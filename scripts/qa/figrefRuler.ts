/**
 * **탐침 자** — 보기 그림을 격자로 놓는 시안의 세로 px 추정 (제품 코드 아님).
 *
 * 왜 필요한가: 조판을 바꾸면 `printOverflow.ts` 의 자가 **같이** 움직여야 한다.
 * 안 그러면 「출제는 골랐는데 인쇄 판정은 경고하는」 문항이 생긴다 — D-52 가 정확히
 * 그 원칙이다(`fit-select.md` §2: 한 규칙·한 숫자). 그런데 D-07 이라 제품 자를
 * 지금 고칠 수 없으므로, **고쳤을 때 자가 맞는지**를 여기서 먼저 재 본다.
 *
 * ## 제 손으로 다시 세지 않는다
 *
 * 발문·상자·수식 줄 수는 **제품 `estimateProblemPx` 를 그대로 부른다.** 옮겨 적으면
 * 그 순간 두 자가 갈린다. 이 파일이 새로 세는 것은 **보기 그림 격자 한 덩어리**뿐이다.
 *
 * ## 상수는 실측에서 온다
 *
 * 아래 값은 전부 `measure-figref-layout.tsx` 가 지면에서 잰 것이다(2026-08-18):
 * ```
 * | 시안 | 보기 칸 폭 | 마커 폭 | 그림칸 폭 | 마커 줄높이 |
 * | ㄱ-옆2   | 173.77 | 12.50 | 155.27 | 20.31 |
 * | ㄴ-옆3   | 110.52 | 12.50 |  92.02 | 20.31 |
 * | ㄷ-아래2 | 173.77 | 12.50 | 173.77 | 20.31 |
 * | ㄹ-아래3 | 110.52 | 12.50 | 110.52 | 20.31 |
 * ```
 * 칸 폭은 `(problemColumn − colGap×(cols−1)) / cols` 와 소수점까지 같다
 * (2열 173.75 · 3열 110.50). 그래서 **유도값을 쓰고, 실측과 다르면 멈춘다** —
 * 「참」이 제품 상수에서 나오지 않게 하려는 것이다(CLAUDE.md 2026-08-18).
 */
import {
  estimateProblemPx,
  UNKNOWN_FIGURE_HEIGHT_PX,
  type FigureDimension,
} from "../../src/lib/printOverflow";
import { JASEUP_MEASURED_PX } from "../../src/lib/printGeometry";
import { BODY_CHOICE_CLASS } from "../../src/lib/math/circledNumber";

/** 보기 그림 격자의 열 사이 간격 (탐침 CSS `column-gap: 16px`). */
export const CHOICE_FIG_COL_GAP = 16;
/** 마커(①) 글자 폭 — 실측 12.50px. */
export const CHOICE_MARK_WIDTH = 12.5;
/** 마커와 그림 사이 간격 (탐침 CSS `gap: 6px`). */
export const CHOICE_MARK_GAP = 6;
/** 「번호 아래」에서 마커 줄과 그림 사이 간격 (탐침 CSS `gap: 2px`). */
export const CHOICE_BELOW_GAP = 2;

export interface ChoiceGridOptions {
  cols: number;
  /** true = 번호 옆 · false = 번호 아래 */
  beside: boolean;
}

/** 보기 그림 한 칸에 실제로 주어지는 **그림 폭**. */
export function choiceFigureWidth(options: ChoiceGridOptions): number {
  const cell =
    (JASEUP_MEASURED_PX.problemColumn -
      CHOICE_FIG_COL_GAP * (options.cols - 1)) /
    options.cols;
  return options.beside ? cell - CHOICE_MARK_WIDTH - CHOICE_MARK_GAP : cell;
}

/**
 * 보기 그림 격자가 먹는 **세로 픽셀**.
 *
 * 지면 그대로의 모형이다: `display:grid` 라 **한 줄에 정확히 `cols` 장**이 들어가고
 * (flex-wrap 과 다르다 — 폭이 남아도 넷째가 안 올라온다), 줄 높이는 그 줄에서 가장
 * 높은 칸이다.
 */
export function choiceFigureBlockPx(
  figures: readonly (FigureDimension | null)[],
  options: ChoiceGridOptions,
): number {
  if (figures.length === 0) return 0;
  const { line, choiceGridTop, choiceRowGap, figureMaxWidth } =
    JASEUP_MEASURED_PX;
  const width = choiceFigureWidth(options);

  const cellHeights = figures.map((figure) => {
    // 치수를 모르는 그림은 «상한 폭 × 실측 중앙 높이» 짜리로 본다 — 판정이 이미 쓰는 값을
    // 그대로 쓰고, 좁은 칸에 맞춰 **같은 비율로** 줄인다. 여기서 새 «모른다»를 정하지 않는다.
    const w = figure ? figure.width : figureMaxWidth;
    const h = figure ? figure.height : UNKNOWN_FIGURE_HEIGHT_PX;
    const scaled = h * Math.min(1, width / w);
    return options.beside
      ? Math.max(line, scaled)
      : line + CHOICE_BELOW_GAP + scaled;
  });

  let total = choiceGridTop;
  const rows = Math.ceil(figures.length / options.cols);
  for (let row = 0; row < rows; row += 1)
    total += Math.max(
      ...cellHeights.slice(row * options.cols, (row + 1) * options.cols),
    );
  return total + choiceRowGap * (rows - 1);
}

/**
 * **원문**에서 `[그림]` 날 문자열만 걷어낸다.
 *
 * ⚠️ 파싱된 발문(`parseProblemContent(...).question`)을 자에 다시 넣으면 안 된다 —
 *    그 문자열은 상자가 이미 인용문 마크다운으로 굳은 상태라, `estimateProblemPx` 가
 *    한 번 더 파싱하면서 **상자 구조가 녹는다**. 실측으로 상자 문항 4건이 78~229px
 *    과소평가됐다(=놓침). 원문을 넣으면 그 4건이 전부 20px 안으로 들어온다.
 *
 * 표시만 지우면 보기 칸(`1. [그림]`)은 본문이 비어 `parseProblemContent` 가
 * **스스로 버린다**(빈 보기 filter). 그래서 글자가 남는 보기(실측 123건 중 5건)는
 * 그대로 세고, 그림뿐인 보기는 0으로 센다 — 자가 조판과 같은 것을 본다.
 */
/**
 * 표시를 지우고 나면 `1.`·`2.` 만 남은 **빈 보기 줄**이 생긴다. 그대로 두면
 * 파서가 그 글자를 발문에 흘리거나(실측 +16px) 마지막 하나를 보기로 세서(+36px)
 * 자가 조판보다 커진다. 조판은 그 줄을 안 그리므로 자도 지운다.
 *
 * ⚠️ 글자가 남는 보기(`5. 해당되는 그래프가 없다.`)는 **안 지운다** — 그건 실제로
 *    지면에 찍힌다(실측 123건 중 5건).
 */
// 본문 마커라 **일부러 좁다** — `circledNumber.ts` 한 곳에서 온다.
const EMPTY_CHOICE_LINE = new RegExp(
  String.raw`^[ \t]*(?:[1-9][0-9]?[.)]|[${BODY_CHOICE_CLASS}])[ \t]*$`,
);

export function stripFigureMarks(text: string): string {
  return text
    .replace(/\[그림\]/g, "")
    .split("\n")
    .filter((line) => !EMPTY_CHOICE_LINE.test(line))
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,)\]?!。，、])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface FigrefPlanDims {
  stem: (FigureDimension | null)[];
  choices: (FigureDimension | null)[];
}

/**
 * 보기 그림 조판을 쓴 문항의 세로 px.
 *
 * 발문 줄 수·상자·세로 수식·남은 글자 보기는 **제품 자**가 센다
 * (`estimateProblemPx`, 표시를 지운 **원문**을 넘긴다).
 * 여기서 더하는 것은 보기 그림 격자 하나뿐이다.
 */
export function estimateFigrefProblemPx(
  content: string,
  plan: FigrefPlanDims,
  options: ChoiceGridOptions,
): number {
  return (
    estimateProblemPx(stripFigureMarks(content), plan.stem) +
    choiceFigureBlockPx(plan.choices, options)
  );
}
