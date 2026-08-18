/**
 * `printOverflow.ts` 가 쓰는 «자»를 지면에서 검증한다 (읽기 전용 · DB 안 씀).
 *
 * 검증 대상 — 전부 근사이고, 전부 지면과 어긋나 있다:
 *   · `COLUMN_UNITS = 59`      (문항 열 · 1열 보기 · 상자 항목을 **같은 폭**으로 본다)
 *   · `BOX_CHROME_LINES = 2`   (상자의 `my-4` 마진을 세지 않는다)
 *   · 문항번호·정답란           (아예 세지 않는다)
 *   · `OVERFLOW_LINE_LIMIT = 14`(문항 칸 484px 에서 유도된 값이 아니다)
 *
 *   npx tsx scripts/qa/measure-paper-units.tsx
 */
import { chromium } from "@playwright/test";

import {
  estimateProblemLines,
  OVERFLOW_LINE_LIMIT,
} from "../../src/lib/printOverflow";
import {
  MEASURED,
  assertPaperSane,
  GUARD_SCRIPT,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

/** 지면 높이를 재려는 표본. 추정기가 어디서 덜 세는지 갈라 보이게 골랐다. */
const FIXTURES: Array<{ key: string; content: string; figureUrls?: string[] }> =
  [
    { key: "empty", content: "" },
    { key: "plain-1line", content: "가".repeat(20) },
    {
      key: "box-two-items-30",
      content: `다음 <보기> 에서 옳은 것을 고르시오.\n<보기>\nㄱ. ${"가".repeat(30)}\nㄴ. ${"나".repeat(30)}`,
    },
    {
      key: "nobox-two-items-30",
      content: `다음 보기 에서 옳은 것을 고르시오. ㄱ. ${"가".repeat(30)} ㄴ. ${"나".repeat(30)}`,
    },
    {
      key: "choices-one-col-20",
      content: `다음 중 옳은 것은?\n1. ${"가".repeat(20)}\n2. ${"나".repeat(20)}\n3. ${"다".repeat(20)}\n4. ${"라".repeat(20)}\n5. ${"마".repeat(20)}`,
    },
    {
      key: "choices-two-col-5",
      content: `다음 중 옳은 것은?\n1. ${"가".repeat(5)}\n2. ${"나".repeat(5)}\n3. ${"다".repeat(5)}\n4. ${"라".repeat(5)}\n5. ${"마".repeat(5)}`,
    },
  ];

async function main() {
  const slots = FIXTURES.map((f, i) =>
    renderSlot(
      { id: f.key, content: f.content, figureUrls: f.figureUrls },
      i + 1,
    ),
  );
  // 칸을 고정 높이로 두면 넘친 것을 못 재므로, 이 측정에서만 칸을 내용 높이로 푼다.
  const html = (
    await paperDocument([renderPage("continuation", slots, 2)])
  ).replace(
    "</head>",
    "<style>.a4Page{height:auto!important}.problemItem{flex:none!important}</style></head>",
  );
  const url = writeProbe("probe-units.html", html);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 900 },
  });
  await page.emulateMedia({ media: "print" });
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  let out: Record<string, number | string>;
  let rows: Array<{ key: string; total: number; body: number }>;
  try {
    // 이 측정만 칸 높이를 auto 로 풀므로 A4 높이 검사는 건너뛰고 나머지만 본다.
    const guard = (await page.evaluate(GUARD_SCRIPT)) as {
      katexOk: boolean;
      a4Height: number;
      fontSize: string;
    };
    assertPaperSane({ ...guard, a4Height: 1122.5 });
    // ⚠️ page.evaluate 안에서 이름 붙은 함수를 만들면 esbuild 의 `__name` 때문에 죽는다.
    out = (await page.evaluate(() => {
      const res: Record<string, number | string> = {};
      const q = document.querySelector.bind(document);
      const ruler = document.createElement("div");
      ruler.className = "problemText";
      ruler.style.cssText =
        "position:absolute;visibility:hidden;white-space:nowrap;width:max-content";
      ruler.textContent = "가";
      (q(".problemList") as HTMLElement).appendChild(ruler);
      // 한글 한 글자 = 표시폭 2
      res.unitPx = ruler.getBoundingClientRect().width / 2;
      ruler.remove();

      const plain = q('[data-pid="plain-1line"]') as HTMLElement;
      const plainBody = plain.querySelector("[data-paper-view]") as HTMLElement;
      res.columnPx = (
        plainBody.firstElementChild as HTMLElement
      ).getBoundingClientRect().width;
      res.linePx = parseFloat(
        getComputedStyle(plainBody.querySelector("p")!).lineHeight,
      );

      const oneCol = (
        q('[data-pid="choices-one-col-20"]') as HTMLElement
      ).querySelector("[data-paper-view]") as HTMLElement;
      const grid = Array.from(
        (oneCol.firstElementChild as HTMLElement).children,
      ).find((c) =>
        (c as HTMLElement).className.includes("mt-4"),
      ) as HTMLElement;
      res.choiceTextPx = (
        grid.children[0]!.lastElementChild as HTMLElement
      ).getBoundingClientRect().width;
      res.choiceGridMarginTopPx = parseFloat(getComputedStyle(grid).marginTop);
      res.choiceRowGapPx = parseFloat(getComputedStyle(grid).rowGap);

      const box = (
        q('[data-pid="box-two-items-30"]') as HTMLElement
      ).querySelector("[data-box-card]") as HTMLElement;
      const boxStyle = getComputedStyle(box);
      res.boxItemPx = (
        box.querySelector("[data-box-item]") as HTMLElement
      ).getBoundingClientRect().width;
      let itemsPx = 0;
      box.querySelectorAll("[data-box-item]").forEach((el) => {
        itemsPx += (el as HTMLElement).getBoundingClientRect().height;
      });
      res.boxChromePx =
        box.getBoundingClientRect().height +
        parseFloat(boxStyle.marginTop) +
        parseFloat(boxStyle.marginBottom) -
        itemsPx;

      const num = plain.querySelector(".questionNumber") as HTMLElement;
      const blank = plain.querySelector(".answerBlank") as HTMLElement;
      res.fixedChromePx =
        num.getBoundingClientRect().height +
        parseFloat(getComputedStyle(num).marginBottom) +
        parseFloat(getComputedStyle(blank).marginTop) +
        blank.getBoundingClientRect().height;
      return res;
    })) as Record<string, number>;

    rows = (await page.evaluate(() => {
      const list: Array<{ key: string; total: number; body: number }> = [];
      document.querySelectorAll(".problemItem").forEach((node) => {
        const item = node as HTMLElement;
        const num = item.querySelector(".questionNumber") as HTMLElement;
        const blank = item.querySelector(".answerBlank") as HTMLElement;
        const view = item.querySelector("[data-paper-view]") as HTMLElement;
        list.push({
          key: item.dataset.pid!,
          total:
            blank.getBoundingClientRect().bottom -
            num.getBoundingClientRect().top,
          body: view.getBoundingClientRect().height,
        });
      });
      return list;
    })) as Array<{ key: string; total: number; body: number }>;
  } finally {
    await browser.close();
  }

  const unit = out.unitPx as number;
  const line = out.linePx as number;
  console.log(`1 표시단위 = ${unit.toFixed(3)}px · 본문 행높이 ${line}px\n`);
  console.log("«자» 검증 — 추정기는 셋 다 59단위로 본다");
  console.log(
    `  문항 열        ${(out.columnPx as number).toFixed(1)}px = ${((out.columnPx as number) / unit).toFixed(1)}단위`,
  );
  console.log(
    `  1열 보기 글자칸 ${(out.choiceTextPx as number).toFixed(1)}px = ${((out.choiceTextPx as number) / unit).toFixed(1)}단위  (마커 ①·gap-1.5 만큼 좁다)`,
  );
  console.log(
    `  상자 항목칸    ${(out.boxItemPx as number).toFixed(1)}px = ${((out.boxItemPx as number) / unit).toFixed(1)}단위  (p-4·테두리만큼 좁다)`,
  );
  console.log(
    `\n상자 chrome(마진 포함, 라벨 줄 포함) ${(out.boxChromePx as number).toFixed(1)}px = ${((out.boxChromePx as number) / line).toFixed(2)}줄  ← 추정 3줄(테두리 2 + 라벨 1)`,
  );
  console.log(
    `고정 chrome(문항번호+정답란)          ${(out.fixedChromePx as number).toFixed(1)}px = ${((out.fixedChromePx as number) / line).toFixed(2)}줄  ← 추정 0줄`,
  );
  console.log(
    `보기 그리드 여백 mt-4 ${out.choiceGridMarginTopPx}px · 행 간격 ${out.choiceRowGapPx}px       ← 추정 0줄`,
  );

  console.log("\n표본별 — 실측 본문 줄 대 추정 줄");
  for (const r of rows) {
    const fixture = FIXTURES.find((f) => f.key === r.key)!;
    const real = r.body / line;
    const est = estimateProblemLines(fixture.content);
    console.log(
      `  ${r.key.padEnd(22)} 실측 ${real.toFixed(2)}줄  추정 ${String(est).padStart(2)}줄  차 ${(real - est).toFixed(2)}줄  (문항 전체 ${r.total.toFixed(1)}px)`,
    );
  }

  const implied = OVERFLOW_LINE_LIMIT * line + (out.fixedChromePx as number);
  console.log(
    `\n한계 ${OVERFLOW_LINE_LIMIT}줄 + 고정 chrome = ${implied.toFixed(1)}px — 문항 칸은 ${MEASURED.slotContinuationPx}px(첫 장 ${MEASURED.slotFirstPagePx}px)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
