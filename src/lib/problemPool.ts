/**
 * 문제 풀 조회 조건 (D-31).
 * 지시가 없으면 전부 공용. 은행·출제는 shared 또는 본인 private만 본다.
 */
export const DEFAULT_PROBLEM_POOL = "shared" as const;

export function problemVisibleWhere(userId: string) {
  return {
    OR: [{ pool: DEFAULT_PROBLEM_POOL }, { userId }],
  };
}

export function isProblemAccessible(
  problem: { pool: string; userId: string },
  userId: string,
): boolean {
  return problem.pool === DEFAULT_PROBLEM_POOL || problem.userId === userId;
}
