/**
 * `@/lib/db`(Prisma 클라이언트) 대체용 인메모리 테스트 더블 — Phase 2, T2.1.
 *
 * 배경: `src/__tests__/api/class.test.ts`는 Route Handler(`src/app/api/classes/**`,
 * `src/app/api/students/**`)를 fetch가 아니라 함수로 직접 호출하므로 MSW(src/mocks/handlers)가
 * 가로챌 수 없다 — 아무 조치가 없으면 실제 Prisma 클라이언트가 .env의 DATABASE_URL(공유
 * Supabase 프로덕션 DB)에 접속해버린다. `vitest.setup.ts`가 `vi.mock("@/lib/db", ...)`로
 * 이 모듈을 주입해 테스트가 실제 DB에 절대 쓰기/읽기를 하지 않도록 막는다.
 *
 * class/student 라우트 핸들러가 실제로 호출하는 Prisma 메서드 부분집합(create/findMany/count/
 * findUnique/update/delete)만 구현한다 — 전체 PrismaClient API를 흉내내지 않는다.
 */
import { randomUUID } from "node:crypto";

import type { ClassEntity, StudentEntity } from "@/contracts/class.contract";
import {
  MOCK_CLASS_OTHER_USER,
  MOCK_CLASSES,
  MOCK_STUDENTS,
} from "@/mocks/data";

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

let classRows: ClassRow[] = [];
let studentRows: StudentRow[] = [];

/** 매 테스트 시작 전 Mock 픽스처(src/mocks/data) 상태로 되돌린다 — 테스트 간 상태 오염 방지. */
export function resetPrismaTestDouble() {
  classRows = [...MOCK_CLASSES, MOCK_CLASS_OTHER_USER].map(toClassRow);
  studentRows = MOCK_STUDENTS.map(toStudentRow);
}
resetPrismaTestDouble();

function matches<T extends object>(row: T, where?: Partial<T>): boolean {
  if (!where) return true;
  return (Object.keys(where) as Array<keyof T>).every(
    (key) => row[key] === where[key],
  );
}

interface FindManyArgs<T> {
  where?: Partial<T>;
  skip?: number;
  take?: number;
  orderBy?: unknown;
}

export const prismaTestDouble = {
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
    async findMany({ where, skip = 0, take }: FindManyArgs<ClassRow> = {}) {
      const filtered = classRows.filter((row) => matches(row, where));
      return take === undefined
        ? filtered.slice(skip)
        : filtered.slice(skip, skip + take);
    },
    async count({ where }: { where?: Partial<ClassRow> } = {}) {
      return classRows.filter((row) => matches(row, where)).length;
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
      // schema.prisma: Student.classId → onDelete: Cascade — 실제 DB가 하는 것과 동일하게
      // 연결된 학생 행도 함께 제거한다.
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
    async findMany({ where, skip = 0, take }: FindManyArgs<StudentRow> = {}) {
      const filtered = studentRows.filter((row) => matches(row, where));
      return take === undefined
        ? filtered.slice(skip)
        : filtered.slice(skip, skip + take);
    },
    async count({ where }: { where?: Partial<StudentRow> } = {}) {
      return studentRows.filter((row) => matches(row, where)).length;
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
};
