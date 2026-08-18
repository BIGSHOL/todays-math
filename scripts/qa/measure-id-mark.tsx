/**
 * 문항번호 서식·식별자 표시가 **지면 세로를 몇 px 먹는가**를 실측한다 (읽기 전용).
 *
 * 왜 따로 있나: 「작게 넣으면 안 늘어나겠지」는 추측이다. 자습 지면은 문항 하나가
 * 고정 높이 칸(이어지는 장 484px · 첫 장 405px)이고, 넘친 내용은 잘리는 게 아니라
 * **옆 문항 위에 겹쳐 찍힌다.** 이미 6.19%(이어지는 장) / 13.46%(첫 장)가 넘친다.
 * 그러니 한 줄(20.3px)이 늘면 그만큼 더 겹친다 — 재고 답해야 한다.
 *
 *   npx tsx scripts/qa/measure-id-mark.tsx --take 400
 *   npx tsx scripts/qa/measure-id-mark.tsx --first-page --take 400
 *   npx tsx scripts/qa/measure-id-mark.tsx --ids .measure/candidates.json --json .measure/variants.json
 *   npx tsx scripts/qa/measure-id-mark.tsx --variants baseline,mark-scratch --take 200
 *
 * ## 측정 방식 — 기준선을 **같은 실행 안에서** 다시 잰다
 *
 * 이미 `.measure/cont.json` 에 기준선이 있지만 그걸 빼서 Δ 를 내지 않는다.
 * 폰트 로딩·그림 파일·브라우저 판이 바뀌면 두 실행의 절대값이 조금씩 달라질 수
 * 있고, 그 차이가 그대로 「배치가 먹은 px」로 둔갑한다. **같은 페이지에서 잰
 * 기준선과 견주면** 그 오염이 상쇄된다.
 *
 * ## 조용히 거짓이 되는 길 — 이걸 막으려고 가드가 있다
 *
 * 배치안의 마크업 주입이 **실패하면 그 변형은 기준선과 똑같이 그려진다.** 그러면
 * 이 스크립트는 「Δ 0px · 넘침 증가 0건」이라고 보고한다 — 정확히 우리가 듣고 싶은
 * 답이라 아무도 의심하지 않는다(CLAUDE.md 2026-08-18 「가드는 망가뜨려 봐야
 * 가드인 줄 안다」). 그래서 매 실행:
 *   ① 주입한 표시(`.idMark`)가 **문항 수만큼** 실제로 DOM 에 있는지 센다.
 *   ② 서식을 바꾼 변형은 `.questionNumber` 의 실제 `font-size`·`margin-bottom` 을
 *      브라우저에서 되읽어 의도한 값인지 대조한다.
 *   ③ 실측 칸(`availPx`)이 제품 상수와 다르면 멈춘다.
 * 하나라도 어긋나면 **던진다.** 「0px 이었다」는 답은 가드를 통과한 뒤에만 쓸 수 있다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "@playwright/test";

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { D_LAYOUT, D_TIGHT_CANDIDATES, injectMark } from "./idLayouts";
import {
  GUARD_SCRIPT,
  assertPaperSane,
  paperDocument,
  renderPage,
  renderSlot,
  writeProbe,
} from "./paperProbe";

const prisma = new PrismaClient();

/**
 * 지면에 찍힐 식별자 **표본 문자열**. 체계는 id-scheme 세션이 정한다(여기서 정하지
 * 않는다). 세로를 재는 데 글자 수는 상관없지만, **번호 줄에 같이 얹을 수 있는가**는
 * 가로 문제라 실제로 쓸 법한 길이로 잰다. `5123-7` 은 지금 DB 의 `externalId` 모양이다.
 */
const SAMPLE_ID = "5123-7";

interface Variant {
  name: string;
  /** 보고서에 그대로 실을 한 줄 설명. */
  label: string;
  /** 이 변형이 덧붙이는 CSS. 지면 원문 뒤에 붙어 덮어쓴다. */
  css?: string;
  /** 문항 하나의 HTML 을 고친다. `renderSlot` 산출물을 받는다. */
  slot?: (html: string) => string;
  /**
   * 장 하나의 HTML 을 고친다. `renderPage` 산출물을 받는다 — 꼬리글처럼 **장 단위**로
   * 붙는 자리를 재려면 여기여야 한다. 꼬리글이 커지면 문항 칸(`availPx`)이 **줄어든다**
   * (`.pageFooter` 는 `flex:none` 이라 제 높이를 먼저 가져간다).
   */
  page?: (html: string, pids: string[]) => string;
  /** 표시를 주입하는 변형인가 — 가드 ①이 개수를 센다. */
  injectsMark?: boolean;
  /** 번호 서식을 바꾸는 변형인가 — 가드 ②가 되읽어 대조한다. */
  numberStyle?: { fontSizePx?: number; marginBottomPx?: number };
}

/** 표시 조각. 색·크기는 **제안**이다 — 원장님 확정 전이라 여기 값이 정본이 아니다. */
const mark = (extraClass: string) =>
  `<span class="idMark ${extraClass}">${SAMPLE_ID}</span>`;

/** `.questionNumber` 블록 끝에 끼워 넣는다. */
function intoNumberLine(html: string, piece: string): string {
  const marker = '<div class="questionNumber">';
  const start = html.indexOf(marker);
  if (start < 0)
    throw new Error("questionNumber 를 못 찾았다 — 지면 DOM 이 바뀌었다.");
  const end = html.indexOf("</div>", start);
  return html.slice(0, end) + piece + html.slice(end);
}

/** `.answerBlank` 블록 끝에 끼워 넣는다. */
function intoAnswerBlank(html: string, piece: string): string {
  const marker = '<div class="answerBlank">';
  const start = html.indexOf(marker);
  if (start < 0)
    throw new Error("answerBlank 를 못 찾았다 — 지면 DOM 이 바뀌었다.");
  const end = html.indexOf("</div>", start);
  return html.slice(0, end) + piece + html.slice(end);
}

/** `.scratchPad` 블록 끝에 끼워 넣는다 (칸 밖 — 흐름에서 빠진 자리). */
function intoScratchPad(html: string, piece: string): string {
  const marker = '<div class="scratchPad">';
  const start = html.indexOf(marker);
  if (start < 0)
    throw new Error("scratchPad 를 못 찾았다 — 지면 DOM 이 바뀌었다.");
  const end = html.indexOf("</div>", start);
  return html.slice(0, end) + piece + html.slice(end);
}

/** `.answerBlank` **뒤에** 새 블록을 붙인다 (한 줄을 새로 먹는 대조군). */
function afterAnswerBlank(html: string, piece: string): string {
  const marker = '<div class="answerBlank">';
  const start = html.indexOf(marker);
  if (start < 0)
    throw new Error("answerBlank 를 못 찾았다 — 지면 DOM 이 바뀌었다.");
  const end = html.indexOf("</div>", start) + "</div>".length;
  return html.slice(0, end) + piece + html.slice(end);
}

/** 6pt·7pt·8pt 를 px 로 (인쇄 매체에서 pt 는 절대 단위 — 1pt = 96/72 px). */
const pt = (v: number) => `${((v * 96) / 72).toFixed(3)}px`;

const VARIANTS: Variant[] = [
  {
    name: "baseline",
    label: "지금 지면 (문 N 18px · line-height 1 · margin-bottom 6px)",
  },

  /* ── 가. 번호 줄의 빈 자리에 작은 식별자 ──────────────────────────────── */
  {
    name: "mark-inline-7pt",
    label: "번호 옆 인라인 7pt — 「문 12  5123-7」",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8;letter-spacing:.04em}
          .idInline{margin-left:10px;font-weight:500}`,
    slot: (html) => intoNumberLine(html, mark("idInline")),
  },
  {
    name: "mark-inline-6pt",
    label: "번호 옆 인라인 6pt",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(6)};color:#a0a0a8;letter-spacing:.04em}
          .idInline{margin-left:10px;font-weight:500}`,
    slot: (html) => intoNumberLine(html, mark("idInline")),
  },
  {
    name: "mark-inline-8pt",
    label: "번호 옆 인라인 8pt",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(8)};color:#a0a0a8;letter-spacing:.04em}
          .idInline{margin-left:10px;font-weight:500}`,
    slot: (html) => intoNumberLine(html, mark("idInline")),
  },
  /**
   * 위 셋에서 6pt 는 0px 인데 7pt 는 0.3px, 8pt 는 0.7px 이 붙는다. 이유는 글자 크기
   * 자체가 아니라 **줄상자**다 — `.questionNumber` 는 `line-height:1` 이라 버팀목이
   * 18px 인데, 작은 글씨라도 `line-height:normal`(≈1.2)이면 제 줄상자가 버팀목 아래로
   * 조금 삐져나온다. 그래서 **표시 쪽 `line-height` 를 1 로 눌러** 다시 잰다.
   * 이게 0px 이면 「읽히는 크기」와 「공짜」를 동시에 가질 수 있다.
   */
  {
    name: "mark-inline-7pt-lh1",
    label: "번호 옆 인라인 7pt + line-height:1",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};line-height:1;color:#a0a0a8;letter-spacing:.04em}
          .idInline{margin-left:10px;font-weight:500}`,
    slot: (html) => intoNumberLine(html, mark("idInline")),
  },
  {
    name: "mark-inline-8pt-lh1",
    label: "번호 옆 인라인 8pt + line-height:1",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(8)};line-height:1;color:#a0a0a8;letter-spacing:.04em}
          .idInline{margin-left:10px;font-weight:500}`,
    slot: (html) => intoNumberLine(html, mark("idInline")),
  },
  {
    name: "mark-inline-9pt-lh1",
    label: "번호 옆 인라인 9pt + line-height:1 (버팀목 18px 의 한계 확인)",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(9)};line-height:1;color:#a0a0a8;letter-spacing:.04em}
          .idInline{margin-left:10px;font-weight:500}`,
    slot: (html) => intoNumberLine(html, mark("idInline")),
  },
  {
    name: "mark-answerblank-8pt",
    label: "정답란 오른쪽 끝 8pt — 정답란은 30.5px 이라 더 여유가 있다",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(8)};color:#a0a0a8;letter-spacing:.04em}
          .idBlank{margin-left:10px;font-weight:500}`,
    slot: (html) => intoAnswerBlank(html, mark("idBlank")),
  },
  {
    name: "mark-scratch-8pt",
    label: "풀이칸 오른쪽 아래 8pt — 흐름 밖이라 크기와 무관해야 한다",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(8)};color:#a0a0a8;letter-spacing:.04em}
          .idScratch{position:absolute;right:8px;bottom:6px;font-weight:500}`,
    slot: (html) => intoScratchPad(html, mark("idScratch")),
  },
  {
    name: "mark-footer",
    label: "장 꼬리글에 그 장 문항 코드를 모아 적기 — 문항 칸은 안 건드린다",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8;letter-spacing:.04em}
          .idFooter{margin-left:12px;font-weight:500}`,
    page: (html, pids) =>
      html.replace(
        "</footer>",
        `<span class="idMark idFooter">문1 ${SAMPLE_ID} · 문2 ${SAMPLE_ID}</span></footer>`,
      ) + (pids.length ? "" : ""),
  },
  /**
   * **가드 자가 시험용.** 일부러 꼬리글을 크게 만들어 「칸이 줄었다」 경고가 실제로
   * 뜨는지 본다. 뜨지 않으면 위 `mark-footer` 의 「0px」은 **가드가 눈이 먼 것**이지
   * 공짜라는 증거가 아니다(CLAUDE.md 2026-08-18 「가드는 망가뜨려 봐야 가드인 줄 안다」).
   *   npx tsx scripts/qa/measure-id-mark.tsx --take 60 --variants baseline,guard-check-footer-tall
   */
  {
    name: "guard-check-footer-tall",
    label: "【가드 시험】 꼬리글을 40px 로 부풀린다 — 칸 경고가 떠야 정상",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8}
          .idFooterTall{display:block;height:40px}`,
    page: (html) =>
      html.replace(
        "</footer>",
        `<span class="idMark idFooterTall">${SAMPLE_ID}</span></footer>`,
      ),
  },
  {
    name: "mark-number-right",
    label: "번호 줄 **오른쪽 끝** 7pt (번호 줄을 flex 로)",
    injectsMark: true,
    css: `.questionNumber{display:flex;align-items:baseline}
          .idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8;letter-spacing:.04em}
          .idRight{margin-left:auto;font-weight:500}`,
    slot: (html) => intoNumberLine(html, mark("idRight")),
  },
  {
    name: "mark-answerblank",
    label: "정답란 오른쪽 끝 7pt — 이미 있는 30.5px 줄 안",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8;letter-spacing:.04em}
          .idBlank{margin-left:10px;font-weight:500}`,
    slot: (html) => intoAnswerBlank(html, mark("idBlank")),
  },
  {
    name: "mark-scratch",
    label: "풀이칸(SCRATCH PAD) 오른쪽 아래 7pt — 흐름 밖",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8;letter-spacing:.04em}
          .idScratch{position:absolute;right:8px;bottom:6px;font-weight:500}`,
    slot: (html) => intoScratchPad(html, mark("idScratch")),
  },
  {
    name: "mark-below",
    label: "【대조군】 문항 아래 새 줄 — 한 줄을 새로 먹는 배치",
    injectsMark: true,
    css: `.idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8;letter-spacing:.04em}
          .idBelow{display:block;margin-top:4px;text-align:right;font-weight:500}`,
    slot: (html) =>
      afterAnswerBlank(html, `<div class="idMark idBelow">${SAMPLE_ID}</div>`),
  },

  /* ── 나. 번호를 키워 「별개 서식」으로 ────────────────────────────────── */
  {
    name: "num-22",
    label: "번호 22px (지금 18px)",
    numberStyle: { fontSizePx: 22 },
    css: `.questionNumber{font-size:22px}`,
  },
  {
    name: "num-26",
    label: "번호 26px",
    numberStyle: { fontSizePx: 26 },
    css: `.questionNumber{font-size:26px}`,
  },
  {
    name: "num-26-rule",
    label: "번호 26px + 아래 구분선 + 여백 10px (별개 서식)",
    numberStyle: { fontSizePx: 26, marginBottomPx: 10 },
    css: `.questionNumber{font-size:26px;padding-bottom:5px;margin-bottom:10px;border-bottom:1px solid var(--paper-gold)}`,
  },
  {
    name: "num-26-rule-mark",
    label: "번호 26px + 구분선 + 그 줄 오른쪽 끝에 식별자 7pt",
    injectsMark: true,
    numberStyle: { fontSizePx: 26, marginBottomPx: 10 },
    css: `.questionNumber{display:flex;align-items:baseline;font-size:26px;padding-bottom:5px;margin-bottom:10px;border-bottom:1px solid var(--paper-gold)}
          .idMark{font-family:var(--paper-font-sans);font-size:${pt(7)};color:#a0a0a8;letter-spacing:.04em}
          .idRight{margin-left:auto;font-weight:500}`,
    slot: (html) => intoNumberLine(html, mark("idRight")),
  },
  {
    name: "num-22-rule-tight",
    label: "번호 22px + 구분선 + 여백을 6px 로 조인 안",
    numberStyle: { fontSizePx: 22, marginBottomPx: 6 },
    css: `.questionNumber{font-size:22px;padding-bottom:3px;margin-bottom:6px;border-bottom:1px solid var(--paper-gold)}`,
  },

  /**
   * **키우면서 상쇄하는 조합.** 22px 은 +4px, 아래 여백 6→2px 은 −4px 이라 «더하면 0»
   * 이지만, 그건 산술이다. 두 변화가 같은 줄에 걸리므로 **실제로 그런지는 재 봐야
   * 안다** — 보고서에 산술로 적어 두면 그 줄만 아무도 확인 안 한 값이 된다.
   */
  {
    name: "num-22-tight-2",
    label: "번호 22px + 아래 여백 6px → 2px (키우면서 상쇄하는 조합)",
    numberStyle: { fontSizePx: 22, marginBottomPx: 2 },
    css: `.questionNumber{font-size:22px;margin-bottom:2px}`,
  },

  /* ── 다. 반대로 — 번호를 키우면서 세로를 **안** 늘리는 배치 ──────────── */
  {
    name: "num-float-26",
    label: "번호 26px 를 본문 첫 줄에 태운다 (float)",
    numberStyle: { fontSizePx: 26 },
    css: `.questionNumber{float:left;font-size:26px;margin:0 10px 0 0}`,
  },
  {
    name: "num-margin-26",
    label: "번호 26px 를 왼쪽 여백으로 빼낸다 (본문 열이 그만큼 좁아진다)",
    numberStyle: { fontSizePx: 26 },
    css: `.questionArea{position:relative;padding-left:34px}
          .questionNumber{position:absolute;left:0;top:0;width:34px;font-size:26px;margin:0}`,
  },
  {
    name: "num-tight-2",
    label: "지금 크기 그대로 아래 여백만 6px → 2px",
    numberStyle: { fontSizePx: 18, marginBottomPx: 2 },
    css: `.questionNumber{margin-bottom:2px}`,
  },

  /* ── 라. D-tight — D 의 선은 살리고 «선 둘레의 빈 자리»만 줄인다 ────────
   *
   * CSS 는 `scripts/qa/idLayouts.ts` 한 곳에서 온다. 전수 측정(`measure-cap-layout`)
   * ·스크린샷(`shot-cap-layout`)이 **같은 문자열**을 쓴다 — 옮겨 적으면 재는 배치와
   * 찍는 배치가 갈라져도 아무도 모른다.
   *
   * `d-shared` 는 **대조군**이다: 위 `num-26-rule-mark`(이 파일에 직접 쓴 D안)와
   * 같은 Δ 가 나와야 공유 모듈이 D안을 옳게 옮긴 것이다. 다르면 둘 중 하나가 틀렸다.
   */
  ...[D_LAYOUT, ...D_TIGHT_CANDIDATES].map((layout) => ({
    name: layout.name === "d" ? "d-shared" : layout.name,
    label: layout.label,
    css: layout.css,
    injectsMark: layout.injectsMark,
    numberStyle: layout.expect
      ? {
          fontSizePx: layout.expect.fontSizePx,
          marginBottomPx: layout.expect.marginBottomPx,
        }
      : undefined,
    slot: layout.injectsMark ? injectMark : undefined,
  })),
];

interface Row {
  id: string;
  content: string;
  figureUrls: string[];
  questionType: string | null;
}

interface Measured {
  pid: string;
  availPx: number;
  /**
   * 문항번호 위 ~ **정답란 아래**. `measure-print-overflow.tsx` 와 같은 정의 —
   * 기준선 캐시(`.measure/cont.json`)와 같은 자로 잰 값이라야 견줄 수 있다.
   */
  neededPx: number;
  /**
   * 문항번호 위 ~ 문항 열에 그려진 것 중 **가장 아래**.
   *
   * ⚠️ 이게 없으면 지표가 눈이 먼다. 처음에 `neededPx` 만 재고 「정답란 **아래** 새 줄」
   * 대조군을 돌렸더니 **Δ 0.0px** 이 나왔다 — 한 줄을 새로 먹는 배치인데도. 정답란
   * 아래에 붙인 것은 그 구간 **밖**이라 자가 아예 못 본 것이다. 「0px 이라 공짜」는
   * 이 저장소가 가장 듣고 싶어 하는 답이라 그대로 보고서에 실릴 뻔했다
   * (CLAUDE.md 2026-08-18 「지표가 실패를 셀 수 있는 형태인지 먼저 확인하라」).
   * 넘침 판정은 이 값으로 한다.
   */
  usedPx: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * 지면을 그려 한 변형의 높이를 잰다. **장마다 두 문항** — 칸은 `flex: 1 1 0%` 로
 * 나뉘므로 한 장에 하나만 넣으면 칸이 두 배가 되어 다른 것을 재게 된다
 * (`measure-print-overflow.tsx` 와 같은 이유).
 */
async function measureVariant(
  page: Page,
  rows: Row[],
  kind: "first" | "continuation",
  variant: Variant,
  onProgress?: (done: number) => void,
): Promise<Measured[]> {
  const all: Measured[] = [];
  const PAGES_PER_BATCH = 60;
  for (let start = 0; start < rows.length; start += PAGES_PER_BATCH * 2) {
    const chunk = rows.slice(start, start + PAGES_PER_BATCH * 2);
    const pages: string[] = [];
    for (let i = 0; i < chunk.length; i += 2) {
      const slots = chunk.slice(i, i + 2).map((row, j) => {
        const base = renderSlot(
          {
            id: row.id,
            content: row.content ?? "",
            figureUrls: row.figureUrls,
            essayNumber: row.questionType === "서술형" ? 1 : null,
          },
          i + j + 1,
        );
        return variant.slot ? variant.slot(base) : base;
      });
      const pageHtml = renderPage(kind, slots, kind === "first" ? 1 : 2);
      pages.push(
        variant.page
          ? variant.page(
              pageHtml,
              chunk.slice(i, i + 2).map((r) => r.id),
            )
          : pageHtml,
      );
    }
    const doc = (await paperDocument(pages)).replace(
      "</head>",
      `<style>${variant.css ?? ""}</style></head>`,
    );
    const url = writeProbe(`probe-idmark-${variant.name}.html`, doc);
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    assertPaperSane(await page.evaluate(GUARD_SCRIPT));

    /* ── 가드 ① 주입이 실제로 붙었는가 ─────────────────────────────────────
       안 붙으면 이 변형은 기준선과 **똑같이** 그려지고, 결과는 「Δ 0px」로 나온다.
       그게 듣고 싶은 답이라 아무도 의심하지 않는다. 그래서 개수를 센다. */
    const marks = await page.evaluate(
      () => document.querySelectorAll(".idMark").length,
    );
    // 꼬리글 변형은 **장마다 하나**다(문항마다 하나가 아니다).
    const expectedMarks = variant.page
      ? Math.ceil(chunk.length / 2)
      : chunk.length;
    if (variant.injectsMark && marks !== expectedMarks)
      throw new Error(
        `${variant.name}: 표시가 ${marks}개인데 ${expectedMarks}개여야 한다 — 주입이 샜다. 이 변형의 «0px» 은 거짓이다.`,
      );
    if (!variant.injectsMark && marks !== 0)
      throw new Error(
        `${variant.name}: 표시를 안 넣는 변형인데 ${marks}개가 있다.`,
      );

    /* ── 가드 ② 번호 서식이 실제로 그 값으로 그려졌는가 ─────────────────── */
    if (variant.numberStyle) {
      const got = await page.evaluate(() => {
        const el = document.querySelector(".questionNumber");
        if (!el) return null;
        const s = getComputedStyle(el);
        return { fontSize: s.fontSize, marginBottom: s.marginBottom };
      });
      if (!got) throw new Error(`${variant.name}: questionNumber 가 없다.`);
      const want = variant.numberStyle;
      if (
        want.fontSizePx !== undefined &&
        got.fontSize !== `${want.fontSizePx}px`
      )
        throw new Error(
          `${variant.name}: 번호 글꼴이 ${got.fontSize} 다 — 의도한 ${want.fontSizePx}px 이 아니다. CSS 가 안 먹었다.`,
        );
      if (
        want.marginBottomPx !== undefined &&
        got.marginBottom !== `${want.marginBottomPx}px`
      )
        throw new Error(
          `${variant.name}: 번호 아래 여백이 ${got.marginBottom} 다 — 의도한 ${want.marginBottomPx}px 이 아니다.`,
        );
    }

    const measured = (await page.evaluate(() => {
      const out: unknown[] = [];
      document.querySelectorAll(".problemItem").forEach((node) => {
        const item = node as HTMLElement;
        const num = item.querySelector(".questionNumber") as HTMLElement;
        const blank = item.querySelector(".answerBlank") as HTMLElement;
        const area = item.querySelector(".questionArea") as HTMLElement;
        const style = getComputedStyle(item);
        const top = num.getBoundingClientRect().top;
        // 문항 열에 그려진 것 중 가장 아래. 정답란 **아래**에 무엇을 붙이든 여기 걸린다.
        // (이름 붙은 함수를 쓰면 esbuild `__name` 헬퍼로 죽는다 — paperProbe 주석 (3))
        let bottom = blank.getBoundingClientRect().bottom;
        area.querySelectorAll("*").forEach((child) => {
          const rect = (child as HTMLElement).getBoundingClientRect();
          if (rect.height > 0 && rect.bottom > bottom) bottom = rect.bottom;
        });
        out.push({
          pid: item.dataset.pid,
          // ⚠️ grid row 가 아니라 article 의 content box (paperProbe 주석 (4)).
          availPx:
            item.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom),
          neededPx: blank.getBoundingClientRect().bottom - top,
          usedPx: bottom - top,
        });
      });
      return out;
    })) as Measured[];
    all.push(...measured);
    onProgress?.(all.length);
  }
  return all;
}

function quantiles(values: number[]): {
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
} {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
  return {
    min: s[0]!,
    p50: at(0.5),
    p95: at(0.95),
    max: s[s.length - 1]!,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

/**
 * 전수 캐시에서 **뒤집힐 수 있는 문항만** 골라 낸다.
 *
 * 왜 이렇게 하나: 47,152건을 변형마다 다시 그리면 한 변형에 90분이다. 그런데 배치를
 * 바꿔서 **새로 넘칠 수 있는 문항**은 「지금 칸에 아슬아슬하게 들어가 있는 것」뿐이고,
 * **해소될 수 있는 문항**은 「조금 넘치는 것」뿐이다. 여유(`availPx − neededPx`)가
 * 창 밖인 문항은 Δ 가 창보다 작은 한 판정이 바뀔 수 없다.
 *
 * ⚠️ 그래서 **Δ 가 창 안에 있었는지**를 측정 뒤에 반드시 확인한다. 창보다 큰 Δ 가
 *    하나라도 나오면 창 밖에서도 뒤집힌 문항이 있을 수 있고, 그러면 「전수 정확」이
 *    아니다. 그 경우 이 스크립트는 **그렇게 말한다**(조용히 숫자만 내지 않는다).
 */
function windowIds(
  cache: Array<{ pid: string; availPx: number; neededPx: number }>,
  windowPx: number,
): string[] {
  return cache
    .filter((m) => Math.abs(m.availPx - m.neededPx) <= windowPx)
    .map((m) => m.pid);
}

async function main() {
  const take = Number(arg("--take") ?? 0);
  const idsFile = arg("--ids");
  const cachePath = arg("--cache");
  const windowPx = Number(arg("--window") ?? 60);
  const sampleN = Number(arg("--sample") ?? 0);
  const outPath = arg("--json");
  const kind = process.argv.includes("--first-page") ? "first" : "continuation";
  const only = (arg("--variants") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const variants = only.length
    ? VARIANTS.filter((v) => only.includes(v.name))
    : VARIANTS;
  if (only.length && variants.length !== only.length)
    throw new Error(
      `모르는 변형이 있다: ${only.filter((n) => !VARIANTS.some((v) => v.name === n)).join(", ")}`,
    );
  if (!variants.some((v) => v.name === "baseline"))
    throw new Error(
      "baseline 없이 재면 Δ 를 낼 수 없다 — 같은 실행에서 같이 재야 한다.",
    );

  /**
   * 전수 캐시를 쓰면 두 무리를 잰다.
   *   · **창 안** — 판정이 뒤집힐 수 있는 문항 전부. 여기서 나온 증감이 곧 전수 증감이다.
   *   · **고루 뽑은 표본** — 창 밖에서도 Δ 가 창을 넘지 않는지 확인하는 무리.
   *     이게 없으면 「창 밖은 안 뒤집힌다」는 전제를 아무도 확인하지 않는다.
   */
  const cache = cachePath
    ? (JSON.parse(readFileSync(cachePath, "utf8")) as Array<{
        pid: string;
        availPx: number;
        neededPx: number;
      }>)
    : null;
  let ids: string[] | null = idsFile
    ? (JSON.parse(readFileSync(idsFile, "utf8")) as string[])
    : null;
  if (cache) {
    const inWindow = windowIds(cache, windowPx);
    const inWindowSet = new Set(inWindow);
    const rest = cache.filter((m) => !inWindowSet.has(m.pid));
    // 무작위를 안 쓴다 — 같은 명령이 같은 표본을 고르게 해서 재실행이 재현되게.
    const stride = Math.max(1, Math.floor(rest.length / Math.max(1, sampleN)));
    const spread =
      sampleN > 0
        ? rest.filter((_, i) => i % stride === 0).slice(0, sampleN)
        : [];
    ids = [...inWindow, ...spread.map((m) => m.pid)];
    console.log(
      `전수 캐시 ${cachePath} · ${cache.length.toLocaleString()}건\n` +
        `  창(|여유| ≤ ${windowPx}px) ${inWindow.length.toLocaleString()}건` +
        ` + 창 밖 표본 ${spread.length.toLocaleString()}건`,
    );
  }
  const rows = (await prisma.$queryRawUnsafe(
    ids
      ? `SELECT id, content, figure_urls AS "figureUrls", question_type AS "questionType"
           FROM problem WHERE id = ANY($1::uuid[]) ORDER BY id`
      : `SELECT id, content, figure_urls AS "figureUrls", question_type AS "questionType"
           FROM problem ORDER BY id ${take > 0 ? `LIMIT ${take}` : ""}`,
    ...(ids ? [ids] : []),
  )) as Row[];
  if (ids && rows.length !== ids.length)
    throw new Error(
      `요청한 문항 ${ids.length}건 중 ${rows.length}건만 DB 에 있다 — 목록이 낡았다.`,
    );

  /**
   * ⚠️ **짝수로 맞춘다.** 장마다 두 문항을 넣으므로 홀수면 마지막 장이 한 문항이 되고,
   * 그 칸은 `flex: 1 1 0%` 라 **997px**(첫 장 838px)로 두 배가 된다 — 484px 을 재려던
   * 자리에서 다른 것을 재게 된다(적대적 리뷰 ④ B 와 같은 자리).
   *
   * **버리지 말고 채운다.** 하나를 버리면 하필 「반드시 봐야 할」 그 문항이 빠질 수
   * 있다. 채운 문항은 `filler` 로 표시해 집계에서 뺀다.
   *
   * (이 가드는 실제로 걸렸다 — 창 333 + 표본 600 = 933건이 홀수였고, 가드 ③ 이
   *  「문항 칸이 2가지다(484, 997)」로 멈춰 세웠다. 없었으면 마지막 한 줄이 두 배 칸으로
   *  들어가 조용히 섞였을 것이다.)
   */
  let fillerPid: string | null = null;
  if (rows.length % 2 === 1) {
    const have = new Set(rows.map((r) => r.id));
    const extra = (await prisma.$queryRawUnsafe(
      `SELECT id, content, figure_urls AS "figureUrls", question_type AS "questionType"
         FROM problem WHERE id <> ALL($1::uuid[]) ORDER BY id LIMIT 1`,
      [...have],
    )) as Row[];
    if (extra.length === 0) throw new Error("짝을 채울 문항이 없다.");
    rows.push(extra[0]!);
    fillerPid = extra[0]!.id;
    console.log(`홀수라 짝맞춤 문항 1건을 덧댔다(집계에서 뺀다): ${fillerPid}`);
  }

  console.log(
    `문항 ${rows.length.toLocaleString()}건 · ${kind === "first" ? "첫" : "이어지는"} 장 · 변형 ${variants.length}가지`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1200 },
  });
  await page.emulateMedia({ media: "print" });

  const results: Record<string, Map<string, Measured>> = {};
  try {
    for (const variant of variants) {
      const measured = await measureVariant(page, rows, kind, variant, (done) =>
        process.stdout.write(`\r${variant.name} ${done}/${rows.length}   `),
      );
      results[variant.name] = new Map(measured.map((m) => [m.pid, m]));
      process.stdout.write("\r");
    }
  } finally {
    await browser.close();
  }

  // 짝맞춤으로 덧댄 문항은 «재려던 것»이 아니다 — 집계 전에 뺀다.
  if (fillerPid)
    for (const map of Object.values(results)) map.delete(fillerPid);

  const base = results["baseline"]!;

  /* ── 가드 ③ 실측 칸이 제품 상수와 같은가 ────────────────────────────────
     다르면 지면이 우리가 아는 그 지면이 아니다. 여기서 멈추지 않으면 넘침 증감이
     **엉뚱한 칸**을 기준으로 세어진다(적대적 리뷰 ④ E 와 같은 함정). */
  const slots = [...new Set([...base.values()].map((m) => m.availPx))];
  if (slots.length !== 1)
    throw new Error(
      `기준선 문항 칸이 ${slots.length}가지다(${slots.join(", ")}).`,
    );
  const slot = slots[0]!;
  const constant =
    kind === "first"
      ? JASEUP_MEASURED_PX.firstPageSlot
      : JASEUP_MEASURED_PX.continuationSlot;
  if (slot !== constant)
    throw new Error(
      `실측 칸 ${slot}px ≠ 제품 상수 ${constant}px — 지면이 바뀌었다. 상수부터 다시 재라.`,
    );

  /* ── 가드 ④ 기준선에서는 두 자가 같은 값을 가리켜야 한다 ────────────────
     지금 지면은 정답란이 문항 열의 **마지막** 요소다. 그래서 「정답란 아래까지」와
     「가장 아래까지」가 같아야 한다. 다르면 내가 모르는 무언가가 정답란 밑에 있다는
     뜻이고, 그러면 기준선 캐시와의 비교 자체가 성립하지 않는다. */
  const parityGap = [...base.values()]
    .map((m) => m.usedPx - m.neededPx)
    .filter((d) => Math.abs(d) > 0.5);
  if (parityGap.length > 0)
    throw new Error(
      `기준선에서 「정답란 아래」와 「가장 아래」가 ${parityGap.length}건 다르다(최대 ${Math.max(
        ...parityGap.map(Math.abs),
      ).toFixed(1)}px) — 두 자가 다른 것을 재고 있다.`,
    );

  /* ── 가드 ⑤ 같은 실행의 기준선이 **전수 캐시와 같은 값**인가 ────────────────
     전수 환산은 「창 안은 지금 재고, 창 밖은 캐시를 믿는다」이다. 두 측정이 서로
     어긋나 있으면 그 환산은 **다른 두 지면을 이어 붙인 숫자**가 된다. 지문 장치가
     막아 주지만 지문은 «파일이 바뀌었나»만 본다 — 값이 실제로 같은지는 여기서 센다. */
  /**
   * 어긋난 문항이 **몇 건까지는** 빼고 간다. 이 저장소의 공유 DB·그림 폴더는 다른
   * 트랙이 지금도 고치고 있어서(실제로 이 측정 중에 그림 파일이 오갔다) 완전히
   * 멈춘 상태를 기다릴 수 없다. 대신 **뺀 문항을 이름까지 찍는다** — 조용히 빼면
   * 그게 곧 「숫자가 좋아지는 쪽으로 표본을 고르는」 짓이 된다.
   * 상한을 넘으면 그건 파일 몇 개가 오간 게 아니라 **캐시가 낡은 것**이므로 멈춘다.
   */
  const DRIFT_LIMIT = 20;
  const drifted: Array<{ pid: string; cached: number; now: number }> = [];
  if (cache) {
    const cacheById = new Map(cache.map((m) => [m.pid, m]));
    for (const [pid, b] of base) {
      const c = cacheById.get(pid);
      if (!c) continue;
      if (Math.abs(c.neededPx - b.neededPx) > 0.5)
        drifted.push({ pid, cached: c.neededPx, now: b.neededPx });
    }
    if (drifted.length > DRIFT_LIMIT)
      throw new Error(
        `이번 실행의 기준선이 전수 캐시와 ${drifted.length}건 다르다(상한 ${DRIFT_LIMIT}) — ` +
          `캐시가 낡았다. 전수 환산을 할 수 없다. 먼저 다시 재라:\n` +
          `  npx tsx scripts/qa/measure-print-overflow.tsx ${kind === "first" ? "--first-page " : ""}--verify ${cachePath} --take 2000 --repair`,
      );
    if (drifted.length > 0) {
      console.log(
        `⚠️ 캐시와 어긋난 문항 ${drifted.length}건을 집계에서 뺀다(그림 파일이 오가는 중):`,
      );
      for (const d of drifted)
        console.log(
          `   · ${d.pid} 캐시 ${d.cached.toFixed(1)}px → 지금 ${d.now.toFixed(1)}px`,
        );
      for (const map of Object.values(results))
        for (const d of drifted) map.delete(d.pid);
    } else {
      console.log(
        `기준선 ↔ 전수 캐시 대조: ${base.size.toLocaleString()}건 전부 일치`,
      );
    }
  }

  const baseOver = [...base.values()].filter(
    (m) => m.usedPx > m.availPx,
  ).length;
  console.log(
    `\n문항 칸 ${slot}px (실측) · 기준선 넘침 ${baseOver}/${rows.length} (${((100 * baseOver) / rows.length).toFixed(2)}%)\n`,
  );

  const header =
    "변형".padEnd(20) +
    "Δ중앙".padStart(8) +
    "Δ최소".padStart(8) +
    "Δ최대".padStart(8) +
    "넘침".padStart(7) +
    "새로넘침".padStart(9) +
    "해소".padStart(6) +
    "  설명";
  console.log(header);
  console.log("─".repeat(header.length + 10));

  const report: Record<string, unknown> = {};
  for (const variant of variants) {
    const got = results[variant.name]!;
    const deltas: number[] = [];
    let over = 0;
    let newlyOver = 0;
    let resolved = 0;
    const newlyOverIds: string[] = [];
    for (const [pid, b] of base) {
      const v = got.get(pid);
      if (!v) throw new Error(`${variant.name}: ${pid} 가 빠졌다.`);
      deltas.push(v.usedPx - b.usedPx);
      const wasOver = b.usedPx > b.availPx;
      const isOver = v.usedPx > v.availPx;
      if (isOver) over += 1;
      if (isOver && !wasOver) {
        newlyOver += 1;
        newlyOverIds.push(pid);
      }
      if (!isOver && wasOver) resolved += 1;
    }
    /**
     * **칸이 줄었는가**도 따로 본다. 장 꼬리글처럼 «장 단위»로 붙는 배치는 문항 높이를
     * 한 픽셀도 안 늘리면서 **칸(`availPx`)을 깎는다.** Δ 열만 보면 그런 배치는 영원히
     * 0.0 이라 「공짜」로 읽힌다 — 넘침은 두 값의 **차이**로 나는데 자가 한쪽만 보고 있는 것이다.
     */
    const slotDeltas = new Set<number>();
    for (const [pid, b] of base)
      slotDeltas.add(got.get(pid)!.availPx - b.availPx);
    const slotDelta = [...slotDeltas];
    if (slotDelta.some((d) => d !== 0))
      console.log(
        `  ⚠️ ${variant.name}: 문항 칸이 ${slotDelta.join(", ")}px 달라졌다(장 단위로 자리를 먹는 배치다).`,
      );

    const q = quantiles(deltas);
    console.log(
      variant.name.padEnd(20) +
        q.p50.toFixed(1).padStart(8) +
        q.min.toFixed(1).padStart(8) +
        q.max.toFixed(1).padStart(8) +
        String(over).padStart(7) +
        String(newlyOver).padStart(9) +
        String(resolved).padStart(6) +
        "  " +
        variant.label,
    );
    report[variant.name] = {
      label: variant.label,
      delta: q,
      slotDeltaPx: slotDelta,
      overflow: over,
      newlyOverflowing: newlyOver,
      resolved,
      newlyOverflowingIds: newlyOverIds.slice(0, 50),
    };
  }

  console.log(
    `\nΔ = 이 배치가 문항 하나에서 더 먹은 세로 px (기준선 대비, 같은 실행에서 잰 값).\n` +
      `「새로넘침」 = 기준선에서는 칸에 들어갔는데 이 배치에서 넘치는 문항 수 — 잰 ${rows.length.toLocaleString()}건 기준.`,
  );

  /* ── 전수 환산 — 캐시를 줬을 때만 ───────────────────────────────────────── */
  if (cache) {
    const cacheOver = cache.filter((m) => m.neededPx > m.availPx).length;
    /**
     * ⚠️ 이 환산이 **정확**하려면 「창 밖 문항은 판정이 안 뒤집힌다」가 참이어야 하고,
     *    그건 **모든 Δ 가 창보다 작을 때만** 참이다. 그래서 잰 Δ 의 최대치를 창과
     *    견주고, 넘으면 정확하다고 **말하지 않는다**. 이 확인이 없으면 창을 좁게
     *    잡을수록 「증가 0건」이 잘 나온다 — 듣고 싶은 답이 공짜로 나오는 구조다.
     */
    console.log(
      `\n── 전수 환산 (캐시 ${cache.length.toLocaleString()}건 · 기준선 넘침 ${cacheOver.toLocaleString()}건 ` +
        `${((100 * cacheOver) / cache.length).toFixed(2)}%) ──`,
    );
    const head =
      "변형".padEnd(20) +
      "Δ최대절대".padStart(11) +
      "창밖가능성".padStart(11) +
      "전수 넘침".padStart(11) +
      "증감".padStart(9);
    console.log(head);
    console.log("─".repeat(head.length + 6));
    for (const variant of variants) {
      const r = report[variant.name] as {
        delta: { min: number; max: number };
        newlyOverflowing: number;
        resolved: number;
      };
      const absMax = Math.max(Math.abs(r.delta.min), Math.abs(r.delta.max));
      const exact = absMax <= windowPx;
      const total = cacheOver + r.newlyOverflowing - r.resolved;
      console.log(
        variant.name.padEnd(20) +
          absMax.toFixed(1).padStart(11) +
          (exact ? "없음(정확)" : "있음(주의)").padStart(11) +
          total.toLocaleString().padStart(11) +
          `${r.newlyOverflowing - r.resolved >= 0 ? "+" : ""}${(r.newlyOverflowing - r.resolved).toLocaleString()}`.padStart(
            9,
          ),
      );
      (report[variant.name] as Record<string, unknown>).corpus = {
        baselineOverflow: cacheOver,
        total,
        exact,
        maxAbsDelta: absMax,
        windowPx,
        driftExcluded: drifted.length,
      };
    }
    console.log(
      `\n「창밖가능성 없음(정확)」 = 잰 Δ 의 최대 절대값이 창(${windowPx}px)보다 작다 →\n` +
        `  창 밖 문항은 판정이 뒤집힐 수 없으므로 전수 숫자가 **정확하다**.\n` +
        `「있음(주의)」 = Δ 가 창을 넘었다 → 창 밖에서도 뒤집혔을 수 있어 전수 숫자는 하한이다.`,
    );
  }

  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          kind,
          slotPx: slot,
          rows: rows.length,
          measuredIds: [...base.keys()],
          sampleId: SAMPLE_ID,
          baselineOverflow: baseOver,
          variants: report,
          raw: Object.fromEntries(
            Object.entries(results).map(([name, map]) => [
              name,
              Object.fromEntries(
                [...map].map(([pid, m]) => [
                  pid,
                  [m.availPx, m.neededPx, m.usedPx],
                ]),
              ),
            ]),
          ),
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n→ ${outPath}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
