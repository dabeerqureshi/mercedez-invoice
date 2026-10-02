"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Mail,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DEFAULT_VEHICLE_MAKE,
  VAT_RATE,
  invoiceNumberLabel,
  money,
} from "@/lib/config";
import { computeTotals, parsePrice, round2 } from "@/lib/pricing";
import type { PartsLine, WorkLine } from "@/lib/pricing";
import type { CartLine } from "@/lib/types";

interface CheckoutDialogProps {
  lines: CartLine[];
  onClose: () => void;
  onSaved: () => void;
}

interface PartRow {
  partNumber: string;
  designation: string;
  quantity: number;
  unitPriceText: string;
  retrievedAt: string;
}

interface WorkRow {
  description: string;
  operNo: string;
  timeHours: string;
  labourCostText: string;
}

const emptyWorkRow = (): WorkRow => ({
  description: "",
  operNo: "",
  timeHours: "",
  labourCostText: "0.00",
});

interface SaveResult {
  ok: boolean;
  saved: boolean;
  invoiceNumber: number | null;
  pdfUrl: string | null;
  csvUrl: string | null;
  storage: "blob" | "local" | null;
  emailed: boolean;
  emailError: string;
  error: string;
}

export function CheckoutDialog({
  lines,
  onClose,
  onSaved,
}: CheckoutDialogProps) {
  // The dialog is mounted fresh each time it opens, so the state initialisers
  // below give us a clean form without needing a reset effect.
  const [rows, setRows] = useState<PartRow[]>(() =>
    lines.map((l) => ({
      partNumber: l.partNumber,
      designation: l.designation,
      quantity: l.quantity,
      unitPriceText: String(l.unitPrice),
      retrievedAt: l.retrievedAt,
    })),
  );
  const [vehicle, setVehicle] = useState({
    make: DEFAULT_VEHICLE_MAKE,
    model: "",
    regNo: "",
    mileage: "",
  });
  const [work, setWork] = useState<WorkRow[]>([emptyWorkRow()]);
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const parts: PartsLine[] = useMemo(
    () =>
      rows.map((r) => {
        const { value, isNumber } = parsePrice(r.unitPriceText);
        return {
          partNumber: r.partNumber,
          designation: r.designation,
          quantity: r.quantity,
          unitPrice: value,
          lineTotal: isNumber ? round2(value * r.quantity) : 0,
        };
      }),
    [rows],
  );

  const workLines: WorkLine[] = useMemo(
    () =>
      work
        .filter((w) => w.description.trim() !== "")
        .map((w) => ({
          description: w.description.trim(),
          operNo: w.operNo.trim(),
          timeHours: w.timeHours.trim(),
          labourCost: round2(parsePrice(w.labourCostText).value),
        })),
    [work],
  );

  const totals = useMemo(
    () => computeTotals(parts, workLines),
    [parts, workLines],
  );

  const updateRow = (index: number, patch: Partial<PartRow>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const updateWork = (index: number, patch: Partial<WorkRow>) =>
    setWork((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));

  const addWorkRow = () => setWork((prev) => [...prev, emptyWorkRow()]);
  const removeWorkRow = (index: number) =>
    setWork((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    );

  async function handleSave() {
    const name = customer.name.trim();
    if (!name) {
      toast.error("Customer name required", {
        description: "Please enter the customer's name.",
      });
      return;
    }
    setSaving(true);
    try {
      const payloadParts = rows.map((r) => {
        const { value, isNumber } = parsePrice(r.unitPriceText);
        return {
          partNumber: r.partNumber,
          designation: r.designation,
          quantity: r.quantity,
          unitPrice: value,
          lineTotal: isNumber ? round2(value * r.quantity) : 0,
          priceRetrievedAt: r.retrievedAt,
        };
      });

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            name,
            phone: customer.phone.trim(),
            email: customer.email.trim(),
          },
          vehicle: {
            make: vehicle.make.trim(),
            model: vehicle.model.trim(),
            regNo: vehicle.regNo.trim().toUpperCase(),
            mileage: vehicle.mileage.trim(),
          },
          parts: payloadParts,
          workItems: workLines,
        }),
      });
      const data = (await res.json()) as SaveResult;
      if (!res.ok) {
        toast.error("Save failed", {
          description: data.error || "Could not save invoice.",
        });
        return;
      }
      // Saved (or saved-with-PDF-failure): show the result panel.
      setResult(data);
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRetry() {
    if (!result?.invoiceNumber) return;
    setResending(true);
    try {
      const res = await fetch(
        `/api/invoices/${result.invoiceNumber}/resend`,
        { method: "POST" },
      );
      const data = (await res.json()) as { ok: boolean; error: string };
      if (data.ok) {
        setResult({ ...result, emailed: true, emailError: "" });
        toast.success("Invoice emailed");
      } else {
        setResult({ ...result, emailed: false, emailError: data.error });
        toast.error("Email failed again", { description: data.error });
      }
    } catch (e) {
      toast.error("Email failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setResending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Checkout</DialogTitle>
          <DialogDescription>
            Review the parts, add vehicle &amp; work details, then save the
            invoice.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <InvoiceResult
            result={result}
            resending={resending}
            onRetry={handleRetry}
            onDone={onSaved}
          />
        ) : (
          <>
        <div className="mt-4 space-y-5">
          {/* ---- parts ---- */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Parts</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Part Number</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-[70px]">Qty</TableHead>
                  <TableHead className="w-[120px]">Unit Price</TableHead>
                  <TableHead className="w-[120px] text-right">
                    Line Total
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const { value, isNumber } = parsePrice(r.unitPriceText);
                  const lineTotal = isNumber ? round2(value * r.quantity) : 0;
                  return (
                    <TableRow key={r.partNumber}>
                      <TableCell className="font-medium">
                        {r.partNumber}
                      </TableCell>
                      <TableCell className="text-muted">
                        {r.designation}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {r.quantity}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.unitPriceText}
                          onChange={(e) =>
                            updateRow(i, { unitPriceText: e.target.value })
                          }
                          className="h-8 w-24"
                          inputMode="decimal"
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(lineTotal)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
          {/* ---- vehicle ---- */}
          <section className="rounded-lg border border-border bg-panel-alt p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Make">
                <Input
                  value={vehicle.make}
                  onChange={(e) =>
                    setVehicle((v) => ({ ...v, make: e.target.value }))
                  }
                  className="h-9"
                />
              </Field>
              <Field label="Model">
                <Input
                  value={vehicle.model}
                  onChange={(e) =>
                    setVehicle((v) => ({ ...v, model: e.target.value }))
                  }
                  className="h-9"
                />
              </Field>
              <Field label="Reg">
                <Input
                  value={vehicle.regNo}
                  maxLength={12}
                  onChange={(e) =>
                    setVehicle((v) => ({ ...v, regNo: e.target.value }))
                  }
                  className="h-9 uppercase"
                />
              </Field>
              <Field label="Mileage">
                <Input
                  value={vehicle.mileage}
                  onChange={(e) =>
                    setVehicle((v) => ({ ...v, mileage: e.target.value }))
                  }
                  className="h-9"
                />
              </Field>
            </div>
          </section>

          {/* ---- work ---- */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold">Description of work</h3>
              <div className="ml-auto">
                <Button variant="default" size="sm" onClick={addWorkRow}>
                  <Plus className="h-3.5 w-3.5" />
                  Add work line
                </Button>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[100px]">Oper No.</TableHead>
                  <TableHead className="w-[90px]">Time</TableHead>
                  <TableHead className="w-[120px]">Labour Cost</TableHead>
                  <TableHead className="w-[48px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {work.map((w, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Input
                        value={w.description}
                        onChange={(e) =>
                          updateWork(i, { description: e.target.value })
                        }
                        className="h-8"
                        placeholder="Work description"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={w.operNo}
                        onChange={(e) =>
                          updateWork(i, { operNo: e.target.value })
                        }
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={w.timeHours}
                        onChange={(e) =>
                          updateWork(i, { timeHours: e.target.value })
                        }
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={w.labourCostText}
                        onChange={(e) =>
                          updateWork(i, { labourCostText: e.target.value })
                        }
                        className="h-8 w-24"
                        inputMode="decimal"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove work line"
                        className="h-8 w-8 text-subtle hover:bg-danger/10 hover:text-danger"
                        onClick={() => removeWorkRow(i)}
                        disabled={work.length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          {/* ---- customer + totals ---- */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-panel-alt p-3">
              <h3 className="mb-2 text-sm font-semibold">Customer details</h3>
              <div className="grid grid-cols-[70px_1fr] items-center gap-x-2 gap-y-2">
                <span className="text-sm text-muted">Name:</span>
                <Input
                  value={customer.name}
                  onChange={(e) =>
                    setCustomer((c) => ({ ...c, name: e.target.value }))
                  }
                  className="h-9"
                  placeholder="Customer name (required)"
                />
                <span className="text-sm text-muted">Phone:</span>
                <Input
                  value={customer.phone}
                  onChange={(e) =>
                    setCustomer((c) => ({ ...c, phone: e.target.value }))
                  }
                  className="h-9"
                  placeholder="Phone"
                />
                <span className="text-sm text-muted">Email:</span>
                <Input
                  value={customer.email}
                  onChange={(e) =>
                    setCustomer((c) => ({ ...c, email: e.target.value }))
                  }
                  className="h-9"
                  placeholder="Email"
                  type="email"
                />
              </div>
            </div>

            <div className="flex flex-col justify-center gap-1 rounded-lg border border-border bg-panel-alt p-3 text-right">
              <TotalsLine label="Parts:" value={money(totals.parts)} />
              <TotalsLine label="Labour:" value={money(totals.labour)} />
              <TotalsLine
                label="SUBTOTAL:"
                value={money(totals.subtotal)}
                strong
              />
              <TotalsLine
                label={`VAT @ ${Math.round(VAT_RATE * 100)}%:`}
                value={money(totals.vat)}
              />
              <div className="mt-1 flex items-center justify-end gap-3 border-t border-border pt-2">
                <span className="text-sm font-bold text-primary-active">
                  TOTAL:
                </span>
                <span className="text-xl font-bold text-primary-active tabular-nums">
                  {money(totals.total)}
                </span>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="mt-5">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || rows.length === 0}
          >
            {saving ? "Saving…" : "Save & Email Invoice"}
          </Button>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InvoiceResult({
  result,
  resending,
  onRetry,
  onDone,
}: {
  result: SaveResult;
  resending: boolean;
  onRetry: () => void;
  onDone: () => void;
}) {
  const num =
    result.invoiceNumber != null
      ? invoiceNumberLabel(result.invoiceNumber)
      : "invoice";
  const pdfFailed = !result.ok && result.saved;

  return (
    <div className="mt-4 space-y-4">
      {pdfFailed ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900">
              {num} saved — PDF/CSV failed
            </p>
            <p className="text-sm text-amber-800">{result.error}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold text-emerald-900">{num} saved</p>
            <p className="text-sm text-emerald-800">
              CSV exported{result.emailed ? " and emailed to the customer" : ""}.
            </p>
          </div>
        </div>
      )}

      {(result.pdfUrl || result.csvUrl) && (
        <div className="flex flex-wrap gap-2">
          {result.pdfUrl && (
            <a href={result.pdfUrl} target="_blank" rel="noreferrer">
              <Button variant="default">
                <Download className="h-4 w-4" />
                Download PDF
              </Button>
            </a>
          )}
          {result.csvUrl && (
            <a href={result.csvUrl} target="_blank" rel="noreferrer">
              <Button variant="default">
                <Download className="h-4 w-4" />
                Download CSV
              </Button>
            </a>
          )}
        </div>
      )}

      {result.ok && !result.emailed && (
        <div className="rounded-lg border border-border bg-panel-alt p-3">
          <p className="text-sm font-medium">Email failed</p>
          <p className="text-xs text-muted">{result.emailError}</p>
          <p className="mt-1 text-xs text-muted">
            The invoice, PDF and CSV are safe — you can retry the email.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {result.ok && !result.emailed && (
          <Button variant="default" onClick={onRetry} disabled={resending}>
            {resending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            Retry Email
          </Button>
        )}
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function TotalsLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      <span
        className={
          strong
            ? "text-sm font-semibold text-foreground"
            : "text-sm text-muted"
        }
      >
        {label}
      </span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}
