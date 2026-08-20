/**
 * SVG 채택 전후 **인쇄 높이**가 얼마나 움직였나 — 되돌리기 원장에서 잰다.
 *
 *   node scripts/qa/measure-svg-height-delta.mjs
 *
 * 왜 필요한가: 인쇄 폭은 mm 라 안 변하지만 **높이는 비율을 따라간다.**
 * 그래서 「비율이 2% 안」이라는 가드가 곧 「높이가 2% 안」이다 — 그 둘이
 * 어긋나면 가드가 아무것도 보장하지 않는다.
 *
 * 🔴 실제로 이 자가 결함을 찾았다: 가드는 반올림 **전** viewBox 를 재는데
 *    `figure_dims` 는 Int[] 라 **반올림 뒤** 값이 지면에 쓰인다. viewBox 가
 *    74×29 처럼 작아서 반올림만으로 비율이 3% 흔들렸다(가드는 2%).
 *    가드를 「저장할 값」으로 고친 뒤 최대가 2% 안으로 들어왔다.
 *
 * ⚠️ 아무것도 안 바꾼다.
 */
import { readFileSync } from "node:fs";
const L = JSON.parse(readFileSync("scripts/qa/reports/figure-svg-adopt.json", "utf-8"));
let worst = 0, worstId = "", n = 0, over1 = 0;
const deltas = [];
for (const r of L.rows) {
  for (let i = 0; i < r.beforeUrls.length; i++) {
    const bw = r.beforeDims[i * 2], bh = r.beforeDims[i * 2 + 1];
    const aw = r.afterDims[i * 2], ah = r.afterDims[i * 2 + 1];
    if (!bw || !bh || !aw || !ah) continue;
    // 같은 인쇄 폭 W 에서 높이는 W*(h/w) 다 → 변화율 = (ah/aw)/(bh/bw) - 1
    const d = (ah / aw) / (bh / bw) - 1;
    deltas.push(Math.abs(d)); n++;
    if (Math.abs(d) > Math.abs(worst)) { worst = d; worstId = r.id; }
    if (Math.abs(d) > 0.01) over1++;
  }
}
deltas.sort((a, b) => a - b);
const pct = (q) => (deltas[Math.floor(deltas.length * q)] * 100).toFixed(3);
console.log(`자리 ${n}`);
console.log(`  높이 변화 중앙 ${pct(0.5)}% · 95분위 ${pct(0.95)}% · 최대 ${(worst * 100).toFixed(2)}%`);
console.log(`  1% 넘게 변한 자리 ${over1} (${((over1 / n) * 100).toFixed(1)}%)`);
console.log(`  가장 큰 문항 ${worstId}`);
