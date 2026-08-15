/**
 * `$...$` 안에 들어 있는 **유니코드 수학기호**를 전수로 세고, KaTeX 가 실제로
 * 못 그리는 것만 골라낸다.
 *
 * 배경: 완료본 텍스트레이어 추출물이 `√5` `≤` 처럼 기호를 날문자로 싣는다.
 * 어떤 것은 KaTeX 가 알아서 그리고 어떤 것은 못 그린다 — 추측하지 말고 센다.
 *
 * 화면 출력은 표 한 장뿐. 사용: node scripts/qa/scan-math-unicode.mjs
 */
import { writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import katex from "katex";

const db = new PrismaClient();
const OUT = "scripts/qa/reports/math-unicode.json";

/** ASCII·한글·기본 구두점을 뺀 나머지 = 후보 기호 */
const PLAIN = /[ -~가-힣ㄱ-ㆎ\s]/;

const rows = await db.problem.findMany({
  select: { id: true, content: true, answer: true },
});

/** 문자 → {건수, 문항수} */
const count = new Map();
const seenInRow = new Set();

for (const r of rows) {
  const text = `${r.content}\n${r.answer ?? ""}`;
  seenInRow.clear();
  for (const m of text.matchAll(/\$([^$]+)\$/g)) {
    for (const ch of m[1]) {
      if (PLAIN.test(ch)) continue;
      const e = count.get(ch) ?? { n: 0, rows: 0 };
      e.n += 1;
      if (!seenInRow.has(ch)) {
        e.rows += 1;
        seenInRow.add(ch);
      }
      count.set(ch, e);
    }
  }
}

/** KaTeX 가 그 글자 하나를 수식으로 그릴 수 있는가 */
function katexHandles(ch) {
  try {
    const html = katex.renderToString(ch, { throwOnError: true, strict: "error" });
    return !html.includes("katex-error") && !html.includes("#cc0000");
  } catch {
    return false;
  }
}

const table = [...count.entries()]
  .map(([ch, e]) => ({
    ch,
    code: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
    ...e,
    ok: katexHandles(ch),
  }))
  .sort((a, b) => b.rows - a.rows);

await writeFile(OUT, JSON.stringify(table, null, 1), "utf8");

const bad = table.filter((t) => !t.ok);
console.log("── 수식 안 유니코드 기호 (전 문항 스캔) ──");
console.log(`문항 ${rows.length} · 서로 다른 기호 ${table.length} · KaTeX 미지원 ${bad.length}`);
console.log("\n  ✗ KaTeX 가 못 그리는 것 (고쳐야 할 대상)");
console.log("  기호  코드      문항수   출현");
for (const t of bad.slice(0, 20)) {
  console.log(`   ${t.ch}   ${t.code.padEnd(8)} ${String(t.rows).padStart(6)} ${String(t.n).padStart(6)}`);
}
console.log("\n  ✓ KaTeX 가 그리는 것 (상위 8개, 손대지 않음)");
console.log(
  "   " +
    table
      .filter((t) => t.ok)
      .slice(0, 8)
      .map((t) => `${t.ch}(${t.rows})`)
      .join("  "),
);
console.log(`\n→ ${OUT}`);
await db.$disconnect();
