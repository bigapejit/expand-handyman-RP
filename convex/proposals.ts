import { ConvexError, v } from "convex/values";

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
import { appOrigin } from "./email";
import { makeDepositInvoice } from "./invoices";
import { discardPdfCopy } from "./pdfCopyFiles";
import { lookUpSiteTax } from "./salesTax";
import { advanceForCustomer } from "./leads";
import { emailOutcome } from "./schema";
import {
  customerViewedLink,
  customerViewsOfLink,
  decidedAt,
  endSigningLinks,
  firstCustomerView,
  liveLinkForToken,
  mintLinkToken,
  mintSigningLink,
  sentPaper,
  signingLinksForProposal,
  type LiveSigningLink,
} from "./signingLinks";
import { sendableEmail } from "../lib/customer";
import {
  ExpandBusiness,
  proposalTerms,
  Unknown,
  WashingtonNoticeToCustomer,
} from "../lib/expand-business";
import type { PaperProposal } from "../lib/proposal-paper";
import { proposalCode } from "../lib/proposals";
import { signingUrl } from "../lib/signing-link";
import { siteCityLine, siteStreetLine } from "../lib/sites";
import {
  DefaultDepositPercent,
  depositBlockers,
  depositCentsFault,
  depositPercentFault,
  proposalDisplayName,
  proposalFaultMessage,
  proposalMoney,
  recipientBlockers,
  sendBlockerMessage,
  sendBlockers,
  splitPayment,
  storedDeposit,
  taxRateFault,
  type ProposalFault,
  type SendBlocker,
} from "../lib/proposal-pricing";
import {
  noticeToCustomerApplies,
  sealProposal,
  SigningConsent,
  signingFaultMessage,
  signingFaults,
  type SigningFault,
} from "../lib/proposal-signing";
import { offeredLineItems, priceStoredSolution } from "../lib/solution-pricing";
import { isWashingtonRegion } from "../lib/wa-sales-tax";

// Proposals, ported from FRSG's convex/proposals.ts: the offers the owner
// assembles from a site's solutions (CONTEXT.md, **Proposal**). This holds the
// drafting half — which solutions a draft offers and in what order, which of
// the site's proposals is Recommended, the deposit, the notes and the tax —
// and Send, Withdraw and Re-send.
//
// A draft reads its solutions live: it stores their ids and nothing about
// them, so a solution repriced once is repriced in every draft holding it, and
// a solution deleted drops out of every draft holding it (solutions.remove).
// Send freezes the offer, and from then on every reader uses the frozen copy
// and never the live solutions, customer or site.

// The site page's Proposals tab, and everything the panel over it edits: the
// site's proposals, each as the panel reads it, and its solutions to pick
// from, read by the site's index. A site that is gone has nothing on it.
export const forSite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const site = await ctx.db.get(a.siteId);
    if (!site) return { customerEmail: null, solutions: [], proposals: [] };
    const customer = await ctx.db.get(site.customerId);
    // Where Send would go, or null when the customer has no address to send to.
    const customerEmail = customer ? sendableEmail(customer.email) : null;
    const [solutions, proposals] = await Promise.all([
      ctx.db
        .query("solutions")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect(),
      proposalsAtSite(ctx, site._id),
    ]);
    const bySolutionId = new Map(solutions.map((s) => [s._id, s] as const));
    return {
      customerEmail,
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
      proposals: await Promise.all(
        proposals
          .sort((x, y) => x.number - y.number)
          .map(async (proposal) => {
            const read = proposalForOwner(proposal, site, (id) => bySolutionId.get(id));
            return {
              ...read,
              // What Send would refuse, asked the way `sendWithLink` asks
              // it, so the button names the same reasons.
              sendBlockers:
                proposal.state === "draft"
                  ? [
                      ...sendBlockers(
                        read.solutions.map((solution) => solution.priceCents),
                        proposal.tax,
                      ),
                      ...depositBlockers(read.payment),
                      ...recipientBlockers(customerEmail),
                    ]
                  : [],
              sentAt: proposal.sentAt ?? null,
              sentTo: proposal.frozen?.sentTo ?? null,
              ...(await linkHistory(ctx, proposal._id)),
              ...decisionForOwner(proposal),
              // Approving one proposal leaves the site's others alone, so
              // the panel says how many are still out for the owner to
              // retire by hand.
              otherSentAtSite: proposals.filter(
                (other) => other._id !== proposal._id && other.state === "sent",
              ).length,
            };
          }),
      ),
    };
  },
});

// The global Proposals page: every proposal across every customer, newest
// first. Read-only; each row carries its site, where it opens.
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
        siteId: site._id,
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

// How many decided proposals the Dashboard shows, FRSG's figure.
const DashboardDecidedLimit = 8;

// The Dashboard's Proposals card, ported from FRSG's `dashboardForStaff`: what
// is out with a customer across every site, the one waiting longest first and
// each saying whether the customer has opened its current link, then the few
// most recently decided, latest decision first. Every row is past Send, so it
// reads the frozen offer and the customer's name as sent.
//
// The Sent list is unbounded on purpose: every one is a customer being waited
// on. The decided ones are read whole and cut in memory, because the index
// orders them by when they were sent and the card wants when they were
// decided; that costs the offers made, never the drafts.
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const inState = (state: Doc<"proposals">["state"]) =>
      ctx.db.query("proposals").withIndex("by_state_sent", (q) => q.eq("state", state));
    const [sent, approved, declined] = await Promise.all([
      inState("sent").order("asc").collect(),
      inState("approved").collect(),
      inState("declined").collect(),
    ]);
    const decided = (
      await Promise.all(
        [...approved, ...declined].map(async (proposal) => ({
          proposal,
          decidedAt: await decidedAt(ctx, proposal),
        })),
      )
    )
      .sort((x, y) => y.decidedAt - x.decidedAt)
      .slice(0, DashboardDecidedLimit);

    const awaitingRows = await Promise.all(
      sent.map(async (proposal) => {
        const row = await dashboardRow(ctx, proposal);
        if (!row) return null;
        const live = (await signingLinksForProposal(ctx, proposal._id)).find(
          (link) => link.endedAt === undefined,
        );
        return {
          ...row,
          sentAt: proposal.sentAt ?? proposal.updatedAt,
          ...(live
            ? await customerViewsOfLink(ctx, live.token)
            : { customerViews: 0, lastViewedAt: null }),
        };
      }),
    );
    const decidedRows = await Promise.all(
      decided.map(async ({ proposal, decidedAt: at }) => {
        const row = await dashboardRow(ctx, proposal);
        if (!row) return null;
        return { ...row, state: proposal.state as "approved" | "declined", decidedAt: at };
      }),
    );
    return {
      awaiting: awaitingRows.filter((row) => row !== null),
      decided: decidedRows.filter((row) => row !== null),
    };
  },
});

// A Dashboard row's name for a proposal past Send, and the site it opens on.
// A site with a proposal cannot be deleted, so a missing one is data gone
// wrong, and the row is left out rather than pointing nowhere.
async function dashboardRow(ctx: QueryCtx, proposal: Doc<"proposals">) {
  const site = await ctx.db.get(proposal.siteId);
  if (!site || !proposal.frozen) return null;
  const offer = frozenOffer(proposal.frozen);
  return {
    proposalId: proposal._id,
    siteId: site._id,
    customerId: site.customerId,
    customerName: proposal.frozen.customerName,
    code: offer.code,
    title: proposalDisplayName(
      proposal.name,
      offer.solutions.map((solution) => solution.title),
    ),
    totalCents: offer.money.totalCents,
  };
}

// The staff paper: a proposal as its **Proposal paper**, for the owner to read
// before sending or after. A draft is laid out from its live solutions as if
// sent now, with the signed-in owner as the Estimator Send would name; past
// Draft the paper is the offer Send froze, exactly as the customer's link
// shows it. A query, so reading the paper here never lands in a view log.
//
// A draft has no sent date, and "now" is the page's to say: a query's result
// is cached until what it read changes, so a date taken here would go stale.
// It may also hold solutions nobody has priced, which its total leaves out;
// the count is for the page to say so, never for the paper.
export const paper = query({
  args: { proposalId: v.id("proposals") },
  handler: async (
    ctx,
    a,
  ): Promise<
    | (Omit<PaperProposal, "sentAt"> & { sentAt: number | null; unpricedSolutions: number })
    | null
  > => {
    await requireOwner(ctx);
    const proposal = await ctx.db.get(a.proposalId);
    if (!proposal) return null;
    if (proposal.state !== "draft") {
      const sent = sentPaper(proposal);
      return sent ? { ...sent, unpricedSolutions: 0 } : null;
    }
    const site = await ctx.db.get(proposal.siteId);
    if (!site) return null;
    const customer = await ctx.db.get(site.customerId);
    const identity = await ctx.auth.getUserIdentity();

    const solutions = await liveSolutions(ctx, proposal);
    const prices = solutions.map(priceStoredSolution);
    const money = proposalMoney(prices, proposal.tax);

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
      sentAt: null,
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
        materialAllowanceCents: solution.materialAllowanceCents,
      })),
      ...(proposal.notes === undefined ? {} : { notes: proposal.notes }),
      terms: proposalTerms(),
      tax: proposal.tax,
      ...money,
      depositPercent: proposal.depositPercent,
      ...(proposal.depositCents === undefined ? {} : { depositCents: proposal.depositCents }),
      unpricedSolutions: prices.filter((price) => price === null).length,
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
// what order, its Notes and exclusions, the Deposit, and a rate typed by hand.
// Only what is named changes. The Deposit is named one way or the other: a
// percent puts the proposal back on a percent, a set amount overrides it.
export const update = mutation({
  args: {
    proposalId: v.id("proposals"),
    name: v.optional(v.string()),
    solutionIds: v.optional(v.array(v.id("solutions"))),
    notes: v.optional(v.string()),
    depositPercent: v.optional(v.number()),
    // Whole cents.
    depositCents: v.optional(v.number()),
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
    if (a.depositPercent !== undefined && a.depositCents !== undefined)
      throw new Error("Set the deposit as a percent or as an amount, not both.");
    if (a.depositPercent !== undefined) {
      refuse(depositPercentFault(a.depositPercent));
      patch.depositPercent = a.depositPercent;
      // Patching a field to undefined is what removes it.
      patch.depositCents = undefined;
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
    // Measured against the total this same edit leaves, so a set amount typed
    // alongside a change of solutions or rate is judged on what they come to.
    if (a.depositCents !== undefined) {
      const edited = { ...proposal, ...patch };
      const money = proposalMoney(
        (await liveSolutions(ctx, edited)).map(priceStoredSolution),
        edited.tax,
      );
      refuse(depositCentsFault(a.depositCents, money.totalCents));
      patch.depositCents = a.depositCents;
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
      ...(proposal.depositCents === undefined ? {} : { depositCents: proposal.depositCents }),
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
// reader works out money of its own. Past Draft every figure is the one Send
// froze, and the Proposal ID with them.
function proposalForOwner(
  proposal: Doc<"proposals">,
  site: Doc<"sites">,
  solutionById: (id: Id<"solutions">) => Doc<"solutions"> | undefined,
) {
  const offer = proposal.frozen
    ? frozenOffer(proposal.frozen)
    : liveOffer(proposal, site, solutionById);
  return {
    proposalId: proposal._id,
    siteId: site._id,
    siteName: site.name,
    code: offer.code,
    // The name as stored, for the field to show, and the name as read, for
    // everything that has to call the proposal something.
    name: proposal.name ?? null,
    title: proposalDisplayName(
      proposal.name,
      offer.solutions.map((solution) => solution.title),
    ),
    state: proposal.state,
    recommended: proposal.recommended,
    solutions: offer.solutions,
    notes: offer.notes ?? null,
    tax: offer.tax,
    money: offer.money,
    // The percent the proposal keeps even under a set amount, for switching
    // back to it.
    depositPercent: offer.depositPercent,
    payment: splitPayment(offer.money.totalCents, storedDeposit(offer)),
  };
}

function liveOffer(
  proposal: Doc<"proposals">,
  site: Doc<"sites">,
  solutionById: (id: Id<"solutions">) => Doc<"solutions"> | undefined,
) {
  // An id naming a solution since deleted is simply not there.
  const priced = proposal.solutionIds.flatMap((id) => {
    const solution = solutionById(id);
    return solution ? [{ solution, price: priceStoredSolution(solution) }] : [];
  });
  return {
    code: proposalCode(site.name, proposal.number),
    solutions: priced.map(({ solution, price }) => ({
      solutionId: solution._id,
      title: solution.title,
      priceCents: price?.priceCents ?? null,
    })),
    notes: proposal.notes,
    tax: proposal.tax,
    money: proposalMoney(
      priced.map(({ price }) => price),
      proposal.tax,
    ),
    depositPercent: proposal.depositPercent,
    depositCents: proposal.depositCents,
  };
}

function frozenOffer(frozen: FrozenProposal) {
  return {
    code: frozen.code,
    solutions: frozen.solutions.map((solution) => ({
      solutionId: solution.solutionId,
      title: solution.title,
      priceCents: solution.priceCents as number | null,
    })),
    notes: frozen.notes,
    tax: frozen.tax,
    money: {
      subtotalCents: frozen.subtotalCents,
      taxCents: frozen.taxCents,
      totalCents: frozen.totalCents,
    },
    depositPercent: frozen.depositPercent,
    depositCents: frozen.depositCents,
  };
}

// The customer's answer as the panel shows it: who signed and when, or when
// it was declined, by whom and why, and what became of the emails it sent.
function decisionForOwner(proposal: Doc<"proposals">) {
  return {
    approvedAt: proposal.approvedAt ?? null,
    signerName: proposal.signature?.signerName ?? null,
    declinedAt: proposal.declinedAt ?? null,
    declinedBy: proposal.declinedBy ?? null,
    declineReason: proposal.declineReason ?? null,
    decisionEmails: (proposal.decisionEmails ?? []).map((sent) => ({
      to: sent.to,
      email: sent.email ?? null,
    })),
  };
}

// Every signing link the proposal has had, newest first, for the panel's
// history, and whether the customer has opened the live one. Only the live
// link's token is handed over: it is the one the panel offers to copy, and an
// ended one opens nothing.
async function linkHistory(ctx: QueryCtx, proposalId: Id<"proposals">) {
  // Two sends in the same millisecond still list newest first.
  const links = (await signingLinksForProposal(ctx, proposalId)).sort(
    (x, y) => y.sentAt - x.sentAt || y._creationTime - x._creationTime,
  );
  const live = links.find((link) => link.endedAt === undefined);
  return {
    liveToken: live?.token ?? null,
    // The address the email carried, built the same way, so the link the panel
    // copies is that one exactly. Null where this deployment names no origin,
    // and the panel builds it from its own.
    liveUrl: live ? signingUrl(appOrigin(), live.token) : null,
    opened: live ? await customerViewedLink(ctx, live.token) : false,
    links: links.map((link) => ({
      linkId: link._id,
      sentTo: link.sentTo,
      sentAt: link.sentAt,
      email: link.email ?? null,
      endedAt: link.endedAt ?? null,
      endedReason: link.endedReason ?? null,
    })),
  };
}

// **Send** (CONTEXT.md): the draft offered to the customer by email. An action
// only so the link's token comes from real randomness, which a mutation's
// seeded generator is not promised to be; everything else happens in one
// mutation, so the offer, the link and the scheduled email land together.
export const send = action({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.proposals.sendWithLink, {
      proposalId: a.proposalId,
      token: mintLinkToken(),
    });
  },
});

// Freezes the offer as it stands (FRSG's frozen block, plus the Proposal ID,
// the customer's name, the site's address, the email it goes to and the
// Estimator), mints the link and schedules its email. The email is scheduled,
// never awaited: Send is the offer, and a Resend outage must be able to fail
// without unmaking it.
export const sendWithLink = internalMutation({
  args: { proposalId: v.id("proposals"), token: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await requireDraft(ctx, a.proposalId, "sent");
    const site = await ctx.db.get(proposal.siteId);
    if (!site) throw new Error("Site not found.");
    const customer = await ctx.db.get(site.customerId);
    if (!customer) throw new Error("Customer not found.");
    const identity = await ctx.auth.getUserIdentity();

    const priced = (await liveSolutions(ctx, proposal)).map((solution) => ({
      solution,
      price: priceStoredSolution(solution),
    }));
    const money = proposalMoney(
      priced.map(({ price }) => price),
      proposal.tax,
    );
    const sentTo = sendableEmail(customer.email);
    // The same questions the button asks, asked again here, because a stale
    // panel is exactly how an unpriced solution would otherwise reach a
    // customer.
    refuseSend([
      ...sendBlockers(
        priced.map(({ price }) => price?.priceCents ?? null),
        proposal.tax,
      ),
      ...depositBlockers(splitPayment(money.totalCents, storedDeposit(proposal))),
      ...recipientBlockers(sentTo),
    ]);
    // Refused above; this only tells the type checker so.
    if (sentTo === null) return;

    const frozen: FrozenProposal = {
      code: proposalCode(site.name, proposal.number),
      customerName: customer.name,
      site: { street: siteStreetLine(site), city: siteCityLine(site), region: site.region },
      sentTo,
      estimator: {
        name: identity?.name?.trim() || Unknown,
        email: identity?.email?.trim() || Unknown,
      },
      solutions: priced.map(({ solution, price }) => {
        // Unreachable past the refusal above, which names every unpriced
        // solution. Stated rather than defaulted, because a solution frozen at
        // $0 would be a price Expand never offered.
        if (!price) throw new Error("A solution with no price reached Send.");
        return {
          solutionId: solution._id,
          title: solution.title,
          scopeOfWork: solution.description,
          priceCents: price.priceCents,
          lineItems: offeredLineItems(solution.lineItems),
          materialAllowanceCents: solution.materialAllowanceCents,
        };
      }),
      ...money,
      depositPercent: proposal.depositPercent,
      ...(proposal.depositCents === undefined ? {} : { depositCents: proposal.depositCents }),
      tax: proposal.tax,
      terms: proposalTerms(),
      // The draft's own text, copied like everything else here. It stays on
      // the draft too, so Withdraw hands the live field back unchanged.
      ...(proposal.notes === undefined ? {} : { notes: proposal.notes }),
    };
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      state: "sent",
      frozen,
      sentAt: now,
      updatedAt: now,
    });
    // A proposal sent is a Thumbtack lead quoted (CONTEXT.md, **Stage**).
    await advanceForCustomer(ctx, customer._id, "sent");
    await emailNewLink(ctx, { proposal, frozen, token: a.token, ownerName: identity?.name, now });
  },
});

// **Withdraw** (CONTEXT.md): the offer taken back. The link ends, the frozen
// copy, the send stamp and any PDF copy go, and the proposal is a draft reading
// its live solutions again. Nobody is emailed; the customer's link just stops
// working.
export const withdraw = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await requireSent(ctx, a.proposalId, "withdrawn");
    const now = Date.now();
    await endSigningLinks(ctx, proposal._id, "withdrawn", now);
    await discardPdfCopy(ctx, proposal);
    await ctx.db.patch(proposal._id, {
      state: "draft",
      frozen: undefined,
      sentAt: undefined,
      updatedAt: now,
    });
  },
});

// **Re-send** (CONTEXT.md): the same frozen offer, to the customer's current
// email, with a fresh link. An action for the reason Send is one.
export const resend = action({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.proposals.resendWithLink, {
      proposalId: a.proposalId,
      token: mintLinkToken(),
    });
  },
});

// Nothing about what was offered moves, not even the send date on the paper:
// only where it went. The old link ends as `resent`, so the email it sat in
// stops opening anything. The PDF copy goes too, as it does whenever the offer
// is taken back from where it was: the new link's first Download makes its own.
export const resendWithLink = internalMutation({
  args: { proposalId: v.id("proposals"), token: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await requireSent(ctx, a.proposalId, "re-sent");
    if (!proposal.frozen) throw new Error("This proposal has no offer to send again.");
    const site = await ctx.db.get(proposal.siteId);
    const customer = site ? await ctx.db.get(site.customerId) : null;
    const sentTo = customer ? sendableEmail(customer.email) : null;
    refuseSend(recipientBlockers(sentTo));
    // Refused above; this only tells the type checker so.
    if (sentTo === null) return;

    const identity = await ctx.auth.getUserIdentity();
    const frozen = { ...proposal.frozen, sentTo };
    const now = Date.now();
    await endSigningLinks(ctx, proposal._id, "resent", now);
    await discardPdfCopy(ctx, proposal);
    await ctx.db.patch(proposal._id, { frozen, updatedAt: now });
    await emailNewLink(ctx, { proposal, frozen, token: a.token, ownerName: identity?.name, now });
  },
});

// The owner's Decline: the customer said no somewhere other than their link —
// on the phone, or by never answering. Final, like the customer's own, and the
// reason is optional because "they went elsewhere" is often all there is.
// Nobody is emailed, and the link stops opening anything: the customer never
// answered through it.
export const decline = mutation({
  args: { proposalId: v.id("proposals"), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await requireSent(ctx, a.proposalId, "declined");
    const now = Date.now();
    await endSigningLinks(ctx, proposal._id, "declined", now);
    await discardPdfCopy(ctx, proposal);
    await ctx.db.patch(proposal._id, {
      state: "declined",
      declinedAt: now,
      declinedBy: "owner",
      declineReason: optionalText(a.reason ?? "", ReasonMaxLength),
      decisionEmails: [],
      updatedAt: now,
    });
  },
});

// What the customer's page sends with Approve.
const approveArgs = {
  token: v.string(),
  signerName: v.string(),
  consentTicked: v.boolean(),
  noticeTicked: v.boolean(),
  // The versions of the two sentences the page showed beside its ticks. The
  // signature records the current constants, so a page rendered before a
  // wording change, or a caller that doesn't say what it showed, is refused
  // rather than recorded as having agreed to words its signer never read.
  // The notice's is needed only where the notice applies.
  consentWordingVersion: v.string(),
  noticeWordingVersion: v.optional(v.string()),
  // The signer's browser, as the page reports it. Recorded, never verified:
  // it is evidence an electronic signature keeps, not a gate.
  userAgent: v.optional(v.string()),
};

// **Approve** (CONTEXT.md): the customer's **Signature**, and the moment the
// agreement forms. Public and token-authenticated, ported from FRSG's
// `approve`: the signing link is the whole access model, and nobody at Expand
// countersigns. Convex runs mutations one at a time, so a second press that
// lands after the first finds the link ended and is refused.
//
// What is recorded is what the certificate of completion prints: who typed
// what, on which browser, when their link was first viewed, the sentences they
// ticked with their versions, and the offer as signed, sealed with its
// fingerprint. Washington's Notice to Customer is a second tick of its own,
// required only where the statute requires it. The approval emails follow,
// scheduled, so a mail outage can never unmake the signature, and so does the
// **Deposit invoice**, made and sent in the same mutation.
//
// An action only so the invoice link's token comes from real randomness, as
// Send's does; the signature, the invoice and every email land together in
// `approveWithLink`.
export const approve = action({
  args: approveArgs,
  handler: async (ctx, a) => {
    await ctx.runMutation(internal.proposals.approveWithLink, {
      ...a,
      invoiceToken: mintLinkToken(),
    });
  },
});

export const approveWithLink = internalMutation({
  args: { ...approveArgs, invoiceToken: v.string() },
  handler: async (ctx, a) => {
    const { link, proposal, site } = await requireLiveLink(ctx, a.token);
    const frozen = proposal.frozen;
    const noticeRequired = noticeToCustomerApplies(
      frozen.site.region ?? site.region,
      frozen.totalCents,
    );

    refuseStaleWording(a.consentWordingVersion, SigningConsent.version);
    if (noticeRequired)
      refuseStaleWording(a.noticeWordingVersion, WashingtonNoticeToCustomer.version);
    refuseSigning(
      signingFaults({
        signerName: a.signerName,
        consentTicked: a.consentTicked,
        noticeRequired,
        noticeTicked: a.noticeTicked,
      }),
    );

    const now = Date.now();
    const signerName = a.signerName.trim().replace(/\s+/g, " ").slice(0, NameMaxLength);
    const userAgent = optionalText(a.userAgent ?? "", UserAgentMaxLength);
    const firstOpenedAt = await firstCustomerView(ctx, link.token);
    const title = frozenTitle(proposal.name, frozen);
    const sealed = sealProposal({
      proposalId: proposal._id,
      number: proposal.number,
      code: frozen.code,
      name: title,
      customerName: frozen.customerName,
      site: frozen.site,
      // Present on every Sent proposal; the fallback only satisfies the type.
      sentAt: proposal.sentAt ?? link.sentAt,
      sentByName: frozen.estimator.name,
      offer: frozen,
    });

    // The customer at the address their link went to, and Expand, each on
    // their own so neither sees the other's address.
    const recipients = [link.sentTo, ExpandBusiness.email];
    await ctx.db.patch(proposal._id, {
      state: "approved",
      approvedAt: now,
      signature: {
        signerName,
        signingLinkId: link._id,
        signedAt: now,
        ...(userAgent === undefined ? {} : { userAgent }),
        ...(firstOpenedAt === null ? {} : { firstOpenedAt }),
        consentWording: SigningConsent.wording(proposal.number),
        consentWordingVersion: SigningConsent.version,
        noticeShown: noticeRequired,
        noticeTicked: noticeRequired && a.noticeTicked,
        ...(noticeRequired
          ? {
              noticeWording: WashingtonNoticeToCustomer.text,
              noticeWordingVersion: WashingtonNoticeToCustomer.version,
            }
          : {}),
        sealed,
      },
      decisionEmails: recipients.map((to) => ({ to })),
      updatedAt: now,
    });
    await endSigningLinks(ctx, proposal._id, "approved", now);
    // And an approved one is the customer's Thumbtack leads won.
    await advanceForCustomer(ctx, site.customerId, "approved");
    // The offer's PDF copy is not the signed copy, and goes with the state it
    // printed. The signed copy is made on its first download.
    await discardPdfCopy(ctx, proposal);

    for (const [index, to] of recipients.entries())
      await ctx.scheduler.runAfter(0, internal.proposalEmails.sendApproval, {
        proposalId: proposal._id,
        index,
        to,
        token: link.token,
        signerName,
        code: frozen.code,
        siteStreet: frozen.site.street,
        siteAddress: siteAddress(frozen),
        signedAt: now,
        proposalTitle: title,
        totalCents: frozen.totalCents,
      });
    await makeDepositInvoice(ctx, {
      proposal,
      frozen,
      proposalName: title,
      customerId: site.customerId,
      token: a.invoiceToken,
      now,
    });
  },
});

// The customer's Decline, from the same link and just as final as their
// signature. The reason is theirs to give or not; Expand hears either way.
export const declineFromLink = mutation({
  args: { token: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { proposal } = await requireLiveLink(ctx, a.token);
    const frozen = proposal.frozen;
    const now = Date.now();
    const reason = optionalText(a.reason ?? "", ReasonMaxLength);
    await endSigningLinks(ctx, proposal._id, "declined", now);
    await discardPdfCopy(ctx, proposal);
    await ctx.db.patch(proposal._id, {
      state: "declined",
      declinedAt: now,
      declinedBy: "customer",
      declineReason: reason,
      decisionEmails: [{ to: ExpandBusiness.email }],
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.proposalEmails.sendDeclineNotice, {
      proposalId: proposal._id,
      index: 0,
      to: ExpandBusiness.email,
      customerName: frozen.customerName,
      code: frozen.code,
      siteStreet: frozen.site.street,
      siteAddress: siteAddress(frozen),
      proposalTitle: frozenTitle(proposal.name, frozen),
      ...(reason === undefined ? {} : { reason }),
    });
  },
});

// What became of one of the decision's emails, written back by its scheduled
// send. It never touches the decision itself.
export const recordDecisionEmail = internalMutation({
  args: { proposalId: v.id("proposals"), index: v.number(), email: emailOutcome },
  handler: async (ctx, a) => {
    const proposal = await ctx.db.get(a.proposalId);
    const emails = proposal?.decisionEmails;
    if (!proposal || !emails || !emails[a.index]) return;
    await ctx.db.patch(proposal._id, {
      decisionEmails: emails.map((sent, index) =>
        index === a.index ? { ...sent, email: a.email } : sent,
      ),
    });
  },
});

// The customer's acts, refused the way the page reads them. A token that names
// nothing, a link that has ended and a proposal no longer Sent all get one
// sentence: which of them it is tells the holder nothing they can use.
async function requireLiveLink(ctx: MutationCtx, token: string): Promise<LiveSigningLink> {
  const live = await liveLinkForToken(ctx, token);
  if (!live)
    throw new ConvexError({
      code: "link_ended",
      message: `This link is no longer live. Reply to the email it came in, or call Expand Handyman at ${ExpandBusiness.phone}.`,
    });
  return live;
}

// A page rendered under an earlier wording, or one that doesn't say which it
// showed, is sent back to reload rather than recorded as agreeing to sentences
// its signer never saw.
function refuseStaleWording(shown: string | undefined, current: string) {
  if (shown === current) return;
  throw new ConvexError({
    code: "wording_stale",
    message: "The wording on this page has changed since it opened. Reload the page and sign again.",
  });
}

// Every reason the signing step is short of a signature, in one sentence,
// exactly as the sign bar lists them before it lets the button through.
function refuseSigning(faults: readonly SigningFault[]) {
  if (faults.length === 0) return;
  throw new ConvexError({
    code: faults[0],
    message: faults.map(signingFaultMessage).join(" "),
  });
}

// A sent proposal's display name, read from the solution titles Send froze.
function frozenTitle(name: string | undefined, frozen: FrozenProposal): string {
  return proposalDisplayName(
    name,
    frozen.solutions.map((solution) => solution.title),
  );
}

// The site as one line, the way every email names it.
function siteAddress(frozen: FrozenProposal): string {
  return [frozen.site.street, frozen.site.city].filter(Boolean).join(", ");
}

// One fresh link, and the email that carries it, scheduled to run once this
// mutation commits. The letter is written from the frozen offer, so a Re-send
// says exactly what the Send did.
async function emailNewLink(
  ctx: MutationCtx,
  send: {
    proposal: Doc<"proposals">;
    frozen: FrozenProposal;
    token: string;
    ownerName: string | undefined;
    now: number;
  },
) {
  const { proposal, frozen } = send;
  const linkId = await mintSigningLink(ctx, {
    proposalId: proposal._id,
    token: send.token,
    sentTo: frozen.sentTo,
    sentAt: send.now,
  });
  await ctx.scheduler.runAfter(0, internal.proposalEmails.sendSigningLink, {
    linkId,
    token: send.token,
    to: frozen.sentTo,
    customerName: frozen.customerName,
    // The owner's name on their account profile; the letter still reads
    // without one.
    ownerName: send.ownerName?.trim() || "Your estimator",
    siteStreet: frozen.site.street,
    siteAddress: siteAddress(frozen),
    proposalTitle: frozenTitle(proposal.name, frozen),
    totalCents: frozen.totalCents,
  });
}

// Every reason Send is refused, in one sentence, so fixing one thing is never
// followed by being told the next. The code names the first, for a caller
// that wants to branch.
function refuseSend(blockers: readonly SendBlocker[]) {
  if (blockers.length === 0) return;
  throw new ConvexError({
    code: blockers[0],
    blockers: [...blockers],
    message: blockers.map(sendBlockerMessage).join(" "),
  });
}

type FrozenProposal = NonNullable<Doc<"proposals">["frozen"]>;

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

// A draft's solutions as it offers them, read live. An id naming a solution
// since deleted is simply not there.
async function liveSolutions(ctx: QueryCtx, proposal: Doc<"proposals">) {
  return (await Promise.all(proposal.solutionIds.map((id) => ctx.db.get(id)))).flatMap(
    (solution) => (solution ? [solution] : []),
  );
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

// Approved and Declined are final: only an offer still waiting on the
// customer can be taken back or sent again.
async function requireSent(ctx: MutationCtx, proposalId: Id<"proposals">, act: string) {
  const proposal = await requireProposal(ctx, proposalId);
  if (proposal.state !== "sent") throw new Error(`Only a sent proposal can be ${act}.`);
  return proposal;
}

function refuse(fault: ProposalFault | null) {
  if (fault !== null) throw new Error(proposalFaultMessage(fault));
}

const NameMaxLength = 200;
const NotesMaxLength = 8000;
const ReasonMaxLength = 2000;
const UserAgentMaxLength = 512;

// Typed optional text as stored: trimmed, absent when blank, and cut at a
// length nothing legitimate exceeds.
function optionalText(value: string, maxLength: number): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}
