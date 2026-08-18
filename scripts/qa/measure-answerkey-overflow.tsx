/**
 * 정답지(해설) 지면이 **잘리는 양**을 실측한다 (읽기 전용 · DB 읽기만).
 *
 * `.answerSolutions` 는 `column-count:2` + `overflow:hidden` 이라, 높이를 넘긴 해설은
 * **3번째 단**으로 밀려 지면 밖에서 통째로 사라진다(문항 하나가 통으로 없어진다).
 * `paginateAnswerKey` 는 장당 8건 고정이고, **1쪽에는 빠른 정답 상자가 더 얹힌다**
 * (문항 수에 비례해 커진다). 넘침 경고는 `content` 만 보고 `solution` 은 안 본다.
 *
 *   npx tsx scripts/qa/measure-answerkey-overflow.tsx --tests 120 --count 25
 *   npx tsx scripts/qa/measure-answerkey-overflow.tsx --with-solution --shot out.png
 *   npx tsx scripts/qa/measure-answerkey-overflow.tsx --with-solution --json .measure/ak.json
 *
 * ⚠️ 2026-08-18 추가: 장 단위 «잘렸다/아니다» 만으로는 **판정을 만들 수 없다.**
 *    어느 문항이 사라졌는지가 있어야 «solution 으로 예측할 수 있는가»를 채점한다.
 *    그래서 `.solutionItem` 하나하나가 2단 밖(3번째 단)으로 밀렸는지도 같이 낸다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";

import { MathText } from "../../src/components/math/MathText";
import type { TestPrintProblem } from "../../src/components/print/types";
import { paginateAnswerKey } from "../../src/lib/printLayout";
import { PAPER_VARS, paperStyles, writeProbe } from "./paperProbe";

const prisma = new PrismaClient();

/** `PrintAnswerKeyPage` 의 DOM 과 같은 모양. */
function renderAnswerPage(
  all: TestPrintProblem[],
  pageProblems: TestPrintProblem[],
  pageNumber: number,
  startingNumber: number,
  totalPages: number,
  tag: string,
): string {
  const quick =
    pageNumber === 1
      ? `<section class="quickAnswerBox"><h3>빠른 정답</h3><div class="quickAnswerGrid">${all
          .map(
            (p, i) =>
              `<div class="quickAnswerCell"><strong>문 ${i + 1}</strong>${renderToStaticMarkup(
                <MathText as="span" text={p.answer} />,
              )}</div>`,
          )
          .join("")}</div></section>`
      : "";
  const items = pageProblems
    .map(
      (p, i) =>
        `<article class="solutionItem" data-pid="${p.id}"><div class="solutionHeading">문 ${startingNumber + i} · ${renderToStaticMarkup(
          <MathText as="span" text={p.answer} />,
        )}</div><div class="solutionBody">${renderToStaticMarkup(
          <MathText
            as="div"
            text={p.solution ?? "해설이 등록되지 않았습니다."}
          />,
        )}</div></article>`,
    )
    .join("");
  return `<section class="a4Page answerPage" data-tag="${tag}" data-page="${pageNumber}" style="${PAPER_VARS}">
<header class="answerHeader"><div><div class="answerEyebrow">오늘의수학 · ANSWER KEY</div><h2>일일테스트 · 이차방정식</h2></div><span>정답 및 해설 · ${pageNumber} / ${totalPages}</span></header>
${quick}
<div class="answerSolutions" style="column-count:2">${items}</div>
<footer class="answerFooter">오늘의수학 · p. ${pageNumber}</footer>
</section>`;
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const nTests = Number(arg("--tests") ?? 120);
  const perTest = Number(arg("--count") ?? 25);
  const shotPath = arg("--shot");
  const onlyWithSolution = process.argv.includes("--with-solution");

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, answer, solution FROM problem ${onlyWithSolution ? "WHERE solution IS NOT NULL" : ""} ORDER BY id`,
  )) as Array<{ id: string; answer: string; solution: string | null }>;
  console.log(
    `풀 ${rows.length.toLocaleString()}건 → 시험지 ${nTests}개 × ${perTest}문항${onlyWithSolution ? " (해설 있는 문항만)" : ""}`,
  );

  // 시험지마다 다른 구간을 뽑는다(무작위를 쓰지 않아 재실행이 같은 결과를 낸다).
  const pick = (k: number) => {
    const start = (k * perTest * 7) % Math.max(1, rows.length - perTest);
    return rows.slice(start, start + perTest).map((r, i) => ({
      id: r.id,
      orderIndex: i + 1,
      content: "",
      answer: r.answer ?? "",
      solution: r.solution,
    })) as TestPrintProblem[];
  };

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  await page.emulateMedia({ media: "print" });
  const styles = await paperStyles();

  let clipped = 0;
  let total = 0;
  const worst: Array<{ test: number; page: number; ratio: number }> = [];
  /** 채점용 산출물 — 쪽마다 «어느 문항이 사라졌는가». */
  const pageLog: Array<{
    test: number;
    page: number;
    ids: string[];
    lost: string[];
    heights: number[];
    quickCells: number[];
    columnPx: number;
  }> = [];
  const BATCH = 20;
  try {
    for (let t = 0; t < nTests; t += BATCH) {
      const sections: string[] = [];
      for (let k = t; k < Math.min(t + BATCH, nTests); k += 1) {
        const picked = pick(k);
        const pages = paginateAnswerKey(picked);
        pages.forEach((p, i) =>
          sections.push(
            renderAnswerPage(
              picked,
              p.problems,
              i + 1,
              p.startingNumber,
              pages.length,
              String(k),
            ),
          ),
        );
      }
      const url = writeProbe(
        "probe-answerkey.html",
        `<!doctype html><html><head><meta charset="utf-8">${styles}<style>body{margin:0}</style></head><body>${sections.join("\n")}</body></html>`,
      );
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const res = (await page.evaluate(() => {
        const out: Array<{
          tag: number;
          page: number;
          clientW: number;
          scrollW: number;
          lost: string[];
          heights: number[];
          quickCells: number[];
          columnPx: number;
        }> = [];
        document.querySelectorAll(".a4Page").forEach((section) => {
          const el = section.querySelector(".answerSolutions") as HTMLElement;
          const box = el.getBoundingClientRect();
          const lost: string[] = [];
          const heights: number[] = [];
          el.querySelectorAll(".solutionItem").forEach((node) => {
            const item = node as HTMLElement;
            // 다단에서 넘친 항목은 **3번째 단**, 즉 컨테이너 오른쪽 밖에 놓인다.
            // (세로로 잘리는 게 아니라 가로로 밀려 지면에서 사라진다.)
            if (item.getBoundingClientRect().left > box.right - 1)
              lost.push(item.dataset.pid ?? "");
            // 항목 높이는 **이 지면 안에서** 재야 한다 — 따로 떼어 재면 글꼴 문맥이
            // 달라져 조용히 다른 값이 나온다(실제로 그래서 자가 20% 짧았다).
            heights.push(
              item.getBoundingClientRect().height +
                parseFloat(getComputedStyle(item).marginBottom),
            );
          });
          // 「빠른 정답」 상자는 1쪽에만 있고, 셀 높이가 **정답의 수식**에 달렸다
          // (실측 25문항에서 상자 높이가 344~668px 로 갈린다).
          const quickCells: number[] = [];
          (section as HTMLElement)
            .querySelectorAll(".quickAnswerCell")
            .forEach((cell) => {
              quickCells.push(
                (cell as HTMLElement).getBoundingClientRect().height,
              );
            });
          const style = getComputedStyle(el);
          out.push({
            tag: Number((section as HTMLElement).dataset.tag),
            page: Number((section as HTMLElement).dataset.page),
            clientW: el.clientWidth,
            scrollW: el.scrollWidth,
            lost,
            heights,
            quickCells,
            columnPx:
              el.clientHeight -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom),
          });
        });
        return out;
      })) as Array<{
        tag: number;
        page: number;
        clientW: number;
        scrollW: number;
        lost: string[];
        heights: number[];
        quickCells: number[];
        columnPx: number;
      }>;
      for (const r of res) {
        total += 1;
        const picked = pick(r.tag);
        const pages = paginateAnswerKey(picked);
        pageLog.push({
          test: r.tag,
          page: r.page,
          ids: pages[r.page - 1]!.problems.map((p) => p.id),
          lost: r.lost,
          heights: r.heights,
          quickCells: r.quickCells,
          columnPx: r.columnPx,
        });
        // 다단에서 높이를 넘긴 내용은 **가로로** 단을 더 만들고 그게 잘린다.
        if (r.scrollW > r.clientW + 1) {
          clipped += 1;
          worst.push({
            test: r.tag,
            page: r.page,
            ratio: r.scrollW / r.clientW,
          });
        }
      }
    }
    worst.sort((a, b) => b.ratio - a.ratio);

    if (shotPath && worst.length > 0) {
      const w = worst[0]!;
      const picked = pick(w.test);
      const pages = paginateAnswerKey(picked);
      const target = pages[w.page - 1]!;
      const url = writeProbe(
        "probe-answerkey-shot.html",
        `<!doctype html><html><head><meta charset="utf-8">${styles}<style>body{margin:0}</style></head><body>${renderAnswerPage(picked, target.problems, w.page, target.startingNumber, pages.length, String(w.test))}</body></html>`,
      );
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      mkdirSync(path.dirname(shotPath), { recursive: true });
      await page.locator(".a4Page").screenshot({ path: shotPath });
      console.log(`→ ${shotPath}`);
    }
  } finally {
    await browser.close();
  }

  console.log(
    `정답지 ${total}장 중 해설이 잘린 장 ${clipped} (${((clipped * 100) / total).toFixed(1)}%)`,
  );
  console.log(
    `  그중 1쪽(빠른 정답 상자가 얹힌 장) ${worst.filter((w) => w.page === 1).length}장 / 1쪽 총 ${nTests}장`,
  );
  const lostItems = pageLog.reduce((n, p) => n + p.lost.length, 0);
  const items = pageLog.reduce((n, p) => n + p.ids.length, 0);
  console.log(
    `해설 ${items.toLocaleString()}건 중 지면 밖으로 밀린 것 ${lostItems.toLocaleString()} (${((lostItems * 100) / Math.max(1, items)).toFixed(2)}%)`,
  );

  const jsonPath = arg("--json");
  if (jsonPath) {
    mkdirSync(path.dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(pageLog), "utf8");
    console.log(`→ ${jsonPath}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
