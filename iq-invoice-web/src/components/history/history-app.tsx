"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Header } from "@/components/pos/header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PRICE_SOURCE, invoiceNumberLabel, money } from "@/lib/config";

interface HistoryInvoice {
  invoiceNumber: number;
  createdAt: string | null;
  customerName: string;
  customerEmail: string;
  make: string | null;
  model: string | null;
  regNo: string | null;
  mileage: string | null;
  subtotal: number;
  vat: number;
  discount: number;
  total: number;
  currency: string;
  itemCount: number;
  pdfUrl: string | null;
  csvUrl: string | null;
}

/**
 * Invoice history (Phase 4): every saved invoice, newest first, with quick
 * access to the stored PDF/CSV and a one-click email resend.
 */
export function HistoryApp() {
  const [rows, setRows] = useState<HistoryInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resending, setResending] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/invoices");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Could not load invoices.");
      }
      setRows(data.invoices);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load: state updates happen inside the fetch callbacks (the
    // react-hooks/set-state-in-effect rule forbids direct calls here).
    let stale = false;
    fetch("/api/invoices")
      .then((res) => res.json())
      .then((data) => {
        if (stale) return;
        if (!data?.ok) {
          setError(data?.error || "Could not load invoices.");
        } else {
          setRows(data.invoices);
        }
      })
      .catch((e) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, []);

  const resend = useCallback(async (n: number) => {
    setResending(n);
    try {
      const res = await fetch(`/api/invoices/${n}/resend`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`Email sent for ${invoiceNumberLabel(n)}.`);
      } else {
        toast.error("Could not send email", {
          description: data.error || "Unknown error.",
        });
      }
    } catch (e) {
      toast.error("Could not send email", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setResending(null);
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header priceSource={PRICE_SOURCE} />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Invoice history</h1>
            <p className="text-sm text-muted">Saved invoices, newest first.</p>
          </div>
          <Link href="/">
            <Button variant="primary">New invoice</Button>
          </Link>
        </div>

        <Card className="p-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading invoices…
            </div>
          ) : error ? (
            <div className="py-8 text-center text-sm">
              <p className="text-red-400">{error}</p>
              <Button className="mt-3" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No invoices yet — scan a part and check out.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted">
                    <th className="py-2 pr-3">Invoice</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Vehicle</th>
                    <th className="py-2 pr-3 text-right">Items</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 pr-3">Files</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.invoiceNumber}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="py-2 pr-3 font-medium">
                        {invoiceNumberLabel(r.invoiceNumber)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {r.createdAt ? r.createdAt.slice(0, 10) : "—"}
                      </td>
                      <td className="py-2 pr-3">{r.customerName || "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {[r.make, r.model].filter(Boolean).join(" ") ||
                          r.regNo ||
                          "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">{r.itemCount}</td>
                      <td className="py-2 pr-3 text-right font-medium">
                        {money(r.total)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {r.pdfUrl && (
                          <a
                            className="text-primary underline"
                            href={r.pdfUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            PDF
                          </a>
                        )}
                        {r.pdfUrl && r.csvUrl && " · "}
                        {r.csvUrl && (
                          <a
                            className="text-primary underline"
                            href={r.csvUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            CSV
                          </a>
                        )}
                        {!r.pdfUrl && !r.csvUrl && "—"}
                      </td>
                      <td className="py-2 text-right">
                        {r.customerEmail && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={resending === r.invoiceNumber}
                            onClick={() => void resend(r.invoiceNumber)}
                          >
                            {resending === r.invoiceNumber
                              ? "Sending…"
                              : "Resend"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
