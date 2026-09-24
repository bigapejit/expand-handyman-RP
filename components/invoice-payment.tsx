"use client";

import { useMutation } from "convex/react";
import { CircleCheck, ExternalLink, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { PanelInvoice } from "@/components/invoice-sending";
import { FieldHeading, FieldLabel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { stampDate } from "@/lib/invoice-paper";
import { pacificDay } from "@/lib/invoice-standing";
import {
  onItsWayUnowed,
  ownerOnItsWay,
  PaidTwice,
  paidSentence,
  stripeNoteSentence,
} from "@/lib/pay-now";
import { errorMessage } from "@/lib/utils";

// Under the sending block, what the invoice's money came to, every
// **Payment** in one green sentence however it arrived (lib/pay-now.ts,
// `paidSentence`): the owner's own with Mark unpaid under it, which takes the
// stamp back off, and a Stripe one with where it lives in Stripe, since money
// that came through Stripe only ever goes back there. More than one is money
// that came twice. While a bank payment is **Payment on its way** the amber box
// stands where Mark paid would, so the record and the money cannot disagree;
// and it stands under the payments too, since two sessions minted before
// either completed can leave one paid and the other still confirming, which
// the owner must see before it lands as a second payment. After Stripe took
// one back, the grey note says why the invoice is owed again, above Mark
// paid. Once void, when and the owner's reason, and any Stripe payment that
// landed on it anyway or is still on its way to it. A draft has nothing to
// say here. Nobody is emailed by anything in this block.
export function InvoicePayment({ invoice }: { invoice: PanelInvoice }) {
  if (invoice.state === "draft") return null;
  if (invoice.state === "void") return <Voided invoice={invoice} />;
  const paid = invoice.payments.length > 0;
  return (
    <div className="space-y-2">
      <FieldHeading>Payment</FieldHeading>
      {paid ? <Paid invoice={invoice} /> : null}
      {invoice.onItsWay ? (
        <OnItsWay
          onItsWay={invoice.onItsWay}
          unowed={onItsWayUnowed({ paid, void: false })}
        />
      ) : null}
      {!paid && !invoice.onItsWay ? (
        <>
          {invoice.note ? <StripeNoteBox note={invoice.note} /> : null}
          {invoice.money.amountDueCents === 0 ? (
            <p className="text-sm text-slate-600">Nothing is due on it, so it reads Paid.</p>
          ) : (
            <MarkPaid invoice={invoice} />
          )}
        </>
      ) : null}
    </div>
  );
}

function MarkPaid({ invoice }: { invoice: PanelInvoice }) {
  const markPaid = useMutation(api.invoices.markPaid);
  const today = usePacificToday();
  // Today until the owner picks another day, and still today after midnight
  // if they never did.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const credit = invoice.money.amountDueCents < 0;
  const fieldId = `received-on-${invoice.invoiceId}`;

  const record = async () => {
    setBusy(true);
    try {
      await markPaid({ invoiceId: invoice.invoiceId, receivedOn: day });
      setRefusal("");
    } catch (err) {
      setRefusal(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {refusal ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {refusal}
        </p>
      ) : null}
      <p className="text-sm text-slate-600">
        {credit
          ? "This is a credit. Refund it by hand, then mark it paid on the day you did."
          : "Once the money is in, mark it paid. Its link then shows the paper stamped PAID."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <FieldLabel htmlFor={fieldId}>{credit ? "Refunded on" : "Money arrived on"}</FieldLabel>
          <Input
            id={fieldId}
            type="date"
            className="w-44"
            value={day}
            max={today}
            required
            onChange={(event) => setPicked(event.target.value || null)}
          />
        </div>
        <Button disabled={busy || !day} onClick={() => void record()}>
          <CircleCheck data-icon="inline-start" aria-hidden />{" "}
          {busy ? "Marking paid…" : "Mark paid"}
        </Button>
      </div>
    </>
  );
}

type PanelPayment = PanelInvoice["payments"][number];

// Each payment, earliest first, in its green sentence with what can be done
// about it under it.
function Paid({ invoice }: { invoice: PanelInvoice }) {
  const markUnpaid = useMutation(api.invoices.markUnpaid);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");

  const takeBack = async () => {
    setBusy(true);
    try {
      await markUnpaid({ invoiceId: invoice.invoiceId });
      setRefusal("");
    } catch (err) {
      setRefusal(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {refusal ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {refusal}
        </p>
      ) : null}
      <ul className="space-y-3">
        {invoice.payments.map((payment, index) => (
          <li key={index} className="space-y-2">
            <PaidBox payment={payment} />
            {payment.source === "owner" ? (
              <Button variant="outline" disabled={busy} onClick={() => void takeBack()}>
                <Undo2 data-icon="inline-start" aria-hidden />{" "}
                {busy ? "Marking unpaid…" : "Mark unpaid"}
              </Button>
            ) : (
              <StripeLink href={payment.stripeUrl}>See the payment in Stripe</StripeLink>
            )}
          </li>
        ))}
      </ul>
      {invoice.payments.length > 1 ? (
        <p className="text-sm font-medium text-slate-900">{PaidTwice}</p>
      ) : null}
    </>
  );
}

function PaidBox({
  payment,
  onVoidInvoice = false,
}: {
  payment: PanelPayment;
  onVoidInvoice?: boolean;
}) {
  return (
    <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      {paidSentence(payment, onVoidInvoice)}
    </p>
  );
}

// No Mark paid and no Void while the bank confirms: the money is coming, and
// the invoice reads Paid by itself once it lands. On an invoice already paid
// or void, a line under the words says the money is more than was owed
// (`onItsWayUnowed`).
function OnItsWay({
  onItsWay,
  unowed,
}: {
  onItsWay: NonNullable<PanelInvoice["onItsWay"]>;
  unowed: string | null;
}) {
  const { head, body } = ownerOnItsWay(onItsWay);
  return (
    <>
      <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <p>
          <strong className="font-semibold">{head}</strong> {body}
        </p>
        {unowed ? <p className="font-medium">{unowed}</p> : null}
      </div>
      <StripeLink href={onItsWay.stripeUrl}>See it in Stripe</StripeLink>
    </>
  );
}

// A returned, refunded or lost Stripe payment, kept in grey until the invoice
// is paid, on its way again or void, so the owner remembers why it is owed
// again without a chip of its own.
function StripeNoteBox({ note }: { note: NonNullable<PanelInvoice["note"]> }) {
  return (
    <div className="space-y-2 rounded-xl border bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <p>{stripeNoteSentence(note)}</p>
      <StripeLink href={note.stripeUrl}>See it in Stripe</StripeLink>
    </div>
  );
}

// Where a Stripe payment lives in Stripe's dashboard, in a tab of its own:
// refunds and disputes are the owner's to handle there, never here.
function StripeLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<a href={href} target="_blank" rel="noreferrer" />}
    >
      {children} <ExternalLink data-icon="inline-end" aria-hidden />
    </Button>
  );
}

// A void invoice owes nothing, but a Stripe payment may still have landed on
// it, voided while the customer was on Stripe's page, or a bank payment be
// on its way to it: that money moved, so it is shown with the word to refund
// it rather than hidden.
function Voided({ invoice }: { invoice: PanelInvoice }) {
  return (
    <div className="space-y-2">
      <FieldHeading>Void</FieldHeading>
      <div className="space-y-1 rounded-xl border bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <p>
          {invoice.voidedAt !== null
            ? `Voided on ${stampDate(pacificDay(invoice.voidedAt))}. `
            : "Voided. "}
          Its link shows the paper stamped VOID, with nothing due.
        </p>
        {invoice.voidReason ? (
          <p className="text-slate-500">Reason (only you see it): {invoice.voidReason}</p>
        ) : null}
      </div>
      {invoice.payments.map((payment, index) => (
        <div key={index} className="space-y-2">
          <PaidBox payment={payment} onVoidInvoice />
          {payment.source === "stripe" ? (
            <StripeLink href={payment.stripeUrl}>See the payment in Stripe</StripeLink>
          ) : null}
        </div>
      ))}
      {invoice.onItsWay ? (
        <OnItsWay
          onItsWay={invoice.onItsWay}
          unowed={onItsWayUnowed({ paid: invoice.payments.length > 0, void: true })}
        />
      ) : null}
    </div>
  );
}
