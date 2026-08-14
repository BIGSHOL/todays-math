"use client";

import { AuthForm } from "@/components/auth/AuthForm";

export function LoginForm({ callbackUrl = "/" }: { callbackUrl?: string }) {
  return <AuthForm mode="login" callbackUrl={callbackUrl} />;
}
