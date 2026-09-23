// The money on a Solution: what its Line Items cost, and the one price the
// customer eventually reads (CONTEXT.md, **Line Item** / **Markup** /
// **Solution**). Ported from FRSG's shared/solution-pricing.ts. The price is
// never typed — if the figure should be different, a line or the Markup
// changes and the price follows — so this module is the only place a
// Solution's price comes from.
//
// It is kept free of Convex imports because the same arithmetic has to run in
// three places that must never disagree by a cent: the authoring panel's live readout, the
// Convex query that lists Solutions, and the frozen copy a Proposal takes at
// Send, and so that every rounding edge can be exercised as plain arithmetic.

import {
  isLineItemUnit,
  LineItemUnits,
  readLineItemUnit,
  type LineItemUnit,
} from "./line-item-units";

// Expand's Markup, as whole percent: what a Solution is priced at until
// somebody says otherwise, and still what all but a handful are priced at.
// Deliberately not a decimal: percent-of-an-integer stays exact in integer
// arithmetic, and `cost * 1.1` does not — $1,000.00 of cost comes out a hair
// over $1,100 and would round up to $1,101.
export const DefaultSolutionMarkupPercent = 10;

// The highest Markup Expand will store, as whole percent: high enough never to
// argue with a real one, low enough to catch a cost typed into the percent
// field. Exported so the panel's field and the mutation's refusal share one
// ceiling rather than each keeping its own copy of the number.
export const MaxSolutionMarkupPercent = 1_000;

// The percent a Solution is actually priced at. A Solution that names none is
// priced at Expand's, so the number is never absent by the time anything
// multiplies by it, and a stored zero is a real Markup — work offered at cost
// — rather than a missing one.
export function readMarkupPercent(markupPercent: number | undefined): number {
  return markupPercent ?? DefaultSolutionMarkupPercent;
}

// Every way a Markup can fail to be one, named here beside the Line Item
// faults so the mutation that refuses one and the panel that words the
// refusal cannot drift apart.
export type MarkupFault = "markup_percent_invalid";

// Whole percent, both ends included. Zero is a real Markup; a negative one
// would sell below cost; a fraction of a percent is not a figure Expand sets,
// and keeping it whole is what keeps the arithmetic below exact. `isInteger`
// is what refuses a NaN or an Infinity too, so nothing unmultipliable is ever
// stored.
export function markupPercentFault(markupPercent: number): MarkupFault | null {
  if (
    !Number.isInteger(markupPercent) ||
    markupPercent < 0 ||
    markupPercent > MaxSolutionMarkupPercent
  ) {
    return "markup_percent_invalid";
  }
  return null;
}

export function markupFaultMessage(fault: MarkupFault): string {
  switch (fault) {
    case "markup_percent_invalid":
      return `A Solution's Markup must be a whole percent, from 0 to ${MaxSolutionMarkupPercent.toLocaleString("en-US")}.`;
  }
}

// One row of a Solution's internal cost buildup. Every kind of cost is one of
// these — materials, equipment, labor, permits, disposal — with no categories.
// The quantity is typed by hand and may be fractional ("1.5 squares"); the
// unit cost is whole cents.
//
// `unit` is what the quantity counts, from lib/line-item-units.ts's one
// list. It is a plain string rather than a `LineItemUnit` because that is what
// arrives from a client, and typing it here would only move the refusal
// somewhere it could not be worded; `lineItemFault` is what refuses an
// off-list one, and `readLineItemUnit` says what an absent one means.
export type SolutionLineItem = {
  name: string;
  quantity: number;
  unitCostCents: number;
  unit?: string;
};

// The customer-facing half of a Line Item: what it is, how much of it, and
// what that counts. No unit cost and no line cost — those are internal to
// Expand (CONTEXT.md, **Line Item**) — which is exactly why this is the shape
// Send freezes onto a Proposal and the Proposal Document prints.
export type OfferedLineItem = {
  name: string;
  quantity: number;
  unit: LineItemUnit;
};

// A line to read that half off: the live Line Item a Solution holds, or the
// copy a Proposal froze, which carries no money to leave behind.
type ReadableLineItem = {
  name: string;
  quantity: number;
  unit?: string;
};

// A Solution's lines as the customer will read them, with the money taken off
// and every unit read. An absent list — a Solution nobody has costed, or a
// Proposal frozen before Line Items were part of the copy — is an empty one,
// so no reader has to ask twice.
export function offeredLineItems(
  lineItems: readonly ReadableLineItem[] | undefined,
): OfferedLineItem[] {
  return (lineItems ?? []).map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unit: readLineItemUnit(line.unit),
  }));
}

// A priced Solution: what it costs Expand, and what it is sold for. Both in
// cents, and `priceCents` is always a whole number of dollars.
export type SolutionPrice = {
  costCents: number;
  priceCents: number;
};

// What one line costs, for the figure printed beside it. Rounded to the cent —
// half up, so a line never quietly costs less than it does. The cost of the
// whole Solution is rounded once over the sum rather than line by line, so a
// table of fractional-cent lines can show figures that differ from the total
// by a cent; the total is the one that is right.
export function lineCostCents(line: SolutionLineItem): number {
  return Math.round(line.quantity * line.unitCostCents);
}

// The whole of a Solution's money, or nothing at all: a Solution with no Line
// Items has no price, which is a different answer from $0 and reads that way
// everywhere (a Proposal cannot be Sent carrying one).
export function priceSolution(
  lineItems: readonly SolutionLineItem[],
  markupPercent?: number,
): SolutionPrice | null {
  if (lineItems.length === 0) return null;

  // Summed exactly and rounded once, because that is what the cost is: the sum
  // of quantity × unit cost. Rounding each line first would let a table of
  // half-cent lines charge a cent per line that nobody owes.
  const costCents = Math.round(
    lineItems.reduce((total, line) => total + line.quantity * line.unitCostCents, 0),
  );

  // Marked up and rounded **up** to the whole dollar, in one step and in
  // integers: cost cents × (100 + markup) is exact, and dividing by 10,000
  // asks the question "how many whole dollars" directly.
  const priceDollars = Math.ceil(
    (costCents * (100 + readMarkupPercent(markupPercent))) / 10_000,
  );

  return { costCents, priceCents: priceDollars * 100 };
}

// A Solution as it is stored, as far as its price is concerned: the lines it
// holds and the Markup it is sold at, both absent on a Solution nobody has
// costed or repriced. Structural, so a Convex `Doc<"solutions">` is one
// without this module ever hearing about Convex.
export type PriceableSolution = {
  lineItems?: readonly SolutionLineItem[];
  markupPercent?: number;
};

// The price of a stored Solution, which is the only way anything outside this
// module should ask for one: reaching for `priceSolution` directly is how a
// reader ends up pricing a Solution at Expand's Markup after somebody changed
// it.
export function priceStoredSolution(
  solution: PriceableSolution,
): SolutionPrice | null {
  return priceSolution(solution.lineItems ?? [], solution.markupPercent);
}

// Every way a Line Item can fail to be one, named once here so the mutation
// that refuses it and the panel that words the refusal cannot drift apart. A
// zero quantity and a zero unit cost are both ordinary: a line included at no
// charge is a real thing to write down.
export type LineItemFault =
  | "line_name_required"
  | "line_quantity_invalid"
  | "line_unit_cost_invalid"
  | "line_unit_invalid";

export function lineItemFault(line: SolutionLineItem): LineItemFault | null {
  if (line.name.trim().length === 0) return "line_name_required";
  if (!Number.isFinite(line.quantity) || line.quantity < 0) {
    return "line_quantity_invalid";
  }
  // Whole cents, because a unit cost that carries a fraction of a cent is a
  // typo the price would silently absorb.
  if (!Number.isSafeInteger(line.unitCostCents) || line.unitCostCents < 0) {
    return "line_unit_cost_invalid";
  }
  // Absent is fine — `readLineItemUnit` says what it means — but a unit that is
  // there has to be one Expand prices in, or the paper would print two letters
  // nobody agreed on.
  if (line.unit !== undefined && !isLineItemUnit(line.unit)) {
    return "line_unit_invalid";
  }
  return null;
}

export function lineItemFaultMessage(fault: LineItemFault): string {
  switch (fault) {
    case "line_name_required":
      return "Every Line Item needs a name.";
    case "line_quantity_invalid":
      return "A Line Item's quantity cannot be negative.";
    case "line_unit_cost_invalid":
      return "A Line Item's unit cost must be whole cents, and cannot be negative.";
    case "line_unit_invalid":
      return `A Line Item's unit must be one of ${LineItemUnits.join(", ")}.`;
  }
}
