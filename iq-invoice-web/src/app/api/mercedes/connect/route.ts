/**
 * POST /api/mercedes/connect
 *
 * Opens the manual-login window for the shop owner (the web equivalent of
 * the desktop app's "Open Mercedes & Login" button):
 *
 *   1. create (or reuse) the persistent Browserbase Context,
 *   2. start a keepAlive login session on it, navigate to the B2B site,
 *   3. hand the Live View URL back to the UI (interactive iframe),
 *   4. persist `pending_login` so price lookups are blocked until verify.
 *
 * The session survives the API response because keepAlive=true; /verify ends
 * it once the sign-in is confirmed.
 */
import { NextResponse } from "next/server";

import {
  connectCdp,
  createContext,
  createSession,
  endSession,
  getLiveUrls,
  isBrowserbaseConfigured,
} from "@/lib/browserbase";
import {
  BROWSERBASE_CONTEXT_NAME,
  LOGIN_SESSION_TIMEOUT_S,
  MERCEDES_B2B_URL,
  MERCEDES_NAV_TIMEOUT_MS,
} from "@/lib/connectors/mercedes-config";
import { tryRememberMe } from "@/lib/connectors/remember-me";
import { getSessionState, saveSessionState } from "@/lib/db/session-store";
import { withLock } from "@/lib/lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  if (!isBrowserbaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Browserbase is not configured. Set BROWSERBASE_API_KEY and " +
          "BROWSERBASE_PROJECT_ID to use live Mercedes pricing.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await withLock(async () => {
      const state = await getSessionState();
      // Reuse the existing Context so a re-login keeps prior browser data.
      const contextId = state?.contextId
        ? state.contextId
        : await createContext(BROWSERBASE_CONTEXT_NAME);
      // Close any previous in-progress login window first (one session per
      // Context is a hard Browserbase rule).
      if (state?.pendingSessionId) await endSession(state.pendingSessionId);

      const session = await createSession({
        contextId,
        timeoutSeconds: LOGIN_SESSION_TIMEOUT_S,
        keepAlive: true,
      });
      try {
        const browser = await connectCdp(session.connectUrl);
        try {
          const context = browser.contexts()[0];
          const page =
            context?.pages()[0] ?? (context ? await context.newPage() : null);
          if (page) {
            await page
              .goto(MERCEDES_B2B_URL, {
                waitUntil: "domcontentloaded",
                timeout: MERCEDES_NAV_TIMEOUT_MS,
              })
              .catch(() => undefined);
            // Best-effort "keep me signed in" tick (port of the desktop app).
            await tryRememberMe(page);
          }
        } finally {
          await browser.close().catch(() => undefined);
        }
      } catch (e) {
        await endSession(session.id);
        throw e;
      }

      // Live View URL: the UI embeds this as an interactive iframe so the
      // owner can sign in (with MFA) without the server ever seeing a password.
      const live = await getLiveUrls(session.id);
      await saveSessionState({
        contextId,
        pendingSessionId: session.id,
        status: "pending_login",
      });
      return {
        sessionId: session.id,
        contextId,
        liveViewUrl: live.debuggerUrl,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `Could not open the Mercedes login window: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 502 },
    );
  }
}
