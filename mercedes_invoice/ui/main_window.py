"""PySide6 POS main window.

Flow: scan part -> price source lookup -> cart (auto-qty on duplicates)
    -> VIEW CART / CHECKOUT dialog (customer details) -> Save & Email
    -> SQLite + PDF + CSV saved, email attempted.
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from .. import config, db
from ..connectors import (
    LoginRequiredError,
    PartNotFoundError,
    make_source,
)
from .checkout_dialog import CheckoutDialog


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(config.APP_NAME)
        self.resize(760, 620)

        self.source = make_source(config.PRICE_SOURCE)
        # part_number -> dict(price, retrieved_at, currency)
        self.lookup_cache = {}

        self._build_ui()
        self._connect_signals()
        self._refresh_status()

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        central = QWidget()
        root = QVBoxLayout(central)

        # Scan field
        scan_row = QHBoxLayout()
        scan_row.addWidget(QLabel("Scan:"))
        self.scan_input = QLineEdit()
        self.scan_input.setPlaceholderText("Scan or type a part number, then press Enter")
        self.scan_input.setClearButtonEnabled(True)
        scan_row.addWidget(self.scan_input, 1)
        root.addLayout(scan_row)

        # Items table
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(
            ["Part Number", "Product", "Qty", "Unit Price", "Line Total"])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setColumnWidth(0, 220)
        self.table.setColumnWidth(1, 180)
        self.table.setColumnWidth(2, 60)
        self.table.setColumnWidth(3, 100)
        self.table.setColumnWidth(4, 110)
        root.addWidget(self.table, 1)

        # Summary
        self.lbl_subtotal = QLabel("Subtotal:   £0.00")
        self.lbl_vat = QLabel(f"VAT {int(config.VAT_RATE * 100)}%:   £0.00")
        self.lbl_discount = QLabel("Discount:   -£0.00")
        self.lbl_total = QLabel("TOTAL:   £0.00")
        self.lbl_subtotal.setAlignment(Qt.AlignRight)
        self.lbl_vat.setAlignment(Qt.AlignRight)
        self.lbl_discount.setAlignment(Qt.AlignRight)
        self.lbl_total.setAlignment(Qt.AlignRight)
        for lbl in (self.lbl_subtotal, self.lbl_vat, self.lbl_discount, self.lbl_total):
            root.addWidget(lbl)
        font = self.lbl_total.font()
        font.setBold(True)
        font.setPointSize(12)
        self.lbl_total.setFont(font)

        # Buttons
        btn_row = QHBoxLayout()
        self.btn_clear = QPushButton("CLEAR")
        self.btn_checkout = QPushButton("VIEW CART / CHECKOUT")
        self.btn_checkout.setDefault(True)
        btn_row.addWidget(self.btn_clear)
        btn_row.addStretch(1)
        btn_row.addWidget(self.btn_checkout)
        root.addLayout(btn_row)

        self.setCentralWidget(central)

        # Toolbar: manual Mercedes login for the mercedes source
        if self.source.name == "mercedes":
            tb = self.addToolBar("Mercedes")
            self.action_login = tb.addAction("Open Mercedes & Login")
            self.action_login.triggered.connect(self._on_login)

    def _connect_signals(self):
        self.scan_input.returnPressed.connect(self._on_scan)
        self.btn_clear.clicked.connect(self._clear_items)
        self.btn_checkout.clicked.connect(self._checkout)
        self.table.itemChanged.connect(self._on_table_item_changed)

    def _refresh_status(self):
        self.statusBar().showMessage(
            f"Price source: {self.source.name} - {self.source.status}"
        )

    # ------------------------------------------------------------------ scan
    def _on_scan(self):
        part = self.scan_input.text().strip()
        if not part:
            return
        try:
            price = self.source.get_price(part)
        except LoginRequiredError as e:
            self._try_open_login()
            QMessageBox.warning(
                self, "Mercedes login required",
                str(e) + "\n\nThe Mercedes login page has been opened. Sign in "
                "/ complete MFA there, then scan again.",
            )
            self.scan_input.clear()
            return
        except PartNotFoundError as e:
            QMessageBox.warning(
                self, "Part not found",
                "Mercedes returned no price for this part number.\n\n" + str(e),
            )
            self.scan_input.clear()
            return
        except NotImplementedError as e:
            QMessageBox.warning(
                self, "Price source not wired",
                "The current price source is not fully configured.\n\n" + str(e),
            )
            self.scan_input.clear()
            return
        except Exception as e:  # connectivity / other source errors
            QMessageBox.warning(
                self, "Mercedes unavailable",
                f"Cannot retrieve live price for {part}.\n\n"
                f"{e}\n\n"
                "If your Mercedes session expired, use 'Open Mercedes & Login' "
                "to log in again.",
            )
            self.scan_input.clear()
            return

        self.lookup_cache[part] = {
            "price": float(price.price),
            "retrieved_at": price.retrieved_at,
            "currency": price.currency,
            "name": price.designation or "",
        }

        row = self._find_row(part)
        if row is not None:
            # duplicate scan -> increment quantity
            spin = self.table.cellWidget(row, 2)
            spin.setValue(spin.value() + 1)
        else:
            self._add_row(part)

        self.scan_input.clear()
        self._recalc_totals()

    def _find_row(self, part):
        for r in range(self.table.rowCount()):
            if self.table.item(r, 0).text() == part:
                return r
        return None

    def _add_row(self, part):
        info = self.lookup_cache[part]
        r = self.table.rowCount()
        self.table.insertRow(r)
        self.table.setItem(r, 0, QTableWidgetItem(part))
        self.table.setItem(r, 1, QTableWidgetItem(info.get("name", "")))
        self.table.setItem(r, 3, QTableWidgetItem(config.money(info["price"])))
        self.table.setItem(r, 4, QTableWidgetItem(config.money(info["price"])))

        spin = QSpinBox()
        spin.setMinimum(1)
        spin.setMaximum(9999)
        spin.setValue(1)
        self.table.setCellWidget(r, 2, spin)
        spin.valueChanged.connect(lambda _v, rr=r: self._on_qty_changed(rr))

    def _on_qty_changed(self, row):
        self._refresh_line_total(row)
        self._recalc_totals()

    def _on_table_item_changed(self, item):
        # keep part-number/product columns non-editable; refresh on edits
        if item.column() in (0, 1):
            self.table.blockSignals(True)
            item.setFlags(item.flags() & ~Qt.ItemIsEditable)
            self.table.blockSignals(False)
        if item.column() == 4:
            self._recalc_totals()

    def _refresh_line_total(self, row):
        part = self.table.item(row, 0).text()
        info = self.lookup_cache.get(part)
        if info is None:
            return
        spin = self.table.cellWidget(row, 2)
        qty = spin.value() if spin else 1
        total = round(info["price"] * qty, 2)
        self.table.setItem(row, 4, QTableWidgetItem(config.money(total)))

    def _line_items(self):
        items = []
        for r in range(self.table.rowCount()):
            part = self.table.item(r, 0).text()
            spin = self.table.cellWidget(r, 2)
            qty = spin.value() if spin else 1
            info = self.lookup_cache.get(part)
            if info is None:
                continue
            unit = info["price"]
            line_total = round(unit * qty, 2)
            items.append({
                "part_number": part,
                "designation": info.get("name", ""),
                "quantity": qty,
                "unit_price": unit,
                "line_total": line_total,
                "vat": None,          # filled at save time below
                "discount": None,
                "price_retrieved_at": info["retrieved_at"],
            })
        return items

    def _recalc_totals(self):
        subtotal = 0.0
        for r in range(self.table.rowCount()):
            part = self.table.item(r, 0).text()
            info = self.lookup_cache.get(part)
            if info is None:
                continue
            spin = self.table.cellWidget(r, 2)
            qty = spin.value() if spin else 1
            subtotal += info["price"] * qty
        subtotal = round(subtotal, 2)
        vat = round(subtotal * config.VAT_RATE, 2)
        discount = round(config.DEFAULT_DISCOUNT, 2)
        total = round(subtotal + vat - discount, 2)

        self.lbl_subtotal.setText(f"Subtotal:   {config.money(subtotal)}")
        self.lbl_vat.setText(f"VAT {int(config.VAT_RATE * 100)}%:   {config.money(vat)}")
        self.lbl_discount.setText(f"Discount:   -{config.money(discount)}")
        self.lbl_total.setText(f"TOTAL:   {config.money(total)}")

    def _clear_items(self):
        self.lookup_cache.clear()
        self.table.setRowCount(0)
        self.scan_input.clear()
        self._recalc_totals()

    # ------------------------------------------------------------------ checkout
    def _checkout(self):
        if self.table.rowCount() == 0:
            QMessageBox.information(
                self, "Nothing to check out", "Scan at least one part first."
            )
            return
        items = self._line_items()
        parts_subtotal = round(sum(i["line_total"] for i in items), 2)
        dlg = CheckoutDialog(items, parts_subtotal, self)
        if dlg.exec() == 1:
            self._clear_items()
            self.scan_input.setFocus()

    def _try_open_login(self):
        opener = getattr(self.source, "open_login", None)
        if callable(opener):
            try:
                opener()
            except Exception:
                pass

    # ------------------------------------------------------------------ login
    def _on_login(self):
        try:
            self.source.open_login()
        except Exception as e:  # noqa: BLE001
            QMessageBox.warning(self, "Mercedes", f"Could not open browser:\n{e}")
        self._refresh_status()

    def closeEvent(self, event):
        try:
            self.source.close()
        except Exception:
            pass
        event.accept()


def run():
    db.init_db()
    import sys
    from PySide6.QtWidgets import QApplication
    app = QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())
