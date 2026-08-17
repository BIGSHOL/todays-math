/**
 * 🔴 RED → 🟢 GREEN — Phase 4, T4.3 S-05 검수 (H5×G2, D-29)
 *
 * 구현: src/app/(main)/tests/[id]/page.tsx + src/components/test/{TestReview,ProblemCard}
 * 데이터: 기존 MSW test 핸들러 (교체/확정)
 *
 * 확정: docs/planning/05-design-system.md §8.6 S-05
 * 교체: 1클릭, 확인 모달 없음. 인쇄 링크만 /tests/[id]/print
 */
import { describe, expect, it } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import TestReviewPage from "@/app/(main)/tests/[id]/page";
import { ReviewProblemCard } from "@/components/test/ReviewProblemCard";
import {
  MOCK_PROBLEMS,
  MOCK_TEST_CONFIRMED_PROBLEMS,
  MOCK_TEST_DRAFT_PROBLEMS,
  TEST_CONFIRMED_ID,
  TEST_DRAFT_ID,
  TEST_NOT_FOUND_ID,
} from "@/mocks/data";
import { server } from "@/mocks/server";

async function renderReview(id: string) {
  const user = userEvent.setup();
  const ui = await TestReviewPage({ params: Promise.resolve({ id }) });
  const view = render(ui);
  return { user, ...view };
}

describe("[T4.3 S-05] 검수 — 문제 카드", () => {
  it("문 N·난이도/유형 마이크로 라벨·MathText·우측 교체를 보여 준다", async () => {
    const { container } = await renderReview(TEST_DRAFT_ID);

    const first = await screen.findByRole("article", { name: "문 1" });
    expect(first).toHaveTextContent("하");
    expect(first).toHaveTextContent("계산");
    expect(first.querySelector(".katex")).not.toBeNull();
    expect(first.querySelector(".katex-error")).toBeNull();

    const replace = within(first).getByRole("button", { name: "교체" });
    expect(replace.className).toMatch(/underline|bg-transparent/);

    expect(screen.getByRole("article", { name: "문 8" })).toBeInTheDocument();
    expect(MOCK_TEST_DRAFT_PROBLEMS).toHaveLength(8);

    expect(container.textContent ?? "").not.toMatch(/[!！]/);
    expect(container.textContent ?? "").not.toMatch(/[😀🎉✨🔥]/);
    expect(first.className).not.toMatch(/#A57F00|gold/i);
    expect(within(first).getByRole("separator")).toBeInTheDocument();
  });

  it("본문을 누르면 답과 해설을 보여 준다", async () => {
    const { user } = await renderReview(TEST_DRAFT_ID);
    const first = await screen.findByRole("article", { name: "문 1" });

    expect(within(first).getByText("답")).not.toBeVisible();

    await user.click(within(first).getByText("를 유한소수로 나타내어라."));

    expect(within(first).getByText("답")).toBeVisible();
    expect(within(first).getAllByText("0.28").length).toBeGreaterThan(0);
    expect(within(first).getByText("해설")).toBeVisible();
    expect(within(first).queryByText("해설 없음")).not.toBeInTheDocument();
  });

  it("닫혀 있는 동안에는 답·해설 수식을 조판하지 않는다", async () => {
    // `<details>` 가 닫혀 있어도 React 는 자식을 렌더한다 — 30문항이면 보이지도
    // 않는 KaTeX 파이프라인 60개를 그대로 지불한다. 그 비용을 다시 들여오는
    // 회귀를 막는다. (화면에 보이는 것은 전후가 같다 — 닫힘은 어차피 안 보인다.)
    const user = userEvent.setup();
    const problem = MOCK_PROBLEMS.find((item) => item.solution !== null)!;

    render(<ReviewProblemCard orderIndex={1} problem={problem} />);
    const card = screen.getByRole("article", { name: "문 1" });

    // 접힌 상태: 제목("답"/"해설")은 그대로, 발췌 밖 수식은 조판되지 않았다.
    expect(within(card).getByText("답")).toBeInTheDocument();
    expect(within(card).getByText("해설")).toBeInTheDocument();
    const closedFormulas = card.querySelectorAll(".katex").length;

    await user.click(card.querySelector("summary")!);

    // 펼치면 바로 보인다 — 한 박자 기다릴 필요가 없다.
    expect(card.querySelectorAll(".katex").length).toBeGreaterThan(
      closedFormulas,
    );
    expect(within(card).getByText("답")).toBeVisible();
  });

  it("summary 클릭을 거치지 않고 펼쳐져도 답과 해설이 나온다", async () => {
    // 키보드(Enter/Space) 활성화는 브라우저가 summary 에 click 을 흘려 주지만
    // jsdom 은 그 활성화 동작을 흉내 내지 않는다. 그래서 **어떤 경로로 열리든**
    // 마지막에 반드시 일어나는 일(open 이 켜지고 toggle 이 뜬다)을 검증한다 —
    // 페이지 내 찾기·코드로 여는 경우도 같은 경로다.
    const problem = MOCK_PROBLEMS.find((item) => item.solution !== null)!;

    render(<ReviewProblemCard orderIndex={1} problem={problem} />);
    const card = screen.getByRole("article", { name: "문 1" });
    const details = card.querySelector("details")!;
    const closedFormulas = card.querySelectorAll(".katex").length;

    details.open = true;
    fireEvent(details, new Event("toggle"));

    expect(card.querySelectorAll(".katex").length).toBeGreaterThan(
      closedFormulas,
    );
    expect(within(card).getByText("답")).toBeVisible();
  });

  it("해설이 없으면 해설 없음이다", async () => {
    const user = userEvent.setup();
    const problem = MOCK_PROBLEMS.find((item) => item.solution === null);
    expect(problem).toBeDefined();

    render(<ReviewProblemCard orderIndex={3} problem={problem!} />);
    const card = screen.getByRole("article", { name: "문 3" });

    await user.click(card.querySelector("summary")!);

    expect(within(card).getByText("답")).toBeVisible();
    expect(within(card).getByText("해설 없음")).toBeVisible();
  });

  it("교체는 모달 없이 1클릭으로 본문을 바꾼다", async () => {
    const { user } = await renderReview(TEST_DRAFT_ID);
    const first = await screen.findByRole("article", { name: "문 1" });
    const before = MOCK_TEST_DRAFT_PROBLEMS[0]!.problem.content;

    expect(first).toHaveTextContent("를 유한소수로 나타내어라");

    await user.click(within(first).getByRole("button", { name: "교체" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      const card = screen.getByRole("article", { name: "문 1" });
      expect(card.textContent ?? "").not.toContain("를 유한소수로 나타내어라");
    });

    const replacement = MOCK_PROBLEMS.find(
      (p) =>
        p.unitId === MOCK_TEST_DRAFT_PROBLEMS[0]!.problem.unitId &&
        p.id !== MOCK_TEST_DRAFT_PROBLEMS[0]!.problem.id,
    );
    expect(replacement).toBeDefined();
    expect(replacement!.content).not.toBe(before);
    expect(screen.getByText(/교체 1/)).toBeInTheDocument();
  });

  it("교체 요청 실패를 사용자에게 알리고 기존 문제를 유지한다", async () => {
    server.use(
      http.put(
        "/api/tests/:id/problems/:seq",
        () => new HttpResponse("broken", { status: 500 }),
      ),
    );
    const { user } = await renderReview(TEST_DRAFT_ID);
    const first = await screen.findByRole("article", { name: "문 1" });
    await user.click(within(first).getByRole("button", { name: "교체" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "문제를 교체하지 못했습니다",
    );
    expect(first).toHaveTextContent("를 유한소수로 나타내어라");
  });
});

describe("[T4.3 S-05] 검수 — 하단 확정·인쇄", () => {
  it("초안은 인쇄를 비활성화해 실패 경로로 이동시키지 않는다", async () => {
    await renderReview(TEST_DRAFT_ID);
    await screen.findByRole("article", { name: "문 1" });

    expect(screen.getByText(/교체 0/)).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "확정" });
    expect(confirm.className).toContain("bg-[#161616]");

    expect(screen.getByRole("button", { name: "인쇄" })).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "인쇄" }),
    ).not.toBeInTheDocument();
  });

  it("확정을 누른 뒤에만 인쇄 링크를 연다", async () => {
    const { user } = await renderReview(TEST_DRAFT_ID);
    await screen.findByRole("article", { name: "문 1" });

    await user.click(screen.getByRole("button", { name: "확정" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "확정" })).toBeDisabled();
      expect(screen.getByRole("link", { name: "인쇄" })).toHaveAttribute(
        "href",
        `/tests/${TEST_DRAFT_ID}/print`,
      );
    });
    expect(
      screen.queryByRole("button", { name: "인쇄" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("확정 요청 실패를 알리고 인쇄를 계속 막는다", async () => {
    server.use(
      http.post(
        "/api/tests/:id/confirm",
        () => new HttpResponse("broken", { status: 500 }),
      ),
    );
    const { user } = await renderReview(TEST_DRAFT_ID);
    await screen.findByRole("article", { name: "문 1" });

    await user.click(screen.getByRole("button", { name: "확정" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "테스트를 확정하지 못했습니다",
    );
    expect(screen.getByRole("button", { name: "인쇄" })).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "인쇄" }),
    ).not.toBeInTheDocument();
  });

  it("이미 교체된 확정본은 교체 수를 반영한다", async () => {
    await renderReview(TEST_CONFIRMED_ID);
    await screen.findByRole("article", { name: "문 1" });

    const replacedCount = MOCK_TEST_CONFIRMED_PROBLEMS.filter(
      (item) => item.replaced,
    ).length;
    expect(
      screen.getByText(new RegExp(`교체 ${replacedCount}`)),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확정" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "인쇄" })).toHaveAttribute(
      "href",
      `/tests/${TEST_CONFIRMED_ID}/print`,
    );
  });

  it("없는 테스트면 찾을 수 없다는 안내를 보여 준다", async () => {
    await renderReview(TEST_NOT_FOUND_ID);

    expect(
      await screen.findByText("테스트를 찾을 수 없습니다"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "교체" }),
    ).not.toBeInTheDocument();
  });
});
