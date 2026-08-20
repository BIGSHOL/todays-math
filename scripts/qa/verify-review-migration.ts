/**
 * 검수 콘솔 마이그레이션 **롤백 검증** — 돌려 보고 되돌린다.
 *
 *   npx tsx scripts/qa/verify-review-migration.ts
 *
 * 왜 이렇게 하나: 마이그레이션 SQL 을 **텍스트로만** 검사하면 장식이 된다
 * (2026-08-18: `toMatch(/LOOP/)` 가 재시도를 지운 뒤에도 초록이었다).
 * 그래서 진짜로 실행하고, 제약이 **나쁜 행을 실제로 막는지**까지 확인한 뒤
 * 트랜잭션을 통째로 되돌린다. 공유 DB(D-31)에 아무것도 안 남는다.
 *
 * ⚠️ 실행 중 몇 초간 problem·user 테이블에 잠금이 걸린다. 다른 트랙이 배치를
 *    돌리는 중이면 그쪽이 잠깐 기다린다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const MIGRATION = path.join(
  "prisma",
  "migrations",
  "20260820150000_problem_report_and_solution_source",
  "migration.sql",
);

/** 홑따옴표 안의 세미콜론은 문장 끝이 아니다. 순진하게 자르면 SQL 이 깨진다. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      cur += c;
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (!inStr && c === "-" && next === "-") {
      inLineComment = true;
      cur += c;
      continue;
    }
    if (c === "'") {
      // '' 는 문자열 안의 홑따옴표다
      if (inStr && next === "'") {
        cur += "''";
        i++;
        continue;
      }
      inStr = !inStr;
      cur += c;
      continue;
    }
    if (c === ";" && !inStr) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => !/^(--[^\n]*\n?)*$/.test(s));
}

class Rollback extends Error {}

async function main() {
  const sql = readFileSync(MIGRATION, "utf-8");
  const statements = splitStatements(sql);
  console.log(
    `문장 ${statements.length}개를 트랜잭션 안에서 돌린다 — 끝에 되돌린다.`,
  );

  const prisma = new PrismaClient();
  const problems: string[] = [];
  const notes: string[] = [];

  // 이미 적용된 뒤에 돌리면 `CREATE TYPE` 이 「이미 있다」로 죽는다 — 그러면
  // 다음 사람은 **SQL 이 틀린 줄 안다.** 검증은 적용 **전에만** 뜻이 있으므로
  // 그 사실을 분명히 말하고 끝낸다.
  const [{ n: already }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'problem_report'`,
  );
  if (Number(already) > 0) {
    console.log(
      "이 마이그레이션은 **이미 적용되어 있다** — 검증은 적용 전에만 뜻이 있다.\n" +
        "다시 검증하려면 `prisma migrate resolve --rolled-back` 등으로 되돌린 뒤에 돌려라.",
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

        // ── ⑴ 채운 값이 분모와 맞나 ──────────────────────────────────────
        const rows = await tx.$queryRawUnsafe<
          { solution_source: string; n: bigint }[]
        >(
          `SELECT "solution_source", count(*) AS n FROM "problem" GROUP BY 1 ORDER BY 1`,
        );
        const by = Object.fromEntries(
          rows.map((r) => [r.solution_source, Number(r.n)]),
        );
        const [{ n: totalBig }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "problem"`,
        );
        const total = Number(totalBig);
        const sum = (by.none ?? 0) + (by.original ?? 0) + (by.ai ?? 0);
        notes.push(
          `해설 출처 — none ${by.none ?? 0} · original ${by.original ?? 0} · ai ${by.ai ?? 0} (합 ${sum} / 전체 ${total})`,
        );
        if (sum !== total)
          problems.push(`🔴 합이 전체와 다르다 ${sum} ≠ ${total}`);

        const [{ n: withSol }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "problem" WHERE "solution" IS NOT NULL AND "solution" <> ''`,
        );
        if (Number(withSol) !== (by.original ?? 0) + (by.ai ?? 0))
          problems.push(
            `🔴 해설 있는 행 ${Number(withSol)} 인데 original+ai 는 ${(by.original ?? 0) + (by.ai ?? 0)}`,
          );

        // ── ⑵ 계정 역할 기본값 ───────────────────────────────────────────
        const [{ n: nonDirector }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "user" WHERE "role" <> 'director'`,
        );
        if (Number(nonDirector) !== 0)
          problems.push(
            `🔴 기존 계정 ${Number(nonDirector)}개가 director 가 아니다`,
          );
        notes.push("기존 계정은 전부 director 로 남았다");

        // ── ⑶ 제약이 **실제로 막는가** ───────────────────────────────────
        const [{ id: pid }] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id" FROM "problem" LIMIT 1`,
        );
        /**
         * 🔴 **세이브포인트가 필요하다.** 포스트그레스는 문장 하나가 실패하면
         *    트랜잭션 전체를 중단하고 그 뒤 명령을 전부 무시한다(25P02).
         *    「일부러 실패시켜 제약을 확인」하려면 실패를 세이브포인트로 감싸야 한다.
         *    안 감싸면 **첫 실패 뒤의 검사가 전부 «실패»로 보여** 판정이 통째로 거짓이 된다.
         */
        let sp = 0;
        const tryInsert = async (
          _label: string,
          cols: string,
          vals: string,
        ) => {
          const name = `sp${++sp}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
          try {
            await tx.$executeRawUnsafe(
              `INSERT INTO "problem_report" ("problem_id", ${cols}) VALUES ('${pid}', ${vals})`,
            );
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            return true;
          } catch {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
            return false;
          }
        };

        if (await tryInsert("기타+설명없음", `"reason"`, `'other'`))
          problems.push("🔴 「기타」인데 설명 없는 신고가 들어갔다");
        else notes.push("「기타」+설명 없음 → 막힘 ✓");

        if (
          !(await tryInsert(
            "기타+설명",
            `"reason", "note"`,
            `'other', '보기 ②와 ④가 같다'`,
          ))
        )
          problems.push("🔴 설명이 있는 「기타」 신고가 막혔다");
        else notes.push("「기타」+설명 있음 → 통과 ✓");

        if (!(await tryInsert("그림", `"reason"`, `'figure'`)))
          problems.push(
            "🔴 설명 없는 「그림」 신고가 막혔다 — 사유만으로 신고할 수 있어야 한다",
          );
        else notes.push("「그림」 사유만 → 통과 ✓");

        if (
          await tryInsert(
            "처리했는데 시각없음",
            `"reason", "status"`,
            `'content', 'resolved'`,
          )
        )
          problems.push("🔴 처리 상태인데 처리 시각이 없는 행이 들어갔다");
        else notes.push("status=resolved + resolved_at 없음 → 막힘 ✓");

        // 같은 사람이 같은 사유로 두 번 → 한 건
        await tx.$executeRawUnsafe(
          `INSERT INTO "problem_report" ("problem_id", "reason") VALUES ('${pid}', 'answer')`,
        );
        const dup = await tryInsert("중복", `"reason"`, `'answer'`);
        if (dup) problems.push("🔴 같은 사유의 열린 신고가 두 건 들어갔다");
        else notes.push("같은 사유 중복 → 막힘 ✓");

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

  // ── 정말 되돌아갔나 ────────────────────────────────────────────────────
  const left = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'problem_report'`,
  );
  const leftCol = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.columns
      WHERE table_name = 'problem' AND column_name = 'solution_source'`,
  );
  await prisma.$disconnect();

  for (const n of notes) console.log("  " + n);
  const stuck = Number(left[0].n) + Number(leftCol[0].n);
  console.log(
    stuck === 0
      ? "\n되돌렸다 — 공유 DB 에 아무것도 안 남았다 (테이블·컬럼 0)"
      : `\n🔴 되돌리기 실패 — 남은 것 ${stuck}개`,
  );
  if (stuck !== 0) problems.push("🔴 되돌리기 실패");

  if (problems.length) {
    console.error("\n" + problems.join("\n"));
    process.exit(1);
  }
  console.log("검증 통과 — 이 SQL 은 돌아가고, 제약이 실제로 막는다.");
}

if (process.argv[1]?.includes("verify-review-migration")) void main();
