// Vitest 전역 셋업 (T0.4 — 테스트 인프라)
// 참조: docs/planning/02-trd.md §7.3 (테스트 도구), §7.6 (품질 게이트)
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";

import { server } from "@/mocks/server";

// MSW: 등록되지 않은 요청은 에러로 처리 — 실제 네트워크/AI 호출이 테스트에
// 몰래 나가는 것을 원천 차단한다 (Claude API 포함, 07-coding-convention §5).
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => {
  server.close();
});
