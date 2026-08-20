/**
 * SVG 채택 검수용 **비교 시트**를 만든다 — 왼쪽 래스터(정본) · 오른쪽 SVG.
 *
 * 왜 이렇게 만드나: 판정은 **눈으로** 해야 하는데, 그 눈이 볼 그림은 «제품이
 * 실제로 그리는 것»이어야 한다. 그래서 별도 변환기를 쓰지 않고 **브라우저의
 * `<img>` 로, 인쇄 폭(mm)으로** 그린다 — 지면과 같은 경로다.
 * (별도 하니스로 확인한 「80/80」이 제품과 다를 수 있었던 자리다.)
 *
 *   node scripts/qa/render-svg-compare.mjs [--limit=N] [--only=blocked]
 *
 * 산출: `scripts/qa/reports/svg-compare/<번호>__<경로>.png` (커밋하지 않는다)
 *       + `index.json` (번호 → 파일 경로·문항 id)
 *
 * ⚠️ 아무것도 안 바꾼다. 읽고 그리기만 한다.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const OUT =
  process.argv.find((a) => a.startsWith("--out="))?.slice(6) ??
  "scripts/qa/reports/svg-compare";
const LIMIT = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 0,
);
/** `--only=blocked` 면 **비율이 어긋나 막힌** 자리를 본다 (반대쪽 표본). */
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

/** 파일을 data: URI 로. 원본 바이트 그대로 — 다시 인코딩하지 않는다. */
function dataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

function viewBox(file) {
  try {
    const m = /viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/.exec(
      readFileSync(file, "utf-8").slice(0, 4000),
    );
    return m ? [Number(m[3]), Number(m[4])] : null;
  } catch {
    return null;
  }
}

const prisma = new PrismaClient();
const probs = await prisma.problem.findMany({
  where: { figureUrls: { isEmpty: false } },
  select: { id: true, figureUrls: true, figureDims: true, figureSourceMm: true },
});

/** 검수할 짝 목록 — 그림 **한 장**이 한 행이다. */
const pairs = [];
for (const p of probs) {
  for (let i = 0; i < p.figureUrls.length; i++) {
    const u = p.figureUrls[i];
    if (u.startsWith("/figures-svg/")) continue;
    const rel = u.replace(/^\/figures\//, "").replace(/\.[^./]+$/, ".svg");
    const svg = path.join("public/figures-svg", rel);
    if (!existsSync(svg)) continue;
    const raster = path.join("public", u);
    if (!existsSync(raster)) continue;
    const vb = viewBox(svg);
    const rw = p.figureDims?.[i * 2],
      rh = p.figureDims?.[i * 2 + 1];
    const mm = p.figureSourceMm?.[i] ?? null;
    if (!vb || !rw || !rh) continue;
    const diff = Math.abs(vb[0] / vb[1] - rw / rh) / (rw / rh);
    const blocked = diff > 0.02;
    if (ONLY === "blocked" ? !blocked : blocked) continue;
    if (ONLY !== "blocked" && !(mm > 0)) continue; // 채택 후보만
    pairs.push({
      problemId: p.id,
      url: u,
      svg,
      raster,
      mm: mm ?? 70,
      ratioDiff: +(diff * 100).toFixed(2),
      kind: u.startsWith("/figures/rpm/") ? "RPM" : "기출",
    });
  }
}
await prisma.$disconnect();

// 무작위로 섞는다 — 「깨끗해 보이는 것부터」 보면 아무것도 못 찾는다.
// 시드 고정: 다시 돌려도 같은 순서여야 「몇 번을 봤다」가 뜻을 갖는다.
let seed = 20260820;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
pairs.sort(() => rnd() - 0.5);
const targets = LIMIT > 0 ? pairs.slice(0, LIMIT) : pairs;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
const index = [];
let n = 0;
for (const t of targets) {
  const w = Math.min(t.mm, 70);
  // 지면과 같은 방식: `<img>` 에 인라인 mm 폭. 높이는 비율대로 따라온다.
  // ⚠️ 그림은 **data: URI 로 박는다.** `setContent` 페이지는 about:blank 라
  //    크롬이 `file://` 하위 자원을 막는다 — 그러면 **빈 그림이 나오는데
  //    스크린숏은 멀쩡히 찍힌다.** 실제로 그렇게 여섯 장이 전부 같은
  //    6,311바이트로 나왔다(2026-08-20). 조용히 실패하는 자리다.
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#FCFCF8;
    font:12px system-ui;display:flex;gap:8px;align-items:flex-start;padding:8px">
    <div><div style="color:#666">래스터(정본)</div>
      <img src="${dataUri(t.raster)}" style="width:${w}mm;height:auto"></div>
    <div style="border-left:1px solid #ccc;padding-left:8px"><div style="color:#666">SVG</div>
      <img src="${dataUri(t.svg)}" style="width:${w}mm;height:auto"></div>
  </body></html>`);
  // 두 그림이 **실제로 실렸는지** 확인한다. 안 실리면 멈춘다 — 빈 그림을
  // 「깨끗하다」고 읽는 것이 이 검수에서 가장 나쁜 결과다.
  const loaded = await page.evaluate(() =>
    Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0),
  );
  if (!loaded) {
    console.error(`
🔴 그림이 안 실렸다: ${t.url} — 빈 시트를 만들지 않는다.`);
    process.exit(1);
  }
  const name = `${String(++n).padStart(4, "0")}__${t.url.replace(/[/\\]/g, "_")}.png`;
  await page.locator("body").screenshot({ path: path.join(OUT, name) });
  index.push({ n, file: name, ...t });
  if (n % 100 === 0) process.stdout.write(`\r렌더 ${n}/${targets.length}`);
}
await browser.close();
writeFileSync(
  path.join(OUT, "index.json"),
  JSON.stringify(
    { 기준: "왼쪽 래스터(정본) · 오른쪽 SVG. 폭은 인쇄 mm.", 총: targets.length, 행: index },
    null,
    1,
  ),
  "utf-8",
);
console.log(`\r비교 시트 ${n}장 → ${OUT}`);
console.log(
  `  기출 ${targets.filter((t) => t.kind === "기출").length} · RPM ${targets.filter((t) => t.kind === "RPM").length}` +
    (LIMIT ? `  (전체 ${pairs.length} 중 ${targets.length}장만 — 무작위 · 시드 고정)` : ""),
);
