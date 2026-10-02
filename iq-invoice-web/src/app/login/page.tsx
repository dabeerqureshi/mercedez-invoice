import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { authEnabled, isValidSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // No password configured -> nothing to sign in to (desktop parity).
  if (!authEnabled()) redirect("/");
  const store = await cookies();
  if (isValidSessionToken(store.get(SESSION_COOKIE)?.value)) redirect("/");
  return <LoginForm />;
}
