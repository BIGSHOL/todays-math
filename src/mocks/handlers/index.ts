import type { HttpHandler } from "msw";

/**
 * MSW 핸들러 레지스트리 (T0.4 — 빈 골격).
 *
 * 도메인별 핸들러는 T0.5.2에서 src/contracts/*.contract.ts 기반으로 채워진다:
 *   - src/mocks/handlers/auth.ts     (가입/로그인)
 *   - src/mocks/handlers/class.ts    (반/학생/진도 CRUD)
 *   - src/mocks/handlers/problem.ts  (문제은행/AI 생성·변형)
 *   - src/mocks/handlers/test.ts     (출제/검수/교체/확정)
 *
 * Claude API 응답도 여기서 고정 픽스처로 모킹한다 — 테스트에서 실제 AI 호출 금지
 * (02-trd.md §7.3, CLAUDE.md 절대 규칙 7).
 */
export const handlers: HttpHandler[] = [];
