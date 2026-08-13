/**
 * 🔴 RED — 대응 구현 태스크: Phase 1, T1.1 (Auth.js 인증 API RED→GREEN)
 *
 * `src/app/api/auth/signup/route.ts`가 아직 존재하지 않으므로 아래 import는 런타임에 모듈
 * 해석에 실패해 이 파일 전체가 FAILED로 보고된다 — 이것이 RED의 정상 상태다(06-tasks.md
 * T0.5.3 완료 조건 "npm run test 실행 시 전부 FAILED"). GREEN 전환은 T1.1에서 아래 경로에
 * Route Handler를 구현하면서 이루어진다.
 *
 * `@ts-expect-error`는 "모듈이 아직 없다"는 예상된 타입 에러를 명시적으로 흡수해
 * `npm run type-check`가 이 RED 파일 때문에 실패하지 않도록 한다 — 구현이 생기면 해당 줄의
 * 에러가 사라져 `@ts-expect-error`가 "사용되지 않음" 에러로 즉시 드러나므로, 구현 완료를
 * 놓치지 않고 이 주석을 제거하도록 강제하는 효과도 있다.
 *
 * 대응 계약: src/contracts/auth.contract.ts
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// @ts-expect-error TODO(T1.1) — src/app/api/auth/signup/route.ts 구현 전까지 모듈이 없다.
import { POST as signup } from "@/app/api/auth/signup/route";

import { authSignupResponseSchema } from "@/contracts/auth.contract";
import { errorResponseSchema } from "@/contracts/common.contract";
import { MOCK_EXISTING_SIGNUP_EMAIL } from "@/mocks/data";

function signupRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[T1.1] POST /api/auth/signup", () => {
  it("유효한 이메일/비밀번호/이름으로 가입하면 201과 사용자 정보를 반환한다", async () => {
    const res = await signup(
      signupRequest({
        email: "new-teacher@example.com",
        password: "password123",
        name: "김원장",
      }),
    );
    expect(res.status).toBe(201);
    const body = authSignupResponseSchema.parse(await res.json());
    expect(body.data.email).toBe("new-teacher@example.com");
  });

  it("응답 본문에 비밀번호(해시 포함)가 노출되지 않는다", async () => {
    const res = await signup(
      signupRequest({
        email: "new-teacher@example.com",
        password: "password123",
        name: "김원장",
      }),
    );
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("짧은 비밀번호(8자 미만)는 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await signup(
      signupRequest({
        email: "a@example.com",
        password: "short",
        name: "김원장",
      }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("빈 본문은 VALIDATION_ERROR(400)를 반환한다", async () => {
    const res = await signup(signupRequest({}));
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("이미 가입된 이메일은 CONFLICT(409)를 반환한다", async () => {
    const res = await signup(
      signupRequest({
        email: MOCK_EXISTING_SIGNUP_EMAIL,
        password: "password123",
        name: "김원장",
      }),
    );
    expect(res.status).toBe(409);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("CONFLICT");
  });
});
