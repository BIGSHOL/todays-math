/**
 * RPM(sumaek) 원본 그림 회수.
 *
 * 배경: RPM 이관은 그림을 **한 장도** 싣지 못했다(실측 4,862행 전부 `figureUrls` 빈 배열).
 * 원인은 `recover-rpm-answers.ts` 가 고친 「훑지 않은 키」와 다르다 — 원본
 * `question_versions.body`/`choices` JSON 안에는 그림 노드가 **애초에 0개**다
 * (본문 노드 타입 전수: text 40,281 · math 38,253 · paragraph 6,151 ·
 * choice_group 1,920 · condition_box 150). 그래서 `flattenStructured` 의
 * `FIGURE_TYPES` 분기는 이 데이터에 대해 한 번도 발화한 적이 없다.
 * 그림은 별도 테이블 `diagram_assets` 에 있고, **적재 파이프라인이 그 테이블을
 * 조회하지 않았다.** 「훑지 않은 키」가 아니라 「조회하지 않은 테이블」이다.
 *
 * 형태: `diagram_assets.original_crop_path` 는 공개 Supabase Storage 의 PNG 경로다
 * (`svg_path` 는 전부 NULL). 주소는 `{SUPABASE_URL}/storage/v1/object/public/diagrams/{path}`
 * — sumaek `apps/web/src/lib/content/diagrams.ts` 와 같은 버킷명이라야 한다.
 *
 * ⚠️ 그림은 **문항 버전이 아니라 문항**으로 되찾는다. 표는 `question_version_id` 로
 * 매여 있지만 그림은 그 버전의 것이 아니라 **그 문항이 실려 있던 지면**의 것이라,
 * 본문을 고쳐 새 버전이 생기면 그림만 옛 버전에 매인 채 조용히 사라진다
 * (sumaek 실측 2026-08-10, 129건). 그래서 현재 버전에 매인 것이 있으면 그것을 쓰고,
 * 없으면 같은 문항의 가장 최근 버전 것을 쓴다. 현재 버전만 보면 1,482장,
 * 문항으로 넓히면 1,605장이다(그림을 여러 버전에 걸쳐 가진 문항은 5개뿐이고
 * 그 5개도 고른 버전이 항상 최대 집합이라, 버전 합계 1,611 중 6장은 중복이다).
 *
 * 짝짓기: 적재 때 `externalId` 를 버려서 키 조인이 안 된다(실측 0건). 그래서
 * `recover-rpm-answers.ts` 와 **같은 본문 매칭**을 쓴다 — 원본 body+choices 를 적재
 * 당시 형태와 마커 복원 형태로 모두 펴서 키를 걸고, 후보가 하나일 때만 쓴다.
 *
 * ⚠️ 본문중복(후보 2+) 233건은 **글자는 같은데 그림만 다른 쌍둥이**다. 그래서
 * 기본 제외한다. 후보들의 그림 경로가 완전히 같은 4건만 `--include-ambiguous` 뒤에서
 * 허용한다 — 어느 원본이든 결과가 같으므로 그때만 안전하다.
 *
 * 접속 정보는 저장소에 넣지 않는다 — `SUMAEK_DATABASE_URL` / `SUMAEK_SUPABASE_URL` 을
 * 먼저 보고, 없으면 `SUMAEK_ENV_PATH`(기본 `C:\Creative\sumaek\.env`)를 파싱한다.
 * 원본 DB 에는 **SELECT 만** 한다(`SET TRANSACTION READ ONLY`).
 *
 *   npx tsx scripts/qa/recover-rpm-figures.ts                       드라이런(내려받지 않음)
 *   npx tsx scripts/qa/recover-rpm-figures.ts --include-ambiguous   경로 일치 중복분까지
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/recover-rpm-figures.ts --apply
 */
import type { Dirent } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { flattenStructured } from "../../src/lib/import/flattenStructured";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { readEnvFile } from "../import/readEnvFile";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";
/** sumaek `apps/web/src/lib/content/diagrams.ts` 의 BUCKET 과 같은 이름이어야 한다. */
const BUCKET = "diagrams";
/** 공개 버킷이지만 원장님 소유 프로젝트다 — 동시 요청을 낮게 잡는다. */
const CONCURRENCY = 6;
const RETRIES = 2;
/** PNG 매직 바이트. HTML 오류 페이지를 이미지로 저장하면 지면에서 깨진다. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIGURE_ROOT = path.join("public", "figures", "rpm");
const PUBLIC_PREFIX = "/figures/rpm";
/** 드라이런 용량 추정용 — 표본 8장 실측 평균(15.1 KB). 받은 것이 생기면 그 실측이 이긴다. */
const SAMPLED_SHEET_BYTES = 15.1 * 1024;

/**
 * 그림은 문항 단위로 넓혀 찾는다(머리말 참조). 현재 버전에 매인 것이 있으면 그것,
 * 없으면 같은 문항의 가장 최근 버전 것 — sumaek `fetchQuestionDiagrams` 와 같은 규칙.
 */
const SOURCE_SELECT = `
WITH ranked AS (
  SELECT
    v.question_id,
    da.original_crop_path,
    da.alt_text,
    (da.structure->>'index')::int AS idx,
    dense_rank() OVER (
      PARTITION BY v.question_id
      ORDER BY (v.id = q.current_version_id) DESC, v.version_number DESC
    ) AS version_rank
  FROM diagram_assets da
  JOIN question_versions v ON v.id = da.question_version_id
  JOIN questions q ON q.id = v.question_id
  WHERE q.source_ref IS NOT NULL
    AND da.original_crop_path IS NOT NULL
)
SELECT
  q.id::text AS id,
  qv.body,
  qv.choices,
  (
    SELECT json_agg(json_build_object('path', r.original_crop_path, 'alt', r.alt_text)
                    ORDER BY r.idx NULLS LAST, r.original_crop_path)
    FROM ranked r
    WHERE r.question_id = q.id AND r.version_rank = 1
  ) AS diagrams
FROM questions q
JOIN question_versions qv ON qv.id = q.current_version_id
WHERE q.source_ref IS NOT NULL
`;

interface SqlClient {
  unsafe: (query: string) => Promise<Array<Record<string, unknown>>>;
  end: () => Promise<void>;
}
type PostgresFactory = (
  url: string,
  options?: Record<string, unknown>,
) => SqlClient;

interface Diagram {
  /** 원본 스토리지 경로 — 버킷 이름은 붙지 않는다. */
  path: string;
  alt: string | null;
}

interface SourceRow {
  id: string;
  /** 적재 당시 형태 — `body + choices` 를 편 문자열. */
  content: string;
  /** `restore-choice-markers.ts` 가 만들어 넣는 형태 — `지문 + 마커 보기`. */
  restoredContent: string;
  diagrams: Diagram[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

interface ChoiceItem {
  order: number;
  marker: string;
  text: string;
}

/** 원본 보기 배열 → `{order, marker, text}`. `recover-rpm-answers.ts` 와 같은 규칙. */
function toChoiceItems(raw: unknown): ChoiceItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ChoiceItem[] = [];
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const marker =
      typeof record.marker === "string" ? record.marker.trim() : "";
    const order = typeof record.order === "number" ? record.order : index + 1;
    const text = flattenStructured(record.content).content.trim();
    if (!marker || !text) return;
    items.push({ order, marker, text });
  });
  return items.sort((a, b) => a.order - b.order);
}

/** 지문 뒤에 마커 없이 겹쳐 붙은 보기 값 — 완전일치일 때만 잘라 낸다. */
function stripDuplicatedChoiceTail(body: string, items: ChoiceItem[]): string {
  if (items.length === 0) return body;
  const tail = items
    .map((item) => item.text)
    .join("")
    .replace(/\s+/g, "");
  if (!tail) return body;
  const segments = body.split("\n\n");
  for (let take = segments.length; take > 0; take -= 1) {
    const candidate = segments
      .slice(segments.length - take)
      .join("")
      .replace(/\s+/g, "");
    if (candidate === tail) {
      return segments
        .slice(0, segments.length - take)
        .join("\n\n")
        .trimEnd();
    }
  }
  return body;
}

function toDiagrams(value: unknown): Diagram[] {
  if (!Array.isArray(value)) return [];
  const items: Diagram[] = [];
  for (const raw of value) {
    const record = asRecord(raw);
    const storagePath = typeof record?.path === "string" ? record.path : "";
    if (!storagePath) continue;
    items.push({
      path: storagePath,
      alt: typeof record?.alt === "string" ? record.alt : null,
    });
  }
  return items;
}

function toSourceRow(row: Record<string, unknown>): SourceRow | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const body = flattenStructured(row.body);
  const choices = flattenStructured(row.choices);
  // 적재 때(convertRpmExtractedRow)와 같은 조립 순서라야 본문이 일치한다.
  const content = [body.content, choices.content].filter(Boolean).join("\n\n");

  const choiceItems = toChoiceItems(row.choices);
  const stem = stripDuplicatedChoiceTail(body.content, choiceItems);
  const block = choiceItems
    .map((choice) => `${choice.marker} ${choice.text}`)
    .join("\n\n");

  return {
    id,
    content,
    // 마커 복원본과 **글자 단위로 같은** 문자열이라야 복원 후에도 짝이 맞는다.
    restoredContent: [stem, block].filter(Boolean).join("\n\n"),
    diagrams: toDiagrams(row.diagrams),
  };
}

const normalizeContent = (value: string): string => value.replace(/\s+/g, "");

/** 보기 마커 복원 전/후 양쪽에 걸리는 짝짓기 키 — `recover-rpm-answers.ts` 와 동일. */
function canonicalKey(content: string): string {
  const parsed = parseProblemContent(content);
  return normalizeContent(parsed.question + parsed.choices.join(""));
}

function keysOf(content: string): string[] {
  return [
    ...new Set([normalizeContent(content), canonicalKey(content)]),
  ].filter(Boolean);
}

interface SumaekEnv {
  databaseUrl: string | null;
  supabaseUrl: string | null;
}

async function resolveSumaekEnv(): Promise<SumaekEnv> {
  const envFile = await readEnvFile(
    process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV,
  );
  return {
    databaseUrl:
      process.env.SUMAEK_DATABASE_URL?.trim() ||
      envFile?.DATABASE_URL?.trim() ||
      null,
    supabaseUrl:
      process.env.SUMAEK_SUPABASE_URL?.trim() ||
      envFile?.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
      envFile?.SUPABASE_URL?.trim() ||
      null,
  };
}

async function readSource(
  url: string,
): Promise<Array<Record<string, unknown>>> {
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  const loaded = (await import(pathToFileURL(driverPath).href)) as {
    default: PostgresFactory;
  };
  const sql = loaded.default(url, {
    max: 1,
    prepare: false,
    connection: { application_name: "recover-rpm-figures-readonly" },
  });
  try {
    // 원본 저장소는 읽기만 한다 — 세션 자체를 읽기 전용으로 잠근다.
    await sql.unsafe("SET default_transaction_read_only = on");
    await sql.unsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    return await sql.unsafe(SOURCE_SELECT);
  } finally {
    await sql.end();
  }
}

interface Plan {
  problemId: string;
  sourceId: string;
  /** 내려받을 것들 — 지면 순서(`structure->>'index'`)를 지킨다. */
  files: Array<{ storagePath: string; localPath: string; publicPath: string }>;
}

function planFor(problemId: string, source: SourceRow): Plan {
  return {
    problemId,
    sourceId: source.id,
    files: source.diagrams.map((diagram, index) => {
      const name = `${index}.png`;
      return {
        storagePath: diagram.path,
        localPath: path.join(FIGURE_ROOT, source.id, name),
        publicPath: `${PUBLIC_PREFIX}/${source.id}/${name}`,
      };
    }),
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

interface DownloadStats {
  downloaded: number;
  skipped: number;
  failed: number;
  bytes: number;
  failures: string[];
}

/** 받은 것이 진짜 PNG 인지 본다 — HTML 오류 페이지를 저장하면 지면에서 깨진다. */
function isPng(buffer: Buffer): boolean {
  return (
    buffer.length > PNG_MAGIC.length && buffer.subarray(0, 8).equals(PNG_MAGIC)
  );
}

async function downloadOne(
  supabaseUrl: string,
  file: Plan["files"][number],
  stats: DownloadStats,
): Promise<void> {
  if (await exists(file.localPath)) {
    stats.skipped += 1;
    return;
  }
  const url = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${file.storagePath}`;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!isPng(buffer)) throw new Error("PNG 아님(오류 페이지 의심)");
      await mkdir(path.dirname(file.localPath), { recursive: true });
      await writeFile(file.localPath, buffer);
      stats.downloaded += 1;
      stats.bytes += buffer.length;
      return;
    } catch (error) {
      if (attempt === RETRIES) {
        stats.failed += 1;
        // 경로만 남긴다 — 접속 정보는 로그에도 넣지 않는다.
        stats.failures.push(`${file.publicPath} — ${(error as Error).message}`);
      }
    }
  }
}

/** 실패는 세고 넘어간다. 동시 요청은 CONCURRENCY 로 묶는다. */
async function downloadAll(
  supabaseUrl: string,
  plans: Plan[],
): Promise<DownloadStats> {
  const stats: DownloadStats = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    failures: [],
  };
  const queue = plans.flatMap((plan) => plan.files);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) return;
        await downloadOne(supabaseUrl, queue[index], stats);
      }
    },
  );
  await Promise.all(workers);
  return stats;
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(full);
    } else {
      total += (await stat(full)).size;
    }
  }
  return total;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const includeAmbiguous = process.argv.includes("--include-ambiguous");

  const { databaseUrl, supabaseUrl } = await resolveSumaekEnv();
  if (!databaseUrl) {
    console.log(
      "원본 접속 정보가 없습니다 — SUMAEK_DATABASE_URL 또는 SUMAEK_ENV_PATH 를 지정하세요.",
    );
    return;
  }
  if (!supabaseUrl) {
    console.log(
      "원본 스토리지 주소가 없습니다 — SUMAEK_SUPABASE_URL 또는 SUMAEK_ENV_PATH 를 지정하세요.",
    );
    return;
  }

  const rawRows = await readSource(databaseUrl);
  const sourceRows = rawRows
    .map(toSourceRow)
    .filter((row): row is SourceRow => row !== null);
  const withDiagram = sourceRows.filter((row) => row.diagrams.length > 0);
  const sourceSheets = withDiagram.reduce(
    (sum, row) => sum + row.diagrams.length,
    0,
  );

  const byKey = new Map<string, Set<SourceRow>>();
  for (const row of sourceRows) {
    for (const key of [
      ...new Set([...keysOf(row.content), ...keysOf(row.restoredContent)]),
    ]) {
      const bucket = byKey.get(key) ?? new Set<SourceRow>();
      bucket.add(row);
      byKey.set(key, bucket);
    }
  }

  function candidatesFor(content: string): SourceRow[] {
    const found = new Set<SourceRow>();
    for (const key of keysOf(content)) {
      for (const row of byKey.get(key) ?? []) found.add(row);
    }
    return [...found];
  }

  /** 후보가 여럿이어도 그림 경로가 완전히 같으면 어느 쪽을 골라도 결과가 같다. */
  function agreedDiagrams(candidates: SourceRow[]): SourceRow | null {
    const signatures = new Set(
      candidates.map((row) => row.diagrams.map((d) => d.path).join("|")),
    );
    if (signatures.size !== 1) return null;
    return candidates[0].diagrams.length > 0 ? candidates[0] : null;
  }

  const prisma = new PrismaClient();
  try {
    const problems = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: { id: true, content: true, figureUrls: true },
    });

    const plans: Plan[] = [];
    let matchedUnique = 0;
    let unmatched = 0;
    let ambiguous = 0;
    let ambiguousTaken = 0;
    let noDiagram = 0;
    let alreadyHasUrls = 0;

    for (const problem of problems) {
      const candidates = candidatesFor(problem.content);
      if (candidates.length === 0) {
        unmatched += 1;
        continue;
      }

      let source: SourceRow | null = null;
      if (candidates.length === 1) {
        matchedUnique += 1;
        source = candidates[0];
      } else {
        // 글자는 같은데 그림만 다른 쌍둥이다 — 기본은 건드리지 않는다.
        ambiguous += 1;
        if (!includeAmbiguous) continue;
        source = agreedDiagrams(candidates);
        if (!source) continue;
        ambiguousTaken += 1;
      }

      if (source.diagrams.length === 0) {
        noDiagram += 1;
        continue;
      }
      if (problem.figureUrls.length > 0) {
        alreadyHasUrls += 1;
        continue;
      }
      plans.push(planFor(problem.id, source));
    }

    const sheets = plans.reduce((sum, plan) => sum + plan.files.length, 0);
    const alreadyOnDisk = (
      await Promise.all(
        plans.flatMap((plan) => plan.files.map((f) => exists(f.localPath))),
      )
    ).filter(Boolean).length;

    console.log("── RPM 원본 그림 회수 ──");
    console.log(
      `원본 문항 ${sourceRows.length} · 그림 보유 ${withDiagram.length}` +
        ` · 그림 장수 ${sourceSheets}`,
    );
    console.log(
      `우리 transformed ${problems.length} — 유일매칭 ${matchedUnique}` +
        ` · 본문중복 ${ambiguous}(경로일치로 채택 ${ambiguousTaken}` +
        `${includeAmbiguous ? "" : ", 기본 제외 — --include-ambiguous"})` +
        ` · 매칭실패 ${unmatched}`,
    );
    console.log(
      `회수 대상 ${plans.length}문항 / ${sheets}장` +
        ` (이미 내려받힌 파일 ${alreadyOnDisk}장)`,
    );
    console.log(
      `제외 — 원본에 그림 없음 ${noDiagram}` +
        ` · 이미 figureUrls 있음 ${alreadyHasUrls}`,
    );

    if (!apply) {
      // 드라이런은 내려받지 않는다. 용량은 이미 받아 둔 것의 실측 평균으로 잡는다.
      const existingBytes = await directorySize(FIGURE_ROOT);
      const perSheet =
        alreadyOnDisk > 0 ? existingBytes / alreadyOnDisk : SAMPLED_SHEET_BYTES;
      const remaining = sheets - alreadyOnDisk;
      console.log(
        `\n드라이런 — 변경 없음. public/figures/rpm 현재 ${mb(existingBytes)}` +
          ` · 남은 ${remaining}장 예상 ${mb(perSheet * remaining)}` +
          (alreadyOnDisk > 0 ? "" : " (표본 8장 실측 평균 기준)"),
      );
      console.log(
        `적용하려면 --apply (대상 ${plans.length}문항 / ${sheets}장)`,
      );
      return;
    }

    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      return;
    }

    const stats = await downloadAll(supabaseUrl, plans);
    console.log(
      `\n내려받기 — 신규 ${stats.downloaded} · 건너뜀 ${stats.skipped}` +
        ` · 실패 ${stats.failed} · ${mb(stats.bytes)}`,
    );
    for (const failure of stats.failures.slice(0, 20)) {
      console.log(`  실패: ${failure}`);
    }

    // 파일이 실제로 있는 것만 DB 에 적는다 — 실패한 장은 경로를 남기지 않는다.
    let updated = 0;
    let partial = 0;
    for (const plan of plans) {
      const present: string[] = [];
      for (const file of plan.files) {
        if (await exists(file.localPath)) present.push(file.publicPath);
      }
      if (present.length === 0) continue;
      if (present.length < plan.files.length) partial += 1;
      await prisma.problem.update({
        where: { id: plan.problemId },
        data: { figureUrls: present, figureSource: "source" },
      });
      updated += 1;
    }
    const finalBytes = await directorySize(FIGURE_ROOT);
    console.log(
      `\n회수 완료 — ${updated}문항 (일부 장만 받힌 문항 ${partial})` +
        ` · public/figures/rpm ${mb(finalBytes)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
