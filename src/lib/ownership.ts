/**
 * 소유권 검증 공용 헬퍼 — "존재하지 않으면 404(NOT_FOUND), 존재하지만 로그인 사용자 소유가
 * 아니면 403(FORBIDDEN)" 패턴을 반(Class)·학생(Student)·문제(Problem) API가 공유한다.
 * 이후 Phase 4, T5(시험지 API)도 동일 패턴을 재사용할 수 있다
 * (06-tasks.md T2.1 REFACTOR: "소유권 검증 미들웨어 패턴 통일").
 *
 * MSW 목 핸들러 쪽 대응물: src/mocks/handlers/class.ts의 findClass().
 */
import type {
  Class as ClassRow,
  Problem as ProblemRow,
  Student as StudentRow,
} from "@prisma/client";

import { db } from "@/lib/db";
import { forbiddenError, notFoundError } from "@/lib/apiResponse";

export type OwnershipResult<T> =
  { ok: true; data: T } | { ok: false; response: Response };

/** 반이 존재하고, 로그인 사용자(userId) 소유인지 확인한다. */
export async function requireOwnedClass(
  classId: string,
  userId: string,
): Promise<OwnershipResult<ClassRow>> {
  const cls = await db.class.findUnique({ where: { id: classId } });
  if (!cls) return { ok: false, response: notFoundError("반") };
  if (cls.userId !== userId) {
    return { ok: false, response: forbiddenError() };
  }
  return { ok: true, data: cls };
}

/**
 * 학생이 존재하고, 소속 반이 로그인 사용자(userId) 소유인지 확인한다.
 * Student는 userId를 직접 갖지 않으므로(04-database-design.md §2.6) 소속 Class를 경유해 검증한다.
 */
export async function requireOwnedStudent(
  studentId: string,
  userId: string,
): Promise<OwnershipResult<StudentRow>> {
  const student = await db.student.findUnique({ where: { id: studentId } });
  if (!student) return { ok: false, response: notFoundError("학생") };

  const owned = await requireOwnedClass(student.classId, userId);
  if (!owned.ok) return owned;

  return { ok: true, data: student };
}

/** 문제가 존재하고, 로그인 사용자(userId) 소유인지 확인한다(Problem.userId 직접 소유). */
export async function requireOwnedProblem(
  problemId: string,
  userId: string,
): Promise<OwnershipResult<ProblemRow>> {
  const problem = await db.problem.findUnique({ where: { id: problemId } });
  if (!problem) return { ok: false, response: notFoundError("문제") };
  if (problem.userId !== userId) {
    return { ok: false, response: forbiddenError() };
  }
  return { ok: true, data: problem };
}
