import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyDrafts } from "../../src/lib/import/buildReport";
import {
  convertPastExamPaper,
  normalizePastExamPaper,
  type PastExamAnswer,
  type PastExamPaper,
} from "../../src/lib/import/convertPastExam";
import { problemFingerprint } from "../../src/lib/import/problemFingerprint";
import { IMPORT_TEXT_MAX } from "../../src/lib/import/toLoadRows";
import type { ImportDraft } from "../../src/lib/import/types";
import { classifyDatabaseUrl } from "../../src/lib/import/classifyDatabaseUrl";
import { readEnvFile } from "../import/readEnvFile";
import { seedUnitsAsLike } from "../import/loadUnits";

interface Args {
  sourceDir: string;
  dbEnvFile?: string;
  outFile?: string;
}

interface ResolvedDatabase {
  url: string | null;
  directUrl: string | null;
  reason: string | null;
  selectedSource: "db-env-file" | "none" | "process";
}

function parseArgs(argv: string[]): Args {
  const valueAfter = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    sourceDir: valueAfter("--source-dir") ?? "F:\\시험지변환기\\db\\ocr_pilot",
    dbEnvFile: valueAfter("--db-env-file"),
    outFile: valueAfter("--out"),
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function redactError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "<redacted-db-url>")
    .slice(0, 1000);
}

function isLoadable(draft: ImportDraft): boolean {
  return (
    Boolean(draft.content.trim()) &&
    draft.content.length <= IMPORT_TEXT_MAX &&
    draft.answer.length <= IMPORT_TEXT_MAX
  );
}

async function inspectSource(sourceDir: string) {
  const names = await readdir(sourceDir);
  const primaryFiles = names
    .filter(
      (name) =>
        name.endsWith(".json") &&
        !name.endsWith(".answers.json") &&
        !name.includes("extracted"),
    )
    .sort((a, b) => a.localeCompare(b, "en"));
  const answerFiles = names
    .filter((name) => name.endsWith(".answers.json"))
    .sort((a, b) => a.localeCompare(b, "en"));

  const units = seedUnitsAsLike();
  const reports = [];
  const classified: Array<ImportDraft & { unitId: string }> = [];
  const parseFailures: string[] = [];
  const answerParseFailures: string[] = [];
  const missingAnswerFiles: string[] = [];
  const sourceKinds = new Map<string, number>();
  let parsedPapers = 0;
  let parsedAnswerFiles = 0;
  let questionCount = 0;
  let metaExamIdCount = 0;
  let sourceExamIdCount = 0;
  let fileStemExamIdCount = 0;

  const answerFileSet = new Set(answerFiles);
  for (const file of primaryFiles) {
    let raw: PastExamPaper;
    try {
      raw = JSON.parse(await readFile(path.join(sourceDir, file), "utf8"));
      parsedPapers += 1;
    } catch {
      parseFailures.push(file);
      continue;
    }

    const rawRecord = raw as PastExamPaper & { _source?: unknown };
    const sourceKind =
      typeof rawRecord._source === "string" ? rawRecord._source : "structured";
    sourceKinds.set(sourceKind, (sourceKinds.get(sourceKind) ?? 0) + 1);
    if (raw.meta?.exam_id !== undefined) metaExamIdCount += 1;
    else if (
      typeof rawRecord._source === "object" &&
      rawRecord._source !== null &&
      "exam_id" in rawRecord._source
    ) {
      sourceExamIdCount += 1;
    } else {
      fileStemExamIdCount += 1;
    }

    const questions = raw.questions ?? [];
    questionCount += questions.length;
    const answerName = file.replace(/\.json$/u, ".answers.json");
    let answers: PastExamAnswer[] = [];
    if (!answerFileSet.has(answerName)) {
      missingAnswerFiles.push(file);
    } else {
      try {
        const parsed = JSON.parse(
          await readFile(path.join(sourceDir, answerName), "utf8"),
        ) as { items?: PastExamAnswer[] };
        answers = Array.isArray(parsed.items) ? parsed.items : [];
        parsedAnswerFiles += 1;
      } catch {
        answerParseFailures.push(answerName);
      }
    }

    const paper = normalizePastExamPaper(raw, path.parse(file).name);
    const result = classifyDrafts(
      "past_exam",
      convertPastExamPaper(paper, answers),
      units,
      paper.meta?.subject ?? paper.meta?.grade,
    );
    reports.push(result.report);
    classified.push(...result.classified);
  }

  const summary = reports.reduce(
    (acc, report) => ({
      total: acc.total + report.total,
      ok: acc.ok + report.ok,
      unclassified: acc.unclassified + report.unclassified,
      skippedFigure: acc.skippedFigure + report.skippedFigure,
    }),
    { total: 0, ok: 0, unclassified: 0, skippedFigure: 0 },
  );
  const ready = classified.filter(isLoadable);
  const fingerprints = ready.map((draft) => ({
    externalId: draft.externalId,
    fingerprint: problemFingerprint(draft),
  }));
  const uniqueExternalIds = new Set(
    fingerprints.map((item) => item.externalId),
  );
  const uniqueFingerprints = new Set(
    fingerprints.map((item) => item.fingerprint),
  );
  const idsByFingerprint = new Map<string, string[]>();
  for (const item of fingerprints) {
    const ids = idsByFingerprint.get(item.fingerprint) ?? [];
    ids.push(item.externalId);
    idsByFingerprint.set(item.fingerprint, ids);
  }
  const duplicateFingerprintSamples = [...idsByFingerprint.entries()]
    .filter(([, externalIds]) => externalIds.length > 1)
    .slice(0, 5)
    .map(([fingerprint, externalIds]) => ({ fingerprint, externalIds }));

  return {
    sourceDir,
    fileInventory: {
      primaryFiles: primaryFiles.length,
      parsedPapers,
      parseFailures,
      answerFiles: answerFiles.length,
      parsedAnswerFiles,
      answerParseFailures,
      missingAnswerFiles,
    },
    questionCount,
    classification: {
      ...summary,
      loadable: ready.length,
      oversizedOrEmpty: classified.length - ready.length,
    },
    sourceMetadata: {
      metaExamIdCount,
      sourceExamIdCount,
      fileStemExamIdCount,
      sourceKinds: Object.fromEntries([...sourceKinds.entries()].sort()),
    },
    identity: {
      externalIdCount: fingerprints.length,
      uniqueExternalIds: uniqueExternalIds.size,
      duplicateExternalIds: fingerprints.length - uniqueExternalIds.size,
      uniqueFingerprints: uniqueFingerprints.size,
      duplicateFingerprints: fingerprints.length - uniqueFingerprints.size,
      duplicateFingerprintSamples,
      sample: fingerprints.slice(0, 5),
      inventoryDigest: sha256(
        fingerprints
          .map((item) => `${item.externalId}:${item.fingerprint}`)
          .sort()
          .join("\n"),
      ),
    },
    ready,
    fingerprintSet: uniqueFingerprints,
  };
}

async function resolveDatabase(args: Args): Promise<ResolvedDatabase> {
  if (args.dbEnvFile) {
    const envFile = await readEnvFile(path.resolve(args.dbEnvFile));
    if (!envFile) {
      return {
        url: null,
        directUrl: null,
        reason: `DB env 파일을 읽을 수 없습니다: ${path.resolve(args.dbEnvFile)}`,
        selectedSource: "db-env-file",
      };
    }
    if (!envFile.DATABASE_URL) {
      return {
        url: null,
        directUrl: null,
        reason: "지정한 DB env 파일에 DATABASE_URL이 없습니다.",
        selectedSource: "db-env-file",
      };
    }
    return {
      url: envFile.DATABASE_URL,
      directUrl: envFile.DIRECT_URL ?? envFile.DATABASE_URL,
      reason: null,
      selectedSource: "db-env-file",
    };
  }
  if (!process.env.DATABASE_URL) {
    return {
      url: null,
      directUrl: null,
      reason: "DATABASE_URL이 없고 --db-env-file도 지정되지 않았습니다.",
      selectedSource: "none",
    };
  }
  return {
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    reason: null,
    selectedSource: "process",
  };
}

async function inspectDatabase(
  args: Args,
  source: Awaited<ReturnType<typeof inspectSource>>,
) {
  const resolved = await resolveDatabase(args);
  if (!resolved.url) {
    return {
      status: "unavailable" as const,
      readOnlyTransaction: false,
      selectedSource: resolved.selectedSource,
      reason: resolved.reason,
    };
  }

  process.env.DATABASE_URL = resolved.url;
  process.env.DIRECT_URL = resolved.directUrl ?? resolved.url;
  const target = classifyDatabaseUrl(resolved.url);
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
          const [problemCount, bySource, byReviewStatus, rows, columns] =
            await Promise.all([
              tx.problem.count(),
              tx.problem.groupBy({
                by: ["source"],
                _count: { _all: true },
                orderBy: { source: "asc" },
              }),
              tx.problem.groupBy({
                by: ["reviewStatus"],
                _count: { _all: true },
                orderBy: { reviewStatus: "asc" },
              }),
              tx.problem.findMany({
                where: { source: "past_exam" },
                select: {
                  id: true,
                  source: true,
                  difficulty: true,
                  problemType: true,
                  content: true,
                  answer: true,
                  solution: true,
                  directUseAllowed: true,
                },
                orderBy: { id: "asc" },
              }),
              tx.$queryRawUnsafe<Array<{ column_name: string }>>(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'problem' ORDER BY ordinal_position",
              ),
            ]);

          const targetFingerprints = rows.map((row) => ({
            id: row.id,
            fingerprint: problemFingerprint(row),
          }));
          const targetFingerprintSet = new Set(
            targetFingerprints.map((item) => item.fingerprint),
          );
          const matched = source.ready.filter((draft) =>
            targetFingerprintSet.has(problemFingerprint(draft)),
          );
          const missing = source.ready.filter(
            (draft) => !targetFingerprintSet.has(problemFingerprint(draft)),
          );
          const targetExtras = targetFingerprints.filter(
            (item) => !source.fingerprintSet.has(item.fingerprint),
          );

          return {
            status: "ok" as const,
            selectedSource: resolved.selectedSource,
            targetKind: target.kind,
            readOnlyTransaction: true,
            problemCount,
            bySource: bySource.map((item) => ({
              source: item.source,
              count: item._count._all,
            })),
            byReviewStatus: byReviewStatus.map((item) => ({
              reviewStatus: item.reviewStatus,
              count: item._count._all,
            })),
            pastExam: {
              rows: rows.length,
              uniqueFingerprints: targetFingerprintSet.size,
              duplicateRows: rows.length - targetFingerprintSet.size,
              samples: targetFingerprints.slice(0, 5),
            },
            provenanceColumns: columns
              .map((item) => item.column_name)
              .filter((name) =>
                /external|hash|meta|origin|source/iu.test(name),
              ),
            comparison: {
              matchedLoadableRows: matched.length,
              missingLoadableRows: missing.length,
              targetPastExamRowsNotInSource: targetExtras.length,
              missingSample: missing.slice(0, 5).map((draft) => ({
                externalId: draft.externalId,
                fingerprint: problemFingerprint(draft),
              })),
              targetExtraSample: targetExtras.slice(0, 5),
            },
          };
        },
        { timeout: 60_000 },
      );
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    return {
      status: "unavailable" as const,
      readOnlyTransaction: false,
      selectedSource: resolved.selectedSource,
      targetKind: target.kind,
      reason: redactError(error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = await inspectSource(path.resolve(args.sourceDir));
  const database = await inspectDatabase(args, source);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    source: {
      sourceDir: source.sourceDir,
      fileInventory: source.fileInventory,
      questionCount: source.questionCount,
      classification: source.classification,
      sourceMetadata: source.sourceMetadata,
      identity: source.identity,
    },
    database,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.outFile) {
    const outFile = path.resolve(args.outFile);
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, json, "utf8");
  }
  process.stdout.write(json);
  if (database.status !== "ok") process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(redactError(error));
  process.exitCode = 1;
});
