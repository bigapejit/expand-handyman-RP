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
  lines: InvoiceLine[];
  // The owner-set Zelle email (#62).
  zelleEmail: string;
  // The day the money arrived, once marked paid (#65).
  paidOn?: number;
  // The day it was voided (#64).
  voidedOn?: number;
};

export function amountDueCents(invoice: PaperInvoice): number {
  return invoice.lines.reduce((sum, line) => sum + line.cents, 0);
}

const proposal = {
  customerName: "Dana Whitfield",
  site: { street: "3107 Kauffman Ave", city: "Vancouver, WA 98660" },
  proposalCode: "3107KAUFFMAN-P1",
  proposalName: "Kitchen faucet and hallway repair",
  zelleEmail: "pay@expandhandyman.com",
};

// $4,000.00 + 8.7% tax = $4,348.00; a 50% Deposit is $2,174.00.
const totalCents = 434_800;
const depositCents = 217_400;

const deposit: PaperInvoice = {
  ...proposal,
  number: "INV-1001",
  kind: "deposit",
  sentAt: Date.UTC(2026, 8, 23, 17, 42, 10),
  lines: [
    {
      description: `Deposit for Proposal ${proposal.proposalCode} (50% of $4,348.00)`,
      cents: depositCents,
    },
  ],
};

// The final invoice as the owner sent it: the balance line the app prefilled,
// then two lines they typed, one a credit.
const final: PaperInvoice = {
  ...proposal,
  number: "INV-1002",
  kind: "final",
  sentAt: Date.UTC(2026, 9, 14, 21, 5, 0),
  lines: [
    {
      description: `Balance of Proposal ${proposal.proposalCode}, $4,348.00 less $2,174.00 invoiced`,
      cents: totalCents - depositCents,
    },
    {
      description: "Material allowance credit: kitchen faucet came in under",
      cents: -8_640,
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
