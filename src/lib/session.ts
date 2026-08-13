/**
 * 세션 사용자 조회 — Route Handler 공용 헬퍼.
 *
 * ⚠️ 임시 구현 (Phase 2, T2.1): Phase 1, T1.1(Auth.js 인증 API)이 별도 worktree
 * (phase/1-auth)에서 이 파일과 같은 경로(src/lib/session.ts)에 Auth.js(NextAuth v5) 세션
 * 기반 실제 구현을 병렬로 작성 중이다(06-tasks.md T1.1 REFACTOR: "세션 헬퍼(getSessionUser)
 * 추출 — 이후 모든 API의 소유권 검증에 재사용"). main 병합 시 두 브랜치가 이 파일을 각자
 * 수정했다면 **T1.1 버전을 채택**한다 — T2.1(반/학생 API)은 시그니처
 * `getSessionUser(request): Promise<SessionUser | null>`만 지키면 되므로 구현 교체에
 * 영향받지 않는다.
 *
 * 이 임시 버전은 실제 쿠키/JWT를 검증하지 않고 고정된 로그인 사용자 id를 반환한다.
 * 값은 src/mocks/data/ids.ts의 USER_TEACHER_ID와 반드시 동일해야 한다(Mock 픽스처 기준
 * "현재 로그인한 사용자" — 프로덕션 코드가 테스트 전용 모듈을 import하지 않도록 리터럴로
 * 고정했다. 두 값이 어긋나면 class.test.ts의 FORBIDDEN(403) 케이스가 깨진다).
 */
import type { NextRequest } from "next/server";

export interface SessionUser {
  id: string;
}

// src/mocks/data/ids.ts → USER_TEACHER_ID(makeId("1000", 1))와 동일한 값.
const PLACEHOLDER_SESSION_USER_ID = "10000000-0000-4000-8000-000000000001";

/**
 * 요청의 세션 사용자를 반환한다. 로그인하지 않은 요청은 null을 반환해야 한다
 * (호출부는 null이면 401 UNAUTHORIZED로 응답 — src/lib/apiResponse.ts unauthorizedErrorResponse).
 *
 * TODO(T1.1 병합 후): Auth.js 세션(쿠키/JWT) 검증 기반 실제 구현으로 교체.
 */
export async function getSessionUser(
  request: NextRequest,
): Promise<SessionUser | null> {
  void request; // 임시 구현은 요청을 실제로 검사하지 않는다 — 실 구현에서 사용 예정.
  return { id: PLACEHOLDER_SESSION_USER_ID };
}
