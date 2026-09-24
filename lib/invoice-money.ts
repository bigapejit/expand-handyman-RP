// The money on an **Invoice** (CONTEXT.md), as the spec's "Money" settles it:
// one rule for every invoice, whatever kind. The lines are before tax and may
// be negative; the tax is charged once on their sum at the rate the invoice
// copied from its proposal; Amount Due is the two added. Lists, cards, the
// email and the paper all read the same three figures from here.
//
// Kept free of Convex imports for the reason lib/proposal-pricing.ts is: the
// mutation that makes an invoice, the query that shows it and the paper must
// never disagree by a cent, and every rounding edge is plain arithmetic.

import {
  chargedTaxRate,
  splitPayment,
  storedDeposit,
  type ProposalTax,
} from "./proposal-pricing";

// One **Invoice line**: a description and an amount before tax, in whole
// cents, negative for a credit.
export type InvoiceLine = { description: string; cents: number };

export type InvoiceMoney = {
  subtotalCents: number;
  taxCents: number;
  amountDueCents: number;
};

export function invoiceMoney(lines: readonly InvoiceLine[], taxRate: number): InvoiceMoney {
  const subtotalCents = lines.reduce((sum, line) => sum + line.cents, 0);
  const taxCents = Math.round(subtotalCents * taxRate);
  return { subtotalCents, taxCents, amountDueCents: subtotalCents + taxCents };
}

// The rate an invoice copies from its proposal's frozen tax when it is made:
// the rate charged, or 0 where the proposal charges none. Past Send a
// proposal always has one where it is taxed (`sendBlockers`).
export function invoiceTaxRate(tax: ProposalTax): number {
  return chargedTaxRate(tax) ?? 0;
}

// The **Deposit invoice**'s one line: the Deposit the customer signed for,
// taken back to its share before tax, so the paper's tax on top brings Amount
// Due back to the Deposit. That can land a cent either side of it; the drift
// is accepted so the tax on every invoice stays one rule. A Deposit of nothing
// makes no line, and so no invoice.
export function depositLine(offer: {
  // The proposal's display name, as the customer read it.
  name: string;
  totalCents: number;
  depositPercent: number;
  depositCents?: number;
  tax: ProposalTax;
}): InvoiceLine | null {
  const deposit = storedDeposit(offer);
  const { depositCents } = splitPayment(offer.totalCents, deposit);
  if (depositCents <= 0) return null;
  return {
    description:
      deposit.kind === "percent"
        ? `Deposit (${deposit.percent}%) for ${offer.name}`
        : `Deposit for ${offer.name}`,
    cents: Math.round(depositCents / (1 + invoiceTaxRate(offer.tax))),
  };
}

// The **Invoice number** as it is printed and spoken: `INV-1001`.
export function invoiceNumberLabel(number: number): string {
  return `INV-${number}`;
}
