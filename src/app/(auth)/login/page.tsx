import { LoginForm } from "@/components/auth/LoginForm";
import { normalizeCallbackUrl } from "@/lib/callbackUrl";

export const metadata = {
  title: "로그인",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const query = await searchParams;
  return <LoginForm callbackUrl={normalizeCallbackUrl(query.callbackUrl)} />;
}
