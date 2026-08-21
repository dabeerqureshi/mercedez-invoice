"""Invoice output-file naming.

One place builds the saved invoice file names so the PDF and CSV always match:
    Invoices/<year>/INV-000123-John-Smith.pdf
    Invoices/<year>/INV-000123-John-Smith.csv

The customer's name is included so invoices can be identified at a glance in
the folder. Names are sanitised for Windows (illegal characters removed,
whitespace collapsed to dashes, length capped) and fall back to the plain
invoice number when no customer name was entered.
"""
import datetime
import csv
import os
import re

from . import config

_MAX_NAME_LEN = 40


def _safe_name_part(name: str) -> str:
    """Turn a customer name into a safe filename segment ('John Smith' -> 'John-Smith')."""
    cleaned = re.sub(r"[^A-Za-z0-9 \-_&']", "", name or "")
    cleaned = cleaned.strip()
    cleaned = re.sub(r"\s+", "-", cleaned)
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned[:_MAX_NAME_LEN].rstrip("-")


def _field(obj, key: str) -> str:
    """Read a field from a dict OR a sqlite3.Row, returning '' on any problem."""
    if obj is None:
        return ""
    try:
        value = obj[key]
    except Exception:
        return ""
    return value or ""


def invoice_filename(record, ext: str) -> str:
    """Build '<base>.<ext>' for an invoice record from db.get_invoice().

    Includes the customer's name when available, e.g.
    'INV-000123-John-Smith.pdf'; falls back to 'INV-000123.pdf'.

    Note: record["customer"] is a sqlite3.Row (index access only), so fields
    are read via _field() rather than dict.get().
    """
    invoice = record["invoice"]
    base = f"INV-{int(invoice['invoice_number']):06d}"
    name = _safe_name_part(_field(record.get("customer"), "name"))
    if name:
        base = f"{base}-{name}"
    ext = ext.lstrip(".").lower()
    return f"{base}.{ext}"


def invoice_output_path(record, ext: str) -> str:
    """Full path 'Invoices/<year>/<file>' for an invoice record."""
    year = datetime.datetime.now().year
    out_dir = os.path.join(config.INVOICES_DIR, str(year))
    os.makedirs(out_dir, exist_ok=True)
    return os.path.join(out_dir, invoice_filename(record, ext))



def _field(obj, key: str) -> str:
    """Read a field from a dict OR a sqlite3.Row, returning '' on any problem."""
    if obj is None:
        return ""
    try:
        value = obj[key]
    except Exception:
        return ""
    return value or ""


def _designation(item) -> str:
    try:
        return item["designation"] or ""
    except (KeyError, TypeError):
        return ""


def export_invoice_csv(record):
    """Write an invoice (dict from db.get_invoice()) to CSV.

    The file is named with the customer's name (see invoice_output_path),
    e.g. Invoices/<year>/INV-000123-John-Smith.csv.

    Returns the absolute path of the CSV.
    """
    invoice = record["invoice"]
    customer = record["customer"] or {}
    items = record["items"]

    invoice_number = int(invoice["invoice_number"])
    path = invoice_output_path(record, "csv")

    date_str = invoice["created_at"] or datetime.datetime.now().isoformat(timespec="seconds")

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Invoice", f"INV-{invoice_number:06d}"])
        w.writerow(["Date", date_str])
        w.writerow(["Customer", customer["name"] if customer else ""])
        w.writerow(["Email", customer["email"] if customer else ""])
        w.writerow(["Phone", customer["phone"] if customer else ""])
        inv = invoice
        w.writerow(["Vehicle Make", _field(inv, "make")])
        w.writerow(["Vehicle Model", _field(inv, "model")])
        w.writerow(["Vehicle Reg", _field(inv, "reg_no")])
        w.writerow(["Mileage", _field(inv, "mileage")])
        w.writerow([])
        w.writerow(["DESCRIPTION OF WORK", "OPER No.", "Time", "LABOUR COST"])
        for it in record.get("work_items") or []:
            w.writerow([
                _field(it, "description"),
                _field(it, "oper_no"),
                _field(it, "time_hours"),
                round(float(_field(it, "labour_cost") or 0), 2),
            ])
        w.writerow([])
        w.writerow(["Part Number", "Description", "Qty", "Unit Price", "Line Total"])
        for it in items:
            w.writerow([
                it["part_number"],
                _designation(it),
                it["quantity"],
                round(float(it["unit_price"]), 2),
                round(float(it["line_total"]), 2),
            ])
        w.writerow([])
        w.writerow(["Subtotal", "", "", "", round(float(invoice["subtotal"]), 2)])
        w.writerow(["VAT", "", "", "", round(float(invoice["vat"]), 2)])
        w.writerow(["Discount", "", "", "", round(float(invoice["discount"]), 2)])
        w.writerow(["TOTAL", "", "", "", round(float(invoice["total"]), 2)])

    return path
