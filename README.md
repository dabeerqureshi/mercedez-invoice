# Mercedes Parts Invoice (1-day MVP)

Desktop POS app: **USB barcode scan → live Mercedes price → invoice PDF → email**.
Built with Python + PySide6 + Playwright + SQLite + ReportLab + SMTP.

> ⚠️ **Legal / account boundary**: use only your own authorized Mercedes B2B
> Connect account and normal login/MFA. No password is ever stored in this
> code; credentials bypass, CAPTCHA bypass, and access-control evasion are out
> of scope. Contact your Mercedes partner for account/support issues.

---

## Quick start (dev)

### Easiest: use the setup script
```bash
bash setup.sh        # macOS / Linux
# or double-click / run  setup.bat   (Windows)
```
This creates a venv, installs everything from `requirements.txt` (avoids shell
quoting issues with `>=`), and prints the launch command.

### Or do it manually
```bash
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt      # quote versions if installing directly:
                                     # pip install 'PySide6-Essentials>=6.5'
playwright install chromium          # only needed for the Mercedes source
python -m mercedes_invoice.main
```

> **Note:** PySide6 (Qt) is a large download (~106 MB). If it fails with a
> dropped connection, retry on a stable/faster network (e.g. a phone hotspot).

> **macOS 26 dev-machine note:** the Qt *GUI window* is currently blocked on
> this Mac by a Qt/macOS-26 compatibility issue (Qt's platform-plugin loader
> silently rejects every `*.dylib` plugin — "Could not find the Qt platform
> plugin \"cocoa\"" — even though the plugin file is valid). This affects both
> the Apple system Python 3.9 and a Homebrew Python 3.12 venv. Everything
> **except the live window** is fully verified here via:
> - `python selftest.py` (full scan→cart→invoice→PDF→CSV→email pipeline),
> - `python -m mercedes_invoice.main --selftest-gui` (GUI smoke test),
> - the `/tmp/*_test.py` regression checks.
>
> The actual product is the **Windows `.exe`**, where PySide6 + PyInstaller
> work normally — build it with the packaging command below and verify the
> window on Windows.

The app launches with the **mock** price source by default, so you can test the
whole scan → cart → VAT/discount → PDF → email pipeline with offline,
deterministic prices.

### Using offline test prices (no Mercedes login)
```
export MERCEDES_PRICE_SOURCE=mock
python -m mercedes_invoice.main
```

### Configuring email (SMTP)
Set these (e.g. export, or in your shell profile). Never commit a password.
```
export MERCEDES_SMTP_HOST=smtp.example.com
export MERCEDES_SMTP_PORT=587
export MERCEDES_SMTP_USER=you@example.com
export MERCEDES_SMTP_PASSWORD=secret
export MERCEDES_SMTP_FROM=you@example.com
```
If SMTP is not configured, the invoice is **still saved and PDF generated**; the
UI reports the email failure and offers **Retry Email**. Invoices are never
lost because email failed.

### Configuring the real Mercedes source
```
export MERCEDES_PRICE_SOURCE=mercedes
python -m mercedes_invoice.main
```
A persistent Chromium profile is kept in `mercedes_browser/`. Log in + MFA
manually **once**; the session persists for later launches. Use the
**Open Mercedes & Login** toolbar button.

The connector opens `https://b2bconnect.mercedes-benz.com/gb/catalog`, fills the
part-search box, and captures the price API response with
`page.expect_response()`. If the live catalog's search input selector differs,
set it with:
```
export MERCEDES_SEARCH_SELECTOR='input[placeholder="..."], #partSearch'
```

#### Prices used
The response contains both a list price and a net price
(`data.partList[0].price.listPricePerUnit` / `netPricePerUnit`, where
`amount / 10**fraction.digitCount` = unit price). By default the **list price**
is invoiced. To use the net price instead:
```
export MERCEDES_PRICE_FIELD=net
```
Part numbers are normalised automatically (spaces stripped), e.g.
`A   000 828 03 88` ↔ `A0008280388`, so barcode scans work directly.

Error states are surfaced clearly: **login required** (session expired →
prompted to log in), **part not found**, and **Mercedes unavailable**.
Network traffic is captured to `network_log.jsonl` for diagnostics.

---

## Where things are stored
| What      | Where |
|-----------|-------|
| Database  | `mercedes_invoice/mercedes_invoice.db` |
| PDF + CSV | `Invoices/<year>/INV-000001.pdf` and `INV-000001.csv` |
| Browser session | `mercedes_browser/` (gitignored) |
| Network capture | `network_log.jsonl` (gitignored) |

Each invoice saves a **PDF** (for the customer) and a **CSV** record (for you),
side by side in the same year folder. Invoice line items freeze the
**price-retrieved-at-checkout** (plus the product name), so historical invoices
keep their old prices even when Mercedes prices change later.

## Daily use
1. Double-click the exe (first time only: click **Open Mercedes & Login** and
   sign in once; the session persists).
2. Scan parts with the barcode gun — on a duplicate scan the **quantity
   increments** automatically. Product name + latest price are fetched live
   each scan. (No scanner handy? Just **type** the part number and press
   **Enter** — it's treated exactly like a scan.)
3. Click **VIEW CART / CHECKOUT**, enter the customer's **name / phone /
   email** and click **Save & Email**.
4. The invoice is saved to SQLite + PDF + CSV and emailed to the customer.
   If the email fails the invoice is still saved, and you can **Retry Email**.

## Quick self-test (no GUI, no scanner, no Mercedes login)
Simulates the full pipeline with an offline price source:
```bash
source .venv/bin/activate
python selftest.py
```
It scans two parts (one twice → quantity increments), checks out a customer,
saves a real **SQLite** invoice + **PDF** + **CSV**, and attempts the email —
printing the invoice number and the PDF/CSV paths so you can open and verify
them. Use `MERCEDES_PRICE_SOURCE=mercedes` to attempt a live lookup instead
(requires your logged-in session).

## Packaging (PyInstaller)
```bash
pip install pyinstaller
pyinstaller --noconfirm --onefile --windowed \
  --name MercedesInvoice \
  --add-data "mercedes_invoice:mercedes_invoice" \
  mercedes_invoice/main.py
```
Then double-click `MercedesInvoice(.exe)`. (The Mercedes connector also needs
the Playwright browser available on the target machine — see Playwright docs.
Note: build the `.exe` on a **Windows** machine.)

## Layout
```
mercedes_invoice/
  config.py           VAT, currency, paths, SMTP
  db.py               SQLite: customers, invoices, invoice_items
  pdf.py              ReportLab invoice -> Invoices/<year>/INV-<n>.pdf
  csv_export.py       CSV record -> Invoices/<year>/INV-<n>.csv
  emailer.py          SMTP with attachment + retry semantics
  connectors/
    base.py           PriceSource interface
    mock.py           offline deterministic prices (test)
    mercedes.py       Playwright persistent-profile connector (login/session)
  ui/main_window.py   PySide6 POS scan screen
  ui/checkout_dialog.py  cart + customer details + Save & Email
  main.py             entry point
```
