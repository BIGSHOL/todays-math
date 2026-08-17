// Vitest 전역 셋업 (T0.4 — 테스트 인프라)
// 참조: docs/planning/02-trd.md §7.3 (테스트 도구), §7.6 (품질 게이트)
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

import { server } from "@/mocks/server";

// findBy*/waitFor 의 기본 상한 1초를 올린다 (성능 수리 C-2).
//
// 문제 카드(문제은행·검수)는 이제 `next/dynamic` 지연 청크다. 그래서 한 테스트
// 파일의 **첫 렌더**가 KaTeX + unified/remark 모듈 그래프를 처음 적재하는 비용을
// 문다 — 격리 실행에서는 350ms 지만, 전체 실행에서 워커들이 CPU 를 다투면 1초를
// 넘겨 첫 테스트만 간헐 실패했다(3회 중 2회 재현). 두 번째 렌더부터는 모듈이
// 캐시돼 즉시다. **렌더가 느려진 게 아니라 적재 시점이 옮겨간 것**이다.
//
// vitest.config.mts 가 같은 렌더 스택 때문에 testTimeout 을 5초→20초로 올린 것과
// 같은 성질의 조정이다. 단언 내용은 아무것도 바뀌지 않는다 — 깨진 렌더는 여전히
// 실패하고, 다만 1초가 아니라 5초 뒤에 실패한다(testTimeout 20초 안이다).
configure({ asyncUtilTimeout: 5000 });

// Phase 2, T2.1 — `src/__tests__/api/class.test.ts`(및 이후 progress/problem/test API
// 테스트)는 Route Handler를 fetch가 아니라 함수로 직접 호출하므로 MSW(위 server)가 가로챌 수
// 없다. 실제 Prisma 클라이언트(`@/lib/db`)가 .env의 DATABASE_URL(공유 Supabase 프로덕션 DB)에
// 접속하지 않도록, 모든 테스트 파일에서 전역으로 인메모리 테스트 더블로 치환한다.
// (src/mocks/prismaTestDouble.ts 참조 — MSW 기반 mockHandlers.contract.test.ts는 fetch를
// 가로채므로 이 모킹과 무관하다.)
vi.mock("@/lib/db", async () => {
  const mod = await import("@/mocks/prismaTestDouble");
  // prismaTestDouble 모듈 초기화가 끝나기 전에 팩토리가 닫히면 named export가
  // undefined일 수 있다. 프로퍼티 접근 시점에 실객체를 읽도록 프록시로 감싼다.
  const db = new Proxy(
    {},
    {
      get(_target, prop, receiver) {
        return Reflect.get(mod.prismaTestDouble, prop, receiver);
      },
    },
  );
  return { db };
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
