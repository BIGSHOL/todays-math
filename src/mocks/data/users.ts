/**
 * Mock 사용자 픽스처 (T0.5.2).
 *
 * 대응 API 경로: POST /api/auth/signup (src/contracts/auth.contract.ts).
 * ⚠️ authUserSchema/classSchema 등 개별 엔티티 스키마는 계약 파일에서 export되지 않는다
 *    (SSOT 설계상 응답 래퍼 스키마만 공개) — 이 픽스처는 `AuthUser` 타입으로 컴파일 타임 검증하고,
 *    런타임 계약 검증은 `authSignupResponseSchema.parse({ data })` 형태로 wrapper를 통해 수행한다
 *    (src/mocks/handlers/auth.ts, src/__tests__/unit/mockHandlers.contract.test.ts 참조).
 */
import type { AuthUser } from "@/contracts/auth.contract";

import { USER_OTHER_ID, USER_TEACHER_ID } from "./ids";

/** 기본 로그인 사용자 — 대부분의 Mock 데이터(반/문제/테스트)의 소유자. */
export const MOCK_TEACHER: AuthUser = {
  id: USER_TEACHER_ID,
  email: "teacher@example.com",
  name: "김원장",
  createdAt: "2026-01-05T09:00:00Z",
};

/** 소유권 검증(403 FORBIDDEN) 테스트 전용 — 다른 학원 강사. */
export const MOCK_OTHER_TEACHER: AuthUser = {
  id: USER_OTHER_ID,
  email: "other-teacher@example.com",
  name: "박강사",
  createdAt: "2026-02-10T09:00:00Z",
};

/** POST /api/auth/signup 중복 이메일(CONFLICT) 재현용 — 이미 가입된 이메일. */
export const MOCK_EXISTING_SIGNUP_EMAIL = MOCK_TEACHER.email;
