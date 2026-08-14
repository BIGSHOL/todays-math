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
  MOCK_PROBLEM_OTHER_USER,
  MOCK_PROBLEMS,
  MOCK_PROGRESS,
  MOCK_STUDENTS,
  MOCK_TEST_PROBLEMS_BY_TEST_ID,
  MOCK_TESTS,
  MOCK_UNITS,
  problemId,
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
  content: string;
  answer: string;
  solution: string | null;
  reviewStatus: ReviewStatus;
  directUseAllowed: boolean;
  pool: "shared" | "private";
  createdAt: Date;
  updatedAt: Date;
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
}

interface TestProblemRow {
  id: string;
  testId: string;
  problemId: string;
  orderIndex: number;
  replaced: boolean;
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
    createdAt: new Date(entity.createdAt),
    updatedAt: new Date(entity.updatedAt),
  };
}

function toTestRow(entity: TestEntity): TestRow {
  return {
    ...entity,
    testDate: new Date(`${entity.testDate}T00:00:00.000Z`),
    printedAt: entity.printedAt ? new Date(entity.printedAt) : null,
    createdAt: new Date(entity.createdAt),
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
  };
}

let classRows: ClassRow[] = [];
let studentRows: StudentRow[] = [];
let unitRows: UnitRow[] = [];
let progressRows: ProgressRow[] = [];
let problemRows: ProblemRow[] = [];
let testRows: TestRow[] = [];
let testProblemRows: TestProblemRow[] = [];

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
    ...extraEligibleProblems(),
  ].map(toProblemRow);
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
    createdAt: new Date("2026-08-12T08:00:00.000Z"),
  });
  testProblemRows.push({
    id: RECENT_BLOCK_TP_ID,
    testId: RECENT_BLOCK_TEST_ID,
    problemId: RECENT_BLOCK_PROBLEM_ID,
    orderIndex: 1,
    replaced: false,
  });
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

  const orClauses = where.OR;
  const rest = { ...where };
  delete rest.OR;
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
      const obj = cond as { in?: unknown[] };
      if (Array.isArray(obj.in)) return obj.in.includes(value);
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
      data: Omit<ProblemRow, "id" | "createdAt" | "updatedAt" | "pool"> & {
        originProblemId?: string | null;
        reviewStatus?: ReviewStatus;
        pool?: "shared" | "private";
      };
    }) {
      const now = new Date();
      const row: ProblemRow = {
        id: randomUUID(),
        ...data,
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
    }: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: unknown;
    } = {}) {
      return paginate(
        problemRows.filter((row) => matchesWhere(row, where)),
        skip,
        take,
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
    }: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: unknown;
    } = {}) {
      return paginate(
        applyOrder(
          testRows.filter((row) => matchesWhere(row, where)),
          orderBy,
        ),
        skip,
        take,
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
      };
    }) {
      const row: TestProblemRow = {
        id: randomUUID(),
        testId: data.testId,
        problemId: data.problemId,
        orderIndex: data.orderIndex,
        replaced: data.replaced ?? false,
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
};

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
        throw error;
      }
    }
    return Promise.all(arg);
  },
};
