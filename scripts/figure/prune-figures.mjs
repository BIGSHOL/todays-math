/**
 * HWP 정본 대조 결과를 DB 에 반영한다 — **오배치 그림을 떼고, 주인 문항에 붙인다.**
 *
 *   node scripts/figure/prune-figures.mjs                 드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 node scripts/figure/prune-figures.mjs --apply
 *   node scripts/figure/prune-figures.mjs --no-move       떼기만 하고 옮기지 않는다
 *
 * 선행: `python scripts/figure/index-hwp-figures.py`
 *       `node scripts/figure/export-figure-rows.mjs`
 *       `python scripts/figure/match-hwp-figures.py`
 *
 * ── 왜 옮기는가 (실측 사례) ─────────────────────────────────────────────
 * 5364 18번(서술형·그릇 그림)에 17번의 **선택지 그래프 5장**이 통째로 딸려 있었고,
 * 정작 17번("일차함수 그래프를 바르게 나타낸 것은?")은 그림이 하나도 없어 풀 수
 * 없었다. 떼기만 하면 17번은 계속 못 푼다 — 주인에게 돌려줘야 둘 다 산다.
 *
 * ── 안전 규칙 ───────────────────────────────────────────────────────────
 * - 뗄 근거는 "그 그림이 같은 시험지 **다른 문항 것임이 증명**되었을 때" 뿐이다
 *   (`match-hwp-figures.py` 의 `owners`). 단순 불일치는 보류하고 건드리지 않는다.
 * - 남는 그림이 0장이 되는 행은 **떼지 않는다**(`전부오배치`는 보고만 한다).
 * - 옮길 대상 행이 이미 그 경로를 갖고 있으면 건너뛴다(멱등).
 * - `source='past_exam'` 만, `figure_urls`/`figure_source` 만 쓴다.
 * - 공유 DB 쓰기는 `--apply` + `ALLOW_SHARED_IMPORT=1` 둘 다 있을 때만. 게이트는 접속 앞.
 */
import { readFile, writeFile } from "node:fs/promises";

const APPLY = process.argv.includes("--apply");
const NO_MOVE = process.argv.includes("--no-move");

if (APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다. ALLOW_SHARED_IMPORT=1 과 --apply 가 둘 다 필요하다.",
  );
  process.exit(1);
}

const PLAN = "scripts/qa/reports/figure-match-plan.json";
const MAP = "scripts/qa/reports/figure-row-map.json";
const REPORT = "scripts/qa/reports/figure-prune-report.json";

const { PlanJson, MapJson } = {
  PlanJson: JSON.parse(await readFile(PLAN, "utf8")),
  MapJson: JSON.parse(await readFile(MAP, "utf8")),
};

// (시험지, HWP 순번) → 행. 주인 문항을 찾을 때 쓴다.
const byExamHwpQ = new Map();
for (const r of MapJson) byExamHwpQ.set(`${r.e} ${r.hwpQ}`, r);

const stat = {
  계획행: PlanJson.계획.length,
  뗄행: 0,
  뗄장수: 0,
  옮길장수: 0,
  "옮김:주인행없음": 0,
  "옮김:이미있음": 0,
  "보류:전부오배치": 0,
};
const edits = new Map(); // id → { urls, reason }

const urlsOf = (row) => edits.get(row.id)?.urls ?? row.db ?? [];

for (const p of PlanJson.계획) {
  if (p.verdict === "전부오배치") {
    // 떼면 그림이 0장이 된다. 그림 없는 문항은 풀 수 없으니 사람이 볼 몫으로 남긴다.
    stat["보류:전부오배치"] += 1;
    continue;
  }
  if (p.verdict !== "일부오배치" || !p.drop?.length) continue;
  // 보류분(`hold`)은 증거가 없어 못 떼는 그림이다 — 그대로 남긴다.
  // 남길 게 하나도 없으면 그 행은 건드리지 않는다(그림 0장 방지).
  const remain = [...(p.keep ?? []), ...(p.hold ?? [])];
  if (!remain.length) {
    stat["보류:전부오배치"] += 1;
    continue;
  }

  stat.뗄행 += 1;
  stat.뗄장수 += p.drop.length;
  edits.set(p.id, { urls: remain, e: p.e, q: p.q, reason: "오배치 제거" });

  if (NO_MOVE) continue;
  for (const url of p.drop) {
    const owner = p.owners?.[url];
    if (!owner) continue;
    const target = byExamHwpQ.get(`${p.e} ${Number(owner.문항)}`);
    if (!target) {
      stat["옮김:주인행없음"] += 1;
      continue;
    }
    const cur = urlsOf(target);
    if (cur.includes(url)) {
      stat["옮김:이미있음"] += 1;
      continue;
    }
    edits.set(target.id, {
      urls: [...cur, url],
      e: target.e,
      q: target.q,
      reason: "주인 문항으로 이관",
    });
    stat.옮길장수 += 1;
  }
}

const detail = [...edits.entries()].map(([id, v]) => ({ id, ...v }));

if (APPLY) {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    let done = 0;
    for (const e of detail) {
      await db.$executeRawUnsafe(
        `update "problem"
            set "figure_urls" = $1::text[],
                "figure_source" = case when array_length($1::text[], 1) > 0
                                       then 'source' else null end
          where id = $2::uuid and source = 'past_exam'`,
        e.urls,
        e.id,
      );
      done += 1;
      if (done % 200 === 0) console.log(`  … ${done}/${detail.length}`);
    }
    stat.갱신행 = done;
  } finally {
    await db.$disconnect();
  }
}

await writeFile(
  REPORT,
  JSON.stringify(
    { 기준시각: new Date().toISOString(), 적용: APPLY, 이관: !NO_MOVE, 집계: stat, 변경: detail },
    null,
    1,
  ),
  "utf8",
);

console.log(APPLY ? "── 정리 완료 ──" : "── 드라이런(쓰기 없음) ──", NO_MOVE ? "[떼기만]" : "[떼고 옮김]");
for (const [k, v] of Object.entries(stat)) console.log(`  ${k.padEnd(16)} ${v}`);
console.log(`  갱신 대상 행       ${detail.length}`);
console.log(`  상세 → ${REPORT}`);
