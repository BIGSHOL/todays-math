/**
 * 사용 지표 계약 — FEAT-3 노스스타/입력 지표 (PRD 4장).
 *
 * 대응 API 경로:
 *   GET /api/metrics — 주간 요약 (실사용 일수, 무수정 사용률, 출제→인쇄 소요)
 *
 * 인쇄 기록 자체는 src/contracts/test.contract.ts 의
 * POST /api/tests/{id}/print (testPrintResponseSchema)가 담당한다.
 */
import { z } from "zod";

import { dataResponseSchema, isoDateSchema } from "./common.contract";

export const metricsQuerySchema = z.strictObject({
  /** 주간 창의 시작일(YYYY-MM-DD). 생략 시 오늘 포함 최근 7일. */
  weekStart: isoDateSchema.optional(),
});
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export const weeklyMetricsSchema = z.strictObject({
  weekStart: isoDateSchema,
  weekEnd: isoDateSchema,
  /** 노스스타: 해당 주에 1회 이상 인쇄한 날짜 수 */
  printedDays: z.number().int().min(0),
  printedCount: z.number().int().min(0),
  unmodifiedCount: z.number().int().min(0),
  /** 무수정 사용률 — 인쇄 0건이면 0 */
  unmodifiedRate: z.number().min(0).max(1),
  /** 출제 생성(createdAt)→인쇄(printedAt) 평균 초. 인쇄 0건이면 null */
  avgGenerateToPrintSeconds: z.number().nullable(),
});
export type WeeklyMetrics = z.infer<typeof weeklyMetricsSchema>;

export const metricsResponseSchema = dataResponseSchema(weeklyMetricsSchema);
