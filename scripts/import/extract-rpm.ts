/**
 * sumaek RPM 추출 — SELECT 만. 쓰기는 시도하지 않는다.
 * 실패하면 리포트에 이유만 남기고 프로세스를 실패로 끝내지 않는다.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { classifyDrafts } from "../../src/lib/import/buildReport";
import { convertRpmExtractedRow } from "../../src/lib/import/convertRpm";
import {
  filterReportItems,
  summarizeImportReport,
} from "../../src/lib/import/parseReport";
import { isDirectScript } from "./isDirectScript";
import { seedUnitsAsLike } from "./loadUnits";
import { readEnvFile } from "./readEnvFile";
import { writeJson } from "./writeJson";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";

const RPM_SELECT = `
SELECT
  q.id::text AS id,
  q.kind,
  q.printed_number,
  q.source_ref,
  q.review_status,
  q.is_auto_assignable,
  qv.body,
  qv.choices,
  qv.answer,
  qv.explanation,
  qv.difficulty,
  qv.question_type_tags,
  (
    SELECT COALESCE(json_agg(json_build_object(
      'name', c.name,
      'grade_band', c.grade_band,
      'slug', c.slug
    )), '[]'::json)
    FROM question_alignments qa
    JOIN canonical_concepts c ON c.id = qa.concept_id
    WHERE qa.question_id = q.id
  ) AS concepts
FROM questions q
LEFT JOIN question_versions qv ON qv.id = q.current_version_id
WHERE q.source_ref IS NOT NULL
`;

export interface RpmExtractResult {
  ok: boolean;
  reason?: string;
  rowCount: number;
  summary?: ReturnType<typeof summarizeImportReport>;
  lockedAll?: boolean;
}

function redactReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/:[^@/\s]+@/g, ":****@").slice(0, 400);
}

async function loadSumaekEnv(): Promise<Record<string, string> | null> {
  const override = process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV;
  return readEnvFile(override);
}

async function extractViaPostgres(
  databaseUrl: string,
): Promise<Array<Record<string, unknown>>> {
  await access(DEFAULT_POSTGRES_JS);
  const loaded = (await import(pathToFileURL(DEFAULT_POSTGRES_JS).href)) as {
    default: (
      url: string,
      options?: Record<string, unknown>,
    ) => {
      unsafe: (query: string) => Promise<Array<Record<string, unknown>>>;
      end: () => Promise<void>;
    };
  };
  const sql = loaded.default(databaseUrl, {
    max: 1,
    prepare: false,
    connection: { application_name: "t30-rpm-readonly" },
  });
  try {
    await sql.unsafe("SET default_transaction_read_only = on");
    await sql.unsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    return await sql.unsafe(RPM_SELECT);
  } finally {
    await sql.end();
  }
}

async function extractViaRest(
  env: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const base = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!base || !key) {
    throw new Error("Supabase REST URL/키가 없습니다.");
  }

  const questions: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const url = `${base}/rest/v1/questions?source_ref=not.is.null&select=id,kind,printed_number,source_ref,review_status,is_auto_assignable,current_version_id`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${to}`,
        Prefer: "count=exact",
      },
    });
    if (!response.ok) {
      throw new Error(`questions REST ${response.status}`);
    }
    const batch = (await response.json()) as Array<Record<string, unknown>>;
    questions.push(...batch);
    if (batch.length < pageSize) break;
  }

  const versionIds = questions
    .map((row) => row.current_version_id)
    .filter((id): id is string => typeof id === "string");
  const versions = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < versionIds.length; i += 80) {
    const chunk = versionIds.slice(i, i + 80);
    const url = `${base}/rest/v1/question_versions?id=in.(${chunk.join(",")})&select=id,question_id,body,choices,answer,explanation,difficulty,question_type_tags`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!response.ok)
      throw new Error(`question_versions REST ${response.status}`);
    const batch = (await response.json()) as Array<Record<string, unknown>>;
    for (const row of batch) {
      if (typeof row.question_id === "string")
        versions.set(row.question_id, row);
    }
  }

  return questions.map((row) => {
    const version = versions.get(String(row.id)) ?? {};
    return {
      id: row.id,
      kind: row.kind,
      printed_number: row.printed_number,
      source_ref: row.source_ref,
      review_status: row.review_status,
      is_auto_assignable: row.is_auto_assignable,
      body: version.body,
      choices: version.choices,
      answer: version.answer,
      explanation: version.explanation,
      difficulty: version.difficulty,
      question_type_tags: version.question_type_tags,
      concepts: [],
    };
  });
}

export async function runRpmExtract(outDir: string): Promise<RpmExtractResult> {
  const env = await loadSumaekEnv();
  if (!env) {
    const result: RpmExtractResult = {
      ok: false,
      reason: `sumaek .env를 읽지 못했습니다 (${DEFAULT_SUMAEK_ENV}).`,
      rowCount: 0,
    };
    await writeJson(path.join(outDir, "rpm-extract.json"), result);
    return result;
  }

  let rows: Array<Record<string, unknown>> = [];
  let method = "";
  try {
    if (env.DATABASE_URL) {
      rows = await extractViaPostgres(env.DATABASE_URL);
      method = "postgres-readonly";
    } else {
      throw new Error("DATABASE_URL 없음 — REST로 시도");
    }
  } catch (error) {
    try {
      rows = await extractViaRest(env);
      method = "supabase-rest-get";
    } catch (restError) {
      const result: RpmExtractResult = {
        ok: false,
        reason: `RPM 추출 실패(읽기 전용). sql=${redactReason(error)}; rest=${redactReason(restError)}`,
        rowCount: 0,
      };
      await writeJson(path.join(outDir, "rpm-extract.json"), result);
      console.log(`[rpm-extract] skipped: ${result.reason}`);
      return result;
    }
  }

  const drafts = rows.map((row) =>
    convertRpmExtractedRow({
      id: String(row.id),
      kind: typeof row.kind === "string" ? row.kind : null,
      printed_number:
        typeof row.printed_number === "string" ? row.printed_number : null,
      source_ref:
        row.source_ref && typeof row.source_ref === "object"
          ? (row.source_ref as Record<string, unknown>)
          : null,
      body: row.body,
      choices: row.choices,
      answer: row.answer,
      explanation: row.explanation,
      difficulty: row.difficulty,
      question_type_tags: row.question_type_tags,
      concepts: Array.isArray(row.concepts)
        ? (row.concepts as Array<{ name?: string; grade_band?: string }>)
        : [],
    }),
  );
  const { report } = classifyDrafts("transformed", drafts, seedUnitsAsLike());
  const lockedAll = drafts.every((draft) => draft.directUseAllowed === false);
  await writeJson(path.join(outDir, "rpm-report.json"), report);
  await writeJson(
    path.join(outDir, "rpm-unclassified.json"),
    filterReportItems(report, "unclassified"),
  );
  await writeJson(
    path.join(outDir, "rpm-figures.json"),
    filterReportItems(report, "skipped_figure"),
  );
  await writeJson(path.join(outDir, "rpm-dump.json"), {
    method,
    count: rows.length,
    ids: drafts.map((draft) => draft.externalId),
  });
  const result: RpmExtractResult = {
    ok: true,
    rowCount: rows.length,
    summary: summarizeImportReport(report),
    lockedAll,
  };
  await writeJson(path.join(outDir, "rpm-extract.json"), {
    ...result,
    method,
  });
  console.log(
    `[rpm-extract] method=${method} rows=${rows.length} ok=${report.ok} unclassified=${report.unclassified} skippedFigure=${report.skippedFigure} lockedAll=${lockedAll}`,
  );
  return result;
}

if (isDirectScript(import.meta.url)) {
  runRpmExtract("scripts/import/reports").catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
