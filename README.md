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
> - `python build.py --test-only` (import smoke test + mock price-lookup pipeline),
> - `python -m mercedes_invoice.main --selftest-gui` (GUI smoke test).
>
> The actual product is the **Windows `.exe`**, where PySide6 + PyInstaller
> work normally — build it with `build.bat` (or `python build.py`) and verify
> the window on Windows.

The app now uses the **real Mercedes price source by default** — scanning a part
invoices the **live, current price from the Mercedes website** (list price by
default; switch to net with `MERCEDES_PRICE_FIELD=net`).

> The older **`mock`** source (offline, deterministic test prices) still exists
> if you ever want to try the pipeline with no Mercedes login:
> ```
> export MERCEDES_PRICE_SOURCE=mock
> python -m mercedes_invoice.main
> ```

### Setup note (Playwright browser)
The first time after installing/updating Playwright, download the matching
Chromium — required for the live Mercedes source:
```
.\.venv\Scripts\python -m playwright install chromium
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
A persistent Chromium profile is kept in `mercedes_browser/`. On launch the app
**auto-connects**: it opens the Mercedes catalog automatically (no manual step).
Log in + MFA manually **once** if prompted; the session persists for later
launches (see *Single sign-on / session persistence* below). You can also connect
again anytime with the **Open Mercedes & Login** toolbar button. The status bar
changes from *"not connected"* to *"Mercedes (browser session active)"* once the
browser is open.

### Single sign-on / session persistence
You only have to log in **once**. Your Mercedes session (cookies + local storage)
is stored in the Playwright persistent profile and reused on every later launch:

| Where the app runs | Session / data location |
|--------------------|------------------------|
| From source (dev)  | `mercedes_invoice/mercedes_browser/` |
| Packaged `.exe`    | `%APPDATA%\MercedesInvoice\mercedes_browser\` |

The packaged `.exe` deliberately does **not** store data inside its own folder —
PyInstaller `--onefile` extracts to a temporary folder that is wiped on each run,
so storing the profile there would force a fresh login every time. Keeping data in
`%APPDATA%\MercedesInvoice` (database, browser profile, `Invoices/`) means your
login and your saved invoices survive across launches and app updates. Make sure
you close the app window normally (not *kill/force-close*) so the profile is
flushed to disk cleanly.

### Log in once per day, use the app all day
The app is designed so you log in **once per day** and keep working without
re-logging in all day, even while the browser stays open in the background and
even after you close the program window:

- **Persistent session** (above): your login survives app close and relaunch.
- **"Keep me signed in / Remember me"**: when the app shows the Mercedes login
  screen it best-effort ticks the site's own *Remember / keep me signed in*
  switch, which extends your SSO session to the maximum Mercedes allows
  (`MERCEDES_REMEMBER_ME=0` disables this).
- **Session keep-alive**: while the app is open, it quietly refreshes the parked
  catalog every few minutes so Mercedes' idle-timeout doesn't log you out
  mid-day. `MERCEDES_KEEP_ALIVE_S=240` controls the interval in seconds (set `0`
  to disable). A recent scan already counts as activity, so the keep-alive only
  touches the page when the app has genuinely been idle.
- **Live prices every time**: every part lookup still goes straight to the live
  Mercedes catalog — nothing is ever estimated or cached. The keep-alive simply
  makes sure the live session is still there when you scan.

Every scanned part is looked up **live** on every scan (prices change on the
website), and each invoice is saved with the **customer's name/email/phone** and
prints the customer name on the PDF.

### Reliable part-search field selection (2nd-scan fix)
The Mercedes catalog is a single-page app. After a successful search it
re-renders, and a naive "first input" lookup can land on the **vehicle / VIN
search bar** instead of the part box — which is why a second scan could type
into the wrong field. Two layers fix this:

- **Reset before every scan** (`MERCEDES_RESET_CATALOG_BEFORE_SCAN=1`, default
  on): the catalog is reloaded to its clean landing before each scan,
  reproducing the known-good state of the very first scan. Set `0` if you prefer
  no reload and rely on the selector below.
- **Part-specific selector** (`MERCEDES_PART_SEARCH_SELECTOR`): the app prefers
  inputs whose placeholder/name/id/aria-label references a *part* (e.g. "Enter
  part number") and **skips** inputs that look like vehicle/VIN/chassis search
  fields. If your site uses a specific id you can pin it, e.g.:
  ```
  export MERCEDES_PART_SEARCH_SELECTOR='#partNumberInput'
  ```

### Adding multiple parts at once
The scan field now accepts **several part numbers at once**, separated by a comma,
semicolon, or newline — e.g.
```
A0008280388, A0008300286, A0012300917
```
Each part is looked up live and added to the cart in one go (entering the same
part twice still increments its quantity). A space is **not** used as a separator,
because Mercedes part numbers like `A 000 828 03 88` legitimately contain spaces —
so barcode scans and normally-typed single parts keep working exactly as before.


The connector opens `https://b2bconnect.mercedes-benz.com/gb/catalog`, fills the
part-search box, and captures the price API response with
`page.expect_response()`. If the live catalog's search input selector differs,
set it with:
```
export MERCEDES_SEARCH_SELECTOR='input[placeholder="..."], #partSearch'
```

> All Mercedes browser work runs on a **background thread**, so a slow page load
> or price lookup never freezes the app window. Timeouts are generous by default
> but configurable:
> ```
> export MERCEDES_NAV_TIMEOUT_MS=120000      # page loads / navigation
> export MERCEDES_RESPONSE_TIMEOUT_MS=60000   # price API response
> ```

#### Prices used
The part search returns a `partInfoResult.data.partList` entry for each part,
containing both a list price and a net price
(`part.price.listPricePerUnit` / `netPricePerUnit`, where
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
Paths below are for running **from source**; the packaged `.exe` uses the same
layout under `%APPDATA%\MercedesInvoice\` instead (see *Single sign-on* above).

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
3. Click any cart row and press **REMOVE SELECTED** (or the **Delete** key)
   to remove a part from the cart before checkout.
4. Click **VIEW CART / CHECKOUT**. Optionally type a **work / labour
   description** and set the **service cost** (labour) — this is added to the
   total and printed on the invoice. Enter the customer's **name / phone /
   email** and click **Save & Email**.
5. The invoice is saved to SQLite + PDF + CSV and emailed to the customer.
   If the email fails the invoice is still saved, and you can **Retry Email**.

## Build verification (no GUI, no scanner, no Mercedes login)
Verifies that all modules import correctly and the offline mock price-lookup
pipeline works (no Mercedes login required):
```bash
source .venv/bin/activate        # Windows: .venv\Scripts\activate
python build.py --test-only
```
The test imports every package module and runs a mock price lookup, printing
`All imports OK` and `Mock price lookup OK` on success.

## Packaging (PyInstaller)

**Windows (recommended):** just run `build.bat` from the project root — it runs
the unified `build.py` script which:
1. **Tests** — import smoke test + mock price-lookup pipeline
2. **Builds** — PyInstaller with `mercedes_invoice.spec` (bundles ReportLab
   fonts, Playwright driver, and excludes unused heavy Qt modules)
3. **Packages** — compresses `dist/MercedesInvoice/` into
   `IQMotorsInvoice-Release.zip` (plus `README-FIRST.txt`)

Then double-click `MercedesInvoice.exe` from the unzipped folder. (The Mercedes
connector also needs the Playwright browser available on the target machine —
see Playwright docs. **Build the `.exe` on a Windows machine.**)

### Manual steps (equivalent)
```bash
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m playwright install chromium
.venv\Scripts\python -m PyInstaller --noconfirm --clean mercedes_invoice.spec
```

### Build flags
```bash
python build.py                 # full: test -> build -> zip
python build.py --test-only     # just the test stage
python build.py --build-only    # just the PyInstaller build
python build.py --zip-only      # just package the zip
```

## Layout
```
build.bat        Thin Windows wrapper that calls build.py
build.py         Unified build: test + PyInstaller + zip packaging
mercedes_invoice.spec   PyInstaller spec (bundles ReportLab fonts + Playwright driver)
mercedes_invoice/
  __init__.py, main.py      package + entry point
  config.py                 VAT, currency, paths, SMTP, timeouts
  db.py                     SQLite: customers, invoices, invoice_items
  pdf.py                    ReportLab invoice -> Invoices/<year>/INV-<n>.pdf
  csv_export.py             CSV record -> Invoices/<year>/INV-<n>.csv
  emailer.py                SMTP with attachment + retry semantics
  assets/                   logo.png, footer.png, app.ico
  connectors/
    __init__.py             factory (make_source)
    base.py                 PriceSource interface
    mock.py                 offline deterministic prices
    mercedes.py             Playwright persistent-profile connector (login/session)
  ui/
    __init__.py             MainWindow + run()
    main_window.py          PySide6 POS scan screen (background price worker)
    checkout_dialog.py      cart + vehicle details + customer details + Save & Email
    style.py                shared Qt stylesheet
```
build.bat           Windows PyInstaller build script
mercedes_invoice.spec   optional richer PyInstaller spec
mercedes_invoice/
  config.py           VAT, currency, paths, SMTP, timeouts
  db.py               SQLite: customers, invoices, invoice_items
  pdf.py              ReportLab invoice -> Invoices/<year>/INV-<n>.pdf
  csv_export.py       CSV record -> Invoices/<year>/INV-<n>.csv
  emailer.py          SMTP with attachment + retry semantics
  connectors/
    base.py           PriceSource interface
    mock.py           offline deterministic prices (test)
    mercedes.py       Playwright persistent-profile connector (login/session)
  ui/main_window.py   PySide6 POS scan screen (background price worker)
  ui/checkout_dialog.py  cart + customer details + Save & Email
  main.py             entry point
```
