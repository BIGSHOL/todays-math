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

    await screen.findByText("1건 등록");
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
  // MSW 전체 풀 = 등록형 30 + 타 사용자 shared 1 + AI 생성/변형 픽스처
  const TOTAL =
    MOCK_PROBLEMS.length +
    1 +
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

    await screen.findByText("1건 등록");
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

    await user.click(within(panel).getByRole("button", { name: "채택분 저장" }));

    await screen.findByText("1건 변형");
    expect(screen.getByText(/을 유한소수로 나타내어라/)).toBeInTheDocument();
    expect(MOCK_AI_TRANSFORMED_PROBLEMS[0]!.content).toContain("11");
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
describe("[S-08] 문제은행 — 그림 있는 문제만 (MSW)", () => {
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

    const box = screen.getByRole("checkbox", { name: "그림 있는 문제만" });
    expect(box).toBeInTheDocument();
    expect(box).not.toBeChecked();
  });

  it("켜면 hasFigure=true 로 조회하고, 끄면 다시 빠진다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(
      screen.getByRole("checkbox", { name: "그림 있는 문제만" }),
    );
    await waitFor(() => {
      expect(captured.at(-1)?.get("hasFigure")).toBe("true");
    });

    await user.click(
      screen.getByRole("checkbox", { name: "그림 있는 문제만" }),
    );
    await waitFor(() => {
      expect(captured.at(-1)?.has("hasFigure")).toBe(false);
    });
  });

  it("켜면 1페이지부터 다시 본다 — 켠 채로 옛 페이지에 남으면 빈 화면이 된다", async () => {
    const { user } = await renderBank();
    const captured = captureQueries();

    await user.click(
      screen.getByRole("checkbox", { name: "그림 있는 문제만" }),
    );
    await waitFor(() => {
      expect(captured.at(-1)?.get("page")).toBe("1");
    });
  });
});
