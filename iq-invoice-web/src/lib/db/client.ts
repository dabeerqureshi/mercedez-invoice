/**
 * libSQL (SQLite) database client.
 *
 *   * Turso in production  -> TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 *   * local dev / tests    -> a file under .data/ (no account needed)
 *
 * A module-level singleton is cached on globalThis so Next.js hot-reload does
 * not open a new connection on every request.
 */
import fs from "fs";
import path from "path";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __iqClient?: Client;
  __iqDb?: LibSQLDatabase<typeof schema>;
};

function databaseUrl(): string {
  const url = process.env.TURSO_DATABASE_URL;
  if (url && url.trim() !== "") return url;
  // Local fallback: a SQLite file in the project's .data/ folder.
  return "file:.data/mercedes_invoice.db";
}

export function getClient(): Client {
  if (!globalForDb.__iqClient) {
    const url = databaseUrl();
    const authToken = process.env.TURSO_AUTH_TOKEN;
    // Ensure the local .data directory exists before libSQL opens the file.
    if (url.startsWith("file:")) {
      const filePath = url.slice("file:".length);
      fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    }
    globalForDb.__iqClient = createClient(
      authToken ? { url, authToken } : { url },
    );
  }
  return globalForDb.__iqClient;
}

export function getDb(): LibSQLDatabase<typeof schema> {
  if (!globalForDb.__iqDb) {
    globalForDb.__iqDb = drizzle(getClient(), { schema });
  }
  return globalForDb.__iqDb;
}

export { schema };