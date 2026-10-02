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
      },
    });
  return {
    contextId: patch.contextId,
    pendingSessionId: patch.pendingSessionId ?? null,
    status: patch.status,
    connectedAt: patch.connectedAt ?? null,
    updatedAt: updated_at,
  };
}

/** Remove the connection state (Disconnect). */
export async function clearSessionState(): Promise<void> {
  await ensureSchema();
  await getDb().delete(mercedesSessions).where(eq(mercedesSessions.id, 1));
}
