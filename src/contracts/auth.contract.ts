/**
 * 인증 계약 — 이메일 가입 · 로그인.
 *
 * 대응 API 경로:
 *   POST /api/auth/signup   — 이메일 회원가입 (email/password/name, bcrypt 해싱은 구현 레이어 책임)
 *
 * ⚠️ 구글 로그인은 Auth.js(NextAuth v5) Google Provider가 내부적으로 처리하므로
 *    (`/api/auth/[...nextauth]` 표준 라우트) 별도 계약이 필요 없다.
 * ⚠️ 이메일 로그인도 Auth.js Credentials Provider가 `/api/auth/callback/credentials`를
 *    내부 처리한다 — 별도 Route Handler를 만들지 않는다. 아래 authLoginRequestSchema는
 *    로그인 화면(S-01)의 클라이언트 측 폼 검증 + `signIn("credentials", ...)` 호출 페이로드
 *    형태를 정의하기 위한 계약이며, 자체 Route Handler를 갖지 않는다.
 *
 * 참조: docs/planning/02-trd.md §3.3(비밀번호 bcrypt), §4.1(Google OAuth)
 *       docs/planning/04-database-design.md §2.1 (USER — email UNIQUE, name VarChar(50))
 */
import { z } from "zod";

import {
  dataResponseSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.contract";

// User.email VarChar(255)
const emailSchema = z
  .email({ error: "이메일 형식이 올바르지 않습니다." })
  .max(255, {
    error: "이메일은 255자를 초과할 수 없습니다.",
  });

// bcrypt 해싱 대상 원문 비밀번호 — 최소 8자, bcrypt 72바이트 제한 고려해 상한 72자.
const passwordSchema = z
  .string()
  .min(8, { error: "비밀번호는 8자 이상이어야 합니다." })
  .max(72, { error: "비밀번호는 72자를 초과할 수 없습니다." })
  .refine((password) => new TextEncoder().encode(password).byteLength <= 72, {
    error: "비밀번호는 UTF-8 기준 72바이트를 초과할 수 없습니다.",
  });

// User.name VarChar(50)
const displayNameSchema = z
  .string()
  .min(1, { error: "이름을 입력해주세요." })
  .max(50, { error: "이름은 50자를 초과할 수 없습니다." });

// ── 회원가입 ────────────────────────────────────────────────
export const authSignupRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  name: displayNameSchema,
});
export type AuthSignupRequest = z.infer<typeof authSignupRequestSchema>;

const authUserSchema = z.strictObject({
  id: uuidSchema,
  email: emailSchema,
  name: displayNameSchema,
  createdAt: isoDateTimeSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authSignupResponseSchema = dataResponseSchema(authUserSchema);
export type AuthSignupResponse = z.infer<typeof authSignupResponseSchema>;

// ── 로그인 (Auth.js 내부 처리 — 페이로드 형태 정의용) ─────────────
export const authLoginRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
});
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;
