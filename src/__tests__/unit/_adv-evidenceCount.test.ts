/**
 * 적대적 리뷰 ③ — 재현 전용.
 *
 * 공격 대상: "근거가 부족하면 숫자를 내지 않는다" (viewModel.roundJudgement).
 *
 * `MIN_EVIDENCE_ROUNDS = 2` 의 근거로 viewModel 이 든 것은
 *   - "evidenceCount === 0 은 전국 평균만으로 만든 것"
 *   - "1편은 학교 패턴이라고 부를 수 없다"
 * 둘 다 **그 학교 과거 편수**에 대한 말이다. 엔진도 그렇게 센다
 * (predictBlueprint.ts:435 `evidenceCount: history.length`).
 *
 * 그런데 화면이 보는 `summary.evidenceCount` 는 `run.inputExamIds.length` 이고,
 * `inputExamIds` 는 `[...history, ...cohort]` — **다른 학교 시험지까지** 담는다
 * (predictionRunService.ts:425·499, cohort 정의는 같은 파일 221행).
 */
import { describe, expect, it } from "vitest";

import { observeBlueprint } from "@/lib/predictor/blueprint";
import {
  DEFAULT_PARAMS,
  predictBlueprint,
} from "@/lib/predictor/predictBlueprint";
import { toRoundSummary, type PredictionRunRow } from "@/lib/exam/composeRounds";
import { roundJudgement, MIN_EVIDENCE_ROUNDS } from "@/components/exam/viewModel";
import { basisLine } from "@/components/exam/BlueprintPanel";
import type {
  ExamPaper,
  ExamPeriod,
  ExamSeriesKey,
} from "@/contracts/predictor.contract";

const MINE: ExamSeriesKey = {
  school: "정화중",
  level: "중",
  grade: 3,
  subject: "중3",
};
const TARGET: ExamPeriod = { year: 2025, semester: 2, round: "중간" };

function paper(
  school: string,
  period: ExamPeriod,
  externalExamId: string,
): ExamPaper {
  return {
    externalExamId,
    series: { ...MINE, school },
    period,
    subjectRaw: "수학",
    totalScore: 100,
    sourceFile: null,
    questions: Array.from({ length: 20 }, (_, i) => ({
      number: i + 1,
      score: 5,
      qtype: "객관식" as const,
      difficultyLabel: "중" as const,
      topicRaw: "이차방정식",
      unitId: null,
      answer: "1",
      hasFigure: false,
      problemId: null,
    })),
  };
}

describe("[ADV-11] '근거 N회차' 는 그 학교 과거 편수가 아니다", () => {
  it("우리 학교 과거 1편 + 남의 학교 4편 → 화면은 '근거 5회차' 라고 적고 숫자를 낸다", () => {
    // 작년 같은 회차 1편 — 실제로 제일 흔한 상황이다.
    const history = [
      observeBlueprint(paper("정화중", { year: 2024, semester: 2, round: "중간" }, "own-1")),
    ];
    // 코호트 = 같은 급/학년/과목의 **다른 학교** (predictionRunService.ts:221).
    const cohort = ["A중", "B중", "C중", "D중"].map((s, i) =>
      observeBlueprint(paper(s, { year: 2024, semester: 2, round: "중간" }, `co-${i}`)),
    );

    const blueprint = predictBlueprint({
      series: MINE,
      target: TARGET,
      history,
      cohort,
      rangeHistory: history,
      rangeCohort: cohort,
      params: DEFAULT_PARAMS,
    });

    console.log(
      "[ADV-11] 엔진이 낸 값 — evidenceCount =",
      blueprint.evidenceCount,
      "· confidence =",
      blueprint.confidence.toFixed(3),
    );

    // runPrediction 이 저장하는 모양 그대로: inputExamIds = [...history, ...cohort]
    const run: PredictionRunRow = {
      id: "70000000-0000-4000-8000-0000000000c1",
      userId: "10000000-0000-4000-8000-000000000001",
      examDate: null,
      createdAt: new Date("2026-08-16T00:00:00.000Z"),
      engineVersion: "0.5.0",
      school: MINE.school,
      level: MINE.level,
      grade: MINE.grade,
      subject: MINE.subject,
      targetYear: TARGET.year,
      targetSemester: TARGET.semester,
      targetRound: TARGET.round,
      inputExamIds: ["own-1", "co-0", "co-1", "co-2", "co-3"],
      predictedBlueprint: blueprint,
      predictedScores: [],
    };

    const summary = toRoundSummary(run, [])!;
    const judgement = roundJudgement(summary);

    console.log(
      "[ADV-11] 화면이 보는 값 — evidenceCount =",
      summary.evidenceCount,
      "· 판정 =",
      JSON.stringify(judgement),
    );
    console.log("[ADV-11] 청사진 패널 근거 줄 =", basisLine(summary.evidenceCount, summary.confidence));

    // 엔진: 이 학교 과거는 1편뿐 → viewModel 의 문턱(2)에 미달이다.
    expect(blueprint.evidenceCount).toBe(1);
    expect(blueprint.evidenceCount).toBeLessThan(MIN_EVIDENCE_ROUNDS);

    // 화면: 그런데 5회차로 세고 통과시킨다 → 청사진 숫자를 그대로 낸다.
    expect(summary.evidenceCount).toBe(5);
    expect(judgement.available).toBe(true);
  });

  it("계약 주석은 '(blueprint.evidenceCount 와 같은 값)' 이라고 적혀 있다 — 실제로는 다르다", () => {
    const history = [
      observeBlueprint(paper("정화중", { year: 2024, semester: 2, round: "중간" }, "own-1")),
    ];
    const cohort = [
      observeBlueprint(paper("A중", { year: 2024, semester: 2, round: "중간" }, "co-0")),
    ];
    const blueprint = predictBlueprint({
      series: MINE,
      target: TARGET,
      history,
      cohort,
      rangeHistory: history,
      rangeCohort: cohort,
      params: DEFAULT_PARAMS,
    });
    const run: PredictionRunRow = {
      id: "70000000-0000-4000-8000-0000000000c2",
      userId: "10000000-0000-4000-8000-000000000001",
      examDate: null,
      createdAt: new Date("2026-08-16T00:00:00.000Z"),
      engineVersion: "0.5.0",
      school: MINE.school,
      level: MINE.level,
      grade: MINE.grade,
      subject: MINE.subject,
      targetYear: TARGET.year,
      targetSemester: TARGET.semester,
      targetRound: TARGET.round,
      inputExamIds: ["own-1", "co-0"],
      predictedBlueprint: blueprint,
      predictedScores: [],
    };
    const summary = toRoundSummary(run, [])!;
    console.log(
      "[ADV-11b] blueprint.evidenceCount =",
      blueprint.evidenceCount,
      "· summary.evidenceCount =",
      summary.evidenceCount,
    );
    expect(summary.evidenceCount).not.toBe(blueprint.evidenceCount);
  });
});
