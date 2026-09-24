"use client";

import { Banknote, CircleCheck, Landmark, RefreshCw, Undo2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { formatCentsExact } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  actions,
  bankName,
  daysBetween,
  invoiceById,
  kindName,
  matchedBy,
  openInvoices,
  shortDay,
  standingOf,
  suggest,
  Today,
  type Deposit,
  type Invoice,
  type Standing,
  type Statuses,
} from "./store";

// PROTOTYPE (#130): throwaway. The pieces every variant is built from: one
// deposit as a card with what the app suggests and what the owner can do,
// the invoice chip, and the one-line Reconnect strip.

// ── One deposit ──────────────────────────────────────────────────────────
export function DepositCard({
  deposit,
  statuses,
  onOpenInvoice,
  compact = false,
}: {
  deposit: Deposit;
  statuses: Statuses;
  onOpenInvoice: (invoiceId: string) => void;
  compact?: boolean;
}) {
  const status = statuses[deposit.id];
  const done = status.kind !== "waiting";
  return (
    <li className={cn("space-y-2 px-4 py-3", done && "bg-slate-50/60")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
            done ? "bg-slate-100 text-slate-400" : "bg-emerald-50 text-emerald-700",
          )}
        >
          {deposit.kind === "check" ? (
            <Banknote className="size-4" aria-hidden />
          ) : (
            <Landmark className="size-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={cn(
                "text-base font-semibold tabular-nums",
                done ? "text-slate-500" : "text-slate-900",
              )}
            >
              {formatCentsExact(deposit.amountCents)}
            </span>
            <span className="text-sm text-slate-500">
              {kindName(deposit.kind)} · {bankName(deposit.bank)} · {shortDay(deposit.day)}
            </span>
          </p>
          {compact && done ? null : (
            <p className="truncate font-mono text-xs text-slate-500">
              {deposit.description}
              {deposit.memo ? ` · memo "${deposit.memo}"` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="pl-11">
        {status.kind === "waiting" ? (
          <Waiting deposit={deposit} statuses={statuses} />
        ) : status.kind === "matched" ? (
          <Matched deposit={deposit} invoiceIds={status.invoiceIds} by={status.by} statuses={statuses} onOpenInvoice={onOpenInvoice} />
        ) : status.kind === "payout" ? (
          <p className="text-sm text-slate-500">Stripe payout, already counted. Those invoices were paid through Stripe.</p>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            Not an invoice.
            <Button size="xs" variant="ghost" onClick={() => actions.undo(deposit.id)}>
              <Undo2 data-icon="inline-start" aria-hidden /> Undo
            </Button>
          </p>
        )}
      </div>
    </li>
  );
}

function Waiting({ deposit, statuses }: { deposit: Deposit; statuses: Statuses }) {
  const s = suggest(deposit, statuses);
  const [picking, setPicking] = useState(false);
  const dismiss = (
    <Button size="sm" variant="outline" onClick={() => actions.dismiss(deposit.id)}>
      <X data-icon="inline-start" aria-hidden /> Not an invoice
    </Button>
  );
  const pick = (
    <Button size="sm" variant="outline" onClick={() => setPicking((p) => !p)}>
      Pick an invoice
    </Button>
  );

  if (picking)
    return (
      <Picker
        deposit={deposit}
        statuses={statuses}
        onPick={(ids) => actions.match(deposit.id, ids)}
        onCancel={() => setPicking(false)}
      />
    );

  switch (s.kind) {
    case "one": {
      const inv = invoiceById(s.invoiceId);
      return (
        <Suggested>
          <p className="text-sm text-slate-700">
            Looks like <InvoiceWords invoice={inv} /> {daysAgo(inv.sentDay)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => actions.match(deposit.id, [inv.id])}>
              <CircleCheck data-icon="inline-start" aria-hidden /> Confirm
            </Button>
            {pick}
            {dismiss}
          </div>
        </Suggested>
      );
    }
    case "pair": {
      const [a, b] = s.invoiceIds.map(invoiceById);
      return (
        <Suggested>
          <p className="text-sm text-slate-700">
            Looks like two of {a.customerName}&rsquo;s: {a.number} {formatCentsExact(a.amountDueCents)} and{" "}
            {b.number} {formatCentsExact(b.amountDueCents)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => actions.match(deposit.id, s.invoiceIds)}>
              <CircleCheck data-icon="inline-start" aria-hidden /> Confirm both
            </Button>
            {pick}
            {dismiss}
          </div>
        </Suggested>
      );
    }
    case "several":
      return (
        <Suggested>
          <p className="text-sm text-slate-700">
            {s.invoiceIds.length} invoices are for this amount.
            {s.nameMatch ? " The name fits the first." : ""}
          </p>
          <ul className="divide-y overflow-hidden rounded-lg border bg-white">
            {s.invoiceIds.map((id) => {
              const inv = invoiceById(id);
              return (
                <li key={id} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 flex-1">
                    <InvoiceWords invoice={inv} /> {daysAgo(inv.sentDay)}
                    {id === s.nameMatch ? (
                      <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">name fits</span>
                    ) : null}
                  </span>
                  <Button size="sm" className="self-start" variant={id === s.nameMatch ? "default" : "outline"} onClick={() => actions.match(deposit.id, [id])}>
                    This one
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">{dismiss}</div>
        </Suggested>
      );
    case "alreadyPaid": {
      const inv = invoiceById(s.invoiceId);
      return (
        <Suggested>
          <p className="text-sm text-slate-700">
            <InvoiceWords invoice={inv} /> is for this amount, and you marked it paid{" "}
            {shortDay(inv.ownerPayment!.receivedOn)}. Attach this deposit to it?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => actions.match(deposit.id, [inv.id])}>
              <CircleCheck data-icon="inline-start" aria-hidden /> Attach
            </Button>
            <Button size="sm" variant="outline" onClick={() => actions.dismiss(deposit.id)}>
              Leave it
            </Button>
            {pick}
          </div>
        </Suggested>
      );
    }
    case "none":
      return (
        <Suggested muted>
          <p className="text-sm text-slate-600">No open invoice is for this amount.</p>
          <div className="flex flex-wrap gap-2">
            {pick}
            {dismiss}
          </div>
        </Suggested>
      );
  }
}

function Suggested({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border px-3 py-2.5",
        muted ? "border-slate-200 bg-slate-50" : "border-emerald-200 bg-emerald-50/60",
      )}
    >
      {children}
    </div>
  );
}

// Every open invoice, the nearest amount first, and a way to tick more than
// one when a deposit paid two.
function Picker({
  deposit,
  statuses,
  onPick,
  onCancel,
}: {
  deposit: Deposit;
  statuses: Statuses;
  onPick: (invoiceIds: string[]) => void;
  onCancel: () => void;
}) {
  const [ticked, setTicked] = useState<string[]>([]);
  const open = [...openInvoices(statuses)].sort(
    (a, b) =>
      Math.abs(a.amountDueCents - deposit.amountCents) - Math.abs(b.amountDueCents - deposit.amountCents),
  );
  const sum = ticked.reduce((n, id) => n + invoiceById(id).amountDueCents, 0);
  return (
    <div className="space-y-2 rounded-xl border bg-white px-3 py-2.5">
      <p className="text-sm text-slate-700">Which invoice did {formatCentsExact(deposit.amountCents)} pay? Tick two if it paid both.</p>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {open.map((inv) => {
          const on = ticked.includes(inv.id);
          return (
            <li key={inv.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setTicked((t) => (on ? t.filter((x) => x !== inv.id) : [...t, inv.id]))}
                  className="size-4 accent-slate-900"
                />
                <span className="min-w-0 flex-1">
                  <InvoiceWords invoice={inv} /> {daysAgo(inv.sentDay)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={ticked.length === 0} onClick={() => onPick(ticked)}>
          <CircleCheck data-icon="inline-start" aria-hidden /> Mark {ticked.length > 1 ? "both" : "it"} paid
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {ticked.length > 0 && sum !== deposit.amountCents ? (
          <span className="text-xs text-amber-800">
            Ticked {formatCentsExact(sum)}, deposit {formatCentsExact(deposit.amountCents)}. Marked paid anyway.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Matched({
  deposit,
  invoiceIds,
  by,
  statuses,
  onOpenInvoice,
}: {
  deposit: Deposit;
  invoiceIds: string[];
  by: "you" | "itself";
  statuses: Statuses;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {invoiceIds.map((id) => {
        const inv = invoiceById(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onOpenInvoice(id)}
            className="inline-flex items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-slate-100"
          >
            <span className="text-slate-700">
              {inv.number} · {inv.customerName}
              {inv.ownerPayment ? " (was marked paid by you)" : ""}
            </span>
            <StandingChip standing={standingOf(inv, statuses)} />
          </button>
        );
      })}
      <span className="text-slate-500">{by === "itself" ? "Marked paid by itself." : "Confirmed by you."}</span>
      {deposit.id === "d9" ? null : (
        <Button size="xs" variant="ghost" onClick={() => actions.undo(deposit.id)}>
          <Undo2 data-icon="inline-start" aria-hidden /> Undo
        </Button>
      )}
    </div>
  );
}

export function InvoiceWords({ invoice }: { invoice: Invoice }) {
  return (
    <span className="text-slate-900">
      <span className="font-medium">{invoice.number}</span> · {invoice.kind} · {invoice.customerName} ·{" "}
      <span className="tabular-nums">{formatCentsExact(invoice.amountDueCents)}</span>
    </span>
  );
}

export function daysAgo(day: string): string {
  const n = daysBetween(day, Today);
  return n === 0 ? "sent today" : n === 1 ? "sent yesterday" : `sent ${n} days ago`;
}

// ── The invoice chip, as the real one draws it ───────────────────────────
export function StandingChip({ standing }: { standing: Standing }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
        standing === "unpaid" && "border-sky-300 bg-sky-50 text-sky-900",
        standing === "overdue" && "border-red-300 bg-red-50 text-red-900",
        standing === "paid" && "border-emerald-300 bg-emerald-50 text-emerald-900",
      )}
    >
      {standing === "unpaid" ? "Unpaid" : standing === "overdue" ? "Overdue" : "Paid"}
    </span>
  );
}

// ── How the invoice's row reads once a deposit is on it ──────────────────
export function paidLine(invoice: Invoice, statuses: Statuses): string | null {
  const dep = matchedBy(invoice.id, statuses);
  if (dep) return `Paid ${shortDay(dep.day)} by ${kindName(dep.kind)}`;
  if (invoice.ownerPayment) return `Paid ${shortDay(invoice.ownerPayment.receivedOn)}, marked by you`;
  return null;
}

// ── Relay needs a login again ────────────────────────────────────────────
export function ReconnectLine({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}
    >
      <span className="flex-1">Relay needs a login again. Nothing new from it since Sept 21.</span>
      <Button size="sm" variant="outline">
        <RefreshCw data-icon="inline-start" aria-hidden /> Reconnect
      </Button>
    </div>
  );
}
