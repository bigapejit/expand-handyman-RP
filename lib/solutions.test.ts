import { describe, expect, it } from "vitest";

import type { LineItemUnit } from "./line-item-units";
import {
  markupPercentFault,
  MaxSolutionMarkupPercent,
} from "./solution-pricing";

import {
  blankLineItemDraft,
  draftPrice,
  draftsFromLineItems,
  lineCostLabel,
  lineItemsToStore,
  markupField,
  markupToStore,
  materialAllowanceField,
  materialAllowanceToStore,
  moveDraft,
  priceReadout,
  readLineItems,
  readMarkupField,
  readMaterialAllowanceField,
  readQuantity,
  readUnitCostCents,
  sameLineItems,
  solutionDetailLabel,
  solutionPriceLabel,
  unitCostField,
  type LineItemDraft,
} from "./solutions";

const en = "en-US";

// A row the Solution already holds. A row nobody has written yet comes from
// `blankLineItemDraft`, which is what tells the two apart.
function draft(
  name: string,
  quantity: string,
  unitCost: string,
  unit: LineItemUnit = "EA",
  key = name,
): LineItemDraft {
  return { key, name, quantity, unit, unitCost, stored: true };
}

describe("What the Solutions list says a Solution costs", () => {
  it("names the price in whole dollars", () => {
    expect(solutionPriceLabel({ costCents: 154_545, priceCents: 170_000 }, en)).toBe(
      "$1,700",
    );
  });

  // "No price" and "$0" are different facts about a Solution, and only one of
  // them can be put in front of a customer.
  it("says a Solution nobody has costed has no price, not a price of nothing", () => {
    expect(solutionPriceLabel(null, en)).toBe("No price");
    expect(solutionPriceLabel({ costCents: 0, priceCents: 0 }, en)).toBe("$0");
  });
});

describe("The cost → Markup → price readout", () => {
  it("shows three figures that add up on screen, rounding included", () => {
    expect(priceReadout({ costCents: 154_545, priceCents: 170_000 }, en)).toEqual({
      costLabel: "$1,545.45",
      // $154.55, not $154.545: the whole-dollar rounding is inside the Markup
      // line, so cost plus Markup is exactly the price.
      markupAmountLabel: "$154.55",
      materialAllowanceLabel: null,
      priceLabel: "$1,700",
    });
  });

  // The allowance is its own row between the Markup and the price, so the
  // Markup line still reads only what the percent added to the lines.
  it("reads the Material Allowance out on its own row, unmarked", () => {
    expect(
      priceReadout(
        { costCents: 154_545, priceCents: 300_000, materialAllowanceCents: 130_000 },
        en,
      ),
    ).toEqual({
      costLabel: "$1,545.45",
      markupAmountLabel: "$154.55",
      materialAllowanceLabel: "$1,300",
      priceLabel: "$3,000",
    });
  });

  // The amount is whatever the price the Solution's own Markup produced left
  // over the cost, so a repriced Solution reads out at its own figures rather
  // than at Expand's.
  it("reads out the amount the Solution's own Markup added", () => {
    expect(priceReadout({ costCents: 100_000, priceCents: 125_000 }, en)).toMatchObject({
      markupAmountLabel: "$250",
      priceLabel: "$1,250",
    });
  });

  it("has nothing to read out before anything is costed", () => {
    expect(priceReadout(null, en)).toBeNull();
  });
});

describe("The Markup field", () => {
  it("shows the percent plainly, with no sign to type around", () => {
    expect(markupField(10)).toBe("10");
    expect(markupField(0)).toBe("0");
  });

  // A whole percent as typed, or nothing yet — the same rule the Payment Terms
  // split keeps, because a fraction of a percent is not a Markup Expand sets.
  it("reads a whole percent, and nothing else", () => {
    expect(readMarkupField("25")).toBe(25);
    expect(readMarkupField(" 25 ")).toBe(25);
    expect(readMarkupField("25%")).toBe(25);
    expect(readMarkupField("0")).toBe(0);
  });

  it("stores a percent that is really a change", () => {
    expect(markupToStore("25", 10)).toBe(25);
    expect(markupToStore("0", 10)).toBe(0);
  });

  // A field left alone is not an edit, and a field left half-typed or holding
  // something that is not a percent snaps back to what the Solution is still
  // sold at rather than repricing it behind the author.
  it("stores nothing from a field nobody really changed", () => {
    expect(markupToStore("10", 10)).toBeNull();
    expect(markupToStore(" 10 ", 10)).toBeNull();
    expect(markupToStore("", 10)).toBeNull();
    expect(markupToStore("12.5", 10)).toBeNull();
    // Nothing the mutation would refuse is ever sent: past the ceiling the
    // field snaps back instead.
    expect(markupToStore("1001", 10)).toBeNull();
    expect(markupToStore("-5", 10)).toBeNull();
  });

  it("reads nothing at all from a field that is not a percent yet", () => {
    expect(readMarkupField("")).toBeNull();
    expect(readMarkupField(" ")).toBeNull();
    expect(readMarkupField("12.5")).toBeNull();
    expect(readMarkupField("-5")).toBeNull();
    expect(readMarkupField("abc")).toBeNull();
    expect(readMarkupField("%")).toBeNull();
    expect(readMarkupField("1 0")).toBeNull();
    // Past the ceiling the mutation refuses, so the field snaps back rather
    // than sending a figure that can only come back refused.
    expect(readMarkupField("1001")).toBeNull();
    expect(readMarkupField("99999999")).toBeNull();
  });

  // The field's ceiling is the mutation's, shared rather than repeated, so the
  // last percent Expand will store is the last one the field will read.
  it("reads the highest Markup the mutation would take", () => {
    expect(readMarkupField(String(MaxSolutionMarkupPercent))).toBe(
      MaxSolutionMarkupPercent,
    );
    expect(markupPercentFault(MaxSolutionMarkupPercent)).toBeNull();
    expect(markupPercentFault(MaxSolutionMarkupPercent + 1)).not.toBeNull();
  });
});

describe("What one line of the table costs", () => {
  it("multiplies out the quantity beside the line", () => {
    expect(lineCostLabel({ name: "Silicone", quantity: 2, unitCostCents: 50_000 }, en)).toBe(
      "$1,000",
    );
  });
});

describe("Reading the table as it is typed", () => {
  it("takes a quantity typed plainly, or with a decimal", () => {
    expect(readQuantity("2")).toBe(2);
    expect(readQuantity(" 2.5 ")).toBe(2.5);
    expect(readQuantity("1,200")).toBe(1200);
  });

  // A field on the way to a number is not an error; it is nothing yet.
  it("reads a field that is not a number yet as nothing", () => {
    expect(readQuantity("")).toBe(0);
    expect(readQuantity("-")).toBe(0);
    expect(readQuantity("abc")).toBe(0);
  });

  // Passed through rather than clamped, so the save refuses it out loud
  // instead of the table quietly pricing something else.
  it("passes a negative quantity through to be refused", () => {
    expect(readQuantity("-3")).toBe(-3);
  });

  it("reads money however it is typed", () => {
    expect(readUnitCostCents("500")).toBe(50_000);
    expect(readUnitCostCents("$1,250.50")).toBe(125_050);
    expect(readUnitCostCents(" 19.99 ")).toBe(1_999);
    expect(readUnitCostCents("")).toBe(0);
    expect(readUnitCostCents("abc")).toBe(0);
  });

  // Rounding, not truncation: a third of a dollar typed into a unit cost is 33
  // cents, and never 32.
  it("reads money to the nearest cent", () => {
    expect(readUnitCostCents("0.333")).toBe(33);
    expect(readUnitCostCents("10.005")).toBe(1_001);
  });

  it("writes cents back into the field as plain dollars", () => {
    expect(unitCostField(125_050)).toBe("1250.50");
    expect(unitCostField(1_999)).toBe("19.99");
    // An empty field, not "0.00": a cost nobody has typed reads as blank.
    expect(unitCostField(0)).toBe("");
  });

  it("opens a stored Solution's table with each line as it was saved", () => {
    expect(
      draftsFromLineItems([
        { name: "Silicone", quantity: 2.5, unit: "SF", unitCostCents: 50_000 },
        { name: "Disposal", quantity: 1, unitCostCents: 0 },
      ]),
    ).toEqual([
      {
        key: "stored-0",
        name: "Silicone",
        quantity: "2.5",
        unit: "SF",
        unitCost: "500.00",
        stored: true,
      },
      // A line stored before units existed is one of a thing, which is what it
      // has always meant.
      {
        key: "stored-1",
        name: "Disposal",
        quantity: "1",
        unit: "EA",
        unitCost: "",
        stored: true,
      },
    ]);
  });

  it("starts a new row at one of something, priced at nothing", () => {
    expect(blankLineItemDraft("new-1")).toEqual({
      key: "new-1",
      name: "",
      quantity: "1",
      unit: "EA",
      unitCost: "",
      stored: false,
    });
  });
});

describe("Which rows are Line Items yet", () => {
  it("takes every named row, trimmed", () => {
    expect(
      readLineItems([
        draft("  Silicone  ", "2", "500", "SF"),
        draft("Disposal", "1", "45.45"),
      ]),
    ).toEqual([
      { name: "Silicone", quantity: 2, unit: "SF", unitCostCents: 50_000 },
      { name: "Disposal", quantity: 1, unit: "EA", unitCostCents: 4_545 },
    ]);
  });

  // A fresh row is not a nameless Line Item to be refused; it is a row nobody
  // has written yet, and it neither saves nor prices.
  it("leaves an unnamed row out rather than refusing the save over it", () => {
    expect(readLineItems([draft("Silicone", "1", "500"), blankLineItemDraft("new-1")])).toEqual(
      [{ name: "Silicone", quantity: 1, unit: "EA", unitCostCents: 50_000 }],
    );
  });
});

describe("What the table is saved as", () => {
  it("saves every named row", () => {
    expect(
      lineItemsToStore([draft("Silicone", "1", "500"), blankLineItemDraft("new-1")]),
    ).toEqual([{ name: "Silicone", quantity: 1, unit: "EA", unitCostCents: 50_000 }]);
  });

  // Clearing a name is how somebody retypes it, and there is a Remove button
  // for deleting a line. Waiting is what keeps the two from meaning the same.
  it("waits rather than deleting a stored line whose name is being retyped", () => {
    expect(lineItemsToStore([draft("", "1", "500"), draft("Primer", "1", "200")])).toBeNull();
  });

  it("saves an emptied table, because taking every line off is a real edit", () => {
    expect(lineItemsToStore([])).toEqual([]);
  });
});

describe("Whether the table still says what is stored", () => {
  const stored = [{ name: "Silicone", quantity: 1, unitCostCents: 50_000 }];

  it("sees no edit in a table nobody changed", () => {
    expect(sameLineItems(readLineItems([draft("Silicone", "1", "500")]), stored)).toBe(
      true,
    );
  });

  // A line the author has retyped into square feet is a different line, even
  // though every figure on it is the same.
  it("sees a unit picked as an edit", () => {
    expect(
      sameLineItems(readLineItems([draft("Silicone", "1", "500", "SF")]), stored),
    ).toBe(false);
  });

  it("sees an edit to any of the three fields, and to the order", () => {
    expect(sameLineItems(readLineItems([draft("Silicone", "2", "500")]), stored)).toBe(
      false,
    );
    expect(sameLineItems(readLineItems([draft("Silicone", "1", "550")]), stored)).toBe(
      false,
    );
    expect(sameLineItems(readLineItems([draft("Sealant", "1", "500")]), stored)).toBe(
      false,
    );
    expect(sameLineItems([], stored)).toBe(false);
    expect(
      sameLineItems(
        [stored[0], { name: "Primer", quantity: 1, unitCostCents: 100 }],
        [{ name: "Primer", quantity: 1, unitCostCents: 100 }, stored[0]],
      ),
    ).toBe(false);
  });
});

describe("The price while the table is being typed", () => {
  it("prices the rows as they stand, at the Markup the panel shows", () => {
    expect(
      draftPrice([draft("Silicone", "1", "500"), draft("Labor", "10", "100")], 10),
    ).toEqual({ costCents: 150_000, priceCents: 165_000 });
  });

  // The Markup field is live too: the price under the table follows the
  // percent being typed above it, from the same module the server prices with.
  it("follows the Markup as it is changed", () => {
    expect(
      draftPrice([draft("Silicone", "1", "500"), draft("Labor", "10", "100")], 25),
    ).toEqual({ costCents: 150_000, priceCents: 187_500 });
  });

  it("has no price at all with nothing written down", () => {
    expect(draftPrice([], 10)).toBeNull();
    expect(draftPrice([blankLineItemDraft("new-1")], 10)).toBeNull();
  });

  it("adds the Material Allowance being typed, and is priced on it alone", () => {
    expect(draftPrice([draft("Silicone", "1", "500")], 10, 130_000)).toEqual({
      costCents: 50_000,
      priceCents: 185_000,
      materialAllowanceCents: 130_000,
    });
    expect(draftPrice([], 10, 130_000)).toMatchObject({ priceCents: 130_000 });
  });
});

describe("The Material Allowance field", () => {
  it("shows whole dollars plainly, with no sign or grouping to type around", () => {
    expect(materialAllowanceField(130_000)).toBe("1300");
  });

  it("reads whole dollars however they are typed", () => {
    for (const typed of ["1300", "1,300", "$1,300", " 1300 ", "1300.00"])
      expect(readMaterialAllowanceField(typed)).toBe(130_000);
  });

  // The live price only takes an allowance the save would keep: blank, "0",
  // cents, or anything that is not a figure yet add nothing while typing.
  it("reads nothing from a field that is not an allowance yet", () => {
    for (const typed of ["", "  ", "0", "12.50", "12.999", "-5", "abc"])
      expect(readMaterialAllowanceField(typed)).toBeUndefined();
  });

  it("stores a new or changed amount", () => {
    expect(materialAllowanceToStore("1300", null)).toBe(130_000);
    expect(materialAllowanceToStore("$1,500", 130_000)).toBe(150_000);
  });

  // Emptying the field and leaving it is the same edit as the ✕.
  it("clears a stored allowance when the field is emptied", () => {
    expect(materialAllowanceToStore("", 130_000)).toBeNull();
    expect(materialAllowanceToStore("  ", 130_000)).toBeNull();
  });

  it("stores nothing from a field nobody really changed", () => {
    expect(materialAllowanceToStore("1300", 130_000)).toBeUndefined();
    expect(materialAllowanceToStore("$1,300.00", 130_000)).toBeUndefined();
    // Added and left empty: there was nothing, and there still is.
    expect(materialAllowanceToStore("", null)).toBeUndefined();
  });

  // A figure that is not whole dollars is sent as typed, so the save refuses it
  // in words rather than the field quietly storing a different amount.
  it("passes an amount that is not an allowance through to be refused", () => {
    expect(materialAllowanceToStore("12.50", null)).toBe(1_250);
    expect(materialAllowanceToStore("0", 130_000)).toBe(0);
    // Not rounded to the cent first, or "12.999" would be stored as $13.
    expect(materialAllowanceToStore("12.999", null)).not.toBe(1_300);
    expect(materialAllowanceToStore("12.999", 1_300)).not.toBeUndefined();
  });
});

describe("The Solutions list row's detail", () => {
  it("counts the Line Items", () => {
    expect(solutionDetailLabel(0, null, en)).toBe("No line items");
    expect(solutionDetailLabel(1, null, en)).toBe("1 line item");
    expect(solutionDetailLabel(4, null, en)).toBe("4 line items");
  });

  it("names a Material Allowance beside them", () => {
    expect(solutionDetailLabel(4, 130_000, en)).toBe(
      "4 line items · $1,300 material allowance",
    );
    expect(solutionDetailLabel(0, 130_000, en)).toBe(
      "No line items · $1,300 material allowance",
    );
  });
});

describe("Reordering the table", () => {
  const rows = [draft("A", "1", "1"), draft("B", "1", "2"), draft("C", "1", "3")];

  it("moves a row past its neighbour either way", () => {
    expect(moveDraft(rows, 1, "up").map((row) => row.name)).toEqual(["B", "A", "C"]);
    expect(moveDraft(rows, 1, "down").map((row) => row.name)).toEqual(["A", "C", "B"]);
  });

  it("leaves the table alone at either end", () => {
    expect(moveDraft(rows, 0, "up").map((row) => row.name)).toEqual(["A", "B", "C"]);
    expect(moveDraft(rows, 2, "down").map((row) => row.name)).toEqual(["A", "B", "C"]);
  });
});
