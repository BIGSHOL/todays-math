/**
 * 파라미터 탐색 — **연도로 나눠 검증한다.**
 *
 * backtest 지표를 보면서 파라미터를 고르면 그 지표에 과적합된다.
 * 그래서 2024년 이전 회차로만 고르고, **2025년 회차로 확인**한다.
 * 확인 세트의 숫자가 탐색 세트보다 크게 나쁘면 그 파라미터는 버린다.
 *
 * 실행:
 *   npx tsx scripts/predictor/tune.ts [--holdout-year 2025]
 */
import { comparePeriod } from "../../src/contracts/predictor.contract";
import type { Blueprint, ExamPaper } from "../../src/contracts/predictor.contract";
import { observeBlueprint } from "../../src/lib/predictor/blueprint";
import { blueprintDistances } from "../../src/lib/predictor/distance";
import {
  DEFAULT_PARAMS,
  predictBlueprint,
  type PredictorParams,
} from "../../src/lib/predictor/predictBlueprint";
import { isSameRound, rangeSeriesKey, styleSeriesKey } from "../../src/lib/predictor/series";
import { loadCorpus } from "./loadCorpus";

const args = process.argv.slice(2);
const HOLDOUT_YEAR = Number(
  args.includes("--holdout-year") ? args[args.indexOf("--holdout-year") + 1] : 2025,
);

interface Entry {
  paper: ExamPaper;
  observed: Blueprint;
  styleKey: string;
  rangeKey: string;
  cohortKey: string;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
}

function build() {
  const { papers } = loadCorpus();
  const entries: Entry[] = papers.map((paper) => ({
    paper,
    observed: observeBlueprint(paper),
    styleKey: styleSeriesKey(paper.series),
    rangeKey: rangeSeriesKey(paper.series),
    cohortKey: `${paper.series.level}${paper.series.grade}|${paper.series.subject}`,
  }));
  const index = (key: keyof Entry) => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = e[key] as string;
      const list = map.get(k);
      if (list) list.push(e);
      else map.set(k, [e]);
    }
    return map;
  };
  return {
    entries,
    byStyle: index("styleKey"),
    byRange: index("rangeKey"),
    byCohort: index("cohortKey"),
  };
}

const data = build();

function evaluate(params: PredictorParams, targets: Entry[]) {
  const rows: ReturnType<typeof blueprintDistances>[] = [];
  for (const target of targets) {
    const before = (list: Entry[]) =>
      list.filter((e) => comparePeriod(e.paper.period, target.paper.period) < 0);
    const history = before(data.byStyle.get(target.styleKey) ?? []);
    if (!history.length) continue;
    const rangeHistory = before(data.byRange.get(target.rangeKey) ?? []);
    const cohort = before(data.byCohort.get(target.cohortKey) ?? []).filter(
      (e) => e.paper.series.school !== target.paper.series.school,
    );
    const sameRoundRange = rangeHistory.filter((e) =>
      isSameRound(target.paper.period, e.paper.period),
    );
    const predicted = predictBlueprint({
      series: target.paper.series,
      target: target.paper.period,
      history: history.map((e) => e.observed),
      cohort: cohort.map((e) => e.observed),
      rangeHistory: (sameRoundRange.length ? sameRoundRange : rangeHistory).map((e) => e.observed),
      rangeCohort: cohort.map((e) => e.observed),
      params,
    });
    rows.push(blueprintDistances(predicted, target.observed));
  }
  return {
    n: rows.length,
    questionCount: mean(rows.map((r) => r.questionCountAbsError)),
    typeMix: mean(rows.map((r) => r.typeMixDistance)),
    grid: mean(rows.map((r) => r.scoreGridDistance)),
    unit: mean(rows.map((r) => r.unitMixDistance)),
  };
}

/** 항목별 개선을 하나로 합친 점수 — 낮을수록 좋다. 문항수는 척도가 달라 10으로 나눈다. */
function objective(m: ReturnType<typeof evaluate>) {
  return m.questionCount / 10 + m.typeMix + m.grid + m.unit;
}

const search = data.entries.filter((e) => e.paper.period.year < HOLDOUT_YEAR);
const holdout = data.entries.filter((e) => e.paper.period.year >= HOLDOUT_YEAR);
console.log(`탐색 세트 ${search.length}편 (~${HOLDOUT_YEAR - 1}) · 확인 세트 ${holdout.length}편 (${HOLDOUT_YEAR}~)`);

const grid: PredictorParams[] = [];
for (const decay of [0.7, 0.85, 1.0]) {
  for (const priorWeight of [1, 2, 4]) {
    for (const gridPriorWeight of [0, 0.25, 1, 2]) {
      for (const gridDecay of [0.4, 0.7, 1.0]) {
        grid.push({
          ...DEFAULT_PARAMS,
          decay,
          sameRoundBoost: 2,
          priorWeight,
          gridPriorWeight,
          gridDecay,
        });
      }
    }
  }
}

let best: { params: PredictorParams; score: number } | null = null;
for (const params of grid) {
  const m = evaluate(params, search);
  const score = objective(m);
  if (!best || score < best.score) best = { params, score };
}

const baseSearch = evaluate(DEFAULT_PARAMS, search);
const baseHold = evaluate(DEFAULT_PARAMS, holdout);
const bestSearch = evaluate(best!.params, search);
const bestHold = evaluate(best!.params, holdout);

const row = (label: string, m: ReturnType<typeof evaluate>) =>
  `${label.padEnd(22)}${String(m.n).padStart(6)}${m.questionCount.toFixed(3).padStart(11)}` +
  `${m.typeMix.toFixed(4).padStart(10)}${m.grid.toFixed(4).padStart(10)}${m.unit.toFixed(4).padStart(10)}`;

console.log(`\n조합 ${grid.length}개 탐색`);
console.log(`최적: ${JSON.stringify(best!.params)}`);
console.log(`\n${"".padEnd(22)}${"n".padStart(6)}${"문항수MAE".padStart(11)}${"유형".padStart(10)}${"배점눈금".padStart(10)}${"단원".padStart(10)}`);
console.log("-".repeat(69));
console.log(row("기본(탐색)", baseSearch));
console.log(row("최적(탐색)", bestSearch));
console.log(row("기본(확인)", baseHold));
console.log(row("최적(확인)", bestHold));

// 전역 최적은 합산 점수는 좋아도 항목별로 나빠질 수 있다(문항수가 특히 그렇다).
// 그래서 **문제로 지목된 항목만** 바꾼 보수적 안을 따로 확인한다.
const conservative: PredictorParams = {
  ...DEFAULT_PARAMS,
  gridPriorWeight: best!.params.gridPriorWeight,
  gridDecay: best!.params.gridDecay,
};
console.log(row("보수(탐색)", evaluate(conservative, search)));
console.log(row("보수(확인)", evaluate(conservative, holdout)));
console.log(`보수안: ${JSON.stringify(conservative)}`);

const searchGain = objective(baseSearch) - objective(bestSearch);
const holdGain = objective(baseHold) - objective(bestHold);
console.log(
  `\n합산 개선  탐색 ${searchGain >= 0 ? "+" : ""}${searchGain.toFixed(4)}` +
    ` · 확인 ${holdGain >= 0 ? "+" : ""}${holdGain.toFixed(4)}`,
);
console.log(
  holdGain > 0
    ? "→ 확인 세트에서도 개선됐다. 채택해도 된다."
    : "→ ⚠️ 확인 세트에서 개선이 없다. 탐색 세트 과적합이다. 채택하지 말 것.",
);
