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
import { normalizeCallbackUrl, requestedCallbackUrl } from "@/lib/callbackUrl";
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

  it("보호 경로의 쿼리까지 로그인 후 목적지로 복원한다", async () => {
    const user = userEvent.setup();
    const callbackUrl =
      "/tests/new?classId=10000000-0000-4000-8000-000000000001";
    signIn.mockResolvedValue({ ok: true });

    render(<LoginForm callbackUrl={callbackUrl} />);
    await user.type(screen.getByLabelText("이메일"), "teacher@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(callbackUrl);
    });
  });

  it("가입 전환 링크가 /signup 을 가리킨다", () => {
    render(<LoginForm />);

    expect(screen.getByRole("link", { name: "가입" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  // 구글(OAuth) 로그인은 제거됐다(원장님 지시 2026-08-14) — 로그인 수단은 이메일/비밀번호뿐이다.
  // 버튼이 다시 살아나면 이 테스트가 깨진다.
  it("소셜 로그인 버튼을 노출하지 않는다", () => {
    render(<LoginForm />);

    expect(
      screen.queryByRole("button", { name: /구글/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
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

describe("callback URL", () => {
  it("Proxy 목적지에 원래 쿼리 문자열을 보존한다", () => {
    expect(requestedCallbackUrl("/tests/new", "?classId=abc")).toBe(
      "/tests/new?classId=abc",
    );
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "javascript:alert(1)",
  ])("외부 또는 실행 가능한 목적지 %s 를 루트로 제한한다", (value) => {
    expect(normalizeCallbackUrl(value)).toBe("/");
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

  it("가입 성공 후 credentials 로그인하고 /onboarding 으로 이동한다", async () => {
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
      expect(push).toHaveBeenCalledWith("/onboarding");
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
