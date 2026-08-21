/**
 * **첫 장 칸이 79px 좁은 이유를 조각으로 가른다** (읽기 전용 · DB 안 씀).
 *
 *   npx tsx scripts/qa/measure-first-page-header.tsx
 *
 * 첫 장 문항 칸은 405px, 이어지는 장은 484px 다. 그 79px 이 **머리글 탓인지
 * 「◆ 핵심 개념 정리」 상자 탓인지**를 알아야 원장님이 고를 수 있다:
 *
 *   ⑴ 첫 장을 1문항으로 → 장 수가 는다
 *   ⑵ 개념 상자를 줄이거나 뺀다 → 장 수가 그대로다
 *
 * ⑵ 가 79px 중 얼마를 되찾는지 **재지 않고는 두 안을 견줄 수 없다.**
 * 그래서 같은 지면을 조각만 빼며 네 번 그려 문항 칸을 잰다 —
 * 값을 손으로 셈하지 않는다(패딩·여백·줄높이를 빠뜨리기 쉽다).
 *
 * ⚠️ 제품 CSS(`TestPrint.module.css`)를 그대로 쓴다. 여기서 나온 값이 제품과
 *    갈라지면 그건 이 스크립트가 아니라 지면이 바뀐 것이다.
 */
import { chromium } from "@playwright/test";

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import {
  assertPaperSane,
  GUARD_SCRIPT,
  paperDocument,
  renderPage,
  renderSlot,
} from "./paperProbe";

/** 첫 장 지면에서 조각을 하나씩 빼 본다. */
const 조각빼기: Record<string, (html: string) => string> = {
  "지금 그대로": (h) => h,
  "개념 상자 없이": (h) =>
    h.replace(/<section class="conceptBox">[\s\S]*?<\/section>/, ""),
  "개념 상자의 본문만 없이": (h) =>
    h.replace(
      /<div class="conceptText">[\s\S]*?<\/div>/,
      '<div class="conceptText"></div>',
    ),
  "머리글을 이어지는 장처럼": (h) =>
    h.replace(
      /<header class="firstHeader">[\s\S]*?<\/header>/,
      '<header class="continuationHeader"><span>오늘의수학 · 일일테스트</span><span>p. 1</span></header>',
    ),
};

async function main() {
  const two = [
    renderSlot({ id: "a", content: "가".repeat(20) }, 1),
    renderSlot({ id: "b", content: "나".repeat(20) }, 2),
  ];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.emulateMedia({ media: "print" });

  const 결과: { 이름: string; 칸: number }[] = [];
  for (const [이름, 빼기] of Object.entries(조각빼기)) {
    const html = 빼기(renderPage("first", two, 1));
    await page.setContent(await paperDocument([html]), {
      waitUntil: "networkidle",
    });
    assertPaperSane(
      (await page.evaluate(GUARD_SCRIPT)) as Parameters<
        typeof assertPaperSane
      >[0],
    );
    /**
     * 🔴 **정본 자(`measure-paper-units.tsx`)와 같은 계산**이어야 한다 —
     *    거기는 패딩을 뺀 **내용 상자**를 잰다. 처음에 `getBoundingClientRect()`
     *    로 쟀다가 419.7px 이 나와 「지면이 바뀌었다」는 거짓 경보를 냈다.
     *    14.7px 은 지면이 아니라 **내가 다르게 잰 것**이었다.
     */
    const 칸 = (await page.evaluate(`(() => {
      const item = document.querySelector(".problemItem");
      const st = getComputedStyle(item);
      return item.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
    })()`)) as number;
    결과.push({ 이름, 칸: Math.round(칸 * 10) / 10 });
  }
  await browser.close();

  const 지금 = 결과[0]!.칸;
  const 이어지는장 = JASEUP_MEASURED_PX.continuationSlot;
  console.log(
    `이어지는 장 문항 칸 ${이어지는장}px (제품 상수) · 첫 장 ${지금}px — 차이 ${(이어지는장 - 지금).toFixed(1)}px\n`,
  );
  console.log("조각을 빼면 첫 장 칸이 얼마가 되나");
  for (const r of 결과)
    console.log(
      `  ${r.이름.padEnd(22)} ${String(r.칸).padStart(7)}px` +
        `  (지금보다 +${(r.칸 - 지금).toFixed(1)} · 이어지는 장까지 ${(이어지는장 - r.칸).toFixed(1)} 남음)`,
    );

  /**
   * 🔴 제품 상수와 어긋나면 **멈춘다.** 이 스크립트가 그리는 DOM 이 제품 지면과
   *    갈라졌다는 뜻이고, 그러면 위 표 전체가 거짓이다.
   */
  if (Math.abs(지금 - JASEUP_MEASURED_PX.firstPageSlot) > 1)
    throw new Error(
      `첫 장 칸 실측 ${지금}px ≠ 제품 상수 ${JASEUP_MEASURED_PX.firstPageSlot}px — 지면이 바뀌었다. 상수를 다시 뽑아라.`,
    );
  console.log("\n✅ 제품 상수와 일치");
}

void main();
