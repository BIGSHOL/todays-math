/**
 * 트랙 E 적재분에 그림을 붙인다 — **E 의 적재가 끝난 뒤에만 돌린다.**
 *
 *   node scripts/figure/attach-load-figures.mjs                드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 node scripts/figure/attach-load-figures.mjs --apply
 *   node scripts/figure/attach-load-figures.mjs --only-choice-figures   보기그림 문항 먼저
 *
 * 선행: `python scripts/figure/prepare-load-figures.py --write`
 *       (그림 파일이 `public/figures/` 에 이미 있어야 한다 — 파일 없는 경로는 붙이지 않는다)
 *
 * 적재 전에 돌리면 **대상 행이 0** 으로 나온다. 그건 실패가 아니라 아직 이르다는 뜻이다.
 * 계획에 있는데 DB 에 없는 (편, 번호) 를 따로 세어 보여 준다 — 그 수가 계획 수와 같으면
 * 아직 적재 전이다.
 *
 * - `source='past_exam'` · `figure_urls`/`figure_source` 만 쓴다.
 * - 이미 그림이 붙은 행은 건드리지 않는다(멱등).
 * - 공유 DB 쓰기는 `--apply` + `ALLOW_SHARED_IMPORT=1` 둘 다 있을 때만. 게이트는 접속 앞.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ONLY_CHOICE = process.argv.includes("--only-choice-figures");
/** 보기마다 그림인 문항 — 그림이 없으면 보기가 비어 출제되면 안 된다(트랙 E 표시). */
const CHOICE_FIGURE_MIN = 4;

if (APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error("공유 DB 쓰기가 막혀 있다. ALLOW_SHARED_IMPORT=1 과 --apply 가 둘 다 필요하다.");
  process.exit(1);
}

const PLAN = "scripts/qa/reports/figure-load-plan.json";
const REPORT = "scripts/qa/reports/figure-load-attach-report.json";

const planFile = JSON.parse(await readFile(PLAN, "utf8"));
const plan = planFile.계획.filter(
  (p) => !ONLY_CHOICE || p.urls.length >= CHOICE_FIGURE_MIN,
);

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

try {
  const rows = await db.$queryRawUnsafe(
    `select id, exam_id::text as e, question_number as q, figure_urls
       from problem
      where source = 'past_exam'
        and exam_id = any($1::text[])
        and question_number is not null`,
    [...new Set(plan.map((p) => p.e))],
  );
  const byKey = new Map(rows.map((r) => [`${r.e} ${r.q}`, r]));

  const stat = {
    계획행: plan.length,
    "아직 DB 에 없음": 0,
    "건너뜀:이미그림있음": 0,
    "건너뜀:파일없음": 0,
    붙일행: 0,
    붙일장수: 0,
  };
  const todo = [];
  for (const p of plan) {
    const row = byKey.get(`${p.e} ${p.q}`);
    if (!row) {
      stat["아직 DB 에 없음"] += 1;
      continue;
    }
    if ((row.figure_urls ?? []).length) {
      stat["건너뜀:이미그림있음"] += 1;
      continue;
    }
    const ok = [];
    for (const u of p.urls) {
      try {
        await access(path.join("public", u));
        ok.push(u);
      } catch {
        /* 파일이 없으면 붙이지 않는다 — 깨진 이미지는 그림 없음보다 나쁘다 */
      }
    }
    if (ok.length !== p.urls.length) {
      // 보기 그림은 하나만 빠져도 보기가 어긋난다. 반쪽으로 붙이지 않는다.
      stat["건너뜀:파일없음"] += 1;
      continue;
    }
    stat.붙일행 += 1;
    stat.붙일장수 += ok.length;
    todo.push({ id: row.id, e: p.e, q: p.q, urls: ok });
  }

  if (APPLY) {
    let done = 0;
    for (const t of todo) {
      await db.$executeRawUnsafe(
        `update "problem" set "figure_urls" = $1::text[], "figure_source" = 'source'
          where id = $2::uuid and source = 'past_exam'
            and coalesce(array_length("figure_urls",1),0) = 0`,
        t.urls,
        t.id,
      );
      done += 1;
      if (done % 200 === 0) console.log(`  … ${done}/${todo.length}`);
    }
    stat.갱신행 = done;
  }

  await writeFile(
    REPORT,
    JSON.stringify(
      { 기준시각: new Date().toISOString(), 적용: APPLY, 보기그림만: ONLY_CHOICE, 집계: stat, 대상: todo },
      null,
      1,
    ),
    "utf8",
  );

  console.log(APPLY ? "── 적재분 그림 연결 완료 ──" : "── 드라이런(쓰기 없음) ──", ONLY_CHOICE ? "[보기그림 문항만]" : "");
  for (const [k, v] of Object.entries(stat)) console.log(`  ${k.padEnd(18)} ${v}`);
  if (stat["아직 DB 에 없음"] === stat.계획행) {
    console.log("  → 계획 전량이 아직 DB 에 없다. 트랙 E 의 적재가 끝나기 전이다.");
  }
  console.log(`  상세 → ${REPORT}`);
} finally {
  await db.$disconnect();
}
