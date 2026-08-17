/**
 * 🔴 RED → 🟢 GREEN — Phase 3, T3.3 S-08 ProblemCard
 *
 * 구현: src/components/problem/ProblemCard.tsx
 * 수식: src/components/math/MathText.tsx 재사용 (KaTeX 엔진 중복 금지)
 * 확정: docs/planning/05-design-system.md §8.6 S-08 — 교체 없음 (S-05 소유)
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProblemBody } from "@/components/print/templates/ProblemBody";
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

  // 어떤 화면이든 문항 본문은 인쇄 지면과 같은 틀(폭·서체)로 렌더한다 — 줄바꿈까지 동일 (2026-08-17 원장님 지시).
  it("문항 본문을 지면 문항 틀(data-paper-view) 안에 렌더한다", () => {
    const { container } = render(
      <ProblemCard problem={MOCK_PROBLEM_WITH_FRACTION} />,
    );

    const frame = container.querySelector("[data-paper-view]");
    expect(frame).not.toBeNull();
    expect(frame!.textContent).toContain("를 유한소수로 나타내어라.");
  });

  // 화면 카드와 인쇄 지면이 **같은 마크업**을 내야 줄바꿈이 갈라지지 않는다.
  // 어느 한쪽에 렌더 분기를 넣으면 이 테스트가 깨진다.
  it("문제은행 카드와 인쇄 문항 본문의 마크업이 동일하다", () => {
    const problem = MOCK_PROBLEM_WITH_FRACTION;
    const card = render(<ProblemCard problem={problem} />);
    const cardBody = card.container.querySelector("[data-paper-view]")!;

    const print = render(
      <ProblemBody
        problem={{
          id: problem.id,
          orderIndex: 1,
          content: problem.content,
          answer: problem.answer,
          solution: problem.solution,
          figureUrls: problem.figureUrls,
        }}
      />,
    );
    const printBody = print.container.querySelector("[data-paper-view]")!;

    expect(cardBody.innerHTML).toBe(printBody.innerHTML);
  });

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
