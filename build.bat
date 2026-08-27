@echo off
REM IQ Motors Invoice — Windows build wrapper.
REM
REM Runs the unified build script (build.py) which:
REM   1. Tests (import smoke test + mock pipeline)
REM   2. Builds the .exe with PyInstaller using mercedes_invoice.spec
REM   3. Packages dist/ into IQMotorsInvoice-Release.zip
REM
REM Prerequisites (run once): setup.bat
REM   - Creates .venv with all dependencies
REM   - Downloads Playwright Chromium: .venv\Scripts\python -m playwright install chromium
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" build.py
if errorlevel 1 (
    echo.
    echo Build FAILED. Review the error output above.
    pause
    exit /b 1
)

pause
