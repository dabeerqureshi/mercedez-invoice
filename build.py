#!/usr/bin/env python3
"""
IQ Motors Invoice — unified build script (test + build + package).

Usage:
    python build.py              # run all stages: test -> build -> zip
    python build.py --test-only  # just the smoke test
    python build.py --build-only # just the PyInstaller build
    python build.py --zip-only   # just package the zip

Prerequisites (run once):
    setup.bat   (or setup.sh on macOS/Linux)

The script uses the project virtual environment (.venv) and the
mercedes_invoice.spec file to produce a ready-to-ship zip.
"""
import os
import sys
import shutil
import subprocess
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
if not os.path.exists(PY):
    PY = sys.executable  # fall back to the current interpreter

SPEC_FILE = os.path.join(ROOT, "mercedes_invoice.spec")
DIST_DIR = os.path.join(ROOT, "dist", "MercedesInvoice")
ZIP_PATH = os.path.join(ROOT, "IQMotorsInvoice-Release.zip")
README_FIRST = os.path.join(ROOT, "README-FIRST.txt")


def step(title):
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Stage 1 — TEST (import smoke test + offline mock pipeline)
# ---------------------------------------------------------------------------
def run_test():
    step("[1/3] TEST — import smoke test + mock pipeline")

    test_code = (
        "import mercedes_invoice\n"
        "from mercedes_invoice import config, db, csv_export, emailer, pdf\n"
        "from mercedes_invoice.connectors import make_source\n"
        "from mercedes_invoice.ui.main_window import MainWindow\n"
        "from mercedes_invoice.ui.checkout_dialog import CheckoutDialog\n"
        "print('All imports OK')\n"
        "\n"
        "# Quick offline pipeline test (no Mercedes login needed)\n"
        "db.init_db()\n"
        "src = make_source('mock')\n"
        "res = src.get_price('A0008280388')\n"
        "assert res.price > 0, 'mock price should be positive'\n"
        "src.close()\n"
        "print(f'Mock price lookup OK: {res.part_number} = {res.price} {res.currency}')\n"
    )

    rc = subprocess.call([PY, "-c", test_code])
    if rc != 0:
        sys.exit("TEST FAILED — see errors above.")
    print("Test passed.")


# ---------------------------------------------------------------------------
# Stage 2 — BUILD (PyInstaller with the spec)
# ---------------------------------------------------------------------------
def run_build():
    step("[2/3] BUILD — PyInstaller (mercedes_invoice.spec)")

    if not os.path.exists(SPEC_FILE):
        sys.exit(f"Spec file not found: {SPEC_FILE}")

    # Clean previous build artifacts so stale files don't sneak in.
    for d in (os.path.join(ROOT, "build"), os.path.join(ROOT, "dist")):
        if os.path.isdir(d):
            shutil.rmtree(d)

    rc = subprocess.call(
        [PY, "-m", "PyInstaller", "--noconfirm", "--clean", SPEC_FILE],
        cwd=ROOT,
    )
    if rc != 0:
        sys.exit("PyInstaller build FAILED — see errors above.")

    if not os.path.isdir(DIST_DIR):
        sys.exit(f"Build output not found: {DIST_DIR}")

    print("Build complete.")


# ---------------------------------------------------------------------------
# Stage 3 — ZIP (package the release)
# ---------------------------------------------------------------------------
def run_zip():
    step("[3/3] PACKAGE — creating release zip")

    if not os.path.isdir(DIST_DIR):
        sys.exit(f"Nothing to package — {DIST_DIR} does not exist. Run --build first.")

    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        # Walk the PyInstaller onedir output.
        for dirpath, _, files in os.walk(DIST_DIR):
            for f in files:
                fp = os.path.join(dirpath, f)
                arcname = os.path.relpath(fp, os.path.join(ROOT, "dist"))
                z.write(fp, arcname)

        # Include client-facing instructions.
        if os.path.exists(README_FIRST):
            z.write(README_FIRST, "README-FIRST.txt")

    size_mb = os.path.getsize(ZIP_PATH) / 1e6
    print(f"Zip created: {ZIP_PATH} ({size_mb:.1f} MB)")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    args = set(sys.argv[1:])
    do_test = not args or "--test-only" in args
    do_build = not args or "--build-only" in args
    do_zip = not args or "--zip-only" in args

    # When specific stages are requested, only run those.
    if {"--test-only", "--build-only", "--zip-only"} & args:
        do_test = "--test-only" in args
        do_build = "--build-only" in args
        do_zip = "--zip-only" in args

    if do_test:
        run_test()
    if do_build:
        run_build()
    if do_zip:
        run_zip()

    step("DONE")
    if do_zip and os.path.exists(ZIP_PATH):
        print(f"Release package: {ZIP_PATH}")
        print("To release to a client, send them the zip above.")
    elif do_zip:
        print("Zip packaging was requested but the file was not created.")
    else:
        print("Selected stages completed.")

if __name__ == "__main__":
    main()