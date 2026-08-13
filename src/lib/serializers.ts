/**
 * Prisma 조회 결과(Date 객체 · Prisma.JsonValue) → 계약 엔티티(ISO 문자열 · 좁혀진 타입)
 * 직렬화 헬퍼. `src/app/api/classes/**`, `src/app/api/students/**`, `src/app/api/progress/**`가
 * 공용으로 사용한다.
 */
import type {
  Class as ClassRow,
  Progress as ProgressRow,
  Student as StudentRow,
} from "@prisma/client";

import type { DifficultyRatio } from "@/contracts/common.contract";
import type {
  ClassEntity,
  ProgressEntity,
  StudentEntity,
} from "@/contracts/class.contract";

export function serializeClass(row: ClassRow): ClassEntity {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    grade: row.grade,
    defaultProblemCount: row.defaultProblemCount,
    // Class.difficultyRatio는 jsonb — 계약의 difficultyRatioSchema 형태({easy,mid,hard})로 저장됨을 전제한다.
    difficultyRatio: row.difficultyRatio as DifficultyRatio,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeStudent(row: StudentRow): StudentEntity {
  return {
    id: row.id,
    classId: row.classId,
    name: row.name,
    useIndividualProgress: row.useIndividualProgress,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeProgress(row: ProgressRow): ProgressEntity {
  return {
    id: row.id,
    classId: row.classId,
    studentId: row.studentId,
    unitId: row.unitId,
    // Progress.recordedAt은 @db.Date(날짜만) — 계약의 isoDateSchema(YYYY-MM-DD)에 맞춰 자른다.
    recordedAt: row.recordedAt.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
  };
}
