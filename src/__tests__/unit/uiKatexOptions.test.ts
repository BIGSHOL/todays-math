/**
 * **우리 전처리가 만든 글자를 우리 렌더가 거부하고 있었다.**
 *
 * `preprocessMathText` 는 호(⌒)와 순환마디 점을 `\htmlClass{…}` 로 내보낸다.
 * KaTeX 는 이 HTML 확장을 `trust` 없이는 거부하는데, 거부한 결과를 **예외가 아니라
 * 붉은 글자**로 그린다. 그래서 옵션을 안 넘긴 렌더 경로는 조용히 붉은 `\htmlClass`
 * 를 학생 지면에 내보낸다 — 실측 문항 320행 · 수식 787곳(2026-08-18).
 *
 * 이 테스트가 잠그는 것:
 *   1. 전처리가 실제로 `\htmlClass` 를 만든다는 사실(설계다, 사고가 아니다).
 *   2. 옵션 없이 그리면 **붉다**는 사실(그러니 이 옵션은 선택이 아니다).
 *   3. `UI_KATEX_OPTIONS` 를 넘기면 붉지 않고 클래스도 살아 있다는 사실.
 *
 * 화면(`MarkdownRenderer` → `rehypeKatex`)이 이 상수를 넘기도록 연결하는 일은
 * 다른 세션 소유 파일이라 여기서 하지 않는다 — 보고서 참조.
 */
import katex from "katex";
import { describe, expect, it } from "vitest";

import { UI_KATEX_OPTIONS } from "@/lib/math/katexRender";
import { preprocessMathText } from "@/lib/math/textPreprocess";

const isRed = (html: string) =>
  /#cc0000/i.test(html) || html.includes("katex-error");

describe("[UI_KATEX_OPTIONS] 전처리가 만드는 `\\htmlClass` 를 렌더가 받아들이는가", () => {
  it("전처리는 순환마디를 `\\htmlClass{repeat-dot}` 으로 내보낸다", () => {
    expect(preprocessMathText("$0.\\overline{3}$")).toContain(
      "\\htmlClass{repeat-dot}",
    );
  });

  it("전처리는 호를 `\\htmlClass{geom-arc-wrap}` 으로 내보낸다", () => {
    expect(preprocessMathText("$\\overset{\\frown}{AB}$")).toContain(
      "\\htmlClass{geom-arc-wrap}",
    );
  });

  it("옵션 **없이** 그리면 붉게 나간다 — 지금 화면이 이 상태다", () => {
    const html = katex.renderToString("0.\\htmlClass{repeat-dot}{3}", {
      throwOnError: false,
    });
    expect(isRed(html)).toBe(true);
  });

  it("`UI_KATEX_OPTIONS` 를 넘기면 붉지 않고 클래스도 살아 있다", () => {
    const html = katex.renderToString("0.\\htmlClass{repeat-dot}{3}", {
      ...UI_KATEX_OPTIONS,
      throwOnError: false,
    });
    expect(isRed(html)).toBe(false);
    expect(html).toContain("repeat-dot");
  });

  it("허용 범위는 `\\htmlClass` 하나뿐이다 — 임의 HTML 주입은 막는다", () => {
    expect(UI_KATEX_OPTIONS.trust({ command: "\\htmlClass" })).toBe(true);
    expect(UI_KATEX_OPTIONS.trust({ command: "\\href" })).toBe(false);
    expect(UI_KATEX_OPTIONS.trust({ command: "\\includegraphics" })).toBe(
      false,
    );
  });
});
