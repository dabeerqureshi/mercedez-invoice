@echo off
REM Build a standalone Windows .exe with PyInstaller.
REM
REM Prerequisites (done once by setup.bat):
REM   - Python 3.9+ with PySide6, reportlab, playwright, pyinstaller installed
REM   - Playwright Chromium downloaded
REM       python -m playwright install chromium
REM
REM Run this from the project root. The output is:
REM   dist\MercedesInvoice.exe
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python not found. Run setup.bat first.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

echo Building MercedesInvoice.exe ...
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean ^
    --onefile --windowed ^
    --name MercedesInvoice ^
    --add-data "mercedes_invoice;mercedes_invoice" ^
    mercedes_invoice/main.py

if errorlevel 1 (
    echo.
    echo Build FAILED. Review the error output above.
    pause
    exit /b 1
)

echo.
echo ===========================================================
echo  Build complete: dist\MercedesInvoice.exe
echo -----------------------------------------------------------
echo  NOTE: The Mercedes connector also needs Playwright's
echo  Chromium on the target machine. See the README
echo  (Packaging section) for details.
echo ===========================================================
pause
