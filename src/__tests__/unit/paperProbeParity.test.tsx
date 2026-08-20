/**
 * 🔴 **자가 재는 지면 == 제품이 찍는 지면.**
 *
 * ## 왜 이 파일이 있는가
 *
 * 넘침 재현율의 분모는 높이 캐시(`.measure/cont.json`)이고, 그 캐시는
 * `paperProbe.renderSlot` 이 그린 지면을 Chromium 으로 재서 만든다. 그러니
 * **탐침이 제품과 다른 지면을 그리면 그 캐시가 통째로 딴 것을 잰다.**
 *
 * 2026-08-20 에 실제로 그랬다: 제품 인쇄 경로(`ProblemBody` → `PaperProblemView`)는
 * `figureDims`·`figureSourceMm` 을 넘겨 그림 폭을 **mm 로 못 박는데**, 탐침은 그 둘을
 * **아예 안 넘겼다.** 그래서 탐침에서는 모든 그림이 `w-auto max-w-[70mm]`,
 * 곧 **원본 픽셀 크기**로 그려졌다. 300dpi 재크롭본으로 갈아 끼운 그림 1,249문항을
 * 다시 재 보니 519건(41.6%)의 높이가 −313 ~ +661px 달랐다 — 제품 지면에서는
 * 폭이 mm 로 고정돼 있어 그만큼 움직이지 않는다.
 *
 * 이 저장소가 여러 번 적은 자리다: 「제품 함수를 그대로 부른다」는 절반만 옳고,
 * **그 함수에 넣는 입력도 조판과 같아야 한다**(CLAUDE.md 2026-08-18).
 */
import { describe, expect, it } from "vitest";

import { renderSlot } from "../../../scripts/qa/paperProbe";
import { fallbackSourceMm, figureWidthStyle } from "../../lib/figurePrintSize";

const FIGURE = "/figures/probe/x.png";

describe("탐침 지면이 제품 지면과 같은 것을 그린다", () => {
  it("mm 를 알면 그림 폭을 mm 로 못 박는다 — 제품과 같은 값으로", () => {
    const html = renderSlot(
      {
        id: "p1",
        content: "다음 그림에서 $x$ 의 값을 구하시오.",
        figureUrls: [FIGURE],
        figureDims: [400, 300],
        figureSourceMm: [42],
      },
      1,
    );
    const expected = figureWidthStyle(42)!.width;
    expect(expected).toBe("42.00mm");
    expect(html).toContain(`width:${expected}`);
  });

  it("70mm 상한은 제품과 같은 함수가 건다", () => {
    const html = renderSlot(
      {
        id: "p1",
        content: "본문",
        figureUrls: [FIGURE],
        figureDims: [400, 300],
        figureSourceMm: [200],
      },
      1,
    );
    expect(html).toContain(`width:${figureWidthStyle(200)!.width}`);
    expect(html).toContain("width:70.00mm");
  });

  it("mm 를 몰라도 탐침과 제품이 **같은 폭**을 그린다 — 픽셀에서 환산", () => {
    // 2026-08-20 에 「모르면 상한(70mm)」이 「모르면 픽셀에서 환산」으로 바뀌었다.
    // 여기서 지키는 것은 그 규칙 자체가 아니라 **탐침이 제품과 같다**는 것이다 —
    // 갈라지면 높이 캐시가 딴 지면을 재고, 그건 아무도 모르게 어긋난다.
    const html = renderSlot(
      {
        id: "p1",
        content: "본문",
        figureUrls: [FIGURE],
        figureDims: [400, 300],
      },
      1,
    );
    const expected = figureWidthStyle(fallbackSourceMm(400, FIGURE))!.width;
    expect(html).toContain(`width:${expected}`);
    expect(html).toContain("<img");
    // 🔴 상한을 그대로 박은 것이 아니어야 한다 — 그러면 옛 동작과 못 가른다.
    expect(expected).not.toBe("70.00mm");
  });
});
