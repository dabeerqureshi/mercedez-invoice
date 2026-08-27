# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Mercedes Parts Invoice app.

Build with:
    .venv\Scripts\python -m PyInstaller mercedes_invoice.spec

Produces a single-file, windowed MercedesInvoice.exe in dist/.

The Mercedes connector needs Playwright's bundled driver + Chromium on the
target machine; the driver data is collected here so the exe carries it.
"""
import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Bundle the whole mercedes_invoice package as data (so db.py paths &
# resources land next to the frozen app), plus ReportLab fonts and the
# IQ Motors logo used on every invoice.
datas = [("mercedes_invoice", "mercedes_invoice")]
datas += collect_data_files("reportlab")

# Playwright ships a node driver inside its package; include it so the
# connector can run from the frozen exe.
try:
    import playwright
    pdir = os.path.dirname(playwright.__file__)
    datas.append((os.path.join(pdir, "driver"), "playwright/driver"))
except Exception:
    pass

hiddenimports = collect_submodules("mercedes_invoice")
hiddenimports += [
    "mercedes_invoice.connectors.base",
    "mercedes_invoice.connectors.mock",
    "mercedes_invoice.connectors.mercedes",
    "mercedes_invoice.ui.main_window",
    "mercedes_invoice.ui.checkout_dialog",
    "reportlab",
]

a = Analysis(
    ["mercedes_invoice/main.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
        excludes=[
        # Heavy optional Qt submodules we never use — excluding them avoids the
        # memory blowup in PyInstaller's Gui hook that was crashing the build.
        "PySide6.QtQml",
        "PySide6.QtQuick",
        "PySide6.QtWebEngineWidgets",
        "PySide6.QtWebEngineCore",
        "PySide6.QtWebEngine",
        "PySide6.QtMultimedia",
        "PySide6.QtMultimediaWidgets",
        "PySide6.Qt3DInput",
        "PySide6.Qt3DRender",
        "PySide6.Qt3DExtras",
        "PySide6.Qt3DLogic",
        "PySide6.Qt3DAnimation",
        "PySide6.QtCharts",
        "PySide6.QtDataVisualization",
        "PySide6.QtTextToSpeech",
        "PySide6.QtPdf",
        "PySide6.QtPdfWidgets",
        "PySide6.QtHelp",
        "PySide6.QtSql",
        "PySide6.QtBluetooth",
        "PySide6.QtSensors",
        "PySide6.QtPositioning",
        "PySide6.QtLocation",
        "PySide6.QtNfc",
        "PySide6.QtSvg",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,      # onedir build: fast startup, AV-friendly
    icon="mercedes_invoice/assets/app.ico",
        # version info omitted (PyInstaller 6.x treats this as a .rc filename path,
    # not a string) — app version lives in config.APP_NAME and main.py title.
    name="MercedesInvoice",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                  # UPX triggers antivirus false positives
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="MercedesInvoice",
)
