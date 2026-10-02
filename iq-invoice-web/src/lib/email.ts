/**
 * SMTP email sender with PDF attachment — port of emailer.py.
 *
 * The invoice is always saved to disk first; an email failure never loses
 * data. Returns { ok, error } so the UI can offer "Retry Email".
 *
 * Works on the Vercel Node.js runtime (which can open SMTP connections) and
 * locally. When SMTP is not configured, returns ok:false with a clear reason
 * and sends nothing — exactly like the desktop app's is_configured().
 */
import nodemailer from "nodemailer";

import {
  COMPANY_NAME,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASSWORD,
  SMTP_PORT,
  SMTP_USER,
  SMTP_USE_TLS,
} from "./config";

export function isConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);
}

export interface SendResult {
  ok: boolean;
  error: string;
}

export async function sendInvoiceEmail(args: {
  to: string;
  pdf: Buffer;
  filename: string;
  invoiceNumber: number;
  retries?: number;
}): Promise<SendResult> {
  const { to, pdf, filename, invoiceNumber, retries = 1 } = args;

  if (!isConfigured()) {
    return {
      ok: false,
      error:
        "SMTP is not configured. Set SMTP_HOST / SMTP_USER / SMTP_PASSWORD " +
        "and try again.",
    };
  }
  if (!to || !to.includes("@")) {
    return { ok: false, error: "No valid customer email address." };
  }

  const label = `INV-${String(invoiceNumber).padStart(6, "0")}`;
  const text =
    `Dear customer,\n\n` +
    `Please find attached your invoice ${label}.\n\n` +
    `Thank you for your business.\n${COMPANY_NAME}`;

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: !SMTP_USE_TLS && SMTP_PORT === 465,
        requireTLS: SMTP_USE_TLS,
        auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 30_000,
      });
      await transporter.sendMail({
        from: SMTP_FROM || SMTP_USER,
        to,
        subject: `Invoice ${label}`,
        text,
        attachments: [{ filename, content: pdf }],
      });
      return { ok: true, error: "" };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}