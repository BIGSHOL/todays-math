/**
 * 되찾은 보기 그림 짝을 `Problem.choiceFigureIndex` 에 넣는다.
 * **기본은 드라이런이고, 이 조사에서는 적용하지 않았다.**
 *
 *   npx tsx scripts/qa/apply-choice-figure-index.ts                 드라이런 (기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-choice-figure-index.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-choice-figure-index.ts --revert
 *
 * 선행: `python scripts/qa/choice_figure_recover.py …` (짝 회수 드라이런)
 * 산출: `scripts/qa/reports/choice-figure-index-apply.json` — **행마다 `before`** 를 담는다.
 *       이 파일은 `.gitignore` 예외로 **커밋된다**(`git check-ignore -v` 로 확인할 것).
 *
 * ## 이 스크립트가 스스로 지키는 것
 *
 * 1. **모르는 것은 안 쓴다.** 짝을 못 찾은 행은 빈 배열 그대로 둔다 — 손대지 않는다.
 *    빈 배열은 «짝을 모른다»이고, 지면은 오늘처럼 번호 없이 그린다. 아무 그림이나
 *    ①에 붙이는 쪽으로 미끄러지면 안 된다(`choiceFigureIndex.ts` 머리말).
 * 2. **멱등.** 이미 값이 있는 행은 건드리지 않는다(`cardinality > 0` 이면 건너뛴다).
 * 3. **낡은 계획은 멈춘다.** 회수 때 본 `figure_urls` 와 지금 DB 의 값이 **한 글자라도
 *    다르면** 그 행을 쓰지 않는다. 공유 DB(D-31)는 조사 도중에도 움직이고, 그 사이에
 *    `prune-figures.mjs` 가 그림 한 장을 떼면 **배열 전체가 한 칸씩 밀린다** —
 *    그런 짝은 그럴듯해 보이면서 틀린다.
 * 4. **규약 검산을 쓰기 전과 후에 모두 돌린다.** 길이 · 범위 · 중복 —
 *    판정은 `src/lib/problem/choiceFigureIndex.ts` 한 곳이 갖는다(렌더와 같은 규칙).
 * 5. **되돌리기 자료를 먼저 쓰고 DB 를 나중에 쓴다.** 순서가 반대면 중간에 죽었을 때
 *    되돌릴 근거가 없다(2026-08-18 실제로 겪었다).
 * 6. 공유 DB 쓰기는 `--apply` + `ALLOW_SHARED_IMPORT=1` **둘 다** 있을 때만.
 *    게이트는 접속보다 앞에 둔다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { PrismaClient } from "@prisma/client";

import { checkChoiceFigureIndex } from "../../src/lib/problem/choiceFigureIndex";

const PAIRS = "scripts/qa/reports/choice-figure-pairs.json";
const LEDGER = "scripts/qa/reports/choice-figure-index-apply.json";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 과 --apply(또는 --revert) 가 둘 다 필요하다.",
  );
  process.exit(1);
}
if (APPLY && REVERT) {
  console.error("--apply 와 --revert 를 같이 줄 수 없다.");
  process.exit(1);
}

const prisma = new PrismaClient();

export interface Pair {
  id: string;
  verdict: string;
  why?: string;
  examId?: string | null;
  questionNumber?: number | null;
  figureQnum?: number | null;
  figureUrls?: string[];
  choiceFigureIndex?: number[];
}

export interface LedgerRow {
  id: string;
  examId: string | null;
  questionNumber: number | null;
  figureUrls: string[];
  /** 적용 **전** DB 값 — 되돌리기의 근거다. */
  before: number[];
  /** 적용할 값. */
  after: number[];
  why: string;
}

export interface DbRow {
  id: string;
  figureUrls: string[];
  choiceFigureIndex: number[];
  examId: string | null;
  questionNumber: number | null;
}

function readLedger(): { rows: LedgerRow[] } {
  if (!existsSync(LEDGER))
    throw new Error(
      `되돌리기 자료가 없다: ${LEDGER} — 먼저 드라이런을 돌려라.`,
    );
  return JSON.parse(readFileSync(LEDGER, "utf8")) as { rows: LedgerRow[] };
}

/**
 * 컬럼이 아직 있는가.
 *
 * 마이그레이션(`20260818220000_problem_choice_figure_index`)은 **공유 DB 스키마 변경**이라
 * 원장님 확정 없이 돌리지 않는다(D-31). 그래서 컬럼이 없는 상태에서도 계획은 세울 수
 * 있어야 하되, **없는 값을 읽은 척하면 안 된다.**
 */
async function columnExists(): Promise<boolean> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT 1 AS ok FROM information_schema.columns
      WHERE table_name = 'problem' AND column_name = 'choice_figure_index'`,
  )) as unknown[];
  return rows.length > 0;
}

async function fetchRows(
  ids: string[],
  hasColumn: boolean,
): Promise<Map<string, DbRow>> {
  if (ids.length === 0) return new Map();
  const column = hasColumn
    ? `choice_figure_index AS "choiceFigureIndex"`
    : // ⚠️ 추론이다. 컬럼은 `NOT NULL DEFAULT ARRAY[]::INTEGER[]` 로 생기므로
      // 만들어진 직후 모든 행이 빈 배열이다. 그래도 «읽은 값»이 아니라는 것을
      // 산출물과 화면에 못 박고, 이 모드에서는 --apply 를 막는다.
      `ARRAY[]::int[] AS "choiceFigureIndex"`;
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, figure_urls AS "figureUrls",
            ${column},
            exam_id AS "examId", question_number AS "questionNumber"
       FROM problem WHERE id = ANY($1::uuid[])`,
    ids,
  )) as DbRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

/* ── 되돌리기 ────────────────────────────────────────────────────────── */

export type RevertDecision =
  { restore: true; to: number[] } | { restore: false; reason: string };

/**
 * 이 행을 되돌릴 것인가 — **순수 함수**.
 *
 * 되돌리기는 안전망이라 정작 시험하기 어렵다(되돌릴 일이 안 생기길 바라니까).
 * 그래서 판단만 떼어 테스트가 부르게 한다. 여기서 지키는 것 둘:
 *
 *  ㉮ **우리가 쓴 값일 때만 되돌린다.** 지금 값이 원장의 `after` 와 다르면 그 사이에
 *     누가 다른 값을 넣은 것이다 — 그걸 `before` 로 덮으면 **남의 변경을 지운다.**
 *  ㉯ 되돌릴 값은 원장의 `before` **그대로**다. 「어차피 빈 배열이니까」라고 `[]` 를
 *     박으면, 나중에 덮어쓰기 모드가 생기는 순간 되돌리기가 조용히 거짓말이 된다.
 */
export function revertRow(
  row: LedgerRow,
  now: DbRow | undefined,
): RevertDecision {
  if (!now) return { restore: false, reason: "DB 에 그 행이 없다" };
  const same =
    now.choiceFigureIndex.length === row.after.length &&
    now.choiceFigureIndex.every((v, i) => v === row.after[i]);
  if (!same)
    return {
      restore: false,
      reason: "우리가 쓴 값이 아니다 — 남의 변경을 덮지 않는다",
    };
  return { restore: true, to: row.before };
}

async function revert() {
  if (!(await columnExists()))
    throw new Error("컬럼이 없다 — 되돌릴 것도 없다.");
  const { rows } = readLedger();
  const db = await fetchRows(
    rows.map((r) => r.id),
    true,
  );
  let restored = 0;
  let untouched = 0;
  for (const row of rows) {
    const decision = revertRow(row, db.get(row.id));
    if (!decision.restore) {
      untouched += 1;
      continue;
    }
    await prisma.$executeRawUnsafe(
      `UPDATE problem SET choice_figure_index = $1::int[] WHERE id = $2::uuid`,
      decision.to,
      row.id,
    );
    restored += 1;
  }
  console.log(
    `되돌림 ${restored}행 · 값이 달라 건드리지 않음 ${untouched}행 (남의 변경을 덮지 않는다)`,
  );
}

/* ── 한 행을 쓸지 말지 — **순수 함수**. 가드는 여기 모여 있고 테스트가 이걸 부른다 ── */

export type PlanDecision =
  { ok: true; row: LedgerRow } | { ok: false; reason: string };

/**
 * 이 행에 값을 쓸 것인가.
 *
 * 가드를 `main()` 안에 두면 **DB 없이는 시험할 수 없다.** 그러면 「가드가 있다」는
 * 말만 남고 정말 막는지는 아무도 모른다 — 이 저장소가 여러 번 겪은 자리다.
 * 그래서 판단만 떼어 낸다(`src/__tests__/unit/applyChoiceFigureIndex.test.ts`).
 */
export function planRow(pair: Pair, now: DbRow | undefined): PlanDecision {
  if (!now) return { ok: false, reason: "DB 에 그 행이 없다" };

  // ① 회수기가 «자동» 이라고 한 것만 쓴다. 사람확인·불가는 손대지 않는다 —
  //    모르는 것을 그럴듯하게 채우면 지금보다 나쁘다.
  if (pair.verdict !== "자동")
    return { ok: false, reason: `«자동» 이 아니다 (${pair.verdict})` };

  // ② 멱등 — 이미 값이 있으면 손대지 않는다
  if (now.choiceFigureIndex.length > 0)
    return { ok: false, reason: "이미 값이 있다 (멱등)" };

  // ③ 낡은 계획은 멈춘다 — 그림 목록이 그때와 같아야 색인이 가리키는 곳이 같다.
  //    사이에 `prune-figures.mjs` 가 한 장을 떼면 배열이 통째로 한 칸씩 밀린다.
  const seen = pair.figureUrls ?? [];
  const same =
    seen.length === now.figureUrls.length &&
    seen.every((u, i) => u === now.figureUrls[i]);
  if (!same)
    return {
      ok: false,
      reason: `그림 목록이 바뀌었다 (회수 때 ${seen.length}장 · 지금 ${now.figureUrls.length}장)`,
    };

  // ④ 규약 검산 — 쓰기 **전에** 본다. 렌더와 같은 규칙 한 곳을 쓴다.
  const after = pair.choiceFigureIndex ?? [];
  const check = checkChoiceFigureIndex(now.figureUrls.length, after);
  if (!check.ok) return { ok: false, reason: `규약 위반: ${check.reason}` };

  return {
    ok: true,
    row: {
      id: pair.id,
      examId: now.examId,
      questionNumber: now.questionNumber,
      figureUrls: now.figureUrls,
      before: now.choiceFigureIndex,
      after,
      why: pair.why ?? "",
    },
  };
}

/* ── 계획 세우기 + 적용 ──────────────────────────────────────────────── */

async function main() {
  if (REVERT) {
    await revert();
    await prisma.$disconnect();
    return;
  }

  const pairs = JSON.parse(readFileSync(PAIRS, "utf8")) as Pair[];
  const auto = pairs.filter((p) => p.verdict === "자동");
  const withArray = auto.filter((p) => (p.choiceFigureIndex ?? []).length > 0);
  if (withArray.length !== auto.length)
    throw new Error(
      `«자동» ${auto.length}건 중 ${auto.length - withArray.length}건에 배열이 없다 — 회수기를 다시 돌려라.`,
    );

  const hasColumn = await columnExists();
  if (!hasColumn) {
    if (APPLY) {
      console.error(
        [
          "컬럼 `choice_figure_index` 가 아직 없다. 마이그레이션",
          "  prisma/migrations/20260818220000_problem_choice_figure_index",
          "을 먼저 적용하라. 컬럼 없이 --apply 는 막는다.",
        ].join("\n"),
      );
      process.exit(1);
    }
    console.log(
      [
        "⚠️ 컬럼 `choice_figure_index` 가 아직 없다 — **드라이런만** 가능하다.",
        "   `before` 는 읽은 값이 아니라 **추론**이다 (컬럼이 NOT NULL DEFAULT ARRAY[]",
        "   로 생기므로 만들어진 직후 전 행이 빈 배열이다). 적용 전에 컬럼이 있는",
        "   상태로 반드시 다시 돌려 `before` 를 실제로 읽어야 한다.",
        "",
      ].join("\n"),
    );
  }
  const db = await fetchRows(
    withArray.map((p) => p.id),
    hasColumn,
  );

  const plan: LedgerRow[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const p of withArray) {
    const decided = planRow(p, db.get(p.id));
    if (decided.ok) plan.push(decided.row);
    else skipped.push({ id: p.id, reason: decided.reason });
  }

  const shapes = new Map<string, number>();
  for (const r of plan) {
    const k = JSON.stringify(r.after);
    shapes.set(k, (shapes.get(k) ?? 0) + 1);
  }

  console.log(`── 보기 그림 짝 적재 ${APPLY ? "(적용)" : "(드라이런)"} ──`);
  console.log(`  회수 «자동»        ${auto.length}건`);
  console.log(`  쓸 계획            ${plan.length}건`);
  console.log(`  건너뜀             ${skipped.length}건`);
  const reasons = new Map<string, number>();
  for (const s of skipped)
    reasons.set(
      s.reason.replace(/\d+/g, "N"),
      (reasons.get(s.reason.replace(/\d+/g, "N")) ?? 0) + 1,
    );
  for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(n).padStart(4)}  ${r}`);
  console.log(`  배열 모양`);
  for (const [k, n] of [...shapes.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(n).padStart(4)}  ${k}`);

  // ⑤ 되돌리기 자료를 **먼저** 쓴다
  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note:
          "되돌리기 자료. `before` 가 적용 전 DB 값이다. " +
          "되돌리려면: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-choice-figure-index.ts --revert",
        generatedFrom: PAIRS,
        applied: APPLY,
        beforeIsInferred: !hasColumn,
        beforeNote: hasColumn
          ? "before 는 DB 에서 읽은 값이다."
          : "⚠️ 컬럼이 없어 before 를 읽지 못했다. 전부 [] 로 적었으나 이는 추론이다 — 적용 전에 컬럼이 있는 상태로 다시 돌릴 것.",
        planned: plan.length,
        skipped,
        rows: plan,
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`  되돌리기 자료 → ${LEDGER} (행마다 before)`);

  if (!APPLY) {
    console.log(
      `\n드라이런이다 — DB 를 한 건도 안 썼다.\n` +
        `적용하려면: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-choice-figure-index.ts --apply`,
    );
    await verify(plan, { readBack: false, hasColumn });
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const row of plan) {
    // 조건을 UPDATE 에도 건다 — 계획을 세운 뒤 남이 값을 넣었으면 안 쓴다(멱등).
    const n = await prisma.$executeRawUnsafe(
      `UPDATE problem SET choice_figure_index = $1::int[]
        WHERE id = $2::uuid AND coalesce(cardinality(choice_figure_index), 0) = 0`,
      row.after,
      row.id,
    );
    written += Number(n);
  }
  console.log(`  쓴 행 ${written}`);
  await verify(plan, { readBack: true, hasColumn });
  await prisma.$disconnect();
}

/* ── 검산 — 쓰기 전에도, 쓴 뒤에도 ───────────────────────────────────── */

async function verify(
  plan: LedgerRow[],
  { readBack, hasColumn }: { readBack: boolean; hasColumn: boolean },
) {
  console.log(`\n── 검산 (${readBack ? "DB 를 되읽어서" : "계획값으로"}) ──`);
  const source: { id: string; figureUrls: string[]; value: number[] }[] =
    readBack
      ? [
          ...(
            await fetchRows(
              plan.map((r) => r.id),
              hasColumn,
            )
          ).values(),
        ].map((r) => ({
          id: r.id,
          figureUrls: r.figureUrls,
          value: r.choiceFigureIndex,
        }))
      : plan.map((r) => ({
          id: r.id,
          figureUrls: r.figureUrls,
          value: r.after,
        }));

  const fails = { 길이: 0, 범위: 0, 중복: 0, 계획과다름: 0 };
  const wanted = new Map(plan.map((r) => [r.id, r.after]));
  for (const row of source) {
    if (row.value.length !== row.figureUrls.length) fails.길이 += 1;
    if (row.value.some((v) => !Number.isInteger(v) || v < 0 || v > 10))
      fails.범위 += 1;
    const nonZero = row.value.filter((v) => v !== 0);
    if (new Set(nonZero).size !== nonZero.length) fails.중복 += 1;
    const want = wanted.get(row.id);
    if (
      want &&
      (want.length !== row.value.length ||
        want.some((v, i) => v !== row.value[i]))
    )
      fails.계획과다름 += 1;
  }
  console.log(`  대상 ${source.length}행`);
  console.log(`  길이가 figure_urls 와 다른 행      ${fails.길이}`);
  console.log(`  색인이 0..10 밖인 행               ${fails.범위}`);
  console.log(`  0 이 아닌 색인이 겹치는 행         ${fails.중복}`);
  if (readBack)
    console.log(`  계획과 다르게 들어간 행            ${fails.계획과다름}`);

  const bad = Object.entries(fails).filter(([, n]) => n > 0);
  if (bad.length) {
    console.error(
      `\n🔴 검산 실패 — ${bad.map(([k, n]) => `${k} ${n}행`).join(" · ")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`  ✅ 전부 통과`);
  }

  // 짝을 모르는 행이 조용히 채워지지 않았는지도 본다 — 이 스크립트의 존재 이유다.
  if (readBack) {
    const stray = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM problem
        WHERE coalesce(cardinality(choice_figure_index),0) > 0
          AND cardinality(choice_figure_index) <> coalesce(cardinality(figure_urls),0)`,
    )) as { n: number }[];
    console.log(
      `  DB 전량에서 «길이가 안 맞는 채로 값이 든» 행 ${stray[0]!.n} (0 이어야 한다)`,
    );
    if (stray[0]!.n > 0) process.exitCode = 1;
  }
}

if (process.argv[1]?.includes("apply-choice-figure-index"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
