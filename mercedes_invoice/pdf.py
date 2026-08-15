"""ReportLab invoice generation.

Builds Invoices/<year>/INV-000001.pdf from the stored invoice record.
"""
import datetime
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from . import config


def _money(amount):
    return config.money(round(float(amount or 0), 2))


def _format_items(db_items):
    return [
        {
            "part_number": it["part_number"],
            "designation": it["designation"] if "designation" in it.keys() else "",
            "quantity": it["quantity"],
            "unit_price": it["unit_price"],
            "line_total": it["line_total"],
        }
        for it in db_items
    ]


def generate_invoice_pdf(record):
    """record is the dict returned by db.get_invoice().

    Returns the absolute path of the generated PDF.
    """
    invoice = record["invoice"]
    customer = record["customer"] or {}
    items = _format_items(record["items"])

    invoice_number = int(invoice["invoice_number"])
    year = datetime.datetime.now().year
    out_dir = os.path.join(config.INVOICES_DIR, str(year))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"INV-{invoice_number:06d}.pdf")

    styles = getSampleStyleSheet()
    title = ParagraphStyle("title", parent=styles["Title"], fontSize=18, spaceAfter=2)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=9, leading=12)
    heading = ParagraphStyle("heading", parent=styles["Heading2"], fontSize=12, spaceBefore=8)
    cell = ParagraphStyle("cell", parent=styles["Normal"], fontSize=9, leading=11)

    story = []
    story.append(Paragraph(config.COMPANY_NAME, title))
    story.append(Paragraph(config.COMPANY_ADDRESS, small))
    story.append(Paragraph(f"{config.COMPANY_EMAIL}  |  {config.COMPANY_PHONE}", small))
    story.append(Spacer(1, 8 * mm))

    story.append(Paragraph(f"Invoice: INV-{invoice_number:06d}", heading))
    story.append(Paragraph(
        f"Date: {datetime.datetime.now().strftime('%d-%b-%Y')}", styles["Normal"]))
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Customer", heading))
    story.append(Paragraph(customer["name"] or "", styles["Normal"]))
    if customer["email"]:
        story.append(Paragraph(customer["email"], styles["Normal"]))
    if customer["phone"]:
        story.append(Paragraph(customer["phone"], styles["Normal"]))
    story.append(Spacer(1, 6 * mm))

    data = [["Part", "Description", "Qty", "Price", "Total"]]
    for it in items:
        data.append([
            Paragraph(it["part_number"], cell),
            Paragraph(it.get("designation") or "", cell),
            str(it["quantity"]),
            _money(it["unit_price"]),
            _money(it["line_total"]),
        ])
    table = Table(data, colWidths=[38 * mm, 55 * mm, 15 * mm, 35 * mm, 35 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#333333")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN", (3, 0), (4, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(table)
    story.append(Spacer(1, 8 * mm))

    summary = Table(
        [
            ["Subtotal:", _money(invoice["subtotal"])],
            [f"VAT {int(config.VAT_RATE * 100)}%:", _money(invoice["vat"])],
            ["Discount:", _money(-float(invoice["discount"]) if invoice["discount"] else 0)],
            ["TOTAL:", _money(invoice["total"])],
        ],
        colWidths=[120 * mm, 35 * mm],
    )
    summary.setStyle(TableStyle([
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 12),
        ("LINEABOVE", (0, -1), (-1, -1), 1.2, colors.black),
    ]))
    story.append(summary)

    doc = SimpleDocTemplate(
        path, pagesize=A4,
        rightMargin=15 * mm, leftMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"INV-{invoice_number:06d}",
    )
    doc.build(story)
    return path
