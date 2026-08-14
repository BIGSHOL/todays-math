/**
 * 🔴→🟢 KaTeX 3단 방어 렌더 + 한국 수학 정규화.
 *
 * 이식 정본: Mathgen `katexRender.ts` + `textPreprocess.ts` (06-tasks.md T3.3/T5.2).
 * 보강: sumaek unicode/overparen, mathlab `\(\)`/`\[\]` 구분자, math_test 평문 혼재.
 *
 * 절대 규칙: 어떤 입력에도 `.katex-error`(붉은 글씨)를 내지 않는다.
 */
import { describe, expect, it } from "vitest";

import {
  applyMathInnerNormalization,
  cleanMalformedLatex,
  preprocessMathText,
} from "@/lib/math/textPreprocess";
import { renderKatexSafe } from "@/lib/math/katexRender";
import { renderMathHtml } from "@/lib/math/renderMathHtml";
import {
  MOCK_PROBLEM_WITH_EXPONENT,
  MOCK_PROBLEM_WITH_FRACTION,
  MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL,
  MOCK_PROBLEM_WITH_SQRT,
} from "@/mocks/data";

function expectSafeHtml(html: string) {
  expect(html).not.toContain("katex-error");
  expect(html).not.toMatch(/color:\s*#cc0000/i);
}

describe("[KaTeX] 3단 방어 — renderKatexSafe", () => {
  it("정상 분수·루트·지수·도형을 .katex 로 그리고 katex-error 가 없다", () => {
    const cases = [
      { tex: "\\frac{7}{25}", label: "분수" },
      { tex: "\\sqrt{3}x - 2", label: "루트" },
      { tex: "a^{3} \\times a^{2}", label: "지수" },
      { tex: "\\triangle ABC", label: "도형" },
    ];
    for (const c of cases) {
      const html = renderKatexSafe(c.tex, false);
      expect(html, c.label).toContain("katex");
      expectSafeHtml(html);
    }
  });

  it("\\left\\left 같은 모델 typo 는 2차 수리 후 그려지고 빨강이 없다", () => {
    const html = renderKatexSafe("\\left\\left( x+1 \\right\\right)", false);
    expectSafeHtml(html);
    expect(html.includes("katex") || html.includes("math-raw")).toBe(true);
  });

  it("복구 불가 입력은 katex-error 대신 중립 .math-raw 로 떨어진다", () => {
    const html = renderKatexSafe("\\notacommand{????} \\left", false);
    expectSafeHtml(html);
    expect(html).toContain("math-raw");
  });

  it("복구 불가 입력의 원문은 HTML 이스케이프된다", () => {
    const html = renderKatexSafe("<script>alert(1)</script>", false);
    expectSafeHtml(html);
    expect(html).not.toContain("<script>");
  });
});

describe("[KaTeX] 전처리 — preprocessMathText", () => {
  it("\\( \\) / \\[ \\] 구분자를 $ / $$ 로 바꾼다", () => {
    const inline = preprocessMathText("값 \\(x+1\\) 이다");
    expect(inline).toMatch(/\$/);
    expect(inline).not.toContain("\\(");

    const block = preprocessMathText("식 \\[\\frac{1}{2}\\]");
    expect(block).toContain("$$");
    expect(block).not.toContain("\\[");
  });

  it("$A$$B$ 접착을 $A$ $B$ 로 분리한다", () => {
    const out = preprocessMathText("$x$$y$");
    expect(out).toMatch(/\$\\displaystyle x\$\s+\$\\displaystyle y\$/);
  });

  it("인라인 cases 는 display $$ 로 승격한다", () => {
    const out = preprocessMathText(
      "$\\begin{cases} x=1 \\\\ y=2 \\end{cases}$",
    );
    expect(out).toContain("$$");
  });

  it("수식 안 한글을 prose 로 분리한다", () => {
    const out = preprocessMathText("$2ab \\times (가운데) \\times A$");
    expect(out).toContain("가운데");
    expect(out.match(/\$/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("유니코드 제곱·곱셈·부등호를 LaTeX 로 바꾼다", () => {
    const inner = applyMathInnerNormalization("x² × y ≤ 3");
    expect(inner).toMatch(/x\^\{2\}/);
    expect(inner).toContain("\\times");
    expect(inner).toMatch(/\\le|\\leq/);
  });

  it("\\overparen 은 KaTeX 가 그리는 \\overgroup 으로 바꾼다", () => {
    const inner = applyMathInnerNormalization("\\overparen{AB}");
    expect(inner).not.toContain("\\overparen");
    expect(inner).toMatch(/overgroup|geom-arc-wrap/);
  });

  it("\\left\\left 와 빈 분수를 정리한다", () => {
    expect(cleanMalformedLatex("\\left\\left(x\\right\\right)")).not.toContain(
      "\\left\\left",
    );
    expect(cleanMalformedLatex("\\frac{a}{}")).toContain("\\frac{a}{1}");
  });
});

describe("[KaTeX] 혼합 본문 — renderMathHtml", () => {
  it("픽스처 4종(분수·지수·루트·도형)을 그려 katex-error 가 없다", () => {
    const samples = [
      MOCK_PROBLEM_WITH_FRACTION.content,
      MOCK_PROBLEM_WITH_EXPONENT.content,
      MOCK_PROBLEM_WITH_SQRT.content,
      MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL.content,
    ];
    for (const text of samples) {
      const html = renderMathHtml(text);
      expect(html).toContain("katex");
      expectSafeHtml(html);
    }
  });

  it("수식 밖 한글·HTML 은 이스케이프하고 수식만 렌더한다", () => {
    const html = renderMathHtml("각도 <90 일 때 $x^2$");
    expect(html).toContain("&lt;90");
    expect(html).toContain("katex");
    expectSafeHtml(html);
  });

  it("$ 없이 흘러나온 raw LaTeX 줄도 wrap 후 그린다", () => {
    const html = renderMathHtml("\\frac{1}{2}의 값은?");
    expectSafeHtml(html);
    expect(html).toContain("katex");
    expect(html).toContain("의 값은?");
  });

  it.each([
    "에 대하여 A^{\\bigstar}=\\{x+y \\mid x \\in A\\}로 정의한다.",
    "교점이 있을 때, \\underbrace{(f \\circ \\cdots \\circ f)}_{2024\\text{개}}(5)의 값은?",
  ])("OCR 코퍼스의 느슨한 명령을 원문 노출 없이 렌더한다: %s", (text) => {
    const html = renderMathHtml(text);
    expectSafeHtml(html);
    expect(html).toContain("katex");
    expect(html).not.toContain("math-raw");
  });

  it("한 줄에 반복되는 느슨한 수식 구간을 모두 렌더한다", () => {
    const input = "A \\subset B이면 참이고, x \\notin A이면 y \\geq 0이다.";
    const preprocessed = preprocessMathText(input);
    const html = renderMathHtml(input);
    expectSafeHtml(html);
    expect(preprocessed.match(/\$/gu)).toHaveLength(6);
    expect(html.match(/class="katex"/gu)).toHaveLength(3);
  });

  it.each(["포물선 y=x^2+2px+q의 초점", "f^{-1}의 그래프"])(
    "OCR의 ASCII caret 수식을 자동 렌더한다: %s",
    (input) => {
      const html = renderMathHtml(input);
      expectSafeHtml(html);
      expect(html).not.toMatch(/[A-Za-z0-9]\^[A-Za-z0-9{]/u);
      expect(html).toContain("katex");
    },
  );
});
