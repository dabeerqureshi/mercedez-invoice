"""Shared Qt stylesheet — a clean, professional, production look.

Applied at the window / dialog level (both the main POS window and the
checkout dialog) so the whole app shares one consistent, modern theme:
a light workspace, a dark brand header, white "card" panels, and a calm blue
accent for the primary actions.

Object-name hooks used by the UI code (documented so future widgets can reuse):

  Header:            QWidget#HeaderBar, QLabel#AppTitle, QLabel#AppSubtitle,
                     QPushButton#HeaderButton
  Panels/headings:   QWidget#Panel, QLabel#SectionTitle, QLabel#HintLabel,
                     QLabel#SummaryLabel, QLabel#TotalLabel
  Buttons:           QPushButton#PrimaryButton, QPushButton#DangerButton
"""

# --- Brand palette ---------------------------------------------------------
_COLOR_BG        = "#F4F6FA"   # window background
_COLOR_HEADER    = "#1E2B3C"   # brand header bar
_COLOR_PANEL     = "#FFFFFF"   # cards
_COLOR_BORDER    = "#D9DEE8"   # hairlines
_COLOR_INPUT_BG  = "#FFFFFF"
_COLOR_INPUT_BRD = "#C9D1DE"
_COLOR_TEXT      = "#1F2733"
_COLOR_MUTED     = "#5B6572"
_COLOR_ACCENT    = "#3366E6"   # primary actions
_COLOR_ACCENT_DK = "#264FD8"
_COLOR_DANGER    = "#C02626"

APP_STYLESHEET = (
"""
/* ---------- base ---------- */
QMainWindow, QDialog { background-color: %(BG)s; }
QWidget {
    font-family: "Segoe UI", "Segoe UI Variable", "Arial";
    font-size: 13px;
    color: %(TEXT)s;
}
QLabel { background: transparent; color: %(TEXT)s; }

/* ---------- brand header ---------- */
QWidget#HeaderBar { background-color: %(HEADER)s; }
QLabel#AppTitle { color: #FFFFFF; font-size: 19px; font-weight: 700; letter-spacing: 0.4px; }
QLabel#AppSubtitle { color: #AFC3E0; font-size: 12px; }

/* ---------- panels / headings ---------- */
QWidget#Panel {
    background-color: %(PANEL)s;
    border: 1px solid %(BORDER)s;
    border-radius: 10px;
}
QLabel#SectionTitle { font-size: 14px; font-weight: 600; color: %(TEXT)s; }
QLabel#HintLabel { color: %(MUTED)s; font-size: 12px; }
QLabel#SummaryLabel { color: %(MUTED)s; font-size: 14px; }
QLabel#TotalLabel { color: %(ACCENT_DK)s; font-size: 21px; font-weight: 700; }
/* ---------- line edits ---------- */
QLineEdit {
    background-color: %(INPUT_BG)s;
    border: 1px solid %(INPUT_BRD)s;
    border-radius: 6px;
    padding: 8px 12px;
    selection-background-color: %(ACCENT)s;
    selection-color: #FFFFFF;
}
QLineEdit:focus { border: 1px solid %(ACCENT)s; }
QLineEdit:disabled { background-color: #EEF1F6; color: #8A94A6; }

/* ---------- buttons ---------- */
QPushButton {
    background-color: %(PANEL)s;
    border: 1px solid %(INPUT_BRD)s;
    border-radius: 6px;
    padding: 9px 18px;
    font-weight: 600;
    color: %(TEXT)s;
}
QPushButton:hover { background-color: #F0F3FA; border-color: %(ACCENT)s; }
QPushButton:pressed { background-color: #E3E9F7; }
QPushButton:disabled { background-color: #EEF1F6; color: #9AA3B2; border-color: #DFE4EE; }
QPushButton#PrimaryButton {
    background-color: %(ACCENT)s;
    color: #FFFFFF;
    border: 1px solid %(ACCENT_DK)s;
}
QPushButton#PrimaryButton:hover { background-color: #406FF0; }
QPushButton#PrimaryButton:pressed { background-color: %(ACCENT_DK)s; }
QPushButton#DangerButton { color: %(DANGER)s; border: 1px solid #F0B9B9; }
QPushButton#DangerButton:hover { background-color: #FBEEEE; border-color: #DC2626; }
QPushButton#HeaderButton {
    color: #FFFFFF;
    background-color: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 6px;
}
QPushButton#HeaderButton:hover { background-color: rgba(255, 255, 255, 0.22); }

/* ---------- tables ---------- */
QTableWidget, QTableView {
    background-color: %(PANEL)s;
    alternate-background-color: #F7F9FC;
    gridline-color: #EDF0F5;
    border: 1px solid %(BORDER)s;
    border-radius: 8px;
    selection-background-color: #E4ECFF;
    selection-color: %(TEXT)s;
}
QHeaderView::section {
    background-color: #EDF1F8;
    color: #3A4453;
    padding: 9px 10px;
    border: none;
    border-bottom: 1px solid %(BORDER)s;
    font-weight: 600;
    font-size: 12.5px;
}
QTableCornerButton::section { background-color: #EDF1F8; border: none; }

/* ---------- spin boxes ---------- */
QSpinBox, QDoubleSpinBox {
    background-color: %(INPUT_BG)s;
    border: 1px solid %(INPUT_BRD)s;
    border-radius: 6px;
    padding: 4px 8px;
    min-height: 16px;
    selection-background-color: %(ACCENT)s;
}
QSpinBox:focus, QDoubleSpinBox:focus { border-color: %(ACCENT)s; }
QSpinBox::up-button, QDoubleSpinBox::up-button,
QSpinBox::down-button, QDoubleSpinBox::down-button {
    width: 16px; border: none; background: transparent;
}

/* ---------- checkbox ---------- */
QCheckBox { spacing: 7px; color: %(TEXT)s; }
QCheckBox::indicator {
    width: 16px; height: 16px;
    border: 1px solid %(INPUT_BRD)s;
    border-radius: 4px;
    background-color: %(PANEL)s;
}
QCheckBox::indicator:checked { background-color: %(ACCENT)s; border-color: %(ACCENT)s; }

/* ---------- status bar / toolbar ---------- */
QStatusBar {
    background-color: %(PANEL)s;
    border-top: 1px solid %(BORDER)s;
    color: %(MUTED)s;
}
QStatusBar::item { border: none; }
QToolBar { background-color: %(HEADER)s; border: none; spacing: 6px; padding: 4px; }
QToolButton { color: #FFFFFF; padding: 6px 12px; border-radius: 6px; }
QToolButton:hover { background-color: rgba(255, 255, 255, 0.15); }

/* ---------- message boxes ---------- */
QMessageBox { background-color: %(PANEL)s; }

"""
) % {
    "BG": _COLOR_BG, "HEADER": _COLOR_HEADER, "PANEL": _COLOR_PANEL,
    "BORDER": _COLOR_BORDER, "INPUT_BG": _COLOR_INPUT_BG,
    "INPUT_BRD": _COLOR_INPUT_BRD, "TEXT": _COLOR_TEXT,
    "MUTED": _COLOR_MUTED, "ACCENT": _COLOR_ACCENT,
    "ACCENT_DK": _COLOR_ACCENT_DK, "DANGER": _COLOR_DANGER,
}
