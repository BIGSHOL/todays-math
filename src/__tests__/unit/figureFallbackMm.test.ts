/**
 * 🟢 mm 를 **모를 때** 그림을 얼마로 그리나 — 「모르면 최대」를 고친 자리.
 *
 * 예전 기본값은 상한(70mm), 곧 **최대 크기**였다. 그런데 mm 를 아는 8,549자리의
 * 인쇄 폭 중앙은 47.3mm 이고 상한에 걸린 것은 14.5% 뿐이다 — 즉 «모르는 것»이
 * «아는 것의 85%»보다 크게 그려지고 있었다. 크기 일관성이 목표인데 정반대다.
 * 원장님이 종이에서 「그림이 너무 거대해」로 찾아 주셨다(2026-08-20).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FALLBACK_DPI,
  FALLBACK_MIN_MM,
  FIGURE_MAX_WIDTH_MM,
  fallbackSourceMm,
  figureFallbackDpi,
  parseFigureDimensions,
} from "../../lib/figurePrintSize";

describe("벡터냐 스캔이냐 — 경로가 가른다", () => {
  it.each([
    ["/figures/rpm/019fd1d7-abc/0.png", FALLBACK_DPI.vector],
    ["/figures-svg/rpm/019fd1d7-abc/0.svg", FALLBACK_DPI.vector],
    ["/figures/3635/pdf-q17.png", FALLBACK_DPI.scan],
    ["/figures/4086/hwp-q20.png", FALLBACK_DPI.scan],
  ])("%s → %idpi", (url, dpi) => {
    expect(figureFallbackDpi(url)).toBe(dpi);
  });

  it("경로를 모르면 스캔으로 본다 — 기출이 훨씬 많다", () => {
    expect(figureFallbackDpi(undefined)).toBe(FALLBACK_DPI.scan);
  });
});

describe("환산 폭", () => {
  it("스캔본 394px(중앙) 은 대략 40mm 대다 — 아는 값의 중앙과 같은 자리", () => {
    const mm = fallbackSourceMm(394, "/figures/3635/a.png");
    expect(mm).toBeGreaterThan(35);
    expect(mm).toBeLessThan(50);
  });

  it("RPM 은 72dpi 로 환산한다 — PDF 점 단위다", () => {
    // 200pt = 200/72 inch = 70.6mm → 상한에 걸린다.
    expect(fallbackSourceMm(200, "/figures/rpm/x/0.png")).toBe(
      FIGURE_MAX_WIDTH_MM,
    );
    expect(fallbackSourceMm(100, "/figures/rpm/x/0.png")).toBeCloseTo(35.3, 0);
  });

  it("🔴 상한을 넘지 않는다", () => {
    expect(fallbackSourceMm(99999, "/figures/1/a.png")).toBe(
      FIGURE_MAX_WIDTH_MM,
    );
  });

  it("🔴 바닥 아래로 안 내려간다 — 그 아래는 종이에서 못 읽는다", () => {
    expect(fallbackSourceMm(3, "/figures/1/a.png")).toBe(FALLBACK_MIN_MM);
  });
});

describe("mm 를 아는 자리는 **안 건드린다**", () => {
  it("아는 값이 있으면 그 값 그대로", () => {
    const got = parseFigureDimensions(
      1,
      [400, 300],
      [22.5],
      ["/figures/1/a.png"],
    );
    expect(got[0]).toEqual({ width: 400, height: 300, sourceMm: 22.5 });
  });

  it("🔴 경로를 안 주면 **예전 그대로** «모른다» 다 — 부르는 쪽을 한꺼번에 안 고쳐도 된다", () => {
    const got = parseFigureDimensions(1, [400, 300], null);
    expect(got[0]).toEqual({ width: 400, height: 300 });
  });

  it("경로를 주면 모르는 자리를 환산한다", () => {
    const got = parseFigureDimensions(1, [400, 300], null, [
      "/figures/1/a.png",
    ]);
    expect(got[0]?.sourceMm).toBeCloseTo((400 / 253) * 25.4, 3);
  });
});

describe("🔴 조판과 자가 **같은 인자**를 넘긴다", () => {
  /**
   * 경로를 한쪽만 넘기면 그림 폭이 갈라진다 — 지면은 새 크기로 그리는데 자는
   * 옛 크기로 재거나 그 반대다. **갈라진 것은 아무도 못 본다**(지면이 멀쩡해 보인다).
   * 그래서 두 원문을 읽어 넷째 인자가 둘 다 있는지 센다.
   */
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf-8");

  /**
   * 🔴 「낱말이 들어 있나」로 세면 안 된다. `figures.length` 안에도 `figures` 가
   *    있어서, 넷째 인자를 지워도 `toContain("figures")` 가 초록이었다
   *    (2026-08-20 변이 시험에서 실제로 그랬다 — 2026-08-18 「LOOP 가 있나」와 같은 자리).
   *    그래서 **인자 개수**를 센다.
   */
  const args = (src: string, fn: string): string[] => {
    const i = src.indexOf(fn + "(");
    if (i < 0) return [];
    let depth = 0;
    let cur = "";
    const out: string[] = [];
    for (let k = i + fn.length; k < src.length; k++) {
      const c = src[k]!;
      if (c === "(") {
        depth++;
        if (depth === 1) continue;
      }
      if (c === ")") {
        depth--;
        if (depth === 0) {
          out.push(cur.trim());
          break;
        }
      }
      if (c === "," && depth === 1) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += c;
    }
    return out.filter((a) => a !== "");
  };

  it("ProblemContent 가 그림 **경로**를 넷째 인자로 넘긴다", () => {
    const a = args(
      read("src/components/math/ProblemContent.tsx"),
      "parseFigureDimensions",
    );
    expect(a).toHaveLength(4);
    expect(a[3]).toBe("figures");
  });

  it("넘침 자가 그림 **경로**를 넷째 인자로 넘긴다", () => {
    const a = args(
      read("src/lib/printOverflow.ts"),
      "parseFigureDimensionsRule",
    );
    expect(a).toHaveLength(4);
    expect(a[3]).toBe("problem.figureUrls");
  });
});
