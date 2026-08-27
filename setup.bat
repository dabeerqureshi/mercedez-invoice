@echo off
REM One-time setup for Windows.
REM Creates a virtual environment, installs all dependencies from
REM requirements.txt, and tells you how to launch the app.
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python not found. Install Python 3.9+ from python.org
    echo and tick "Add Python to PATH" during setup.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

echo Upgrading pip...
python -m pip install --upgrade pip

echo Installing dependencies (PySide6 is large; needs a stable/fast internet)...
python -m pip install -r requirements.txt

echo.
echo ===========================================================
echo  Setup complete!
echo -----------------------------------------------------------
echo  To launch the app:
echo    python -m mercedes_invoice.main
echo.
echo  Or verify the build (import + mock pipeline test):
echo    python build.py --test-only
echo ===========================================================
pause
