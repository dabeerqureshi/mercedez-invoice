/**
 * Mercedes B2B Connect connector (Playwright over Browserbase) — port of
 * mercedes_invoice/connectors/mercedes.py.
 *
 * Design:
 *   * The desktop app drove a persistent LOCAL Chromium profile off disk; here
 *     every lookup opens a short-lived Browserbase session bound to a
 *     persistent Context, so the Mercedes login lives in the Context exactly
 *     like it lived in the profile directory ("log in once, use all day").
 *   * get_price() drives the real catalog page (fills the part-search box)
 *     and captures the price API response, matching any JSON response that
 *     carries a partList — no hard-coded endpoint URL.
 *   * Errors are categorised for the UI: LoginRequiredError,
 *     PartNotFoundError, generic PriceSourceError — wording matches the
 *     desktop release verbatim.
 *   * One Browserbase session at a time (free-plan limit AND a site
 *     anti-concurrency rule), serialised by lib/lock; a per-lookup deadline
 *     keeps the work inside the serverless function budget.
 */
import type { Locator, Page } from "playwright-core";

import {
  createSession,
  endSession,
  isBrowserbaseConfigured,
  withPage,
  type CreatedSession,
} from "../browserbase";
import { getSessionState, touchActivity } from "../db/session-store";
import { withLock } from "../lock";
import * as cfg from "./mercedes-config";
import {
  LoginRequiredError,
  PartNotFoundError,
  PriceResult,
  PriceSource,
  PriceSourceError,
  nowIso,
} from "./types";

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Canonical compact form: 'A   000 828 03 88' -> 'A0008280388'. */
function normalize(part: string): string {
  return (part || "").replace(/\s+/g, "").toUpperCase();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function remaining(deadline: number): number {
  return deadline - Date.now();
}

export class MercedesPriceSource implements PriceSource {
  name = "mercedes";

  async getPrice(partNumber: string): Promise<PriceResult> {
    if (!isBrowserbaseConfigured()) {
      throw new LoginRequiredError(
        "Mercedes live pricing is not configured. Set BROWSERBASE_API_KEY " +
          "(and BROWSERBASE_PROJECT_ID), or use the mock source with " +
          "NEXT_PUBLIC_PRICE_SOURCE=mock.",
      );
    }
    // The connection state gates the lookup exactly like the desktop app's
    // login check did: no authenticated session -> honest LoginRequiredError,
    // never a silent mock price.
    const state = await getSessionState();
    if (!state || state.status !== "connected" || !state.contextId) {
      throw new LoginRequiredError(
        state?.status === "pending_login"
          ? "Mercedes login is still in progress. Finish signing in via " +
            "'Open Mercedes & Login', then scan again."
          : "Mercedes login required. Use the 'Open Mercedes & Login' button and sign in.",
      );
    }
    const contextId = state.contextId;
    // Serialise: one session on one Context at a time (Browserbase rule).
    const result = await withLock(() => lookupPrice(partNumber, contextId));
    // Phase 4: remember the activity so the keep-alive can skip its refresh.
    await touchActivity();
    return result;
  }

  get status(): string {
    // Configuration only — live connection state is shown by the header badge
    // (fetched from /api/mercedes/status, since it lives in the database).
    return isBrowserbaseConfigured()
      ? "mercedes (Browserbase cloud browser)"
      : "mercedes (not configured — set BROWSERBASE_API_KEY)";
  }
}

export interface KeepAliveOutcome {
  action:
    | "not_configured"
    | "disabled"
    | "disconnected"
    | "recent_activity"
    | "refreshed"
    | "login_page"
    | "error";
  detail?: string;
}

/**
 * Quiet activity to stop Mercedes' idle-timeout logging you out mid-day —
 * port of MercedesPriceSource.keep_alive() from mercedes.py.
 *
 * The desktop app softly reloaded the parked catalog page from a background
 * timer; here we open a short session on the persistent Context and load the
 * catalog once (a fresh session starts on about:blank, so that load IS the
 * refresh). If the site bounces to a login screen we just report it —
 * get_price() still surfaces an honest LoginRequiredError on the next scan,
 * exactly like the desktop behaviour.
 */
export async function keepAliveSession(): Promise<KeepAliveOutcome> {
  if (!isBrowserbaseConfigured()) return { action: "not_configured" };
  if (cfg.MERCEDES_KEEP_ALIVE_S <= 0) return { action: "disabled" };
  const state = await getSessionState();
  if (!state || state.status !== "connected" || !state.contextId) {
    return { action: "disconnected" };
  }
  // Idle guard: a recent lookup already refreshed the site session.
  const last = state.lastActivityAt
    ? Date.parse(
        state.lastActivityAt.endsWith("Z")
          ? state.lastActivityAt
          : `${state.lastActivityAt}Z`,
      )
    : NaN;
  if (
    Number.isFinite(last) &&
    Date.now() - last < cfg.MERCEDES_KEEP_ALIVE_S * 1000
  ) {
    return { action: "recent_activity" };
  }

  const contextId = state.contextId;
  return withLock(async () => {
    let session: CreatedSession;
    try {
      session = await createSession({
        contextId,
        timeoutSeconds: cfg.VERIFY_SESSION_TIMEOUT_S,
        keepAlive: false,
      });
    } catch (e) {
      return {
        action: "error" as const,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
    try {
      return await withPage(session.connectUrl, async (page) => {
        await page
          .goto(cfg.MERCEDES_CATALOG_URL, {
            waitUntil: "domcontentloaded",
            timeout: cfg.MERCEDES_NAV_TIMEOUT_MS,
          })
          .catch(() => undefined);
        if (await isLoginPage(page)) return { action: "login_page" as const };
        return { action: "refreshed" as const };
      });
    } finally {
      await endSession(session.id);
    }
  });
}

/**
 * Open a fresh Browserbase session on the authenticated Context, run one
 * catalog search, then disconnect (which ends the non-keepAlive session).
 */
async function lookupPrice(
  partNumber: string,
  contextId: string,
): Promise<PriceResult> {
  const deadline = Date.now() + cfg.MERCEDES_LOOKUP_BUDGET_MS;
  let session: CreatedSession;
  try {
    session = await createSession({
      contextId,
      timeoutSeconds: cfg.PRICE_SESSION_TIMEOUT_S,
      keepAlive: false,
    });
  } catch (e) {
    throw new PriceSourceError(
      `Could not start a Mercedes browser session: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  try {
    return await withPage(session.connectUrl, (page) =>
      searchCatalog(page, partNumber, deadline),
    );
  } finally {
    // withPage already disconnected (auto-ends the session); this covers the
    // case where connecting failed before withPage could run.
    await endSession(session.id);
  }
}

/** The get_price() body from mercedes.py, adapted to async Playwright. */
async function searchCatalog(
  page: Page,
  partNumber: string,
  deadline: number,
): Promise<PriceResult> {
  // Reset to the catalog landing before every scan (unless disabled): the SPA
  // re-renders after a search and 'first input' can land on the vehicle
  // search bar, which is why the 2nd+ scan would otherwise fail.
  await safeNav(page, cfg.MERCEDES_CATALOG_URL, {
    force: cfg.MERCEDES_RESET_CATALOG_BEFORE_SCAN,
    deadline,
  });

  const canon = normalize(partNumber);
  if (!canon) throw new PartNotFoundError("Empty part number.");

  const search = await locateSearch(page);

  let body: Json | null = null;
  let siteError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    // Search button first, Enter as fallback; budget guard for the deadline.
    if (remaining(deadline) < 4000) break;
    // Human-like entry on every attempt (the SPA may clear the field after a
    // failed submit).
    await enterPartNumber(search, canon);
    try {
      body = await capturePriceResponse(page, search, attempt, deadline);
      if (body !== null && (await searchErrorShown(page))) {
        // Mercedes surfaced its generic error toast -> the submit path was
        // wrong/transient; retry with the other trigger.
        siteError =
          "Mercedes showed 'Something went wrong. Please try again later.'";
        body = null;
        continue;
      }
      if (body !== null) break;
    } catch (e) {
      if (await isLoginPage(page)) {
        throw new LoginRequiredError(cfg.MSG_LOGIN_REQUIRED);
      }
      throw e instanceof PriceSourceError
        ? e
        : new PriceSourceError(
            `Mercedes search failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
    }
    // body === null -> no price response within the timeout.
    if (await isLoginPage(page)) throw new LoginRequiredError(cfg.MSG_LOGIN_REQUIRED);
    siteError = "the catalog returned no price response (timeout)";
  }

  if (body === null) {
    throw new PriceSourceError(
      "Could not retrieve the live Mercedes price for this part. " +
        (siteError ? siteError + ". " : "") +
        "Check the part number and your session, then scan again.",
    );
  }

  // succeed / responseCode live inside partInfoResult on the real API.
  const { meta } = partInfo(body);
  const source = meta ?? body;
  const succeed = "succeed" in source ? source.succeed : body.succeed;
  const code = String(source.responseCode ?? body.responseCode ?? "");
  if (succeed !== true) {
    if (code.toUpperCase().includes("AUTH")) {
      throw new LoginRequiredError(cfg.MSG_LOGIN_REQUIRED_SHORT);
    }
    throw new PriceSourceError(`Mercedes request failed: ${code}`);
  }

  return extractPrice(body, canon);
}

// -- navigation / login detection -------------------------------------------

/**
 * Best-effort check of whether the browser is on a login/auth screen.
 * Exported for the /api/mercedes/verify route, which uses the same detection.
 */
export async function isLoginPage(page: Page): Promise<boolean> {
  let url = "";
  try {
    url = (page.url() || "").toLowerCase();
  } catch {
    url = "";
  }
  if (cfg.LOGIN_URL_MARKERS.some((k) => url.includes(k))) return true;
  try {
    const text = (
      await page.locator("body").innerText({ timeout: 3000 })
    ).toLowerCase();
    if (cfg.LOGIN_TEXT_MARKERS.some((k) => text.includes(k))) return true;
  } catch {
    // Best effort — same as the desktop implementation.
  }
  return false;
}

/**
 * Navigate to *url*, turning login redirects into LoginRequiredError.
 *
 * Live Mercedes bounces the catalog to its login/auth host when the session is
 * missing or expired ("Navigation interrupted by another navigation to
 * https://login.mercedes-benz.com…"); we translate that (and any "ended up on
 * the login page") into LoginRequiredError so the UI prompts for a sign-in
 * instead of surfacing a confusing generic error.
 *
 * Navigation is skipped when already on the target host (unless force=true,
 * used to reset the catalog to its clean landing before each scan).
 */
async function safeNav(
  page: Page,
  url: string,
  opts: { force?: boolean; deadline: number },
): Promise<void> {
  const targetHost = new URL(url).host.toLowerCase();
  const curr = (page.url() || "").toLowerCase();
  const alreadyThere =
    !opts.force && !!curr && curr.includes(targetHost) && !(await isLoginPage(page));

  if (!alreadyThere) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(
          Math.min(cfg.MERCEDES_NAV_TIMEOUT_MS, remaining(opts.deadline)),
          1000,
        ),
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).toLowerCase();
      const interrupted = msg.includes("navigation interrupted") && msg.includes("login");
      if (interrupted || (await isLoginPage(page))) {
        throw new LoginRequiredError(cfg.MSG_LOGIN_REQUIRED);
      }
      throw new PriceSourceError(`Mercedes navigation failed: ${e}`);
    }
  }

  // A "successful" goto can still end up redirected onto the login page.
  if (await isLoginPage(page)) throw new LoginRequiredError(cfg.MSG_LOGIN_REQUIRED);
}

// -- part-search field -------------------------------------------------------

/** Priority-ordered selector list that targets the *part* search input. */
function partSearchCandidates(): string[] {
  const override = (cfg.MERCEDES_PART_SEARCH_SELECTOR || "").trim();
  if (override) return [override];
  return [
    'input[placeholder*="part" i]',
    'input[placeholder*="article" i]',
    'input[placeholder*="oem" i]',
    'input[placeholder*="part number" i]',
    'input[name*="part" i]',
    'input[id*="part" i]',
    'input[aria-label*="part" i]',
    'input[type="search"]',
    "input[type=text]",
  ];
}

/** Best-effort: is this search input the vehicle/VIN one (not the part box)? */
async function looksLikeVehicleInput(loc: Locator): Promise<boolean> {
  try {
    const attrs = await Promise.all([
      loc.getAttribute("placeholder"),
      loc.getAttribute("aria-label"),
      loc.getAttribute("name"),
      loc.getAttribute("id"),
    ]);
    const blob = attrs.filter(Boolean).join(" ").toLowerCase();
    return cfg.VEHICLE_HINTS.some((h) => blob.includes(h));
  } catch {
    return false;
  }
}

async function locateSearch(page: Page): Promise<Locator> {
  // Try the part-specific candidates first: pick the first one that is
  // visible AND not the vehicle/VIN search field.
  for (const sel of partSearchCandidates()) {
    const locAll = page.locator(sel);
    const count = await locAll.count();
    if (count === 0) continue;
    for (let idx = 0; idx < count; idx++) {
      const one = locAll.nth(idx);
      if (await looksLikeVehicleInput(one)) continue;
      if (await one.isVisible().catch(() => false)) return one;
    }
  }

  // Fall back to the configured generic selector (still skipping vehicle).
  try {
    const locAll = page.locator(cfg.MERCEDES_SEARCH_SELECTOR);
    const count = await locAll.count();
    for (let idx = 0; idx < count; idx++) {
      const one = locAll.nth(idx);
      if (await looksLikeVehicleInput(one)) continue;
      if (await one.isVisible().catch(() => false)) return one;
    }
  } catch {
    // Fall through to the error below.
  }

  throw new PriceSourceError(cfg.MSG_NO_SELECTOR);
}

/**
 * Find the Search button belonging to the part field's own form.
 *
 * Scoping to the field's container prevents clicking a header/global search
 * button instead of the part-search one. Returns null when none is found.
 */
async function scopedSearchButton(search: Locator): Promise<Locator | null> {
  const scopes: Locator[] = [];
  try {
    const form = search.locator("xpath=ancestor::form[1]");
    if (await form.count()) scopes.push(form);
  } catch {
    // No form ancestor.
  }
  try {
    // SPAs often don't use <form>; take the nearest ancestor that owns a
    // button as the container fallback.
    const wrap = search.locator("xpath=ancestor::div[.//button][1]");
    if (await wrap.count()) scopes.push(wrap);
  } catch {
    // No container ancestor.
  }

  for (const scope of scopes) {
    try {
      const btn = scope.getByRole("button", { name: /search/i });
      if (await btn.count()) return btn.first();
      const alt = scope.locator(
        "button[type=submit], input[type=submit], button:has-text('Search')",
      );
      if (await alt.count()) return alt.first();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Submit the part search. The catalog's own Search button is the reliable
 * path (Enter submits an alternate/invalid flow and surfaces Mercedes'
 * generic 'Something went wrong' toast), so the button is tried first and
 * Enter is only the fallback.
 */
async function triggerSearch(
  page: Page,
  search: Locator,
  attempt: number,
): Promise<void> {
  const btn = await scopedSearchButton(search);
  if (btn) {
    await btn.click();
    return;
  }
  if (attempt === 0) {
    // No scoped button found -> try a page-level Search button once.
    try {
      const pageBtn = page.getByRole("button", { name: /^search$/i });
      if (await pageBtn.count()) {
        await pageBtn.first().click();
        return;
      }
    } catch {
      // Fall through to Enter.
    }
  }
  await search.press("Enter");
}

/**
 * Type the part number like a human and verify the field holds it.
 *
 * Real key events (rather than fill()) let Mercedes' own React handlers and
 * formatters run exactly as if typed by hand — fill() can leave their internal
 * state out of sync so the search silently fails. Reading the value back
 * afterwards removes any race where the search is submitted before the SPA
 * accepted the text.
 */
async function enterPartNumber(search: Locator, canon: string): Promise<void> {
  await search.click().catch(() => undefined);
  await search.fill("").catch(() => undefined); // clear any previous value

  let typed = false;
  try {
    await search.pressSequentially(canon, { delay: cfg.MERCEDES_TYPE_DELAY_MS });
    typed = true;
  } catch {
    // Try the fallback below.
  }
  if (!typed) {
    await search.fill(canon).catch(() => undefined); // last resort
  }

  // Verify the field really holds the number (any site formatting OK).
  try {
    const value = normalize((await search.inputValue()) ?? "");
    if (value !== canon) await search.fill(canon);
  } catch {
    // Best effort — same as the desktop implementation.
  }
}

/** True if Mercedes displayed its generic 'Something went wrong' toast. */
async function searchErrorShown(page: Page): Promise<boolean> {
  try {
    const loc = page.getByText(/something went wrong/i);
    return (await loc.count()) > 0 && (await loc.first().isVisible());
  } catch {
    return false;
  }
}

// -- price API capture / parsing --------------------------------------------

/** Match any API response carrying a price part-list, regardless of URL. */
function isPriceResponse(body: unknown): boolean {
  if (!isRecord(body)) return false;
  // The real Mercedes API returns the part list under
  // partInfoResult.data.partList (a legacy shape used body.data.partList).
  const pinfo = isRecord(body.partInfoResult) ? body.partInfoResult : null;
  const candidates: unknown[] = [body.data, pinfo ? pinfo.data : undefined];
  for (const candidate of candidates) {
    if (isRecord(candidate) && Array.isArray(candidate.partList)) return true;
  }
  return false;
}

/**
 * Trigger the search and wait for the price API response (equivalent of
 * Python's `with page.expect_response(...)`). Returns the parsed JSON body or
 * null when no price response arrived within the timeout.
 */
async function capturePriceResponse(
  page: Page,
  search: Locator,
  attempt: number,
  deadline: number,
): Promise<Json | null> {
  const timeout = Math.max(
    Math.min(cfg.MERCEDES_RESPONSE_TIMEOUT_MS, remaining(deadline)),
    1000,
  );
  let captured: Json | null = null;
  const pending = page
    .waitForResponse(
      async (response) => {
        try {
          const json: unknown = await response.json();
          if (isPriceResponse(json)) {
            captured = json as Json;
            return true;
          }
        } catch {
          // Not a JSON body — keep waiting.
        }
        return false;
      },
      { timeout },
    )
    .catch(() => null);
  // If triggerSearch throws, `pending` still has its own catch handler, so it
  // can never surface as an unhandled rejection.
  await triggerSearch(page, search, attempt);
  await pending;
  return captured;
}

/** Locate the part-list container and its metadata in the response. */
function partInfo(body: Json): { data: Json | null; meta: Json | null } {
  const pinfo = body.partInfoResult;
  if (isRecord(pinfo)) {
    const data = pinfo.data;
    if (isRecord(data) && Array.isArray(data.partList)) {
      return { data, meta: pinfo };
    }
  }
  const data = body.data;
  if (isRecord(data) && Array.isArray(data.partList)) {
    return { data, meta: body };
  }
  return { data: null, meta: null };
}

/** Build the PriceResult from the captured response (list|net price field). */
function extractPrice(body: Json, canon: string): PriceResult {
  const { data } = partInfo(body);
  if (!data) {
    throw new PartNotFoundError(`Mercedes returned no price for part '${canon}'.`);
  }
  const parts = Array.isArray(data.partList) ? data.partList : [];
  if (parts.length === 0 || !isRecord(parts[0])) {
    throw new PartNotFoundError(`Mercedes returned no price for part '${canon}'.`);
  }
  const part = parts[0] as Json;
  if (part.isUnknownPart || part.isInvalidPart) {
    throw new PartNotFoundError(`Mercedes returned no price for part '${canon}'.`);
  }

  const field = `${cfg.PRICE_FIELD}PricePerUnit`;
  const priceObj = isRecord(part.price) ? part.price[field] : undefined;
  if (!isRecord(priceObj)) {
    throw new PriceSourceError(
      `Mercedes response has no '${field}' for part '${canon}'.`,
    );
  }

  const amount = Number(priceObj.amount ?? 0) || 0;
  const fraction = isRecord(priceObj.fraction) ? priceObj.fraction : {};
  const digit = Number(fraction.digitCount ?? 0) || 0;
  const price = round2(amount / Math.pow(10, Math.max(digit, 0)));
  const currency =
    (isRecord(priceObj.currency) ? (priceObj.currency.unit as string) : "") ||
    "GBP";
  const designation =
    typeof part.designation === "string" ? part.designation : "";

  return {
    partNumber: canon,
    price,
    currency: String(currency),
    retrievedAt: nowIso(),
    designation,
  };
}




