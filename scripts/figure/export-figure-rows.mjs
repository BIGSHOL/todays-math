/**
 * HWP 대조 대상 행을 파일로 뽑는다 (DB → JSON). 대조기는 DB 를 모른다.
 *
 *   node scripts/figure/export-figure-rows.mjs           그림 붙은 기출 전량
 *   node scripts/figure/export-figure-rows.mjs --gap     그림 없는데 본문이 그림을 가리키는 행
 *
 * 정렬(DB 문항번호 ↔ HWP 순번)은 트랙 D 의 `hwp-verdicts.jsonl` 을 쓴다 —
 * `align='확정'` 인 행만 담는다. 순번을 임의로 가정하지 않는다.
 */
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { PrismaClient } from "@prisma/client";

const GAP = process.argv.includes("--gap");
const VERDICTS =
  process.env.HWP_VERDICTS ??
  "C:/Users/user/orca/workspaces/testautocreator/잔여-D-HWP/scripts/qa/reports/hwp-verdicts.jsonl";
const OUT = "scripts/qa/reports/figure-rows.json";
/** 정렬된 기출 행 전량 — 오배치 그림을 **주인 문항으로 옮길** 때 대상 행을 찾는 지도. */
const MAP = "scripts/qa/reports/figure-row-map.json";

const FIGURE_WORD =
  /그림과\s*같|그림에서|그림은|아래\s*그림|다음\s*그림|위\s*그림|\[그림|그림처럼|그림의/;

const align = new Map();
for await (const line of createInterface({
  input: createReadStream(VERDICTS, "utf8"),
  crlfDelay: Infinity,
})) {
  if (!line.trim()) continue;
  const v = JSON.parse(line);
  if (v.align === "확정" && v.hwpNumber != null) align.set(v.id, v.hwpNumber);
}

const db = new PrismaClient();
try {
  const rows = await db.$queryRawUnsafe(
    `select id, exam_id::text as e, question_number as q, content, figure_urls
       from problem
      where source = 'past_exam' and exam_id is not null and question_number is not null`,
  );
  const out = [];
  const map = [];
  for (const r of rows) {
    const hwpQ = align.get(r.id);
    if (hwpQ == null) continue;
    const has = (r.figure_urls ?? []).length > 0;
    map.push({ id: r.id, e: r.e, q: r.q, hwpQ, db: r.figure_urls ?? [] });
    if (GAP) {
      if (has || !FIGURE_WORD.test(r.content ?? "")) continue;
      out.push({ id: r.id, e: r.e, q: r.q, hwpQ, db: [] });
    } else {
      if (!has) continue;
      out.push({ id: r.id, e: r.e, q: r.q, hwpQ, db: r.figure_urls });
    }
  }
  await writeFile(OUT, JSON.stringify(out), "utf8");
  await writeFile(MAP, JSON.stringify(map), "utf8");
  const manifestExists = await readFile("scripts/figure/hwp-figure-index.json", "utf8")
    .then(() => true)
    .catch(() => false);
  console.log(
    `대조 대상 ${out.length}행 → ${OUT}` +
      `  · 정렬행 지도 ${map.length}행 → ${MAP}` +
      (manifestExists ? "" : "  (⚠️ hwp-figure-index.json 이 없다 — index-hwp-figures.py 를 먼저 돌려라)"),
  );
} finally {
  await db.$disconnect();
}
