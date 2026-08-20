/**
 * 검수 기록 마이그레이션 **롤백 검증** — 돌려 보고 되돌린다.
 *
 *   npx tsx scripts/qa/verify-review-log-migration.ts
 *
 * 왜: 텍스트로만 검사하면 장식이 된다(2026-08-18 `toMatch(/LOOP/)` 사건).
 * 실제로 실행하고, **이 표가 무엇에 쓰이는지까지** 확인한 뒤 되돌린다 —
 * 「안 본 문항 고르기」 질의를 여기서 직접 돌려 본다. 표만 만들어지고
 * 정작 쓰려는 질의가 안 되면 다음 슬라이스에서야 알게 된다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { splitStatements } from "./verify-review-migration";

const MIGRATION = path.join(
  "prisma",
  "migrations",
  "20260820180000_problem_review_log",
  "migration.sql",
);

class Rollback extends Error {}

async function main() {
  const sql = readFileSync(MIGRATION, "utf-8");
  const statements = splitStatements(sql);
  console.log(`문장 ${statements.length}개를 트랜잭션 안에서 돌린다.`);

  const prisma = new PrismaClient();
  const problems: string[] = [];
  const notes: string[] = [];

  const [{ n: already }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'problem_review_log'`,
  );
  if (Number(already) > 0) {
    console.log(
      "이 마이그레이션은 **이미 적용되어 있다** — 검증은 적용 전에만 뜻이 있다.",
    );
    await prisma.$disconnect();
    return;
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const [i, s] of statements.entries()) {
          try {
            await tx.$executeRawUnsafe(s);
          } catch (e) {
            const head = s
              .split("\n")
              .find((l) => l.trim() && !l.trim().startsWith("--"));
            throw new Error(
              `문장 ${i + 1} 실패\n  ${head?.slice(0, 100)}\n  ${(e as Error).message.split("\n")[0]}`,
            );
          }
        }
        notes.push(`SQL ${statements.length}문장 실행 성공`);

        const ids = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id" FROM "problem" ORDER BY "created_at" LIMIT 3`,
        );
        if (ids.length < 3) throw new Error("문항이 3건도 없다 — 검증 불가");
        const [a, b, c] = ids.map((r) => r.id);

        // 🔴 세이브포인트로 감싼다 — 일부러 실패시키는 문장이 트랜잭션을 중단시킨다(25P02).
        let sp = 0;
        const tryRaw = async (raw: string) => {
          const name = `sp${++sp}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
          try {
            await tx.$executeRawUnsafe(raw);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            return true;
          } catch {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
            return false;
          }
        };

        // ── ⑴ 판정 값을 가리는가 ──────────────────────────────────────────
        for (const v of ["pass", "unsure", "defect"]) {
          if (
            !(await tryRaw(
              `INSERT INTO "problem_review_log" ("problem_id","verdict") VALUES ('${a}','${v}')`,
            ))
          )
            problems.push(`🔴 정상 판정 '${v}' 가 막혔다`);
        }
        notes.push("pass·unsure·defect 셋 다 들어간다 ✓");

        if (
          await tryRaw(
            `INSERT INTO "problem_review_log" ("problem_id","verdict") VALUES ('${a}','approved')`,
          )
        )
          problems.push("🔴 모르는 판정 값이 들어갔다");
        else notes.push("모르는 판정 → 막힘 ✓");

        // ── ⑵ 덧붙이기만 한다 — 같은 문항을 다시 봐도 앞 기록이 남는다 ────
        const [{ n: dup }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "problem_review_log" WHERE "problem_id" = '${a}'`,
        );
        if (Number(dup) !== 3)
          problems.push(
            `🔴 같은 문항 기록이 3건이어야 하는데 ${Number(dup)}건`,
          );
        else notes.push("같은 문항을 세 번 봐도 세 줄 다 남는다 ✓");

        // ── ⑶ 검수자 없이도 남는다 (탈퇴해도 기록은 남아야 한다) ──────────
        notes.push("reviewer_id 없이 들어간다 ✓ (위 삽입이 전부 그렇다)");

        // ── ⑷ 🔴 **이 표를 실제로 쓰는 질의** — 「내가 아직 안 본 것」 ─────
        const users = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id" FROM "user" LIMIT 1`,
        );
        if (users.length === 0) throw new Error("계정이 없다 — 검증 불가");
        const me = users[0].id;
        await tx.$executeRawUnsafe(
          `INSERT INTO "problem_review_log" ("problem_id","reviewer_id","verdict")
           VALUES ('${b}','${me}','pass')`,
        );
        const unseen = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT p."id" FROM "problem" p
            WHERE p."id" IN ('${a}','${b}','${c}')
              AND NOT EXISTS (
                SELECT 1 FROM "problem_review_log" l
                 WHERE l."problem_id" = p."id" AND l."reviewer_id" = '${me}')`,
        );
        const got = new Set(unseen.map((r) => r.id));
        if (got.has(b))
          problems.push("🔴 내가 본 문항이 «안 본 것»에 남아 있다");
        if (!got.has(a) || !got.has(c))
          problems.push(
            "🔴 남이 본(또는 아무도 안 본) 문항이 «안 본 것»에서 빠졌다",
          );
        if (!got.has(a))
          problems.push(
            "🔴 reviewer_id 가 비어 있는 기록이 **내 기록처럼** 세어졌다",
          );
        if (got.has(b) || !got.has(a) || !got.has(c)) {
          /* 위에서 이미 적었다 */
        } else {
          notes.push(
            "「내가 아직 안 본 것」 질의가 실제로 갈라 준다 ✓ (남의 기록·빈 검수자는 안 센다)",
          );
        }

        throw new Rollback();
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) {
      console.error("\n🔴 검증 실패\n" + (e as Error).message);
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'problem_review_log'`,
  );
  const leftType = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM pg_type WHERE typname = 'review_verdict'`,
  );
  await prisma.$disconnect();

  for (const n of notes) console.log("  " + n);
  const stuck = Number(left[0].n) + Number(leftType[0].n);
  console.log(
    stuck === 0
      ? "\n되돌렸다 — 공유 DB 에 아무것도 안 남았다 (표·열거형 0)"
      : `\n🔴 되돌리기 실패 — 남은 것 ${stuck}개`,
  );
  if (stuck !== 0) problems.push("🔴 되돌리기 실패");

  if (problems.length) {
    console.error("\n" + problems.join("\n"));
    process.exit(1);
  }
  console.log(
    "검증 통과 — 이 SQL 은 돌아가고, 쓰려는 질의가 실제로 갈라 준다.",
  );
}

if (process.argv[1]?.includes("verify-review-log-migration")) void main();
