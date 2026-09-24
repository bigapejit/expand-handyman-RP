"use client";

import { ChevronRight, CircleCheck } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { formatCentsExact } from "@/lib/money";
import { cn } from "@/lib/utils";

import { DepositCard, paidLine, ReconnectLine, StandingChip } from "./pieces";
import {
  actions,
  bankName,
  Deposits,
  Invoices,
  kindName,
  shortDay,
  standingOf,
  suggest,
  waitingDeposits,
  type Deposit,
  type Invoice,
  type Statuses,
  type Suggestion,
} from "./store";

// PROTOTYPE (#130): B, nothing new in the nav. The Invoices page grows a
// "Money in" segment, and a deposit that fits an invoice shows up under that
// invoice's row in Unpaid, with Confirm right there. Deposits that fit
// nothing are a one-line box above the list pointing at the segment.
type Filter = "unpaid" | "overdue" | "paid" | "all" | "money";

export function VariantBInvoices({
  statuses,
  relayNeedsLogin,
  onOpenInvoice,
}: {
  statuses: Statuses;
  relayNeedsLogin: boolean;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("unpaid");
  const waiting = waitingDeposits(statuses);
  // Which waiting deposit offers itself to which invoice.
  const offers = new Map<string, { deposit: Deposit; suggestion: Suggestion }>();
  const unfit: Deposit[] = [];
  for (const d of waiting) {
    const s = suggest(d, statuses);
    if (s.kind === "one") offers.set(s.invoiceId, { deposit: d, suggestion: s });
    else if (s.kind === "pair" || s.kind === "several") for (const id of s.invoiceIds) offers.set(id, { deposit: d, suggestion: s });
    else unfit.push(d);
  }
  const rows = Invoices.filter((inv) => {
    const standing = standingOf(inv, statuses);
    if (filter === "all") return true;
    if (filter === "unpaid") return standing !== "paid";
    return standing === filter;
  });
  const options = [
    { value: "unpaid" as const, label: "Unpaid" },
    { value: "overdue" as const, label: "Overdue" },
    { value: "paid" as const, label: "Paid" },
    { value: "all" as const, label: "All" },
    { value: "money" as const, label: waiting.length ? `Money in · ${waiting.length}` : "Money in" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" description="Every invoice across every customer." />
      <div className="space-y-4">
        <div className="no-scrollbar max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
          <Segmented label="Standing" value={filter} onChange={setFilter} options={options} />
        </div>
        {relayNeedsLogin ? <ReconnectLine /> : null}
        {filter === "money" ? (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
            {[...waiting, ...Deposits.filter((d) => statuses[d.id].kind !== "waiting")].map((d) => (
              <DepositCard key={d.id} deposit={d} statuses={statuses} onOpenInvoice={onOpenInvoice} />
            ))}
          </ul>
        ) : (
          <>
            {filter !== "paid" && unfit.length ? (
              <button
                type="button"
                onClick={() => setFilter("money")}
                className="flex w-full items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left text-sm text-sky-900 hover:bg-sky-100"
              >
                <span className="flex-1">
                  {unfit.length === 1 ? "A deposit landed that fits no invoice" : `${unfit.length} deposits landed that fit no invoice`}
                  : {unfit.map((d) => `${formatCentsExact(d.amountCents)} ${kindName(d.kind).toLowerCase()}`).join(", ")}.
                </span>
                <span className="shrink-0 font-medium">Money in</span>
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              </button>
            ) : null}
            <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
              {rows.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  invoice={inv}
                  statuses={statuses}
                  offer={offers.get(inv.id) ?? null}
                  onOpen={() => onOpenInvoice(inv.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function InvoiceRow({
  invoice,
  statuses,
  offer,
  onOpen,
}: {
  invoice: Invoice;
  statuses: Statuses;
  offer: { deposit: Deposit; suggestion: Suggestion } | null;
  onOpen: () => void;
}) {
  const standing = standingOf(invoice, statuses);
  const paid = paidLine(invoice, statuses);
  return (
    <li className={cn(offer && "bg-emerald-50/40")}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">
            {invoice.number} · {invoice.kind}
          </p>
          <p className="truncate text-sm text-slate-500">
            {invoice.customerName}
            {paid ? ` · ${paid}` : ""}
          </p>
        </div>
        <StandingChip standing={standing} />
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
          {formatCentsExact(invoice.amountDueCents)}
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
      </button>
      {offer ? <OfferStrip invoice={invoice} offer={offer} /> : null}
    </li>
  );
}

function OfferStrip({
  invoice,
  offer: { deposit, suggestion },
}: {
  invoice: Invoice;
  offer: { deposit: Deposit; suggestion: Suggestion };
}) {
  const landed = `${formatCentsExact(deposit.amountCents)} landed in ${bankName(deposit.bank)} ${shortDay(deposit.day)} by ${kindName(deposit.kind)}`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-emerald-100 px-4 py-2 text-sm text-slate-700">
      <span className="min-w-0 flex-1">
        {suggestion.kind === "pair"
          ? `${landed}, enough for this and ${suggestion.invoiceIds.filter((id) => id !== invoice.id).map((id) => Invoices.find((i) => i.id === id)!.number).join(", ")}.`
          : suggestion.kind === "several"
            ? `${landed}. ${suggestion.nameMatch === invoice.id ? "The name fits this one." : "Could be this one, or another for the same amount."}`
            : `${landed}.`}{" "}
        <span className="font-mono text-xs text-slate-500">{deposit.description}</span>
      </span>
      <Button
        size="sm"
        variant={suggestion.kind === "several" && suggestion.nameMatch !== invoice.id ? "outline" : "default"}
        onClick={() =>
          actions.match(deposit.id, suggestion.kind === "pair" ? suggestion.invoiceIds : [invoice.id])
        }
      >
        <CircleCheck data-icon="inline-start" aria-hidden />{" "}
        {suggestion.kind === "pair" ? "Confirm both" : suggestion.kind === "several" ? "This one" : "Confirm"}
      </Button>
    </div>
  );
}
