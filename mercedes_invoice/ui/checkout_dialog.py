"""Checkout dialog: cart + customer details + service cost + discount.

Invoice math (matches the confirmed spec):
    parts_subtotal = sum of part line totals
    vat            = parts_subtotal x 20%
                     (+ service x 20% only if "Apply VAT to service" is checked)
    total          = (parts_subtotal + service) + vat - discount

Save flow: SQLite (DB) -> PDF -> CSV -> email. The invoice is always saved
to disk first, so an email failure never loses data (retry is offered).
"""
import datetime

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QDialog,
    QDoubleSpinBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from .. import config, csv_export, db, emailer, pdf


class CheckoutDialog(QDialog):
    def __init__(self, items, parts_subtotal, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Checkout")
        self.resize(640, 620)

        self.items = items              # parts line items (vat/discount not yet set)
        self.parts_subtotal = parts_subtotal
        self._build_ui()
        self._recalc()

    def _build_ui(self):
        root = QVBoxLayout(self)

        root.addWidget(QLabel("Cart items:"))

        self.table = QTableWidget(len(self.items), 5)
        self.table.setHorizontalHeaderLabels(
            ["Part Number", "Product", "Qty", "Unit Price", "Line Total"])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        for r, it in enumerate(self.items):
            self.table.setItem(r, 0, QTableWidgetItem(it["part_number"]))
            self.table.setItem(r, 1, QTableWidgetItem(it.get("designation") or ""))
            self.table.setItem(r, 2, QTableWidgetItem(str(it["quantity"])))
            self.table.setItem(r, 3, QTableWidgetItem(config.money(it["unit_price"])))
            self.table.setItem(r, 4, QTableWidgetItem(config.money(it["line_total"])))
        self.table.resizeColumnsToContents()
        root.addWidget(self.table)

        # Summary (updates live)
        self.lbl_parts = QLabel()
        self.lbl_service = QLabel()
        self.lbl_vat = QLabel()
        self.lbl_discount = QLabel()
        self.lbl_total = QLabel()
        font = self.lbl_total.font()
        font.setBold(True)
        font.setPointSize(11)
        self.lbl_total.setFont(font)
        for lbl in (self.lbl_parts, self.lbl_service, self.lbl_vat,
                    self.lbl_discount, self.lbl_total):
            lbl.setAlignment(Qt.AlignRight)
            root.addWidget(lbl)

        # Service cost / discount / VAT-on-service controls
        charges_form = QFormLayout()

        self.spin_service = QDoubleSpinBox()
        self.spin_service.setRange(0, 1_000_000)
        self.spin_service.setDecimals(2)
        self.spin_service.setPrefix("£ ")
        self.spin_service.setValue(0.00)

        self.chk_service_vat = QCheckBox("Apply 20% VAT to service cost")
        self.chk_service_vat.setChecked(False)  # default: VAT on parts only

        service_row = QHBoxLayout()
        service_row.addWidget(self.spin_service)
        service_row.addWidget(self.chk_service_vat)
        service_widget = QWidget()
        service_widget.setLayout(service_row)

        self.spin_discount = QDoubleSpinBox()
        self.spin_discount.setRange(0, 1_000_000)
        self.spin_discount.setDecimals(2)
        self.spin_discount.setPrefix("£ ")
        self.spin_discount.setValue(float(config.DEFAULT_DISCOUNT or 0))

        charges_form.addRow("Service cost:", service_widget)
        charges_form.addRow("Discount:", self.spin_discount)
        root.addLayout(charges_form)

        self.spin_service.valueChanged.connect(self._recalc)
        self.chk_service_vat.toggled.connect(self._recalc)
        self.spin_discount.valueChanged.connect(self._recalc)

        # Customer details
        form = QFormLayout()
        self.inp_name = QLineEdit()
        self.inp_name.setPlaceholderText("Customer name (required)")
        self.inp_phone = QLineEdit()
        self.inp_phone.setPlaceholderText("Phone number")
        self.inp_email = QLineEdit()
        self.inp_email.setPlaceholderText("customer@example.com")
        form.addRow("Customer Name:", self.inp_name)
        form.addRow("Phone:", self.inp_phone)
        form.addRow("Email:", self.inp_email)
        root.addLayout(form)

        btn = QPushButton("Save & Email")
        btn.setDefault(True)
        btn.clicked.connect(self._on_save)
# ------------------------------------------------------------------ math
    def _calc(self):
        """Return (subtotal, vat, discount, total, apply_service_vat)."""
        parts = round(self.parts_subtotal, 2)
        service = self.spin_service.value()
        apply_service_vat = self.chk_service_vat.isChecked()

        vat = round(parts * config.VAT_RATE, 2)
        if apply_service_vat:
            vat += round(service * config.VAT_RATE, 2)

        subtotal = round(parts + service, 2)
        discount = min(self.spin_discount.value(), subtotal + vat)
        total = round(subtotal + vat - discount, 2)
        return parts, service, vat, discount, total, apply_service_vat

    def _recalc(self):
        parts, service, vat, discount, total, _apply = self._calc()
        self.lbl_parts.setText(f"Parts Subtotal:   {config.money(parts)}")
        self.lbl_service.setText(f"Service Cost:     {config.money(service)}")
        self.lbl_vat.setText(f"VAT {int(config.VAT_RATE * 100)}%:   {config.money(vat)}")
        self.lbl_discount.setText(f"Discount:        -{config.money(discount)}")
        self.lbl_total.setText(f"TOTAL:   {config.money(total)}")

    # ------------------------------------------------------------------ save
    def _on_save(self):
        name = self.inp_name.text().strip()
        if not name:
            QMessageBox.warning(
                self, "Customer name required", "Please enter the customer's name."
            )
            return
        customer = {
            "name": name,
            "email": self.inp_email.text().strip(),
            "phone": self.inp_phone.text().strip(),
        }

        parts, service, vat, discount, total, apply_service_vat = self._calc()

        # Build the full line-item list: parts + (service if > 0)
        items = []
        for it in self.items:
            items.append({
                "part_number": it["part_number"],
                "designation": it.get("designation", ""),
                "quantity": it["quantity"],
                "unit_price": it["unit_price"],
                "line_total": it["line_total"],
                # per-line VAT for the parts subtotal
                "vat": round(round(it["line_total"], 2) * config.VAT_RATE, 2),
                "discount": discount,
                "price_retrieved_at": it.get("price_retrieved_at", ""),
            })
        if service > 0:
            items.append({
                "part_number": "SERVICE",
                "designation": "Service / labour",
                "quantity": 1,
                "unit_price": service,
                "line_total": service,
                "vat": round(service * config.VAT_RATE, 2) if apply_service_vat else 0.0,
                "discount": discount,
                "price_retrieved_at": datetime.datetime.now().isoformat(timespec="seconds"),
            })

        # 1) Persist permanently (with frozen Mercedes prices)
        try:
            record = db.save_invoice(
                customer, items, subtotal, vat,
                discount, total, config.CURRENCY_CODE,
            )
        except Exception as e:  # noqa: BLE001
            QMessageBox.critical(self, "Save failed", f"Could not save invoice:\n{e}")
            return
        invoice_number = int(record["invoice"]["invoice_number"])

        # 2) PDF + CSV (never skipped because email might fail)
        try:
            pdf_path = pdf.generate_invoice_pdf(record)
            csv_path = csv_export.export_invoice_csv(record)
        except Exception as e:  # noqa: BLE001
            QMessageBox.critical(
                self, "Save failed",
                f"Invoice INV-{invoice_number:06d} was saved to the database but "
                f"the PDF/CSV could not be generated:\n{e}",
            )
            self.done(1)
            return

        ok, err = emailer.send_invoice(customer["email"], pdf_path, invoice_number)

        if ok:
            QMessageBox.information(
                self, "Done",
                f"Invoice INV-{invoice_number:06d} saved, CSV exported, and emailed "
                f"to {customer.get('email')}.\n\nPDF: {pdf_path}\nCSV: {csv_path}",
            )
            self.done(1)
        else:
            # Never lose the invoice: DB + PDF + CSV already exist.
            mb = QMessageBox(self)
            mb.setIcon(QMessageBox.Warning)
            mb.setWindowTitle("Email failed")
            mb.setText(
                f"Invoice INV-{invoice_number:06d} was SAVED successfully.\n"
                f"PDF: {pdf_path}\nCSV: {csv_path}\n\nEmail FAILED: {err}"
            )
            mb.addButton("Retry Email", QMessageBox.AcceptRole)
            mb.addButton("Close", QMessageBox.RejectRole)
            if mb.exec() == 0:  # Retry
                ok2, err2 = emailer.send_invoice(
                    customer["email"], pdf_path, invoice_number
                )
                if ok2:
                    QMessageBox.information(
                        self, "Done",
                        f"Invoice INV-{invoice_number:06d} emailed to "
                        f"{customer.get('email')}.",
                    )
                else:
                    QMessageBox.warning(
                        self, "Email failed again",
                        f"Still failed: {err2}\n\nInvoice, PDF and CSV are safe on disk.",
                    )
            self.done(1)
        root.addWidget(btn)