/**
 * 하위 문항 판정 규칙 전수 검증 (읽기 전용).
 *
 * `measure-subquestions.ts` 는 **후보가 몇 개인지**만 셌다. 이 도구는 실제 규칙
 * (`findSubQuestionMarkers`)이 **무엇을 잡고 무엇을 놓치는지**를 센다.
 *
 * ⚠️ 「걸린 것」만 보면 규칙은 언제나 옳아 보인다. 그래서 **놓친 것**(후보는 있는데
 * 규칙이 버린 문항)을 같은 무게로 뽑는다 — CLAUDE.md 2026-08-16 «판정별로 골고루,
 * 특히 「문제 없음」쪽을 가장 의심스러운 순서로 정렬해 훑을 것».
 *
 *   npx tsx scripts/qa/audit-subquestion-rule.ts
 *   npx tsx scripts/qa/audit-subquestion-rule.ts --samples
 */
import { PrismaClient } from "@prisma/client";

import { findSubQuestionMarkers } from "../../src/lib/math/subQuestion";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

/** 후보 모양 — 규칙이 보는 것보다 **넓게** 잡아야 「놓친 것」이 드러난다. */
const LOOSE_CANDIDATE = /\(\s*\d{1,2}\s*\)|[⑴-⒇]/g;

function excerpt(text: string, at: number): string {
  return text.slice(Math.max(0, at - 60), at + 90).replace(/\n/g, " ⏎ ");
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();

  let hitProblems = 0;
  let markerTotal = 0;
  const byCount = new Map<number, number>();
  const hits: Array<{ id: string; text: string; at: number[] }> = [];
  const misses: Array<{ id: string; text: string; loose: number }> = [];
  let looseProblems = 0;

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (!rows.length) break;

    for (const row of rows) {
      // 판정은 **보기를 뗀 지문**에서 돈다 — 실제 렌더 경로와 같은 입력이어야 한다.
      const { question } = parseProblemContent(row.content ?? "");
      const markers = findSubQuestionMarkers(question);
      const loose = question.match(LOOSE_CANDIDATE)?.length ?? 0;
      if (loose >= 2) looseProblems += 1;

      if (markers.length >= 2) {
        hitProblems += 1;
        markerTotal += markers.length;
        byCount.set(markers.length, (byCount.get(markers.length) ?? 0) + 1);
        if (hits.length < 14)
          hits.push({
            id: row.id,
            text: question,
            at: markers.map((m) => m.index),
          });
      } else if (loose >= 2 && misses.length < 14) {
        // 후보는 2개 이상인데 규칙이 버린 문항 — 여기서 진짜 하위 문항을 놓쳤는지 본다.
        misses.push({ id: row.id, text: question, loose });
      }
    }
  }

  console.log(`문항 ${total.toLocaleString()}건 — 전수\n`);
  console.log(
    `규칙이 하위 문항으로 판정: ${hitProblems}건 (${((hitProblems * 100) / total).toFixed(2)}%) · 마커 ${markerTotal}개`,
  );
  console.log(
    `느슨한 후보가 2개 이상인 문항: ${looseProblems}건 (${((looseProblems * 100) / total).toFixed(2)}%)`,
  );
  console.log(
    `→ 규칙이 버린 문항: ${looseProblems - hitProblems}건 (이 중 진짜가 있는지가 관건)\n`,
  );
  console.log("하위 문항 개수 분포");
  for (const [n, c] of [...byCount].sort((a, b) => a[0] - b[0]))
    console.log(`  ${String(n).padStart(3)}개  ${String(c).padStart(5)}건`);

  if (wantSamples) {
    console.log("\n\n### 걸린 것 — 전부 진짜 하위 문항인가");
    for (const h of hits)
      console.log(`  · ${h.id.slice(0, 8)} ${excerpt(h.text, h.at[0]!)}`);
    console.log("\n\n### 버린 것 — 진짜를 놓치지 않았는가 (후보 2개 이상)");
    for (const m of misses)
      console.log(
        `  · ${m.id.slice(0, 8)} [후보${m.loose}] ${m.text.slice(0, 190).replace(/\n/g, " ⏎ ")}`,
      );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
