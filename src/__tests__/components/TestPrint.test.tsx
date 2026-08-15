import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("대분수 정답은 분자 클립 방지 여백이 있는 헤딩에 그린다", async () => {
    const user = userEvent.setup();
    const mixed: TestPrintDocument = {
      ...PRINT_DOCUMENT,
      problems: [
        {
          id: "20000000-0000-4000-8000-000000000099",
          orderIndex: 1,
          content: "$\\frac{28}{15}$를 대분수로 나타내어라.",
          answer: "$\\frac{28}{15}$",
          solution: null,
        },
      ],
    };
    const { container } = render(<TestPrint data={mixed} />);
    await user.click(screen.getByRole("button", { name: "정답지" }));

    const heading = container.querySelector('[data-testid="answer-heading-1"]');
    expect(heading).not.toBeNull();
    expect(heading?.querySelector(".katex")).not.toBeNull();
    expect(heading?.className ?? "").toMatch(/solutionHeading/);
  });

  it("정답지 CSS는 단 상단 대분수 분자가 잘리지 않게 여백을 둔다", () => {
    const css = readFileSync(
      path.resolve(process.cwd(), "src/components/print/TestPrint.module.css"),
      "utf8",
    );
    expect(css).toMatch(/\.answerSolutions[\s\S]*?padding-top:\s*0\.6em/);
    expect(css).toMatch(/\.solutionHeading[\s\S]*?line-height:\s*2\.2/);
    expect(css).toMatch(/\.quickAnswerCell[\s\S]*?overflow:\s*visible/);
  });
});

/**
 * 🔴 RED → 🟢 GREEN — 적대적 리뷰 잔여 3건
 *   (1) 긴 문항이 조용히 잘린다  (2) 인쇄 실패 원인이 한 문장으로 뭉개진다
 *   (3) 오류가 보조기술에 안 읽힌다
 */
describe("TestPrint — 인쇄 사고 방지", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const longDoc: TestPrintDocument = {
    ...PRINT_DOCUMENT,
    problems: [
      PRINT_DOCUMENT.problems[0],
      { ...PRINT_DOCUMENT.problems[1], content: "가".repeat(600) },
    ],
  };

  it("잘릴 만한 문항이 있으면 인쇄 전에 번호로 알린다", () => {
    render(<TestPrint data={longDoc} />);
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent("2번");
    expect(warning).toHaveTextContent("본문이 길다");
  });

  it("멀쩡한 시험지에는 경고를 띄우지 않는다 — 늘 켜져 있으면 아무도 안 본다", () => {
    render(<TestPrint data={PRINT_DOCUMENT} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("경고가 인쇄를 막지는 않는다 — 원장이 알고 누르게만 한다", () => {
    render(<TestPrint data={longDoc} />);
    expect(screen.getByRole("button", { name: "인쇄하기" })).toBeEnabled();
  });

  it("인쇄 실패는 서버가 준 사유를 그대로 보여 준다 (401 을 409 로 뭉개지 않는다)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
        }),
      }),
    );
    const user = userEvent.setup();
    render(<TestPrint data={PRINT_DOCUMENT} />);
    await user.click(screen.getByRole("button", { name: "인쇄하기" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("로그인이 필요합니다.");
    expect(alert).not.toHaveTextContent("확정된 테스트만");
  });

  it("서버가 사유를 안 주면 상태 코드로 갈라 말한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("본문 없음");
        },
      }),
    );
    const user = userEvent.setup();
    render(<TestPrint data={PRINT_DOCUMENT} />);
    await user.click(screen.getByRole("button", { name: "인쇄하기" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("서버");
  });
});
