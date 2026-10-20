// **Job math** (CONTEXT.md): for one job, what it leaves the owner if he does
// the work himself, the most he could pay a W-2 worker an hour, and what to
// charge to pay a chosen wage. It never changes a Solution's price; it only
// reads one (`solutionJobInputs`), or takes figures typed into the calculator.
//
// The model is the owner's own: fixed percentages of every job's price — the
// **Buckets** — come off the top first (profit, marketing, operations), then
// whatever the job pays out that isn't labor (materials, dump fees), and what
// is left pays for the hands that do the work. Sales tax is not a bucket: the
// customer pays it on top of the price, so it never enters this arithmetic.
//
// Kept free of Convex imports for the same reason lib/solution-pricing.ts is:
// the calculator, the Solution panel's one-line readout and the mutation that
// stores the percentages must agree to the cent, and every rounding edge is
// tested here as plain arithmetic. All money is whole cents.

import { priceStoredSolution, type PriceableSolution } from "./solution-pricing";
import { readLineItemUnit } from "./line-item-units";

// The owner's percentages and rates. Percents are of the price before sales
// tax and may carry up to two decimals ("9.5", "1.25"); money is whole cents.
export type JobMathSettings = {
  // The Buckets.
  profitPercent: number;
  marketingPercent: number;
  // Gas, gear, insurance, B&O tax: running the business, not doing the job.
  opsPercent: number;
  // Set aside from the owner's own pay for self-employment and federal income
  // tax. Washington has no state income tax, so there is nothing else.
  ownerTaxPercent: number;
  // What an employer pays on top of a W-2 wage.
  payrollTaxPercent: number;
  // Washington L&I workers' comp is billed per hour worked, not as a percent
  // of wages, so it is a rate in cents and not a fifth percentage.
  workersCompCentsPerHour: number;
  // The hourly wage the W-2 column starts at until another is typed.
  wageCents: number;
};

// The owner's own buckets and set-aside, and Washington's 2026 employer costs.
export const DefaultJobMathSettings: JobMathSettings = {
  profitPercent: 10,
  marketingPercent: 10,
  opsPercent: 10,
  ownerTaxPercent: 25,
  // Social Security and Medicare (7.65), federal unemployment after the state
  // credit (0.6), and Washington unemployment at about 2.75 for a new
  // employer. Paid Family and Medical Leave has no employer share under 50
  // employees (https://paidleave.wa.gov/small-businesses/), and WA Cares is
  // paid by the employee, so neither is here.
  payrollTaxPercent: 11,
  // L&I's 2026 employer share per hour for class 0516, handyman work
  // (https://lni.wa.gov/insurance/_docs/2026RatesBusTypeClassCode.pdf). A job
  // that is all one-story gutter cleaning is class 6602, $1.31 an hour; the
  // handyman class is the safer default because it covers most jobs.
  workersCompCentsPerHour: 246,
  wageCents: 3000,
};

// The settings as stored, every one optional, with the defaults filled in. A
// settings row nobody has touched holds none of them, and one written before
// some were added holds some.
export function readJobMathSettings(
  stored: Partial<JobMathSettings> | null | undefined,
): JobMathSettings {
  return {
    profitPercent: stored?.profitPercent ?? DefaultJobMathSettings.profitPercent,
    marketingPercent: stored?.marketingPercent ?? DefaultJobMathSettings.marketingPercent,
    opsPercent: stored?.opsPercent ?? DefaultJobMathSettings.opsPercent,
    ownerTaxPercent: stored?.ownerTaxPercent ?? DefaultJobMathSettings.ownerTaxPercent,
    payrollTaxPercent:
      stored?.payrollTaxPercent ?? DefaultJobMathSettings.payrollTaxPercent,
    workersCompCentsPerHour:
      stored?.workersCompCentsPerHour ?? DefaultJobMathSettings.workersCompCentsPerHour,
    wageCents: stored?.wageCents ?? DefaultJobMathSettings.wageCents,
  };
}

// ---------------------------------------------------------------------------
// Percents as whole hundredths of a percent.
//
// A percent with up to two decimals is a whole number of hundredths of a
// percent (9.5% is 950), and cents × hundredths is an exact integer, so every
// percentage below is taken as one integer product divided once by 10,000 —
// the same trick lib/solution-pricing.ts plays with its whole-percent Markup.
// `cents * 0.095` would carry float drift into the rounding.
const Hundredths = 10_000;

function hundredths(percent: number): number {
  return Math.round(percent * 100);
}

// A share of an amount, rounded to the cent, half up. `cents * h` is exact,
// and an exact half-cent (`n / 10,000` ending in 5,000) is exactly
// representable, so `Math.round` sees the true value.
function percentOf(cents: number, percentHundredths: number): number {
  return Math.round((cents * percentHundredths) / Hundredths);
}

// ---------------------------------------------------------------------------
// Faults, shared by the mutation that refuses settings and the form that
// words the refusal.

export type JobMathSettingsFault =
  | "profit_percent_invalid"
  | "marketing_percent_invalid"
  | "ops_percent_invalid"
  | "buckets_too_high"
  | "owner_tax_percent_invalid"
  | "payroll_tax_percent_invalid"
  | "workers_comp_invalid"
  | "wage_invalid";

// Finite, not negative, and no finer than two decimals, which is what keeps
// the arithmetic above exact. A third decimal is refused rather than rounded,
// so what is stored is what was typed.
function percentOk(percent: number): boolean {
  return (
    Number.isFinite(percent) &&
    percent >= 0 &&
    Math.abs(percent * 100 - Math.round(percent * 100)) < 1e-6
  );
}

function wholeCentsOk(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents >= 0;
}

// The first thing wrong with a set of settings, or null. Buckets adding up to
// 100% or more would leave nothing of any price for the work, and make "what
// to charge" a division by zero or less; an owner tax of 100% would leave him
// nothing to take home.
export function jobMathSettingsFault(
  settings: JobMathSettings,
): JobMathSettingsFault | null {
  if (!percentOk(settings.profitPercent)) return "profit_percent_invalid";
  if (!percentOk(settings.marketingPercent)) return "marketing_percent_invalid";
  if (!percentOk(settings.opsPercent)) return "ops_percent_invalid";
  if (bucketHundredths(settings) >= Hundredths) return "buckets_too_high";
  if (!percentOk(settings.ownerTaxPercent) || settings.ownerTaxPercent >= 100) {
    return "owner_tax_percent_invalid";
  }
  if (!percentOk(settings.payrollTaxPercent)) return "payroll_tax_percent_invalid";
  if (!wholeCentsOk(settings.workersCompCentsPerHour)) return "workers_comp_invalid";
  if (!wholeCentsOk(settings.wageCents)) return "wage_invalid";
  return null;
}

const PercentRule = "a percent of 0 or more, with at most two decimals";

export function jobMathSettingsFaultMessage(fault: JobMathSettingsFault): string {
  switch (fault) {
    case "profit_percent_invalid":
      return `Profit must be ${PercentRule}.`;
    case "marketing_percent_invalid":
      return `Marketing must be ${PercentRule}.`;
    case "ops_percent_invalid":
      return `Operations must be ${PercentRule}.`;
    case "buckets_too_high":
      return "Profit, marketing and operations together must be under 100%, or nothing is left for the work.";
    case "owner_tax_percent_invalid":
      return "Your tax set-aside must be a percent from 0 up to, but not including, 100, with at most two decimals.";
    case "payroll_tax_percent_invalid":
      return `Payroll taxes must be ${PercentRule}.`;
    case "workers_comp_invalid":
      return "L&I must be a dollar amount per hour, 0 or more.";
    case "wage_invalid":
      return "The wage must be a dollar amount per hour, 0 or more.";
  }
}

function bucketHundredths(settings: JobMathSettings): number {
  return (
    hundredths(settings.profitPercent) +
    hundredths(settings.marketingPercent) +
    hundredths(settings.opsPercent)
  );
}

// ---------------------------------------------------------------------------
// The arithmetic.

export type JobInputs = {
  // What the customer pays, before sales tax.
  priceCents: number;
  // Hours of work, by whoever does it. May be fractional.
  laborHours: number;
  // Everything paid out of the price that isn't labor: materials, dump fees,
  // a rental.
  otherCostCents: number;
  // The hourly wage to cost the W-2 column at; the settings' when absent.
  wageCents?: number;
};

export type BucketKey = "profit" | "marketing" | "ops";

export type Bucket = { key: BucketKey; label: string; percent: number; cents: number };

export type W2Cost = {
  wageCents: number;
  // hours × wage, rounded to the cent.
  wagesCents: number;
  // The employer's share on top of those wages, rounded to the cent.
  payrollTaxCents: number;
  // L&I: hours × the hourly rate, rounded to the cent.
  workersCompCents: number;
  totalCostCents: number;
  // What the job has left for labor, less that total. Negative means the job
  // loses money at this wage.
  leftOverCents: number;
};

export type JobMath = {
  buckets: Bucket[];
  otherCostCents: number;
  // Price less the buckets and the other costs: what pays for the work. Can
  // be negative — a job priced under its materials and buckets — and is left
  // negative rather than clamped, because that is the answer.
  laborPoolCents: number;
  owner: {
    // Everything left for labor is the owner's pay when he does the work.
    payCents: number;
    // His tax set-aside on that pay. Nothing on a loss: there is no income to
    // set tax aside from.
    taxSetAsideCents: number;
    takeHomeCents: number;
    // Take-home ÷ hours, to the nearest cent (half up). Null with no hours.
    takeHomePerHourCents: number | null;
  };
  w2: {
    // The highest whole-cent hourly wage the job can pay with every bucket
    // intact, payroll taxes and L&I included. Null with no hours; zero or less
    // when the job can't pay anyone at all.
    maxWageCents: number | null;
    atWage: W2Cost;
  };
  // What to charge to pay the chosen wage with every bucket intact, rounded up
  // to a whole dollar. Null only for settings whose buckets reach 100%.
  priceForWageCents: number | null;
};

// What a W-2 worker costs for the job at one hourly wage. Each figure is
// rounded to the cent as a payroll run would, so they add up on screen.
function w2Cost(
  laborHours: number,
  wageCents: number,
  laborPoolCents: number,
  settings: JobMathSettings,
): W2Cost {
  const hours = Math.max(0, laborHours);
  const wagesCents = Math.round(hours * wageCents);
  const payrollTaxCents = percentOf(wagesCents, hundredths(settings.payrollTaxPercent));
  const workersCompCents = Math.round(hours * settings.workersCompCentsPerHour);
  const totalCostCents = wagesCents + payrollTaxCents + workersCompCents;
  return {
    wageCents,
    wagesCents,
    payrollTaxCents,
    workersCompCents,
    totalCostCents,
    leftOverCents: laborPoolCents - totalCostCents,
  };
}

export function jobMath(inputs: JobInputs, settings: JobMathSettings): JobMath {
  const { priceCents, laborHours, otherCostCents } = inputs;
  const wageCents = inputs.wageCents ?? settings.wageCents;

  const shares: Omit<Bucket, "cents">[] = [
    { key: "profit", label: "Profit", percent: settings.profitPercent },
    { key: "marketing", label: "Marketing", percent: settings.marketingPercent },
    { key: "ops", label: "Ops", percent: settings.opsPercent },
  ];
  const buckets: Bucket[] = shares.map((bucket) => ({
    ...bucket,
    cents: percentOf(priceCents, hundredths(bucket.percent)),
  }));
  const bucketsCents = buckets.reduce((sum, bucket) => sum + bucket.cents, 0);
  const laborPoolCents = priceCents - bucketsCents - otherCostCents;

  const taxSetAsideCents =
    laborPoolCents > 0
      ? percentOf(laborPoolCents, hundredths(settings.ownerTaxPercent))
      : 0;
  const takeHomeCents = laborPoolCents - taxSetAsideCents;

  return {
    buckets,
    otherCostCents,
    laborPoolCents,
    owner: {
      payCents: laborPoolCents,
      taxSetAsideCents,
      takeHomeCents,
      takeHomePerHourCents: laborHours > 0 ? Math.round(takeHomeCents / laborHours) : null,
    },
    w2: {
      maxWageCents:
        laborHours > 0 ? maxWageCents(laborHours, laborPoolCents, settings) : null,
      atWage: w2Cost(laborHours, wageCents, laborPoolCents, settings),
    },
    priceForWageCents: priceForWageCents(
      otherCostCents + w2Cost(laborHours, wageCents, 0, settings).totalCostCents,
      settings,
    ),
  };
}

// The most an hour the pool covers: the wage w where
// hours × (w × (1 + payroll%) + L&I) = pool, floored to the cent. In
// hundredths of a percent that is
// (pool − hours × L&I) × 10,000 ÷ (hours × (10,000 + payroll)),
// one division so the floor sees as exact a quotient as floats allow.
//
// Rounding each of `w2Cost`'s figures to the cent can put its total above
// that exact one by at most half a cent per figure: half a cent of wages,
// carried through payroll tax, plus half a cent each on payroll tax and L&I.
// So the floor is taken against the pool less that much, which the rounded
// total can never overrun at any number of hours. That start can sit a cent
// or so under the true answer, and on a very short job (a fraction of an
// hour) many dollars under, since a cent of wage there moves the cost by far
// less than a cent. So the wage then climbs to the highest cent that still
// fits: in doubling strides until one overshoots, then halving back. That is
// right because the rounded cost never falls as the wage rises, so every wage
// below one that fits also fits, and it takes a few dozen checks at most.
function maxWageCents(
  laborHours: number,
  laborPoolCents: number,
  settings: JobMathSettings,
): number | null {
  const payroll = hundredths(settings.payrollTaxPercent);
  const fits = (wage: number) =>
    w2Cost(laborHours, wage, laborPoolCents, settings).leftOverCents >= 0;
  const roundingCents = (Hundredths + payroll) / (2 * Hundredths) + 1;
  let wage = Math.floor(
    ((laborPoolCents - roundingCents - laborHours * settings.workersCompCentsPerHour) *
      Hundredths) /
      (laborHours * (Hundredths + payroll)),
  );
  // Hours so small, or a pool so large, that the division leaves no whole
  // cent to search from: there is no wage to name, and stepping from
  // Infinity or NaN would never end.
  if (!Number.isSafeInteger(wage)) return null;
  // Float error in the division above is the only way the start can miss, and
  // it misses by a cent at most; this cannot run on.
  while (!fits(wage)) wage -= 1;
  let stride = 1;
  while (fits(wage + stride)) {
    wage += stride;
    stride *= 2;
  }
  for (; stride >= 1; stride = Math.floor(stride / 2))
    if (fits(wage + stride)) wage += stride;
  return wage;
}

// What to charge so that `costCents` (other costs plus the W-2 cost of the
// work) is covered after every bucket comes off the top:
// cost ÷ (1 − buckets%), rounded up to a whole dollar.
//
// The markup trap: with 30% in buckets it is tempting to multiply cost by
// 1.3. But the buckets are a share of the *price*, not of the cost — $1,000
// of cost × 1.3 is a $1,300 price whose buckets take $390, leaving $910 for a
// $1,000 job. Dividing by 0.7 gives $1,429, whose buckets take $429 and leave
// the $1,000 whole.
//
// In integers: cost × 10,000 ÷ ((10,000 − bucket hundredths) × 100) asks
// "how many whole dollars" directly. Each bucket is then rounded half up on
// its own, which at an exact half-cent could take a cent more than the
// division allowed for, so the price is checked against the buckets as
// `jobMath` actually takes them and raised a dollar at a time until the work
// is covered. That always ends, and soon: the three roundings cost at most a
// cent and a half together, while each dollar adds at least a hundredth of a
// cent to what is kept (settings are whole hundredths of a percent below
// 100%), so it takes at most 150 dollars even at the most extreme settings.
function priceForWageCents(costCents: number, settings: JobMathSettings): number | null {
  const keep = Hundredths - bucketHundredths(settings);
  if (keep <= 0) return null;
  if (costCents <= 0) return 0;
  let dollars = Math.ceil((costCents * Hundredths) / (keep * 100));
  const kept = (priceCents: number) =>
    priceCents -
    percentOf(priceCents, hundredths(settings.profitPercent)) -
    percentOf(priceCents, hundredths(settings.marketingPercent)) -
    percentOf(priceCents, hundredths(settings.opsPercent));
  while (kept(dollars * 100) < costCents) dollars += 1;
  return dollars * 100;
}

// ---------------------------------------------------------------------------
// Reading a Solution.

// What Job math needs from a stored Solution, or null when it has no price.
//
// Hours are the quantities of its HR lines and nothing else. A DA or WK line
// is not counted as labor because a day or a week is as often equipment — a
// lift rented for a day, a dumpster for a week — as it is work, and counting
// a rental as hours would make every hour look cheaper than it is. An HR line
// is always somebody working.
//
// Everything that isn't an HR line is money the price pays out before labor:
// the cost of every other line, plus the Material Allowance, which the
// customer pays for materials and so is spent on them, not kept.
export function solutionJobInputs(
  solution: PriceableSolution,
): Omit<JobInputs, "wageCents"> | null {
  const price = priceStoredSolution(solution);
  if (price === null) return null;

  let laborHours = 0;
  let otherExact = 0;
  for (const line of solution.lineItems ?? []) {
    if (readLineItemUnit(line.unit) === "HR") laborHours += line.quantity;
    else otherExact += line.quantity * line.unitCostCents;
  }
  // Summed exactly and rounded once, as the Solution's own cost is.
  const otherCostCents = Math.round(otherExact) + (price.materialAllowanceCents ?? 0);
  // Hours are typed with a decimal or two; summing them as floats can leave
  // 0.1 + 0.2 = 0.30000000000000004, which nobody typed and a link would show.
  return {
    priceCents: price.priceCents,
    laborHours: Math.round(laborHours * 1_000_000) / 1_000_000,
    otherCostCents,
  };
}

// ---------------------------------------------------------------------------
// The calculator's fields and its link.

// A dollar figure typed by hand, as whole cents, or null when it is not a
// figure yet. "$1,250.50", "1250.5" and " 1250.50 " are the same money. A
// figure too big to be money (1e308 is finite, but not in cents) is not one
// either: every sum after it would be Infinity or NaN.
export function readDollarsField(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

// Hours typed by hand, or null when it is not a figure yet.
export function readHoursField(raw: string): number | null {
  const cleaned = raw.trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Cents as the calculator's fields show them: plain dollars with no sign or
// grouping, and cents only when there are some.
export function dollarsField(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

// The calculator, opened with a job's figures typed in: what the Solution
// panel links to. Dollars in the query, not cents, so the link reads as the
// fields will.
export function jobMathHref(inputs: Omit<JobInputs, "wageCents">): string {
  const params = new URLSearchParams({
    price: dollarsField(inputs.priceCents),
    hours: String(inputs.laborHours),
    other: dollarsField(inputs.otherCostCents),
  });
  return `/job-math?${params.toString()}`;
}
