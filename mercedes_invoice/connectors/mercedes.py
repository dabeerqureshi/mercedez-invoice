"""Mercedes B2B Connect connector (Playwright).

Design:
  * Never store or send your Mercedes password. A *persistent browser
    profile* (config.PROFILE_DIR) keeps your authenticated session, so you
    log in + MFA manually ONCE and it persists between launches.
  * get_price() drives the real catalog page (fills the part-search box) and
    captures the price API response. It matches any JSON response carrying
    data.partList, so it works without hard-coding the endpoint URL.
  * Response shape (confirmed from a live session):
        data.partList[0].price.<list|net>PricePerUnit
            .amount / 10**fraction.digitCount  => unit price
            .currency.unit                      => currency
  * Errors are categorised for the UI: LoginRequired, PartNotFound, and a
    generic PriceSourceError.
"""
import json
import os
import re
import datetime

from .. import config
from .base import (
    LoginRequiredError,
    PartNotFoundError,
    PriceResult,
    PriceSource,
    PriceSourceError,
    now_iso,
)

# Playwright is imported lazily inside the methods that need it so the app can
# run with the mock source even when Playwright is not installed.


def normalize_part(part: str) -> str:
    """Canonical compact form of a Mercedes part number, e.g.
    'A   000 828 03 88' -> 'A0008280388' (spaces stripped, upper-cased)."""
    return re.sub(r"\s+", "", part or "").upper()


def _find_chrome_exe(root: str) -> str:
    """Locate a chrome.exe inside a bundled Chromium folder (or '')."""
    import glob
    hits = glob.glob(os.path.join(root, "**", "chrome.exe"), recursive=True)
    return hits[0] if hits else ""


def _log(entry: dict) -> None:
    entry["ts"] = now_iso()
    os.makedirs(os.path.dirname(config.NETWORK_LOG) or ".", exist_ok=True)
    with open(config.NETWORK_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


class MercedesPriceSource(PriceSource):
    name = "mercedes"

    def __init__(self):
        self._pw = None
        self._context = None
        self._page = None
        self._logged_in_page_reached = False

    # -- lifecycle ------------------------------------------------------
    def launch(self) -> None:
        """(Re)open the persistent Chromium profile (headless=False).

        Idempotent: if a browser is already running it is closed first, then a
        fresh one is launched from ``config.PROFILE_DIR``. Because the profile
        is persistent, the user's Mercedes login is restored automatically —
        reopening here never requires re-logging in.

        Browser resolution order (so client machines need NOTHING installed):
          1. a Chromium bundled inside the release (config.BUNDLED_BROWSER_DIR)
          2. Microsoft Edge   (preinstalled on Windows 10/11)
          3. Google Chrome    (if installed)
          4. Playwright's own Chromium
        """
        from playwright.sync_api import sync_playwright  # lazy import

        # Clean up any previous, possibly-dead browser before relaunching.
        try:
            if self._context is not None:
                self._context.close()
        except Exception:
            pass
        try:
            if self._pw is not None:
                self._pw.stop()
        except Exception:
            pass
        self._pw = None
        self._context = None
        self._page = None

        os.makedirs(config.PROFILE_DIR, exist_ok=True)
        self._pw = sync_playwright().start()

        launch_error = None
        for kwargs in self._browser_launch_variants():
            try:
                self._context = self._pw.chromium.launch_persistent_context(
                    user_data_dir=config.PROFILE_DIR, **kwargs)
                break
            except Exception as e:  # try the next browser on the machine
                launch_error = e
                self._context = None
        if self._context is None:
            raise PriceSourceError(
                "Could not start a browser on this machine. "
                "Microsoft Edge or Google Chrome must be present "
                f"(last error: {launch_error})"
            )

        self._page = (
            self._context.pages[0]
            if self._context.pages
            else self._context.new_page()
        )
        # Start capturing network traffic for the discovery step.
        self._context.on("request", self._on_request)
        self._context.on("response", self._on_response)

    @staticmethod
    def _browser_launch_variants():
        """Launch-kwarg candidates, most self-contained first."""
        headless = {"headless": False}   # visible window: the user watches
                                         # Mercedes live in the side browser
        variants = []
        # 1) Chromium bundled inside the release folder (fully offline).
        bundled = config.BUNDLED_BROWSER_DIR
        if bundled and os.path.isdir(bundled):
            exe = _find_chrome_exe(bundled)
            if exe:
                variants.append({"executable_path": exe, **headless})
        # 2) Edge / 3) Chrome - preinstalled on virtually every Windows box.
        variants.append({"channel": "msedge", **headless})
        variants.append({"channel": "chrome", **headless})
        # 4) Playwright's own Chromium (only if its installer was ever run).
        variants.append(dict(headless))
        return variants

    def _browser_dead(self) -> bool:
        """True if the browser/context/page was closed (e.g. by the user)."""
        try:
            if self._context is None or self._page is None:
                return True
            if self._context.browser is not None and self._context.browser.is_connected() is False:
                return True
            if self._page.is_closed():
                return True
            # A closed context raises when touched.
            self._context.pages
            return False
        except Exception:
            return True

    def _ensure_browser(self) -> None:
        """Automatically (re)launch the persistent browser if it was closed.

        This is the key to "everything works even if you close the browser":
        if the user (or a crash) closes the Chromium window, the next operation
        quietly reopens it from the same profile, restoring their Mercedes
        session with no manual login and no app restart.
        """
        if self._browser_dead():
            self.launch()


    def _on_request(self, req) -> None:
        try:
            _log({"type": "request", "method": req.method, "url": req.url,
                  "post_data": req.post_data if req.method in ("POST", "PUT", "PATCH") else None})
        except Exception:
            pass

    def _on_response(self, resp) -> None:
        try:
            entry = {"type": "response", "status": resp.status, "url": resp.url}
            ctype = resp.headers.get("content-type", "")
            if "json" in ctype:
                try:
                    entry["body_preview"] = resp.text()[:2000]
                except Exception:
                    pass
            _log(entry)
        except Exception:
            pass

    def open_login(self) -> None:
        """Open the Mercedes site so you can log in / MFA manually."""
        self._ensure_browser()
        # Login *should* land on the auth page; swallow the LoginRequired for
        # this manual action (we *want* to reach the login screen).
        try:
            self._safe_nav(config.MERCEDES_B2B_URL)
        except LoginRequiredError:
            pass
        # Best-effort: tick the site's own "Keep me signed in" so the session
        # persists into/through the day (login once, open all day).
        self._try_enable_remember_me()

    def _try_enable_remember_me(self) -> None:
        """Best-effort tick of Mercedes' 'Remember / keep me signed in' switch.

        This is purely a convenience that extends the SSO session as far as
        Mercedes allows (the whole "login once per day" goal). It fails silently
        on any error — if the site's DOM doesn't expose a match, normal manual
        login still works exactly as before.
        """
        if not config.MERCEDES_REMEMBER_ME:
            return
        try:
            page = self._page
            if page is None:
                return
            selectors = (
                "[id*=remember-me-switch]", "[id*=rememberMeSwitch]",
                "input[type=checkbox][id*=emember]",
                "input[type=checkbox][id*=ersistent]",
                "input[type=checkbox][id*=keep]",
                "input[type=checkbox][id*=stay]",
            )
            for sel in selectors:
                loc = page.locator(sel).first
                if not loc.count():
                    continue
                try:
                    tag = (loc.evaluate("el => el.tagName") or "").lower()
                    ctype = (loc.get_attribute("type") or "").lower()
                except Exception:
                    tag, ctype = "", ""
                if tag == "input" and ctype == "checkbox":
                    if not loc.is_checked():
                        loc.check(force=True, timeout=3000)
                else:
                    # A labelled switch/wrapper: click it unless already on.
                    try:
                        checked = loc.get_attribute("aria-checked")
                        if checked and checked.lower() == "false":
                            loc.click(timeout=3000)
                            break
                        if checked is None:
                            loc.click(timeout=3000)
                            break
                    except Exception:
                        pass
                break
        except Exception:
            pass

    def open_parts_page(self) -> None:
        """Open the parts/B2B catalog page after manual login."""
        self._ensure_browser()
        self._safe_nav(config.MERCEDES_CATALOG_URL)

    def auto_connect(self) -> None:
        """Open the Mercedes catalog automatically (used on app launch).

        The persistent profile keeps the session, so if the user has already
        logged in once this simply restores the authenticated page. If a login
        is required, the page will redirect to the login screen and the user
        can sign in manually.
        """
        self.open_parts_page()

    def keep_alive(self) -> None:
        """Quiet activity to stop Mercedes' idle-timeout logging you out mid-day.

        Runs on the background worker between scans. When the app is parked on
        the already-logged-in catalog it does a soft page reload so Mercedes
        sees fresh activity and keeps the SSO session alive — the practical
        enabler for "log in once per day, use the app all day".

        get_price() still re-checks the live session and surfaces a real
        LoginRequiredError every single time, so live prices and honest
        expiry handling are completely unchanged.
        """
        from urllib.parse import urlsplit

        try:
            self._ensure_browser()   # if the browser was closed, reopen it
            if not self._page:
                return
            if self._is_login_page():
                return
            url = (self._page.url or "").lower()
            host = urlsplit(config.MERCEDES_CATALOG_URL).netloc.lower()
            if host not in url:
                return
            self._page.reload(
                wait_until="domcontentloaded",
                timeout=config.MERCEDES_NAV_TIMEOUT_MS,
            )
        except Exception:
            pass

    # -- navigation / login detection ------------------------------------
    def _is_login_page(self) -> bool:
        """Best-effort check of whether the browser is on a login/auth screen."""
        try:
            url = (self._page.url or "").lower()
        except Exception:
            url = ""
        if any(k in url for k in (
                "login", "signin", "sign-in", "/auth", "sso", "ucp",
                "authorization.ping", "resumepath=")):
            return True
        try:
            text = (self._page.locator("body").inner_text(timeout=3000) or "")
            low = text.lower()
            if any(k in low for k in ("sign in", "log in", "user name",
                                      "password", "microsoft", "verify your identity")):
                return True
        except Exception:
            pass
        return False

    def _safe_nav(self, url: str, force: bool = False) -> None:
        """Navigate to *url*, turning login redirects into LoginRequiredError.

        Live Mercedes often bounces the catalog to its login/auth host when the
        session is missing or expired. Playwright reports that as "Navigation
        interrupted by another navigation to https://login.mercedes-benz.com…".
        We translate that (and any 'ended up on the login page') into a
        LoginRequiredError so the UI can prompt the user to sign in, instead of
        surfacing a confusing generic 'Mercedes unavailable'.

        If the page is *already* on the target host (and not stuck on a login
        screen), navigation is skipped — re-running goto on every barcode scan
        would otherwise re-trigger the login bounce and interrupt the user's
        session mid-flow. Pass ``force=True`` to always reload (used to reset
        the catalog to its clean landing before each scan, so the part-search
        field is selected rather than the vehicle search bar).
        """
        from urllib.parse import urlsplit

        from playwright.sync_api import Error as PlaywrightError

        target_host = urlsplit(url).netloc.lower()
        try:
            curr = (self._page.url or "").lower()
        except Exception:
            curr = ""
        already_there = (
            not force and bool(curr) and target_host in curr
            and not self._is_login_page()
        )

        if not already_there:
            try:
                self._page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=config.MERCEDES_NAV_TIMEOUT_MS,
                )
            except PlaywrightError as e:
                msg = str(e).lower()
                interrupted = "navigation interrupted" in msg and "login" in msg
                if interrupted or self._is_login_page():
                    raise LoginRequiredError(
                        "Mercedes login required (session expired). "
                        "Use the 'Open Mercedes & Login' button and sign in."
                    )
                raise PriceSourceError(f"Mercedes navigation failed: {e}")

        # A "successful" goto can still end up redirected onto the login page.
        if self._is_login_page():
            raise LoginRequiredError(
                "Mercedes login required (session expired). "
                "Use the 'Open Mercedes & Login' button and sign in."
            )

    # -- price lookup ---------------------------------------------------
    def get_price(self, part_number: str) -> PriceResult:
        """Retrieve the live price for one part from the Mercedes catalog.

        Implementation notes:
          * Uses the persistent, already-logged-in browser session.
          * Drives the real catalog page (fills the search box) and captures
            the price API response with page.expect_response(), so we don't
            need to hard-code the endpoint URL.
          * Response shape (confirmed from a live session):
                data.partList[0].price.<list|net>PricePerUnit
                    .amount / 10**fraction.digitCount  => unit price
                    .currency.unit                      => currency
        """
        from playwright.sync_api import TimeoutError as PlaywrightTimeout

        self._ensure_browser()   # auto-reopen if the user closed the browser
        # Reset to the catalog landing before every scan (unless disabled): the
        # SPA re-renders after a search and 'first input' can land on the vehicle
        # search bar, which is why the 2nd+ scan would otherwise fail.
        self._safe_nav(
            config.MERCEDES_CATALOG_URL,
            force=config.MERCEDES_RESET_CATALOG_BEFORE_SCAN,
        )

        canon = normalize_part(part_number)
        if not canon:
            raise PartNotFoundError("Empty part number.")

        search = self._locate_search()

        body = None
        site_error = ""
        for attempt in range(2):  # Search button first, Enter as fallback
            # Human-like entry on every attempt (the SPA may clear the field
            # after a failed submit).
            self._enter_part_number(search, canon)
            try:
                with self._page.expect_response(
                    self._is_price_response,
                    timeout=config.MERCEDES_RESPONSE_TIMEOUT_MS,
                ) as resp_info:
                    self._trigger_search(search, attempt=attempt)
                body = resp_info.value.json()
                if self._search_error_shown():
                    # Mercedes surfaced its generic error toast -> the submit
                    # path was wrong/transient; retry with the other trigger.
                    site_error = ("Mercedes showed 'Something went wrong. "
                                  "Please try again later.'")
                    body = None
                    continue
                break
            except PlaywrightTimeout:
                if self._is_login_page():
                    raise LoginRequiredError(
                        "Mercedes login required (session expired). "
                        "Use the 'Open Mercedes & Login' button and sign in."
                    )
                site_error = "the catalog returned no price response (timeout)"
                continue

        if body is None:
            raise PriceSourceError(
                "Could not retrieve the live Mercedes price for this part. "
                + (site_error + ". " if site_error else "")
                + "Check the part number and your session, then scan again."
            )

        # succeed / responseCode live inside partInfoResult on the real API.
        _, meta = self._partinfo(body)
        succeed = (meta or {}).get("succeed", body.get("succeed"))
        code = str((meta or {}).get("responseCode", body.get("responseCode", "")))
        if succeed is not True:
            if "AUTH" in code.upper():
                raise LoginRequiredError(
                    "Mercedes login required (session expired)."
                )
            raise PriceSourceError(f"Mercedes request failed: {code}")

        return self._extract_price(body, canon)

    # -- helpers --------------------------------------------------------
    _VEHICLE_HINTS = (
        "vin", "vehicle", "chassis", "frame", "registration", "reg-",
        "wmi", "model", "body", "ident",
    )

    def _looks_like_vehicle_input(self, loc) -> bool:
        """Best-effort: is this search input the vehicle/VIN one (not the part box)?"""
        try:
            blob = " ".join([
                loc.get_attribute("placeholder") or "",
                loc.get_attribute("aria-label") or "",
                loc.get_attribute("name") or "",
                loc.get_attribute("id") or "",
            ]).lower()
        except Exception:
            return False
        return any(h in blob for h in self._VEHICLE_HINTS)

    def _part_search_candidates(self):
        """Priority-ordered selector list that targets the *part* search input."""
        override = (config.MERCEDES_PART_SEARCH_SELECTOR or "").strip()
        if override:
            return [override]
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
        ]

    def _locate_search(self):
        # Try the part-specific candidates first: pick the first one that is
        # visible AND not the vehicle/VIN search field.
        for sel in self._part_search_candidates():
            loc_all = self._page.locator(sel)
            count = loc_all.count()
            if count == 0:
                continue
            for idx in range(count):
                one = loc_all.nth(idx)
                if self._looks_like_vehicle_input(one):
                    continue
                try:
                    if one.is_visible():
                        return one
                except Exception:
                    continue

        # Fall back to the configured generic selector (still skipping vehicle).
        try:
            loc_all = self._page.locator(config.MERCEDES_SEARCH_SELECTOR)
            count = loc_all.count()
            for idx in range(count):
                one = loc_all.nth(idx)
                if self._looks_like_vehicle_input(one):
                    continue
                try:
                    if one.is_visible():
                        return one
                except Exception:
                    continue
        except Exception:
            pass

        raise PriceSourceError(
            "Could not find the Mercedes part-search field. Tune "
            "MERCEDES_PART_SEARCH_SELECTOR / MERCEDES_SEARCH_SELECTOR "
            "(see config.py) after logging in."
        )

    def _trigger_search(self, search, attempt=0):
        """Submit the part search.

        The catalog's own **Search button** is the reliable path: pressing
        Enter submits an alternate/invalid flow (e.g. empty VIN combined) and
        surfaces Mercedes' generic 'Something went wrong' error, which is
        exactly what a manual button click does not do. So the button is tried
        first and Enter is only the fallback.

        The button is looked up *inside the same form/container as the part
        field*, so a header/global search button can never be clicked by
        mistake.
        """
        btn = self._scoped_search_button(search)
        if btn is not None:
            btn.click()
            return
        if attempt == 0:
            # No scoped button found -> try a page-level Search button once.
            try:
                page_btn = self._page.get_by_role(
                    "button", name=re.compile(r"^search$", re.I)
                )
                if page_btn.count():
                    page_btn.first.click()
                    return
            except Exception:
                pass
        search.press("Enter")

    def _scoped_search_button(self, search):
        """Find the Search button belonging to the part field's own form.

        Returns a locator or None. Scoping to the field's container prevents
        clicking a header/global search button instead of the part-search one.
        """
        scopes = []
        try:
            form = search.locator("xpath=ancestor::form[1]")
            if form.count():
                scopes.append(form)
        except Exception:
            pass
        try:
            # SPAs often don't use <form>; take the nearest ancestor that owns
            # a button as the container fallback.
            wrap = search.locator("xpath=ancestor::div[.//button][1]")
            if wrap.count():
                scopes.append(wrap)
        except Exception:
            pass

        for scope in scopes:
            try:
                btn = scope.get_by_role("button", name=re.compile(r"search", re.I))
                if btn.count():
                    return btn.first
                alt = scope.locator(
                    "button[type=submit], input[type=submit], "
                    "button:has-text('Search')"
                )
                if alt.count():
                    return alt.first
            except Exception:
                continue
        return None

    def _enter_part_number(self, search, canon: str) -> None:
        """Type the part number like a human and verify the field holds it.

        Real key events (rather than ``fill()``) let Mercedes' own React
        handlers and formatters run exactly as if typed by hand — ``fill()``
        can leave their internal state out of sync so the search silently
        fails. Reading the value back afterwards removes any race where the
        search is submitted before the SPA has accepted the text.
        """
        try:
            search.click()
        except Exception:
            pass
        try:
            search.fill("")  # clear any previous value
        except Exception:
            pass

        typed = False
        try:
            search.press_sequentially(canon, delay=config.MERCEDES_TYPE_DELAY_MS)
            typed = True
        except Exception:
            pass
        if not typed:
            try:
                search.type(canon, delay=config.MERCEDES_TYPE_DELAY_MS)
                typed = True
            except Exception:
                pass
        if not typed:
            search.fill(canon)  # last resort

        # Verify the field really holds the number (any site formatting OK).
        try:
            value = re.sub(r"\s+", "", (search.input_value() or "")).upper()
            if value != canon:
                search.fill(canon)
        except Exception:
            pass

    def _search_error_shown(self) -> bool:
        """True if Mercedes displayed its generic 'Something went wrong' toast."""
        try:
            page = self._page
            if page is None:
                return False
            loc = page.get_by_text(re.compile(r"something went wrong", re.I))
            return bool(loc.count()) and loc.first.is_visible()
        except Exception:
            return False


    def _is_price_response(self, response) -> bool:
        """Match any API response carrying a price part-list, regardless of URL."""
        try:
            body = response.json()
        except Exception:
            return False
        if not isinstance(body, dict):
            return False
        # The real Mercedes API returns the part list under
        # partInfoResult.data.partList (a legacy shape used body.data.partList).
        for candidate in (body.get("data"), (body.get("partInfoResult") or {}).get("data")):
            if isinstance(candidate, dict) and isinstance(candidate.get("partList"), list):
                return True
        return False

    @staticmethod
    def _partinfo(body: dict):
        """Locate the part-list container and its metadata in the response.

        Handles both the real shape (partInfoResult.data.partList) and the older
        flat shape (body.data.partList). Returns (data_dict|None, meta_dict|None).
        """
        pinfo = body.get("partInfoResult")
        if isinstance(pinfo, dict):
            data = pinfo.get("data")
            if isinstance(data, dict) and isinstance(data.get("partList"), list):
                return data, pinfo
        data = body.get("data")
        if isinstance(data, dict) and isinstance(data.get("partList"), list):
            return data, body
        return None, None

    def _extract_price(self, body: dict, canon: str) -> PriceResult:
        data, meta = self._partinfo(body)
        if data is None:
            raise PartNotFoundError(
                f"Mercedes returned no price for part '{canon}'."
            )
        parts = data.get("partList") or []
        if not parts:
            raise PartNotFoundError(
                f"Mercedes returned no price for part '{canon}'."
            )
        part = parts[0]
        if part.get("isUnknownPart") or part.get("isInvalidPart"):
            raise PartNotFoundError(
                f"Mercedes returned no price for part '{canon}'."
            )

        field = f"{config.PRICE_FIELD}PricePerUnit"
        price_obj = (part.get("price") or {}).get(field)
        if not price_obj:
            raise PriceSourceError(
                f"Mercedes response has no '{field}' for part '{canon}'."
            )

        amount = int(price_obj.get("amount", 0))
        digit = int((price_obj.get("fraction") or {}).get("digitCount", 0))
        price = round(amount / (10 ** max(digit, 0)), 2)
        currency = ((price_obj.get("currency") or {}).get("unit")) or "GBP"
        designation = part.get("designation") or ""

        return PriceResult(
            part_number=canon,
            price=price,
            currency=currency,
            retrieved_at=now_iso(),
            designation=designation,
        )

    @property
    def status(self) -> str:
        if self._browser_dead():
            return "not connected (reopens automatically on next scan)"
        try:
            if not self._page or not self._page.url:
                return "not connected"
        except Exception:
            return "not connected (reopens automatically on next scan)"
        return "Mercedes (browser session active)"

    def close(self) -> None:
        try:
            if self._context is not None:
                self._context.close()
        except Exception:
            pass
        try:
            if self._pw is not None:
                self._pw.stop()
        except Exception:
            pass
        self._pw = self._context = self._page = None
