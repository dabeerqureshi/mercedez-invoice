"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/config";
import { round2 } from "@/lib/pricing";
import type { CartLine } from "@/lib/types";

interface CartTableProps {
  lines: CartLine[];
  onQtyChange: (partNumber: string, qty: number) => void;
  onRemove: (partNumber: string) => void;
}

export function CartTable({ lines, onQtyChange, onRemove }: CartTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[220px]">Part Number</TableHead>
          <TableHead>Product</TableHead>
          <TableHead className="w-[90px]">Qty</TableHead>
          <TableHead className="w-[130px] text-right">Unit Price</TableHead>
          <TableHead className="w-[130px] text-right">Line Total</TableHead>
          <TableHead className="w-[56px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={6}
              className="py-10 text-center text-sm text-subtle"
            >
              No parts yet — scan or type a part number above to add it.
            </TableCell>
          </TableRow>
        ) : (
          lines.map((line) => {
            const lineTotal = round2(line.unitPrice * line.quantity);
            return (
              <TableRow key={line.partNumber}>
                <TableCell className="font-medium">{line.partNumber}</TableCell>
                <TableCell className="text-muted">
                  {line.designation}
                </TableCell>
                <TableCell>
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={line.quantity}
                    onChange={(e) =>
                      onQtyChange(
                        line.partNumber,
                        Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                      )
                    }
                    className="h-8 w-16 rounded-md border border-input bg-card px-2 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(line.unitPrice)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {money(lineTotal)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${line.partNumber}`}
                    className="h-8 w-8 text-subtle hover:bg-danger/10 hover:text-danger"
                    onClick={() => onRemove(line.partNumber)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
