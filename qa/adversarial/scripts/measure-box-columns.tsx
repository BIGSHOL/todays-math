/**
 * 적대적 리뷰 — **상자 항목**의 2열 판정을 실제 렌더 폭으로 잰다. 읽기 전용.
 *
 * 2026-08-18 수리는 2열 한계(`TWO_COLUMN_WIDTH_LIMIT = 24`)를 **선택지**로만 맞췄다
 * (`scripts/qa/measure-choice-layout.tsx`, 표본 2,247 조각). 그런데 같은 함수
 * `fitsTwoColumns` 가 **상자 항목**에도 쓰인다(`renderBoxSegment`) —
 * 칸 폭도 다르고(마커 칸이 없다) 글의 종류도 다르다(조건 문장). 그쪽은 **아무도
 * 재지 않았다.** 물려받은 임계값이 다른 분모에서도 맞는지 본다
 * (CLAUDE.md 2026-08-17: 임계값을 물려받을 때는 분모가 같은지부터 볼 것).
 *
 * 함정은 정본 스크립트와 같다 — `file://` 로 열어 KaTeX CSS 를 실제로 붙이고,
 * 폭을 재는 사본은 **같은 글꼴 문맥 안**에 붙인다.
 *
 * 실행: npx tsx qa/adversarial/scripts/measure-box-columns.tsx [--take 2000]
 */
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer } from "../../../src/components/math/MarkdownRenderer";
import {
  displayWidth,
  TWO_COLUMN_WIDTH_LIMIT,
} from "../../../src/lib/math/displayWidth";
import { parseProblemContent } from "../../../src/lib/problem/parseProblemContent";
import { PAPER_FONTS } from "../../../src/components/print/tokens";

const prisma = new PrismaClient();

/** 지면 기하 — `MarkdownRenderer` 의 `BOX_CARD_CLASS`(p-4, border 1px) 기준. */
const MM_PX = 96 / 25.4;
const PAPER_COLUMN = (210 * MM_PX - 100 - 14) * (1.15 / 2.15); // ≈ 363.6px
const CARD_PADDING = 16 * 2 + 1 * 2; // p-4 + border
const CARD_INNER = PAPER_COLUMN - CARD_PADDING; // ≈ 329.6px
const GRID_GAP = 24; // gap-x-6
const CELL_TWO = (CARD_INNER - GRID_GAP) / 2; // ≈ 152.8px

const KATEX_CSS = pathToFileURL(
  path.join(process.cwd(), "node_modules/katex/dist/katex.min.css"),
).href;
const PROBE_HTML = path.join(process.cwd(), "qa/adversarial/_probe-box.html");

interface Item {
  pid: string;
  columns: number;
  text: string;
  width: number;
}

/** `parseProblemContent` 가 만든 인용문에서 상자를 되읽는다. */
function boxesOf(
  question: string,
): Array<{ columns: number; items: string[] }> {
  const out: Array<{ columns: number; items: string[] }> = [];
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    const paras = cur
      .join("\n")
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const header = paras[0] ?? "";
    const match = /^<(?:보기|조건|상자|나열)([1-3])?>/.exec(header);
    if (match) {
      const columns = Number(match[1] ?? 1);
      const items = paras.slice(1);
      // 머리 없는 상자는 첫 문단이 곧 내용이다.
      if (header.startsWith("<나열"))
        items.unshift(header.replace(/^<나열\d?>\s*/, ""));
      if (items.length > 0) out.push({ columns, items });
    }
    cur = null;
  };
  for (const rawLine of question.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (line.startsWith(">")) {
      if (cur === null) cur = [];
      cur.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flush();
  }
  flush();
  return out;
}

function buildHtml(items: Item[]): string {
  const cells = items
    .map((item, i) => {
      const inner = renderToStaticMarkup(
        <MarkdownRenderer content={item.text} className="[&_p]:my-0" />,
      );
      const boxWidth = item.columns === 2 ? CELL_TWO : CARD_INNER;
      return `<div class="probe" data-i="${i}" style="width:${boxWidth}px">
  <div class="row"><div class="body">${inner}</div></div>
</div>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${KATEX_CSS}">
<style>
  body { margin:0; font-family:${PAPER_FONTS.serifKR}; color:#0E0E10; }
  .probe { box-sizing:border-box; }
  .row { display:flex; align-items:flex-start; font-size:12.5px; line-height:1.6; }
  .body { min-width:0; flex:1; overflow-wrap:anywhere; }
  .body p { margin:0; }
  .measure { position:absolute; visibility:hidden; white-space:nowrap; width:max-content; }
</style></head><body>${cells}
<div id="ruler" style="font-size:12.5px;line-height:1.6;position:absolute;visibility:hidden">가</div>
</body></html>`;
}

async function main() {
  const takeArg = process.argv.indexOf("--take");
  const take = takeArg >= 0 ? Number(process.argv[takeArg + 1]) : 1200;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; content: string }>
  >(`SELECT id, content FROM problem ORDER BY id`);

  const items: Item[] = [];
  let boxes = 0;
  let twoColBoxes = 0;
  for (const row of rows) {
    const { question } = parseProblemContent(row.content ?? "");
    if (!question.includes(">")) continue;
    for (const box of boxesOf(question)) {
      boxes += 1;
      if (box.columns === 2) twoColBoxes += 1;
      if (box.columns !== 2) continue; // 2열로 그리기로 한 것만 검증 대상
      if (items.length >= take * 4) continue;
      for (const text of box.items)
        items.push({
          pid: row.id,
          columns: box.columns,
          text,
          width: displayWidth(text),
        });
    }
  }
  console.log(
    `상자 ${boxes}개 (2열 ${twoColBoxes}개) → 2열 항목 ${items.length}개 측정`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  writeFileSync(PROBE_HTML, buildHtml(items), "utf8");
  await page.goto(pathToFileURL(PROBE_HTML).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  const cssOk = await page.evaluate(() => {
    const probe = document.querySelector(".katex-mathml") as HTMLElement | null;
    return probe ? getComputedStyle(probe).position === "absolute" : true;
  });
  if (!cssOk) throw new Error("KaTeX CSS 가 안 붙었다 — 측정 중단");

  const measured = await page.evaluate(() => {
    const out: Array<{ i: number; contentW: number; boxW: number }> = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(".probe"),
    )) {
      const row = el.querySelector<HTMLElement>(".row")!;
      const body = el.querySelector<HTMLElement>(".body")!;
      const clone = body.cloneNode(true) as HTMLElement;
      clone.className = "measure";
      row.appendChild(clone);
      const contentW = clone.getBoundingClientRect().width;
      clone.remove();
      out.push({
        i: Number(el.dataset.i),
        contentW,
        boxW: body.getBoundingClientRect().width,
      });
    }
    return out;
  });
  await browser.close();
  unlinkSync(PROBE_HTML);

  const recs = measured.map((m) => ({ ...items[m.i]!, ...m }));
  const folded = recs.filter((r) => r.contentW > r.boxW + 0.5);
  console.log(
    `2열 칸 폭 ${CELL_TWO.toFixed(1)}px (상자 안쪽 ${CARD_INNER.toFixed(1)}px)`,
  );
  console.log(
    `2열로 그렸는데 **실제로 칸을 넘는** 항목: ${folded.length}개 / ${recs.length} (${((folded.length * 100) / Math.max(1, recs.length)).toFixed(1)}%)`,
  );
  console.log(`한계 ${TWO_COLUMN_WIDTH_LIMIT} 기준 — 이 전부가 «놓침»이다.\n`);
  const worst = [...folded]
    .sort((a, b) => b.contentW - a.contentW)
    .slice(0, 25);
  for (const r of worst)
    console.log(
      `  ${r.pid.slice(0, 8)} 폭${String(r.width).padStart(3)} 실측${r.contentW.toFixed(0).padStart(4)}px/${r.boxW.toFixed(0)}px  ${r.text.slice(0, 70)}`,
    );

  const byProblem = new Set(folded.map((r) => r.pid));
  console.log(`\n접히는 항목을 가진 문항 ${byProblem.size}건`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
