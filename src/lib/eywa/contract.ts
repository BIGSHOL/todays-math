/**
 * eywa 연계 API — **소비자 쪽 계약** (계획 3판 §3).
 *
 * eywa 가 응답 모양을 바꾸면 **여기가 빨개져야 한다**(codex #19 — 생산자 쪽
 * 테스트는 생산자가 응답과 테스트를 같이 바꾸면 초록이다). 응답은 전량 zod 로
 * 검증하고, 어긋나면 그 실행을 통째로 버린다 — 이전 데이터가 유지된다.
 *
 * 생산자: eywa `src/features/integrations/todays-math/` (브랜치
 * `BIGSHOL/todays-math-api`). 필드 뜻은 그쪽 주석과 계획 문서가 SSOT.
 */
import { z } from "zod";

export const rosterStudentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  grade: z.string().nullable(),
  school: z.string().nullable(),
  status: z.literal("enrolled"),
  classes: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().min(1),
      startDate: z.string().nullable(),
    }),
  ),
});

export const rosterResponseSchema = z.object({
  generatedAt: z.string(),
  total: z.number().int().nonnegative(),
  students: z.array(rosterStudentSchema),
});

export const progressRowSchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  /** YYYY-MM-DD — JS Date 로 달력을 다시 만들지 않는다(grok #11, TZ 함정). */
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.string(),
  progress: z.string(),
  classId: z.uuid().nullable(),
  makeupClassId: z.uuid().nullable(),
});

export const progressResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  rows: z.array(progressRowSchema),
  nextCursor: z.string().nullable(),
});

export type RosterResponse = z.infer<typeof rosterResponseSchema>;
export type ProgressResponse = z.infer<typeof progressResponseSchema>;
