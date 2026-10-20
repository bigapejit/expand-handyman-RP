import { describe, expect, it } from "vitest";

import {
  DefaultJobMathSettings,
  dollarsField,
  jobMath,
  jobMathHref,
  jobMathSettingsFault,
  jobMathSettingsFaultMessage,
  readDollarsField,
  readHoursField,
  readJobMathSettings,
  solutionJobInputs,
  type JobMathSettings,
  type JobMathSettingsFault,
} from "./job-math";

const defaults = DefaultJobMathSettings;

function settings(patch: Partial<JobMathSettings>): JobMathSettings {
  return { ...defaults, ...patch };
}

// The job the owner worked through by hand: gutters on four houses, eight
// hours, the customer offered $350, and a helper would be paid $30 an hour.
describe("The gutter job", () => {
  const math = jobMath({ priceCents: 35_000, laborHours: 8, otherCostCents: 0 }, defaults);

  it("takes 10% of the price into each bucket", () => {
    expect(math.buckets.map((b) => [b.key, b.cents])).toEqual([
      ["profit", 3_500],
      ["marketing", 3_500],
      ["ops", 3_500],
    ]);
  });

  it("leaves the rest for labor", () => {
    expect(math.laborPoolCents).toBe(24_500);
  });

  // 18,375 ÷ 8 = 2,296.875, to the nearest cent.
  it("tells the owner what he keeps doing it himself", () => {
    expect(math.owner).toEqual({
      payCents: 24_500,
      taxSetAsideCents: 6_125,
      takeHomeCents: 18_375,
      takeHomePerHourCents: 2_297,
    });
  });

  // (24,500 ÷ 8 − 246) ÷ 1.11 = 2,537.39…
  it("says the most it can pay a W-2 worker an hour", () => {
    expect(math.w2.maxWageCents).toBe(2_537);
  });

  it("costs a W-2 worker at $30 an hour, and shows the loss", () => {
    expect(math.w2.atWage).toEqual({
      wageCents: 3_000,
      wagesCents: 24_000,
      payrollTaxCents: 2_640,
      workersCompCents: 1_968,
      totalCostCents: 28_608,
      leftOverCents: -4_108,
    });
  });

  // 28,608 ÷ 0.7 = 40,868.57, up to the whole dollar.
  it("says what to charge to pay $30 an hour with the buckets intact", () => {
    expect(math.priceForWageCents).toBe(40_900);
  });

  it("really does keep the buckets intact at that price", () => {
    const charged = jobMath(
      { priceCents: math.priceForWageCents!, laborHours: 8, otherCostCents: 0 },
      defaults,
    );
    expect(charged.w2.atWage.leftOverCents).toBeGreaterThanOrEqual(0);
  });
});

describe("The most a job can pay an hour", () => {
  it("is the highest wage that leaves nothing negative, and a cent more does", () => {
    const at = (wageCents: number) =>
      jobMath({ priceCents: 35_000, laborHours: 8, otherCostCents: 0, wageCents }, defaults)
        .w2.atWage.leftOverCents;
    expect(at(2_537)).toBeGreaterThanOrEqual(0);
    expect(at(2_538)).toBeLessThan(0);
  });

  it("is nothing to speak of when L&I alone eats the pool", () => {
    const math = jobMath({ priceCents: 1_000, laborHours: 8, otherCostCents: 0 }, defaults);
    expect(math.w2.maxWageCents).toBeLessThanOrEqual(0);
  });

  it("takes fractional hours", () => {
    const math = jobMath(
      { priceCents: 20_000, laborHours: 1.5, otherCostCents: 0 },
      defaults,
    );
    const wage = math.w2.maxWageCents!;
    const left = (wageCents: number) =>
      jobMath(
        { priceCents: 20_000, laborHours: 1.5, otherCostCents: 0, wageCents },
        defaults,
      ).w2.atWage.leftOverCents;
    expect(left(wage)).toBeGreaterThanOrEqual(0);
    expect(left(wage + 1)).toBeLessThan(0);
  });
});

describe("A job with no hours", () => {
  const math = jobMath(
    { priceCents: 10_000, laborHours: 0, otherCostCents: 2_000 },
    defaults,
  );

  it("has no per-hour figures", () => {
    expect(math.owner.takeHomePerHourCents).toBeNull();
    expect(math.w2.maxWageCents).toBeNull();
  });

  it("costs no wages", () => {
    expect(math.w2.atWage.totalCostCents).toBe(0);
  });

  // 2,000 ÷ 0.7 = 2,857.14, up to $29.
  it("still says what covers the other costs with the buckets intact", () => {
    expect(math.priceForWageCents).toBe(2_900);
  });
});

describe("A job priced under its costs", () => {
  const math = jobMath(
    { priceCents: 10_000, laborHours: 2, otherCostCents: 9_000 },
    defaults,
  );

  it("leaves a negative amount for labor rather than clamping it", () => {
    expect(math.laborPoolCents).toBe(-2_000);
  });

  it("sets no tax aside on a loss", () => {
    expect(math.owner.taxSetAsideCents).toBe(0);
    expect(math.owner.takeHomeCents).toBe(-2_000);
    expect(math.owner.takeHomePerHourCents).toBe(-1_000);
  });
});

describe("Rounding", () => {
  it("rounds a half-cent bucket up", () => {
    const math = jobMath({ priceCents: 5, laborHours: 0, otherCostCents: 0 }, defaults);
    expect(math.buckets[0].cents).toBe(1);
  });

  // 1.15 × 100 is 114.99999999999999 in floating point; the bucket must
  // still be exactly 1.15% of the price.
  it("takes a two-decimal percent exactly", () => {
    const math = jobMath(
      { priceCents: 100_000, laborHours: 0, otherCostCents: 0 },
      settings({ profitPercent: 1.15 }),
    );
    expect(math.buckets[0].cents).toBe(1_150);
  });

  it("uses the wage typed over the default", () => {
    const math = jobMath(
      { priceCents: 35_000, laborHours: 8, otherCostCents: 0, wageCents: 2_000 },
      defaults,
    );
    expect(math.w2.atWage.wagesCents).toBe(16_000);
  });

  // Three buckets of 10.5% on $101 are 1,060.5 cents each, and each rounds up,
  // taking 1.5 cents more than 31.5% of the price. $101 is what dividing says
  // covers $69.18, but after the buckets round it leaves $69.17, so the price
  // goes up a dollar.
  it("raises the price a dollar when rounded buckets would leave the work a cent short", () => {
    const math = jobMath(
      { priceCents: 0, laborHours: 0, otherCostCents: 6_918 },
      settings({ profitPercent: 10.5, marketingPercent: 10.5, opsPercent: 10.5 }),
    );
    expect(math.priceForWageCents).toBe(10_200);
  });

  // The markup trap: multiplying by 1.3 underfunds the buckets.
  it("divides by what the buckets leave rather than multiplying by them", () => {
    const math = jobMath(
      { priceCents: 0, laborHours: 0, otherCostCents: 100_000 },
      defaults,
    );
    expect(math.priceForWageCents).toBe(142_900);
  });

  // Buckets just short of 100% leave a hundredth of a cent per dollar, so the
  // roundings can take many dollars to make up; the price keeps climbing
  // until the work is covered rather than giving up after a few. (From Codex.)
  it("keeps raising the price until the rounded buckets leave the work covered", () => {
    const tight = settings({ profitPercent: 10.96, marketingPercent: 89.01, opsPercent: 0.01 });
    const cost = 845_643;
    const price = jobMath({ priceCents: 0, laborHours: 0, otherCostCents: cost }, tight)
      .priceForWageCents!;
    const atPrice = jobMath({ priceCents: price, laborHours: 0, otherCostCents: cost }, tight);
    expect(atPrice.laborPoolCents).toBeGreaterThanOrEqual(0);
    const dollarLess = jobMath(
      { priceCents: price - 100, laborHours: 0, otherCostCents: cost },
      tight,
    );
    expect(dollarLess.laborPoolCents).toBeLessThan(0);
  });
});

describe("The most you can pay, on a short job", () => {
  // A short job: every cent of wage moves the rounded cost by less than a
  // cent, so the answer is many cents above where the search starts, and
  // must still be the highest that leaves nothing negative. 0.01 hours is
  // Codex's case, where the search once stopped about 96 cents short.
  it.each([0.01, 0.25, 0.1, 1.5, 7.75])("finds the highest wage that leaves nothing negative at %s hours", (hours) => {
    const math = jobMath({ priceCents: 5_000, laborHours: hours, otherCostCents: 0 }, defaults);
    const wage = math.w2.maxWageCents!;
    const at = jobMath(
      { priceCents: 5_000, laborHours: hours, otherCostCents: 0, wageCents: wage },
      defaults,
    );
    expect(at.w2.atWage.leftOverCents).toBeGreaterThanOrEqual(0);
    const centMore = jobMath(
      { priceCents: 5_000, laborHours: hours, otherCostCents: 0, wageCents: wage + 1 },
      defaults,
    );
    expect(centMore.w2.atWage.leftOverCents).toBeLessThan(0);
  });
});

describe("The settings", () => {
  it("fills in every default for a row that holds none", () => {
    expect(readJobMathSettings(undefined)).toEqual(defaults);
    expect(readJobMathSettings({ profitPercent: 15 })).toEqual(
      settings({ profitPercent: 15 }),
    );
  });

  it("keeps a stored zero as a real figure", () => {
    expect(readJobMathSettings({ marketingPercent: 0 }).marketingPercent).toBe(0);
  });

  it("accepts the defaults and two decimals", () => {
    expect(jobMathSettingsFault(defaults)).toBeNull();
    expect(jobMathSettingsFault(settings({ payrollTaxPercent: 9.65 }))).toBeNull();
  });

  it.each<[Partial<JobMathSettings>, JobMathSettingsFault]>([
    [{ profitPercent: -1 }, "profit_percent_invalid"],
    [{ profitPercent: Number.NaN }, "profit_percent_invalid"],
    [{ marketingPercent: Number.POSITIVE_INFINITY }, "marketing_percent_invalid"],
    [{ opsPercent: 1.234 }, "ops_percent_invalid"],
    [{ profitPercent: 50, marketingPercent: 30, opsPercent: 20 }, "buckets_too_high"],
    [{ ownerTaxPercent: 100 }, "owner_tax_percent_invalid"],
    [{ ownerTaxPercent: -5 }, "owner_tax_percent_invalid"],
    [{ payrollTaxPercent: -0.01 }, "payroll_tax_percent_invalid"],
    [{ workersCompCentsPerHour: 300.5 }, "workers_comp_invalid"],
    [{ workersCompCentsPerHour: -1 }, "workers_comp_invalid"],
    [{ wageCents: 2_999.5 }, "wage_invalid"],
    [{ wageCents: -100 }, "wage_invalid"],
  ])("refuses %o as %s", (patch, fault) => {
    expect(jobMathSettingsFault(settings(patch))).toBe(fault);
  });

  it("allows buckets just under 100%", () => {
    expect(
      jobMathSettingsFault(
        settings({ profitPercent: 50, marketingPercent: 30, opsPercent: 19.99 }),
      ),
    ).toBeNull();
  });

  it("words every fault", () => {
    const faults: JobMathSettingsFault[] = [
      "profit_percent_invalid",
      "marketing_percent_invalid",
      "ops_percent_invalid",
      "buckets_too_high",
      "owner_tax_percent_invalid",
      "payroll_tax_percent_invalid",
      "workers_comp_invalid",
      "wage_invalid",
    ];
    for (const fault of faults) expect(jobMathSettingsFaultMessage(fault)).toMatch(/\.$/);
  });
});

describe("A Solution's job inputs", () => {
  it("counts only HR lines as hours, and everything else as other costs", () => {
    const inputs = solutionJobInputs({
      lineItems: [
        { name: "Labor", quantity: 8, unit: "HR", unitCostCents: 3_000 },
        { name: "Dump fee", quantity: 1, unit: "EA", unitCostCents: 2_500 },
        // A day of a rented lift is not a day of work.
        { name: "Lift rental", quantity: 1, unit: "DA", unitCostCents: 20_000 },
      ],
      materialAllowanceCents: 10_000,
    });
    // Cost 46,500 × 1.1 = 51,150, up to $512, plus the $100 allowance.
    expect(inputs).toEqual({ priceCents: 61_200, laborHours: 8, otherCostCents: 32_500 });
  });

  it("reads a line with no unit as one of a thing, not hours", () => {
    const inputs = solutionJobInputs({
      lineItems: [{ name: "Faucet", quantity: 2, unitCostCents: 5_000 }],
    });
    expect(inputs).toEqual({ priceCents: 11_000, laborHours: 0, otherCostCents: 10_000 });
  });

  it("prices at the Solution's own Markup", () => {
    const inputs = solutionJobInputs({
      lineItems: [{ name: "Labor", quantity: 2, unit: "HR", unitCostCents: 5_000 }],
      markupPercent: 50,
    });
    expect(inputs?.priceCents).toBe(15_000);
  });

  it("adds fractional hours without float dust", () => {
    const inputs = solutionJobInputs({
      lineItems: [
        { name: "Setup", quantity: 0.1, unit: "HR", unitCostCents: 0 },
        { name: "Cleanup", quantity: 0.2, unit: "HR", unitCostCents: 0 },
        { name: "Caulk", quantity: 1, unit: "EA", unitCostCents: 1_000 },
      ],
    });
    expect(inputs?.laborHours).toBe(0.3);
  });

  it("is nothing for a Solution with no price", () => {
    expect(solutionJobInputs({})).toBeNull();
    expect(solutionJobInputs({ lineItems: [] })).toBeNull();
  });
});

describe("The calculator's fields", () => {
  it("reads dollars typed any ordinary way", () => {
    expect(readDollarsField("$1,250.50")).toBe(125_050);
    expect(readDollarsField(" 350 ")).toBe(35_000);
    expect(readDollarsField("")).toBeNull();
    expect(readDollarsField("abc")).toBeNull();
  });

  it("reads hours", () => {
    expect(readHoursField("7.5")).toBe(7.5);
    expect(readHoursField("")).toBeNull();
  });

  it("shows cents only when there are some", () => {
    expect(dollarsField(35_000)).toBe("350");
    expect(dollarsField(12_345)).toBe("123.45");
  });

  it("links the calculator with a job's figures in dollars", () => {
    expect(jobMathHref({ priceCents: 35_000, laborHours: 8, otherCostCents: 1_250 })).toBe(
      "/job-math?price=350&hours=8&other=12.50",
    );
  });
});
