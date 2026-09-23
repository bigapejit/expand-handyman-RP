// The **Invoice paper** (CONTEXT.md) as data: everything the sheet prints,
// read from a sent invoice's row and the settings, and nothing else. The
// component (components/invoice-paper.tsx) works out the money from the lines
// and the rate with lib/invoice-money.ts, so the paper and every list agree.

import type { InvoiceLine } from "./invoice-money";

export type PaperInvoice = {
  // The **Invoice number** as printed, `INV-1001`.
  number: string;
  // The day it was sent, which is its due date: every invoice is due on
  // receipt.
  sentAt: number;
  customerName: string;
  site: { street: string; city: string };
  // The Proposal ID and the proposal's display name.
  proposalCode: string;
  proposalName: string;
  // Before tax, in the order the invoice lists them.
  lines: InvoiceLine[];
  taxRate: number;
  // The owner's Zelle setting at the moment the paper is read.
  zelleEmail: string;
};

// The top bar over the paper: which invoice, and at which site.
export function invoicePaperTitle(paper: Pick<PaperInvoice, "number" | "site">): string {
  return `Invoice ${paper.number} · ${paper.site.street}`;
}

// The tax row's label, the rate written the way the proposal paper writes it.
export function invoiceTaxLabel(rate: number): string {
  const percent = (rate * 100).toLocaleString("en-US", { maximumFractionDigits: 4 });
  return `Sales Tax (${percent}%)`;
}
