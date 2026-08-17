/**
 * `@/lib/db`(Prisma 클라이언트) 대체용 인메모리 테스트 더블 — T2.1(class/student) +
 * T2.2(unit/progress) + T3.1(problem) + T4.2(test/testProblem/$transaction).
 *
 * Route Handler를 함수로 직접 호출하므로 MSW가 가로챌 수 없다. vitest.setup.ts가
 * `vi.mock("@/lib/db")`로 이 모듈을 주입해 실제 DB 접속을 막는다.
 *
 * 라우트가 실제로 호출하는 Prisma 메서드 부분집합만 구현한다.
 */
import { randomUUID } from "node:crypto";

import type {
  ClassEntity,
  ProgressEntity,
  StudentEntity,
} from "@/contracts/class.contract";
import type {
  Difficulty,
  ProblemSource,
  ReviewStatus,
  TestStatus,
  TestType,
} from "@/contracts/common.contract";
import type { ProblemEntity, ProblemType } from "@/contracts/problem.contract";
import type { TestEntity, TestProblemItem } from "@/contracts/test.contract";
import {
  MOCK_CLASS_OTHER_USER,
  MOCK_CLASSES,
  MOCK_CURRENT_PROGRESS_UNIT,
  MOCK_PROBLEM_OTHER_SHARED,
  MOCK_PROBLEM_MISSING_ANSWER,
  MOCK_PROBLEM_OTHER_USER,
  MOCK_PROBLEMS,
  MOCK_PROGRESS,
  MOCK_STUDENTS,
  MOCK_TEST_PROBLEMS_BY_TEST_ID,
  MOCK_TEST_RESULT_FIXTURE_TEST,
  MOCK_TEST_RESULT_FIXTURE_TEST_PROBLEMS,
  MOCK_TEST_RESULT_PROBLEMS,
  MOCK_TESTS,
  MOCK_UNITS,
  problemId,
  testProblemId,
  USER_TEACHER_ID,
} from "@/mocks/data";
import type { MockUnit } from "@/mocks/data/units";

interface ClassRow {
  id: string;
  userId: string;
  name: string;
  grade: string;
  defaultProblemCount: number;
  difficultyRatio: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

interface StudentRow {
  id: string;
  classId: string;
  name: string;
  useIndividualProgress: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type UnitRow = MockUnit;

interface ProgressRow {
  id: string;
  classId: string;
  studentId: string | null;
  unitId: string;
  recordedAt: Date;
  createdAt: Date;
}

interface ProblemRow {
  id: string;
  userId: string;
  unitId: string;
  source: ProblemSource;
  originProblemId: string | null;
  difficulty: Difficulty;
  problemType: string;
  /** 출제 형식(객관식|단답형|서술형) — T7.6 백필 전이라 실데이터도 대부분 NULL 이다. */
  questionType: string | null;
  content: string;
  answer: string;
  solution: string | null;
  reviewStatus: ReviewStatus;
  directUseAllowed: boolean;
  pool: "shared" | "private";
  /** 원본 배점(08-import-ledger.md 이관 메타데이터) — 계약(ProblemEntity)엔 없어 픽스처만 채운다. */
  score: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TestResultRow {
  id: string;
  testId: string;
  studentId: string;
  takenAt: Date;
  score: number;
  predictedScore: number;
  createdAt: Date;
}

interface ProblemAnswerRow {
  id: string;
  testResultId: string;
  problemId: string;
  selectedChoice: number | null;
  essayScore: number | null;
  isCorrect: boolean;
  sequence: number;
}

interface AnalysisReportRow {
  id: string;
  testResultId: string;
  totalScore: number;
  predictedScore: number;
  unitScores: Record<string, number>;
  difficultyDistribution: Record<
    Difficulty,
    { correct: number; total: number }
  >;
  recommendedUnits: string[];
  createdAt: Date;
}

interface TestRow {
  id: string;
  userId: string;
  classId: string;
  studentId: string | null;
  testType: TestType;
  rangeStartUnitId: string | null;
  rangeEndUnitId: string;
  status: TestStatus;
  modified: boolean;
  testDate: Date;
  printedAt: Date | null;
  createdAt: Date;
  /** '오늘의 시험' 회차 연결. 일반 시험지는 null. */
  predictionRunId: string | null;
}

interface TestProblemRow {
  id: string;
  testId: string;
  problemId: string;
  orderIndex: number;
  replaced: boolean;
  /** T7.9 — 배점 보정기가 매긴 조정 배점. 일일테스트는 NULL(D-28). */
  score: number | null;
}

/** T7.3 — 예측기 코퍼스 적재기(scripts/predictor/load-exams.ts) 전용. */
interface ExamRow {
  id: string;
  externalExamId: string;
  school: string;
  level: string;
  grade: number;
  subject: string;
  subjectRaw: string | null;
  year: number;
  semester: number;
  round: string;
  totalScore: number;
  questionCount: number;
  sourceFile: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ExamQuestionRow {
  id: string;
  examId: string;
  number: number;
  score: number;
  qtype: string;
  difficultyLabel: string | null;
  topicRaw: string | null;
  unitId: string | null;
  answer: string | null;
  hasFigure: boolean;
  problemId: string | null;
}

/**
 * T7.14 '오늘의 시험' 조회 라우트가 읽는 두 테이블.
 * 기본은 **빈 배열**이다 — 아직 예측을 한 번도 안 돌린 상태가 정상이기 때문이다.
 * 필요한 테스트가 `seedPredictionRuns` / `seedActualExamScores` 로 직접 채운다.
 */
interface PredictionRunRow {
  id: string;
  /** 회차 소유자. 목록·상세 소유권이 이 값으로 판정된다. */
  userId?: string;
  /** 시험 시행일. 화면이 D-day 를 세는 기준이다. */
  examDate?: Date | null;
  createdAt: Date;
  engineVersion: string;
  school: string;
  level: string;
  grade: number;
  subject: string;
  targetYear: number;
  targetSemester: number;
  targetRound: string;
  cutoffYear: number;
  cutoffSemester: number;
  cutoffRound: string;
  inputExamIds: string[];
  params: unknown;
  predictedBlueprint: unknown;
  predictedScores: unknown;
  actualSchoolMean: number | null;
  actualSchoolStdev: number | null;
  actualRecordedAt: Date | null;
}

interface ActualExamScoreRow {
  id: string;
  runId: string;
  studentId: string;
  actualScore: number;
  predictedScore: number;
  residual: number;
  intervalHit: boolean;
  recordedAt: Date;
  updatedAt: Date;
}

const PROBLEM_TYPES: ProblemType[] = ["계산", "개념", "활용", "서술형"];

/** 픽스처 30문항만으로는 daily 8문항·교체 후보가 부족하므로 테스트 더블에만 보강한다. */
function extraEligibleProblems(): ProblemEntity[] {
  const extras: ProblemEntity[] = [];
  let seq = 101;
  const push = (unitId: string, difficulty: Difficulty) => {
    extras.push({
      id: problemId(seq),
      userId: USER_TEACHER_ID,
      unitId,
      source: "manual",
      originProblemId: null,
      difficulty,
      problemType: PROBLEM_TYPES[(seq - 1) % 4]!,
      content: `출제 풀 보강 문제 ${seq}`,
      answer: "0",
      solution: null,
      reviewStatus: "approved",
      directUseAllowed: true,
      pool: "shared",
      figureUrls: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    seq += 1;
  };

  for (let i = 0; i < 2; i++) push(MOCK_CURRENT_PROGRESS_UNIT.id, "easy");
  for (let i = 0; i < 4; i++) push(MOCK_CURRENT_PROGRESS_UNIT.id, "mid");
  for (let i = 0; i < 2; i++) push(MOCK_CURRENT_PROGRESS_UNIT.id, "hard");
  const unit0 = MOCK_UNITS[0]!.id;
  const unit1 = MOCK_UNITS[1]!.id;
  push(unit0, "easy");
  push(unit0, "easy");
  push(unit1, "easy");
  push(unit1, "easy");
  return extras;
}

/** D-20: 최근 14일 내 출제되어 교체 후보에서 빠져야 하는 unit1 extra easy (seq 111). */
const RECENT_BLOCK_TEST_ID = "90000000-0000-4000-8000-000000000010";
const RECENT_BLOCK_TP_ID = "91000000-0000-4000-8000-000000000100";
const RECENT_BLOCK_PROBLEM_ID = problemId(111);

function toClassRow(entity: ClassEntity): ClassRow {
  return {
    ...entity,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toStudentRow(entity: StudentEntity): StudentRow {
  return {
    ...entity,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toProgressRow(entity: ProgressEntity): ProgressRow {
  return {
    ...entity,
    recordedAt: new Date(`${entity.recordedAt}T00:00:00.000Z`),
    createdAt: new Date(entity.createdAt),
  };
}

function toProblemRow(entity: ProblemEntity): ProblemRow {
  return {
    ...entity,
    // ProblemEntity(계약)엔 score가 없다 — 균등 배분 채점 경로(gradeAnswers.ts) 테스트는
    // MOCK_TEST_RESULT_PROBLEMS(score 직접 지정)로 별도 커버한다.
    score: null,
    questionType: null,
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

/** T7.1 채점 테스트 전용 — score(배점)를 직접 지정한 픽스처는 ISO 문자열만 Date로 바꾼다. */
function toFixtureProblemRow(
  fixture: (typeof MOCK_TEST_RESULT_PROBLEMS)[number],
): ProblemRow {
  return {
    ...fixture,
    questionType: null,
    createdAt: new Date(fixture.createdAt),
    updatedAt: new Date(fixture.updatedAt),
  };
}

function toTestRow(entity: TestEntity): TestRow {
  return {
    ...entity,
    testDate: new Date(`${entity.testDate}T00:00:00.000Z`),
    printedAt: entity.printedAt ? new Date(entity.printedAt) : null,
    createdAt: new Date(entity.createdAt),
    predictionRunId: null,
  };
}

function toTestProblemRow(
  testId: string,
  item: TestProblemItem,
): TestProblemRow {
  return {
    id: item.id,
    testId,
    problemId: item.problemId,
    orderIndex: item.orderIndex,
    replaced: item.replaced,
    score: null,
  };
}

/** T7.1 채점 테스트 전용 Test 픽스처 — printedAt이 항상 값이 있어 별도 변환 함수를 둔다. */
function toFixtureTestRow(): TestRow {
  const fixture = MOCK_TEST_RESULT_FIXTURE_TEST;
  return {
    id: fixture.id,
    userId: fixture.userId,
    classId: fixture.classId,
    studentId: fixture.studentId,
    testType: fixture.testType,
    rangeStartUnitId: fixture.rangeStartUnitId,
    rangeEndUnitId: fixture.rangeEndUnitId,
    status: fixture.status,
    modified: fixture.modified,
    testDate: new Date(`${fixture.testDate}T00:00:00.000Z`),
    printedAt: new Date(fixture.printedAt),
    predictionRunId: null,
    createdAt: new Date(fixture.createdAt),
  };
}

let classRows: ClassRow[] = [];
let studentRows: StudentRow[] = [];
let unitRows: UnitRow[] = [];
let progressRows: ProgressRow[] = [];
let problemRows: ProblemRow[] = [];
let testRows: TestRow[] = [];
let testProblemRows: TestProblemRow[] = [];
let testResultRows: TestResultRow[] = [];
let problemAnswerRows: ProblemAnswerRow[] = [];
let analysisReportRows: AnalysisReportRow[] = [];
let examRows: ExamRow[] = [];
let examQuestionRows: ExamQuestionRow[] = [];
let predictionRunRows: PredictionRunRow[] = [];
let actualExamScoreRows: ActualExamScoreRow[] = [];

/** 매 테스트 시작 전 Mock 픽스처 상태로 되돌린다 — 테스트 간 상태 오염 방지. */
export function resetPrismaTestDouble() {
  classRows = [...MOCK_CLASSES, MOCK_CLASS_OTHER_USER].map(toClassRow);
  studentRows = MOCK_STUDENTS.map(toStudentRow);
  unitRows = MOCK_UNITS.map((unit) => ({ ...unit }));
  progressRows = MOCK_PROGRESS.map(toProgressRow);
  problemRows = [
    ...MOCK_PROBLEMS,
    MOCK_PROBLEM_OTHER_USER,
    MOCK_PROBLEM_OTHER_SHARED,
    MOCK_PROBLEM_MISSING_ANSWER,
    ...extraEligibleProblems(),
  ].map(toProblemRow);
  problemRows.push(...MOCK_TEST_RESULT_PROBLEMS.map(toFixtureProblemRow));
  testRows = MOCK_TESTS.map(toTestRow);
  testProblemRows = Object.entries(MOCK_TEST_PROBLEMS_BY_TEST_ID).flatMap(
    ([testId, items]) => items.map((item) => toTestProblemRow(testId, item)),
  );

  testRows.push({
    id: RECENT_BLOCK_TEST_ID,
    userId: USER_TEACHER_ID,
    classId: MOCK_CLASSES[0]!.id,
    studentId: null,
    testType: "daily",
    rangeStartUnitId: null,
    rangeEndUnitId: MOCK_UNITS[1]!.id,
    status: "printed",
    modified: false,
    testDate: new Date("2026-08-12T00:00:00.000Z"),
    printedAt: new Date("2026-08-12T09:00:00.000Z"),
    predictionRunId: null,
    createdAt: new Date("2026-08-12T08:00:00.000Z"),
  });
  testProblemRows.push({
    id: RECENT_BLOCK_TP_ID,
    testId: RECENT_BLOCK_TEST_ID,
    problemId: RECENT_BLOCK_PROBLEM_ID,
    orderIndex: 1,
    replaced: false,
    score: null,
  });

  // ── T7.1 채점 테스트 전용(TestResult/ProblemAnswer/AnalysisReport) ──
  testRows.push(toFixtureTestRow());
  testProblemRows.push(
    ...MOCK_TEST_RESULT_FIXTURE_TEST_PROBLEMS.map((item, i) => ({
      id: testProblemId(900 + i),
      testId: MOCK_TEST_RESULT_FIXTURE_TEST.id,
      problemId: item.problemId,
      orderIndex: item.orderIndex,
      replaced: false,
      score: null,
    })),
  );
  testResultRows = [];
  problemAnswerRows = [];
  analysisReportRows = [];
  examRows = [];
  examQuestionRows = [];
  predictionRunRows = [];
  actualExamScoreRows = [];
}
resetPrismaTestDouble();

function matchesWhere<T extends object>(
  row: T,
  where?: Record<string, unknown>,
): boolean {
  if (!where) return true;
  const record = row as Record<string, unknown>;

  if (Array.isArray(where.AND)) {
    return where.AND.every((clause) =>
      matchesWhere(row, clause as Record<string, unknown>),
    );
  }

  // 🔴 모르는 최상위 연산자를 **조용히 필드 이름으로 취급하면** 가짜가 실제 Prisma 와
  //    다른 답을 낸다. `NOT: { score: null }` 이 그렇게 늘 false 가 되어, 프로덕션에서
  //    맞는 가드가 테스트에서만 틀리게 동작했다. 지원하는 것만 받고 나머지는 던진다.
  if (where.NOT !== undefined) {
    if (Array.isArray(where.NOT)) {
      const anyMatch = where.NOT.some((clause) =>
        matchesWhere(row, clause as Record<string, unknown>),
      );
      if (anyMatch) return false;
    } else if (matchesWhere(row, where.NOT as Record<string, unknown>)) {
      return false;
    }
  }
  for (const key of Object.keys(where)) {
    if (key === key.toUpperCase() && !["AND", "OR", "NOT"].includes(key)) {
      throw new Error(
        `prismaTestDouble: 지원하지 않는 where 연산자 '${key}' — 조용히 통과시키지 않는다`,
      );
    }
  }

  const orClauses = where.OR;
  const rest = { ...where };
  delete rest.OR;
  delete rest.NOT;
  if (Array.isArray(orClauses)) {
    const orOk = orClauses.some((clause) =>
      matchesWhere(row, clause as Record<string, unknown>),
    );
    if (!orOk) return false;
  }

  return Object.entries(rest).every(([key, cond]) => {
    if (cond === undefined) return true;
    const value = record[key];
    if (
      cond !== null &&
      typeof cond === "object" &&
      !Array.isArray(cond) &&
      !(cond instanceof Date)
    ) {
      const obj = cond as { in?: unknown[]; not?: unknown };
      if (Array.isArray(obj.in)) return obj.in.includes(value);
      if ("not" in obj) return value !== obj.not;
    }
    return value === cond;
  });
}

function applyOrder<T extends object>(rows: T[], orderBy?: unknown): T[] {
  if (!orderBy || typeof orderBy !== "object") return rows;
  const [key, dir] = Object.entries(orderBy as Record<string, string>)[0] ?? [];
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (av instanceof Date && bv instanceof Date) {
      return dir === "desc"
        ? bv.getTime() - av.getTime()
        : av.getTime() - bv.getTime();
    }
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "desc" ? bv - av : av - bv;
    }
    return 0;
  });
}

function paginate<T>(rows: T[], skip = 0, take?: number): T[] {
  return take === undefined ? rows.slice(skip) : rows.slice(skip, skip + take);
}

/**
 * `select` 투영 — 실제 Prisma 는 **고른 컬럼만** 돌려준다.
 *
 * 가짜가 행 전체를 돌려주면 "조회는 5컬럼으로 좁혔는데 테스트는 28컬럼을 보고 통과"
 * 하는 침묵 회귀가 생긴다. 그래서 여기서도 실제로 잘라 낸다.
 * 모르는 필드·지원하지 않는 관계는 조용히 넘기지 않고 **던진다**(matchesWhere 와 같은 원칙).
 */
function applySelect<T extends object>(
  rows: T[],
  select: Record<string, unknown> | undefined,
  relations: Record<string, (row: T, spec: unknown) => unknown> = {},
): unknown[] {
  if (!select) return rows;
  return rows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(select)) {
      if (spec === false || spec === undefined) continue;
      if (spec === true) {
        if (!(key in row)) {
          throw new Error(
            `prismaTestDouble: select 에 없는 필드 '${key}' — 조용히 undefined 를 내지 않는다`,
          );
        }
        projected[key] = (row as Record<string, unknown>)[key];
        continue;
      }
      const resolve = relations[key];
      if (!resolve) {
        throw new Error(
          `prismaTestDouble: 지원하지 않는 관계 select '${key}' — 조용히 통과시키지 않는다`,
        );
      }
      projected[key] = resolve(row, spec);
    }
    return projected;
  });
}

function hydrateTestProblems(
  rows: TestProblemRow[],
  include?: { problem?: boolean },
) {
  if (!include?.problem) return rows;
  return rows.map((row) => ({
    ...row,
    problem:
      problemRows.find((problem) => problem.id === row.problemId) ?? null,
  }));
}

function hydrateTestResults(
  rows: TestResultRow[],
  include?: { answers?: boolean; analysisReport?: boolean },
) {
  if (!include) return rows;
  return rows.map((row) => ({
    ...row,
    ...(include.answers
      ? {
          answers: problemAnswerRows.filter((a) => a.testResultId === row.id),
        }
      : {}),
    ...(include.analysisReport
      ? {
          analysisReport:
            analysisReportRows.find((r) => r.testResultId === row.id) ?? null,
        }
      : {}),
  }));
}

const prismaModels = {
  class: {
    async create({
      data,
    }: {
      data: Omit<ClassRow, "id" | "createdAt" | "updatedAt">;
    }) {
      const now = new Date();
      const row: ClassRow = {
        id: randomUUID(),
        ...data,
        createdAt: now,
        updatedAt: now,
      };
      classRows.push(row);
      return row;
    },
    async findMany({
      where,
      skip = 0,
      take,
    }: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: unknown;
    } = {}) {
      return paginate(
        classRows.filter((row) => matchesWhere(row, where)),
        skip,
        take,
      );
    },
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return classRows.filter((row) => matchesWhere(row, where)).length;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return classRows.find((row) => row.id === where.id) ?? null;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<
        Omit<ClassRow, "id" | "userId" | "createdAt" | "updatedAt">
      >;
    }) {
      const row = classRows.find((r) => r.id === where.id);
      if (!row) throw new Error(`class not found: ${where.id}`);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async delete({ where }: { where: { id: string } }) {
      const index = classRows.findIndex((r) => r.id === where.id);
      if (index === -1) throw new Error(`class not found: ${where.id}`);
      const [removed] = classRows.splice(index, 1);
      studentRows = studentRows.filter((s) => s.classId !== where.id);
      return removed!;
    },
  },
  student: {
    async create({
      data,
    }: {
      data: Omit<
        StudentRow,
        "id" | "useIndividualProgress" | "createdAt" | "updatedAt"
      >;
    }) {
      const now = new Date();
      const row: StudentRow = {
        id: randomUUID(),
        ...data,
        useIndividualProgress: false,
        createdAt: now,
        updatedAt: now,
      };
      studentRows.push(row);
      return row;
    },
    async findMany({
      where,
      skip = 0,
      take,
    }: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
    } = {}) {
      return paginate(
        studentRows.filter((row) => matchesWhere(row, where)),
        skip,
        take,
      );
    },
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return studentRows.filter((row) => matchesWhere(row, where)).length;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return studentRows.find((row) => row.id === where.id) ?? null;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<
        Omit<StudentRow, "id" | "classId" | "createdAt" | "updatedAt">
      >;
    }) {
      const row = studentRows.find((r) => r.id === where.id);
      if (!row) throw new Error(`student not found: ${where.id}`);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async delete({ where }: { where: { id: string } }) {
      const index = studentRows.findIndex((r) => r.id === where.id);
      if (index === -1) throw new Error(`student not found: ${where.id}`);
      const [removed] = studentRows.splice(index, 1);
      return removed!;
    },
  },
  unit: {
    async findUnique({ where }: { where: { id: string } }) {
      return unitRows.find((row) => row.id === where.id) ?? null;
    },
    async findFirst({ where }: { where?: Record<string, unknown> } = {}) {
      return unitRows.find((row) => matchesWhere(row, where)) ?? null;
    },
    async findMany({ where }: { where?: Record<string, unknown> } = {}) {
      return unitRows.filter((row) => matchesWhere(row, where));
    },
  },
  progress: {
    async create({
      data,
    }: {
      data: {
        classId: string;
        studentId?: string | null;
        unitId: string;
        recordedAt: Date;
      };
    }) {
      const row: ProgressRow = {
        id: randomUUID(),
        classId: data.classId,
        studentId: data.studentId ?? null,
        unitId: data.unitId,
        recordedAt: data.recordedAt,
        createdAt: new Date(),
      };
      progressRows.push(row);
      return row;
    },
    async findMany({ where }: { where?: Record<string, unknown> } = {}) {
      return progressRows.filter((row) => matchesWhere(row, where));
    },
  },
  problem: {
    async create({
      data,
    }: {
      data: Omit<
        ProblemRow,
        "id" | "createdAt" | "updatedAt" | "pool" | "questionType"
      > & {
        originProblemId?: string | null;
        reviewStatus?: ReviewStatus;
        pool?: "shared" | "private";
        questionType?: string | null;
      };
    }) {
      const now = new Date();
      const row: ProblemRow = {
        id: randomUUID(),
        ...data,
        questionType: data.questionType ?? null,
        originProblemId: data.originProblemId ?? null,
        reviewStatus: data.reviewStatus ?? "pending",
        directUseAllowed: data.directUseAllowed ?? true,
        pool: data.pool ?? "shared",
        createdAt: now,
        updatedAt: now,
      };
      problemRows.push(row);
      return row;
    },
    async findMany({
      where,
      skip = 0,
      take,
      select,
    }: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: unknown;
      select?: Record<string, unknown>;
    } = {}) {
      return applySelect(
        paginate(
          problemRows.filter((row) => matchesWhere(row, where)),
          skip,
          take,
        ),
        select,
      );
    },
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return problemRows.filter((row) => matchesWhere(row, where)).length;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return problemRows.find((row) => row.id === where.id) ?? null;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<
        Omit<ProblemRow, "id" | "userId" | "createdAt" | "updatedAt">
      >;
    }) {
      const row = problemRows.find((r) => r.id === where.id);
      if (!row) throw new Error(`problem not found: ${where.id}`);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async delete({ where }: { where: { id: string } }) {
      const index = problemRows.findIndex((r) => r.id === where.id);
      if (index === -1) throw new Error(`problem not found: ${where.id}`);
      if (testProblemRows.some((row) => row.problemId === where.id)) {
        throw Object.assign(new Error("foreign key constraint failed"), {
          code: "P2003",
        });
      }
      const [removed] = problemRows.splice(index, 1);
      return removed!;
    },
  },
  test: {
    async create({
      data,
    }: {
      data: {
        userId: string;
        classId: string;
        studentId?: string | null;
        testType: TestType;
        rangeStartUnitId?: string | null;
        rangeEndUnitId: string;
        status?: TestStatus;
        modified?: boolean;
        testDate: Date;
        printedAt?: Date | null;
        predictionRunId?: string | null;
      };
    }) {
      const row: TestRow = {
        id: randomUUID(),
        userId: data.userId,
        classId: data.classId,
        studentId: data.studentId ?? null,
        testType: data.testType,
        rangeStartUnitId: data.rangeStartUnitId ?? null,
        rangeEndUnitId: data.rangeEndUnitId,
        status: data.status ?? "draft",
        modified: data.modified ?? false,
        testDate: data.testDate,
        printedAt: data.printedAt ?? null,
        predictionRunId: data.predictionRunId ?? null,
        createdAt: new Date(),
      };
      testRows.push(row);
      return row;
    },
    async findMany({
      where,
      skip = 0,
      take,
      orderBy,
      select,
    }: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: unknown;
      select?: Record<string, unknown>;
    } = {}) {
      return applySelect(
        paginate(
          applyOrder(
            testRows.filter((row) => matchesWhere(row, where)),
            orderBy,
          ),
          skip,
          take,
        ),
        select,
        {
          // `loadRounds` 가 "이 시험지에 채점이 있는가"를 take:1 로 확인한다.
          // 가짜가 이 관계를 안 채우면 `t.testResults.length` 가 그대로 터진다 —
          // 예전에는 픽스처의 predictionRunId 가 전부 null 이라 우연히 빈 배열만 나와
          // 이 경로가 한 번도 실행되지 않았다.
          testResults: (row, spec) => {
            const { take: relTake } = (spec ?? {}) as { take?: number };
            const rows = testResultRows.filter((r) => r.testId === row.id);
            return applySelect(
              paginate(rows, 0, relTake),
              (spec as { select?: Record<string, unknown> }).select,
            );
          },
        },
      );
    },
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return testRows.filter((row) => matchesWhere(row, where)).length;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return testRows.find((row) => row.id === where.id) ?? null;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Omit<TestRow, "id" | "userId" | "createdAt">>;
    }) {
      const row = testRows.find((r) => r.id === where.id);
      if (!row) throw new Error(`test not found: ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    async updateMany({
      where,
      data,
    }: {
      where?: Record<string, unknown>;
      data: Partial<Omit<TestRow, "id" | "userId" | "createdAt">>;
    }) {
      const rows = testRows.filter((row) => matchesWhere(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
  },
  testProblem: {
    async create({
      data,
    }: {
      data: {
        testId: string;
        problemId: string;
        orderIndex: number;
        replaced?: boolean;
        score?: number | null;
      };
    }) {
      const row: TestProblemRow = {
        id: randomUUID(),
        testId: data.testId,
        problemId: data.problemId,
        orderIndex: data.orderIndex,
        replaced: data.replaced ?? false,
        score: data.score ?? null,
      };
      testProblemRows.push(row);
      return row;
    },
    async findMany({
      where,
      include,
      orderBy,
    }: {
      where?: Record<string, unknown>;
      include?: { problem?: boolean };
      orderBy?: unknown;
    } = {}) {
      const rows = applyOrder(
        testProblemRows.filter((row) => matchesWhere(row, where)),
        orderBy,
      );
      return hydrateTestProblems(rows, include);
    },
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return testProblemRows.filter((row) => matchesWhere(row, where)).length;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Omit<TestProblemRow, "id" | "testId">>;
    }) {
      const row = testProblemRows.find((r) => r.id === where.id);
      if (!row) throw new Error(`testProblem not found: ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  },
  testResult: {
    async create({
      data,
    }: {
      data: {
        testId: string;
        studentId: string;
        score: number;
        predictedScore: number;
        takenAt?: Date;
      };
    }) {
      const row: TestResultRow = {
        id: randomUUID(),
        testId: data.testId,
        studentId: data.studentId,
        takenAt: data.takenAt ?? new Date(),
        score: data.score,
        predictedScore: data.predictedScore,
        createdAt: new Date(),
      };
      testResultRows.push(row);
      return row;
    },
    async findMany({
      where,
      include,
      orderBy,
    }: {
      where?: Record<string, unknown>;
      include?: { answers?: boolean; analysisReport?: boolean };
      orderBy?: unknown;
    } = {}) {
      const rows = applyOrder(
        testResultRows.filter((row) => matchesWhere(row, where)),
        orderBy,
      );
      return hydrateTestResults(rows, include);
    },
    async findFirst({
      where,
      include,
      orderBy,
    }: {
      where?: Record<string, unknown>;
      include?: { answers?: boolean; analysisReport?: boolean };
      orderBy?: unknown;
    } = {}) {
      const rows = applyOrder(
        testResultRows.filter((row) => matchesWhere(row, where)),
        orderBy,
      );
      const [first] = hydrateTestResults(rows.slice(0, 1), include);
      return first ?? null;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return testResultRows.find((row) => row.id === where.id) ?? null;
    },
  },
  problemAnswer: {
    async create({
      data,
    }: {
      data: {
        testResultId: string;
        problemId: string;
        selectedChoice: number | null;
        essayScore: number | null;
        isCorrect: boolean;
        sequence: number;
      };
    }) {
      const row: ProblemAnswerRow = {
        id: randomUUID(),
        testResultId: data.testResultId,
        problemId: data.problemId,
        selectedChoice: data.selectedChoice,
        essayScore: data.essayScore,
        isCorrect: data.isCorrect,
        sequence: data.sequence,
      };
      problemAnswerRows.push(row);
      return row;
    },
    async findMany({ where }: { where?: Record<string, unknown> } = {}) {
      return problemAnswerRows.filter((row) => matchesWhere(row, where));
    },
  },
  analysisReport: {
    async create({
      data,
    }: {
      data: {
        testResultId: string;
        totalScore: number;
        predictedScore: number;
        unitScores: Record<string, number>;
        difficultyDistribution: Record<
          Difficulty,
          { correct: number; total: number }
        >;
        recommendedUnits: string[];
      };
    }) {
      const row: AnalysisReportRow = {
        id: randomUUID(),
        testResultId: data.testResultId,
        totalScore: data.totalScore,
        predictedScore: data.predictedScore,
        unitScores: data.unitScores,
        difficultyDistribution: data.difficultyDistribution,
        recommendedUnits: data.recommendedUnits,
        createdAt: new Date(),
      };
      analysisReportRows.push(row);
      return row;
    },
    async findUnique({ where }: { where: { testResultId: string } }) {
      return (
        analysisReportRows.find(
          (row) => row.testResultId === where.testResultId,
        ) ?? null
      );
    },
  },
  exam: {
    async findUnique({ where }: { where: { externalExamId: string } }) {
      return (
        examRows.find((row) => row.externalExamId === where.externalExamId) ??
        null
      );
    },
    async findMany({ where }: { where?: Record<string, unknown> } = {}) {
      return examRows.filter((row) => matchesWhere(row, where));
    },
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return examRows.filter((row) => matchesWhere(row, where)).length;
    },
    async upsert({
      where,
      update,
      create,
    }: {
      where: { externalExamId: string };
      update: Partial<
        Omit<ExamRow, "id" | "externalExamId" | "createdAt" | "updatedAt">
      >;
      create: Omit<ExamRow, "id" | "createdAt" | "updatedAt">;
    }) {
      const now = new Date();
      const row = examRows.find(
        (r) => r.externalExamId === where.externalExamId,
      );
      if (row) {
        Object.assign(row, update, { updatedAt: now });
        return row;
      }
      const created: ExamRow = {
        id: randomUUID(),
        ...create,
        createdAt: now,
        updatedAt: now,
      };
      examRows.push(created);
      return created;
    },
  },
  examQuestion: {
    async findMany({ where }: { where?: Record<string, unknown> } = {}) {
      return examQuestionRows.filter((row) => matchesWhere(row, where));
    },
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return examQuestionRows.filter((row) => matchesWhere(row, where)).length;
    },
    async deleteMany({ where }: { where?: Record<string, unknown> } = {}) {
      const keep = examQuestionRows.filter((row) => !matchesWhere(row, where));
      const removed = examQuestionRows.length - keep.length;
      examQuestionRows = keep;
      return { count: removed };
    },
    async createMany({ data }: { data: Array<Omit<ExamQuestionRow, "id">> }) {
      const rows = data.map((d) => ({ id: randomUUID(), ...d }));
      examQuestionRows.push(...rows);
      return { count: rows.length };
    },
  },
  // T7.14 '오늘의 시험' 조회 라우트는 이 둘을 **읽기만** 한다 — 쓰기 메서드를 두지 않는다.
  predictionRun: {
    async findMany({
      where,
      orderBy,
      take,
      select,
    }: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
      take?: number;
      select?: Record<string, unknown>;
    } = {}) {
      return applySelect(
        paginate(
          applyOrder(
            predictionRunRows.filter((row) => matchesWhere(row, where)),
            orderBy,
          ),
          0,
          take,
        ),
        select,
      );
    },
    async findUnique({
      where,
      select,
    }: {
      where: { id: string };
      select?: Record<string, unknown>;
    }) {
      const row = predictionRunRows.find((r) => r.id === where.id) ?? null;
      if (!row) return null;
      return applySelect([row], select)[0];
    },
  },
  actualExamScore: {
    async findMany({ where }: { where?: Record<string, unknown> } = {}) {
      return actualExamScoreRows.filter((row) => matchesWhere(row, where));
    },
  },
};

/**
 * T7.14 전용 시드 헬퍼. `PredictionRun`/`ActualExamScore` 는 기본이 빈 배열이라
 * (아직 예측을 안 돌린 상태가 정상) 필요한 테스트만 직접 채운다.
 */
export function seedPredictionRuns(rows: PredictionRunRow[]) {
  // 🔴 실제 컬럼은 NULL 이지 **부재**가 아니다. `exam_date` 는 스키마에 늘 있고
  //    Prisma 는 select 하면 항상 값(또는 null)을 돌려준다. 픽스처가 생략한 것을 그대로
  //    두면 select 투영에서 "없는 필드"가 된다. 여기서 DB 기본값(NULL)으로 정규화한다.
  //    ⚠️ NOT NULL 컬럼(`user_id`)은 **채우지 않는다** — 없으면 그대로 터져야 픽스처
  //    누락이 드러난다. 그럴듯한 기본값을 지어넣으면 소유권 테스트가 조용히 무의미해진다.
  predictionRunRows.push(...rows.map((row) => ({ examDate: null, ...row })));
}

export function seedActualExamScores(rows: ActualExamScoreRow[]) {
  actualExamScoreRows.push(...rows);
}

export const prismaTestDouble = {
  ...prismaModels,
  async $transaction<T>(
    arg: ((tx: typeof prismaModels) => Promise<T>) | Promise<unknown>[],
  ): Promise<T | unknown[]> {
    if (typeof arg === "function") {
      const snapshot = structuredClone({
        classRows,
        studentRows,
        unitRows,
        progressRows,
        problemRows,
        testRows,
        testProblemRows,
        testResultRows,
        problemAnswerRows,
        analysisReportRows,
        examRows,
        examQuestionRows,
      });
      try {
        return await arg(prismaModels);
      } catch (error) {
        classRows = snapshot.classRows;
        studentRows = snapshot.studentRows;
        unitRows = snapshot.unitRows;
        progressRows = snapshot.progressRows;
        problemRows = snapshot.problemRows;
        testRows = snapshot.testRows;
        testProblemRows = snapshot.testProblemRows;
        testResultRows = snapshot.testResultRows;
        problemAnswerRows = snapshot.problemAnswerRows;
        analysisReportRows = snapshot.analysisReportRows;
        examRows = snapshot.examRows;
        examQuestionRows = snapshot.examQuestionRows;
        throw error;
      }
    }
    return Promise.all(arg);
  },
};
