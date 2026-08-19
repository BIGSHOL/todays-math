/**
 * 🔴 RED → 🟢 GREEN — Phase 4, T4.3 S-04 출제 설정 (H5×G2, D-29)
 *
 * 구현: src/app/(main)/tests/new/page.tsx + src/components/test/GenerateSetup.tsx
 * 데이터: 기존 MSW class/student/test 핸들러 + 단원 목록
 *
 * 확정: docs/planning/05-design-system.md §8.6 S-04
 */
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NewTestPage from "@/app/(main)/tests/new/page";
import {
  CLASS_A_ID,
  CLASS_B_ID,
  CLASS_STARVED_ID,
  MOCK_CURRENT_PROGRESS_UNIT,
  MOCK_UNITS,
  MOCK_CLASS_A,
  MOCK_CLASS_B,
  MOCK_PROBLEMS,
  MOCK_REVIEW_RANGE_END_UNIT,
  MOCK_REVIEW_RANGE_START_UNIT,
  MOCK_STUDENT_1,
  MOCK_TEST_DRAFT,
  MOCK_TEST_DRAFT_PROBLEMS,
  STUDENT_IDS,
} from "@/mocks/data";
import { server } from "@/mocks/server";

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

async function renderSetup(search?: { classId?: string; studentId?: string }) {
  const user = userEvent.setup();
  const ui = await NewTestPage({
    searchParams: Promise.resolve(search ?? {}),
  });
  const view = render(ui);
  await screen.findByRole("heading", { name: "출제 설정" });
  await screen.findByRole("button", { name: "출제" });
  return { user, ...view };
}

describe("[T4.3 S-04] 출제 설정 — 폼 골격", () => {
  it("전폭 폼으로 반·유형·문항 수·난이도 배분·출제를 보여 준다", async () => {
    const { container } = await renderSetup();

    expect(screen.getByLabelText("반")).toBeInTheDocument();
    expect(screen.getByLabelText("학생")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "일일테스트" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "확인테스트" })).not.toBeChecked();
    expect(screen.getByLabelText("문항 수")).toBeInTheDocument();
    expect(screen.getByLabelText("하")).toBeInTheDocument();
    expect(screen.getByLabelText("중")).toBeInTheDocument();
    expect(screen.getByLabelText("상")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "출제" })).toBeInTheDocument();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/[!！]/);
    expect(container.textContent ?? "").not.toMatch(/[😀🎉✨🔥]/);
  });

  it("반 목록을 불러오고 선택 반의 기본 문항 수·난이도 배분을 채운다", async () => {
    const { user } = await renderSetup();

    const classSelect = screen.getByLabelText("반");
    expect(classSelect).toHaveDisplayValue(MOCK_CLASS_A.name);
    expect(screen.getByLabelText("문항 수")).toHaveValue(
      MOCK_CLASS_A.defaultProblemCount,
    );
    expect(screen.getByLabelText("하")).toHaveValue(
      MOCK_CLASS_A.difficultyRatio.easy,
    );
    expect(screen.getByLabelText("중")).toHaveValue(
      MOCK_CLASS_A.difficultyRatio.mid,
    );
    expect(screen.getByLabelText("상")).toHaveValue(
      MOCK_CLASS_A.difficultyRatio.hard,
    );

    await user.selectOptions(classSelect, CLASS_B_ID);

    expect(screen.getByLabelText("문항 수")).toHaveValue(
      MOCK_CLASS_B.defaultProblemCount,
    );
    expect(screen.getByLabelText("하")).toHaveValue(
      MOCK_CLASS_B.difficultyRatio.easy,
    );
    expect(screen.getByLabelText("중")).toHaveValue(
      MOCK_CLASS_B.difficultyRatio.mid,
    );
    expect(screen.getByLabelText("상")).toHaveValue(
      MOCK_CLASS_B.difficultyRatio.hard,
    );
  });

  it("query classId가 있으면 그 반을 미리 고른다", async () => {
    await renderSetup({ classId: CLASS_B_ID });

    expect(screen.getByLabelText("반")).toHaveValue(CLASS_B_ID);
    expect(screen.getByLabelText("문항 수")).toHaveValue(
      MOCK_CLASS_B.defaultProblemCount,
    );
  });

  /**
   * 🔴 RED → 🟢 — **범위는 진도가 정한다. 화면은 한 줄로 보여 준다.**
   *
   * 예전에는 소단원 select 두 개가 **전 교육과정 735개**를 늘어놓고, 기본값이
   * 「초1 첫 소단원 ~ 미적분2 마지막」이었다. 손대지 않고 출제하면 다섯 학년이
   * 섞인 시험지가 **오류도 경고도 없이** 나왔다(실측).
   *
   * 확정(2026-08-19, D-07 절차): Wire **C안**(평소 한 줄, 고칠 때만 펼침) →
   * Hi-fi **④ 범위 막대** → 펼침은 **㈟ 3열 피커 두 벌**(S-07 과 같은 것).
   */
  it("확인테스트면 범위를 한 줄로 보여 준다 — 평단 목록은 없다", async () => {
    const { user } = await renderSetup();

    expect(screen.queryByText(/~/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "확인테스트" }));

    // 기본값은 서버(`/api/tests/default-range`)가 준다 — 반 A 는 확인테스트를 낸 적이
    // 없으니 **진도 이력 첫 단원 ~ 현재 진도**다.
    await screen.findByText(
      `${MOCK_UNITS[0]!.section} ~ ${MOCK_CURRENT_PROGRESS_UNIT.section}`,
    );

    // ④ 막대의 라벨 — 「그 학년 전체에서 어디까지인가」.
    expect(
      screen.getByText(
        `${MOCK_CURRENT_PROGRESS_UNIT.grade} 소단원 ${MOCK_UNITS.length}개 중 1~4번째`,
      ),
    ).toBeInTheDocument();

    // 평소에는 고를 것이 없다 — 목록도 피커도 안 나온다.
    expect(screen.queryByLabelText("시작 소단원")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /범위 시작/ })).toBeNull();
  });

  it("「고치기」를 누르면 3열 피커가 시작·끝 두 벌 열린다", async () => {
    const { user } = await renderSetup();
    await user.click(screen.getByRole("radio", { name: "확인테스트" }));
    await screen.findByRole("button", { name: "고치기" });

    await user.click(screen.getByRole("button", { name: "고치기" }));

    const startPicker = screen.getByRole("group", { name: "범위 시작 소단원" });
    const endPicker = screen.getByRole("group", { name: "범위 끝 소단원" });
    // 3열 — 학년 | 대단원 | 소단원 (S-07 UnitTreePicker 그대로)
    expect(within(startPicker).getByText("학년")).toBeInTheDocument();
    expect(within(startPicker).getByText("대단원")).toBeInTheDocument();
    expect(within(endPicker).getByText("소단원")).toBeInTheDocument();
  });

  it("피커에서 끝을 바꾸면 한 줄과 출제 요청이 함께 바뀐다", async () => {
    let body: unknown;
    server.use(
      http.post("/api/tests/generate", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            data: {
              test: MOCK_TEST_DRAFT,
              problems: MOCK_TEST_DRAFT_PROBLEMS,
              shortfall: [],
            },
          },
          { status: 201 },
        );
      }),
    );

    const { user } = await renderSetup();
    await user.click(screen.getByRole("radio", { name: "확인테스트" }));
    await screen.findByRole("button", { name: "고치기" });
    await user.click(screen.getByRole("button", { name: "고치기" }));

    const endPicker = screen.getByRole("group", { name: "범위 끝 소단원" });
    await user.click(
      within(endPicker).getByRole("button", {
        name: MOCK_REVIEW_RANGE_END_UNIT.section,
      }),
    );

    await screen.findByText(
      `${MOCK_UNITS[0]!.section} ~ ${MOCK_REVIEW_RANGE_END_UNIT.section}`,
    );

    await user.click(screen.getByRole("button", { name: "출제" }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      testType: "review",
      rangeStartUnitId: MOCK_UNITS[0]!.id,
      rangeEndUnitId: MOCK_REVIEW_RANGE_END_UNIT.id,
    });
  });

  /**
   * 🔒 진도가 없으면 범위를 **지어내지 않는다**. 예전 기본값(초1~미적분2)이 바로
   * 그 «지어냄»이었다. 안내하고 원장이 직접 고르게 한다.
   */
  it("진도가 없어 범위를 못 내면 안내하고 출제를 막는다", async () => {
    server.use(
      http.get("/api/tests/default-range", () =>
        HttpResponse.json({ data: null }),
      ),
    );

    const { user } = await renderSetup();
    await user.click(screen.getByRole("radio", { name: "확인테스트" }));

    expect(
      await screen.findByText("진도 기록이 없어 범위를 정하지 못했습니다"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "출제" })).toBeDisabled();
  });

  it("문항 수를 고쳐도 고르던 범위가 그대로 살아 있다", async () => {
    const { user } = await renderSetup();
    await user.click(screen.getByRole("radio", { name: "확인테스트" }));
    await screen.findByRole("button", { name: "고치기" });
    await user.click(screen.getByRole("button", { name: "고치기" }));

    const endPicker = screen.getByRole("group", { name: "범위 끝 소단원" });
    await user.click(
      within(endPicker).getByRole("button", {
        name: MOCK_REVIEW_RANGE_END_UNIT.section,
      }),
    );

    const count = screen.getByLabelText("문항 수");
    await user.clear(count);
    await user.type(count, "12");

    expect(screen.getByLabelText("문항 수")).toHaveValue(12);
    expect(
      screen.getByText(
        `${MOCK_UNITS[0]!.section} ~ ${MOCK_REVIEW_RANGE_END_UNIT.section}`,
      ),
    ).toBeInTheDocument();
  });
});

describe("[T4.3 S-04] 출제 설정 — 출제 요청", () => {
  beforeEach(() => {
    nav.push.mockReset();
  });

  it("출제를 누르면 generate를 보내고 검수 화면으로 이동한다", async () => {
    const { user } = await renderSetup();

    await user.click(screen.getByRole("button", { name: "출제" }));

    await waitFor(() => {
      expect(nav.push).toHaveBeenCalled();
    });
    expect(String(nav.push.mock.calls[0]?.[0])).toMatch(
      /^\/tests\/[0-9a-f-]{36}$/i,
    );
  });

  it("학생을 고르면 출제 요청에 studentId를 넣는다", async () => {
    let body: unknown;
    server.use(
      http.post("/api/tests/generate", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            data: {
              test: {
                ...MOCK_TEST_DRAFT,
                id: "90000000-0000-4000-8000-000000000042",
                studentId: STUDENT_IDS[0],
              },
              problems: MOCK_TEST_DRAFT_PROBLEMS,
              shortfall: [],
            },
          },
          { status: 201 },
        );
      }),
    );

    const { user } = await renderSetup();
    await screen.findByRole("option", { name: MOCK_STUDENT_1.name });
    await user.selectOptions(screen.getByLabelText("학생"), MOCK_STUDENT_1.id);
    await user.click(screen.getByRole("button", { name: "출제" }));

    await waitFor(() => {
      expect(body).toMatchObject({
        classId: CLASS_A_ID,
        studentId: MOCK_STUDENT_1.id,
        testType: "daily",
      });
    });
    expect(nav.push).toHaveBeenCalledWith(
      "/tests/90000000-0000-4000-8000-000000000042",
    );
  });

  it("문항 수와 난이도 배분 합이 다르면 잘못된 출제 요청을 보내지 않는다", async () => {
    let called = false;
    server.use(
      http.post("/api/tests/generate", () => {
        called = true;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const { user } = await renderSetup();

    await user.clear(screen.getByLabelText("문항 수"));
    await user.type(screen.getByLabelText("문항 수"), "9");
    await user.click(screen.getByRole("button", { name: "출제" }));

    expect(
      await screen.findByText("난이도 배분의 합이 문항 수와 같아야 합니다"),
    ).toBeInTheDocument();
    expect(called).toBe(false);
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("[T4.3 S-04] 출제 설정 — 문제 부족", () => {
  beforeEach(() => {
    nav.push.mockReset();
  });

  it("부족하면 가용/필요와 AI 생성·문항 수 줄이기를 보여 준다", async () => {
    const { user } = await renderSetup();

    await user.selectOptions(screen.getByLabelText("반"), CLASS_STARVED_ID);
    await user.click(screen.getByRole("button", { name: "출제" }));

    expect(await screen.findByText(/가용 0/)).toBeInTheDocument();
    expect(screen.getByText(/필요 8/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 생성" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "문항 수 줄이기" }),
    ).toBeDisabled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("🔴 다른 사유로 재실패하면 낡은 부족 배너가 남지 않는다", async () => {
    const { user } = await renderSetup();

    // 1차 — 문제 부족(422). 가용/필요와 AI 생성 버튼이 뜬다.
    await user.selectOptions(screen.getByLabelText("반"), CLASS_STARVED_ID);
    await user.click(screen.getByRole("button", { name: "출제" }));
    expect(await screen.findByText(/가용 0/)).toBeInTheDocument();

    // 2차 — 같은 화면에서 전혀 다른 사유(500)로 실패.
    server.use(
      http.post("/api/tests/generate", () =>
        HttpResponse.json(
          { error: { code: "INTERNAL_ERROR", message: "서버 오류입니다" } },
          { status: 500 },
        ),
      ),
    );
    await user.click(screen.getByRole("button", { name: "출제" }));

    // 화면을 못 보는 사용자에게도 실패가 전달돼야 한다.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "서버 오류입니다",
    );
    // 옛 숫자와 AI 생성 버튼이 새 오류와 나란히 남으면 원장은 엉뚱한 걸 누른다.
    await waitFor(() => {
      expect(screen.queryByText(/가용 0/)).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "AI 생성" }),
    ).not.toBeInTheDocument();
  });

  it("문항 수 줄이기는 가용 수로 다시 출제한다", async () => {
    const generateBodies: unknown[] = [];
    server.use(
      http.post("/api/tests/generate", async ({ request }) => {
        const parsed = (await request.json()) as { problemCount?: number };
        generateBodies.push(parsed);
        if (parsed.problemCount === 3) {
          return HttpResponse.json(
            {
              data: {
                test: {
                  ...MOCK_TEST_DRAFT,
                  id: "90000000-0000-4000-8000-000000000043",
                },
                problems: MOCK_TEST_DRAFT_PROBLEMS,
                shortfall: [],
              },
            },
            { status: 201 },
          );
        }
        return HttpResponse.json(
          {
            error: {
              code: "INSUFFICIENT_PROBLEMS",
              message: "이 단원의 문제가 부족합니다.",
              details: {
                unitId: MOCK_REVIEW_RANGE_START_UNIT.id,
                available: 3,
                required: 8,
              },
            },
          },
          { status: 422 },
        );
      }),
    );

    const { user } = await renderSetup();
    await user.click(screen.getByRole("button", { name: "출제" }));

    const reduce = await screen.findByRole("button", {
      name: "문항 수 줄이기",
    });
    expect(screen.getByText(/가용 3/)).toBeInTheDocument();
    await user.click(reduce);

    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith(
        "/tests/90000000-0000-4000-8000-000000000043",
      );
    });
    expect(generateBodies.at(-1)).toMatchObject({ problemCount: 3 });
  });

  it("AI 생성은 pending으로 두고 승격 안내만 한다", async () => {
    let generated = false;
    let approved = false;
    server.use(
      http.post("/api/problems/generate", async () => {
        generated = true;
        return HttpResponse.json(
          {
            data: [
              {
                ...MOCK_PROBLEMS[0],
                reviewStatus: "pending",
                source: "ai_generated",
              },
            ],
          },
          { status: 201 },
        );
      }),
      http.patch(/\/api\/problems\/.+\/review-status$/, () => {
        approved = true;
        return HttpResponse.json({ data: MOCK_PROBLEMS[0] });
      }),
    );

    const { user } = await renderSetup();
    await user.selectOptions(screen.getByLabelText("반"), CLASS_STARVED_ID);
    await user.click(screen.getByRole("button", { name: "출제" }));
    await user.click(await screen.findByRole("button", { name: "AI 생성" }));

    expect(
      await screen.findByText(/문제은행에서 승격한 뒤 다시 출제하세요/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("alert").querySelector('a[href="/problems"]'),
    ).not.toBeNull();
    expect(generated).toBe(true);
    expect(approved).toBe(false);
    expect(nav.push).not.toHaveBeenCalled();
  });
});
