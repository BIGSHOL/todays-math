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

  it("확인테스트면 시작·끝 소단원을 보여 주고, 일일이면 숨긴다", async () => {
    const { user } = await renderSetup();

    expect(screen.queryByLabelText("시작 소단원")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("끝 소단원")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "확인테스트" }));

    const start = screen.getByLabelText("시작 소단원");
    const end = screen.getByLabelText("끝 소단원");
    expect(start).toBeInTheDocument();
    expect(end).toBeInTheDocument();
    expect(
      within(start).getByRole("option", {
        name: MOCK_REVIEW_RANGE_START_UNIT.section,
      }),
    ).toBeInTheDocument();
    expect(
      within(end).getByRole("option", {
        name: MOCK_REVIEW_RANGE_END_UNIT.section,
      }),
    ).toBeInTheDocument();
  });

  it("문항 수를 고친 뒤에도 소단원 선택이 그대로 살아 있다", async () => {
    // 소단원 option 은 실제로 1,472개다. 글자 하나마다 두 벌을 다시 조정하지
    // 않도록 select 를 memo 로 잘라 뒀는데, 잘못 자르면 핸들러가 옛 값을 붙든
    // 채 굳는다(고전적인 memo 사고). 그 방향을 잠근다.
    const { user } = await renderSetup();
    await user.click(screen.getByRole("radio", { name: "확인테스트" }));

    const start = screen.getByLabelText("시작 소단원");
    const kept = (start as HTMLSelectElement).value;

    const count = screen.getByLabelText("문항 수");
    await user.clear(count);
    await user.type(count, "12");

    expect(screen.getByLabelText("문항 수")).toHaveValue(12);
    // 목록·선택값 모두 그대로다.
    expect(screen.getByLabelText("시작 소단원")).toHaveValue(kept);
    await user.selectOptions(
      screen.getByLabelText("끝 소단원"),
      MOCK_REVIEW_RANGE_END_UNIT.id,
    );
    expect(screen.getByLabelText("끝 소단원")).toHaveValue(
      MOCK_REVIEW_RANGE_END_UNIT.id,
    );
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
