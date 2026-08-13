/**
 * 문제 본문 KaTeX 렌더 컴포넌트 — T3.3 MathText 추출분.
 * 검수·인쇄가 같은 컴포넌트를 쓴다 (렌더 경로 분기 금지).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { MathText } from "@/components/math/MathText";
import {
  MOCK_PROBLEM_WITH_EXPONENT,
  MOCK_PROBLEM_WITH_FRACTION,
  MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL,
  MOCK_PROBLEM_WITH_SQRT,
} from "@/mocks/data";

describe("[MathText] 대표 수식 4종", () => {
  it.each([
    ["분수", MOCK_PROBLEM_WITH_FRACTION.content],
    ["지수", MOCK_PROBLEM_WITH_EXPONENT.content],
    ["루트", MOCK_PROBLEM_WITH_SQRT.content],
    ["도형", MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL.content],
  ] as const)(
    "%s 본문에 .katex 가 있고 .katex-error 가 없다",
    (_label, text) => {
      const { container } = render(<MathText text={text} />);
      expect(container.querySelector(".katex")).not.toBeNull();
      expect(container.querySelector(".katex-error")).toBeNull();
    },
  );

  it("수식 밖 한글 문장을 그대로 보여 준다", () => {
    const { container } = render(
      <MathText text="$\frac{1}{2}$를 소수로 나타내어라." />,
    );
    expect(container.textContent).toContain("를 소수로 나타내어라.");
  });
});
