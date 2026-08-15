#!/usr/bin/env python3
"""Mercedes Invoice — console self-test (no GUI, no scanner needed).

Simulates the full daily flow:
    scan part -> live price + product name -> cart (duplicate scan
    increments qty) -> checkout (customer) -> SQLite + PDF + CSV + email.

Run from the project root (activate the venv first):
    python selftest.py                      # offline mock prices
    MERCEDES_PRICE_SOURCE=mercedes python selftest.py   # live (needs login)
"""
import datetime
import sys

from mercedes_invoice import config, csv_export, db, emailer, pdf
from mercedes_invoice.connectors import make_source


def main() -> int:
    print("Mercedes Invoice — self-test")
    print("=" * 50)

    db.init_db()  # ensures schema + migration
    src = make_source(config.PRICE_SOURCE)
    print(f"Price source: {src.name} ({src.status})\n")

    # Simulate barcode scans. 'A' twice => duplicate scan must increment qty.
    scans = ["A0008280388", "A0008280388", "B0001234567"]
    cart = {}  # part -> {qty, price, designation, currency, retrieved_at}

    for part in scans:
        try:
            res = src.get_price(part)
        except Exception as e:  # noqa: BLE001
            print(f"  !! scan {part} failed: {e}")
            continue
        if part in cart:
            cart[part]["qty"] += 1
            print(f"  scan {part} -> quantity now {cart[part]['qty']} "
                  f"(price {res.price} {res.currency})")
        else:
            cart[part] = {
                "qty": 1, "price": res.price, "designation": res.designation,
                "currency": res.currency, "retrieved_at": res.retrieved_at,
            }
            print(f"  scan {part} -> {res.designation or '(no name)'} "
                  f"{res.price} {res.currency}")

    if not cart:
        print("\nNo items could be priced — cannot continue.")
        src.close()
        return 1

    # Build line items (same logic as the GUI's _line_items)
    items = []
    subtotal = 0.0
    for part, info in cart.items():
        line_total = round(info["price"] * info["qty"], 2)
        subtotal += line_total
        items.append({
            "part_number": part,
            "designation": info["designation"],
            "quantity": info["qty"],
            "unit_price": info["price"],
            "line_total": line_total,
            "vat": 0.0,
            "discount": 0.0,
            "price_retrieved_at": info["retrieved_at"],
        })

    # --- Charges entered at checkout --------------------------------------
    service_cost = 50.00            # e.g. labour / fitment
    apply_service_vat = False      # default: 20% VAT applies to PARTS only
    discount = 20.00               # fixed amount, as per MVP choice

    parts_subtotal = round(subtotal, 2)
    vat = round(parts_subtotal * config.VAT_RATE, 2)
    if apply_service_vat:
        vat += round(service_cost * config.VAT_RATE, 2)
    subtotal = round(parts_subtotal + service_cost, 2)
    vat = round(vat, 2)
    discount = round(min(discount, subtotal + vat), 2)
    total = round(subtotal + vat - discount, 2)

    # Service is stored as its own line item (part "SERVICE")
    if service_cost > 0:
        items.append({
            "part_number": "SERVICE",
            "designation": "Service / labour",
            "quantity": 1,
            "unit_price": service_cost,
            "line_total": service_cost,
            "vat": round(service_cost * config.VAT_RATE, 2) if apply_service_vat else 0.0,
            "discount": 0.0,
            "price_retrieved_at": datetime.datetime.now().isoformat(timespec="seconds"),
        })
    for it in items:
        if it["part_number"] != "SERVICE":
            it["discount"] = discount

    print(f"\nParts subtotal   {config.money(parts_subtotal)}")
    print(f"Service cost     {config.money(service_cost)}")
    print(f"VAT {int(config.VAT_RATE * 100)}%      {config.money(vat)}")
    print(f"Discount        -{config.money(discount)}")
    print(f"TOTAL            {config.money(total)}")

    # Checkout: capture customer (in the GUI these are the dialog fields)
    customer = {
        "name": "Self-Test Customer",
        "email": "customer@example.com",
        "phone": "+440000000000",
    }

    # 1) Persist (SQLite) with frozen prices/names
    record = db.save_invoice(customer, items, subtotal, vat, discount,
                             total, config.CURRENCY_CODE)
    invoice_number = int(record["invoice"]["invoice_number"])
    print(f"\nSaved invoice INV-{invoice_number:06d} to SQLite.")

    # 2) PDF + CSV (always saved; email failure never loses them)
    pdf_path = pdf.generate_invoice_pdf(record)
    csv_path = csv_export.export_invoice_csv(record)
    print(f"PDF generated: {pdf_path}")
    print(f"CSV generated: {csv_path}")

    # 3) Email (will report the fail-safe path if SMTP is not configured)
    ok, err = emailer.send_invoice(customer["email"], pdf_path, invoice_number)
    if ok:
        print(f"Email: SENT to {customer['email']}")
    else:
        print(f"Email: NOT SENT (invoice / PDF / CSV still saved) — {err}")

    print("\nSelf-test complete. Open the PDF and CSV above to verify.")
    src.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
