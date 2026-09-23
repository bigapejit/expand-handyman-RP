import { describe, expect, it } from "vitest";

import {
  DefaultLineItemUnit,
  isLineItemUnit,
  LineItemUnits,
  lineItemUnitLabel,
  readLineItemUnit,
} from "./line-item-units";

describe("the list of units", () => {
  it("is the six Expand prices in, in the order a picker offers them", () => {
    expect(LineItemUnits).toEqual(["EA", "SF", "LF", "HR", "DA", "WK"]);
  });

  it("starts a line off at one of a thing", () => {
    expect(DefaultLineItemUnit).toBe("EA");
  });

  it("spells every one of them out", () => {
    for (const unit of LineItemUnits) {
      expect(lineItemUnitLabel(unit)).toMatch(/\S/);
    }
    expect(lineItemUnitLabel("SF")).toBe("square feet");
  });

  it("recognises a unit only by its exact spelling", () => {
    expect(isLineItemUnit("LF")).toBe(true);
    expect(isLineItemUnit("lf")).toBe(false);
    expect(isLineItemUnit("SQ")).toBe(false);
    expect(isLineItemUnit("")).toBe(false);
  });
});

describe("reading a stored unit", () => {
  it("keeps the one that is there", () => {
    expect(readLineItemUnit("HR")).toBe("HR");
  });

  it("reads a line written before units as each", () => {
    expect(readLineItemUnit(undefined)).toBe("EA");
  });

  it("reads anything off the list as each rather than failing", () => {
    expect(readLineItemUnit("SQ")).toBe("EA");
  });
});
