/**
 * 그림 폭 상한을 바꾼 지면을 **실제로 그려** 재고 찍는다 (읽기 전용).
 *
 *   npx tsx scripts/qa/shot-figure-cap.tsx 70 <id> <id> --shot
 *   npx tsx scripts/qa/shot-figure-cap.tsx 45 <id> <id> --shot
 *   npx tsx scripts/qa/shot-figure-cap.tsx 29 <id> <id> --shot
 *
 * ## 🔴 캐시로 채점하지 않는다
 *
 * `.measure/*.json` 은 **현행 지면**을 잰 값이다. 폭 상한을 바꾸면 그 캐시는 그 순간
 * 거짓이 된다 — 지문 장치가 막아 주지만, 막아 준다고 값이 생기지는 않는다.
 * 그래서 바꾼 배치의 높이는 **여기서 새로 잰다.**
 *
 * ## 🔴 제품 CSS 는 한 글자도 안 바꾼다
 *
 * 상한 덧칠은 **탐침 HTML 안에만** 넣는다(`<style>` 한 줄). `TestPrint.module.css`·
 * `ProblemContent.tsx` 는 그대로다. 그래서 이 스크립트를 몇 번 돌려도 캐시 지문의
 * `inputsHash` 가 안 바뀐다 — 「지면을 바꿔 놓고 옛 캐시로 채점」이 구조적으로 불가능하다.
 *
 * ⚠️ 46mm 는 두 장이 363.72px 라 문항 열(363.5px)을 **0.22px** 넘어 한 장씩 접힌다.
 *    mm 로 적을 때는 **45mm(2열) · 29mm(3열)** 처럼 여유를 둘 것.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";

import {
  GUARD_SCRIPT,
  assertPaperSane,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

const prisma = new PrismaClient();
const OUT_DIR = "docs/planning/tracks/reports/oversize";

async function main() {
  const capMm = Number(process.argv[2] ?? 70);
  const ids = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const shot = process.argv.includes("--shot");
  if (ids.length === 0) {
    console.error(
      "사용법: npx tsx scripts/qa/shot-figure-cap.tsx <mm> <id>... [--shot]",
    );
    process.exitCode = 1;
    return;
  }

  const rows = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: { id: true, content: true, figureUrls: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r) => r !== undefined);

  const pages: string[] = [];
  for (let i = 0; i < ordered.length; i += 2)
    pages.push(
      renderPage(
        "continuation",
        ordered
          .slice(i, i + 2)
          .map((r, j) =>
            renderSlot(
              { id: r.id, content: r.content ?? "", figureUrls: r.figureUrls },
              i + j + 1,
            ),
          ),
        2,
      ),
    );

  let html = await paperDocument(pages);
  // 그림 묶음 div 에 표식만 붙인다 — 제품 컴포넌트는 안 건드린다.
  html = html.replace(
    /<div class="mt-3 flex flex-wrap items-start gap-4/g,
    '<div class="figureRow mt-3 flex flex-wrap items-start gap-4',
  );
  html = html
    .replace(
      "</head>",
      `<style>@media print{[data-paper-view] .figureRow img{max-width:${capMm}mm !important}}</style></head>`,
    )
    .replace("background:#c9c9c7", "background:#fff");

  const url = writeProbe(`probe-cap-${capMm}.html`, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 950, height: 1200 },
    deviceScaleFactor: 2,
  });
  try {
    await page.emulateMedia({ media: "print" });
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    assertPaperSane(await page.evaluate(GUARD_SCRIPT));
    const measured = (await page.evaluate(() => {
      const out: [string, number, number, number][] = [];
      document.querySelectorAll(".problemItem").forEach((node) => {
        const item = node as HTMLElement;
        const num = item.querySelector(".questionNumber") as HTMLElement;
        const blank = item.querySelector(".answerBlank") as HTMLElement;
        const view = item.querySelector("[data-paper-view]") as HTMLElement;
        const figRow = view.querySelector(
          "div[class*='mt-3']",
        ) as HTMLElement | null;
        out.push([
          item.dataset.pid ?? "",
          blank.getBoundingClientRect().bottom -
            num.getBoundingClientRect().top,
          figRow ? figRow.getBoundingClientRect().height : 0,
          figRow ? figRow.querySelectorAll("img").length : 0,
        ]);
      });
      return out;
    })) as [string, number, number, number][];
    for (const [pid, needed, figure, n] of measured)
      console.log(
        `${pid.slice(0, 8)} 상한 ${capMm}mm · 그림 ${n}장 → 그림 블록 ${figure.toFixed(0)}px · 문항 ${needed.toFixed(0)}px`,
      );
    if (shot) {
      mkdirSync(OUT_DIR, { recursive: true });
      const a4 = page.locator(".a4Page");
      for (let i = 0; i < (await a4.count()); i += 1) {
        const file = path.join(
          OUT_DIR,
          `cap${capMm}mm${(await a4.count()) > 1 ? `-p${i + 1}` : ""}.png`,
        );
        await a4.nth(i).screenshot({ path: file });
        console.log(`-> ${file}`);
      }
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
