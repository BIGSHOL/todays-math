/**
 * SVG 채택 검수 **선별기** — 눈이 갈 곳을 정한다. 판정하지 않는다.
 *
 * 왜 판정하지 않나: 이 저장소는 겹쳐 보기 지표에 **세 번** 속았다
 * (`℃`→`¾` 를 0.027 로 통과 · 앤티앨리어싱을 획 손실로 세어 242장 폐기 ·
 * `<use>` stroke-width ×9 를 0.0250 으로 통과). 그러니 이 숫자로 **버리거나
 * 통과시키지 않는다.** 오직 **훑는 순서**를 정하는 데만 쓴다 —
 * 「문제 없음 쪽을 가장 의심스러운 순서로 정렬해 훑을 것」(CLAUDE.md 2026-08-16).
 *
 *   node scripts/qa/screen-svg-diff.mjs [--dir=<비교시트 폴더>]
 *
 * 재는 것 (둘 다 **같은 상자**에 최대로 맞춰 그린 뒤 canvas 로):
 *   · 잉크량 비 — SVG 잉크 / 래스터 잉크. 1 보다 많이 작으면 **내용이 빠졌다**는 쪽.
 *   · 칸별 최대 차 — 8×8 로 나눈 각 칸의 잉크량 차. 자리가 어긋나면 커진다.
 *
 * 산출: `<폴더>/screen.json` (의심스러운 순서로 정렬)
 * ⚠️ 아무것도 안 바꾼다.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIR =
  process.argv.find((a) => a.startsWith("--dir="))?.slice(6) ??
  "scripts/qa/reports/svg-compare";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const dataUri = (f) =>
  `data:${MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream"};base64,${readFileSync(f).toString("base64")}`;

const idx = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf-8"));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");

/**
 * 그림 하나를 240×240 흰 칸에 최대로 맞춰 그리고 잉크량을 잰다.
 * **브라우저가 그린다** — 지면과 같은 엔진이라 별도 변환기의 버릇이 안 섞인다.
 */
const measure = (uri) =>
  page.evaluate(async (src) => {
    const S = 240;
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("load"));
      img.src = src;
    });
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.fillRect(0, 0, S, S);
    // SVG 는 자연 크기가 mm 라 naturalWidth 가 작을 수 있다 — 비율로만 맞춘다.
    const r = Math.min(S / img.naturalWidth, S / img.naturalHeight);
    const w = img.naturalWidth * r, h = img.naturalHeight * r;
    g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
    const d = g.getImageData(0, 0, S, S).data;
    const cells = new Float64Array(64);
    let ink = 0;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) << 2;
        const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        const v = 1 - lum; // 흰 바탕에 그렸으므로 어두울수록 잉크
        ink += v;
        cells[((y * 8 / S) | 0) * 8 + ((x * 8 / S) | 0)] += v;
      }
    const n = S * S;
    return { ink: ink / n, cells: Array.from(cells, (v) => (v * 64) / n) };
  }, uri);

const out = [];
let n = 0, failed = 0;
for (const r of idx["행"]) {
  let a, b;
  try {
    a = await measure(dataUri(r.raster));
    b = await measure(dataUri(r.svg));
  } catch {
    failed++;
    out.push({ ...r, suspicion: 999, note: "🔴 그림을 못 그렸다 — 반드시 눈으로 봐라" });
    continue;
  }
  const inkRatio = a.ink > 0 ? b.ink / a.ink : 0;
  let cellMax = 0;
  for (let i = 0; i < 64; i++) cellMax = Math.max(cellMax, Math.abs(a.cells[i] - b.cells[i]));
  // 의심도: 잉크량이 **어느 쪽으로든** 어긋날수록 · 칸이 어긋날수록 크다.
  // ⚠️ 처음에는 `max(0, 1-inkRatio)` 로 **줄어든 쪽만** 봤다. 그랬더니
  //    래스터가 벤 다이어그램인데 SVG 는 «명제 참/거짓 표»인 — 완전히 **다른
  //    그림**이 잉크비 1.87 로 나와 의심도 하위 40%(105/171위)에 묻혔다.
  //    한 방향 문턱은 손상을 «정상» 쪽으로 민다(CLAUDE.md 2026-08-16·17).
  //    로그를 쓰면 0.5배와 2배가 같은 크기로 잡힌다.
  const suspicion = Math.abs(Math.log(Math.max(inkRatio, 1e-6))) + cellMax * 2;
  out.push({ ...r, inkRaster: +a.ink.toFixed(5), inkSvg: +b.ink.toFixed(5),
             inkRatio: +inkRatio.toFixed(3), cellMax: +cellMax.toFixed(4),
             suspicion: +suspicion.toFixed(4) });
  if (++n % 200 === 0) process.stdout.write(`\r선별 ${n}/${idx["행"].length}`);
}
await browser.close();
out.sort((x, y) => y.suspicion - x.suspicion);
writeFileSync(path.join(DIR, "screen.json"), JSON.stringify({
  기준: "의심도 내림차순. **판정이 아니라 훑는 순서다** — 이 숫자로 버리지 마라.",
  총: out.length, 못그림: failed, 행: out,
}, null, 1), "utf-8");
const mid = out[Math.floor(out.length / 2)];
console.log(`\r선별 ${out.length}장 → ${path.join(DIR, "screen.json")}  (못 그림 ${failed})`);
console.log(`  잉크비 중앙 ${mid.inkRatio} · 칸차 중앙 ${mid.cellMax}`);
console.log(`  가장 의심 ${out[0].suspicion} — ${out[0].file}`);
