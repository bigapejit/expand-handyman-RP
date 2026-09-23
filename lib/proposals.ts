import { formatCents } from "./money";
import type { ProposalTax } from "./proposal-pricing";
import { panelHref } from "./side-panel";

// How a Proposal reads in the staff app: its state chip, its Proposal ID, where
// its tax rate came from, and the two kinds of typed figure the panel takes.
// Ported from FRSG's apps/web/lib/proposals.ts. Pure, so the totals the owner
// watches change while ticking and typing are arithmetically the same ones the
// server stores — lib/proposal-pricing.ts owns every figure, and nothing here
// recomputes one.

export type ProposalState = "draft" | "sent" | "approved" | "declined";

export function proposalStateLabel(state: ProposalState): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
  }
}

// The **Proposal ID** (CONTEXT.md): the Site name and the Proposal's number at
// that Site. Called a code in the code, because `proposalId` is already the
// row's Convex id.
export function proposalCode(siteName: string, number: number): string {
  return `${siteName}-P${number}`;
}

// The search parameter the open Proposal rides in on the customer's Proposals
// tab (side-panel.ts). Named here so the Proposals page and the Dashboard can
// point straight at a panel without knowing how the tab spells it.
export const ProposalPanelParam = "proposal";

export function proposalPanelHref(customerId: string, proposalId: string): string {
  return panelHref(`/customers/${customerId}/proposals`, "", ProposalPanelParam, proposalId);
}

// What a customer's row on the Customers list says about their proposals: the
// Sent ones waiting on them first, since those are the ones to chase; else how
// the last decided one went; else the drafts being written; else nothing yet.
export type ProposalActivity =
  | { kind: "awaiting"; label: string }
  | { kind: "decided"; state: "approved" | "declined" }
  | { kind: "quiet"; label: string };

export function proposalActivity(
  proposals: readonly { state: ProposalState; updatedAt: number }[],
): ProposalActivity {
  const sent = proposals.filter((proposal) => proposal.state === "sent").length;
  if (sent > 0) return { kind: "awaiting", label: `${sent} awaiting a signature` };

  const decided = proposals
    .filter((proposal) => proposal.state === "approved" || proposal.state === "declined")
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (decided?.state === "approved" || decided?.state === "declined")
    return { kind: "decided", state: decided.state };

  const drafts = proposals.length;
  if (drafts === 0) return { kind: "quiet", label: "No proposals" };
  return { kind: "quiet", label: drafts === 1 ? "1 draft" : `${drafts} drafts` };
}

// What a Solution costs, beside its tick box. A Solution nobody has costed is
// still pickable — a Draft may hold one — and says so rather than showing $0.
export function solutionPickLabel(priceCents: number | null, locale?: string): string {
  return priceCents === null ? "No price" : formatCents(priceCents, locale);
}

// Where the rate came from, under the tax row. DOR's location code and quarter
// are shown because they are what makes a rate checkable — and a Washington
// Site with no rate is asked for one outright, because nothing else will
// produce it.
export function taxSourceLine(tax: ProposalTax): string | null {
  if (tax.source === "none") return null;
  if (tax.rate === undefined) return "No rate found — enter the rate";

  return [
    tax.source === "override" ? "Entered by hand" : "Looked up",
    tax.locationCode && `location ${tax.locationCode}`,
    // Only a looked-up rate belongs to a quarter; a typed one is nobody's.
    tax.source === "lookup" && tax.period,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Rates are stored as decimals of the whole and typed as the percent people
// talk in, so the field converts in both directions and nothing else in the
// app has to know that 8.9 and 0.089 are the same rate.
export function taxRateField(rate: number | undefined): string {
  if (rate === undefined) return "";
  // Multiplied in a way that survives the binary: 0.089 * 100 is 8.900000…1.
  return String(Number((rate * 100).toFixed(4)));
}

// A rate as typed, or nothing yet. Anything half-written — blank, a stray
// percent sign, letters — is not a rate, and the panel simply waits.
export function readTaxRateField(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, "").trim();
  if (trimmed === "") return null;

  const percent = Number(trimmed);
  if (!Number.isFinite(percent)) return null;
  return Number((percent / 100).toFixed(6));
}

// The two linked percent fields: one figure, shown twice. The final payment is
// never typed independently — it is what is left.
export function splitFieldValue(depositPercent: number): {
  deposit: string;
  final: string;
} {
  return {
    deposit: String(depositPercent),
    final: String(100 - depositPercent),
  };
}

// A whole percent as typed, or nothing yet. A fraction of a percent is not a
// split Expand offers, so it is refused here rather than being rounded into
// one nobody chose.
export function readPercentField(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  return Number(trimmed);
}

// A row dropped somewhere else in the list. A drop naming no row, or naming
// where the row already is, is simply nothing happening — the same non-event
// that dragging past either end of the list is.
export function reorder<Item>(items: readonly Item[], from: number, to: number): Item[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  if (to < 0 || to >= next.length) return next;

  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// The keyboard's way to the same place: past either end is nothing happening,
// exactly as it is on the Line Item table.
export function moveInOrder<Item>(
  items: readonly Item[],
  index: number,
  direction: "up" | "down",
): Item[] {
  return reorder(items, index, index + (direction === "up" ? -1 : 1));
}

// The last change to a Proposal, on its row in the list. To the day, because
// a Proposal is assembled over days and an exact minute is precision nobody
// acts on. There is only ever the owner to name, so nobody is.
export function lastChangeLine(updatedAt: number, locale?: string): string {
  const day = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(updatedAt));

  return `Last edited ${day}`;
}
