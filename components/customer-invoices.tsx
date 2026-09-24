"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { HubEmpty, HubLoading, HubSection } from "@/components/customer-hub-shell";
import { InvoiceChip } from "@/components/invoice-chips";
import { InvoicePanelHost } from "@/components/invoice-panel";
import { useSidePanel } from "@/components/side-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { InvoicePanelParam, invoiceSentLabel } from "@/lib/invoices";
import { formatCentsExact } from "@/lib/money";
import { cn } from "@/lib/utils";

export type InvoiceListRow = FunctionReturnType<typeof api.invoices.forCustomer>[number];

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
          : "Bills for this customer's approved proposals."
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

// One invoice in a list inside a hub page or a panel: its title and chip, a
// line under it, and the amount due on the right. A void invoice is struck
// through, as it is everywhere it is listed.
export function InvoiceRow({
  invoice,
  subtitle,
  open,
  compact = false,
}: {
  invoice: Pick<InvoiceListRow, "title" | "state" | "standing" | "amountDueCents">;
  subtitle?: string;
  open: () => void;
  // Inside a panel, where the row sits in a bordered list of its own.
  compact?: boolean;
}) {
  const voided = invoice.state === "void";
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={open}
        className={cn(
          "flex w-full items-center gap-3 text-left transition-colors hover:bg-slate-50",
          compact ? "px-3 py-2 text-sm" : "px-5 py-3",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "truncate font-medium text-slate-900",
                voided && "text-slate-500 line-through",
              )}
            >
              {invoice.title}
            </span>
            <InvoiceChip state={invoice.state} standing={invoice.standing} />
          </span>
          {subtitle ? (
            <span className="block truncate text-xs text-slate-500">{subtitle}</span>
          ) : null}
        </span>
        <span
          className={cn(
            "shrink-0 font-semibold text-slate-900 tabular-nums",
            compact && "font-medium",
            voided && "text-slate-400 line-through",
          )}
        >
          {formatCentsExact(invoice.amountDueCents)}
        </span>
      </button>
    </li>
  );
}
