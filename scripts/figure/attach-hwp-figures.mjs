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
if (APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error("공유 DB 쓰기가 막혀 있다. ALLOW_SHARED_IMPORT=1 과 --apply 가 둘 다 필요하다.");
  process.exit(1);
}

const PLAN = "scripts/qa/reports/figure-recover-plan.json";
const REPORT = "scripts/qa/reports/figure-attach-report.json";

const plan = JSON.parse(await readFile(PLAN, "utf8")).계획;
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

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
