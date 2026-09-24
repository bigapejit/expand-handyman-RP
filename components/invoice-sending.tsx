"use client";

import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { RotateCcw, Send } from "lucide-react";
import { useState } from "react";

import { CopyLinkButton, useAppOrigin } from "@/components/copy-link";
import { LinkHistory } from "@/components/proposal-sending";
import { FieldHeading } from "@/components/side-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { invoiceSendBlockerMessage } from "@/lib/invoices";
import { emailFailed, linkEmailLabel, signingPath } from "@/lib/signing-link";
import { cn, errorMessage } from "@/lib/utils";

export type PanelInvoice = NonNullable<FunctionReturnType<typeof api.invoices.panel>>;

// The invoice panel's sending block, copied from the proposal's
// (proposal-sending.tsx): a draft's **Send**, with every reason it would be
// refused listed before it is pressed; once sent, and once void too, the live
// **Invoice link** to copy, what became of its email, **Re-send**, and every
// link the invoice has had. The link is always there to copy, and said out
// loud when the email did not go, because then the owner is the only way it
// reaches the customer.
export function InvoiceSending({
  invoice,
  amountUnreadable = false,
}: {
  invoice: PanelInvoice;
  // An amount in the draft's table that cannot be read, and so is not stored:
  // sending now would send the amount it replaced.
  amountUnreadable?: boolean;
}) {
  if (invoice.state === "draft")
    return (
      <div className="space-y-2">
        <FieldHeading>Send</FieldHeading>
        <SendDraft invoice={invoice} amountUnreadable={amountUnreadable} />
      </div>
    );
  return (
    <div className="space-y-2">
      <FieldHeading>Invoice link</FieldHeading>
      <SentLink invoice={invoice} />
      {invoice.links.length > 0 ? <LinkHistory links={invoice.links} /> : null}
    </div>
  );
}

function SendDraft({
  invoice,
  amountUnreadable,
}: {
  invoice: PanelInvoice;
  amountUnreadable: boolean;
}) {
  const send = useAction(api.invoices.send);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState("");
  const reasons = [
    ...(amountUnreadable ? [UnreadableAmount] : []),
    ...invoice.sendBlockers.map(invoiceSendBlockerMessage),
  ];
  const blocked = reasons.length > 0;

  const sendNow = async () => {
    setConfirming(false);
    setSending(true);
    try {
      await send({ invoiceId: invoice.invoiceId });
      setRefusal("");
    } catch (err) {
      setRefusal(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {refusal ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {refusal}
        </p>
      ) : null}
      {blocked ? (
        <ul className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">
          Gives it the next invoice number and emails {invoice.customerEmail} a private link
          to it. From then on its lines can&rsquo;t change.
        </p>
      )}
      <Button disabled={blocked || sending} onClick={() => setConfirming(true)}>
        <Send data-icon="inline-start" aria-hidden /> {sending ? "Sending…" : "Send invoice"}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {invoice.customerEmail} gets an email with a private link to it, due on
              receipt. It takes the next invoice number, and its lines are fixed as they stand
              now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep drafting</AlertDialogCancel>
            <AlertDialogAction onClick={() => void sendNow()}>Send invoice</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const UnreadableAmount = "An amount on this invoice isn't a figure yet.";

function SentLink({ invoice }: { invoice: PanelInvoice }) {
  const resend = useAction(api.invoices.resend);
  const origin = useAppOrigin();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const live = invoice.links.find((link) => link.endedAt === null) ?? null;
  const url =
    invoice.liveUrl ??
    (invoice.liveToken && origin ? `${origin}${signingPath(invoice.liveToken)}` : "");

  const resendNow = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      await resend({ invoiceId: invoice.invoiceId });
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
      {live ? (
        <div className="space-y-2 rounded-xl border px-3 py-3 text-sm">
          <p className="flex flex-wrap gap-x-2 text-xs text-slate-500">
            <span className="min-w-0 break-all text-slate-900">{live.sentTo}</span>
            <span
              className={cn(emailFailed(live.email) && "font-medium text-amber-800")}
            >
              {linkEmailLabel(live.email)}
            </span>
          </p>
          {emailFailed(live.email) ? (
            <p className="text-sm text-amber-900">
              The link works: copy it and send it to {live.sentTo} yourself.
            </p>
          ) : null}
          {url ? (
            <>
              <p className="break-all rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 select-all">
                {url}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <CopyLinkButton url={url} />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* A void invoice is re-sent too: its link opens the paper stamped
          VOID (invoices.resendWithLink). */}
      {invoice.state !== "draft" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || invoice.customerEmail === null}
            onClick={() => setConfirming(true)}
          >
            <RotateCcw data-icon="inline-start" aria-hidden /> {busy ? "Re-sending…" : "Re-send"}
          </Button>
        </div>
      ) : null}
      {invoice.state !== "draft" && invoice.customerEmail === null ? (
        <p className="text-xs text-slate-500">
          The customer has no email address now. Add one to re-send.
        </p>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-send {invoice.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {invoice.customerEmail} gets the same invoice with a fresh link. Nothing on it
              changes, not even its date.
              {live ? ` The link sent to ${live.sentTo} stops working.` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void resendNow()}>Re-send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
