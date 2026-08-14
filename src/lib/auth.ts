/**
 * Auth.js(NextAuth v5) 설정 — 이메일/비밀번호(Credentials) + 구글(Google) 로그인.
 *
 * 참조: docs/planning/02-trd.md §3.3(비밀번호 bcrypt), §4.1(Google OAuth)
 *       docs/planning/07-coding-convention.md §5.2(모든 API 세션 확인 + user_id 소유권 검증)
 *
 * 세션 전략: JWT — Credentials Provider는 Auth.js 제약상 database 세션 전략을 쓸 수 없다
 * (Credentials는 어댑터가 세션을 직접 발급하지 않음). @auth/prisma-adapter는 그대로 두어
 * 구글 로그인의 Account/User 연동(및 향후 database 세션 전환 여지)은 유지한다.
 *
 * 이메일 가입(POST /api/auth/signup)은 이 파일과 별개로 `src/app/api/auth/signup/route.ts`가
 * 직접 처리한다(Auth.js Credentials는 "로그인"만 담당, "가입"은 표준 흐름 밖의 커스텀 API).
 */
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import NextAuth, { type DefaultSession } from "next-auth";
// ⚠️ 값 없는(type-only) import지만 제거하면 안 된다 — 아래 `declare module "next-auth/jwt"`
//    보강이 tsc(moduleResolution: bundler)에서 "module cannot be found"(TS2664)로 실패한다.
//    TS가 서브패스 exports 대상 모듈을 증강하려면 해당 모듈을 먼저 실제로 import해 알고
//    있어야 하는 알려진 제약이다.
import type {} from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { authLoginRequestSchema } from "@/contracts/auth.contract";
import { db } from "@/lib/db";

const googleReady =
  Boolean(process.env.GOOGLE_CLIENT_ID) &&
  Boolean(process.env.GOOGLE_CLIENT_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    ...(googleReady
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "이메일", type: "email" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials) {
        const parsed = authLoginRequestSchema.safeParse({
          email: credentials?.email,
          password: credentials?.password,
        });
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.user.findUnique({ where: { email } });
        // 구글 가입 사용자(passwordHash NULL)는 Credentials 로그인을 허용하지 않는다.
        if (!user?.passwordHash || user.deletedAt) {
          return null;
        }

        const isValidPassword = await compare(password, user.passwordHash);
        if (!isValidPassword) {
          return null;
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
});

// Auth.js 표준 타입에 user_id를 실어 나르기 위한 모듈 보강.
// (세션/토큰에 담긴 id는 소유권 검증의 근거가 되므로 string으로 명시한다.)
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
