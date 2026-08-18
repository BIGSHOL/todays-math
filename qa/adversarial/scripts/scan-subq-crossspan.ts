/**
 * 적대적 리뷰 — `charBefore` 가 **수식 경계에서 멈춘다**는 완화가 함수값을
 * 하위 문항으로 읽지 않는가. 읽기 전용.
 *
 * `subQuestion.ts` 는 `$15$ $8$ $(1)$ …` 을 살리려고 「앞 글자가 `$` 면 빈 문자열」로
 * 봤다. 그런데 이 말뭉치는 함수값도 **수식 밖으로 쪼개져** 있다 —
 * `$f$ $(1)$` · `$3g$ ′ $(1)$`. 프라임이 없으면 이 완화가 그대로 통과시킨다.
 *
 * 여기서는 **판정이 잡은 마커마다** 바로 앞 수식 span 의 마지막 글자를 본다.
 * 그 글자가 영문자면 함수값일 개연성이 크다 — 그런 마커로 줄이 갈린 문항을 센다.
 *
 * 실행: npx tsx qa/adversarial/scripts/scan-subq-crossspan.ts [--samples]
 */
import { PrismaClient } from "@prisma/client";

import { normalizeOcrText } from "../../../src/lib/problem/parseProblemContent";
import { findSubQuestionMarkers } from "../../../src/lib/math/subQuestion";

const prisma = new PrismaClient();

/** 마커 앞이 «닫는 `$` 로 끝나는 수식» 인가. 그렇다면 그 수식의 마지막 글자를 준다. */
function charBeforeAcrossSpan(text: string, index: number): string | null {
  let i = index - 1;
  while (i >= 0 && /[ \t~]/.test(text[i]!)) i -= 1;
  if (i < 0 || text[i] !== "$") return null;
  // 그 `$` 는 앞 수식의 **닫는** 달러다. 그 앞 글자를 본다.
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j]!)) j -= 1;
  return j >= 0 ? text[j]! : null;
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();
  let problems = 0;
  let suspicious = 0;
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
      const text = normalizeOcrText(row.content ?? "");
      const markers = findSubQuestionMarkers(text);
      if (markers.length === 0) continue;
      problems += 1;
      const bad = markers.filter((m) => {
        const ch = charBeforeAcrossSpan(text, m.index);
        return ch !== null && /[A-Za-z]/.test(ch);
      });
      if (bad.length === 0) continue;
      suspicious += 1;
      if (samples.length < 40)
        samples.push(
          `--- ${row.id}  (의심 마커 ${bad.length}/${markers.length})` +
            bad
              .map(
                (m) =>
                  "\n    " +
                  text.slice(
                    Math.max(0, m.index - 45),
                    m.index + m.length + 25,
                  ),
              )
              .join(""),
        );
    }
  }

  console.log(`전수 ${total}문항`);
  console.log(`하위 문항으로 판정된 문항 ${problems}건`);
  console.log(
    `  그중 마커 앞 수식이 **영문자**로 끝나는 것이 있는 문항 ${suspicious}건`,
  );
  if (wantSamples) for (const s of samples) console.log("\n" + s);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
