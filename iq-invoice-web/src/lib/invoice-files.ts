/**
 * Invoice output-file naming — port of csv_export.py.
 *
 * One place builds the saved file names so the PDF and CSV always match:
 *   Invoices/<year>/INV-000123-John-Smith.pdf
 *   Invoices/<year>/INV-000123-John-Smith.csv
 */
import { safeNamePart } from "./pricing";
import type { InvoiceRecord } from "./db/repo";

/** Base name without extension, e.g. "INV-000123-John-Smith". */
export function invoiceFileBase(record: InvoiceRecord): string {
  const base = `INV-${String(Math.trunc(record.invoice.invoiceNumber)).padStart(
    6,
    "0",
  )}`;
  const name = safeNamePart(record.customer?.name ?? "");
  return name ? `${base}-${name}` : base;
}

/** File name with extension, e.g. "INV-000123-John-Smith.pdf". */
export function invoiceFilename(record: InvoiceRecord, ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase();
  return `${invoiceFileBase(record)}.${clean}`;
}

/** Storage key "Invoices/<year>/<file>" for an invoice record. */
export function invoiceStorageKey(
  record: InvoiceRecord,
  ext: string,
): string {
  const year = new Date().getFullYear();
  return `Invoices/${year}/${invoiceFilename(record, ext)}`;
}