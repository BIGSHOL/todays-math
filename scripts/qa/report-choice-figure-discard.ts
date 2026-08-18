/**
 * 되찾지 못한 보기 그림 문항을 **폐기했을 때 무엇을 잃는가** (D-20 · 읽기 전용).
 *
 *   npx tsx scripts/qa/report-choice-figure-discard.ts
 *
 * 선행: `scripts/qa/reports/choice-figure-pairs.json` (회수 드라이런 산출물)
 *
 * 겸해서 **마커 잔존 통계를 두 자로 나란히** 낸다. 앞 자(`report-choice-figures.ts`)의
 * `choiceTexts` 는 연속한 마커를 건너뛴다(`\s*` 가 다음 줄 개행을 먹는다). 그래서
 * 같은 134건을 두고도 「일부만 남음」이 부풀어 있었다. 어느 쪽이 맞는지는 표로 보여야
 * 한다 — 조용히 한쪽을 고치면 앞 보고서의 숫자와 어긋난 이유를 아무도 모른다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { classifyChoiceFigureRow } from "./choiceFigureRules";
import { choiceTexts } from "./report-choice-figures";

const prisma = new PrismaClient();
const PAIRS = "scripts/qa/reports/choice-figure-pairs.json";

/** 일일테스트 기본 정원 · 확인테스트 정원 (D-20 판단 기준). */
const DAILY = 8;
const REVIEW = 25;

interface Pair {
  id: string;
  verdict: string;
  why?: string;
}

async function main() {
  const pairs = JSON.parse(readFileSync(PAIRS, "utf8")) as Pair[];
  const verdictOf = new Map(pairs.map((p) => [p.id, p.verdict]));

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT p.id, p.content, p.figure_urls AS "figureUrls", p.unit_id AS "unitId",
            p.pool::text AS pool, p.review_status::text AS "reviewStatus",
            p.direct_use_allowed AS "directUseAllowed",
            p.answer = '(정답 없음)' AS "noAnswer"
       FROM problem p ORDER BY p.id`,
  )) as {
    id: string;
    content: string;
    figureUrls: string[];
    unitId: string | null;
    pool: string;
    reviewStatus: string;
    directUseAllowed: boolean;
    noAnswer: boolean;
  }[];

  const eligible = rows.filter(
    (r) =>
      r.pool === "shared" &&
      r.reviewStatus === "approved" &&
      r.directUseAllowed &&
      !r.noAnswer,
  );

  /* ── 마커 잔존 — 두 자를 나란히 (같은 모집단에서) ─────────────────── */
  const legacySet = eligible.filter((r) => classifyChoiceFigureRow(r).broken);
  const state = (n: number, filled: number) =>
    n === 0 ? "없음" : filled >= 5 ? "다섯" : "일부";
  const oldTally = new Map<string, number>();
  const newTally = new Map<string, number>();
  for (const r of legacySet) {
    const ct = choiceTexts(r.content ?? "");
    const o = state(
      ct.size,
      [...ct.values()].filter((t) => t.length > 0).length,
    );
    oldTally.set(o, (oldTally.get(o) ?? 0) + 1);
    const v = classifyChoiceFigureRow(r);
    newTally.set(v.markerState, (newTally.get(v.markerState) ?? 0) + 1);
  }
  console.log(`## 마커 잔존 — 앞 자와 이 자 (같은 ${legacySet.length}건)\n`);
  console.log("| 마커 잔존 | 앞 자(choiceTexts) | 이 자(제품 정규식) |");
  console.log("| --- | ---: | ---: |");
  for (const k of ["없음", "일부", "다섯"])
    console.log(`| ${k} | ${oldTally.get(k) ?? 0} | ${newTally.get(k) ?? 0} |`);
  console.log(
    `\n앞 자는 \`1.\\n2.\\n3.\\n4.\\n5.\` 를 **3개**로 센다 — 연속한 마커를 건너뛴다.\n`,
  );

  /* ── D-20 — 못 되찾은 것을 폐기하면 ────────────────────────────────── */
  const lost = legacySet.filter((r) => verdictOf.get(r.id) === "불가");
  const unitNames = new Map<string, string>();
  const units = (await prisma.$queryRawUnsafe(
    `SELECT id, grade, chapter, section FROM unit`,
  )) as { id: string; grade: string; chapter: string; section: string }[];
  if (units.length === 0)
    throw new Error("단원표가 비었다 — 이름 없이 집계하면 표를 읽을 수 없다.");
  for (const u of units)
    unitNames.set(u.id, `${u.grade} ${u.chapter} > ${u.section}`);

  const poolByUnit = new Map<string, number>();
  for (const r of eligible)
    if (r.unitId) poolByUnit.set(r.unitId, (poolByUnit.get(r.unitId) ?? 0) + 1);
  const lostByUnit = new Map<string, number>();
  for (const r of lost)
    if (r.unitId) lostByUnit.set(r.unitId, (lostByUnit.get(r.unitId) ?? 0) + 1);

  console.log(`## D-20 — 되찾지 못한 ${lost.length}건을 폐기하면\n`);
  const affected = [...lostByUnit.entries()].map(([id, n]) => {
    const pool = poolByUnit.get(id) ?? 0;
    return { id, n, pool, left: pool - n, name: unitNames.get(id) ?? id };
  });
  affected.sort((a, b) => b.n - a.n || a.left - b.left);
  const underDaily = affected.filter((a) => a.left < DAILY);
  const underReview = affected.filter((a) => a.left < REVIEW);
  console.log(
    `- 영향받는 단원 **${affected.length}개**\n` +
      `- 폐기 후 일일테스트 정원(${DAILY}문항) 아래로 내려가는 단원 **${underDaily.length}개**\n` +
      `- 확인테스트 정원(${REVIEW}문항) 아래로 내려가는 단원 **${underReview.length}개**\n`,
  );
  console.log("| 단원 | 풀 | 잃는 수 | 남는 수 |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const a of affected.slice(0, 12))
    console.log(`| ${a.name} | ${a.pool} | ${a.n} | ${a.left} |`);
  if (underReview.length) {
    console.log(`\n### ⚠️ 정원 아래로 내려가는 단원\n`);
    console.log("| 단원 | 풀 | 잃는 수 | 남는 수 |");
    console.log("| --- | ---: | ---: | ---: |");
    for (const a of underReview)
      console.log(`| ${a.name} | ${a.pool} | ${a.n} | ${a.left} |`);
  }
  const noUnit = lost.filter((r) => !r.unitId).length;
  if (noUnit) console.log(`\n단원이 없는 행 ${noUnit}건은 위 집계에서 빠졌다.`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
