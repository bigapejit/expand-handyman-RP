"use client";

import { Landmark } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { formatCentsExact } from "@/lib/money";

import { DepositCard, ReconnectLine } from "./pieces";
import { Deposits, waitingDeposits, type Statuses } from "./store";

// PROTOTYPE (#130): A, a Money in page of its own in the nav. Every deposit
// that landed, the ones waiting on the owner on top, the done ones under
// them. The nav item wears the count still waiting.
export function VariantAPage({
  statuses,
  relayNeedsLogin,
  onOpenInvoice,
}: {
  statuses: Statuses;
  relayNeedsLogin: boolean;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const waiting = waitingDeposits(statuses);
  const done = Deposits.filter((d) => statuses[d.id].kind !== "waiting");
  const total = waiting.reduce((n, d) => n + d.amountCents, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Money in"
        description="What landed in Relay and U.S. Bank, and the invoice each one paid."
      />
      {relayNeedsLogin ? <ReconnectLine /> : null}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium text-slate-500">
            {waiting.length === 0 ? "Nothing waiting on you" : `Waiting on you · ${waiting.length}`}
          </h2>
          {waiting.length ? (
            <span className="text-sm tabular-nums text-slate-500">{formatCentsExact(total)}</span>
          ) : null}
        </div>
        {waiting.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed bg-slate-50 text-center">
            <div className="px-6">
              <Landmark className="mx-auto size-6 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500">Every deposit is on an invoice or set aside.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
            {waiting.map((d) => (
              <DepositCard key={d.id} deposit={d} statuses={statuses} onOpenInvoice={onOpenInvoice} />
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-500">Done</h2>
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {done.map((d) => (
            <DepositCard key={d.id} deposit={d} statuses={statuses} onOpenInvoice={onOpenInvoice} />
          ))}
        </ul>
      </section>
    </div>
  );
}
