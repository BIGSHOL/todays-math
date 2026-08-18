/**
 * 계산 과정 다단 등식 실태 조사 (읽기 전용).
 *
 * 원장님(2026-08-18): "이런 문제는 좀 심각하네. 다음 계산 과정이 너무 줄바꿈 하나도
 * 처리 안되어있음" — `= … = … = …` 로 이어지는 계산이 한 줄로 흐른다.
 *
 * 규칙을 정하기 전에 **어떤 모양으로 실려 있는지** 먼저 센다. 이 말뭉치는 PDF
 * 텍스트 레이어 추출본이라 등식이 한 수식 안에 있을 수도, 여러 수식으로 쪼개져
 * 있을 수도 있다. **수식 span 을 가르는 자리와 안 되는 자리가 갈린다.**
 *
 *   npx tsx scripts/qa/measure-equation-chains.ts
 *   npx tsx scripts/qa/measure-equation-chains.ts --samples
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

const MATH_ATOM = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g;

/**
 * 최상위(중괄호·`\left…\right` 밖)의 `=` 와 `,` 자리.
 *
 * ⚠️ **쉼표를 같이 세는 것이 이 조사의 핵심이다.** 처음엔 「한 수식에 `=` 가 2개
 * 이상이면 계산 과정」으로 셌더니 5.78% 가 나왔는데, 표본을 눈으로 보니 거의 전부
 * 오탐이었다 — `$y=ax\,,~y=bx$` · `$A=2x^{2}+xy,B=x^{2}-xy$` · `$ax+y=-2,10x-2y=-3$`
 * 은 **여러 개의 식을 나열**한 것이지 한 식을 이어 계산한 것이 아니다.
 * 여기서 줄을 바꾸면 연립방정식이 계산 과정처럼 보인다 — 문제가 바뀐다.
 *
 * 계산 과정은 `A = B = C` 처럼 **쉼표 없이** `=` 가 잇따른다. 그것만 센다.
 */
export function topLevelMarks(inner: string): {
  equals: number[];
  commas: number[];
} {
  const equals: number[] = [];
  const commas: number[] = [];
  let depth = 0;
  let leftDepth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (ch === "\\") {
      if (inner.startsWith("\\left", i)) leftDepth += 1;
      else if (inner.startsWith("\\right", i)) leftDepth -= 1;
      i += 1; // 이스케이프된 다음 글자는 건너뛴다(`\,` `\;` 포함)
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (depth !== 0 || leftDepth !== 0) continue;
    else if (ch === ",") commas.push(i);
    else if (ch === "=") {
      // `\ne`·`\le`·`<=` 같은 합성 기호의 일부가 아닌지 본다.
      const prev = inner[i - 1];
      const next = inner[i + 1];
      if (prev === "<" || prev === ">" || prev === "!" || prev === ":")
        continue;
      if (next === "=") continue;
      equals.push(i);
    }
  }
  return { equals, commas };
}

/** 쉼표로 갈리지 않고 잇따르는 `=` 쌍의 개수. 0이면 계산 과정이 아니다. */
export function chainedEqualsCount(inner: string): number {
  const { equals, commas } = topLevelMarks(inner);
  let n = 0;
  for (let i = 1; i < equals.length; i += 1) {
    const a = equals[i - 1]!;
    const b = equals[i]!;
    if (!commas.some((c) => c > a && c < b)) n += 1;
  }
  return n;
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();

  let chainInOneSpan = 0; // 한 수식 안에 `=` 가 2개 이상
  let chainAcrossSpans = 0; // 수식이 `$=$` 로 쪼개져 있다
  let anyChain = 0;
  const envBlocked = new Set<string>();
  const samples: Array<{ id: string; kind: string; text: string }> = [];

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
      const { question } = parseProblemContent(row.content ?? "");
      const atoms = [...question.matchAll(MATH_ATOM)];
      let inOne = false;
      let across = 0;
      for (const m of atoms) {
        const inner = m[0].replace(/^\$\$?/, "").replace(/\$\$?$/, "");
        // 여러 줄 환경은 이미 제 줄을 가진다 — 건드리면 안 된다.
        if (/\\begin\{/.test(inner)) {
          envBlocked.add(row.id);
          continue;
        }
        if (chainedEqualsCount(inner) >= 1) inOne = true;
        if (inner.replace(/[\s~]/g, "") === "=") across += 1;
      }
      if (inOne) chainInOneSpan += 1;
      if (across >= 2) chainAcrossSpans += 1;
      if (inOne || across >= 2) {
        anyChain += 1;
        if (samples.length < 16)
          samples.push({
            id: row.id,
            kind: inOne ? (across >= 2 ? "둘 다" : "한 수식 안") : "수식 사이",
            text: question,
          });
      }
    }
  }

  console.log(`문항 ${total.toLocaleString()}건 — 전수\n`);
  console.log(
    `한 수식 안에 «쉼표 없이 잇따르는 =» 가 있는 문항: ${chainInOneSpan}건 (${((chainInOneSpan * 100) / total).toFixed(2)}%)`,
  );
  console.log(
    `= 하나만 든 수식이 2개 이상(쪼개져 실림): ${chainAcrossSpans}건 (${((chainAcrossSpans * 100) / total).toFixed(2)}%)`,
  );
  console.log(
    `둘 중 하나라도 해당: ${anyChain}건 (${((anyChain * 100) / total).toFixed(2)}%)`,
  );
  console.log(
    `\n여러 줄 환경(\\begin{...})이 있어 건드리면 안 되는 문항: ${envBlocked.size}건`,
  );

  if (wantSamples) {
    console.log("\n\n표본 — 규칙은 눈으로 봐야 틀린 게 보인다");
    for (const s of samples)
      console.log(
        `\n· ${s.id.slice(0, 8)} [${s.kind}]\n    ${s.text.slice(0, 300).replace(/\n/g, " ⏎ ")}`,
      );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
