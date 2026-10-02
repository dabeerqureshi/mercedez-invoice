/**
 * GET /api/mercedes/status
 *
 * Connection state for the header badge and the connect dialog:
 *   configured  - Browserbase credentials present
 *   connected   - an authenticated Context exists and is verified
 *   pendingLogin - a manual login window is open and not yet confirmed
 */
import { NextResponse } from "next/server";

import { authEnabled, guardRequest } from "@/lib/auth";
import { isBrowserbaseConfigured } from "@/lib/browserbase";
import { PRICE_SOURCE } from "@/lib/config";
import { MERCEDES_KEEP_ALIVE_S } from "@/lib/connectors/mercedes-config";
import { getSessionState } from "@/lib/db/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;
  let connected = false;
  let pendingLogin = false;
  let connectedAt: string | null = null;
  let hasContext = false;
  try {
    const state = await getSessionState();
    hasContext = Boolean(state?.contextId);
    connected = state?.status === "connected";
    pendingLogin = state?.status === "pending_login";
    connectedAt = state?.connectedAt ?? null;
  } catch {
    // Database not ready — report as disconnected.
  }
  return NextResponse.json({
    ok: true,
    priceSource: PRICE_SOURCE,
    configured: isBrowserbaseConfigured(),
    connected,
    pendingLogin,
    hasContext,
    connectedAt,
    // Phase 4: the POS page pings /api/cron/keep-alive at this interval while
    // connected (0 disables — desktop MERCEDES_KEEP_ALIVE_S).
    keepAliveSeconds: MERCEDES_KEEP_ALIVE_S,
    // Phase 4 auth: whether the Sign out button should be shown.
    authEnabled: authEnabled(),
  });
}
