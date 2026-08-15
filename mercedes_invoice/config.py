"""Application-wide configuration.

Most of these can be overridden with environment variables so that no
secrets are committed to the code. Edit the fallback values or set env vars.
"""
import os

# --- Identity / branding -------------------------------------------------
APP_NAME = "Mercedes Parts Invoice"
COMPANY_NAME = os.environ.get("MERCEDES_COMPANY", "YOUR COMPANY")
COMPANY_ADDRESS = os.environ.get("MERCEDES_ADDRESS", "123 Example Street, City, UK")
COMPANY_EMAIL = os.environ.get("MERCEDES_COMPANY_EMAIL", "sales@example.com")
COMPANY_PHONE = os.environ.get("MERCEDES_COMPANY_PHONE", "+44XXXXXXXXXX")

# --- Money ---------------------------------------------------------------
CURRENCY = "£"
CURRENCY_CODE = "GBP"
VAT_RATE = 0.20            # 20%
DEFAULT_DISCOUNT = 0.0     # fixed-amount discount applied to the subtotal (GBP)

# --- Paths ---------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "mercedes_invoice.db")
PROFILE_DIR = os.path.join(BASE_DIR, "mercedes_browser")
NETWORK_LOG = os.path.join(BASE_DIR, "network_log.jsonl")
INVOICES_DIR = os.path.join(BASE_DIR, "Invoices")

# --- Price source --------------------------------------------------------
# "mock"      -> offline deterministic prices (use this for development/testing)
# "mercedes"  -> real Playwright connector (requires your logged-in session)
PRICE_SOURCE = os.environ.get("MERCEDES_PRICE_SOURCE", "mock")

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

# --- SMTP (email) --------------------------------------------------------
# Set via env vars, e.g. in a shell/profile, or export before launching:
#   export MERCEDES_SMTP_HOST="smtp.example.com"
#   export MERCEDES_SMTP_USER="you@example.com"
#   export MERCEDES_SMTP_PASSWORD="..."
SMTP_HOST = os.environ.get("MERCEDES_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("MERCEDES_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("MERCEDES_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("MERCEDES_SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("MERCEDES_SMTP_FROM", COMPANY_EMAIL)
SMTP_USE_TLS = os.environ.get("MERCEDES_SMTP_TLS", "1") == "1"


def money(amount):
    """Format a number as currency, e.g. 290.0 -> '£290.00'."""
    return f"{CURRENCY}{amount:,.2f}"
