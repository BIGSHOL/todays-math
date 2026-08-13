/**
 * Prisma 조회 결과(Date 객체 · Prisma.JsonValue) → 계약 엔티티(ISO 문자열 · 좁혀진 타입)
 * 직렬화 헬퍼. 반/학생/진도/문제/시험지 API가 공용으로 사용한다.
 */
import type {
  Class as ClassRow,
  Problem as ProblemRow,
  Progress as ProgressRow,
  Student as StudentRow,
  Test as TestRow,
  TestProblem as TestProblemRow,
} from "@prisma/client";

import type { DifficultyRatio } from "@/contracts/common.contract";
import type {
  ClassEntity,
  ProgressEntity,
  StudentEntity,
} from "@/contracts/class.contract";
import type { ProblemEntity, ProblemType } from "@/contracts/problem.contract";
import type { TestEntity, TestProblemItem } from "@/contracts/test.contract";

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

export function serializeProblem(row: ProblemRow): ProblemEntity {
  return {
    id: row.id,
    userId: row.userId,
    unitId: row.unitId,
    source: row.source,
    originProblemId: row.originProblemId,
    difficulty: row.difficulty,
    // Problem.problemType은 DB에서 자유 문자열(VarChar)이지만 앱 계약은 4종으로 좁힌다
    // (07-coding-convention.md §2.3, problem.contract.ts 상단 주석 참조).
    problemType: row.problemType as ProblemType,
    content: row.content,
    answer: row.answer,
    solution: row.solution,
    reviewStatus: row.reviewStatus,
    directUseAllowed: row.directUseAllowed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeTest(row: TestRow): TestEntity {
  return {
    id: row.id,
    userId: row.userId,
    classId: row.classId,
    studentId: row.studentId,
    testType: row.testType,
    rangeStartUnitId: row.rangeStartUnitId,
    rangeEndUnitId: row.rangeEndUnitId,
    status: row.status,
    modified: row.modified,
    testDate: row.testDate.toISOString().slice(0, 10),
    printedAt: row.printedAt ? row.printedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeTestProblemItem(
  row: TestProblemRow & { problem: ProblemRow },
): TestProblemItem {
  return {
    id: row.id,
    problemId: row.problemId,
    orderIndex: row.orderIndex,
    replaced: row.replaced,
    problem: serializeProblem(row.problem),
  };
}
