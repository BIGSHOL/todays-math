/**
 * 학생 응시 결과 계약 — v2 "오늘의 시험"(기출 예상 점수 판독기) T7.1.
 *
 * 대응 API 경로:
 *   POST   /api/tests/{id}/submit                — 채점 결과 입력(자동 채점 + 예상 점수 산출)
 *   GET    /api/tests/{id}/results                — 학생별 응시 결과 목록
 *   GET    /api/tests/{id}/results/{studentId}    — 특정 학생의 상세 분석 리포트(최신 1건)
 *
 * 참조: docs/planning/11-score-predictor.md §1 (산출물 A/B/C, "1차 산출물: 엔진 + 리포트 먼저")
 *       prisma/schema.prisma의 TestResult/ProblemAnswer/AnalysisReport
 *
 * ⚠️ T7.1 지시서의 예시 스키마는 SubmitTestResultSchema.testId를 요청 본문에 포함했으나,
 *    이 API는 testId를 경로 파라미터({id})로 이미 받으므로 본문에 중복·불일치 위험이 있는
 *    testId를 넣지 않는다(REST 관례 + idParamSchema 재사용, 다른 /api/tests/{id}/* 엔드포인트와
 *    일관). studentId만 본문에 남긴다 — 완료 보고에 근거 명시.
 * ⚠️ predictedScore(판독기 계산값)는 잠정 placeholder다 —
 *    src/lib/predictor/predictStudentScore.ts 상단 주석 참조.
 */
import { z } from "zod";

import {
  dataResponseSchema,
  difficultySchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.contract";

// ─────────────────────────────────────────────
// 채점 결과 입력 (POST /api/tests/{id}/submit)
// ─────────────────────────────────────────────

/**
 * 문항 1개에 대한 학생 응답 — 객관식(selectedChoice)과 서술형(essayScore) 중 하나만 값을 갖고,
 * 둘 다 NULL이면 미답으로 채점한다(오답 처리, 0점).
 */
export const problemAnswerInputSchema = z.strictObject({
  problemId: uuidSchema,
  /** 객관식 선택 번호(1~5). 서술형/미답이면 NULL. */
  selectedChoice: z
    .number()
    .int()
    .min(1, { error: "선택 번호는 1 이상이어야 합니다." })
    .max(5, { error: "선택 번호는 5 이하여야 합니다." })
    .nullable(),
  /** 서술형 채점 점수(0~100, 배점 대비 비율). 객관식/미답이면 NULL. */
  essayScore: z
    .number()
    .min(0, { error: "서술형 점수는 0 이상이어야 합니다." })
    .max(100, { error: "서술형 점수는 100 이하여야 합니다." })
    .nullable(),
  /** 시험지 내 문항 순서 — TestProblem.orderIndex와 대응. */
  sequence: z.number().int().min(0),
});
export type ProblemAnswerInput = z.infer<typeof problemAnswerInputSchema>;

export const testResultSubmitRequestSchema = z.strictObject({
  studentId: uuidSchema,
  answers: z
    .array(problemAnswerInputSchema)
    .min(1, { error: "채점할 응답이 최소 1건 이상이어야 합니다." }),
});
export type TestResultSubmitRequest = z.infer<
  typeof testResultSubmitRequestSchema
>;

// ─────────────────────────────────────────────
// 엔티티
// ─────────────────────────────────────────────

export const problemAnswerSchema = z.strictObject({
  id: uuidSchema,
  problemId: uuidSchema,
  selectedChoice: z.number().int().min(1).max(5).nullable(),
  essayScore: z.number().min(0).max(100).nullable(),
  isCorrect: z.boolean(),
  sequence: z.number().int().min(0),
});
export type ProblemAnswerEntity = z.infer<typeof problemAnswerSchema>;

/** 난이도별 정답/전체 문항 수. */
export const difficultyDistributionEntrySchema = z.strictObject({
  correct: z.number().int().min(0),
  total: z.number().int().min(0),
});

export const analysisReportSchema = z.strictObject({
  id: uuidSchema,
  testResultId: uuidSchema,
  totalScore: z.number(),
  /** 잠정 placeholder — src/lib/predictor/predictStudentScore.ts 참조. */
  predictedScore: z.number(),
  /** {unitId: 정답률(0~100)} */
  unitScores: z.record(uuidSchema, z.number()),
  /** {difficulty(easy|mid|hard): {correct, total}} */
  difficultyDistribution: z.record(
    difficultySchema,
    difficultyDistributionEntrySchema,
  ),
  /** 복습 추천 단원 id — 정답률 낮은 순 최대 3개(잠정 기준선 60%). */
  recommendedUnits: z.array(uuidSchema),
  createdAt: isoDateTimeSchema,
});
export type AnalysisReportEntity = z.infer<typeof analysisReportSchema>;

export const testResultSchema = z.strictObject({
  id: uuidSchema,
  testId: uuidSchema,
  studentId: uuidSchema,
  takenAt: isoDateTimeSchema,
  score: z.number(),
  /** 잠정 placeholder — src/lib/predictor/predictStudentScore.ts 참조. */
  predictedScore: z.number(),
  createdAt: isoDateTimeSchema,
});
export type TestResultEntity = z.infer<typeof testResultSchema>;

// ─────────────────────────────────────────────
// 응답 (제출 직후 — 자동 채점 + 분석 리포트 동봉)
// ─────────────────────────────────────────────

export const testResultSubmitResponseSchema = dataResponseSchema(
  z.strictObject({
    testResult: testResultSchema,
    analysisReport: analysisReportSchema,
  }),
);
export type TestResultSubmitResponse = z.infer<
  typeof testResultSubmitResponseSchema
>;

// ─────────────────────────────────────────────
// 목록 조회 (GET /api/tests/{id}/results)
// ─────────────────────────────────────────────

export const testResultListResponseSchema = dataResponseSchema(
  z.array(testResultSchema),
);
export type TestResultListResponse = z.infer<
  typeof testResultListResponseSchema
>;

// ─────────────────────────────────────────────
// 학생별 상세 조회 (GET /api/tests/{id}/results/{studentId}) — 최신 1건
// ─────────────────────────────────────────────

export const testResultDetailResponseSchema = dataResponseSchema(
  z.strictObject({
    testResult: testResultSchema,
    answers: z.array(problemAnswerSchema),
    analysisReport: analysisReportSchema,
  }),
);
export type TestResultDetailResponse = z.infer<
  typeof testResultDetailResponseSchema
>;
