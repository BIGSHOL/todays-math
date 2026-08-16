/**
 * 파라미터 탐색 — **연도로 나눠 검증하고, 항목별로 판정한다.**
 *
 * 두 가지를 코드로 막는다.
 *
 * 1. **탐색 세트 과적합.** backtest 지표를 보며 파라미터를 고르면 그 지표에 과적합된다.
 *    2024년 이전으로만 고르고 2025년으로 확인한다. 확인 세트가 나빠지면 버린다.
 *
 * 2. **합산 목적함수의 함정.** 합계 하나로 고르면 어떤 항목은 조용히 나빠진다
 *    (이 트랙에서 실제로 겪었다). 그래서 **항목마다 따로 최적을 찾고**
 *    항목별로 채택 여부를 가른다.
 *
 * 코퍼스에 **신뢰 가드를 건다.** 안 걸면 backtest 는 1,810편으로 재는데 튜닝은
 * 오염된 2,020편으로 골라, 서로 다른 데이터에 맞춘 파라미터가 나온다
 * (2026-08-16 발견 — 그 전까지 이 스크립트는 가드를 안 걸고 있었다).
 *
 * 기준선을 함께 낸다. **엔진이 carry-forward 를 못 이기는 항목은 엔진을 쓸 이유가 없다.**
 *
 * 실행:
 *   npx tsx scripts/predictor/tune.ts [--holdout-year 2025]
 */
import { comparePeriod } from "../../src/contracts/predictor.contract";
import type {
  Blueprint,
  ExamPaper,
} from "../../src/contracts/predictor.contract";
import { observeBlueprint } from "../../src/lib/predictor/blueprint";
import { blueprintDistances } from "../../src/lib/predictor/distance";
import { partitionTrusted } from "../../src/lib/predictor/paperTrust";
import {
  DEFAULT_PARAMS,
  predictBlueprint,
  type PredictorParams,
} from "../../src/lib/predictor/predictBlueprint";
import {
  isSameRound,
  rangeSeriesKey,
  styleSeriesKey,
} from "../../src/lib/predictor/series";
import { loadCorpus } from "./loadCorpus";

const args = process.argv.slice(2);
const HOLDOUT_YEAR = Number(
  args.includes("--holdout-year")
    ? args[args.indexOf("--holdout-year") + 1]
    : 2025,
);

interface Entry {
  paper: ExamPaper;
  observed: Blueprint;
  styleKey: string;
  rangeKey: string;
  cohortKey: string;
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((s, v) => s + v, 0) / values.length
    : NaN;
}

function build() {
  const { papers } = loadCorpus();
  // backtest 와 **같은 코퍼스**를 봐야 한다. 다르면 튜닝이 딴 데이터에 맞춰진다.
  const { trusted, excluded } = partitionTrusted(papers);
  console.log(
    `신뢰 가드: ${trusted.length}편 사용 · ${excluded.length}편 제외`,
  );
  const entries: Entry[] = trusted.map((paper) => ({
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

interface Metrics {
  n: number;
  questionCount: number;
  totalScore: number;
  typeMix: number;
  grid: number;
  unit: number;
}

const METRIC_KEYS = [
  "questionCount",
  "totalScore",
  "typeMix",
  "grid",
  "unit",
] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

const METRIC_LABEL: Record<MetricKey, string> = {
  questionCount: "문항수MAE",
  totalScore: "총점MAE",
  typeMix: "유형",
  grid: "배점눈금",
  unit: "단원",
};

/** 한 대상에 대해 엔진 예측과 carry-forward 를 함께 만든다. 근거가 없으면 null. */
function predictFor(target: Entry, params: PredictorParams) {
  const before = (list: Entry[]) =>
    list.filter((e) => comparePeriod(e.paper.period, target.paper.period) < 0);
  const history = before(data.byStyle.get(target.styleKey) ?? []);
  if (!history.length) return null;
  const rangeHistory = before(data.byRange.get(target.rangeKey) ?? []);
  const cohort = before(data.byCohort.get(target.cohortKey) ?? []).filter(
    (e) => e.paper.series.school !== target.paper.series.school,
  );
  const sameRoundRange = rangeHistory.filter((e) =>
    isSameRound(target.paper.period, e.paper.period),
  );
  const engine = predictBlueprint({
    series: target.paper.series,
    target: target.paper.period,
    history: history.map((e) => e.observed),
    cohort: cohort.map((e) => e.observed),
    rangeHistory: (sameRoundRange.length ? sameRoundRange : rangeHistory).map(
      (e) => e.observed,
    ),
    rangeCohort: cohort.map((e) => e.observed),
    params,
  });
  const last = history[history.length - 1].observed;
  const carry: Blueprint = {
    ...last,
    kind: "predicted",
    period: target.paper.period,
  };
  return { engine, carry, observed: target.observed };
}

function summarize(
  rows: Array<ReturnType<typeof blueprintDistances>>,
): Metrics {
  return {
    n: rows.length,
    questionCount: mean(rows.map((r) => r.questionCountAbsError)),
    totalScore: mean(rows.map((r) => r.totalScoreAbsError)),
    typeMix: mean(rows.map((r) => r.typeMixDistance)),
    grid: mean(rows.map((r) => r.scoreGridDistance)),
    unit: mean(rows.map((r) => r.unitMixDistance)),
  };
}

function evaluate(params: PredictorParams, targets: Entry[]): Metrics {
  const rows: Array<ReturnType<typeof blueprintDistances>> = [];
  for (const target of targets) {
    const p = predictFor(target, params);
    if (p) rows.push(blueprintDistances(p.engine, p.observed));
  }
  return summarize(rows);
}

/** carry-forward 기준선 — 파라미터와 무관하므로 한 번만 잰다. */
function evaluateCarry(targets: Entry[]): Metrics {
  const rows: Array<ReturnType<typeof blueprintDistances>> = [];
  for (const target of targets) {
    const p = predictFor(target, DEFAULT_PARAMS);
    if (p) rows.push(blueprintDistances(p.carry, p.observed));
  }
  return summarize(rows);
}

const search = data.entries.filter((e) => e.paper.period.year < HOLDOUT_YEAR);
const holdout = data.entries.filter((e) => e.paper.period.year >= HOLDOUT_YEAR);
console.log(
  `탐색 세트 ${search.length}편 (~${HOLDOUT_YEAR - 1}) · 확인 세트 ${holdout.length}편 (${HOLDOUT_YEAR}~)`,
);

const grid: PredictorParams[] = [];
for (const decay of [0.4, 0.55, 0.7, 0.85, 1.0]) {
  for (const sameRoundBoost of [1, 2, 4]) {
    for (const priorWeight of [0, 0.5, 1, 2, 4]) {
      for (const unitOwnWeight of [0, 0.15, 0.25, 0.4]) {
        grid.push({
          ...DEFAULT_PARAMS,
          decay,
          sameRoundBoost,
          priorWeight,
          unitOwnWeight,
        });
      }
    }
  }
}
console.log(`\n조합 ${grid.length}개 · 항목마다 따로 최적을 찾는다`);

const evaluated = grid.map((params) => ({
  params,
  m: evaluate(params, search),
}));

const baseSearch = evaluate(DEFAULT_PARAMS, search);
const baseHold = evaluate(DEFAULT_PARAMS, holdout);
const carryHold = evaluateCarry(holdout);

console.log(
  `\n${"항목".padEnd(12)}${"".padEnd(6)}${"탐색".padStart(10)}${"확인".padStart(10)}${"carry(확인)".padStart(14)}${"판정".padStart(10)}`,
);
console.log("-".repeat(74));

for (const key of METRIC_KEYS) {
  const best = evaluated.reduce((a, b) => (b.m[key] < a.m[key] ? b : a));
  const bestHold = evaluate(best.params, holdout);

  const searchImproved = best.m[key] < baseSearch[key];
  const holdImproved = bestHold[key] < baseHold[key];
  const verdict = !searchImproved
    ? "기본유지"
    : holdImproved
      ? "채택가능"
      : "과적합";

  const changes = (
    ["decay", "sameRoundBoost", "priorWeight", "unitOwnWeight"] as const
  )
    .filter((p) => best.params[p] !== DEFAULT_PARAMS[p])
    .map((p) => `${p}=${best.params[p]}`);

  console.log(
    `${METRIC_LABEL[key].padEnd(12)}${"기본".padEnd(6)}` +
      `${baseSearch[key].toFixed(4).padStart(10)}${baseHold[key].toFixed(4).padStart(10)}` +
      `${carryHold[key].toFixed(4).padStart(14)}` +
      `${(baseHold[key] <= carryHold[key] ? "엔진승" : "carry승").padStart(10)}`,
  );
  console.log(
    `${"".padEnd(12)}${"최적".padEnd(6)}` +
      `${best.m[key].toFixed(4).padStart(10)}${bestHold[key].toFixed(4).padStart(10)}` +
      `${"".padStart(14)}${verdict.padStart(10)}   ${changes.join(" ") || "(기본과 동일)"}`,
  );
}

console.log(
  "\n항목별 최적 파라미터가 서로 다르면 하나로 합칠 수 없다. 항목마다 다른 감쇠/축소를",
);
console.log(
  "쓰려면 엔진에 항목별 파라미터를 두어야 한다(배점 눈금이 이미 그렇다: gridDecay).",
);

// ─────────────────────────────────────────────
// 후보 전수 검증 — 항목별 최적표만 보고 채택하면 안 된다.
//
// ⚠️ 위 표의 "최적" 줄에는 **그 항목에 영향이 없는 파라미터**도 섞여 나온다
//    (문항수에 unitOwnWeight 는 아무 영향이 없는데 그리드 순서상 먼저 걸린다).
//    파라미터는 여러 항목이 **공유**하므로, 하나를 바꾸면 다른 항목이 조용히 나빠진다.
//    그래서 실제로 바꿀 후보를 정하고 **전 항목에서** 확인 세트로 잰다.
// ─────────────────────────────────────────────
const CANDIDATES: Array<{ name: string; params: PredictorParams }> = [
  { name: "기본", params: DEFAULT_PARAMS },
  {
    name: "boost=4",
    params: { ...DEFAULT_PARAMS, sameRoundBoost: 4 },
  },
  {
    name: "prior=0",
    params: { ...DEFAULT_PARAMS, priorWeight: 0 },
  },
  {
    name: "boost=4+prior=0",
    params: { ...DEFAULT_PARAMS, sameRoundBoost: 4, priorWeight: 0 },
  },
  {
    name: "boost=4+prior=0.5",
    params: { ...DEFAULT_PARAMS, sameRoundBoost: 4, priorWeight: 0.5 },
  },
  // prior 인하는 문항 수·유형만 좋아지고 총점은 두 분할 모두에서 나빠졌다.
  // 그래서 총점용(priorWeight)은 그대로 두고 학교 고유 항목만 낮춘다.
  {
    name: "boost=4+style=0",
    params: { ...DEFAULT_PARAMS, sameRoundBoost: 4, stylePriorWeight: 0 },
  },
  {
    name: "boost=4+style=0.5",
    params: { ...DEFAULT_PARAMS, sameRoundBoost: 4, stylePriorWeight: 0.5 },
  },
  {
    name: "boost=4+style=1",
    params: { ...DEFAULT_PARAMS, sameRoundBoost: 4, stylePriorWeight: 1 },
  },
];

console.log("\n\n── 후보 전수 검증 (확인 세트) — 낮을수록 좋다 ──");
console.log(
  `${"후보".padEnd(20)}${METRIC_KEYS.map((k) => METRIC_LABEL[k].padStart(11)).join("")}`,
);
console.log("-".repeat(20 + 11 * METRIC_KEYS.length));

const carryRow = METRIC_KEYS.map((k) =>
  carryHold[k].toFixed(4).padStart(11),
).join("");
console.log(`${"carry-forward".padEnd(20)}${carryRow}`);

for (const c of CANDIDATES) {
  const m = evaluate(c.params, holdout);
  const cells = METRIC_KEYS.map((k) => {
    const worse = m[k] > baseHold[k] + 1e-9;
    const better = m[k] < baseHold[k] - 1e-9;
    const mark = c.name === "기본" ? " " : worse ? "↑" : better ? "↓" : " ";
    return (m[k].toFixed(4) + mark).padStart(11);
  }).join("");
  console.log(`${c.name.padEnd(20)}${cells}`);
}
console.log(
  "\n↓ 좋아짐 · ↑ 나빠짐 (기본 대비). 하나라도 ↑ 면 그 변경은 쪼개서 봐야 한다.",
);
