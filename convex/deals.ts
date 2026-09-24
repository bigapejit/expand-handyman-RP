import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
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

// Every lead's deal, for the leads from before deals. The sidebar asks for
// this as the owner's first page opens, so old leads are on the board and in
// the badge from the first visit after the deploy whether or not the CLI
// migration has run; each run after the first finds nothing to make. A page
// of leads at a time, the rest scheduled behind it, so however many leads
// there are every one is reached; there are dozens, so one page is the norm.
export async function dealsForOldLeads(ctx: MutationCtx, cursor: string | null = null) {
  const page = await ctx.db.query("leads").paginate({ cursor, numItems: 200 });
  let made = 0;
  for (const lead of page.page) {
    if (lead.dealId && (await ctx.db.get(lead.dealId))) continue;
    await dealForLead(ctx, lead);
    made++;
  }
  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.migrations.dealsFromLeads, {
      cursor: page.continueCursor,
    });
  return { made, ...(page.isDone ? {} : { more: true }) };
}

export const backfillLeads = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return dealsForOldLeads(ctx);
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

// Of a customer's deals, those an offer from `site` could be for, begun by
// `at`: open, at the site or at none yet.
export function couldBeFor(deals: Doc<"deals">[], site: Doc<"sites">, at: number) {
  return deals.filter(
    (deal) =>
      isOpen(deal.stage) && deal.createdAt <= at && (!deal.siteId || deal.siteId === site._id),
  );
}

// Of those, the ones with no live offer out. An offer still out (sent) is
// live; a withdrawn, declined or already signed one is not (an open deal
// holding a signed offer was reopened by hand), and the deal is free for
// another.
export async function withNoLiveOffer(ctx: QueryCtx, deals: Doc<"deals">[]) {
  const free: Doc<"deals">[] = [];
  for (const deal of deals) {
    const held = deal.proposalId ? await ctx.db.get(deal.proposalId) : null;
    if (held?.state !== "sent") free.push(deal);
  }
  return free;
}

// The open deals an offer from `site` made now could be for, with no live
// offer out: what Send asks before sending an offer made for no deal in
// particular (lib/proposal-pricing.ts, `ambiguityBlockers`).
export async function freeDealsForOffer(ctx: QueryCtx, site: Doc<"sites">) {
  const deals = await ctx.db
    .query("deals")
    .withIndex("by_customer", (q) => q.eq("customerId", site.customerId))
    .collect();
  return withNoLiveOffer(ctx, couldBeFor(deals, site, Date.now()));
}

// The open deals a proposal from this site could be for, newest first, for
// the Proposals tab's New proposal to ask which when there is more than one.
export const openAtSite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireOwner(ctx);
    const site = await ctx.db.get(siteId);
    if (!site) return [];
    const deals = await ctx.db
      .query("deals")
      .withIndex("by_customer", (q) => q.eq("customerId", site.customerId))
      .collect();
    return couldBeFor(deals, site, Date.now())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((deal) => ({
        dealId: deal._id,
        title: deal.title,
        stage: deal.stage,
        hasSite: deal.siteId !== undefined,
      }));
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

/**
 * A deal to `stage`, stamped with when and by what, unless it is there
 * already. Only a proposal's move is worth remembering: see `stageBy`.
 */
export async function moveDeal(
  ctx: MutationCtx,
  deal: Doc<"deals">,
  stage: Stage,
  by?: "proposal",
) {
  if (deal.stage === stage) return;
  const now = Date.now();
  await ctx.db.patch(deal._id, { stage, stageChangedAt: now, stageBy: by, updatedAt: now });
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
  // The old board moved every lead of the customer on one send, so several
  // leads can match the same proposal. It was for one job: the first deal
  // made claims it, the rest keep their stage and no offer.
  const matched =
    (lead.stage === "quoted" || lead.stage === "won") && lead.stageChangedAt !== undefined
      ? await proposalThatMoved(ctx, lead.customerId, lead.stageChangedAt, lead.stage === "won")
      : null;
  const moved = matched && !(await someDealHolds(ctx, lead.customerId, matched._id)) ? matched : null;
  const dealId = await ctx.db.insert("deals", {
    customerId: lead.customerId,
    title: lead.category,
    source: "thumbtack",
    // A lead from before deals carries the stage it had reached.
    stage: lead.stage ?? "new",
    stageChangedAt: lead.stageChangedAt ?? now,
    notes: "",
    leadId: lead._id,
    ...(moved ? { siteId: moved.siteId, proposalId: moved._id, stageBy: "proposal" as const } : {}),
    createdAt: lead.arrivedAt,
    updatedAt: now,
  });
  await ctx.db.patch(lead._id, { dealId });
  if (moved) await ctx.db.patch(moved._id, { dealId });
  const deal = await ctx.db.get(dealId);
  if (!deal) throw new Error("The deal did not save.");
  return deal;
}

// Whether one of the customer's deals already reads this proposal as its own.
async function someDealHolds(
  ctx: QueryCtx,
  customerId: Id<"customers">,
  proposalId: Id<"proposals">,
) {
  const deals = await ctx.db
    .query("deals")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  return deals.some((deal) => deal.proposalId === proposalId);
}

// Which of a customer's proposals the old board's move stood for. That move
// stamped the lead's `stageChangedAt` in the same transaction as the
// proposal's own send (`sentAt`) or approval (`approvedAt`), so the proposal
// whose stamp matches is the one; a lead the owner moved by hand since
// matches nothing and takes none. A minute's slack covers clocks read twice.
async function proposalThatMoved(
  ctx: QueryCtx,
  customerId: Id<"customers">,
  stageChangedAt: number,
  won: boolean,
) {
  const sites = await ctx.db
    .query("sites")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  let pick: SentProposal | null = null;
  let gap = 60_000;
  for (const site of sites) {
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    for (const p of proposals) {
      if (p.state === "draft" || !p.frozen) continue;
      const stamp = won ? p.approvedAt : p.sentAt;
      if (stamp === undefined) continue;
      const off = Math.abs(stamp - stageChangedAt);
      if (off <= gap) {
        gap = off;
        pick = { ...p, state: p.state };
      }
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
  // The deals this proposal could be for, and those of them free to take it.
  const candidates = couldBeFor(deals, site, sentAt);
  const free = await withNoLiveOffer(ctx, candidates);
  const holding = (deal: Doc<"deals">) => deal.proposalId === proposal._id;
  // The deal the offer is for: the one it was drafted for or Send gave it
  // to, wherever that deal is now, plus any still reading it (an offer from
  // before this was recorded). Its send and its approval are that deal's
  // alone. If the deal is still this customer's at this site, open or not,
  // it takes the offer: a deal closed by hand keeps its stage but reads the
  // offer, and one reading a newer offer since reads the signed one. If the
  // deal has left, to another site, to no site, or to another customer, the
  // offer was for a job that is no longer here, and nothing moves.
  const its = proposal.dealId ? await ctx.db.get(proposal.dealId) : null;
  const own = [...(its ? [its] : []), ...deals.filter((d) => holding(d) && d._id !== its?._id)];
  const here = own.filter((d) => d.customerId === site.customerId && d.siteId === site._id);
  let targets: Doc<"deals">[];
  if (own.length > 0) {
    targets = here;
  } else {
    // An offer made for no deal in particular is for the deal with no live
    // offer of its own; Send refuses it while more than one could take it,
    // so this finds one. With none free, it is a fresh offer on the deal
    // whose earlier one is still out, and replaces it. An approval of an
    // offer no deal is known to own is one from before this was recorded,
    // and finds its deal the same way.
    targets = free;
    if (targets.length === 0) targets = candidates;
    // One offer is for one job. With more than one deal it could still be
    // for, the one the owner touched last is the one being quoted; the
    // others wait for their own.
    if (targets.length > 1) {
      targets = [
        targets.reduce((best, deal) =>
          deal.updatedAt > best.updatedAt ||
          (deal.updatedAt === best.updatedAt && deal.createdAt > best.createdAt)
            ? deal
            : best,
        ),
      ];
    }
  }
  for (const deal of targets) {
    // The deal takes the site if it had none, and reads this proposal as
    // its own, so the card shows this offer and no later one at the site;
    // the offer remembers the deal for good.
    await ctx.db.patch(deal._id, {
      ...(deal.siteId ? {} : { siteId: site._id }),
      proposalId: proposal._id,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(proposal._id, { dealId: deal._id });
    await moveDeal(ctx, deal, move(deal.stage), "proposal");
  }
}
