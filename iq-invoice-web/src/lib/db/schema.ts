/**
 * Drizzle schema — port of db.py.
 *
 * Same tables/columns as the desktop app, including the columns that were
 * added by later migrations (designation, vehicle make/model/reg_no/mileage).
 * DDL is created idempotently in schema.ts (ensureSchema) so the app self-
 * initialises exactly like the Python `init_db()`.
 */
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  createdAt: text("created_at"),
});

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceNumber: integer("invoice_number").notNull().unique(),
  customerId: integer("customer_id"),
  subtotal: real("subtotal").notNull(),
  vat: real("vat").notNull(),
  discount: real("discount").notNull(),
  total: real("total").notNull(),
  currency: text("currency").notNull(),
  createdAt: text("created_at"),
  // vehicle details (added by migration in the desktop app)
  make: text("make"),
  model: text("model"),
  regNo: text("reg_no"),
  mileage: text("mileage"),
});

export const invoiceItems = sqliteTable("invoice_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull(),
  partNumber: text("part_number").notNull(),
  designation: text("designation"),
  quantity: integer("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
  lineTotal: real("line_total").notNull(),
  vat: real("vat").notNull(),
  discount: real("discount").notNull(),
  priceRetrievedAt: text("price_retrieved_at"),
});

export const workItems = sqliteTable("work_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull(),
  description: text("description").notNull(),
  operNo: text("oper_no"),
  timeHours: text("time_hours"),
  labourCost: real("labour_cost").notNull().default(0),
  position: integer("position").notNull().default(0),
});

// Phase 3: live Mercedes connection state (single row, id = 1). Stores the
// Browserbase Context ID (the cloud equivalent of the desktop app's local
// browser profile) plus the state of any in-progress manual login.
export const mercedesSessions = sqliteTable("mercedes_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contextId: text("context_id").notNull(),
  pendingSessionId: text("pending_session_id"),
  status: text("status").notNull(), // "pending_login" | "connected"
  connectedAt: text("connected_at"),
  updatedAt: text("updated_at"),
  // Phase 4: timestamp of the last successful live lookup — the keep-alive
  // idle guard skips its quiet refresh while activity is recent.
  lastActivityAt: text("last_activity_at"),
});