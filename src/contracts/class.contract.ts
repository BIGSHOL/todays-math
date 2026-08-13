/**
 * 반/학생/진도 계약 — FEAT-4.
 *
 * 대응 API 경로:
 *   POST   /api/classes              — 반 생성
 *   GET    /api/classes              — 반 목록 조회 (본인 소유, 페이지네이션)
 *   GET    /api/classes/{id}         — 반 단건 조회
 *   PATCH  /api/classes/{id}         — 반 수정
 *   DELETE /api/classes/{id}         — 반 삭제
 *   POST   /api/students             — 학생 등록 (이름만 — 최소 수집 원칙)
 *   GET    /api/students             — 학생 목록 조회 (classId 쿼리 필수)
 *   PATCH  /api/students/{id}        — 학생 수정 (이름/개별 진도 사용 여부)
 *   DELETE /api/students/{id}        — 학생 삭제
 *   POST   /api/progress             — 진도 기록 (반 전체 또는 개별 학생)
 *   GET    /api/progress             — 현재 진도 조회 (classId[, studentId] 쿼리)
 *   POST   /api/progress/advance     — "다음 소단원 1클릭 진행" (D-19, order_index 기준)
 *
 * ⚠️ PROGRESS는 04-database-design.md §2.6 기준 이력 누적(append-only) 엔티티다.
 *    02-trd.md §8.1의 "PATCH /api/progress/{id}" 예시는 일반 RESTful 규칙의 예시일 뿐이며,
 *    실제 데이터 모델(이력 누적)과 맞지 않아 이 계약에서는 채택하지 않는다 — 진도 갱신은
 *    항상 새 PROGRESS 행을 추가하는 POST로 표현한다(수정/삭제 엔드포인트 없음).
 *
 * 참조: docs/planning/04-database-design.md §2.6 (CLASS/STUDENT/PROGRESS)
 *       docs/planning/03-user-flow.md §5 (진도 갱신 플로우), §7 (S-02, S-07)
 */
import { z } from "zod";

import {
  dataResponseSchema,
  difficultyRatioSchema,
  isoDateSchema,
  isoDateTimeSchema,
  listResponseSchema,
  paginationParamsSchema,
  uuidSchema,
} from "./common.contract";

// ─────────────────────────────────────────────
// 반 (CLASS)
// ─────────────────────────────────────────────

// Class.name VarChar(100)
const classNameSchema = z
  .string()
  .min(1, { error: "반 이름을 입력해주세요." })
  .max(100, { error: "반 이름은 100자를 초과할 수 없습니다." });

// Class.grade VarChar(10)
const classGradeSchema = z
  .string()
  .min(1, { error: "학년을 입력해주세요." })
  .max(10, { error: "학년은 10자를 초과할 수 없습니다." });

// Class.defaultProblemCount — 업무상 합리적 상한(문서에 명시된 상한 없음, 시험지 1회 문항 수 기준).
const defaultProblemCountSchema = z
  .number()
  .int()
  .min(1, { error: "기본 문항 수는 1개 이상이어야 합니다." })
  .max(30, { error: "기본 문항 수는 30개를 초과할 수 없습니다." });

export const classCreateRequestSchema = z.strictObject({
  name: classNameSchema,
  grade: classGradeSchema,
  defaultProblemCount: defaultProblemCountSchema.default(8),
  difficultyRatio: difficultyRatioSchema.default({ easy: 3, mid: 4, hard: 1 }),
});
export type ClassCreateRequest = z.infer<typeof classCreateRequestSchema>;

export const classUpdateRequestSchema = z
  .strictObject({
    name: classNameSchema.optional(),
    grade: classGradeSchema.optional(),
    defaultProblemCount: defaultProblemCountSchema.optional(),
    difficultyRatio: difficultyRatioSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    error: "수정할 값이 없습니다.",
  });
export type ClassUpdateRequest = z.infer<typeof classUpdateRequestSchema>;

const classSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  name: classNameSchema,
  grade: classGradeSchema,
  defaultProblemCount: defaultProblemCountSchema,
  difficultyRatio: difficultyRatioSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ClassEntity = z.infer<typeof classSchema>;

export const classResponseSchema = dataResponseSchema(classSchema);
export const classListResponseSchema = listResponseSchema(classSchema);

// ─────────────────────────────────────────────
// 학생 (STUDENT) — 이름만 수집 (최소 수집 원칙, 02-trd.md §3.3)
// ─────────────────────────────────────────────

// Student.name VarChar(50)
const studentNameSchema = z
  .string()
  .min(1, { error: "학생 이름을 입력해주세요." })
  .max(50, { error: "학생 이름은 50자를 초과할 수 없습니다." });

export const studentCreateRequestSchema = z.strictObject({
  classId: uuidSchema,
  name: studentNameSchema,
});
export type StudentCreateRequest = z.infer<typeof studentCreateRequestSchema>;

export const studentUpdateRequestSchema = z
  .strictObject({
    name: studentNameSchema.optional(),
    useIndividualProgress: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    error: "수정할 값이 없습니다.",
  });
export type StudentUpdateRequest = z.infer<typeof studentUpdateRequestSchema>;

const studentSchema = z.strictObject({
  id: uuidSchema,
  classId: uuidSchema,
  name: studentNameSchema,
  useIndividualProgress: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type StudentEntity = z.infer<typeof studentSchema>;

export const studentResponseSchema = dataResponseSchema(studentSchema);
export const studentListResponseSchema = listResponseSchema(studentSchema);

export const studentListQuerySchema = z.strictObject({
  classId: uuidSchema,
  page: paginationParamsSchema.shape.page,
  pageSize: paginationParamsSchema.shape.pageSize,
});
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;

// ─────────────────────────────────────────────
// 진도 (PROGRESS) — D-21 이력 누적 + 반/개별 이중 구조
// ─────────────────────────────────────────────

export const progressRecordRequestSchema = z.strictObject({
  classId: uuidSchema,
  /** 미지정 시 반 전체 진도. 값이 있으면 해당 학생 개별 진도(반 진도보다 우선). */
  studentId: uuidSchema.optional(),
  unitId: uuidSchema,
  /** 미지정 시 서버가 오늘 날짜로 기록. */
  recordedAt: isoDateSchema.optional(),
});
export type ProgressRecordRequest = z.infer<typeof progressRecordRequestSchema>;

/** "다음 소단원 1클릭 진행" — 서버가 현재 진도 unit의 orderIndex+1을 찾아 자동 기록(D-19). */
export const progressAdvanceRequestSchema = z.strictObject({
  classId: uuidSchema,
  studentId: uuidSchema.optional(),
});
export type ProgressAdvanceRequest = z.infer<
  typeof progressAdvanceRequestSchema
>;

export const progressQuerySchema = z.strictObject({
  classId: uuidSchema,
  studentId: uuidSchema.optional(),
});
export type ProgressQuery = z.infer<typeof progressQuerySchema>;

const progressSchema = z.strictObject({
  id: uuidSchema,
  classId: uuidSchema,
  studentId: uuidSchema.nullable(),
  unitId: uuidSchema,
  recordedAt: isoDateSchema,
  createdAt: isoDateTimeSchema,
});
export type ProgressEntity = z.infer<typeof progressSchema>;

export const progressResponseSchema = dataResponseSchema(progressSchema);
