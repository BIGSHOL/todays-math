/**
 * 이미 적재된 문항의 **잘못된 단원 배정을 정정**한다.
 *
 * 배경(2026-08-15): `convertPastExam` 이 학년 힌트로 `meta.subject`("수학","수상")를
 * 먼저 봤다. 그건 시험지 원본 표기라 우리 트리 라벨이 아니어서 3,788문항의 학년이
 * 해석되지 않았고, 그 문항들은 **초1~고3 전체 풀**에서 단원을 골랐다. 그래서 중3
 * 문항이 공통수학1 단원에, 중2 문항이 초4 단원에 실렸다(실측 270건).
 *
 * `meta.grade` 를 먼저 보도록 고쳤으므로, 이미 들어간 행도 같이 고쳐야 한다.
 * 적재(`load-classified`)는 insert 전용이라 이 스크립트가 필요하다.
 *
 *   npx tsx scripts/qa/fix-unit-assignments.ts                    드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/fix-unit-assignments.ts --apply
 *   npx tsx scripts/qa/fix-unit-assignments.ts <리포트 경로>       B단계 등 다른 배치
 *
 * 단원을 잃은 문항(올바른 학년 안에 붙을 소단원이 없는 것)은 지우지 않고
 * `reviewStatus=pending` 으로 내려 출제 풀에서만 뺀다 — D-22 대로 pending 은
 * 출제에 안 잡히고, 나중에 재분류하면 되돌릴 수 있다.
 */
import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const DEFAULT_REPORT = "scripts/qa/reports/final-batch-report.json";

/**
 * 어느 배치의 리포트를 볼지. B단계(N드라이브 신규 추출)는 자기 리포트를
 * 따로 쓰므로 경로를 받는다. 리포트에 있는 `externalId` 만 건드리므로
 * 부분 리포트로 돌려도 다른 배치를 망가뜨리지 않는다.
 */
function reportPath(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  return arg ?? process.env.FINAL_BATCH_REPORT ?? DEFAULT_REPORT;
}
const CHUNK = 500;

interface ReportItem {
  externalId: string;
  status: string;
  unitId: string | null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const report = reportPath();
  const items: ReportItem[] = JSON.parse(await readFile(report, "utf-8")).report
    .items;
  console.log(`리포트: ${report}`);

  const wanted = new Map<string, string>();
  const dropped = new Set<string>();
  for (const item of items) {
    if (item.status === "ok" && item.unitId)
      wanted.set(item.externalId, item.unitId);
    else dropped.add(item.externalId);
  }

  const prisma = new PrismaClient();
  try {
    const ids = [...wanted.keys(), ...dropped];
    const current = new Map<
      string,
      { id: string; unitId: string; reviewStatus: string }
    >();
    for (let i = 0; i < ids.length; i += CHUNK * 4) {
      const rows = await prisma.problem.findMany({
        where: { externalId: { in: ids.slice(i, i + CHUNK * 4) } },
        select: {
          id: true,
          externalId: true,
          unitId: true,
          reviewStatus: true,
        },
      });
      for (const row of rows) {
        if (row.externalId) current.set(row.externalId, row);
      }
    }

    const moves: Array<{ id: string; unitId: string }> = [];
    for (const [externalId, unitId] of wanted) {
      const row = current.get(externalId);
      if (row && row.unitId !== unitId) moves.push({ id: row.id, unitId });
    }
    const demote: string[] = [];
    for (const externalId of dropped) {
      const row = current.get(externalId);
      if (row && row.reviewStatus === "approved") demote.push(row.id);
    }
    // 분류가 좋아져 다시 붙은 문항의 보류를 푼다. 안 풀면 출제에
    // 영원히 안 잡힌다 — 보류는 되돌릴 수 있어야 의미가 있다.
    const restore: string[] = [];
    for (const externalId of wanted.keys()) {
      const row = current.get(externalId);
      if (row && row.reviewStatus === "pending") restore.push(row.id);
    }

    console.log("── 단원 배정 정정 ──");
    console.log(
      `대조 ${current.size}행 · 단원 이동 ${moves.length}` +
        ` · 출제 보류 ${demote.length} · 보류 해제 ${restore.length}`,
    );

    if (!apply) {
      console.log("\n드라이런 — 변경 없음. 적용하려면 --apply");
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

    let moved = 0;
    for (const move of moves) {
      await prisma.problem.update({
        where: { id: move.id },
        data: { unitId: move.unitId },
      });
      moved += 1;
    }
    let held = 0;
    for (let i = 0; i < demote.length; i += CHUNK) {
      const result = await prisma.problem.updateMany({
        where: { id: { in: demote.slice(i, i + CHUNK) } },
        data: { reviewStatus: "pending" },
      });
      held += result.count;
    }
    let freed = 0;
    for (let i = 0; i < restore.length; i += CHUNK) {
      const result = await prisma.problem.updateMany({
        where: { id: { in: restore.slice(i, i + CHUNK) } },
        data: { reviewStatus: "approved" },
      });
      freed += result.count;
    }
    console.log(
      `
정정 완료 — 단원 이동 ${moved} · 출제 보류 ${held}` + ` · 보류 해제 ${freed}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
