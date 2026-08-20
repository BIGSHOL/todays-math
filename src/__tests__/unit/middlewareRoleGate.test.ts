/**
 * 역할 게이트의 관문 — src/middleware.ts.
 *
 * 규칙 자체는 routeAccess.test.ts 가 잠근다. 여기서 보는 것은 **배선**이다:
 *  ⑴ 막힌 API 는 403 **JSON** 이다 — 화면용 리다이렉트를 API 에 주면 fetch 가
 *     엉뚱한 HTML 을 파싱하다 죽는다.
 *  ⑵ 막힌 화면은 검수 콘솔로 되돌린다 — 빈 「권한 없음」 화면보다 낫다.
 *  ⑶ 🔴 `role` 이 **없는** 토큰은 원장이다. 여기서 reviewer 로 읽으면
 *     이 기능이 나가는 순간 **원장이 자기 서비스에서 잠긴다**(기존 토큰엔 role 이 없다).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getToken = vi.fn();
vi.mock("next-auth/jwt", () => ({
  getToken: (...a: unknown[]) => getToken(...a),
}));

import { middleware } from "@/middleware";

function req(method: string, path: string) {
  return new NextRequest(`http://localhost${path}`, { method });
}

beforeEach(() => {
  getToken.mockReset();
});

describe("역할 게이트 관문", () => {
  it("로그인 안 했으면 여기서 판정하지 않는다 — 각 라우트가 401 을 낸다", async () => {
    getToken.mockResolvedValue(null);
    const res = await middleware(req("GET", "/api/tests"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("원장은 지나간다", async () => {
    getToken.mockResolvedValue({ id: "u1", role: "director" });
    const res = await middleware(req("POST", "/api/tests/generate"));
    expect(res.status).toBe(200);
  });

  it("🔴 role 이 없는 토큰은 원장이다 — 기존 로그인이 잠기면 안 된다", async () => {
    getToken.mockResolvedValue({ id: "u1" });
    const res = await middleware(req("POST", "/api/tests/generate"));
    expect(res.status).toBe(200);
  });

  it("🔴 검수 계정이 원장 API 를 부르면 403 **JSON** 이다", async () => {
    getToken.mockResolvedValue({ id: "u2", role: "reviewer" });
    const res = await middleware(req("POST", "/api/tests/generate"));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("🔴 검수 계정이 원장 화면에 들어가면 검수 콘솔로 되돌린다", async () => {
    getToken.mockResolvedValue({ id: "u2", role: "reviewer" });
    const res = await middleware(req("GET", "/classes"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/review");
  });

  it("검수 계정도 검수에 필요한 것은 지나간다", async () => {
    getToken.mockResolvedValue({ id: "u2", role: "reviewer" });
    for (const [m, p] of [
      ["GET", "/review"],
      ["GET", "/api/problems"],
      ["POST", "/api/problems/p1/reports"],
      ["PATCH", "/api/problems/p1/review-status"],
    ] as const) {
      const res = await middleware(req(m, p));
      expect(res.status, `${m} ${p}`).toBe(200);
    }
  });

  it("되돌릴 때 원래 질의 문자열을 끌고 가지 않는다", async () => {
    getToken.mockResolvedValue({ id: "u2", role: "reviewer" });
    const res = await middleware(req("GET", "/tests/new?classId=c1&grade=3"));
    expect(new URL(res.headers.get("location") ?? "").search).toBe("");
  });
});
