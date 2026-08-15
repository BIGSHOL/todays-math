// T0(예측기) 계약 테스트 — docs/planning/11-score-predictor.md
//
// 유효 샘플 parse / 무효 샘플 reject 확인과, 시점 정렬 유틸의 동작을 고정한다.
// 정렬 규칙(연도 → 학기 → 중간<기말)이 틀리면 backtest의 시간 분리가 통째로 무너지므로
// 이 파일이 그 규칙의 SSOT 테스트다.
import { describe, expect, it } from "vitest";

import {
  abilityEstimateSchema,
  backtestMetricsSchema,
  blueprintSchema,
  comparePeriod,
  examPaperSchema,
  examPeriodSchema,
  examQuestionSchema,
  itemStatSchema,
  periodSortKey,
  predictionRunSchema,
  scorePredictionSchema,
  seriesKeyString,
  studentResponseSchema,
  type ExamPeriod,
} from "@/contracts/predictor.contract";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-15T00:00:00.000Z";

const series = {
  school: "정화중",
  level: "중" as const,
  grade: 3,
  subject: "중3",
};

const period = (
  year: number,
  semester: 1 | 2,
  round: "중간" | "기말",
): ExamPeriod => ({ year, semester, round });

const question = {
  number: 1,
  score: 3.2,
  qtype: "객관식" as const,
  difficultyLabel: "하" as const,
  topicRaw: "제곱근과 실수",
  unitId: UUID_1,
  answer: "②",
  hasFigure: false,
  problemId: UUID_2,
};

const blueprint = {
  kind: "observed" as const,
  series,
  period: period(2025, 2, "중간"),
  questionCount: 24,
  totalScore: 100,
  typeMix: {
    객관식: { count: 18, score: 62 },
    단답형: { count: 2, score: 8 },
    서술형: { count: 4, score: 30 },
  },
  difficultyMix: {
    하: { count: 9, score: 32 },
    중: { count: 11, score: 44 },
    상: { count: 4, score: 24 },
    미표기: { count: 0, score: 0 },
  },
  scoreHistogram: [{ score: 3.2, count: 5 }],
  positionCurve: [
    { number: 1, difficulty: 0, score: 3.2, qtype: "객관식" as const },
  ],
  unitMix: [
    {
      unitId: UUID_1,
      topicRaw: "제곱근과 실수",
      count: 4,
      score: 13.6,
    },
  ],
  expectedMean: 62.4,
  expectedMeanInterval: { lower: 57.4, upper: 67.4, coverage: 0.8 },
  evidenceCount: 3,
  confidence: 0.62,
};

describe("[예측기 계약] L0 시험지", () => {
  it("examQuestionSchema — 소수 배점(3.2)을 그대로 받는다", () => {
    const result = examQuestionSchema.safeParse(question);
    expect(result.success).toBe(true);
    expect(result.success && result.data.score).toBe(3.2);
  });

  it("examQuestionSchema — 난이도 라벨·소단원·단원이 없는 문항도 받는다", () => {
    const result = examQuestionSchema.safeParse({
      ...question,
      difficultyLabel: null,
      topicRaw: null,
      unitId: null,
      answer: null,
      problemId: null,
    });
    expect(result.success).toBe(true);
  });

  it("examQuestionSchema — 난이도 라벨에 easy/mid/hard를 넣으면 거부한다", () => {
    // 시험지 원본 라벨(상/중/하)과 문제은행 난이도(easy/mid/hard)는 다른 축이다.
    const result = examQuestionSchema.safeParse({
      ...question,
      difficultyLabel: "easy",
    });
    expect(result.success).toBe(false);
  });

  it("examPaperSchema — 시험지 1편을 parse한다", () => {
    const result = examPaperSchema.safeParse({
      externalExamId: "2643",
      series,
      period: period(2025, 1, "중간"),
      subjectRaw: "수학",
      totalScore: 100,
      questions: [question],
      sourceFile: "N:/개인/기출/HWP 2 PDF/[정화중][3][25-1-중간] (완료).PDF",
    });
    expect(result.success).toBe(true);
  });

  it("examPeriodSchema — 3학기는 거부한다", () => {
    expect(
      examPeriodSchema.safeParse({ year: 2025, semester: 3, round: "중간" })
        .success,
    ).toBe(false);
  });
});

describe("[예측기 계약] L1 청사진", () => {
  it("blueprintSchema — 실측 청사진을 parse한다", () => {
    const result = blueprintSchema.safeParse(blueprint);
    expect(result.success).toBe(true);
  });

  it("blueprintSchema — 예측 청사진의 소수 문항 수(기댓값)를 허용한다", () => {
    const result = blueprintSchema.safeParse({
      ...blueprint,
      kind: "predicted",
      typeMix: {
        객관식: { count: 17.4, score: 60.2 },
        단답형: { count: 2.1, score: 8.3 },
        서술형: { count: 4.5, score: 31.5 },
      },
      evidenceCount: 0,
      confidence: 0.1,
    });
    expect(result.success).toBe(true);
  });

  it("blueprintSchema — 매핑 안 된 단원도 원문 표기로 남길 수 있다", () => {
    const result = blueprintSchema.safeParse({
      ...blueprint,
      unitMix: [
        { unitId: null, topicRaw: "미정계수법", count: 2, score: 7 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("[예측기 계약] L2~L4", () => {
  it("itemStatSchema — 학생 응답 전(IRT 미추정) 상태를 받는다", () => {
    const result = itemStatSchema.safeParse({
      externalExamId: "2643",
      questionNumber: 1,
      humanLabel: "하",
      solverProfiles: [
        {
          name: "weak",
          model: "claude-haiku-4-5-20251001",
          effort: "low",
          attempts: 5,
          correct: 2,
          meanSteps: 4.2,
        },
      ],
      irtA: null,
      irtB: null,
      respondentCount: 0,
      estimatedPCorrect: 0.44,
      basis: ["human", "solver"],
    });
    expect(result.success).toBe(true);
  });

  it("studentResponseSchema — 서술형 부분점수를 받는다", () => {
    const result = studentResponseSchema.safeParse({
      studentId: UUID_1,
      externalExamId: "2643",
      questionNumber: 22,
      correct: false,
      earnedScore: 3,
      elapsedSec: 240,
      respondedAt: NOW,
    });
    expect(result.success).toBe(true);
  });

  it("abilityEstimateSchema — 단원별 능력을 함께 받는다", () => {
    const result = abilityEstimateSchema.safeParse({
      studentId: UUID_1,
      theta: 0.8,
      se: 0.3,
      responseCount: 120,
      byUnit: [{ unitId: UUID_2, theta: -0.4, se: 0.6, responseCount: 12 }],
      estimatedAt: NOW,
    });
    expect(result.success).toBe(true);
  });

  it("scorePredictionSchema — 학생 개인 예측을 parse한다", () => {
    const result = scorePredictionSchema.safeParse({
      studentId: UUID_1,
      series,
      period: period(2025, 2, "중간"),
      expectedScore: 87,
      interval: { lower: 79, upper: 93, coverage: 0.8 },
      byUnit: [
        {
          unitId: UUID_2,
          topicRaw: null,
          availableScore: 20,
          expectedScore: 16.4,
        },
      ],
      riskFlags: ["적은_과거회차"],
    });
    expect(result.success).toBe(true);
  });

  it("scorePredictionSchema — studentId가 null이면 시험지 예상 평균 예측이다", () => {
    const result = scorePredictionSchema.safeParse({
      studentId: null,
      series,
      period: period(2025, 2, "중간"),
      expectedScore: 62.4,
      interval: { lower: 57, upper: 68, coverage: 0.8 },
      byUnit: [],
      riskFlags: [],
    });
    expect(result.success).toBe(true);
  });

  it("scorePredictionSchema — 알 수 없는 위험 플래그는 거부한다", () => {
    const result = scorePredictionSchema.safeParse({
      studentId: null,
      series,
      period: period(2025, 2, "중간"),
      expectedScore: 62.4,
      interval: { lower: 57, upper: 68, coverage: 0.8 },
      byUnit: [],
      riskFlags: ["대충_찍음"],
    });
    expect(result.success).toBe(false);
  });
});

describe("[예측기 계약] L5 보정 루프", () => {
  it("predictionRunSchema — 컷오프와 근거 시험지를 함께 기록한다", () => {
    const result = predictionRunSchema.safeParse({
      id: UUID_1,
      createdAt: NOW,
      engineVersion: "0.1.0",
      series,
      targetPeriod: period(2025, 2, "중간"),
      cutoffPeriod: period(2025, 1, "기말"),
      inputExamIds: ["2643", "2644"],
      params: { decay: 0.7, shrinkage: 4 },
      predictedBlueprint: { ...blueprint, kind: "predicted" },
      predictedScores: [],
    });
    expect(result.success).toBe(true);
  });

  it("predictionRunSchema — 컷오프 기록이 빠지면 거부한다", () => {
    // 컷오프가 없으면 그 예측이 미래 자료를 봤는지 검증할 수 없다.
    const result = predictionRunSchema.safeParse({
      id: UUID_1,
      createdAt: NOW,
      engineVersion: "0.1.0",
      series,
      targetPeriod: period(2025, 2, "중간"),
      inputExamIds: [],
      params: {},
      predictedBlueprint: null,
      predictedScores: [],
    });
    expect(result.success).toBe(false);
  });

  it("backtestMetricsSchema — 구간 적중률을 담는다", () => {
    const result = backtestMetricsSchema.safeParse({
      runId: UUID_1,
      engineVersion: "0.1.0",
      questionCountAbsError: 1,
      totalScoreAbsError: 0,
      difficultyMixDistance: 0.12,
      typeMixDistance: 0.04,
      unitMixDistance: 0.22,
      meanScoreAbsError: 4.1,
      studentScoreMae: null,
      intervalHitRate: null,
      predictedPaperHitRate: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("[예측기 계약] 시점 정렬", () => {
  it("같은 학기에서 중간이 기말보다 앞선다", () => {
    expect(
      comparePeriod(period(2025, 1, "중간"), period(2025, 1, "기말")),
    ).toBeLessThan(0);
  });

  it("1학기 기말이 2학기 중간보다 앞선다", () => {
    expect(
      comparePeriod(period(2025, 1, "기말"), period(2025, 2, "중간")),
    ).toBeLessThan(0);
  });

  it("연도가 우선한다", () => {
    expect(
      comparePeriod(period(2024, 2, "기말"), period(2025, 1, "중간")),
    ).toBeLessThan(0);
  });

  it("같은 시점은 0이다", () => {
    expect(
      comparePeriod(period(2025, 2, "중간"), period(2025, 2, "중간")),
    ).toBe(0);
  });

  it("정렬 키로 시리즈를 시간순으로 세운다", () => {
    const sorted = [
      period(2025, 2, "중간"),
      period(2024, 1, "중간"),
      period(2025, 1, "기말"),
      period(2024, 1, "기말"),
    ]
      .sort(comparePeriod)
      .map(periodSortKey);

    expect(sorted).toEqual([
      "2024-1-1",
      "2024-1-2",
      "2025-1-2",
      "2025-2-1",
    ]);
  });

  it("seriesKeyString — 학교·학교급학년·과목을 한 키로 묶는다", () => {
    expect(seriesKeyString(series)).toBe("정화중|중3|중3");
  });
});
