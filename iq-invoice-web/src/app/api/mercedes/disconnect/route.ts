/**
 * POST /api/mercedes/disconnect
 *
 * Two modes (JSON body):
 *   { "mode": "cancel" }  - close an open login window WITHOUT verifying and
 *                           restore the previous state (connected if it ever
 *                           connected, otherwise logged_out). The Context is
 *                           kept, so a later Connect reuses it.
 *   { "mode": "reset" }   - full disconnect: end any session, DELETE the
 *                           Browserbase Context (forgets the login) and clear
 *                           the stored state.
 * Default: "reset".
 */
import { NextResponse } from "next/server";

import { guardRequest } from "@/lib/auth";
import { deleteContext, endSession } from "@/lib/browserbase";
import { clearSessionState, getSessionState, saveSessionState } from "@/lib/db/session-store";
import { withLock } from "@/lib/lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  mode?: string;
}

export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    // Empty body -> reset.
  }
  const mode = body.mode === "cancel" ? "cancel" : "reset";

  try {
    const result = await withLock(async () => {
      const state = await getSessionState();
      if (state?.pendingSessionId) await endSession(state.pendingSessionId);

      if (mode === "cancel") {
        if (!state?.contextId) {
          return { connected: false, message: "No login window was open." };
        }
        // Restore the state we had before the login window opened.
        const connected = Boolean(state.connectedAt);
        await saveSessionState({
          contextId: state.contextId,
          pendingSessionId: null,
          status: connected ? "connected" : "logged_out",
          connectedAt: state.connectedAt,
        });
        return {
          connected,
          message: connected
            ? "Login window closed. The previous session is still in use."
            : "Login window closed.",
        };
      }

      // Full reset.
      if (state?.contextId) {
        try {
          await deleteContext(state.contextId);
        } catch {
          // Context may already be gone.
        }
      }
      await clearSessionState();
      return { connected: false, message: "Mercedes connection removed." };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
