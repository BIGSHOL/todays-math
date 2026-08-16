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
 * ## `params` 에 무엇이 들어가나
 *
 * 엔진 파라미터 + 근거 집계 + 진단 문구다. **소유자(`userId`)와 위험 표시(`riskFlags`)는
 * 컬럼이다** — 한때 컬럼이 없어 이 JSON 에 실었지만 마이그레이션
 * `20260816160000_prediction_run_owner_and_interval` 로 자리를 찾았다.
 * 소유권 판정과 목록 필터는 이제 DB where 로 하고, 그래서 페이지네이션도 정확하다.
 */
import { z } from "zod";

import {
  dataResponseSchema,
  errorCodeSchema,
  isoDateSchema,
  isoDateTimeSchema,
  listResponseSchema,
  paginationParamsSchema,
  uuidSchema,
} from "./common.contract";
import {
  examLevelSchema,
  examPeriodSchema,
  examSeriesKeySchema,
  predictionRunSchema,
  predictorParamsSchema,
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
 * 엔진 파라미터 스냅샷 — **정의는 `predictor.contract.ts` 한 곳에만 있다.**
 *
 * 예전에는 여기에 같은 형태를 복제해 두고 "DEFAULT_PARAMS 가 통과하는지 테스트가
 * 매번 확인한다"는 표류 방지를 걸었다. 실제로 엔진이 `stylePriorWeight` 를 더했을 때
 * 그 테스트가 잡아냈지만, **잡힌 자리가 런타임(저장 API 500)이었다.**
 * 이제 정의가 하나뿐이라 표류 자체가 불가능하다. 여기서는 이름만 다시 내보낸다.
 */
export { predictorParamsSchema };
export type { PredictorParamsSnapshot } from "./predictor.contract";

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
  /**
   * 학원이 만든 '대비' 자료라 학습에서 뺀 편 수(`paperSource`).
   * 이 값이 크면 그 학교는 **실제 기출이 얇다**는 뜻이다 — 신뢰도를 그만큼 낮게 읽어야 한다.
   */
  excludedBySource: z.int().min(0),
  /** 요청이 근거를 직접 지정했는가(재실행 비교용 핀). */
  pinned: z.boolean(),
});
export type PredictionEvidenceStats = z.infer<
  typeof predictionEvidenceStatsSchema
>;

/**
 * DB `PredictionRun.params` 에 저장되는 형태 — **실행 스냅샷**이다.
 *
 * 소유자·위험 표시는 여기 없다(컬럼이다). 여기 남는 것은 "이 run 을 그대로 다시
 * 돌리려면 무엇이 필요한가"와 "왜 이런 결과가 나왔나" 뿐이다.
 */
export const predictionRunParamsSchema = z.strictObject({
  /** 엔진 파라미터 스냅샷 — 이게 없으면 과거 run 을 재현할 수 없다. */
  predictor: predictorParamsSchema,
  evidence: predictionEvidenceStatsSchema,
  /** 청사진을 못 만든 이유. 만들었으면 null. */
  unavailableReason: z.string().max(300).nullable(),
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
  /**
   * 이 시험의 실제 시행일(YYYY-MM-DD). 화면이 D-day 를 세는 기준이고 **엔진 입력이 아니다.**
   * 모르면 보내지 않는다 — NULL 로 저장한다. 대상 시점(`targetPeriod`)에서
   * 임의로 날짜를 만들어 채우지 않는다.
   */
  examDate: isoDateSchema.optional(),
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
  /** 실제 시행일. 원장이 아직 안 알려줬으면 null — 지어내지 않는다. */
  examDate: isoDateSchema.nullable(),
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
  /** 실제 시행일. 계기판이 D-day 를 세는 값. 모르면 null. */
  examDate: isoDateSchema.nullable(),
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
 * 목록 응답 — `{data, meta}`. 소유자가 컬럼이 된 뒤로 필터·건수를 DB 가 세므로
 * `total` 이 정확하다(메모리 필터 시절에는 붙일 수 없었다).
 */
export const predictionRunListResponseSchema = listResponseSchema(
  predictionRunSummarySchema,
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
  ...paginationParamsSchema.shape,
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
