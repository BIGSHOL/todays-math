/**
 * Prisma 조회 결과(Date 객체 · Prisma.JsonValue) → 계약 엔티티(ISO 문자열 · 좁혀진 타입)
 * 직렬화 헬퍼. 반/학생/진도/문제/시험지 API가 공용으로 사용한다.
 */
import type {
  AnalysisReport as AnalysisReportRow,
  Class as ClassRow,
  Problem as ProblemRow,
  ProblemAnswer as ProblemAnswerRow,
  Progress as ProgressRow,
  Student as StudentRow,
  Test as TestRow,
  TestProblem as TestProblemRow,
  TestResult as TestResultRow,
} from "@prisma/client";

import type { Difficulty, DifficultyRatio } from "@/contracts/common.contract";
import type {
  ClassEntity,
  ProgressEntity,
  StudentEntity,
} from "@/contracts/class.contract";
import type { ProblemEntity, ProblemType } from "@/contracts/problem.contract";
import type { TestEntity, TestProblemItem } from "@/contracts/test.contract";
import type {
  AnalysisReportEntity,
  ProblemAnswerEntity,
  TestResultEntity,
} from "@/contracts/testresult.contract";

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
    // 컬럼을 **그대로** 내보낸다. 단원에서 다시 만들지 않는다 — 코드는 부여 당시의
    // 스냅샷이고, 다시 계산하면 원장님이 적어 둔 코드가 다른 문항을 가리킨다(D-53).
    problemCode: row.problemCode,
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
    pool: row.pool,
    // 그림이 없는 문항은 빈 배열이다 — 화면이 널 검사를 하지 않아도 되게 한다.
    figureUrls: row.figureUrls ?? [],
    figureSvg: row.figureSvg ?? null,
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

export function serializeTestResult(row: TestResultRow): TestResultEntity {
  return {
    id: row.id,
    testId: row.testId,
    studentId: row.studentId,
    takenAt: row.takenAt.toISOString(),
    score: row.score,
    predictedScore: row.predictedScore,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeProblemAnswer(
  row: ProblemAnswerRow,
): ProblemAnswerEntity {
  return {
    id: row.id,
    problemId: row.problemId,
    selectedChoice: row.selectedChoice,
    essayScore: row.essayScore,
    isCorrect: row.isCorrect,
    sequence: row.sequence,
  };
}

export function serializeAnalysisReport(
  row: AnalysisReportRow,
): AnalysisReportEntity {
  return {
    id: row.id,
    testResultId: row.testResultId,
    totalScore: row.totalScore,
    predictedScore: row.predictedScore,
    // AnalysisReport.unitScores/difficultyDistribution은 jsonb — 계약 형태로 저장됨을 전제한다
    // (Test/Class.difficultyRatio와 같은 패턴, serializeClass 참조).
    unitScores: row.unitScores as Record<string, number>,
    difficultyDistribution: row.difficultyDistribution as Record<
      Difficulty,
      { correct: number; total: number }
    >,
    recommendedUnits: row.recommendedUnits,
    createdAt: row.createdAt.toISOString(),
  };
}
