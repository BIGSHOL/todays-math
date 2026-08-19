/**
 * 되돌리기가 **정말** 되는가 — 공유 DB 를 읽어 **로컬 사본**에 적용하고 되돌린다.
 *
 * 공유 DB 에는 한 글자도 안 쓴다(브리프 규칙). 지금 값을 읽어 메모리에 사본을 만들고,
 * 제품이 실제로 쓰는 **순수 함수 그대로**(`decideDiscard`/`revertDiscard`,
 * `planRow`/`revertRow`) 적용 → 되돌리기를 돌린 뒤 **원래 값과 한 글자도 다르지
 * 않은지** 대조한다. 규칙을 옮겨 적지 않는다 — 옮겨 적으면 동어반복이 된다.
 *
 * 경합도 같이 시험한다: 사이에 **남이 값을 바꾼** 행은 되돌리기가 건드리면 안 된다.
 *
 *   npx tsx qa/adversarial/scripts/revert-roundtrip.ts
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import {
  decideDiscard,
  revertDiscard,
  type LockedRow,
} from "../../../scripts/qa/apply-choice-figure-discard";
import {
  planRow,
  revertRow,
  type DbRow,
  type LedgerRow,
  type Pair,
} from "../../../scripts/qa/apply-choice-figure-index";

const prisma = new PrismaClient();
let failed = 0;

function check(ok: boolean, label: string, extra = "") {
  console.log(`  ${ok ? "✅" : "🔴"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed += 1;
}

/* ── ㉮ 출제 제외 (directUseAllowed) ─────────────────────────────────── */

async function discardRoundTrip() {
  console.log("\n── ㉮ 출제 제외 잠금 · 적용 → 되돌리기 (로컬 사본) ──");
  const ledger = JSON.parse(
    readFileSync("scripts/qa/reports/choice-figure-discard-lock.json", "utf8"),
  ) as { 이전상태: LockedRow[] };
  const ids = ledger.이전상태.map((r) => r.id);

  const real = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, direct_use_allowed AS "directUseAllowed"
       FROM problem WHERE id = ANY($1::uuid[])`,
    ids,
  )) as { id: string; directUseAllowed: boolean }[];

  // 로컬 사본 — 여기서만 쓴다
  const db = new Map(
    real.map((r) => [r.id, { directUseAllowed: r.directUseAllowed }]),
  );
  const before = new Map([...db].map(([k, v]) => [k, v.directUseAllowed]));
  check(
    db.size === ids.length,
    `원장 ${ids.length}행이 DB 에 다 있다`,
    `${db.size}행 읽음`,
  );
  check(
    [...before.values()].every((v) => v === true),
    "잠그기 전 값이 전부 true (원장의 before 와 같다)",
  );

  // 적용
  let locked = 0;
  for (const row of ledger.이전상태) {
    const now = db.get(row.id)!;
    if (now.directUseAllowed) {
      now.directUseAllowed = false;
      locked += 1;
    }
  }
  check(locked === ids.length, `적용: ${ids.length}행을 뺐다`, `${locked}행`);

  // 🔴 경합 — 사이에 남이 한 행을 도로 풀어 놓았다
  const stolen = ids[0]!;
  db.get(stolen)!.directUseAllowed = true;

  // 되돌리기 — **제품이 쓰는 판단 함수 그대로**
  let restored = 0;
  let untouched = 0;
  for (const row of ledger.이전상태) {
    const d = revertDiscard(row, db.get(row.id));
    if (d.restore) {
      db.get(row.id)!.directUseAllowed = d.to;
      restored += 1;
    } else untouched += 1;
  }
  check(
    untouched === 1 && restored === ids.length - 1,
    "남이 바꾼 1행은 안 건드리고 나머지를 되돌렸다",
    `되돌림 ${restored} · 안 건드림 ${untouched}`,
  );

  const diff = [...before].filter(
    ([id, v]) => db.get(id)!.directUseAllowed !== v,
  );
  check(
    diff.length === 0,
    "되돌린 뒤 원래 값과 **한 글자도** 다르지 않다",
    `다른 행 ${diff.length}`,
  );

  // 되돌리기를 한 번 더 — 멱등이어야 한다 (이제 전부 true 라 아무것도 안 한다)
  const again = ledger.이전상태.filter(
    (r) => revertDiscard(r, db.get(r.id)).restore,
  );
  check(
    again.length === 0,
    "되돌리기를 한 번 더 돌려도 아무것도 안 바꾼다 (멱등)",
  );
}

/* ── ㉯ 짝 적재 (choiceFigureIndex) ──────────────────────────────────── */

async function indexRoundTrip() {
  console.log("\n── ㉯ 보기 그림 짝 적재 · 적용 → 되돌리기 (로컬 사본) ──");
  const pairs = JSON.parse(
    readFileSync("scripts/qa/reports/choice-figure-pairs.json", "utf8"),
  ) as Pair[];
  const auto = pairs.filter((p) => p.verdict === "자동");

  const real = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, figure_urls AS "figureUrls",
            exam_id AS "examId", question_number AS "questionNumber"
       FROM problem WHERE id = ANY($1::uuid[])`,
    auto.map((p) => p.id),
  )) as Omit<DbRow, "choiceFigureIndex">[];

  // 컬럼이 아직 없으므로 마이그레이션 직후 상태(전 행 빈 배열)를 사본으로 만든다
  const db = new Map<string, DbRow>(
    real.map((r) => [r.id, { ...r, choiceFigureIndex: [] as number[] }]),
  );
  const before = new Map(
    [...db].map(([k, v]) => [k, [...v.choiceFigureIndex]]),
  );

  const plan: LedgerRow[] = [];
  for (const p of auto) {
    const d = planRow(p, db.get(p.id));
    if (d.ok) plan.push(d.row);
  }
  check(
    plan.length === auto.length,
    `계획 ${auto.length}행`,
    `${plan.length}행`,
  );

  for (const row of plan) db.get(row.id)!.choiceFigureIndex = [...row.after];

  // 멱등 — 다시 계획하면 한 행도 안 나와야 한다
  const replan = auto.filter((p) => planRow(p, db.get(p.id)).ok);
  check(
    replan.length === 0,
    "적용 뒤 다시 계획하면 0행 (멱등)",
    `${replan.length}행`,
  );

  // 🔴 경합 — 사이에 남이 다른 값을 넣었다
  const stolen = plan[0]!.id;
  db.get(stolen)!.choiceFigureIndex = [9, 9, 9];

  let restored = 0;
  let untouched = 0;
  for (const row of plan) {
    const d = revertRow(row, db.get(row.id));
    if (d.restore) {
      db.get(row.id)!.choiceFigureIndex = [...d.to];
      restored += 1;
    } else untouched += 1;
  }
  check(
    untouched === 1 && restored === plan.length - 1,
    "남이 넣은 1행은 안 덮고 나머지를 되돌렸다",
    `되돌림 ${restored} · 안 덮음 ${untouched}`,
  );

  const diff = [...before].filter(([id, v]) => {
    const now = db.get(id)!.choiceFigureIndex;
    return now.length !== v.length || now.some((x, i) => x !== v[i]);
  });
  check(
    diff.length === 1 && diff[0]![0] === stolen,
    "남이 바꾼 그 한 행 말고는 원래 값 그대로다",
    `다른 행 ${diff.length}`,
  );

  // 🔴 낡은 계획 — 그 사이 `prune-figures.mjs` 가 그림 한 장을 뗐다면 안 써야 한다
  const victim = auto.find((p) => (p.figureUrls ?? []).length > 1)!;
  const row = db.get(victim.id)!;
  const pruned: DbRow = {
    ...row,
    choiceFigureIndex: [],
    figureUrls: row.figureUrls.slice(1),
  };
  const d = planRow(victim, pruned);
  check(
    !d.ok && d.reason.includes("그림 목록이 바뀌었다"),
    "그림 한 장이 떨어진 뒤에는 짝을 안 쓴다 (한 칸씩 밀린 배열 방지)",
    d.ok ? "썼다" : d.reason,
  );
}

async function main() {
  await discardRoundTrip();
  await indexRoundTrip();
  console.log(
    failed === 0
      ? "\n✅ 되돌리기 왕복 전부 통과 — 공유 DB 는 한 글자도 안 썼다"
      : `\n🔴 ${failed}건 실패`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
