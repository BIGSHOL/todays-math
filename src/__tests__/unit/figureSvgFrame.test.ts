import { describe, expect, it } from "vitest";

import {
  FIGURE_SVG_COMPACT_VIEWBOX,
  FIGURE_SVG_MID_VIEWBOX,
  figureSvgFrameClass,
  figureSvgSize,
} from "@/lib/figure/figureSvgFrame";

const svg = (w: number, h = 80) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;

describe("[figureSvgFrame] 초등 그림은 발문에 맞춰 줄인다", () => {
  it("수 카드·연산 상자는 140", () => {
    expect(figureSvgSize(svg(136))).toBe("compact");
    expect(figureSvgSize(svg(140))).toBe("compact");
    expect(figureSvgSize(svg(144))).toBe("compact");
    expect(figureSvgFrameClass(svg(140))).toContain("max-w-[140px]");
  });

  it("상자 연쇄·각·연산 흐름은 240 — 360 으로 늘리지 않는다", () => {
    expect(figureSvgSize(svg(229))).toBe("mid");
    expect(figureSvgSize(svg(242))).toBe("mid");
    expect(figureSvgSize(svg(304))).toBe("mid");
    expect(figureSvgFrameClass(svg(242))).toContain("max-w-[240px]");
    expect(figureSvgFrameClass(svg(242))).not.toContain("max-w-[360px]");
  });

  it("문턱을 넘기면 다음 칸으로 간다", () => {
    expect(figureSvgSize(svg(FIGURE_SVG_COMPACT_VIEWBOX))).toBe("compact");
    expect(figureSvgSize(svg(FIGURE_SVG_COMPACT_VIEWBOX + 1))).toBe("mid");
    expect(figureSvgSize(svg(FIGURE_SVG_MID_VIEWBOX))).toBe("mid");
    expect(figureSvgSize(svg(FIGURE_SVG_MID_VIEWBOX + 1))).toBe("wide");
  });
});
