/**
 * 세션 헬퍼 — 이후 모든 API(`src/app/api/**`)의 소유권 검증(`user_id` 일치 여부)에
 * 재사용되는 공용 함수 (T1.1 REFACTOR 산출물).
 *
 * 참조: docs/planning/07-coding-convention.md §5.2 "모든 API에서 세션 확인 + user_id 소유권 검증"
 *
 * 사용 예 (T2.1 이후 각 Route Handler):
 * ```ts
 * const sessionUser = await getSessionUser();
 * if (!sessionUser) return unauthorizedError();
 * // ... sessionUser.id로 Prisma where 절 소유권 필터링
 * ```
 */
import { auth } from "@/lib/auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

/** 현재 요청의 로그인 사용자를 반환한다. 미인증이면 null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
  };
}
