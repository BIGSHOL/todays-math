/**
 * 문항 코드 배선 검증 — **새 문항이 코드 없이 들어올 수 있는 경로가 하나도 없는가** (D-53).
 *
 *   npx tsx scripts/qa/verify-problem-code-wiring.ts
 *   npx tsx scripts/qa/verify-problem-code-wiring.ts --json
 *
 * ⚠️ **이 스크립트는 공유 DB 를 바꾸지 않는다.** 모든 확인은 트랜잭션 안에서 하고
 *    마지막에 반드시 되돌린다(ROLLBACK). PostgreSQL 은 DDL 도 트랜잭션 대상이라
 *    「트리거를 지워 보는」 시험까지 되돌릴 수 있다. 그래도 커밋 경로가 없다는 것을
 *    눈으로 확인하려면 이 파일에서 `ROLLBACK` 을 검색해 보라 — `commit` 은 없다.
 *
 * 두 가지를 한다:
 *
 *   §A **경로 전수 조사** — 저장소에서 `problem` 행을 만드는 자리를 **찾아서** 센다.
 *       손으로 적은 목록을 쓰지 않는다(CLAUDE.md 2026-08-18). 목록에 없는 경로가
 *       생기면 표에 새 줄이 나타난다.
 *
 *   §B **DB 실측** — 「트리거가 정말 붙이는가」·「겹치면 정말 다시 뽑는가」·
 *       「한 번 붙은 코드를 정말 못 바꾸는가」를 **실제로 해 본다.**
 *       가드는 망가뜨려 봐야 가드인 줄 안다(적대적 리뷰 ④ §H) — 그래서
 *       트리거를 지운 상태로도 넣어 본다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

import { PROBLEM_CODE_PATTERN } from "../../src/contracts/problemCode.contract";

const JSON_OUT = process.argv.includes("--json");
const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════════
// §A 경로 전수 조사 — 목록을 손으로 쓰지 않는다
// ══════════════════════════════════════════════════════════════════
interface InsertSite {
  file: string;
  line: number;
  snippet: string;
  /** 이 자리가 `problemCode` 를 스스로 넘기는가 */
  passesCode: boolean;
}

/**
 * 조사에서 빼는 파일 — **부여 지점이 아니라 검증기**다(자기 자신, 마이그레이션 적용기).
 * ⚠️ 뺀 것은 **반드시 출력에 찍는다.** 조용히 빼면 표가 「전부 봤다」로 읽힌다
 * (CLAUDE.md 2026-08-18 「빠진 표본은 반드시 세어 찍어라」).
 */
const EXCLUDED = [
  "scripts/qa/verify-problem-code-wiring.ts",
  "scripts/qa/apply-problem-code-migration.ts",
];
const excluded: string[] = [];

const SOURCE_EXT = /\.(ts|tsx|mts|mjs)$/;

/** 디렉터리를 훑어 소스 파일 경로를 모은다(node:fs 의 globSync 는 @types/node 20 에 없다). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

/** `problem` 테이블에 행을 만드는 자리를 찾는다. Prisma 호출 + 날 SQL 둘 다. */
function findInsertSites(): InsertSite[] {
  const files = ["src", "scripts", "prisma", "e2e"].flatMap((dir) => walk(dir));
  const PRISMA_CALL =
    /\bproblem\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/;
  const RAW_INSERT = /INSERT\s+INTO\s+"?problem"?\s*\(/i;

  const sites: InsertSite[] = [];
  for (const file of files.sort()) {
    // 자기 자신과 마이그레이션 적용기는 «부여 지점»이 아니라 «검증기»다.
    if (EXCLUDED.some((x) => file.replaceAll("\\", "/").includes(x))) {
      excluded.push(file.replaceAll("\\", "/"));
      continue;
    }
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!PRISMA_CALL.test(line) && !RAW_INSERT.test(line)) return;
      if (/problemAnswer|problem_answer|testProblem|test_problem/i.test(line))
        return;
      // 호출 뒤 40줄 안에서 problemCode 를 직접 넘기는지 본다.
      const body = lines.slice(i, i + 40).join("\n");
      sites.push({
        file: file.replaceAll("\\", "/"),
        line: i + 1,
        snippet: line.trim().slice(0, 90),
        passesCode:
          /\bproblemCode\s*:/.test(body) || /problem_code\b/.test(body),
      });
    });
  }
  return sites;
}

// ══════════════════════════════════════════════════════════════════
// §B DB 실측 — 전부 ROLLBACK 된다
// ══════════════════════════════════════════════════════════════════
interface Check {
  id: string;
  what: string;
  ok: boolean;
  detail: string;
}

class Rollback extends Error {}

/** Prisma 오류 메시지는 여러 줄이다 — 마지막 줄에 Postgres 원문이 온다. */
function lastLine(text: string): string {
  const parts = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return parts[parts.length - 1] ?? "";
}

async function runDbChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (id: string, what: string, ok: boolean, detail: string) =>
    checks.push({ id, what, ok, detail });

  try {
    await prisma.$transaction(
      async (tx) => {
        const [user] = (await tx.$queryRawUnsafe(
          `SELECT id FROM "user" LIMIT 1`,
        )) as Array<{ id: string }>;
        const [unit] = (await tx.$queryRawUnsafe(
          `SELECT id, problem_code_prefix AS prefix FROM "unit" ORDER BY order_index LIMIT 1`,
        )) as Array<{ id: string; prefix: string }>;
        if (!user || !unit) throw new Error("user/unit 표본이 없다");

        /**
         * 「막혀야 한다」를 시험하는 자리. PostgreSQL 은 한 문장이 실패하면 그 트랜잭션이
         * **통째로 못 쓰게** 되므로(25P02), SAVEPOINT 로 감싸 되돌린 뒤 계속한다.
         * 처음엔 이걸 빠뜨려 B5 이후 검사가 전부 죽었다 — 실패를 기대하는 검사는
         * 실패 뒤에도 계속 돌 수 있어야 «검사»다.
         */
        let spSeq = 0;
        const expectFailure = async (
          run: () => Promise<unknown>,
        ): Promise<{ failed: boolean; message: string }> => {
          spSeq += 1;
          const sp = `sp_${spSeq}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
          try {
            await run();
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
            return { failed: false, message: "" };
          } catch (error) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
            return {
              failed: true,
              message: lastLine(String((error as Error).message)),
            };
          }
        };

        const insertRaw = async (extra = "", codeExpr = "DEFAULT") => {
          const rows = (await tx.$queryRawUnsafe(
            `INSERT INTO "problem" (id, user_id, unit_id, source, difficulty, problem_type,
                                    content, answer, created_at, updated_at${extra ? ", problem_code" : ""})
             VALUES (gen_random_uuid(), '${user.id}', '${unit.id}', 'manual', 'easy', '계산',
                     '배선 검증', '0', now(), now()${extra ? `, ${codeExpr}` : ""})
             RETURNING id, problem_code`,
          )) as Array<{ id: string; problem_code: string }>;
          return rows[0]!;
        };

        // ── B1. 날 SQL INSERT 도 코드를 받는가 (앱을 안 거치는 모든 경로의 대표) ──
        const raw = await insertRaw();
        add(
          "B1",
          "날 SQL INSERT 가 코드를 받는다 (psql·미래의 스크립트 포함)",
          new RegExp(PROBLEM_CODE_PATTERN).test(raw.problem_code) &&
            raw.problem_code.startsWith(`${unit.prefix}-`),
          `${raw.problem_code}`,
        );

        // ── B2. Prisma create (앱 라우트 3곳이 쓰는 길) ──
        // exam-wiring: 테스트 — 배선 검증용 탐침이다. `source: "manual"` 을 넣고
        //               트랜잭션째 되돌린다. 기출을 적재하는 경로가 아니다
        const viaPrisma = await tx.problem.create({
          data: {
            userId: user.id,
            unitId: unit.id,
            source: "manual",
            difficulty: "easy",
            problemType: "계산",
            content: "배선 검증(Prisma)",
            answer: "0",
          },
        });
        add(
          "B2",
          "Prisma create 가 코드를 받는다 (POST /api/problems 계열)",
          new RegExp(PROBLEM_CODE_PATTERN).test(viaPrisma.problemCode),
          viaPrisma.problemCode,
        );

        // ── B3. createMany 한 문장에 여러 행 (적재 스크립트가 쓰는 길) ──
        // exam-wiring: 테스트 — 위와 같다. 일괄 삽입에도 코드가 붙는지만 본다
        await tx.problem.createMany({
          data: Array.from({ length: 25 }, (_, i) => ({
            userId: user.id,
            unitId: unit.id,
            source: "manual" as const,
            difficulty: "easy" as const,
            problemType: "계산",
            content: `배선 검증(일괄 ${i})`,
            answer: "0",
          })),
        });
        const [batch] = (await tx.$queryRawUnsafe(
          `SELECT count(*)::int AS n, count(problem_code)::int AS coded
             FROM "problem" WHERE content LIKE '배선 검증(일괄%'`,
        )) as Array<{ n: number; coded: number }>;
        add(
          "B3",
          "createMany 한 문장 25행이 전부 코드를 받는다 (적재 경로)",
          batch!.n === 25 && batch!.coded === 25,
          `${batch!.coded}/${batch!.n}`,
        );

        // ── B4. 일부러 충돌시킨다 — 정말 다시 뽑는가 ──
        // `random()` 은 `setseed()` 로 되감을 수 있다. 같은 씨앗을 두 번 심으면
        // 트리거는 **같은 4자를 먼저 뽑는다.** 그때 재시도가 없으면 유니크 위반으로
        // 죽고, 있으면 다른 코드가 나온다. (이게 `gen_random_bytes` 대신 `random()`
        // 을 고른 이유다 — 시험할 수 없는 가드는 장식이다.)
        //
        // ⚠️ **B4 만으로는 아무것도 증명 못 한다.** `setseed` 가 아예 안 먹어도
        //    두 코드는 다르게 나오고 검사는 초록이 된다 — 「참」이 검사 대상에서
        //    오는 자리다(적대적 리뷰 ④ §H). 그래서 씨앗이 정말 되감기는지를
        //    **B4a 로 따로 확인**하고, 2차가 «첫 뽑기가 아니라 둘째 뽑기»를
        //    받았는지까지 본다.
        const draws = async (seed: number, n: number) => {
          await tx.$executeRawUnsafe(`SELECT setseed(${seed})`);
          const out: string[] = [];
          for (let i = 0; i < n; i += 1) {
            const [row] = (await tx.$queryRawUnsafe(
              `SELECT "problem_code_suffix"() AS s`,
            )) as Array<{ s: string }>;
            out.push(row!.s);
          }
          return out;
        };
        const drawA = await draws(0.4242, 2);
        const drawB = await draws(0.4242, 2);
        add(
          "B4a",
          "대조군 — 같은 씨앗이면 같은 4자가 나온다 (되감기가 정말 먹는다)",
          drawA[0] === drawB[0] &&
            drawA[1] === drawB[1] &&
            drawA[0] !== drawA[1],
          `씨앗 0.4242 → ${drawA.join(", ")} · 다시 → ${drawB.join(", ")}`,
        );

        await tx.$executeRawUnsafe(`SELECT setseed(0.4242)`);
        const first = await insertRaw();
        await tx.$executeRawUnsafe(`SELECT setseed(0.4242)`);
        const second = await insertRaw();
        add(
          "B4",
          "같은 4자가 나와도 다시 뽑아 다른 코드를 준다 (충돌 재시도가 실제로 돌았다)",
          first.problem_code === `${unit.prefix}-${drawA[0]}` &&
            second.problem_code === `${unit.prefix}-${drawA[1]}`,
          `1차 ${first.problem_code}(첫 뽑기 ${drawA[0]}) → 같은 씨앗 2차 ${second.problem_code}` +
            ` (첫 뽑기 ${drawA[0]} 가 겹쳐 둘째 뽑기 ${drawA[1]} 로 넘어갔다)`,
        );

        // ── B5. 한 번 붙은 코드는 못 바꾼다 ──
        const frozen = await expectFailure(() =>
          tx.$executeRawUnsafe(
            `UPDATE "problem" SET problem_code = '${unit.prefix}-2222' WHERE id = '${raw.id}'`,
          ),
        );
        add(
          "B5",
          "이미 붙은 코드를 UPDATE 로 못 바꾼다 (파생으로 되돌리는 수리를 DB 가 거절)",
          frozen.failed,
          frozen.failed ? "거절함" : "⚠️ 바뀌었다",
        );

        // ── B6. 단원을 옮겨도 코드가 안 바뀐다 ──
        const [otherUnit] = (await tx.$queryRawUnsafe(
          `SELECT id, problem_code_prefix AS prefix FROM "unit" WHERE id <> '${unit.id}' ORDER BY order_index LIMIT 1`,
        )) as Array<{ id: string; prefix: string }>;
        await tx.$executeRawUnsafe(
          `UPDATE "problem" SET unit_id = '${otherUnit.id}' WHERE id = '${raw.id}'`,
        );
        const [moved] = (await tx.$queryRawUnsafe(
          `SELECT problem_code, unit_id FROM "problem" WHERE id = '${raw.id}'`,
        )) as Array<{ problem_code: string; unit_id: string }>;
        add(
          "B6",
          "단원을 옮겨도 코드가 그대로다 (저장이지 파생이 아니다)",
          moved!.problem_code === raw.problem_code &&
            moved!.unit_id === otherUnit.id,
          `${raw.problem_code} (단원 ${unit.prefix} → ${otherUnit.prefix})`,
        );

        // ── B7. 형식을 어긴 코드는 못 넣는다 ──
        const rejected = await expectFailure(() =>
          insertRaw("code", `'${unit.prefix}-K7M0'`),
        ); // 0 은 헷갈리는 글자라 금지
        add(
          "B7",
          "헷갈리는 글자가 든 코드를 CHECK 가 거절한다",
          rejected.failed,
          rejected.failed ? `${unit.prefix}-K7M0 거절함` : "⚠️ 들어갔다",
        );

        // ── B8. 같은 코드 두 번은 못 넣는다 ──
        const dupRejected = await expectFailure(() =>
          insertRaw("code", `'${raw.problem_code}'`),
        );
        add(
          "B8",
          "같은 코드를 두 문항이 못 가진다 (@unique)",
          dupRejected.failed,
          dupRejected.failed ? "거절함" : "⚠️ 들어갔다",
        );

        // ── B10. **가드를 망가뜨려 본다 ①** — 재시도를 없애면 정말 겹치는가 ──
        // B4 는 「재시도가 있으면 안 겹친다」를 보였다. 그런데 그것만으로는 «재시도
        // 덕분»인지 알 수 없다. 그래서 재시도가 **없는** 함수로 갈아 끼우고 같은
        // 씨앗을 심는다 — 유니크 위반이 나야 B4 의 초록이 재시도 덕이라는 뜻이다.
        // (텍스트로만 「LOOP 가 있나」를 보던 가드는 실제로 **장식**이었다: 재시도를
        //  지워도 초록이었다. 무작위 4자를 뽑는 함수에도 LOOP 가 있었기 때문이다.)
        await tx.$executeRawUnsafe(
          `CREATE OR REPLACE FUNCTION "problem_code_next"(p_unit_id uuid) RETURNS varchar
           LANGUAGE plpgsql VOLATILE AS $fn$
           DECLARE v_prefix text;
           BEGIN
             SELECT u."problem_code_prefix" INTO v_prefix FROM "unit" u WHERE u."id" = p_unit_id;
             RETURN v_prefix || '-' || "problem_code_suffix"();
           END;
           $fn$`,
        );
        // ⚠️ 씨앗은 B4 가 쓴 것과 **달라야** 한다. 같은 씨앗을 쓰면 B4 가 이미 넣어 둔
        //    코드와 1차부터 겹쳐, 「재시도가 없어서 죽었다」가 아니라 「예전 행과 겹쳐
        //    죽었다」가 된다. (처음에 그렇게 써서 B10 이 거짓 빨강이 났다.)
        await tx.$executeRawUnsafe(`SELECT setseed(0.777)`);
        const noRetryFirst = await expectFailure(() => insertRaw());
        await tx.$executeRawUnsafe(`SELECT setseed(0.777)`);
        const noRetrySecond = await expectFailure(() => insertRaw());
        add(
          "B10",
          "재시도를 없애면 같은 씨앗에서 **겹쳐서 죽는다** (B4 의 초록이 재시도 덕임을 보인다)",
          !noRetryFirst.failed && noRetrySecond.failed,
          !noRetryFirst.failed
            ? noRetrySecond.failed
              ? `1차 성공 · 2차 거절 — ${noRetrySecond.message.slice(0, 80)}`
              : "⚠️ 재시도가 없는데도 안 겹쳤다 — 씨앗이 안 먹은 것이다"
            : `⚠️ 1차부터 실패했다(씨앗이 앞 검사와 겹쳤다): ${noRetryFirst.message.slice(0, 80)}`,
        );

        // ── B9. **가드를 망가뜨려 본다 ②** — 트리거를 지우면 INSERT 가 멈추는가 ──
        // 「적재 경로 하나에서 코드 부여를 뺀다」의 DB 판이다. 부여가 트리거 한 곳에
        // 모여 있으므로, 그것을 지우는 것이 「경로에서 부여를 빼는」 일과 같다.
        // NOT NULL + CHECK 가 남아 있어야 **조용히 NULL 이 들어가지 않는다.**
        await tx.$executeRawUnsafe(
          `DROP TRIGGER "problem_code_assign" ON "problem"`,
        );
        const blocked = await expectFailure(() => insertRaw());
        add(
          "B9",
          "트리거를 지우면 INSERT 가 **멈춘다** (조용히 NULL 이 들어가지 않는다)",
          blocked.failed,
          blocked.failed
            ? blocked.message.includes("problem_code") ||
              blocked.message.includes("null value")
              ? "problem_code 제약이 막았다"
              : "제약이 막았다"
            : "⚠️ 코드 없이 들어갔다",
        );
        if (blocked.failed)
          add("B9-msg", "막은 이유(원문)", true, blocked.message);

        throw new Rollback();
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  return checks;
}

async function main() {
  const sites = findInsertSites();
  const dbChecks = await runDbChecks();

  // 트리거·제약이 지금 실제로 붙어 있는가 (되돌림과 무관한 상태 조회)
  const triggers = (await prisma.$queryRawUnsafe(
    `SELECT tgname FROM pg_trigger WHERE tgrelid = 'problem'::regclass AND NOT tgisinternal ORDER BY 1`,
  )) as Array<{ tgname: string }>;
  const constraints = (await prisma.$queryRawUnsafe(
    `SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid = 'problem'::regclass AND conname LIKE '%problem_code%' ORDER BY 1`,
  )) as Array<{ conname: string; convalidated: boolean }>;
  const [counts] = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total, count(problem_code)::int AS coded,
            count(*) FILTER (WHERE problem_code IS NOT NULL AND problem_code !~ $1)::int AS malformed
       FROM "problem"`,
    PROBLEM_CODE_PATTERN,
  )) as Array<{ total: number; coded: number; malformed: number }>;

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { sites, excluded, dbChecks, triggers, constraints, counts },
        null,
        2,
      ),
    );
  } else {
    console.log("§A 문항을 만드는 경로 — 저장소에서 찾은 전량\n");
    console.log("| # | 자리 | 코드를 직접 넘기나 | 누가 붙이나 |");
    console.log("|---|---|---|---|");
    sites.forEach((s, i) => {
      console.log(
        `| ${i + 1} | \`${s.file}:${s.line}\` | ${s.passesCode ? "넘긴다" : "**안 넘긴다**"} | ${
          s.passesCode ? "그 자리 (형식·유일성은 제약이 본다)" : "DB 트리거"
        }|`,
      );
    });
    console.log(`\n합계 ${sites.length}곳.`);
    console.log(
      `조사에서 뺀 파일 ${excluded.length}개(부여 지점이 아니라 검증기다): ${excluded.join(", ") || "없음"}\n`,
    );

    console.log("§B DB 실측 (전부 ROLLBACK 됨)\n");
    for (const c of dbChecks)
      console.log(
        `  ${c.ok ? "✅" : "❌"} ${c.id} ${c.what}\n       ${c.detail}`,
      );

    console.log("\n§C 지금 붙어 있는 것");
    console.log(
      `  트리거: ${triggers.map((t) => t.tgname).join(", ") || "(없음)"}`,
    );
    for (const c of constraints)
      console.log(`  제약: ${c.conname} (검증됨=${c.convalidated})`);
    console.log(
      `  문항 ${counts!.total.toLocaleString()} · 코드 있음 ${counts!.coded.toLocaleString()} · 형식 위반 ${counts!.malformed}`,
    );
  }

  const failed = dbChecks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error(
      `\n실패 ${failed.length}건: ${failed.map((c) => c.id).join(", ")}`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
