/**
 * 문제은행 계약 — FEAT-1, FEAT-5.
 *
 * 대응 API 경로:
 *   POST   /api/problems                    — 문제 등록 (수동 자작/기출 직접 입력)
 *   GET    /api/problems                     — 문제 목록 조회 (필터: unitId/grade/chapter/chapterPrefix/difficulty/problemType/source/reviewStatus)
 *   GET    /api/problems/{id}                — 문제 단건 조회
 *   PATCH  /api/problems/{id}                — 문제 수정 (본문/정답/풀이 등)
 *   DELETE /api/problems/{id}                — 문제 삭제
 *   PATCH  /api/problems/{id}/review-status  — 검수 승격 (pending → approved 등, D-22)
 *   POST   /api/problems/generate            — AI 문제 생성 (unitId, difficulty, count)
 *   POST   /api/problems/transform           — 기존 문제 변형 (originProblemId, count)
 *
 * Problem.directUseAllowed — T3.0/D-26. RPM 원본은 false, 그 외 기본 true.
 * Problem.pool — D-31. 기본 shared. 특별 지시가 없으면 전부 공용 풀.
 *
 * ⚠️ reviewStatus는 등록/수정 요청에 포함하지 않는다 — 검수 승격은 반드시 전용 엔드포인트
 *    (PATCH /api/problems/{id}/review-status)를 통하도록 강제해 클라이언트가 등록과 동시에
 *    스스로 승인 처리하는 경로를 원천 차단한다(D-22 품질 리스크 완화).
 *
 * 참조: docs/planning/04-database-design.md §2.3 (PROBLEM)
 *       docs/planning/07-coding-convention.md §2.3 (problemType: 계산/개념/활용/서술형)
 */
import { z } from "zod";

import {
  dataResponseSchema,
  difficultySchema,
  isoDateTimeSchema,
  listResponseSchema,
  paginationParamsSchema,
  problemPoolSchema,
  problemSourceSchema,
  reviewStatusSchema,
  uuidSchema,
} from "./common.contract";

// 07-coding-convention.md §2.3 — 확장 가능성 고려해 prisma는 자유 문자열이지만,
// 앱(계약) 레벨에서는 아래 4종으로 제한한다.
export const problemTypeSchema = z.enum(["계산", "개념", "활용", "서술형"], {
  error: "문제 유형은 계산/개념/활용/서술형 중 하나여야 합니다.",
});
export type ProblemType = z.infer<typeof problemTypeSchema>;

// content/answer/solution — TEXT(무제한)이지만 비정상적으로 큰 입력을 막기 위한 상한.
const problemTextSchema = (label: string) =>
  z
    .string()
    .min(1, { error: `${label}을(를) 입력해주세요.` })
    .max(10_000, { error: `${label}은(는) 10,000자를 초과할 수 없습니다.` });

// ── 등록 ────────────────────────────────────────────────
export const problemCreateRequestSchema = z.strictObject({
  unitId: uuidSchema,
  /** 화면(S-08) 직접 등록은 manual/past_exam만 허용 — ai_generated/transformed는 전용 엔드포인트가 서버에서 부여 */
  source: z.enum(["manual", "past_exam"], {
    error: "등록 출처는 manual 또는 past_exam이어야 합니다.",
  }),
  difficulty: difficultySchema,
  problemType: problemTypeSchema,
  content: problemTextSchema("문제 본문"),
  answer: problemTextSchema("정답"),
  solution: problemTextSchema("풀이").optional(),
  /** 생략 시 공용 풀 (D-31). private는 명시할 때만. */
  pool: problemPoolSchema.optional().default("shared"),
});
export type ProblemCreateRequest = z.infer<typeof problemCreateRequestSchema>;

export const problemUpdateRequestSchema = z
  .strictObject({
    unitId: uuidSchema.optional(),
    difficulty: difficultySchema.optional(),
    problemType: problemTypeSchema.optional(),
    content: problemTextSchema("문제 본문").optional(),
    answer: problemTextSchema("정답").optional(),
    solution: problemTextSchema("풀이").optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: "수정할 값이 없습니다." });
export type ProblemUpdateRequest = z.infer<typeof problemUpdateRequestSchema>;

export const problemSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  unitId: uuidSchema,
  source: problemSourceSchema,
  originProblemId: uuidSchema.nullable(),
  difficulty: difficultySchema,
  problemType: problemTypeSchema,
  content: problemTextSchema("문제 본문"),
  answer: problemTextSchema("정답"),
  solution: problemTextSchema("풀이").nullable(),
  reviewStatus: reviewStatusSchema,
  /** RPM 원본은 false — 출제 풀에서 제외 (D-26). 응답에 없으면 true로 본다. */
  directUseAllowed: z.boolean().default(true),
  /** 공용 풀이 기본 (D-31). 응답에 없으면 shared로 본다. */
  pool: problemPoolSchema.default("shared"),
  /**
   * 원본 시험지에서 오려 온 그림 경로들 (`/figures/<examId>/qNN.jpg`).
   * 선택지마다 그림인 문항이 있어 배열이다. 없으면 빈 배열(널 금지).
   * 참조: docs/planning/09-figure-engine-guide.md §5
   */
  figureUrls: z.array(z.string()).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ProblemEntity = z.infer<typeof problemSchema>;

export const problemResponseSchema = dataResponseSchema(problemSchema);
export const problemListResponseSchema = listResponseSchema(problemSchema);

// ── 조회 필터 ────────────────────────────────────────────
export const problemFilterQuerySchema = z.strictObject({
  unitId: uuidSchema.optional(),
  /**
   * 계단식 단원 필터(S-08) — Unit relation 기준으로 거른다.
   * grade: 학년("초1"·"중2"·고등 과목명). chapter: 중단원 정확 일치.
   * chapterPrefix: 중단원 접두 일치("1-" = 초등 1학기) — chapter가 있으면 무시.
   */
  grade: z.string().min(1).optional(),
  chapter: z.string().min(1).optional(),
  chapterPrefix: z.string().min(1).optional(),
  difficulty: difficultySchema.optional(),
  problemType: problemTypeSchema.optional(),
  source: problemSourceSchema.optional(),
  reviewStatus: reviewStatusSchema.optional(),
  pool: problemPoolSchema.optional(),
  page: paginationParamsSchema.shape.page,
  pageSize: paginationParamsSchema.shape.pageSize,
});
export type ProblemFilterQuery = z.infer<typeof problemFilterQuerySchema>;

// ── 검수 승격 ────────────────────────────────────────────
export const problemReviewStatusUpdateRequestSchema = z.strictObject({
  reviewStatus: reviewStatusSchema,
});
export type ProblemReviewStatusUpdateRequest = z.infer<
  typeof problemReviewStatusUpdateRequestSchema
>;

// ── AI 생성 ─────────────────────────────────────────────
export const problemGenerateRequestSchema = z.strictObject({
  unitId: uuidSchema,
  difficulty: difficultySchema,
  /** 업무상 합리적 상한 — 1회 AI 호출로 과도한 생성을 막는다(문서에 명시된 상한 없음). */
  count: z
    .number()
    .int()
    .min(1, { error: "생성 개수는 1개 이상이어야 합니다." })
    .max(10, { error: "생성 개수는 10개를 초과할 수 없습니다." })
    .default(1),
});
export type ProblemGenerateRequest = z.infer<
  typeof problemGenerateRequestSchema
>;

export const problemGenerateResponseSchema = dataResponseSchema(
  z.array(problemSchema),
);

// ── 변형 ────────────────────────────────────────────────
export const problemTransformRequestSchema = z.strictObject({
  originProblemId: uuidSchema,
  count: z
    .number()
    .int()
    .min(1, { error: "변형 개수는 1개 이상이어야 합니다." })
    .max(10, { error: "변형 개수는 10개를 초과할 수 없습니다." })
    .default(1),
});
export type ProblemTransformRequest = z.infer<
  typeof problemTransformRequestSchema
>;

export const problemTransformResponseSchema = dataResponseSchema(
  z.array(problemSchema),
);
