import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner } from "./auth";
import { rememberLineItems } from "./catalog";
import { solutionLineItem } from "./schema";
import { readLineItemUnit, type LineItemUnit } from "../lib/line-item-units";
import {
  lineItemFault,
  lineItemFaultMessage,
  markupFaultMessage,
  markupPercentFault,
  materialAllowanceFault,
  materialAllowanceFaultMessage,
  priceStoredSolution,
  readMarkupPercent,
  type SolutionLineItem,
} from "../lib/solution-pricing";

// Solutions, ported from FRSG's convex/solutions.ts: the priced pieces of work
// at a site that proposals are assembled from. They are plain live rows edited
// in one place, and reach the customer only inside a sent proposal's frozen
// copy. No price is ever stored: lib/solution-pricing.ts works it out from the
// line items, the markup and the material allowance on every read.

const DefaultTitle = "Untitled solution";

// The site page's Solutions tab: one site's solutions in the order written,
// read by its index, each saying whether a sent or decided proposal holds it
// and so it can't be deleted. A site that is gone has none.
export const forSite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const site = await ctx.db.get(a.siteId);
    if (!site) return [];
    const [solutions, fixed] = await Promise.all([
      ctx.db
        .query("solutions")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect(),
      solutionsInFixedProposals(ctx, site._id),
    ]);
    return solutions.map((solution) => ({
      ...solutionForOwner(solution),
      siteName: site.name,
      deletable: !fixed.has(solution._id),
    }));
  },
});

// "New solution" has already asked which site; the title is optional because
// the panel opens straight away for the owner to write one.
export const create = mutation({
  args: { siteId: v.id("sites"), title: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    if (!(await ctx.db.get(a.siteId))) throw new Error("Site not found.");
    const now = Date.now();
    return ctx.db.insert("solutions", {
      siteId: a.siteId,
      title: a.title?.trim() || DefaultTitle,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// One edit of one solution: its title, its Scope of Work (`description`), its
// line items, its markup and its material allowance. Only what is named
// changes; a material allowance named as null is taken off.
export const update = mutation({
  args: {
    solutionId: v.id("solutions"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    lineItems: v.optional(v.array(solutionLineItem)),
    markupPercent: v.optional(v.number()),
    materialAllowanceCents: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const solution = await requireSolution(ctx, a.solutionId);
    const patch: Partial<Doc<"solutions">> = {};

    if (a.title !== undefined) {
      const title = a.title.trim();
      if (!title) throw new Error("A Solution needs a title the customer can read.");
      patch.title = title;
    }
    if (a.description !== undefined) patch.description = a.description.trim();
    if (a.lineItems !== undefined) patch.lineItems = verifiedLineItems(a.lineItems);
    // A stored zero is a real markup, so this asks whether the field was named
    // rather than whether it is truthy.
    if (a.markupPercent !== undefined) {
      const fault = markupPercentFault(a.markupPercent);
      if (fault) throw new Error(markupFaultMessage(fault));
      patch.markupPercent = a.markupPercent;
    }
    // Patching the field to undefined is what removes it, so a solution with
    // no allowance never stores one of zero.
    if (a.materialAllowanceCents === null) patch.materialAllowanceCents = undefined;
    else if (a.materialAllowanceCents !== undefined) {
      const fault = materialAllowanceFault(a.materialAllowanceCents);
      if (fault) throw new Error(materialAllowanceFaultMessage(fault));
      patch.materialAllowanceCents = a.materialAllowanceCents;
    }

    const now = Date.now();
    await ctx.db.patch(solution._id, { ...patch, updatedAt: now });
    // The Catalog learns from the save, not from the typing.
    if (patch.lineItems !== undefined) await rememberLineItems(ctx, patch.lineItems, now);
  },
});

// A solution a draft offers drops out of the draft. One a sent or decided
// proposal offers stays, since that proposal is the record of what the
// customer was offered.
export const remove = mutation({
  args: { solutionId: v.id("solutions") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const solution = await ctx.db.get(a.solutionId);
    if (!solution) return;
    if ((await solutionsInFixedProposals(ctx, solution.siteId)).has(solution._id))
      throw new Error(
        "This solution is in a sent or decided proposal, so it can't be deleted.",
      );
    const drafts = await ctx.db
      .query("proposals")
      .withIndex("by_site", (q) => q.eq("siteId", solution.siteId))
      .collect();
    for (const draft of drafts)
      if (draft.solutionIds.includes(solution._id))
        await ctx.db.patch(draft._id, {
          solutionIds: draft.solutionIds.filter((id) => id !== solution._id),
        });
    await ctx.db.delete(solution._id);
  },
});

/** Shared with deleting a site, which may only happen while it has no proposals. */
export async function deleteSiteSolutions(ctx: MutationCtx, siteId: Id<"sites">) {
  const solutions = await ctx.db
    .query("solutions")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  for (const solution of solutions) await ctx.db.delete(solution._id);
}

function solutionForOwner(solution: Doc<"solutions">) {
  return {
    _id: solution._id,
    siteId: solution.siteId,
    title: solution.title,
    description: solution.description,
    // Every line reads with a unit, whatever the row holds.
    lineItems: (solution.lineItems ?? []).map((line) => ({
      ...line,
      unit: readLineItemUnit(line.unit),
    })),
    // Never absent: a solution nobody has repriced reads the default markup.
    markupPercent: readMarkupPercent(solution.markupPercent),
    materialAllowanceCents: solution.materialAllowanceCents ?? null,
    // Null rather than zero when nothing has been priced yet.
    price: priceStoredSolution(solution),
    updatedAt: solution.updatedAt,
  };
}

// A line item as it will be stored: named, non-negative, in whole cents and
// counted in a unit off the list, with the refusal worded by
// lib/solution-pricing.ts. A save that names no unit stores `EA`.
function verifiedLineItems(
  lineItems: SolutionLineItem[],
): (SolutionLineItem & { unit: LineItemUnit })[] {
  return lineItems.map((line) => {
    const fault = lineItemFault(line);
    if (fault) throw new Error(lineItemFaultMessage(fault));
    return { ...line, name: line.name.trim(), unit: readLineItemUnit(line.unit) };
  });
}

// The solutions a sent, approved or declined proposal at the site offers.
async function solutionsInFixedProposals(
  ctx: QueryCtx,
  siteId: Id<"sites">,
): Promise<Set<Id<"solutions">>> {
  const proposals = await ctx.db
    .query("proposals")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  return new Set(
    proposals
      .filter((proposal) => proposal.state !== "draft")
      .flatMap((proposal) => proposal.solutionIds),
  );
}

async function requireSolution(ctx: MutationCtx, solutionId: Id<"solutions">) {
  const solution = await ctx.db.get(solutionId);
  if (!solution) throw new Error("Solution not found.");
  return solution;
}
