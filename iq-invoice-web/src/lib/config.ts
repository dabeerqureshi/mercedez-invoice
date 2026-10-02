/**
 * Application-wide configuration — port of mercedes_invoice/config.py.
 *
 * Branding, money, VAT and the price-source switch. In the web build the
 * runtime values (SMTP, Browserbase keys, DB URL) come from environment
 * variables; anything the shop should never have to touch is hardcoded here,
 * exactly like the desktop release.
 */

// --- Identity / branding ---------------------------------------------------
export const APP_NAME = "IQ Motors - Parts & Service Invoicing";
export const COMPANY_NAME = "IQ MOTORS";
export const COMPANY_TAGLINE =
  "REPAIRS AND PARTS - SPECIALIST IN MERCEDES BENZ";
export const COMPANY_ADDRESS =
  "28 Northfield Avenue, West Ealing, London W13 9RL";
export const COMPANY_EMAIL = "";
export const COMPANY_PHONE = "020 8579 9955";
export const COMPANY_MOBILE = "07771 542 186";
export const COMPANY_VAT_REG_NO = "228706791";
export const SERVICE_BOOK_NOTE =
  "We can update your DIGITAL SERVICE BOOK on Mercedes Benz System " +
  "(for Service History)";

// Default vehicle make (editable per invoice in checkout).
export const DEFAULT_VEHICLE_MAKE = "MERCEDES BENZ";

// --- Money -----------------------------------------------------------------
export const CURRENCY = "£";
export const CURRENCY_CODE = "GBP";
export const VAT_RATE = 0.2; // 20%
export const DEFAULT_DISCOUNT = 0; // fixed-amount discount on the subtotal (GBP)

/**
 * Price source selector.
 *   "mock"     -> offline deterministic prices (zero-config dev/tests)
 *   "mercedes" -> live Mercedes B2B via Browserbase (Phase 3)
 * Defaults to "mock" so a fresh clone runs with nothing set; set
 * NEXT_PUBLIC_PRICE_SOURCE=mercedes (in .env / Vercel) for live prices.
 */
export const PRICE_SOURCE =
  (process.env.NEXT_PUBLIC_PRICE_SOURCE as string) || "mock";

/** Which Mercedes price field to use: "list" | "net". */
export const PRICE_FIELD = (process.env.MERCEDES_PRICE_FIELD as string) || "list";

// Mercedes B2B site.
export const MERCEDES_B2B_URL = "https://b2bconnect.mercedes-benz.com";
export const MERCEDES_CATALOG_URL = `${MERCEDES_B2B_URL}/gb/catalog`;

// --- Email (SMTP) ----------------------------------------------------------
// Read from environment variables (never hardcode a password). When these are
// absent the invoice is still saved and the UI offers "Retry Email".
export const SMTP_HOST = process.env.SMTP_HOST ?? "";
export const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
export const SMTP_USER = process.env.SMTP_USER ?? "";
export const SMTP_PASSWORD = process.env.SMTP_PASSWORD ?? "";
export const SMTP_FROM = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "";
export const SMTP_USE_TLS = (process.env.SMTP_USE_TLS ?? "true") !== "false";

/** Format a number as currency, e.g. 290 -> "£290.00". */
export function money(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `${CURRENCY}${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format an invoice number as INV-000123. */
export function invoiceNumberLabel(n: number): string {
  return `INV-${String(Math.trunc(n)).padStart(6, "0")}`;
}
