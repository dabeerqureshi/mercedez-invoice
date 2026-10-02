/**
 * POST /api/invoices/<number>/resend
 *
 * "Retry Email": regenerate the PDF from the stored invoice and send it again.
 */
import { NextResponse } from "next/server";

import { guardRequest } from "@/lib/auth";
import { resendInvoiceEmail } from "@/lib/invoice-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const denied = guardRequest(req);
  if (denied) return denied;
  const { number } = await params;
  const invoiceNumber = Number(number);
  if (!Number.isFinite(invoiceNumber)) {
    return NextResponse.json(
      { ok: false, error: "Invalid invoice number." },
      { status: 400 },
    );
  }
  try {
    const result = await resendInvoiceEmail(invoiceNumber);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}