/**
 * POST /api/price  { partNumber }
 *
 * Live price lookup. Talks only to the configured PriceSource (mock in
 * Phase 1, Mercedes via Browserbase in Phase 3), so the UI never cares which
 * source answered. Errors are categorised exactly like the desktop app:
 *   kind = "login_required" | "not_found" | "error"
 */
import { NextResponse } from "next/server";

import { guardRequest } from "@/lib/auth";
import { PRICE_SOURCE } from "@/lib/config";
import {
  LoginRequiredError,
  PartNotFoundError,
  makeSource,
  normalizePart,
} from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Live lookups open a Browserbase session + drive the catalog; 60s is the
// maximum allowed on every Vercel plan, and the connector's internal deadline
// (~50s) keeps us under it so failures stay ours, not a function kill.
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;
  let body: { partNumber?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, kind: "error", error: "Invalid request body." },
      { status: 400 },
    );
  }

  const part = normalizePart(body.partNumber ?? "");
  if (!part) {
    return NextResponse.json(
      { ok: false, kind: "error", error: "Empty part number.", part },
      { status: 400 },
    );
  }

  const source = makeSource(PRICE_SOURCE);
  try {
    const result = await source.getPrice(part);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof PartNotFoundError) {
      return NextResponse.json(
        { ok: false, kind: "not_found", error: message, part },
        { status: 404 },
      );
    }
    if (e instanceof LoginRequiredError) {
      return NextResponse.json(
        { ok: false, kind: "login_required", error: message, part },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { ok: false, kind: "error", error: message, part },
      { status: 502 },
    );
  }
}
