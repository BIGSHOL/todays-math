/**
 * 적대적 리뷰 ① — 「44,000건은 한 글자도 안 바뀐다」를 전수로 확인한다. **읽기 전용.**
 *
 * 기준선은 `qa/adversarial/baseline/`(= main 5c0b1400, 본문 조판 수리 직전).
 * 지금 코드와 옛 코드에 같은 `content` 를 넣어 `question`·`choices` 를 맞대고,
 * 달라진 문항을 **왜 달라졌는지**로 분류한다. 분류에 안 잡히는 변경이
 * 「의도하지 않은 변경」이다.
 *
 * 실행: npx tsx qa/adversarial/scripts/scan-render-drift.ts [--samples] [--kind=<이름>]
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent as parseNew } from "../../../src/lib/problem/parseProblemContent";
import { splitBoxSegments } from "../../../src/lib/math/boxBlock";
import { findSubQuestionMarkers } from "../../../src/lib/math/subQuestion";
import { parseProblemContent as parseOld } from "../baseline/problem/parseProblemContent";

const prisma = new PrismaClient();

/** 무엇이 이 문항을 바꿨나 — 새 규칙 셋 중 어디에 걸렸는가. */
function classify(content: string, oldQ: string, newQ: string): string {
  const oldBox = /(^|\n)>/.test(oldQ);
  const newBox = /(^|\n)>/.test(newQ);
  if (!oldBox && newBox) return "상자-새로생김";
  if (oldBox && !newBox) return "상자-사라짐";
  if (oldBox && newBox) return "상자-경계바뀜";
  // 상자가 없는 문항인데 달라졌다 — 하위 문항 줄바꿈이거나 계산 과정 줄바꿈이다.
  const subq = findSubQuestionMarkers(content).length > 0;
  const chainish = /\$[^$\n]*=[^$\n]*=[^$\n]*\$/.test(content);
  if (subq && newQ.includes("\n\n")) return "하위문항-줄바꿈";
  if (chainish && newQ.includes("\n\n")) return "계산과정-줄바꿈";
  if (splitBoxSegments(content) !== null && /<(보기|조건|상자)>/.test(newQ))
    return "마커-정규화";
  return "분류불가";
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const only = process.argv
    .find((a) => a.startsWith("--kind="))
    ?.slice("--kind=".length);

  const total = await prisma.problem.count();
  const kinds = new Map<string, number>();
  const samples = new Map<
    string,
    Array<{ id: string; old: string; now: string }>
  >();
  let changedQuestion = 0;
  let changedChoices = 0;
  let scanned = 0;

  const bump = (kind: string, id: string, oldQ: string, newQ: string) => {
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (!samples.has(kind)) samples.set(kind, []);
    const bucket = samples.get(kind)!;
    if (bucket.length < 80) bucket.push({ id, old: oldQ, now: newQ });
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
      scanned += 1;
      const a = parseOld(content);
      const b = parseNew(content);
      const qDiff = a.question !== b.question;
      const cDiff =
        a.choices.length !== b.choices.length ||
        a.choices.some((c, i) => c !== b.choices[i]);
      if (qDiff) changedQuestion += 1;
      if (cDiff) changedChoices += 1;
      if (!qDiff && !cDiff) continue;
      const kind =
        cDiff && !qDiff
          ? "보기가바뀜"
          : classify(content, a.question, b.question);
      bump(kind, row.id, a.question, b.question);
    }
  }

  console.log(`전수 ${scanned}건 (DB ${total})`);
  console.log(`  question 이 달라진 문항 ${changedQuestion}건`);
  console.log(`  choices 가 달라진 문항 ${changedChoices}건`);
  console.log("\n분류");
  for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1]))
    console.log(`  ${kind.padEnd(18)} ${count}`);

  if (wantSamples) {
    for (const [kind, bucket] of samples) {
      if (only && kind !== only) continue;
      console.log(`\n===== ${kind} =====`);
      for (const s of bucket) {
        console.log(`--- ${s.id}`);
        console.log(`OLD | ${s.old.slice(0, 400).replace(/\n/g, "\\n")}`);
        console.log(`NEW | ${s.now.slice(0, 400).replace(/\n/g, "\\n")}`);
      }
    }
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
