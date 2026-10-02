/**
 * POST /api/mercedes/verify
 *
 * Confirms the manual login and flips the connection state to `connected`:
 *
 *   1. end the login session (Browserbase then flushes the user-data-dir into
 *      the Context — the documented "wait a few seconds" step),
 *   2. open a FRESH session on the same Context and load the catalog,
 *   3. if we are NOT bounced to a login screen, the Context is authenticated:
 *      end the probe session, persist `connected`.
 *
 * This matches the Browserbase Contexts login workflow exactly and also
 * verifies the login even if the original login session already expired.
 */
import { NextResponse } from "next/server";

import {
  createSession,
  endSession,
  isBrowserbaseConfigured,
  withPage,
} from "@/lib/browserbase";
import {
  MERCEDES_CATALOG_URL,
  MERCEDES_NAV_TIMEOUT_MS,
  VERIFY_SESSION_TIMEOUT_S,
} from "@/lib/connectors/mercedes-config";
import { isLoginPage } from "@/lib/connectors/mercedes";
import { getSessionState, saveSessionState } from "@/lib/db/session-store";
import { withLock } from "@/lib/lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST() {
  if (!isBrowserbaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Browserbase is not configured." },
      { status: 400 },
    );
  }

  try {
    const result = await withLock(async () => {
      const state = await getSessionState();
      if (!state?.contextId) {
        throw new Error(
          "No Mercedes browser context yet. Open the login window first.",
        );
      }
      const contextId = state.contextId;

      // 1. End the manual login session and give the Context a moment to
      //    persist what happened inside it.
      if (state.pendingSessionId) {
        await endSession(state.pendingSessionId);
        await sleep(3000);
      }

      // 2. Probe with a fresh session on the same Context.
      const session = await createSession({
        contextId,
        timeoutSeconds: VERIFY_SESSION_TIMEOUT_S,
        keepAlive: false,
      });
      let loggedIn = false;
      try {
        loggedIn = await withPage(session.connectUrl, async (page) => {
          await page
            .goto(MERCEDES_CATALOG_URL, {
              waitUntil: "domcontentloaded",
              timeout: MERCEDES_NAV_TIMEOUT_MS,
            })
            .catch(() => undefined);
          return !(await isLoginPage(page));
        });
      } finally {
        await endSession(session.id);
      }

      if (!loggedIn) {
        await saveSessionState({
          contextId,
          pendingSessionId: null,
          status: "logged_out",
          connectedAt: null,
        });
        return {
          connected: false,
          message:
            "The catalog still redirects to the login page. Sign in inside " +
            "the window (including any MFA), then press Continue again.",
        };
      }

      // 3. Persist the authenticated Context as ready for lookups.
      await sleep(1000);
      await saveSessionState({
        contextId,
        pendingSessionId: null,
        status: "connected",
        connectedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
      });
      return {
        connected: true,
        message: "Mercedes session connected. Live pricing is ready.",
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        error: `Could not verify the Mercedes session: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 502 },
    );
  }
}
