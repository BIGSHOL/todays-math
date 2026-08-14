/**
 * 소유권 검증 공용 헬퍼 — "존재하지 않으면 404(NOT_FOUND), 존재하지만 로그인 사용자 소유가
 * 아니면 403(FORBIDDEN)" 패턴을 반(Class)·학생(Student)·문제(Problem)·시험지(Test) API가 공유한다.
 * (06-tasks.md T2.1 REFACTOR: "소유권 검증 미들웨어 패턴 통일").
 *
 * MSW 목 핸들러 쪽 대응물: src/mocks/handlers/class.ts의 findClass().
 */
import type {
  Class as ClassRow,
  Problem as ProblemRow,
  Student as StudentRow,
  Test as TestRow,
} from "@prisma/client";

import { db } from "@/lib/db";
import { forbiddenError, notFoundError } from "@/lib/apiResponse";
import { isProblemAccessible } from "@/lib/problemPool";

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

/**
 * 학생이 존재·소유권 OK이고, 요청의 classId에 실제로 소속인지까지 확인한다.
 * 진도 API·출제 API가 반·학생 조합을 받을 때 잘못된 조합을 "존재하지 않는 학생"으로
 * 취급하기 위한 헬퍼.
 */
export async function requireOwnedStudentInClass(
  studentId: string,
  classId: string,
  userId: string,
): Promise<OwnershipResult<StudentRow>> {
  const owned = await requireOwnedStudent(studentId, userId);
  if (!owned.ok) return owned;
  if (owned.data.classId !== classId) {
    return { ok: false, response: notFoundError("학생") };
  }
  return owned;
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

/**
 * 문제가 존재하고, 공용 풀이거나 로그인 사용자 소유인지 확인한다 (D-31).
 * 은행 단건 조회·수정·삭제·검수·변형 원본에 쓴다. private는 소유자만.
 */
export async function requireAccessibleProblem(
  problemId: string,
  userId: string,
): Promise<OwnershipResult<ProblemRow>> {
  const problem = await db.problem.findUnique({ where: { id: problemId } });
  if (!problem) return { ok: false, response: notFoundError("문제") };
  if (!isProblemAccessible(problem, userId)) {
    return { ok: false, response: forbiddenError() };
  }
  return { ok: true, data: problem };
}

/** 시험지가 존재하고, 로그인 사용자(userId) 소유인지 확인한다. */
export async function requireOwnedTest(
  testId: string,
  userId: string,
): Promise<OwnershipResult<TestRow>> {
  const test = await db.test.findUnique({ where: { id: testId } });
  if (!test) return { ok: false, response: notFoundError("테스트") };
  if (test.userId !== userId) {
    return { ok: false, response: forbiddenError() };
  }
  return { ok: true, data: test };
}
