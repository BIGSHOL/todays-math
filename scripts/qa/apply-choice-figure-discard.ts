/**
 * 보기 그림 짝을 **되찾지 못한** 문항을 출제 풀에서 뺀다 (`directUseAllowed = false`).
 * **기본은 드라이런이고, 이 조사에서는 적용하지 않았다.**
 *
 *   npx tsx scripts/qa/apply-choice-figure-discard.ts                 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-choice-figure-discard.ts --apply
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-choice-figure-discard.ts --revert
 *
 * 원장님 확정(2026-08-18): 「정말 안되겠음 버려야지」 — 되찾을 수 없는 것은 뺀다.
 *
 * ## 왜 이 방식인가 — **이미 있는 방식을 그대로 쓴다**
 *
 * 그림 유실 856건을 뺄 때 쓴 방식과 **같다**(`apply-missing-figure-lock.ts`):
 *   · `directUseAllowed = false` — `reviewStatus` 도 새 잠금 컬럼도 아니다.
 *   · 게이트도 같은 `ALLOW_UNIT_FIX=1`.
 *   · 원장에 **행마다 이전 상태**를 남기고, 원장을 **DB 보다 먼저** 쓴다.
 * 방식이 갈리면 「세는 쪽과 막는 쪽」이 갈라진다 — 출제 풀 조건은
 * `findEligibleProblems` 한 곳이 보고, 그게 보는 것이 `directUseAllowed` 다.
 *
 * ## 🔴 두 잠금이 서로를 안다
 *
 * 같은 컬럼을 두 스크립트가 잠그면 **한쪽을 되돌릴 때 다른 쪽이 풀린다.**
 * 그래서 (1) 그림 유실 원장에 이미 있는 행은 **잠그지 않고**,
 * (2) 되돌릴 때는 **지금 값이 우리가 쓴 값(false)일 때만** 되돌린다.
 *
 * ## 영구 삭제가 아니다
 *
 * 원장에 행마다 **왜 뺐는지**를 남긴다. 나중에 원본을 다시 구하거나(HWP 19건),
 * 사람이 확인해서 살릴 수 있다. `--revert` 로 통째로, 또는 원장에서 id 를 골라 푼다.
 *
 * ## 무엇을 빼지 않는가
 *
 *   · **자동 회수 97건** — 짝을 되찾았다. 뺄 이유가 없다.
 *   · **사람확인 7건** — 사람이 보면 되는 것이지 못 쓰는 것이 아니다. **손대지 않는다.**
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { estimateProblemCount, readSignals } from "./oversizeRules";

const prisma = new PrismaClient();

const PAIRS = "scripts/qa/reports/choice-figure-pairs.json";
/** 무리(보기그림/미분류/반대쪽)를 아는 유일한 파일. **범위를 좁히는 근거다.** */
const CANDIDATES = "scripts/qa/reports/choice-figure-candidates.json";
const LEDGER = "scripts/qa/reports/choice-figure-discard-lock.json";
/** 그림 유실 잠금 원장 — 같은 컬럼을 잠그므로 겹치면 안 된다. */
const FIGURE_LOCK = "scripts/qa/reports/missing-figure-lock.json";

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

interface Pair {
  id: string;
  verdict: string;
  why?: string;
}

interface Row {
  id: string;
  externalId: string | null;
  directUseAllowed: boolean;
  content: string;
  unitId: string | null;
  school: string | null;
  questionNumber: number | null;
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
  /** 회수기가 말한 «못 하는 이유». */
  사유: string;
  /** 본문 신호로 본 «무엇이 망가졌나» — 되살릴 길이 다르다. */
  부류: string;
}

/* ── 한 행을 뺄지 말지 — 순수 함수 (DB 없이 시험한다) ──────────────────── */

export type DiscardDecision =
  { lock: true; 부류: string } | { lock: false; reason: string };

/**
 * 본문 신호로 «무엇이 망가졌나» 를 가른다 — 되살릴 길이 부류마다 다르다.
 * 판정은 `oversizeRules.ts` 의 것을 그대로 쓴다(자를 새로 만들지 않는다).
 */
export function classifyDiscard(content: string): string {
  const s = readSignals(content ?? "");
  if (estimateProblemCount(s) >= 3) return "문항 병합 — 재이관해야 산다";
  if (s.paperHeaders > 0) return "머리말 오염 — 본문 손질로 산다";
  if (s.base64Share >= 0.3) return "본문 오염 — base64";
  return "짝을 못 찾음 — 원본을 다시 구해야 산다";
}

export function decideDiscard(
  pair: Pair,
  row: Row | undefined,
  alreadyFigureLocked: boolean,
  /** 이 행이 **«보기그림» 무리**인가 — 회수기가 판정한 대상 모집단. */
  isChoiceFigure: boolean,
): DiscardDecision {
  if (!row) return { lock: false, reason: "DB 에 그 행이 없다" };

  // ① 🔴 **«보기그림» 무리만** 뺀다.
  //
  //    회수기는 «미분류»(그림 2장 이상인 서술형 등)와 «반대쪽»(보기가 진짜 글자)도
  //    같이 돌렸다 — 판정을 반증하려고 일부러 넓게 돌린 것이다. 그 둘의 «불가» 는
  //    「못 쓰는 문항」이 아니라 **「보기 그림 문항이 아니다」**는 뜻이다.
  //    무리를 안 거르면 멀쩡한 문항 390건이 함께 빠진다(실측: 43 → 433).
  if (!isChoiceFigure)
    return { lock: false, reason: "«보기그림» 무리가 아니다 (판정 대상 밖)" };

  // ② «불가» 만 뺀다. 자동(97)·사람확인(7)은 손대지 않는다 —
  //    사람이 보면 되는 것을 빼면 멀쩡한 문항이 조용히 사라진다.
  if (pair.verdict !== "불가")
    return { lock: false, reason: `«불가» 가 아니다 (${pair.verdict})` };

  // ③ 이미 그림 유실로 잠긴 행은 건드리지 않는다 — 되돌릴 때 서로 풀어 버린다.
  if (alreadyFigureLocked)
    return { lock: false, reason: "그림 유실 원장에 이미 있다" };

  // ④ 이미 출제에서 빠진 행은 건드리지 않는다 (멱등).
  if (!row.directUseAllowed)
    return { lock: false, reason: "이미 빠져 있다 (멱등)" };

  return { lock: true, 부류: classifyDiscard(row.content) };
}

/* ── 되돌리기 ────────────────────────────────────────────────────────── */

export type RevertDecision =
  { restore: true; to: boolean } | { restore: false; reason: string };

/**
 * 되돌릴 것인가. **지금 값이 우리가 쓴 값(false)일 때만** 되돌린다 —
 * 그 사이 누가 풀었거나 다른 잠금이 걸렸으면 덮지 않는다.
 */
export function revertDiscard(
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

function figureLockedIds(): Set<string> {
  if (!existsSync(FIGURE_LOCK)) return new Set();
  const l = JSON.parse(readFileSync(FIGURE_LOCK, "utf8")) as {
    이전상태: { id: string }[];
  };
  return new Set(l.이전상태.map((r) => r.id));
}

async function fetchAll(): Promise<Map<string, Row>> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, external_id AS "externalId",
            direct_use_allowed AS "directUseAllowed", content,
            unit_id::text AS "unitId", school, question_number AS "questionNumber",
            pool::text AS pool, review_status::text AS "reviewStatus",
            answer = '(정답 없음)' AS "noAnswer"
       FROM problem`,
  )) as Row[];
  return new Map(rows.map((r) => [r.id, r]));
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
    const d = revertDiscard(row, all.get(row.id));
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

  const pairs = JSON.parse(readFileSync(PAIRS, "utf8")) as Pair[];
  const cands = JSON.parse(readFileSync(CANDIDATES, "utf8")) as {
    id: string;
    group: string;
  }[];
  const choiceFigureIds = new Set(
    cands.filter((c) => c.group === "보기그림").map((c) => c.id),
  );
  const all = await fetchAll();
  const figureLocked = figureLockedIds();

  // 🔴 분모를 먼저 검산한다. 「보기그림 무리의 «불가»」가 몇 건인지 알고 시작해야
  //    범위가 새는 것을 안다 — 처음 판에서 43 이 433 이 됐다(무리를 안 걸렀다).
  const expected = pairs.filter(
    (p) => p.verdict === "불가" && choiceFigureIds.has(p.id),
  ).length;
  console.log(
    `  분모 검산 — «보기그림» ${choiceFigureIds.size}건 중 «불가» ${expected}건`,
  );

  const todo: LockedRow[] = [];
  const skipped = new Map<string, number>();
  for (const p of pairs) {
    const d = decideDiscard(
      p,
      all.get(p.id),
      figureLocked.has(p.id),
      choiceFigureIds.has(p.id),
    );
    if (d.lock) {
      const row = all.get(p.id)!;
      todo.push({
        id: row.id,
        externalId: row.externalId,
        directUseAllowed: row.directUseAllowed,
        school: row.school,
        questionNumber: row.questionNumber,
        사유: p.why ?? "",
        부류: d.부류,
      });
    } else if (p.verdict === "불가" && choiceFigureIds.has(p.id)) {
      skipped.set(d.reason, (skipped.get(d.reason) ?? 0) + 1);
    }
  }

  if (
    todo.length + [...skipped.values()].reduce((a, b) => a + b, 0) !==
    expected
  )
    throw new Error(
      `범위가 샜다 — 뺄 것 ${todo.length} + 건너뜀 이 «불가» ${expected} 와 안 맞는다.`,
    );

  console.log(
    `── 짝을 못 찾은 문항 출제 제외 ${APPLY ? "(적용)" : "(드라이런)"} ──`,
  );
  console.log(`  «보기그림» 의 «불가»  ${expected}건`);
  console.log(`  뺄 것            ${todo.length}건`);
  for (const [r, n] of [...skipped.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  건너뜀 ${String(n).padStart(4)}  ${r}`);

  const byClass = new Map<string, number>();
  const byReason = new Map<string, number>();
  for (const r of todo) {
    byClass.set(r.부류, (byClass.get(r.부류) ?? 0) + 1);
    byReason.set(r.사유, (byReason.get(r.사유) ?? 0) + 1);
  }
  console.log(`\n  [왜 못 찾았나]`);
  for (const [k, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(6)}  ${k}`);
  console.log(`\n  [무엇이 망가졌나 — 되살릴 길이 다르다]`);
  for (const [k, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(6)}  ${k}`);

  await countLoss(todo, all);

  // 원장을 **먼저** 쓴다 — 반대 순서면 중간에 죽었을 때 되돌릴 근거가 없다.
  const ledger = {
    적용: "보기 그림 짝을 되찾지 못한 문항 출제 제외 (directUseAllowed=false) — 원장님 확정 2026-08-18",
    기준시각: new Date().toISOString(),
    되돌리기:
      "ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-choice-figure-discard.ts --revert",
    영구삭제아님:
      "행마다 사유·부류를 남겼다. 원본을 다시 구하거나 사람이 확인해 살릴 수 있다.",
    적용됨: APPLY,
    잠근건수: todo.length,
    이전상태: todo,
  };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), "utf8");
  console.log(`\n  원장 → ${LEDGER} (행마다 이전 상태 + 사유)`);

  if (!APPLY) {
    console.log(
      `\n드라이런이다 — DB 를 한 건도 안 썼다.\n` +
        `적용하려면: ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-choice-figure-discard.ts --apply`,
    );
    await prisma.$disconnect();
    return;
  }

  const { count } = await prisma.problem.updateMany({
    where: { id: { in: todo.map((r) => r.id) }, directUseAllowed: true },
    data: { directUseAllowed: false },
  });
  console.log(`\n  뺐다: ${count}건`);
  await prisma.$disconnect();
}

/* ── 무엇을 잃는가 (D-20) ────────────────────────────────────────────── */

async function countLoss(todo: LockedRow[], all: Map<string, Row>) {
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
  console.log(`     영향받는 단원                         ${rows.length}개`);
  console.log(
    `     일일테스트 정원(${DAILY}) 아래로 내려가는 단원   ${underDaily.length}개`,
  );
  console.log(
    `     확인테스트 정원(${REVIEW}) 아래로 내려가는 단원  ${underReview.length}개`,
  );
  if (noUnit)
    console.log(`     단원이 없는 행                        ${noUnit}건`);
  console.log(`\n  | 단원 | 풀 | 잃는 수 | 남는 수 |`);
  console.log(`  | --- | ---: | ---: | ---: |`);
  for (const r of rows.slice(0, 12))
    console.log(`  | ${r.name} | ${r.pool} | ${r.n} | ${r.left} |`);
  if (underReview.length) {
    console.log(`\n  ⚠️ 정원 아래로 내려가는 단원`);
    for (const r of underReview)
      console.log(`     ${r.name} — ${r.pool} → ${r.left}`);
  }
}

if (process.argv[1]?.includes("apply-choice-figure-discard"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
