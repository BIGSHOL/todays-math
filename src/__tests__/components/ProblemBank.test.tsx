/**
 * 🔴 RED → 🟢 GREEN — Phase 3, T3.3 S-08 문제은행
 *
 * 구현: src/app/(main)/problems/page.tsx, src/components/problem/**
 * 데이터: 기존 MSW problem 핸들러 (실제 DB/AI 호출 없음)
 *
 * 확정: docs/planning/05-design-system.md §8.6 S-08
 * 액션: 등록 / 생성 / 변형. 검수 [교체]는 S-05 소유.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import ProblemsPage from "@/app/(main)/problems/page";
import {
  MOCK_AI_GENERATED_PROBLEMS,
  MOCK_AI_TRANSFORMED_PROBLEMS,
  MOCK_PROBLEM_WITH_FRACTION,
  MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL,
  MOCK_UNITS,
} from "@/mocks/data";
import { server } from "@/mocks/server";

async function renderBank() {
  const user = userEvent.setup();
  const view = render(<ProblemsPage />);
  await screen.findByRole("heading", { name: "문제은행" });
  await screen.findByText(/를 유한소수로 나타내어라/);
  return { user, ...view };
}

describe("[T3.3 S-08] 문제은행 — 크롬·필터·액션", () => {
  it("AppChrome 내비와 단원/난이도/유형/상태 필터, 등록·생성·변형을 보여 준다", async () => {
    await renderBank();

    expect(screen.getByRole("link", { name: "오늘의수학" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "문제은행" })).toHaveAttribute(
      "href",
      "/problems",
    );

    expect(screen.getByLabelText("단원")).toBeInTheDocument();
    expect(screen.getByLabelText("난이도")).toBeInTheDocument();
    expect(screen.getByLabelText("유형")).toBeInTheDocument();
    expect(screen.getByLabelText("상태")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "등록" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "생성" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "변형" })).toBeInTheDocument();
  });

  it("목록에서 분수·도형 수식을 MathText로 렌더하고 [교체]는 없다", async () => {
    const { container } = await renderBank();

    expect(container.textContent).toMatch(/밑변의 길이가/);
    expect(container.querySelectorAll(".katex").length).toBeGreaterThan(1);
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "교체" }),
    ).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/[!！]/);
  });
});

describe("[T3.3 S-08] 문제은행 — 필터 (MSW)", () => {
  it("필터 요청 실패 뒤 이전 필터의 문제를 계속 보여 주지 않는다", async () => {
    const { user } = await renderBank();
    expect(screen.getByText(/밑변의 길이가/)).toBeInTheDocument();

    server.use(
      http.get(
        "/api/problems",
        () => new HttpResponse("broken", { status: 500 }),
      ),
    );
    await user.selectOptions(screen.getByLabelText("난이도"), "hard");

    expect(
      await screen.findByText("목록을 불러오지 못했습니다"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/밑변의 길이가/)).not.toBeInTheDocument();
  });

  it("API가 돌려준 실제 단원 ID를 필터와 등록 폼에 사용한다", async () => {
    const liveUnit = {
      id: "12345678-1234-4123-8123-123456789abc",
      grade: "중3",
      chapter: "실제 대단원",
      section: "실제 소단원",
      orderIndex: 999,
    };
    server.use(
      http.get("/api/units", () => HttpResponse.json({ data: [liveUnit] })),
    );

    const { user } = await renderBank();
    const liveOption = await screen.findByRole("option", {
      name: liveUnit.section,
    });
    expect(liveOption).toHaveValue(liveUnit.id);
    expect(
      screen.queryByRole("option", { name: MOCK_UNITS[0]!.section }),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("단원"), liveUnit.id);
    await user.click(screen.getByRole("button", { name: "등록" }));

    const form = screen.getByRole("form", { name: "등록" });
    expect(within(form).getByLabelText("단원")).toHaveValue(liveUnit.id);
  });

  it("난이도 쉬움만 보면 도형(어려움) 문항이 빠진다", async () => {
    const { user } = await renderBank();

    await user.selectOptions(screen.getByLabelText("난이도"), "easy");

    await waitFor(() => {
      expect(screen.queryByText(/밑변의 길이가/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/를 유한소수로 나타내어라/)).toBeInTheDocument();
  });

  it("유형·상태·단원 필터를 조합하면 해당 문항만 남는다", async () => {
    const { user } = await renderBank();

    await user.selectOptions(screen.getByLabelText("유형"), "계산");
    await user.selectOptions(screen.getByLabelText("상태"), "approved");
    await user.selectOptions(
      screen.getByLabelText("단원"),
      MOCK_PROBLEM_WITH_FRACTION.unitId,
    );

    await waitFor(() => {
      expect(screen.getByText(/를 유한소수로 나타내어라/)).toBeInTheDocument();
      expect(screen.queryByText(/의 해를 구하시오/)).not.toBeInTheDocument();
    });
  });

  it("일치하는 문항이 없으면 빈 목록 안내를 보여 준다", async () => {
    const { user } = await renderBank();
    const emptyComboUnit = MOCK_UNITS[8]!;

    await user.selectOptions(screen.getByLabelText("단원"), emptyComboUnit.id);
    await user.selectOptions(screen.getByLabelText("난이도"), "hard");

    await waitFor(() => {
      expect(screen.getByText("등록된 문제가 없습니다")).toBeInTheDocument();
    });
  });
});

describe("[T3.3 S-08] 문제은행 — 등록/생성/변형", () => {
  it("활성 필터와 다른 새 문제를 결과 목록에 끼워 넣지 않는다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(screen.getByLabelText("난이도"), "hard");
    await screen.findByText(/밑변의 길이가/);
    await user.click(screen.getByRole("button", { name: "등록" }));

    const form = screen.getByRole("form", { name: "등록" });
    await user.selectOptions(within(form).getByLabelText("출처"), "manual");
    await user.selectOptions(within(form).getByLabelText("난이도"), "easy");
    await user.selectOptions(within(form).getByLabelText("유형"), "계산");
    await user.type(
      within(form).getByLabelText("본문"),
      "필터에서 제외할 문제 $1+1$",
    );
    await user.type(within(form).getByLabelText("정답"), "2");
    await user.click(within(form).getByRole("button", { name: "등록하기" }));

    await screen.findByText("1건 등록");
    expect(screen.queryByText(/필터에서 제외할 문제/)).not.toBeInTheDocument();
    expect(screen.getByText(/밑변의 길이가/)).toBeInTheDocument();
  });

  it("등록하면 작성한 본문이 목록 앞에 나타난다", async () => {
    const { user } = await renderBank();
    await user.click(screen.getByRole("button", { name: "등록" }));

    const form = screen.getByRole("form", { name: "등록" });
    await user.selectOptions(
      within(form).getByLabelText("단원"),
      MOCK_PROBLEM_WITH_FRACTION.unitId,
    );
    await user.selectOptions(within(form).getByLabelText("출처"), "manual");
    await user.selectOptions(within(form).getByLabelText("난이도"), "easy");
    await user.selectOptions(within(form).getByLabelText("유형"), "계산");
    await user.type(within(form).getByLabelText("본문"), "등록 본문 $1+1$");
    await user.type(within(form).getByLabelText("정답"), "2");
    await user.click(within(form).getByRole("button", { name: "등록하기" }));

    await screen.findByText("1건 등록");
    expect(screen.getByText(/등록 본문/)).toBeInTheDocument();
  });

  it("생성하면 AI 픽스처 본문이 현재 목록에 추가된다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(
      screen.getByLabelText("단원"),
      MOCK_PROBLEM_WITH_FRACTION.unitId,
    );
    await waitFor(() => {
      expect(
        screen.queryByText(/에 물을 더 넣어 농도를/),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "생성" }));
    const form = screen.getByRole("form", { name: "생성" });
    await user.selectOptions(
      within(form).getByLabelText("단원"),
      MOCK_PROBLEM_WITH_FRACTION.unitId,
    );
    await user.selectOptions(within(form).getByLabelText("난이도"), "easy");
    await user.click(within(form).getByRole("button", { name: "생성하기" }));

    await screen.findByText("1건 생성");
    expect(screen.getByText(/에 물을 더 넣어 농도를/)).toBeInTheDocument();
    expect(MOCK_AI_GENERATED_PROBLEMS[0]!.content).toContain("소금물");
  });

  it("변형하면 변형 픽스처 본문이 현재 목록에 추가된다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(
      screen.getByLabelText("단원"),
      MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL.unitId,
    );
    await waitFor(() => {
      expect(screen.getByText(/밑변의 길이가/)).toBeInTheDocument();
      expect(
        screen.queryByText(/을 유한소수로 나타내어라/),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "변형" }));
    const form = screen.getByRole("form", { name: "변형" });
    await user.selectOptions(
      within(form).getByLabelText("원본 문제"),
      MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL.id,
    );
    await user.click(within(form).getByRole("button", { name: "변형하기" }));

    await screen.findByText("1건 변형");
    expect(screen.getByText(/을 유한소수로 나타내어라/)).toBeInTheDocument();
    expect(MOCK_AI_TRANSFORMED_PROBLEMS[0]!.content).toContain("11");
  });
});
