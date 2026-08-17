/**
 * 배점 보정기 계약 — 설계 SSOT는 docs/planning/11-score-predictor.md §10 (원장님 지시 D-42).
 *
 * > 비슷한 문제를 짜깁기해 한 장의 시험지를 만들 경우, **점수 보정기**로 문항별 배점을
 * > 세밀하게 조정하고 **합계 100점** 처리해야 한다.
 *
 * ## 왜 이 계약이 따로 있나
 *
 * `predictor.contract.ts` 는 읽기 전용 SSOT다(트랙 E 지시). 배점 보정기와 예측 문제지가
 * 새로 필요로 하는 자료 형태는 전부 이 파일에 모은다. 예측 문제지 스키마도 여기 있는 이유는
 * 배점 보정 결과를 그대로 싣는 그릇이라 같은 파일에 두는 편이 어긋날 여지가 적기 때문이다.
 *
 * ## 두 개의 배점을 절대 섞지 않는다 (11 §10.2-4)
 *
 * - `originalScore` / `PaperCandidate.score` = `Problem.score`, **원본 기출 배점**. 읽기만 한다.
 *   덮어쓰면 학습 코퍼스가 오염된다.
 * - `score` = 보정기가 매긴 **조정 배점**. `TestProblem.score` 에만 싣는다.
 *
 * ## 판단 불가를 값으로 만든다
 *
 * 눈금 집합(그 학교가 실제로 쓰는 배점)이 없으면 3.7점 같은 값을 **지어내지 않고**
 * `judgementUnavailable` 을 돌려준다. 이 프로젝트는 0문항 0점 청사진을 낸 적이 있다.
 */
import { z } from "zod";

import {
  difficultySchema,
  isoDateSchema,
  problemSourceSchema,
  uuidSchema,
} from "./common.contract";
import {
  difficultyLabelSchema,
  examPeriodSchema,
  examSeriesKeySchema,
  questionTypeSchema,
} from "./predictor.contract";

// ─────────────────────────────────────────────
// 공통 — 판단 불가
// ─────────────────────────────────────────────

export const judgementUnavailableReasonSchema = z.enum(
  [
    /** 청사진 `scoreHistogram` 이 비어 있다 — 그 학교 이력이 없다. */
    "눈금_없음",
    /** 보정할 문항이 하나도 없다. */
    "문항_없음",
    /** 눈금이 0.01 단위로 떨어지지 않는다(예: 3.333). 정수 연산으로 정확히 다룰 수 없다. */
    "눈금_해상도_초과",
    /** 그 눈금 집합과 그 문항 수로는 합계 100 을 만들 수 없다. */
    "합계_100_불가",
    /** 문제은행에 쓸 수 있는 후보가 없다. */
    "후보_없음",
    /** 청사진이 시험지를 만들기에 결손이다(문항 수 0 등). */
    "청사진_결손",
  ],
  { error: "판단 불가 사유 값이 올바르지 않습니다." },
);
export type JudgementUnavailableReason = z.infer<
  typeof judgementUnavailableReasonSchema
>;

/** 근거가 없으면 값을 만들지 않는다 — 이 형태로 돌려준다. */
export const judgementUnavailableSchema = z.strictObject({
  ok: z.literal(false),
  judgement: z.literal("판단 불가"),
  reason: judgementUnavailableReasonSchema,
  /** 원장 화면에 그대로 띄울 수 있는 한 줄. D-08 톤(간결·사무적). */
  detail: z.string().min(1).max(300),
});
export type JudgementUnavailable = z.infer<typeof judgementUnavailableSchema>;

// ─────────────────────────────────────────────
// 배점 눈금
// ─────────────────────────────────────────────

/**
 * 그 학교가 실제로 쓰는 배점 값 집합. 청사진 `scoreHistogram` 에서 뽑는다.
 * 배점 눈금은 학교 고유성 43.3% 로 강한 신호다(11 §2.2) — 임의의 값을 섞지 않는다.
 */
export const scoreGridSchema = z.array(z.number().positive().max(100));
export type ScoreGrid = z.infer<typeof scoreGridSchema>;

// ─────────────────────────────────────────────
// 배점 보정기 입출력
// ─────────────────────────────────────────────

/** 보정 대상 문항 — 배점을 정하는 데 필요한 것만 받는다. */
export const normalizerQuestionSchema = z.strictObject({
  /** 시험지 안에서의 문항 번호(1부터). 동점 tie-break 축이다. */
  number: z.int().min(1).max(60),
  qtype: questionTypeSchema,
  /** 라벨이 없는 문항이 14% 있다. 없으면 중간으로 **순위만** 매기고 값을 지어내지 않는다. */
  difficultyLabel: difficultyLabelSchema.nullable(),
  /**
   * 원본 배점(`Problem.score`). 기출이면 값이 있고 자작·AI 는 null 이다.
   * 보정기는 이 값을 **읽지도 쓰지도 않는다** — 보존용 사본으로만 들고 다닌다.
   */
  originalScore: z.number().positive().max(100).nullable(),
});
export type NormalizerQuestion = z.infer<typeof normalizerQuestionSchema>;

export const normalizedQuestionSchema = normalizerQuestionSchema.extend({
  /** 조정 배점. 반드시 눈금 집합 안의 값이다. `TestProblem.score` 에 싣는다. */
  score: z.number().positive().max(100),
});
export type NormalizedQuestion = z.infer<typeof normalizedQuestionSchema>;

export const scoreNormalizationSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    questions: z.array(normalizedQuestionSchema).min(1).max(60),
    /** 정확히 100. 정수(0.01점 단위)로 계산하므로 부동소수 잔차가 남지 않는다. */
    totalScore: z.literal(100),
    /** 실제로 쓴 눈금 집합(오름차순). */
    grid: scoreGridSchema,
  }),
  judgementUnavailableSchema,
]);
export type ScoreNormalization = z.infer<typeof scoreNormalizationSchema>;

// ─────────────────────────────────────────────
// 원장 수동 조정 (11 §10.4)
// ─────────────────────────────────────────────

export const manualScoreIssueSchema = z.enum(
  ["합계_불일치", "배점_형식오류", "문항번호_중복"],
  {
    error: "수동 조정 오류 값이 올바르지 않습니다.",
  },
);
export type ManualScoreIssue = z.infer<typeof manualScoreIssueSchema>;

export const manualScoreCheckSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    total: z.literal(100),
    /** 눈금 집합 밖의 배점을 쓴 문항 번호. 저장을 막지는 않고 알리기만 한다. */
    offGrid: z.array(z.int().min(1).max(60)),
  }),
  z.strictObject({
    ok: z.literal(false),
    issue: manualScoreIssueSchema,
    total: z.number(),
    /** 100 − 합계. 양수면 남은 점수, 음수면 초과분. */
    remaining: z.number(),
    /** 예: `합계 98.5 — 1.5점 남음`. 자동으로 다른 문항을 건드리지 않는다. */
    message: z.string().min(1).max(200),
    offGrid: z.array(z.int().min(1).max(60)),
  }),
]);
export type ManualScoreCheck = z.infer<typeof manualScoreCheckSchema>;

// ─────────────────────────────────────────────
// 예측 문제지 (11 §3 L6)
// ─────────────────────────────────────────────

/**
 * 문제은행 후보 — `Problem` row 의 부분집합. **전부 읽기 전용이다.**
 * `answer` `figureUrls` `figureSource` 는 다른 트랙 소유라 아예 받지 않는다.
 */
export const paperCandidateSchema = z.strictObject({
  problemId: uuidSchema,
  unitId: uuidSchema,
  /** 문제은행 축(easy/mid/하 아님). 청사진의 하/중/상과 다른 축이다 — §L6 배정에서만 다리를 놓는다. */
  difficulty: difficultySchema,
  /** `Problem.questionType`. T7.6 백필 전이면 null 이라 유형 일치를 확인할 수 없다. */
  questionType: questionTypeSchema.nullable(),
  source: problemSourceSchema,
  /** 원본 기출 배점(`Problem.score`). **읽기만 한다.** */
  score: z.number().positive().max(100).nullable(),
});
export type PaperCandidate = z.infer<typeof paperCandidateSchema>;

/** 청사진 칸을 그대로 못 채웠을 때 어디를 풀었는지. 빈 배열이면 정확히 맞은 칸이다. */
export const paperRelaxationSchema = z.enum(["단원", "난이도", "유형"], {
  error: "완화 축 값이 올바르지 않습니다.",
});
export type PaperRelaxation = z.infer<typeof paperRelaxationSchema>;

export const predictedPaperQuestionSchema = z.strictObject({
  /** 지면상의 문항 번호(1부터). */
  orderIndex: z.int().min(1).max(60),
  problemId: uuidSchema,
  unitId: uuidSchema,
  difficulty: difficultySchema,
  qtype: questionTypeSchema,
  /** 원본 기출 배점 사본. 보정에 쓰지 않는다 — 대조용이다. */
  originalScore: z.number().positive().max(100).nullable(),
  /** 배점 보정기가 매긴 조정 배점. `TestProblem.score` 에 싣는다. */
  score: z.number().positive().max(100),
  relaxed: z.array(paperRelaxationSchema),
  /** 그 학교가 과거에 실제로 냈던 문항인가(11 §3 L6 우선순위 ①). */
  schoolReuse: z.boolean(),
});
export type PredictedPaperQuestion = z.infer<
  typeof predictedPaperQuestionSchema
>;

export const unfilledSlotSchema = z.strictObject({
  /** 청사진에서 이 칸이 몇 번째였나. 완성된 시험지의 문항 번호와 다르다. */
  slotIndex: z.int().min(1).max(60),
  unitId: uuidSchema.nullable(),
  difficulty: difficultySchema.nullable(),
  qtype: questionTypeSchema,
  /** 왜 못 채웠나. 빈 칸을 아무 문항으로 메우지 않고 그대로 보고한다. */
  detail: z.string().min(1).max(200),
});
export type UnfilledSlot = z.infer<typeof unfilledSlotSchema>;

export const predictedPaperSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    series: examSeriesKeySchema,
    period: examPeriodSchema,
    questions: z.array(predictedPaperQuestionSchema).min(1).max(60),
    /** 정확히 100 (D-42). */
    totalScore: z.literal(100),
    grid: scoreGridSchema,
    /** 채우지 못한 칸. 비어 있어야 청사진대로 나온 시험지다. */
    unfilled: z.array(unfilledSlotSchema),
    /** 재료로 쓴 과거 시험지 중 신뢰 가드(11 §11)를 통과한 편수. */
    referenceUsed: z.int().min(0),
    /** 만점 100 가드에 걸려 재료에서 뺀 편수. */
    referenceExcluded: z.int().min(0),
  }),
  judgementUnavailableSchema,
]);
export type PredictedPaper = z.infer<typeof predictedPaperSchema>;

// ─────────────────────────────────────────────
// API 계약
//
// 대응 경로: POST /api/tests/predicted · PATCH /api/tests/{id}/scores
//
// ⚠️ 이 스키마들을 `test.contract.ts`(일일/확인테스트 계약)가 아니라 여기에 둔 이유:
//    4개 세션이 병렬이라 공용 계약 파일을 동시에 고치면 병합이 충돌한다. 예측 문제지와
//    배점 조정은 트랙 E 전용 경로이므로 트랙 E 계약 파일에 모은다. 합치는 편이 낫다고
//    판단되면 코디네이터가 옮기면 된다 — REPORT.md 에 적었다.
// ─────────────────────────────────────────────

/** POST /api/tests/predicted — 예측 문제지 생성 + 적재. */
export const predictedPaperCreateRequestSchema = z.strictObject({
  /**
   * '오늘의 시험' 회차에서 만드는 문제지면 그 회차 id (15 §B).
   * 생략하면 단독 생성 — 회차와 연결되지 않아 계기판 파이프라인에 잡히지 않는다.
   */
  predictionRunId: uuidSchema.optional(),
  classId: uuidSchema,
  /** NULL 이면 반 전체 대상. */
  studentId: uuidSchema.nullable().optional(),
  testDate: isoDateSchema,
  rangeStartUnitId: uuidSchema.nullable().optional(),
  rangeEndUnitId: uuidSchema,
  /** 문제은행에서 재료를 뽑을 단원 범위. 비면 만들 수 없다. */
  unitIds: z.array(uuidSchema).min(1).max(60),
  /** 어느 학교의 어느 시험을 예측하나. */
  series: examSeriesKeySchema,
  /**
   * 예측 대상 시점. **이 시점 이후 자료는 근거에서 제외된다**(누출 차단, 11 §3 L5).
   * 서버가 컷오프를 강제하므로 클라이언트가 과거 데이터를 골라 보낼 필요가 없다.
   */
  target: examPeriodSchema,
});
export type PredictedPaperCreateRequest = z.infer<
  typeof predictedPaperCreateRequestSchema
>;

export const predictedPaperCreateResponseSchema = z.strictObject({
  data: z.strictObject({
    testId: uuidSchema,
    questionCount: z.int().min(1).max(60),
    /** 정확히 100 (D-42). */
    totalScore: z.literal(100),
    grid: scoreGridSchema,
    questions: z.array(predictedPaperQuestionSchema).min(1).max(60),
    /** 채우지 못한 칸. 비어 있어야 청사진대로 나온 시험지다. */
    unfilled: z.array(unfilledSlotSchema),
    /** 근거로 쓴 과거 회차 수 / 만점 100 가드(11 §11)로 뺀 회차 수. */
    referenceUsed: z.int().min(0),
    referenceExcluded: z.int().min(0),
    /** 청사진이 몇 편에 근거하는가. 0이면 코호트만으로 만든 것이라 신뢰도가 낮다. */
    evidenceCount: z.int().min(0),
    confidence: z.number().min(0).max(1),
  }),
});
export type PredictedPaperCreateResponse = z.infer<
  typeof predictedPaperCreateResponseSchema
>;

/** PATCH /api/tests/{id}/scores — 원장 수동 배점 조정 (11 §10.4). */
export const testScoresUpdateRequestSchema = z.strictObject({
  scores: z
    .array(
      z.strictObject({
        orderIndex: z.int().min(1).max(60),
        score: z.number().positive().max(100),
      }),
    )
    .min(1)
    .max(60),
});
export type TestScoresUpdateRequest = z.infer<
  typeof testScoresUpdateRequestSchema
>;

export const testScoresUpdateResponseSchema = z.strictObject({
  data: z.strictObject({
    testId: uuidSchema,
    questionCount: z.int().min(1).max(60),
    totalScore: z.literal(100),
    problems: z
      .array(
        z.strictObject({
          orderIndex: z.int().min(1).max(60),
          problemId: uuidSchema,
          score: z.number().positive().max(100),
        }),
      )
      .min(1)
      .max(60),
  }),
});
export type TestScoresUpdateResponse = z.infer<
  typeof testScoresUpdateResponseSchema
>;
