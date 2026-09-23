// The units a **Line Item**'s quantity is counted in (CONTEXT.md). Ported
// from FRSG's shared/line-item-units.ts. One fixed list, in the order a picker
// offers it, and the only thing anywhere that says what a unit may be:
// nothing else validates one. Add to it when a real Line Item needs a unit it
// does not hold — never to make a single line fit.
//
// It is kept free of Convex imports because the same list has to run in three
// places that must never disagree: the authoring panel's picker, the Convex
// mutation that refuses an off-list unit, and the frozen copy the proposal
// paper prints from.

export const LineItemUnits = ["EA", "SF", "LF", "HR", "DA", "WK"] as const;

export type LineItemUnit = (typeof LineItemUnits)[number];

// What a new line counts in until somebody says otherwise, and what a line
// written before units existed means: one of a thing.
export const DefaultLineItemUnit: LineItemUnit = "EA";

// The unit spelled out, for the picker, where two letters on their own would
// be a guess. Paper prints the abbreviation and never this.
const UnitLabels: Record<LineItemUnit, string> = {
  EA: "each",
  SF: "square feet",
  LF: "linear feet",
  HR: "hours",
  DA: "days",
  WK: "weeks",
};

export function lineItemUnitLabel(unit: LineItemUnit): string {
  return UnitLabels[unit];
}

export function isLineItemUnit(unit: string): unit is LineItemUnit {
  return (LineItemUnits as readonly string[]).includes(unit);
}

// The unit a stored line is counted in. Absent is an ordinary state — every
// Line Item written before units existed has no unit at all — and reads as `EA`,
// which is what those lines have always meant. Anything off the list reads the
// same way rather than failing a read: refusing a unit is the save's business
// (lib/solution-pricing.ts, `lineItemFault`), and no read should be the
// place a Proposal already sent stops printing.
export function readLineItemUnit(unit: string | undefined): LineItemUnit {
  return unit !== undefined && isLineItemUnit(unit) ? unit : DefaultLineItemUnit;
}
