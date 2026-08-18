/**
 * 정답지의 «자»를 실측한다 — 해설 한 건이 몇 px 이고, 한 쪽에 몇 px 이 들어가는가.
 *
 * `measure-answerkey-overflow.tsx` 는 **장 단위로 잘렸는지**만 센다. 판정을 만들려면
 * 그 앞이 필요하다: 해설 칸의 높이, 「빠른 정답」 상자가 문항 수에 따라 먹는 높이,
 * 그리고 해설 한 건의 높이가 **표시폭으로 예측되는가**.
 *
 *   npx tsx scripts/qa/measure-answerkey-units.tsx
 *   npx tsx scripts/qa/measure-answerkey-units.tsx --take 1500 --json .measure/solution-units.json
 *
 * 읽기 전용 · DB 는 읽기만 한다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";

import { MathText } from "../../src/components/math/MathText";
import { displayWidth } from "../../src/lib/math/displayWidth";
import { PAPER_VARS, paperStyles, writeProbe } from "./paperProbe";

const prisma = new PrismaClient();

interface Row {
  id: string;
  answer: string;
  solution: string | null;
}

function solutionItem(number: number, row: Row): string {
  return `<article class="solutionItem" data-pid="${row.id}"><div class="solutionHeading">문 ${number} · ${renderToStaticMarkup(
    <MathText as="span" text={row.answer ?? ""} />,
  )}</div><div class="solutionBody">${renderToStaticMarkup(
    <MathText as="div" text={row.solution ?? "해설이 등록되지 않았습니다."} />,
  )}</div></article>`;
}

/** 「빠른 정답」 상자만 얹은 쪽 — 상자 높이와 남는 해설 칸을 재려고 쓴다. */
function answerPage(quickCount: number, items: string, tag: string): string {
  const quick =
    quickCount > 0
      ? `<section class="quickAnswerBox"><h3>빠른 정답</h3><div class="quickAnswerGrid">${Array.from(
          { length: quickCount },
          (_, i) =>
            `<div class="quickAnswerCell"><strong>문 ${i + 1}</strong><span>${(i % 5) + 1}</span></div>`,
        ).join("")}</div></section>`
      : "";
  return `<section class="a4Page answerPage" data-tag="${tag}" style="${PAPER_VARS}">
<header class="answerHeader"><div><div class="answerEyebrow">오늘의수학 · ANSWER KEY</div><h2>일일테스트 · 이차방정식</h2></div><span>정답 및 해설 · 1 / 3</span></header>
${quick}
<div class="answerSolutions" style="column-count:2">${items}</div>
<footer class="answerFooter">오늘의수학 · p. 1</footer>
</section>`;
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const take = Number(arg("--take") ?? 1500);
  const outPath = arg("--json");

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, answer, solution FROM problem WHERE solution IS NOT NULL
     ORDER BY id LIMIT ${take}`,
  )) as Row[];
  console.log(`해설 있는 문항 ${rows.length.toLocaleString()}건`);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1400 },
  });
  await page.emulateMedia({ media: "print" });
  const styles = await paperStyles();

  const out: Record<string, unknown> = {};
  const perItem: Array<{ pid: string; px: number; width: number }> = [];

  try {
    /* ── ① 쪽 구조: 빠른 정답 상자 높이 · 해설 칸 높이 ───────────────────────── */
    const structureSections = [0, 8, 12, 16, 20, 25, 30].map((n) =>
      answerPage(n, solutionItem(1, rows[0]!), `quick${n}`),
    );
    let url = writeProbe(
      "probe-answerkey-units.html",
      `<!doctype html><html><head><meta charset="utf-8">${styles}<style>body{margin:0}</style></head><body>${structureSections.join("\n")}</body></html>`,
    );
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const structure = (await page.evaluate(() => {
      const rowsOut: Array<{
        tag: string;
        quickPx: number;
        solutionsPx: number;
        columnPx: number;
      }> = [];
      document.querySelectorAll(".a4Page").forEach((section) => {
        const el = section as HTMLElement;
        const quick = el.querySelector(".quickAnswerBox") as HTMLElement | null;
        const sol = el.querySelector(".answerSolutions") as HTMLElement;
        const style = getComputedStyle(sol);
        rowsOut.push({
          tag: el.dataset.tag ?? "",
          quickPx: quick ? quick.getBoundingClientRect().height : 0,
          solutionsPx:
            sol.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom),
          columnPx: (sol.clientWidth - parseFloat(style.columnGap || "32")) / 2,
        });
      });
      return rowsOut;
    })) as Array<{
      tag: string;
      quickPx: number;
      solutionsPx: number;
      columnPx: number;
    }>;
    console.log("\n쪽 구조 — 빠른 정답 문항 수별");
    for (const s of structure)
      console.log(
        `  ${s.tag.padEnd(8)} 상자 ${s.quickPx.toFixed(1)}px · 해설 칸 ${s.solutionsPx.toFixed(1)}px · 단 폭 ${s.columnPx.toFixed(1)}px`,
      );
    out.structure = structure;

    /* ── ② 해설 한 건의 높이 — 단 폭 한 줄짜리 컨테이너에 하나씩 ─────────────── */
    const columnPx = structure[0]!.columnPx;
    const BATCH = 120;
    for (let start = 0; start < rows.length; start += BATCH) {
      const chunk = rows.slice(start, start + BATCH);
      const html = chunk
        .map(
          (row, i) =>
            `<div class="answerSolutions" style="column-count:1;width:${columnPx}px;height:auto;overflow:visible">${solutionItem(start + i + 1, row)}</div>`,
        )
        .join("");
      url = writeProbe(
        "probe-solution-items.html",
        `<!doctype html><html><head><meta charset="utf-8">${styles}<style>body{margin:0;width:1000px}</style><div style="${PAPER_VARS}"></div></head><body class="answerPage" style="${PAPER_VARS}">${html}</body></html>`,
      );
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const measured = (await page.evaluate(() => {
        const list: Array<{ pid: string; px: number }> = [];
        document.querySelectorAll(".solutionItem").forEach((node) => {
          const el = node as HTMLElement;
          const style = getComputedStyle(el);
          list.push({
            pid: el.dataset.pid ?? "",
            // `margin-bottom: 14px` 도 다음 항목을 미는 실제 세로다.
            px:
              el.getBoundingClientRect().height +
              parseFloat(style.marginBottom),
          });
        });
        return list;
      })) as Array<{ pid: string; px: number }>;
      for (const m of measured) {
        const row = rows.find((r) => r.id === m.pid)!;
        perItem.push({
          pid: m.pid,
          px: m.px,
          width: displayWidth(row.solution ?? ""),
        });
      }
      process.stdout.write(`\r해설 측정 ${perItem.length}/${rows.length}`);
    }
    console.log("");
  } finally {
    await browser.close();
  }

  const heights = perItem.map((p) => p.px).sort((a, b) => a - b);
  const q = (p: number) => heights[Math.floor(heights.length * p)]!;
  console.log(
    `\n해설 한 건 높이 — p10 ${q(0.1).toFixed(0)}px · 중앙 ${q(0.5).toFixed(0)}px · p90 ${q(0.9).toFixed(0)}px · 최대 ${heights.at(-1)!.toFixed(0)}px`,
  );
  out.items = perItem;

  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out), "utf8");
    console.log(`→ ${outPath}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
