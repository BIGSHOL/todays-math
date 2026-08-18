/**
 * 인쇄 넘침 위험 판정 — **넘쳐도 모르는 것**이 진짜 피해다.
 *
 * ## 무슨 일이 일어나는가 (2026-08-18 정정)
 *
 * 예전 주석은 「문항 하나가 `.problemBox` 이고 `overflow: hidden` 이라 잘린다」고 적었다.
 * **`.problemBox` 라는 클래스는 존재하지 않는다.** 저장소에서 그 이름이 나오는 곳은
 * 그 주석 한 줄뿐이었고, `TestPrint.module.css` 의 `overflow: hidden` 은
 * `.a4Page`(지면 전체)와 `.answerSolutions`(정답지 해설단) 둘뿐이다.
 * 문항 칸 `.problemItem` 에는 **`overflow` 가 없다.**
 *
 * 그래서 실제로 일어나는 일은 «잘림»이 아니라 **«겹침»**이다
 * (적대적 리뷰 ③ §3 — 스크린샷과 실제 A4 PDF 로 확인).
 *   · **1번 문항이 넘치면 → 2번 문항 위에 겹쳐 찍힌다.** 그 문항만 조금 잘리는 게
 *     아니라 **멀쩡한 옆 문항까지 못 읽게 된다.**
 *   · **2번 문항이 넘치면 → 보기·정답란이 지면 밖으로 밀려 통째로 사라진다.**
 *     넘친 내용은 다음 장으로 가지 않는다(PDF 로 확인: 페이지 수 그대로 1).
 *
 * 이 차이가 경고 문구를 좌우한다. 원장이 「잘린 문항」을 찾으면 못 찾는다 —
 * 눈에 들어오는 것은 **글자가 겹친 옆 문항**이다. 찾는 대상이 틀리면 경고가 있어도
 * 지나친다. 주석·테스트 이름·경고 문구를 전부 이 사실에 맞춘다.
 *
 * ## 무엇을 보는가
 *
 * 장당 문항 수는 2로 고정이고(`JASEUP_GEOMETRY.questionsPerPage`) 칸 높이는
 * **첫 장 405px · 이어지는 장 484px** 이다(`JASEUP_MEASURED_PX`).
 * 판정은 본문 표시폭 · 배치(상자·보기 열 수) · **그림 높이** · 놓이는 **장**을 본다.
 * 정답지는 `assessAnswerKeyRisk` 가 따로 본다.
 *
 * 지면 형태는 원장님 확정 사항(D-07)이라 여기서 바꾸지 않는다.
 * **인쇄를 막지도 않는다** — 원장이 알고 누르게만 한다.
 *
 * ⚠️ 이건 확정이 아니라 **개연성**이다. 정확히 재려면 실제 렌더 높이를 측정해야 한다 —
 *    `scripts/qa/measure-print-overflow.tsx` 가 그걸 하고,
 *    `scripts/qa/eval-overflow-rules.ts` 가 이 판정을 그 실측과 대조해 채점한다.
 */
import type { TestPrintProblem } from "@/components/print/types";
import { displayWidth, fitsTwoColumns } from "@/lib/math/displayWidth";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { paginateAnswerKey } from "@/lib/printLayout";
import { packProblems } from "@/lib/printPack";
import {
  normalizeOcrText,
  parseProblemContent,
} from "@/lib/problem/parseProblemContent";

/**
 * 본문 **표시 폭** 한계. 원문 글자 수가 아니다 — 한글·전각은 2, 수식은 글리프 근사로 센다
 * (`displayWidth`, 시험지변환기 `_sol_seg_width` 이식).
 *
 * 값의 근거(실데이터 20,000건, 2026-08-17): 예전 규칙 "원문 500자 초과"가 잡던 279건과
 * **같은 건수**를 잡는 폭이 530이다. 같은 경고량에서 판정만 달라진다 —
 *   · 수식이 많아 원문만 길던 108건은 빠지고(예: 원문 654자 / 폭 430),
 *   · 한글이 많아 **놓치던 107건**이 들어온다(예: 원문 389자 / 폭 554).
 *
 * ⚠️ 임계값을 바꿀 때는 **같은 경고 건수로 맞춰** 비교할 것. 분모가 다르면
 *    "새 규칙이 놓치는 게 없다"는 착시가 생긴다(이번 이식에서 실제로 그랬다).
 *
 * ── 2026-08-18: 임계값은 그대로인데 **자가 바뀌었다** ────────────────────────
 * `displayWidth` 가 연산자 여백을 세기 시작해 같은 문항의 폭이 커졌다
 * (원장님 "보기가 접힌다" 회귀 수리). 그래서 **530 이라는 숫자의 뜻이 바뀌었다**:
 *   경고 건수 605건(1.28%) → **709건(1.50%)**
 * 예전과 **같은 건수**로 맞추려면 한계를 546 으로 올려야 한다.
 * 그런데 올리지 않았다 — 새로 걸린 104건을 눈으로 보니 원문 350~630자짜리
 * **진짜로 긴 문항**이었다(폭 531 표본 전량). 숫자를 다시 맞추면 그 사실이
 * 가려질 뿐이라 그대로 두고, 늘어난 건수를 보고서에 적는다.
 * (CLAUDE.md 2026-08-17: 임계값을 물려받을 때는 분모가 같은지부터 볼 것.)
 */
export const OVERFLOW_WIDTH_LIMIT = 530;

/**
 * 그림이 이 장수 이상이면 세로 공간을 넘길 개연성이 크다.
 *
 * ⚠️ 이 규칙은 **장수**만 본다. 실데이터의 그림 문항은 94%가 1장짜리라
 * 여기에 걸리는 것은 512건뿐인데, 실제로 넘치는 그림 문항은 2,557건이다.
 * 그림이 지면을 얼마나 먹는지는 장수가 아니라 **치수**로 갈린다 —
 * 그건 `estimateFigureBlockPx` 가 본다. 이 상수는 「치수를 모르는데 여러 장」인
 * 경우를 남겨 두는 안전망일 뿐이다(적대적 리뷰 ③ §2).
 */
export const OVERFLOW_FIGURE_LIMIT = 2;

/* ────────────────────────────────────────────────────────────────────────
 * 그림 높이 — 인자에 없던 것 (적대적 리뷰 ③ §2)
 * ──────────────────────────────────────────────────────────────────────── */

/** 그림 한 장의 **원본** 치수. 인쇄 폭 상한을 적용하기 전 값이다. */
export interface FigureDimension {
  width: number;
  height: number;
}

/**
 * 치수를 모르는 그림 한 장이 먹는다고 **가정**하는 높이.
 *
 * 근거: 실데이터 9,587장을 인쇄 폭 상한(70mm)으로 환산한 높이의 **중앙값 207px**
 * (90분위 305px · 99분위 1,145px). 중앙값을 쓰는 이유는 이 값이 「모르는 것」에만
 * 붙기 때문이다 — 적재된 치수가 있으면 실제 값을 쓴다. 0으로 세면
 * **그림 문항일수록 조용해진다**(리뷰 §2 — 인자에 없는 것은 안 잡힌다).
 */
export const UNKNOWN_FIGURE_HEIGHT_PX = 207;

/** 치수를 모르는 그림의 가정 폭. 상한(70mm)에 붙여 «한 줄에 한 장»으로 본다. */
const UNKNOWN_FIGURE_WIDTH_PX = JASEUP_MEASURED_PX.figureMaxWidth;

/**
 * DB 의 평탄 배열(`problem.figure_dims` = `[w1,h1,w2,h2,…]`)을 그림 수에 맞춰 짝짓는다.
 *
 * ⚠️ **손상된 입력은 «작은 그림»이 아니라 «모른다»로 받는다.** 길이가 안 맞으면
 *    어느 그림에 붙는 값인지 알 수 없으므로 전부 `null` 이다. 짝은 맞는데 값이
 *    0·음수·NaN 이면 그 자리만 `null` 이다. 여기서 0을 그대로 흘리면 넘치는
 *    문항이 «높이 0» 으로 읽힌다(CLAUDE.md 2026-08-16).
 */
export function parseFigureDimensions(
  figureCount: number,
  flat: readonly number[] | null | undefined,
): (FigureDimension | null)[] {
  if (figureCount <= 0) return [];
  const unknown = (): (FigureDimension | null)[] =>
    Array.from({ length: figureCount }, () => null);
  if (!flat || flat.length !== figureCount * 2) return unknown();

  return Array.from({ length: figureCount }, (_, index) => {
    const width = flat[index * 2]!;
    const height = flat[index * 2 + 1]!;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  });
}

/**
 * 그림 묶음이 문항 칸에서 먹는 **세로 픽셀**.
 *
 * 지면 그대로의 모형이다(`ProblemContent`):
 *   `<div class="mt-3 flex flex-wrap items-start gap-4">` 안에
 *   `<img class="… print:max-w-[70mm]">` 이 늘어선다.
 * 그래서 (1) 폭이 상한을 넘으면 **비율대로** 줄고, (2) 가로로 늘어놓다 문항 열을
 * 넘으면 다음 줄로 접히며, (3) 한 줄의 높이는 그 줄에서 **가장 높은 장**이다
 * (`items-start` 라 늘어나지 않는다).
 *
 * 폭 상한(264.57px)이 문항 열(363.5px)보다 좁으므로 한 장이 혼자 넘쳐 줄어드는
 * 일은 없다 — flex 축소를 따로 세지 않는 근거다.
 */
export function estimateFigureBlockPx(
  figures: readonly (FigureDimension | null)[],
): number {
  if (figures.length === 0) return 0;
  const { problemColumn, figureMaxWidth, figureGap, figureBlockTop } =
    JASEUP_MEASURED_PX;

  let total = figureBlockTop;
  let rowWidth = 0;
  let rowHeight = 0;
  let rows = 0;

  for (const figure of figures) {
    const scale = figure ? Math.min(1, figureMaxWidth / figure.width) : 1;
    const width = figure ? figure.width * scale : UNKNOWN_FIGURE_WIDTH_PX;
    const height = figure ? figure.height * scale : UNKNOWN_FIGURE_HEIGHT_PX;

    const wouldBe = rowWidth === 0 ? width : rowWidth + figureGap + width;
    if (rowWidth > 0 && wouldBe > problemColumn) {
      total += rowHeight;
      rows += 1;
      rowWidth = width;
      rowHeight = height;
      continue;
    }
    rowWidth = wouldBe;
    rowHeight = Math.max(rowHeight, height);
  }
  total += rowHeight;
  rows += 1;
  // 줄 사이 간격 — `gap-4` 는 가로·세로 모두에 붙는다.
  return total + figureGap * (rows - 1);
}

/* ────────────────────────────────────────────────────────────────────────
 * 줄 수 추정 — 폭 총합이 못 보는 것을 본다
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 문항 열 한 줄에 들어가는 **표시폭** — 셋이 다르다.
 *
 * 예전에는 셋 다 `COLUMN_UNITS = 59` 하나로 봤다. 지면 실측은
 * 문항 열 58.2 · 1열 보기 글자칸 55.2 · 상자 항목칸 52.7 단위다
 * (`scripts/qa/measure-paper-units.tsx`). 보기는 마커(①)와 `gap-1.5` 만큼,
 * 상자는 `p-4` 와 테두리만큼 좁다. 한 값으로 뭉개면 **좁은 쪽에서 덜 센다** —
 * 폭 6.4%(보기)·10.7%(상자)를 안 보는 셈이라 접히는 줄이 통째로 빠진다.
 */
const COLUMN_UNITS = JASEUP_MEASURED_PX.problemColumn / JASEUP_MEASURED_PX.unit;
const CHOICE_TEXT_UNITS =
  JASEUP_MEASURED_PX.choiceTextColumn / JASEUP_MEASURED_PX.unit;
const BOX_ITEM_UNITS =
  JASEUP_MEASURED_PX.boxItemColumn / JASEUP_MEASURED_PX.unit;

/** 표시폭을 열 폭으로 나눠 줄 수로. 빈 문자열은 0줄이다. */
function linesFor(text: string, unitsPerLine = COLUMN_UNITS): number {
  const width = displayWidth(text);
  if (width <= 0) return 0;
  return Math.ceil(width / unitsPerLine);
}

/**
 * 보기 묶음이 차지하는 **세로 픽셀**. **렌더러와 같은 함수로 열 수를 정한다**
 * (`fitsTwoColumns`) — 둘이 갈라지면 "화면은 1열인데 판정은 2열로 셈"이 된다.
 *
 * 글자 줄 말고도 `mt-4`(16px)와 행 간격 `gap-y-2`(8px)를 먹는다. 예전에는 둘 다
 * 0으로 봤다 — 1열 5보기면 그것만 1.8줄이다.
 */
function choicesBlockPx(items: readonly string[]): number {
  if (items.length === 0) return 0;
  const { line, choiceGridTop, choiceRowGap } = JASEUP_MEASURED_PX;
  // 2열은 항목이 전부 한 칸에 들어갈 때만 고른다 — 그래서 행마다 한 줄이다.
  const rows = fitsTwoColumns(items)
    ? Math.ceil(items.length / 2)
    : items.length;
  const textLines = fitsTwoColumns(items)
    ? rows
    : items.reduce(
        (sum, item) => sum + Math.max(1, linesFor(item, CHOICE_TEXT_UNITS)),
        0,
      );
  return choiceGridTop + textLines * line + choiceRowGap * (rows - 1);
}

/**
 * 문항 하나가 지면에서 차지하는 **세로 픽셀**을 추정한다.
 *
 * 문항번호 위부터 정답란 아래까지 — `measure-print-overflow.tsx` 가 재는 `needed`
 * 와 같은 구간이다. 그래야 문항 칸(`JASEUP_MEASURED_PX.continuationSlot`)과
 * 직접 견줄 수 있고, 한계를 **칸에서 유도**할 수 있다.
 *
 * `figures` 는 `parseFigureDimensions` 가 짝지은 **원본 치수**다. 넘기지 않으면
 * 그림을 0으로 센다 — 그게 2026-08-18 이전의 동작이었고, 실측 넘침의 93.8%가
 * 거기로 빠져나갔다(적대적 리뷰 ③ §2). 판정 경로에서는 반드시 넘길 것.
 */
export function estimateProblemPx(
  content: string,
  figures: readonly (FigureDimension | null)[] = [],
): number {
  const { question, choices } = parseProblemContent(content);
  const { line, boxChrome, fixedChrome } = JASEUP_MEASURED_PX;

  // 문항번호와 정답란은 본문과 무관하게 늘 붙는다 — 실측 62.5px = 3.08줄.
  // 예전에는 0으로 셌고, 그래서 «14줄» 이 칸 484px 과 아무 관계가 없었다.
  let px = fixedChrome;

  // `parseProblemContent` 는 상자를 이미 **인용문 마크다운**으로 굳혀 준다
  //   `> <보기2>` / `>` / `> ㄱ. …`
  // 라벨 뒤 숫자가 렌더러가 정한 **열 수**다. 여기서 다시 판단하지 않고 그대로 읽는다 —
  // 판정이 스스로 열 수를 정하면 렌더러와 갈라져 조용히 어긋난다.
  let plain: string[] = [];
  let box: string[] | null = null;

  /**
   * ⚠️ 예전에는 평문 줄을 **한 덩어리로 이어 붙여** 셌다. 그때는 지문이 늘 한 줄
   * (`collapseWhitespace` 가 개행을 다 녹인다)이라 같은 값이었다.
   * 2026-08-18 부터 계산 과정 다단 등식이 **문단으로 갈린다** — 문단마다 제 줄을
   * 차지하므로 따로 세지 않으면 늘어난 세로 공간을 한 줄도 못 본다.
   *
   * 문단 사이 여백은 **0이다** — `@tailwindcss/typography` 가 설치돼 있지 않아
   * `prose-p:my-2` 가 빌드 산출물에 한 줄도 없다(적대적 리뷰 ③ §8, 실측 0px/0px).
   * 예전 주석은 「8px 이라 안 센다」고 적었는데 그 8px 은 존재하지 않는다.
   */
  const flushPlain = () => {
    if (plain.length === 0) return;
    for (const part of plain) px += Math.max(1, linesFor(part)) * line;
    plain = [];
  };
  const flushBox = () => {
    if (box === null) return;
    // 문단(빈 `>` 줄로 나뉜 덩어리)으로 나눈다. 첫 문단이 라벨이다.
    const paras = box
      .join("\n")
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    const header = paras[0] ?? "";
    const items = paras.slice(1);
    const cols = Number(header.match(/(\d+)\s*[>〉】］\]]/)?.[1] ?? 1);

    // `boxChrome` 은 테두리·안쪽 여백·`my-4` 바깥 마진에 **라벨 줄까지** 넣은 실측값이다.
    // `<나열>` 상자는 라벨 줄을 안 그리므로(머리 없는 상자) 한 줄을 뺀다.
    const headerless = header.startsWith("<나열");
    px += boxChrome - (headerless ? line : 0);
    if (headerless) items.unshift(header.replace(/^<나열\d?>\s*/, ""));
    if (cols >= 2) {
      // 2열은 항목이 전부 한 칸에 들어갈 때만 선택된다(`fitsTwoColumns`).
      px += Math.ceil(items.length / cols) * line;
    } else {
      px += items.reduce(
        (sum, item) => sum + Math.max(1, linesFor(item, BOX_ITEM_UNITS)) * line,
        0,
      );
    }
    box = null;
  };

  for (const rawLine of question.split(/\r?\n/)) {
    const trimmed = rawLine.trimStart();
    if (trimmed.startsWith(">")) {
      flushPlain();
      if (box === null) box = [];
      box.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }
    flushBox();
    if (trimmed) plain.push(trimmed);
  }
  flushPlain();
  flushBox();

  px += estimateFigureBlockPx(figures);
  px += choicesBlockPx(choices);
  return px;
}

/**
 * 문항 하나가 차지하는 **줄 수**. `estimateProblemPx` 를 행높이로 나눈 값이다 —
 * 한계값(`OVERFLOW_LINE_LIMIT`)과 같은 단위로 읽으라고 남긴다.
 */
export function estimateProblemLines(
  content: string,
  figures: readonly (FigureDimension | null)[] = [],
): number {
  return Math.ceil(
    estimateProblemPx(content, figures) / JASEUP_MEASURED_PX.line,
  );
}

/**
 * 반 페이지 문항 칸(이어지는 장)에 들어가는 줄 수의 한계 — **칸 높이에서 유도한다.**
 *
 * ── 값의 내력 ────────────────────────────────────────────────────────────
 *  · ~2026-08-17  **14** — 「폭 규칙(530)이 잡는 건수와 같은 규모가 되는 줄 수」.
 *                 자가 없을 때 쓰던 임시방편이다. 칸(484px)과 아무 관계가 없어서
 *                 지면이 바뀌어도 판정은 몰랐다.
 *  · 2026-08-18a  **18** — 그림 높이를 세게 된 뒤 실측 곡선의 무릎으로 다시 잡았다.
 *                 여전히 «맞춘» 값이다.
 *  · 2026-08-18b  **지금** — 자가 지면 px 를 그대로 재게 됐으므로
 *                 `floor(484 / 20.3125) = 23` 이다. **맞춘 값이 아니라 유도한 값.**
 *
 * 자와 한계는 **같이** 움직여야 한다. 자만 고치면 경고가 폭증하고(한계 18로 두면
 * 8,446건 · 정밀도 32.3%), 한계만 올리면 덜 세던 몫이 되살아난다.
 *
 * 실측 검산 (전수 47,152건 · `scripts/qa/eval-overflow-rules.ts`):
 * ```
 * 한계 22  경고 4,229  맞음 2,710  헛것 1,519  재현율 99.4%  정밀도 64.1%
 * 한계 23  경고 3,495  맞음 2,621  헛것   874  재현율 96.1%  정밀도 75.0%   ← 유도값
 * 한계 24  경고 2,837  맞음 2,374  헛것   463  재현율 87.1%  정밀도 83.7%
 * ```
 * 유도값이 곡선의 무릎과 같은 자리다 — 자를 바로잡았으니 그래야 맞는다.
 */
export const OVERFLOW_LINE_LIMIT = Math.floor(
  JASEUP_MEASURED_PX.continuationSlot / JASEUP_MEASURED_PX.line,
);

/**
 * **첫 장** 문항 칸의 줄 수 한계 — 이어지는 장보다 낮다.
 *
 * 첫 장에는 머리글과 「◆ 핵심 개념 정리」 상자가 얹혀 문항 칸이 79px 좁다
 * (405px vs 484px = 3.9줄 = 칸의 16.3%). 그런데 판정은 한계를 하나만 써서
 * **같은 문항이 1·2번이면 겹치고 3번이면 멀쩡**했다 — 첫 장에서만 넘치는 문항이
 * 실측 3,216건, 그중 경고도 없던 것이 2,892건이다(적대적 리뷰 ③ §4).
 *
 * 값은 **칸 차이에서 유도한다.** 손으로 고르면 두 상수가 따로 놀아, 지면을 다시
 * 재도 한쪽만 따라온다. 실측으로도 이 값이 맞다 — 첫 장 기준 전수 채점:
 *
 * ```
 * 한계 13  경고 8,017  맞음 5,775  재현율 97.2%  정밀도 72.0%
 * 한계 14  경고 7,148  맞음 5,578  재현율 93.9%  정밀도 78.0%   ← 유도값
 * 한계 16  경고 5,302  맞음 4,845  재현율 81.6%  정밀도 91.4%
 * 한계 18  경고 3,742  맞음 3,473  재현율 58.5%  정밀도 92.8%   ← 장을 모를 때
 * ```
 */
export const OVERFLOW_LINE_LIMIT_FIRST_PAGE = Math.floor(
  JASEUP_MEASURED_PX.firstPageSlot / JASEUP_MEASURED_PX.line,
);

export interface OverflowRisk {
  /** 지면에 찍히는 문항 번호(1부터). 배열 위치가 아니다 — 원장이 지면에서 찾는 번호다. */
  number: number;
  problemId: string;
  reasons: string[];
}

export function assessOverflowRisk(
  problems: TestPrintProblem[],
): OverflowRisk[] {
  const risks: OverflowRisk[] = [];

  /**
   * 문항이 **몇 째 장**에 놓이는지는 `packProblems` 가 정한다. 판정이 스스로
   * 「인덱스 2까지가 첫 장」이라고 굳히면 분할이 바뀔 때 조용히 어긋난다 —
   * 렌더러와 열 수를 나눠 갖던 `fitsTwoColumns` 와 같은 자리다.
   */
  const pageOfIndex: number[] = [];
  packProblems(problems).forEach((page, pageIndex) => {
    for (let i = 0; i < page.problems.length; i += 1)
      pageOfIndex.push(pageIndex + 1);
  });

  problems.forEach((problem, index) => {
    const reasons: string[] = [];
    const figureCount = problem.figureUrls?.length ?? 0;
    const figures = parseFigureDimensions(figureCount, problem.figureDims);
    const figurePx = estimateFigureBlockPx(figures);

    if (displayWidth(problem.content) > OVERFLOW_WIDTH_LIMIT)
      reasons.push("본문이 길다");
    // 폭 총합이 못 보는 배치(그림·상자·보기 1열)를 줄 수로 따로 본다.
    // 같은 문항이 둘 다에 걸리면 사유를 겹쳐 적지 않는다 — 원장이 읽을 문장이다.
    const lines = estimateProblemLines(problem.content, figures);
    // 첫 장은 칸이 3.9줄 좁다 — 같은 문항이라도 앞자리면 더 엄격하게 본다.
    const onFirstPage = pageOfIndex[index] === 1;
    const limit = onFirstPage
      ? OVERFLOW_LINE_LIMIT_FIRST_PAGE
      : OVERFLOW_LINE_LIMIT;
    if (!reasons.length && lines > limit) {
      // 높이의 절반 넘게가 그림이면 원장이 지면에서 찾을 것도 그림이다.
      // 사유가 가리키는 곳이 틀리면 경고가 있어도 지나친다(리뷰 §3).
      const figureLines = figurePx / JASEUP_MEASURED_PX.line;
      const what =
        figureLines * 2 >= lines ? "그림이 크다" : "배치가 높다(상자·보기 1열)";
      // 첫 장에서만 걸리는 문항은 **뒤로 옮기면 해결된다.** 그게 원장이 할 일이라
      // 사유에 적는다 — 사유가 가리키는 곳이 곧 손볼 곳이어야 한다.
      reasons.push(
        onFirstPage && lines <= OVERFLOW_LINE_LIMIT
          ? `${what} · 첫 장은 칸이 좁다`
          : what,
      );
    }
    // 장수 규칙은 **치수를 모를 때만** 쓰는 안전망이다. 치수를 알면 높이 규칙이
    // 같은 문항을 이미 본다 — 실측으로 「장수만 걸리는」 39건은 **한 건도 안 넘쳤다.**
    if (figureCount >= OVERFLOW_FIGURE_LIMIT && figures.some((f) => f === null))
      reasons.push("그림이 여러 장이다");

    if (reasons.length) {
      risks.push({ number: index + 1, problemId: problem.id, reasons });
    }
  });

  return risks;
}

/* ────────────────────────────────────────────────────────────────────────
 * 정답지 — `solution` 도 판정한다 (적대적 리뷰 ③ §5)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 해설 한 단에 들어가는 **표시폭**.
 *
 * 단 폭은 331px 이고 본문은 11.5px 다. 글자 폭만 따지면 55 단위쯤이어야 하는데
 * 실측에 맞춘 값은 **50** 이다 — `displayWidth` 의 수식 글리프 근사가 해설(수식
 * 밀도가 본문보다 훨씬 높다)에서 덜 세기 때문이다. 여기서 근사를 고치는 대신
 * **자를 실측에 맞춘다** — 그게 이 저장소가 반복해서 배운 것이다(문턱이 아니라 자).
 *
 * 맞춤 근거: 해설 1,500건을 지면에 그려 높이를 재고 격자 탐색
 * (`scripts/qa/measure-answerkey-units.tsx` + 채점). 50/52 조합에서
 * 오차 |20px| 이내가 **81.7%** (중앙 +2px · p05 −33px · p95 +29px).
 */
const SOLUTION_UNITS_PER_LINE = 52;

/**
 * 해설 한 건이 글자 말고 더 먹는 세로 — 「문 N · 답」 제목 줄과 항목 아래 여백.
 * 실측: 제목 줄 26.4px + 마진 4px + 패딩 약 4px + `margin-bottom: 14px` ≈ 52px.
 */
const SOLUTION_CHROME_PX = 48;

/**
 * **세로로 자리를 더 먹는 수식.** `displayWidth` 는 폭만 재므로 `rac` 를 «두 글자»로
 * 보지만, 지면에서는 분자·분모가 위아래로 쌓여 한 줄로 안 끝난다. 해설은 본문보다
 * 수식 밀도가 훨씬 높아 이 몫이 그대로 «놓침»이 된다.
 *
 * 실측 1,500건에서 이 항을 넣으면 오차 |20px| 이내가 80.7% → **86.1%** 로 오르고,
 * 20px 넘게 **과소평가**하는 비율이 13.5% → **6.7%** 로 준다. 과소평가는 곧 놓침이라
 * 정확도보다 이쪽이 중요하다.
 */
const TALL_MATH_RE =
  /\\(?:d?frac|sum|int|prod|lim|binom|begin\{[a-z]*matrix\}|begin\{cases\}|sqrt\[)/g;
const TALL_MATH_EXTRA_PX = 4;

/**
 * 「빠른 정답」 상자의 높이. 이 상자는 정답지 **1쪽에만** 얹히고, 그만큼 해설 칸이
 * 좁아진다 — 실측으로 잘린 정답지 134장 중 **95장이 1쪽**인 이유가 이것이다.
 *
 * ⚠️ **문항 수만으로는 못 구한다.** 셀 안폭이 좁아(약 153px 에서 「문 N」 라벨을 뺀
 *    몫) 정답이 조금만 길면 두 줄이 되고, 행 높이는 그 행에서 가장 높은 칸을 따른다.
 *    실측 25문항 상자가 **344~668px** 로 갈린다 — 처음에 「1」 같은 합성 정답으로
 *    재서 344 로 굳혔더니 1쪽 해설 칸을 139px 넓게 봤고, 그만큼 경고를 놓쳤다.
 *    (지면 실측은 **실제 내용으로, 실제 지면 안에서** 해야 한다.)
 */
export function quickAnswerBoxPx(answers: readonly string[]): number {
  if (answers.length === 0) return 0;
  const {
    quickAnswerTitle,
    quickAnswerRowGap,
    quickAnswerColumns,
    quickAnswerCellBase,
    quickAnswerCellLine,
    quickAnswerCellUnits,
  } = JASEUP_MEASURED_PX;

  const cellPx = (answer: string) => {
    const width = displayWidth(normalizeOcrText(answer ?? ""));
    return (
      quickAnswerCellBase +
      Math.max(1, Math.ceil(width / quickAnswerCellUnits)) * quickAnswerCellLine
    );
  };

  let total = quickAnswerTitle;
  const rows = Math.ceil(answers.length / quickAnswerColumns);
  for (let i = 0; i < answers.length; i += quickAnswerColumns) {
    // 한 행의 높이는 그 행에서 **가장 높은 칸**이다 (grid 행).
    total += Math.max(
      ...answers.slice(i, i + quickAnswerColumns).map((a) => cellPx(a)),
    );
  }
  return total + quickAnswerRowGap * (rows - 1);
}

/**
 * 해설 한 건이 정답지에서 차지하는 **세로 픽셀**.
 *
 * ⚠️ 렌더러와 **같은 정규화**(`normalizeOcrText`)를 태운다. DB 해설에는 OCR 이
 *    수식마다 빈 줄을 넣어 «문단»이 100개가 넘는 것이 있는데, 렌더러는 그 개행을
 *    전부 공백으로 녹여 한 문단으로 흘린다. 문단으로 세면 실측 309px 짜리를
 *    2,098px 로 본다 — 실제로 그렇게 틀렸다.
 */
export function estimateSolutionPx(solution: string | null): number {
  // 해설이 없으면 지면에 「해설이 등록되지 않았습니다.」 한 줄이 나간다.
  const text = normalizeOcrText(solution ?? "해설이 등록되지 않았습니다.");
  const lines = Math.max(
    1,
    Math.ceil(displayWidth(text) / SOLUTION_UNITS_PER_LINE),
  );
  TALL_MATH_RE.lastIndex = 0;
  const tall = text.match(TALL_MATH_RE)?.length ?? 0;
  return (
    SOLUTION_CHROME_PX +
    lines * JASEUP_MEASURED_PX.solutionLine +
    tall * TALL_MATH_EXTRA_PX
  );
}

export interface AnswerKeyRisk {
  /** 정답지 쪽 번호(1부터). */
  page: number;
  /** 그 쪽에서 해설이 **통째로 사라질** 수 있는 문항 번호. */
  numbers: number[];
}

/**
 * 정답지에서 해설이 지면 밖으로 밀릴 문항을 짚는다.
 *
 * `.answerSolutions` 는 `column-count: 2` + `overflow: hidden` 이다. 두 단을 다
 * 채우고도 남은 해설은 **3번째 단**으로 밀려 지면 밖에서 사라진다 — 세로로 조금
 * 잘리는 게 아니라 **한 문항의 해설이 통째로 없어진다.** 항목마다
 * `break-inside: avoid` 라 단 경계에서 쪼개지지 않고 통으로 다음 단에 간다.
 *
 * ⚠️ **정원(`answerEntriesPerPage`)은 안 건드린다.** 줄이면 정답지 장 수와 배치가
 *    바뀌므로 원장님 확정 대상이다(D-07). 여기서는 알리기만 한다.
 */
export function assessAnswerKeyRisk(
  problems: TestPrintProblem[],
): AnswerKeyRisk[] {
  const { answerSolutionsFull, solutionColumns, quickAnswerGap } =
    JASEUP_MEASURED_PX;
  const risks: AnswerKeyRisk[] = [];

  paginateAnswerKey(problems).forEach((page, pageIndex) => {
    // 1쪽에만 「빠른 정답」 상자가 얹힌다 — 그만큼 해설 칸이 좁다.
    const columnPx =
      pageIndex === 0
        ? answerSolutionsFull -
          quickAnswerBoxPx(problems.map((p) => p.answer)) -
          quickAnswerGap
        : answerSolutionsFull;

    let column = 0;
    let used = 0;
    const numbers: number[] = [];
    page.problems.forEach((problem, index) => {
      const height = estimateSolutionPx(problem.solution);
      // 단이 남았는데 안 들어가면 통째로 다음 단으로 간다(`break-inside: avoid`).
      if (used > 0 && used + height > columnPx) {
        column += 1;
        used = 0;
      }
      if (column >= solutionColumns) numbers.push(page.startingNumber + index);
      used += height;
    });

    if (numbers.length) risks.push({ page: pageIndex + 1, numbers });
  });

  return risks;
}
