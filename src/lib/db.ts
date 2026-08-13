import { PrismaClient } from "@prisma/client";

/**
 * Prisma 클라이언트 싱글턴.
 *
 * Next.js dev 서버는 파일 변경 시 모듈을 다시 평가(hot reload)하는데,
 * 매번 `new PrismaClient()`를 호출하면 커넥션이 누적되어
 * "too many connections" 오류가 발생한다 (특히 Supabase/Neon 무료 플랜의
 * 커넥션 제한 — 07-coding-convention.md, 02-trd.md §2.3 참조).
 *
 * globalThis에 인스턴스를 캐싱해 dev 환경에서도 프로세스당 1개만 생성되도록 한다.
 * 프로덕션에서는 globalForPrisma를 사용하지 않아도 무방하지만,
 * 동일 패턴을 유지해도 안전하다 (Vercel 서버리스 함수 콜드 스타트마다 재생성됨).
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
