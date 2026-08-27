#!/usr/bin/env bash
# One-time setup for macOS / Linux.
# Creates a virtual environment, installs all dependencies from
# requirements.txt (so no shell-quoting pitfalls with >=), and prints how
# to launch the app.
#
# IMPORTANT (macOS 26 / Qt compat): use a Homebrew Python 3.12+ so Qt's
# platform plugins load correctly. The Apple system Python 3.9 (from
# CommandLineTools) breaks PySide6's plugin discovery on new macOS.
#
# Usage:
#   bash setup.sh
set -e
cd "$(dirname "$0")"

# Prefer a modern Homebrew Python; fall back to whatever is in PATH.
if [ -x /opt/homebrew/bin/python3.12 ]; then
    PY=/opt/homebrew/bin/python3.12
    VENV=.venv312
elif [ -x /opt/homebrew/bin/python3.13 ]; then
    PY=/opt/homebrew/bin/python3.13
    VENV=.venv312
else
    PY="${PYTHON:-python3}"
    VENV=.venv
fi

if ! command -v "$PY" >/dev/null 2>&1; then
    echo "ERROR: '$PY' not found."
    echo "On macOS, install a modern Python first:  brew install python@3.12"
    exit 1
fi

echo "Using $PY -> virtual env: $VENV"

if [ ! -d "$VENV" ]; then
    echo "Creating virtual environment ($VENV)..."
    "$PY" -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "Upgrading pip..."
python -m pip install --upgrade pip

echo "Installing dependencies (PySide6 is large; needs a stable/fast internet)..."
python -m pip install -r requirements.txt

echo
echo "==========================================================="
echo " Setup complete!"
echo "-----------------------------------------------------------"
echo " To launch the app:"
echo "   source $VENV/bin/activate"
echo "   python -m mercedes_invoice.main"
echo
echo " Or verify the build (import + mock pipeline test):"
echo "   python build.py --test-only"
echo "==========================================================="
