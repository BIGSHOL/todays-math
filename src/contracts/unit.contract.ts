/**
 * 교육과정 단원 목록 — S-04 확인테스트 범위 선택.
 * GET /api/units
 */
import { z } from "zod";

import { dataResponseSchema, uuidSchema } from "./common.contract";

export const unitSchema = z.strictObject({
  id: uuidSchema,
  grade: z.string().min(1),
  chapter: z.string().min(1),
  section: z.string().min(1),
  orderIndex: z.number().int(),
});
export type UnitEntity = z.infer<typeof unitSchema>;

export const unitListResponseSchema = dataResponseSchema(z.array(unitSchema));
export type UnitListResponse = z.infer<typeof unitListResponseSchema>;
