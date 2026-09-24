"use client";

import { useQuery } from "convex/react";
import { Eye } from "lucide-react";

import { HubLoading } from "@/components/customer-hub-shell";
import { InvoiceChip } from "@/components/invoice-chips";
import { InvoiceSending, type PanelInvoice } from "@/components/invoice-sending";
import { FieldHeading, SidePanel, useSidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { usePacificToday } from "@/hooks/use-pacific-today";
import { invoiceTaxLabel } from "@/lib/invoice-paper";
import { InvoicePanelParam, invoicePaperHref } from "@/lib/invoices";
import { formatCentsExact } from "@/lib/money";
import { cn } from "@/lib/utils";

// The **Invoice panel**: one invoice slid in over a hub tab, held in
// `?invoice=<id>` (lib/side-panel.ts) so a reload, a copied link and Back all
// mean the same thing. The Invoices tab opens it over its list, and the
// Proposals tab over an approved proposal's panel, which comes back when this
// one closes. A link naming no invoice, or another customer's, just shows the
// tab.
export function InvoicePanelHost({ customerId }: { customerId: string }) {
  const { openId, close } = useSidePanel(InvoicePanelParam);
  if (!openId) return null;
  return (
    <OpenInvoice key={openId} invoiceId={openId} customerId={customerId} onClose={close} />
  );
}

function OpenInvoice({
  invoiceId,
  customerId,
  onClose,
}: {
  invoiceId: string;
  customerId: string;
  onClose: () => void;
}) {
  const today = usePacificToday();
  const invoice = useQuery(api.invoices.panel, { invoiceId, today });

  if (invoice === undefined) {
    return (
      <SidePanel title="Invoice" onClose={onClose}>
        <HubLoading label="Loading invoice" />
      </SidePanel>
    );
  }
  if (invoice === null || invoice.customerId !== customerId) return null;
  return <InvoicePanel invoice={invoice} onClose={onClose} />;
}

// Everything about one invoice: its header, its lines and money, the sending
// block, and a footer. Built up by the tickets after this one: a draft's
// lines become editable with Send beside them; Mark paid sits under the
// sending block; Download, Void and Delete join View paper in the footer.
function InvoicePanel({ invoice, onClose }: { invoice: PanelInvoice; onClose: () => void }) {
  return (
    <SidePanel
      title={invoice.title}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{invoice.customerName}</span>
          <span aria-hidden>·</span>
          <span>{invoice.proposalCode}</span>
          <InvoiceChip state={invoice.state} standing={invoice.standing} />
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        <InvoiceLines invoice={invoice} />

        <InvoiceSending invoice={invoice} />

        <div className="flex flex-wrap items-center gap-1 border-t pt-4">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a href={invoicePaperHref(invoice.invoiceId)} target="_blank" rel="noreferrer" />
            }
          >
            <Eye data-icon="inline-start" aria-hidden /> View paper
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

// The lines as the paper prints them, before tax, then Subtotal, Sales Tax at
// the invoice's rate and Amount Due. A void invoice keeps its lines, with the
// amount due struck through, as its paper does.
function InvoiceLines({ invoice }: { invoice: PanelInvoice }) {
  const { money } = invoice;
  return (
    <div className="space-y-2">
      <FieldHeading>Lines</FieldHeading>
      <div className="overflow-hidden rounded-xl border text-sm">
        {invoice.lines.length === 0 ? (
          <p className="px-3 py-3 text-slate-500">No lines yet.</p>
        ) : (
          <ol className="divide-y">
            {invoice.lines.map((line, index) => (
              <li key={index} className="flex items-start justify-between gap-4 px-3 py-2">
                <span className="min-w-0 text-slate-900">{line.description}</span>
                <span className="shrink-0 tabular-nums text-slate-900">
                  {formatCentsExact(line.cents)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <dl className="space-y-1 border-t bg-slate-50/60 px-3 py-3">
          <div className="flex justify-between gap-6 text-slate-500">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatCentsExact(money.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between gap-6 text-slate-500">
            <dt>{invoiceTaxLabel(invoice.taxRate)}</dt>
            <dd className="tabular-nums">{formatCentsExact(money.taxCents)}</dd>
          </div>
          <div className="flex justify-between gap-6 border-t pt-2 font-semibold text-slate-900">
            <dt>Amount due</dt>
            <dd className={cn("tabular-nums", invoice.state === "void" && "line-through")}>
              {formatCentsExact(money.amountDueCents)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
