/**
 * HWP 정본에서 회수한 그림을 `figureUrls` 에 붙인다.
 *
 *   node scripts/figure/attach-hwp-figures.mjs                드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 node scripts/figure/attach-hwp-figures.mjs --apply
 *
 * 선행: `python scripts/figure/recover-hwp-figures.py --write`
 *
 * - 대상은 **지금 그림이 하나도 없는** 기출 문항뿐이다. 이미 붙은 행은 건드리지 않는다
 *   (덧붙이기는 `prune-figures.mjs` 의 이관 경로가 담당한다).
 * - 파일이 실제로 있는 경로만 붙인다.
 * - `source='past_exam'` · `figure_urls`/`figure_source` 만 쓴다.
 * - 공유 DB 쓰기는 `--apply` + `ALLOW_SHARED_IMPORT=1` 둘 다 있을 때만. 게이트는 접속 앞.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error("공유 DB 쓰기가 막혀 있다. ALLOW_SHARED_IMPORT=1 과 --apply 가 둘 다 필요하다.");
  process.exit(1);
}

// 회수 경로가 둘이다 — HWP 정본(`recover-hwp-figures.py`)과 PDF 발문 기준
// (`crop-pdf-by-stem.py`). 산출 모양이 같으므로 붙이는 쪽은 하나만 둔다.
const PLAN =
  process.argv.find((a) => a.startsWith("--plan="))?.slice("--plan=".length) ??
  "scripts/qa/reports/figure-recover-plan.json";
const REPORT = "scripts/qa/reports/figure-attach-report.json";
/**
 * **되돌리기 원장.** 행마다 `before`(붙이기 **전** `figure_urls`)를 담는다.
 *
 * ⚠️ 예전에는 `figure-attach-report.json` 만 썼는데 그건 (1) `.gitignore` 에 걸려
 * **커밋이 안 되고** (2) DB 를 **다 쓴 뒤에** 기록됐다. 둘 다 「되돌릴 근거」로는
 * 못 쓴다 — 이 컴퓨터에만 남으면 다른 컴퓨터에서 되돌릴 길이 없고, 중간에 죽으면
 * 무엇을 썼는지조차 모른다(2026-08-18 적대적 리뷰가 지적한 그 자리).
 * 그래서 **DB 보다 먼저** 쓰고, `.gitignore` 예외로 커밋되게 한다.
 */
const LEDGER = "scripts/qa/reports/figure-attach-ledger.json";

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

if (REVERT) {
  // **지금 값이 우리가 쓴 값일 때만** 되돌린다 — 남의 변경을 덮지 않는다.
  const ledger = JSON.parse(await readFile(LEDGER, "utf8"));
  let back = 0, skip = 0;
  for (const r of ledger.rows) {
    const [now] = await db.$queryRawUnsafe(
      `select figure_urls from problem where id = $1::uuid`, r.id,
    );
    if (!now || JSON.stringify(now.figure_urls ?? []) !== JSON.stringify(r.after)) { skip += 1; continue; }
    await db.$executeRawUnsafe(
      `update "problem" set "figure_urls" = $1::text[] where id = $2::uuid`,
      r.before, r.id,
    );
    back += 1;
  }
  console.log(`되돌림 ${back}행 · 값이 달라 건드리지 않음 ${skip}행`);
  await db.$disconnect();
  process.exit(0);
}

const plan = JSON.parse(await readFile(PLAN, "utf8")).계획;

try {
  const rows = await db.$queryRawUnsafe(
    `select id, figure_urls from problem where id = any($1::uuid[]) and source = 'past_exam'`,
    plan.map((p) => p.id),
  );
  const cur = new Map(rows.map((r) => [r.id, r.figure_urls ?? []]));

  const stat = { 계획행: plan.length, "건너뜀:행없음": 0, "건너뜀:이미그림있음": 0, "건너뜀:파일없음": 0, 붙일행: 0, 붙일장수: 0 };
  const todo = [];
  for (const p of plan) {
    const now = cur.get(p.id);
    if (now === undefined) { stat["건너뜀:행없음"] += 1; continue; }
    if (now.length) { stat["건너뜀:이미그림있음"] += 1; continue; }
    const ok = [];
    for (const u of p.urls) {
      try { await access(path.join("public", u)); ok.push(u); } catch { /* 없는 파일은 붙이지 않는다 */ }
    }
    if (!ok.length) { stat["건너뜀:파일없음"] += 1; continue; }
    stat.붙일행 += 1;
    stat.붙일장수 += ok.length;
    todo.push({ id: p.id, e: p.e, q: p.q, mention: p.mention, urls: ok });
  }

  if (APPLY) {
    // ── 되돌리기 자료를 **DB 보다 먼저** 쓴다. 순서가 반대면 중간에 죽었을 때 근거가 없다.
    let ledger = { note: "되돌리기 자료. `before` 가 붙이기 전 값이다.", rows: [] };
    try { ledger = JSON.parse(await readFile(LEDGER, "utf8")); } catch { /* 처음이면 새로 만든다 */ }
    const seen = new Set(ledger.rows.map((r) => r.id));
    for (const t of todo) {
      if (seen.has(t.id)) continue;   // 여러 번 돌려도 **최초 상태**를 잃지 않는다
      ledger.rows.push({ id: t.id, e: t.e, q: t.q, before: cur.get(t.id) ?? [], after: t.urls, plan: PLAN });
    }
    ledger.기준시각 = new Date().toISOString();
    ledger.적용됨 = true;
    ledger.되돌리기 =
      "ALLOW_SHARED_IMPORT=1 node scripts/figure/attach-hwp-figures.mjs --revert";
    await writeFile(LEDGER, JSON.stringify(ledger, null, 1), "utf8");
    console.log(`  되돌리기 원장 → ${LEDGER} (누적 ${ledger.rows.length}행)`);

    let done = 0;
    for (const t of todo) {
      await db.$executeRawUnsafe(
        `update "problem" set "figure_urls" = $1::text[], "figure_source" = 'source'
          where id = $2::uuid and source = 'past_exam' and coalesce(array_length("figure_urls",1),0) = 0`,
        t.urls, t.id,
      );
      done += 1;
      if (done % 100 === 0) console.log(`  … ${done}/${todo.length}`);
    }
    stat.갱신행 = done;
  }

  await writeFile(REPORT, JSON.stringify({ 기준시각: new Date().toISOString(), 적용: APPLY, 집계: stat, 대상: todo }, null, 1), "utf8");
  console.log(APPLY ? "── 회수 그림 적재 완료 ──" : "── 드라이런(쓰기 없음) ──");
  for (const [k, v] of Object.entries(stat)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`  상세 → ${REPORT}`);
} finally {
  await db.$disconnect();
}
