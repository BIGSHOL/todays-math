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

/**
 * 🔴 RED → 🟢 GREEN — 팔레트 「계기판」 확정에 따른 카드 정리 (원장님 확정 2026-08-18).
 *
 * 결정 셋: (1) 팔레트 B, (2) 검수 상태에 기능색 사용, (3) 난이도·유형 칩 → 마이크로 라벨.
 * 05 §8.6 이 원래 "난이도·유형은 마이크로 라벨"로 확정해 둔 것을 카드가 안 따르고 있었다.
 */
describe("[S-08] ProblemCard — 팔레트 정리", () => {
  it("테일윈드 기본 팔레트(indigo·slate)를 쓰지 않는다", () => {
    const { container } = render(
      <ProblemCard problem={MOCK_PROBLEM_WITH_FRACTION} />,
    );
    // 토큰 밖 색이 남아 있으면 팔레트를 바꿔도 카드만 겉돈다.
    expect(container.innerHTML).not.toMatch(/indigo-\d|slate-\d/);
  });

  it("난이도·유형은 알약 칩이 아니라 마이크로 라벨이다", () => {
    render(<ProblemCard problem={MOCK_PROBLEM_WITH_FRACTION} />);
    const level = screen.getByText("쉬움");
    const type = screen.getByText("계산");
    for (const el of [level, type]) {
      // 알약이 아니다 — 둥근 테두리도 면색도 없다.
      expect(el.className).not.toMatch(/rounded|bg-/);
    }
    // 마이크로 라벨 규격(10px·굵게·자간)은 묶는 부모가 준다.
    expect(level.parentElement?.className).toMatch(/text-\[10px\].*tracking-/);
    expect(level.parentElement).toBe(type.parentElement);
  });

  it("검수 상태는 상태마다 다른 색으로 구분한다", () => {
    const statuses = ["approved", "pending", "rejected"] as const;
    const classes = statuses.map((reviewStatus) => {
      const { container } = render(
        <ProblemCard
          problem={{ ...MOCK_PROBLEM_WITH_FRACTION, reviewStatus }}
        />,
      );
      const label = container.querySelector("[data-review-status]");
      expect(label).not.toBeNull();
      return label!.className;
    });
    expect(new Set(classes).size).toBe(3);
  });
});

/**
 * 도형 SVG (D-55) — AI 변형이 엔진으로 새로 그린 도형이 **카드에 실제로 보이는가**.
 *
 * ⚠️ 이 가드가 없으면 도형이 저장은 되는데 지면에는 안 나온다. 적대적 변이에서
 *    「카드가 도형을 안 그린다」가 **초록**이었다 — 아무도 안 보고 있었다.
 */
describe("[D-55] ProblemCard — 도형 SVG", () => {
  const SVG =
    '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" data-probe="1">' +
    '<line x1="0" y1="0" x2="10" y2="10"/></svg>';

  it("figureSvg 가 있으면 지면에 inline 으로 그린다", () => {
    const { container } = render(
      <ProblemCard
        problem={{ ...MOCK_PROBLEM_WITH_FRACTION, figureSvg: SVG }}
      />,
    );
    expect(
      container.querySelector('[data-figure-svg] svg[data-probe="1"]'),
    ).toBeInTheDocument();
  });

  it("figureSvg 가 없으면 빈 자리를 만들지 않는다", () => {
    const { container } = render(
      <ProblemCard problem={MOCK_PROBLEM_WITH_FRACTION} />,
    );
    expect(container.querySelector("[data-figure-svg]")).toBeNull();
  });
});
