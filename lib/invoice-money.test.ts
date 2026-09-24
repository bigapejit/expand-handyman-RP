import { describe, expect, it } from "vitest";

import {
  depositLine,
  finalInvoiceLines,
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

  it("rounds the tax to the cent, a half cent up", () => {
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

describe("The final invoice's prefilled lines", () => {
  // $4,000 before tax, as Send froze it.
  const proposal = { name: "Kitchen faucet and hallway repair", subtotalCents: 400_000 };
  const deposit = {
    kind: "deposit" as const,
    state: "sent" as const,
    number: 1001,
    lines: [{ description: "Deposit (50%) for Kitchen faucet and hallway repair", cents: 200_000 }],
  };

  it("takes the deposit invoice off the proposal's price, naming it by its number", () => {
    expect(finalInvoiceLines(proposal, [deposit])).toEqual([
      { description: "Kitchen faucet and hallway repair", cents: 400_000 },
      { description: "Less deposit invoiced (INV-1001)", cents: -200_000 },
    ]);
  });

  it("takes off every invoice sent on it, in number order, each at its subtotal", () => {
    const midway = {
      kind: "typed" as const,
      state: "sent" as const,
      number: 1003,
      lines: [
        { description: "Framing midway", cents: 90_000 },
        { description: "Credit for returned lumber", cents: -10_000 },
      ],
    };
    // Listed out of order, as a query might hand them over.
    expect(finalInvoiceLines(proposal, [midway, deposit])).toEqual([
      { description: "Kitchen faucet and hallway repair", cents: 400_000 },
      { description: "Less deposit invoiced (INV-1001)", cents: -200_000 },
      { description: "Less invoiced (INV-1003)", cents: -80_000 },
    ]);
  });

  it("skips void invoices and drafts, which billed nothing", () => {
    const voided = { ...deposit, state: "void" as const, number: 1002 };
    const draft = {
      kind: "typed" as const,
      state: "draft" as const,
      lines: [{ description: "Extra", cents: 5_000 }],
    };
    expect(finalInvoiceLines(proposal, [voided, draft, { ...deposit, number: 1004 }])).toEqual([
      { description: "Kitchen faucet and hallway repair", cents: 400_000 },
      { description: "Less deposit invoiced (INV-1004)", cents: -200_000 },
    ]);
  });

  it("bills a tax-free proposal's balance with no tax on top", () => {
    const lines = finalInvoiceLines({ name: "Fix gate", subtotalCents: 55_000 }, [
      {
        kind: "deposit",
        state: "sent",
        number: 1001,
        lines: [{ description: "Deposit (30%) for Fix gate", cents: 16_500 }],
      },
    ]);
    expect(lines).toEqual([
      { description: "Fix gate", cents: 55_000 },
      { description: "Less deposit invoiced (INV-1001)", cents: -16_500 },
    ]);
    expect(invoiceMoney(lines, 0)).toEqual({
      subtotalCents: 38_500,
      taxCents: 0,
      amountDueCents: 38_500,
    });
  });

  it("is the proposal's whole price when nothing was sent before it", () => {
    expect(finalInvoiceLines(proposal, [])).toEqual([
      { description: "Kitchen faucet and hallway repair", cents: 400_000 },
    ]);
  });

  it("can come to nothing, or to a credit when more was billed than the price", () => {
    const whole = { ...deposit, lines: [{ description: "Deposit (100%)", cents: 400_000 }] };
    const extra = {
      kind: "typed" as const,
      state: "sent" as const,
      number: 1002,
      lines: [{ description: "Extra", cents: 20_000 }],
    };
    expect(invoiceMoney(finalInvoiceLines(proposal, [whole]), 0.087).amountDueCents).toBe(0);
    expect(invoiceMoney(finalInvoiceLines(proposal, [whole, extra]), 0.087).amountDueCents).toBe(
      -21_740,
    );
  });
});
