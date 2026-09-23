// PROTOTYPE (issue #68): throwaway. Dummy invoices for the invoice paper, on
// the proposal the proposal-paper prints use (scripts/print-proposal-paper.tsx):
// Dana Whitfield's kitchen faucet and hallway repair, $4,000 plus 8.7% tax.
// Nothing here is read from Convex.

export type InvoiceLine = { description: string; cents: number };

export type PaperInvoice = {
  // The **Invoice number**, e.g. INV-1001.
  number: string;
  kind: "deposit" | "final";
  sentAt: number;
  customerName: string;
  site: { street: string; city: string };
  proposalCode: string;
  proposalName: string;
  // Pre-tax lines. Washington requires the sales tax stated separately on an
  // invoice (RCW 82.08.050), so the paper sums them, adds the proposal's
  // frozen rate, and shows Amount Due, as the proposal's Grand Total does.
  lines: InvoiceLine[];
  taxRate: number;
  // The owner-set Zelle email (#62).
  zelleEmail: string;
  // The day the money arrived, once marked paid (#65).
  paidOn?: number;
  // The day it was voided (#64).
  voidedOn?: number;
};

export function subtotalCents(invoice: PaperInvoice): number {
  return invoice.lines.reduce((sum, line) => sum + line.cents, 0);
}

export function taxCents(invoice: PaperInvoice): number {
  return Math.round(subtotalCents(invoice) * invoice.taxRate);
}

export function amountDueCents(invoice: PaperInvoice): number {
  return subtotalCents(invoice) + taxCents(invoice);
}

const proposal = {
  customerName: "Dana Whitfield",
  site: { street: "3107 Kauffman Ave", city: "Vancouver, WA 98660" },
  proposalCode: "3107KAUFFMAN-P1",
  proposalName: "Kitchen faucet and hallway repair",
  zelleEmail: "pay@expandhandyman.com",
  taxRate: 0.087,
};

// $4,000.00 before tax; a 50% Deposit is $2,000.00 before tax.
const jobCents = 400_000;
const depositCents = 200_000;

const deposit: PaperInvoice = {
  ...proposal,
  number: "INV-1001",
  kind: "deposit",
  sentAt: Date.UTC(2026, 8, 23, 17, 42, 10),
  lines: [
    { description: `Deposit (50%) for ${proposal.proposalName}`, cents: depositCents },
  ],
};

// The final invoice as the owner sent it: the job at its proposed price less
// the deposit already invoiced, both prefilled, then two lines they typed,
// one a credit.
const final: PaperInvoice = {
  ...proposal,
  number: "INV-1002",
  kind: "final",
  sentAt: Date.UTC(2026, 9, 14, 21, 5, 0),
  lines: [
    { description: proposal.proposalName, cents: jobCents },
    { description: "Less deposit invoiced (INV-1001)", cents: -depositCents },
    {
      description: "Material allowance credit: kitchen faucet came in under",
      cents: -8_000,
    },
    {
      description: "Approved extra: replace corroded P-trap under the kitchen sink",
      cents: 14_500,
    },
  ],
};

export const Variants = [
  { key: "deposit", label: "Deposit invoice, sent" },
  { key: "final", label: "Final invoice with two typed lines, sent" },
  { key: "paid", label: "Final invoice, marked paid" },
  { key: "void", label: "Deposit invoice, voided" },
] as const;

export type VariantKey = (typeof Variants)[number]["key"];

export function invoiceFor(variant: string): PaperInvoice {
  switch (variant) {
    case "final":
      return final;
    case "paid":
      return { ...final, paidOn: Date.UTC(2026, 9, 20, 18, 0, 0) };
    case "void":
      return { ...deposit, voidedOn: Date.UTC(2026, 8, 25, 16, 30, 0) };
    default:
      return deposit;
  }
}
