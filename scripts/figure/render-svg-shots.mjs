/**
 * SVG 를 **지면과 같은 렌더러**로 그려 PNG 로 떨군다 (헤드리스 Chromium).
 *
 *   node scripts/figure/render-svg-shots.mjs <작업목록.json>
 *   작업목록: [{ "svg": "…", "png": "…", "w": 480, "h": 220 }, …]
 *
 * ## 왜 PyMuPDF 로 안 하나 (실측 2026-08-19)
 *
 * MuPDF 는 **자기가 낸 SVG 를 자기가 못 읽는다** — `get_svg_image()` 산출물을
 * 그대로 다시 열어 그리면 **온통 검게** 나온다(솎기 전·후 모두, 극값 (0,0)).
 * 그걸로 대조하면 모든 그림이 「어긋났다」로 나오고, 반대로 문턱을 낮추면
 * **아무것도 안 걸린다.** 판정자가 눈이 먼 채로 초록을 찍는 자리다.
 *
 * 게다가 지면은 Chromium 이 그린다. **대조는 제품이 쓰는 렌더러로 해야** 한다 —
 * `paint-order` 처럼 렌더러마다 다른 속성이 실제로 있었다.
 *
 * ⚠️ 헤드리스라 원장님 화면 포커스를 뺏지 않는다(절대 규칙 9).
 */
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

async function main() {
  const jobsPath = process.argv[2];
  if (!jobsPath) throw new Error("작업 목록 JSON 경로를 주세요");
  const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  let done = 0;
  let failed = 0;
  for (const j of jobs) {
    try {
      const svg = readFileSync(j.svg, "utf8");
      await page.setViewportSize({ width: j.w, height: j.h });
      await page.setContent(
        `<!doctype html><style>html,body{margin:0;padding:0;background:#fff}` +
          `svg{display:block;width:${j.w}px;height:${j.h}px}</style>${svg}`,
        { waitUntil: "load" },
      );
      mkdirSync(path.dirname(j.png), { recursive: true });
      await page.screenshot({ path: j.png, clip: { x: 0, y: 0, width: j.w, height: j.h } });
      done += 1;
    } catch {
      failed += 1;
    }
  }
  await browser.close();
  console.log(`그림 ${done}장 · 실패 ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
