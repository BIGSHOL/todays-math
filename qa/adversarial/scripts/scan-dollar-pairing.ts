/**
 * 적대적 리뷰 — 하위 문항 마커가 **닫는 `$` 를 여는 `$` 로 읽는가**. 읽기 전용.
 *
 * `subQuestion.ts` 의 `SPAN_ARABIC`·`SPAN_PAREN_DIGIT` 은 「수식 span **통째**가
 * 번호 하나」를 찾는다고 적었다. 그런데 정규식은 `$` 가 여는 것인지 닫는 것인지
 * 모른다. 그래서 `…73.55$ ⑴ $\sqrt{551}$` 에서 **앞 수식의 닫는 `$`** 부터
 * **뒤 수식의 여는 `$`** 까지를 한 span 으로 읽는다.
 *
 * 그러면 마커 인덱스가 `$` 위에 앉는다. 그 자리에서 상자를 끊거나 문단을 나누면
 * **`$` 짝이 통째로 밀려** LaTeX 가 날 글자로 지면에 나간다
 * (CLAUDE.md 2026-08-16 «KaTeX 가 초록이라고 지면이 멀쩡한 게 아니다» 와 같은 부류 —
 *  이 부류는 KaTeX 오류조차 아니다).
 *
 * 판정: 마커 자리가 `$` 이고, 그 앞의 `$` 개수가 **홀수**면 그 `$` 는 닫는 것이다.
 *
 * 실행: npx tsx qa/adversarial/scripts/scan-dollar-pairing.ts [--samples]
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent as parseNew } from "../../../src/lib/problem/parseProblemContent";
import { parseProblemContent as parseOld } from "../baseline/problem/parseProblemContent";
import { normalizeOcrText } from "../../../src/lib/problem/parseProblemContent";
import { findSubQuestionMarkers } from "../../../src/lib/math/subQuestion";

const prisma = new PrismaClient();

/** 문단마다 `$` 짝이 맞는가 — 마크다운 렌더러가 문단 단위로 수식을 짝짓는다. */
function brokenParagraphs(question: string): string[] {
  return question
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^>\s?/gm, "").trim())
    .filter((p) => (p.match(/\$/g)?.length ?? 0) % 2 === 1);
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();

  let markerOnClosing = 0;
  let oldBroken = 0;
  let newBroken = 0;
  let newOnly = 0;
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
      const text = normalizeOcrText(content);
      for (const m of findSubQuestionMarkers(text)) {
        if (text[m.index] !== "$") continue;
        const before = text.slice(0, m.index).match(/\$/g)?.length ?? 0;
        if (before % 2 === 1) {
          markerOnClosing += 1;
          break;
        }
      }
      const a = brokenParagraphs(parseOld(content).question);
      const b = brokenParagraphs(parseNew(content).question);
      if (a.length > 0) oldBroken += 1;
      if (b.length > 0) newBroken += 1;
      if (b.length > a.length) {
        newOnly += 1;
        if (samples.length < 30)
          samples.push(`--- ${row.id}\n    ${b.join("\n    ").slice(0, 500)}`);
      }
    }
  }

  console.log(`전수 ${total}문항`);
  console.log(`마커가 **닫는 \`$\`** 위에 앉은 문항 ${markerOnClosing}건`);
  console.log(
    `문단의 \`$\` 짝이 깨진 문항   옛 ${oldBroken} → 지금 ${newBroken}`,
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
