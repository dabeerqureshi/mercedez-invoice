/**
 * Invoice pipeline — port of the checkout_dialog save flow.
 *
 * Order (identical to the desktop app):
 *   SQLite save  ->  PDF  ->  CSV  ->  storage  ->  email
 *
 * The invoice is always saved to the database FIRST, so a PDF/email failure
 * never loses data; the caller can offer "Retry Email".
 */
import { CURRENCY_CODE, VAT_RATE } from "./config";
import { exportInvoiceCsv } from "./csv";
import type { InvoiceItemInput, VehicleInput } from "./db/repo";
import { getInvoice, saveInvoice } from "./db/repo";
import { sendInvoiceEmail } from "./email";
import { invoiceFilename, invoiceStorageKey } from "./invoice-files";
import { renderInvoicePdf } from "./pdf/invoice";
import { computeTotals, round2 } from "./pricing";
import type { PartsLine, WorkLine } from "./pricing";
import { saveInvoiceFile } from "./storage";

export interface ProcessInput {
  customer: { name: string; phone?: string; email?: string };
  vehicle: VehicleInput;
  parts: Array<{
    partNumber: string;
    designation?: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    priceRetrievedAt?: string;
  }>;
  workItems: Array<{
    description: string;
    operNo?: string;
    timeHours?: string;
    labourCost: number;
  }>;
}

export interface ProcessResult {
  ok: boolean;
  saved: boolean;
  invoiceNumber: number | null;
  totals: ReturnType<typeof computeTotals>;
  pdfUrl: string | null;
  csvUrl: string | null;
  storage: "blob" | "local" | null;
  emailed: boolean;
  emailError: string;
  error: string;
}

export async function processInvoice(input: ProcessInput): Promise<ProcessResult> {
  const parts: PartsLine[] = input.parts
    .filter((p) => (p.partNumber ?? "").trim() !== "")
    .map((p) => ({
      partNumber: p.partNumber.trim(),
      designation: p.designation ?? "",
      quantity: Number(p.quantity) || 1,
      unitPrice: Number(p.unitPrice) || 0,
      lineTotal: round2(Number(p.lineTotal) || 0),
    }));

  const workItems: WorkLine[] = input.workItems
    .filter((w) => (w.description ?? "").trim() !== "")
    .map((w) => ({
      description: (w.description ?? "").trim(),
      operNo: (w.operNo ?? "").trim(),
      timeHours: (w.timeHours ?? "").trim(),
      labourCost: round2(Number(w.labourCost) || 0),
    }));

  const totals = computeTotals(parts, workItems);

  const retrievedBy = new Map(
    input.parts.map((p) => [p.partNumber.trim(), p.priceRetrievedAt ?? ""]),
  );

  const items: InvoiceItemInput[] = parts.map((p) => ({
    partNumber: p.partNumber,
    designation: p.designation,
    quantity: p.quantity,
    unitPrice: p.unitPrice,
    lineTotal: p.lineTotal,
    vat: round2(round2(p.lineTotal) * VAT_RATE),
    discount: 0,
    priceRetrievedAt: retrievedBy.get(p.partNumber) ?? "",
  }));

  const record = await saveInvoice({
    customer: input.customer,
    items,
    subtotal: totals.subtotal,
    vat: totals.vat,
    discount: 0,
    total: totals.total,
    currency: CURRENCY_CODE,
    vehicle: input.vehicle,
    workItems,
  });

  const invoiceNumber = Math.trunc(record.invoice.invoiceNumber);

  const base: ProcessResult = {
    ok: true,
    saved: true,
    invoiceNumber,
    totals,
    pdfUrl: null,
    csvUrl: null,
    storage: null,
    emailed: false,
    emailError: "",
    error: "",
  };

  // PDF + CSV. On failure the invoice is still saved; report it.
  let pdf: Buffer;
  try {
    pdf = await renderInvoicePdf(record);
    const csv = exportInvoiceCsv(record);
    const pdfFile = await saveInvoiceFile({
      key: invoiceStorageKey(record, "pdf"),
      data: pdf,
    });
    const csvFile = await saveInvoiceFile({
      key: invoiceStorageKey(record, "csv"),
      data: csv,
    });
    base.pdfUrl = pdfFile.url;
    base.csvUrl = csvFile.url;
    base.storage = pdfFile.storage;
  } catch (e) {
    return {
      ...base,
      ok: false,
      error:
        `Invoice INV-${String(invoiceNumber).padStart(6, "0")} was saved to the ` +
        `database but the PDF/CSV could not be generated: ` +
        (e instanceof Error ? e.message : String(e)),
    };
  }

  // Email (failure never loses data).
  const send = await sendInvoiceEmail({
    to: input.customer.email ?? "",
    pdf,
    filename: invoiceFilename(record, "pdf"),
    invoiceNumber,
  });
  base.emailed = send.ok;
  base.emailError = send.ok ? "" : send.error;

  return base;
}

/** Regenerate the PDF from the stored record and email it again. */
export async function resendInvoiceEmail(
  invoiceNumber: number,
): Promise<{ ok: boolean; error: string }> {
  const record = await getInvoice(invoiceNumber);
  if (!record) {
    return { ok: false, error: `Invoice INV-${invoiceNumber} not found.` };
  }
  const pdf = await renderInvoicePdf(record);
  return sendInvoiceEmail({
    to: record.customer?.email ?? "",
    pdf,
    filename: invoiceFilename(record, "pdf"),
    invoiceNumber,
  });
}