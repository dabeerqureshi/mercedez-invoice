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
        """Open the persistent Chromium profile (headless=False)."""
        from playwright.sync_api import sync_playwright  # lazy import
        os.makedirs(config.PROFILE_DIR, exist_ok=True)
        self._pw = sync_playwright().start()
        self._context = self._pw.chromium.launch_persistent_context(
            user_data_dir=config.PROFILE_DIR,
            headless=False,
        )
        self._page = (
            self._context.pages[0]
            if self._context.pages
            else self._context.new_page()
        )
        # Start capturing network traffic for the discovery step.
        self._context.on("request", self._on_request)
        self._context.on("response", self._on_response)

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
        if not self._page:
            self.launch()
        self._page.goto(config.MERCEDES_B2B_URL, wait_until="domcontentloaded")

    def open_parts_page(self) -> None:
        """Open the parts/B2B catalog page after manual login."""
        if not self._page:
            self.launch()
        self._page.goto(config.MERCEDES_CATALOG_URL, wait_until="domcontentloaded")

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

        if not self._page:
            self.launch()
        self._page.goto(config.MERCEDES_CATALOG_URL, wait_until="domcontentloaded")

        canon = normalize_part(part_number)
        if not canon:
            raise PartNotFoundError("Empty part number.")

        search = self._locate_search()
        search.fill(canon)

        body = None
        for attempt in range(2):  # retry once with a different trigger
            try:
                with self._page.expect_response(
                    self._is_price_response, timeout=30000
                ) as resp_info:
                    self._trigger_search(search, attempt=attempt)
                body = resp_info.value.json()
                break
            except PlaywrightTimeout:
                if "login" in self._page.url.lower():
                    raise LoginRequiredError(
                        "Mercedes login required (session expired). "
                        "Use the 'Open Mercedes & Login' button and sign in."
                    )
                continue

        if body is None:
            raise PriceSourceError(
                "Could not capture the Mercedes price response (timeout). "
                "Check your session and the part search on the catalog page."
            )

        if body.get("succeed") is not True:
            code = str(body.get("responseCode", ""))
            if "AUTH" in code.upper():
                raise LoginRequiredError(
                    "Mercedes login required (session expired)."
                )
            raise PriceSourceError(f"Mercedes request failed: {code}")

        return self._extract_price(body, canon)

    # -- helpers --------------------------------------------------------
    def _locate_search(self):
        from playwright.sync_api import TimeoutError as PlaywrightTimeout

        search = self._page.locator(config.MERCEDES_SEARCH_SELECTOR).first
        try:
            search.wait_for(state="visible", timeout=8000)
        except PlaywrightTimeout:
            raise PriceSourceError(
                "Could not find the Mercedes part-search field. Tune "
                "MERCEDES_SEARCH_SELECTOR (see config.py) after logging in."
            )
        return search

    def _trigger_search(self, search, attempt=0):
        if attempt > 0:
            btn = self._page.locator(
                "button[type=submit], input[type=submit], "
                "button:has-text('Search')"
            ).first
            if btn.count():
                btn.click()
                return
        search.press("Enter")

    def _is_price_response(self, response) -> bool:
        """Match any API response carrying a price part-list, regardless of URL."""
        try:
            body = response.json()
        except Exception:
            return False
        if not isinstance(body, dict):
            return False
        data = body.get("data")
        return isinstance(data, dict) and isinstance(
            data.get("partList"), list
        )

    def _extract_price(self, body: dict, canon: str) -> PriceResult:
        data = body.get("data") or {}
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
        if not self._page:
            return "not connected"
        return "Mercedes (manual login / session active)"

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
