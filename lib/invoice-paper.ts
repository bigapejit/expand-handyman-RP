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
  // How to pay: the owner's **Zelle tag** setting at the moment the paper is
  // read, and where a check may be mailed, null until the owner has supplied
  // an address (lib/expand-business.ts), when the paper says a check is
  // handed over in person only.
  zelleTag: string;
  mailingAddress: string | null;
  // PAID once a payment is recorded, VOID once voided, and nothing while it
  // is owed or still a draft.
  stamp: InvoiceStamp | null;
};

// The stamp across the cover block's empty half, with its day: for PAID the
// day the money arrived as Mark paid recorded it, for VOID the day it was
// voided. Both are Pacific calendar days, `YYYY-MM-DD`
// (lib/invoice-standing.ts, `pacificDay`).
export type InvoiceStamp = { kind: "paid" | "void"; day: string };

// Which paper this is, as the stamp makes it: what a PDF copy of it is bound
// to, since each stamp changes the sheet.
export type InvoicePaperState = "sent" | "paid" | "void";

export function invoicePaperState(paper: Pick<PaperInvoice, "stamp">): InvoicePaperState {
  return paper.stamp?.kind ?? "sent";
}

// A stamp's day as the paper writes days, `9/3/2026`
// (lib/proposal-paper.ts, `paperDate`).
export function stampDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${month}/${date}/${year}`;
}

// The sentence under the invoice link's top bar once the invoice is stamped,
// in the words the invoices spec (#93) settled, and the tone it is said in:
// the signed green for paid, the declined grey for void.
export function invoiceLinkStrip(
  stamp: InvoiceStamp | null,
): { tone: "signed" | "declined"; body: string } | undefined {
  if (!stamp) return undefined;
  const day = stampDate(stamp.day);
  return stamp.kind === "paid"
    ? { tone: "signed", body: `Paid on ${day}. Thank you.` }
    : {
        tone: "declined",
        body: `Expand Handyman voided this invoice on ${day}. Nothing is due on it.`,
      };
}

// The top bar over the paper: which invoice, and at which site.
export function invoicePaperTitle(paper: Pick<PaperInvoice, "number" | "site">): string {
  return `Invoice ${paper.number} · ${paper.site.street}`;
}

// The tax row's label, the rate written the way the proposal paper writes it.
export function invoiceTaxLabel(rate: number): string {
  const percent = (rate * 100).toLocaleString("en-US", { maximumFractionDigits: 4 });
  return `Sales Tax (${percent}%)`;
}
