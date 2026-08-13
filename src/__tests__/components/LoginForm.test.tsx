/**
 * 🔴 RED → 🟢 GREEN — Phase 1, T1.2 (S-01 로그인/가입 화면).
 *
 * 대응 구현: src/components/auth/LoginForm.tsx, SignupForm.tsx
 * 대응 계약: src/contracts/auth.contract.ts
 * 디자인: docs/planning/05-design-system.md §8.6 S-01
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/auth/LoginForm";
import { SignupForm } from "@/components/auth/SignupForm";
import { MOCK_EXISTING_SIGNUP_EMAIL } from "@/mocks/data";

const signIn = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  signIn,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

describe("[T1.2] LoginForm", () => {
  beforeEach(() => {
    signIn.mockReset();
    push.mockReset();
    refresh.mockReset();
  });

  it("이메일과 비밀번호 필드를 보여 준다", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toBeInTheDocument();
    expect(screen.queryByLabelText("이름")).not.toBeInTheDocument();
  });

  it('로그인 제출 시 signIn("credentials")를 호출하고 / 로 이동한다', async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({
      ok: true,
      error: undefined,
      status: 200,
      url: "/",
    });

    render(<LoginForm />);
    await user.type(screen.getByLabelText("이메일"), "teacher@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith(
        "credentials",
        expect.objectContaining({
          email: "teacher@example.com",
          password: "password123",
          redirect: false,
        }),
      );
      expect(push).toHaveBeenCalledWith("/");
    });
  });

  it("가입 전환 링크가 /signup 을 가리킨다", () => {
    render(<LoginForm />);

    expect(screen.getByRole("link", { name: "가입" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it('구글 버튼은 signIn("google")을 호출한다', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(
      screen.getByRole("button", { name: "구글 계정으로 계속" }),
    );

    expect(signIn).toHaveBeenCalledWith(
      "google",
      expect.objectContaining({ redirectTo: "/" }),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("잘못된 이메일은 검증 에러를 보여 주고 제출하지 않는다", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("이메일"), "not-an-email");
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(
      await screen.findByText("이메일 형식이 올바르지 않습니다."),
    ).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("짧은 비밀번호는 검증 에러를 보여 주고 제출하지 않는다", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("이메일"), "teacher@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "short");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(
      await screen.findByText("비밀번호는 8자 이상이어야 합니다."),
    ).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("자격 증명 실패 시 에러를 보여 주고 이동하지 않는다", async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({
      ok: false,
      error: "CredentialsSignin",
      status: 401,
      url: null,
    });

    render(<LoginForm />);
    await user.type(screen.getByLabelText("이메일"), "teacher@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(
      await screen.findByText("이메일 또는 비밀번호가 올바르지 않습니다."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("[T1.2] SignupForm", () => {
  beforeEach(() => {
    signIn.mockReset();
    push.mockReset();
    refresh.mockReset();
  });

  it("이메일/비밀번호/이름 필드와 로그인 전환 링크를 보여 준다", () => {
    render(<SignupForm />);

    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toBeInTheDocument();
    expect(screen.getByLabelText("이름")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("가입 성공 후 credentials 로그인하고 / 로 이동한다", async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({
      ok: true,
      error: undefined,
      status: 200,
      url: "/",
    });

    render(<SignupForm />);
    await user.type(screen.getByLabelText("이메일"), "new-teacher@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.type(screen.getByLabelText("이름"), "김원장");
    await user.click(screen.getByRole("button", { name: "가입" }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith(
        "credentials",
        expect.objectContaining({
          email: "new-teacher@example.com",
          password: "password123",
          redirect: false,
        }),
      );
      expect(push).toHaveBeenCalledWith("/");
    });
  });

  it("이미 가입된 이메일은 필드 아래 에러를 보여 주고 로그인하지 않는다", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(
      screen.getByLabelText("이메일"),
      MOCK_EXISTING_SIGNUP_EMAIL,
    );
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.type(screen.getByLabelText("이름"), "김원장");
    await user.click(screen.getByRole("button", { name: "가입" }));

    expect(
      await screen.findByText("이미 가입된 이메일입니다."),
    ).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("빈 이름은 검증 에러를 보여 준다", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText("이메일"), "new-teacher@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.click(screen.getByRole("button", { name: "가입" }));

    expect(await screen.findByText("이름을 입력해주세요.")).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });
});
