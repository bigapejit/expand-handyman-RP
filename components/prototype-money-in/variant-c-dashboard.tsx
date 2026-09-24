"use client";

import { ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { formatCentsExact } from "@/lib/money";

import { DepositCard, ReconnectLine, StandingChip } from "./pieces";
import {
  Deposits,
  Invoices,
  shortDay,
  standingOf,
  waitingDeposits,
  type Statuses,
} from "./store";

// PROTOTYPE (#130): C, a card on the Dashboard and nothing else. Only what
// is waiting on the owner shows; a deposit confirmed or set aside leaves
// the card and lives on its invoice from then on. Stripe payouts are one
// grey line. No page, no segment, no history.
export function VariantCDashboard({
  statuses,
  relayNeedsLogin,
  onOpenInvoice,
}: {
  statuses: Statuses;
  relayNeedsLogin: boolean;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const waiting = waitingDeposits(statuses);
  const total = waiting.reduce((n, d) => n + d.amountCents, 0);
  const payouts = Deposits.filter((d) => statuses[d.id].kind === "payout");
  const owed = Invoices.filter((inv) => standingOf(inv, statuses) !== "paid");
  const owedCents = owed.reduce((n, inv) => n + inv.amountDueCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="What is waiting on a customer, what they decided, and what they owe."
      />
      <div className="space-y-8">
        <section aria-labelledby="money-landed" className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="money-landed" className="text-lg font-semibold tracking-tight">
              Money landed
            </h2>
            <p className="text-sm text-muted-foreground">Waiting on you</p>
          </div>
          {relayNeedsLogin ? <ReconnectLine compact /> : null}
          {waiting.length === 0 ? (
            <p className="rounded-2xl border border-dashed bg-slate-50 px-6 py-6 text-center text-sm text-slate-500">
              Nothing landed that needs you. A deposit shows here until it is on an invoice or set aside.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-4 rounded-2xl border bg-white px-4 py-3">
                <span className="text-sm text-slate-500">
                  {waiting.length === 1 ? "1 deposit" : `${waiting.length} deposits`}
                </span>
                <span className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {formatCentsExact(total)}
                </span>
              </div>
              <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
                {waiting.map((d) => (
                  <DepositCard key={d.id} deposit={d} statuses={statuses} onOpenInvoice={onOpenInvoice} compact />
                ))}
              </ul>
            </div>
          )}
          {payouts.length ? (
            <p className="text-xs text-slate-500">
              Also {payouts.map((d) => `a Stripe payout of ${formatCentsExact(d.amountCents)} ${shortDay(d.day)}`).join(", ")},
              already counted.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="dash-invoices" className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="dash-invoices" className="text-lg font-semibold tracking-tight">
              Invoices
            </h2>
            <p className="text-sm text-muted-foreground">Owed to you</p>
          </div>
          <div className="flex items-baseline justify-between gap-4 rounded-2xl border bg-white px-4 py-3">
            <span className="text-sm text-slate-500">On {owed.length} invoices</span>
            <span className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {formatCentsExact(owedCents)}
            </span>
          </div>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
            {owed.map((inv) => (
              <li key={inv.id}>
                <button
                  type="button"
                  onClick={() => onOpenInvoice(inv.id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900">{inv.customerName}</span>
                      <StandingChip standing={standingOf(inv, statuses)} />
                    </p>
                    <p className="text-sm text-slate-500 sm:truncate">
                      {inv.number} · {inv.kind} · Sent {shortDay(inv.sentDay)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
                    {formatCentsExact(inv.amountDueCents)}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
