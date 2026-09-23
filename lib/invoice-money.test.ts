import { describe, expect, it } from "vitest";

import {
  depositLine,
  invoiceMoney,
  invoiceNumberLabel,
  invoiceTaxRate,
} from "./invoice-money";
import type { ProposalTax } from "./proposal-pricing";

const vancouver: ProposalTax = { source: "lookup", rate: 0.087, locationCode: "0605" };

describe("What an invoice adds up to", () => {
  it("sums the lines, taxes the sum once and adds the two", () => {
    expect(
      invoiceMoney(
        [
          { description: "Kitchen faucet and hallway repair", cents: 400_000 },
          { description: "Less deposit invoiced (INV-1001)", cents: -200_000 },
          { description: "Material allowance credit", cents: -8_000 },
          { description: "Approved extra", cents: 14_500 },
        ],
        0.087,
      ),
    ).toEqual({ subtotalCents: 206_500, taxCents: 17_966, amountDueCents: 224_466 });
  });

  it("rounds the tax to the cent, half away from nothing", () => {
    // 1,005 × 0.1 is 100.5 cents.
    expect(invoiceMoney([{ description: "Hinge", cents: 1_005 }], 0.1).taxCents).toBe(101);
  });

  it("charges nothing on a tax-free invoice", () => {
    expect(invoiceMoney([{ description: "Gate", cents: 55_000 }], 0)).toEqual({
      subtotalCents: 55_000,
      taxCents: 0,
      amountDueCents: 55_000,
    });
  });

  it("comes to nothing with no lines", () => {
    expect(invoiceMoney([], 0.087)).toEqual({ subtotalCents: 0, taxCents: 0, amountDueCents: 0 });
  });
});

describe("The rate an invoice copies from its proposal", () => {
  it("is the proposal's charged rate", () => {
    expect(invoiceTaxRate(vancouver)).toBe(0.087);
    expect(invoiceTaxRate({ source: "override", rate: 0.09 })).toBe(0.09);
  });

  it("is zero where the proposal charges none", () => {
    expect(invoiceTaxRate({ source: "none" })).toBe(0);
  });
});

describe("The deposit invoice's one line", () => {
  const offer = {
    name: "Kitchen faucet and hallway repair",
    // $4,000 before tax at 8.7%.
    totalCents: 434_800,
    tax: vancouver,
  };

  it("bills a percent Deposit's share before tax, named with its percent", () => {
    const line = depositLine({ ...offer, depositPercent: 50 });
    expect(line).toEqual({
      description: "Deposit (50%) for Kitchen faucet and hallway repair",
      cents: 200_000,
    });
    // Tax on top brings Amount Due back to the Deposit as signed.
    expect(invoiceMoney([line!], 0.087).amountDueCents).toBe(217_400);
  });

  it("bills a set Deposit's share before tax, named without a percent", () => {
    const line = depositLine({ ...offer, depositPercent: 50, depositCents: 100_000 });
    expect(line).toEqual({
      description: "Deposit for Kitchen faucet and hallway repair",
      cents: 91_996,
    });
    expect(invoiceMoney([line!], 0.087).amountDueCents).toBe(100_000);
  });

  it("bills a tax-free proposal's Deposit as it stands", () => {
    const line = depositLine({
      name: "Fix gate",
      totalCents: 55_000,
      depositPercent: 30,
      tax: { source: "none" },
    });
    expect(line).toEqual({ description: "Deposit (30%) for Fix gate", cents: 16_500 });
    expect(invoiceMoney([line!], 0).amountDueCents).toBe(16_500);
  });

  it("lets Amount Due drift a cent from the signed Deposit, so the tax stays one rule", () => {
    // A set Deposit of $299.11 at 8.9%: its share before tax is $274.66, and
    // the tax on that, $24.44, brings Amount Due to $299.10.
    const line = depositLine({
      name: "Fix gate",
      totalCents: 59_895,
      depositPercent: 50,
      depositCents: 29_911,
      tax: { source: "lookup", rate: 0.089 },
    });
    expect(line?.cents).toBe(27_466);
    expect(invoiceMoney([line!], 0.089)).toEqual({
      subtotalCents: 27_466,
      taxCents: 2_444,
      amountDueCents: 29_910,
    });
  });

  it("makes no line for a Deposit of nothing", () => {
    expect(depositLine({ ...offer, depositPercent: 0 })).toBeNull();
    expect(depositLine({ ...offer, depositPercent: 50, depositCents: 0 })).toBeNull();
  });
});

describe("The invoice number", () => {
  it("reads INV- and the count", () => {
    expect(invoiceNumberLabel(1001)).toBe("INV-1001");
  });
});
