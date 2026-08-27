"""Application-wide configuration — HARDCODED for the IQ Motors release.

Everything is baked in so the packaged exe behaves identically on any client
machine: no environment variables, no config files, nothing to set up.
"""
import os

# --- Identity / branding -------------------------------------------------
APP_NAME = "IQ Motors - Parts & Service Invoicing"
COMPANY_NAME = "IQ MOTORS"
COMPANY_TAGLINE = "REPAIRS AND PARTS - SPECIALIST IN MERCEDES BENZ"
COMPANY_ADDRESS = "28 Northfield Avenue, West Ealing, London W13 9RL"
COMPANY_EMAIL = ""
COMPANY_PHONE = "020 8579 9955"
COMPANY_MOBILE = "07771 542 186"
COMPANY_VAT_REG_NO = "228706791"
SERVICE_BOOK_NOTE = (
    "We can update your DIGITAL SERVICE BOOK on Mercedes Benz System "
    "(for Service History)"
)

# Optional logo / footer images drawn on every invoice. If a file is missing,
# clean text fallbacks are drawn instead.
_ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
LOGO_PATH = os.path.join(_ASSETS_DIR, "logo.png")
FOOTER_PATH = os.path.join(_ASSETS_DIR, "footer.png")

# Default vehicle make (editable per invoice in the checkout dialog).
DEFAULT_VEHICLE_MAKE = "MERCEDES BENZ"

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
# Live Mercedes B2B Connect prices on every scan.
PRICE_SOURCE = "mercedes"

# Which Mercedes price field to use as the invoice/cart unit price.
# "list" -> listPricePerUnit, "net" -> netPricePerUnit.
PRICE_FIELD = "list"

# Mercedes B2B site (real host discovered during live session).
MERCEDES_B2B_URL = "https://b2bconnect.mercedes-benz.com"
MERCEDES_CATALOG_URL = MERCEDES_B2B_URL + "/gb/catalog"

MERCEDES_SEARCH_SELECTOR = "input[type=search], input[type=text]"
MERCEDES_PART_SEARCH_SELECTOR = ""
MERCEDES_RESET_CATALOG_BEFORE_SCAN = True
MERCEDES_TYPE_DELAY_MS = 30

# Timeouts (ms). Generous because page loads and the price API can be slow;
# all browser work runs on a background thread so the UI never freezes.
MERCEDES_NAV_TIMEOUT_MS = 120000
MERCEDES_RESPONSE_TIMEOUT_MS = 60000

# --- Session keep-alive ---------------------------------------------------
MERCEDES_KEEP_ALIVE_S = 240      # quiet catalog refresh; 0 disables
MERCEDES_REMEMBER_ME = True      # tick the site's own keep-me-signed-in

# --- Browser resolution (zero-dependency client machines) -----------------
# Order tried by the connector:
#   1. a Chromium bundled inside the release ("browser" folder next to the exe)
#   2. Microsoft Edge   (preinstalled on Windows 10/11 - no download needed)
#   3. Google Chrome    (if installed)
#   4. Playwright's own Chromium (only present if someone ran its installer)
import sys

if getattr(sys, "frozen", False):
    # exe sits at <install>\MercedesInvoice.exe; bundle browsers at <install>\browser
    _APP_DIR = os.path.dirname(sys.executable)
else:
    _APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLED_BROWSER_DIR = os.path.join(_APP_DIR, "browser")

# --- SMTP (email) --------------------------------------------------------
# Hardcoded for the IQ Motors release (invoice emails go from this account).
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "qureshidabeer92@gmail.com"
SMTP_PASSWORD = "vzmnuwdeducnojpr"
SMTP_FROM = "qureshidabeer92@gmail.com"
SMTP_USE_TLS = True


def money(amount):
    """Format a number as currency, e.g. 290.0 -> '£290.00'."""
    return f"{CURRENCY}{amount:,.2f}"
