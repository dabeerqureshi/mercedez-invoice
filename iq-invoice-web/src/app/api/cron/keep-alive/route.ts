/**
 * GET /api/cron/keep-alive
 *
 * Phase 4: quiet Mercedes session refresh (port of the desktop QTimer that
 * softly reloaded the parked catalog every MERCEDES_KEEP_ALIVE_S seconds).
 * Triggered by:
 *   - the open POS page (client timer, session cookie),
 *   - Vercel Cron (Authorization: Bearer $CRON_SECRET — sent automatically),
 *   - an external pinger (?secret=$CRON_SECRET).
 *
 * The connector skips the refresh when a lookup happened recently and reports
 * what it actually did (see KeepAliveOutcome).
 */
import { NextResponse } from "next/server";

import {
  authEnabled,
  isValidSessionToken,
  readSessionCookie,
  safeEqual,
} from "@/lib/auth";
import { keepAliveSession } from "@/lib/connectors/mercedes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const querySecret = new URL(req.url).searchParams.get("secret") ?? "";
  if (
    cronSecret &&
    ((bearer.length > 0 && safeEqual(bearer, cronSecret)) ||
      (querySecret.length > 0 && safeEqual(querySecret, cronSecret)))
  ) {
    return true;
  }
  // The open POS page pings with its session cookie.
  if (isValidSessionToken(readSessionCookie(req))) return true;
  // Nothing configured (local dev): allow, matching the open-auth default.
  if (!cronSecret && !authEnabled()) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden." },
      { status: 403 },
    );
  }
  try {
    const outcome = await keepAliveSession();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
