/**
 * 검증에서 **틀린 것으로 확정된 정답**만 골라 고친다.
 *
 * 백필 로더(`load-answer-backfill.ts`)는 `(정답 없음)` 인 행만 채운다.
 * 이미 답이 들어간 행을 고치려면 이 도구가 필요하다 — 다만 아무거나
 * 덮으면 안 되므로 **현재 값이 `before` 와 일치할 때만** 바꾼다.
 * 그 사이 누가 다른 값으로 고쳤으면 건드리지 않고 보고만 한다.
 *
 * 목록은 `scripts/qa/reports/answer-corrections.json`:
 *   [{ "id", "before", "after", "why" }]
 *
 *   npx tsx scripts/qa/apply-answer-corrections.ts            드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-answer-corrections.ts --apply
 */
import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const LIST = "scripts/qa/reports/answer-corrections.json";

interface Correction {
  id: string;
  before: string;
  after: string;
  why?: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const items: Correction[] = JSON.parse(await readFile(LIST, "utf-8"));
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { id: { in: items.map((i) => i.id) } },
      select: { id: true, answer: true },
    });
    const current = new Map(rows.map((r) => [r.id, r.answer]));

    const ready: Correction[] = [];
    const drifted: Correction[] = [];
    const missing: Correction[] = [];
    for (const item of items) {
      const now = current.get(item.id);
      if (now === undefined) missing.push(item);
      else if (now.trim() !== item.before.trim()) drifted.push(item);
      else ready.push(item);
    }

    console.log("── 정답 교정 ──");
    console.log(
      `목록 ${items.length} · 교정 가능 ${ready.length}` +
        ` · 현재 값이 달라 건너뜀 ${drifted.length} · DB 에 없음 ${missing.length}`,
    );
    for (const item of drifted) {
      console.log(
        `  건너뜀 ${item.id} — 현재 ${JSON.stringify(current.get(item.id))}`,
      );
    }

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
    for (const item of ready) {
      await prisma.problem.update({
        where: { id: item.id },
        data: { answer: item.after },
      });
    }
    console.log(`\n교정 완료 — ${ready.length}건`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
