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
import { PROBLEM_CARD_MIN_WIDTH } from "@/components/print/tokens";
import { FIELD_SELECT_WIDTH } from "@/components/problem/FieldSelect";
import {
  MOCK_AI_GENERATED_PROBLEMS,
  MOCK_AI_TRANSFORMED_PROBLEMS,
  MOCK_PROBLEM_WITH_FRACTION,
  MOCK_PROBLEM_WITH_FIGURE,
  MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL,
  MOCK_PROBLEMS,
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
  it("AppChrome 내비와 학년/중단원/소단원/난이도/유형/상태 필터, 등록·생성을 보여 준다", async () => {
    await renderBank();

    expect(screen.getByRole("link", { name: "오늘의수학" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "문제은행" })).toHaveAttribute(
      "href",
      "/problems",
    );

    expect(screen.getByLabelText("학년")).toBeInTheDocument();
    expect(screen.getByLabelText("중단원")).toBeInTheDocument();
    expect(screen.getByLabelText("소단원")).toBeInTheDocument();
    // MOCK_UNITS는 전부 중2 — 학기 select는 초등 학년을 골랐을 때만 나타난다.
    expect(screen.queryByLabelText("학기")).not.toBeInTheDocument();
    expect(screen.getByLabelText("난이도")).toBeInTheDocument();
    expect(screen.getByLabelText("유형")).toBeInTheDocument();
    expect(screen.getByLabelText("상태")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "등록" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "생성" })).toBeInTheDocument();
    // 「변형」은 위쪽 액션이 아니다 — 문제 카드 안에서 연다(원장님 확정 2026-08-19).
    // 종전의 위쪽 드롭다운은 네이티브 select 라 수식을 못 그려 무엇을 고르는지 알 수 없었다.
    expect(
      screen.queryByRole("form", { name: "변형" }),
    ).not.toBeInTheDocument();
  });

  it("목록에서 분수·도형 수식을 MathText로 렌더하고 [교체]는 없다", async () => {
    const { container } = await renderBank();

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
    expect(screen.getByText(/를 유한소수로 나타내어라/)).toBeInTheDocument();

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
    expect(
      screen.queryByText(/를 유한소수로 나타내어라/),
    ).not.toBeInTheDocument();
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

    await user.selectOptions(screen.getByLabelText("소단원"), liveUnit.id);
    await user.click(screen.getByRole("button", { name: "등록" }));

    // 패널은 지연 청크다(ProblemPanelsLazy) — 단언은 그대로 두고 대기만 붙인다.
    const form = await screen.findByRole("form", { name: "등록" });
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

  it("유형·상태·소단원 필터를 조합하면 해당 문항만 남는다", async () => {
    const { user } = await renderBank();

    await user.selectOptions(screen.getByLabelText("유형"), "계산");
    await user.selectOptions(screen.getByLabelText("상태"), "approved");
    await user.selectOptions(
      screen.getByLabelText("소단원"),
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

    await user.selectOptions(
      screen.getByLabelText("소단원"),
      emptyComboUnit.id,
    );
    await user.selectOptions(screen.getByLabelText("난이도"), "hard");

    await waitFor(() => {
      expect(screen.getByText("등록된 문제가 없습니다")).toBeInTheDocument();
    });
  });
});

describe("[S-08] 문제은행 — 계단식 단원 필터 (MSW)", () => {
  // MOCK_UNITS: 전부 중2 — "1. 수와 식"(0~7) + "2. 부등식"(8~14).
  const SUWASIK_UNIT = MOCK_UNITS[0]!;
  const BUDEUNGSIK_UNIT = MOCK_UNITS[8]!;

  const EMPTY_LIST = {
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  };

  /** MOCK_UNITS에는 초등 학년이 없어 학기 select 케이스는 픽스처 주입으로 재현한다. */
  const ELEMENTARY_FIXTURE_UNITS = [
    {
      id: "e0000000-0000-4000-8000-000000000001",
      grade: "초1",
      chapter: "1-1 9까지의 수",
      section: "9까지의 수",
      orderIndex: 1,
    },
    {
      id: "e0000000-0000-4000-8000-000000000002",
      grade: "초1",
      chapter: "1-2 덧셈과 뺄셈",
      section: "모으기와 가르기",
      orderIndex: 2,
    },
    {
      id: "e0000000-0000-4000-8000-000000000003",
      grade: "초1",
      chapter: "2-1 100까지의 수",
      section: "100까지의 수",
      orderIndex: 3,
    },
    {
      id: "e0000000-0000-4000-8000-000000000004",
      grade: "중3",
      chapter: "1. 실수와 그 연산",
      section: "제곱근의 뜻과 성질",
      orderIndex: 4,
    },
  ];

  function captureProblemQueries() {
    const captured: URLSearchParams[] = [];
    server.use(
      http.get("/api/problems", ({ request }) => {
        captured.push(new URL(request.url).searchParams);
        return HttpResponse.json(EMPTY_LIST);
      }),
    );
    return captured;
  }

  it("학년 옵션은 units에서 파생되고, 학년 선택 전에는 중단원을 고를 수 없다", async () => {
    await renderBank();

    const gradeSelect = screen.getByLabelText("학년");
    expect(
      within(gradeSelect).getByRole("option", { name: "전체" }),
    ).toBeInTheDocument();
    expect(
      within(gradeSelect).getByRole("option", { name: "중2" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("중단원")).toBeDisabled();
    expect(screen.getByLabelText("소단원")).toBeEnabled();
  });

  it("중단원을 고르면 그 범위로 좁혀지고 소단원 옵션도 좁아진다", async () => {
    const { user } = await renderBank();

    await user.selectOptions(screen.getByLabelText("학년"), "중2");
    await waitFor(() => {
      expect(screen.getByText(/를 유한소수로 나타내어라/)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByLabelText("중단원"),
      BUDEUNGSIK_UNIT.chapter,
    );

    await screen.findByText(/부등식인 것을 모두 고르시오/);
    expect(
      screen.queryByText(/를 유한소수로 나타내어라/),
    ).not.toBeInTheDocument();

    const sectionSelect = screen.getByLabelText("소단원");
    expect(
      within(sectionSelect).getByRole("option", {
        name: BUDEUNGSIK_UNIT.section,
      }),
    ).toBeInTheDocument();
    expect(
      within(sectionSelect).queryByRole("option", {
        name: SUWASIK_UNIT.section,
      }),
    ).not.toBeInTheDocument();
  });

  it("소단원까지 고르면 서버에는 unitId만 보낸다 (필터 우선순위)", async () => {
    const { user } = await renderBank();
    await user.selectOptions(screen.getByLabelText("학년"), "중2");
    await user.selectOptions(
      screen.getByLabelText("중단원"),
      BUDEUNGSIK_UNIT.chapter,
    );
    await screen.findByText(/부등식인 것을 모두 고르시오/);

    const captured = captureProblemQueries();
    await user.selectOptions(
      screen.getByLabelText("소단원"),
      BUDEUNGSIK_UNIT.id,
    );
    await screen.findByText("등록된 문제가 없습니다");

    const params = captured.at(-1)!;
    expect(params.get("unitId")).toBe(BUDEUNGSIK_UNIT.id);
    expect(params.get("grade")).toBeNull();
    expect(params.get("chapter")).toBeNull();
    expect(params.get("chapterPrefix")).toBeNull();
  });

  it("초등 학년을 고르면 학기 select가 나타나고 grade+chapterPrefix를 보낸다", async () => {
    server.use(
      http.get("/api/units", () =>
        HttpResponse.json({ data: ELEMENTARY_FIXTURE_UNITS }),
      ),
    );
    const { user } = await renderBank();
    expect(screen.queryByLabelText("학기")).not.toBeInTheDocument();

    const captured = captureProblemQueries();
    await user.selectOptions(screen.getByLabelText("학년"), "초1");
    const semesterSelect = await screen.findByLabelText("학기");
    await user.selectOptions(semesterSelect, "1");

    await waitFor(() => {
      expect(captured.at(-1)?.get("chapterPrefix")).toBe("1-");
    });
    const params = captured.at(-1)!;
    expect(params.get("grade")).toBe("초1");
    expect(params.get("chapter")).toBeNull();
    expect(params.get("unitId")).toBeNull();

    const chapterSelect = screen.getByLabelText("중단원");
    expect(
      within(chapterSelect).getByRole("option", { name: "1-1 9까지의 수" }),
    ).toBeInTheDocument();
    expect(
      within(chapterSelect).queryByRole("option", { name: "2-1 100까지의 수" }),
    ).not.toBeInTheDocument();
  });

  it("초등이 아닌 학년으로 바꾸면 학기 select가 사라지고 학기 필터도 풀린다", async () => {
    server.use(
      http.get("/api/units", () =>
        HttpResponse.json({ data: ELEMENTARY_FIXTURE_UNITS }),
      ),
    );
    const { user } = await renderBank();

    const captured = captureProblemQueries();
    await user.selectOptions(screen.getByLabelText("학년"), "초1");
    await user.selectOptions(await screen.findByLabelText("학기"), "2");
    await waitFor(() => {
      expect(captured.at(-1)?.get("chapterPrefix")).toBe("2-");
    });

    await user.selectOptions(screen.getByLabelText("학년"), "중3");
    expect(screen.queryByLabelText("학기")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(captured.at(-1)?.get("grade")).toBe("중3");
    });
    expect(captured.at(-1)?.get("chapterPrefix")).toBeNull();
  });

  it("상위 select를 바꾸면 하위 선택이 전체로 돌아가고 1페이지부터 본다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(screen.getByLabelText("학년"), "중2");
    await user.selectOptions(
      screen.getByLabelText("중단원"),
      BUDEUNGSIK_UNIT.chapter,
    );
    await user.selectOptions(
      screen.getByLabelText("소단원"),
      BUDEUNGSIK_UNIT.id,
    );
    await screen.findByText(/부등식인 것을 모두 고르시오/);

    await user.selectOptions(screen.getByLabelText("학년"), "");

    await screen.findByText(/를 유한소수로 나타내어라/);
    expect(screen.getByLabelText("중단원")).toHaveValue("");
    expect(screen.getByLabelText("중단원")).toBeDisabled();
    expect(screen.getByLabelText("소단원")).toHaveValue("");
    expect(screen.getAllByText(/^1 \/ \d+ 페이지$/).length).toBeGreaterThan(0);
  });

  it("중단원 필터와 다른 단원에 등록한 새 문제는 목록에 끼워 넣지 않는다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(screen.getByLabelText("학년"), "중2");
    await user.selectOptions(
      screen.getByLabelText("중단원"),
      BUDEUNGSIK_UNIT.chapter,
    );
    await screen.findByText(/부등식인 것을 모두 고르시오/);

    await user.click(screen.getByRole("button", { name: "등록" }));
    const form = screen.getByRole("form", { name: "등록" });
    await user.selectOptions(
      within(form).getByLabelText("단원"),
      SUWASIK_UNIT.id,
    );
    await user.selectOptions(within(form).getByLabelText("출처"), "manual");
    await user.selectOptions(within(form).getByLabelText("난이도"), "easy");
    await user.selectOptions(within(form).getByLabelText("유형"), "계산");
    await user.type(
      within(form).getByLabelText("본문"),
      "다른 중단원의 문제 $1+1$",
    );
    await user.type(within(form).getByLabelText("정답"), "2");
    await user.click(within(form).getByRole("button", { name: "등록하기" }));

    // 안내는 「만들었다」에서 멈추지 않고 **화면에 몇 건 보이는지**까지 말한다.
    // 종전에는 "1건 등록"이라 해 놓고 목록에도 총계에도 변화가 없어 실패로 읽혔다.
    await screen.findByText("1건 등록 — 현재 필터에 0건만 보입니다");
    expect(screen.queryByText(/다른 중단원의 문제/)).not.toBeInTheDocument();
  });

  it("중단원 필터 범위 단원에 등록한 새 문제는 목록 앞에 나타난다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(screen.getByLabelText("학년"), "중2");
    await user.selectOptions(
      screen.getByLabelText("중단원"),
      BUDEUNGSIK_UNIT.chapter,
    );
    await screen.findByText(/부등식인 것을 모두 고르시오/);

    await user.click(screen.getByRole("button", { name: "등록" }));
    const form = screen.getByRole("form", { name: "등록" });
    await user.selectOptions(
      within(form).getByLabelText("단원"),
      BUDEUNGSIK_UNIT.id,
    );
    await user.selectOptions(within(form).getByLabelText("출처"), "manual");
    await user.selectOptions(within(form).getByLabelText("난이도"), "easy");
    await user.selectOptions(within(form).getByLabelText("유형"), "계산");
    await user.type(
      within(form).getByLabelText("본문"),
      "같은 중단원의 문제 $1+1$",
    );
    await user.type(within(form).getByLabelText("정답"), "2");
    await user.click(within(form).getByRole("button", { name: "등록하기" }));

    await screen.findByText("1건 등록");
    expect(screen.getByText(/같은 중단원의 문제/)).toBeInTheDocument();
  });
});

describe("[T3.3 S-08] 문제은행 — 페이지네이션", () => {
  // MSW 전체 풀 = 등록형 30 + 그림 문항 1 + 타 사용자 shared 1 + AI 생성/변형 픽스처
  const TOTAL =
    MOCK_PROBLEMS.length +
    2 +
    MOCK_AI_GENERATED_PROBLEMS.length +
    MOCK_AI_TRANSFORMED_PROBLEMS.length;

  it("20건 단위로 나누고 다음/이전으로 이동한다", async () => {
    const { user, container } = await renderBank();

    expect(container.querySelectorAll("article")).toHaveLength(20);
    expect(screen.getAllByText(`총 ${TOTAL}문제`).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 / 2 페이지").length).toBeGreaterThan(0);
    const prev = screen.getAllByRole("button", { name: "이전" })[0]!;
    const next = screen.getAllByRole("button", { name: "다음" })[0]!;
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    await user.click(next);

    // MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL(30번째)은 2페이지에 있다
    await screen.findByText(/밑변의 길이가/);
    expect(container.querySelectorAll("article")).toHaveLength(TOTAL - 20);
    expect(screen.getAllByText("2 / 2 페이지").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/를 유한소수로 나타내어라/),
    ).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "다음" })) {
      expect(button).toBeDisabled();
    }
  });

  it("2페이지에서 이전을 누르면 1페이지로 돌아온다", async () => {
    const { user } = await renderBank();
    await user.click(screen.getAllByRole("button", { name: "다음" })[0]!);
    await screen.findByText(/밑변의 길이가/);

    await user.click(screen.getAllByRole("button", { name: "이전" })[0]!);

    await screen.findByText(/를 유한소수로 나타내어라/);
    expect(screen.getAllByText("1 / 2 페이지").length).toBeGreaterThan(0);
  });

  it("필터를 바꾸면 1페이지로 돌아간다", async () => {
    const { user } = await renderBank();
    await user.click(screen.getAllByRole("button", { name: "다음" })[0]!);
    await screen.findByText(/밑변의 길이가/);

    await user.selectOptions(screen.getByLabelText("난이도"), "easy");

    await screen.findByText(/를 유한소수로 나타내어라/);
    expect(screen.getAllByText(/^1 \/ \d+ 페이지$/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "이전" })[0]!).toBeDisabled();
  });
});

describe("[T3.3 S-08] 문제은행 — 등록/생성/변형", () => {
  it("활성 필터와 다른 새 문제를 결과 목록에 끼워 넣지 않는다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(screen.getByLabelText("난이도"), "hard");
    await screen.findByText(/밑변의 길이가/);
    await user.click(screen.getByRole("button", { name: "등록" }));

    // 패널은 지연 청크다(ProblemPanelsLazy) — 단언은 그대로 두고 대기만 붙인다.
    const form = await screen.findByRole("form", { name: "등록" });
    await user.selectOptions(within(form).getByLabelText("출처"), "manual");
    await user.selectOptions(within(form).getByLabelText("난이도"), "easy");
    await user.selectOptions(within(form).getByLabelText("유형"), "계산");
    await user.type(
      within(form).getByLabelText("본문"),
      "필터에서 제외할 문제 $1+1$",
    );
    await user.type(within(form).getByLabelText("정답"), "2");
    await user.click(within(form).getByRole("button", { name: "등록하기" }));

    await screen.findByText("1건 등록 — 현재 필터에 0건만 보입니다");
    expect(screen.queryByText(/필터에서 제외할 문제/)).not.toBeInTheDocument();
    expect(screen.getByText(/밑변의 길이가/)).toBeInTheDocument();
  });

  it("등록하면 작성한 본문이 목록 앞에 나타난다", async () => {
    const { user } = await renderBank();
    await user.click(screen.getByRole("button", { name: "등록" }));

    // 패널은 지연 청크다(ProblemPanelsLazy) — 단언은 그대로 두고 대기만 붙인다.
    const form = await screen.findByRole("form", { name: "등록" });
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
      screen.getByLabelText("소단원"),
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

  it("카드에서 변형하면 후보를 먼저 보여 주고, 채택한 것만 목록에 들어온다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(
      screen.getByLabelText("소단원"),
      MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL.unitId,
    );
    await waitFor(() => {
      expect(screen.getByText(/밑변의 길이가/)).toBeInTheDocument();
      expect(
        screen.queryByText(/을 유한소수로 나타내어라/),
      ).not.toBeInTheDocument();
    });

    // 고르는 자리가 곧 보고 있는 자리다 — 카드마다 「변형」이 붙는다.
    await user.click(screen.getAllByRole("button", { name: "변형" })[0]!);
    const panel = screen.getByRole("region", { name: "변형" });
    await user.click(within(panel).getByRole("button", { name: "변형하기" }));

    // 후보가 뜬 시점에는 **아직 은행에 없다** — 미리보기 단계다.
    await within(panel).findByText(/변형 결과/);
    expect(screen.queryByText(/건 변형$/)).not.toBeInTheDocument();

    await user.click(
      within(panel).getByRole("button", { name: "채택분 저장" }),
    );

    await screen.findByText("1건 변형");
    expect(screen.getByText(/을 유한소수로 나타내어라/)).toBeInTheDocument();
    expect(MOCK_AI_TRANSFORMED_PROBLEMS[0]!.content).toContain("11");
  });

  /** 그림 문항 카드를 열고 변형 패널을 띄운다 — 도형 갈래 테스트가 같이 쓴다. */
  async function openFigureTransform(
    user: ReturnType<typeof userEvent.setup>,
    count?: string,
  ) {
    await user.selectOptions(
      screen.getByLabelText("소단원"),
      MOCK_PROBLEM_WITH_FIGURE.unitId,
    );
    await waitFor(() => {
      expect(screen.getByText(/직각삼각형 ABC 의 넓이/)).toBeInTheDocument();
    });
    const card = screen
      .getByText(/직각삼각형 ABC 의 넓이/)
      .closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "변형" }));
    const panel = within(card).getByRole("region", { name: "변형" });
    if (count) {
      await user.selectOptions(within(panel).getByLabelText("개수"), count);
    }
    await user.click(within(panel).getByRole("button", { name: "변형하기" }));
    await within(panel).findByText(/변형 결과/);
    return panel;
  }

  it("그림 문항은 도형을 새로 그려 보여 주고, 그려진 후보는 채택할 수 있다", async () => {
    const { user } = await renderBank();
    const panel = await openFigureTransform(user);

    // 왜 도형이 붙어 있는지를 먼저 말한다.
    expect(within(panel).getByRole("status")).toHaveTextContent(
      /그림이 있어야 풀리는 문항/,
    );
    // 서버가 그려 준 SVG 가 실제로 지면에 들어간다.
    expect(
      panel.querySelector("[data-figure-preview] svg"),
    ).toBeInTheDocument();
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
    expect(
      within(panel).getByRole("button", { name: "채택분 저장" }),
    ).toBeEnabled();
  });

  it("도형을 못 그린 후보는 사유와 함께 채택할 수 없다", async () => {
    const { user } = await renderBank();
    // mock 은 첫 후보를 «도형 못 그림», 마지막을 «재현 검사 실패» 로 둔다.
    const panel = await openFigureTransform(user, "2");

    expect(
      within(panel).getByText(/도형 없음 — .*도형을 확정하지 못했습니다/),
    ).toBeInTheDocument();
    // 도형이 없으면 재현 검사를 통과했어도 못 쓴다 — 본문이 그림을 가리킨 채로 나간다.
    expect(within(panel).queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      within(panel).getByRole("button", { name: "채택분 저장" }),
    ).toBeDisabled();
  });

  it("원본 재현 검사에 떨어진 후보는 사유와 함께 「폐기」로 보이고 채택할 수 없다", async () => {
    const { user } = await renderBank();
    await user.selectOptions(
      screen.getByLabelText("소단원"),
      MOCK_PROBLEM_WITH_GEOMETRY_SYMBOL.unitId,
    );
    await waitFor(() => {
      expect(screen.getByText(/밑변의 길이가/)).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "변형" })[0]!);
    const panel = screen.getByRole("region", { name: "변형" });
    // mock 은 마지막 하나를 일부러 탈락시킨다 — 2개를 뽑아야 그 경로가 나온다.
    await user.selectOptions(within(panel).getByLabelText("개수"), "2");
    await user.click(within(panel).getByRole("button", { name: "변형하기" }));

    await within(panel).findByText(/변형 결과 2건/);
    // 「몇 개 왔다」가 아니라 **왜 못 쓰는지**가 보여야 한다.
    expect(within(panel).getByText("폐기")).toBeInTheDocument();
    expect(
      within(panel).getByText(/원본 재현 검사 실패 — 재현값/),
    ).toBeInTheDocument();
    // 탈락 후보에는 채택 체크박스가 없다 — 통과한 하나만 고를 수 있다.
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(panel).getByText("채택 1건")).toBeInTheDocument();
  });
});

/**
 * 2026-08-17 원장님 지시 — "문제 보기 우측 공간 너무 많이 남아서 기본 2단에
 * 창 크기에 따라서 3단 혹은 1단 자동화해야겠고 (너무 좁은 창 방지 필요하긴함)".
 *
 * jsdom 은 레이아웃을 계산하지 않으므로 **열 규칙 자체**를 잠근다. 실제 열 수는
 * 실물 브라우저 실측으로 확인했다 (docs/planning/tracks/reports/render-a-layout.md).
 */
describe("[렌더 수리 A] 문제은행 — 목록 다단 배치", () => {
  it("남는 폭에 반응하는 auto-fit 그리드로 깐다 (브레이크포인트 하드코딩 없음)", async () => {
    const { container } = await renderBank();
    const grid = container.querySelector<HTMLElement>("[data-problem-grid]");

    expect(grid).not.toBeNull();
    expect(grid!.className).toContain("grid");
    expect(grid!.style.gridTemplateColumns).toContain("auto-fit");
  });

  it("열 하한은 카드 최소 폭 — 그보다 좁으면 100%로 떨어져 1단이 된다", async () => {
    const { container } = await renderBank();
    const grid = container.querySelector<HTMLElement>("[data-problem-grid]")!;

    // min(100%, <카드 최소 폭>) — 너무 좁은 창에서 가로 스크롤 대신 1단으로.
    expect(grid.style.gridTemplateColumns).toContain("min(100%,");
    expect(grid.style.gridTemplateColumns).toContain(PROBLEM_CARD_MIN_WIDTH);
  });

  it("카드에 세로 여백을 겹쳐 주지 않는다 — 간격은 그리드 gap 하나만", async () => {
    const { container } = await renderBank();
    const card = container.querySelector("[data-problem-grid] article");

    expect(card).not.toBeNull();
    expect(card!.className).not.toMatch(/(^|\s)mb-6(\s|$)/);
  });
});

/**
 * 2026-08-17 원장님 지시 — "필터 선택할때마다 크기 제각각인데 고정된 크기에서
 * 선택만 바뀌도록", 이어서 "드랍다운 버튼은 그대로 두고, 드랍다운 목록을 키우는걸로
 * 가로너비".
 *
 * jsdom 은 레이아웃을 계산하지 않으므로 **폭 규칙**과 **말줄임/툴팁 장치**를 잠근다.
 * 실제 폭(모든 칸 192px, 선택을 바꿔도 동일)과 네이티브 팝업 폭(394px)은 실물
 * Chrome 실측으로 확인했다 (docs/planning/tracks/reports/render-a-layout.md §5).
 */
describe("[렌더 수리 A] 문제은행 — 필터 폭 고정", () => {
  it("필터 바는 고정 폭 트랙 그리드다 — 내용에 따라 늘어나지 않는다", async () => {
    const { container } = await renderBank();
    const bar = container.querySelector<HTMLElement>("[data-filter-bar]");

    expect(bar).not.toBeNull();
    expect(bar!.className).toContain("grid");
    // minmax/1fr 이 아니라 **고정 트랙**이어야 선택값·옵션 길이에 흔들리지 않는다.
    expect(bar!.style.gridTemplateColumns).toBe(
      `repeat(auto-fill, ${FIELD_SELECT_WIDTH})`,
    );
  });

  it("칸이 늘거나 줄어도(학기 칸) 폭이 그대로다 — auto-fill 이라 트랙이 유지된다", async () => {
    const { container } = await renderBank();
    const bar = container.querySelector<HTMLElement>("[data-filter-bar]")!;

    expect(bar.style.gridTemplateColumns).toContain("auto-fill");
    expect(bar.style.gridTemplateColumns).not.toContain("auto-fit");
  });

  it("select 는 칸을 채우고 넘치는 값은 말줄임한다", async () => {
    await renderBank();
    const select = screen.getByLabelText("소단원");

    expect(select.className).toContain("w-full");
    expect(select.className).toContain("text-ellipsis");
    expect(select.className).toContain("overflow-hidden");
    expect(select.className).toContain("whitespace-nowrap");
  });

  it("잘려도 무엇을 골랐는지 알 수 있게 선택값을 title 로 노출한다", async () => {
    const { user } = await renderBank();
    const select = screen.getByLabelText("소단원");

    expect(select).toHaveAttribute("title", "전체");

    const unit = MOCK_UNITS[0]!;
    await user.selectOptions(select, unit.id);
    await waitFor(() => {
      expect(select).toHaveAttribute("title", unit.section);
    });
  });
});

/**
 * 🔴 RED → 🟢 GREEN — 「그림 있는 문제만」 필터 (원장님 지시 2026-08-18).
 *
 * 실측 근거: DB 47,152건 중 그림(`figureUrls`)이 있는 문항은 8,442건(17.9%)뿐이라
 * 그림 문항을 찾으려면 은행을 통째로 넘겨야 했다. `figureSvg` 는 아직 0건이지만
 * 스키마상 그림의 다른 갈래라 서버 조건에 함께 넣는다.
 */
describe("[S-08] 문제은행 — 자료 토글 그림·해설·정답 (MSW)", () => {
  const EMPTY_LIST = { data: [], meta: { page: 1, pageSize: 20, total: 0 } };

  function captureQueries() {
    const captured: URLSearchParams[] = [];
    server.use(
      http.get("/api/problems", ({ request }) => {
        captured.push(new URL(request.url).searchParams);
        return HttpResponse.json(EMPTY_LIST);
      }),
    );
    return captured;
  }

  it("체크박스를 보여 주고 기본은 꺼져 있다", async () => {
    await renderBank();

    const box = screen.getByRole("checkbox", { name: "그림" });
    expect(box).toBeInTheDocument();
    expect(box).not.toBeChecked();
  });

  it("켜면 hasFigure=true 로 조회하고, 끄면 다시 빠진다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(screen.getByRole("checkbox", { name: "그림" }));
    await waitFor(() => {
      expect(captured.at(-1)?.get("hasFigure")).toBe("true");
    });

    await user.click(screen.getByRole("checkbox", { name: "그림" }));
    await waitFor(() => {
      expect(captured.at(-1)?.has("hasFigure")).toBe(false);
    });
  });

  it("켜면 1페이지부터 다시 본다 — 켠 채로 옛 페이지에 남으면 빈 화면이 된다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(screen.getByRole("checkbox", { name: "그림" }));
    await waitFor(() => {
      expect(captured.at(-1)?.get("page")).toBe("1");
    });
  });
});

/**
 * 🔴 RED → 🟢 GREEN — 「자료」 토글 셋 (원장님 지시 2026-08-19).
 *
 * 「그림 있는 문제만」 하나였던 자리를 **그림 · 해설 · 정답** 셋으로 넓힌다.
 *
 * ## 왜 셋 다 뜻이 있나 — 만들기 전에 실측으로 확인했다 (DB 47,152건)
 *
 *   그림 있음  9,448 (20.0%)   `figureUrls` 또는 `figureSvg`
 *   해설 있음 13,909 (29.5%)   `solution` 이 비지 않음
 *   정답 있음 45,041 (95.5%)   ← ⚠️ 여기가 함정이었다
 *
 * ⚠️ **`answer` 는 빈 값이 0건이다.** 「비어 있지 않은가」로 만들면 100% 를 통과시켜
 *    아무것도 안 거른다. 실제 자리표시자는 **`(정답 없음)` 문자열 2,111건**이다.
 *    「빈 값」이 빈 문자열이 아니라 **글자로 적힌 자리표시자**인 것은 이 저장소에서
 *    되풀이된 부류다(CLAUDE.md 2026-08-18 「빈 컬럼이 결함이 아니라 판별자였다」).
 *
 * 셋은 **서로 독립**이다 — 켠 것을 모두 만족하는 문항만 남는다(AND).
 */
describe("[S-08] 문제은행 — 해설·정답 토글 (MSW)", () => {
  const EMPTY_LIST = { data: [], meta: { page: 1, pageSize: 20, total: 0 } };

  function captureQueries() {
    const captured: URLSearchParams[] = [];
    server.use(
      http.get("/api/problems", ({ request }) => {
        captured.push(new URL(request.url).searchParams);
        return HttpResponse.json(EMPTY_LIST);
      }),
    );
    return captured;
  }

  it("셋을 다 보여 주고 기본은 전부 꺼져 있다", async () => {
    await renderBank();

    for (const name of ["그림", "해설", "정답"]) {
      const box = screen.getByRole("checkbox", { name });
      expect(box).toBeInTheDocument();
      expect(box).not.toBeChecked();
    }
  });

  it("셋이 한 묶음으로 묶여 있다 — 이름만으로는 무엇을 거르는지 모른다", async () => {
    await renderBank();
    // `그림` 한 글자로는 「그림이 있는 것만」인지 「그림 종류」인지 알 수 없다.
    // 묶음 이름이 그 뜻을 지고 있어야 한다.
    expect(screen.getByRole("group", { name: "자료" })).toBeInTheDocument();
  });

  it("해설을 켜면 hasSolution=true 로 조회하고, 끄면 다시 빠진다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(screen.getByRole("checkbox", { name: "해설" }));
    await waitFor(() => {
      expect(captured.at(-1)?.get("hasSolution")).toBe("true");
    });

    await user.click(screen.getByRole("checkbox", { name: "해설" }));
    await waitFor(() => {
      expect(captured.at(-1)?.has("hasSolution")).toBe(false);
    });
  });

  it("정답을 켜면 hasAnswer=true 로 조회한다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(screen.getByRole("checkbox", { name: "정답" }));
    await waitFor(() => {
      expect(captured.at(-1)?.get("hasAnswer")).toBe("true");
    });
  });

  it("셋을 같이 켜면 셋 다 붙는다 — 서로를 지우지 않는다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(screen.getByRole("checkbox", { name: "그림" }));
    await user.click(screen.getByRole("checkbox", { name: "해설" }));
    await user.click(screen.getByRole("checkbox", { name: "정답" }));

    await waitFor(() => {
      const q = captured.at(-1)!;
      expect(q.get("hasFigure")).toBe("true");
      expect(q.get("hasSolution")).toBe("true");
      expect(q.get("hasAnswer")).toBe("true");
    });
  });

  it("해설·정답도 1페이지부터 다시 본다 — 켠 채로 옛 페이지에 남으면 빈 화면이 된다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(screen.getByRole("checkbox", { name: "해설" }));
    await waitFor(() => {
      expect(captured.at(-1)?.get("page")).toBe("1");
    });
  });
});

/**
 * 🔴 RED → 🟢 GREEN — 문항 본문 검색 (원장님 지시 2026-08-19).
 *
 * ## 실측 근거 (`id-find-review.md`, DB 47,152건)
 *
 * 소단원까지 좁혀도 목표 문항이 **중앙 7페이지째 · p90 34페이지째**에 있고,
 * 이동은 「이전/다음」뿐이라 건너뛸 수 없다. 본문 한 구절로 **유일 특정은
 * 29.5~33.0%** 뿐이지만 **소단원 필터와 겹치면 중앙 2행** — 한 페이지 안이다.
 * 그래서 검색은 **필터를 대체하지 않고 겹쳐 쓰는** 물건이다.
 *
 * ⚠️ 17.4%(8,187행)는 **옮겨 적을 한글 구절이 아예 없어** 구조적으로 못 찾는다.
 *    검색이 만능이 아니라는 뜻이고, 그래서 자료 토글·단원 필터가 계속 필요하다.
 *
 * ⚠️ 서버 실측 277~289ms(Seq Scan)이다. 글자마다 조회하면 안 된다 — **디바운스**가
 *    있어야 한다. 그 사실을 테스트가 잠근다(타자 중에는 안 나가고, 멎으면 한 번 나간다).
 */
describe("[S-08] 문제은행 — 본문 검색 (MSW)", () => {
  const EMPTY_LIST = { data: [], meta: { page: 1, pageSize: 20, total: 0 } };

  function captureQueries() {
    const captured: URLSearchParams[] = [];
    server.use(
      http.get("/api/problems", ({ request }) => {
        captured.push(new URL(request.url).searchParams);
        return HttpResponse.json(EMPTY_LIST);
      }),
    );
    return captured;
  }

  it("검색칸을 보여 주고 기본은 비어 있다", async () => {
    await renderBank();
    const box = screen.getByRole("searchbox", { name: "본문 검색" });
    expect(box).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("타자가 멎으면 q 로 조회한다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.type(
      screen.getByRole("searchbox", { name: "본문 검색" }),
      "이차함수",
    );
    await waitFor(
      () => {
        expect(captured.at(-1)?.get("q")).toBe("이차함수");
      },
      { timeout: 3000 },
    );
  });

  /**
   * 서버가 한 번 조회에 277~289ms 를 쓴다. 글자마다 나가면 네 글자에 네 번이고,
   * 늦게 온 옛 응답이 새 응답을 덮는 경합도 생긴다.
   */
  it("글자마다 조회하지 않는다 — 네 글자를 쳐도 조회는 한 번뿐", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.type(
      screen.getByRole("searchbox", { name: "본문 검색" }),
      "이차함수",
    );
    await waitFor(
      () => {
        expect(captured.at(-1)?.get("q")).toBe("이차함수");
      },
      { timeout: 3000 },
    );
    const withQ = captured.filter((c) => c.get("q"));
    expect(withQ.length).toBe(1);
  });

  it("지우면 q 가 빠진다 — 빈 검색어를 서버로 보내지 않는다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();
    const box = screen.getByRole("searchbox", { name: "본문 검색" });

    // ⚠️ 지우기 전에 **검색이 실제로 나간 것을 먼저 확인**해야 한다. 디바운스가
    //    아직 안 터진 상태에서 지우면 `q` 가 처음부터 빈 채라 상태가 안 바뀌고,
    //    조회가 한 번도 안 나가 「빠졌다」를 확인할 수 없다(거짓 초록/거짓 빨강).
    await user.type(box, "이차");
    await waitFor(
      () => {
        expect(captured.at(-1)?.get("q")).toBe("이차");
      },
      { timeout: 3000 },
    );

    await user.clear(box);
    await waitFor(
      () => {
        expect(captured.at(-1)?.has("q")).toBe(false);
      },
      { timeout: 3000 },
    );
  });

  it("검색하면 1페이지부터 다시 본다 — 옛 페이지에 남으면 빈 화면이 된다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.type(
      screen.getByRole("searchbox", { name: "본문 검색" }),
      "이차",
    );
    await waitFor(
      () => {
        expect(captured.at(-1)?.get("page")).toBe("1");
      },
      { timeout: 3000 },
    );
  });

  it("검색은 필터를 **대체하지 않는다** — 자료 토글과 같이 붙는다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(screen.getByRole("checkbox", { name: "해설" }));
    await user.type(
      screen.getByRole("searchbox", { name: "본문 검색" }),
      "이차",
    );
    await waitFor(
      () => {
        const q = captured.at(-1)!;
        expect(q.get("q")).toBe("이차");
        expect(q.get("hasSolution")).toBe("true");
      },
      { timeout: 3000 },
    );
  });
});

/**
 * 🔴 RED → 🟢 GREEN — 필터 줄 줄맞춤 (원장님 지시 2026-08-19, 스크린샷).
 *
 * 「자료」 묶음만 제목 높이와 상자 위치가 다른 자리에 있었다. 원인은 `fieldset`/`legend`
 * 다 — `legend` 는 브라우저가 **테두리 위에 얹어 그리는 특별한 상자**라
 * `border-0 p-0` 을 줘도 다른 칸의 `<label>` 첫 줄과 **같은 흐름에 서지 않는다.**
 *
 * 그래서 묶음 의미(`role="group"` + `aria-labelledby`)는 지키되 **마크업 구조는
 * 다른 칸과 똑같이** 맞춘다 — `flex flex-col gap-1` + 제목 span + `h-11` 상자.
 */
describe("[S-08] 문제은행 — 필터 줄맞춤", () => {
  it("「자료」 묶음이 `fieldset` 이 아니라 다른 칸과 같은 구조다", async () => {
    await renderBank();
    const group = screen.getByRole("group", { name: "자료" });
    // `legend` 는 다른 칸의 제목과 다른 흐름에 서므로 쓰지 않는다.
    expect(group.tagName).not.toBe("FIELDSET");
    expect(group.querySelector("legend")).toBeNull();
  });

  it("「자료」 상자와 select 가 같은 높이 클래스를 쓴다", async () => {
    await renderBank();
    const group = screen.getByRole("group", { name: "자료" });
    const box = group.querySelector("div");
    expect(box?.className).toContain("h-11");
  });
});
