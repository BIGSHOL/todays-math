/**
 * 인라인 분수가 위아래 줄과 겹치는지 **실제 렌더에서** 잰다 (읽기 전용).
 *
 * 원장님(2026-08-18): "이런 문제는 보기 높이를 좀 더 줘야할듯. 분수라서 위아래
 * 보기와 겹침"
 *
 * 겹침은 «줄 높이»만 봐서는 모른다. 브라우저는 줄 안에 키 큰 inline-block 이
 * 있으면 줄 상자를 늘리지만, KaTeX 는 분수 막대 위아래로 **줄 상자 밖까지**
 * 잉크를 뻗는다. 그래서 «줄 상자»가 아니라 **잉크 상자**를 재고, 위아래 줄의
 * 잉크와 실제로 겹치는지 본다.
 *
 *   npx tsx scripts/qa/measure-fraction-overlap.tsx
 */
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer } from "../../src/components/math/MarkdownRenderer";
import { PAPER_FONTS } from "../../src/components/print/tokens";

const MM_PX = 96 / 25.4;
const PAPER_COLUMN = (210 * MM_PX - 100 - 14) * (1.15 / 2.15);
const CELL_TWO = (PAPER_COLUMN - 32) / 2;

const KATEX_CSS = pathToFileURL(
  path.join(process.cwd(), "node_modules/katex/dist/katex.min.css"),
).href;
const F = path.join(process.cwd(), "scripts/qa/_probe4.html");

/** 여러 줄로 접히면서 분수가 섞인 실제 모양. */
const CASES: Array<{ name: string; width: number; text: string }> = [
  {
    name: "발문 두 줄 + 인라인 분수",
    width: PAPER_COLUMN,
    text: "두 수 $\\frac{3}{4}$ 와 $\\frac{5}{6}$ 의 합에서 $\\frac{1}{2}$ 을 뺀 값을 구하고, 그 값이 $\\frac{7}{12}$ 보다 큰지 판단하시오.",
  },
  {
    name: "보기 한 칸(2열) + 분수",
    width: CELL_TWO,
    text: "$\\frac{4}{5}-\\frac{\\sqrt{69}}{15}$ 이고 또한 $\\frac{1}{2}$ 이다.",
  },
  {
    name: "겹분수",
    width: PAPER_COLUMN,
    text: "$\\frac{\\frac{1}{2}}{3}$ 의 값과 $\\frac{\\frac{3}{4}}{5}$ 의 값을 각각 구하고 둘의 차를 구하시오.",
  },
  {
    name: "합기호·적분",
    width: PAPER_COLUMN,
    text: "$\\sum_{k=1}^{9}a_k$ 와 $\\int_{0}^{1}f(x)dx$ 를 각각 구한 뒤 그 곱을 구하시오. 단 $a_k$ 는 자연수다.",
  },
  {
    name: "분수 없음(기준)",
    width: PAPER_COLUMN,
    text: "두 수의 합에서 그 차를 뺀 값을 구하고, 그 값이 자연수인지 판단하시오. 단 두 수는 자연수다.",
  },
];

async function main() {
  const cells = CASES.map(
    (c, i) =>
      `<div class="probe" data-i="${i}" style="width:${c.width}px"><div class="body">${renderToStaticMarkup(
        <MarkdownRenderer content={c.text} className="[&_p]:my-0" />,
      )}</div></div>`,
  ).join("\n");
  writeFileSync(
    F,
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${KATEX_CSS}">
<style>body{margin:0;font-family:${PAPER_FONTS.serifKR};color:#0E0E10}
.probe{margin-bottom:24px}
.body{font-size:12.5px;line-height:1.6;overflow-wrap:anywhere}
.body p{margin:0}</style></head><body>${cells}</body></html>`,
    "utf8",
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 900, height: 1400 },
  });
  await page.goto(pathToFileURL(F).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  const out = await page.evaluate(() => {
    const results: Array<{
      i: number;
      lines: number;
      boxH: number;
      lineH: number;
      worstOverhang: number;
      overlaps: number;
    }> = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(".probe"),
    )) {
      const body = el.querySelector<HTMLElement>(".body")!;
      const boxH = body.getBoundingClientRect().height;
      // 줄 상자 경계 — Range 로 각 줄의 사각형을 얻는다.
      const range = document.createRange();
      range.selectNodeContents(body);
      const lineRects = Array.from(range.getClientRects()).filter(
        (r) => r.height > 4 && r.width > 1,
      );
      // 줄마다 y 중심으로 묶는다.
      const rows: DOMRect[][] = [];
      for (const r of lineRects) {
        const row = rows.find(
          (g) =>
            Math.abs((g[0]!.top + g[0]!.bottom) / 2 - (r.top + r.bottom) / 2) <
            6,
        );
        if (row) row.push(r as DOMRect);
        else rows.push([r as DOMRect]);
      }
      rows.sort((a, b) => a[0]!.top - b[0]!.top);
      const bands = rows.map((row) => ({
        top: Math.min(...row.map((r) => r.top)),
        bottom: Math.max(...row.map((r) => r.bottom)),
      }));

      // KaTeX 잉크 — 분수 막대·분자·분모가 실제로 차지하는 세로 범위.
      let worst = 0;
      let overlaps = 0;
      for (const k of Array.from(
        body.querySelectorAll<HTMLElement>(".katex"),
      )) {
        const kr = k.getBoundingClientRect();
        const band = bands.find((b) => kr.top < b.bottom && kr.bottom > b.top);
        if (!band) continue;
        const over = Math.max(band.top - kr.top, kr.bottom - band.bottom);
        if (over > worst) worst = over;
        // 이웃 줄 띠와 겹치면 진짜 겹침이다.
        for (const other of bands) {
          if (other === band) continue;
          if (kr.top < other.bottom && kr.bottom > other.top) overlaps += 1;
        }
      }
      results.push({
        i: Number(el.dataset.i),
        lines: bands.length,
        boxH,
        lineH: bands.length ? bands[0]!.bottom - bands[0]!.top : 0,
        worstOverhang: worst,
        overlaps,
      });
    }
    return results;
  });
  await browser.close();
  unlinkSync(F);

  for (const o of out) {
    const c = CASES[o.i]!;
    console.log(
      `줄 ${String(o.lines).padStart(2)} · 전체높이 ${o.boxH.toFixed(1).padStart(6)}px · 첫줄띠 ${o.lineH.toFixed(1)}px · ` +
        `줄 밖 튀어나옴 ${o.worstOverhang.toFixed(1).padStart(5)}px · **이웃 줄과 겹침 ${o.overlaps}** — ${c.name}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
