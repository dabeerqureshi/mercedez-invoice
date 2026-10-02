/**
 * POST /api/auth/login  { password }
 *
 * Phase 4 hardening: sets the signed session cookie when APP_PASSWORD is
 * configured. With no password configured the endpoint reports `disabled` and
 * everything stays open (desktop parity).
 */
import { NextResponse } from "next/server";

import {
  authEnabled,
  newSessionToken,
  passwordsMatch,
  SESSION_COOKIE,
  SESSION_TTL_S,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!authEnabled()) {
    return NextResponse.json({ ok: true, disabled: true });
  }
  if (!passwordsMatch(body.password ?? "")) {
    return NextResponse.json(
      { ok: false, error: "Wrong password." },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, newSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return res;
}
