/**
 * 🔴 RED → 🟢 그림 높이를 **판정이 볼 수 있게** 한다.
 *
 * ## 왜 이 테스트가 있는가
 *
 * 적대적 리뷰 ③(`docs/planning/tracks/reports/adv-print-review.md` §2)이 Chromium 실측으로
 * 밝힌 것: 넘치는 문항 2,725건 중 **2,557건(93.8%)이 그림 문항**인데
 * `estimateProblemLines(content)` 의 **인자에 그림이 아예 없었다.**
 * 인자에 없는 것은 임계값을 어떻게 옮겨도 안 잡힌다 — 한계를 14에서 8까지 내려도
 * 전수 재현율이 50%를 못 넘었다.
 *
 * 그래서 여기서 잠그는 것은 «임계값»이 아니라 **자**다:
 *   1. 인쇄 폭 상한(70mm)을 넘는 그림은 **비율대로 줄어든다.**
 *   2. 작은 그림은 안 늘어난다.
 *   3. 여러 장은 `flex-wrap` 대로 **줄바꿈**한다 (가로로 늘어놓다 넘치면 다음 줄).
 *   4. 치수를 모르면 **보수적 상수**로 센다 — 0으로 세지 않는다.
 *
 * ⚠️ 손상된 입력으로도 시험한다(CLAUDE.md 2026-08-16). 치수가 0·음수·NaN·짝이
 *    안 맞는 배열로 들어오면 «작은 그림»이 아니라 **모른다**로 받아야 한다 —
 *    0으로 세면 넘치는 문항일수록 조용해진다.
 */
import { describe, expect, it } from "vitest";

import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import {
  UNKNOWN_FIGURE_HEIGHT_PX,
  assessSeat,
  estimateFigureBlockPx,
  parseFigureDimensions,
} from "@/lib/printOverflow";

/**
 * ⚠️ 기대값을 **상수에서 만들지 않는다.** 예전에는 `figureMaxWidth` 등을 그대로
 *    읽어 기대값을 세워서, 상수를 264.567 → 363.5 로 망가뜨려도 **전부 초록**이었다
 *    (적대적 리뷰 ④ — 상수 29개 전수 변이 시험). 채점기가 제품 상수를 읽어
 *    동어반복이 되는 것과 같은 자리다. 여기서는 지면 실측 px 를 **리터럴**로 쓴다.
 */
/** `print:max-w-[70mm]` = 70mm × 96dpi / 25.4 (`printGeometryPin.test.ts` 가 잠근다). */
const FIGURE_MAX_WIDTH_PX = 264.5669291338583;
/** `gap-4` = 1rem. */
const FIGURE_GAP_PX = 16;
/** `mt-3` = 0.75rem. */
const FIGURE_BLOCK_TOP_PX = 12;

describe("[적대③-A] 그림 묶음의 지면 높이", () => {
  it("모형이 쓰는 상수가 이 리터럴과 같다 — 둘이 갈라지면 가드가 죽는다", () => {
    expect(JASEUP_MEASURED_PX.figureMaxWidth).toBeCloseTo(
      FIGURE_MAX_WIDTH_PX,
      3,
    );
    expect(JASEUP_MEASURED_PX.figureGap).toBe(FIGURE_GAP_PX);
    expect(JASEUP_MEASURED_PX.figureBlockTop).toBe(FIGURE_BLOCK_TOP_PX);
  });

  it("그림이 없으면 0px 이다 — 여백도 안 생긴다", () => {
    expect(estimateFigureBlockPx([])).toBe(0);
  });

  it("폭 상한(70mm)을 넘는 그림은 비율대로 줄어든다", () => {
    // 실데이터 `/figures/4729/hwp-q03.png` 598×688 → 인쇄 264.57×304.4
    const px = estimateFigureBlockPx([{ width: 598, height: 688 }]);
    expect(px).toBeCloseTo(
      FIGURE_BLOCK_TOP_PX + (688 * FIGURE_MAX_WIDTH_PX) / 598,
      1,
    );
  });

  it("상한보다 작은 그림은 **늘리지 않는다**", () => {
    const px = estimateFigureBlockPx([{ width: 100, height: 60 }]);
    expect(px).toBeCloseTo(FIGURE_BLOCK_TOP_PX + 60, 5);
  });

  it("나란히 놓이는 두 장은 **높은 쪽**만큼만 먹는다", () => {
    // 100 + 16 + 120 = 236px < 문항 열 363.5px → 한 줄
    const px = estimateFigureBlockPx([
      { width: 100, height: 60 },
      { width: 120, height: 90 },
    ]);
    expect(px).toBeCloseTo(FIGURE_BLOCK_TOP_PX + 90, 5);
  });

  it("한 줄에 안 들어가면 줄바꿈하고 **행 간격까지** 먹는다", () => {
    // 264.57 × 2 + 16 = 545px > 363.5px → 두 줄
    const tall = { width: 400, height: 400 }; // → 264.57 × 264.57
    const scaled = (400 * FIGURE_MAX_WIDTH_PX) / 400;
    const px = estimateFigureBlockPx([tall, tall]);
    expect(px).toBeCloseTo(FIGURE_BLOCK_TOP_PX + scaled * 2 + FIGURE_GAP_PX, 1);
  });

  it("치수를 모르는 그림은 보수적 상수로 센다 — **0이 아니다**", () => {
    expect(estimateFigureBlockPx([null])).toBeCloseTo(
      FIGURE_BLOCK_TOP_PX + UNKNOWN_FIGURE_HEIGHT_PX,
      5,
    );
  });
});

describe("[적대③-A] 손상된 치수는 «작은 그림»이 아니라 «모른다»다", () => {
  it("짝이 안 맞는 평탄 배열은 통째로 모른다로 받는다", () => {
    // 그림 2장인데 값이 3개 — 어느 쪽에 붙는지 알 수 없다.
    expect(parseFigureDimensions(2, [10, 20, 30])).toEqual([null, null]);
  });

  it("길이가 맞아도 0·음수·NaN 짝은 그 자리만 모른다로 받는다", () => {
    expect(parseFigureDimensions(3, [100, 60, 0, 40, -5, Number.NaN])).toEqual([
      { width: 100, height: 60 },
      null,
      null,
    ]);
  });

  it("치수가 아예 없으면 그림 수만큼 모른다다 — 그림이 사라지지 않는다", () => {
    expect(parseFigureDimensions(2, undefined)).toEqual([null, null]);
    expect(parseFigureDimensions(2, [])).toEqual([null, null]);
  });

  it("그림이 없으면 치수가 뭐가 들어와도 빈 배열이다", () => {
    expect(parseFigureDimensions(0, [1, 2, 3])).toEqual([]);
  });

  it("모른다 상수는 실측 중앙값(207px) 언저리다 — 0으로 수렴하지 않는다", () => {
    expect(UNKNOWN_FIGURE_HEIGHT_PX).toBeGreaterThan(
      JASEUP_MEASURED_PX.line * 5,
    );
  });
});

/**
 * 🔴 RED → 🟢 **물리 크기(mm)를 알면 mm 로 그린다** (그림 인쇄 크기 트랙).
 *
 * 오늘 규칙은 「넘치면 줄인다」뿐이라 **같은 삼각형이 문항마다 다른 크기**로 나간다
 * (원본 가로 41~7,343px). 원본 지면에서 그 그림이 차지하던 물리 폭을 알면 그걸 쓴다.
 * 근거: `docs/planning/tracks/figure-quality-brief.md` §9 · §14.
 *
 * ⚠️ 여기서도 기대값을 **상수에서 만들지 않는다.** mm→px 는 손으로 계산한 리터럴이다.
 */
/** 40mm × 96 / 25.4 */
const FORTY_MM_PX = 151.1811023622047;
/** 60mm × 96 / 25.4 */
const SIXTY_MM_PX = 226.77165354330708;

describe("[그림크기] 자가 mm 를 보면 mm 로 잰다", () => {
  it("mm 를 알면 픽셀을 무시하고 그 물리 크기로 잰다", () => {
    // 200×150px 인데 원본에서 40mm 였다 → 폭 151.18px, 높이는 비율대로.
    expect(
      estimateFigureBlockPx([{ width: 200, height: 150, sourceMm: 40 }]),
    ).toBeCloseTo(FIGURE_BLOCK_TOP_PX + (150 * FORTY_MM_PX) / 200, 6);
  });

  it("작은 그림이라도 원본이 컸으면 **키워서** 잰다 — 오늘은 못 하던 일이다", () => {
    // 100×100px(오늘은 100px 그대로 = 26mm) 인데 원본에서 60mm 였다.
    expect(
      estimateFigureBlockPx([{ width: 100, height: 100, sourceMm: 60 }]),
    ).toBeCloseTo(FIGURE_BLOCK_TOP_PX + SIXTY_MM_PX, 6);
  });

  it("mm 가 70을 넘으면 70mm 로 줄여서 잰다", () => {
    expect(
      estimateFigureBlockPx([{ width: 3000, height: 1500, sourceMm: 150 }]),
    ).toBeCloseTo(FIGURE_BLOCK_TOP_PX + (1500 * FIGURE_MAX_WIDTH_PX) / 3000, 6);
  });

  /** 🔴 이 트랙이 존재하는 이유. 픽셀이 4배 달라도 지면 크기는 같아야 한다. */
  it("원본 물리 크기가 같으면 픽셀이 달라도 **같은 크기**로 잰다", () => {
    const small = estimateFigureBlockPx([
      { width: 200, height: 150, sourceMm: 40 },
    ]);
    const big = estimateFigureBlockPx([
      { width: 800, height: 600, sourceMm: 40 },
    ]);
    expect(small).toBeCloseTo(big, 6);
  });

  it("mm 를 알면 나란히 놓이는 줄도 달라진다 — 자가 지면을 그대로 따라간다", () => {
    const pair = [
      { width: 800, height: 600, sourceMm: 40 },
      { width: 800, height: 600, sourceMm: 40 },
    ];
    // 151.18 + 16 + 151.18 = 318.4px < 문항 열 363.5px → **한 줄**
    expect(estimateFigureBlockPx(pair)).toBeCloseTo(
      FIGURE_BLOCK_TOP_PX + (600 * FORTY_MM_PX) / 800,
      6,
    );
    // mm 를 모르면 둘 다 264.57px 로 잘려 545px → **두 줄** (오늘 동작).
    const byPixels = estimateFigureBlockPx([
      { width: 800, height: 600 },
      { width: 800, height: 600 },
    ]);
    expect(byPixels).toBeGreaterThan(estimateFigureBlockPx(pair) * 3);
  });
});

describe("[그림크기] mm 를 모르면 **오늘 그대로** — 회귀 0", () => {
  /**
   * 2026-08-19 이전 규칙을 **그대로 옮겨 적은 사본**이다. 제품을 부르지 않는다 —
   * 부르면 동어반복이 된다(CLAUDE.md 2026-08-18 「지표의 «참»이 제품에서 오면 안 된다」).
   * 옛 코드: `const scale = figure ? Math.min(1, figureMaxWidth / figure.width) : 1;`
   */
  const frozenBlockPx = (
    figures: readonly ({ width: number; height: number } | null)[],
  ): number => {
    const problemColumn = 363.5;
    let total = FIGURE_BLOCK_TOP_PX;
    let rowWidth = 0;
    let rowHeight = 0;
    let rows = 0;
    for (const figure of figures) {
      const scale = figure
        ? Math.min(1, FIGURE_MAX_WIDTH_PX_FROZEN / figure.width)
        : 1;
      const width = figure ? figure.width * scale : FIGURE_MAX_WIDTH_PX_FROZEN;
      const height = figure ? figure.height * scale : UNKNOWN_FIGURE_HEIGHT_PX;
      const wouldBe = rowWidth === 0 ? width : rowWidth + FIGURE_GAP_PX + width;
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
    return total + FIGURE_GAP_PX * (rows - 1);
  };
  /** 실측 상수 그대로 — 옛 사본이 제품 상수를 읽지 않게 리터럴로 박는다. */
  const FIGURE_MAX_WIDTH_PX_FROZEN = 264.567;

  it("치수만 아는 그림은 옛 자와 **한 값**이다 (폭 20~3,000px 전수)", () => {
    const mismatches: string[] = [];
    for (let width = 20; width <= 3000; width += 7) {
      const figures = [{ width, height: Math.round(width * 0.72) + 13 }];
      const now = estimateFigureBlockPx(figures);
      const before = frozenBlockPx(figures);
      if (Math.abs(now - before) > 1e-9)
        mismatches.push(`${width}px: ${before} → ${now}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("여러 장·모르는 장이 섞여도 옛 자와 같다", () => {
    const cases = [
      [{ width: 100, height: 60 }, null],
      [null, null, null],
      [
        { width: 400, height: 400 },
        { width: 120, height: 90 },
      ],
      [
        { width: 41, height: 30 },
        { width: 7343, height: 4000 },
        { width: 425, height: 300 },
      ],
    ];
    for (const figures of cases)
      expect(estimateFigureBlockPx(figures)).toBeCloseTo(
        frozenBlockPx(figures),
        9,
      );
  });

  it("mm 배열이 손상돼도 **치수는 살아남는다** — 오늘 동작이 안 무너진다", () => {
    // 그림 2장인데 mm 이 1개 — mm 만 모르고 치수는 그대로다.
    expect(parseFigureDimensions(2, [100, 60, 200, 150], [40])).toEqual([
      { width: 100, height: 60 },
      { width: 200, height: 150 },
    ]);
  });

  it("mm 를 붙이면 치수 옆에 같이 실린다", () => {
    expect(parseFigureDimensions(2, [100, 60, 200, 150], [40, 62.5])).toEqual([
      { width: 100, height: 60, sourceMm: 40 },
      { width: 200, height: 150, sourceMm: 62.5 },
    ]);
  });

  it("손상된 mm 는 그 자리만 빠진다 — 성한 자리는 mm 로 그린다", () => {
    expect(parseFigureDimensions(2, [100, 60, 200, 150], [40, 0])).toEqual([
      { width: 100, height: 60, sourceMm: 40 },
      { width: 200, height: 150 },
    ]);
  });

  /**
   * 🔴 **치수를 모르면 mm 도 안 쓴다.** 자와 지면이 **같이** 모른다.
   *
   * 비율(치수)을 모르면 높이를 못 잰다. 그때 폭만 mm 로 좁혀 잡으면 그림 둘이 한 줄에
   * 들어가는 것으로 계산돼 **높이가 줄어든다** — 과소평가는 곧 놓침이고, 놓침은 겹쳐
   * 찍힌 시험지로 간다. 그리고 지면 컴포넌트도 같은 `parseFigureDimensions` 를
   * 부르므로 여기서 버리면 **양쪽이 같이** 오늘 그대로가 된다.
   */
  it("치수를 모르면 mm 가 있어도 통째로 모른다다", () => {
    expect(parseFigureDimensions(2, [1, 2, 3], [40, 50])).toEqual([null, null]);
    expect(parseFigureDimensions(1, [0, 0], [40])).toEqual([null]);
  });

  it("mm 인자를 안 주면 예전 두 인자 호출과 같다", () => {
    expect(parseFigureDimensions(2, [100, 60, 200, 150])).toEqual(
      parseFigureDimensions(2, [100, 60, 200, 150], undefined),
    );
  });
});

/**
 * 🔴 RED → 🟢 **판정이 문항에서 mm 를 읽는다.** 배선이 한쪽만 되면 그쪽 지표만
 * 좋아진다(CLAUDE.md 2026-08-18) — 규칙만 고치고 인자에 안 실으면 아무것도 안 바뀐다.
 */
describe("[그림크기] 넘침 판정이 문항의 mm 를 인자로 받는다", () => {
  const seat = (sourceMm?: number[]) =>
    assessSeat(
      {
        content: "그림과 같은 삼각형의 넓이를 구하시오.",
        figureUrls: ["/figures/1/q01.png"],
        figureDims: [800, 600],
        figureSourceMm: sourceMm,
      },
      484,
    );

  it("mm 를 실으면 그 크기로 잰다", () => {
    expect(seat([40]).figurePx).toBeCloseTo(
      FIGURE_BLOCK_TOP_PX + (600 * FORTY_MM_PX) / 800,
      6,
    );
  });

  it("mm 를 안 실으면 오늘 그대로다 — 회귀 0", () => {
    expect(seat().figurePx).toBeCloseTo(
      FIGURE_BLOCK_TOP_PX + (600 * FIGURE_MAX_WIDTH_PX) / 800,
      3,
    );
  });

  it("mm 가 크면 문항 높이도 커진다 — 판정까지 실제로 이어진다", () => {
    expect(seat([70]).lines).toBeGreaterThan(seat([20]).lines);
  });
});
