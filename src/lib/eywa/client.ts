/**
 * eywa DB 접속 — **읽기 전용**.
 *
 *   EYWA_DATABASE_URL=postgresql://…   (서버 환경변수로만. `.env` 는 커밋 안 된다)
 *
 * ## 왜 Prisma 인가
 *
 * eywa 는 **다른 Supabase 프로젝트**다(우리 `aws-0`, eywa `aws-1`). 새 드라이버를
 * 넣는 대신 이미 있는 `PrismaClient` 에 `datasources.db.url` 만 갈아 끼우고
 * `$queryRaw` 로 읽는다 — eywa 스키마를 우리 `schema.prisma` 에 옮겨 적을 필요가
 * 없다(옮겨 적으면 eywa 가 컬럼을 바꿀 때 조용히 갈라진다).
 *
 * ## 🔴 읽기 전용을 **규약이 아니라 서버가** 강제한다
 *
 * 여기는 원장님 **운영 DB** 다. 「SELECT 만 쓴다」는 주석은 가드가 아니다.
 * 그래서 모든 질의를 `SET TRANSACTION READ ONLY` 를 건 트랜잭션 안에서 돌린다 —
 * 우리 코드에 버그가 나도 Postgres 가 `25006` 으로 거절한다.
 *
 * ## 🔴 처음 쓴 가드는 **조용히 안 먹었다**
 *
 * 처음엔 접속 문자열에 `?options=-c default_transaction_read_only=on` 을 실었다.
 * 실측해 보니 **Supabase 풀러(pgbouncer)가 그 시작 옵션을 안 넘겨서** 쓰기가
 * 그대로 통과했다. 오류도 경고도 없었다 — 「가드가 있다」는 주석만 남았을 것이다.
 * 그래서 그 방식을 **뺐다.** 안 먹는 가드는 없느니만 못하다(거짓 안심을 준다).
 *
 * 지금 가드는 `scripts/qa/probe-eywa-readonly.ts` 가 **실제로 쓰기를 던져** 확인한다.
 * 시험할 수 없는 가드는 장식이다(CLAUDE.md 2026-08-18).
 */
import { PrismaClient } from "@prisma/client";

/** 트랜잭션을 읽기 전용으로 만드는 문장. **BEGIN 직후 첫 문장이어야 한다.** */
export const READ_ONLY_STATEMENT = "set transaction read only";

/** Postgres 가 읽기 전용 트랜잭션에서 쓰기를 거절할 때 내는 SQLSTATE. */
export const READ_ONLY_SQLSTATE = "25006";

export class EywaNotConfiguredError extends Error {
  constructor() {
    super(
      "EYWA_DATABASE_URL 이 없다. eywa 진도를 가져오려면 서버 환경변수로 넣어라 " +
        "(값은 eywa 저장소의 .env.local 에 있다).",
    );
    this.name = "EywaNotConfiguredError";
  }
}

export function createEywaClient(
  rawUrl = process.env.EYWA_DATABASE_URL,
): PrismaClient {
  if (!rawUrl) throw new EywaNotConfiguredError();
  return new PrismaClient({ datasources: { db: { url: rawUrl } } });
}

/**
 * eywa 를 읽는 **유일한 통로.** 부르는 쪽은 이 함수만 쓴다 — `client.$queryRaw` 를
 * 직접 부르면 가드 밖이다(`src/__tests__/unit/eywaClient.test.ts` 가 그걸 막는다).
 *
 * `sql` 은 우리가 이 저장소 안에 적는 상수만 넣는다. 사용자 입력을 이어 붙이지
 * 말고 `params` 로 넘겨라(`$1`, `$2` …).
 */
export async function eywaQuery<T>(
  client: PrismaClient,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(READ_ONLY_STATEMENT);
    return tx.$queryRawUnsafe<T[]>(sql, ...params);
  });
}
