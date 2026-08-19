/**
 * 파일럿(index-batch)으로 적재한 문항만 골라 렌더·정답을 점검한다.
 *
 * 전수검사(ocr-audit)는 9,552건 집계라 새로 들어온 355건이 묻힌다.
 * 이 스크립트는 `scripts/qa/reports/index-batch/*.json` 의 examId 에 속한 행만 본다.
 *
 * 화면 출력은 집계 + 대표 사례 몇 줄뿐(토큰 절약 원칙 §4).
 * 사용: node scripts/qa/check-pilot-rows.mjs [--dir scripts/qa/reports/index-batch]
 */
import { readFileSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import katex from "katex";
// ── 원문자 목록은 **한 곳**에서 온다 ────────────────────────────────────────────
// `scripts/qa/circled-glyphs.json` 은 `src/lib/math/circledNumber.ts` 에서 생성된다.
const { 본문마커: BODY_MARKS } = JSON.parse(
  readFileSync(new URL("./circled-glyphs.json", import.meta.url), "utf8"),
);

const dirArg = process.argv.indexOf("--dir");
const DIR = dirArg > -1 ? process.argv[dirArg + 1] : "scripts/qa/reports/index-batch";
const OUT = "scripts/qa/reports/pilot-rows.json";

const db = new PrismaClient();

const examIds = (await readdir(DIR))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const rows = await db.problem.findMany({
  where: { examId: { in: examIds } },
  select: {
    id: true,
    externalId: true,
    school: true,
    content: true,
    answer: true,
    solution: true,
    questionNumber: true,
  },
});

/** KaTeX 실패 판정 — 클래스뿐 아니라 붉은 색까지 본다(09/렌더 교훈). */
const RED = "#cc0000";
function renderFails(latex) {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      strict: false,
    });
    return html.includes("katex-error") || html.includes(RED);
  } catch {
    return true;
  }
}

/** 본문에서 $...$ 수식만 뽑는다. */
function mathRuns(text) {
  return [...text.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
}

// LaTeX 안에 그대로 들어온 유니코드 수학기호 — KaTeX 가 못 읽는 것들
const RAW_UNICODE = /[√∅∩∪⊂⊃⊆⊇∈∉≠≤≥×÷±∞∠△□∽≡→←↔⇔⇒∑∏∫]/;

const stat = {
  총: rows.length,
  정답보유: 0,
  해설보유: 0,
  KATEX_실패: 0,
  수식내_원시유니코드: 0,
  보기없음: 0,
};
const samples = { katex: [], unicode: [] };

for (const r of rows) {
  if (r.answer && r.answer !== "(정답 없음)") stat.정답보유 += 1;
  if (r.solution) stat.해설보유 += 1;
  if (!new RegExp(String.raw`\n\s*(?:[1-9][.)]|[${BODY_MARKS}])`).test(r.content))
    stat.보기없음 += 1;

  const runs = mathRuns(r.content);
  const bad = runs.filter((x) => renderFails(x));
  if (bad.length > 0) {
    stat.KATEX_실패 += 1;
    if (samples.katex.length < 4)
      samples.katex.push({ externalId: r.externalId, latex: bad[0].slice(0, 60) });
  }
  const uni = runs.find((x) => RAW_UNICODE.test(x));
  if (uni) {
    stat.수식내_원시유니코드 += 1;
    if (samples.unicode.length < 6)
      samples.unicode.push({ externalId: r.externalId, latex: uni.slice(0, 60) });
  }
}

await writeFile(OUT, JSON.stringify({ stat, samples }, null, 1), "utf8");

console.log("── 파일럿 적재분 점검 ──");
for (const [k, v] of Object.entries(stat)) {
  const pct = k === "총" ? "" : ` (${((v * 100) / Math.max(1, stat.총)).toFixed(1)}%)`;
  console.log(`  ${k.padEnd(18)} ${String(v).padStart(5)}${pct}`);
}
if (samples.unicode.length > 0) {
  console.log("\n  수식 안 원시 유니코드 사례:");
  for (const s of samples.unicode) console.log(`    ${s.externalId}  $${s.latex}$`);
}
if (samples.katex.length > 0) {
  console.log("\n  KaTeX 실패 사례:");
  for (const s of samples.katex) console.log(`    ${s.externalId}  $${s.latex}$`);
}
console.log(`\n→ ${OUT}`);
await db.$disconnect();
