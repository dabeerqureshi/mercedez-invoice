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

/**
 * Best-effort brute-force throttle: at most RATE_MAX failed attempts per
 * RATE_WINDOW_MS per client IP, plus a fixed delay on every failure so online
 * guessing stays slow even across serverless instances (each instance keeps
 * its own counter — a full distributed limiter would need Redis, see README).
 */
const RATE_MAX = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const FAIL_DELAY_MS = 300;
const failures = new Map<string, number[]>(); // client key -> failure times

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || "unknown";
}

function prune(list: number[]): number[] {
  const now = Date.now();
  return list.filter((t) => now - t < RATE_WINDOW_MS);
}

function rateCheck(key: string): number {
  // Seconds to wait (0 = allowed). Also sweeps stale keys so the map stays small.
  if (failures.size > 500) {
    for (const [k, v] of failures) {
      if (prune(v).length === 0) failures.delete(k);
    }
  }
  const list = prune(failures.get(key) ?? []);
  failures.set(key, list);
  if (list.length < RATE_MAX) return 0;
  return Math.max(1, Math.ceil((RATE_WINDOW_MS - (Date.now() - list[0])) / 1000));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const key = clientKey(req);
  const retryAfterS = rateCheck(key);
  if (retryAfterS > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many attempts. Try again in ${Math.ceil(retryAfterS / 60)} minute(s).`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfterS) } },
    );
  }

  if (!passwordsMatch(body.password ?? "")) {
    const list = [...(failures.get(key) ?? []), Date.now()];
    failures.set(key, list);
    await sleep(FAIL_DELAY_MS); // constant-ish delay blunts online guessing
    return NextResponse.json(
      { ok: false, error: "Wrong password." },
      { status: 401 },
    );
  }

  failures.delete(key);
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
