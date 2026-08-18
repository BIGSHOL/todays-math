"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import {
  CREDENTIALS_ERROR,
  fieldErrorsFromResponse,
  fieldErrorsFromZod,
} from "@/components/auth/authErrors";
import { AuthField } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import { normalizeCallbackUrl } from "@/lib/callbackUrl";

type AuthFormProps = {
  mode: "login" | "signup";
  callbackUrl?: string;
};

export function AuthForm({ mode, callbackUrl }: AuthFormProps) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const title = isSignup ? "가입" : "로그인";
  const loginDestination = normalizeCallbackUrl(callbackUrl);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  // 하이드레이션 전에는 onSubmit 이 안 붙어 있어 네이티브 GET 제출이 일어나고,
  // 비밀번호가 /login?password=... 로 URL 에 노출된다 (2026-08-17 실측). 그 전엔 버튼을 잠근다.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    // 계약 스키마는 **제출 시점에** 불러온다 (성능 수리 C-1). 정적 import 면
    // zod + 계약 모듈(279KB)이 로그인/가입 초기 번들에 실려 첫 페인트를 막는다.
    // 검증 규칙·오류 문구는 그대로다 — 불러오는 시점만 옮겼다.
    const { authLoginRequestSchema, authSignupRequestSchema } =
      await import("@/contracts/auth.contract");

    if (isSignup) {
      const parsed = authSignupRequestSchema.safeParse({
        email,
        password,
        name,
      });
      if (!parsed.success) {
        setErrors(fieldErrorsFromZod(parsed.error));
        return;
      }

      setPending(true);
      try {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        if (!res.ok) {
          setErrors(await fieldErrorsFromResponse(res));
          return;
        }
        const signedIn = await signInWithCredentials(email, password);
        if (!signedIn) {
          setErrors({ password: CREDENTIALS_ERROR });
          return;
        }
        router.push("/onboarding");
        router.refresh();
      } finally {
        setPending(false);
      }
      return;
    }

    const parsed = authLoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }

    setPending(true);
    try {
      const signedIn = await signInWithCredentials(email, password);
      if (!signedIn) {
        setErrors({ password: CREDENTIALS_ERROR });
        return;
      }
      router.push(loginDestination);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex w-[360px] flex-col gap-4"
    >
      <h1 className="text-[15px] font-black">{title}</h1>
      <AuthField
        id="email"
        name="email"
        label="이메일"
        type="email"
        autoComplete="email"
        value={email}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <AuthField
        id="password"
        name="password"
        label="비밀번호"
        type="password"
        autoComplete={isSignup ? "new-password" : "current-password"}
        value={password}
        error={errors.password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {isSignup ? (
        <AuthField
          id="name"
          name="name"
          label="이름"
          type="text"
          autoComplete="name"
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
      ) : null}
      <Button
        type="submit"
        variant="ink"
        disabled={pending || !hydrated}
        className="w-full"
      >
        {title}
      </Button>
      <Link
        href={isSignup ? "/login" : "/signup"}
        className="inline-flex min-h-11 items-center justify-center text-[12.5px] font-bold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-g-blue"
      >
        {isSignup ? "로그인" : "가입"}
      </Link>
    </form>
  );
}

function subscribeNever() {
  return () => {};
}

async function signInWithCredentials(email: string, password: string) {
  const result = await signIn("credentials", {
    email,
    password,
    redirect: false,
  });
  // next-auth v5 beta 는 자격 증명이 틀려도 HTTP 200 이라 ok:true 로 온다.
  // 실패 여부는 error("CredentialsSignin") 필드가 유일한 근거다.
  return result?.ok === true && !result.error;
}
