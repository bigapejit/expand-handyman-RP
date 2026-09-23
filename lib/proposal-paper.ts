import type { ProposalTerm } from "./expand-business";
import { formatCentsExact } from "./money";
import type { ProposalTax } from "./proposal-pricing";
import type { ProposalState } from "./proposals";
import type { OfferedLineItem } from "./solution-pricing";

// The **Proposal paper**'s own facts, dates and layout (CONTEXT.md), ported
// from FRSG's lib/proposal-paper.ts. Pure, so the sheets a test lays out are
// the sheets the page draws.
//
// Every date here is read in UTC, as the paper itself is
// (components/proposal-paper.tsx): a record read years later cannot depend
// on whichever timezone its reader's browser is in.

// One proposal as the paper prints it: everything already decided, so the
// paper does no money and looks nothing up. A draft is laid out this way from
// its live solutions, as if sent now; a sent proposal from what Send froze.
export type PaperProposal = {
  proposalId: string;
  number: number;
  // The Proposal ID.
  code: string;
  // The name as read: typed, or the solutions it offers.
  name: string;
  state: ProposalState;
  recommended: boolean;
  sentAt: number;
  // The sending owner, under their sign-in account's name and email.
  estimator: { name: string; email: string };
  customerName: string;
  site: { street: string; city: string };
  solutions: PaperSolution[];
  notes?: string;
  terms: ProposalTerm[];
  tax: ProposalTax;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositPercent: number;
  // A set Deposit, which overrides the percent (lib/proposal-pricing.ts,
  // `storedDeposit`).
  depositCents?: number;
  // The customer's answer, once given: an approved proposal carries its
  // signature, which the signed copy prints, and a declined one the day.
  signature?: PaperSignature;
  declinedAt?: number;
};

// A **Signature** as the signed copy prints it: on the customer's line, and in
// the certificate of completion with the notice they acknowledged.
export type PaperSignature = {
  signerName: string;
  signedAt: number;
  firstOpenedAt?: number;
  userAgent?: string;
  consentWording: string;
  consentWordingVersion: string;
  noticeShown: boolean;
  // The notice wording acknowledged, where it was.
  notice?: { wording: string; version: string };
  fingerprint: string;
};

export type PaperSolution = {
  solutionId: string;
  title: string;
  scopeOfWork: string;
  lineItems: OfferedLineItem[];
  // The **Material allowance**, whole-dollar cents: the one dollar figure the
  // paper prints inside a solution. Absent when the solution has none.
  materialAllowanceCents?: number;
};

// How long the letter says the offer stands. Wording only: nothing expires by
// itself.
export const ValidityDays = 30;

export function validUntil(sentAt: number): number {
  return sentAt + ValidityDays * 24 * 60 * 60 * 1000;
}

// The one clock the paper is read by, and the way the certificate of
// completion declares it: a timestamp whose zone is not written down is not
// evidence of anything.
const PaperTimeZone = "UTC";
export const PaperTimeZoneLabel = "(UTC+00:00) Coordinated Universal Time";

// A calendar day on the paper, in the short numeric form a commercial estimate
// dates itself by.
export function paperDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: PaperTimeZone,
  }).format(new Date(ms));
}

// A moment, to the second, in the same clock: what the certificate stamps its
// events in.
export function paperStamp(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: PaperTimeZone,
  }).format(new Date(ms));
}

// The top bar's one line: which proposal this paper is.
export function paperTitle(number: number, name: string): string {
  return `Proposal ${number} · ${name}`;
}

// The sign bar's left-hand line, closed and open alike: what the customer is
// being asked for, and how long the offer stands.
export function totalAndValidity(totalCents: number, sentAt: number): string {
  return `${formatCentsExact(totalCents)} · valid until ${paperDate(validUntil(sentAt))}`;
}

// The banner under the top bar once the customer has answered, in the words
// settled on "Decide the proposal lifecycle, signing link and email texts for
// one recipient" (#17). Dated as the paper is, so the banner and the date on
// the signature line are the same day.
export function approvedBanner(approvedAt: number): string {
  return `You approved this proposal on ${paperDate(approvedAt)}. A copy has been emailed to you.`;
}

export function declinedBanner(declinedAt: number): string {
  return `You declined this proposal on ${paperDate(declinedAt)}.`;
}

// What the bar offers instead of its buttons once the customer has declined:
// a sentence, and a number that rings.
export const HelpBeforeNumber = "Have any questions or need help? Call Expand Handyman at";

// A phone number as a phone dials it: the digits, and the leading `+` of an
// international number.
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

// The certificate's count of the sheets it certifies: the cover, every
// solution sheet and the Terms.
export function documentPages(solutions: readonly PaperSolution[]): number {
  return 1 + solutionSheets(solutions).length + 1;
}

// The certificate's own sheets: one, and a second carrying the Notice to
// Customer where it was acknowledged.
export function certificatePages(noticeAcknowledged: boolean): number {
  return noticeAcknowledged ? 2 : 1;
}

// The paper's width, in CSS inches at 96 per inch.
const PaperWidthPx = 8.5 * 96;

// How much of full size a letter page is drawn at, given the width of the box
// it is drawn in. Below full width the sheet is scaled down whole rather than
// reflowed, so what a customer reads on a phone is the page that will print.
// The 20 pixels are the backdrop's own margin either side of the sheet, and
// the floor of a tenth keeps a box narrower than that from scaling to nothing.
export function paperScale(availableWidth: number): number {
  return Math.min(1, Math.max(0.1, (availableWidth - 20) / PaperWidthPx));
}

// A sheet of body copy at 10.5pt over the page's own margins, in lines.
export const SolutionLinesPerSheet = 48;

// The Grand Total block: the payment rows, the tax rows, the double-ruled
// total and the Estimator's signature under it.
export const GrandTotalLines = 14;

// Roughly how many lines a solution's block takes: its title and table head,
// a line and a bit per table row (each line item, and the material allowance),
// its wrapped scope, the SCOPE OF WORK label and the gap that follows the
// block.
export function solutionLines(solution: PaperSolution): number {
  const scope = scopeLines(solution.scopeOfWork).reduce(
    (total, line) => total + Math.ceil(line.length / 122),
    0,
  );
  const rows =
    solution.lineItems.length + (solution.materialAllowanceCents === undefined ? 0 : 1);
  return 3 + scope + 2 + Math.ceil(rows * 1.3) + 7;
}

/**
 * The solutions grouped into sheets, so that every sheet starts a page and
 * carries a letterhead. The Grand Total closes the last sheet, so it is
 * counted there too: where it would not fit after the last solution, that
 * solution moves to a fresh sheet with it, and where the two together would
 * still overrun a sheet the Grand Total takes the next sheet alone, letterhead
 * and all. Either way it never overflows alone onto a sheet with no letterhead.
 *
 * It is an estimate, not a measurement: measuring means a fixed-height box,
 * and a box silently swallows whatever overruns it. A group the estimate got
 * wrong still flows onto the next sheet rather than losing anything.
 */
export function solutionSheets(solutions: readonly PaperSolution[]): PaperSolution[][] {
  const sheets: PaperSolution[][] = [];
  let current: PaperSolution[] = [];
  let used = 0;
  for (const solution of solutions) {
    const lines = solutionLines(solution);
    if (current.length > 0 && used + lines > SolutionLinesPerSheet) {
      sheets.push(current);
      current = [];
      used = 0;
    }
    current.push(solution);
    used += lines;
  }

  if (used + GrandTotalLines > SolutionLinesPerSheet) {
    const last = current.at(-1);
    const takeAlong =
      current.length > 1 &&
      last !== undefined &&
      solutionLines(last) + GrandTotalLines <= SolutionLinesPerSheet;
    if (takeAlong) current.pop();
    sheets.push(current);
    current = takeAlong ? [last] : [];
  }
  sheets.push(current);
  return sheets;
}

// A scope of work as written, one paragraph per line, in one weight: the
// paper has no bold inside a scope, so typed `**` markers are dropped.
export function scopeLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\*\*/g, ""))
    .filter((line) => line.trim() !== "");
}
