/**
 * Mercedes B2B site constants — port of the Mercedes section of
 * mercedes_invoice/config.py.
 *
 * The Python desktop app could afford very generous timeouts because the
 * browser ran locally and the UI sat on a background thread. On Vercel every
 * lookup runs inside a function with a hard wall-clock budget, so the timeouts
 * default to smaller values here (still overridable via environment), and the
 * connector additionally honours a per-lookup deadline. Behaviour — selectors,
 * trigger order, retry semantics — is otherwise identical.
 */
import { MERCEDES_B2B_URL, MERCEDES_CATALOG_URL, PRICE_FIELD } from "../config";

export { MERCEDES_B2B_URL, MERCEDES_CATALOG_URL, PRICE_FIELD };

/** Generic search-input selector (fallback). */
export const MERCEDES_SEARCH_SELECTOR = "input[type=search], input[type=text]";
/** Optional shop override for the part-search input selector. */
export const MERCEDES_PART_SEARCH_SELECTOR =
  process.env.MERCEDES_PART_SEARCH_SELECTOR ?? "";
/** Reset the catalog landing before every scan (SPA re-render workaround). */
export const MERCEDES_RESET_CATALOG_BEFORE_SCAN =
  (process.env.MERCEDES_RESET_CATALOG_BEFORE_SCAN ?? "true") !== "false";
/** Human-like keystroke delay when typing the part number. */
export const MERCEDES_TYPE_DELAY_MS = 30;

// Timeouts (ms). Python defaults: nav 120000 / response 60000 — reduced here
// to fit a serverless function run; override via env if your plan allows more.
export const MERCEDES_NAV_TIMEOUT_MS = Number(
  process.env.MERCEDES_NAV_TIMEOUT_MS || 25000,
);
export const MERCEDES_RESPONSE_TIMEOUT_MS = Number(
  process.env.MERCEDES_RESPONSE_TIMEOUT_MS || 18000,
);
/**
 * Total wall-clock budget for one price lookup inside /api/price
 * (session create + CDP connect + catalog reset + up to two search attempts).
 * Kept under the route's maxDuration so a failure is ours, not a function kill.
 */
export const MERCEDES_LOOKUP_BUDGET_MS = Number(
  process.env.MERCEDES_LOOKUP_BUDGET_MS || 50000,
);

/** Best-effort tick of the site's "keep me signed in" switch. */
export const MERCEDES_REMEMBER_ME =
  (process.env.MERCEDES_REMEMBER_ME ?? "true") !== "false";

// --- Browserbase session lifetimes (seconds) -------------------------------
/** Manual-login session: long enough to complete SSO + MFA comfortably. */
export const LOGIN_SESSION_TIMEOUT_S = 1800;
/** Verification session: just needs to load the catalog and check the session. */
export const VERIFY_SESSION_TIMEOUT_S = 120;
/** Price lookup session: auto-ends when the CDP connection drops. */
export const PRICE_SESSION_TIMEOUT_S = 300;

// --- Session keep-alive (Phase 4) -------------------------------------------
/**
 * Quiet catalog refresh between scans, port of MERCEDES_KEEP_ALIVE_S from
 * config.py (240s default, 0 disables). Fires from the open POS page as a
 * timer and from Vercel Cron / an external pinger when nobody has the page
 * open; the server skips the refresh while a lookup happened recently.
 */
export const MERCEDES_KEEP_ALIVE_S = Number(
  process.env.MERCEDES_KEEP_ALIVE_S || 240,
);

/** Context name shown in the Browserbase dashboard. */
export const BROWSERBASE_CONTEXT_NAME = "iq-invoice-mercedes";

/** Substrings that identify a Mercedes login/auth screen (from mercedes.py). */
export const LOGIN_URL_MARKERS = [
  "login",
  "signin",
  "sign-in",
  "/auth",
  "sso",
  "ucp",
  "authorization.ping",
  "resumepath=",
] as const;

/** Body-text hints that the page is a login screen (from mercedes.py). */
export const LOGIN_TEXT_MARKERS = [
  "sign in",
  "log in",
  "user name",
  "password",
  "microsoft",
  "verify your identity",
] as const;

/** Attribute hints that an input is the vehicle/VIN search, not part search. */
export const VEHICLE_HINTS = [
  "vin",
  "vehicle",
  "chassis",
  "frame",
  "registration",
  "reg-",
  "wmi",
  "model",
  "body",
  "ident",
] as const;

/** Error messages surfaced by the connector (exact desktop wording). */
export const MSG_LOGIN_REQUIRED =
  "Mercedes login required (session expired). Use the 'Open Mercedes & Login' button and sign in.";
export const MSG_LOGIN_REQUIRED_SHORT = "Mercedes login required (session expired).";
export const MSG_NO_SELECTOR =
  "Could not find the Mercedes part-search field. Tune MERCEDES_PART_SEARCH_SELECTOR / MERCEDES_SEARCH_SELECTOR (see config.py) after logging in.";
