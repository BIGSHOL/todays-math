/**
 * Prisma 조회 결과(Date 객체 · Prisma.JsonValue) → 계약 엔티티(ISO 문자열 · 좁혀진 타입)
 * 직렬화 헬퍼. `src/app/api/classes/**`, `src/app/api/students/**`,
 * `src/app/api/problems/**`가 공용으로 사용한다.
 */
import type {
  Class as ClassRow,
  Problem as ProblemRow,
  Student as StudentRow,
} from "@prisma/client";

import type { DifficultyRatio } from "@/contracts/common.contract";
import type { ClassEntity, StudentEntity } from "@/contracts/class.contract";
import type { ProblemEntity, ProblemType } from "@/contracts/problem.contract";

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

export function serializeProblem(row: ProblemRow): ProblemEntity {
  return {
    id: row.id,
    userId: row.userId,
    unitId: row.unitId,
    source: row.source,
    originProblemId: row.originProblemId,
    difficulty: row.difficulty,
    problemType: row.problemType as ProblemType,
    content: row.content,
    answer: row.answer,
    solution: row.solution,
    reviewStatus: row.reviewStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
