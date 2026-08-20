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

export type FigureSvgSize = "compact" | "mid" | "wide";

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
};

export function figureSvgFrameClass(svg: string): string {
  return FRAME[figureSvgSize(svg)];
}
