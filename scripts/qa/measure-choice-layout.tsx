/**
 * 보기·본문의 **실제 렌더 폭·높이**를 브라우저에서 잰다 (읽기 전용).
 *
 * 왜 필요한가: `displayWidth` 는 글리프 **개수** 근사다. 지면에서 실제로 넓은 것은
 * 연산자 간격(`\div`·`=` 는 좌우에 여백이 붙는다)인데, 개수 근사는 그걸 한 글자도
 * 못 본다. 2026-08-18 원장님 지적 "2열인데 ②가 두 줄로 접힌다"가 그 사각지대다.
 *
 * 그래서 실제 KaTeX CSS·지면 폭·지면 글꼴로 렌더해 `getBoundingClientRect` 로 잰다.
 * 이것이 기준이고 `displayWidth` 는 이 기준에 맞춰 보정한다.
 *
 * ⚠️ 측정이 거짓이 되는 함정 둘 — 둘 다 실제로 밟았다:
 *  (1) `page.setContent` 는 about:blank 문서라 `file://` 스타일시트가 **조용히 막힌다.**
 *      KaTeX CSS 없이 재면 숨김 대상인 `.katex-mathml` 이 폭에 잡혀
 *      `$2\sqrt{5}$` 가 6,459px 로 나온다. 그래서 파일로 써서 `goto` 로 연다.
 *  (2) 줄바꿈 없는 폭을 재려고 만든 사본을 `document.body` 에 붙이면 **글꼴 크기를
 *      잃는다**(12.5px → 16px). 측정값이 정확히 1.28배 부풀었다. 사본은 반드시
 *      같은 글꼴 문맥 안에 붙인다.
 *
 *   npx tsx scripts/qa/measure-choice-layout.tsx            # 표본 400문항
 *   npx tsx scripts/qa/measure-choice-layout.tsx --take 1500
 *   npx tsx scripts/qa/measure-choice-layout.tsx --json out.json
 */
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownRenderer } from "../../src/components/math/MarkdownRenderer";
import {
  displayWidth,
  TWO_COLUMN_WIDTH_LIMIT,
} from "../../src/lib/math/displayWidth";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { PAPER_FONTS } from "../../src/components/print/tokens";

const prisma = new PrismaClient();

/** 지면 기하 — TestPrint.module.css / ProblemContent 와 같은 값이어야 한다. */
const MM_PX = 96 / 25.4;
const PAPER_COLUMN = (210 * MM_PX - 100 - 14) * (1.15 / 2.15); // ≈ 363.6px
const CHOICE_GAP_X = 32; // gap-x-8
const MARKER_GAP = 6; // gap-1.5
const MARKER_WIDTH = 12.5; // ① 한 글자
const CELL_TWO = (PAPER_COLUMN - CHOICE_GAP_X) / 2;

const KATEX_CSS = pathToFileURL(
  path.join(process.cwd(), "node_modules/katex/dist/katex.min.css"),
).href;
const PROBE_HTML = path.join(process.cwd(), "scripts/qa/_probe.html");

interface Item {
  pid: string;
  kind: "choice" | "question";
  text: string;
  width: number;
}

function buildHtml(items: Item[]): string {
  const cells = items
    .map((item, i) => {
      const inner = renderToStaticMarkup(
        <MarkdownRenderer content={item.text} className="[&_p]:my-0" />,
      );
      const boxWidth = item.kind === "choice" ? CELL_TWO : PAPER_COLUMN;
      return `<div class="probe" data-i="${i}" style="width:${boxWidth}px">
  <div class="row"><span class="mark">①</span><div class="body">${inner}</div></div>
</div>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${KATEX_CSS}">
<style>
  body { margin:0; font-family:${PAPER_FONTS.serifKR}; color:#0E0E10; }
  .probe { box-sizing:border-box; }
  .row { display:flex; align-items:flex-start; gap:${MARKER_GAP}px; font-size:12.5px; line-height:1.6; }
  .mark { flex:none; }
  .body { min-width:0; flex:1; overflow-wrap:anywhere; }
  .body p { margin:0; }
  .measure { position:absolute; visibility:hidden; white-space:nowrap; width:max-content; }
</style></head><body>${cells}
<div id="ruler" style="font-size:12.5px;line-height:1.6;position:absolute;visibility:hidden">가</div>
</body></html>`;
}

async function main() {
  const takeArg = process.argv.indexOf("--take");
  const take = takeArg >= 0 ? Number(process.argv[takeArg + 1]) : 400;
  const jsonArg = process.argv.indexOf("--json");

  const total = await prisma.problem.count();
  const step = Math.max(1, Math.floor(total / take));
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; content: string }>
  >(`SELECT id, content FROM problem ORDER BY id`);

  const items: Item[] = [];
  for (let i = 0; i < rows.length; i += step) {
    const row = rows[i]!;
    const { question, choices } = parseProblemContent(row.content ?? "");
    for (const c of choices)
      items.push({
        pid: row.id,
        kind: "choice",
        text: c,
        width: displayWidth(c),
      });
    if (question)
      items.push({
        pid: row.id,
        kind: "question",
        text: question,
        width: displayWidth(question),
      });
  }
  console.log(
    `표본 문항 ${Math.ceil(rows.length / step)}건 → 조각 ${items.length}개 측정`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  writeFileSync(PROBE_HTML, buildHtml(items), "utf8");
  await page.goto(pathToFileURL(PROBE_HTML).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  // 스타일시트가 실제로 붙었는지 확인한다 — 안 붙으면 측정값이 통째로 거짓이다.
  const cssOk = await page.evaluate(() => {
    const probe = document.querySelector(".katex-mathml") as HTMLElement | null;
    return probe ? getComputedStyle(probe).position === "absolute" : true;
  });
  if (!cssOk)
    throw new Error("KaTeX CSS 가 안 붙었다 — 측정 중단(거짓 측정 방지)");

  const measured = await page.evaluate(() => {
    const ruler = document.getElementById("ruler")!.getBoundingClientRect();
    const out: Array<{ i: number; h: number; contentW: number; boxW: number }> =
      [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(".probe"),
    )) {
      const row = el.querySelector<HTMLElement>(".row")!;
      const body = el.querySelector<HTMLElement>(".body")!;
      const h = body.getBoundingClientRect().height;
      // 사본은 **같은 글꼴 문맥**(.row) 안에 붙여야 12.5px 를 물려받는다.
      const clone = body.cloneNode(true) as HTMLElement;
      clone.className = "measure";
      row.appendChild(clone);
      const contentW = clone.getBoundingClientRect().width;
      clone.remove();
      out.push({
        i: Number(el.dataset.i),
        h,
        contentW,
        boxW: body.getBoundingClientRect().width,
      });
    }
    return { lineHeight: ruler.height, out };
  });
  await browser.close();
  unlinkSync(PROBE_HTML);

  const lh = measured.lineHeight;
  console.log(`한 줄 높이 = ${lh.toFixed(2)}px (12.5px × 1.6 = 20 기대)\n`);

  const recs = measured.out.map((m) => ({ ...items[m.i]!, ...m }));
  if (jsonArg >= 0)
    writeFileSync(
      process.argv[jsonArg + 1]!,
      JSON.stringify(
        { lineHeight: lh, cellTwo: CELL_TWO, paperColumn: PAPER_COLUMN, recs },
        null,
        1,
      ),
    );

  const choices = recs.filter((r) => r.kind === "choice");
  const folded = choices.filter((r) => r.contentW > r.boxW + 0.5);
  console.log(
    `보기 조각 ${choices.length}개 · 2열 칸 폭 ${CELL_TWO.toFixed(1)}px (본문 ${(CELL_TWO - MARKER_GAP - MARKER_WIDTH).toFixed(1)}px)`,
  );
  console.log(
    `실제로 칸을 넘는 보기: ${folded.length}개 (${((folded.length * 100) / choices.length).toFixed(1)}%)\n`,
  );

  const L = TWO_COLUMN_WIDTH_LIMIT;
  const missed = folded.filter((r) => r.width <= L);
  const over = choices.filter((r) => r.width > L && r.contentW <= r.boxW + 0.5);
  console.log(`현재 한계 ${L} 기준`);
  console.log(`  ⚠ 놓침(2열로 둬도 된다 했는데 접힘): ${missed.length}개`);
  console.log(`  과잉(1열로 내렸는데 안 접힘)      : ${over.length}개`);
  for (const r of missed.slice(0, 20))
    console.log(
      `    폭${String(r.width).padStart(3)} 실측${r.contentW.toFixed(0).padStart(4)}px/${r.boxW.toFixed(0)}px  ${r.text.slice(0, 74)}`,
    );

  // 한계값을 훑어 «놓침 + 과잉» 이 가장 적은 지점을 찾는다.
  console.log("\n한계값별 오판 (놓침 = 접히는데 2열 / 과잉 = 안 접히는데 1열)");
  let best = { limit: L, wrong: Number.MAX_SAFE_INTEGER, missed: 0, over: 0 };
  for (let limit = 6; limit <= 32; limit += 1) {
    const m = choices.filter(
      (r) => r.contentW > r.boxW + 0.5 && r.width <= limit,
    ).length;
    const o = choices.filter(
      (r) => r.contentW <= r.boxW + 0.5 && r.width > limit,
    ).length;
    if (m + o < best.wrong) best = { limit, wrong: m + o, missed: m, over: o };
    console.log(
      `  ${String(limit).padStart(3)}  놓침 ${String(m).padStart(4)}  과잉 ${String(o).padStart(4)}  합 ${String(m + o).padStart(4)}`,
    );
  }
  console.log(
    `\n→ 오판이 가장 적은 한계: ${best.limit} (놓침 ${best.missed} · 과잉 ${best.over} · 합 ${best.wrong})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
