/**
 * 모든 요청이 지나는 관문 — 로그인 확인과 **역할 게이트**.
 *
 * 역할 규칙: src/lib/routeAccess.ts (허용 목록)
 *
 * ⚠️ Next 16 은 `middleware` 를 `proxy` 로 바꿨다. 둘 다 있으면 **서버가 안 뜬다**
 *    (2026-08-20 에 실제로 그랬다 — 단위 테스트 148파일이 전부 초록인데 앱이 안 켜졌다).
 *    관문은 **이 파일 하나**다. `src/middleware.ts` 를 새로 만들지 말 것.
 *
 * 왜 관문 하나인가: 라우트마다 검사를 넣으면 **새 라우트에서 넣는 걸 잊는다.**
 * 그리고 잊었을 때 열려 버린다. 관문이 하나면 잊을 자리가 없다.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requestedCallbackUrl } from "@/lib/callbackUrl";
import { routeAccessFor } from "@/lib/routeAccess";

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/dev/") ||
    pathname === "/favicon.ico";

  if (!req.auth && !isPublic) {
    const login = new URL("/login", req.nextUrl);
    login.searchParams.set(
      "callbackUrl",
      requestedCallbackUrl(pathname, req.nextUrl.search),
    );
    return NextResponse.redirect(login);
  }

  /**
   * 역할 게이트. 로그인 안 한 요청은 여기서 판정하지 않는다 —
   * 화면은 위에서 로그인으로 보냈고, API 는 각 라우트가 401 을 낸다.
   *
   * ⚠️ `role` 이 **없는** 세션은 원장으로 본다. DB 기본값이 director 이고,
   *    이 기능이 나가기 전에 발급된 토큰은 전부 원장 것이다.
   *    반대로 읽으면 배포 순간 **원장이 자기 서비스에서 잠긴다.**
   */
  if (req.auth) {
    const role = req.auth.user?.role === "reviewer" ? "reviewer" : "director";
    if (routeAccessFor(role, req.method, pathname) === "deny") {
      if (pathname.startsWith("/api/")) {
        // 화면용 리다이렉트를 API 에 주면 fetch 가 HTML 을 파싱하다 죽는다.
        return NextResponse.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "검수 전용 계정은 이 기능을 쓸 수 없습니다.",
            },
          },
          { status: 403 },
        );
      }
      // 화면이면 검수 콘솔로 되돌린다 — 빈 「권한 없음」 화면보다 낫다.
      const url = req.nextUrl.clone();
      url.pathname = "/review";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
