"use client";

import { useQuery } from "convex/react";

import { HubLoading } from "@/components/customer-hub-shell";
import { InvoiceRow } from "@/components/invoice-row";
import { FieldHeading } from "@/components/side-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePacificToday } from "@/hooks/use-pacific-today";

// An approved proposal's Invoices section, in its panel: the proposal's own
// invoices, oldest first, each with its number, kind, chip and amount due,
// opening the invoice panel in the proposal's place. Only an approved
// proposal shows it; Job done and New invoice come to sit under the list.
export function ProposalInvoices({
  proposalId,
  onOpen,
}: {
  proposalId: Id<"proposals">;
  onOpen: (invoiceId: string) => void;
}) {
  const today = usePacificToday();
  const invoices = useQuery(api.invoices.forProposal, { proposalId, today });

  return (
    <div className="space-y-2">
      <FieldHeading>Invoices</FieldHeading>
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
    </div>
  );
}
