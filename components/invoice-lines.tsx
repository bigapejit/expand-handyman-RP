"use client";

import type { FunctionArgs } from "convex/server";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import type { PanelInvoice } from "@/components/invoice-sending";
import { FieldHeading, FieldLabel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { api } from "@/convex/_generated/api";
import { invoiceMoney, type InvoiceMoney } from "@/lib/invoice-money";
import { invoiceTaxLabel } from "@/lib/invoice-paper";
import {
  lineDraftsFrom,
  linesToStore,
  readAmountField,
  sameInvoiceLines,
  type InvoiceLineDraft,
} from "@/lib/invoices";
import { formatCentsExact } from "@/lib/money";
import { moveInOrder } from "@/lib/proposals";
import { cn } from "@/lib/utils";

// What one edit of a draft may change (invoices.update).
export type InvoiceDraftPatch = Omit<FunctionArgs<typeof api.invoices.update>, "invoiceId">;

// The lines as the paper prints them, before tax, then Subtotal, Sales Tax at
// the invoice's rate and Amount Due. A sent invoice's lines never change, and
// a void invoice keeps its lines, with the amount due struck through, as its
// paper does.
export function InvoiceLines({ invoice }: { invoice: PanelInvoice }) {
  return (
    <div className="space-y-2">
      <FieldHeading>Lines</FieldHeading>
      <div className="overflow-hidden rounded-xl border text-sm">
        {invoice.lines.length === 0 ? (
          <p className="px-3 py-3 text-slate-500">No lines yet.</p>
        ) : (
          <ol className="divide-y">
            {invoice.lines.map((line, index) => (
              <li key={index} className="flex items-start justify-between gap-4 px-3 py-2">
                <span className="min-w-0 text-slate-900">{line.description}</span>
                <span className="shrink-0 tabular-nums text-slate-900">
                  {formatCentsExact(line.cents)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <InvoiceTotals
          money={invoice.money}
          taxRate={invoice.taxRate}
          struck={invoice.state === "void"}
        />
      </div>
    </div>
  );
}

// A **Draft invoice** open for writing: a typed invoice's title, then its
// lines, each a description and an amount before tax, negative for a credit,
// added, edited, removed and moved. Text commits when the field is left, so
// a half-typed amount never becomes the invoice; removing and moving a line
// is the whole edit, so it stores at once. A line just added waits for its
// field to be left, so Send does not call it blank before it is written. The
// totals under the table follow every keystroke, from the same module the
// server and the paper use.
export function InvoiceDraftLines({
  invoice,
  onSave,
  onUnreadable,
}: {
  invoice: PanelInvoice;
  onSave: (patch: InvoiceDraftPatch) => Promise<boolean>;
  // Told whether an amount in the table cannot be read, and so cannot be
  // stored: until it can, the invoice still holds the amount it replaced, and
  // Send must wait rather than send that.
  onUnreadable: (unreadable: boolean) => void;
}) {
  const [title, setTitle] = useState(invoice.typedTitle ?? "");
  const [drafts, setDraftRows] = useState<InvoiceLineDraft[]>(() =>
    lineDraftsFrom(invoice.lines),
  );
  const setDrafts = (rows: InvoiceLineDraft[]) => {
    setDraftRows(rows);
    onUnreadable(linesToStore(rows) === null);
  };
  const nextKey = useRef(0);
  // The row just added, whose description takes the cursor.
  const [added, setAdded] = useState<string | null>(null);

  // Stored whole, and only when the table says something different and every
  // amount in it reads. A refusal puts the table back to the lines the
  // invoice still holds.
  const commit = async (rows: InvoiceLineDraft[]) => {
    const lines = linesToStore(rows);
    if (lines === null || sameInvoiceLines(lines, invoice.lines)) return;
    if (!(await onSave({ lines }))) setDrafts(lineDraftsFrom(invoice.lines));
  };

  const editRow = (index: number, patch: Partial<InvoiceLineDraft>) => {
    setDrafts(drafts.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  };

  const replace = (next: InvoiceLineDraft[]) => {
    setDrafts(next);
    void commit(next);
  };

  const addRow = () => {
    nextKey.current += 1;
    const key = `new-${nextKey.current}`;
    setAdded(key);
    setDrafts([...drafts, { key, description: "", amount: "" }]);
  };

  // A refused title puts the field back to what the invoice is still called.
  const commitTitle = async () => {
    const stored = invoice.typedTitle ?? "";
    if (title.trim() === stored) return;
    if (!(await onSave({ title }))) setTitle(stored);
  };

  const money = invoiceMoney(
    drafts.map((row) => ({
      description: row.description,
      cents: readAmountField(row.amount) ?? 0,
    })),
    invoice.taxRate,
  );

  return (
    <div className="space-y-6">
      {invoice.kind === "typed" ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="invoice-title">Title</FieldLabel>
          <Input
            id="invoice-title"
            value={title}
            placeholder="Invoice"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void commitTitle()}
            className="w-full bg-white font-medium"
          />
          <p className="text-xs text-slate-500">
            What the invoice is for, such as &ldquo;Framing midway&rdquo;. Lists show it
            after the number.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <FieldHeading>Lines</FieldHeading>
        <div className="overflow-hidden rounded-xl border text-sm">
          <div
            aria-hidden
            className={cn(
              LineGrid,
              "hidden bg-slate-50 px-3 py-2 text-xs font-medium tracking-wide text-slate-500 uppercase sm:grid",
            )}
          >
            <span>Description</span>
            <span className="text-right">Amount</span>
            <span />
          </div>
          {drafts.length === 0 ? (
            <p className="px-3 py-4 text-slate-500">
              No lines yet. Each line is a description and an amount before tax; make it
              negative for a credit.
            </p>
          ) : (
            <ul>
              {drafts.map((row, index) => (
                <DraftLineRow
                  key={row.key}
                  row={row}
                  autoFocus={row.key === added}
                  isFirst={index === 0}
                  isLast={index === drafts.length - 1}
                  onEdit={(patch) => editRow(index, patch)}
                  onCommit={() => void commit(drafts)}
                  onMove={(direction) => replace(moveInOrder(drafts, index, direction))}
                  onRemove={() => replace(drafts.filter((_, at) => at !== index))}
                />
              ))}
            </ul>
          )}
          <InvoiceTotals money={money} taxRate={invoice.taxRate} />
        </div>
        <Button variant="outline" onClick={addRow}>
          <Plus data-icon="inline-start" aria-hidden /> Add line
        </Button>
      </div>
    </div>
  );
}

const LineGrid =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center";

function DraftLineRow({
  row,
  autoFocus,
  isFirst,
  isLast,
  onEdit,
  onCommit,
  onMove,
  onRemove,
}: {
  row: InvoiceLineDraft;
  autoFocus: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (patch: Partial<InvoiceLineDraft>) => void;
  onCommit: () => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const unreadable = readAmountField(row.amount) === null;
  return (
    <li className={cn(LineGrid, "border-t px-3 py-2 first:border-t-0 sm:first:border-t")}>
      <Input
        aria-label="Description"
        placeholder="What this line is for"
        autoFocus={autoFocus}
        value={row.description}
        onChange={(event) => onEdit({ description: event.target.value })}
        onBlur={onCommit}
        className="col-span-2 w-full bg-white sm:col-span-1"
      />
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
        >
          $
        </span>
        {/* No numeric keypad: a phone's has no minus, and a credit needs one. */}
        <Input
          aria-label="Amount before tax"
          aria-invalid={unreadable || undefined}
          placeholder="0.00"
          value={row.amount}
          onChange={(event) => onEdit({ amount: event.target.value })}
          onBlur={onCommit}
          className="w-full bg-white pl-6 text-right tabular-nums"
        />
      </div>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move line up"
          disabled={isFirst}
          onClick={() => onMove("up")}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move line down"
          disabled={isLast}
          onClick={() => onMove("down")}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Remove line" onClick={onRemove}>
          <X aria-hidden />
        </Button>
      </div>
      {unreadable ? (
        <p className="col-span-2 text-xs text-red-700 sm:col-span-3">
          Type an amount such as 1,250.00, or -80.00 for a credit.
        </p>
      ) : null}
    </li>
  );
}

function InvoiceTotals({
  money,
  taxRate,
  struck = false,
}: {
  money: InvoiceMoney;
  taxRate: number;
  struck?: boolean;
}) {
  return (
    <dl className="space-y-1 border-t bg-slate-50/60 px-3 py-3">
      <div className="flex justify-between gap-6 text-slate-500">
        <dt>Subtotal</dt>
        <dd className="tabular-nums">{formatCentsExact(money.subtotalCents)}</dd>
      </div>
      <div className="flex justify-between gap-6 text-slate-500">
        <dt>{invoiceTaxLabel(taxRate)}</dt>
        <dd className="tabular-nums">{formatCentsExact(money.taxCents)}</dd>
      </div>
      <div className="flex justify-between gap-6 border-t pt-2 font-semibold text-slate-900">
        <dt>Amount due</dt>
        <dd className={cn("tabular-nums", struck && "line-through")}>
          {formatCentsExact(money.amountDueCents)}
        </dd>
      </div>
    </dl>
  );
}
