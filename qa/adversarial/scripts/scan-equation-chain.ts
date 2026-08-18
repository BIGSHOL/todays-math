/**
 * 적대적 리뷰 — 계산 과정 줄바꿈이 **수식을 깨뜨리는가**. 읽기 전용.
 *
 * `equationChain.ts` 는 「조각마다 `$` 짝이 맞고 중괄호가 균형을 이룬다」고 적었다.
 * 균형은 **자기 스캐너가 센 것**이라 동어반복이다 — 실제 판정자는 KaTeX 다.
 * 그래서 원본 span 과 조각을 **KaTeX 로 직접 파싱**해 본다:
 *   · 원본은 통과하는데 조각이 실패하면 **자르기가 깨뜨린 것**이다.
 *   · 원본도 실패하면 «이미 깨진 수식» 인데 — `HWP_RESIDUE_RE` 가 그걸 막겠다고
 *     했으므로, 그래도 잘렸다면 그 가드가 샌 것이다.
 *
 * 실행: npx tsx qa/adversarial/scripts/scan-equation-chain.ts [--samples]
 */
import katex from "katex";
import { PrismaClient } from "@prisma/client";

import {
  isWorkedProcess,
  splitEquationChain,
} from "../../../src/lib/math/equationChain";
import { UI_KATEX_OPTIONS } from "../../../src/lib/math/katexRender";
import { normalizeOcrText } from "../../../src/lib/problem/parseProblemContent";
import { preprocessMathText } from "../../../src/lib/math/textPreprocess";

const prisma = new PrismaClient();

const INLINE_MATH_SPAN = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g;

/** 지면과 같은 경로로 렌더한다 — 전처리 + 같은 옵션. 실패하면 메시지를 돌려준다. */
function parseFail(span: string): string | null {
  const processed = preprocessMathText(span);
  const inner = processed.replace(/^\$+/, "").replace(/\$+$/, "");
  try {
    katex.renderToString(inner, {
      ...UI_KATEX_OPTIONS,
      throwOnError: true,
      output: "html",
      displayMode: false,
    });
    return null;
  } catch (error) {
    return (error as Error).message.slice(0, 140);
  }
}

interface Case {
  id: string;
  span: string;
  parts: string[];
  before: string | null;
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();

  let problems = 0;
  let spans = 0;
  const brokenByCut: Case[] = [];
  const brokenBefore: Case[] = [];
  const cases: Case[] = [];

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
      const text = normalizeOcrText(content);
      if (!text.includes("=")) continue;
      const worked = isWorkedProcess(content);
      let hit = false;
      for (const match of text.matchAll(INLINE_MATH_SPAN)) {
        const span = match[0];
        const parts = splitEquationChain(span, { workedProcess: worked });
        if (parts === null) continue;
        hit = true;
        spans += 1;
        const before = parseFail(span);
        const item: Case = { id: row.id, span, parts, before };
        cases.push(item);
        const after = parts.map(parseFail).filter(Boolean) as string[];
        if (before !== null) brokenBefore.push(item);
        else if (after.length > 0) brokenByCut.push(item);
      }
      if (hit) problems += 1;
    }
  }

  const dump = (title: string, list: Case[]) => {
    console.log("");
    console.log(`===== ${title} (${list.length}) =====`);
    for (const c of list) {
      console.log("");
      console.log(`--- ${c.id}`);
      console.log(`원본  ${c.span}`);
      console.log(`조각  ${c.parts.join("  |  ")}`);
      if (c.before) console.log(`원본오류  ${c.before}`);
    }
  };

  console.log(`전수 ${total}문항`);
  console.log(`계산 과정으로 나뉜 문항 ${problems}건 · 수식 ${spans}개`);
  console.log(
    `  자르기 때문에 KaTeX 가 못 읽게 된 수식 ${brokenByCut.length}개`,
  );
  console.log(`  자르기 전에 이미 깨져 있던 수식 ${brokenBefore.length}개`);
  dump("자르기가 깨뜨린 것", brokenByCut);
  dump("이미 깨져 있었는데 그래도 잘랐다", brokenBefore);
  if (wantSamples) dump("나뉜 수식 전량", cases);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
