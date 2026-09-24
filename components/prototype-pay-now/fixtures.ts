// PROTOTYPE (#112): throwaway. Dummy invoices for the invoice link and the
// panel, and the signed proposal the deposit invoice came from. Nothing here
// is read from Convex. The deposit invoice comes to $2,854.37, over the
// $1,000 line above which card is not offered; the gutter invoice sits under
// it, so both ways show.

import { proposalTerms, WashingtonNoticeToCustomer } from "@/lib/expand-business";
import { invoiceMoney, type InvoiceLine, type InvoiceMoney } from "@/lib/invoice-money";
import type { PaperInvoice } from "@/lib/invoice-paper";
import type { PaperProposal, PaperSolution } from "@/lib/proposal-paper";
import { fingerprintOf, SigningConsent } from "@/lib/proposal-signing";

export const TaxRate = 0.089;
// The business is enrolled with Zelle under a tag, not an email (#116). The
// paper's line reads "Zelle: send to <this>. The payment shows as Expand
// Handyman LLC.", so the setting carries the words that complete it.
export const ZelleTag = "expandhandyman";
export const ZelleEmail = `the Zelle® tag ${ZelleTag} from your banking app`;

// ── The ways to pay online, as the map settled them on 2026-09-23 ────────
// Bank is always offered; card only when Amount Due is $1,000 or less. No
// fee on either: the card fee was dropped after the research (#111).
export const CardUpToCents = 100_000;

export type PayChoice = { method: "bank" | "card"; chargeCents: number };

export function payChoices(amountDueCents: number): PayChoice[] {
  const bank: PayChoice = { method: "bank", chargeCents: amountDueCents };
  return amountDueCents <= CardUpToCents
    ? [bank, { method: "card", chargeCents: amountDueCents }]
    : [bank];
}

// ── The day on the panel ─────────────────────────────────────────────────
// "Sept 23", the way the ticket writes it, from a Pacific day `YYYY-MM-DD`.
const Months = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
export function shortDay(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${Months[month - 1]} ${date}`;
}

// ── Readings of the invoice link ─────────────────────────────────────────
export type Reading = "unpaid" | "small" | "onway" | "paid";
export const Readings = [
  { key: "unpaid", name: "Unpaid, over $1,000: bank only" },
  { key: "small", name: "Unpaid, up to $1,000: bank or card" },
  { key: "onway", name: "Payment on its way" },
  { key: "paid", name: "Paid" },
] as const satisfies readonly { key: Reading; name: string }[];

export const PaidOn = "2026-09-23";
export const AcceptedOn = "2026-09-23";

const site = { street: "3107 Kauffman Ave", city: "Vancouver, WA 98660" };
const sentAt = Date.UTC(2026, 8, 23, 2, 15, 3);

const depositLines: InvoiceLine[] = [
  { description: "Deposit (50%) for Kitchen faucet and hallway repair", cents: 262_109 },
];
const gutterLines: InvoiceLine[] = [
  { description: "Clean gutters and downspouts, front and back", cents: 32_500 },
  { description: "Replace two downspout elbows and re-seat the brackets", cents: 41_000 },
];

export function linkInvoice(reading: Reading): PaperInvoice {
  const deposit: PaperInvoice = {
    number: "INV-1001",
    sentAt,
    customerName: "Dana Whitfield",
    site,
    proposalCode: "3107KAUFFMAN-P1",
    proposalName: "Kitchen faucet and hallway repair",
    lines: depositLines,
    taxRate: TaxRate,
    zelleEmail: ZelleEmail,
    stamp: null,
  };
  switch (reading) {
    case "small":
      return {
        ...deposit,
        number: "INV-1003",
        sentAt: Date.UTC(2026, 8, 19, 22, 40, 0),
        proposalCode: "3107KAUFFMAN-P2",
        proposalName: "Gutter cleaning",
        lines: gutterLines,
      };
    case "paid":
      return { ...deposit, stamp: { kind: "paid", day: PaidOn } };
    default:
      return deposit;
  }
}

// ── The panel ────────────────────────────────────────────────────────────
export type PanelPayment =
  | { source: "owner"; receivedOn: string }
  | { source: "stripe"; receivedOn: string; method: "card" | "bank"; stripeUrl: string };

export type PanelStanding = "unpaid" | "overdue" | "paid" | "onway";

export type PanelFixture = {
  invoiceId: string;
  title: string;
  kind: "deposit" | "final" | "typed";
  customerName: string;
  proposalCode: string;
  lines: InvoiceLine[];
  taxRate: number;
  money: InvoiceMoney;
  standing: PanelStanding;
  payment: PanelPayment | null;
  // A bank payment accepted but not confirmed, when the standing is onway.
  pending: { acceptedOn: string; stripeUrl: string } | null;
  sentTo: string;
  sentAt: number;
};

const StripePayment = "https://dashboard.stripe.com/payments/pi_3Q2prototype";

function fixture(
  fields: Omit<PanelFixture, "money" | "taxRate" | "customerName" | "sentTo">,
): PanelFixture {
  return {
    ...fields,
    taxRate: TaxRate,
    money: invoiceMoney(fields.lines, TaxRate),
    customerName: "Dana Whitfield",
    sentTo: "dana.whitfield@example.com",
  };
}

export const PanelInvoices: PanelFixture[] = [
  fixture({
    invoiceId: "inv-1001",
    title: "INV-1001 · Deposit",
    kind: "deposit",
    proposalCode: "3107KAUFFMAN-P1",
    lines: depositLines,
    standing: "paid",
    payment: { source: "stripe", receivedOn: PaidOn, method: "bank", stripeUrl: StripePayment },
    pending: null,
    sentAt,
  }),
  fixture({
    invoiceId: "inv-1002",
    title: "INV-1002 · Final",
    kind: "final",
    proposalCode: "3107KAUFFMAN-P1",
    lines: [
      { description: "Kitchen faucet and hallway repair", cents: 524_218 },
      { description: "Less deposit invoiced (INV-1001)", cents: -262_109 },
    ],
    standing: "paid",
    payment: { source: "stripe", receivedOn: "2026-09-25", method: "card", stripeUrl: StripePayment },
    pending: null,
    sentAt: Date.UTC(2026, 8, 25, 21, 5, 0),
  }),
  fixture({
    invoiceId: "inv-1003",
    title: "INV-1003 · Gutter cleaning",
    kind: "typed",
    proposalCode: "3107KAUFFMAN-P2",
    lines: gutterLines,
    standing: "paid",
    payment: { source: "owner", receivedOn: "2026-09-21" },
    pending: null,
    sentAt: Date.UTC(2026, 8, 19, 22, 40, 0),
  }),
  fixture({
    invoiceId: "inv-1004",
    title: "INV-1004 · Deposit",
    kind: "deposit",
    proposalCode: "1420BROADWAY-P1",
    lines: [{ description: "Deposit (50%) for Deck board replacement", cents: 141_500 }],
    standing: "onway",
    payment: null,
    pending: { acceptedOn: AcceptedOn, stripeUrl: StripePayment },
    sentAt: Date.UTC(2026, 8, 23, 1, 12, 0),
  }),
  fixture({
    invoiceId: "inv-1005",
    title: "INV-1005 · Final",
    kind: "final",
    proposalCode: "1420BROADWAY-P1",
    lines: [
      { description: "Deck board replacement", cents: 283_000 },
      { description: "Less deposit invoiced (INV-1004)", cents: -141_500 },
    ],
    standing: "unpaid",
    payment: null,
    pending: null,
    sentAt: Date.UTC(2026, 8, 23, 18, 30, 0),
  }),
];

// ── The signed proposal, for the page right after signing ────────────────
const faucet: PaperSolution = {
  solutionId: "s1",
  title: "Replace kitchen faucet and shut-off valves",
  lineItems: [
    { name: "Pull-down kitchen faucet, single handle, stainless", quantity: 1, unit: "EA" },
    { name: "Quarter-turn angle stop valve, 1/2 in x 3/8 in", quantity: 2, unit: "EA" },
    { name: "Braided stainless supply line, 20 in", quantity: 2, unit: "EA" },
    { name: "Plumbing labor", quantity: 3, unit: "HR" },
  ],
  scopeOfWork: [
    "Shut off water at the main, remove the existing faucet and both under-sink shut-off valves, and haul them away.",
    "Install two new quarter-turn angle stops and braided supply lines, then mount and connect the new pull-down faucet supplied by Expand Handyman.",
    "Restore water, test for leaks at every joint under pressure, flush the aerator and confirm hot and cold are on the correct sides.",
  ].join("\n"),
};

const drywall: PaperSolution = {
  solutionId: "s2",
  title: "Repair and repaint hallway drywall",
  lineItems: [
    { name: "Drywall repair, patches up to 12 in", quantity: 48, unit: "SF" },
    { name: "Joint compound, tape and primer", quantity: 1, unit: "EA" },
    { name: "Interior paint, eggshell, color matched (gallon)", quantity: 2, unit: "EA" },
    { name: "Carpentry and finishing labor", quantity: 7, unit: "HR" },
  ],
  scopeOfWork: [
    "Protect the floor and nearby furniture with drop cloths and plastic sheeting.",
    "Cut out and patch the damaged drywall along the hallway (about 48 square feet), tape, apply three coats of compound and sand smooth.",
    "Prime the repaired areas and apply two coats of color-matched eggshell paint to the full hallway walls, corner to corner, so no patch shows.",
    "Clean up daily and remove all debris at completion.",
  ].join("\n"),
};

export const SignedAt = Date.UTC(2026, 8, 23, 2, 14, 51);

const subtotalCents = 524_218;
const taxCents = Math.round(subtotalCents * TaxRate);

export const ApprovedProposal: PaperProposal = {
  proposalId: "prototype",
  number: 1,
  code: "3107KAUFFMAN-P1",
  name: "Kitchen faucet and hallway repair",
  state: "approved",
  recommended: true,
  sentAt: Date.UTC(2026, 8, 22, 17, 42, 10),
  estimator: { name: "Andrew Putilin", email: "andrew.putilin@example.com" },
  customerName: "Dana Whitfield",
  site,
  solutions: [faucet, drywall],
  notes:
    "Excludes moving large furniture, any plumbing beyond the under-sink shut-off valves, and repainting ceilings or trim. If rot is found behind the hallway drywall we will stop and price the repair with you before continuing.",
  terms: proposalTerms(),
  tax: { source: "lookup", rate: TaxRate, locationCode: "0605" },
  subtotalCents,
  taxCents,
  totalCents: subtotalCents + taxCents,
  depositPercent: 50,
  signature: {
    signerName: "Dana Whitfield",
    signedAt: SignedAt,
    firstOpenedAt: Date.UTC(2026, 8, 22, 19, 3, 27),
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
    consentWording: SigningConsent.wording(1),
    consentWordingVersion: SigningConsent.version,
    noticeShown: true,
    notice: { wording: WashingtonNoticeToCustomer.text, version: WashingtonNoticeToCustomer.version },
    fingerprint: fingerprintOf("prototype-pay-now"),
  },
};

// What the deposit invoice off that proposal asks for.
export const DepositDueCents = invoiceMoney(depositLines, TaxRate).amountDueCents;
