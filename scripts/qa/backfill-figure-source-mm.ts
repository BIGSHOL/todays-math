/**
 * `problem.figure_source_mm` 적재 — 그림 칸 원장의 `width_mm` 을 DB 에 넣는다.
 *
 *   npx tsx scripts/qa/backfill-figure-source-mm.ts             # 드라이런 (기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-figure-source-mm.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-figure-source-mm.ts --revert
 *
 * 선행: 마이그레이션 `20260819120000_problem_figure_source_mm` 을 **먼저** DB 에
 *       넣고, 그다음 `schema.prisma` 에 컬럼을 적는다. 반대면 인쇄가 죽는다.
 *
 * 산출: `scripts/qa/reports/figure-source-mm-apply.json` — 행마다 `before`.
 *       `.gitignore` 예외로 커밋된다. `git check-ignore -q` 가 exit 1 이어야 한다.
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런. `--apply` 와 `--revert --apply` 모두
 *    `ALLOW_SHARED_IMPORT=1` 이 있어야 연다. 게이트가 `--revert` 보다 앞이다.
 *
 * ⚠️ **모르는 것은 안 쓴다.** 한 장이라도 원장에 없거나 mm 이 없으면 그 문항은
 *    통째로 건너뛴다(지시서 §1 ⑶). 추측한 dpi 환산을 넣지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { PrismaClient } from "@prisma/client";

import { parseFigureRectLedger } from "../../src/app/dev/figure-print-size/ledger";
import { checkFigureSourceMm } from "../../src/lib/figurePrintSize";

import { mergeLedgerRows, stillApplied } from "./revertLedger";

const RECT_LEDGER = "scripts/qa/reports/figure-rect-ledger.json";
const LEDGER = "scripts/qa/reports/figure-source-mm-apply.json";

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

export interface DbRow {
  id: string;
  figureUrls: string[];
  figureSourceMm: number[];
  figureDims: number[];
  examId: string | null;
  questionNumber: number | null;
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

export type ResolveDecision =
  { ok: true; mm: number[] } | { ok: false; reason: string };

/**
 * 원장에서 이 문항의 mm 배열을 만든다. **한 장이라도 모르면 통째로 실패.**
 *
 * 값은 제품 `checkFigureSourceMm` 을 통과한 것만 남긴다 — 화면이 받는 값과
 * 적재가 넣는 값이 갈라지면 안 된다.
 */
export function resolveMm(
  urls: string[],
  lookup: ReadonlyMap<string, number | null>,
): ResolveDecision {
  if (urls.length === 0) return { ok: false, reason: "그림이 없다" };
  const mm: number[] = [];
  let known = 0;
  for (const url of urls) {
    if (!url.startsWith("/figures/"))
      return { ok: false, reason: `URL 규약 밖이다 (${url})` };
    const value = lookup.get(url);
    if (value == null) continue;
    known += 1;
    mm.push(value);
  }
  if (known === 0)
    return {
      ok: false,
      reason: `원장에 mm 이 없다 (${urls.length}장)`,
    };
  if (known !== urls.length)
    return {
      ok: false,
      reason: `일부만 원장에 있다 (${urls.length}장 중 ${known}장)`,
    };
  const check = checkFigureSourceMm(urls.length, mm);
  if (!check.ok) return { ok: false, reason: check.reason };
  return { ok: true, mm };
}

export type PlanDecision =
  { ok: true; row: LedgerRow } | { ok: false; reason: string };

function sameNums(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 이 행에 mm 을 쓸 것인가 — **순수 함수**. 가드는 여기 모여 있다.
 */
export function planRow(now: DbRow | undefined, after: number[]): PlanDecision {
  if (!now) return { ok: false, reason: "DB 에 그 행이 없다" };

  const check = checkFigureSourceMm(now.figureUrls.length, after);
  if (!check.ok) return { ok: false, reason: check.reason };

  if (sameNums(now.figureSourceMm, after))
    return { ok: false, reason: "이미 같은 값이다 (멱등)" };

  if (now.figureSourceMm.length > 0)
    return {
      ok: false,
      reason: `이미 값이 있다 (길이 ${now.figureSourceMm.length}) — 남의 변경을 덮지 않는다`,
    };

  return {
    ok: true,
    row: {
      id: now.id,
      examId: now.examId,
      questionNumber: now.questionNumber,
      figureUrls: now.figureUrls,
      before: now.figureSourceMm,
      after,
      why: "원장 width_mm · checkFigureSourceMm 통과",
    },
  };
}

export type RevertDecision =
  { restore: true; to: number[] } | { restore: false; reason: string };

/**
 * 이 행을 되돌릴 것인가. **우리가 쓴 값일 때만.**
 */
export function revertRow(
  row: LedgerRow,
  now: DbRow | undefined,
): RevertDecision {
  if (!now) return { restore: false, reason: "DB 에 그 행이 없다" };
  if (!sameNums(now.figureSourceMm, row.after))
    return {
      restore: false,
      reason: "우리가 쓴 값이 아니다 — 남의 변경을 덮지 않는다",
    };
  return { restore: true, to: row.before };
}

/* ── 아래는 CLI. 테스트는 위 순수 함수만 부른다. ── */

const prisma = new PrismaClient();

async function columnExists(): Promise<boolean> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT 1 AS ok FROM information_schema.columns
      WHERE table_name = 'problem' AND column_name = 'figure_source_mm'`,
  )) as unknown[];
  return rows.length > 0;
}

async function fetchRows(
  ids: string[],
  hasColumn: boolean,
): Promise<Map<string, DbRow>> {
  if (ids.length === 0) return new Map();
  const column = hasColumn
    ? `figure_source_mm AS "figureSourceMm"`
    : `ARRAY[]::double precision[] AS "figureSourceMm"`;
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, figure_urls AS "figureUrls",
            ${column},
            figure_dims AS "figureDims",
            exam_id AS "examId", question_number AS "questionNumber"
       FROM problem WHERE id = ANY($1::uuid[])`,
    ids,
  )) as DbRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

function readApplyLedger(): { rows: LedgerRow[] } {
  if (!existsSync(LEDGER))
    throw new Error(
      `되돌리기 자료가 없다: ${LEDGER} — 먼저 드라이런을 돌려라.`,
    );
  return JSON.parse(readFileSync(LEDGER, "utf8")) as { rows: LedgerRow[] };
}

async function revert() {
  if (!(await columnExists()))
    throw new Error("컬럼이 없다 — 되돌릴 것도 없다.");
  const { rows } = readApplyLedger();
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
    if (!APPLY) continue;
    await prisma.$executeRawUnsafe(
      `UPDATE problem SET figure_source_mm = $1::double precision[] WHERE id = $2::uuid`,
      decision.to,
      row.id,
    );
    restored += 1;
  }
  if (!APPLY) {
    const would = rows.filter((r) => revertRow(r, db.get(r.id)).restore).length;
    console.log(
      `드라이런 되돌리기 — 대상 ${would}행 · 값이 달라 건드리지 않음 ${rows.length - would}행. --apply 라야 실제로 되돌린다.`,
    );
    return;
  }
  console.log(
    `되돌림 ${restored}행 · 값이 달라 건드리지 않음 ${untouched}행 (남의 변경을 덮지 않는다)`,
  );
}

async function main() {
  if (REVERT) {
    await revert();
    await prisma.$disconnect();
    return;
  }

  if (!existsSync(RECT_LEDGER)) {
    console.error(`원장이 없다: ${RECT_LEDGER}`);
    process.exit(1);
  }
  const parsed = parseFigureRectLedger(readFileSync(RECT_LEDGER, "utf8"));
  if (!parsed.ok) {
    console.error(`원장을 못 읽는다: ${parsed.reason}`);
    process.exit(1);
  }
  const lookup = new Map<string, number | null>();
  for (const [url, entry] of parsed.entries) lookup.set(url, entry.sourceMm);

  const hasColumn = await columnExists();
  if (!hasColumn) {
    if (APPLY) {
      console.error(
        [
          "컬럼 `figure_source_mm` 가 아직 없다. 마이그레이션",
          "  prisma/migrations/20260819120000_problem_figure_source_mm",
          "을 먼저 적용하라. 컬럼 없이 --apply 는 막는다.",
        ].join("\n"),
      );
      process.exit(1);
    }
    console.log(
      [
        "⚠️ 컬럼 `figure_source_mm` 가 아직 없다 — **드라이런만** 가능하다.",
        "   `before` 는 읽은 값이 아니라 **추론**이다 (컬럼이 NOT NULL DEFAULT ARRAY[]",
        "   로 생기므로 만들어진 직후 전 행이 빈 배열이다). 적용 전에 컬럼이 있는",
        "   상태로 반드시 다시 돌려 `before` 를 실제로 읽어야 한다.",
        "",
      ].join("\n"),
    );
  }

  const candidates = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, figure_urls AS "figureUrls",
            figure_dims AS "figureDims",
            exam_id AS "examId", question_number AS "questionNumber"
       FROM problem WHERE cardinality(figure_urls) > 0 ORDER BY id`,
  )) as Array<Omit<DbRow, "figureSourceMm">>;
  console.log(`그림 있는 문항 ${candidates.length.toLocaleString()}건 (분모)`);

  const ids = candidates.map((c) => c.id);
  const dbNow = await fetchRows(ids, hasColumn);

  const plan: LedgerRow[] = [];
  const skipped: { id: string; reason: string }[] = [];
  let resolveFail = 0;

  for (const c of candidates) {
    const now = dbNow.get(c.id) ?? {
      ...c,
      figureSourceMm: [],
    };
    const resolved = resolveMm(now.figureUrls, lookup);
    if (!resolved.ok) {
      resolveFail += 1;
      skipped.push({ id: c.id, reason: resolved.reason });
      if (resolved.reason.startsWith("일부만"))
        console.log(
          `  🔴 일부만 ${c.id}  ${resolved.reason}  ${now.figureUrls.join(" · ")}`,
        );
      continue;
    }
    const decided = planRow(now, resolved.mm);
    if (decided.ok) plan.push(decided.row);
    else skipped.push({ id: c.id, reason: decided.reason });
  }

  const reasons = new Map<string, number>();
  for (const s of skipped) {
    const key = s.reason.replace(/\d+/g, "N");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  console.log(`── figure_source_mm 적재 ${APPLY ? "(적용)" : "(드라이런)"} ──`);
  console.log(`  원장 행            ${parsed.total.toLocaleString()}`);
  console.log(`  원장 mm 통과       ${parsed.withMm.toLocaleString()}`);
  console.log(`  그림 있는 문항     ${candidates.length.toLocaleString()}`);
  console.log(`  쓸 계획            ${plan.length.toLocaleString()}`);
  console.log(
    `  건너뜀             ${skipped.length.toLocaleString()} (원장에서 못 만듦 ${resolveFail.toLocaleString()})`,
  );
  for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(n).padStart(5)}  ${r}`);

  const nFig = plan.reduce((s, r) => s + r.after.length, 0);
  console.log(`  계획에 실리는 그림 ${nFig.toLocaleString()}장`);
  if (plan[0])
    console.log(
      `  예시 ${plan[0].id} → [${plan[0].after.map((x) => x.toFixed(2)).join(", ")}]`,
    );

  const previous = existsSync(LEDGER)
    ? (JSON.parse(readFileSync(LEDGER, "utf8")) as {
        rows?: LedgerRow[];
        applied?: boolean;
        beforeIsInferred?: boolean;
      })
    : null;
  const merged = mergeLedgerRows(previous?.rows, plan);
  const applied = stillApplied(previous?.applied, APPLY);
  const inferred =
    (plan.length > 0 && !hasColumn) ||
    (merged.carried > 0 && previous?.beforeIsInferred === true);

  mkdirSync(dirname(LEDGER), { recursive: true });
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note:
          "되돌리기 자료. `before` 가 적용 전 DB 값이다. " +
          "되돌리려면: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-figure-source-mm.ts --revert --apply",
        generatedFrom: RECT_LEDGER,
        applied,
        beforeIsInferred: inferred,
        beforeNote: !inferred
          ? "before 는 DB 에서 읽은 값이다."
          : "⚠️ 컬럼이 없어 before 를 읽지 못한 행이 있다. [] 로 적었으나 이는 추론이다 — 적용 전에 컬럼이 있는 상태로 다시 돌릴 것.",
        planned: plan.length,
        carriedOver: merged.carried,
        skippedCount: skipped.length,
        skipReasons: Object.fromEntries(reasons),
        rows: merged.rows,
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(
    `  되돌리기 자료 → ${LEDGER} (행마다 before) · 이번 계획 ${plan.length}행` +
      (merged.carried ? ` · 옛 원장에서 이어받음 ${merged.carried}행` : ""),
  );

  if (!APPLY) {
    console.log(
      `\n드라이런이다 — DB 를 한 건도 안 썼다.\n` +
        `적용하려면 마이그레이션 → schema.prisma → prisma generate 뒤에\n` +
        `ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-figure-source-mm.ts --apply`,
    );
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  const BATCH = 200;
  for (let i = 0; i < plan.length; i += BATCH) {
    const chunk = plan.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.$executeRawUnsafe(
          `UPDATE problem SET figure_source_mm = $1::double precision[]
            WHERE id = $2::uuid
              AND coalesce(cardinality(figure_source_mm), 0) = 0
              AND figure_urls = $3::text[]`,
          row.after,
          row.id,
          row.figureUrls,
        ),
      ),
    );
    written += chunk.length;
    process.stdout.write(`\r적재 ${written}/${plan.length}`);
  }
  console.log(
    `\n적재 완료 ${written.toLocaleString()}건 (조건에 안 맞으면 0행 갱신)`,
  );
  await prisma.$disconnect();
}

const isCli = process.argv[1]?.includes("backfill-figure-source-mm");
if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
