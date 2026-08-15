"""CSV export for invoices.

Writes a per-invoice CSV alongside the PDF in
Invoices/<year>/INV-000001.csv. Uses only the standard library csv module.
"""
import csv
import datetime
import os

from . import config


def _designation(item) -> str:
    try:
        return item["designation"] or ""
    except (KeyError, TypeError):
        return ""


def export_invoice_csv(record):
    """Write an invoice (dict from db.get_invoice()) to CSV.

    Returns the absolute path of the CSV.
    """
    invoice = record["invoice"]
    customer = record["customer"] or {}
    items = record["items"]

    invoice_number = int(invoice["invoice_number"])
    year = datetime.datetime.now().year
    out_dir = os.path.join(config.INVOICES_DIR, str(year))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"INV-{invoice_number:06d}.csv")

    date_str = invoice["created_at"] or datetime.datetime.now().isoformat(timespec="seconds")

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Invoice", f"INV-{invoice_number:06d}"])
        w.writerow(["Date", date_str])
        w.writerow(["Customer", customer["name"] if customer else ""])
        w.writerow(["Email", customer["email"] if customer else ""])
        w.writerow(["Phone", customer["phone"] if customer else ""])
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
