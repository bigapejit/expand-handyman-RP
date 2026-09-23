import {
  DefaultLineItemUnit,
  readLineItemUnit,
  type LineItemUnit,
} from "./line-item-units";
import {
  lineCostCents,
  MaxSolutionMarkupPercent,
  priceSolution,
  type SolutionLineItem,
  type SolutionPrice,
} from "./solution-pricing";

import { formatCents } from "./money";

// How a Solution reads on the customer's Solutions tab: the row in the list,
// and the Line Item table inside the panel. Ported from FRSG's
// apps/web/lib/solutions.ts without the roof-record links. Pure, so the price
// the owner watches change while typing is arithmetically the same number the
// server computes on save — lib/solution-pricing.ts owns the arithmetic, and
// nothing here repeats any of it.

// The price the list shows. A Solution nobody has costed has no price at all,
// which is a different thing from a Solution that costs nothing, and the row
// says so rather than showing "$0".
export function solutionPriceLabel(
  price: SolutionPrice | null,
  locale?: string,
): string {
  return price === null ? "No price" : formatCents(price.priceCents, locale);
}

// The readout under the table: what the work costs, what the Markup adds, and
// the one figure the customer will read. Nothing here is customer-visible —
// the cost and the Markup are internal (CONTEXT.md, **Markup**). The percent
// itself is not a label here: it is the field the author
// types in, and repeating it beside the amount would be the same figure told
// twice, from two sources that could disagree mid-keystroke.
export type PriceReadout = {
  costLabel: string;
  markupAmountLabel: string;
  priceLabel: string;
};

export function priceReadout(
  price: SolutionPrice | null,
  locale?: string,
): PriceReadout | null {
  if (price === null) return null;
  return {
    costLabel: formatCents(price.costCents, locale),
    // The rounding up to the whole dollar lands here, so the three figures
    // always add up on screen.
    markupAmountLabel: formatCents(price.priceCents - price.costCents, locale),
    priceLabel: formatCents(price.priceCents, locale),
  };
}

export function lineCostLabel(line: SolutionLineItem, locale?: string): string {
  return formatCents(lineCostCents(line), locale);
}

// A Line Item while it is being typed. Quantity and unit cost stay as strings
// because a half-typed number is a real state of the field — "1." and "" are
// things people type on the way to "1.5" — and a table that rewrote them under
// the cursor would be unusable. The unit is not a string like them: it is
// picked from a fixed list, so it is only ever one of them. `key` is the row's
// identity while it is on screen; nothing stores it. `stored` says whether the
// Solution already holds this line, which is what tells a half-retyped name
// from a row nobody has written yet.
export type LineItemDraft = {
  key: string;
  name: string;
  quantity: string;
  unit: LineItemUnit;
  unitCost: string;
  stored: boolean;
};

export function draftsFromLineItems(
  lineItems: readonly SolutionLineItem[],
): LineItemDraft[] {
  return lineItems.map((line, index) => ({
    key: `stored-${index}`,
    name: line.name,
    quantity: String(line.quantity),
    unit: readLineItemUnit(line.unit),
    unitCost: unitCostField(line.unitCostCents),
    stored: true,
  }));
}

// A new row starts at one of whatever it is, priced at nothing: the quantity
// is nearly always 1, the unit is the one most lines count in, and the cost is
// the thing being looked up.
export function blankLineItemDraft(key: string): LineItemDraft {
  return {
    key,
    name: "",
    quantity: "1",
    unit: DefaultLineItemUnit,
    unitCost: "",
    stored: false,
  };
}

// Cents as the field shows them for editing: plain dollars, no currency
// symbol or grouping, because the field is typed into as well as read.
export function unitCostField(cents: number): string {
  if (cents === 0) return "";
  return (cents / 100).toFixed(2);
}

// A figure typed by hand, with the punctuation people type around numbers
// taken off. Anything that is not a number yet — blank, "-", "1."
// mid-keystroke — is nothing rather than an error, so the readout stays live
// while a field is half-written. A figure that really is negative is passed
// through rather than clamped, so the save refuses it out loud instead of the
// table quietly pricing something else.
function readTypedNumber(raw: string): number {
  const value = Number(raw.trim().replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

// A quantity is that figure and nothing more: named separately from the unit
// cost because the two are different things about a line, not because they are
// read differently.
export function readQuantity(raw: string): number {
  return readTypedNumber(raw);
}

// A unit cost typed by hand, as whole cents. "$1,250.50", "1250.5", and
// " 1250.50 " are the same money.
export function readUnitCostCents(raw: string): number {
  return Math.round(readTypedNumber(raw) * 100);
}

// The rows that are Line Items yet. A row with no name is not one — it is
// either a fresh row nobody has filled in or a name the author is in the
// middle of replacing — so it is left out of the price rather than being
// refused as an error every time the field is left.
export function readLineItems(
  drafts: readonly LineItemDraft[],
): SolutionLineItem[] {
  return drafts
    .filter((draft) => draft.name.trim().length > 0)
    .map((draft) => ({
      name: draft.name.trim(),
      quantity: readQuantity(draft.quantity),
      unit: draft.unit,
      unitCostCents: readUnitCostCents(draft.unitCost),
    }));
}

// What the table should be saved as, or `null` for "not yet". A row the
// Solution already holds whose name has been emptied is a name being retyped,
// not a line being deleted — there is a Remove button for that — so the whole
// save waits rather than dropping the line and re-pricing the Solution behind
// the author. A blank row nobody has written is simply not a Line Item yet and
// holds nothing up.
export function lineItemsToStore(
  drafts: readonly LineItemDraft[],
): SolutionLineItem[] | null {
  const midEdit = drafts.some(
    (draft) => draft.stored && draft.name.trim().length === 0,
  );
  return midEdit ? null : readLineItems(drafts);
}

// Whether the table still says what the Solution already stores. A field left
// alone is not an edit: without this, every blur would write the same list
// back and teach the Catalog another use of every name in it.
export function sameLineItems(
  left: readonly SolutionLineItem[],
  right: readonly SolutionLineItem[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (line, index) =>
        line.name === right[index].name &&
        line.quantity === right[index].quantity &&
        readLineItemUnit(line.unit) === readLineItemUnit(right[index].unit) &&
        line.unitCostCents === right[index].unitCostCents,
    )
  );
}

// The price of the table as it stands, at the Markup the field above it
// shows: recomputed on every keystroke from the same module the server prices
// with, so what the author watches is what will be stored.
export function draftPrice(
  drafts: readonly LineItemDraft[],
  markupPercent: number,
): SolutionPrice | null {
  return priceSolution(readLineItems(drafts), markupPercent);
}

// The Markup as the field shows it for editing: a plain whole percent, with no
// sign to type around.
export function markupField(markupPercent: number): string {
  return String(markupPercent);
}

// A whole percent as typed, or nothing yet, because a fraction of a percent
// is not a Markup Expand sets. The ceiling is the mutation's own
// (`MaxSolutionMarkupPercent`, shared rather than repeated), so the field
// snaps back rather than sending a figure that could only come back refused.
export function readMarkupField(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const percent = Number(trimmed);
  return percent > MaxSolutionMarkupPercent ? null : percent;
}

// What the field should be saved as, or `null` for "nothing to save" — the
// same question `lineItemsToStore` asks of the table. A field left alone is
// not an edit, and one holding something that is not a whole percent is a
// figure half-typed or mistyped: either way the field snaps back to what the
// Solution is still sold at rather than repricing it behind the author.
export function markupToStore(typed: string, stored: number): number | null {
  const percent = readMarkupField(typed);
  return percent === null || percent === stored ? null : percent;
}

// Moving a row past its neighbour. Past either end is simply nothing
// happening.
export function moveDraft(
  drafts: readonly LineItemDraft[],
  index: number,
  direction: "up" | "down",
): LineItemDraft[] {
  const target = index + (direction === "up" ? -1 : 1);
  if (target < 0 || target >= drafts.length) return [...drafts];

  const reordered = [...drafts];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered;
}
