"use client";

import { CircleCheck, Undo2 } from "lucide-react";

import { FieldHeading, FieldLabel, SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCentsExact } from "@/lib/money";

import { StandingChip } from "./pieces";
import {
  actions,
  bankName,
  howLanded,
  invoiceById,
  kindName,
  matchedBy,
  shortDay,
  standingOf,
  suggest,
  Today,
  waitingDeposits,
  type Invoice,
  type Statuses,
} from "./store";

// PROTOTYPE (#130): throwaway. The invoice panel, opened with `?invoice=` as
// the real one is, cut down to the part this ticket is about: what the
// Payment block reads once a deposit from the bank is on the invoice, beside
// "marked by you" as the Pay now spec (#121) writes it.
export function InvoicePanelPrototype({
  invoiceId,
  statuses,
  onClose,
}: {
  invoiceId: string;
  statuses: Statuses;
  onClose: () => void;
}) {
  const invoice = invoiceById(invoiceId);
  return (
    <SidePanel
      title={`${invoice.number} · ${invoice.kind}`}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{invoice.customerName}</span>
          <StandingChip standing={standingOf(invoice, statuses)} />
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        <div className="space-y-2">
          <FieldHeading>Amount Due</FieldHeading>
          <p className="text-lg font-semibold tabular-nums text-slate-900">
            {formatCentsExact(invoice.amountDueCents)}
            <span className="ml-2 text-sm font-normal text-slate-500">Sent {shortDay(invoice.sentDay)}</span>
          </p>
        </div>
        <div className="space-y-2">
          <FieldHeading>Payment</FieldHeading>
          <PaymentBlock invoice={invoice} statuses={statuses} />
        </div>
      </div>
    </SidePanel>
  );
}

function PaymentBlock({ invoice, statuses }: { invoice: Invoice; statuses: Statuses }) {
  const deposit = matchedBy(invoice.id, statuses);
  const withOthers = deposit
    ? (statuses[deposit.id] as { invoiceIds: string[] }).invoiceIds.filter((id) => id !== invoice.id)
    : [];

  if (deposit && invoice.ownerPayment)
    // Marked by hand first, the deposit attached after.
    return (
      <>
        <Green>Paid {shortDay(invoice.ownerPayment.receivedOn)}, marked by you.</Green>
        <DepositLine
          text={`The ${kindName(deposit.kind).toLowerCase()} of ${formatCentsExact(deposit.amountCents)} landed in ${bankName(deposit.bank)} ${shortDay(deposit.day)}: ${deposit.description}.`}
        />
        <Button variant="outline" size="sm" onClick={() => actions.undo(deposit.id)}>
          <Undo2 data-icon="inline-start" aria-hidden /> Detach the deposit
        </Button>
      </>
    );

  if (deposit)
    return (
      <>
        <Green>
          Paid {shortDay(deposit.day)}, {howLanded(deposit)}
          {withOthers.length ? `, together with ${withOthers.map((id) => invoiceById(id).number).join(" and ")}` : ""}.
        </Green>
        <DepositLine
          text={`${deposit.description}${deposit.memo ? ` · memo "${deposit.memo}"` : ""} · ${formatCentsExact(deposit.amountCents)}`}
        />
        <Button variant="outline" size="sm" onClick={() => actions.undo(deposit.id)}>
          <Undo2 data-icon="inline-start" aria-hidden /> Not this invoice
        </Button>
      </>
    );

  if (invoice.ownerPayment)
    return (
      <>
        <Green>Paid {shortDay(invoice.ownerPayment.receivedOn)}, marked by you.</Green>
        <Button variant="outline" size="sm">
          <Undo2 data-icon="inline-start" aria-hidden /> Mark unpaid
        </Button>
      </>
    );

  // Unpaid. A deposit waiting in the bank that fits this invoice is offered
  // here too, so the owner never has to go find it.
  const offered = waitingDeposits(statuses).find((d) => {
    const s = suggest(d, statuses);
    return (
      (s.kind === "one" && s.invoiceId === invoice.id) ||
      (s.kind === "pair" && s.invoiceIds.includes(invoice.id)) ||
      (s.kind === "several" && s.invoiceIds.includes(invoice.id))
    );
  });
  const offer = offered ? suggest(offered, statuses) : null;
  return (
    <>
      {offered && offer ? (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-sm text-slate-700">
          <p>
            {formatCentsExact(offered.amountCents)} landed in {bankName(offered.bank)} {shortDay(offered.day)} by{" "}
            {kindName(offered.kind)}
            {offer.kind === "pair" ? ", enough for this and the other one" : offer.kind === "several" ? ", and this is one of the invoices for that amount" : ""}
            . <span className="font-mono text-xs text-slate-500">{offered.description}</span>
          </p>
          <Button
            size="sm"
            onClick={() =>
              actions.match(offered.id, offer.kind === "pair" ? offer.invoiceIds : [invoice.id])
            }
          >
            <CircleCheck data-icon="inline-start" aria-hidden />{" "}
            {offer.kind === "pair" ? "Confirm both" : "Confirm"}
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-slate-600">
        Once the money is in, mark it paid. Its link then shows the paper stamped PAID.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <FieldLabel htmlFor={`mi-received-${invoice.id}`}>Money arrived on</FieldLabel>
          <Input id={`mi-received-${invoice.id}`} type="date" className="w-44" defaultValue={Today} />
        </div>
        <Button>
          <CircleCheck data-icon="inline-start" aria-hidden /> Mark paid
        </Button>
      </div>
    </>
  );
}

function Green({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      {children}
    </p>
  );
}

function DepositLine({ text }: { text: string }) {
  return <p className="font-mono text-xs text-slate-500">{text}</p>;
}
