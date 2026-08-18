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
