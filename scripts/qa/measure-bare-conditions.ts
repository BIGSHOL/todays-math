/**
 * 마커 없는 «다음 조건» 상자 실태 조사 (읽기 전용).
 *
 * 원장님(2026-08-18): "문제에 '다음 조건'이라는 말이 있는데 조건만 따로 모아서
 * 네모 박스 안에 넣어두면 훨씬 깔끔"
 *
 * 지금 `boxBlock` 은 `<조건>` 같은 **마커가 있어야** 상자를 그린다. 마커 없이
 * 발문이 「다음 조건을 …」이라고만 하고 `●`·`∘` 로 항목을 나열하는 문항이 있다.
 * 얼마나 있는지, 어떤 불릿을 쓰는지 먼저 센다.
 *
 * 실측(2026-08-18): 문구가 있는 문항 1,936건(4.11%) · 이미 상자 513건 ·
 * **마커 없이 불릿만 있는 것 61건(0.13%)**. 쓰인 불릿은 `∘` 31 · `◦` 12 ·
 * `⚪` 4 · `○` 3 · `•` 2 순. `□`(5건)·`⋅`(1건)은 **불릿이 아니다** —
 * `□ABCD` 도형 표기와 `\cdot` 이 그렇게 세어진 것이라 목록에 넣지 않았다.
 *
 *   npx tsx scripts/qa/measure-bare-conditions.ts
 *   npx tsx scripts/qa/measure-bare-conditions.ts --samples
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

/** 발문이 「뒤에 조건이 온다」고 말하는 문구. */
const TRIGGER_RE =
  /다음\s*(?:<\s*)?조건|아래\s*조건|조건을\s*(?:모두\s*)?만족|다음을\s*(?:모두\s*)?만족|다음\s*을\s*만족/;

/** 불릿 후보를 넓게 잡는다 — 어떤 글자가 실제로 쓰이는지 보려는 것이다. */
const BULLET_CANDIDATES = [..."●○◎◉⦿•∘◦⚫⚪◯∙⋅⁃‣▪▫■□◆◇★☆※ㅇ⋆"];

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();

  let triggered = 0;
  let alreadyBoxed = 0;
  let bareCandidate = 0;
  const bulletUse = new Map<string, number>();
  const samples: Array<{ id: string; bullet: string; text: string }> = [];

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
      if (!TRIGGER_RE.test(question)) continue;
      triggered += 1;

      /*
       * ⚠️ 이미 상자인지 볼 때 `splitBoxSegments(question)` 을 다시 돌리면 안 된다.
       * `question` 은 **이미 처리된 마크다운**이라 라벨이 `<상자1>`(열 수가 붙은 형태)
       * 이고, 그건 정규형 `<상자>` 가 아니어서 판정이 늘 「상자 아님」이 된다.
       * 실제로 그렇게 셌더니 이미 상자인 문항이 «마커 없음»으로 잡혔다.
       * 인용문 줄이 있는지를 본다 — 그게 상자가 그려졌다는 증거다.
       */
      if (question.split(/\r?\n/).some((l) => l.trimStart().startsWith(">"))) {
        alreadyBoxed += 1;
        continue;
      }

      // 같은 불릿이 2회 이상 나오는가.
      let best = "";
      let bestCount = 0;
      for (const bullet of BULLET_CANDIDATES) {
        const n = question.split(bullet).length - 1;
        if (n >= 2 && n > bestCount) {
          best = bullet;
          bestCount = n;
        }
      }
      if (bestCount < 2) continue;
      bareCandidate += 1;
      bulletUse.set(best, (bulletUse.get(best) ?? 0) + 1);
      if (samples.length < 14)
        samples.push({ id: row.id, bullet: best, text: question });
    }
  }

  console.log(`문항 ${total.toLocaleString()}건 — 전수\n`);
  console.log(
    `발문이 「다음 조건」류를 말하는 문항: ${triggered}건 (${((triggered * 100) / total).toFixed(2)}%)`,
  );
  console.log(`  그중 이미 상자로 그려짐: ${alreadyBoxed}건`);
  console.log(
    `  그중 마커 없이 불릿만 있는 문항: ${bareCandidate}건 (${((bareCandidate * 100) / total).toFixed(2)}%)\n`,
  );
  console.log("쓰인 불릿");
  for (const [b, n] of [...bulletUse].sort((a, b2) => b2[1] - a[1]))
    console.log(
      `  ${b}  U+${b.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}  ${n}건`,
    );

  if (wantSamples) {
    console.log("\n\n표본 — 규칙은 눈으로 봐야 틀린 게 보인다");
    for (const s of samples)
      console.log(
        `\n· ${s.id.slice(0, 8)} [${s.bullet}]\n    ${s.text.slice(0, 300).replace(/\n/g, " ⏎ ")}`,
      );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
