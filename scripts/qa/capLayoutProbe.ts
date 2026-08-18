/**
 * **그림 폭 상한**을 탐침 지면에만 덧입히는 CSS — 재는 쪽·찍는 쪽이 같은 문자열을 본다.
 *
 * ⚠️ 제품 CSS 는 한 글자도 안 바꾼다. `ProblemContent` 의 `print:max-w-[70mm]` 를
 *    탐침 문서 뒤 `<style>` 로 덮어쓸 뿐이다(`shot-figure-cap.tsx` 와 같은 방식).
 *
 * ⚠️ **46mm 로 적으면 정책이 통째로 무효가 된다** — 두 장이 `173.86×2+16 = 363.72px`
 *    로 문항 열(363.5px)을 0.22px 넘어 한 장씩 접힌다
 *    (`oversize-problems.md` §3). mm 로 적을 때는 **45mm / 29mm** 로 여유를 둘 것.
 */

/** mm → px (96dpi). */
export const mmToPx = (mm: number) => (mm * 96) / 25.4;

export interface FigureCap {
  name: string;
  label: string;
  css: string;
  /**
   * 그림 장수별로 **브라우저에서 되읽어 대조할** 폭 상한(px).
   * 덧칠이 안 먹으면 이 조건은 기준선과 똑같이 그려지고 「내려갔다」가 거짓이 된다.
   */
  expectedMaxWidthPx: (figureCount: number) => number;
}

const uniform = (mm: number): FigureCap => ({
  name: `cap${mm}`,
  label:
    mm === 70
      ? "70mm — 지금 지면 그대로 (`print:max-w-[70mm]`)"
      : `${mm}mm — 그림 폭 상한을 ${mm}mm 로 (장수와 무관하게 늘)`,
  css: `@media print{[data-paper-view] .figureRow img{max-width:${mm}mm !important}}`,
  expectedMaxWidthPx: () => mmToPx(mm),
});

/**
 * `oversize-problems.md` §3 **권고안** — 「2장+ → 2열 · 5장+ → 3열」.
 * 한 장짜리 문항은 상한을 그대로 두므로 **발문 그림 하나짜리는 지금과 똑같이 나온다.**
 * (`:has()` 로 그림 장수를 세므로 제품 마크업을 안 건드린다.)
 */
const POLICY: FigureCap = {
  name: "policy",
  label: "권고안 — 1장 70mm · 2~4장 45mm(2열) · 5장+ 29mm(3열)",
  css: `@media print{
  [data-paper-view] .figureRow img{max-width:70mm !important}
  [data-paper-view] .figureRow:has(img:nth-of-type(2)) img{max-width:45mm !important}
  [data-paper-view] .figureRow:has(img:nth-of-type(5)) img{max-width:29mm !important}
}`,
  expectedMaxWidthPx: (n) => mmToPx(n >= 5 ? 29 : n >= 2 ? 45 : 70),
};

/**
 * **권고안 + 1장짜리 축소** — 1장 55mm · 2~4장 45mm(2열) · 5장+ 29mm(3열).
 *
 * 왜 이 조합인가: 권고안(다열)은 「어느 칸에도 안 들어가는 문항」을 없애지만
 * **분포는 거의 안 민다**(풀의 그림 문항 93.5%가 1장짜리라 손을 안 대기 때문).
 * 반대로 1장짜리 상한만 낮추면 분포는 밀리지만 다열이 안 돼서 큰 문항이 남는다.
 * 둘은 **겨냥하는 것이 다르므로** 겹쳐 쓸 수 있다.
 */
const POLICY55: FigureCap = {
  name: "policy55",
  label: "권고안+축소 — 1장 55mm · 2~4장 45mm(2열) · 5장+ 29mm(3열)",
  css: `@media print{
  [data-paper-view] .figureRow img{max-width:55mm !important}
  [data-paper-view] .figureRow:has(img:nth-of-type(2)) img{max-width:45mm !important}
  [data-paper-view] .figureRow:has(img:nth-of-type(5)) img{max-width:29mm !important}
}`,
  expectedMaxWidthPx: (n) => mmToPx(n >= 5 ? 29 : n >= 2 ? 45 : 55),
};

export const FIGURE_CAPS: FigureCap[] = [
  uniform(70),
  /**
   * 55mm — **다열이 안 되는 중간값.** 두 장이 `207.9×2 + 16 = 431.7px` 라 문항 열
   * (363.5px)을 넘어 여전히 한 줄에 한 장이다. 그래서 이 상한이 버는 것은 오직
   * **그림 자체가 작아져서**다. 45mm 의 이득 중 얼마가 「다열」이고 얼마가 「축소」인지
   * 가르려고 둔다 — 그 둘은 잃는 것이 다르다(다열은 안 잃고, 축소는 읽힘을 잃는다).
   */
  uniform(55),
  uniform(45),
  uniform(29),
  POLICY,
  POLICY55,
];

export function capByName(name: string): FigureCap {
  const found = FIGURE_CAPS.find((c) => c.name === name);
  if (!found)
    throw new Error(
      `모르는 그림 상한이다: ${name} (${FIGURE_CAPS.map((c) => c.name).join(", ")})`,
    );
  return found;
}

/**
 * 그림 묶음 `<div>` 에 표식(`figureRow`)만 붙인다 — 제품 컴포넌트는 안 건드린다.
 * `ProblemContent` 가 내는 클래스 문자열과 **한 글자라도 다르면** 표식이 안 붙고,
 * 그러면 덧칠이 아무것도 안 걸린 채 「상한을 낮췄다」가 된다. 그래서 붙은 개수를
 * 부르는 쪽이 반드시 센다(가드 ④).
 */
export const FIGURE_ROW_MARKER =
  '<div class="mt-3 flex flex-wrap items-start gap-4';

export function markFigureRows(html: string): string {
  return html
    .split(FIGURE_ROW_MARKER)
    .join('<div class="figureRow mt-3 flex flex-wrap items-start gap-4');
}
