/**
 * GET /api/mercedes/status
 *
 * Connection state for the header badge and the connect dialog:
 *   configured  - Browserbase credentials present
 *   connected   - an authenticated Context exists and is verified
 *   pendingLogin - a manual login window is open and not yet confirmed
 */
import { NextResponse } from "next/server";

import { isBrowserbaseConfigured } from "@/lib/browserbase";
import { PRICE_SOURCE } from "@/lib/config";
import { getSessionState } from "@/lib/db/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
  });
}
