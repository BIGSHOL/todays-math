/**
 * '오늘의 시험' 예측 실행(PredictionRun) API 계약 — T7.7.
 *
 * 대응 API 경로:
 *   POST /api/predictions        — 예측 실행 + 저장
 *   GET  /api/predictions        — 회차 목록(계기판)
 *   GET  /api/predictions/{id}   — 회차 상세
 *
 * ⚠️ `src/contracts/predictor.contract.ts` 는 **읽기 전용 SSOT** 다(트랙 E 지시).
 *    이 파일은 그 계약을 import 해서 API 표면(요청/응답)만 정의한다.
 *    엔진 자료형(Blueprint·ScorePrediction·PredictionRun)을 여기서 다시 정의하지 않는다.
 *
 * ## 왜 저장하는가
 *
 * 예측을 기록으로 남기지 않으면 **보정 자체가 불가능하다**(11 §3 L5-c).
 * 나중에 실제 내신 점수가 들어와도 무엇과 비교할지 알 수 없다.
 * 그래서 입력 스냅샷 · 엔진 버전 · 파라미터 · 출력을 통째로 남긴다.
 *
 * ## 🔴 스키마 공백 — `params` 에 임시로 싣는 두 값
 *
 * `prisma/schema.prisma` 의 `PredictionRun` 에는 **소유자 컬럼(`userId`)도,
 * 실행 단위 riskFlag 컬럼도 없다.** 트랙 E 지시상 스키마·마이그레이션을 건드릴 수 없어
 * (4개 세션 병렬 — 각자 마이그레이션을 내면 충돌한다), 아래 두 값을 `params` JSON 안에
 * 예약 키로 싣는다. `params` 는 계약상 `z.record(z.string(), z.unknown())` 이고
 * "형태는 엔진 버전마다 다르다"고 명시돼 있어 담을 수는 있지만, **본래 자리가 아니다.**
 *
 *   - `ownerUserId` — 이 run 을 실행한 사용자. 조회 소유권 판정의 유일한 근거다.
 *   - `riskFlags`   — 실행 단위 위험 표시(청사진이 NULL 인 이유 등).
 *
 * 컬럼이 생기면 `PREDICTION_RUN_PARAMS_STOPGAP_KEYS` 를 따라 기계적으로 옮기면 된다.
 * (REPORT.md 에 코디네이터 확인 항목으로 남겼다.)
 */
import { z } from "zod";

import {
  dataResponseSchema,
  errorCodeSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.contract";
import {
  examLevelSchema,
  examPeriodSchema,
  examSeriesKeySchema,
  predictionRunSchema,
  scorePredictionSchema,
} from "./predictor.contract";

// ─────────────────────────────────────────────
// 위험 표시 — predictor.contract 의 ScorePrediction.riskFlags 와 **같은 값**을 쓴다.
// 열거값을 다시 타이핑하지 않고 SSOT 에서 뽑아 쓴다(표류하면 컴파일 단계에서 드러난다).
// ─────────────────────────────────────────────

export const riskFlagSchema = scorePredictionSchema.shape.riskFlags.element;
export type RiskFlag = z.infer<typeof riskFlagSchema>;

/** 표시 순서 고정 — 화면·보고서에서 순서가 흔들리면 비교가 어렵다. */
export const RISK_FLAG_ORDER: readonly RiskFlag[] = [
  "적은_과거회차",
  "시험범위_미확정",
  "난이도라벨_결손",
  "학교표기_불일치",
  "학생응답_부족",
] as const;

// ─────────────────────────────────────────────
// 엔진 파라미터 스냅샷
// ─────────────────────────────────────────────

/**
 * `src/lib/predictor/predictBlueprint.ts` 의 `PredictorParams` 와 같은 형태다.
 * 계약(Zod)이 SSOT 라 lib 를 import 하지 않고 여기에 형태를 둔다 —
 * 대신 `DEFAULT_PARAMS` 가 이 스키마를 통과하는지 테스트가 매번 확인한다(표류 방지).
 */
export const predictorParamsSchema = z.strictObject({
  decay: z.number().min(0).max(1),
  sameRoundBoost: z.number().min(0).max(10),
  priorWeight: z.number().min(0).max(100),
  gridPriorWeight: z.number().min(0).max(100),
  gridDecay: z.number().min(0).max(1),
  unitOwnWeight: z.number().min(0).max(1),
});
export type PredictorParamsSnapshot = z.infer<typeof predictorParamsSchema>;

/** 근거를 어떻게 모았는지 — 감사·디버깅용 카운트. 문항 본문은 담지 않는다. */
export const predictionEvidenceStatsSchema = z.strictObject({
  /** 자기 학교 과거 회차 수(출제 스타일 단위 = 학교·급·학년). */
  history: z.int().min(0),
  /** 코호트(같은 급·학년·과목, 다른 학교) 편 수. */
  cohort: z.int().min(0),
  /** 단원 배분 전용 이력 — 시험 범위 단위(과목까지 같음). */
  rangeHistory: z.int().min(0),
  rangeCohort: z.int().min(0),
  /** 신뢰 가드(`paperTrust`)에서 빠진 편 수. 조용히 버리지 않고 센다. */
  excludedByTrust: z.int().min(0),
  /** 요청이 근거를 직접 지정했는가(재실행 비교용 핀). */
  pinned: z.boolean(),
});
export type PredictionEvidenceStats = z.infer<
  typeof predictionEvidenceStatsSchema
>;

/** 🔴 위 파일 머리말 참고 — 컬럼이 없어 `params` 에 임시로 싣는 예약 키. */
export const PREDICTION_RUN_PARAMS_STOPGAP_KEYS = [
  "ownerUserId",
  "riskFlags",
] as const;

/** DB `PredictionRun.params` 에 실제로 저장되는 형태(엔진 v0.2 기준). */
export const predictionRunParamsSchema = z.strictObject({
  /** 엔진 파라미터 스냅샷 — 이게 없으면 과거 run 을 재현할 수 없다. */
  predictor: predictorParamsSchema,
  evidence: predictionEvidenceStatsSchema,
  /** 청사진을 못 만든 이유. 만들었으면 null. */
  unavailableReason: z.string().max(300).nullable(),

  // ── 아래 둘은 컬럼이 없어서 여기 있다(임시). ──
  ownerUserId: uuidSchema,
  riskFlags: z.array(riskFlagSchema),
});
export type PredictionRunParams = z.infer<typeof predictionRunParamsSchema>;

// ─────────────────────────────────────────────
// POST /api/predictions — 요청
// ─────────────────────────────────────────────

export const createPredictionRunRequestSchema = z.strictObject({
  series: examSeriesKeySchema,
  /** 예측 대상 시점. */
  targetPeriod: examPeriodSchema,
  /**
   * 입력 컷오프 — 이 시점 **이전** 자료만 근거로 쓴다(같은 시점도 뺀다).
   * 생략하면 대상 시점과 같다. 대상 시점보다 뒤면 누출이므로 거부한다.
   */
  cutoffPeriod: examPeriodSchema.optional(),
  /**
   * 근거 시험지를 직접 지정한다(`Exam.externalExamId`).
   *
   * 왜 필요한가: "엔진을 고칠 때마다 과거 run 을 새 버전으로 재실행해 개선 여부를
   * 비교한다"(11 §3 L5-c). 같은 입력을 그대로 다시 먹여야 버전 비교가 성립한다.
   * 생략하면 컷오프 이전 자료를 DB 에서 자동으로 모은다.
   *
   * ⚠️ 지정한 편은 신뢰 가드(`paperTrust`)를 적용하지 않는다 — 과거 run 재현이 목적이라
   *    가드 기준이 바뀌어도 같은 입력이어야 한다. **누출 검사는 예외 없이 적용된다.**
   */
  inputExamIds: z.array(z.string().min(1).max(120)).min(1).max(500).optional(),
  /** 엔진 파라미터 부분 오버라이드. 생략하면 `DEFAULT_PARAMS`. */
  params: predictorParamsSchema.partial().optional(),
});
export type CreatePredictionRunRequest = z.infer<
  typeof createPredictionRunRequestSchema
>;

// ─────────────────────────────────────────────
// 응답 — 상세 / 목록
// ─────────────────────────────────────────────

/**
 * 회차 상세. `predictor.contract` 의 `predictionRunSchema` 를 그대로 쓰되
 *   - `params` 를 실제 저장 형태로 좁히고
 *   - 화면이 쓰기 쉬운 위치에 `riskFlags`·`unavailableReason` 을 끌어올린다.
 *
 * `predictedBlueprint` 는 nullable 그대로다 — 근거가 없으면 **0문항 0점짜리 청사진을
 * 지어내지 않는다.** 이 프로젝트가 실제로 낸 버그다(2026-08-16 재현).
 */
export const predictionRunDetailSchema = predictionRunSchema.extend({
  params: predictionRunParamsSchema,
  riskFlags: z.array(riskFlagSchema),
  unavailableReason: z.string().max(300).nullable(),
});
export type PredictionRunDetail = z.infer<typeof predictionRunDetailSchema>;

export const predictionRunDetailResponseSchema = dataResponseSchema(
  predictionRunDetailSchema,
);
export type PredictionRunDetailResponse = z.infer<
  typeof predictionRunDetailResponseSchema
>;

/** 계기판 목록 한 줄. 청사진이 없으면 `blueprint` 가 null 이다(0 으로 채우지 않는다). */
export const predictionRunSummarySchema = z.strictObject({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  engineVersion: z.string().min(1).max(40),
  series: examSeriesKeySchema,
  targetPeriod: examPeriodSchema,
  cutoffPeriod: examPeriodSchema,
  /** 근거로 쓴 시험지 편 수 = `inputExamIds.length`. */
  evidenceCount: z.int().min(0),
  riskFlags: z.array(riskFlagSchema),
  blueprint: z
    .strictObject({
      questionCount: z.number().min(1).max(60),
      totalScore: z.number().positive().max(200),
      confidence: z.number().min(0).max(1),
    })
    .nullable(),
});
export type PredictionRunSummary = z.infer<typeof predictionRunSummarySchema>;

/**
 * 목록 응답. 페이지네이션 meta 가 없다 —
 * 한 학교·학년 시리즈의 회차는 학기당 2편 수준이라 수십 행을 넘지 않는다.
 * `PredictionRun` 에 소유자 컬럼이 생겨 DB 단에서 필터링할 수 있게 되면 그때 붙인다
 * (지금은 소유자 필터가 조회 후 메모리에서 일어나 page/total 이 정확할 수 없다).
 */
export const predictionRunListResponseSchema = dataResponseSchema(
  z.array(predictionRunSummarySchema),
);
export type PredictionRunListResponse = z.infer<
  typeof predictionRunListResponseSchema
>;

/** GET /api/predictions 질의 — 계기판은 항상 한 학교·학년을 본다. */
export const predictionRunListQuerySchema = z.strictObject({
  school: z.string().min(1).max(50),
  grade: z.coerce.number().int().min(1).max(3),
  level: examLevelSchema.optional(),
  subject: z.string().min(1).max(50).optional(),
});
export type PredictionRunListQuery = z.infer<
  typeof predictionRunListQuerySchema
>;

// ─────────────────────────────────────────────
// 누출 차단 에러 (422)
// ─────────────────────────────────────────────

/**
 * 왜 422 인가: 요청 자체는 형식이 맞다(400 아님). 다만 **그 입력으로는 예측을 만들 수 없다** —
 * 컷오프 이후 자료가 근거에 섞이면 backtest 숫자만 좋아 보이고 실전에서 무너진다(11 §3 L5-a).
 * 저장은 거부되고 `PredictionRun` 행은 하나도 생기지 않는다.
 */
export const predictionLeakageReasonSchema = z.enum([
  /** 근거 시험지의 시점이 컷오프와 같거나 그 이후다. */
  "근거_컷오프_이후",
  /** 컷오프가 대상 시점보다 뒤다 — 정답지를 근거에 넣을 수 있는 설정이다. */
  "컷오프_대상시점_역전",
]);
export type PredictionLeakageReason = z.infer<
  typeof predictionLeakageReasonSchema
>;

export const predictionLeakageDetailSchema = z.strictObject({
  reason: predictionLeakageReasonSchema,
  cutoffPeriod: examPeriodSchema,
  targetPeriod: examPeriodSchema,
  /** 문제가 된 시험지. 감사에 쓰이므로 시점까지 남긴다. */
  offending: z.array(
    z.strictObject({
      externalExamId: z.string().min(1).max(120),
      period: examPeriodSchema,
    }),
  ),
});
export type PredictionLeakageDetail = z.infer<
  typeof predictionLeakageDetailSchema
>;

export const predictionLeakageErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema.extract(["VALIDATION_ERROR"]),
    message: z.string().min(1),
    details: predictionLeakageDetailSchema,
  }),
});
export type PredictionLeakageErrorResponse = z.infer<
  typeof predictionLeakageErrorResponseSchema
>;
