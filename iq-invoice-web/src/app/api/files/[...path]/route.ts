/**
 * GET /api/files/<Invoices>/<year>/<file>
 *
 * Serves invoice files in local storage mode (when Vercel Blob is not
 * configured). In production, files are served directly from Blob URLs and
 * this route is not used.
 */
import { NextResponse } from "next/server";

import { contentTypeFor, isBlobConfigured, readLocalFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (isBlobConfigured()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { path: segments } = await params;
  const key = (segments ?? []).map(decodeURIComponent).join("/");
  if (!key) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const data = await readLocalFile(key);
  if (!data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const filename = key.split("/").pop() ?? "invoice";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor(key),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}