/**
 * 그림의 **인쇄 크기** — 「얼마로 그린다」를 정하는 **한 곳**.
 *
 * ## 왜 이 파일이 생겼나
 *
 * 2026-08-19 이전 규칙은 「픽셀 폭이 264.567(=70mm)을 넘으면 70mm 로 줄이고, 아니면
 * 픽셀 그대로(96dpi)」뿐이었다. **넘치면 줄인다는 있는데 얼마로 그린다가 없다.**
 * 원본 가로 픽셀이 41~7,343px(중앙 425)이라 **같은 삼각형이 문항마다 다른 크기**로
 * 인쇄된다(`docs/planning/tracks/figure-quality-brief.md` §9).
 *
 * 원장님 지시(2026-08-19): 「모든 그림이나 도형 크기가 **일관성이 있어야** 하니까」.
 *
 * 규격 — 원본 지면에서 그 그림이 차지하던 물리 크기가 곧 출제자가 정한 크기다:
 *
 * ```
 * 인쇄 폭(mm) = min(70, 원본 rect 폭(pt) / 72 * 25.4)
 * ```
 *
 * ## 🔴 지금은 그 값을 아무도 안 들고 있다
 *
 * `figure-manifest.json` 에 `rect` 키가 **0건**이고 RPM 의 `source_coords` 는 발문
 * 상자다(같은 문서 §13). 그림 칸은 `map_exam()`·`figure_rect()` 가 런타임에 만들고
 * **버린다.** 그 값을 되찾는 일은 `그림벡터` 트랙이 맡는다
 * (산출물 `scripts/qa/reports/figure-rect-ledger.json`).
 *
 * **그래서 이 파일의 첫째 계약은 «모르면 오늘 그대로»다.** 값이 들어오기 전까지
 * 지면은 한 픽셀도 달라지면 안 된다(회귀 0). `sourceMm` 이 `null`/`undefined` 인
 * 경로가 2026-08-19 이전 동작 그대로인 것을 테스트가 잠근다.
 *
 * ## 🔴 자와 지면이 **같은 함수**를 부른다
 *
 * 인쇄 넘침 판정(`printOverflow.estimateFigureBlockPx`)과 지면 컴포넌트
 * (`ProblemContent`)가 둘 다 여기를 부른다. 규칙이 두 벌이 되면 한쪽만 옮겨도
 * 아무도 모른다 — 이 저장소가 실제로 그랬다(해설 자에만 「세로 수식」 항을 넣어
 * 문제지 쪽 과소평가가 17.6% 였다. CLAUDE.md 2026-08-18).
 */
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";

/**
 * 그림 한 장의 **원본 픽셀 치수**와, 알면 **원본 지면 물리 폭(mm)**.
 *
 * 둘은 **다른 근거**다 — 픽셀은 «비율», mm 는 «크기»를 안다. 파일에서 읽는 값과
 * 원본 PDF 에서 읽는 값이라 출처도 다르다. 그래서 한쪽만 알 수 있다.
 */
export interface FigureDimension {
  width: number;
  height: number;
  /**
   * 원본 지면에서 그 그림이 차지하던 **물리 폭(mm)**. 모르면 없다.
   *
   * ⚠️ 여기 담기는 것은 **원본 크기**이지 인쇄 폭이 아니다. 70mm 상한은 **제품
   *    정책**이라 `figurePrintWidthMm` 이 인쇄 시점에 건다. 측정값과 정책을 같은
   *    칸에 담으면, 정책이 바뀔 때 측정값이 이미 잘려 있어 되돌릴 수 없다.
   */
  sourceMm?: number;
}

/**
 * 인쇄 그림 폭 **상한(mm)**. 지면 CSS `print:max-w-[70mm]` 와 같은 수다 —
 * 둘이 갈라지면 `printGeometryPin.test.ts` 가 빨개진다.
 *
 * 상한을 **mm 에서** 거는 것이 요점이다. 픽셀에서 걸면 지면 CSS(mm)와 자(px)가
 * 서로 다른 지점에서 잘라 조용히 어긋난다.
 */
export const FIGURE_MAX_WIDTH_MM = 70;

/**
 * 물리 폭으로 받을 수 있는 범위.
 *
 * ⚠️ **이 둘은 실측 문턱이 아니다.** 원장으로 전량을 재 보니 가장 작은 그림은
 *    8.78mm 이고, 1mm 미만·210mm 초과는 **0장**이다. 그래도 1~210 을 유지한다 —
 *    「이 값이 흔한가」가 아니라 **「물리적으로 가능한가」** 만 본다:
 *      · 1mm 미만 — 300dpi 에서 12점(화면 4px)이다. 그림일 수 없다.
 *      · 210mm 초과 — A4 폭이다. 쪽 안의 그림이 쪽보다 넓을 수 없다.
 *
 *    좁게 잡으면 **진짜 작은 그림**(8.78mm 짜리 정육면체 삽화)을 버리게 된다.
 *    바닥값(최소 15mm 같은)은 제품 상수가 아니라 **원장님이 정하실 정책**이다.
 *
 * 덤으로 **단위 착오를 잡는다** — 이 컬럼을 1/100mm 정수로 오해해 7000 을 적어
 * 보내면 210 을 넘어 «모른다» 가 된다. 그림이 조용히 0.7mm 로 나가지 않는다.
 */
export const MIN_FIGURE_MM = 1;
export const MAX_FIGURE_MM = 210;

/** CSS 의 1인치는 인쇄 매체에서도 96px 다 (`print:max-w-[70mm]` 가 264.567px 인 근거). */
const CSS_PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

/** mm → CSS px. **환산은 여기 한 줄뿐이다.** */
export function mmToCssPx(mm: number): number {
  return (mm * CSS_PX_PER_INCH) / MM_PER_INCH;
}

/**
 * CSS px → mm. 옛 규칙이 그린 폭을 **사람이 읽는 단위**로 되돌릴 때만 쓴다
 * (전후 비교 화면이 「지금 몇 mm 로 나가나」를 적는 자리).
 *
 * ⚠️ 지면은 이 함수를 안 쓴다 — 옛 경로는 여전히 픽셀 그대로다. 96 을 두 곳이
 *    적어 두면 한쪽만 옮겨도 아무도 모르므로 여기 한 곳에 둔다.
 */
export function cssPxToMm(px: number): number {
  return (px * MM_PER_INCH) / CSS_PX_PER_INCH;
}

/** 값 하나가 물리 폭으로 말이 되는가. 적재와 읽기가 **같은 술어**를 쓴다. */
function isValidFigureMm(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_FIGURE_MM &&
    value <= MAX_FIGURE_MM
  );
}

export interface FigureSourceMmCheck {
  ok: boolean;
  /** 왜 못 받는지. `ok` 면 빈 문자열. */
  reason: string;
}

/**
 * **적재 쪽** 검사 — 한 자리라도 손상되면 배열째 막는다.
 *
 * 읽기(`parseFigureSourceMm`)는 자리마다 가르는데 적재는 통째로 막는 것이
 * 의도다: 읽기는 「모르는 자리는 오늘 그대로」로 안전하게 미끄러지지만, 적재는
 * 손상된 값을 **공유 DB 에 굳힌다.** 굳기 전에 멈추는 쪽이 싸다.
 * (`checkChoiceFigureIndex` 와 같은 꼴 — 부르는 쪽이 「고쳐야 할 것」과
 * 「아직 없는 것」을 갈라 볼 수 있어야 한다.)
 */
export function checkFigureSourceMm(
  figureCount: number,
  flat: readonly number[] | null | undefined,
): FigureSourceMmCheck {
  if (!flat || flat.length === 0) return { ok: false, reason: "모른다" };
  if (flat.length !== figureCount)
    return {
      ok: false,
      reason: `길이가 다르다 (그림 ${figureCount}장 · 배열 ${flat.length})`,
    };
  for (const value of flat) {
    if (!isValidFigureMm(value))
      return {
        ok: false,
        reason: `물리 폭으로 받을 수 없는 값이다 (${value}) — ${MIN_FIGURE_MM}~${MAX_FIGURE_MM}mm`,
      };
  }
  return { ok: true, reason: "" };
}

/**
 * `figureUrls` 와 같은 길이로 편다. **모르는 자리는 `null`** 이다.
 *
 * `parseFigureDimensions`(printOverflow.ts)와 **같은 규약**이다:
 *   · 길이가 안 맞으면 어느 그림에 붙는지 알 수 없으므로 **통째로** 모른다
 *   · 길이는 맞는데 값이 손상됐으면 **그 자리만** 모른다
 *
 * 모르는 자리는 지면에서 «오늘 그대로»가 된다 — 그게 안전한 미끄러짐이다.
 */
export function parseFigureSourceMm(
  figureCount: number,
  flat: readonly number[] | null | undefined,
): (number | null)[] {
  if (figureCount <= 0) return [];
  const unknown = (): (number | null)[] =>
    Array.from({ length: figureCount }, () => null);
  if (!flat || flat.length !== figureCount) return unknown();

  return Array.from({ length: figureCount }, (_, index) => {
    const value = flat[index]!;
    return isValidFigureMm(value) ? value : null;
  });
}

/**
 * DB 의 평탄 배열(`problem.figure_dims` = `[w1,h1,w2,h2,…]`)을 그림 수에 맞춰 짝짓고,
 * 알면 `problem.figure_source_mm`(같은 순서·같은 길이)을 옆에 싣는다.
 *
 * ⚠️ **손상된 입력은 «작은 그림»이 아니라 «모른다»로 받는다.** 길이가 안 맞으면
 *    어느 그림에 붙는 값인지 알 수 없으므로 전부 `null` 이다. 짝은 맞는데 값이
 *    0·음수·NaN 이면 그 자리만 `null` 이다. 여기서 0을 그대로 흘리면 넘치는
 *    문항이 «높이 0» 으로 읽힌다(CLAUDE.md 2026-08-16).
 *
 * ## 두 배열은 서로를 무너뜨리지 않는다
 *
 * · **mm 이 손상돼도 치수는 살아남는다** → 그 그림은 오늘 그대로 픽셀로 나간다(회귀 0).
 * · **치수를 모르면 mm 도 버린다** → 비율을 모르면 높이를 못 재는데, 폭만 mm 로 좁혀
 *   잡으면 그림 둘이 한 줄에 들어가는 것으로 계산돼 **높이가 줄어든다.** 과소평가는
 *   곧 놓침이고, 놓침은 겹쳐 찍힌 시험지로 간다.
 *
 * ## 🔴 자와 지면이 **이 함수 하나**를 부른다
 *
 * 넘침 판정(`printOverflow`)과 지면 컴포넌트(`ProblemContent`)가 둘 다 여기를 거친다.
 * 그래서 「어느 그림이 mm 를 쓰는가」가 두 벌이 될 수 없다 — 한쪽만 mm 로 그리면
 * 자가 재는 지면과 실제 지면이 갈라지는데, 그건 아무도 모르게 어긋난다.
 */
export function parseFigureDimensions(
  figureCount: number,
  flat: readonly number[] | null | undefined,
  sourceMmFlat?: readonly number[] | null,
): (FigureDimension | null)[] {
  if (figureCount <= 0) return [];
  const unknown = (): (FigureDimension | null)[] =>
    Array.from({ length: figureCount }, () => null);
  if (!flat || flat.length !== figureCount * 2) return unknown();

  const sourceMm = parseFigureSourceMm(figureCount, sourceMmFlat);

  return Array.from({ length: figureCount }, (_, index) => {
    const width = flat[index * 2]!;
    const height = flat[index * 2 + 1]!;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    const mm = sourceMm[index];
    return mm == null ? { width, height } : { width, height, sourceMm: mm };
  });
}

/**
 * 지면에 실제로 그리는 폭(mm) — **정책이 걸리는 한 지점.**
 *
 * 원본이 상한보다 넓으면 70mm 로 줄인다. 원본이 좁으면 **그 크기 그대로** 그린다 —
 * 이게 「얼마로 그린다」이고, 오늘 규칙에 없던 부분이다.
 */
export function figurePrintWidthMm(sourceMm: number): number {
  return Math.min(sourceMm, FIGURE_MAX_WIDTH_MM);
}

/**
 * 그림 한 장이 지면에서 차지하는 **가로 CSS px** — 자(`estimateFigureBlockPx`)가 쓴다.
 *
 * ⚠️ `sourceMm` 이 없는 경로는 **2026-08-19 이전과 한 글자도 다르지 않다.**
 *    `Math.min(원본 픽셀, JASEUP_MEASURED_PX.figureMaxWidth)` 그대로다 — 상한 px 도
 *    새로 계산하지 않고 실측 상수를 그대로 읽는다. 회귀 0 이 이 트랙의 합격 조건이다.
 */
export function figurePrintWidthPx(figure: FigureDimension): number {
  if (figure.sourceMm == null)
    return Math.min(figure.width, JASEUP_MEASURED_PX.figureMaxWidth);
  return mmToCssPx(figurePrintWidthMm(figure.sourceMm));
}

/**
 * 지면 컴포넌트가 `<img>` 에 붙이는 인라인 style — **자와 같은 수**에서 나온다.
 *
 * ⚠️ **인라인 style 은 Tailwind 를 이긴다.** 예전에 카드 폭을 인라인으로 박았다가
 *    `print:w-auto` 가 죽어 인쇄가 깨진 적이 있다. 여기서는
 *    (1) `mm` 를 모르면 **style 을 아예 만들지 않고**(마크업이 오늘 그대로),
 *    (2) 만들 때도 값 자체를 70mm 로 잘라 **CSS 상한 한쪽만 믿지 않는다.**
 *    (`max-width` 가 `width` 를 이기므로 CSS 상한도 여전히 살아 있다 — 이중이다.)
 *
 * 소수 둘째 자리까지만 적는다. 0.01mm 는 300dpi 에서 0.12점이라 지면에서 뜻이 없고,
 * 부동소수 꼬리가 마크업에 그대로 찍히면 스냅숏이 헛되이 흔들린다.
 */
export function figureWidthStyle(
  sourceMm: number | null | undefined,
): { width: string } | undefined {
  if (sourceMm == null) return undefined;
  return { width: `${figurePrintWidthMm(sourceMm).toFixed(2)}mm` };
}
