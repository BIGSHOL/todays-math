/**
 * 🟢 GREEN — Phase 1, T1.1 (Auth.js 인증 API RED→GREEN) 구현 완료.
 *
 * 대응 구현: src/app/api/auth/signup/route.ts, src/lib/auth.ts
 * 대응 계약: src/contracts/auth.contract.ts
 *
 * ⚠️ `DATABASE_URL`은 공유 Supabase 프로덕션 DB를 가리킨다 — 이 파일이 실제 DB에 쓰기 시도를
 * 하지 않도록 `@/lib/db`를 hermetic하게 모킹한다. `MOCK_EXISTING_SIGNUP_EMAIL`(=이미 가입된
 * 이메일) 여부만 findUnique 결과로 재현하면 아래 5개 테스트 케이스를 모두 충분히 검증할 수
 * 있다 — 실제 영속 상태를 흉내 낼 필요는 없다(같은 이메일로 두 번 가입 시도하는 테스트가
 * 없으므로 create() 호출 간 상태를 공유하지 않아도 무방).
 */
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { POST as signup } from "@/app/api/auth/signup/route";

import {
  authLoginRequestSchema,
  authSignupRequestSchema,
  authSignupResponseSchema,
} from "@/contracts/auth.contract";
import { errorResponseSchema } from "@/contracts/common.contract";
import { db } from "@/lib/db";
import { MOCK_EXISTING_SIGNUP_EMAIL } from "@/mocks/data";

type MockDbUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
};

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { email: string };
        }): Promise<MockDbUser | null> => {
          if (where.email !== MOCK_EXISTING_SIGNUP_EMAIL) {
            return null;
          }
          return {
            id: crypto.randomUUID(),
            email: where.email,
            name: "김원장",
            passwordHash: "$2a$10$mockmockmockmockmockmockmo",
            createdAt: new Date("2026-01-05T09:00:00Z"),
          };
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: { email: string; name: string; passwordHash: string };
        }): Promise<MockDbUser> => ({
          id: crypto.randomUUID(),
          email: data.email,
          name: data.name,
          passwordHash: data.passwordHash,
          createdAt: new Date(),
        }),
      ),
    },
  },
}));

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

  it("UTF-8 기준 72바이트를 넘는 비밀번호는 잘림 전에 거부한다", async () => {
    const res = await signup(
      signupRequest({
        email: "a@example.com",
        password: "가".repeat(25),
        name: "김원장",
      }),
    );
    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("기존 계정 로그인은 72자를 넘지 않는 다중 바이트 비밀번호를 계속 허용한다", () => {
    const legacyPassword = "가".repeat(25);

    expect(
      authSignupRequestSchema.safeParse({
        email: "legacy@example.com",
        password: legacyPassword,
        name: "김원장",
      }).success,
    ).toBe(false);
    expect(
      authLoginRequestSchema.safeParse({
        email: "legacy@example.com",
        password: legacyPassword,
      }).success,
    ).toBe(true);
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

  it("동시 가입의 P2002 충돌도 CONFLICT(409)로 수렴한다", async () => {
    vi.mocked(db.user.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique constraint", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );

    const res = await signup(
      signupRequest({
        email: "racing@example.com",
        password: "password123",
        name: "김원장",
      }),
    );
    expect(res.status).toBe(409);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("CONFLICT");
  });
});
