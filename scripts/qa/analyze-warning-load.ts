/**
 * **경고가 한 장에 몇 개 뜨는가** — 판정의 정확도가 아니라 «읽히는가»를 잰다 (읽기 전용).
 *
 * 왜 따로 있나: 재현율·정밀도는 «문항 하나»의 성적이다. 원장이 보는 것은 **시험지
 * 한 장**이고, 경고가 매번 뜨면 그 경고는 없는 것과 같다. 그건 수치가 아니라
 * 제품 결함이라 따로 세야 한다(적대적 리뷰 ④).
 *
 *   npx tsx scripts/qa/analyze-warning-load.ts
 *   npx tsx scripts/qa/analyze-warning-load.ts --counts 8,25,30
 *
 * 계산 방식: 문항 풀에서 N개를 **고루** 뽑는다고 보고(출제 엔진은 단원으로 좁히지만
 * 그 편향은 여기서 모른다 — 그래서 이 값은 «대략»이다), 각 자리의 한계로 채점한다.
 *   · 1·2번  첫 장 칸 405px
 *   · 그 뒤  이어지는 장 칸 484px
 *   · N 이 홀수면 마지막 하나는 **혼자** 놓여 997px 을 쓴다
 * 실측 넘침(캐시)과 판정을 같은 자리에서 견줘 «진짜»와 «헛것»을 갈라 센다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import type { TestPrintProblem } from "../../src/components/print/types";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { assessOverflowRisk } from "../../src/lib/printOverflow";

const prisma = new PrismaClient();

interface Height {
  pid: string;
  availPx: number;
  neededPx: number;
}
interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  figureDims: number[] | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 그 자리에 놓았을 때 경고가 나는가 — 자리마다 짝을 맞춰 판정에 넣는다. */
function warnedAt(
  problem: TestPrintProblem,
  slot: "first" | "continuation" | "solo",
): boolean {
  const filler: TestPrintProblem = {
    id: "filler",
    orderIndex: 0,
    content: "",
    answer: "",
    solution: null,
  };
  if (slot === "first")
    return assessOverflowRisk([problem, filler]).some((r) => r.number === 1);
  if (slot === "solo")
    return assessOverflowRisk([filler, filler, problem]).some(
      (r) => r.number === 3,
    );
  return assessOverflowRisk([filler, filler, problem, filler]).some(
    (r) => r.number === 3,
  );
}

async function main() {
  const counts = (arg("--counts") ?? "8,25,30")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const cont = JSON.parse(
    readFileSync(".measure/cont.json", "utf8"),
  ) as Height[];
  const first = JSON.parse(
    readFileSync(".measure/first.json", "utf8"),
  ) as Height[];
  const neededById = new Map(cont.map((h) => [h.pid, h.neededPx]));
  const firstSlot = first[0]!.availPx;
  const contSlot = cont[0]!.availPx;
  const soloSlot = JASEUP_MEASURED_PX.soloContinuationSlot;

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, figure_urls AS "figureUrls", figure_dims AS "figureDims"
       FROM problem ORDER BY id`,
  )) as Row[];

  let firstWarn = 0;
  let firstReal = 0;
  let contWarn = 0;
  let contReal = 0;
  let soloWarn = 0;
  let soloReal = 0;
  let firstBoth = 0;
  let contBoth = 0;
  let soloBoth = 0;
  let n = 0;

  for (const row of rows) {
    const needed = neededById.get(row.id);
    if (needed === undefined) continue;
    n += 1;
    const problem: TestPrintProblem = {
      id: row.id,
      orderIndex: 0,
      content: row.content ?? "",
      answer: "",
      solution: null,
      figureUrls: row.figureUrls,
      figureDims: row.figureDims ?? undefined,
    };
    const wFirst = warnedAt(problem, "first");
    const wCont = warnedAt(problem, "continuation");
    const wSolo = warnedAt(problem, "solo");
    if (wFirst) firstWarn += 1;
    if (wCont) contWarn += 1;
    if (wSolo) soloWarn += 1;
    if (needed > firstSlot) firstReal += 1;
    if (needed > contSlot) contReal += 1;
    if (needed > soloSlot) soloReal += 1;
    if (wFirst && needed > firstSlot) firstBoth += 1;
    if (wCont && needed > contSlot) contBoth += 1;
    if (wSolo && needed > soloSlot) soloBoth += 1;
  }

  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const pFirstWarn = firstWarn / n;
  const pContWarn = contWarn / n;
  const pSoloWarn = soloWarn / n;
  console.log(`문항 ${n.toLocaleString()}건 (실측 높이가 있는 것)\n`);
  console.log(
    `자리별 — 경고가 나는 비율 / 실제로 넘치는 비율 / 맞은 것\n` +
      `  첫 장(${firstSlot}px)      경고 ${pct(pFirstWarn)} · 실측 넘침 ${pct(firstReal / n)} · 맞음 ${pct(firstBoth / n)}\n` +
      `  이어지는 장(${contSlot}px) 경고 ${pct(pContWarn)} · 실측 넘침 ${pct(contReal / n)} · 맞음 ${pct(contBoth / n)}\n` +
      `  혼자(${soloSlot}px)        경고 ${pct(pSoloWarn)} · 실측 넘침 ${pct(soloReal / n)} · 맞음 ${pct(soloBoth / n)}`,
  );

  console.log(`\n시험지 한 장에 뜨는 경고 (문항을 고루 뽑는다고 볼 때)`);
  console.log(
    `  문항수  경고 기대  그중 헛것  실제 넘침  경고가 뜨는 시험지 비율`,
  );
  for (const count of counts) {
    const firstSeats = Math.min(2, count);
    const odd = count % 2 === 1;
    const soloSeats = odd && count > 2 ? 1 : 0;
    const contSeats = count - firstSeats - soloSeats;

    const expectedWarn =
      firstSeats * pFirstWarn + contSeats * pContWarn + soloSeats * pSoloWarn;
    const expectedHit =
      firstSeats * (firstBoth / n) +
      contSeats * (contBoth / n) +
      soloSeats * (soloBoth / n);
    const expectedReal =
      firstSeats * (firstReal / n) +
      contSeats * (contReal / n) +
      soloSeats * (soloReal / n);
    const quiet =
      Math.pow(1 - pFirstWarn, firstSeats) *
      Math.pow(1 - pContWarn, contSeats) *
      Math.pow(1 - pSoloWarn, soloSeats);
    console.log(
      `  ${String(count).padStart(4)}    ${expectedWarn.toFixed(2).padStart(7)}` +
        `   ${(expectedWarn - expectedHit).toFixed(2).padStart(8)}` +
        `   ${expectedReal.toFixed(2).padStart(8)}` +
        `   ${pct(1 - quiet).padStart(10)}`,
    );
  }
  console.log(
    `\n※ 「경고가 뜨는 시험지 비율」이 높은 이유는 판정이 시끄러워서가 아니다 —` +
      `\n   「실제 넘침」 칸을 보라. 헛것을 **한 건도 없이** 만들어도 그 수만큼은 뜬다.` +
      `\n   줄이려면 지면(첫 장 정원·상자 높이)이나 출제(고를 때 거르기)를 손봐야 하고,` +
      `\n   둘 다 인쇄물이 달라지므로 원장님 확정 대상이다(D-07).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
