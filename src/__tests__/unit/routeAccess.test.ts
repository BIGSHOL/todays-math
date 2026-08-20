/**
 * 역할 게이트 — 검수 계정이 어디까지 갈 수 있나.
 *
 * 구현: src/lib/routeAccess.ts · 부르는 곳: src/middleware.ts
 *
 * 여기서 잠그는 것은 **제품 규칙**이다:
 *  ⑴ 모르는 경로는 **닫힌다** — 목록에 적는 걸 잊어도 열리지 않는다.
 *  ⑵ 메서드를 가린다 — 「문제은행을 본다」와 「문항을 만든다」는 다른 일이다.
 *  ⑶ 한 칸짜리 자리(`{id}`)가 `/` 를 넘지 않는다 — 넘으면 하위 경로가 딸려 열린다.
 */
import { describe, expect, it } from "vitest";

import { REVIEWER_CAPABILITIES, routeAccessFor } from "@/lib/routeAccess";

/** 원장만 할 수 있는 일. 검수 계정이 여기에 닿으면 안 된다. */
const 원장_전용 = [
  ["POST", "/api/tests/generate"],
  ["GET", "/api/tests"],
  ["POST", "/api/classes"],
  ["GET", "/api/classes"],
  ["PATCH", "/api/classes/c1"],
  ["POST", "/api/students"],
  ["POST", "/api/progress/advance"],
  ["GET", "/api/exam/rounds"],
  ["POST", "/api/predictions"],
  ["POST", "/api/problems/generate"],
  ["POST", "/api/problems/transform"],
  ["POST", "/api/problems/transform/adopt"],
  ["GET", "/api/metrics"],
  ["GET", "/"],
  ["GET", "/classes"],
  ["GET", "/tests/new"],
  ["GET", "/dev/print-check"],
  // `/api/review/queue` 만 열었다 — 그 아래를 통째로 연 것이 아니다.
  ["POST", "/api/review/queue"],
  ["GET", "/api/review/reports"],
] as const;

/** 검수 계정이 실제로 하는 일. */
const 검수_가능 = [
  ["GET", "/api/problems"],
  ["GET", "/api/problems/9d4f0f1e-0000-4000-8000-000000000001"],
  ["POST", "/api/problems/9d4f0f1e-0000-4000-8000-000000000001/reports"],
  ["PATCH", "/api/problems/9d4f0f1e-0000-4000-8000-000000000001/review-status"],
  ["GET", "/api/units"],
  ["GET", "/review"],
  ["GET", "/review/queue"],
  ["GET", "/login"],
  ["POST", "/api/auth/callback/credentials"],
] as const;

describe("역할 게이트 — 원장", () => {
  it("원장은 어디든 간다", () => {
    for (const [m, p] of [...원장_전용, ...검수_가능]) {
      expect(routeAccessFor("director", m, p), `${m} ${p}`).toBe("allow");
    }
  });
});

describe("역할 게이트 — 검수 계정", () => {
  it("검수에 필요한 것은 된다", () => {
    for (const [m, p] of 검수_가능) {
      expect(routeAccessFor("reviewer", m, p), `${m} ${p}`).toBe("allow");
    }
  });

  it("🔴 원장 일은 안 된다", () => {
    for (const [m, p] of 원장_전용) {
      expect(routeAccessFor("reviewer", m, p), `${m} ${p}`).toBe("deny");
    }
  });

  it("🔴 **모르는 경로는 닫힌다** — 목록에 적는 걸 잊어도 열리지 않는다", () => {
    // 아직 없는 라우트다. 나중에 생겼을 때 «적는 걸 잊으면 열리는» 구조라면
    // 이 단언이 초록으로 바뀐다.
    expect(routeAccessFor("reviewer", "POST", "/api/아직-없는-것")).toBe(
      "deny",
    );
    expect(routeAccessFor("reviewer", "GET", "/아직-없는-화면")).toBe("deny");
  });

  it("🔴 메서드를 가린다 — 보는 것과 만드는 것은 다른 일이다", () => {
    expect(routeAccessFor("reviewer", "GET", "/api/problems")).toBe("allow");
    expect(routeAccessFor("reviewer", "POST", "/api/problems")).toBe("deny");
    expect(routeAccessFor("reviewer", "DELETE", "/api/problems/p1")).toBe(
      "deny",
    );
    expect(routeAccessFor("reviewer", "PATCH", "/api/problems/p1")).toBe(
      "deny",
    );
  });

  it("🔴 한 칸짜리 자리가 `/` 를 넘지 않는다 — 넘으면 하위 경로가 딸려 열린다", () => {
    expect(routeAccessFor("reviewer", "GET", "/api/problems/p1")).toBe("allow");
    expect(routeAccessFor("reviewer", "GET", "/api/problems/p1/results")).toBe(
      "deny",
    );
    expect(
      routeAccessFor("reviewer", "POST", "/api/problems/p1/reports/extra"),
    ).toBe("deny");
  });

  it("끝의 `/` 는 같은 경로다", () => {
    expect(routeAccessFor("reviewer", "GET", "/review/")).toBe("allow");
    expect(routeAccessFor("reviewer", "GET", "/api/problems/")).toBe("allow");
  });

  it("메서드 대소문자를 가리지 않는다", () => {
    expect(routeAccessFor("reviewer", "get", "/api/problems")).toBe("allow");
  });
});

describe("검수 계정이 할 수 있는 일의 목록", () => {
  /**
   * 🔴 목록을 **여기 그대로 못 박는다.** 규칙이 하나라도 늘거나 넓어지면 이 테스트가
   *    빨개져서, 「검수 계정에게 무엇을 더 열어 줬는가」가 리뷰에 보인다.
   *    (권한이 조용히 넓어지는 것을 막는 유일한 장치다.)
   */
  it("열두 가지뿐이다", () => {
    expect(REVIEWER_CAPABILITIES).toEqual([
      "* /api/auth/**",
      "GET /api/problems",
      "GET /api/problems/{id}",
      "POST /api/problems/{id}/reports",
      "PATCH /api/problems/{id}/review-status",
      "POST /api/problems/{id}/review",
      "GET /api/review/queue",
      "GET /api/units",
      // 2026-08-20 에 **읽기 둘**을 열었다. 이게 없으면 검수 계정은 문항 그림을
      // 하나도 못 받아 빈칸을 보고 판정하게 된다(307 리다이렉트, 에러 없음).
      "GET /figures/**",
      "GET /figures-svg/**",
      "GET /review/**",
      "GET /login",
    ]);
  });
});

describe("🔴 검수자가 **볼 수 있어야** 하는 것 — 막는 것만 시험하면 안 된다", () => {
  /**
   * 이 결함은 실제로 났다(2026-08-20). 역할 게이트를 넣으면서 **막을 것**만 세고
   * **지나가야 할 것**은 안 셌다. `proxy.ts` 의 matcher 는 `_next/static` 만
   * 빼므로 `public/` 밑 그림 파일도 이 관문을 지난다 — 허용 목록에 없으면 307 이다.
   *
   * 그리고 이 결함은 **조용하다.** 검수 화면은 에러 없이 그냥 그림 자리가 빈다.
   * 검수자는 빈칸을 보고 「문제 없다」를 누른다 — 막힌 것보다 나쁘다.
   */
  it.each([
    "/figures/4434/q05.png",
    "/figures/rpm/019fd1d7-da72-77fc-b35b-441b5e06ffed/0.png",
    "/figures-svg/rpm/019fd1db-e23d-7787-85b9-08d4c53b49d9/0.svg",
    "/figures/3635/pdf-q17.jpeg",
  ])("검수자가 그림 %s 를 받을 수 있다", (p) => {
    expect(routeAccessFor("reviewer", "GET", p)).toBe("allow");
  });

  it("그림 경로라도 **쓰기**는 못 한다 — 읽기만 열었다", () => {
    expect(routeAccessFor("reviewer", "POST", "/figures/a.png")).toBe("deny");
    expect(routeAccessFor("reviewer", "DELETE", "/figures/a.png")).toBe("deny");
  });
});
