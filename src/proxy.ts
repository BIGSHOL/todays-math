import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requestedCallbackUrl } from "@/lib/callbackUrl";

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

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
