"use client";

import { useQuery } from "convex/react";

import { HubEmpty, HubLoading, HubSection } from "@/components/customer-hub-shell";
import { InvoicePanelHost } from "@/components/invoice-panel";
import { InvoiceRow } from "@/components/invoice-row";
import { useSidePanel } from "@/components/side-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { InvoicePanelParam, invoiceSentLabel } from "@/lib/invoices";

// The customer page's Invoices tab: every invoice for the customer, newest
// first, drafts and void included. For reading and sending only: an invoice
// starts from its proposal, so there is no New invoice here. A row slides the
// invoice panel in over the list.
export function CustomerInvoices({ customerId }: { customerId: string }) {
  const today = usePacificToday();
  const invoices = useQuery(api.invoices.forCustomer, {
    customerId: customerId as Id<"customers">,
    today,
  });
  const { open } = useSidePanel(InvoicePanelParam);
  const count = invoices?.length ?? 0;

  return (
    <HubSection
      title="Invoices"
      description={
        count
          ? `${count === 1 ? "1 invoice" : `${count} invoices`} for this customer's approved proposals.`
          : "Invoices for this customer's approved proposals."
      }
    >
      {invoices === undefined ? (
        <HubLoading label="Loading invoices" />
      ) : invoices.length === 0 ? (
        <HubEmpty>No invoices yet. They come from approved proposals.</HubEmpty>
      ) : (
        <ol>
          {invoices.map((invoice) => (
            <InvoiceRow
              key={invoice.invoiceId}
              invoice={invoice}
              subtitle={invoiceSentLabel(invoice.sentAt)}
              open={() => open(invoice.invoiceId)}
            />
          ))}
        </ol>
      )}
      <InvoicePanelHost customerId={customerId} />
    </HubSection>
  );
}
