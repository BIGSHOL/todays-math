/**
 * 세부 문항 마커 실태 조사 (읽기 전용).
 *
 * 원장님 지적(2026-08-18): "이런경우는 세부 문항이 줄바꿈 처리되어야할텐데?"
 * `… 다음 물음에 답하여라. [총 6점] (1) 어떤 수를 구하시오. (2) 바르게 …` 처럼
 * 하위 문항이 한 문단으로 흘러 어디서 갈리는지 안 보인다.
 *
 * 규칙을 정하기 전에 **어떤 모양이 얼마나 있는지** 먼저 센다. 마커 후보는
 * 평범한 글에도 나오므로(괄호 숫자·연도 등) 표본을 눈으로 봐야 한다.
 *
 *   npx tsx scripts/qa/measure-subquestions.ts
 *   npx tsx scripts/qa/measure-subquestions.ts --samples
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 후보 마커 — 실제로 쓰이는 것만 남기려고 넓게 잡아 세고 표본으로 거른다. */
const PATTERNS: Array<[string, RegExp]> = [
  ["⑴⑵ 괄호원문자", /[⑴-⑽]/g],
  ["(1) 반각괄호", /\((\d{1,2})\)/g],
  ["（1） 전각괄호", /（\d{1,2}）/g],
  ["1) 닫는괄호만", /(?:^|[\s.])\d{1,2}\)/g],
  ["가) 한글", /(?:^|[\s.])[가-하]\)/g],
];

/** 마커가 **둘 이상** 있어야 하위 문항으로 본다 — 하나면 그냥 괄호일 수 있다. */
const MIN_MARKERS = 2;

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();
  console.log(`문항 ${total.toLocaleString()}건 — 전수\n`);

  const hit = new Map<string, number>();
  const samples = new Map<string, Array<{ id: string; text: string }>>();
  let anyRows = 0;

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
      const text = row.content ?? "";
      let rowHit = false;
      for (const [name, pattern] of PATTERNS) {
        const n = text.match(pattern)?.length ?? 0;
        if (n >= MIN_MARKERS) {
          hit.set(name, (hit.get(name) ?? 0) + 1);
          rowHit = true;
          if (!samples.has(name)) samples.set(name, []);
          const bucket = samples.get(name)!;
          if (bucket.length < 8) bucket.push({ id: row.id, text });
        }
      }
      if (rowHit) anyRows += 1;
    }
  }

  console.log(
    `마커가 ${MIN_MARKERS}개 이상인 문항: ${anyRows}건 (${((anyRows * 100) / total).toFixed(2)}%)\n`,
  );
  console.log("모양별 (한 문항이 여러 모양에 걸릴 수 있다)");
  for (const [name, count] of [...hit].sort((a, b) => b[1] - a[1])) {
    console.log(
      `  ${name.padEnd(16)} ${String(count).padStart(6)}  ${((count * 100) / total).toFixed(2)}%`,
    );
  }

  if (wantSamples) {
    console.log("\n\n표본 — 규칙은 눈으로 봐야 틀린 게 보인다");
    for (const [name, bucket] of samples) {
      console.log(`\n### ${name}`);
      for (const s of bucket) {
        console.log(
          `  · ${s.id.slice(0, 8)} ${s.text.slice(0, 230).replace(/\n/g, " ⏎ ")}`,
        );
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
