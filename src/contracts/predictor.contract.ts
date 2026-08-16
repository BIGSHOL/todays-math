/**
 * 기출 예상 점수 판독기 계약 — 설계 SSOT는 docs/planning/11-score-predictor.md.
 *
 * 이 파일은 예측기 전 계층(L0~L6)이 주고받는 자료 형태의 SSOT다.
 * 병렬 트랙(T1 적재 / T2 패턴엔진 / T3 AI솔버 / T4 학생능력 / T5 예측)이
 * 서로를 기다리지 않고 동시에 작업하려면 이 계약이 먼저 고정돼야 한다.
 *
 * 아직 API 엔드포인트는 없다 — 1차 산출물이 "엔진 + 리포트"이기 때문이다(11 §0).
 * 화면·API는 D-07 디자인 확정 후에 붙인다.
 *
 * 표기 원칙:
 * - 시험지 원문 표기(`topicRaw`, `subjectRaw`)는 **절대 버리지 않는다**. 학교마다 단원을
 *   부르는 이름이 다르고, 그 표기 자체가 출제 패턴 신호다(11 §5).
 * - 난이도는 두 축을 구분한다. `difficultyLabel`(상/중/하)은 시험지 원본의 사람 라벨이고,
 *   `Difficulty`(easy/mid/hard)는 우리 문제은행의 값이다. 섞지 않는다.
 */
import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "./common.contract";

// ─────────────────────────────────────────────
// L0. 시험지 정규화 — 기출 1편을 통째로 다루는 단위
// ─────────────────────────────────────────────

/** 학교급. exam_index `exams.level` 과 같은 표기. */
export const examLevelSchema = z.enum(["중", "고"], {
  error: "학교급은 중 또는 고여야 합니다.",
});
export type ExamLevel = z.infer<typeof examLevelSchema>;

/** 회차. exam_index `exams.round` 와 같은 표기. */
export const examRoundSchema = z.enum(["중간", "기말"], {
  error: "회차는 중간 또는 기말이어야 합니다.",
});
export type ExamRound = z.infer<typeof examRoundSchema>;

export const examSemesterSchema = z.union([z.literal(1), z.literal(2)], {
  error: "학기는 1 또는 2여야 합니다.",
});
export type ExamSemester = z.infer<typeof examSemesterSchema>;

/**
 * 시점 — 시리즈를 시간순으로 세우는 좌표.
 * 정렬 키는 `year → semester → (중간 < 기말)` 이다.
 */
export const examPeriodSchema = z.strictObject({
  year: z.int().min(2000).max(2100),
  semester: examSemesterSchema,
  round: examRoundSchema,
});
export type ExamPeriod = z.infer<typeof examPeriodSchema>;

/**
 * 시리즈 키 — 패턴 학습의 최소 단위.
 * "○○중 · 3학년 · 수학" 처럼 같은 학교·학년·과목의 회차들이 한 시리즈다.
 */
export const examSeriesKeySchema = z.strictObject({
  school: z.string().min(1).max(50),
  level: examLevelSchema,
  /** 중학교는 1~3, 고등학교는 1~3(과목으로 실제 구분한다). */
  grade: z.int().min(1).max(3),
  /** 우리 교육과정 트리 라벨(예: "중3", "공통수학1"). 원본 표기는 subjectRaw. */
  subject: z.string().min(1).max(50),
});
export type ExamSeriesKey = z.infer<typeof examSeriesKeySchema>;

/** 문항 유형. exam_index `questions.qtype` 과 같은 표기. */
export const questionTypeSchema = z.enum(["객관식", "단답형", "서술형"], {
  error: "문항 유형은 객관식/단답형/서술형 중 하나여야 합니다.",
});
export type QuestionType = z.infer<typeof questionTypeSchema>;

/** 시험지 원본의 사람 난이도 라벨. 우리 문제은행의 easy/mid/hard와 다른 축이다. */
export const difficultyLabelSchema = z.enum(["하", "중", "상"], {
  error: "난이도 라벨은 하/중/상 중 하나여야 합니다.",
});
export type DifficultyLabel = z.infer<typeof difficultyLabelSchema>;

export const examQuestionSchema = z.strictObject({
  /** 시험지 안에서의 문항 번호(1부터). 번호별 난이도 곡선의 x축이다. */
  number: z.int().min(1).max(60),
  /** 배점. 3.2·3.4 처럼 소수 배점이 흔하다 — 정수로 반올림하지 말 것. */
  score: z.number().positive().max(100),
  qtype: questionTypeSchema,
  /** 원본에 난이도 표기가 없는 문항이 14% 있다. */
  difficultyLabel: difficultyLabelSchema.nullable(),
  /** ⚠️ 시험지 원문 소단원 표기. 우리 트리로 매핑해도 이 값은 보존한다. */
  topicRaw: z.string().max(100).nullable(),
  /** 우리 교육과정 트리 단원. 매핑 실패 시 null(버리지 않는다). */
  unitId: uuidSchema.nullable(),
  answer: z.string().max(2_000).nullable(),
  /** 그림 참조 문항 여부 — 난이도·풀이 가능성에 영향이 크다. */
  hasFigure: z.boolean(),
  /** 문제은행 `Problem` 과 연결됐으면 그 id. */
  problemId: uuidSchema.nullable(),
});
export type ExamQuestion = z.infer<typeof examQuestionSchema>;

export const examPaperSchema = z.strictObject({
  /** exam_index `exams.id` 등 외부 인덱스 키. 재적재 멱등 키로 쓴다. */
  externalExamId: z.string().min(1).max(120),
  series: examSeriesKeySchema,
  period: examPeriodSchema,
  /** 시험지 원본의 과목 표기(예: "수상", "수학", "공수1"). */
  subjectRaw: z.string().max(50).nullable(),
  /** 배점 합. 보통 100이지만 실제로 어긋나는 시험지가 있어 검증 대상이다. */
  totalScore: z.number().positive().max(200),
  questions: z.array(examQuestionSchema).min(1).max(60),
  sourceFile: z.string().max(500).nullable(),
});
export type ExamPaper = z.infer<typeof examPaperSchema>;

// ─────────────────────────────────────────────
// 엔진 파라미터 — 엔진과 계약이 **한 정의**를 공유한다
//
// 예전에는 이 형태가 predictionRun.contract.ts 에 따로 복제돼 있었다. 엔진에
// stylePriorWeight 를 더한 순간(v0.5) 복제본이 뒤처져 저장 API 가 500 을 냈다.
// 스키마는 여기 한 곳에만 두고, 엔진은 자기 인터페이스가 이 스키마와 **정확히 같은지**
// 컴파일 시점에 확인한다(predictBlueprint.ts 맨 아래). 어긋나면 빌드가 깨진다 —
// 테스트를 돌려야 알던 것을 타입이 먼저 잡는다.
// ─────────────────────────────────────────────

export const predictorParamsSchema = z.strictObject({
  /** 회차당 가중 감쇠율. 1이면 감쇠 없음. */
  decay: z.number().min(0).max(1),
  /** 같은 학기·같은 회차 가중 배수. */
  sameRoundBoost: z.number().min(0).max(20),
  /** 총점 전용 코호트 사전값 가상 표본 수. */
  priorWeight: z.number().min(0).max(100),
  /** 문항 수·유형 배분 전용 축소 계수 — 학교 고유성이 확인된 항목이라 따로 뗐다. */
  stylePriorWeight: z.number().min(0).max(100),
  /** 배점 눈금 전용 축소·감쇠. */
  gridPriorWeight: z.number().min(0).max(100),
  gridDecay: z.number().min(0).max(1),
  /** 단원 배분에서 자기 학교 과거가 차지하는 비중(0~1). */
  unitOwnWeight: z.number().min(0).max(1),
});
export type PredictorParamsSnapshot = z.infer<typeof predictorParamsSchema>;

// 각 파라미터를 왜 그 값으로 골랐는지는 엔진 쪽 `PredictorParams` 주석에 있다
// (실측 근거가 붙어 있어 조정할 때 반드시 읽어야 한다).

// ─────────────────────────────────────────────
// L1. 시험 청사진 (Blueprint)
// 예측값과 실측값이 같은 형태를 쓴다 — 그래야 그대로 대조할 수 있다.
// ─────────────────────────────────────────────

export const blueprintKindSchema = z.enum(["predicted", "observed"], {
  error: "청사진 종류는 predicted 또는 observed여야 합니다.",
});
export type BlueprintKind = z.infer<typeof blueprintKindSchema>;

/** 문항 수와 배점 합을 함께 세는 칸. 문항 수만 맞고 배점이 어긋나는 예측을 잡기 위함. */
const cellSchema = z.strictObject({
  count: z.number().min(0),
  score: z.number().min(0),
});

export const blueprintSchema = z.strictObject({
  kind: blueprintKindSchema,
  series: examSeriesKeySchema,
  period: examPeriodSchema,

  questionCount: z.number().min(1).max(60),
  totalScore: z.number().positive().max(200),

  /** 유형 배분. 예측값은 소수(기댓값)일 수 있다. */
  typeMix: z.record(questionTypeSchema, cellSchema),
  /** 난이도 배분. 라벨이 없는 문항은 `미표기` 키로 모은다. */
  difficultyMix: z.record(z.enum(["하", "중", "상", "미표기"]), cellSchema),
  /** 그 학교가 실제로 쓰는 배점 눈금과 빈도(예: 3.2점 5문항). */
  scoreHistogram: z.array(
    z.strictObject({
      score: z.number().positive().max(100),
      count: z.number().min(0),
    }),
  ),
  /** 번호별 난이도 곡선 — 킬러문항 위치. difficulty는 0(하)~1(상) 연속값. */
  positionCurve: z.array(
    z.strictObject({
      number: z.int().min(1).max(60),
      difficulty: z.number().min(0).max(1),
      score: z.number().positive().max(100),
      qtype: questionTypeSchema.nullable(),
    }),
  ),
  /** 단원 배분. 매핑 안 된 원문 표기는 unitId=null + topicRaw 로 남긴다. */
  unitMix: z.array(
    z.strictObject({
      unitId: uuidSchema.nullable(),
      topicRaw: z.string().max(100).nullable(),
      count: z.number().min(0),
      score: z.number().min(0),
    }),
  ),

  /** 예상 평균(100점 환산). 실측 청사진에서는 실제 평균이 있으면 채운다. */
  expectedMean: z.number().min(0).max(100).nullable(),
  /** 예상 평균의 불확실 구간. */
  expectedMeanInterval: z
    .strictObject({
      lower: z.number().min(0).max(100),
      upper: z.number().min(0).max(100),
      coverage: z.number().min(0.5).max(0.99),
    })
    .nullable(),

  /**
   * 이 청사진이 몇 편의 과거 시험지에 근거하는가.
   * 0이면 전국 평균만으로 만든 것이라 신뢰도가 낮다(계층 축소, 11 §3 L1).
   */
  evidenceCount: z.int().min(0),
  /** 0~1. 낮으면 리포트에 경고를 띄운다. */
  confidence: z.number().min(0).max(1),
});
export type Blueprint = z.infer<typeof blueprintSchema>;

// ─────────────────────────────────────────────
// L2. 문항 난이도 계측
// ─────────────────────────────────────────────

/**
 * AI 솔버 1회 계측 조건.
 * 최신 모델은 내신 수학을 대부분 맞혀 그대로는 변별이 안 된다.
 * 그래서 **의도적으로 약한 조건**을 여러 단 두고 조건별 정답률 벡터를 만든다(11 §3 L2).
 */
export const solverProfileSchema = z.strictObject({
  /** 조건 이름(예: "strong", "mid", "weak"). 회귀 검증에서 특징 이름이 된다. */
  name: z.string().min(1).max(30),
  model: z.string().min(1).max(60),
  /** 추론 예산 등급. 낮출수록 인간 난이도와의 상관이 올라갈 것으로 본다(검증 대상). */
  effort: z.enum(["low", "medium", "high"]),
  attempts: z.int().min(1).max(20),
  correct: z.int().min(0).max(20),
  /** 평균 풀이 단계 수 — 정답률이 포화됐을 때의 보조 변별 신호. */
  meanSteps: z.number().min(0).nullable(),
});
export type SolverProfile = z.infer<typeof solverProfileSchema>;

export const itemStatSchema = z.strictObject({
  externalExamId: z.string().min(1).max(120),
  questionNumber: z.int().min(1).max(60),

  /** 시험지 원본의 사람 라벨. AI 솔버 검증의 정답지 역할을 한다(7,900건 보유). */
  humanLabel: difficultyLabelSchema.nullable(),
  solverProfiles: z.array(solverProfileSchema),

  /** 2PL IRT — 학생 응답이 쌓이면 채워진다. 그 전에는 null. */
  irtA: z.number().nullable(),
  irtB: z.number().nullable(),
  /** 응답 표본 수. 적으면 추정치를 그대로 믿지 않는다. */
  respondentCount: z.int().min(0),

  /** 최종 추정 정답률(모집단 기준). 위 신호들을 결합한 결과. */
  estimatedPCorrect: z.number().min(0).max(1).nullable(),
  /** 추정 근거 — "human" | "solver" | "response" | 결합. 리포트 설명용. */
  basis: z.array(z.enum(["human", "solver", "response"])),
});
export type ItemStat = z.infer<typeof itemStatSchema>;

// ─────────────────────────────────────────────
// L3. 학생 능력
// ─────────────────────────────────────────────

export const studentResponseSchema = z.strictObject({
  studentId: uuidSchema,
  externalExamId: z.string().min(1).max(120),
  questionNumber: z.int().min(1).max(60),
  /** 서술형 부분점수를 다루므로 정오와 획득점수를 함께 받는다. */
  correct: z.boolean(),
  earnedScore: z.number().min(0).max(100),
  elapsedSec: z.int().min(0).max(7_200).nullable(),
  respondedAt: isoDateTimeSchema,
});
export type StudentResponse = z.infer<typeof studentResponseSchema>;

export const abilityEstimateSchema = z.strictObject({
  studentId: uuidSchema,
  /** 전체 능력 θ. 표준정규 척도(0이 평균). */
  theta: z.number(),
  se: z.number().min(0),
  responseCount: z.int().min(0),
  /**
   * 단원별 θ. 전체 실력은 좋은데 특정 단원만 약한 학생이 흔하고,
   * 시험 범위가 그 단원에 몰리면 점수가 크게 흔들린다 — 예측 정확도의 핵심(11 §3 L3).
   */
  byUnit: z.array(
    z.strictObject({
      unitId: uuidSchema,
      theta: z.number(),
      se: z.number().min(0),
      responseCount: z.int().min(0),
    }),
  ),
  estimatedAt: isoDateTimeSchema,
});
export type AbilityEstimate = z.infer<typeof abilityEstimateSchema>;

// ─────────────────────────────────────────────
// L4. 점수 예측
// ─────────────────────────────────────────────

export const scoreIntervalSchema = z.strictObject({
  lower: z.number().min(0).max(100),
  upper: z.number().min(0).max(100),
  /** 이 구간이 담기로 한 확률(예: 0.8). 보정 평가는 실제 적중률을 이 값과 비교한다. */
  coverage: z.number().min(0.5).max(0.99),
});
export type ScoreInterval = z.infer<typeof scoreIntervalSchema>;

export const scorePredictionSchema = z.strictObject({
  /** null이면 학생 개인이 아니라 시험지 예상 평균 예측이다. */
  studentId: uuidSchema.nullable(),
  series: examSeriesKeySchema,
  period: examPeriodSchema,

  expectedScore: z.number().min(0).max(100),
  interval: scoreIntervalSchema,

  /** 단원별 기여 — 어디서 점수를 잃을 것으로 보는지. 리포트의 실질 내용이다. */
  byUnit: z.array(
    z.strictObject({
      unitId: uuidSchema.nullable(),
      topicRaw: z.string().max(100).nullable(),
      availableScore: z.number().min(0),
      expectedScore: z.number().min(0),
    }),
  ),

  /** 예측을 흔드는 요인을 명시한다 — 근거 없는 확신을 막는다. */
  riskFlags: z.array(
    z.enum([
      "적은_과거회차", // evidenceCount 부족
      "학생응답_부족", // θ 표본 부족
      "시험범위_미확정",
      "학교표기_불일치",
      "난이도라벨_결손",
    ]),
  ),
});
export type ScorePrediction = z.infer<typeof scorePredictionSchema>;

// ─────────────────────────────────────────────
// L5. 보정 루프
// ─────────────────────────────────────────────

/**
 * 예측 실행 스냅샷.
 *
 * **이 기록이 없으면 보정 자체가 불가능하다**(11 §3 L5-c).
 * 나중에 실제값이 들어오면 이 run에 붙여 잔차를 계산하고,
 * 엔진을 고칠 때마다 과거 run을 새 버전으로 재실행해 개선 여부를 비교한다.
 */
export const predictionRunSchema = z.strictObject({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  /** 엔진 버전. 이게 다르면 지표를 섞어서 비교하지 않는다. */
  engineVersion: z.string().min(1).max(40),

  series: examSeriesKeySchema,
  /** 예측 대상 시점. */
  targetPeriod: examPeriodSchema,
  /**
   * 입력 컷오프 — **이 시점 이후 자료는 어떤 경로로도 쓰지 않았다**는 선언.
   * backtest의 시간 분리(leakage 금지)를 코드로 강제하는 근거값이다.
   */
  cutoffPeriod: examPeriodSchema,

  /** 근거로 쓴 시험지 목록. 재현·감사에 필요하다. */
  inputExamIds: z.array(z.string().min(1).max(120)),
  /** 엔진 파라미터 스냅샷(감쇠율·축소 계수 등). 형태는 엔진 버전마다 다르다. */
  params: z.record(z.string(), z.unknown()),

  predictedBlueprint: blueprintSchema.nullable(),
  predictedScores: z.array(scorePredictionSchema),
});
export type PredictionRun = z.infer<typeof predictionRunSchema>;

/** 실제 시험 결과 — 보정 루프의 입력. */
export const actualOutcomeSchema = z.strictObject({
  series: examSeriesKeySchema,
  period: examPeriodSchema,
  observedBlueprint: blueprintSchema.nullable(),
  /** 학교가 공개하지 않으면 null. 학생 표본으로 역추정한다. */
  schoolMean: z.number().min(0).max(100).nullable(),
  schoolStdev: z.number().min(0).max(50).nullable(),
  studentScores: z.array(
    z.strictObject({
      studentId: uuidSchema,
      score: z.number().min(0).max(100),
    }),
  ),
});
export type ActualOutcome = z.infer<typeof actualOutcomeSchema>;

/**
 * backtest 지표.
 * 원장님 목표(±5점)를 무엇으로 측정할지 정하는 값이다 — 11 §4.
 */
export const backtestMetricsSchema = z.strictObject({
  runId: uuidSchema,
  engineVersion: z.string().min(1).max(40),

  /** 청사진 정확도 */
  questionCountAbsError: z.number().min(0),
  totalScoreAbsError: z.number().min(0),
  /** 분포 거리(0=완전 일치, 1=완전 불일치). 총변동거리. */
  difficultyMixDistance: z.number().min(0).max(1),
  typeMixDistance: z.number().min(0).max(1),
  unitMixDistance: z.number().min(0).max(1),

  /** 시험 난이도 정확도 — ±5 목표를 직접 재는 값. */
  meanScoreAbsError: z.number().min(0).max(100).nullable(),

  /** 개인 점수 정확도. 점추정 오차와 구간 적중률을 함께 본다. */
  studentScoreMae: z.number().min(0).max(100).nullable(),
  /** 80% 구간이면 실제로 0.8 근처가 나와야 한다(구간이 정직한지). */
  intervalHitRate: z.number().min(0).max(1).nullable(),

  /** 예측 문제지 적중률 — 실제 시험 문항과 유사한 문항을 몇 % 맞췄나. */
  predictedPaperHitRate: z.number().min(0).max(1).nullable(),
});
export type BacktestMetrics = z.infer<typeof backtestMetricsSchema>;

// ─────────────────────────────────────────────
// 유틸 — 시점 정렬 키
// ─────────────────────────────────────────────

/** 시점을 사전순 정렬 가능한 문자열로. 예: `2025-2-1`(2학기 중간). */
export function periodSortKey(period: ExamPeriod): string {
  const roundOrder = period.round === "중간" ? 1 : 2;
  return `${period.year}-${period.semester}-${roundOrder}`;
}

/** a가 b보다 앞선 시점이면 음수. 시리즈 정렬·컷오프 판정에 쓴다. */
export function comparePeriod(a: ExamPeriod, b: ExamPeriod): number {
  const ka = periodSortKey(a);
  const kb = periodSortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** 시리즈 키를 문자열로 — 집계·캐시 키. */
export function seriesKeyString(key: ExamSeriesKey): string {
  return `${key.school}|${key.level}${key.grade}|${key.subject}`;
}
