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
import { figureWidthStyle } from "../../lib/figurePrintSize";

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

  it("mm 를 모르면 style 을 아예 안 만든다 — 2026-08-19 이전 지면 그대로", () => {
    const html = renderSlot(
      {
        id: "p1",
        content: "본문",
        figureUrls: [FIGURE],
        figureDims: [400, 300],
      },
      1,
    );
    expect(html).not.toContain('mm"');
    expect(html).toContain("<img");
  });
});
