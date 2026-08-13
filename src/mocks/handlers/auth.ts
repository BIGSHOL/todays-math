/**
 * MSW 핸들러 — 인증 (T0.5.2).
 * 대응 계약: src/contracts/auth.contract.ts
 * 대응 API 경로: POST /api/auth/signup
 */
import { http, type HttpHandler } from "msw";

import {
  authSignupRequestSchema,
  authSignupResponseSchema,
} from "@/contracts/auth.contract";

import { MOCK_EXISTING_SIGNUP_EMAIL } from "../data";
import { jsonError, jsonOk, validationError } from "./_helpers";

export const authHandlers: HttpHandler[] = [
  // POST /api/auth/signup — 이메일 회원가입
  http.post("/api/auth/signup", async ({ request }) => {
    const body = await request.json();
    const parsed = authSignupRequestSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    // 대표 실패 경로 — 이미 가입된 이메일(CONFLICT).
    if (parsed.data.email === MOCK_EXISTING_SIGNUP_EMAIL) {
      return jsonError("CONFLICT", "이미 가입된 이메일입니다.", 409);
    }

    return jsonOk(
      authSignupResponseSchema,
      {
        data: {
          id: crypto.randomUUID(),
          email: parsed.data.email,
          name: parsed.data.name,
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  }),
];
