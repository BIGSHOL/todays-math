/**
 * HWP 비줄바꿈 공백(`~`) 잔재 실태 조사 (읽기 전용).
 *
 * 원장님(2026-08-18): "네모 표현은 좋았는데 네모 뒤에 공백이 너무 많아보여."
 *
 * HWP 수식 스크립트에서 `~` 는 **한 칸 공백**이다. 변환기가 그걸 LaTeX 로 옮길 때
 * 그대로 두면 LaTeX 의 `~`(비줄바꿈 공백)가 되어 **개수만큼 공백이 쌓인다**.
 * `{BOX{~~ 1. ~~}}` 같은 상자 구문에서 특히 여러 개가 붙는다.
 *
 * 어디에 몇 개가 붙어 있는지 먼저 센다 — 지우기 전에 «지워도 되는 자리»를 알아야 한다.
 *
 *   npx tsx scripts/qa/measure-tilde-space.ts
 *   npx tsx scripts/qa/measure-tilde-space.ts --samples
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MATH_ATOM = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g;
/** 잇따르는 `~` 뭉치. */
const TILDE_RUN = /~+/g;

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();

  let withTilde = 0;
  let runsTotal = 0;
  const byLength = new Map<number, number>();
  /** `~` 뭉치 **앞** 글자별 분포 — 어디에 붙는지 본다. */
  const beforeChar = new Map<string, number>();
  let afterSquare = 0;
  let problemsAfterSquare = 0;
  const samples: string[] = [];

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
      const text = row.content ?? "";
      if (!text.includes("~")) continue;
      withTilde += 1;
      let squareHere = false;

      for (const atom of text.matchAll(MATH_ATOM)) {
        const inner = atom[0];
        for (const run of inner.matchAll(TILDE_RUN)) {
          runsTotal += 1;
          byLength.set(run[0].length, (byLength.get(run[0].length) ?? 0) + 1);
          const prev =
            inner.slice(0, run.index).trimEnd().slice(-1) || "(머리)";
          beforeChar.set(prev, (beforeChar.get(prev) ?? 0) + 1);
          if (
            /□|\\square/.test(
              inner.slice(Math.max(0, run.index - 12), run.index),
            )
          ) {
            afterSquare += 1;
            squareHere = true;
            if (samples.length < 20)
              samples.push(
                `${row.id.slice(0, 8)} ${inner.slice(Math.max(0, run.index - 40), run.index + 20)}`,
              );
          }
        }
      }
      if (squareHere) problemsAfterSquare += 1;
    }
  }

  console.log(`문항 ${total.toLocaleString()}건 — 전수\n`);
  console.log(
    `\`~\` 를 가진 문항: ${withTilde}건 (${((withTilde * 100) / total).toFixed(2)}%) · 수식 안 뭉치 ${runsTotal}개`,
  );
  console.log(
    `그중 **네모(□) 바로 뒤**: ${afterSquare}개 뭉치 / ${problemsAfterSquare}문항\n`,
  );

  console.log("뭉치 길이별");
  for (const [len, n] of [...byLength].sort((a, b) => a[0] - b[0]))
    console.log(
      `  ~${"~".repeat(len - 1).padEnd(7)} ${String(n).padStart(6)}개`,
    );

  console.log("\n뭉치 **앞** 글자 상위 15");
  for (const [ch, n] of [...beforeChar]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15))
    console.log(
      `  ${JSON.stringify(ch).padEnd(10)} ${String(n).padStart(6)}개`,
    );

  if (wantSamples) {
    console.log("\n\n네모 뒤 표본");
    for (const s of samples) console.log(`  · ${s}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
