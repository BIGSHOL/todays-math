/**
 * 짝 하나를 **크게** 그린다 — 남의 판정을 내 눈으로 검산할 때.
 *   node scripts/qa/zoom-pair.mjs 0263 [--scale=3] [--crop=0,0,0.5,1]
 * ⚠️ 아무것도 안 바꾼다.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const DIR = "scripts/qa/reports/svg-compare";
const num = process.argv[2].padStart(4, "0");
const SCALE = Number(process.argv.find((a) => a.startsWith("--scale="))?.slice(8) ?? 3);
const CROP = (process.argv.find((a) => a.startsWith("--crop="))?.slice(7) ?? "0,0,1,1")
  .split(",").map(Number);
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp" };
const uri = (f) => `data:${MIME[path.extname(f).toLowerCase()]};base64,${readFileSync(f).toString("base64")}`;
const rows = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf-8"))["행"];
const r = rows.find((x) => String(x.file).slice(0, 4) === num);
if (!r) { console.error("없다"); process.exit(1); }
const W = 620 * SCALE;
// 크롭: 그림을 W 로 키운 뒤 창을 통해 일부만 본다.
const box = (label, f) => `<div style="flex:none">
  <div style="font:14px system-ui;color:#666">${label}</div>
  <img src="${uri(f)}" style="width:${W}px;height:auto;border:1px solid #ccc;background:#fff;
       image-rendering:pixelated;display:block">
  </div>`;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff;padding:6px;
  display:flex;flex-direction:column;gap:8px">${box("래스터(정본)", r.raster)}${box("SVG", r.svg)}</body></html>`);
const ok = await page.evaluate(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
if (!ok) { console.error("🔴 그림이 안 실렸다"); process.exit(1); }
mkdirSync(path.join(DIR, "zoom"), { recursive: true });
const out = path.join(DIR, "zoom", `${num}.png`);
await page.locator("body").screenshot({ path: out });
await browser.close();
console.log(`${out}  ${r.svg}`);
