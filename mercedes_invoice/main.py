"""Mercedes Parts Invoice - entry point.

Run with:
    python -m mercedes_invoice.main
    python -m mercedes_invoice.main --selftest-gui   # opens window, auto-closes after 2s
"""
import sys


def run_selftest_gui():
    """GUI smoke test: open the main window, then auto-close after 2 s."""
    from PySide6.QtCore import QTimer
    from PySide6.QtWidgets import QApplication

    from mercedes_invoice import db
    from mercedes_invoice.ui.main_window import MainWindow

    db.init_db()
    app = QApplication(sys.argv)
    win = MainWindow()
    win.show()
    QTimer.singleShot(2000, app.quit)
    print("GUI smoke-test: window opened; closing in 2 seconds...")
    app.exec()
    print("GUI smoke-test OK")


if __name__ == "__main__":
    if "--selftest-gui" in sys.argv:
        run_selftest_gui()
    else:
        from mercedes_invoice.ui import run
        run()