"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PRICE_SOURCE, money } from "@/lib/config";
import { normalizePart } from "@/lib/connectors/types";
import type { PriceResult } from "@/lib/connectors/types";
import { computeTotals, round2 } from "@/lib/pricing";
import type { PartsLine } from "@/lib/pricing";
import type { CartLine } from "@/lib/types";

import { CartTable } from "./cart-table";
import { CheckoutDialog } from "./checkout-dialog";
import { ConnectDialog } from "./connect-dialog";
import { Header } from "./header";
import type { ConnectionState } from "./header";
import { TotalsBar } from "./totals-bar";

/** Split a batch of part numbers on commas / semicolons / newlines. */
function parseParts(raw: string): string[] {
  return raw
    .split(/[,;\r\n]+/)
    .map(normalizePart)
    .filter(Boolean);
}

export function PosApp() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("unknown");
  const [keepAliveSeconds, setKeepAliveSeconds] = useState(0);
  const [authOn, setAuthOn] = useState(false);
  /**
   * Phase 4 scan queue (port of the desktop PriceWorker): scanned parts line
   * up here and are looked up strictly one at a time, in scan order.
   */
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);

  const parts: PartsLine[] = useMemo(
    () =>
      cart.map((l) => ({
        partNumber: l.partNumber,
        designation: l.designation,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: round2(l.unitPrice * l.quantity),
      })),
    [cart],
  );
  const totals = useMemo(() => computeTotals(parts, []), [parts]);

  /** Header badge + dialog preflight: Mercedes connection state. */
  const applyStatus = useCallback(
    (data: {
      ok?: boolean;
      configured?: boolean;
      connected?: boolean;
      pendingLogin?: boolean;
      keepAliveSeconds?: number;
      authEnabled?: boolean;
    }) => {
      if (!data?.ok) return;
      setConnection(
        !data.configured
          ? "unconfigured"
          : data.connected
            ? "connected"
            : data.pendingLogin
              ? "pending"
              : "disconnected",
      );
      if (typeof data.keepAliveSeconds === "number") {
        setKeepAliveSeconds(data.keepAliveSeconds);
      }
      if (typeof data.authEnabled === "boolean") setAuthOn(data.authEnabled);
    },
    [],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/mercedes/status");
      applyStatus(await res.json());
    } catch {
      // Status is cosmetic — keep the last known value.
    }
  }, [applyStatus]);

  useEffect(() => {
    // Loaded once on mount; state updates happen in the fetch callbacks.
    let stale = false;
    fetch("/api/mercedes/status")
      .then((res) => res.json())
      .then((data) => {
        if (!stale) applyStatus(data);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [applyStatus]);

  /**
   * Phase 4 keep-alive: while the POS page is open and the Mercedes session is
   * connected, ping the server every `keepAliveSeconds` — the web equivalent of
   * the desktop MainWindow QTimer. The server's idle guard makes the ping a
   * no-op when a lookup happened recently.
   */
  useEffect(() => {
    if (connection !== "connected" || keepAliveSeconds <= 0) return;
    const id = setInterval(() => {
      fetch("/api/cron/keep-alive").catch(() => undefined);
    }, keepAliveSeconds * 1000);
    return () => clearInterval(id);
  }, [connection, keepAliveSeconds]);

  /** Phase 4 auth: clear the session cookie and land on /login. */
  const router = useRouter();
  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }, [router]);

  const addToCart = useCallback((r: PriceResult) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.partNumber === r.partNumber);
      if (idx >= 0) {
        // Duplicate scan -> refresh price + increment quantity.
        const copy = prev.slice();
        copy[idx] = {
          ...copy[idx],
          designation: r.designation,
          unitPrice: r.price,
          currency: r.currency,
          retrievedAt: r.retrievedAt,
          quantity: copy[idx].quantity + 1,
        };
        return copy;
      }
      return [
        ...prev,
        {
          partNumber: r.partNumber,
          designation: r.designation,
          unitPrice: r.price,
          currency: r.currency,
          retrievedAt: r.retrievedAt,
          quantity: 1,
        },
      ];
    });
  }, []);
  /**
   * Phase 4: FIFO lookup drain (port of the desktop PriceWorker queue).
   *
   * The desktop app pushed every scanned part into one background worker that
   * processed them strictly one at a time, in scan order. The first web
   * version fired them all in parallel; this restores the desktop semantics —
   * one lookup at a time, results applied in order — so rapid scans behave
   * exactly like the barcode gun on the local app.
   */
  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const part = queueRef.current[0];
        setPending(queueRef.current.slice());
        try {
          const res = await fetch("/api/price", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partNumber: part }),
          });
          if (res.status === 401) {
            // Session expired mid-scan: drop the queue and re-authenticate
            // instead of toasting one error per remaining part.
            queueRef.current = [];
            toast.error("Session expired", {
              description: "Please sign in again to continue.",
            });
            router.push("/login");
            break;
          }
          const data = await res.json();
          if (!res.ok || !data.ok) {
            const description = data.error || "Could not retrieve a price.";
            if (data.kind === "login_required") {
              toast.error("Mercedes login required", {
                description,
                action: {
                  label: "Connect",
                  onClick: () => setConnectOpen(true),
                },
              });
            } else if (data.kind === "not_found") {
              toast.warning("Part not found", { description });
            } else {
              toast.error("Mercedes unavailable", { description });
            }
          } else {
            addToCart(data.result as PriceResult);
          }
        } catch (e) {
          toast.error("Lookup failed", {
            description: e instanceof Error ? e.message : String(e),
          });
        } finally {
          // Only this drain ever shifts, and scans only ever push, so the
          // part we just finished is still at index 0.
          queueRef.current.shift();
          setPending(queueRef.current.slice());
        }
      }
    } finally {
      drainingRef.current = false;
      setPending([]);
    }
  }, [addToCart, router]);

  const handleScan = useCallback(() => {
    const raw = scanValue.trim();
    if (!raw) return;
    const partsToLookup = parseParts(raw);
    setScanValue("");
    if (partsToLookup.length === 0) return;
    queueRef.current.push(...partsToLookup);
    setPending(queueRef.current.slice());
    void drainQueue();
  }, [scanValue, drainQueue]);

  const handleQtyChange = useCallback((partNumber: string, qty: number) => {
    setCart((prev) =>
      prev.map((l) =>
        l.partNumber === partNumber ? { ...l, quantity: qty } : l,
      ),
    );
  }, []);

  const handleRemove = useCallback((partNumber: string) => {
    setCart((prev) => prev.filter((l) => l.partNumber !== partNumber));
  }, []);

  const handleClear = useCallback(() => setCart([]), []);

  const handleCheckout = useCallback(() => {
    if (cart.length === 0) {
      toast.info("Nothing to check out", {
        description: "Scan at least one part first.",
      });
      return;
    }
    setCheckoutOpen(true);
  }, [cart.length]);

  const handleSaved = useCallback(() => {
    setCart([]);
    setCheckoutOpen(false);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        priceSource={PRICE_SOURCE}
        connection={connection}
        onLogin={() => setConnectOpen(true)}
        onLogout={authOn ? handleLogout : undefined}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-6 py-6">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Scan parts</h2>
          <div className="flex gap-2">
            <Input
              autoFocus
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScan();
                }
              }}
              placeholder="Scan or type part numbers (comma / semicolon / newline separated), then press Enter"
              className="h-11 text-base"
            />
            <Button
              variant="primary"
              className="h-11 shrink-0"
              onClick={handleScan}
            >
              {pending.length > 0 && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Add
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Separate multiple parts with a comma, semicolon or newline. Scanning
            a part already in the basket increases its quantity automatically.
          </p>
        </Card>

        <CartTable
          lines={cart}
          onQtyChange={handleQtyChange}
          onRemove={handleRemove}
        />

        <TotalsBar
          totals={totals}
          count={cart.length}
          onClear={handleClear}
          onCheckout={handleCheckout}
        />
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-2 text-xs text-muted">
          <span>Price source: {PRICE_SOURCE}</span>
          <span>
            Subtotal {money(totals.subtotal)} · VAT {money(totals.vat)}
          </span>
        </div>
      </footer>

      {checkoutOpen && (
        <CheckoutDialog
          lines={cart}
          onClose={() => setCheckoutOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {connectOpen && (
        <ConnectDialog
          onClose={() => {
            setConnectOpen(false);
            void refreshStatus();
          }}
          onConnected={() => void refreshStatus()}
        />
      )}
    </div>
  );
}
