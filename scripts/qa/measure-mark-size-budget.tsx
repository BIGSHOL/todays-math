/**
 * 식별자 표시를 **어느 자리에 몇 pt 까지** 넣으면 공짜인가 — 자리별 크기 한도를 잰다.
 *
 *   npx tsx scripts/qa/measure-mark-size-budget.tsx
 *
 * 왜 따로 있나: `measure-id-mark.tsx` 는 「이 배치가 전수 넘침을 몇 건 늘리나」를 답한다.
 * 그런데 그 표를 보면 **같은 7pt 인데 자리에 따라 0.0 과 0.3 으로 갈린다.** 이유를
 * 모르면 「7pt 는 되고 8pt 는 안 된다」 같은 규칙을 외우게 되는데, 그건 크기의 문제가
 * 아니라 **그 자리가 무엇으로 높이를 정하느냐**의 문제다. 여기서 크기를 훑어 성질을 본다.
 *
 * 실측으로 드러난 세 성질 (2026-08-18 · Chromium 인쇄 매체):
 *
 *   ① **번호 줄 안** — 버팀목이 18px(`line-height:1`)이라, 표시의 줄상자가 그 밖으로
 *      삐져나온 만큼만 늘어난다. **크기에 단조롭지 않다** (9pt 가 8pt 보다 작게 나온다) —
 *      글꼴의 가로줄 위치와 반올림이 정하기 때문이다. 그러니 이 자리의 「0px」은
 *      **글꼴에 기댄 우연**이지 견고한 성질이 아니다.
 *   ② **정답란 안** — 줄 높이를 `.answerLine`·`.checkBox`(각 16px)가 정한다.
 *      표시가 그보다 작으면 아무 일도 안 일어난다 → **9pt 까지 0px, 10pt 부터 값이 붙는다**
 *      (표시 쪽 `line-height` 를 물려받게 두면 경계가 8pt 로 한 칸 내려온다).
 *   ③ **풀이칸 안** — 「SCRATCH PAD」 라벨과 같은 **절대 위치**라 흐름 밖이다 →
 *      **크기와 무관하게 0px** (14pt 까지 확인). 이건 반올림이 아니라 구조다.
 */
import { chromium } from "@playwright/test";

import {
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

/** 인쇄 매체에서 pt 는 절대 단위 — 1pt = 96/72 px. */
const pt = (v: number) => `${((v * 96) / 72).toFixed(3)}px`;

const SAMPLE_ID = "5123-7";
const SIZES = [6, 7, 8, 9, 10, 12, 14] as const;

type Where = "number" | "blank" | "scratch";

const WHERE_LABEL: Record<Where, string> = {
  number: "번호 줄 옆",
  blank: "정답란 오른쪽 끝",
  scratch: "풀이칸 오른쪽 아래",
};

/** 표시를 자리마다 다르게 끼워 넣는다. 실패하면 던진다 — 안 붙으면 «0px» 이 거짓이 된다. */
function inject(html: string, where: Where): string {
  const anchor: Record<Where, string> = {
    number: "</div>",
    blank: '<span class="checkBox"></span></div>',
    scratch: "<span>SCRATCH PAD</span></div>",
  };
  const cls: Record<Where, string> = {
    number: "idInline",
    blank: "idBlank",
    scratch: "idScratch",
  };
  const at = anchor[where];
  if (!html.includes(at))
    throw new Error(`${where}: 붙일 자리를 못 찾았다 — 지면 DOM 이 바뀌었다.`);
  const piece = `<span class="idMark ${cls[where]}">${SAMPLE_ID}</span>`;
  return html.replace(at, piece + at);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  await page.emulateMedia({ media: "print" });

  /** 한 경우를 그려 「번호 줄 높이」와 「문항 세로」를 돌려준다. */
  const measure = async (css: string, where: Where | null) => {
    let slot = renderSlot(
      { id: "probe", content: "간단한 문항 본문이다.", figureUrls: [] },
      1,
    );
    if (where) slot = inject(slot, where);
    // 장마다 두 문항 — 한 문항만 넣으면 칸이 두 배가 되어 다른 것을 잰다.
    const mate = renderSlot(
      { id: "mate", content: "짝 문항.", figureUrls: [] },
      2,
    );
    const doc = (
      await paperDocument([renderPage("continuation", [slot, mate], 2)])
    ).replace("</head>", `<style>${css}</style></head>`);
    await page.goto(writeProbe("probe-size-budget.html", doc), {
      waitUntil: "load",
    });
    await page.evaluate(() => document.fonts.ready);
    return page.evaluate(() => {
      const item = document.querySelector(".problemItem") as HTMLElement;
      const num = item.querySelector(".questionNumber") as HTMLElement;
      const blank = item.querySelector(".answerBlank") as HTMLElement;
      const mark = item.querySelector(".idMark") as HTMLElement | null;
      return {
        numberLine: num.getBoundingClientRect().height,
        blankLine: blank.getBoundingClientRect().height,
        used:
          blank.getBoundingClientRect().bottom -
          num.getBoundingClientRect().top,
        marks: document.querySelectorAll(".idMark").length,
        markFont: mark ? getComputedStyle(mark).fontSize : "-",
      };
    });
  };

  const base = await measure("", null);
  console.log(
    `기준선 — 번호 줄 ${base.numberLine.toFixed(2)}px · 정답란 ${base.blankLine.toFixed(2)}px · 문항 세로 ${base.used.toFixed(2)}px\n`,
  );

  for (const where of ["number", "blank", "scratch"] as Where[]) {
    const lineHeights = where === "number" ? ["normal", "1"] : ["normal"];
    for (const lh of lineHeights) {
      const rows: string[] = [];
      for (const size of SIZES) {
        const css =
          `.idMark{font-family:var(--paper-font-sans);font-size:${pt(size)};line-height:${lh};color:#a0a0a8}` +
          `.idInline{margin-left:10px}.idBlank{margin-left:10px}` +
          `.idScratch{position:absolute;right:8px;bottom:6px}`;
        const got = await measure(css, where);
        // 주입이 샜으면 「0px」은 거짓이다 — 그대로 두면 가장 듣고 싶은 답이 공짜로 나온다.
        if (got.marks !== 1)
          throw new Error(
            `${where} ${size}pt: 표시가 ${got.marks}개다 — 주입이 샜다.`,
          );
        rows.push(
          `${size}pt ${got.used - base.used >= 0 ? "+" : ""}${(got.used - base.used).toFixed(2)}`,
        );
      }
      console.log(
        `${WHERE_LABEL[where]}${where === "number" ? ` (line-height:${lh})` : ""}\n  ${rows.join(" · ")}`,
      );
    }
  }

  await browser.close();
  console.log(
    "\n숫자는 **문항 세로가 기준선보다 몇 px 늘었나**(문항번호 위 ~ 정답란 아래).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
