/**
 * Repository — port of db.py query functions.
 *
 * save_invoice / get_invoice / list_invoices / _get_or_create_customer /
 * _next_invoice_number, using Drizzle over libSQL.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getClient, getDb } from "./client";
import { ensureSchema } from "./init";
import { customers, invoiceItems, invoices, workItems } from "./schema";

/** Anything that supports Drizzle select/insert (the db or a transaction). */
type Executor = Pick<ReturnType<typeof getDb>, "select" | "insert">;

export interface CustomerInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface InvoiceItemInput {
  partNumber: string;
  designation?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  vat: number;
  discount: number;
  priceRetrievedAt?: string | null;
}

export interface WorkItemInput {
  description: string;
  operNo?: string | null;
  timeHours?: string | null;
  labourCost: number;
}

export interface VehicleInput {
  make?: string | null;
  model?: string | null;
  regNo?: string | null;
  mileage?: string | null;
}

export interface InvoiceRecord {
  invoice: typeof invoices.$inferSelect;
  customer: typeof customers.$inferSelect | null;
  items: (typeof invoiceItems.$inferSelect)[];
  workItems: (typeof workItems.$inferSelect)[];
}

function nowIso(): string {
  // Matches Python's datetime.now().isoformat(timespec="seconds").
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function getOrCreateCustomer(
  tx: Executor,
  customer: CustomerInput,
): Promise<number | null> {
  const name = (customer.name ?? "").trim();
  if (!name) return null;
  const email = (customer.email ?? "").trim();
  const phone = (customer.phone ?? "").trim();

  const existing = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.name, name),
        sql`IFNULL(${customers.email}, '') = ${email}`,
        sql`IFNULL(${customers.phone}, '') = ${phone}`,
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const inserted = await tx
    .insert(customers)
    .values({ name, email, phone, createdAt: nowIso() })
    .returning({ id: customers.id });
  return inserted[0].id;
}

async function nextInvoiceNumber(tx: Executor): Promise<number> {
  const rows = await tx
    .select({ m: sql<number>`COALESCE(MAX(${invoices.invoiceNumber}), 0)` })
    .from(invoices);
  return Number(rows[0]?.m ?? 0) + 1;
}
export interface SaveInvoiceArgs {
  customer: CustomerInput;
  items: InvoiceItemInput[];
  subtotal: number;
  vat: number;
  discount: number;
  total: number;
  currency: string;
  vehicle?: VehicleInput;
  workItems?: WorkItemInput[];
}

export async function saveInvoice(
  args: SaveInvoiceArgs,
): Promise<InvoiceRecord> {
  await ensureSchema();
  const db = getDb();
  const vehicle = args.vehicle ?? {};

  const invoiceNumber = await db.transaction(async (tx) => {
    const customerId = await getOrCreateCustomer(tx, args.customer);
    const number = await nextInvoiceNumber(tx);

    const inserted = await tx
      .insert(invoices)
      .values({
        invoiceNumber: number,
        customerId,
        subtotal: args.subtotal,
        vat: args.vat,
        discount: args.discount,
        total: args.total,
        currency: args.currency,
        createdAt: nowIso(),
        make: vehicle.make || null,
        model: vehicle.model || null,
        regNo: vehicle.regNo || null,
        mileage: vehicle.mileage || null,
      })
      .returning({ id: invoices.id });
    const invoiceId = inserted[0].id;

    if (args.items.length > 0) {
      await tx.insert(invoiceItems).values(
        args.items.map((it) => ({
          invoiceId,
          partNumber: it.partNumber,
          designation: it.designation ?? null,
          quantity: Math.trunc(it.quantity),
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
          vat: it.vat,
          discount: it.discount,
          priceRetrievedAt: it.priceRetrievedAt ?? null,
        })),
      );
    }

    const work = (args.workItems ?? []).filter(
      (w) => (w.description ?? "").trim() !== "",
    );
    if (work.length > 0) {
      await tx.insert(workItems).values(
        work.map((w, pos) => ({
          invoiceId,
          description: w.description.trim(),
          operNo: (w.operNo ?? "").trim() || null,
          timeHours: (w.timeHours ?? "").trim() || null,
          labourCost: round2(w.labourCost ?? 0),
          position: pos,
        })),
      );
    }

    return number;
  });

  const record = await getInvoice(invoiceNumber);
  if (!record) {
    throw new Error("Invoice was saved but could not be read back.");
  }
  return record;
}
export async function getInvoice(
  invoiceNumber: number,
): Promise<InvoiceRecord | null> {
  await ensureSchema();
  const db = getDb();
  const inv = await db
    .select()
    .from(invoices)
    .where(eq(invoices.invoiceNumber, invoiceNumber))
    .limit(1);
  if (inv.length === 0) return null;

  const customerRows = inv[0].customerId
    ? await db
        .select()
        .from(customers)
        .where(eq(customers.id, inv[0].customerId))
        .limit(1)
    : [];

  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, inv[0].id))
    .orderBy(asc(invoiceItems.id));

  const work = await db
    .select()
    .from(workItems)
    .where(eq(workItems.invoiceId, inv[0].id))
    .orderBy(asc(workItems.position), asc(workItems.id));

  return {
    invoice: inv[0],
    customer: customerRows[0] ?? null,
    items,
    workItems: work,
  };
}

export async function listInvoices(limit = 50) {
  await ensureSchema();
  return getDb()
    .select()
    .from(invoices)
    .orderBy(desc(invoices.invoiceNumber))
    .limit(limit);
}

// Re-export the raw client for callers that need it (e.g. health checks).
export { getClient };