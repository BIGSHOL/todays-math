/**
 * 문항 코드 백필 — 마이그레이션 이전에 들어온 문항에 코드를 붙인다 (D-53).
 *
 *   npx tsx scripts/qa/backfill-problem-code.ts               # 드라이런 (기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-problem-code.ts --apply
 *   npx tsx scripts/qa/backfill-problem-code.ts --check       # 지금 상태만 센다
 *   npx tsx scripts/qa/backfill-problem-code.ts --ledger      # 원장만 다시 뜬다
 *
 * ⚠️ 공유 DB(D-31)다. 기본은 **드라이런**이고 `--apply` 는 `ALLOW_SHARED_IMPORT=1` 이
 *    있어야만 연다(2026-08-14 적재 사고 뒤 굳은 규칙).
 *
 * **어떻게 붙이나** — 새 문항과 **같은 함수**(`problem_code_next(unit_id)`)를 쓴다.
 * 백필이 제 나름의 규칙을 갖게 두면 두 벌이 되고, 둘이 갈라져도 아무도 모른다.
 *
 * **왜 서버 쪽 고리(DO 블록)인가** — 한 UPDATE 문 안에서는 그 문장이 방금 넣은 코드가
 * 다음 행의 중복 검사에 **안 보인다**(같은 스냅샷). 그러면 같은 단원 수백 행을 한 문장에
 * 넣을 때 겹칠 수 있다. PL/pgSQL 고리는 행마다 별개 문장이라 앞서 넣은 것이 보인다.
 * 그래서 47,152행을 한 문장이 아니라 **행 단위 고리**로 돈다(왕복은 배치마다 한 번).
 *
 * **멱등** — `WHERE problem_code IS NULL` 만 고른다. 이미 코드가 있는 행은 손대지 않고,
 * DB 트리거(`problem_code_freeze`)가 그것을 **강제**한다(바꾸려 하면 예외).
 *
 * **`updated_at` 을 안 건드린다** — 날 SQL 로 UPDATE 하므로 Prisma 의 `@updatedAt`(클라이언트
 * 쪽 값)이 끼어들지 않는다. 일부러 그렇게 했다: 「적재 후 손댄 행 39,563건」이라는 신호가
 * 이 백필로 47,152 가 되어 버리면 그 신호가 죽는다.
 *
 * 되돌리기: `scripts/qa/reports/problem-code-ledger.json.gz`(커밋된다)에 문항 id ↔ 코드가
 * 전량 있다. 컬럼을 드롭했다가 다시 만들면 그 원장으로 **같은 코드를 되살릴 수 있다** —
 * 종이·대화에 이미 나간 코드가 있을 수 있어서 필요한 자료다. 컬럼 자체를 없애려면
 * 마이그레이션 파일 머리의 DROP 문.
 */
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { PrismaClient } from "@prisma/client";

import { PROBLEM_CODE_PATTERN } from "../../src/contracts/problemCode.contract";

const LEDGER_PATH = "scripts/qa/reports/problem-code-ledger.json.gz";
const BATCH = 2_000;

const APPLY = process.argv.includes("--apply");
const CHECK = process.argv.includes("--check");
const LEDGER_ONLY = process.argv.includes("--ledger");

if (APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다. ALLOW_SHARED_IMPORT=1 과 --apply 가 둘 다 필요하다.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

interface Counts {
  total: number;
  coded: number;
  missing: number;
  duplicates: number;
  malformed: number;
  prefixMissing: number;
}

async function counts(): Promise<Counts> {
  const [row] = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int                                                        AS total,
            count(problem_code)::int                                             AS coded,
            count(*) FILTER (WHERE problem_code IS NULL)::int                     AS missing,
            count(*) FILTER (WHERE problem_code IS NOT NULL
                               AND problem_code !~ $1)::int                       AS malformed
       FROM "problem"`,
    PROBLEM_CODE_PATTERN,
  )) as Array<Omit<Counts, "duplicates" | "prefixMissing">>;

  const [dup] = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS duplicates
       FROM (SELECT problem_code FROM "problem"
              WHERE problem_code IS NOT NULL
              GROUP BY 1 HAVING count(*) > 1) t`,
  )) as Array<{ duplicates: number }>;

  const [pre] = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS "prefixMissing" FROM "unit" WHERE problem_code_prefix IS NULL`,
  )) as Array<{ prefixMissing: number }>;

  return {
    ...row,
    duplicates: dup!.duplicates,
    prefixMissing: pre!.prefixMissing,
  };
}

function report(label: string, c: Counts) {
  console.log(
    `${label}\n` +
      `  문항 ${c.total.toLocaleString()} · 코드 있음 ${c.coded.toLocaleString()} · ` +
      `빈 값 ${c.missing.toLocaleString()}\n` +
      `  중복 ${c.duplicates} · 형식 위반 ${c.malformed} · 코드 앞부분 없는 단원 ${c.prefixMissing}`,
  );
}

/** 되돌리기 자료 — 문항 id ↔ 코드 전량. **커밋되는 경로**여야 한다(.gitignore 예외 확인). */
async function writeLedger() {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, problem_code FROM "problem" WHERE problem_code IS NOT NULL ORDER BY id`,
  )) as Array<{ id: string; problem_code: string }>;

  const payload = {
    note:
      "문항 코드(D-53) 원장. 컬럼을 드롭했다가 다시 만들 때 **같은 코드**를 되살리는 근거다. " +
      "종이·대화에 이미 나간 코드가 있을 수 있어 새로 뽑으면 안 된다.",
    generatedFrom: "scripts/qa/backfill-problem-code.ts",
    count: rows.length,
    codes: Object.fromEntries(rows.map((r) => [r.id, r.problem_code])),
  };
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), {
    level: 9,
  });
  writeFileSync(LEDGER_PATH, gz);
  console.log(
    `원장: ${LEDGER_PATH} — ${rows.length.toLocaleString()}건 · ${(gz.length / 1024).toFixed(0)}KB`,
  );
  console.log("  ⚠️ `git check-ignore -v` 로 커밋되는지 확인할 것.");
}

async function fillBatch(): Promise<number> {
  // 행마다 별개 UPDATE 문 — 앞서 넣은 코드가 다음 행의 중복 검사에 보이게 한다.
  // (한 UPDATE 문으로 몰면 같은 스냅샷이라 안 보이고, 같은 단원 수백 행에서 겹칠 수 있다.)
  await prisma.$executeRawUnsafe(
    `DO $do$
     DECLARE r record;
     BEGIN
       FOR r IN SELECT id, unit_id FROM "problem" WHERE problem_code IS NULL ORDER BY id LIMIT ${BATCH}
       LOOP
         UPDATE "problem" SET problem_code = "problem_code_next"(r.unit_id) WHERE id = r.id;
       END LOOP;
     END
     $do$`,
  );
  const [row] = (await prisma.$queryRawUnsafe(
    `SELECT count(*) FILTER (WHERE problem_code IS NULL)::int AS remaining FROM "problem"`,
  )) as Array<{ remaining: number }>;
  return row!.remaining;
}

async function main() {
  const before = await counts();
  report("적용 전:", before);

  if (before.prefixMissing > 0) {
    console.error(
      "\n코드 앞부분이 없는 단원이 있다 — 그 단원의 문항은 코드를 못 받는다.\n" +
        "  마이그레이션(20260818210000_problem_code)이 적용됐는지 먼저 확인하라.",
    );
    process.exitCode = 1;
    return;
  }

  if (CHECK) return;
  if (LEDGER_ONLY) {
    await writeLedger();
    return;
  }

  if (!APPLY) {
    console.log(
      `\n드라이런이다. ${before.missing.toLocaleString()}건에 코드를 붙일 것이다.\n` +
        "  실제로 붙이려면: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-problem-code.ts --apply",
    );
    return;
  }

  let remaining = before.missing;
  let rounds = 0;
  const started = Date.now();
  while (remaining > 0) {
    const next = await fillBatch();
    rounds += 1;
    if (next === remaining) {
      console.error(
        `\n한 바퀴 돌았는데 남은 수가 그대로다(${remaining}). 멈춘다.`,
      );
      process.exitCode = 1;
      return;
    }
    remaining = next;
    console.log(
      `  ${rounds}회차 — 남은 것 ${remaining.toLocaleString()} (${((Date.now() - started) / 1000).toFixed(0)}초)`,
    );
  }

  const after = await counts();
  report("\n적용 후:", after);

  // 원장을 **DB 확정 뒤 곧바로** 쓴다 — 되돌릴 근거 없이 공유 DB 를 바꿔 두지 않는다.
  await writeLedger();

  // 이제 「코드 없는 문항은 없다」를 기존 행까지 포함해 확정한다.
  if (after.missing === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "problem" VALIDATE CONSTRAINT "problem_problem_code_present"`,
    );
    console.log(
      "제약 problem_problem_code_present 를 VALIDATE 했다 — 이제 전량이 검사 대상이다.",
    );
  }

  if (after.missing || after.duplicates || after.malformed) {
    console.error("\n⚠️ 빈 값·중복·형식 위반이 0 이 아니다. 위 숫자를 보라.");
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
