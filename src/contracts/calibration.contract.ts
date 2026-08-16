/**
 * 보정 루프 계약 — T7.10(실측 저장) · T7.11(환산 계수 추정).
 *
 * 대응 API 경로: `POST|GET /api/predictions/{id}/actual`
 * 설계 SSOT: docs/planning/11-score-predictor.md §3 L5(보정 루프), §2.3(잡음 바닥),
 *            §2.7-3(환산 계수가 병목이다)
 *
 * ⚠️ `src/contracts/predictor.contract.ts` 는 읽기 전용 SSOT다(트랙 E 규칙).
 *    이 파일은 그 계약과 형태를 맞추되, 새로 필요한 것만 여기에 정의한다.
 *
 * 정책:
 * - API 요청/응답 object 는 common.contract.ts 와 같이 `z.strictObject()` 로 정의한다.
 * - 단 하나의 예외가 아래 `predictedScoreSnapshotSchema` 다 — 그건 **DB Json 컬럼을 읽는**
 *   스키마라 엔진 버전이 올라가며 필드가 늘어도 과거 run 을 계속 읽어야 한다.
 *   이유는 그 자리에 적었다.
 */
import { z } from "zod";

import {
  dataResponseSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.contract";

// ─────────────────────────────────────────────
// T7.10 — 실측 점수 저장
// ─────────────────────────────────────────────

/**
 * `PredictionRun.predictedScores`(Json) 를 읽을 때 쓰는 **최소 스키마**.
 *
 * ⚠️ 여기만 strictObject 가 아니다. 이 Json 은 `scorePredictionSchema` 로 저장되지만
 *    엔진 버전이 올라가며 필드가 늘어날 수 있다. strict 로 읽으면 **과거 run 이 어느 날
 *    통째로 읽히지 않게 된다** — 보정 근거를 잃는 일이라 실측 저장이 막히면 안 된다.
 *    그래서 잔차 계산에 반드시 필요한 세 값만 요구하고 나머지는 흘려보낸다.
 *
 * 이 값들은 저장 시점에 `ActualExamScore.predictedScore` 로 **복사(스냅샷)** 된다.
 * 이후 집계는 Json 을 다시 파싱하지 않는다 — Json 모양이 바뀌어도 과거 보정 근거가
 * 흔들리지 않도록.
 */
export const predictedScoreSnapshotSchema = z.object({
  /** null 이면 학생 개인이 아니라 시험지 평균 예측이다 — 실측 대조 대상이 아니다. */
  studentId: uuidSchema.nullable(),
  expectedScore: z.number().min(0).max(100),
  /**
   * 예측 시점에 구간이 없을 수 있다(엔진이 구간을 못 낸 경우). 그러면 null 이고,
   * 적중 여부를 **지어내지 않는다** — 저장은 하되 적중률 분모에서 뺀다.
   */
  interval: z
    .object({
      lower: z.number().min(0).max(100),
      upper: z.number().min(0).max(100),
      coverage: z.number().min(0.5).max(0.99),
    })
    .nullish(),
});
export type PredictedScoreSnapshot = z.infer<
  typeof predictedScoreSnapshotSchema
>;

export const actualScoreEntrySchema = z.strictObject({
  studentId: uuidSchema,
  /** 100점 환산 내신 점수. 원본 만점이 다르면 호출 전에 환산해서 넣는다. */
  actualScore: z.number().min(0).max(100),
});
export type ActualScoreEntry = z.infer<typeof actualScoreEntrySchema>;

/**
 * 실측 입력. 같은 run · 같은 학생을 두 번 보내면 **갱신**이다(중복 행이 아니다) —
 * 원장이 점수를 잘못 입력했을 때 고칠 수 있어야 한다(`@@unique([runId, studentId])`).
 */
export const actualScoreUpsertRequestSchema = z
  .strictObject({
    scores: z.array(actualScoreEntrySchema).min(1).max(200),
    /** 학교가 평균을 공개하면 채운다. 안 하면 보내지 않는다(학생 표본으로 역추정). */
    schoolMean: z.number().min(0).max(100).nullable().optional(),
    schoolStdev: z.number().min(0).max(50).nullable().optional(),
  })
  // 한 요청 안에 같은 학생이 두 번 들어오면 어느 쪽이 원장의 의도인지 알 수 없다.
  // 조용히 뒤엣것으로 덮지 않고 되돌려 보낸다.
  .refine(
    (value) =>
      new Set(value.scores.map((entry) => entry.studentId)).size ===
      value.scores.length,
    { error: "같은 학생이 두 번 들어 있습니다.", path: ["scores"] },
  );
export type ActualScoreUpsertRequest = z.infer<
  typeof actualScoreUpsertRequestSchema
>;

export const actualScoreRecordSchema = z.strictObject({
  id: uuidSchema,
  runId: uuidSchema,
  studentId: uuidSchema,
  actualScore: z.number(),
  /**
   * 예측 당시 값의 스냅샷. run 의 Json 을 다시 파싱하지 않기 위한 값이다.
   *
   * **예측이 없었으면 null 이다.** 학생 능력 엔진(11 §3 L3)이 아직 없어 현재 모든 회차의
   * `predictedScores` 가 비어 있는데, 그렇다고 실점수를 못 받으면 보정 루프의 입력이
   * 영영 쌓이지 않는다(11 §4 — 환산 계수는 학생 데이터를 **먼저** 모아야 구한다).
   * 그래서 실점수는 받되 잔차는 **지어내지 않고 비운다.**
   */
  predictedScore: z.number().nullable(),
  /** actual − predicted. 보정 계수(T7.11)의 직접 입력. 예측이 없으면 null. */
  residual: z.number().nullable(),
  /**
   * 예측 **구간**이 실제를 담았는가. 점 예측 MAE 와 별개 지표다.
   * 아래 구간 스냅샷이 null 이면 이 값은 **판정 불가**라는 뜻이고, 적중률 분모에서 뺀다.
   */
  intervalHit: z.boolean(),
  /**
   * 예측 구간의 스냅샷. `predictedScore` 와 같은 규칙 — 처음 저장할 때 복사하고
   * 재저장(점수 정정) 때는 덮어쓰지 않는다. `intervalHit` 은 **이 값**으로 다시 센다.
   */
  predictedLower: z.number().nullable(),
  predictedUpper: z.number().nullable(),
  predictedCoverage: z.number().nullable(),
  recordedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ActualScoreRecord = z.infer<typeof actualScoreRecordSchema>;

/** 한 회차의 잔차 요약. 표본이 0이면 숫자를 지어내지 않고 null 이다. */
export const residualSummarySchema = z.strictObject({
  /** 저장된 실측 행 수 전체. 잔차를 낼 수 없는 행도 여기엔 들어간다. */
  count: z.int().min(0),
  /**
   * 예측 스냅샷이 있어 잔차를 **계산할 수 있는** 표본 수. `count` 와 다를 수 있다.
   * MAE·평균 잔차의 분모는 이 값이다.
   *
   * 🔴 예측이 없던 행을 잔차 0 으로 세면 MAE 가 통째로 희석된다. 이 저장소는 이미
   *    "라벨 없는 문항을 한 칸으로 세어" 지표를 오염시킨 적이 있다 — 같은 사고를 막는
   *    분모다. 아래 `intervalCount` 와 같은 규칙이다.
   */
  residualCount: z.int().min(0),
  mae: z.number().min(0).nullable(),
  meanResidual: z.number().nullable(),
  /**
   * 구간 스냅샷이 있어 적중을 **판정할 수 있는** 표본 수. `count` 와 다를 수 있다.
   * 적중률의 분모는 이 값이다 — 모르는 것을 빗나감으로 세지 않는다.
   */
  intervalCount: z.int().min(0),
  intervalHitRate: z.number().min(0).max(1).nullable(),
});
export type ResidualSummary = z.infer<typeof residualSummarySchema>;

export const actualScoreResponseSchema = dataResponseSchema(
  z.strictObject({
    runId: uuidSchema,
    scores: z.array(actualScoreRecordSchema),
    summary: residualSummarySchema,
  }),
);
export type ActualScoreResponse = z.infer<typeof actualScoreResponseSchema>;

// ─────────────────────────────────────────────
// T7.11 — 환산 계수 추정
// ─────────────────────────────────────────────

/** 계수 추정의 입력 한 건 = 실측이 붙은 예측 하나. */
export const calibrationSampleSchema = z.strictObject({
  runId: uuidSchema,
  studentId: uuidSchema,
  /** 엔진 버전이 다르면 지표를 섞어서 비교하지 않는다(predictor.contract.ts 주석). */
  engineVersion: z.string().min(1).max(40),
  school: z.string().min(1).max(50),
  predicted: z.number(),
  actual: z.number(),
  residual: z.number(),
  intervalHit: z.boolean(),
  /**
   * 구간 스냅샷이 있어 적중을 판정할 수 있는 표본인가.
   * false 면 `intervalHit` 은 의미가 없고 적중률 분모에서 빠진다.
   */
  hasInterval: z.boolean(),
});
export type CalibrationSample = z.infer<typeof calibrationSampleSchema>;

/** 판단 불가 사유. **점수를 지어내는 대신** 이 값을 돌려준다. */
export const calibrationUnavailableReasonSchema = z.enum([
  "표본_부족",
  "엔진버전_혼재",
]);
export type CalibrationUnavailableReason = z.infer<
  typeof calibrationUnavailableReasonSchema
>;

export const calibrationUnavailableSchema = z.strictObject({
  judgementUnavailable: z.literal(true),
  reason: calibrationUnavailableReasonSchema,
  sampleCount: z.int().min(0),
  requiredSampleCount: z.int().min(1),
  message: z.string().min(1).max(200),
});
export type CalibrationUnavailable = z.infer<
  typeof calibrationUnavailableSchema
>;

/**
 * 보정 단계. **합산 목적함수 하나로 고르지 않는다** — 단계별로 홀드아웃(LOO) MAE 를 보고
 * 좋아진 단계만 채택한다(트랙 E 지난 회차 교훈).
 */
export const calibrationStageNameSchema = z.enum([
  "전체_오프셋",
  "전체_기울기",
  "학교_오프셋",
]);
export type CalibrationStageName = z.infer<typeof calibrationStageNameSchema>;

export const calibrationStageSchema = z.strictObject({
  name: calibrationStageNameSchema,
  apply: z.boolean(),
  /** 이 단계 **이전까지 채택된** 보정의 LOO MAE. */
  maeBefore: z.number().min(0),
  /** 이 단계를 얹었을 때의 LOO MAE. */
  maeAfter: z.number().min(0),
  note: z.string().max(300),
});
export type CalibrationStage = z.infer<typeof calibrationStageSchema>;

/** 학교별 계수. 표본이 적으면 전체 평균 쪽으로 당긴다(계층 축소). */
export const schoolCoefficientSchema = z.strictObject({
  school: z.string().min(1).max(50),
  sampleCount: z.int().min(1),
  /** 축소 전 그 학교 잔차 평균 — 그대로 쓰면 안 되는 값이다. */
  rawOffset: z.number(),
  /** 축소 후 실제로 적용할 값. 0 이면 학교 고유 보정 없음(= 전체 수준 그대로). */
  shrunkOffset: z.number(),
  /** 0 이면 전체 평균 100%, 1 이면 학교 고유값 100%. 표본이 적을수록 0 에 가깝다. */
  shrinkageWeight: z.number().min(0).max(1),
  maeBefore: z.number().min(0),
  maeAfter: z.number().min(0),
  /** 이 학교에서 홀드아웃 MAE 가 나빠지면 false — 학교 단위로 쪼개서 채택한다. */
  apply: z.boolean(),
});
export type SchoolCoefficient = z.infer<typeof schoolCoefficientSchema>;

/** 잔차가 한쪽으로 쏠려 있는가. 쏠려 있으면 명시적으로 표시한다. */
export const biasReportSchema = z.strictObject({
  detected: z.boolean(),
  meanResidual: z.number(),
  standardError: z.number().min(0),
  /** meanResidual / standardError. |t| > 2 를 편향으로 본다. */
  tStatistic: z.number(),
  /** 잔차(actual − predicted)가 +쪽이면 엔진이 낮게 불렀다는 뜻이다. */
  direction: z.enum(["과소예측", "과대예측"]).nullable(),
});
export type BiasReport = z.infer<typeof biasReportSchema>;

/** 다음 예측에 실제로 곱하고 더할 값. `applyCalibration()` 의 입력이다. */
export const calibrationCoefficientsSchema = z.strictObject({
  engineVersion: z.string().min(1).max(40),
  /** corrected = slope × predicted + offset + schoolOffsets[school] */
  offset: z.number(),
  slope: z.number(),
  schoolOffsets: z.record(z.string(), z.number()),
});
export type CalibrationCoefficients = z.infer<
  typeof calibrationCoefficientsSchema
>;

export const calibrationResultSchema = z.strictObject({
  judgementUnavailable: z.literal(false),
  engineVersion: z.string().min(1).max(40),
  sampleCount: z.int().min(1),
  schoolCount: z.int().min(1),

  coefficients: calibrationCoefficientsSchema,
  stages: z.array(calibrationStageSchema),
  schools: z.array(schoolCoefficientSchema),
  bias: biasReportSchema,

  /** 보정 전 MAE. */
  maeBefore: z.number().min(0),
  /** 채택된 보정만 적용한 뒤의 **홀드아웃(LOO)** MAE. */
  maeAfter: z.number().min(0),
  /** false 면 보정을 적용하지 않는 쪽이 옳다. */
  improved: z.boolean(),

  /** 구간 적중을 판정할 수 있었던 표본 수. 적중률의 분모다. */
  intervalSampleCount: z.int().min(0),
  /** 구간 적중률 — 점 예측 MAE 와 별개 지표다. 판정 가능한 표본이 없으면 null. */
  intervalHitRate: z.number().min(0).max(1).nullable(),
  /** 엔진이 선언한 구간 신뢰수준. 호출자가 알려주지 않으면 null 이다. */
  nominalCoverage: z.number().min(0.5).max(0.99).nullable(),
  /** 적중률이 선언한 신뢰수준 근처인가. nominalCoverage 가 없으면 null(판단 안 함). */
  intervalHonest: z.boolean().nullable(),
});
export type CalibrationResult = z.infer<typeof calibrationResultSchema>;

export const calibrationOutcomeSchema = z.discriminatedUnion(
  "judgementUnavailable",
  [calibrationUnavailableSchema, calibrationResultSchema],
);
export type CalibrationOutcome = z.infer<typeof calibrationOutcomeSchema>;
