"""PySide6 POS main window.

Flow: scan part -> price source lookup -> cart (auto-qty on duplicates)
    -> VIEW CART / CHECKOUT dialog (customer details) -> Save & Email
    -> SQLite + PDF + CSV saved, email attempted.

All price-source work (Mercedes browser launch, navigation, lookups) runs on
a dedicated background QThread so a slow page load or price lookup never
freezes the window.
"""
import queue
import re
import time

from PySide6.QtCore import QEvent, Qt, QThread, QTimer, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QGridLayout,
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
from ..connectors.mercedes import normalize_part
from .checkout_dialog import CheckoutDialog
from .style import APP_STYLESHEET


class PriceWorker(QThread):
    """Owns the price source and runs every lookup on a background thread.

    The price source is created *inside* ``run()`` (worker thread) because
    Playwright contexts are thread-affine. Jobs are submitted via the queue
    and results are delivered back to the GUI thread through queued signals.
    """

    price_found = Signal(str, float, str, str, str)  # part, price, name, currency, retrieved_at
    part_not_found = Signal(str, str)                # part, message
    login_required = Signal(str, str)                # part, message
    error = Signal(str, str)                         # part, message
    status_changed = Signal(str)                     # status-bar text

    def __init__(self, parent=None):
        super().__init__(parent)
        self._queue = queue.Queue()
        self._stop = False
        self.source = None
        self._last_activity = 0.0  # monotonic ts of the last live lookup

    # -- public API (called from the GUI thread) -------------------------
    def enqueue(self, job):
        self._queue.put(job)

    def shutdown(self, timeout_ms=8000):
        self._stop = True
        self._queue.put(None)
        self.wait(timeout_ms)

    # -- worker thread ---------------------------------------------------
    def run(self):
        self.source = make_source(config.PRICE_SOURCE)
        try:
            if self.source.name == "mercedes":
                try:
                    self._do_auto_connect()
                except Exception:  # surfaced on the next lookup
                    self._emit_status()
            while not self._stop:
                try:
                    job = self._queue.get(timeout=0.5)
                except queue.Empty:
                    continue
                if job is None:
                    break
                kind = job.get("kind")
                if kind == "lookup":
                    self._do_lookup(job.get("part", ""))
                elif kind == "login":
                    self._do_login()
                elif kind == "keep_alive":
                    self._do_keep_alive()
                elif kind == "auto_connect":
                    self._do_auto_connect()
        finally:
            try:
                if self.source is not None:
                    self.source.close()
            except Exception:
                pass
            self.source = None

    def _do_lookup(self, part):
        if not part:
            return
        self._last_activity = time.monotonic()
        try:
            res = self.source.get_price(part)
        except LoginRequiredError as e:
            self.login_required.emit(part, str(e))
            return
        except PartNotFoundError as e:
            self.part_not_found.emit(part, str(e))
            return
        except NotImplementedError as e:  # source not wired up
            self.error.emit(part, str(e))
            return
        except Exception as e:  # connectivity / other source errors
            self.error.emit(part, str(e))
            return
        self.price_found.emit(
            res.part_number,
            float(res.price),
            res.designation or "",
            res.currency or "GBP",
            res.retrieved_at,
        )

    def _do_auto_connect(self):
        try:
            self.source.auto_connect()
        except Exception:
            pass
        self._emit_status()

    def _do_login(self):
        try:
            self.source.open_login()
        except Exception as e:  # noqa: BLE001
            self.error.emit("", str(e))
        self._emit_status()

    def _do_keep_alive(self):
        """Quietly keep the Mercedes session alive between scans.

        A recent lookup already proves activity, so we only touch the page when
        the app has been idle — that is precisely when Mercedes' idle-timeout
        would otherwise log you out.
        """
        try:
            if config.MERCEDES_KEEP_ALIVE_S <= 0:
                return
            if time.monotonic() - self._last_activity < config.MERCEDES_KEEP_ALIVE_S:
                return
            if self.source is not None:
                self.source.keep_alive()
        except Exception:
            pass

    def _emit_status(self):
        try:
            self.status_changed.emit(
                f"Price source: {self.source.name} - {self.source.status}"
            )
        except Exception:
            pass


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(config.APP_NAME)
        self.resize(980, 720)
        self.setStyleSheet(APP_STYLESHEET)

        # part_number -> dict(price, name, currency, retrieved_at)
        self.lookup_cache = {}

        self._build_ui()
        self._connect_signals()
        self._start_worker()

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        central = QWidget()
        central.setObjectName("AppBackground")
        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ---- brand header --------------------------------------------------
        header = QWidget()
        header.setObjectName("HeaderBar")
        hl = QHBoxLayout(header)
        hl.setContentsMargins(24, 14, 24, 14)
        hl.setSpacing(12)

        title_box = QVBoxLayout()
        title_box.setSpacing(2)
        lbl_title = QLabel(config.APP_NAME)
        lbl_title.setObjectName("AppTitle")
        lbl_sub = QLabel("Point-of-Sale · Live Pricing & Invoicing")
        lbl_sub.setObjectName("AppSubtitle")
        title_box.addWidget(lbl_title)
        title_box.addWidget(lbl_sub)
        hl.addLayout(title_box)
        hl.addStretch(1)

        if config.PRICE_SOURCE == "mercedes":
            self.btn_login = QPushButton("Open Mercedes & Login")
            self.btn_login.setObjectName("HeaderButton")
            self.btn_login.setCursor(Qt.PointingHandCursor)
            self.btn_login.clicked.connect(self._on_login)
            hl.addWidget(self.btn_login)
        root.addWidget(header)

        # ---- body ----------------------------------------------------------
        body = QWidget()
        body_layout = QVBoxLayout(body)
        body_layout.setContentsMargins(24, 20, 24, 20)
        body_layout.setSpacing(16)
        root.addWidget(body, 1)

        # Scan card
        scan_panel = QWidget()
        scan_panel.setObjectName("Panel")
        scan_l = QVBoxLayout(scan_panel)
        scan_l.setContentsMargins(18, 16, 18, 16)
        scan_l.setSpacing(8)

        lbl_scan = QLabel("Scan parts")
        lbl_scan.setObjectName("SectionTitle")
        scan_l.addWidget(lbl_scan)

        self.scan_input = QLineEdit()
        self.scan_input.setPlaceholderText(
            "Scan or type part numbers (comma / semicolon / newline separated), then press Enter")
        self.scan_input.setClearButtonEnabled(True)
        self.scan_input.setMinimumHeight(42)
        scan_l.addWidget(self.scan_input)

        lbl_hint = QLabel(
            "Separate multiple parts with a comma, semicolon or newline. "
            "Scanning a part already in the basket increases its quantity "
            "automatically.")
        lbl_hint.setObjectName("HintLabel")
        lbl_hint.setWordWrap(True)
        scan_l.addWidget(lbl_hint)
        body_layout.addWidget(scan_panel)

        # Items table
        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(
            ["Part Number", "Product", "Qty", "Unit Price", "Line Total"])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setColumnWidth(0, 220)
        self.table.setColumnWidth(1, 220)
        self.table.setColumnWidth(2, 70)
        self.table.setColumnWidth(3, 110)
        self.table.setColumnWidth(4, 120)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(40)
        # Let the window see Delete/Backspace keys while the table has focus
        self.table.installEventFilter(self)
        body_layout.addWidget(self.table, 1)

        # Summary + buttons card
        bottom_panel = QWidget()
        bottom_panel.setObjectName("Panel")
        bottom_l = QVBoxLayout(bottom_panel)
        bottom_l.setContentsMargins(18, 14, 18, 14)
        bottom_l.setSpacing(12)

        summary = QGridLayout()
        summary.setHorizontalSpacing(24)
        summary.setVerticalSpacing(4)
        summary.setColumnStretch(0, 1)  # push labels/values right
        self.lbl_subtotal = QLabel("Subtotal")
        self.lbl_vat = QLabel(f"VAT {int(config.VAT_RATE * 100)}%")
        self.lbl_discount = QLabel("Discount")
        for lbl in (self.lbl_subtotal, self.lbl_vat, self.lbl_discount):
            lbl.setObjectName("SummaryLabel")
            lbl.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.val_subtotal = QLabel(config.money(0.0))
        self.val_vat = QLabel(config.money(0.0))
        self.val_discount = QLabel("-" + config.money(0.0))
        for lbl in (self.val_subtotal, self.val_vat, self.val_discount):
            lbl.setObjectName("SummaryLabel")
            lbl.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.lbl_total = QLabel("TOTAL")
        self.lbl_total.setObjectName("TotalLabel")
        self.lbl_total.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.val_total = QLabel(config.money(0.0))
        self.val_total.setObjectName("TotalLabel")
        self.val_total.setAlignment(Qt.AlignRight | Qt.AlignVCenter)

        summary.addWidget(self.lbl_subtotal, 0, 1)
        summary.addWidget(self.val_subtotal, 0, 2)
        summary.addWidget(self.lbl_vat, 1, 1)
        summary.addWidget(self.val_vat, 1, 2)
        summary.addWidget(self.lbl_discount, 2, 1)
        summary.addWidget(self.val_discount, 2, 2)
        summary.addWidget(self.lbl_total, 3, 1)
        summary.addWidget(self.val_total, 3, 2)
        bottom_l.addLayout(summary)

        # Buttons
        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)
        self.btn_clear = QPushButton("Clear")
        self.btn_clear.setObjectName("DangerButton")
        self.btn_remove = QPushButton("Remove Selected")
        self.btn_remove.setObjectName("DangerButton")
        self.btn_checkout = QPushButton("View Cart & Checkout")
        self.btn_checkout.setObjectName("PrimaryButton")
        self.btn_checkout.setDefault(True)
        for b in (self.btn_clear, self.btn_remove, self.btn_checkout):
            b.setCursor(Qt.PointingHandCursor)
        btn_row.addWidget(self.btn_clear)
        btn_row.addWidget(self.btn_remove)
        btn_row.addStretch(1)
        btn_row.addWidget(self.btn_checkout)
        bottom_l.addLayout(btn_row)

        body_layout.addWidget(bottom_panel)
        self.setCentralWidget(central)

    def _connect_signals(self):
        self.scan_input.returnPressed.connect(self._on_scan)
        self.btn_clear.clicked.connect(self._clear_items)
        self.btn_remove.clicked.connect(self._remove_selected)
        self.btn_checkout.clicked.connect(self._checkout)
        self.table.itemChanged.connect(self._on_table_item_changed)

    def _start_worker(self):
        self.worker = PriceWorker(self)
        self.worker.price_found.connect(self._on_price_found)
        self.worker.part_not_found.connect(self._on_part_not_found)
        self.worker.login_required.connect(self._on_login_required)
        self.worker.error.connect(self._on_lookup_error)
        self.worker.status_changed.connect(self.statusBar().showMessage)
        self.worker.start()
        if config.PRICE_SOURCE == "mercedes":
            self.statusBar().showMessage("Connecting to Mercedes...")
            self.worker.enqueue({"kind": "auto_connect"})
            if config.MERCEDES_KEEP_ALIVE_S > 0:
                self._keepalive_timer = QTimer(self)
                self._keepalive_timer.setInterval(config.MERCEDES_KEEP_ALIVE_S * 1000)
                self._keepalive_timer.timeout.connect(self._on_keep_alive)
                self._keepalive_timer.start()
        else:
            self.statusBar().showMessage(
                f"Price source: {config.PRICE_SOURCE} - starting...")

    def _on_keep_alive(self):
        """Timer tick -> ask the worker to keep the Mercedes session alive."""
        try:
            if self.worker is not None and self.worker.isRunning():
                self.worker.enqueue({"kind": "keep_alive"})
        except Exception:
            pass


    # ------------------------------------------------------------------ scan
    def _parse_parts(self, raw):
        """Split a batch of part numbers on commas / semicolons / newlines.

        We deliberately do NOT split on spaces: Mercedes part numbers like
        'A 000 828 03 88' legitimately contain spaces, so those stay inside one
        part. This preserves existing barcode-gun behaviour ('PART<Enter>') and
        typed single parts, while also allowing you to paste several numbers at
        once, e.g.:  A0008280388, A0008300286, A0012300917  (or newline-separated).
        """
        out = []
        for chunk in re.split(r"[,;\r\n]+", raw or ""):
            canon = normalize_part(chunk)
            if canon:
                out.append(canon)
        return out

    def _on_scan(self):
        raw = self.scan_input.text().strip()
        if not raw:
            return
        parts = self._parse_parts(raw)
        if not parts:
            self.scan_input.clear()
            return
        # Every part is looked up live on the background worker (one Mercedes
        # visit each); the UI stays responsive throughout.
        for part in parts:
            self.worker.enqueue({"kind": "lookup", "part": part})

    def _on_price_found(self, part, price, name, currency, retrieved_at):
        self.lookup_cache[part] = {
            "price": float(price),
            "name": name,
            "currency": currency,
            "retrieved_at": retrieved_at,
        }
        row = self._find_row(part)
        if row is not None:
            # duplicate scan -> increment quantity
            spin = self.table.cellWidget(row, 2)
            if spin is not None:
                spin.setValue(spin.value() + 1)
        else:
            self._add_row(part)
        self.scan_input.clear()
        self._recalc_totals()

    def _on_part_not_found(self, part, message):
        QMessageBox.warning(
            self, "Part not found",
            "Mercedes returned no price for this part number.\n\n" + message,
        )
        self.scan_input.clear()

    def _on_login_required(self, part, message):
        # Open the login page for the user (background thread) and tell them.
        self.worker.enqueue({"kind": "login"})
        QMessageBox.warning(
            self, "Mercedes login required",
            message + "\n\nThe Mercedes login page has been opened. Sign in "
            "/ complete MFA there, then scan again.",
        )
        self.scan_input.clear()

    def _on_lookup_error(self, part, message):
        QMessageBox.warning(
            self, "Mercedes unavailable",
            f"Cannot retrieve live price for {part or 'the part'}.\n\n{message}\n\n"
            "If your Mercedes session expired, use 'Open Mercedes & Login' "
            "to log in again.",
        )
        self.scan_input.clear()

    # ------------------------------------------------------------------ table
    def _find_row(self, part):
        for r in range(self.table.rowCount()):
            item = self.table.item(r, 0)
            if item is not None and item.text() == part:
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

    def _remove_selected(self):
        rows = sorted({idx.row() for idx in self.table.selectedIndexes()},
                      reverse=True)
        if not rows:
            return
        for r in rows:
            item = self.table.item(r, 0)
            if item is not None:
                self.lookup_cache.pop(item.text(), None)
            self.table.removeRow(r)
        self._recalc_totals()

    def _on_qty_changed(self, row):
        self._refresh_line_total(row)
        self._recalc_totals()

    def _on_table_item_changed(self, item):
        # keep part-number/product columns non-editable
        if item.column() in (0, 1):
            self.table.blockSignals(True)
            item.setFlags(item.flags() & ~Qt.ItemIsEditable)
            self.table.blockSignals(False)
        if item.column() == 4:
            self._recalc_totals()

    def _refresh_line_total(self, row):
        item = self.table.item(row, 0)
        if item is None:
            return
        info = self.lookup_cache.get(item.text())
        if info is None:
            return
        spin = self.table.cellWidget(row, 2)
        qty = spin.value() if spin else 1
        total = round(info["price"] * qty, 2)
        self.table.setItem(row, 4, QTableWidgetItem(config.money(total)))

    def _line_items(self):
        items = []
        for r in range(self.table.rowCount()):
            item = self.table.item(r, 0)
            if item is None:
                continue
            part = item.text()
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
            item = self.table.item(r, 0)
            if item is None:
                continue
            info = self.lookup_cache.get(item.text())
            if info is None:
                continue
            spin = self.table.cellWidget(r, 2)
            qty = spin.value() if spin else 1
            subtotal += info["price"] * qty
        subtotal = round(subtotal, 2)
        vat = round(subtotal * config.VAT_RATE, 2)
        discount = round(config.DEFAULT_DISCOUNT, 2)
        total = round(subtotal + vat - discount, 2)

        self.val_subtotal.setText(config.money(subtotal))
        self.val_vat.setText(config.money(vat))
        self.val_discount.setText("-" + config.money(discount))
        self.val_total.setText(config.money(total))

    def _clear_items(self):
        self.lookup_cache.clear()
        self.table.setRowCount(0)
        self.scan_input.clear()
        self._recalc_totals()

    # ------------------------------------------------------------------ keyboard
    def eventFilter(self, obj, event):
        if obj is self.table and event.type() == QEvent.KeyPress:
            if event.key() in (Qt.Key_Delete, Qt.Key_Backspace):
                self._remove_selected()
                return True
        return super().eventFilter(obj, event)

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

    # ------------------------------------------------------------------ login
    def _on_login(self):
        self.worker.enqueue({"kind": "login"})

    def closeEvent(self, event):
        try:
            if getattr(self, "_keepalive_timer", None) is not None:
                self._keepalive_timer.stop()
        except Exception:
            pass
        try:
            self.worker.shutdown()
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

