/**
 * Auth.js(NextAuth v5) 표준 라우트 — 구글 OAuth 콜백 + 이메일 로그인(Credentials) 콜백을
 * 내부적으로 처리한다 (`/api/auth/callback/*`, `/api/auth/session` 등).
 *
 * 실제 Provider/세션 설정은 `src/lib/auth.ts`가 SSOT — 이 파일은 핸들러만 그대로 노출한다.
 */
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
