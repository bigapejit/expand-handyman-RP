import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { isOwner } from "./auth";
import { invoiceLinkForToken } from "./invoiceLinks";
import { emailOutcome } from "./schema";
import { proposalDisplayName } from "../lib/proposal-pricing";
import { noticeToCustomerApplies } from "../lib/proposal-signing";
import type { PaperProposal } from "../lib/proposal-paper";
import { offeredLineItems } from "../lib/solution-pricing";

// A proposal's **Signing link** (CONTEXT.md), ported from FRSG's
// convex/signingLinks.ts for one recipient: minted by each Send and Re-send,
// ended when the proposal moves, and answering the public `/sign/<token>`
// page. Rows are ended rather than deleted, so they stay as the record of what
// went where and how it finished.
//
// Nothing public here is owner-gated: the token is the whole access model.
// The owner opening a link is told apart from the customer by their Clerk
// session, and logged as an owner preview (ADR 0001).

export function signingLinksForProposal(ctx: QueryCtx, proposalId: Id<"proposals">) {
  return ctx.db
    .query("signingLinks")
    .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
    .collect();
}

// A fresh token: 32 random bytes, URL-safe. Called from an action, where
// `crypto` is the real thing rather than a mutation's seeded generator.
export function mintLinkToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function mintSigningLink(
  ctx: MutationCtx,
  link: { proposalId: Id<"proposals">; token: string; sentTo: string; sentAt: number },
): Promise<Id<"signingLinks">> {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(link.token)) throw new Error("Invalid signing link.");
  // A token is minted fresh for every send and never reused, so an ended link
  // cannot be revived by sending again.
  if ((await linkForToken(ctx, link.token)) !== null)
    throw new Error("Please try sending again.");
  return ctx.db.insert("signingLinks", link);
}

// Ends the proposal's live link, if it has one, for the reason the proposal
// moved. A link already ended keeps the reason it ended for.
export async function endSigningLinks(
  ctx: MutationCtx,
  proposalId: Id<"proposals">,
  reason: NonNullable<Doc<"signingLinks">["endedReason"]>,
  now: number,
) {
  for (const link of await signingLinksForProposal(ctx, proposalId))
    if (link.endedAt === undefined)
      await ctx.db.patch(link._id, { endedAt: now, endedReason: reason });
}

async function linkForToken(ctx: QueryCtx, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return ctx.db
    .query("signingLinks")
    .withIndex("by_token", (q) => q.eq("token", trimmed))
    .unique();
}

// The proposal a token still opens onto, or nothing. A live link opens its
// Sent proposal. After the customer decides, the link that decided stays
// readable, so the tab they signed in and the email they kept still show the
// paper; it can no longer act, which Approve and Decline ask for themselves.
// A link ended any other way — withdrawn, replaced by a re-send, or declined
// by the owner after a phone call, which the customer never did through it —
// opens nothing, so an old link can never show the offer that took its place.
export async function paperStillOpenedBy(
  ctx: QueryCtx,
  token: string,
): Promise<{ link: Doc<"signingLinks">; proposal: Doc<"proposals"> } | null> {
  const link = await linkForToken(ctx, token);
  if (!link) return null;
  const proposal = await ctx.db.get(link.proposalId);
  if (!proposal?.frozen) return null;

  const decided =
    link.endedReason === "approved" ||
    (link.endedReason === "declined" && proposal.declinedBy === "customer");
  if (link.endedAt !== undefined && !decided) return null;
  if (!decided && proposal.state !== "sent") return null;
  return { link, proposal };
}

export type LiveSigningLink = {
  link: Doc<"signingLinks">;
  proposal: Doc<"proposals"> & { frozen: NonNullable<Doc<"proposals">["frozen"]> };
  site: Doc<"sites">;
};

// The link a customer may still act through: not ended, on a proposal still
// Sent. Approve and Decline ask this for themselves and never read it off
// what the page is showing, which stays readable after a decision.
export async function liveLinkForToken(
  ctx: QueryCtx,
  token: string,
): Promise<LiveSigningLink | null> {
  const link = await linkForToken(ctx, token);
  if (!link || link.endedAt !== undefined) return null;
  const proposal = await ctx.db.get(link.proposalId);
  if (!proposal || proposal.state !== "sent" || !proposal.frozen) return null;
  const site = await ctx.db.get(proposal.siteId);
  if (!site) return null;
  return { link, proposal: { ...proposal, frozen: proposal.frozen }, site };
}

// When the customer first looked at this link: the earliest customer view the
// log holds for it. Owner previews never count.
export async function firstCustomerView(ctx: QueryCtx, token: string): Promise<number | null> {
  const view = await ctx.db
    .query("proposalViews")
    .withIndex("by_token_viewer", (q) => q.eq("token", token).eq("viewer", "customer"))
    .first();
  return view?.openedAt ?? null;
}

// A proposal past Draft as its paper, read wholly from what Send froze.
export function sentPaper(proposal: Doc<"proposals">): PaperProposal | null {
  const frozen = proposal.frozen;
  if (proposal.state === "draft" || !frozen || proposal.sentAt === undefined) return null;
  return {
    proposalId: proposal._id,
    number: proposal.number,
    code: frozen.code,
    name: proposalDisplayName(
      proposal.name,
      frozen.solutions.map((solution) => solution.title),
    ),
    state: proposal.state,
    recommended: proposal.recommended,
    sentAt: proposal.sentAt,
    estimator: frozen.estimator,
    customerName: frozen.customerName,
    site: { street: frozen.site.street, city: frozen.site.city },
    solutions: frozen.solutions.map((solution) => ({
      solutionId: solution.solutionId,
      title: solution.title,
      scopeOfWork: solution.scopeOfWork,
      lineItems: offeredLineItems(solution.lineItems),
      materialAllowanceCents: solution.materialAllowanceCents,
    })),
    ...(frozen.notes === undefined ? {} : { notes: frozen.notes }),
    terms: frozen.terms,
    tax: frozen.tax,
    subtotalCents: frozen.subtotalCents,
    taxCents: frozen.taxCents,
    totalCents: frozen.totalCents,
    depositPercent: frozen.depositPercent,
    ...(frozen.depositCents === undefined ? {} : { depositCents: frozen.depositCents }),
    ...decision(proposal),
  };
}

// What the paper prints of the customer's answer: the signature and its
// certificate once approved, the day of a decline once declined.
function decision(proposal: Doc<"proposals">): Pick<PaperProposal, "signature" | "declinedAt"> {
  const signature = proposal.signature;
  if (proposal.state === "approved" && signature)
    return {
      signature: {
        signerName: signature.signerName,
        signedAt: signature.signedAt,
        ...(signature.firstOpenedAt === undefined ? {} : { firstOpenedAt: signature.firstOpenedAt }),
        ...(signature.userAgent === undefined ? {} : { userAgent: signature.userAgent }),
        consentWording: signature.consentWording,
        consentWordingVersion: signature.consentWordingVersion,
        noticeShown: signature.noticeShown,
        ...(signature.noticeTicked &&
        signature.noticeWording !== undefined &&
        signature.noticeWordingVersion !== undefined
          ? {
              notice: {
                wording: signature.noticeWording,
                version: signature.noticeWordingVersion,
              },
            }
          : {}),
        fingerprint: signature.sealed.fingerprint,
      },
    };
  if (proposal.state === "declined" && proposal.declinedAt !== undefined)
    return { declinedAt: proposal.declinedAt };
  return {};
}

// What the `/sign/<token>` page is looking at. Proposals and invoices share
// the address, so the page asks here first and draws whichever it is. A token
// naming nothing, like an ended proposal link, gets "This link is no longer
// live"; the invoice page says the same for an ended invoice link.
export const resolve = query({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<"proposal" | "invoice" | "ended" | "unknown"> => {
    const token = a.token.trim();
    if (!token) return "unknown";
    if (await paperStillOpenedBy(ctx, token)) return "proposal";
    // An invoice link's own page says when it no longer opens anything, in
    // words about an invoice rather than an answer the customer owes.
    if (await invoiceLinkForToken(ctx, token)) return "invoice";
    return (await linkForToken(ctx, token)) ? "ended" : "unknown";
  },
});

// What the customer's link shows: the paper, stamped with their answer once
// they have given one, and whether the sign bar must show Washington's Notice
// to Customer. A query, so reading it writes nothing; the page reports the
// open itself through `opened`.
export const page = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const opened = await paperStillOpenedBy(ctx, a.token);
    const paper = opened ? sentPaper(opened.proposal) : null;
    if (!opened || !paper) return null;
    const site = await ctx.db.get(opened.proposal.siteId);
    return {
      paper,
      noticeRequired:
        // The frozen total, read the way Approve reads it, so the notice the
        // page shows is the notice Approve asks to have been ticked.
        paper.state === "sent" &&
        site !== null &&
        noticeToCustomerApplies(
          opened.proposal.frozen?.site.region ?? site.region,
          paper.totalCents,
        ),
    };
  },
});

// Every open of a live or decided link, logged as a view or, when the caller
// is the owner, as an owner preview (ADR 0001). The open says nothing to the
// proposal itself: Opened is read from this log, not stored as a state.
export const opened = mutation({
  args: { token: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const opened = await paperStillOpenedBy(ctx, a.token);
    if (!opened) return null;
    const { link, proposal } = opened;
    if (proposal.state === "draft") return null;
    const now = Date.now();
    return ctx.db.insert("proposalViews", {
      proposalId: proposal._id,
      token: link.token,
      viewer: (await isOwner(ctx)) ? "owner" : "customer",
      proposalState: proposal.state,
      openedAt: now,
      lastSeenAt: now,
      viewedMs: 0,
      userAgent: a.userAgent?.slice(0, 500),
    });
  },
});

const seenArgs = { viewId: v.id("proposalViews"), token: v.string() };

// Heartbeats arrive every 20 seconds while the tab is visible. A longer gap
// since the last one means the tab was hidden, and that time is not counted
// as reading.
export const MAX_SEEN_STEP = 30_000;

// What one heartbeat or beacon changes on a view, or nothing when the clock
// has not moved forward.
export function seenUpdate(
  view: { lastSeenAt: number; viewedMs: number },
  now: number,
): { lastSeenAt: number; viewedMs: number } | null {
  const gap = now - view.lastSeenAt;
  if (gap <= 0) return null;
  return {
    lastSeenAt: now,
    viewedMs: view.viewedMs + (gap <= MAX_SEEN_STEP ? gap : 0),
  };
}

// The heartbeat and the close beacon.
async function touchView(ctx: MutationCtx, a: { viewId: Id<"proposalViews">; token: string }) {
  const view = await ctx.db.get(a.viewId);
  if (!view || view.token !== a.token) return;
  const update = seenUpdate(view, Date.now());
  if (update) await ctx.db.patch(view._id, update);
}

export const seen = mutation({
  args: seenArgs,
  handler: (ctx, a) => touchView(ctx, a),
});

export const recordSeen = internalMutation({
  args: seenArgs,
  handler: (ctx, a) => touchView(ctx, a),
});

// Whether the customer has viewed this link: the Opened chip. Owner previews
// never count, and neither do views of a link the proposal has moved on from.
export async function customerViewedLink(ctx: QueryCtx, token: string): Promise<boolean> {
  const view = await ctx.db
    .query("proposalViews")
    .withIndex("by_token_viewer", (q) => q.eq("token", token).eq("viewer", "customer"))
    .first();
  return view !== null;
}

// The customer's opens of one link, for the Dashboard's "Opened twice, last
// Tuesday": how many, and the latest. Owner previews never count.
export async function customerViewsOfLink(
  ctx: QueryCtx,
  token: string,
): Promise<{ customerViews: number; lastViewedAt: number | null }> {
  const views = await ctx.db
    .query("proposalViews")
    .withIndex("by_token_viewer", (q) => q.eq("token", token).eq("viewer", "customer"))
    .collect();
  return { customerViews: views.length, lastViewedAt: views.at(-1)?.openedAt ?? null };
}

// When a decided proposal was decided: the stamp Approve or Decline wrote.
// Not `updatedAt`, which a Recommended mark set later moves too. A decided
// proposal without its stamp falls back to the moment the link that carried
// the answer ended, then to its last change.
export async function decidedAt(ctx: QueryCtx, proposal: Doc<"proposals">): Promise<number> {
  const stamped =
    proposal.state === "approved"
      ? proposal.approvedAt
      : proposal.state === "declined"
        ? proposal.declinedAt
        : undefined;
  if (stamped !== undefined) return stamped;
  const answered = (await signingLinksForProposal(ctx, proposal._id)).find(
    (link) => link.endedReason === proposal.state && link.endedAt !== undefined,
  );
  return answered?.endedAt ?? proposal.updatedAt;
}

// What became of the email that carried the link, written back by the
// scheduled send. It never touches the proposal or the link's own life: the
// offer was made the moment Send committed.
export const recordEmail = internalMutation({
  args: { linkId: v.id("signingLinks"), email: emailOutcome },
  handler: async (ctx, a) => {
    if (await ctx.db.get(a.linkId)) await ctx.db.patch(a.linkId, { email: a.email });
  },
});
