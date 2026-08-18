/**
 * 적대적 리뷰 — 상자 경계가 바뀐 405문항에서 **항목을 잃은 상자**가 있는가. 읽기 전용.
 *
 * 보고서는 「끝 경계 의심 121 → 84」만 셌다. 경계를 **당긴** 수리라 반대편 위험은
 * 「멀쩡한 항목이 상자 밖으로 밀려났다」인데 그건 세지 않았다.
 *
 * 실행: npx tsx qa/adversarial/scripts/scan-box-item-counts.ts [--samples]
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent as parseNew } from "../../../src/lib/problem/parseProblemContent";
import { parseProblemContent as parseOld } from "../baseline/problem/parseProblemContent";

const prisma = new PrismaClient();

function boxItemCount(question: string): number {
  let count = 0;
  let inBox = false;
  let blankRun = false;
  for (const rawLine of question.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (!line.startsWith(">")) {
      inBox = false;
      continue;
    }
    const body = line.replace(/^>\s?/, "").trim();
    if (body.length === 0) {
      blankRun = true;
      continue;
    }
    if (!inBox) {
      inBox = true; // 첫 줄은 라벨
      blankRun = false;
      continue;
    }
    if (blankRun) count += 1;
    blankRun = false;
  }
  return count;
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();
  let lost = 0;
  let gained = 0;
  let lostItems = 0;
  const samples: string[] = [];

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const content = row.content ?? "";
      const a = boxItemCount(parseOld(content).question);
      const b = boxItemCount(parseNew(content).question);
      if (a === b) continue;
      if (b < a) {
        lost += 1;
        lostItems += a - b;
        if (samples.length < 25)
          samples.push(
            `--- ${row.id} (항목 ${a} → ${b})\n    ${parseNew(content).question.slice(0, 400)}`,
          );
      } else gained += 1;
    }
  }

  console.log(`전수 ${total}문항`);
  console.log(`상자 항목이 줄어든 문항 ${lost}건 (잃은 항목 ${lostItems}개)`);
  console.log(`상자 항목이 늘어난 문항 ${gained}건`);
  if (wantSamples) for (const s of samples) console.log("\n" + s);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
