/**
 * Password gate for the deployed app — Phase 4 hardening.
 *
 * The desktop release runs on one trusted shop machine and has no login; on
 * the web the same UI is reachable by anyone with the URL, so we add a single
 * shared password (APP_PASSWORD). When the variable is unset the app is open —
 * exactly like the desktop app — which keeps local development zero-config.
 *
 * Sessions are a signed cookie (HMAC-SHA256 over the expiry timestamp, keyed
 * by AUTH_SECRET or the password itself), so no session table is needed.
 *
 * Server-only: never import this module from a client component (it pulls in
 * next/headers and reads secrets).
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "iq_session";
export const SESSION_TTL_S = 7 * 24 * 60 * 60; // one week

/** The configured password; empty string = auth disabled (desktop parity). */
export function authPassword(): string {
  return process.env.APP_PASSWORD ?? "";
}

export function authEnabled(): boolean {
  return authPassword().length > 0;
}

function sessionSecret(): string {
  return process.env.AUTH_SECRET || authPassword();
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

/** Fresh token for the current time: "<epoch-seconds>.<signature>". */
export function newSessionToken(): string {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_S);
  return `${exp}.${sign(exp)}`;
}

export function isValidSessionToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expiry = Number(exp);
  return Number.isFinite(expiry) && expiry * 1000 > Date.now();
}

/**
 * Constant-time string comparison that hides length too: both sides are
 * reduced to a SHA-256 digest (fixed size) before timingSafeEqual. Used for
 * the password and the cron secret.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function passwordsMatch(candidate: string): boolean {
  return safeEqual(candidate, authPassword());
}

/** Pull our session cookie out of a request's Cookie header. */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(/(?:^|;\s*)iq_session=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // Malformed percent-encoding must fail closed (401), never throw a 500.
    return null;
  }
}

/**
 * API guard: returns a 401 response when auth is enabled and the request has
 * no valid session cookie; returns null when the request may proceed.
 */
export function guardRequest(req: Request): NextResponse | null {
  if (!authEnabled()) return null;
  if (isValidSessionToken(readSessionCookie(req))) return null;
  return NextResponse.json(
    { ok: false, error: "Sign in required." },
    { status: 401 },
  );
}

/** Server-component guard: bounce to /login when auth is on and no cookie. */
export async function requirePageAccess(): Promise<void> {
  if (!authEnabled()) return;
  const store = await cookies();
  if (isValidSessionToken(store.get(SESSION_COOKIE)?.value)) return;
  redirect("/login");
}
