# IQ Motors Invoicing — Web (Next.js)

Next.js + TypeScript rewrite of the desktop **Mercedes Parts Invoice** app
(`../mercedes_invoice`), targeting **Vercel** with **Browserbase** for live
Mercedes pricing.

> **Goal:** identical functionality, dramatically better UI/UX.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| **0 — Scaffold** | Next.js 16 + TS + Tailwind v4 + shadcn-style UI, brand theme, config/money | ✅ Done |
| **1 — UI + mock pricing** | Scan → cart → checkout (vehicle / work / customer) → totals, mock price source | ✅ Done |
| **2 — Save pipeline** | SQLite (libSQL/Turso) + Drizzle, `@react-pdf` invoice, CSV, Vercel Blob (local fallback), SMTP email + Retry | ✅ Done |
| **3 — Live Mercedes** | Browserbase Context + Live View ("log in once"), Playwright port of `mercedes.py` | ✅ Done |
| **4 — Hardening** | Scan queue/serialisation, Vercel Cron keep-alive, auth, invoice history | ✅ Done |

Phases 1–2 run **offline with nothing configured**: mock prices, a local SQLite
file at `.data/`, and invoice files written under `.data/`. No Mercedes login,
no Browserbase, no cloud accounts required. Phase 3 activates when you set
`NEXT_PUBLIC_PRICE_SOURCE=mercedes` and Browserbase credentials. Phase 4's
password gate (`APP_PASSWORD`) and keep-alive cron (`CRON_SECRET`) are
optional — unset, everything behaves like the open desktop release.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Type a part number (e.g. `A0008280388`) and press **Enter** — the mock price
source returns a deterministic price identical to the Python app. Check out to
save the invoice (SQLite + PDF + CSV). PDF/CSV download links appear in the
result panel.

```bash
npm run build && npm start   # production build
npm run lint                 # eslint
```

## The save pipeline (Phase 2)

Order is identical to the desktop app — **the invoice is saved first**, so a
PDF or email failure never loses data:

```
SQLite (libSQL)  ->  @react-pdf invoice  ->  CSV  ->  storage  ->  email
```

- **DB** — `src/lib/db/` (Drizzle over libSQL). Same tables/columns as `db.py`,
  created idempotently on first use (`ensureSchema`).
- **PDF** — `src/lib/pdf/invoice.tsx` reproduces the approved layout: logo,
  INVOICE title, customer/vehicle boxes, description-of-work, parts, ruled
  totals, footer image. Assets live in `src/lib/pdf/assets/`.
- **CSV** — `src/lib/csv.ts` (same columns/order as `csv_export.py`).
- **Storage** — `src/lib/storage.ts`: Vercel Blob when `BLOB_READ_WRITE_TOKEN`
  is set, otherwise local `.data/` served by `/api/files/[...path]`.
- **Email** — `src/lib/email.ts` (Nodemailer/SMTP). When SMTP is unset the
  invoice is still saved and the UI offers **Retry Email**
  (`POST /api/invoices/[number]/resend`).

## How the price source works

`src/lib/connectors/` mirrors the Python design:

- `types.ts` — `PriceSource` interface + `PartNotFoundError` / `LoginRequiredError`
  + `normalizePart()` (client-safe; everything else here is server-only)
- `mock.ts` — offline deterministic prices (MD5-derived, identical to `mock.py`)
- `mercedes.ts` — full port of `mercedes.py`, driving a Browserbase cloud
  browser (see the Phase 3 section below)
- `index.ts` — `makeSource(name)` factory

Switch sources with `NEXT_PUBLIC_PRICE_SOURCE=mock|mercedes` (see `.env.example`).

## Live Mercedes pricing (Phase 3)

The desktop app kept your login in a local Chromium profile directory. The web
build keeps it in a **Browserbase Context** — an encrypted, persistent
user-data-directory hosted by Browserbase — with Playwright (`playwright-core`)
driving short-lived sessions over CDP:

```
Open Mercedes & Login  ->  POST /api/mercedes/connect    (keepAlive session + Live View URL)
  owner signs in inside the embedded Live View iframe (MFA works, no password
  ever reaches the server)
I've signed in          ->  POST /api/mercedes/verify     (ends login session, probes the
                                                           Context with a fresh session,
                                                           persists status = connected)
Scan a part             ->  POST /api/price               (fresh session on the Context,
                                                           port of get_price(): reset
                                                           catalog -> type part -> capture
                                                           price API response)
```

- **Connection state** lives in the `mercedes_sessions` table (Context ID +
  status). Scans while not connected return the desktop's exact
  `login_required` error, and the header badge shows
  connected / login-in-progress / not-connected.
- **Endpoints**: `GET /api/mercedes/status`,
  `POST /api/mercedes/connect`, `POST /api/mercedes/verify`,
  `POST /api/mercedes/disconnect` (`{ "mode": "cancel" | "reset" }` — cancel
  closes an open login window and restores the previous state; reset deletes
  the Context and forgets the login).
- **One session at a time**: all browser work is serialised through
  `src/lib/lock.ts` (Browserbase free plan = 1 concurrent session, and a site
  rule allows one session per Context).
- **Serverless budget**: routes declare `maxDuration = 60` and the connector
  carries a per-lookup deadline (`MERCEDES_LOOKUP_BUDGET_MS`, default 50s) so a
  failure surfaces as a proper connector error instead of a function kill.
  Timeouts default shorter than the desktop app; override via env (see
  `.env.example`).
- **Secrets** stay server-side: `BROWSERBASE_API_KEY` / 
  `BROWSERBASE_PROJECT_ID` are read only in API routes.

## Hardening (Phase 4)

**Scan queue.** Scanned parts go through a client-side FIFO and are looked up
strictly one at a time, in scan order — the exact behaviour of the desktop
app's `PriceWorker` background thread (the first web build fired them all in
parallel). Duplicate scans still increment quantity, also like the desktop.

**Session keep-alive.** The desktop app softly reloaded the parked catalog
every `MERCEDES_KEEP_ALIVE_S` (default 240s, `0` disables) so Mercedes'
idle-timeout doesn't log you out mid-day. On the web three triggers hit
`GET /api/cron/keep-alive`:

- the open POS page (a timer while connected — same role as the desktop QTimer),
- Vercel Cron (`vercel.json`, daily at 06:00 UTC — the Hobby plan allows only
  one run per day; schedule more often on Pro),
- an external pinger (`/api/cron/keep-alive?secret=$CRON_SECRET`) for
  sub-hourly refreshes on any plan.

The route skips the refresh when a lookup happened within the interval
(`mercedes_sessions.last_activity_at`) and reports what it did (`refreshed`,
`recent_activity`, `login_page`, ...). Auth accepts
`Authorization: Bearer $CRON_SECRET` (sent automatically by Vercel Cron when
`CRON_SECRET` is set in the project env), a valid session cookie, or
`?secret=`.

**Auth.** With `APP_PASSWORD` unset the app is open — exactly like the desktop
release, so local dev stays zero-config. Set it and every page and API route
requires a signed session cookie: `/login` signs in, the header shows **Sign
out**. `AUTH_SECRET` optionally keys the cookie HMAC (defaults to the
password). This is a single shared shop password, not a multi-user system.

**Invoice history.** The header links **History** (`/history`): every saved
invoice, newest first, with customer/vehicle/item counts/total, PDF and CSV
links, and one-click **Resend** (`GET /api/invoices` powers the page).

## Invoice maths (unchanged from the desktop app)

```
SUBTOTAL = parts total + sum(labour)
VAT @20% = SUBTOTAL x 20%
TOTAL    = SUBTOTAL + VAT
```

## Layout

```
src/
  app/
    layout.tsx                     root layout + toaster
    page.tsx                       POS screen (auth-gated when APP_PASSWORD set)
    login/page.tsx                 password sign-in (Phase 4)
    history/page.tsx               invoice history (Phase 4)
    globals.css                    brand theme (ported from ui/style.py)
    api/
      price/route.ts               POST { partNumber } -> PriceResult
      auth/login/route.ts          POST { password } -> session cookie (Phase 4)
      auth/logout/route.ts         POST clear the session cookie
      cron/keep-alive/route.ts     GET quiet Mercedes session refresh (Phase 4)
      mercedes/status/route.ts     GET  connection state for the header badge
      mercedes/connect/route.ts    POST open the Live View login window
      mercedes/verify/route.ts     POST confirm the login -> status connected
      mercedes/disconnect/route.ts POST cancel login window / full reset
      invoices/route.ts            POST checkout payload -> save pipeline
                                 GET  history list (Phase 4)
      invoices/[number]/resend/    POST retry email
      files/[...path]/route.ts     serve locally-stored invoice files
  components/
    ui/                            button, input, label, card, table, dialog, badge
    auth/login-form.tsx            password form (Phase 4)
    history/history-app.tsx        invoice history table (Phase 4)
    pos/
      pos-app.tsx                  scan -> cart -> checkout orchestration
      header.tsx                   brand header bar + connection badge
      connect-dialog.tsx           Live View login window (Phase 3)
      cart-table.tsx               cart with qty + remove
      totals-bar.tsx               subtotal / VAT / discount / total
      checkout-dialog.tsx          parts + vehicle + work + customer + result panel
  lib/
    config.ts                      brand, VAT, money(), SMTP (from env)
    auth.ts                        APP_PASSWORD session cookie guard (Phase 4)
    browserbase.ts                 Browserbase session/Context/CDP wrapper
    lock.ts                        serialises all browser work (one session)
    pricing.ts                     totals maths, parsePrice, safeNamePart
    csv.ts                         invoice CSV export
    invoice-files.ts               INV-000123-Name file naming
    invoice-service.ts             save -> PDF -> CSV -> storage -> email
    email.ts                       SMTP sender (Nodemailer)
    storage.ts                     Vercel Blob / local file storage
    connectors/                    price source abstraction (+ mercedes port)
    db/                            schema, client, ensureSchema, repository,
                                   session-store (Mercedes connection state)
    pdf/                           invoice document + brand assets
    types.ts                       CartLine / Vehicle / Customer
```

## Environment

See `.env.example`. Phase 1–2 need nothing set. Later phases add Turso, Vercel
Blob, SMTP and Browserbase values (server-side only — never commit secrets).
Phase 4 adds optional `APP_PASSWORD` / `AUTH_SECRET` (login), `CRON_SECRET`
(keep-alive cron) and `MERCEDES_KEEP_ALIVE_S` (refresh interval). Remember to
set `APP_PASSWORD` and `CRON_SECRET` in the Vercel project env as well.

## Parity with the desktop app

Scan → live price → cart (auto-qty on duplicates) → checkout (parts, vehicle,
work lines, customer) → subtotal/VAT/total → save → PDF → CSV → email, with the
"save first, retry email" invariant. Differences inherent to the web/Vercel
target: files download instead of being written to `%APPDATA%`, and the USB
scanner needs the input focused.