// The money on a Proposal, and the words that go with it (CONTEXT.md,
// **Proposal** / **Deposit**). Ported from FRSG's shared/proposal-pricing.ts
// without its recipient blockers: Expand has one recipient, the customer. A
// Solution's price arrives already decided by lib/solution-pricing.ts —
// nothing here reaches into a cost buildup — and this module adds the three
// things a Proposal contributes: what its Solutions come to, what tax the
// Site's state charges on that, and how the total splits into the two
// payments the customer makes.
//
// It is kept free of Convex imports because the same arithmetic has to run in
// three places that must never disagree by a cent: the authoring panel's live
// readout, the Convex query that lists a customer's Proposals, and the frozen
// copy Send takes. That is also what lets every rounding edge be exercised as
// plain arithmetic.
//
// The default name lives here too rather than in a module of its own: it is
// read off the same ordered list of Solutions the subtotal is, and the list
// row, the panel, and the Proposals page all have to call a Proposal the same
// thing.

import type { SolutionPrice } from "./solution-pricing";

// The rate a Proposal charges, and where it came from. `source` is the whole
// of "is this Site taxed at all": `none` is an Oregon Site, which shows no tax
// row anywhere, and is a different state from a Washington Site whose rate is
// still missing (`lookup` with no rate — DOR could not answer, so the owner
// types one and the source becomes `override`).
//
// The location code and the quarter are kept beside the rate because they are
// what lets a Proposal say which rate it charged, and re-derive it later from
// DOR's rate table without a second address lookup (lib/wa-sales-tax.ts).
export type ProposalTax = {
  source: "lookup" | "override" | "none";
  // A decimal of the whole (0.089), never a percent.
  rate?: number;
  locationCode?: string;
  period?: string;
};

// What the Proposal comes to: the Solutions, the tax on them, and the one
// figure the customer owes. All in whole cents.
export type ProposalMoney = {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

// The rate actually charged, or nothing. An Oregon Site charges no tax at all,
// and a Washington Site with no rate yet charges nothing while the Proposal is
// unsendable — in neither case is a tax line shown.
export function chargedTaxRate(tax: ProposalTax): number | null {
  if (tax.source === "none") return null;
  if (tax.rate === undefined) return null;
  return tax.rate;
}

// Subtotal, tax, total. The subtotal is the sum of the Solutions' prices,
// which are already whole dollars; an unpriced Solution adds nothing, because
// a Draft is assembled before it is costed and the readout has to keep
// answering while it is. Tax is charged on the whole subtotal — labor included
// — and rounded once, to the cent.
export function proposalMoney(
  prices: readonly (SolutionPrice | null)[],
  tax: ProposalTax,
): ProposalMoney {
  const subtotalCents = prices.reduce(
    (total, price) => total + (price?.priceCents ?? 0),
    0,
  );

  const rate = chargedTaxRate(tax);
  const taxCents = rate === null ? 0 : Math.round(subtotalCents * rate);

  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

// Expand's default, in whole percent: half on signing, half on completion.
export const DefaultDepositPercent = 50;

// What the customer pays and when. Two payments and no more — there are no
// progress payments and no retainage (CONTEXT.md, **Deposit**).
export type PaymentSplit = {
  depositPercent: number;
  finalPercent: number;
  depositCents: number;
  finalCents: number;
};

// The deposit is the percentage; the final payment is whatever is left. Taking
// the remainder rather than applying a second percentage is what makes the two
// figures the customer reads add up to the one they owe, at every split and on
// every odd cent.
export function splitPayment(
  totalCents: number,
  depositPercent: number,
): PaymentSplit {
  const depositCents = Math.round((totalCents * depositPercent) / 100);

  return {
    depositPercent,
    finalPercent: 100 - depositPercent,
    depositCents,
    finalCents: totalCents - depositCents,
  };
}

// The Payment Terms in the customer's own words. At either end there is only
// one payment, and saying "0% on completion" would describe a payment that
// never happens.
export function paymentTermsSentence(depositPercent: number): string {
  if (depositPercent === 100) return "One payment on signing";
  if (depositPercent === 0) return "One payment on completion";
  return `${depositPercent}% on signing, ${100 - depositPercent}% on completion`;
}

// Every way a Proposal's own figures can fail to be figures, named once here
// so the mutation that refuses one and the panel that words the refusal cannot
// drift apart — the same division lib/solution-pricing.ts keeps around a
// Line Item.
export type ProposalFault = "deposit_percent_invalid" | "tax_rate_invalid";

// Whole percent, and both ends included: 0 and 100 are real Payment Terms.
export function depositPercentFault(percent: number): ProposalFault | null {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return "deposit_percent_invalid";
  }
  return null;
}

// A rate typed by hand, held the way DOR states one: a decimal of the whole,
// below 1. A "8.9" reaching the field unconverted would charge 890% of the
// subtotal, which is exactly the typo this refuses.
export function taxRateFault(rate: number): ProposalFault | null {
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return "tax_rate_invalid";
  return null;
}

export function proposalFaultMessage(fault: ProposalFault): string {
  switch (fault) {
    case "deposit_percent_invalid":
      return "The deposit must be a whole percent between 0 and 100.";
    case "tax_rate_invalid":
      return "A sales tax rate is a decimal of the whole, such as 0.089 for 8.9%.";
  }
}

// Why Send is refused. Named here rather than on the button because the same
// questions decide it on the server inside `proposals.send`, and a button that
// lists different reasons from the mutation that refuses would be worse than
// no reasons at all.
export type SendBlocker =
  | "no_solutions"
  | "unpriced_solution"
  | "no_tax_rate";

// Every reason at once, in the order they read: what the Proposal is missing,
// then what is wrong with what it holds. A Draft may hold zero Solutions and
// sit that way indefinitely; only Send minds.
//
// It is asked in prices rather than in Solutions because that is all the
// question needs, and because a Sent Proposal's frozen copy keeps a price and
// no cost buildup — so the same call answers on either side of Send.
export function sendBlockers(
  priceCents: readonly (number | null)[],
  tax: ProposalTax,
): SendBlocker[] {
  const blockers: SendBlocker[] = [];

  if (priceCents.length === 0) blockers.push("no_solutions");
  if (priceCents.some((price) => price === null)) blockers.push("unpriced_solution");
  // Only a Site that is taxed can be waiting on a rate.
  if (tax.source !== "none" && tax.rate === undefined) blockers.push("no_tax_rate");

  return blockers;
}

export function sendBlockerMessage(blocker: SendBlocker): string {
  switch (blocker) {
    case "no_solutions":
      return "This Proposal holds no Solutions.";
    case "unpriced_solution":
      return "A Solution in this Proposal has no price.";
    case "no_tax_rate":
      return "This Washington Site has no sales tax rate yet.";
  }
}

// What a Proposal is called: the name somebody typed, or the Solutions it
// holds, read in the order they are offered in. A Draft holding nothing still
// needs a row on the list to open, so it is named rather than blank.
export function proposalDisplayName(
  name: string | undefined,
  solutionTitles: readonly string[],
): string {
  const typed = name?.trim();
  if (typed) return typed;
  return solutionTitles.length === 0
    ? "Untitled proposal"
    : solutionTitles.join(" + ");
}
