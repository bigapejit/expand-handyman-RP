import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwner } from "./auth";
import { lookUpSiteTax } from "./salesTax";
import { Unknown } from "../lib/expand-business";
import type { PaperProposal } from "../lib/proposal-paper";
import { proposalCode } from "../lib/proposals";
import { siteCityLine, siteStreetLine } from "../lib/sites";
import {
  DefaultDepositPercent,
  depositPercentFault,
  proposalDisplayName,
  proposalFaultMessage,
  proposalMoney,
  splitPayment,
  taxRateFault,
  type ProposalFault,
} from "../lib/proposal-pricing";
import { offeredLineItems, priceStoredSolution } from "../lib/solution-pricing";
import { isWashingtonRegion } from "../lib/wa-sales-tax";

// Proposals, ported from FRSG's convex/proposals.ts: the offers the owner
// assembles from a site's solutions (CONTEXT.md, **Proposal**). This holds the
// drafting half — which solutions a draft offers and in what order, which of
// the site's proposals is Recommended, the deposit, the notes and the tax.
//
// A draft reads its solutions live: it stores their ids and nothing about
// them, so a solution repriced once is repriced in every draft holding it, and
// a solution deleted drops out of every draft holding it (solutions.remove).

// The customer page's Proposals tab, and everything the panel over it edits:
// every proposal across the customer's sites, and every solution there is to
// pick from, each tagged with its site.
export const forCustomer = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_customer", (q) => q.eq("customerId", a.customerId))
      .collect();
    sites.sort((x, y) => x.name.localeCompare(y.name));

    const perSite = await Promise.all(
      sites.map(async (site) => {
        const [solutions, proposals] = await Promise.all([
          ctx.db
            .query("solutions")
            .withIndex("by_site", (q) => q.eq("siteId", site._id))
            .collect(),
          proposalsAtSite(ctx, site._id),
        ]);
        const bySolutionId = new Map(solutions.map((s) => [s._id, s] as const));
        return {
          solutions: solutions.map((solution) => ({
            solutionId: solution._id,
            siteId: solution.siteId,
            title: solution.title,
            // Null rather than zero when nothing has been priced yet: the
            // "No price" a draft may hold but not send.
            price: priceStoredSolution(solution),
          })),
          // In number order, so an edit never reshuffles the list under the
          // cursor.
          proposals: proposals
            .sort((x, y) => x.number - y.number)
            .map((proposal) =>
              proposalForOwner(proposal, site, (id) => bySolutionId.get(id)),
            ),
        };
      }),
    );

    return {
      solutions: perSite.flatMap((site) => site.solutions),
      proposals: perSite.flatMap((site) => site.proposals),
    };
  },
});

// The global Proposals page: every proposal across every customer, newest
// first. Read-only; each row opens the proposal on its customer's page.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const proposals = await ctx.db.query("proposals").order("desc").take(1000);
    const sites = new Map<Id<"sites">, Doc<"sites"> | null>();
    const customers = new Map<Id<"customers">, Doc<"customers"> | null>();
    const rows = [];
    for (const proposal of proposals) {
      if (!sites.has(proposal.siteId))
        sites.set(proposal.siteId, await ctx.db.get(proposal.siteId));
      const site = sites.get(proposal.siteId);
      if (!site) continue;
      if (!customers.has(site.customerId))
        customers.set(site.customerId, await ctx.db.get(site.customerId));
      const customer = customers.get(site.customerId);
      if (!customer) continue;

      const solutions = new Map<Id<"solutions">, Doc<"solutions">>();
      for (const id of proposal.solutionIds) {
        const solution = await ctx.db.get(id);
        if (solution) solutions.set(id, solution);
      }
      const read = proposalForOwner(proposal, site, (id) => solutions.get(id));
      rows.push({
        proposalId: read.proposalId,
        customerId: customer._id,
        customerName: customer.name,
        code: read.code,
        title: read.title,
        state: read.state,
        totalCents: read.money.totalCents,
      });
    }
    return rows;
  },
});

// The staff paper: a proposal as its **Proposal paper**, for the owner to read
// before sending. A draft is laid out from its live solutions as if sent now,
// with the signed-in owner as the Estimator Send would name. A query, so
// reading the paper here never lands in a view log. Past Draft the paper is
// the offer Send froze, which this does not lay out yet, so it answers null.
export const paper = query({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a): Promise<PaperProposal | null> => {
    await requireOwner(ctx);
    const proposal = await ctx.db.get(a.proposalId);
    if (!proposal || proposal.state !== "draft") return null;
    const site = await ctx.db.get(proposal.siteId);
    if (!site) return null;
    const customer = await ctx.db.get(site.customerId);
    const identity = await ctx.auth.getUserIdentity();

    const solutions = (
      await Promise.all(proposal.solutionIds.map((id) => ctx.db.get(id)))
    ).flatMap((solution) => (solution ? [solution] : []));
    const money = proposalMoney(solutions.map(priceStoredSolution), proposal.tax);

    return {
      proposalId: proposal._id,
      number: proposal.number,
      code: proposalCode(site.name, proposal.number),
      name: proposalDisplayName(
        proposal.name,
        solutions.map((solution) => solution.title),
      ),
      state: proposal.state,
      recommended: proposal.recommended,
      sentAt: Date.now(),
      estimator: {
        name: identity?.name?.trim() || Unknown,
        email: identity?.email?.trim() || Unknown,
      },
      customerName: customer?.name ?? Unknown,
      site: { street: siteStreetLine(site), city: siteCityLine(site) },
      solutions: solutions.map((solution) => ({
        solutionId: solution._id,
        title: solution.title,
        scopeOfWork: solution.description,
        lineItems: offeredLineItems(solution.lineItems),
      })),
      ...(proposal.notes === undefined ? {} : { notes: proposal.notes }),
      tax: proposal.tax,
      ...money,
      depositPercent: proposal.depositPercent,
    };
  },
});

// An action rather than a mutation: a Washington site's tax rate comes from
// the Department of Revenue over the network, and the new draft carries it
// from the moment the panel opens.
export const create = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a): Promise<Id<"proposals">> => {
    await requireOwner(ctx);
    const { proposalId, taxed } = await ctx.runMutation(internal.proposals.insertDraft, a);
    await lookUpDraftTax(ctx, a.siteId, taxed ? [proposalId] : []);
    return proposalId;
  },
});

/**
 * Shared with moving a site. The site's address decides its drafts' tax, so a
 * draft at a site that has moved starts again from what a new draft there
 * would get, a rate typed by hand included: that rate was for the old
 * address. Proposals past Draft keep what they were offered. Returns the
 * drafts waiting on a lookup.
 */
export async function resetDraftTax(
  ctx: MutationCtx,
  site: Doc<"sites">,
): Promise<Id<"proposals">[]> {
  const taxed = isWashingtonRegion(site.region);
  const drafts = (await proposalsAtSite(ctx, site._id)).filter((p) => p.state === "draft");
  const now = Date.now();
  for (const draft of drafts)
    await ctx.db.patch(draft._id, {
      tax: { source: taxed ? "lookup" : "none" },
      updatedAt: now,
    });
  return taxed ? drafts.map((draft) => draft._id) : [];
}

/**
 * Asks DOR once for the site's rate and stores it on each draft still waiting
 * for one. Anything but a rate leaves them without one, for the owner to type.
 */
export async function lookUpDraftTax(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  proposalIds: Id<"proposals">[],
) {
  if (proposalIds.length === 0) return;
  const looked = await lookUpSiteTax(ctx, siteId);
  if (looked.outcome !== "rate") return;
  for (const proposalId of proposalIds)
    await ctx.runMutation(internal.proposals.storeLookedUpRate, {
      proposalId,
      rate: looked.rate,
      locationCode: looked.locationCode,
      ...(looked.period === null ? {} : { period: looked.period }),
    });
}

export const insertDraft = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const site = await ctx.db.get(a.siteId);
    if (!site) throw new Error("Site not found.");

    // Washington or nothing: `none` is the whole of "this site charges no
    // sales tax", and a Washington site starts with a rate nobody has yet.
    const taxed = isWashingtonRegion(site.region);
    const now = Date.now();
    const proposalId = await ctx.db.insert("proposals", {
      siteId: site._id,
      number: await issueProposalNumber(ctx, site),
      state: "draft",
      solutionIds: [],
      recommended: false,
      depositPercent: DefaultDepositPercent,
      tax: { source: taxed ? "lookup" : "none" },
      createdAt: now,
      updatedAt: now,
    });
    return { proposalId, taxed };
  },
});

// What DOR answered, stored as the draft's rate. Never overwrites a rate the
// owner typed: the lookup is slower than they are, and the figure they chose
// wins.
export const storeLookedUpRate = internalMutation({
  args: {
    proposalId: v.id("proposals"),
    rate: v.number(),
    locationCode: v.string(),
    period: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const proposal = await ctx.db.get(a.proposalId);
    if (!proposal || proposal.state !== "draft") return;
    if (proposal.tax.source !== "lookup" || proposal.tax.rate !== undefined) return;
    await ctx.db.patch(proposal._id, {
      tax: {
        source: "lookup",
        rate: a.rate,
        locationCode: a.locationCode,
        ...(a.period === undefined ? {} : { period: a.period }),
      },
    });
  },
});

// One edit of one draft: what it is called, which solutions it offers and in
// what order, its Notes and exclusions, the deposit, and a rate typed by hand.
// Only what is named changes.
export const update = mutation({
  args: {
    proposalId: v.id("proposals"),
    name: v.optional(v.string()),
    solutionIds: v.optional(v.array(v.id("solutions"))),
    notes: v.optional(v.string()),
    depositPercent: v.optional(v.number()),
    // A decimal of the whole, the way DOR states one. Typing a rate is what
    // makes it an override, so there is no separate source argument.
    taxRate: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await requireDraft(ctx, a.proposalId, "edited");
    const patch: Partial<Doc<"proposals">> = {};

    // An emptied field is not a blank name: it is the proposal going back to
    // being called after the solutions it offers.
    if (a.name !== undefined) patch.name = optionalText(a.name, NameMaxLength);
    if (a.solutionIds !== undefined)
      patch.solutionIds = await verifiedSolutions(ctx, proposal.siteId, a.solutionIds);
    // Whitespace is not a Notes and exclusions block: an emptied field puts
    // the proposal back to printing nothing there.
    if (a.notes !== undefined) patch.notes = optionalText(a.notes, NotesMaxLength);
    if (a.depositPercent !== undefined) {
      refuse(depositPercentFault(a.depositPercent));
      patch.depositPercent = a.depositPercent;
    }
    if (a.taxRate !== undefined) {
      if (proposal.tax.source === "none")
        throw new Error("This site is not in Washington, so it charges no sales tax.");
      refuse(taxRateFault(a.taxRate));
      // The location code survives an override because it is a fact about the
      // site's address, not about the rate. The quarter does not: it dates the
      // figure DOR gave, and this one never came from DOR.
      patch.tax = {
        source: "override",
        rate: a.taxRate,
        ...(proposal.tax.locationCode === undefined
          ? {}
          : { locationCode: proposal.tax.locationCode }),
      };
    }

    await ctx.db.patch(proposal._id, { ...patch, updatedAt: Date.now() });
  },
});

// The Recommended mark is a fact about the site rather than one proposal:
// turning it on here turns it off on whichever proposal held it, in the same
// transaction, so there is never a moment with two. Not draft-gated, because
// it is how the customer is told which option Expand would choose, and that
// can change after a proposal is sent.
export const setRecommended = mutation({
  args: { proposalId: v.id("proposals"), recommended: v.boolean() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await requireProposal(ctx, a.proposalId);
    const now = Date.now();
    if (a.recommended)
      for (const sibling of await proposalsAtSite(ctx, proposal.siteId))
        if (sibling._id !== proposal._id && sibling.recommended)
          await ctx.db.patch(sibling._id, { recommended: false, updatedAt: now });
    await ctx.db.patch(proposal._id, { recommended: a.recommended, updatedAt: now });
  },
});

// A new draft offering the same work on the same terms: the same solutions in
// the same order, deposit, tax and notes. It carries neither the name nor the
// Recommended mark, which are what tell two proposals apart. Unlike FRSG this
// works from any state, so trying again after a decline or repricing approved
// work starts from what was offered; the copy reads the solutions live like
// any draft.
export const duplicate = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await requireProposal(ctx, a.proposalId);
    const site = await ctx.db.get(proposal.siteId);
    if (!site) throw new Error("Site not found.");
    const solutions = await Promise.all(proposal.solutionIds.map((id) => ctx.db.get(id)));
    const now = Date.now();
    return ctx.db.insert("proposals", {
      siteId: site._id,
      // A copy is a new proposal to the customer, so it takes the next number.
      number: await issueProposalNumber(ctx, site),
      state: "draft",
      solutionIds: solutions.flatMap((solution) => (solution ? [solution._id] : [])),
      recommended: false,
      depositPercent: proposal.depositPercent,
      tax: proposal.tax,
      ...(proposal.notes === undefined ? {} : { notes: proposal.notes }),
      createdAt: now,
      updatedAt: now,
    });
  },
});

// A draft is disposable: nobody has seen it, and the solutions it offered are
// the site's, not its own. Its number is not given back.
export const remove = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await requireDraft(ctx, a.proposalId, "deleted");
    await ctx.db.delete(proposal._id);
  },
});

// A proposal as the tab lists it and the panel edits it: its solutions in the
// order it offers them, and every figure derived from them in one place, so no
// reader works out money of its own.
function proposalForOwner(
  proposal: Doc<"proposals">,
  site: Doc<"sites">,
  solutionById: (id: Id<"solutions">) => Doc<"solutions"> | undefined,
) {
  // An id naming a solution since deleted is simply not there.
  const priced = proposal.solutionIds.flatMap((id) => {
    const solution = solutionById(id);
    return solution ? [{ solution, price: priceStoredSolution(solution) }] : [];
  });
  const money = proposalMoney(
    priced.map(({ price }) => price),
    proposal.tax,
  );
  return {
    proposalId: proposal._id,
    siteId: site._id,
    siteName: site.name,
    code: proposalCode(site.name, proposal.number),
    // The name as stored, for the field to show, and the name as read, for
    // everything that has to call the proposal something.
    name: proposal.name ?? null,
    title: proposalDisplayName(
      proposal.name,
      priced.map(({ solution }) => solution.title),
    ),
    state: proposal.state,
    recommended: proposal.recommended,
    solutions: priced.map(({ solution, price }) => ({
      solutionId: solution._id,
      title: solution.title,
      priceCents: price?.priceCents ?? null,
    })),
    notes: proposal.notes ?? null,
    tax: proposal.tax,
    money,
    depositPercent: proposal.depositPercent,
    payment: splitPayment(money.totalCents, proposal.depositPercent),
  };
}

// The next Proposal number at a site. The site's `lastProposalNumber` only
// ever climbs, so a deleted draft leaves a gap and a number a customer has
// read never names a different proposal. Bumping it in the mutation that
// inserts the row is what gives two drafts started at once different numbers:
// Convex serializes the two writes to the site.
async function issueProposalNumber(ctx: MutationCtx, site: Doc<"sites">) {
  const number = site.lastProposalNumber + 1;
  await ctx.db.patch(site._id, { lastProposalNumber: number });
  return number;
}

async function verifiedSolutions(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  requested: Id<"solutions">[],
): Promise<Id<"solutions">[]> {
  const unique = [...new Set(requested)];
  for (const solutionId of unique) {
    const solution = await ctx.db.get(solutionId);
    if (!solution || solution.siteId !== siteId)
      throw new Error("A proposal can only offer solutions written for its own site.");
  }
  return unique;
}

function proposalsAtSite(ctx: QueryCtx, siteId: Id<"sites">) {
  return ctx.db
    .query("proposals")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
}

async function requireProposal(ctx: MutationCtx, proposalId: Id<"proposals">) {
  const proposal = await ctx.db.get(proposalId);
  if (!proposal) throw new Error("Proposal not found.");
  return proposal;
}

// Send freezes the offer, so once a proposal has left Draft nothing may still
// change what it says.
async function requireDraft(ctx: MutationCtx, proposalId: Id<"proposals">, act: string) {
  const proposal = await requireProposal(ctx, proposalId);
  if (proposal.state !== "draft") throw new Error(`Only a draft proposal can be ${act}.`);
  return proposal;
}

function refuse(fault: ProposalFault | null) {
  if (fault !== null) throw new Error(proposalFaultMessage(fault));
}

const NameMaxLength = 200;
const NotesMaxLength = 8000;

// Typed optional text as stored: trimmed, absent when blank, and cut at a
// length nothing legitimate exceeds.
function optionalText(value: string, maxLength: number): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}
