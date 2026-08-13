// Vitest 전역 셋업 (T0.4 — 테스트 인프라)
// 참조: docs/planning/02-trd.md §7.3 (테스트 도구), §7.6 (품질 게이트)
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { server } from "@/mocks/server";

// Phase 2, T2.1 — `src/__tests__/api/class.test.ts`(및 이후 progress/problem/test API
// 테스트)는 Route Handler를 fetch가 아니라 함수로 직접 호출하므로 MSW(위 server)가 가로챌 수
// 없다. 실제 Prisma 클라이언트(`@/lib/db`)가 .env의 DATABASE_URL(공유 Supabase 프로덕션 DB)에
// 접속하지 않도록, 모든 테스트 파일에서 전역으로 인메모리 테스트 더블로 치환한다.
// (src/mocks/prismaTestDouble.ts 참조 — MSW 기반 mockHandlers.contract.test.ts는 fetch를
// 가로채므로 이 모킹과 무관하다.)
vi.mock("@/lib/db", async () => {
  const { prismaTestDouble } = await import("@/mocks/prismaTestDouble");
  return { db: prismaTestDouble };
});

// MSW: 등록되지 않은 요청은 에러로 처리 — 실제 네트워크/AI 호출이 테스트에
// 몰래 나가는 것을 원천 차단한다 (Claude API 포함, 07-coding-convention §5).
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(async () => {
  const { resetPrismaTestDouble } = await import("@/mocks/prismaTestDouble");
  resetPrismaTestDouble();
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => {
  server.close();
});
