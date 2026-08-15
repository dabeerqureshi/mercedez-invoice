"""SMTP email sender with PDF attachment.

The invoice is always saved to disk first; email failure never loses data.
Returns (ok, error_message).
"""
import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from . import config


def is_configured() -> bool:
    return bool(config.SMTP_HOST and config.SMTP_USER and config.SMTP_PASSWORD)


def send_invoice(to_email, pdf_path, invoice_number, retries=1):
    """Send the PDF invoice by email.

    Returns (True, "") on success, (False, error_message) on failure.
    """
    if not is_configured():
        return False, ("SMTP is not configured. Set MERCEDES_SMTP_HOST / "
                       "_USER / _PASSWORD (export them) and try again.")

    if not to_email or "@" not in to_email:
        return False, "No valid customer email address."

    msg = MIMEMultipart()
    msg["From"] = config.SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = f"Invoice INV-{invoice_number:06d}"
    body = (
        f"Dear customer,\n\n"
        f"Please find attached your invoice INV-{invoice_number:06d}.\n\n"
        f"Thank you for your business.\n{config.COMPANY_NAME}"
    )
    msg.attach(MIMEText(body, "plain"))

    with open(pdf_path, "rb") as f:
        part = MIMEApplication(f.read(), _subtype="pdf")
        part.add_header("Content-Disposition", "attachment",
                        filename=os.path.basename(pdf_path))
        msg.attach(part)

    last_error = ""
    for attempt in range(retries + 1):
        try:
            server = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=30)
            try:
                if config.SMTP_USE_TLS:
                    server.starttls()
                server.login(config.SMTP_USER, config.SMTP_PASSWORD)
                server.send_message(msg)
            finally:
                server.quit()
            return True, ""
        except Exception as e:  # noqa: BLE001 - surface any SMTP failure to user
            last_error = str(e)
    return False, last_error
