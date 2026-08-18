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
  MOCK_EMPTY_PROBLEM_UNIT,
  MOCK_TEST_PRINTED,
  MOCK_UNITS,
  TEST_CONFIRMED_ID,
  TEST_DRAFT_ID,
} from "@/mocks/data";
import { server } from "@/mocks/server";

const CARD_GRID = "grid-cols-[44px_minmax(0,1fr)_232px_112px]";

// 일일테스트는 "현재 진도 차시"의 것만 오늘의 테스트로 잡히므로(pickActiveTest, 2026-08-14),
// 각 반의 현재 진도 단원을 rangeEndUnitId로 넣어야 그 반이 done/review로 정상 판정된다.
function printedClassTest(
  classId: string,
  seq: number,
  rangeEndUnitId: string,
) {
  return {
    ...MOCK_TEST_PRINTED,
    id: `90000000-0000-4000-8000-${String(200 + seq).padStart(12, "0")}`,
    classId,
    studentId: null,
    status: "printed" as const,
    modified: false,
    rangeEndUnitId,
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
  it("진도 API 장애를 진도 없음으로 위장하지 않는다", async () => {
    server.use(
      http.get(
        "/api/progress",
        () => new HttpResponse("broken", { status: 500 }),
      ),
    );

    render(<MainPage />);

    expect(
      await screen.findByText("목록을 불러오지 못했습니다"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "중2 심화반" }),
    ).not.toBeInTheDocument();
  });

  it("이번 주 지표는 테스트 목록이 아니라 metrics API 응답을 표시한다", async () => {
    server.use(
      http.get("/api/metrics", () =>
        HttpResponse.json({
          data: {
            weekStart: "2026-08-10",
            weekEnd: "2026-08-16",
            printedDays: 6,
            printedCount: 8,
            unmodifiedCount: 3,
            unmodifiedRate: 0.375,
            avgGenerateToPrintSeconds: 420,
          },
        }),
      ),
    );

    await renderMain();

    expect(screen.getByLabelText("이번 주 인쇄 일수")).toHaveTextContent("6");
    expect(screen.getByLabelText("이번 주 무수정 사용률")).toHaveTextContent(
      "38%",
    );
    expect(screen.getByText("인쇄 일수")).toBeInTheDocument();
  });

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
      screen.getByRole("button", { name: "이전 차시" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "다음 차시" }),
    ).toBeInTheDocument();
    expect(screen.getByText("차시이동")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "직접 선택" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("이번 주")).toBeInTheDocument();
  });

  it("검수/인쇄/출제 주 버튼은 해당 경로 링크다", async () => {
    await renderMain();

    const review = screen.getByRole("link", { name: "검수" });
    expect(review).toHaveAttribute("href", `/tests/${TEST_DRAFT_ID}`);

    const print = screen.getByRole("link", { name: "인쇄" });
    expect(print).toHaveAttribute("href", `/tests/${TEST_CONFIRMED_ID}/print`);

    const generate = screen.getByRole("link", { name: "출제" });
    expect(generate).toHaveAttribute(
      "href",
      `/tests/new?classId=${CLASS_STARVED_ID}`,
    );
  });

  // 배경이 원색 화이트가 되면서(2026-08-18) 「hot = 흰 표면」은 아무 것도 표시하지
  // 못하게 됐다 — 이 테스트가 그 죽은 신호를 지키고 있었다. 지금 처리 중인 반은
  // **왼쪽 잉크 바 + 굵은 밑선**으로 표시한다.
  it("카드 줄이 44 | 1fr | 232 | 112 그리드이고 hot 카드는 선으로 표시된다", async () => {
    await renderMain();

    const hot = screen.getByRole("article", { name: "중2 심화반" });
    expect(hot.className).toContain(CARD_GRID);
    expect(hot.className).toContain("border-ink");
    expect(hot.className).toMatch(/inset_5px/);
    expect(hot.className).not.toContain("bg-white");

    const printCard = screen.getByRole("article", { name: "중2 기초반" });
    expect(printCard.className).toContain(CARD_GRID);
    expect(printCard.className).toContain("border-divider");
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
    // 자동 준비 스케줄러는 없다 — 진도가 있으면 원장이 직접 출제하는 흐름이므로 "직접 출제".
    expect(screen.getAllByText("직접 출제").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /오늘 작업/ }));

    expect(screen.getByRole("link", { name: "검수" })).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "내일 테스트" }),
    ).not.toBeInTheDocument();
  });

  it("다음 차시를 누르면 패널 현재 소단원이 다음 차시로 바뀐다", async () => {
    const { user } = await renderMain();

    expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
      "순환소수를 포함한 식의 계산",
    );

    await user.click(screen.getByRole("button", { name: "다음 차시" }));

    await waitFor(() => {
      expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
        "지수법칙",
      );
    });
  });

  it("이전 차시를 누르면 패널 현재 소단원이 이전 차시로 바뀐다", async () => {
    const { user } = await renderMain();

    expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
      "순환소수를 포함한 식의 계산",
    );

    await user.click(screen.getByRole("button", { name: "이전 차시" }));

    await waitFor(() => {
      expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
        "순환소수의 분수 표현",
      );
    });
  });

  it("차시이동은 진도를 기록하지 않고 '진도 기록' 버튼으로만 커밋한다", async () => {
    let postCount = 0;
    let postedUnitId: string | null = null;
    server.use(
      http.post("/api/progress", async ({ request }) => {
        postCount += 1;
        const bodyJson = (await request.json()) as {
          classId: string;
          unitId: string;
        };
        postedUnitId = bodyJson.unitId;
        return HttpResponse.json(
          {
            data: {
              id: "00000000-0000-4000-8000-000000009999",
              classId: bodyJson.classId,
              studentId: null,
              unitId: bodyJson.unitId,
              recordedAt: "2026-08-14",
              createdAt: "2026-08-14T09:00:00Z",
            },
          },
          { status: 201 },
        );
      }),
    );

    const { user } = await renderMain();

    // 초기: 열람 위치 = 현재 진도 → 기록할 것이 없어 버튼 비활성
    const recordBtn = screen.getByRole("button", {
      name: "이 차시로 진도 기록",
    });
    expect(recordBtn).toBeDisabled();

    // 차시이동(열람) — 진도는 절대 기록되지 않는다(예전 버그: 클릭마다 기록)
    await user.click(screen.getByRole("button", { name: "다음 차시" }));
    await waitFor(() => {
      expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
        "지수법칙",
      );
    });
    expect(postCount).toBe(0);
    expect(recordBtn).toBeEnabled();

    // 명시적 기록 → POST 1회, 이동한 차시(417 지수법칙)로 커밋
    await user.click(recordBtn);
    await waitFor(() => expect(postCount).toBe(1));
    expect(postedUnitId).toBe(MOCK_UNITS[4]!.id);
  });

  it("패널에서 반을 바꾸면 현재 소단원이 그 반 진도로 바뀐다", async () => {
    const { user } = await renderMain();

    const select = screen.getByLabelText("반 선택");
    await user.selectOptions(select, CLASS_STARVED_ID);
    expect(select).toHaveValue(CLASS_STARVED_ID);
    expect(screen.getByLabelText("현재 소단원")).toHaveTextContent(
      MOCK_UNITS[14]!.section,
    );
  });
});

describe("[T4.3 S-03] 메인 — 마우스 어포던스", () => {
  it("반 카드 본체는 클릭 대상이 아니다", async () => {
    await renderMain();

    const card = screen.getByRole("article", { name: "중2 심화반" });
    expect(card.tagName).toBe("ARTICLE");
    expect(card.className).not.toMatch(/cursor-pointer/);
    expect(card).not.toHaveAttribute("onclick");
  });

  it("차시 화살표는 활성일 때만 손가락이다", async () => {
    await renderMain();

    const next = screen.getByRole("button", { name: "다음 차시" });
    const prev = screen.getByRole("button", { name: "이전 차시" });
    expect(next).toBeEnabled();
    expect(prev).toBeEnabled();
    expect(next.className).toMatch(/cursor-pointer/);
    expect(prev.className).toMatch(/cursor-pointer/);
  });

  it("대장부 행은 hover로 클릭처럼 보이지 않는다", async () => {
    const { user } = await renderMain();

    await user.click(screen.getByRole("button", { name: /전체 표/ }));

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    for (const row of rows.slice(1)) {
      expect(row.className).not.toMatch(/hover:bg-white/);
      expect(row.className).not.toMatch(/cursor-pointer/);
    }
    expect(screen.getByRole("link", { name: "검수" })).toBeInTheDocument();
  });
});

describe("[T4.3 S-03] 메인 — 전부 완료면 대장부로 자동 전환", () => {
  it("모든 반이 인쇄 완료면 표를 열고 오늘 완료를 보여 준다", async () => {
    server.use(
      http.get("/api/tests", () =>
        HttpResponse.json({
          data: [
            printedClassTest(CLASS_A_ID, 1, MOCK_CURRENT_PROGRESS_UNIT.id),
            printedClassTest(CLASS_B_ID, 2, MOCK_UNITS[1]!.id),
            printedClassTest(CLASS_STARVED_ID, 3, MOCK_EMPTY_PROBLEM_UNIT.id),
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
            printedClassTest(CLASS_A_ID, 1, MOCK_CURRENT_PROGRESS_UNIT.id),
            {
              ...MOCK_TEST_PRINTED,
              id: TEST_DRAFT_ID,
              classId: CLASS_B_ID,
              studentId: null,
              status: "draft",
              // 반 B의 현재 진도(414 순환소수)에 맞춰야 그 반의 오늘 테스트로 잡힌다.
              rangeEndUnitId: MOCK_UNITS[1]!.id,
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
