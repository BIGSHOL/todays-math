/**
 * 문항 코드 마이그레이션(`20260818210000_problem_code`)을 이 DB 에 적용한다 (D-53).
 *
 *   npx tsx scripts/qa/apply-problem-code-migration.ts            # 드라이런 — 다 해 보고 ROLLBACK
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-problem-code-migration.ts --apply
 *
 * **왜 `prisma migrate deploy` 를 안 쓰나** — 이 저장소에는 다른 트랙이 남긴 **미적용
 * 마이그레이션이 하나 있다**(`20260817120000_problem_created_at_indexes`, 그 파일 머리에
 * 「공유 Supabase 에는 적용하지 않았다」고 적혀 있다). `deploy` 는 그것까지 같이 적용한다 —
 * 남의 결정을 내가 대신 내리는 셈이라 안 한다. 그래서 이 마이그레이션 **하나만** 적용하고
 * `_prisma_migrations` 에 같은 방식(체크섬 = CR 제거 후 sha256)으로 기록한다.
 *
 * 드라이런은 **정말로 다 해 본다** — DDL 까지 트랜잭션 안에서 실행하고 마지막에 되돌린다
 * (PostgreSQL 은 DDL 이 트랜잭션 대상이다). 「돌려 보지 않은 마이그레이션」을 공유 DB 에
 * 처음 던지지 않으려는 것이다.
 *
 * 되돌리기: 마이그레이션 파일 머리의 DROP 문 다섯 줄. `--revert` 로도 돈다.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const MIGRATION_NAME = "20260818210000_problem_code";
const MIGRATION_PATH = `prisma/migrations/${MIGRATION_NAME}/migration.sql`;

const REVERT_SQL = `
DROP TRIGGER IF EXISTS "problem_code_assign" ON "problem";
DROP TRIGGER IF EXISTS "problem_code_freeze" ON "problem";
DROP FUNCTION IF EXISTS "problem_code_assign"();
DROP FUNCTION IF EXISTS "problem_code_freeze"();
DROP FUNCTION IF EXISTS "problem_code_next"(uuid);
DROP FUNCTION IF EXISTS "problem_code_suffix"();
ALTER TABLE "problem" DROP COLUMN IF EXISTS "problem_code";
ALTER TABLE "unit" DROP COLUMN IF EXISTS "problem_code_prefix";
DELETE FROM "_prisma_migrations" WHERE migration_name = '${MIGRATION_NAME}';
`;

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

// 게이트는 접속 앞에 둔다 (다른 적재 스크립트와 같은 규칙, D-31).
if (APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다. ALLOW_SHARED_IMPORT=1 과 --apply 가 둘 다 필요하다.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

/** Prisma 체크섬 = 마이그레이션 파일에서 CR 을 뺀 뒤 sha256 (실측으로 확인했다). */
function prismaChecksum(text: string): string {
  return createHash("sha256").update(text.replaceAll("\r", "")).digest("hex");
}

/**
 * PL/pgSQL 블록에는 세미콜론이 잔뜩 들어 있어 문장을 그냥 쪼갤 수 없다.
 * `$do$` · `$fn$` 같은 달러 인용 구간을 건너뛰며 자른다.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let tag: string | null = null;
  while (i < sql.length) {
    if (tag) {
      if (sql.startsWith(tag, i)) {
        buf += tag;
        i += tag.length;
        tag = null;
        continue;
      }
    } else {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        tag = m[0];
        buf += tag;
        i += tag.length;
        continue;
      }
      if (sql[i] === ";") {
        out.push(buf);
        buf = "";
        i += 1;
        continue;
      }
    }
    buf += sql[i];
    i += 1;
  }
  if (buf.trim()) out.push(buf);
  return out
    .map((s) => s.trim())
    .filter((s) => s && !/^(--[^\n]*\n?)*$/.test(s));
}

async function smokeTest(tx: PrismaClient) {
  const [{ units, missing }] = (await tx.$queryRawUnsafe(
    `SELECT count(*)::int AS units, count(*) FILTER (WHERE problem_code_prefix IS NULL)::int AS missing FROM "unit"`,
  )) as Array<{ units: number; missing: number }>;
  console.log(`  단원 ${units}건 · 코드 앞부분 빈 것 ${missing}`);

  const [{ dup }] = (await tx.$queryRawUnsafe(
    `SELECT count(*)::int AS dup FROM (SELECT problem_code_prefix FROM "unit" GROUP BY 1 HAVING count(*) > 1) t`,
  )) as Array<{ dup: number }>;
  console.log(`  겹치는 단원 코드 ${dup}`);

  // 트리거가 실제로 붙는가 — 아무 단원에 문항 하나를 넣어 본다(이 트랜잭션은 되돌린다).
  const [unit] = (await tx.$queryRawUnsafe(
    `SELECT id, problem_code_prefix FROM "unit" ORDER BY order_index LIMIT 1`,
  )) as Array<{ id: string; problem_code_prefix: string }>;
  const [user] = (await tx.$queryRawUnsafe(
    `SELECT id FROM "user" LIMIT 1`,
  )) as Array<{ id: string }>;
  if (!user) {
    console.log(
      "  (user 행이 없어 INSERT 연기 — 트리거 확인은 wiring 검증에서)",
    );
    return;
  }
  // ⚠️ **넣었으면 반드시 지운다.** 드라이런은 통째로 ROLLBACK 되지만 `--apply` 는
  //    커밋된다 — 처음엔 그 자리를 빠뜨려 확인용 행 한 개가 공유 DB 에 남았다(바로 지웠다).
  const inserted = (await tx.$queryRawUnsafe(
    `INSERT INTO "problem" (id, user_id, unit_id, source, difficulty, problem_type, content, answer, created_at, updated_at)
     VALUES (gen_random_uuid(), '${user.id}', '${unit.id}', 'manual', 'easy', '계산', '__problem_code_smoke__', '0', now(), now())
     RETURNING id, problem_code`,
  )) as Array<{ id: string; problem_code: string }>;
  console.log(
    `  트리거 확인: ${unit.problem_code_prefix} → ${inserted[0]!.problem_code}`,
  );
  const removed = await tx.$executeRawUnsafe(
    `DELETE FROM "problem" WHERE id = '${inserted[0]!.id}'`,
  );
  console.log(`  확인용 행 정리: ${removed}건 삭제`);
}

async function main() {
  if (REVERT) {
    console.log("되돌리기:", REVERT_SQL.trim().split("\n").length, "문장");
    if (!APPLY) {
      console.log("드라이런이다. 실제로 되돌리려면 --revert --apply.");
      return;
    }
    for (const stmt of splitStatements(REVERT_SQL))
      await prisma.$executeRawUnsafe(stmt);
    console.log("되돌렸다.");
    return;
  }

  const raw = readFileSync(MIGRATION_PATH, "utf8");
  const checksum = prismaChecksum(raw);
  const statements = splitStatements(raw);
  console.log(`${MIGRATION_PATH}`);
  console.log(`  문장 ${statements.length}개 · 체크섬 ${checksum}`);

  const already = (await prisma.$queryRawUnsafe(
    `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '${MIGRATION_NAME}'`,
  )) as unknown[];
  if (already.length > 0) {
    console.log("이미 적용돼 있다. 아무것도 하지 않는다.");
    return;
  }

  await prisma
    .$transaction(
      async (tx) => {
        for (const stmt of statements) await tx.$executeRawUnsafe(stmt);
        await tx.$executeRawUnsafe(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES (gen_random_uuid()::text, $1, now(), $2, NULL, NULL, now(), 1)`,
          checksum,
          MIGRATION_NAME,
        );
        console.log("  적용됨. 확인:");
        await smokeTest(tx as unknown as PrismaClient);
        if (!APPLY) throw new DryRun();
      },
      { timeout: 300_000, maxWait: 30_000 },
    )
    .catch((error: unknown) => {
      if (error instanceof DryRun) {
        console.log(
          "\n드라이런이라 **되돌렸다**(ROLLBACK). 실제로 적용하려면:\n" +
            "  ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-problem-code-migration.ts --apply",
        );
        return;
      }
      throw error;
    });

  if (APPLY) console.log("\n적용 완료.");
}

class DryRun extends Error {}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
