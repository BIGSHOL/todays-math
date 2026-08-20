/**
 * 전량 검수용 **묶음 시트** — 한 장에 짝 여럿. 눈이 1,576번이 아니라 N번 보게 한다.
 *
 *   node scripts/qa/render-svg-contact.mjs [--per=4] [--dir=…] [--out=…] [--only=<번호,번호,…>]
 *
 * 왜 묶나: 한 짝씩 1,576장을 보면 **뒤로 갈수록 대충 보게 된다.** 그건 「전량
 * 봤다」가 「전량 통과」로 둔갑하는 길이다. 묶으면 훑는 횟수가 줄어 끝까지 같은
 * 눈으로 볼 수 있다.
 *
 * 🔴 **묶으면 작아진다 — 작아져서 못 보면 묶는 뜻이 없다.** 그래서 쓰기 전에
 *    `--only` 로 **이미 결함으로 판정한 짝**을 섞은 시험 시트를 만들어,
 *    그 크기에서도 결함이 보이는지 확인한다. 안 보이면 `--per` 를 줄인다.
 *
 * 순서는 `screen.json`(의심도 내림차순)을 따른다 — 중간에 멈춰도 **남은 쪽이
 * 가장 안전한 쪽**이 되게.
 *
 * ⚠️ 아무것도 안 바꾼다.
 */
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const DIR = arg("dir", "scripts/qa/reports/svg-compare");
const OUT = arg("out", path.join(DIR, "contact"));
const PER = Number(arg("per", "4"));
const ONLY = arg("only", "");

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const dataUri = (f) =>
  `data:${MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream"};base64,${readFileSync(f).toString("base64")}`;

// 순서는 의심도(있으면), 없으면 index 순.
let rows;
try {
  rows = JSON.parse(readFileSync(path.join(DIR, "screen.json"), "utf-8"))["행"];
} catch {
  rows = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf-8"))["행"];
}
if (ONLY) {
  const want = new Set(ONLY.split(",").map((s) => s.trim().padStart(4, "0")));
  rows = rows.filter((r) => want.has(String(r.file).slice(0, 4)));
  // 시험 시트는 순서를 섞는다 — 「앞의 넷이 결함」이면 시험이 안 된다.
  let seed = 7;
  rows.sort(() => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5);
}

/**
 * 🔴 **둘을 같은 높이로 맞춘다.** 안 그러면 SVG 가 훨씬 작게 나온다 —
 * SVG 의 자연 크기는 mm(70mm≈264px)인데 래스터는 원본 픽셀(수백~수천)이다.
 * 크기가 다르면 「내용이 같은가」를 못 견준다(작은 쪽의 잔 획이 안 보인다).
 * 높이를 고정하고 폭은 비율대로 둔다 — 비율 차이도 눈에 띄게 된다.
 */
const IMG = "height:190px;width:auto;max-width:340px;object-fit:contain";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
const sheets = [];
for (let s = 0; s * PER < rows.length; s++) {
  const group = rows.slice(s * PER, s * PER + PER);
  const html = group
    .map(
      (r) => `<div style="display:flex;gap:10px;align-items:flex-start;
        border-bottom:1px solid #ddd;padding:6px 0">
        <div style="width:52px;flex:none;color:#333;font-weight:600">${String(r.file).slice(0, 4)}</div>
        <div style="flex:none"><div style="color:#888;font-size:11px">래스터(정본)</div>
          <img src="${dataUri(r.raster)}" style="${IMG}"></div>
        <div style="flex:none;border-left:1px solid #bbb;padding-left:10px">
          <div style="color:#888;font-size:11px">SVG</div>
          <img src="${dataUri(r.svg)}" style="${IMG}"></div>
      </div>`,
    )
    .join("");
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff;
    font:13px system-ui;width:820px;padding:8px">${html}</body></html>`);
  const ok = await page.evaluate(() =>
    Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0),
  );
  // 빈 그림을 「깨끗하다」고 읽는 것이 이 검수에서 가장 나쁜 결과다.
  if (!ok) { console.error(`🔴 시트 ${s + 1}: 그림이 안 실렸다`); process.exit(1); }
  const name = `sheet-${String(s + 1).padStart(4, "0")}.png`;
  await page.locator("body").screenshot({ path: path.join(OUT, name) });
  sheets.push({ sheet: s + 1, file: name, items: group.map((r) => String(r.file).slice(0, 4)) });
  if ((s + 1) % 20 === 0) process.stdout.write(`\r시트 ${s + 1}`);
}
await browser.close();
writeFileSync(path.join(OUT, "sheets.json"),
  JSON.stringify({ 기준: `한 장에 ${PER}짝 · 의심도 내림차순`, 총시트: sheets.length,
                   총짝: rows.length, 행: sheets }, null, 1), "utf-8");
console.log(`\r묶음 시트 ${sheets.length}장 (짝 ${rows.length} · 장당 ${PER}) → ${OUT}`);
