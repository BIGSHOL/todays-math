/**
 * 🔴 RED → 🟢 GREEN — Phase 3, T3.3 S-08 ProblemCard
 *
 * 구현: src/components/problem/ProblemCard.tsx
 * 수식: src/components/math/MathText.tsx 재사용 (KaTeX 엔진 중복 금지)
 * 확정: docs/planning/05-design-system.md §8.6 S-08 — 교체 없음 (S-05 소유)
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProblemCard } from "@/components/problem/ProblemCard";
import {
  MOCK_PROBLEM_WITH_EXPONENT,
  MOCK_PROBLEM_WITH_FRACTION,
  MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL,
  MOCK_PROBLEM_WITH_SQRT,
} from "@/mocks/data";

describe("[T3.3 S-08] ProblemCard — 대표 수식 4종 (MathText)", () => {
  it.each([
    ["분수", MOCK_PROBLEM_WITH_FRACTION, "를 유한소수로 나타내어라."],
    ["지수", MOCK_PROBLEM_WITH_EXPONENT, "을 간단히 하여라."],
    ["루트", MOCK_PROBLEM_WITH_SQRT, "의 해를 구하시오."],
    ["도형", MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL, "밑변의 길이가"],
  ] as const)(
    "%s 본문에 .katex 가 있고 .katex-error 가 없다",
    (_label, problem, prose) => {
      const { container } = render(<ProblemCard problem={problem} />);
      expect(container.querySelector(".katex")).not.toBeNull();
      expect(container.querySelector(".katex-error")).toBeNull();
      expect(container.textContent).toContain(prose);
    },
  );

  it("난이도·유형을 마이크로 라벨로 보여 준다", () => {
    render(<ProblemCard problem={MOCK_PROBLEM_WITH_FRACTION} />);
    expect(screen.getByText("쉬움")).toBeInTheDocument();
    expect(screen.getByText("계산")).toBeInTheDocument();
  });

  it("검수 [교체] 버튼을 넣지 않는다", () => {
    render(<ProblemCard problem={MOCK_PROBLEM_WITH_FRACTION} />);
    expect(
      screen.queryByRole("button", { name: "교체" }),
    ).not.toBeInTheDocument();
  });
});
