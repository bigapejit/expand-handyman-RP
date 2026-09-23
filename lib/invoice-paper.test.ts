import { describe, expect, it } from "vitest";

import { invoicePaperTitle, invoiceTaxLabel } from "./invoice-paper";

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
});
