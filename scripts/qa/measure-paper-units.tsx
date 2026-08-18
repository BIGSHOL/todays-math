/**
 * `printOverflow.ts` 가 쓰는 «자»를 지면에서 검증한다 (읽기 전용 · DB 안 씀).
 *
 * 여기서 나오는 값이 곧 `printGeometry.ts` 의 `JASEUP_MEASURED_PX` 다.
 * 지면 CSS 를 바꿨으면 **이 스크립트로 다시 뽑아** 상수를 갱신할 것 — 손으로 고치지 말 것.
 *
 * (2026-08-18 이전에는 넷이 전부 어긋나 있었다: 문항 열·보기·상자를 같은 59단위로 보고,
 *  상자 `my-4` 를 안 세고, 문항번호·정답란을 0으로 세고, 한계 14 가 칸에서 유도된 값이
 *  아니었다 — 적대적 리뷰 ③ §6.)
 *
 *   npx tsx scripts/qa/measure-paper-units.tsx
 */
import { chromium } from "@playwright/test";

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import {
  estimateProblemPx,
  OVERFLOW_LINE_LIMIT,
  OVERFLOW_LINE_LIMIT_FIRST_PAGE,
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

/**
 * **문항 칸 높이를 실제로 잴다.**
 *
 * 예전에는 이 스크립트가 칸 높이를 재지 않고 `paperProbe.MEASURED` 에 적힌 숫자를
 * 그대로 **되읽어 찍었다.** 한계값(23·19)이 바로 그 칸에서 유도되는데, 정작 그
 * 값만은 아무도 지면과 대조하지 않았다 — 「손으로 고치지 말 것, 이 스크립트가
 * 뽑는다」는 주석이 그 값에는 거짓이었다(적대적 리뷰 ④, 10-handoff §8.5 「동어반복 측정」).
 *
 * 칸은 «그 장에 몇 개인가»로 갈린다(`flex: 1 1 0%`) — 그래서 넷을 다 잴다.
 */
async function measureSlots(): Promise<Record<string, number>> {
  const slot = (kind: "first" | "continuation", count: number, page: number) =>
    renderPage(
      kind,
      Array.from({ length: count }, (_, i) =>
        renderSlot(
          { id: `${kind}-${count}-${i}`, content: "짧은 발문." },
          i + 1,
        ),
      ),
      page,
    );
  const url = writeProbe(
    "probe-slots.html",
    await paperDocument([
      slot("continuation", 2, 2),
      slot("continuation", 1, 2),
      slot("first", 2, 1),
      slot("first", 1, 1),
    ]),
  );
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  await page.emulateMedia({ media: "print" });
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    assertPaperSane(await page.evaluate(GUARD_SCRIPT));
    return (await page.evaluate(() => {
      const res: Record<string, number> = {};
      const keys = [
        "continuationSlot",
        "soloContinuationSlot",
        "firstPageSlot",
        "soloFirstPageSlot",
      ];
      document.querySelectorAll(".a4Page").forEach((section, index) => {
        const item = section.querySelector(".problemItem") as HTMLElement;
        const style = getComputedStyle(item);
        res[keys[index]!] =
          item.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom);
      });
      return res;
    })) as Record<string, number>;
  } finally {
    await browser.close();
  }
}

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
  console.log("«자» — 셋이 서로 다르다 (예전에는 셋 다 59단위로 봤다)");
  console.log(
    `  문항 열        ${(out.columnPx as number).toFixed(1)}px = ${((out.columnPx as number) / unit).toFixed(1)}단위`,
  );
  console.log(
    `  1열 보기 글자칸 ${(out.choiceTextPx as number).toFixed(1)}px = ${((out.choiceTextPx as number) / unit).toFixed(1)}단위  (마커 ①·gap-1.5 만큼 좁다) → choiceTextColumn`,
  );
  console.log(
    `  상자 항목칸    ${(out.boxItemPx as number).toFixed(1)}px = ${((out.boxItemPx as number) / unit).toFixed(1)}단위  (p-4·테두리만큼 좁다) → boxItemColumn`,
  );
  console.log(
    `\n상자 chrome(마진·라벨 줄 포함)   ${(out.boxChromePx as number).toFixed(1)}px = ${((out.boxChromePx as number) / line).toFixed(2)}줄  → JASEUP_MEASURED_PX.boxChrome`,
  );
  console.log(
    `고정 chrome(문항번호+정답란)     ${(out.fixedChromePx as number).toFixed(1)}px = ${((out.fixedChromePx as number) / line).toFixed(2)}줄  → JASEUP_MEASURED_PX.fixedChrome`,
  );
  console.log(
    `보기 그리드 mt-4 ${out.choiceGridMarginTopPx}px · 행 간격 ${out.choiceRowGapPx}px   → choiceGridTop · choiceRowGap`,
  );

  // ⚠️ **같은 구간을 견줘야 한다.** `estimateProblemPx` 는 문항번호 위부터 정답란
  //    아래까지(= `r.total`)를 낸다. 본문만 잰 `r.body` 와 견주면 고정 chrome(3.08줄)
  //    만큼 늘 어긋나 보인다 — 자를 고친 직후 실제로 그렇게 헷갈렸다.
  console.log("\n표본별 — 실측 대 추정 (문항번호 위 ~ 정답란 아래)");
  for (const r of rows) {
    const fixture = FIXTURES.find((f) => f.key === r.key)!;
    const est = estimateProblemPx(fixture.content);
    console.log(
      `  ${r.key.padEnd(22)} 실측 ${r.total.toFixed(1).padStart(6)}px  추정 ${est.toFixed(1).padStart(6)}px` +
        `  차 ${(est - r.total).toFixed(1).padStart(6)}px   (본문만 실측 ${(r.body / line).toFixed(2)}줄)`,
    );
  }

  /* ── 문항 칸 — **되읽지 말고 실제로 잴다** ─────────────────── */
  const slotPx = await measureSlots();
  console.log("\n문항 칸 (그 장의 문항 수로 갈린다 — `flex: 1 1 0%`)");
  let slotMismatch = 0;
  for (const [key, measured] of Object.entries(slotPx)) {
    const constant = (JASEUP_MEASURED_PX as Record<string, number>)[key]!;
    const ok = Math.abs(measured - constant) < 0.5;
    if (!ok) slotMismatch += 1;
    console.log(
      `  ${key.padEnd(22)} 실측 ${measured.toFixed(1).padStart(7)}px  상수 ${String(constant).padStart(7)}  ${ok ? "" : "← 어긋남"}`,
    );
  }
  if (slotMismatch > 0) {
    console.error(
      `\n칸 ${slotMismatch}개가 상수와 다르다 — 한계값이 지면과 어긋난 값에서 유도되고 있다.` +
        `\nJASEUP_MEASURED_PX 와 paperProbe.MEASURED 를 **같이** 고칠 것.`,
    );
    process.exitCode = 1;
  }
  // paperProbe 쪽 사본도 같은 값이어야 한다 — 둘이 갈라지면 측정이 지면과 갈린다.
  if (
    MEASURED.slotContinuationPx !== JASEUP_MEASURED_PX.continuationSlot ||
    MEASURED.slotFirstPagePx !== JASEUP_MEASURED_PX.firstPageSlot
  ) {
    console.error("paperProbe.MEASURED 와 JASEUP_MEASURED_PX 가 다르다.");
    process.exitCode = 1;
  }

  console.log(
    `\n한계 ${OVERFLOW_LINE_LIMIT}줄 = ${(OVERFLOW_LINE_LIMIT * line).toFixed(1)}px — 문항 칸 ${slotPx.continuationSlot!.toFixed(1)}px 에서 유도` +
      `\n첫 장 ${OVERFLOW_LINE_LIMIT_FIRST_PAGE}줄 = ${(OVERFLOW_LINE_LIMIT_FIRST_PAGE * line).toFixed(1)}px — 첫 장 칸 ${slotPx.firstPageSlot!.toFixed(1)}px 에서 유도`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
