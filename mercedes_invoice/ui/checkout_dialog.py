"""Checkout dialog: cart + vehicle details + work lines + customer details.

IQ Motors invoice model:
    SUBTOTAL = parts total + sum(labour cost)
    VAT @20% = SUBTOTAL x 20%
    TOTAL    = SUBTOTAL + VAT

Work lines ("Description of Work") take a description (required) and labour
cost (required); Oper No. and Time are optional and left blank on the invoice.
Vehicle details (make/model/reg/mileage) are optional but default to a
Mercedes-Benz make.

Save flow: SQLite (DB) -> PDF -> CSV -> email. The invoice is always saved
to disk first, so an email failure never loses data (retry is offered).
"""
import datetime

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QDialog,
    QFormLayout,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
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
from .style import APP_STYLESHEET


def _fit_on_screen():
    """Return a (w, h) window size that always fits the current screen."""
    scr = QApplication.primaryScreen()
    if scr is None:
        return 900, 680
    g = scr.availableGeometry()
    return min(920, int(g.width() * 0.92)), min(680, int(g.height() * 0.90))


class CheckoutDialog(QDialog):
    def __init__(self, items, parts_subtotal, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Checkout")
        self.resize(*_fit_on_screen())
        self.setStyleSheet(APP_STYLESHEET)

        self.items = items              # parts line items
        self.parts_subtotal = parts_subtotal
        self._build_ui()
        self._recalc()

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 10)
        root.setSpacing(8)

        # ---- parts band -------------------------------------------------
        lbl_parts = QLabel("Parts")
        lbl_parts.setObjectName("SectionTitle")
        root.addWidget(lbl_parts)

        self.table = QTableWidget(len(self.items), 5)
        self.table.setHorizontalHeaderLabels(
            ["Part Number", "Product", "Qty", "Unit Price", "Line Total"])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setEditTriggers(
            QAbstractItemView.DoubleClicked | QAbstractItemView.SelectedClicked
            | QAbstractItemView.EditKeyPressed)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(28)
        for r, it in enumerate(self.items):
            self.table.setItem(r, 0, QTableWidgetItem(it["part_number"]))
            self.table.setItem(r, 1, QTableWidgetItem(it.get("designation") or ""))
            self.table.setItem(r, 2, QTableWidgetItem(str(it["quantity"])))
            # Unit Price is stored as a raw number so the user can edit it.
            self.table.setItem(r, 3, QTableWidgetItem(str(it["unit_price"])))
            self.table.setItem(r, 4, QTableWidgetItem(config.money(it["line_total"])))
            # Only the Unit Price column (3) is editable; the rest stay locked.
            for c in range(5):
                self._set_editable(r, c, c == 3)
        self.table.itemChanged.connect(self._on_parts_item_changed)
        self.table.resizeColumnsToContents()
        self.table.setFixedHeight(min(140, 46 + max(len(self.items), 1) * 28))
        root.addWidget(self.table)

        # ---- vehicle band: one horizontal row ----------------------------
        veh = QWidget()
        veh.setObjectName("Panel")
        vh = QHBoxLayout(veh)
        vh.setContentsMargins(10, 8, 10, 8)
        vh.setSpacing(6)
        for label, attr, default, maxlen in (
                ("Make:", "inp_make", config.DEFAULT_VEHICLE_MAKE, None),
                ("Model:", "inp_model", "", None),
                ("Reg:", "inp_reg", "", 12),
                ("Mileage:", "inp_mileage", "", None)):
            vh.addWidget(QLabel(label))
            edit = QLineEdit(default)
            edit.setMinimumHeight(26)
            if maxlen:
                edit.setMaxLength(maxlen)
            setattr(self, attr, edit)
            vh.addWidget(edit, 1 if attr in ("inp_make", "inp_model") else 0)
        root.addWidget(veh)
        # ---- description of work band ------------------------------------
        wl = QHBoxLayout()
        wl.setSpacing(8)
        lbl_work = QLabel("Description of work")
        lbl_work.setObjectName("SectionTitle")
        wl.addWidget(lbl_work)
        wl.addStretch(1)
        self.btn_add_work = QPushButton("Add work line")
        self.btn_add_work.setCursor(Qt.PointingHandCursor)
        self.btn_add_work.clicked.connect(self._add_work_row)
        self.btn_del_work = QPushButton("Remove selected")
        self.btn_del_work.setObjectName("DangerButton")
        self.btn_del_work.setCursor(Qt.PointingHandCursor)
        self.btn_del_work.clicked.connect(self._remove_work_row)
        wl.addWidget(self.btn_add_work)
        wl.addWidget(self.btn_del_work)
        root.addLayout(wl)

        self.work = QTableWidget(1, 4)
        self.work.setHorizontalHeaderLabels(
            ["Description", "Oper No.", "Time", "Labour Cost"])
        self.work.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.work.setColumnWidth(1, 90)
        self.work.setColumnWidth(2, 70)
        self.work.setColumnWidth(3, 110)
        self.work.setAlternatingRowColors(True)
        self.work.verticalHeader().setVisible(False)
        self.work.verticalHeader().setDefaultSectionSize(28)
        self.work.setFixedHeight(25 + 28 * 3)
        self.work.setItem(0, 3, QTableWidgetItem("0.00"))
        self.work.itemChanged.connect(lambda _i: self._recalc())
        root.addWidget(self.work)

        # ---- bottom band: customer (left) + totals (right) ----------------
        bottom = QHBoxLayout()
        bottom.setSpacing(12)

        cust_panel = QWidget()
        cust_panel.setObjectName("Panel")
        cg = QGridLayout(cust_panel)
        cg.setContentsMargins(10, 8, 10, 8)
        cg.setHorizontalSpacing(8)
        cg.setVerticalSpacing(6)
        self.inp_name = QLineEdit()
        self.inp_name.setPlaceholderText("Customer name (required)")
        self.inp_phone = QLineEdit()
        self.inp_phone.setPlaceholderText("Phone")
        self.inp_email = QLineEdit()
        self.inp_email.setPlaceholderText("Email")
        for e in (self.inp_name, self.inp_phone, self.inp_email):
            e.setMinimumHeight(26)
        cg.addWidget(QLabel("Name:"), 0, 0)
        cg.addWidget(self.inp_name, 0, 1)
        cg.addWidget(QLabel("Phone:"), 0, 2)
        cg.addWidget(self.inp_phone, 0, 3)
        cg.addWidget(QLabel("Email:"), 1, 0)
        cg.addWidget(self.inp_email, 1, 1, 1, 3)
        bottom.addWidget(cust_panel, 1)

        tot_panel = QWidget()
        tot_panel.setObjectName("Panel")
        tv = QVBoxLayout(tot_panel)
        tv.setContentsMargins(10, 6, 10, 6)
        tv.setSpacing(1)
        self.lbl_parts = QLabel()
        self.lbl_labour = QLabel()
        self.lbl_subtotal = QLabel()
        self.lbl_vat = QLabel()
        self.lbl_total = QLabel()
        self.lbl_total.setObjectName("TotalLabel")
        for lbl in (self.lbl_parts, self.lbl_labour, self.lbl_subtotal,
                    self.lbl_vat, self.lbl_total):
            lbl.setAlignment(Qt.AlignRight)
            tv.addWidget(lbl)
        bottom.addWidget(tot_panel)
        root.addLayout(bottom)

        # ---- buttons ------------------------------------------------------
        btn_row = QHBoxLayout()
        btn_row.setSpacing(8)
        btn_row.addStretch(1)
        self.btn_cancel = QPushButton("Cancel")
        self.btn_cancel.clicked.connect(self.reject)
        self.btn_save = QPushButton("Save & Email Invoice")
        self.btn_save.setObjectName("PrimaryButton")
        self.btn_save.setDefault(True)
        self.btn_save.clicked.connect(self._on_save)
        self.btn_cancel.setCursor(Qt.PointingHandCursor)
        self.btn_save.setCursor(Qt.PointingHandCursor)
        self.btn_save.setMinimumHeight(34)
        btn_row.addWidget(self.btn_cancel)
        btn_row.addWidget(self.btn_save)
        root.addLayout(btn_row)

    # ------------------------------------------------------- work rows
    def _add_work_row(self):
        r = self.work.rowCount()
        self.work.insertRow(r)
        self.work.setItem(r, 3, QTableWidgetItem("0.00"))

    def _remove_work_row(self):
        rows = sorted({i.row() for i in self.work.selectedIndexes()}, reverse=True)
        for r in rows:
            if self.work.rowCount() > 1:
                self.work.removeRow(r)

    def _collect_work_items(self):
        """Read the work table -> list of dicts (blank descriptions skipped)."""
        out = []
        for r in range(self.work.rowCount()):
            def cell(row, col):
                it = self.work.item(row, col)
                return (it.text().strip() if it is not None else "")
            desc = cell(r, 0)
            if not desc:
                continue
            try:
                cost = round(float(cell(r, 3) or 0), 2)
            except ValueError:
                cost = 0.0
            out.append({
                "description": desc,
                "oper_no": cell(r, 1),
                "time_hours": cell(r, 2),
                "labour_cost": cost,
            })
        return out

    # ------------------------------------------------------------ parts rows
    def _set_editable(self, r, c, editable):
        """Enable/disable editing on a single table cell (by row, column)."""
        item = self.table.item(r, c)
        if item is None:
            return
        flags = item.flags()
        if editable:
            item.setFlags(flags | Qt.ItemIsEditable)
        else:
            item.setFlags(flags & ~Qt.ItemIsEditable)

    def _parse_price(self, text):
        """Return (numeric, is_number). Text/non-numeric -> (0.0, False).

        Tolerates thousands separators (1,000) and a leading currency symbol
        (£50) while still treating any other non-numeric text as skipped.
        """
        raw = str(text).strip()
        if raw.startswith(config.CURRENCY):
            raw = raw[len(config.CURRENCY):]
        raw = raw.replace(",", "")
        try:
            return float(raw), True
        except ValueError:
            return 0.0, False

    def _read_parts_rows(self):
        """Read the parts table into line-item dicts.

        The Unit Price cell is user-editable: if it holds a number it is used
        for the line total; anything else (text, blank) is treated as £0 and
        skipped from the calculation.
        """
        out = []
        for r in range(self.table.rowCount()):
            def cell(row, col):
                it = self.table.item(row, col)
                return (it.text() if it is not None else "")
            part_number = cell(r, 0)
            if not part_number:
                continue
            try:
                qty = float(cell(r, 2) or 1)
            except ValueError:
                qty = 1.0
            unit, is_number = self._parse_price(cell(r, 3))
            line_total = round(unit * qty, 2) if is_number else 0.0
            out.append({
                "part_number": part_number,
                "designation": cell(r, 1),
                "quantity": qty,
                "unit_price": unit,
                "line_total": line_total,
            })
        return out

    def _on_parts_item_changed(self, item):
        """A Unit Price edit updates that row's Line Total and the totals."""
        col = item.column()
        if col == 3:
            r = item.row()
            unit, is_number = self._parse_price(item.text())
            qty = 1.0
            qit = self.table.item(r, 2)
            if qit is not None:
                try:
                    qty = float(qit.text())
                except ValueError:
                    qty = 1.0
            line_total = round(unit * qty, 2) if is_number else 0.0
            self.table.blockSignals(True)
            self.table.setItem(r, 4, QTableWidgetItem(config.money(line_total)))
            self.table.blockSignals(False)
        self._recalc()

    # ------------------------------------------------------------------ math
    def _calc(self):
        """Return (parts, labour, subtotal, vat, total)."""
        rows = self._read_parts_rows()
        parts = round(sum(r["line_total"] for r in rows), 2)
        labour = round(sum(w["labour_cost"] for w in self._collect_work_items()), 2)
        subtotal = round(parts + labour, 2)
        vat = round(subtotal * config.VAT_RATE, 2)
        total = round(subtotal + vat, 2)
        return parts, labour, subtotal, vat, total

    def _recalc(self):
        parts, labour, subtotal, vat, total = self._calc()
        self.lbl_parts.setText(f"Parts:   {config.money(parts)}")
        self.lbl_labour.setText(f"Labour:   {config.money(labour)}")
        self.lbl_subtotal.setText(f"SUBTOTAL:   {config.money(subtotal)}")
        self.lbl_vat.setText(
            f"VAT @ {int(config.VAT_RATE * 100)}%:   {config.money(vat)}")
        self.lbl_total.setText(f"TOTAL:   {config.money(total)}")

    # ------------------------------------------------------------------ save
    def _on_save(self):
        name = self.inp_name.text().strip()
        if not name:
            QMessageBox.warning(
                self, "Customer name required", "Please enter the customer's name.")
            return
        customer = {
            "name": name,
            "email": self.inp_email.text().strip(),
            "phone": self.inp_phone.text().strip(),
        }
        vehicle = {
            "make": self.inp_make.text().strip(),
            "model": self.inp_model.text().strip(),
            "reg_no": self.inp_reg.text().strip().upper(),
            "mileage": self.inp_mileage.text().strip(),
        }
        work_items = self._collect_work_items()

        _parts, _labour, subtotal, vat, total = self._calc()
        retrieved_by = {
            it["part_number"]: it.get("price_retrieved_at", "")
            for it in self.items
        }
        items = []
        for row in self._read_parts_rows():
            items.append({
                "part_number": row["part_number"],
                "designation": row["designation"],
                "quantity": row["quantity"],
                "unit_price": row["unit_price"],
                "line_total": row["line_total"],
                "vat": round(round(row["line_total"], 2) * config.VAT_RATE, 2),
                "discount": 0.0,
                "price_retrieved_at": retrieved_by.get(row["part_number"], ""),
            })

        try:
            record = db.save_invoice(
                customer, items, subtotal, vat, 0.0, total,
                config.CURRENCY_CODE, vehicle=vehicle, work_items=work_items,
            )
        except Exception as e:  # noqa: BLE001
            QMessageBox.critical(self, "Save failed", f"Could not save invoice:\n{e}")
            return
        invoice_number = int(record["invoice"]["invoice_number"])

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
            return

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
                customer["email"], pdf_path, invoice_number)
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

