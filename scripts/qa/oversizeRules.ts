/**
 * 「어느 칸에도 안 들어가는 문항」을 **왜 긴지**로 가르는 규칙 (읽기 전용 · 순수 함수).
 *
 * 왜 별도 파일인가: 이 규칙은 보고서 생성기(`report-oversize-problems.ts`)와
 * 회귀 테스트가 **같은 것 하나**를 봐야 한다. 세는 쪽과 고치는 쪽이 각자 제 목록을
 * 손으로 들고 있으면 둘이 같이 눈이 먼다(CLAUDE.md 2026-08-18).
 *
 * ⚠️ **`미분류` 를 반드시 낸다.** 「무엇이 오염인지」를 미리 안다고 가정하면 목록에
 *    없는 부류는 구조적으로 0이 된다. 미분류를 눈으로 봐야 규칙이 자란다
 *    (CLAUDE.md 2026-08-18 그림 유실 판정에서 실제로 그렇게 4건을 더 건졌다).
 */

import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { UNKNOWN_FIGURE_HEIGHT_PX } from "../../src/lib/printOverflow";

/** 본문에서 읽어 내는 신호. 판정 근거를 «한 컬럼»이 아니라 여럿에서 모은다. */
export interface OversizeSignals {
  /** base64 로만 이뤄진 60자 이상 덩어리 수 (본문 오염). */
  base64Runs: number;
  /** base64 덩어리가 본문에서 차지하는 글자 비율. */
  base64Share: number;
  /** 「… 5. …」로 끝나는 **보기 한 벌**이 몇 벌인가. 둘 이상이면 문항이 둘 이상이다. */
  choiceSets: number;
  /** `[서술형 n]`·`[서답형 n]` 표시 수. */
  essayTags: number;
  /** `[3점]` 같은 배점 표시 수. 한 문항에 하나가 정상이다. */
  scoreTags: number;
  /** `[11~12]` 같은 **묶음 지시문** — 다음 문항들의 공통 발문이 딸려 온 자국. */
  bundleHeads: number;
  /** `2024년 1학기 중간고사 …중 3학년 수학` 같은 **시험지 머리말** 자국. */
  paperHeaders: number;
  /** 본문이 가리키는 `[그림]` 표시 수. */
  figureMarkers: number;
  /**
   * 본문이 그림을 **집어서 가리키는 라벨**이 몇 가지인가 — `㉠㉡㉢`·`(가)(나)`·`[그림]`.
   *
   * 왜 필요한가: 「그림이 몇 장이면 많다」는 **한 방향 임계값**이라 손상 쪽이 아니라
   * 판정 불가 쪽으로 민다. 실제로 그림 7장이 정상인 문항이 있었다
   * (구암고 21번 「그림 ㉠~㉦」 · 구암중 16번 「물병 4 + 그래프 4」). 장수만 보면
   * 그 둘이 해설 그림 20장짜리와 같은 칸에 들어간다.
   * **본문이 그만큼을 가리키고 있으면 그 그림들은 이 문항의 것**이다.
   */
  figureRefs: number;
}

const BASE64_RUN = /[A-Za-z0-9+/]{60,}={0,2}/g;
const CHOICE_SET = /(?:^|\n)\s*5\.\s/g;
const ESSAY_TAG = /\[\s*(?:서술형|서답형)/g;
const SCORE_TAG = /점\]/g;
/** `[11~12]`·`[$11$~$12$]` — 수식 기호가 끼어도 잡는다(PDF 텍스트 레이어라 흔하다). */
const BUNDLE_HEAD = /\[\s*\$?\d+\$?\s*~\s*\$?\d+\$?\s*\]/g;
/** 시험지 머리말 — 「2024년 1학기 중간고사」·「25년 2학기 중간고사 대비」 둘 다. */
const PAPER_HEADER = /\d{2,4}\s*년\s*\d\s*학기\s*(?:중간|기말)\s*고?사/g;
const FIGURE_MARKER = /\[그림\]/g;
/**
 * 그림을 집어서 가리키는 라벨. **서로 다른 것만** 센다 — 같은 `㉠` 이 발문과 항목에
 * 두 번 나오는 것은 그림 두 장이 아니다.
 * ⑴⑵⑶(하위문항)·①②③(보기 마커)는 **일부러 뺐다** — 그림 라벨이 아니다.
 */
const FIGURE_LABEL =
  /[㉠-㉭㈎-㈛]|\((?:가|나|다|라|마|바|사|아)\)|<그림\s*\$?\d+\$?>/g;

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;
const distinctCount = (text: string, re: RegExp): number =>
  new Set(text.match(re) ?? []).size;

export function readSignals(content: string): OversizeSignals {
  const runs = content.match(BASE64_RUN) ?? [];
  return {
    base64Runs: runs.length,
    base64Share: content.length
      ? runs.reduce((sum, r) => sum + r.length, 0) / content.length
      : 0,
    choiceSets: count(content, CHOICE_SET),
    essayTags: count(content, ESSAY_TAG),
    scoreTags: count(content, SCORE_TAG),
    bundleHeads: count(content, BUNDLE_HEAD),
    paperHeaders: count(content, PAPER_HEADER),
    figureMarkers: count(content, FIGURE_MARKER),
    figureRefs:
      count(content, FIGURE_MARKER) + distinctCount(content, FIGURE_LABEL),
  };
}

/**
 * 이 한 행에 문항이 **몇 개** 들어 있는가(추정).
 * 보기 한 벌·`[서술형 n]`·배점 표시가 각각 문항 하나를 가리킨다 — 셋 중 가장 큰 것을
 * 쓰고, 묶음 지시문이 있으면 그 뒤에 최소 하나가 더 붙어 있다는 뜻이다.
 */
export function estimateProblemCount(s: OversizeSignals): number {
  const byChoices = s.choiceSets;
  const byEssay = s.essayTags;
  const byScore = s.scoreTags;
  return Math.max(1, byChoices, byEssay, byScore) + (s.bundleHeads > 0 ? 1 : 0);
}

export type OversizeClass =
  | "본문 오염 — base64"
  | "문항 병합 — 시험지가 한 행에"
  | "꼬리 오염 — 옆 문항·머리말이 딸려 옴"
  | "그림 과수집 — 해설 그림까지 붙었다"
  | "그림이 지면을 먹는다 — 본문은 짧다"
  | "본문이 정말 길다"
  | "미분류";

export interface ClassifyInput {
  content: string;
  figureCount: number;
  /** 실측 — 그림 묶음이 먹은 세로. */
  figurePx: number;
  /** 실측 — 문항 전체 세로. */
  neededPx: number;
}

/**
 * 「그림이 많다」를 의심하기 시작하는 장수. 스키마 주석의 실측이
 * 「한 문항 최대 6장」(발문 1 + 보기 5)이다.
 *
 * ⚠️ **장수만으로 판정하지 않는다.** 이 값을 넘어도 본문이 그만큼을 가리키고 있으면
 *    (`figureRefs >= figureCount`) 그 그림들은 이 문항의 것이다. 장수만 보면
 *    「그림 ㉠~㉦」(7장 정상)과 「해설 벤다이어그램 20장」이 같은 칸에 들어간다 —
 *    한 방향 임계값은 손상을 «판정 불가» 쪽으로 민다(CLAUDE.md 2026-08-16).
 *    이 규칙은 전량 8건을 눈으로 봐서 맞췄다: 6건 과수집 · 2건 정상.
 */
export const FIGURE_COUNT_SANE_MAX = 6;

export function classifyOversize(input: ClassifyInput): {
  klass: OversizeClass;
  signals: OversizeSignals;
  problemCount: number;
} {
  const signals = readSignals(input.content);
  const problemCount = estimateProblemCount(signals);
  const figShare = input.neededPx > 0 ? input.figurePx / input.neededPx : 0;
  const bodyLength = input.content.length;

  const klass: OversizeClass = (() => {
    // ① 본문이 통째로 쓰레기 — 길이의 태반이 base64 다.
    if (signals.base64Runs > 0 && signals.base64Share >= 0.3)
      return "본문 오염 — base64";
    // ② 한 행에 문항이 셋 이상 — 시험지가 통째로 들어왔다.
    if (problemCount >= 3) return "문항 병합 — 시험지가 한 행에";
    // ③ 그림이 「발문 1 + 보기 5」보다 많은데 **본문이 그만큼을 가리키지 않는다**.
    if (
      input.figureCount > FIGURE_COUNT_SANE_MAX &&
      signals.figureRefs < input.figureCount
    )
      return "그림 과수집 — 해설 그림까지 붙었다";
    // ④ 문항은 하나인데 옆 것의 조각이 붙었다.
    if (
      problemCount === 2 ||
      signals.paperHeaders > 0 ||
      signals.bundleHeads > 0
    )
      return "꼬리 오염 — 옆 문항·머리말이 딸려 옴";
    /**
     * ⑤ 그림이 높이의 절반 넘게 먹는다 — 본문이 아니라 **그림이 문제**다.
     *    보기가 그림인 부류(발문 1 + 보기 5)와 큰 그림 한두 장을 **한 부류로 둔다** —
     *    장수로 가르면 3장/4장 사이에 뜻 없는 금이 생기는데, 처리 방안은 둘 다
     *    「지면이 그림을 어떻게 놓는가」로 같다. 장수는 보고서가 따로 센다.
     */
    if (input.figureCount >= 1 && figShare >= 0.5)
      return "그림이 지면을 먹는다 — 본문은 짧다";
    // ⑥ 그림이 아니라 글이 길다.
    if (bodyLength >= 450) return "본문이 정말 길다";
    return "미분류";
  })();

  return { klass, signals, problemCount };
}

/** 부류마다 **어디서** 다뤄야 하는가 — 보고서의 처리 방안 열. */
export const CLASS_REMEDY: Record<OversizeClass, string> = {
  "본문 오염 — base64": "데이터 수리 (덩어리 제거)",
  "문항 병합 — 시험지가 한 행에": "재이관 (완료본 HWP 재추출) 또는 폐기",
  "꼬리 오염 — 옆 문항·머리말이 딸려 옴": "데이터 수리 (꼬리 잘라 내기)",
  "그림 과수집 — 해설 그림까지 붙었다": "그림 정리 (해설 그림 떼기)",
  "그림이 지면을 먹는다 — 본문은 짧다": "지면 정책 (D-07) — 그림 다열·축소",
  "본문이 정말 길다": "지면 정책 (D-07) — 장당 1문항",
  미분류: "눈으로 볼 것",
};

/* ────────────────────────────────────────────────────────────────────────
 * 「그림 폭 상한을 줄이면 얼마나 낮아지는가」 — 지면 정책 값 계산
 * ──────────────────────────────────────────────────────────────────────── */

export interface FigureDim {
  width: number;
  height: number;
}

/**
 * 그림 묶음이 먹는 세로 — **폭 상한을 인자로 받는** 것 말고는 제품의
 * `estimateFigureBlockPx` 와 같은 규칙이다.
 *
 * ⚠️ 규칙을 옮겨 적었다. 그래서 보고서 생성기와 테스트가 **상한을 제품 값으로 두고**
 *    제품 함수와 전량 대조한다 — 한 건이라도 어긋나면 멈춘다. 옮겨 적은 규칙을
 *    대조 없이 쓰면 그 순간 두 자가 갈라진다(CLAUDE.md 2026-08-18 «자, 배선»).
 */
export function figureBlockPxAt(
  figures: readonly (FigureDim | null)[],
  capPx: number,
): number {
  if (figures.length === 0) return 0;
  const { problemColumn, figureGap, figureBlockTop } = JASEUP_MEASURED_PX;
  let total = figureBlockTop;
  let rowWidth = 0;
  let rowHeight = 0;
  let rows = 0;
  for (const figure of figures) {
    const scale = figure ? Math.min(1, capPx / figure.width) : 1;
    const width = figure ? figure.width * scale : capPx;
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
  return total + figureGap * (rows - 1);
}

/** 한 줄에 `k` 장을 놓으려면 폭 상한이 이 값 **이하**여야 한다. */
export function capForColumns(k: number): number {
  const { problemColumn, figureGap } = JASEUP_MEASURED_PX;
  return (problemColumn - figureGap * (k - 1)) / k;
}

export const MM_TO_PX = 96 / 25.4;
