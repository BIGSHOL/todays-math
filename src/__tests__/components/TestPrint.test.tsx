import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  TestPrint,
  type TestPrintDocument,
} from "@/components/print/TestPrint";

const PRINT_DOCUMENT: TestPrintDocument = {
  testId: "10000000-0000-4000-8000-000000000001",
  testType: "daily",
  testDate: "2026-08-14",
  className: "중2 심화반",
  section: "일차부등식",
  todayGoal: "부등식의 해를 수직선에 나타낼 수 있다",
  conceptNote: "양변에 음수를 곱하거나 나누면 부등호의 방향이 바뀐다.",
  problems: Array.from({ length: 5 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    orderIndex: index + 1,
    content: `문제 ${index + 1}: $x + ${index + 1} = 10$을 풀어라.`,
    answer: String(9 - index),
    solution: `$x = 10 - ${index + 1}$이다.`,
  })),
};

describe("TestPrint", () => {
  it("첫 장에 학원명, 예정일, 이름·반 칸과 확정 제목을 표시한다", () => {
    const { container } = render(<TestPrint data={PRINT_DOCUMENT} />);
    const firstPage = container.querySelector(
      '[data-page-kind="questions"][data-page-number="1"]',
    );

    expect(firstPage).not.toBeNull();
    const page = within(firstPage as HTMLElement);

    expect(page.getByText("오늘의수학")).toBeInTheDocument();
    expect(page.getByText("2026.08.14")).toBeInTheDocument();
    expect(page.getByText("이름 ________ · 반 ______")).toBeInTheDocument();
    expect(
      page.getByRole("heading", {
        name: "일일테스트 · 일차부등식",
      }),
    ).toBeInTheDocument();
    expect(page.queryByText(/점\]/)).not.toBeInTheDocument();
  });

  it("장당 두 문항으로 나누고 각 A4 장에 인쇄 페이지 마커를 둔다", () => {
    const { container } = render(<TestPrint data={PRINT_DOCUMENT} />);

    const pages = container.querySelectorAll(
      '[data-print-page="true"][data-page-kind="questions"]',
    );
    expect(pages).toHaveLength(3);
    expect(pages[0]?.querySelectorAll("[data-problem-number]")).toHaveLength(2);
    expect(pages[1]?.querySelectorAll("[data-problem-number]")).toHaveLength(2);
    expect(pages[2]?.querySelectorAll("[data-problem-number]")).toHaveLength(1);
    expect(pages[0]).toHaveTextContent("핵심 개념 정리");
    expect(pages[1]).not.toHaveTextContent("핵심 개념 정리");
  });

  it("정답지 모드에서 빠른 정답과 2단 해설을 표시한다", async () => {
    const user = userEvent.setup();
    render(<TestPrint data={PRINT_DOCUMENT} />);

    await user.click(screen.getByRole("button", { name: "정답지" }));

    expect(
      screen.getByRole("heading", { name: "빠른 정답" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("quick-answer-1")).toHaveTextContent("9");
    expect(screen.getByTestId("quick-answer-5")).toHaveTextContent("5");
    expect(screen.getByTestId("answer-solutions")).toHaveStyle({
      columnCount: 2,
    });
    expect(
      document.querySelector('[data-page-kind="questions"]'),
    ).not.toBeInTheDocument();
  });
});
