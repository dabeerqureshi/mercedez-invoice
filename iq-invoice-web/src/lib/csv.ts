/**
 * Invoice CSV export — port of csv_export.export_invoice_csv().
 *
 * Returns the CSV as a string. Row order and columns match the desktop app
 * exactly (header block, description of work, parts, totals).
 */
import type { InvoiceRecord } from "./db/repo";

/** Quote a CSV field the way Python's csv.writer does (only when needed). */
function q(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(fields: unknown[]): string {
  return fields.map(q).join(",");
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export function exportInvoiceCsv(record: InvoiceRecord): string {
  const { invoice, customer, items, workItems } = record;
  const invoiceNumber = Math.trunc(invoice.invoiceNumber);
  const dateStr = invoice.createdAt ?? new Date().toISOString();

  const lines: string[] = [];
  lines.push(row(["Invoice", `INV-${String(invoiceNumber).padStart(6, "0")}`]));
  lines.push(row(["Date", dateStr]));
  lines.push(row(["Customer", customer?.name ?? ""]));
  lines.push(row(["Email", customer?.email ?? ""]));
  lines.push(row(["Phone", customer?.phone ?? ""]));
  lines.push(row(["Vehicle Make", invoice.make ?? ""]));
  lines.push(row(["Vehicle Model", invoice.model ?? ""]));
  lines.push(row(["Vehicle Reg", invoice.regNo ?? ""]));
  lines.push(row(["Mileage", invoice.mileage ?? ""]));
  lines.push(row([]));
  lines.push(
    row(["DESCRIPTION OF WORK", "OPER No.", "Time", "LABOUR COST"]),
  );
  for (const w of workItems) {
    lines.push(
      row([
        w.description ?? "",
        w.operNo ?? "",
        w.timeHours ?? "",
        num(w.labourCost),
      ]),
    );
  }
  lines.push(row([]));
  lines.push(
    row(["Part Number", "Description", "Qty", "Unit Price", "Line Total"]),
  );
  for (const it of items) {
    lines.push(
      row([
        it.partNumber,
        it.designation ?? "",
        it.quantity,
        num(it.unitPrice),
        num(it.lineTotal),
      ]),
    );
  }
  lines.push(row([]));
  lines.push(row(["Subtotal", "", "", "", num(invoice.subtotal)]));
  lines.push(row(["VAT", "", "", "", num(invoice.vat)]));
  lines.push(row(["Discount", "", "", "", num(invoice.discount)]));
  lines.push(row(["TOTAL", "", "", "", num(invoice.total)]));

  // csv.writer writes "\r\n" by default.
  return lines.join("\r\n") + "\r\n";
}