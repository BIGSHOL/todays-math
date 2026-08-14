/**
 * classified 문항 createMany.
 * 로컬 docker/개발 DB이거나, ALLOW_SHARED_IMPORT=1 이고 대상이 Supabase일 때 실행한다.
 * 그 외 원격은 INSERT를 하지 않고 리포트만 남긴다.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { problemFingerprint } from "../../src/lib/import/problemFingerprint";
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
  skippedOversized: number;
  skippedDuplicates: number;
  reason: string;
  selectedSource: string;
  selectedKind: string;
}

type ClassifiedDraft = ImportDraft & { unitId: string };

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
    const user = await prisma.user.upsert({
      where: { email: IMPORT_USER_EMAIL },
      update: {},
      create: {
        email: IMPORT_USER_EMAIL,
        name: "이관 계정",
      },
    });
    const existingRows = await prisma.problem.findMany({
      select: {
        source: true,
        difficulty: true,
        problemType: true,
        content: true,
        answer: true,
        solution: true,
        directUseAllowed: true,
      },
    });
    const existingFingerprints = new Set(
      existingRows.map((row) => problemFingerprint(row)),
    );

    const dbUnits = (await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    })) as Array<{
      id: string;
      grade: string;
      chapter: string;
      section: string;
    }>;
    const byKey = new Map<string, string>(
      dbUnits.map((unit) => [
        `${unit.grade}\0${unit.chapter}\0${unit.section}`,
        unit.id,
      ]),
    );

    const classified = (
      await Promise.all([
        readClassified(path.join(outDir, "manual-classified.json")),
        readClassified(path.join(outDir, "ocr-classified.json")),
        readClassified(path.join(outDir, "rpm-classified.json")),
      ])
    ).flat();

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
    const fresh = rows.filter(
      (row) => !existingFingerprints.has(problemFingerprint(row)),
    );
    const skippedDuplicates = rows.length - fresh.length;
    const batchSize = 200;
    let inserted = 0;
    for (let i = 0; i < fresh.length; i += batchSize) {
      const chunk: ImportLoadRow[] = fresh.slice(i, i + batchSize);
      const result = await prisma.problem.createMany({ data: chunk });
      inserted += result.count;
    }

    const result: LoadResult = {
      loaded: true,
      inserted,
      skippedOversized: skipped.length,
      skippedDuplicates,
      reason: sharedAllowed
        ? "공유 공용 풀에 classified 문항을 적재했습니다."
        : "로컬 DB에 classified 문항을 적재했습니다.",
      ...base,
    };
    await writeJson(path.join(outDir, "load-result.json"), result);
    console.log(
      `[load] inserted=${inserted} skipped=${skipped.length} dupes=${skippedDuplicates}`,
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
