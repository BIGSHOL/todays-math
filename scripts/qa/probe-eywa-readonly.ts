/**
 * eywa 접속이 **정말로 읽기 전용인가** — 쓰기를 던져 거절되는 것을 본다.
 *
 *   npx tsx --env-file=.env scripts/qa/probe-eywa-readonly.ts
 *
 * ## 왜 이렇게까지 하나
 *
 * 「SELECT 만 쓴다」는 주석은 가드가 아니다. 이 저장소는 **텍스트로 쓴 가드가
 * 장식이었던 것**을 여러 번 겪었다(2026-08-18 `LOOP` · 2026-08-20 경로 접두사).
 *
 * 그리고 여기서 **실제로 한 번 걸렸다**: 처음 만든 가드(접속 문자열의
 * `options=-c default_transaction_read_only=on`)는 Supabase 풀러가 옵션을
 * 안 넘겨서 **쓰기가 그대로 통과**했다. 이 검사가 없었으면 원장님 운영 DB 에
 * 무방비로 붙은 채 「읽기 전용」이라고 적혀 있었을 것이다.
 *
 * ## 던지는 쓰기는 가드가 풀려 있어도 **안전한 모양**으로 고른다
 *
 *   · `update students set name = name where false`  ← 0행. 트리거도 안 돈다.
 *   · 그것마저 **롤백되는 트랜잭션 안**에서 던진다.
 *
 * 읽기 전용 트랜잭션은 **행 수와 무관하게 명령 자체를** 거절하므로(25006),
 * 「0행이라 통과」 같은 일은 없다 — 이 검사는 실패를 셀 수 있는 형태다.
 */
import { PrismaClient } from "@prisma/client";

import {
  createEywaClient,
  eywaQuery,
  READ_ONLY_SQLSTATE,
  READ_ONLY_STATEMENT,
} from "@/lib/eywa/client";

const ROLLBACK = "__rollback__";
const WRITE = "update students set name = name where false";

function 거절인가(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === READ_ONLY_SQLSTATE ||
    message.includes(READ_ONLY_SQLSTATE) ||
    /read[- ]only/i.test(message)
  );
}

/** 가드를 **건** 통로로 쓰기를 던진다 — `eywaQuery` 와 같은 방식으로 감싼다. */
async function 가드걸고던진다(
  client: PrismaClient,
): Promise<"거절됨" | "통과됨"> {
  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(READ_ONLY_STATEMENT);
      await tx.$executeRawUnsafe(WRITE);
      throw new Error(ROLLBACK); // 여기 닿았다 = 가드가 풀렸다. 그래도 롤백은 한다.
    });
    return "통과됨";
  } catch (error) {
    if (거절인가(error)) return "거절됨";
    if (error instanceof Error && error.message.includes(ROLLBACK))
      return "통과됨";
    throw error;
  }
}

/** 🔴 **음성 대조군** — 가드를 안 걸면 통과해야 한다. */
async function 가드없이던진다(
  client: PrismaClient,
): Promise<"거절됨" | "통과됨"> {
  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(WRITE);
      throw new Error(ROLLBACK);
    });
    return "통과됨";
  } catch (error) {
    if (거절인가(error)) return "거절됨";
    if (error instanceof Error && error.message.includes(ROLLBACK))
      return "통과됨";
    throw error;
  }
}

async function main() {
  if (!process.env.EYWA_DATABASE_URL) {
    console.error("EYWA_DATABASE_URL 이 없다.");
    process.exit(1);
  }
  const client = createEywaClient();

  const 재원 = await eywaQuery<{ n: number }>(
    client,
    "select count(*)::int n from students where status = 'enrolled'",
  );
  console.log(`읽기: ✅ 성공 (재원생 ${재원[0]?.n}명)`);

  const 걸고 = await 가드걸고던진다(client);
  console.log(
    `가드 건 쓰기:  ${걸고 === "거절됨" ? "✅ 거절됨 (25006)" : "❌ 통과됨 — 가드가 없다"}`,
  );

  // 🔴 음성 대조군이 없으면 「어차피 권한이 없어 거절된 것」과 「우리 가드가 막은 것」을
  //    못 가른다. 양성만 대면 재현율만 재고 지어냄은 구조적으로 0이 된다(2026-08-20).
  const 안걸고 = await 가드없이던진다(client);
  console.log(
    `가드 뺀 쓰기:  ${안걸고 === "통과됨" ? "통과됨 — 위 거절은 **우리 가드가** 한 것" : "거절됨 — 계정 권한이 이미 읽기 전용"}`,
  );

  await client.$disconnect();
  console.log();

  if (걸고 !== "거절됨") {
    console.error("❌ 읽기 전용 가드가 작동하지 않는다. 동기화를 돌리지 마라.");
    process.exit(1);
  }
  if (안걸고 !== "통과됨") {
    console.log(
      "⚠️  가드를 빼도 거절된다 — 계정 권한이 이미 읽기 전용일 수 있다.",
    );
    console.log(
      "    그러면 위 ✅ 는 우리 가드를 증명하지 못한다(안전한 쪽이긴 하다).",
    );
    return;
  }
  console.log(
    "✅ 읽기 전용 가드가 실제로 막고 있다 — 양성·음성 대조군 둘 다 확인.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
