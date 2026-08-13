/**
 * 🟢 GREEN — 대응 구현 태스크: Phase 1, T1.3 (S-02 온보딩)
 *
 * 구현: src/app/(auth)/onboarding/page.tsx, src/components/onboarding/*
 * 한 페이지 3단(캐러셀 금지): 반 생성 → 학생 이름 추가 → 진도 지정. 완료 시 /.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserEvent } from "@testing-library/user-event";

import OnboardingPage from "@/app/(auth)/onboarding/page";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import {
  progressRecordRequestSchema,
  progressResponseSchema,
  studentCreateRequestSchema,
  studentResponseSchema,
} from "@/contracts/class.contract";
import { MOCK_UNITS } from "@/mocks/data";
import {
  jsonError,
  jsonOk,
  notFoundError,
  validationError,
} from "@/mocks/handlers/_helpers";
import { server } from "@/mocks/server";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function allowCreatedClassWrites() {
  server.use(
    http.post("/api/students", async ({ request }) => {
      const parsed = studentCreateRequestSchema.safeParse(await request.json());
      if (!parsed.success) return validationError(parsed.error);
      return jsonOk(
        studentResponseSchema,
        {
          data: {
            id: crypto.randomUUID(),
            classId: parsed.data.classId,
            name: parsed.data.name,
            useIndividualProgress: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        { status: 201 },
      );
    }),
    http.post("/api/progress", async ({ request }) => {
      const parsed = progressRecordRequestSchema.safeParse(
        await request.json(),
      );
      if (!parsed.success) return validationError(parsed.error);
      if (!MOCK_UNITS.some((unit) => unit.id === parsed.data.unitId)) {
        return notFoundError("소단원");
      }
      return jsonOk(
        progressResponseSchema,
        {
          data: {
            id: crypto.randomUUID(),
            classId: parsed.data.classId,
            studentId: parsed.data.studentId ?? null,
            unitId: parsed.data.unitId,
            recordedAt:
              parsed.data.recordedAt ?? new Date().toISOString().slice(0, 10),
            createdAt: new Date().toISOString(),
          },
        },
        { status: 201 },
      );
    }),
  );
}

function renderForm() {
  return render(<OnboardingForm units={MOCK_UNITS} />);
}

async function createClass(user: UserEvent, name = "중2 심화반") {
  await user.type(screen.getByLabelText("반 이름"), name);
  await user.type(screen.getByLabelText("학년"), "중2");
  await user.click(screen.getByRole("button", { name: "반 만들기" }));
  await screen.findByText(name);
}

async function addStudent(user: UserEvent, name = "이서준") {
  await user.type(screen.getByLabelText("이름"), name);
  await user.click(screen.getByRole("button", { name: "추가" }));
  await screen.findByText(name);
}

describe("[T1.3] S-02 온보딩", () => {
  beforeEach(() => {
    push.mockReset();
    allowCreatedClassWrites();
  });

  it("한 페이지에 반·학생·진도 3단이 함께 보이고 캐러셀이 없다", () => {
    renderForm();

    expect(
      screen.getByRole("heading", { name: "반 만들기" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "학생 이름" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "진도" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "다음" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "이전" }),
    ).not.toBeInTheDocument();
  });

  it("반 생성 후 학생을 추가하고 진도를 지정하면 메인으로 이동한다", async () => {
    const user = userEvent.setup();
    renderForm();

    await createClass(user);
    await addStudent(user);

    const firstUnit = MOCK_UNITS[0]!;
    await user.selectOptions(screen.getByLabelText("소단원"), firstUnit.id);
    await user.click(screen.getByRole("button", { name: "완료" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
  });

  it("반 이름 없이 만들면 에러를 보여 준다", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("학년"), "중2");
    await user.click(screen.getByRole("button", { name: "반 만들기" }));

    expect(
      await screen.findByText("반 이름을 입력해주세요."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("학년 없이 반을 만들면 에러를 보여 준다", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("반 이름"), "중2 심화반");
    await user.click(screen.getByRole("button", { name: "반 만들기" }));

    expect(await screen.findByText("학년을 입력해주세요.")).toBeInTheDocument();
  });

  it("학생 이름 없이 추가하면 에러를 보여 준다", async () => {
    const user = userEvent.setup();
    renderForm();
    await createClass(user);

    await user.click(screen.getByRole("button", { name: "추가" }));

    expect(
      await screen.findByText("학생 이름을 입력해주세요."),
    ).toBeInTheDocument();
  });

  it("소단원 없이 완료하면 에러를 보여 준다", async () => {
    const user = userEvent.setup();
    renderForm();
    await createClass(user);
    await addStudent(user);

    await user.click(screen.getByRole("button", { name: "완료" }));

    expect(await screen.findByText("진도를 선택해주세요.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("반 생성 API가 실패하면 메시지를 보여 준다", async () => {
    server.use(
      http.post("/api/classes", () =>
        jsonError("VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", 400),
      ),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("반 이름"), "중2 심화반");
    await user.type(screen.getByLabelText("학년"), "중2");
    await user.click(screen.getByRole("button", { name: "반 만들기" }));

    expect(
      await screen.findByText("요청 값이 올바르지 않습니다."),
    ).toBeInTheDocument();
  });

  it("진도 API가 실패하면 메시지를 보여 준다", async () => {
    server.use(
      http.post(
        "/api/progress",
        () => new HttpResponse("broken", { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderForm();
    await createClass(user);
    await addStudent(user);

    await user.selectOptions(
      screen.getByLabelText("소단원"),
      MOCK_UNITS[0]!.id,
    );
    await user.click(screen.getByRole("button", { name: "완료" }));

    expect(await screen.findByText("저장하지 못했습니다.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("페이지가 단원 목록으로 3단 폼을 렌더한다", async () => {
    const page = await OnboardingPage();
    render(page);

    expect(
      screen.getByRole("heading", { name: "반 만들기" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("소단원")).toBeInTheDocument();
  });
});
