/**
 * 정답지 경고(`assessAnswerKeyRisk`)를 **실측으로 사라진 해설**과 대조한다.
 *
 * 근거 자료는 `measure-answerkey-overflow.tsx --json` 이 낸다 — 지면을 Chromium 에
 * 그려 `.solutionItem` 이 2단 밖(3번째 단)으로 밀렸는지를 문항 단위로 기록한 것이다.
 * 여기서는 **다시 그리지 않고** 그 기록으로 규칙만 채점한다.
 *
 *   npx tsx scripts/qa/measure-answerkey-overflow.tsx --with-solution --json .measure/ak-solution.json
 *   npx tsx scripts/qa/eval-answerkey-rules.ts --log .measure/ak-solution.json
 *
 * ⚠️ 채점 단위는 **문항**이다. 장 단위로만 세면 「한 장에서 6건이 사라졌다」와
 *    「1건이 사라졌다」가 같아 보인다 — 어느 쪽을 고쳐야 하는지 갈리지 않는다.
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import type { TestPrintProblem } from "../../src/components/print/types";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import {
  assessAnswerKeyRisk,
  estimateSolutionPx,
  quickAnswerBoxPx,
} from "../../src/lib/printOverflow";

const prisma = new PrismaClient();

interface PageLog {
  test: number;
  page: number;
  ids: string[];
  lost: string[];
}

async function main() {
  const i = process.argv.indexOf("--log");
  const logPath = i >= 0 ? process.argv[i + 1]! : ".measure/ak-solution.json";
  const log = JSON.parse(readFileSync(logPath, "utf8")) as PageLog[];

  const ids = [...new Set(log.flatMap((p) => p.ids))];
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, answer, solution FROM problem WHERE id = ANY($1::uuid[])`,
    ids,
  )) as Array<{ id: string; answer: string; solution: string | null }>;
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 시험지 단위로 되모은다 — 판정은 시험지 전체를 받아야 1쪽 「빠른 정답」 상자를 안다.
  const tests = new Map<number, PageLog[]>();
  for (const page of log) {
    const list = tests.get(page.test) ?? [];
    list.push(page);
    tests.set(page.test, list);
  }

  let lostTotal = 0;
  let hit = 0;
  let falseAlarm = 0;
  let warned = 0;
  const missedSamples: string[] = [];

  for (const [, pages] of tests) {
    pages.sort((a, b) => a.page - b.page);
    const problems: TestPrintProblem[] = pages
      .flatMap((p) => p.ids)
      .map((id, index) => {
        const row = byId.get(id)!;
        return {
          id,
          orderIndex: index + 1,
          content: "",
          answer: row.answer ?? "",
          solution: row.solution,
        };
      });

    const predicted = new Set<string>();
    for (const risk of assessAnswerKeyRisk(problems))
      for (const number of risk.numbers)
        predicted.add(problems[number - 1]!.id);

    const actual = new Set(pages.flatMap((p) => p.lost));
    lostTotal += actual.size;
    warned += predicted.size;
    for (const id of actual)
      if (predicted.has(id)) hit += 1;
      else if (missedSamples.length < 8) missedSamples.push(id);
    for (const id of predicted) if (!actual.has(id)) falseAlarm += 1;
  }

  /* ── 진단: 놓친 쪽에서 «내 자»가 얼마나 짧게 재는가 ─────────────────────── */
  const gaps: number[] = [];
  for (const [, pages] of tests) {
    const all = pages.flatMap((p) => p.ids);
    for (const page of pages) {
      if (page.lost.length === 0) continue;
      const columnPx =
        page.page === 1
          ? JASEUP_MEASURED_PX.answerSolutionsFull -
            quickAnswerBoxPx(all.map((id) => byId.get(id)!.answer ?? "")) -
            JASEUP_MEASURED_PX.quickAnswerGap
          : JASEUP_MEASURED_PX.answerSolutionsFull;
      const estimated = page.ids.reduce(
        (sum, id) => sum + estimateSolutionPx(byId.get(id)!.solution),
        0,
      );
      // 실제로 밀린 건수만큼은 «용량을 넘었다»는 뜻이다. 추정 총합이 용량보다
      // 작으면 그 차이가 곧 «덜 센 몫»이다.
      gaps.push(columnPx * 2 - estimated);
    }
  }
  gaps.sort((a, b) => a - b);
  const g = (p: number) => gaps[Math.floor(gaps.length * p)]!;
  console.log(
    `
실제로 밀린 ${gaps.length}장에서 «용량 − 추정총합»: p25 ${g(0.25).toFixed(0)}px · 중앙 ${g(0.5).toFixed(0)}px · p75 ${g(0.75).toFixed(0)}px`,
  );
  console.log("  (0보다 크면 그만큼 덜 센 것이다 — 자가 짧다)");

  const items = log.reduce((n, p) => n + p.ids.length, 0);
  console.log(`정답지 ${log.length}장 · 해설 ${items.toLocaleString()}건`);
  console.log(
    `실측 사라짐 ${lostTotal} (${((lostTotal * 100) / items).toFixed(2)}%)`,
  );
  console.log(
    `경고 ${warned} · 맞음 ${hit} · 헛것 ${falseAlarm} · 놓침 ${lostTotal - hit}`,
  );
  console.log(
    `재현율 ${((100 * hit) / Math.max(1, lostTotal)).toFixed(1)}% · 정밀도 ${((100 * hit) / Math.max(1, warned)).toFixed(1)}%`,
  );
  if (missedSamples.length)
    console.log(`놓친 표본: ${missedSamples.slice(0, 5).join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
