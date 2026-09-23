import { v, type Infer } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./auth";
import { lookUpPlace } from "./places";
import {
  createSiteName,
  parseSiteDetails,
  sameUnit,
  siteAddress,
} from "../lib/sites";

// A picked place as Google described it, fetched on the server so no site can
// hold an address Google did not return.
export const place = v.object({
  placeId: v.string(),
  addressLine1: v.string(),
  city: v.string(),
  region: v.string(),
  postalCode: v.string(),
  latitude: v.number(),
  longitude: v.number(),
});
const details = { addressLine2: v.string(), accessNotes: v.string() };

export const forCustomer = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_customer", (q) => q.eq("customerId", a.customerId))
      .collect();
    return Promise.all(
      sites
        .sort((x, y) => x.name.localeCompare(y.name))
        .map(async (site) => ({
          ...site,
          address: siteAddress(site),
          proposalCount: (
            await ctx.db
              .query("proposals")
              .withIndex("by_site", (q) => q.eq("siteId", site._id))
              .collect()
          ).length,
        })),
    );
  },
});

// Every site at one Google place, whoever's it is. The site dialog refuses the
// customer's own duplicate and warns about everyone else's.
export const atPlace = query({
  args: { placeId: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_place", (q) => q.eq("placeId", a.placeId))
      .take(50);
    return Promise.all(
      sites.map(async (site) => ({
        siteId: site._id,
        customerId: site.customerId,
        customerName: (await ctx.db.get(site.customerId))?.name ?? "",
        addressLine2: site.addressLine2,
      })),
    );
  },
});

export const add = action({
  args: {
    customerId: v.id("customers"),
    placeId: v.string(),
    sessionToken: v.string(),
    ...details,
  },
  handler: async (ctx, a): Promise<Id<"sites">> => {
    await requireOwner(ctx);
    parseSiteDetails(a);
    const found = await lookUpPlace(a.placeId, a.sessionToken);
    return ctx.runMutation(internal.sites.insert, {
      customerId: a.customerId,
      place: found.address,
      addressLine2: a.addressLine2.trim() || found.unit,
      accessNotes: a.accessNotes,
    });
  },
});

export const insert = internalMutation({
  args: { customerId: v.id("customers"), place, ...details },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    if (!(await ctx.db.get(a.customerId))) throw new Error("Customer not found.");
    return insertSite(ctx, a.customerId, a.place, a);
  },
});

// Picking the address again is optional: without a place only the unit and the
// access notes change, and Google is not asked.
export const update = action({
  args: {
    siteId: v.id("sites"),
    placeId: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
    ...details,
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    parseSiteDetails(a);
    const found = a.placeId
      ? await lookUpPlace(a.placeId, a.sessionToken)
      : undefined;
    await ctx.runMutation(internal.sites.patch, {
      siteId: a.siteId,
      place: found?.address,
      addressLine2: a.addressLine2.trim() || (found?.unit ?? ""),
      accessNotes: a.accessNotes,
    });
  },
});

export const patch = internalMutation({
  args: { siteId: v.id("sites"), place: v.optional(place), ...details },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const site = await ctx.db.get(a.siteId);
    if (!site) throw new Error("Site not found.");
    const next = a.place ?? site;
    const parsed = parseSiteDetails(a);
    await refuseDuplicate(ctx, site.customerId, next.placeId, parsed.addressLine2, site._id);
    await ctx.db.patch(site._id, {
      ...(a.place ?? {}),
      ...parsed,
      // Rebuilt on every save, so a corrected street renames the site.
      name: createSiteName(next.addressLine1),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const site = await ctx.db.get(a.siteId);
    if (!site) return;
    const proposal = await ctx.db
      .query("proposals")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .first();
    if (proposal)
      throw new Error("This site has proposals, so it can't be deleted.");
    await ctx.db.delete(site._id);
  },
});

/** Shared with adding a customer, whose first site saves in the same mutation. */
export async function insertSite(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  found: Infer<typeof place>,
  typed: { addressLine2: string; accessNotes: string },
) {
  const parsed = parseSiteDetails(typed);
  await refuseDuplicate(ctx, customerId, found.placeId, parsed.addressLine2);
  const now = Date.now();
  return ctx.db.insert("sites", {
    customerId,
    ...found,
    ...parsed,
    name: createSiteName(found.addressLine1),
    lastProposalNumber: 0,
    createdAt: now,
    updatedAt: now,
  });
}

async function refuseDuplicate(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  placeId: string,
  addressLine2: string,
  except?: Id<"sites">,
) {
  const same = await ctx.db
    .query("sites")
    .withIndex("by_customer_place", (q) =>
      q.eq("customerId", customerId).eq("placeId", placeId),
    )
    .collect();
  if (same.some((s) => s._id !== except && sameUnit(s.addressLine2, addressLine2)))
    throw new Error("This customer already has that site.");
}
