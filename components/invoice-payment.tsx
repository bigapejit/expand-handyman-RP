"use client";

import { useMutation } from "convex/react";
import { CircleCheck, Undo2 } from "lucide-react";
import { useState } from "react";

import type { PanelInvoice } from "@/components/invoice-sending";
import { FieldHeading, FieldLabel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { stampDate } from "@/lib/invoice-paper";
import { pacificDay } from "@/lib/invoice-standing";
import { errorMessage } from "@/lib/utils";

// Under the sending block, what the invoice's money came to: **Mark paid**
// with the day it arrived, today unless changed; once paid, the day and
// Mark unpaid, which takes the stamp back off; once void, when, and the
// owner's reason. A draft has nothing to say here. Nobody is emailed by
// anything in this block.
export function InvoicePayment({ invoice }: { invoice: PanelInvoice }) {
  if (invoice.state === "draft") return null;
  if (invoice.state === "void") return <Voided invoice={invoice} />;
  return (
    <div className="space-y-2">
      <FieldHeading>Payment</FieldHeading>
      {invoice.payment ? (
        <Paid invoice={invoice} payment={invoice.payment} />
      ) : invoice.money.amountDueCents === 0 ? (
        <p className="text-sm text-slate-600">Nothing is due on it, so it reads Paid.</p>
      ) : (
        <MarkPaid invoice={invoice} />
      )}
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

function Paid({
  invoice,
  payment,
}: {
  invoice: PanelInvoice;
  payment: NonNullable<PanelInvoice["payment"]>;
}) {
  const markUnpaid = useMutation(api.invoices.markUnpaid);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const byHand = payment.source === "owner";

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
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        {byHand
          ? `Paid on ${stampDate(payment.receivedOn)}.`
          : `Paid online on ${stampDate(payment.receivedOn)}. A payment made online can't be marked unpaid here.`}
      </p>
      {byHand ? (
        <Button variant="outline" disabled={busy} onClick={() => void takeBack()}>
          <Undo2 data-icon="inline-start" aria-hidden /> {busy ? "Marking unpaid…" : "Mark unpaid"}
        </Button>
      ) : null}
    </>
  );
}

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
    </div>
  );
}
