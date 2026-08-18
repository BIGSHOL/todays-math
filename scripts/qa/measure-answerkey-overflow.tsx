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
 */
import { mkdirSync } from "node:fs";
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
        `<article class="solutionItem"><div class="solutionHeading">문 ${startingNumber + i} · ${renderToStaticMarkup(
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
        }> = [];
        document.querySelectorAll(".a4Page").forEach((section) => {
          const el = section.querySelector(".answerSolutions") as HTMLElement;
          out.push({
            tag: Number((section as HTMLElement).dataset.tag),
            page: Number((section as HTMLElement).dataset.page),
            clientW: el.clientWidth,
            scrollW: el.scrollWidth,
          });
        });
        return out;
      })) as Array<{
        tag: number;
        page: number;
        clientW: number;
        scrollW: number;
      }>;
      for (const r of res) {
        total += 1;
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
