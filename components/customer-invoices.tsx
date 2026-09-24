"use client";

import { useQuery } from "convex/react";

import { HubEmpty, HubLoading, HubSection } from "@/components/customer-hub-shell";
import type { HubScope } from "@/components/hub-scope";
import { InvoicePanelHost } from "@/components/invoice-panel";
import { InvoiceRow } from "@/components/invoice-row";
import { useSidePanel } from "@/components/side-panel";
import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { InvoicePanelParam, invoiceSentLabel } from "@/lib/invoices";

// The Invoices tab: every invoice at the site, or on the customer page every
// invoice for the customer, newest first, drafts and void included. For
// reading and sending only: an invoice starts from its proposal, so there is
// no New invoice here. A row slides the invoice panel in over the list.
export function CustomerInvoices({ scope }: { scope: HubScope }) {
  const { siteId, customerId } = scope;
  const today = usePacificToday();
  const atSite = useQuery(api.invoices.forSite, siteId ? { siteId, today } : "skip");
  const acrossSites = useQuery(
    api.invoices.forCustomer,
    customerId ? { customerId, today } : "skip",
  );
  const invoices = siteId ? atSite : acrossSites;
  const { open } = useSidePanel(InvoicePanelParam);
  const count = invoices?.length ?? 0;
  const whose = siteId ? "this site's" : "this customer's";

  return (
    <HubSection
      title="Invoices"
      description={
        count
          ? `${count === 1 ? "1 invoice" : `${count} invoices`} for ${whose} approved proposals.`
          : `Invoices for ${whose} approved proposals.`
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
      <InvoicePanelHost scope={scope} />
    </HubSection>
  );
}
