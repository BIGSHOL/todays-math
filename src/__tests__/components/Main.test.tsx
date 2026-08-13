/**
 * 🟢 GREEN — Phase 4, T4.3 S-03 메인 화면 (H5×G2)
 *
 * 구현: src/app/(main)/page.tsx + src/components/main/**
 * 데이터: 기존 MSW test/class 핸들러 (실제 DB 불필요)
 *
 * 확정: docs/planning/05-design-system.md §8.1~8.4
 * 시안: hifi-h5-final.html, hifi-h5-google.html G2, wire-s03-final.html
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MainPage from "@/app/(main)/page";
import {
  CLASS_A_ID,
  CLASS_B_ID,
  CLASS_STARVED_ID,
  MOCK_CLASS_A,
  MOCK_CLASS_B,
  MOCK_CLASS_STARVED,
  MOCK_CURRENT_PROGRESS_UNIT,
  MOCK_TEST_PRINTED,
  MOCK_UNITS,
  TEST_CONFIRMED_ID,
  TEST_DRAFT_ID,
} from "@/mocks/data";
import { server } from "@/mocks/server";

const CARD_GRID = "grid-cols-[44px_minmax(0,1fr)_232px_112px]";

function printedClassTest(classId: string, seq: number) {
  return {
    ...MOCK_TEST_PRINTED,
    id: `90000000-0000-4000-8000-${String(200 + seq).padStart(12, "0")}`,
    classId,
    studentId: null,
    status: "printed" as const,
    modified: false,
    testDate: "2026-08-14",
    printedAt: "2026-08-14T10:00:00+09:00",
  };
}

async function renderMain() {
  const user = userEvent.setup();
  const view = render(<MainPage />);
  await screen.findByRole("article", { name: "중2 심화반" });
  return { user, ...view };
}

describe("[T4.3 S-03] 메인 — MSW 기본 데이터 (스택)", () => {
  it("반 목록과 4단계 게이지, 우측 진도 패널을 보여 준다", async () => {
    await renderMain();

    expect(screen.getByText("오늘의수학")).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "중2 심화반" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "중2 기초반" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /중2 문제부족반/ }),
    ).toBeInTheDocument();

    expect(screen.getByText("남은 작업 3")).toBeInTheDocument();

    const gauges = screen.getAllByRole("group", { name: "진도 단계" });
    expect(gauges.length).toBeGreaterThanOrEqual(3);
    expect(within(gauges[0]!).getByText("진도")).toBeInTheDocument();
    expect(within(gauges[0]!).getByText("출제")).toBeInTheDocument();
    expect(within(gauges[0]!).getByText("검수")).toBeInTheDocument();
    expect(within(gauges[0]!).getByText("인쇄")).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "진도 입력" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "다음 차시로" }),
    ).toBeInTheDocument();
    expect(screen.getByText("이번 주")).toBeInTheDocument();
  });

  it("검수/인쇄 주 버튼은 해당 테스트 링크이고, 진도 입력은 링크가 아니다", async () => {
    await renderMain();

    const review = screen.getByRole("link", { name: "검수" });
    expect(review).toHaveAttribute("href", `/tests/${TEST_DRAFT_ID}`);

    const print = screen.getByRole("link", { name: "인쇄" });
    expect(print).toHaveAttribute("href", `/tests/${TEST_CONFIRMED_ID}/print`);

    expect(
      screen.getByRole("button", { name: "진도 입력" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "진도 입력" }),
    ).not.toBeInTheDocument();
  });

  it("카드·완료 줄이 44 | 1fr | 232 | 112 그리드이고 hot 카드는 흰 배경이다", async () => {
    await renderMain();

    const hot = screen.getByRole("article", { name: "중2 심화반" });
    expect(hot.className).toContain(CARD_GRID);
    expect(hot.className).toContain("bg-white");

    const printCard = screen.getByRole("article", { name: "중2 기초반" });
    expect(printCard.className).toContain(CARD_GRID);
  });

  it("심화반은 검수 단계 메타를, 기초반은 검수 완료 메타를 보여 준다", async () => {
    await renderMain();

    const reviewCard = screen.getByRole("article", { name: "중2 심화반" });
    expect(reviewCard).toHaveTextContent(MOCK_CURRENT_PROGRESS_UNIT.section);
    expect(reviewCard).toHaveTextContent("8문항 준비됨");
    expect(reviewCard).toHaveTextContent("일일테스트");

    const printCard = screen.getByRole("article", { name: "중2 기초반" });
    expect(printCard).toHaveTextContent("순환소수");
    expect(printCard).toHaveTextContent("검수 완료");
    expect(printCard).toHaveTextContent("확인테스트");
  });

  it("S-05 검수 UI(교체)와 느낌표·장식 이모지를 넣지 않는다", async () => {
    const { container } = await renderMain();

    expect(
      screen.queryByRole("button", { name: "교체" }),
    ).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/[!！]/);
    expect(container.textContent ?? "").not.toMatch(/[😀🎉✨🔥]/);
  });
});

describe("[T4.3 S-03] 메인 — 수동 전환·진도 1클릭", () => {
  it("전체 표 토글로 대장부(내일 테스트 열)를 열고 오늘 작업으로 돌아온다", async () => {
    const { user } = await renderMain();

    await user.click(screen.getByRole("button", { name: /전체 표/ }));

    expect(
      screen.getByRole("columnheader", { name: "내일 테스트" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "반" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "현재 진도" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("자동 준비 예약").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /오늘 작업/ }));

    expect(screen.getByRole("link", { name: "검수" })).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "내일 테스트" }),
    ).not.toBeInTheDocument();
  });

  it("다음 차시로를 누르면 패널 현재 소단원이 다음 차시로 바뀐다", async () => {
    const { user } = await renderMain();

    expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
      "순환소수를 포함한 식의 계산",
    );

    await user.click(screen.getByRole("button", { name: "다음 차시로" }));

    await waitFor(() => {
      expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
        "지수법칙",
      );
    });
  });

  it("카드의 진도 입력을 누르면 패널 반 선택이 그 반으로 바뀐다", async () => {
    const { user } = await renderMain();

    await user.click(screen.getByRole("button", { name: "진도 입력" }));

    const select = screen.getByLabelText("반 선택");
    expect(select).toHaveValue(CLASS_STARVED_ID);
    expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
      MOCK_UNITS[14]!.section,
    );
  });
});

describe("[T4.3 S-03] 메인 — 전부 완료면 대장부로 자동 전환", () => {
  it("모든 반이 인쇄 완료면 표를 열고 오늘 완료를 보여 준다", async () => {
    server.use(
      http.get("/api/tests", () =>
        HttpResponse.json({
          data: [
            printedClassTest(CLASS_A_ID, 1),
            printedClassTest(CLASS_B_ID, 2),
            printedClassTest(CLASS_STARVED_ID, 3),
          ],
          meta: { page: 1, pageSize: 20, total: 3 },
        }),
      ),
    );

    render(<MainPage />);

    expect(await screen.findByText("오늘 완료")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "내일 테스트" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/남은 작업/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "다시 보기" }).length).toBe(3);

    expect(
      screen.getByRole("heading", { name: "진도 입력" }),
    ).toBeInTheDocument();
  });

  it("일부만 완료면 스택 하단에 완료 한 줄 요약을 붙인다", async () => {
    server.use(
      http.get("/api/tests", () =>
        HttpResponse.json({
          data: [
            printedClassTest(CLASS_A_ID, 1),
            {
              ...MOCK_TEST_PRINTED,
              id: TEST_DRAFT_ID,
              classId: CLASS_B_ID,
              studentId: null,
              status: "draft",
              testDate: "2026-08-14",
              printedAt: null,
            },
          ],
          meta: { page: 1, pageSize: 20, total: 2 },
        }),
      ),
    );

    render(<MainPage />);

    const done = await screen.findByRole("status", {
      name: `${MOCK_CLASS_A.name} 완료`,
    });
    expect(done.className).toContain(CARD_GRID);
    expect(done).toHaveTextContent("인쇄됨");
    expect(done).toHaveTextContent("완료");
    expect(screen.getByText("남은 작업 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "검수" })).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: MOCK_CLASS_B.name }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: MOCK_CLASS_STARVED.name }),
    ).toBeInTheDocument();
  });
});
