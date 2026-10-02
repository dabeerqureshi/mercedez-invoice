"use client";

import { ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DEFAULT_DISCOUNT, VAT_RATE, money } from "@/lib/config";
import type { Totals } from "@/lib/pricing";

interface TotalsBarProps {
  totals: Totals;
  count: number;
  onClear: () => void;
  onCheckout: () => void;
}

export function TotalsBar({
  totals,
  count,
  onClear,
  onCheckout,
}: TotalsBarProps) {
  const discount = DEFAULT_DISCOUNT;
  return (
    <Card className="flex flex-wrap items-center gap-4 p-4">
      <Button
        variant="danger"
        onClick={onClear}
        disabled={count === 0}
        className="shrink-0"
      >
        Clear basket
      </Button>
      <span className="text-sm text-muted">
        {count} {count === 1 ? "item" : "items"}
      </span>

      <div className="ml-auto flex flex-wrap items-end gap-x-8 gap-y-2">
        <Summary label="Subtotal" value={money(totals.subtotal)} />
        <Summary
          label={`VAT @ ${Math.round(VAT_RATE * 100)}%`}
          value={money(totals.vat)}
        />
        <Summary label="Discount" value={`-${money(discount)}`} />
        <div className="flex flex-col items-end">
          <span className="text-xs font-medium text-muted">Total</span>
          <span className="text-2xl font-bold text-primary-active tabular-nums">
            {money(totals.total)}
          </span>
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={onCheckout}
          disabled={count === 0}
        >
          <ShoppingCart className="h-4 w-4" />
          Checkout
        </Button>
      </div>
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}
