import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOwner } from "./auth";
import { dealStage, handSource } from "./schema";
import { customerViewedLink, signingLinksForProposal } from "./signingLinks";
import { parseDealCustomer } from "../lib/customer";
import {
  OPEN_STAGES,
  ballparkFault,
  isOpen,
  notesFault,
  stageOnProposalApproved,
  stageOnProposalSent,
  titleFault,
  type Stage,
} from "../lib/pipeline";
import { siteAddressLine } from "../lib/sites";
import { estimateLine, isUnread, leadAddressLine } from "../lib/thumbtack";

// The **Pipeline**: every **Deal**, the owner's moves on one, and the moves
// the app makes for them. Owner-only throughout.

// The **Pipeline** page: every deal, newest first, each with who it is for,
// where, the proposal out on it and, on a Thumbtack deal, its lead. The page
// splits open from Closed. Every open deal is read; closed ones only pile up,
// so only the latest closed of each are, as the Customers list is bounded.
export const board = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const byStage = (stage: Stage) =>
      ctx.db.query("deals").withIndex("by_stage", (q) => q.eq("stage", stage)).order("desc");
    const deals = (
      await Promise.all([
        ...OPEN_STAGES.map((stage) => byStage(stage).collect()),
        byStage("won").take(CLOSED_SHOWN),
        byStage("lost").take(CLOSED_SHOWN),
      ])
    ).flat();
    const rows = await Promise.all(deals.map((deal) => dealRow(ctx, deal)));
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

const CLOSED_SHOWN = 500;

async function dealRow(ctx: QueryCtx, deal: Doc<"deals">) {
  const customer = await ctx.db.get(deal.customerId);
  // A deleted site takes itself off the deal; a stale id reads as none.
  const site = deal.siteId ? await ctx.db.get(deal.siteId) : null;
  const lead = deal.leadId ? await ctx.db.get(deal.leadId) : null;
  return {
    ...deal,
    customerName: customer?.name ?? "",
    // The lead's raw number stands in when the customer holds none.
    phone: customer?.phone || lead?.phone || "",
    phoneFrom: customer?.phoneFrom,
    email: customer?.email ?? "",
    site: site ? { siteId: site._id, name: site.name, line: siteAddressLine(site) } : null,
    proposal: await proposalOf(ctx, deal),
    lead: lead
      ? {
          negotiationId: lead.negotiationId,
          unread: isUnread(lead),
          // Where Thumbtack said the job is, read until the deal has a site.
          addressLine: leadAddressLine(lead.location),
          // Thumbtack's own estimate and what the lead cost, in its words.
          estimateLine: estimateLine(lead.estimate),
          leadPrice: lead.leadPrice ?? null,
          description: lead.description,
          details: lead.details,
          attachments: lead.attachments,
        }
      : null,
  };
}

type SentProposal = Doc<"proposals"> & { state: "sent" | "approved" | "declined" };

// The proposal out on a deal: the one that last moved it (`proposalId`,
// written when a proposal is sent or approved, and by the migration for a
// lead the old board had moved). Nothing is guessed from the site: two jobs
// at one site, two offers out at once, a deal moved to another site or
// closed by hand each read exactly what moved them, or nothing. Null when
// none, or when what moved it has since gone back to a draft.
async function proposalOf(ctx: QueryCtx, deal: Doc<"deals">) {
  const held = deal.proposalId ? await ctx.db.get(deal.proposalId) : null;
  if (!held || held.state === "draft" || !held.frozen) return null;
  const latest: SentProposal = { ...held, state: held.state };
  // **Opened**: only a Sent one's current link can be, and only by the customer.
  const live =
    latest.state === "sent"
      ? (await signingLinksForProposal(ctx, latest._id)).find((l) => l.endedAt === undefined)
      : undefined;
  return {
    proposalId: latest._id,
    code: held.frozen.code,
    totalCents: held.frozen.totalCents,
    state: latest.state,
    // A Re-send keeps the offer's date and mints a new link, so the link's
    // send is when the customer last heard: "Sent N days ago" counts from it.
    sentAt: live?.sentAt ?? latest.sentAt ?? latest.updatedAt,
    opened: live ? await customerViewedLink(ctx, live.token) : false,
  };
}

// The New deal dialog: a deal in New for a customer already on file, or for
// one made here from a name and whatever else the owner has. The site, when
// picked, must be that customer's. Thumbtack is never a source typed by hand.
export const create = mutation({
  args: {
    customer: v.union(
      v.object({ customerId: v.id("customers") }),
      v.object({ name: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()) }),
    ),
    title: v.string(),
    source: handSource,
    siteId: v.optional(v.id("sites")),
    ballparkCents: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    refuse(titleFault(a.title));
    const notes = a.notes?.trim() ?? "";
    refuse(notesFault(notes));
    if (a.ballparkCents !== undefined) refuse(ballparkFault(a.ballparkCents));

    let customerId: Id<"customers">;
    if ("customerId" in a.customer) {
      if (!(await ctx.db.get(a.customer.customerId))) throw new Error("Customer not found.");
      customerId = a.customer.customerId;
    } else {
      // Refused before the customer is written, so a bad site leaves none.
      if (a.siteId) throw new Error("A new customer has no sites yet.");
      customerId = await ctx.db.insert(
        "customers",
        parseDealCustomer({
          name: a.customer.name,
          email: a.customer.email ?? "",
          phone: a.customer.phone ?? "",
        }),
      );
    }
    if (a.siteId) await siteOfCustomer(ctx, a.siteId, customerId);

    const now = Date.now();
    return ctx.db.insert("deals", {
      customerId,
      ...(a.siteId ? { siteId: a.siteId } : {}),
      title: a.title.trim(),
      source: a.source,
      stage: "new",
      stageChangedAt: now,
      notes,
      ...(a.ballparkCents !== undefined ? { ballparkCents: a.ballparkCents } : {}),
      createdAt: now,
      updatedAt: now,
    });
  },
});

// The owner moving a deal by hand, to any stage: only the app's own moves are
// forward-only.
export const setStage = mutation({
  args: { dealId: v.id("deals"), stage: dealStage },
  handler: async (ctx, { dealId, stage }) => {
    await requireOwner(ctx);
    await moveDeal(ctx, await dealOf(ctx, dealId), stage);
  },
});

// The Quick panel's **Notes**, saved as the owner leaves the box.
export const setNotes = mutation({
  args: { dealId: v.id("deals"), notes: v.string() },
  handler: async (ctx, { dealId, notes }) => {
    await requireOwner(ctx);
    const deal = await dealOf(ctx, dealId);
    const trimmed = notes.trim();
    refuse(notesFault(trimmed));
    if (trimmed !== deal.notes) await ctx.db.patch(deal._id, { notes: trimmed, updatedAt: Date.now() });
  },
});

// The site a deal is for, once one is known, or none again. Only one of the
// deal's own customer's sites.
export const setSite = mutation({
  args: { dealId: v.id("deals"), siteId: v.union(v.id("sites"), v.null()) },
  handler: async (ctx, { dealId, siteId }) => {
    await requireOwner(ctx);
    const deal = await dealOf(ctx, dealId);
    if (siteId) await siteOfCustomer(ctx, siteId, deal.customerId);
    // A proposal is for a site, so a deal moved to another site lets go of
    // the one it was reading; the next proposal sent from there is its own.
    const moved = (siteId ?? undefined) !== deal.siteId;
    await ctx.db.patch(deal._id, {
      siteId: siteId ?? undefined,
      ...(moved ? { proposalId: undefined } : {}),
      updatedAt: Date.now(),
    });
  },
});

// Opening a deal clears **Unread** on its lead; nothing on Thumbtack does. A
// deal with no lead has nothing to clear.
export const open = mutation({
  args: { dealId: v.id("deals") },
  handler: async (ctx, { dealId }) => {
    await requireOwner(ctx);
    const deal = await dealOf(ctx, dealId);
    if (deal.leadId && (await ctx.db.get(deal.leadId)))
      await ctx.db.patch(deal.leadId, { openedAt: Date.now() });
  },
});

async function dealOf(ctx: QueryCtx, dealId: Id<"deals">) {
  const deal = await ctx.db.get(dealId);
  if (!deal) throw new Error("Deal not found.");
  return deal;
}

async function siteOfCustomer(ctx: QueryCtx, siteId: Id<"sites">, customerId: Id<"customers">) {
  const site = await ctx.db.get(siteId);
  if (!site) throw new Error("Site not found.");
  if (site.customerId !== customerId) throw new Error("That site belongs to another customer.");
  return site;
}

function refuse(fault: string | null) {
  if (fault) throw new Error(fault);
}

/** A deal to `stage`, stamped with when, unless it is there already. */
export async function moveDeal(ctx: MutationCtx, deal: Doc<"deals">, stage: Stage) {
  if (deal.stage === stage) return;
  const now = Date.now();
  await ctx.db.patch(deal._id, { stage, stageChangedAt: now, updatedAt: now });
}

// A lead's **Deal**, made as the lead arrives (or, for a lead from before
// deals, the first time something needs it): source Thumbtack, the category as
// its job, in New, under the lead's customer. A lead the old board had moved
// to Sent out or Won was moved by a proposal to its customer, so the deal
// takes that proposal, and its site, as its own.
export async function dealForLead(ctx: MutationCtx, lead: Doc<"leads">) {
  const held = lead.dealId ? await ctx.db.get(lead.dealId) : null;
  if (held) return held;
  const now = Date.now();
  const moved =
    lead.stage === "quoted" || lead.stage === "won"
      ? await proposalThatMoved(ctx, lead.customerId, lead.arrivedAt, lead.stage === "won")
      : null;
  const dealId = await ctx.db.insert("deals", {
    customerId: lead.customerId,
    title: lead.category,
    source: "thumbtack",
    // A lead from before deals carries the stage it had reached.
    stage: lead.stage ?? "new",
    stageChangedAt: lead.stageChangedAt ?? now,
    notes: "",
    leadId: lead._id,
    ...(moved ? { siteId: moved.siteId, proposalId: moved._id } : {}),
    createdAt: lead.arrivedAt,
    updatedAt: now,
  });
  await ctx.db.patch(lead._id, { dealId });
  const deal = await ctx.db.get(dealId);
  if (!deal) throw new Error("The deal did not save.");
  return deal;
}

// Which of a customer's proposals the old board's move stood for: the
// latest sent from any of their sites since the lead arrived, or, for a lead
// at Won, the approved one. Null when none is found.
async function proposalThatMoved(
  ctx: QueryCtx,
  customerId: Id<"customers">,
  since: number,
  won: boolean,
) {
  const sites = await ctx.db
    .query("sites")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  let pick: SentProposal | null = null;
  for (const site of sites) {
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    for (const p of proposals) {
      if (p.state === "draft" || !p.frozen || (p.sentAt ?? 0) < since) continue;
      const better = !pick
        ? true
        : won && (p.state === "approved") !== (pick.state === "approved")
          ? p.state === "approved"
          : (p.sentAt ?? 0) > (pick.sentAt ?? 0);
      if (better) pick = { ...p, state: p.state };
    }
  }
  return pick;
}

// The app moving deals when a proposal from `site` is sent or approved
// (CONTEXT.md, **Stage**). A proposal is for a site, so only the customer's
// open deals at that site move, and those with no site yet, which take this
// one: a Thumbtack deal rarely has a site until the proposal goes out, and
// its card then reads the proposal. A deal at another site is another job,
// and so is one that began after the proposal went out (`sentAt`): the
// board reads a deal's proposal the same way, so a deal is never closed by
// an offer it does not show.
export async function advanceForSite(
  ctx: MutationCtx,
  site: Doc<"sites">,
  event: "sent" | "approved",
  proposal: Doc<"proposals">,
  sentAt: number,
) {
  const move = event === "sent" ? stageOnProposalSent : stageOnProposalApproved;
  // A lead from before deals that the migration has not reached gets its
  // deal now, carrying the stage it had, so the move is not lost on it.
  const leads = await ctx.db
    .query("leads")
    .withIndex("by_customer", (q) => q.eq("customerId", site.customerId))
    .collect();
  for (const lead of leads) if (!lead.dealId) await dealForLead(ctx, lead);
  const deals = await ctx.db
    .query("deals")
    .withIndex("by_customer", (q) => q.eq("customerId", site.customerId))
    .collect();
  for (const deal of deals) {
    if (!isOpen(deal.stage) || deal.createdAt > sentAt) continue;
    if (deal.siteId && deal.siteId !== site._id) continue;
    // The deal takes the site if it had none, and remembers this proposal as
    // its own, so the card reads this offer and no later one at the site.
    await ctx.db.patch(deal._id, {
      ...(deal.siteId ? {} : { siteId: site._id }),
      proposalId: proposal._id,
      updatedAt: Date.now(),
    });
    await moveDeal(ctx, deal, move(deal.stage));
  }
}
