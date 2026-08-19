/**
 * 🔴 RED → 🟢 그림 인쇄 크기 — **픽셀이 아니라 물리 크기(mm)로 정한다.**
 *
 * ## 왜 이 파일이 있는가
 *
 * 지금 지면 규칙은 「픽셀 폭이 264.567(=70mm)을 넘으면 70mm 로 줄이고, 아니면 픽셀
 * 그대로(96dpi)」뿐이다. **「얼마로 그린다」가 없다.** 원본 가로 픽셀이 41~7,343px
 * (중앙 425)이라 **같은 삼각형이 문항마다 다른 크기**로 인쇄된다.
 * 근거: `docs/planning/tracks/figure-quality-brief.md` §9 · §14.
 *
 * 규격은 원본 지면에서 그 그림이 차지하던 물리 크기다:
 *   `인쇄 폭(mm) = min(70, 원본 rect 폭(pt) / 72 * 25.4)`
 *
 * ## 이 테스트가 잠그는 것
 *
 * 1. mm→CSS px 환산이 **한 곳**에 있다 (자와 지면이 같은 수를 쓴다).
 * 2. 상한(70mm)은 **mm 에서** 걸린다 — 픽셀에서 걸면 지면 CSS 와 갈라진다.
 * 3. **모르면 오늘 그대로다** — 회귀 0. 이게 이 트랙의 합격 조건이다.
 * 4. 손상된 입력은 «작은 그림»이 아니라 **«모른다»** 다 (CLAUDE.md 2026-08-16).
 *
 * ⚠️ 기대값을 **제품 상수에서 만들지 않는다.** 상수를 망가뜨려도 기대값이 같이
 *    움직이면 그 검사는 장식이다(적대적 리뷰 ④ — 상수 29개 중 9개가 그랬다).
 *    여기서는 손으로 계산한 **리터럴**을 쓴다.
 */
import { describe, expect, it } from "vitest";

import {
  FIGURE_MAX_WIDTH_MM,
  MAX_FIGURE_MM,
  MIN_FIGURE_MM,
  checkFigureSourceMm,
  figurePrintWidthMm,
  figurePrintWidthPx,
  figureWidthStyle,
  mmToCssPx,
  parseFigureSourceMm,
} from "@/lib/figurePrintSize";

/** 70mm × 96dpi / 25.4 — 손으로 계산한 값이다. */
const SEVENTY_MM_PX = 264.5669291338583;
/** 40mm × 96 / 25.4 */
const FORTY_MM_PX = 151.1811023622047;
/** 30mm × 96 / 25.4 */
const THIRTY_MM_PX = 113.38582677165354;

describe("[그림크기] mm → CSS px 는 한 곳에서만 환산한다", () => {
  it("1인치(25.4mm)가 CSS 96px 이다 — 인쇄 매체에서도 CSS px 는 96dpi 다", () => {
    expect(mmToCssPx(25.4)).toBeCloseTo(96, 10);
  });

  it("70mm 는 264.5669…px 이다", () => {
    expect(mmToCssPx(FIGURE_MAX_WIDTH_MM)).toBeCloseTo(SEVENTY_MM_PX, 6);
  });

  it("상한은 70mm 다 — 지면 CSS `print:max-w-[70mm]` 와 같은 수", () => {
    expect(FIGURE_MAX_WIDTH_MM).toBe(70);
  });
});

describe("[그림크기] 인쇄 폭은 **mm 에서** 상한이 걸린다", () => {
  it("상한 아래는 그 크기 그대로 그린다 — 이게 «얼마로 그린다» 다", () => {
    expect(figurePrintWidthMm(40)).toBe(40);
  });

  it("상한을 넘으면 70mm 다", () => {
    expect(figurePrintWidthMm(120)).toBe(70);
  });

  it("딱 70mm 는 그대로 70mm 다 — 경계에서 줄어들지 않는다", () => {
    expect(figurePrintWidthMm(70)).toBe(70);
  });
});

describe("[그림크기] 픽셀 폭 — mm 를 알면 mm 로, 모르면 **오늘 그대로**", () => {
  it("mm 를 모르면 원본 픽셀 그대로다 (상한 아래)", () => {
    expect(figurePrintWidthPx({ width: 100, height: 60 })).toBe(100);
  });

  it("mm 를 모르고 상한을 넘으면 264.567px 로 줄인다 — 2026-08-19 이전 동작", () => {
    expect(figurePrintWidthPx({ width: 598, height: 688 })).toBeCloseTo(
      264.567,
      3,
    );
  });

  it("mm 를 알면 **픽셀을 무시하고** 그 물리 크기로 그린다", () => {
    // 같은 40mm 짜리 그림이 200px 로도 800px 로도 잘려 있다 — 지면에서는 같아야 한다.
    expect(
      figurePrintWidthPx({ width: 200, height: 150, sourceMm: 40 }),
    ).toBeCloseTo(FORTY_MM_PX, 6);
    expect(
      figurePrintWidthPx({ width: 800, height: 600, sourceMm: 40 }),
    ).toBeCloseTo(FORTY_MM_PX, 6);
  });

  it("작은 픽셀이라도 원본이 컸으면 **키운다** — 300dpi 재크롭이 오면 여기가 갈린다", () => {
    // 지금 200px 인 그림(96dpi 로 작게 나감)이 원본에서 30mm 였다면 30mm 로 나가야 한다.
    expect(
      figurePrintWidthPx({ width: 200, height: 200, sourceMm: 30 }),
    ).toBeCloseTo(THIRTY_MM_PX, 6);
  });

  it("mm 가 상한을 넘으면 70mm 로 줄인다", () => {
    expect(
      figurePrintWidthPx({ width: 3000, height: 2000, sourceMm: 150 }),
    ).toBeCloseTo(SEVENTY_MM_PX, 6);
  });
});

describe("[그림크기] 지면이 쓰는 인라인 style — 자와 **같은 수**", () => {
  it("mm 를 모르면 style 을 아예 만들지 않는다 — 지면 마크업이 오늘 그대로다", () => {
    expect(figureWidthStyle(null)).toBeUndefined();
    expect(figureWidthStyle(undefined)).toBeUndefined();
  });

  it("mm 를 알면 `width: Xmm` 이다", () => {
    expect(figureWidthStyle(40)).toEqual({ width: "40.00mm" });
  });

  it("style 도 70mm 를 넘지 않는다 — 인라인이 `print:max-w-[70mm]` 를 이기기 때문", () => {
    // ⚠️ 인라인 style 은 Tailwind 를 이긴다. `max-width` 가 `width` 를 이기므로
    //    실제로는 CSS 상한이 살아 있지만, **한쪽만 믿지 않는다** — 값 자체를 자른다.
    expect(figureWidthStyle(120)).toEqual({ width: "70.00mm" });
  });

  it("style 의 mm 와 자의 px 가 **같은 그림**을 가리킨다", () => {
    const style = figureWidthStyle(40)!;
    const mm = Number(style.width.replace("mm", ""));
    expect(mmToCssPx(mm)).toBeCloseTo(
      figurePrintWidthPx({ width: 999, height: 999, sourceMm: 40 }),
      6,
    );
  });
});

describe("[그림크기] 손상된 mm 는 «작은 그림»이 아니라 «모른다»다", () => {
  it("짝이 안 맞는 배열은 통째로 모른다 — `figureDims` 와 같은 규약", () => {
    expect(parseFigureSourceMm(2, [40, 50, 60])).toEqual([null, null]);
  });

  it("아예 없으면 그림 수만큼 모른다다", () => {
    expect(parseFigureSourceMm(2, undefined)).toEqual([null, null]);
    expect(parseFigureSourceMm(2, [])).toEqual([null, null]);
  });

  it("그림이 없으면 빈 배열이다", () => {
    expect(parseFigureSourceMm(0, [40, 50])).toEqual([]);
  });

  it("0·음수·NaN·무한대는 그 자리만 모른다다", () => {
    expect(
      parseFigureSourceMm(4, [0, -3, Number.NaN, Number.POSITIVE_INFINITY]),
    ).toEqual([null, null, null, null]);
  });

  it("물리적으로 불가능한 값은 모른다다 — 1mm 미만·A4 폭(210mm) 초과", () => {
    expect(parseFigureSourceMm(4, [0.5, 1, 210, 210.5])).toEqual([
      null,
      1,
      210,
      null,
    ]);
  });

  it("**단위를 잘못 넣으면 걸린다** — 1/100mm 로 적어 보낸 7000 은 못 받는다", () => {
    // 이 컬럼은 «실수 mm» 다. 정수 1/100mm 규약과 헷갈려 7000 을 쓰면
    // 210mm 상한에 걸려 «모른다» 가 된다 — 그림이 조용히 70mm 로 나가지 않는다.
    expect(parseFigureSourceMm(1, [7000])).toEqual([null]);
  });

  it("숫자가 아닌 값도 모른다다 — JSON 대장이 문자열을 실어 올 수 있다", () => {
    // `"40"` 은 `>= 1 && <= 210` 을 **통과한다**(문자열이 수로 강제된다).
    // 그대로 흘리면 `figureWidthStyle` 의 `toFixed` 에서 터져 **인쇄 화면이 죽는다.**
    expect(parseFigureSourceMm(2, ["40", null] as unknown as number[])).toEqual(
      [null, null],
    );
  });

  it("성한 값과 손상된 값이 섞이면 **자리마다** 가른다", () => {
    expect(parseFigureSourceMm(3, [35.5, -1, 62])).toEqual([35.5, null, 62]);
  });

  it("경계 상수는 이 리터럴이다 — 옮기면 여기가 빨개진다", () => {
    expect(MIN_FIGURE_MM).toBe(1);
    expect(MAX_FIGURE_MM).toBe(210);
  });
});

describe("[그림크기] 적재는 엄격하게 — 읽기와 다른 정책이고 그게 의도다", () => {
  it("성한 배열은 통과한다", () => {
    expect(checkFigureSourceMm(2, [40, 62.5])).toEqual({
      ok: true,
      reason: "",
    });
  });

  it("빈 배열은 «틀렸다»가 아니라 «모른다»다 — 47,152행이 여기서 시작한다", () => {
    expect(checkFigureSourceMm(2, [])).toEqual({ ok: false, reason: "모른다" });
    expect(checkFigureSourceMm(2, undefined)).toEqual({
      ok: false,
      reason: "모른다",
    });
  });

  it("길이가 다르면 사유를 적어 돌려준다", () => {
    expect(checkFigureSourceMm(2, [40]).ok).toBe(false);
    expect(checkFigureSourceMm(2, [40]).reason).toContain("길이");
  });

  it("한 자리라도 손상되면 **배열째** 막는다 — 적재는 반쪽을 안 받는다", () => {
    const check = checkFigureSourceMm(2, [40, 0]);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("0");
  });
});
