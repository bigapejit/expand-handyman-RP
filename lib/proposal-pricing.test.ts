import { describe, expect, it } from "vitest";

import type { SolutionPrice } from "./solution-pricing";
import {
  DefaultDepositPercent,
  depositBlockers,
  depositCentsFault,
  depositPercentFault,
  paymentRows,
  paymentTermsSentence,
  proposalDisplayName,
  proposalFaultMessage,
  proposalMoney,
  sendBlockerMessage,
  sendBlockers,
  splitPayment,
  storedDeposit,
  taxRateFault,
  type Deposit,
  type ProposalTax,
} from "./proposal-pricing";

const percent = (value: number): Deposit => ({ kind: "percent", percent: value });
const amount = (cents: number): Deposit => ({ kind: "amount", cents });

// A priced Solution as the Proposal meets one: the cost behind it is the
// Solution's own business and never reaches a Proposal's arithmetic.
function priced(priceCents: number): SolutionPrice {
  return { costCents: Math.round(priceCents / 1.1), priceCents };
}

const noTax: ProposalTax = { source: "none" };
const vancouver: ProposalTax = {
  source: "lookup",
  rate: 0.089,
  locationCode: "0605",
  period: "Q32026",
};

describe("What a Proposal adds up to", () => {
  // The acceptance figures from issue #208: $10,200 of Solutions at 8.9%.
  it("charges Washington's rate on the whole subtotal", () => {
    expect(proposalMoney([priced(700_000), priced(320_000)], vancouver)).toEqual({
      subtotalCents: 1_020_000,
      taxCents: 90_780,
      totalCents: 1_110_780,
    });
  });

  it("shows an Oregon Proposal no tax at all", () => {
    expect(proposalMoney([priced(1_020_000)], noTax)).toEqual({
      subtotalCents: 1_020_000,
      taxCents: 0,
      totalCents: 1_020_000,
    });
  });

  // A Washington Site whose lookup came back with nothing does owe tax; the
  // Proposal simply cannot say how much yet, and it may not be Sent until it
  // can. Charging zero in the meantime is an absent figure, not a checked one.
  it("charges nothing while a Washington rate is still missing", () => {
    expect(proposalMoney([priced(1_020_000)], { source: "lookup" })).toEqual({
      subtotalCents: 1_020_000,
      taxCents: 0,
      totalCents: 1_020_000,
    });
  });

  it("rounds the tax to the cent", () => {
    // $100.05 at 8.9% is 890.445 cents.
    expect(proposalMoney([priced(10_005)], vancouver).taxCents).toBe(890);
  });

  // A Draft is assembled before it is priced: an unpriced Solution contributes
  // nothing rather than making the whole readout unanswerable.
  it("leaves an unpriced Solution out of the subtotal", () => {
    expect(proposalMoney([priced(500_000), null], vancouver).subtotalCents).toBe(
      500_000,
    );
  });

  it("adds up to nothing at all with no Solutions", () => {
    expect(proposalMoney([], vancouver)).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it("charges an overridden rate exactly as it charges a looked-up one", () => {
    expect(
      proposalMoney([priced(1_020_000)], { source: "override", rate: 0.089 }).taxCents,
    ).toBe(90_780);
  });
});

describe("How a total splits into a Deposit and a Balance", () => {
  it("halves the total by default", () => {
    expect(DefaultDepositPercent).toBe(50);
    expect(splitPayment(1_110_780, percent(DefaultDepositPercent))).toEqual({
      deposit: percent(50),
      depositCents: 555_390,
      balanceCents: 555_390,
    });
  });

  // The Balance is the remainder, never a second percentage: the two figures
  // the customer is shown have to add up to the one they owe.
  it.each([0, 50, 100])("sums to the total at %i%% deposit", (value) => {
    const split = splitPayment(1_110_780, percent(value));
    expect(split.depositCents + split.balanceCents).toBe(1_110_780);
  });

  it("sums to the total on a figure that does not divide evenly", () => {
    const split = splitPayment(1_000_001, percent(33));
    expect(split.depositCents).toBe(330_000);
    expect(split.balanceCents).toBe(670_001);
  });

  it("takes everything on signing at 100, and nothing at 0", () => {
    expect(splitPayment(100_000, percent(100))).toMatchObject({
      depositCents: 100_000,
      balanceCents: 0,
    });
    expect(splitPayment(100_000, percent(0))).toMatchObject({
      depositCents: 0,
      balanceCents: 100_000,
    });
  });

  // A set amount is the figure typed, whatever the total does.
  it("takes a set amount as typed, and leaves the rest as the Balance", () => {
    expect(splitPayment(592_961, amount(150_000))).toEqual({
      deposit: amount(150_000),
      depositCents: 150_000,
      balanceCents: 442_961,
    });
  });

  it("leaves a Balance below zero when the total drops under a set amount", () => {
    expect(splitPayment(135_300, amount(150_000)).balanceCents).toBe(-14_700);
  });
});

describe("The Deposit a proposal stores", () => {
  it("is the percent, until a set amount overrides it", () => {
    expect(storedDeposit({ depositPercent: 30 })).toEqual(percent(30));
    expect(storedDeposit({ depositPercent: 30, depositCents: 150_000 })).toEqual(
      amount(150_000),
    );
  });
});

describe("How the split reads to the customer", () => {
  it("names both payments", () => {
    expect(paymentTermsSentence(splitPayment(100_000, percent(50)))).toBe(
      "50% on signing, 50% on completion",
    );
    expect(paymentTermsSentence(splitPayment(100_000, percent(25)))).toBe(
      "25% on signing, 75% on completion",
    );
    expect(paymentTermsSentence(splitPayment(592_961, amount(150_000)))).toBe(
      "$1,500.00 on signing, the balance on completion",
    );
  });

  // One payment is one sentence: "100% on signing, 0% on completion" describes
  // a payment of nothing that never happens.
  it("names one payment at either end", () => {
    expect(paymentTermsSentence(splitPayment(100_000, percent(100)))).toBe(
      "One payment on signing",
    );
    expect(paymentTermsSentence(splitPayment(100_000, percent(0)))).toBe(
      "One payment on completion",
    );
    expect(paymentTermsSentence(splitPayment(100_000, amount(100_000)))).toBe(
      "One payment on signing",
    );
    expect(paymentTermsSentence(splitPayment(100_000, amount(0)))).toBe(
      "One payment on completion",
    );
  });
});

describe("The payment rows the paper prints", () => {
  it("keeps the percent wording for a percent Deposit", () => {
    expect(paymentRows(splitPayment(592_961, percent(50)))).toEqual([
      { label: "50% due on signing", cents: 296_481 },
      { label: "50% due on completion", cents: 296_480 },
    ]);
  });

  // A percent worked back from a typed figure is not one anybody chose.
  it("names the Deposit and the Balance for a set amount", () => {
    expect(paymentRows(splitPayment(592_961, amount(150_000)))).toEqual([
      { label: "Deposit due on signing", cents: 150_000 },
      { label: "Balance due on completion", cents: 442_961 },
    ]);
  });

  it("leaves off a payment of nothing", () => {
    expect(paymentRows(splitPayment(100_000, percent(100)))).toEqual([
      { label: "100% due on signing", cents: 100_000 },
    ]);
    expect(paymentRows(splitPayment(100_000, percent(0)))).toEqual([
      { label: "100% due on completion", cents: 100_000 },
    ]);
    expect(paymentRows(splitPayment(100_000, amount(100_000)))).toEqual([
      { label: "Deposit due on signing", cents: 100_000 },
    ]);
    expect(paymentRows(splitPayment(100_000, amount(0)))).toEqual([
      { label: "Balance due on completion", cents: 100_000 },
    ]);
  });
});

describe("What a Proposal refuses", () => {
  it("takes a whole percent between nothing and everything", () => {
    expect(depositPercentFault(0)).toBeNull();
    expect(depositPercentFault(50)).toBeNull();
    expect(depositPercentFault(100)).toBeNull();
  });

  it("refuses a split outside the range, or a fraction of a percent", () => {
    expect(depositPercentFault(-1)).toBe("deposit_percent_invalid");
    expect(depositPercentFault(101)).toBe("deposit_percent_invalid");
    expect(depositPercentFault(33.5)).toBe("deposit_percent_invalid");
    expect(depositPercentFault(Number.NaN)).toBe("deposit_percent_invalid");
  });

  it("takes a set amount of whole cents, from nothing up to the whole total", () => {
    expect(depositCentsFault(0, 592_961)).toBeNull();
    expect(depositCentsFault(150_000, 592_961)).toBeNull();
    expect(depositCentsFault(592_961, 592_961)).toBeNull();
  });

  it("refuses a set amount below zero, in fractions of a cent, or past the total", () => {
    expect(depositCentsFault(-1, 592_961)).toBe("deposit_amount_invalid");
    expect(depositCentsFault(150_000.5, 592_961)).toBe("deposit_amount_invalid");
    expect(depositCentsFault(Number.NaN, 592_961)).toBe("deposit_amount_invalid");
    expect(depositCentsFault(800_000, 592_961)).toBe("deposit_over_total");
  });

  // Rates are decimals of the whole, the same as DOR states them: an "8.9"
  // typed straight into the field would charge 890% of the subtotal.
  it("refuses a tax rate that is not a decimal of the whole", () => {
    expect(taxRateFault(0.089)).toBeNull();
    expect(taxRateFault(0)).toBeNull();
    expect(taxRateFault(8.9)).toBe("tax_rate_invalid");
    expect(taxRateFault(-0.01)).toBe("tax_rate_invalid");
  });

  it("words every refusal for the panel that shows it", () => {
    expect(proposalFaultMessage("deposit_percent_invalid")).toMatch(/whole percent/);
    expect(proposalFaultMessage("deposit_amount_invalid")).toMatch(/dollar figure/);
    expect(proposalFaultMessage("deposit_over_total")).toMatch(/more than/);
    expect(proposalFaultMessage("tax_rate_invalid")).toMatch(/rate/);
  });
});

describe("What stops a Draft being Sent", () => {
  it("is nothing, on a priced Washington Draft with a rate", () => {
    expect(sendBlockers([500_000], vancouver)).toEqual([]);
  });

  it("names an empty Draft", () => {
    expect(sendBlockers([], vancouver)).toEqual(["no_solutions"]);
  });

  it("names an unpriced Solution", () => {
    expect(sendBlockers([500_000, null], vancouver)).toEqual([
      "unpriced_solution",
    ]);
  });

  it("names a Washington Draft with no rate", () => {
    expect(sendBlockers([500_000], { source: "lookup" })).toEqual([
      "no_tax_rate",
    ]);
  });

  // An Oregon Site is never waiting on a rate: it charges no tax at all.
  it("never waits on a rate outside Washington", () => {
    expect(sendBlockers([500_000], noTax)).toEqual([]);
  });

  it("names every reason at once, so the button can say all of them", () => {
    expect(sendBlockers([null], { source: "lookup" })).toEqual([
      "unpriced_solution",
      "no_tax_rate",
    ]);
  });

  // A set amount stays as typed, so the total can drop beneath it later.
  it("names a Deposit larger than the total", () => {
    expect(depositBlockers(splitPayment(135_300, amount(150_000)))).toEqual([
      "deposit_over_total",
    ]);
    expect(depositBlockers(splitPayment(150_000, amount(150_000)))).toEqual([]);
    expect(depositBlockers(splitPayment(135_300, percent(100)))).toEqual([]);
  });

  it("words every reason", () => {
    expect(sendBlockerMessage("deposit_over_total")).toMatch(/deposit/);
    expect(sendBlockerMessage("no_solutions")).toMatch(/Solution/);
    expect(sendBlockerMessage("unpriced_solution")).toMatch(/price/);
    expect(sendBlockerMessage("no_tax_rate")).toMatch(/rate/);
  });
});

describe("What a Proposal is called", () => {
  it("joins the titles of the Solutions it holds", () => {
    expect(proposalDisplayName(undefined, ["Re-roof", "Skylight curbs"])).toBe(
      "Re-roof + Skylight curbs",
    );
  });

  it("prefers the name somebody typed", () => {
    expect(proposalDisplayName("Option A", ["Re-roof"])).toBe("Option A");
  });

  it("has something to call a Draft holding nothing", () => {
    expect(proposalDisplayName(undefined, [])).toBe("Untitled proposal");
    expect(proposalDisplayName("  ", ["Re-roof"])).toBe("Re-roof");
  });
});
