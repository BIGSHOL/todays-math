/**
 * backtest 하네스 — "t 시점까지만 보고 t+1 을 맞혀봐라".
 *
 * 원장님 요구("25-1 중간·기말로 25-2 중간을 예측해 맞춰본다")를 과거 데이터 전체에
 * 대해 자동으로 수백 번 돌린다. 학생 데이터가 없어도 지금 당장 가능하다.
 *
 * 시간 분리는 `predictBlueprint` 가 코드로 강제한다 — 대상 시점 이후 자료가 하나라도
 * 섞이면 던진다. 여기서는 그 함수에 넘기기 전에도 한 번 더 걸러 이중으로 막는다.
 *
 * 비교 기준선 2개를 함께 돌린다. **엔진이 이걸 못 이기면 엔진을 쓸 이유가 없다.**
 *   - cohort-only  : 학교 과거를 아예 안 보고 코호트(전국) 평균만 쓴다
 *   - carry-forward: 직전 회차 시험지를 그대로 다음 회차 예측으로 쓴다
 *
 * ⚠️ `engine-sameRound` 변형이 있었으나 **1,343편 전부 engine 과 값이 같아** 걷어냈다
 *    (2026-08-16). 단원 배분을 작년 같은 회차로 좁히는 일을 엔진이 내부에서 이미
 *    하기 때문이다(v0.3 에서 들어갔다). 늘 똑같은 행은 정보가 아니라 잡음이다 —
 *    독립된 모델이 넷인 것처럼 보이게 만든다.
 *
 * 실행:
 *   npx tsx scripts/predictor/backtest.ts [--out <경로>] [--min-history 1]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  Blueprint,
  ExamPaper,
} from "../../src/contracts/predictor.contract";
import { comparePeriod } from "../../src/contracts/predictor.contract";
import { observeBlueprint } from "../../src/lib/predictor/blueprint";
import {
  blueprintDistances,
  type BlueprintDistances,
} from "../../src/lib/predictor/distance";
import {
  predictBlueprint,
  PREDICTOR_ENGINE_VERSION,
  PredictorUnavailableError,
} from "../../src/lib/predictor/predictBlueprint";
import { rangeSeriesKey, styleSeriesKey } from "../../src/lib/predictor/series";
import { partitionTrusted } from "../../src/lib/predictor/paperTrust";
import { isSchoolExam } from "../../src/lib/predictor/paperSource";
import { loadCorpus } from "./loadCorpus";

const args = process.argv.slice(2);
function argOf(name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const OUT = resolve(
  process.cwd(),
  argOf("--out", "scripts/qa/reports/backtest-report.json"),
);
const MIN_HISTORY = Number(argOf("--min-history", "1"));

interface Entry {
  paper: ExamPaper;
  observed: Blueprint;
  styleKey: string;
  rangeKey: string;
  cohortKey: string;
}

type Model = "engine" | "cohort-only" | "carry-forward";

interface Sample extends BlueprintDistances {
  model: Model;
  examId: string;
  styleKey: string;
  historyCount: number;
  /** 실측 시험지에 소단원 표기가 하나라도 있는가 — 단원 지표를 채점할 수 있는가. */
  hasObservedUnits: boolean;
  /** 난이도 라벨이 하나라도 있는가. */
  hasObservedDifficulty: boolean;
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((s, v) => s + v, 0) / values.length
    : NaN;
}

function summarize(samples: Sample[]) {
  const keys: Array<keyof BlueprintDistances> = [
    "questionCountAbsError",
    "totalScoreAbsError",
    "typeMixDistance",
    "scoreGridDistance",
  ];
  const out: Record<string, number> = { n: samples.length };
  for (const k of keys) out[k] = mean(samples.map((s) => s[k]));
  // ⚠️ 소단원 표기가 아예 없는 시험지는 단원 지표에서 뺀다.
  //    실측 대상이 빈 분포면 거리가 자동으로 1이 되어, "단원을 못 맞혔다"가 아니라
  //    "채점할 수 없다"는 사실이 지표를 오염시킨다.
  //    (2026-08-15 신규 추출 279편이 소단원 0% 였다 — 이걸 안 빼면 지표가 통째로 망가진다.)
  const scorable = samples.filter((s) => s.hasObservedUnits);
  out.unitMixDistance = mean(scorable.map((s) => s.unitMixDistance));
  out.unitScorable = scorable.length;
  const dScorable = samples.filter((s) => s.hasObservedDifficulty);
  out.difficultyMixDistance = mean(
    dScorable.map((s) => s.difficultyMixDistance),
  );
  out.difficultyScorable = dScorable.length;
  return out;
}

function main() {
  const { papers, stats } = loadCorpus();
  console.log(
    `코퍼스 ${stats.papers}편 · 문항 ${stats.questions}` +
      ` (파일 ${stats.files} · 시점없음 ${stats.droppedNoPeriod}` +
      ` · 메타부족 ${stats.droppedNoMeta} · 문항부족 ${stats.droppedTooFew}` +
      ` · 배점보정 ${stats.scoreFilled})`,
  );

  // 만점이 100 이 아닌 편은 원본이 잘린 것이다 — 학습·채점·출제 전부에서 뺀다.
  // 넣어 두면 그 학교가 "문항을 13개만 낸다"고 배운다 — 결손이 아니라 편향이 된다.
  const { trusted, excluded } = partitionTrusted(papers);
  const byReason = new Map<string, number>();
  for (const e of excluded) {
    if (e.trust.trusted) continue;
    const key = e.trust.shortfall
      ? `${e.trust.reason}/${e.trust.shortfall}`
      : e.trust.reason;
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  console.log(
    `신뢰 가드: ${trusted.length}편 사용 · ${excluded.length}편 제외 (` +
      [...byReason].map(([r, n]) => `${r} ${n}`).join(" · ") +
      ")",
  );

  // 🔴 학원이 만든 '대비' 자료는 학교 출제 패턴 학습에서 뺀다. 넣으면 엔진이
  //    원장님의 과거 추측을 그 학교 패턴으로 배운다(paperSource.ts 머리주석).
  const schoolExams = trusted.filter((p) => isSchoolExam(p.sourceFile));
  const daebi = trusted.length - schoolExams.length;
  console.log(
    `출처 가르기: 학교 기출 ${schoolExams.length}편 사용 · 학원 대비 자료 ${daebi}편 제외`,
  );

  const entries: Entry[] = schoolExams.map((paper) => ({
    paper,
    observed: observeBlueprint(paper),
    styleKey: styleSeriesKey(paper.series),
    rangeKey: rangeSeriesKey(paper.series),
    cohortKey: `${paper.series.level}${paper.series.grade}|${paper.series.subject}`,
  }));

  const byStyle = new Map<string, Entry[]>();
  const byRange = new Map<string, Entry[]>();
  const byCohort = new Map<string, Entry[]>();
  for (const e of entries) {
    (
      byStyle.get(e.styleKey) ?? byStyle.set(e.styleKey, []).get(e.styleKey)!
    ).push(e);
    (
      byRange.get(e.rangeKey) ?? byRange.set(e.rangeKey, []).get(e.rangeKey)!
    ).push(e);
    (
      byCohort.get(e.cohortKey) ??
      byCohort.set(e.cohortKey, []).get(e.cohortKey)!
    ).push(e);
  }

  const lengths = [...byStyle.values()].map((v) => v.length);
  console.log(
    `출제 스타일 시리즈 ${byStyle.size}개 (2편+ ${lengths.filter((n) => n >= 2).length}` +
      ` · 3편+ ${lengths.filter((n) => n >= 3).length}` +
      ` · 4편+ ${lengths.filter((n) => n >= 4).length})`,
  );

  const samples: Sample[] = [];
  let skipped = 0;
  let unavailable = 0;

  for (const target of entries) {
    const before = <T extends Entry>(list: T[]) =>
      list.filter(
        (e) => comparePeriod(e.paper.period, target.paper.period) < 0,
      );

    const history = before(byStyle.get(target.styleKey) ?? []);
    if (history.length < MIN_HISTORY) {
      skipped += 1;
      continue;
    }
    const rangeHistory = before(byRange.get(target.rangeKey) ?? []);
    const cohort = before(byCohort.get(target.cohortKey) ?? []).filter(
      (e) => e.paper.series.school !== target.paper.series.school,
    );

    const common = {
      series: target.paper.series,
      target: target.paper.period,
      cohort: cohort.map((e) => e.observed),
      rangeCohort: cohort.map((e) => e.observed),
    };

    // 근거가 없어 예측 자체가 불가능한 경우가 있다(그 코호트의 첫 시험지 등).
    // 예전에는 0문항 청사진을 내서 지표에 섞였다 — 이제는 세고 뺀다.
    const tryPredict = (fn: () => Blueprint): Blueprint | null => {
      try {
        return fn();
      } catch (error) {
        if (error instanceof PredictorUnavailableError) return null;
        throw error;
      }
    };

    const engine = predictBlueprint({
      ...common,
      history: history.map((e) => e.observed),
      rangeHistory: rangeHistory.map((e) => e.observed),
    });
    const cohortOnly = tryPredict(() =>
      predictBlueprint({ ...common, history: [], rangeHistory: [] }),
    );
    // 직전 회차를 그대로 — 가장 순진한 기준선.
    const last = history[history.length - 1].observed;
    const carry: Blueprint = {
      ...last,
      kind: "predicted",
      period: target.paper.period,
    };

    const base = {
      examId: target.paper.externalExamId,
      styleKey: target.styleKey,
      historyCount: history.length,
      hasObservedUnits: target.observed.unitMix.length > 0,
      hasObservedDifficulty:
        target.observed.difficultyMix["하"].count +
          target.observed.difficultyMix["중"].count +
          target.observed.difficultyMix["상"].count >
        0,
    };
    samples.push({
      model: "engine",
      ...base,
      ...blueprintDistances(engine, target.observed),
    });
    if (cohortOnly) {
      samples.push({
        model: "cohort-only",
        ...base,
        ...blueprintDistances(cohortOnly, target.observed),
      });
    } else {
      unavailable += 1;
    }
    samples.push({
      model: "carry-forward",
      ...base,
      ...blueprintDistances(carry, target.observed),
    });
  }

  const models: Model[] = ["engine", "cohort-only", "carry-forward"];
  const summary = Object.fromEntries(
    models.map((m) => [m, summarize(samples.filter((s) => s.model === m))]),
  );

  console.log(
    // ⚠️ 모델 수로 나눠 세면 안 된다 — cohort-only 는 근거가 없어 빠지는 편이 있어
    //    나눗셈이 소수로 떨어진다(예전 "1332편"도 실제 1343편의 잘못된 값이었다).
    `\nbacktest 대상 ${samples.filter((s) => s.model === "engine").length}편 (과거 없음으로 제외 ${skipped}편` +
      // 코호트 기준선조차 못 세운 편 — 세어만 두면 기준선 비교가 조용히 왜곡된다.
      `${unavailable ? ` · 코호트 표본 없음 ${unavailable}편` : ""})`,
  );
  console.log(
    `\n${"모델".padEnd(15)}${"문항수MAE".padStart(11)}${"총점MAE".padStart(10)}` +
      `${"유형거리".padStart(10)}${"배점눈금".padStart(10)}${"단원거리".padStart(10)}${"난이도거리".padStart(11)}`,
  );
  console.log("-".repeat(77));
  for (const m of models) {
    const s = summary[m];
    console.log(
      m.padEnd(15) +
        s.questionCountAbsError.toFixed(3).padStart(11) +
        s.totalScoreAbsError.toFixed(3).padStart(10) +
        s.typeMixDistance.toFixed(4).padStart(10) +
        s.scoreGridDistance.toFixed(4).padStart(10) +
        s.unitMixDistance.toFixed(4).padStart(10) +
        s.difficultyMixDistance.toFixed(4).padStart(11),
    );
  }

  // 과거 회차가 쌓일수록 나아지는가 — "몇 학기 돌리면 정확해진다"의 직접 검증.
  console.log("\n과거 회차 수별 (engine, 문항수MAE · 유형거리 · 단원거리):");
  for (const bucket of [1, 2, 3, 4]) {
    const sel = samples.filter(
      (s) =>
        s.model === "engine" &&
        (bucket < 4 ? s.historyCount === bucket : s.historyCount >= 4),
    );
    if (!sel.length) continue;
    const s = summarize(sel);
    console.log(
      `  ${bucket < 4 ? `${bucket}편` : "4편+"}  n=${String(sel.length).padStart(4)}  ` +
        `${s.questionCountAbsError.toFixed(3).padStart(7)}  ` +
        `${s.typeMixDistance.toFixed(4).padStart(7)}  ` +
        `${s.unitMixDistance.toFixed(4).padStart(7)}`,
    );
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        engineVersion: PREDICTOR_ENGINE_VERSION,
        corpus: stats,
        // 신뢰 가드에서 뺀 편 — 버린 게 아니라 **추출 재작업 대상 목록**이다.
        // 추출을 고쳐 다시 뽑으면 externalExamId 멱등이라 그대로 되돌아온다.
        excludedPapers: excluded.map(({ paper, trust }) => ({
          externalExamId: paper.externalExamId,
          school: paper.series.school,
          grade: `${paper.series.level}${paper.series.grade}`,
          subject: paper.series.subject,
          period: `${paper.period.year}-${paper.period.semester}${paper.period.round}`,
          totalScore: paper.totalScore,
          questionCount: paper.questions.length,
          reason: trust.trusted ? null : trust.reason,
          shortfall: trust.trusted ? null : trust.shortfall,
          sourceFile: paper.sourceFile,
        })),
        summary,
        samples,
      },
      null,
      1,
    ),
    "utf-8",
  );
  console.log(`\n상세: ${OUT}`);
}

main();
