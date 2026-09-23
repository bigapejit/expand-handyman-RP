import { describe, expect, it } from "vitest";

import {
  DefaultSolutionMarkupPercent,
  lineCostCents,
  lineItemFault,
  lineItemFaultMessage,
  markupFaultMessage,
  markupPercentFault,
  materialAllowanceFault,
  materialAllowanceFaultMessage,
  MaxSolutionMarkupPercent,
  priceSolution,
  priceStoredSolution,
  readMarkupPercent,
  type SolutionLineItem,
} from "./solution-pricing";

function line(
  quantity: number,
  unitCostCents: number,
  name = "Silicone",
): SolutionLineItem {
  return { name, quantity, unitCostCents };
}

describe("What one Line Item costs", () => {
  it("multiplies the quantity by the unit cost", () => {
    expect(lineCostCents(line(2, 50_000))).toBe(100_000);
  });

  // "2 crew, 5 hrs" is 10 hours at an hourly rate: the quantity carries the
  // arithmetic the name only describes.
  it("prices labor as an ordinary line", () => {
    expect(lineCostCents(line(10, 10_000, "Labor: 2 crew, 5 hrs"))).toBe(100_000);
  });

  it("takes a fractional quantity", () => {
    expect(lineCostCents(line(2.5, 40_000))).toBe(100_000);
  });

  // A fraction of a cent is not a figure anyone can pay, and the table's own
  // lines have to add up to the cost printed under them.
  it("rounds a fraction of a cent to the cent", () => {
    expect(lineCostCents(line(0.333, 100))).toBe(33);
    // Half a cent goes up, so a line never quietly costs less than it does.
    expect(lineCostCents(line(0.5, 101))).toBe(51);
  });

  it("costs nothing at a quantity of zero", () => {
    expect(lineCostCents(line(0, 50_000))).toBe(0);
  });
});

describe("A Solution's price", () => {
  it("has none at all before anything is written down", () => {
    expect(priceSolution([])).toBeNull();
  });

  // The acceptance figure: $1,545.45 of cost at 10% is
  // $1,699.995, which the customer is never shown — the price is $1,700.
  it("marks cost up and rounds the result up to the whole dollar", () => {
    expect(priceSolution([line(1, 154_545)])).toEqual({
      costCents: 154_545,
      priceCents: 170_000,
    });
  });

  // Rounding up must not mean "always up": a marked-up cost that already lands
  // on a dollar is the price, not a dollar more.
  it("leaves a price that is already whole dollars exactly where it is", () => {
    expect(priceSolution([line(1, 100_000)])).toEqual({
      costCents: 100_000,
      priceCents: 110_000,
    });
  });

  it("adds every line before marking anything up", () => {
    const price = priceSolution([
      line(1, 50_000, "Silicone"),
      line(10, 10_000, "Labor: 2 crew, 5 hrs"),
      line(1, 4_545, "Disposal"),
    ]);
    expect(price).toEqual({ costCents: 154_545, priceCents: 170_000 });
  });

  it("prices fractional quantities to the cent", () => {
    expect(priceSolution([line(2.5, 1_999), line(0.25, 4_444)])).toEqual({
      // 2.5 × $19.99 = $49.975; 0.25 × $44.44 = $11.11; $61.085 → $61.09.
      costCents: 6_109,
      priceCents: 6_800,
    });
  });

  // The cost is the sum of the lines, rounded once. Rounding each line first
  // would charge a cent a line for halves that add up to nothing.
  it("rounds the sum once rather than every line on the way", () => {
    expect(priceSolution([line(0.5, 1), line(0.5, 1)])?.costCents).toBe(1);
    expect(lineCostCents(line(0.5, 1))).toBe(1);
  });

  // A Solution whose lines happen to add to nothing has an answer — $0 — and
  // is a different thing from a Solution nobody has priced.
  it("says zero when the lines add to zero, which is not the same as no price", () => {
    expect(priceSolution([line(0, 50_000)])).toEqual({
      costCents: 0,
      priceCents: 0,
    });
  });

  // The figure a Solution starts at: 10% at launch, and what every Solution
  // nobody has changed is still priced at.
  it("charges Expand's Markup when the Solution names none of its own", () => {
    expect(DefaultSolutionMarkupPercent).toBe(10);
    expect(priceSolution([line(1, 1_000_000)])).toEqual({
      costCents: 1_000_000,
      priceCents: 1_100_000,
    });
  });

  // The company Markup is where a Solution starts, not where it
  // is stuck. A Solution carrying its own percent is priced at that one.
  it("charges a Solution's own Markup when it carries one", () => {
    expect(priceSolution([line(1, 1_000_000)], 25)).toEqual({
      costCents: 1_000_000,
      priceCents: 1_250_000,
    });
  });

  // A Markup of nothing is a real answer — work offered at cost — and is not
  // the absent Markup that means "Expand's".
  it("sells at cost at a Markup of zero", () => {
    expect(priceSolution([line(1, 1_000_000)], 0)).toEqual({
      costCents: 1_000_000,
      priceCents: 1_000_000,
    });
  });

  // The rounding is the Markup's, not the default's: every percent rounds the
  // marked-up cost up to the whole dollar the same way.
  it("rounds a Solution's own Markup up to the whole dollar too", () => {
    expect(priceSolution([line(1, 154_545)], 20)).toEqual({
      costCents: 154_545,
      priceCents: 185_500,
    });
  });
});

describe("A Solution's Material Allowance", () => {
  // Priced, and sendable, on the allowance alone: only a Solution with neither
  // lines nor an allowance has no price.
  it("is a price by itself, with no Line Items beside it", () => {
    expect(priceSolution([], undefined, 130_000)).toEqual({
      costCents: 0,
      priceCents: 130_000,
      materialAllowanceCents: 130_000,
    });
  });

  // $1,545.45 of cost at 10% is $1,699.995, rounded up to $1,700; the $1,300
  // allowance lands on top exactly as typed. Marked up it would add $1,430,
  // and summed before the rounding it would still land at $3,000 here, so the
  // second case below is the one that tells the rounding apart.
  it("is added as typed, after the lines are marked up and rounded", () => {
    expect(priceSolution([line(1, 154_545)], undefined, 130_000)).toEqual({
      costCents: 154_545,
      priceCents: 300_000,
      materialAllowanceCents: 130_000,
    });
    // At 25%, $10.01 of cost is $12.5125, rounded up to $13. Marked up with
    // it, a $100 allowance would make $138; it makes $113.
    expect(priceSolution([line(1, 1_001)], 25, 10_000)).toEqual({
      costCents: 1_001,
      priceCents: 11_300,
      materialAllowanceCents: 10_000,
    });
  });

  it("leaves a Solution without one priced exactly as before", () => {
    const price = priceSolution([line(1, 154_545)]);
    expect(price).toEqual({ costCents: 154_545, priceCents: 170_000 });
    expect(price).not.toHaveProperty("materialAllowanceCents");
  });

  it("accepts whole dollars, from $1 up", () => {
    expect(materialAllowanceFault(100)).toBeNull();
    expect(materialAllowanceFault(130_000)).toBeNull();
  });

  // Nothing is not an allowance (there is the ✕ for that), cents are not a
  // figure it is typed in, and a figure that is no figure at all would price
  // the Solution into something unprintable.
  it("refuses anything that is not one", () => {
    for (const cents of [
      0,
      50,
      -100,
      130_050,
      100.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(materialAllowanceFault(cents)).toBe("material_allowance_invalid");
    }
  });

  it("words the refusal", () => {
    expect(materialAllowanceFaultMessage("material_allowance_invalid")).toMatch(
      /whole number of dollars.*\$1/,
    );
  });
});

describe("The Markup a Solution is priced at", () => {
  it("is Expand's when the Solution names none", () => {
    expect(readMarkupPercent(undefined)).toBe(DefaultSolutionMarkupPercent);
  });

  it("is the Solution's own when it carries one, zero included", () => {
    expect(readMarkupPercent(25)).toBe(25);
    expect(readMarkupPercent(0)).toBe(0);
  });

  it("accepts a whole percent, at either end of what Expand would set", () => {
    expect(markupPercentFault(0)).toBeNull();
    expect(markupPercentFault(10)).toBeNull();
    expect(markupPercentFault(MaxSolutionMarkupPercent)).toBeNull();
  });

  // A negative Markup would sell below cost, a fraction of a percent is not a
  // figure Expand sets, and a cost typed into the percent field is the typo the
  // ceiling is there to catch. A figure that is no figure at all — NaN, an
  // infinity — would multiply the cost into something unprintable, so it is
  // refused here rather than reaching the arithmetic.
  it("refuses anything that is not one", () => {
    expect(markupPercentFault(-1)).toBe("markup_percent_invalid");
    expect(markupPercentFault(12.5)).toBe("markup_percent_invalid");
    expect(markupPercentFault(MaxSolutionMarkupPercent + 1)).toBe(
      "markup_percent_invalid",
    );
    expect(markupPercentFault(Number.NaN)).toBe("markup_percent_invalid");
    expect(markupPercentFault(Number.POSITIVE_INFINITY)).toBe(
      "markup_percent_invalid",
    );
    expect(markupPercentFault(Number.NEGATIVE_INFINITY)).toBe(
      "markup_percent_invalid",
    );
  });

  it("words the refusal with the ceiling it actually keeps", () => {
    expect(markupFaultMessage("markup_percent_invalid")).toContain(
      MaxSolutionMarkupPercent.toLocaleString("en-US"),
    );
  });
});

describe("Pricing a Solution as it is stored", () => {
  it("prices it at its own Markup, over the lines it holds", () => {
    expect(
      priceStoredSolution({ lineItems: [line(1, 100_000)], markupPercent: 50 }),
    ).toEqual({ costCents: 100_000, priceCents: 150_000 });
  });

  it("prices a Solution that names no Markup at Expand's", () => {
    expect(priceStoredSolution({ lineItems: [line(1, 100_000)] })).toEqual({
      costCents: 100_000,
      priceCents: 110_000,
    });
  });

  it("has no price for a Solution holding no lines at all", () => {
    expect(priceStoredSolution({})).toBeNull();
    // Repricing an uncosted Solution does not give it a price: "no Line Items"
    // is still no price, whatever percent sits beside it.
    expect(priceStoredSolution({ lineItems: [], markupPercent: 50 })).toBeNull();
  });

  it("prices a stored Material Allowance, with or without lines beside it", () => {
    expect(priceStoredSolution({ materialAllowanceCents: 50_000 })).toEqual({
      costCents: 0,
      priceCents: 50_000,
      materialAllowanceCents: 50_000,
    });
    expect(
      priceStoredSolution({
        lineItems: [line(1, 100_000)],
        markupPercent: 50,
        materialAllowanceCents: 50_000,
      }),
    ).toEqual({ costCents: 100_000, priceCents: 200_000, materialAllowanceCents: 50_000 });
  });

  // Zero has to survive the whole way down — a `markupPercent ?? default`
  // anywhere on this path would quietly resell at-cost work at 10%.
  it("prices a Solution stored at a Markup of zero at cost", () => {
    expect(
      priceStoredSolution({ lineItems: [line(1, 100_000)], markupPercent: 0 }),
    ).toEqual({ costCents: 100_000, priceCents: 100_000 });
  });
});

describe("What a Line Item may say", () => {
  it("accepts an ordinary line", () => {
    expect(lineItemFault(line(2, 50_000))).toBeNull();
  });

  it("accepts a free line and a zero quantity", () => {
    expect(lineItemFault(line(0, 0))).toBeNull();
  });

  it("refuses a line with no name to read", () => {
    expect(lineItemFault(line(1, 100, "   "))).toBe("line_name_required");
  });

  it("refuses a negative quantity or a quantity that is not a number", () => {
    expect(lineItemFault(line(-1, 100))).toBe("line_quantity_invalid");
    expect(lineItemFault(line(Number.NaN, 100))).toBe("line_quantity_invalid");
    expect(lineItemFault(line(Number.POSITIVE_INFINITY, 100))).toBe(
      "line_quantity_invalid",
    );
  });

  it("refuses a negative unit cost, and a cost that is not whole cents", () => {
    expect(lineItemFault(line(1, -100))).toBe("line_unit_cost_invalid");
    expect(lineItemFault(line(1, 100.5))).toBe("line_unit_cost_invalid");
    expect(lineItemFault(line(1, Number.NaN))).toBe("line_unit_cost_invalid");
  });

  it("accepts a unit from the list, and a line that carries none", () => {
    expect(lineItemFault({ ...line(1, 100), unit: "LF" })).toBeNull();
    expect(lineItemFault(line(1, 100))).toBeNull();
  });

  it("refuses a unit Expand does not price in", () => {
    expect(lineItemFault({ ...line(1, 100), unit: "SQ" })).toBe("line_unit_invalid");
    expect(lineItemFault({ ...line(1, 100), unit: "lf" })).toBe("line_unit_invalid");
    expect(lineItemFault({ ...line(1, 100), unit: "" })).toBe("line_unit_invalid");
  });

  it("words every fault, so no surface has to invent a sentence", () => {
    for (const fault of [
      "line_name_required",
      "line_quantity_invalid",
      "line_unit_cost_invalid",
      "line_unit_invalid",
    ] as const) {
      expect(lineItemFaultMessage(fault)).toMatch(/\S/);
    }
  });
});
