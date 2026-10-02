/**
 * Invoice maths — port of ui/checkout_dialog.py (_calc).
 *
 *   SUBTOTAL = parts total + sum(labour cost)
 *   VAT @20% = SUBTOTAL x 20%
 *   TOTAL    = SUBTOTAL + VAT
 *
 * Every value is rounded to 2 decimals at each step, matching the Python
 * implementation exactly so the web app produces identical totals.
 */
import { VAT_RATE } from "./config";

export interface PartsLine {
  partNumber: string;
  designation: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface WorkLine {
  description: string;
  operNo: string;
  timeHours: string;
  labourCost: number;
}

export interface Totals {
  parts: number;
  labour: number;
  subtotal: number;
  vat: number;
  total: number;
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function sumParts(rows: PartsLine[]): number {
  return round2(rows.reduce((acc, r) => acc + (Number(r.lineTotal) || 0), 0));
}

export function sumLabour(rows: WorkLine[]): number {
  return round2(rows.reduce((acc, r) => acc + (Number(r.labourCost) || 0), 0));
}

/** Return the full totals block for a set of parts + work lines. */
export function computeTotals(
  parts: PartsLine[],
  work: WorkLine[],
): Totals {
  const partsTotal = sumParts(parts);
  const labour = sumLabour(work);
  const subtotal = round2(partsTotal + labour);
  const vat = round2(subtotal * VAT_RATE);
  const total = round2(subtotal + vat);
  return { parts: partsTotal, labour, subtotal, vat, total };
}

/**
 * Parse a user-entered price cell ("£12.50", "1,200", "abc").
 * Returns the numeric value and whether it was a valid number.
 * Port of checkout_dialog.py _parse_price.
 */
export function parsePrice(text: string): { value: number; isNumber: boolean } {
  let raw = String(text ?? "").trim();
  if (raw.startsWith("£")) raw = raw.slice(1);
  raw = raw.replace(/,/g, "");
  if (raw === "") return { value: 0, isNumber: false };
  const n = Number(raw);
  if (Number.isFinite(n)) return { value: n, isNumber: true };
  return { value: 0, isNumber: false };
}

/** Sanitise a customer name into a filename segment ('John Smith' -> 'John-Smith'). */
export function safeNamePart(name: string): string {
  let cleaned = (name || "").replace(/[^A-Za-z0-9 \-_&']/g, "");
  cleaned = cleaned.trim().replace(/\s+/g, "-").replace(/-{2,}/g, "-");
  cleaned = cleaned.replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40).replace(/-+$/g, "");
}
