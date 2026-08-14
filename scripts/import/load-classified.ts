/**
 * classified 문항 createMany.
 * 로컬 docker/개발 DB이거나, ALLOW_SHARED_IMPORT=1 이고 대상이 Supabase일 때 실행한다.
 * 그 외 원격은 INSERT를 하지 않고 리포트만 남긴다.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import {
  toLoadRows,
  type ImportLoadRow,
} from "../../src/lib/import/toLoadRows";
import type { ImportDraft } from "../../src/lib/import/types";
import { isDirectScript } from "./isDirectScript";
import { seedUnitByPlaceholder } from "./loadUnits";
import { readEnvFile } from "./readEnvFile";
import { inspectDatabaseTargets } from "./resolveDbTarget";
import { writeJson } from "./writeJson";

const IMPORT_USER_EMAIL = "import@todays-math.local";

export interface LoadResult {
  loaded: boolean;
  inserted: number;
  alreadyPresent: number;
  skippedOversized: number;
  skippedDuplicates: number;
  reason: string;
  selectedSource: string;
  selectedKind: string;
}

type ClassifiedDraft = ImportDraft & { unitId: string };

interface ExistingImportRow {
  unitId: string;
  source: string;
  difficulty: string;
  problemType: string;
  content: string;
  answer: string;
  solution: string | null;
  reviewStatus: string;
  directUseAllowed: boolean;
  pool: string;
  /** 원본 고유 키 — 있으면 내용 대조보다 우선해 중복을 막는다 */
  externalId?: string | null;
}

const LOAD_LOCK_KEY = "todays-math/load-classified/v1";
const LOAD_BATCH_SIZE = 200;

function loadRowKey(row: ExistingImportRow): string {
  return JSON.stringify([
    row.unitId,
    row.source,
    row.difficulty,
    row.problemType,
    row.content,
    row.answer,
    row.solution,
    row.reviewStatus,
    row.directUseAllowed,
    row.pool,
  ]);
}

/**
 * 기존 적재분을 다중집합으로 대조해 누락된 발생분만 반환한다.
 *
 * 동일한 문제가 원본 자료에 여러 번 있더라도 개수를 보존하고, 예전 로더가 일부 배치만
 * 커밋한 DB에서는 이미 들어간 행을 건드리지 않은 채 나머지만 이어서 적재한다.
 */
export function selectMissingLoadRows(
  desired: ImportLoadRow[],
  existing: ExistingImportRow[],
): ImportLoadRow[] {
  const existingCounts = new Map<string, number>();
  // externalId 는 원본 고유 키다. 내용 대조(loadRowKey)는 answer 를 포함하는데,
  // 2026-08-14 정답 백필로 기존 행의 answer 가 바뀌었다 — 내용만 보면 같은 문항을
  // '새 것'으로 오인해 중복 삽입한다. externalId 가 있으면 그것을 우선한다.
  const existingExternalIds = new Set<string>();
  for (const row of existing) {
    if (row.externalId) existingExternalIds.add(row.externalId);
    const key = loadRowKey(row);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  const missing: ImportLoadRow[] = [];
  for (const row of desired) {
    if (row.externalId && existingExternalIds.has(row.externalId)) continue;
    const key = loadRowKey(row);
    const count = existingCounts.get(key) ?? 0;
    if (count > 0) {
      existingCounts.set(key, count - 1);
    } else {
      missing.push(row);
    }
  }
  return missing;
}

async function readClassified(filePath: string): Promise<ClassifiedDraft[]> {
  try {
    const raw = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as ClassifiedDraft[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function applyWorktreeEnv(file: Record<string, string>): void {
  process.env.DATABASE_URL = file.DATABASE_URL;
  process.env.DIRECT_URL = file.DIRECT_URL ?? file.DATABASE_URL;
}

export async function loadClassifiedAtomically(
  prisma: PrismaClient,
  classified: ClassifiedDraft[],
): Promise<{
  inserted: number;
  alreadyPresent: number;
  skippedOversized: number;
}> {
  return prisma.$transaction(
    async (tx) => {
      // 별도 프로세스에서 동시에 실행해도 둘 다 "기존 0건"을 보고 중복 삽입하지 않게 한다.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOAD_LOCK_KEY}))`;

      const user = await tx.user.upsert({
        where: { email: IMPORT_USER_EMAIL },
        update: {},
        create: {
          email: IMPORT_USER_EMAIL,
          name: "이관 계정",
        },
      });

      const dbUnits = await tx.unit.findMany({
        select: { id: true, grade: true, chapter: true, section: true },
      });
      const byKey = new Map<string, string>(
        dbUnits.map((unit) => [
          `${unit.grade}\0${unit.chapter}\0${unit.section}`,
          unit.id,
        ]),
      );

      const remapped: ClassifiedDraft[] = [];
      for (const draft of classified) {
        const seed = seedUnitByPlaceholder(draft.unitId);
        const unitId = seed
          ? byKey.get(`${seed.grade}\0${seed.chapter}\0${seed.section}`)
          : draft.unitId;
        if (!unitId) continue;
        remapped.push({ ...draft, unitId });
      }

      const { rows, skipped } = toLoadRows(remapped, user.id);
      const existing = await tx.problem.findMany({
        where: { userId: user.id },
        select: {
          unitId: true,
          source: true,
          difficulty: true,
          problemType: true,
          content: true,
          answer: true,
          solution: true,
          reviewStatus: true,
          directUseAllowed: true,
          pool: true,
          externalId: true,
        },
      });
      const missing = selectMissingLoadRows(rows, existing);

      let inserted = 0;
      for (let i = 0; i < missing.length; i += LOAD_BATCH_SIZE) {
        const chunk = missing.slice(i, i + LOAD_BATCH_SIZE);
        const result = await tx.problem.createMany({ data: chunk });
        inserted += result.count;
      }

      return {
        inserted,
        alreadyPresent: rows.length - missing.length,
        skippedOversized: skipped.length,
      };
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

export async function runLoadIfLocal(outDir: string): Promise<LoadResult> {
  const inspection = await inspectDatabaseTargets();
  const base = {
    selectedSource: inspection.selectedSource,
    selectedKind: inspection.selected.kind,
  };

  const sharedAllowed = allowSharedImport(inspection.selected);
  if (!inspection.selected.canMigrateOrLoad && !sharedAllowed) {
    const reasons = [inspection.selected.reason];
    if (inspection.mainRepoDotenv.kind === "supabase") {
      reasons.push(
        "메인 .env는 공유 Supabase — ALLOW_SHARED_IMPORT=1 일 때만 적재",
      );
    }
    const result: LoadResult = {
      loaded: false,
      inserted: 0,
      alreadyPresent: 0,
      skippedOversized: 0,
      skippedDuplicates: 0,
      reason: reasons.filter(Boolean).join(" / "),
      ...base,
    };
    await writeJson(path.join(outDir, "load-result.json"), {
      ...result,
      inspection: {
        env: inspection.env,
        worktreeDotenv: inspection.worktreeDotenv,
        mainRepoDotenv: {
          kind: inspection.mainRepoDotenv.kind,
          canMigrateOrLoad: inspection.mainRepoDotenv.canMigrateOrLoad,
          reason: inspection.mainRepoDotenv.reason,
        },
      },
    });
    console.log(`[load] skipped: ${result.reason}`);
    return result;
  }

  if (inspection.selectedSource === "worktree-dotenv") {
    const file = await readEnvFile(path.join(process.cwd(), ".env"));
    if (!file?.DATABASE_URL) {
      throw new Error("worktree .env의 DATABASE_URL을 다시 읽지 못했습니다.");
    }
    applyWorktreeEnv(file);
  }

  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    shell: true,
  });
  if (migrate.status !== 0) {
    throw new Error(
      `prisma migrate deploy 실패: ${migrate.stderr || migrate.stdout}`,
    );
  }
  const seed = spawnSync("npx", ["prisma", "db", "seed"], {
    encoding: "utf8",
    shell: true,
  });
  if (seed.status !== 0) {
    throw new Error(`prisma db seed 실패: ${seed.stderr || seed.stdout}`);
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const classified = (
      await Promise.all([
        readClassified(path.join(outDir, "manual-classified.json")),
        readClassified(path.join(outDir, "ocr-classified.json")),
        readClassified(path.join(outDir, "rpm-classified.json")),
      ])
    ).flat();
    const load = await loadClassifiedAtomically(prisma, classified);

    const result: LoadResult = {
      loaded: load.inserted > 0,
      ...load,
      skippedDuplicates: load.alreadyPresent,
      reason:
        load.inserted > 0
          ? `${sharedAllowed ? "공유 공용 풀" : "로컬 DB"}의 기존 ${load.alreadyPresent}건을 유지하고 누락 ${load.inserted}건을 원자적으로 적재했습니다.`
          : `classified 문항 ${load.alreadyPresent}건이 모두 이미 적재되어 있습니다.`,
      ...base,
    };
    await writeJson(path.join(outDir, "load-result.json"), result);
    console.log(
      `[load] inserted=${load.inserted} existing=${load.alreadyPresent} skipped=${load.skippedOversized}`,
    );
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runLoadIfLocal("scripts/import/reports").catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
