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

  // 문제은행·검수 카드와 같은 지면 문항 뷰 한 경로로 렌더한다 — 화면과 인쇄의 줄바꿈 통일 근거.
  it("모든 문항 본문이 지면 문항 뷰(data-paper-view)로 렌더된다", () => {
    const { container } = render(<TestPrint data={PRINT_DOCUMENT} />);

    const problems = container.querySelectorAll("[data-problem-number]");
    for (const problem of problems) {
      expect(problem.querySelector("[data-paper-view]")).not.toBeNull();
    }
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

  it("넘칠 만한 문항이 있으면 인쇄 전에 번호로 알린다", () => {
    render(<TestPrint data={longDoc} />);
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent("2번");
    expect(warning).toHaveTextContent("본문이 길다");
  });

  /**
   * 문구는 **실제로 일어나는 일**을 가리켜야 한다. 문항 칸(`.problemItem`)에는
   * `overflow` 가 없어서 넘친 내용은 «잘리는» 게 아니라 옆 문항 위에 겹쳐 찍힌다
   * (적대적 리뷰 ③ §3). 「잘린 문항」을 찾으라고 하면 원장은 못 찾는다.
   */
  it("경고가 «잘림»이 아니라 «겹침»을 가리킨다", () => {
    render(<TestPrint data={longDoc} />);
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent("겹쳐 인쇄");
    expect(warning.textContent).not.toMatch(/잘리|잘린|잘림/);
  });

  /**
   * 정답지는 **다른 지면**이다 — `.answerSolutions` 는 2단이고 클립이 걸려 있어
   * 넘친 해설이 3번째 단으로 밀려 통째로 사라진다. 문제지 경고와 따로 알린다
   * (적대적 리뷰 ③ §5, 실측 정답지 480장 중 134장에서 해설이 사라졌다).
   */
  it("해설이 정답지에서 빠질 만하면 쪽·번호로 따로 알린다", () => {
    const longSolution = Array.from(
      { length: 60 },
      (_, i) => `${i}단계에서 양변을 정리하면 값이 나온다.`,
    ).join(" ");
    render(
      <TestPrint
        data={{
          ...PRINT_DOCUMENT,
          problems: PRINT_DOCUMENT.problems.map((p) => ({
            ...p,
            solution: longSolution,
          })),
        }}
      />,
    );
    const answerKeyWarning = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("정답지"));
    expect(answerKeyWarning).toBeDefined();
    expect(answerKeyWarning).toHaveTextContent("1쪽");
    expect(answerKeyWarning).toHaveTextContent(
      "해설이 통째로 빠질 수 있습니다",
    );
  });

  it("해설이 짧으면 정답지 경고는 안 뜬다", () => {
    render(<TestPrint data={PRINT_DOCUMENT} />);
    expect(
      screen
        .queryAllByRole("status")
        .filter((el) => el.textContent?.includes("정답지")),
    ).toHaveLength(0);
  });

  it("멀쩡한 시험지에는 경고를 띄우지 않는다 — 늘 켜져 있으면 아무도 안 본다", () => {
    render(<TestPrint data={PRINT_DOCUMENT} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("경고가 인쇄를 막지는 않는다 — 원장이 알고 누르게만 한다", () => {
    render(<TestPrint data={longDoc} />);
    expect(screen.getByRole("button", { name: "인쇄하기" })).toBeEnabled();
  });

  it("미리보기 지면의 그림은 지연 로딩하지 않는다 — 인쇄 때 빠지면 안 된다", () => {
    // 절대 규칙 6. 화면 목록(문제은행·검수)만 미루고, 지면은 미루지 않는다.
    const withFigures: TestPrintDocument = {
      ...PRINT_DOCUMENT,
      problems: PRINT_DOCUMENT.problems.map((problem, index) => ({
        ...problem,
        figureUrls: [`/figures/2658/q${index + 1}.png`],
      })),
    };
    render(<TestPrint data={withFigures} />);

    const figures = screen.getAllByRole("img");
    expect(figures).toHaveLength(withFigures.problems.length);
    for (const figure of figures) {
      expect(figure).not.toHaveAttribute("loading");
      expect(figure).not.toHaveAttribute("decoding");
    }
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

  /**
   * 원장님 지시: "서술형은 기본적으로 [서술형1] 이런 문구는 제외해야지.
   * 문제 배치될때 알아서 스마트하게 [서술형 n] 되도록해야지."
   * 본문에서 뗀 라벨을 **조판이** 채운다.
   */
  describe("서술형 지면 표시", () => {
    const mixedTypes: TestPrintDocument = {
      ...PRINT_DOCUMENT,
      problems: PRINT_DOCUMENT.problems.map((problem, index) => ({
        ...problem,
        // 1·3·5번째가 서술형 → 지면에는 서술형 1·2·3 으로 나가야 한다.
        questionType: index % 2 === 0 ? "서술형" : "객관식",
      })),
    };

    it("서술형 문항에만 지면 순번을 붙인다", () => {
      const { container } = render(<TestPrint data={mixedTypes} />);
      const badges = [...container.querySelectorAll("[data-problem-number]")]
        .map((el) => el.textContent ?? "")
        .map((text) => /서술형 (\d+)/.exec(text)?.[1] ?? null);

      // 문 1·3·5 만 배지를 갖고, 번호는 장을 넘어가며 이어진다.
      expect(badges).toEqual(["1", null, "2", null, "3"]);
    });

    it("서술형이 없으면 배지를 붙이지 않는다", () => {
      const { container } = render(<TestPrint data={PRINT_DOCUMENT} />);
      expect(container.textContent).not.toContain("서술형");
    });

    it("questionType 을 모르면 서술형이라 단정하지 않는다", () => {
      const unknown: TestPrintDocument = {
        ...PRINT_DOCUMENT,
        problems: PRINT_DOCUMENT.problems.map((p) => ({
          ...p,
          questionType: null,
        })),
      };
      const { container } = render(<TestPrint data={unknown} />);
      expect(container.textContent).not.toContain("서술형");
    });
  });
});
