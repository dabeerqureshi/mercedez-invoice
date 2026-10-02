/**
 * PriceSource interface — port of mercedes_invoice/connectors/base.py.
 *
 * The whole application talks to this interface only, so the rest of the
 * system never cares where the price came from (the real Mercedes site via
 * Browserbase today, or a different vendor later).
 */

export interface PriceResult {
  partNumber: string;
  price: number;
  currency: string;
  /** ISO timestamp persisted with the invoice item. */
  retrievedAt: string;
  /** Product name / description. */
  designation: string;
}

export function nowIso(): string {
  // Python: datetime.now().isoformat(timespec="seconds") -> no timezone suffix
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

/** Base for price-lookup errors surfaced to the UI. */
export class PriceSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceSourceError";
  }
}

/** The requested part number returned no usable result. */
export class PartNotFoundError extends PriceSourceError {
  constructor(message: string) {
    super(message);
    this.name = "PartNotFoundError";
  }
}

/** The Mercedes session is not authenticated / has expired. */
export class LoginRequiredError extends PriceSourceError {
  constructor(message: string) {
    super(message);
    this.name = "LoginRequiredError";
  }
}

/**
 * Canonical compact form of a Mercedes part number, e.g.
 * 'A   000 828 03 88' -> 'A0008280388' (spaces stripped, upper-cased).
 *
 * Lives here (rather than in index.ts) so client components can import it
 * without pulling in the server-only connectors (Browserbase / Playwright).
 */
export function normalizePart(part: string): string {
  return (part || "").replace(/\s+/g, "").toUpperCase();
}

export interface PriceSource {
  /** Identifier used in settings / logs. */
  name: string;
  getPrice(partNumber: string): Promise<PriceResult>;
  close?(): Promise<void> | void;
  /** Human-readable status shown in the UI status bar. */
  status: string;
}
