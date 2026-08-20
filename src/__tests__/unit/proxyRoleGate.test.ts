/**
 * 역할 게이트의 관문 — src/proxy.ts.
 *
 * 🔴 **`src/middleware.ts` 가 아니다.** Next 16 은 `middleware` 를 `proxy` 로 바꿨고,
 *    둘 다 있으면 **서버가 안 뜬다.** 처음에 middleware.ts 로 만들었더니 단위 테스트
 *    148파일이 전부 초록인데 앱이 안 켜졌다(2026-08-20) — 단위 테스트는 모듈을
 *    직접 부르므로 「Next 가 이 파일을 어떻게 읽는가」라는 축이 아예 없다.
 *
 * 규칙 자체는 routeAccess.test.ts 가 잠근다. 여기서 보는 것은 **배선**이다:
 *  ⑴ 막힌 API 는 403 **JSON** 이다 — 화면용 리다이렉트를 API 에 주면 fetch 가
 *     엉뚱한 HTML 을 파싱하다 죽는다.
 *  ⑵ 막힌 화면은 검수 콘솔로 되돌린다 — 빈 「권한 없음」 화면보다 낫다.
 *  ⑶ 🔴 `role` 이 **없는** 토큰은 원장이다. 여기서 reviewer 로 읽으면
 *     이 기능이 나가는 순간 **원장이 자기 서비스에서 잠긴다**(기존 토큰엔 role 이 없다).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `auth()` 래퍼를 세워 준다. 진짜 Auth.js 를 태우면 이 테스트가 DB·쿠키까지
 * 끌고 오게 되어, 정작 보려는 **역할 판정 배선**이 잡음에 묻힌다.
 *
 * ⚠️ `vi.mock` 은 **끌어올려진다** — 평범한 const 로 두면 목 공장이 먼저 돌아
 *    아직 없는 변수를 본다(`session is not defined`). 그래서 `vi.hoisted`.
 */
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  auth: (handler: (req: unknown) => unknown) => (request: NextRequest) =>
    handler(Object.assign(request, { auth: session() })),
}));

import { proxy } from "@/proxy";

function req(method: string, path: string) {
  return new NextRequest(`http://localhost${path}`, { method });
}

/**
 * 부르는 자리를 한곳에 모은다.
 *
 * `proxy` 의 타입은 Auth.js 가 붙인 것이라 `(req, ctx)` 를 받고 `void` 도 낼 수
 * 있다고 되어 있다. 여기서는 위의 목이 그 자리를 대신하므로 실제로는 늘
 * `Response` 다 — 그 좁히기를 **한 군데서만** 한다. 검사마다 캐스팅을 흩뿌리면
 * 나중에 진짜 `void` 가 새도 아무도 못 본다.
 */
async function run(method: string, path: string): Promise<Response> {
  const call = proxy as unknown as (r: NextRequest) => Promise<Response>;
  return await call(req(method, path));
}

beforeEach(() => {
  session.mockReset();
});

describe("관문은 하나다", () => {
  /**
   * 🔴 이 검사가 없어서 **서버가 안 뜨는 커밋**을 만들 뻔했다(2026-08-20).
   *    Next 16 은 `middleware` 를 `proxy` 로 바꿨고, 둘 다 있으면
   *    「Both middleware file and proxy file are detected」로 죽는다.
   *    단위 테스트는 모듈을 직접 부르므로 이 축이 **구조적으로 없다** —
   *    그래서 파일이 있는지를 직접 센다.
   */
  it("🔴 middleware 파일이 있으면 안 된다 — proxy 와 둘 다 있으면 서버가 안 뜬다", () => {
    const roots = [".", "src"];
    const found = roots
      .flatMap((r) =>
        ["middleware.ts", "middleware.js"].map((f) => path.join(r, f)),
      )
      .filter((p) => existsSync(path.join(process.cwd(), p)));
    expect(found, `이 파일들을 지워라: ${found.join(", ")}`).toEqual([]);
  });

  it("proxy 파일은 있어야 한다", () => {
    expect(existsSync(path.join(process.cwd(), "src", "proxy.ts"))).toBe(true);
  });
});

describe("역할 게이트 관문", () => {
  it("로그인 안 했으면 여기서 판정하지 않는다 — 각 라우트가 401 을 낸다", async () => {
    session.mockReturnValue(null);
    const res = await run("GET", "/api/tests");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("원장은 지나간다", async () => {
    session.mockReturnValue({ user: { id: "u1", role: "director" } });
    const res = await run("POST", "/api/tests/generate");
    expect(res.status).toBe(200);
  });

  it("🔴 role 이 없는 토큰은 원장이다 — 기존 로그인이 잠기면 안 된다", async () => {
    session.mockReturnValue({ user: { id: "u1" } });
    const res = await run("POST", "/api/tests/generate");
    expect(res.status).toBe(200);
  });

  it("🔴 검수 계정이 원장 API 를 부르면 403 **JSON** 이다", async () => {
    session.mockReturnValue({ user: { id: "u2", role: "reviewer" } });
    const res = await run("POST", "/api/tests/generate");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("🔴 검수 계정이 원장 화면에 들어가면 검수 콘솔로 되돌린다", async () => {
    session.mockReturnValue({ user: { id: "u2", role: "reviewer" } });
    const res = await run("GET", "/classes");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/review");
  });

  it("검수 계정도 검수에 필요한 것은 지나간다", async () => {
    session.mockReturnValue({ user: { id: "u2", role: "reviewer" } });
    for (const [m, p] of [
      ["GET", "/review"],
      ["GET", "/api/problems"],
      ["POST", "/api/problems/p1/reports"],
      ["PATCH", "/api/problems/p1/review-status"],
    ] as const) {
      const res = await run(m, p);
      expect(res.status, `${m} ${p}`).toBe(200);
    }
  });

  it("되돌릴 때 원래 질의 문자열을 끌고 가지 않는다", async () => {
    session.mockReturnValue({ user: { id: "u2", role: "reviewer" } });
    const res = await run("GET", "/tests/new?classId=c1&grade=3");
    expect(new URL(res.headers.get("location") ?? "").search).toBe("");
  });
});
