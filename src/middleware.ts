/**
 * 역할 게이트의 **유일한 관문** — 화면이든 API 든 여기 하나로 지난다.
 *
 * 규칙: src/lib/routeAccess.ts (허용 목록)
 *
 * 왜 미들웨어 하나인가: 라우트마다 검사를 넣으면 **새 라우트에서 넣는 걸 잊는다.**
 * 그리고 잊었을 때 열려 버린다. 관문이 하나면 잊을 자리가 없다.
 *
 * ⚠️ 여기서는 **DB 를 안 읽는다.** 역할은 JWT 에 실린 사본으로 본다 —
 *    미들웨어는 모든 요청에 붙으므로 왕복 하나가 전 화면에 곱해진다.
 *    대신 역할을 바꾸면 다시 로그인해야 반영된다(routeAccess.ts 머리말).
 *
 * ⚠️ `role` 이 **없는** 토큰은 원장으로 본다. DB 기본값이 director 이고,
 *    이 기능이 나가기 전에 발급된 토큰은 전부 원장의 것이기 때문이다.
 *    검수 계정의 토큰에는 `reviewer` 가 **반드시 실린다** — 없을 수가 없다.
 *    (여기서 없는 것을 reviewer 로 읽으면 원장이 자기 서비스에서 잠긴다.)
 */
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import { jsonError } from "@/lib/apiResponse";
import { routeAccessFor } from "@/lib/routeAccess";

export async function middleware(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: request.nextUrl.protocol === "https:",
  });

  // 로그인 안 한 요청은 여기서 판정하지 않는다 — 각 라우트가 401 을 낸다.
  if (!token) return NextResponse.next();

  const role = token.role === "reviewer" ? "reviewer" : "director";
  const { pathname } = request.nextUrl;

  if (routeAccessFor(role, request.method, pathname) === "allow") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return jsonError(
      "FORBIDDEN",
      "검수 전용 계정은 이 기능을 쓸 수 없습니다.",
      403,
    );
  }

  // 화면이면 검수 콘솔로 되돌린다 — 「권한 없음」 빈 화면보다 낫다.
  const url = request.nextUrl.clone();
  url.pathname = "/review";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * 정적 자산은 지나가게 둔다. 그림(`/figures/...`)까지 막으면 검수 화면에서
   * 정작 볼 것이 안 보인다.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|figures/|fonts/|.*[.](?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
