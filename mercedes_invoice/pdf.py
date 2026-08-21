"""IQ Motors invoice PDF - layout matched to the approved demo.

Drawn with ReportLab canvas primitives (rather than flowed platypus) so the
header, detail boxes, work/parts sections and totals sit exactly where the
demo places them:

  * logo top-left, big bold INVOICE top-right
  * CUSTOMER DETAILS box (left) and VEHICLE DETAILS box (right)
  * DESCRIPTION OF WORK  | OPER No. | Time | LABOUR COST
  * PARTS DESCRIPTION    | QUANTITY | PART NUMBER | PARTS COST
  * SUBTOTAL / VAT @20% / TOTAL right-aligned with rule lines
  * V.A.T REG NO + service-book note + address block at the bottom
"""
import datetime
import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdfcanvas

from . import config
from .csv_export import invoice_output_path

PAGE_W, PAGE_H = A4
MARGIN = 15 * mm


def _field(obj, key):
    if obj is None:
        return ""
    try:
        value = obj[key]
    except Exception:
        return ""
    return value or ""


def _label_value(c, x, y, label, value, label_w=22 * mm):
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x, y, label)
    c.setFont("Helvetica", 9)
    c.drawString(x + label_w, y, str(value or ""))


def _draw_header(c):
    top_y = PAGE_H - MARGIN - 12 * mm
    logo = config.LOGO_PATH
    if logo and os.path.exists(logo):
        try:
            img = ImageReader(logo)
            iw, ih = img.getSize()
            h = 16 * mm
            w = h * (iw / float(ih))
            c.drawImage(img, MARGIN, top_y - h + 4 * mm,
                        width=w, height=h, mask="auto")
        except Exception:
            pass
    else:
        c.setFont("Helvetica-Bold", 20)
        c.drawString(MARGIN, top_y - 6 * mm, config.COMPANY_NAME)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(MARGIN, top_y - 10 * mm, config.COMPANY_TAGLINE)

    c.setFont("Helvetica-Bold", 26)
    c.drawRightString(PAGE_W - MARGIN, top_y - 8 * mm, "INVOICE")
    return top_y - 24 * mm


def _box(c, x, y, w, h):
    c.rect(x, y, w, h)


def _draw_details(c, y_top, record):
    invoice = record["invoice"]
    customer = record.get("customer") or {}
    col_w = (PAGE_W - 2 * MARGIN - 10 * mm) / 2.0
    row_h = 6.2 * mm
    box_h = row_h * 6      # header + 4 rows + a full padding row at the bottom

    # left: CUSTOMER DETAILS
    lx = MARGIN
    ly = y_top - box_h
    _box(c, lx, ly, col_w, box_h)
    yy = y_top - row_h
    c.setFont("Helvetica-Bold", 8)
    c.drawString(lx + 2 * mm, yy - 3.6 * mm, "CUSTOMER DETIALS")
    yy -= row_h
    _label_value(c, lx + 2 * mm, yy - 3.6 * mm, "", _field(customer, "name"))
    yy -= row_h
    date_str = datetime.datetime.now().strftime("%d/%m/%Y")
    _label_value(c, lx + 2 * mm, yy - 3.6 * mm, "DATE:",
                 date_str, label_w=18 * mm)
    yy -= row_h
    inv_no = f"INV-{int(invoice['invoice_number']):06d}"
    _label_value(c, lx + 2 * mm, yy - 3.6 * mm, "INVOICE NO:", inv_no,
                 label_w=24 * mm)

    # right: VEHICLE DETAILS
    rx = MARGIN + col_w + 10 * mm
    _box(c, rx, ly, col_w, box_h)
    label_x = rx + 2 * mm
    value_x = rx + 24 * mm
    rows = [
        ("MAKE", _field(invoice, "make") or config.DEFAULT_VEHICLE_MAKE),
        ("MODEL", _field(invoice, "model")),
        ("REG", _field(invoice, "reg_no")),
        ("MILEAGE", _field(invoice, "mileage")),
    ]
    yy = y_top - row_h
    c.setFont("Helvetica-Bold", 8)
    c.drawString(rx + 2 * mm, yy - 3.6 * mm, "VEHICLE DETAILS")
    for label, value in rows:
        yy -= row_h
        c.setFont("Helvetica-Bold", 8)
        c.drawString(label_x, yy - 3.6 * mm, label)
        c.setFont("Helvetica", 9)
        c.drawString(value_x, yy - 3.6 * mm, str(value or ""))
    return ly - 16 * mm

from .csv_export import invoice_output_path


def _fit(c, text, font, size, max_w):
    """Truncate text with an ellipsis so it never exceeds max_w."""
    text = str(text or "")
    if c.stringWidth(text, font, size) <= max_w:
        return text
    while text and c.stringWidth(text + "...", font, size) > max_w:
        text = text[:-1]
    return text + "..."


def _section_headers(c, y, cols):
    """Underlined column headers. cols = (x, text, align) with align
    'l' left or 'r' right-aligned at x (used for the cost columns so the
    header sits directly over its figures)."""
    c.setFont("Helvetica-Bold", 9)
    c.setLineWidth(0.6)
    for x, text, align in cols:
        if align == "r":
            c.drawRightString(x, y, text)
            c.line(x - c.stringWidth(text, "Helvetica-Bold", 9) - 1,
                   y - 1.6 * mm, x + 1, y - 1.6 * mm)
        else:
            c.drawString(x, y, text)
            c.line(x - 1, y - 1.6 * mm,
                   x + c.stringWidth(text, "Helvetica-Bold", 9) + 1,
                   y - 1.6 * mm)


def _draw_work(c, y, work_items):
    x_desc = MARGIN
    x_oper = MARGIN + 97 * mm     # ~112mm abs
    x_time = MARGIN + 123 * mm    # ~138mm abs
    x_cost = PAGE_W - MARGIN      # right-aligned figures/headers
    desc_w = x_oper - x_desc - 4 * mm
    _section_headers(c, y, [
        (x_desc, "DESCRIPTION OF WORK", "l"),
        (x_oper, "OPER No.", "l"),
        (x_time, "Time", "l"),
        (x_cost, "LABOUR COST", "r"),
    ])
    yy = y - 9 * mm
    for w in work_items:
        c.setFont("Helvetica", 9)
        c.drawString(x_desc, yy, _fit(c, _field(w, "description"),
                                      "Helvetica", 9, desc_w))
        c.drawString(x_oper, yy, _field(w, "oper_no"))
        c.drawString(x_time, yy, _field(w, "time_hours"))
        cost = float(_field(w, "labour_cost") or 0)
        c.drawRightString(x_cost, yy, config.money(cost))
        yy -= 7 * mm
    return yy - 8 * mm


def _draw_parts(c, y, items):
    x_desc = MARGIN
    x_qty = MARGIN + 100 * mm     # ~115mm abs
    x_part = MARGIN + 127 * mm    # ~142mm abs
    x_cost = PAGE_W - MARGIN      # right-aligned figures/headers
    desc_w = x_qty - x_desc - 4 * mm
    part_w = 24 * mm              # keeps numbers clear of the cost column
    _section_headers(c, y, [
        (x_desc, "PARTS DESCRIPTION", "l"),
        (x_qty, "QUANTITY", "l"),
        (x_part, "PART NUMBER", "l"),
        (x_cost, "PARTS COST", "r"),
    ])
    yy = y - 9 * mm
    for it in items:
        c.setFont("Helvetica", 9)
        desc = _field(it, "designation") or _field(it, "part_number")
        c.drawString(x_desc, yy, _fit(c, desc, "Helvetica", 9, desc_w))
        c.drawCentredString(x_qty + 8 * mm, yy, str(_field(it, "quantity")))
        c.drawString(x_part, yy, _fit(c, _field(it, "part_number"),
                                      "Helvetica", 9, part_w))
        c.drawRightString(x_cost, yy,
                          config.money(float(_field(it, "line_total") or 0)))
        yy -= 7 * mm
    return yy - 8 * mm


def _labour_total(record):
    """Sum of the invoice's work-item labour costs."""
    return round(sum(float(_field(w, "labour_cost") or 0)
                     for w in (record.get("work_items") or [])), 2)


def _draw_totals(c, y, record):
    """Totals block: SUBTOTAL (parts) / LABOUR COST / VAT / TOTAL.

    Drawn bottom-up from *y_bottom* so it always sits just above the footer,
    matching the demo layout regardless of how many part lines exist.
    """
    invoice = record["invoice"]
    labour = _labour_total(record)
    grand = float(_field(invoice, "subtotal") or 0)   # parts + labour
    parts_only = round(grand - labour, 2)

    x_label = PAGE_W - MARGIN - 55 * mm
    rows = [  # drawn from the anchor going UP, so the block never
              # slides down into the footer image
        ("TOTAL", float(_field(invoice, "total") or 0), True),
        (f"VAT @ {int(config.VAT_RATE * 100)}%",
         float(_field(invoice, "vat") or 0), False),
        ("LABOUR COST", labour, False),
        ("SUBTOTAL", parts_only, False),
    ]
    yy = y
    for label, value, bold in rows:
        c.setFont("Helvetica-Bold" if bold else "Helvetica",
                  11 if bold else 9.5)
        c.drawRightString(x_label, yy, label)
        c.setLineWidth(0.7 if not bold else 1.0)
        c.line(PAGE_W - MARGIN - 38 * mm, yy - 1.5 * mm,
               PAGE_W - MARGIN, yy - 1.5 * mm)
        c.drawRightString(PAGE_W - MARGIN, yy, config.money(value))
        yy += 8.5 * mm          # stack upward, away from the footer
    return yy


def _draw_footer(c):
    """Draw the full footer strip from footer.png when available.

    The image carries the brand logos, address/phone block, the VAT
    registration number and the digital-service-book note — i.e. the exact
    approved footer. Falls back to a drawn text footer only if missing.
    """
    footer = config.FOOTER_PATH
    if footer and os.path.exists(footer):
        try:
            img = ImageReader(footer)
            iw, ih = img.getSize()
            w = PAGE_W - 2 * MARGIN
            h = w * (ih / float(iw))
            c.drawImage(img, MARGIN, MARGIN - 2 * mm,
                        width=w, height=h, mask="auto")
            return
        except Exception:
            pass

    # ---- text fallback ---------------------------------------------------
    foot_y = MARGIN + 4 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(PAGE_W / 2.0 - 8 * mm, foot_y + 16 * mm,
                        f"V.A.T REG NO: {config.COMPANY_VAT_REG_NO}")
    c.drawRightString(PAGE_W - MARGIN, foot_y + 22 * mm, "We can update your")
    c.drawRightString(PAGE_W - MARGIN, foot_y + 17 * mm, "DIGITAL SERVICE  BOOK")
    c.drawRightString(PAGE_W - MARGIN, foot_y + 12 * mm, "on Mercedes Benz System")
    c.setFont("Helvetica", 9)
    c.drawRightString(PAGE_W - MARGIN, foot_y + 7 * mm, "(for Service History)")
    c.setFont("Helvetica", 6.5)
    c.drawString(MARGIN, foot_y + 2 * mm, config.COMPANY_ADDRESS)
    c.drawString(MARGIN, foot_y - 1.5 * mm,
                 f"Tel: {config.COMPANY_PHONE}  Mobile: {config.COMPANY_MOBILE}")


def generate_invoice_pdf(record):
    """Render the invoice record to the demo-matching PDF. Returns the path."""
    path = invoice_output_path(record, "pdf")
    c = pdfcanvas.Canvas(path, pagesize=A4)
    c.setTitle(os.path.basename(path))

    y = _draw_header(c)
    y = _draw_details(c, y, record)
    y = _draw_work(c, y, record.get("work_items") or [])
    _draw_parts(c, y, record.get("items") or [])

    # Totals anchored just above the footer strip (demo layout), leaving the
    # demo's white space between the parts list and the totals.
    footer = config.FOOTER_PATH
    footer_h = 0.0
    if footer and os.path.exists(footer):
        try:
            img = ImageReader(footer)
            iw, ih = img.getSize()
            footer_h = (PAGE_W - 2 * MARGIN) * (ih / float(iw))
        except Exception:
            pass
    totals_bottom = MARGIN + footer_h + 14 * mm
    _draw_totals(c, totals_bottom, record)

    _draw_footer(c)
    c.showPage()
    c.save()
    return path
