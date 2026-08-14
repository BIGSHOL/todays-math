"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

import {
  CREDENTIALS_ERROR,
  fieldErrorsFromResponse,
  fieldErrorsFromZod,
} from "@/components/auth/authErrors";
import { AuthField } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import {
  authLoginRequestSchema,
  authSignupRequestSchema,
} from "@/contracts/auth.contract";
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

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
      <Button type="submit" variant="ink" disabled={pending} className="w-full">
        {title}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        className="w-full"
        onClick={() => {
          void signIn("google", { redirectTo: loginDestination });
        }}
      >
        구글 계정으로 계속
      </Button>
      <Link
        href={isSignup ? "/login" : "/signup"}
        className="inline-flex min-h-11 items-center justify-center text-[12.5px] font-bold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8]"
      >
        {isSignup ? "로그인" : "가입"}
      </Link>
    </form>
  );
}

async function signInWithCredentials(email: string, password: string) {
  const result = await signIn("credentials", {
    email,
    password,
    redirect: false,
  });
  return result?.ok === true;
}
