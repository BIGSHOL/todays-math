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
  it("여덟 가지뿐이다", () => {
    expect(REVIEWER_CAPABILITIES).toEqual([
      "* /api/auth/**",
      "GET /api/problems",
      "GET /api/problems/{id}",
      "POST /api/problems/{id}/reports",
      "PATCH /api/problems/{id}/review-status",
      "GET /api/units",
      "GET /review/**",
      "GET /login",
    ]);
  });
});
