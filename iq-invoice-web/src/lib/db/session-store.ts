/**
 * Mercedes connection state — single row (id = 1) in `mercedes_sessions`.
 *
 * Holds the Browserbase Context ID (persistent login, cloud equivalent of the
 * desktop app's local browser profile) and whether a manual login is pending
 * or completed. Read/written by the /api/mercedes/* routes and the price
 * connector.
 */
import { eq } from "drizzle-orm";

import { getDb } from "./client";
import { ensureSchema } from "./init";
import { mercedesSessions } from "./schema";

export type MercedesStatus = "pending_login" | "connected" | "logged_out";

export interface MercedesSessionState {
  contextId: string;
  pendingSessionId: string | null;
  status: MercedesStatus;
  connectedAt: string | null;
  updatedAt: string | null;
  lastActivityAt: string | null;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

export async function getSessionState(): Promise<MercedesSessionState | null> {
  await ensureSchema();
  const rows = await getDb()
    .select()
    .from(mercedesSessions)
    .where(eq(mercedesSessions.id, 1))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    contextId: row.contextId,
    pendingSessionId: row.pendingSessionId,
    status:
      row.status === "pending_login" || row.status === "connected"
        ? row.status
        : "logged_out",
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
  };
}

export interface SaveSessionPatch {
  contextId: string;
  pendingSessionId?: string | null;
  status: MercedesStatus;
  connectedAt?: string | null;
}

/** Upsert the single connection-state row. */
export async function saveSessionState(
  patch: SaveSessionPatch,
): Promise<MercedesSessionState> {
  await ensureSchema();
  const updated_at = nowIso();
  await getDb()
    .insert(mercedesSessions)
    .values({
      id: 1,
      contextId: patch.contextId,
      pendingSessionId: patch.pendingSessionId ?? null,
      status: patch.status,
      connectedAt: patch.connectedAt ?? null,
      updatedAt: updated_at,
    })
    .onConflictDoUpdate({
      target: mercedesSessions.id,
      set: {
        contextId: patch.contextId,
        pendingSessionId: patch.pendingSessionId ?? null,
        status: patch.status,
        connectedAt: patch.connectedAt ?? null,
        updatedAt: updated_at,
        // last_activity_at is intentionally NOT reset here — it is only written
        // by touchActivity() and must survive connection-state changes.
      },
    });
  const after = await getSessionState();
  if (after) return after;
  return {
    contextId: patch.contextId,
    pendingSessionId: patch.pendingSessionId ?? null,
    status: patch.status,
    connectedAt: patch.connectedAt ?? null,
    updatedAt: updated_at,
    lastActivityAt: null,
  };
}

/**
 * Record a successful live lookup. The keep-alive route uses this as its idle
 * guard: a recent lookup already proves the Mercedes session is alive, so the
 * quiet catalog refresh is skipped (port of PriceWorker._last_activity).
 */
export async function touchActivity(): Promise<void> {
  try {
    await ensureSchema();
    await getDb()
      .update(mercedesSessions)
      .set({ lastActivityAt: nowIso() })
      .where(eq(mercedesSessions.id, 1));
  } catch {
    // Activity tracking is best-effort; never break a lookup over it.
  }
}

/** Remove the connection state (Disconnect). */
export async function clearSessionState(): Promise<void> {
  await ensureSchema();
  await getDb().delete(mercedesSessions).where(eq(mercedesSessions.id, 1));
}
