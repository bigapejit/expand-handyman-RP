// The **Pipeline** in the app's own words (CONTEXT.md, **Deal**, **Stage**,
// **Source**): the stages a deal moves through, the moves the app makes for
// the owner, and what a card or the Quick panel says about a deal. Pure, so
// the Convex functions and the page read the same rules.

import { formatCents } from "./money";

export type Stage = "new" | "talking" | "booked" | "estimating" | "quoted" | "won" | "lost";

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  talking: "Talking",
  booked: "Booked",
  estimating: "Estimating",
  // Stored as `quoted`; the owner reads it as "Sent out".
  quoted: "Sent out",
  won: "Won",
  lost: "Lost",
};

// Won and Lost close a deal, which moves from the open Pipeline to Closed;
// the owner can reopen one by hand.
export const OPEN_STAGES: readonly Stage[] = ["new", "talking", "booked", "estimating", "quoted"];

export const isOpen = (stage: Stage) => OPEN_STAGES.includes(stage);

// The moves the app makes for the owner (CONTEXT.md, **Stage**). Each only
// ever moves a deal forward, never out of a later stage or a closed one.

/** A customer's message moves New to Talking, once the owner has written too. */
export function stageOnCustomerReply(stage: Stage, hadBusinessMessage: boolean): Stage {
  return stage === "new" && hadBusinessMessage ? "talking" : stage;
}

export function stageOnProposalSent(stage: Stage): Stage {
  return isOpen(stage) && stage !== "quoted" ? "quoted" : stage;
}

export function stageOnProposalApproved(stage: Stage): Stage {
  return isOpen(stage) ? "won" : stage;
}

/** Where a deal came from. Only the webhook ever says Thumbtack. */
export type Source = "thumbtack" | "referral" | "repeat" | "website" | "phone";

export const SOURCE_LABELS: Record<Source, string> = {
  thumbtack: "Thumbtack",
  referral: "Referral",
  repeat: "Repeat customer",
  website: "Website",
  phone: "Phone / walk-up",
};

/** The same in a word, for a card's badge. */
export const SHORT_SOURCE_LABELS: Record<Source, string> = {
  thumbtack: "Thumbtack",
  referral: "Referral",
  repeat: "Repeat",
  website: "Website",
  phone: "Phone",
};

/** The sources the New deal dialog offers: every one but Thumbtack. */
export type HandSource = Exclude<Source, "thumbtack">;
export const HAND_SOURCES: readonly HandSource[] = ["referral", "repeat", "website", "phone"];

// What the owner types on a deal. Refused on the server in these words, and
// the dialog can say them first.
export const MAX_TITLE = 200;
export const MAX_NOTES = 5000;

export function titleFault(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return "Say what the job is.";
  if (trimmed.length > MAX_TITLE) return "Keep the job under 200 characters.";
  return null;
}

export function notesFault(notes: string): string | null {
  return notes.length > MAX_NOTES ? "Keep notes under 5,000 characters." : null;
}

// A ballpark is a guess in whole dollars, at least one of them; no ballpark
// is how a deal has none, so a stored zero would only say that twice.
export function ballparkFault(cents: number): string | null {
  return Number.isSafeInteger(cents) && cents >= 100 && cents % 100 === 0
    ? null
    : "Make the ballpark a whole number of dollars.";
}

/**
 * The Ballpark box read as whole cents: blank is no ballpark (`null`), and
 * `$1,200` or `1200` is 120000. Anything else is a fault in words.
 */
export function readBallpark(typed: string): { cents: number | null } | { fault: string } {
  const text = typed.replace(/[$,\s]/g, "");
  if (!text) return { cents: null };
  if (!/^\d+$/.test(text)) return { fault: "Make the ballpark a whole number of dollars." };
  const cents = Number(text) * 100;
  const fault = ballparkFault(cents);
  return fault ? { fault } : { cents };
}

/** `$1,850`: a deal's figure in whole dollars, as the board reads it. */
export function money(cents: number) {
  return formatCents(Math.round(cents / 100) * 100, "en-US");
}

/** The one figure a card shows: the proposal's total once one is out, else the ballpark. */
export function dealValueCents(deal: {
  ballparkCents?: number;
  proposal: { totalCents: number } | null;
}): number | null {
  return deal.proposal?.totalCents ?? deal.ballparkCents ?? null;
}

const DAY = 86_400_000;

/**
 * Why an open deal wants looking at, in one short phrase, or null when it can
 * wait. Read against how long the deal has sat in its stage, or, once out,
 * since its proposal was last sent; the unread dot says the rest.
 */
export function attention(
  deal: {
    stage: Stage;
    stageChangedAt: number;
    proposal: { state: "sent" | "approved" | "declined"; opened: boolean; sentAt: number } | null;
  },
  now: number,
): string | null {
  if (!isOpen(deal.stage)) return null;
  const days = (now - deal.stageChangedAt) / DAY;
  if (deal.stage === "new" && days >= 1) return "No reply yet";
  if (deal.stage === "talking" && days >= 4) return "Gone quiet";
  if (deal.stage === "estimating" && days >= 3) return "Estimate overdue";
  if (deal.stage === "quoted") {
    // Moved to Sent out by hand, with no proposal the app can read: counted
    // from the move.
    if (!deal.proposal) return days >= 7 ? `Sent ${Math.floor(days)} days ago` : null;
    if (deal.proposal.state !== "sent") return null;
    const out = (now - deal.proposal.sentAt) / DAY;
    if (out >= 7) return `Sent ${Math.floor(out)} days ago`;
    if (deal.proposal.opened) return "Opened, no answer";
  }
  return null;
}

/**
 * A Google Calendar event for the deal, filled in for the owner to move: the
 * next full hour after `now`, one hour long, in UTC so the calendar shows it
 * in the owner's own zone.
 */
export function calendarUrl(
  deal: { title: string; customerName: string; phone: string; notes: string; siteLine: string | null },
  now: number,
) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3_600_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${deal.title} · ${deal.customerName}`,
    dates: `${stamp(start)}/${stamp(end)}`,
    details: [deal.customerName, deal.phone, deal.notes.trim()].filter(Boolean).join("\n"),
    ...(deal.siteLine ? { location: deal.siteLine } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The first line of the owner's notes, for a card; empty when there are none. */
export function firstLine(text: string) {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}
