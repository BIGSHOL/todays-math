/**
 * 같은 본문의 **정답 있는 쌍둥이**에서 정답을 복사한다. **AI 0 · 토큰 0.**
 *
 * 같은 문항이 여러 시험지에 재출제되는데, 어느 편에는 정답면이 인쇄돼
 * 있고 어느 편에는 없다. 정답이 이미 우리 DB 안에 있는데 센티널
 * `(정답 없음)` 로 남아 출제에서 빠지는 건 순손실이다.
 *
 * 본문이 **글자 하나까지 같을 때만** 복사한다. 비슷한 문항은 숫자가 달라
 * 정답이 다르다 — 유사도로 붙이면 틀린 정답이 시험지에 인쇄된다.
 *
 *   npx tsx scripts/qa/backfill-answers-from-twins.ts            드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-answers-from-twins.ts --apply
 */
import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const SENTINEL = "정답 없음";

function key(content: string): string {
  return createHash("sha1")
    .update(content.replace(/\s+/g, " ").trim())
    .digest("hex");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true, answer: true, solution: true },
    });

    const donors = new Map<
      string,
      { answer: string; solution: string | null }
    >();
    for (const row of rows) {
      if (row.answer.includes(SENTINEL)) continue;
      const k = key(row.content);
      const seen = donors.get(k);
      // 같은 본문에 서로 다른 정답이 있으면 어느 쪽이 맞는지 알 수 없다 — 건너뛴다.
      if (seen && seen.answer !== row.answer) {
        donors.set(k, { answer: "", solution: null });
        continue;
      }
      if (!seen) donors.set(k, { answer: row.answer, solution: row.solution });
    }

    const moves: Array<{
      id: string;
      answer: string;
      solution: string | null;
    }> = [];
    let conflict = 0;
    for (const row of rows) {
      if (!row.answer.includes(SENTINEL)) continue;
      const donor = donors.get(key(row.content));
      if (!donor) continue;
      if (!donor.answer) {
        conflict += 1;
        continue;
      }
      moves.push({
        id: row.id,
        answer: donor.answer,
        solution: row.solution ?? donor.solution,
      });
    }

    console.log("── 쌍둥이 정답 복사 (AI 0 · 토큰 0) ──");
    console.log(
      `대상 ${rows.length}행 · 회수 가능 ${moves.length} · 정답 충돌로 건너뜀 ${conflict}`,
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
    let n = 0;
    for (const m of moves) {
      await prisma.problem.update({
        where: { id: m.id },
        data: { answer: m.answer, solution: m.solution },
      });
      n += 1;
    }
    console.log(`\n복사 완료 — ${n}건`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
