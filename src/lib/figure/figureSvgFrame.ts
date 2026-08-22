/**
 * inline SVG 그림의 화면 폭.
 *
 * `sanitize_svg` 가 root `width`/`height`/`class` 를 버리므로 치수는
 * `viewBox` 밖에 없다. ProblemContent 는 큰 도형을 360px 까지 늘리는데,
 * 초등 그림의 viewBox 는 140~300 이라 발문(12.5px, 열 364px)을 압도한다.
 *
 * 문턱은 `/dev/cube-scrape` 실측 viewBox 폭:
 *   수 카드 136 · opBox 140 · sumBox 144 · 수 모형 152
 *   자릿값 202 · 각 229 · 상자연쇄 242 · 도형수 259 · 연산흐름 304
 * 원장님(2026-08-21): 본문 글자에 비해 크다. 위젯은 140, 중간 도형은 240.
 */
export const FIGURE_SVG_WIDE_MAX_PX = 360;
export const FIGURE_SVG_MID_MAX_PX = 240;
export const FIGURE_SVG_COMPACT_MAX_PX = 140;
export const FIGURE_SVG_COMPACT_VIEWBOX = 160;
export const FIGURE_SVG_MID_VIEWBOX = 320;

/**
 * 그래프 짝(`chartPair`) 전용 — **문항 열을 통째로** 쓴다 (D-70 계열, 원장님 확정 2026-08-23).
 *
 * 왜 등급을 더하나: 짝은 폭이 두 배(실측 405단위)라 `wide`(360px)에 넣으면 눈금 글자가
 * 12.44px 으로 **본문(12.5px) 아래**로 내려간다. 열 폭까지 주면 12.58px 로 조건을 지킨다.
 * 근거는 실측 `problemColumn` 363.5px(`printGeometry.ts`)과 그 지면 환산
 * 96.9mm(= 363.5 ÷ 3.75px/mm, `mid` 240px/64mm 에서 나온 배율).
 *
 * ⚠️ **이 두 수는 `scripts/figure/elem_advanced.py` 의 `PAIR_FRAME_PX`·`PAIR_FRAME_MM`
 *    과 반드시 같아야 한다** — 파이썬이 이 폭으로 「눈금 글자가 본문 이상인가」를 판정하고,
 *    실제로 그려지는 폭은 여기가 정한다. 어긋나면 **가드가 통과시킨 그림이 지면에서
 *    작아진다.** `elementaryFigure.test.ts` 가 두 파일의 숫자를 대조한다.
 *
 * 띠를 380 부터 잡은 이유: 지금 나오는 그림 중 가장 넓은 것이 336(`pills`)이라
 * **이 띠는 오늘 비어 있다** — 짝 말고는 등급이 안 바뀐다(실측 확인, 시험이 잠근다).
 */
export const FIGURE_SVG_PAIR_MAX_PX = 364;
export const FIGURE_SVG_PAIR_MM = 97;
export const FIGURE_SVG_PAIR_VIEWBOX = 380;

export type FigureSvgSize = "compact" | "mid" | "wide" | "pair";

const VIEWBOX_WH = /viewBox="0\s+0\s+([\d.]+)\s+([\d.]+)"/;

export function figureSvgViewBoxWidth(svg: string): number | null {
  const match = VIEWBOX_WH.exec(svg);
  if (!match) return null;
  const width = Number(match[1]);
  return Number.isFinite(width) && width > 0 ? width : null;
}

export function figureSvgSize(svg: string): FigureSvgSize {
  const width = figureSvgViewBoxWidth(svg);
  if (width === null) return "wide";
  if (width <= FIGURE_SVG_COMPACT_VIEWBOX) return "compact";
  if (width <= FIGURE_SVG_MID_VIEWBOX) return "mid";
  if (width > FIGURE_SVG_PAIR_VIEWBOX) return "pair";
  return "wide";
}

export function isCompactFigureSvg(svg: string): boolean {
  return figureSvgSize(svg) !== "wide";
}

const FRAME: Record<FigureSvgSize, string> = {
  compact:
    "mt-3 max-w-[140px] print:max-w-[37mm] [&>svg]:h-auto [&>svg]:w-full print:break-inside-avoid",
  mid: "mt-3 max-w-[240px] print:max-w-[64mm] [&>svg]:h-auto [&>svg]:w-full print:break-inside-avoid",
  wide: "mt-3 max-w-[360px] print:max-w-[70mm] [&>svg]:h-auto [&>svg]:w-full print:break-inside-avoid",
  // 짝은 문항 열을 통째로 쓴다 — 위 상수와 같은 수여야 한다(364px / 97mm).
  pair: "mt-3 max-w-[364px] print:max-w-[97mm] [&>svg]:h-auto [&>svg]:w-full print:break-inside-avoid",
};

export function figureSvgFrameClass(svg: string): string {
  return FRAME[figureSvgSize(svg)];
}
