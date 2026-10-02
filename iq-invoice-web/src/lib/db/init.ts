/**
 * Idempotent schema creation — port of db.init_db() + db._migrate().
 *
 * Runs on first use so the app self-initialises (no separate migration step),
 * exactly like the desktop release. Safe to call on every request; the checks
 * are cheap and the DDL uses IF NOT EXISTS.
 */
import { getClient } from "./client";

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS customers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      email       TEXT,
      phone       TEXT,
      created_at  TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS invoices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number  INTEGER UNIQUE NOT NULL,
      customer_id     INTEGER,
      subtotal        REAL NOT NULL,
      vat             REAL NOT NULL,
      discount        REAL NOT NULL,
      total           REAL NOT NULL,
      currency        TEXT NOT NULL,
      created_at      TEXT,
      make            TEXT,
      model           TEXT,
      reg_no          TEXT,
      mileage         TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS work_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id  INTEGER NOT NULL,
      description TEXT NOT NULL,
      oper_no     TEXT,
      time_hours  TEXT,
      labour_cost REAL NOT NULL DEFAULT 0,
      position    INTEGER NOT NULL DEFAULT 0
    )`,
  `CREATE TABLE IF NOT EXISTS invoice_items (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id          INTEGER NOT NULL,
      part_number         TEXT NOT NULL,
      designation         TEXT,
      quantity            INTEGER NOT NULL,
      unit_price          REAL NOT NULL,
      line_total          REAL NOT NULL,
      vat                 REAL NOT NULL,
      discount            REAL NOT NULL,
      price_retrieved_at  TEXT
    )`,
  // Phase 3: Mercedes connection state (single row, id = 1).
  `CREATE TABLE IF NOT EXISTS mercedes_sessions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      context_id          TEXT NOT NULL,
      pending_session_id  TEXT,
      status              TEXT NOT NULL,
      connected_at        TEXT,
      updated_at          TEXT,
      last_activity_at    TEXT
    )`,
];

async function columns(table: string): Promise<Set<string>> {
  const rs = await getClient().execute(`PRAGMA table_info(${table})`);
  return new Set(rs.rows.map((r) => String(r.name)));
}

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  const client = getClient();
  for (const sql of CREATE_STATEMENTS) {
    await client.execute(sql);
  }
  // Migrations for databases created before a column existed (matches
  // db._migrate): ALTER TABLE ADD COLUMN fails if the column is present, so
  // we check PRAGMA table_info first.
  const itemCols = await columns("invoice_items");
  if (!itemCols.has("designation")) {
    await client.execute("ALTER TABLE invoice_items ADD COLUMN designation TEXT");
  }
  const invCols = await columns("invoices");
  for (const name of ["make", "model", "reg_no", "mileage"]) {
    if (!invCols.has(name)) {
      await client.execute(`ALTER TABLE invoices ADD COLUMN ${name} TEXT`);
    }
  }
  // Phase 4: keep-alive idle guard.
  const sessionCols = await columns("mercedes_sessions");
  if (!sessionCols.has("last_activity_at")) {
    await client.execute(
      "ALTER TABLE mercedes_sessions ADD COLUMN last_activity_at TEXT",
    );
  }
}

/** Ensure the schema exists (runs once per process). */
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = run().catch((e) => {
      // Allow a retry on the next call if initialisation failed.
      ready = null;
      throw e;
    });
  }
  return ready;
}