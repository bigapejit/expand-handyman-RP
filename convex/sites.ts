import { v, type Infer } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./auth";
import { lookUpPlace } from "./places";
import { lookUpDraftTax, resetDraftTax } from "./proposals";
import { deleteSiteSolutions } from "./solutions";
import { Unknown } from "../lib/expand-business";
import {
  createSiteName,
  parseSiteDetails,
  sameUnit,
  siteAddress,
  siteCityLine,
  siteDeleteRefusal,
  siteStreetLine,
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

// The Sites list: every site across every customer, with its street and city
// lines, whose it is, how many proposals it has and when it was last touched,
// the one touched most recently first. The page searches the rows itself.
// Bounded as the Customers list is, and read in two scans rather than a query
// per site.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const sites = await ctx.db.query("sites").order("desc").take(1000);
    const proposals = new Map<Id<"sites">, { count: number; lastEdit: number }>();
    for (const proposal of await ctx.db.query("proposals").take(10_000)) {
      const held = proposals.get(proposal.siteId);
      proposals.set(proposal.siteId, {
        count: (held?.count ?? 0) + 1,
        lastEdit: Math.max(held?.lastEdit ?? 0, proposal.updatedAt),
      });
    }
    const customerNames = new Map<Id<"customers">, string>();
    const rows = [];
    for (const site of sites) {
      if (!customerNames.has(site.customerId))
        customerNames.set(
          site.customerId,
          (await ctx.db.get(site.customerId))?.name ?? Unknown,
        );
      const held = proposals.get(site._id);
      rows.push({
        siteId: site._id,
        customerId: site.customerId,
        customerName: customerNames.get(site.customerId) ?? Unknown,
        streetLine: siteStreetLine(site),
        cityLine: siteCityLine(site),
        proposalCount: held?.count ?? 0,
        // The site's own last edit or its proposals' latest, whichever is
        // newer. A photo's upload time joins them once the site holds photos.
        lastActivity: Math.max(site.updatedAt, held?.lastEdit ?? 0),
      });
    }
    return rows.sort((x, y) => y.lastActivity - x.lastActivity);
  },
});

// The site page's header: the site, its address over two lines, whose it is,
// its access notes, and the count beside each tab. Read by the id the page
// address carries, which may be anything a link was typed as, so an id naming
// no site opens nothing rather than failing.
export const get = query({
  args: { siteId: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const siteId = ctx.db.normalizeId("sites", a.siteId);
    const site = siteId ? await ctx.db.get(siteId) : null;
    if (!site) return null;
    const bySite = (table: "proposals" | "solutions" | "invoices") =>
      ctx.db
        .query(table)
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect();
    const [customer, proposals, solutions, invoices] = await Promise.all([
      ctx.db.get(site.customerId),
      bySite("proposals"),
      bySite("solutions"),
      bySite("invoices"),
    ]);
    return {
      site,
      streetLine: siteStreetLine(site),
      cityLine: siteCityLine(site),
      customerId: site.customerId,
      customerName: customer?.name ?? Unknown,
      accessNotes: site.accessNotes,
      counts: {
        proposals: proposals.length,
        solutions: solutions.length,
        // No site holds a photo until the photos table exists; the count is
        // read from its site index from then on.
        photos: 0,
        invoices: invoices.length,
      },
    };
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
    const drafts = await ctx.runMutation(internal.sites.patch, {
      siteId: a.siteId,
      place: found?.address,
      addressLine2: a.addressLine2.trim() || (found?.unit ?? ""),
      accessNotes: a.accessNotes,
    });
    await lookUpDraftTax(ctx, a.siteId, drafts);
  },
});

export const patch = internalMutation({
  args: { siteId: v.id("sites"), place: v.optional(place), ...details },
  handler: async (ctx, a): Promise<Id<"proposals">[]> => {
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
    // The drafts' tax follows the street, city, state and ZIP it was looked
    // up from; a new unit or access note changes none of them.
    const moved = (["addressLine1", "city", "region", "postalCode"] as const).some(
      (part) => next[part] !== site[part],
    );
    return moved ? resetDraftTax(ctx, { ...site, ...next }) : [];
  },
});

// Delete site, from Edit site on the site page. Refused while the site holds a
// proposal or an invoice, whatever the dialog showed; otherwise its solutions
// go with it.
export const remove = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const site = await ctx.db.get(a.siteId);
    if (!site) return;
    // One of each is enough to refuse, so none is counted past the first.
    const oneOf = async (table: "proposals" | "invoices") =>
      (await ctx.db
        .query(table)
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .first())
        ? 1
        : 0;
    const refusal = siteDeleteRefusal({
      proposals: await oneOf("proposals"),
      invoices: await oneOf("invoices"),
    });
    if (refusal) throw new Error(refusal);
    await deleteSiteSolutions(ctx, site._id);
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

/** The customer's site at this place and unit, other than `except`. */
export async function findSite(
  ctx: QueryCtx,
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
  return same.find((s) => s._id !== except && sameUnit(s.addressLine2, addressLine2));
}

async function refuseDuplicate(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  placeId: string,
  addressLine2: string,
  except?: Id<"sites">,
) {
  if (await findSite(ctx, customerId, placeId, addressLine2, except))
    throw new Error("This customer already has that site.");
}
