/**
 * **학생이 정답을 고를 수 없는 297건**을 출제 풀에서 뺀다 (`directUseAllowed = false`).
 *
 *   npx tsx scripts/qa/apply-unusable-discard.ts                      드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-unusable-discard.ts --apply
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-unusable-discard.ts --revert
 *
 * 원장님 확정(2026-08-19): 「AI로 새로 내자」 — 원본 복구가 아니라 **새 문항으로
 * 대체**한다. 대체 전에 먼저 막는 이유는, 이 297건이 **지금도 출제되고 있어서**다
 * (실측 269건이 출제 가능 상태였다). 학생이 못 푸는 문항이 지면에 나간다.
 *
 * 목록의 정본은 `scripts/qa/reports/unusable-problems.json` 의 `fatal` 이고,
 * 그 판정 규칙은 `report-unusable-problems.ts` 하나뿐이다. 여기서 다시 판정하지 않는다 —
 * 세는 쪽과 막는 쪽이 목록을 각각 쓰면 둘이 같이 눈이 먼다(CLAUDE.md 2026-08-18).
 *
 * ## 🔴 무리를 다시 좁힌다
 *
 * 「반증하려고 넓힌 모집단을 처리 대상으로 그대로 물려받았다」로 43이 433이 된 적이
 * 있다(2026-08-18). 그래서 여기서도 **치명 판정 다섯 가지만** 받고, 분모(297)를
 * 먼저 찍은 뒤 「뺄 것 + 건너뜀」이 그 수와 안 맞으면 **멈춘다.**
 *
 * ## 🔴 같은 컬럼을 세 스크립트가 잠근다
 *
 * `apply-missing-figure-lock.ts`(그림 유실) · `apply-choice-figure-discard.ts`(보기 그림 짝)
 * 가 같은 `directUseAllowed` 를 잠근다. 서로 모르면 **한쪽을 되돌릴 때 다른 쪽이 풀린다.**
 * 그래서 (1) 저 원장들에 이미 있는 행은 **잠그지 않고**, (2) 되돌릴 때는
 * **지금 값이 우리가 쓴 값(false)일 때만** 되돌린다.
 *
 * ## 영구 삭제가 아니다
 *
 * 행마다 판정·원인·단원·원본 경로를 남긴다. AI 대체분이 검수를 통과하면 이 행들은
 * 그대로 두면 되고, 원본을 다시 구하면 `--revert` 로 되살릴 수 있다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { mergeLedgerRows, stillApplied } from "./revertLedger";

const prisma = new PrismaClient();

const FATAL = "scripts/qa/reports/unusable-problems.json";
const LEDGER = "scripts/qa/reports/unusable-discard-lock.json";
/** 같은 컬럼을 잠그는 다른 원장들 — 겹치면 되돌릴 때 서로 푼다. */
const OTHER_LOCKS = [
  "scripts/qa/reports/missing-figure-lock.json",
  "scripts/qa/reports/choice-figure-discard-lock.json",
];

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

if ((APPLY || REVERT) && process.env.ALLOW_UNIT_FIX !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_UNIT_FIX=1 과 --apply(또는 --revert) 가 둘 다 필요하다.",
  );
  process.exit(1);
}

/** 일일테스트 기본 정원 · 확인테스트 정원 (D-20). */
const DAILY = 8;
const REVIEW = 25;

/**
 * 「학생이 정답을 고를 수 없다」로 판정된 다섯 가지. **이 목록이 처리 대상 무리다.**
 * `report-unusable-problems.ts` 가 내는 판정 중 ⚠️(지면번호어긋남·보기수이상·
 * 정답표기가번호아님)는 **정답을 고를 수는 있으므로** 여기 없다.
 */
export const FATAL_VERDICTS = new Set([
  "보기0칸",
  "정답보기없음",
  "정답번호어긋남",
  "정답번호중복",
  "정답표기가모호",
]);

export interface FatalRow {
  id: string;
  verdict: string;
  cause: string;
  school: string | null;
  questionNumber: number | null;
  source: string;
  sourceFile: string | null;
  unitId: string | null;
}

export interface DbRow {
  id: string;
  externalId: string | null;
  directUseAllowed: boolean;
  unitId: string | null;
  pool: string;
  reviewStatus: string;
  noAnswer: boolean;
}

export interface LockedRow {
  id: string;
  externalId: string | null;
  /** 잠그기 **전** 값. 이게 없으면 되돌릴 수 없다. */
  directUseAllowed: boolean;
  school: string | null;
  questionNumber: number | null;
  판정: string;
  원인: string;
  /** AI 대체분이 어느 단원·어느 원본을 대신하는지 알아야 한다. */
  unitId: string | null;
  원본: string | null;
}

/* ── 한 행을 뺄지 말지 — 순수 함수 (DB 없이 시험한다) ──────────────────── */

export type DiscardDecision = { lock: true } | { lock: false; reason: string };

export function decideUnusableDiscard(
  fatal: FatalRow,
  row: DbRow | undefined,
  alreadyLockedElsewhere: boolean,
): DiscardDecision {
  // ① 🔴 **치명 판정만** 뺀다. 목록에 ⚠️ 부류가 섞여 들어오면 정답을 고를 수 있는
  //    문항까지 빠진다 — 43이 433이 된 사고와 같은 자리다.
  if (!FATAL_VERDICTS.has(fatal.verdict))
    return { lock: false, reason: `치명 판정이 아니다 (${fatal.verdict})` };
  if (!row) return { lock: false, reason: "DB 에 그 행이 없다" };
  // ② 다른 원장이 이미 잠근 행은 건드리지 않는다 — 되돌릴 때 서로 푼다.
  if (alreadyLockedElsewhere)
    return { lock: false, reason: "다른 잠금 원장에 이미 있다" };
  // ③ 이미 빠져 있으면 그대로 둔다 (멱등).
  if (!row.directUseAllowed)
    return { lock: false, reason: "이미 빠져 있다 (멱등)" };
  return { lock: true };
}

/* ── 되돌리기 ────────────────────────────────────────────────────────── */

export type RevertDecision =
  { restore: true; to: boolean } | { restore: false; reason: string };

/**
 * 되돌릴 것인가. **지금 값이 우리가 쓴 값(false)일 때만** 되돌린다 —
 * 그 사이 누가 풀었거나 다른 잠금이 걸렸으면 덮지 않는다.
 */
export function revertUnusable(
  locked: LockedRow,
  now: { directUseAllowed: boolean } | undefined,
): RevertDecision {
  if (!now) return { restore: false, reason: "DB 에 그 행이 없다" };
  if (now.directUseAllowed !== false)
    return {
      restore: false,
      reason: "우리가 쓴 값이 아니다 — 남의 변경을 덮지 않는다",
    };
  return { restore: true, to: locked.directUseAllowed };
}

/* ── 실행 ────────────────────────────────────────────────────────────── */

function otherLockedIds(): Set<string> {
  const out = new Set<string>();
  for (const path of OTHER_LOCKS) {
    if (!existsSync(path)) continue;
    const l = JSON.parse(readFileSync(path, "utf8")) as {
      이전상태?: { id: string }[];
    };
    for (const r of l.이전상태 ?? []) out.add(r.id);
  }
  return out;
}

async function fetchAll(): Promise<Map<string, DbRow>> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, external_id AS "externalId",
            direct_use_allowed AS "directUseAllowed",
            unit_id::text AS "unitId", pool::text AS pool,
            review_status::text AS "reviewStatus",
            answer = '(정답 없음)' AS "noAnswer"
       FROM problem`,
  )) as DbRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function countLoss(todo: LockedRow[], all: Map<string, DbRow>) {
  const units = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, grade, chapter, section FROM unit`,
  )) as { id: string; grade: string; chapter: string; section: string }[];
  if (units.length === 0)
    throw new Error("단원표가 비었다 — 이름 없이 세면 표를 읽을 수 없다.");
  const name = new Map(
    units.map((u) => [u.id, `${u.grade} ${u.chapter} > ${u.section}`]),
  );

  const pool = new Map<string, number>();
  for (const r of all.values())
    if (
      r.pool === "shared" &&
      r.reviewStatus === "approved" &&
      r.directUseAllowed &&
      !r.noAnswer &&
      r.unitId
    )
      pool.set(r.unitId, (pool.get(r.unitId) ?? 0) + 1);

  const lose = new Map<string, number>();
  let noUnit = 0;
  for (const r of todo) {
    const unitId = all.get(r.id)?.unitId;
    if (!unitId) {
      noUnit += 1;
      continue;
    }
    lose.set(unitId, (lose.get(unitId) ?? 0) + 1);
  }

  const rows = [...lose.entries()].map(([id, n]) => {
    const p = pool.get(id) ?? 0;
    return { id, n, pool: p, left: p - n, name: name.get(id) ?? id };
  });
  rows.sort((a, b) => b.n - a.n || a.left - b.left);
  const underDaily = rows.filter((r) => r.left < DAILY);
  const underReview = rows.filter((r) => r.left < REVIEW);

  console.log(`\n  [D-20 — 무엇을 잃는가]`);
  console.log(`     영향받는 단원                          ${rows.length}개`);
  console.log(
    `     일일테스트 정원(${DAILY}) 아래로 내려가는 단원   ${underDaily.length}개`,
  );
  console.log(
    `     확인테스트 정원(${REVIEW}) 아래로 내려가는 단원  ${underReview.length}개`,
  );
  if (noUnit)
    console.log(`     단원이 없는 행                         ${noUnit}건`);
  console.log(`\n  | 단원 | 풀 | 잃는 수 | 남는 수 |`);
  console.log(`  | --- | ---: | ---: | ---: |`);
  for (const r of rows.slice(0, 12))
    console.log(`  | ${r.name} | ${r.pool} | ${r.n} | ${r.left} |`);
  if (underReview.length) {
    console.log(`\n  ⚠️ 정원 아래로 내려가는 단원`);
    for (const r of underReview)
      console.log(`     ${r.name} — ${r.pool} → ${r.left}`);
  }
  return {
    units: rows.length,
    underDaily: underDaily.length,
    underReview: underReview.length,
  };
}

async function revert() {
  if (!existsSync(LEDGER)) throw new Error(`원장이 없다: ${LEDGER}`);
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
    이전상태: LockedRow[];
  };
  const all = await fetchAll();
  let restored = 0;
  let untouched = 0;
  for (const row of ledger.이전상태) {
    const d = revertUnusable(row, all.get(row.id));
    if (!d.restore) {
      untouched += 1;
      continue;
    }
    await prisma.$executeRawUnsafe(
      `UPDATE problem SET direct_use_allowed = $1 WHERE id = $2::uuid`,
      d.to,
      row.id,
    );
    restored += 1;
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

  const fatal = (
    JSON.parse(readFileSync(FATAL, "utf8")) as { fatal: FatalRow[] }
  ).fatal;
  const all = await fetchAll();
  const elsewhere = otherLockedIds();

  // 🔴 분모를 **먼저** 찍는다. 「뺄 것 + 건너뜀」이 이 수와 안 맞으면 범위가 샌 것이다.
  const expected = fatal.length;
  const notFatal = fatal.filter((f) => !FATAL_VERDICTS.has(f.verdict)).length;
  console.log(`  분모 검산 — 대장 ${expected}건 · 치명 아닌 것 ${notFatal}건`);

  const todo: LockedRow[] = [];
  const skipped = new Map<string, number>();
  for (const f of fatal) {
    const d = decideUnusableDiscard(f, all.get(f.id), elsewhere.has(f.id));
    if (d.lock) {
      const row = all.get(f.id)!;
      todo.push({
        id: row.id,
        externalId: row.externalId,
        directUseAllowed: row.directUseAllowed,
        school: f.school,
        questionNumber: f.questionNumber,
        판정: f.verdict,
        원인: f.cause,
        unitId: row.unitId,
        원본: f.sourceFile,
      });
    } else {
      skipped.set(d.reason, (skipped.get(d.reason) ?? 0) + 1);
    }
  }

  const skippedTotal = [...skipped.values()].reduce((a, b) => a + b, 0);
  if (todo.length + skippedTotal !== expected)
    throw new Error(
      `범위가 샜다 — 뺄 것 ${todo.length} + 건너뜀 ${skippedTotal} 이 대장 ${expected} 와 안 맞는다.`,
    );

  console.log(
    `── 학생이 정답을 고를 수 없는 문항 출제 제외 ${APPLY ? "(적용)" : "(드라이런)"} ──`,
  );
  console.log(`  대장            ${expected}건`);
  console.log(`  뺄 것           ${todo.length}건`);
  for (const [r, n] of [...skipped.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  건너뜀 ${String(n).padStart(4)}  ${r}`);

  const byVerdict = new Map<string, number>();
  const byCause = new Map<string, number>();
  for (const r of todo) {
    byVerdict.set(r.판정, (byVerdict.get(r.판정) ?? 0) + 1);
    byCause.set(r.원인, (byCause.get(r.원인) ?? 0) + 1);
  }
  console.log(`\n  [판정별]`);
  for (const [k, n] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(6)}  ${k}`);
  console.log(`\n  [원인별 — AI 대체가 아니라 고쳐야 사는 것도 있다]`);
  for (const [k, n] of [...byCause.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(6)}  ${k}`);

  await countLoss(todo, all);

  // 원장을 **먼저** 쓴다 — 반대 순서면 중간에 죽었을 때 되돌릴 근거가 없다.
  // 그리고 덮어쓰지 않고 **이어 쓴다**(`revertLedger.ts` 주석 참조).
  const previous = existsSync(LEDGER)
    ? (JSON.parse(readFileSync(LEDGER, "utf8")) as {
        이전상태?: LockedRow[];
        적용됨?: boolean;
      })
    : null;
  const merged = mergeLedgerRows(previous?.이전상태, todo);
  const ledger = {
    적용:
      "학생이 정답을 고를 수 없는 문항 출제 제외 (directUseAllowed=false) — " +
      "원장님 확정 2026-08-19 「AI로 새로 내자」",
    기준시각: new Date().toISOString(),
    되돌리기:
      "ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-unusable-discard.ts --revert",
    영구삭제아님:
      "행마다 판정·원인·단원·원본 경로를 남겼다. AI 대체분이 이 단원들을 채운다.",
    적용됨: stillApplied(previous?.적용됨, APPLY),
    잠근건수: merged.rows.length,
    이번계획: todo.length,
    이어받음: merged.carried,
    이전상태: merged.rows,
  };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), "utf8");
  console.log(
    `\n  원장 → ${LEDGER} · 이번 계획 ${todo.length}행` +
      (merged.carried ? ` · 옛 원장에서 이어받음 ${merged.carried}행` : ""),
  );

  if (!APPLY) {
    console.log(
      `\n드라이런이다 — DB 를 한 건도 안 썼다.\n` +
        `적용하려면: ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-unusable-discard.ts --apply`,
    );
    await prisma.$disconnect();
    return;
  }

  const { count } = await prisma.problem.updateMany({
    where: { id: { in: todo.map((r) => r.id) }, directUseAllowed: true },
    data: { directUseAllowed: false },
  });
  console.log(`\n  뺐다: ${count}건`);
  // 계획과 쓴 행이 다르면 그 사이 남이 잠갔다는 뜻이다 — 조용히 넘어가면 안 된다.
  if (count !== todo.length)
    console.log(
      `  ⚠️ 계획 ${todo.length} 과 다르다 — 그 사이 다른 세션이 ${todo.length - count}행을 잠갔다.` +
        ` 그 행은 우리가 잠근 것이 아니므로 되돌릴 때 건너뛴다(값 검사가 막는다).`,
    );
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("apply-unusable-discard")) void main();
