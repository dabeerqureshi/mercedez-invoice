"""Sqlite3 persistence layer.

Schema (matches the requested design):
  customers      name / email / phone
  invoices       invoice_number, customer, subtotal, vat, discount, total, timestamp
  invoice_items  part_number, quantity, unit_price, line_total, vat, discount,
                 price_retrieved_at   <- the live Mercedes price at checkout is
                                        frozen here, so old invoices are never
                                        retroactively changed by later prices.
"""
import datetime
import sqlite3

from . import config

DB_PATH = config.DB_PATH


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    con = _connect()
    try:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS customers (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                email       TEXT,
                phone       TEXT,
                created_at  TEXT
            );
            CREATE TABLE IF NOT EXISTS invoices (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_number  INTEGER UNIQUE NOT NULL,
                customer_id     INTEGER,
                subtotal        REAL NOT NULL,
                vat             REAL NOT NULL,
                discount        REAL NOT NULL,
                total           REAL NOT NULL,
                currency        TEXT NOT NULL,
                created_at      TEXT,
                FOREIGN KEY (customer_id) REFERENCES customers (id)
            );
            CREATE TABLE IF NOT EXISTS invoice_items (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id          INTEGER NOT NULL,
                part_number         TEXT NOT NULL,
                designation         TEXT,
                quantity            INTEGER NOT NULL,
                unit_price          REAL NOT NULL,
                line_total          REAL NOT NULL,
                vat                 REAL NOT NULL,
                discount            REAL NOT NULL,
                price_retrieved_at  TEXT,
                FOREIGN KEY (invoice_id) REFERENCES invoices (id)
            );
            """
        )
        con.commit()
        _migrate(con)
    finally:
        con.close()


def _migrate(con: sqlite3.Connection) -> None:
    """Add columns introduced after the initial schema, for existing DBs."""
    cols = {r["name"] for r in con.execute("PRAGMA table_info(invoice_items)")}
    if "designation" not in cols:
        con.execute("ALTER TABLE invoice_items ADD COLUMN designation TEXT")
    con.commit()


def _next_invoice_number(con: sqlite3.Connection) -> int:
    row = con.execute(
        "SELECT COALESCE(MAX(invoice_number), 0) AS m FROM invoices"
    ).fetchone()
    return int(row["m"]) + 1


def _get_or_create_customer(con, name, email, phone):
    name = (name or "").strip()
    if not name:
        return None
    email = (email or "").strip()
    phone = (phone or "").strip()
    row = con.execute(
        "SELECT id FROM customers WHERE name=? AND "
        "IFNULL(email,'')=? AND IFNULL(phone,'')=?",
        (name, email, phone),
    ).fetchone()
    if row:
        return row["id"]
    cur = con.execute(
        "INSERT INTO customers (name, email, phone, created_at) VALUES (?,?,?,?)",
        (name, email, phone, datetime.datetime.now().isoformat(timespec="seconds")),
    )
    return cur.lastrowid


def save_invoice(customer, items, subtotal, vat, discount, total, currency):
    """Persist an invoice plus its frozen line items.

    Args:
        customer: dict with keys name/email/phone (may be empty name -> None)
        items:    list of dicts with keys part_number, quantity, unit_price,
                  line_total, vat, discount, price_retrieved_at

    Returns:
        A dict {invoice, customer, items} via get_invoice(), or raises.
    """
    con = _connect()
    try:
        customer_id = _get_or_create_customer(
            con, customer.get("name"), customer.get("email"), customer.get("phone")
        )
        invoice_number = _next_invoice_number(con)
        now = datetime.datetime.now().isoformat(timespec="seconds")
        cur = con.execute(
            "INSERT INTO invoices (invoice_number, customer_id, subtotal, vat, "
            "discount, total, currency, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (invoice_number, customer_id, subtotal, vat, discount, total, currency, now),
        )
        invoice_id = cur.lastrowid
        for it in items:
            con.execute(
                "INSERT INTO invoice_items (invoice_id, part_number, designation, "
                "quantity, unit_price, line_total, vat, discount, "
                "price_retrieved_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    invoice_id,
                    it["part_number"],
                    it.get("designation"),
                    it["quantity"],
                    it["unit_price"],
                    it["line_total"],
                    it["vat"],
                    it["discount"],
                    it["price_retrieved_at"],
                ),
            )
        con.commit()
        return get_invoice(invoice_number)
    finally:
        con.close()


def get_invoice(invoice_number):
    con = _connect()
    try:
        inv = con.execute(
            "SELECT * FROM invoices WHERE invoice_number=?", (invoice_number,)
        ).fetchone()
        if inv is None:
            return None
        customer = None
        if inv["customer_id"]:
            customer = con.execute(
                "SELECT * FROM customers WHERE id=?", (inv["customer_id"],)
            ).fetchone()
        items = con.execute(
            "SELECT * FROM invoice_items WHERE invoice_id=?", (inv["id"],)
        ).fetchall()
        return {"invoice": inv, "customer": customer, "items": items}
    finally:
        con.close()


def list_invoices(limit=50):
    con = _connect()
    try:
        rows = con.execute(
            "SELECT * FROM invoices ORDER BY invoice_number DESC LIMIT ?", (limit,)
        ).fetchall()
        return rows
    finally:
        con.close()
