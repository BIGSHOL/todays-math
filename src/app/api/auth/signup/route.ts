/**
 * POST /api/auth/signup — 이메일 회원가입.
 *
 * Auth.js Credentials Provider는 "로그인"만 담당하므로 "가입"은 이 커스텀 Route Handler가
 * 별도로 처리한다(`src/lib/auth.ts` 상단 주석 참조). 성공 시 비밀번호(해시 포함)는 응답에
 * 담지 않는다.
 *
 * 대응 계약: src/contracts/auth.contract.ts
 * 참조: docs/planning/02-trd.md §3.3(비밀번호 bcrypt), 07-coding-convention.md §5.2
 */
import { hash } from "bcryptjs";
import { NextRequest } from "next/server";

import {
  authSignupRequestSchema,
  authSignupResponseSchema,
} from "@/contracts/auth.contract";
import { jsonError, jsonOk, validationError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { isPrismaErrorCode } from "@/lib/prismaErrors";

/** bcrypt salt rounds — 보안/성능 균형의 관행값. */
const BCRYPT_SALT_ROUNDS = 10;

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = authSignupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const { email, password, name } = parsed.data;

  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    return jsonError("CONFLICT", "이미 가입된 이메일입니다.", 409);
  }

  const passwordHash = await hash(password, BCRYPT_SALT_ROUNDS);
  let user;
  try {
    user = await db.user.create({
      data: { email, name, passwordHash },
    });
  } catch (error) {
    // findUnique와 create 사이의 동시 가입도 기존 가입과 같은 응답으로 수렴시킨다.
    if (isPrismaErrorCode(error, "P2002")) {
      return jsonError("CONFLICT", "이미 가입된 이메일입니다.", 409);
    }
    throw error;
  }

  return jsonOk(
    authSignupResponseSchema,
    {
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
