/**
 * POST /api/invoices   — save pipeline: SQLite (libSQL) -> PDF -> CSV ->
 *                         storage -> email (saved first, email failure never
 *                         loses data).
 * GET  /api/invoices   — invoice history list for /history (Phase 4): newest
 *                         first, with customer, item counts and file links.
 */
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { guardRequest } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/init";
import type { InvoiceRecord } from "@/lib/db/repo";
import { customers, invoiceItems, invoices } from "@/lib/db/schema";
import { invoiceStorageKey } from "@/lib/invoice-files";
import { processInvoice } from "@/lib/invoice-service";
import { isBlobConfigured } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SaveBody {
  customer?: { name?: string; phone?: string; email?: string };
  vehicle?: { make?: string; model?: string; regNo?: string; mileage?: string };
  parts?: Array<{
    partNumber?: string;
    designation?: string;
    quantity?: number;
    unitPrice?: number;
    lineTotal?: number;
    priceRetrievedAt?: string;
  }>;
  workItems?: Array<{
    description?: string;
    operNo?: string;
    timeHours?: string;
    labourCost?: number;
  }>;
}

export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;
  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, saved: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const name = (body.customer?.name ?? "").trim();
  if (!name) {
    return NextResponse.json(
      { ok: false, saved: false, error: "Please enter the customer's name." },
      { status: 422 },
    );
  }

  try {
    const result = await processInvoice({
      customer: {
        name,
        phone: body.customer?.phone ?? "",
        email: body.customer?.email ?? "",
      },
      vehicle: {
        make: body.vehicle?.make ?? "",
        model: body.vehicle?.model ?? "",
        regNo: body.vehicle?.regNo ?? "",
        mileage: body.vehicle?.mileage ?? "",
      },
      parts: (body.parts ?? []).map((p) => ({
        partNumber: p.partNumber ?? "",
        designation: p.designation ?? "",
        quantity: Number(p.quantity ?? 1) || 1,
        unitPrice: Number(p.unitPrice ?? 0) || 0,
        lineTotal: Number(p.lineTotal ?? 0) || 0,
        priceRetrievedAt: p.priceRetrievedAt ?? "",
      })),
      workItems: (body.workItems ?? []).map((w) => ({
        description: w.description ?? "",
        operNo: w.operNo ?? "",
        timeHours: w.timeHours ?? "",
        labourCost: Number(w.labourCost ?? 0) || 0,
      })),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        saved: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices — history list (Phase 4)
// ---------------------------------------------------------------------------

interface HistoryRow {
  invoiceNumber: number;
  createdAt: string | null;
  customerName: string;
  customerEmail: string;
  make: string | null;
  model: string | null;
  regNo: string | null;
  mileage: string | null;
  subtotal: number;
  vat: number;
  discount: number;
  total: number;
  currency: string;
  itemCount: number;
  pdfUrl: string | null;
  csvUrl: string | null;
}

/** One Blob listing pass -> pathname-to-url map for invoice files. */
async function listBlobInvoiceFiles(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { list } = await import("@vercel/blob");
    // Cursor through every page so invoices beyond the first 1000 blobs keep
    // working PDF/CSV links (capped at 10k for safety).
    let cursor: string | undefined;
    for (let pass = 0; pass < 10; pass++) {
      const res = await list({
        prefix: "Invoices/",
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      for (const blob of res.blobs) map.set(blob.pathname, blob.url);
      if (!res.hasMore || !res.cursor) break;
      cursor = res.cursor;
    }
  } catch {
    // Blob unavailable — links fall back to null (the invoices themselves are
    // still in the database).
  }
  return map;
}

/** Page size for /history (a "Load more" button fetches the next page). */
const HISTORY_PAGE_SIZE = 50;

export async function GET(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;
  try {
    const rawOffset = Number(
      new URL(req.url).searchParams.get("offset") ?? "0",
    );
    const offset =
      Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    await ensureSchema();
    const db = getDb();
    const rows = await db
      .select({
        invoice: invoices,
        customerName: customers.name,
        customerEmail: customers.email,
      })
      .from(invoices)
      .leftJoin(customers, eq(customers.id, invoices.customerId))
      .orderBy(desc(invoices.invoiceNumber))
      .limit(HISTORY_PAGE_SIZE + 1)
      .offset(offset);
    const hasMore = rows.length > HISTORY_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows;
    if (page.length === 0) {
      return NextResponse.json({ ok: true, invoices: [], hasMore: false });
    }

    const counts = await db
      .select({ invoiceId: invoiceItems.invoiceId, n: sql<number>`COUNT(*)` })
      .from(invoiceItems)
      .groupBy(invoiceItems.invoiceId);
    const countBy = new Map(counts.map((c) => [c.invoiceId, Number(c.n)]));

    const blobUrls = isBlobConfigured() ? await listBlobInvoiceFiles() : null;
    const localUrl = (key: string) =>
      `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;

    const list: HistoryRow[] = page.map((row) => {
      // invoiceStorageKey only needs the number and the customer name.
      const record = {
        invoice: row.invoice,
        customer: row.customerName ? { name: row.customerName } : null,
        items: [],
        workItems: [],
      } as unknown as InvoiceRecord;
      const fileUrl = (key: string): string | null =>
        blobUrls ? (blobUrls.get(key) ?? null) : localUrl(key);
      return {
        invoiceNumber: row.invoice.invoiceNumber,
        createdAt: row.invoice.createdAt,
        customerName: row.customerName ?? "",
        customerEmail: row.customerEmail ?? "",
        make: row.invoice.make,
        model: row.invoice.model,
        regNo: row.invoice.regNo,
        mileage: row.invoice.mileage,
        subtotal: row.invoice.subtotal,
        vat: row.invoice.vat,
        discount: row.invoice.discount,
        total: row.invoice.total,
        currency: row.invoice.currency,
        itemCount: countBy.get(row.invoice.id) ?? 0,
        pdfUrl: fileUrl(invoiceStorageKey(record, "pdf")),
        csvUrl: fileUrl(invoiceStorageKey(record, "csv")),
      };
    });
    return NextResponse.json({ ok: true, invoices: list, hasMore });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}