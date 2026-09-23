import type { OfferedLineItem } from "./solution-pricing";
import type { ProposalTax } from "./proposal-pricing";
import type { ProposalState } from "./proposals";

// The **Proposal paper**'s own facts, dates and layout (CONTEXT.md), ported
// from FRSG's lib/proposal-paper.ts. Pure, so the sheets a test lays out are
// the sheets the page draws.
//
// Every date here is read in UTC, as the paper itself is
// (components/proposal-document.tsx): a record read years later cannot depend
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
  tax: ProposalTax;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositPercent: number;
};

export type PaperSolution = {
  solutionId: string;
  title: string;
  scopeOfWork: string;
  lineItems: OfferedLineItem[];
};

// How long the letter says the offer stands. Wording only: nothing expires by
// itself.
export const ValidityDays = 30;

export function validUntil(sentAt: number): number {
  return sentAt + ValidityDays * 24 * 60 * 60 * 1000;
}

// A calendar day on the paper, in the short numeric form a commercial estimate
// dates itself by.
export function paperDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

// The top bar's one line: which proposal this paper is.
export function paperTitle(number: number, name: string): string {
  return `Proposal ${number} · ${name}`;
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
// a line and a bit per line item, its wrapped scope, the SCOPE OF WORK label
// and the gap that follows the block.
export function solutionLines(solution: PaperSolution): number {
  const scope = scopeLines(solution.scopeOfWork).reduce(
    (total, line) => total + Math.ceil(line.length / 122),
    0,
  );
  return 3 + scope + 2 + Math.ceil(solution.lineItems.length * 1.3) + 7;
}

/**
 * The solutions grouped into sheets, so that every sheet starts a page and
 * carries a letterhead. The Grand Total closes the last sheet, so it is
 * counted there too: where it would not fit after the last solution, that
 * solution moves to a fresh sheet with it, and where the two together would
 * still overrun a sheet the Grand Total takes the next sheet alone, letterhead
 * and all.
 * Either way it never overflows alone onto a sheet with no letterhead.
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
