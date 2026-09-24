"use client";

import { useMutation, useQuery } from "convex/react";
import { CheckCheck, Plus } from "lucide-react";
import { useState } from "react";

import { HubLoading } from "@/components/customer-hub-shell";
import { InvoiceRow } from "@/components/invoice-row";
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
import type { Id } from "@/convex/_generated/dataModel";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { formatCentsExact } from "@/lib/money";
import { errorMessage } from "@/lib/utils";

// An approved proposal's Invoices section, in its panel: the proposal's own
// invoices, oldest first, each with its number, kind, chip and amount due,
// opening the invoice panel in the proposal's place. Under the list, **Job
// done** raises the final invoice while the proposal has none standing, and
// New invoice starts a typed one; each opens the draft it made. Only an
// approved proposal shows any of it.
export function ProposalInvoices({
  proposalId,
  onOpen,
}: {
  proposalId: Id<"proposals">;
  onOpen: (invoiceId: string) => void;
}) {
  const today = usePacificToday();
  const invoices = useQuery(api.invoices.forProposal, { proposalId, today });
  // What Job done would make, or null while it is not offered.
  const prefill = useQuery(api.invoices.finalPrefill, { proposalId });
  const jobDone = useMutation(api.invoices.jobDone);
  const createTyped = useMutation(api.invoices.createTyped);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");

  const make = async (run: () => Promise<Id<"invoices">>) => {
    setConfirming(false);
    setBusy(true);
    try {
      onOpen(await run());
      setRefusal("");
    } catch (err) {
      setRefusal(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const raiseFinal = () => make(() => jobDone({ proposalId }));

  // The balance before tax: nothing left, or a credit, is asked about first.
  const balanceCents = prefill?.money.subtotalCents ?? null;
  const asksFirst = balanceCents !== null && balanceCents <= 0;

  return (
    <div className="space-y-2">
      <FieldHeading>Invoices</FieldHeading>
      {refusal ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {refusal}
        </p>
      ) : null}
      {invoices === undefined ? (
        <HubLoading label="Loading invoices" />
      ) : invoices.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-slate-500">
          No invoices yet.
        </p>
      ) : (
        <ol className="overflow-hidden rounded-xl border">
          {invoices.map((invoice) => (
            <InvoiceRow
              key={invoice.invoiceId}
              invoice={invoice}
              compact
              open={() => onOpen(invoice.invoiceId)}
            />
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        {prefill ? (
          <Button
            disabled={busy}
            onClick={() => (asksFirst ? setConfirming(true) : void raiseFinal())}
          >
            <CheckCheck data-icon="inline-start" aria-hidden /> Job done
          </Button>
        ) : null}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void make(() => createTyped({ proposalId }))}
        >
          <Plus data-icon="inline-start" aria-hidden /> New invoice
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {balanceCents === 0 ? "Nothing is left to bill" : "More was billed than the price"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {balanceCents === 0
                ? "The invoices already sent on this proposal come to its whole price, so the final invoice starts at $0.00. Add lines for any extras before you send it; sent at $0.00, it reads Paid."
                : `The invoices already sent on this proposal come to more than its price, so the final invoice starts as a credit of ${formatCentsExact(-(prefill?.money.amountDueCents ?? 0))}. Once it is sent, refund the customer by hand and mark it paid.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void raiseFinal()}>
              Make the final invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
