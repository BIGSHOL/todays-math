/**
 * 적대적 리뷰 — 상자 **항목 경계**가 수식을 가르지 않는가. 읽기 전용.
 *
 * `boxBlock` 은 항목 시작 자리를 원문 인덱스로 잡아 잘라 낸다. 그 자리가 `$…$`
 * 한가운데면 조각의 `$` 짝이 깨져 **지면에 날 달러가 나가거나** 수식이 통째로
 * 평문이 된다. 판정기 자신은 이걸 세지 않는다(자기 스캐너로 셌다고 적었을 뿐이다).
 *
 * 옛 코드와 나란히 재서 이번 수리가 이 부류를 늘렸는지 본다.
 *
 * 실행: npx tsx qa/adversarial/scripts/scan-box-item-splits.ts [--samples]
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent as parseNew } from "../../../src/lib/problem/parseProblemContent";
import { parseProblemContent as parseOld } from "../baseline/problem/parseProblemContent";

const prisma = new PrismaClient();

function boxParagraphs(question: string): string[][] {
  const boxes: string[][] = [];
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    boxes.push(
      cur
        .join("\n")
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    cur = null;
  };
  for (const rawLine of question.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (line.startsWith(">")) {
      if (cur === null) cur = [];
      cur.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flush();
  }
  flush();
  return boxes;
}

/** `$` 개수가 홀수인 조각 — 수식 span 이 갈렸다는 뜻이다. */
function oddDollars(text: string): boolean {
  return (text.match(/\$/g)?.length ?? 0) % 2 === 1;
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();
  let oldBad = 0;
  let newBad = 0;
  let newOnly = 0;
  const samples: string[] = [];

  const count = (question: string) => {
    let bad = 0;
    for (const paras of boxParagraphs(question))
      for (const para of paras) if (oddDollars(para)) bad += 1;
    return bad;
  };

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
      const a = count(parseOld(content).question);
      const b = count(parseNew(content).question);
      if (a > 0) oldBad += 1;
      if (b > 0) newBad += 1;
      if (b > a) {
        newOnly += 1;
        if (samples.length < 25) {
          const paras = boxParagraphs(parseNew(content).question)
            .flat()
            .filter(oddDollars);
          samples.push(
            `--- ${row.id} (옛 ${a} → 지금 ${b})\n    ${paras.join("\n    ")}`,
          );
        }
      }
    }
  }

  console.log(`전수 ${total}문항`);
  console.log(
    `상자 조각의 \`$\` 짝이 깨진 문항   옛 ${oldBad} → 지금 ${newBad}`,
  );
  console.log(`  이번 수리로 새로 깨진 문항 ${newOnly}건`);
  if (wantSamples) for (const s of samples) console.log("\n" + s);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
