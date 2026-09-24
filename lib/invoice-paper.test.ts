import { describe, expect, it } from "vitest";

import {
  invoiceLinkStrip,
  invoicePaperState,
  invoicePaperTitle,
  invoiceTaxLabel,
  stampDate,
} from "./invoice-paper";

describe("The invoice paper's words", () => {
  it("titles the screen with the invoice number and the street", () => {
    expect(
      invoicePaperTitle({
        number: "INV-1001",
        site: { street: "3107 Kauffman Ave", city: "Vancouver, WA 98660" },
      }),
    ).toBe("Invoice INV-1001 · 3107 Kauffman Ave");
  });

  it("writes the rate as a percent, as the proposal paper does", () => {
    expect(invoiceTaxLabel(0.087)).toBe("Sales Tax (8.7%)");
    expect(invoiceTaxLabel(0.0865)).toBe("Sales Tax (8.65%)");
    expect(invoiceTaxLabel(0)).toBe("Sales Tax (0%)");
  });

  it("writes a stamp's day the way the paper writes days", () => {
    expect(stampDate("2026-09-03")).toBe("9/3/2026");
    expect(stampDate("2026-12-31")).toBe("12/31/2026");
  });

  it("names the paper by its stamp", () => {
    expect(invoicePaperState({ stamp: null })).toBe("sent");
    expect(invoicePaperState({ stamp: { kind: "paid", day: "2026-09-03" } })).toBe("paid");
    expect(invoicePaperState({ stamp: { kind: "void", day: "2026-09-03" } })).toBe("void");
  });

  it("says under the link's top bar that it is paid or void, and nothing while owed", () => {
    expect(invoiceLinkStrip(null)).toBeUndefined();
    expect(invoiceLinkStrip({ kind: "paid", day: "2026-09-03" })).toEqual({
      tone: "signed",
      body: "Paid on 9/3/2026. Thank you.",
    });
    expect(invoiceLinkStrip({ kind: "void", day: "2026-09-04" })).toEqual({
      tone: "declined",
      body: "Expand Handyman voided this invoice on 9/4/2026. Nothing is due on it.",
    });
  });
});
