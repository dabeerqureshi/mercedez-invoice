"""Application-wide configuration.

Most of these can be overridden with environment variables so that no
secrets are committed to the code. Edit the fallback values or set env vars.
"""
import os

# --- Identity / branding -------------------------------------------------
APP_NAME = "IQ Motors - Parts & Service Invoicing"
COMPANY_NAME = os.environ.get("MERCEDES_COMPANY", "IQ MOTORS")
COMPANY_TAGLINE = os.environ.get(
    "MERCEDES_TAGLINE", "REPAIRS AND PARTS - SPECIALIST IN MERCEDES BENZ"
)
COMPANY_ADDRESS = os.environ.get(
    "MERCEDES_ADDRESS", "28 Northfield Avenue, West Ealing, London W13 9RL"
)
COMPANY_EMAIL = os.environ.get("MERCEDES_COMPANY_EMAIL", "")
COMPANY_PHONE = os.environ.get("MERCEDES_COMPANY_PHONE", "020 8579 9955")
COMPANY_MOBILE = os.environ.get("MERCEDES_COMPANY_MOBILE", "07771 542 186")
COMPANY_VAT_REG_NO = os.environ.get("MERCEDES_VAT_REG_NO", "228706791")
SERVICE_BOOK_NOTE = os.environ.get(
    "MERCEDES_SERVICE_BOOK_NOTE",
    "We can update your DIGITAL SERVICE BOOK on Mercedes Benz System "
    "(for Service History)",
)

# Optional logo drawn at the top-left of every invoice. If the file is
# missing, a clean text-based brand header is drawn instead.
_ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
LOGO_PATH = os.environ.get("MERCEDES_LOGO_PATH",
                           os.path.join(_ASSETS_DIR, "logo.png"))
# Full invoice footer strip (brand logos + address + VAT reg no + service
# book note). If missing, a text footer is drawn instead.
FOOTER_PATH = os.environ.get("MERCEDES_FOOTER_PATH",
                             os.path.join(_ASSETS_DIR, "footer.png"))

# Default vehicle make (editable per invoice in the checkout dialog).
DEFAULT_VEHICLE_MAKE = os.environ.get("MERCEDES_DEFAULT_MAKE", "MERCEDES BENZ")

# --- Money ---------------------------------------------------------------
CURRENCY = "£"
CURRENCY_CODE = "GBP"
VAT_RATE = 0.20            # 20%
DEFAULT_DISCOUNT = 0.0     # fixed-amount discount applied to the subtotal (GBP)

# --- Paths ---------------------------------------------------------------
#
# IMPORTANT (single sign-on persistence): when the app is packaged with
# PyInstaller --onefile, the code is extracted to a *temporary* folder that is
# rebuilt from scratch on every launch. If we based our paths on __file__ there,
# the Mercedes browser profile (your login session), the database and the saved
# invoices would live in that throwaway temp dir and be wiped each run — forcing
# a fresh Mercedes login every time. So:
#   * development / running from source  -> data stays in the project folder
#   * frozen (.exe)                      -> data lives in a stable user dir
import sys

_FROZEN = bool(getattr(sys, "frozen", False))


def _data_dir() -> str:
    """Return a stable, user-writable base folder for app data."""
    if _FROZEN:
        # %APPDATA%\MercedesInvoice (Windows) — persists across launches.
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        d = os.path.join(base, "MercedesInvoice")
    else:
        d = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(d, exist_ok=True)
    return d


DATA_DIR = _data_dir()
DB_PATH = os.path.join(DATA_DIR, "mercedes_invoice.db")
PROFILE_DIR = os.path.join(DATA_DIR, "mercedes_browser")
NETWORK_LOG = os.path.join(DATA_DIR, "network_log.jsonl")
INVOICES_DIR = os.path.join(DATA_DIR, "Invoices")

# --- Price source --------------------------------------------------------
# "mercedes"  -> REAL Mercedes B2B Connect via Playwright (default; live prices)
# "mock"      -> offline deterministic prices (use this for development/testing
#                when you don't want to / can't hit the live site)
PRICE_SOURCE = os.environ.get("MERCEDES_PRICE_SOURCE", "mercedes")

# Which Mercedes price field to use as the invoice/cart unit price.
# "list" -> listPricePerUnit, "net" -> netPricePerUnit.
PRICE_FIELD = os.environ.get("MERCEDES_PRICE_FIELD", "list").lower()

# Mercedes B2B site (real host discovered during live session).
MERCEDES_B2B_URL = os.environ.get(
    "MERCEDES_B2B_URL", "https://b2bconnect.mercedes-benz.com"
)
MERCEDES_CATALOG_URL = os.environ.get(
    "MERCEDES_CATALOG_URL",
    MERCEDES_B2B_URL + "/gb/catalog",
)
# Selector for the part-search input on the catalog page. Tune after logging
# into the live site if the default doesn't match.
MERCEDES_SEARCH_SELECTOR = os.environ.get(
    "MERCEDES_SEARCH_SELECTOR", "input[type=search], input[type=text]"
)

# Optional, more-specific selector that targets the *part* search input so we
# never accidentally type into the vehicle / VIN search bar. If set, the app
# uses ONLY this selector (no heuristic guessing).
MERCEDES_PART_SEARCH_SELECTOR = os.environ.get("MERCEDES_PART_SEARCH_SELECTOR", "")

# The Mercedes catalog is a single-page app: after a successful search it
# re-renders and the generic "first input" can point at the vehicle search bar
# instead of the part box (this is exactly why the 2nd scan fails). Reloading
# the catalog to its fresh landing before each scan reproduces the known-good
# state where the very first scan works. Set 0 to disable (tune the part
# selector instead).
MERCEDES_RESET_CATALOG_BEFORE_SCAN = os.environ.get(
    "MERCEDES_RESET_CATALOG_BEFORE_SCAN", "1"
) == "1"

# Human-like keystroke delay (ms) when entering the part number. Real key
# events make Mercedes' own React handlers/formatters run exactly as if typed
# by hand — `fill()` can leave their internal state out of sync and the search
# then silently fails ("Something went wrong"). 0 = as fast as possible.
MERCEDES_TYPE_DELAY_MS = int(os.environ.get("MERCEDES_TYPE_DELAY_MS", "30"))


# Timeouts (ms). These are generous by default because page loads and the
# price API can be slow, and all browser work runs on a background thread so
# the UI never freezes while waiting.
MERCEDES_NAV_TIMEOUT_MS = int(os.environ.get("MERCEDES_NAV_TIMEOUT_MS", "120000"))
MERCEDES_RESPONSE_TIMEOUT_MS = int(
    os.environ.get("MERCEDES_RESPONSE_TIMEOUT_MS", "60000")
)

# --- Session keep-alive ---------------------------------------------------
# While the app is open, quietly refresh the parked Mercedes catalog every N
# seconds so the site's idle-timeout doesn't log you out mid-day. This is what
# makes "log in once per day, use the app all day" actually hold. Set 0 to
# disable the auto keep-alive.
MERCEDES_KEEP_ALIVE_S = int(os.environ.get("MERCEDES_KEEP_ALIVE_S", "240"))

# Best-effort: when the app opens a Mercedes login page it tries to tick the
# site's own "Keep me signed in / Remember me" switch so the SSO session lasts
# as long as Mercedes allows (login once per day).
MERCEDES_REMEMBER_ME = os.environ.get("MERCEDES_REMEMBER_ME", "1") == "1"

# --- SMTP (email) --------------------------------------------------------
# Set via env vars, e.g. in a shell/profile, or export before launching:
#   export MERCEDES_SMTP_HOST="smtp.example.com"
#   export MERCEDES_SMTP_USER="you@example.com"
#   export MERCEDES_SMTP_PASSWORD="..."
SMTP_HOST = os.environ.get("MERCEDES_SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("MERCEDES_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("MERCEDES_SMTP_USER", "qureshidabeer92@gmail.com")
SMTP_PASSWORD = os.environ.get("MERCEDES_SMTP_PASSWORD", "vzmnuwdeducnojpr")
SMTP_FROM = os.environ.get("MERCEDES_SMTP_FROM", "qureshidabeer92@gmail.com")
SMTP_USE_TLS = os.environ.get("MERCEDES_SMTP_TLS", "1") == "1"


def money(amount):
    """Format a number as currency, e.g. 290.0 -> '£290.00'."""
    return f"{CURRENCY}{amount:,.2f}"
