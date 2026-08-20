/**
 * 낸 SVG 가 **지면에서 쓰이는 방식 그대로** 뜨는지 본다 — `<img src="…svg">`.
 *
 *   node scripts/figure/check-svg-as-img.mjs [표본수]
 *
 * ## 왜 따로 보나
 *
 * 대조에 쓴 렌더는 SVG 를 **문서에 직접 심어(setContent)** 그렸다. 지면은 다르다 —
 * `<img>` 로 불러오면 브라우저가 SVG 를 **격리된 문서**로 다룬다(바깥 참조 금지,
 * 스크립트 금지, 크기는 스스로 말해야 한다). 심어서 잘 나온다고 `<img>` 로도
 * 잘 나온다는 보장이 없다. 「제품이 쓰는 방식으로 재라」.
 *
 * 보는 것 셋:
 *   1. 불러와지는가(`img.decode()` 가 안 던지는가)
 *   2. **스스로 말한 크기**가 mm 로 오는가(`naturalWidth` 가 0이 아닌가)
 *   3. 그린 결과가 **비어 있지 않은가**(흰 종이만 나오면 실패다)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "public", "figures-svg");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".svg")) out.push(p);
  }
  return out;
}

async function main() {
  const want = Number(process.argv[2] || 60);
  const all = walk(DIR);
  // 고루 뽑는다 — 앞쪽만 보면 한 편·한 책에 몰린다.
  const step = Math.max(1, Math.floor(all.length / want));
  const pick = all.filter((_, i) => i % step === 0).slice(0, want);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  let ok = 0;
  const bad = [];
  for (const f of pick) {
    // file:// 은 Chromium 이 about:blank 에서 이미지를 안 연다(EncodingError).
    // 지면은 http(s) 로 `/figures-svg/…` 를 물린다. data URL 이 그 경로와 같다 —
    // `<img>` 가 격리된 문서로 SVG 를 연다.
    const svg = readFileSync(f, "utf8");
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const r = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
      } catch (e) {
        return { loaded: false };
      }
      const w = Math.max(1, Math.round(img.naturalWidth));
      const h = Math.max(1, Math.round(img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200) ink += 1;
      return { loaded: true, w, h, inkRatio: ink / (w * h) };
    }, src);
    if (r.loaded && r.w > 1 && r.h > 1 && r.inkRatio > 0.001) ok += 1;
    else bad.push({ file: path.relative(DIR, f), ...r });
  }
  await browser.close();
  console.log(`<img> 로 띄워 본 ${pick.length}장 — 정상 ${ok} · 이상 ${bad.length}`);
  for (const b of bad.slice(0, 10)) console.log("  ", JSON.stringify(b));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
