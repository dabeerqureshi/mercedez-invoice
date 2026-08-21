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
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="MercedesInvoice",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
