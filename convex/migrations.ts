import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { customerDetails } from "./documents";
import { findSite, insertSite, place } from "./sites";
import {
  MAX_LOOKUP,
  NotAStreetAddress,
  placeAddress,
  placesKey,
  suggestAddresses,
} from "../lib/places";

// One transaction can only read and write so much, so the backfill takes a
// bounded page at a time. Freezing a document removes it from the next page,
// so there is no cursor to carry: run until it reports done.
const PAGE = 200;

// One-off. Documents issued before customer details were frozen carry no copy of
// the customer's name, so they would still follow a renamed customer.
// Freeze them as they stand today. Drafts are left alone: they are meant to read
// the live customer until their link is issued.
export const backfillCustomerDetails = internalMutation({
  args: {},
  handler: async (ctx) => {
    const page = await ctx.db
      .query("documents")
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "draft"),
          q.eq(q.field("customerName"), undefined),
        ),
      )
      .take(PAGE);
    for (const d of page)
      await ctx.db.patch(d._id, {
        customerName: (await customerDetails(ctx, d)).customerName,
      });
    return { frozen: page.length, done: page.length < PAGE };
  },
});

type Report = {
  migrated: { customer: string; site: string }[];
  failed: { customer: string; address: string; reason: string }[];
};

// One-off. Customers from before Sites carry one free-text address. Each goes
// through the same Places calls as the address box: exactly one suggestion that
// Google resolves to a street address becomes a site, and anything else creates
// none and is reported for the owner to add by hand on the customer page. Every
// lookup runs before anything is written, so a Google fault changes nothing and
// the run can simply be repeated. Run from the CLI:
//   npx convex run --prod migrations:sitesFromCustomers
export const sitesFromCustomers = internalAction({
  args: {},
  handler: async (ctx): Promise<Report> => {
    const key = placesKey();
    const legacy = await ctx.runQuery(internal.migrations.legacyAddresses, {});
    const outcomes = [];
    for (const customer of legacy) {
      const text = customer.address.trim();
      // A blank address has nothing to look up; it is only cleared.
      outcomes.push({
        ...customer,
        ...(text ? await resolve(key, text) : {}),
      });
    }
    return ctx.runMutation(internal.migrations.moveOntoSites, { outcomes });
  },
});

async function resolve(key: string, text: string) {
  // One session per customer, as one lookup in the address box would be.
  const session = crypto.randomUUID();
  const suggestions = await suggestAddresses(key, text.slice(0, MAX_LOOKUP), session);
  if (suggestions.length !== 1)
    return {
      reason: suggestions.length
        ? `Google found ${suggestions.length} matches.`
        : "Google found no match.",
    };
  try {
    return { found: await placeAddress(key, suggestions[0].placeId, session) };
  } catch (error) {
    // Anything else is Google or the network failing, which must abort the
    // run before any address is cleared.
    if (!(error instanceof NotAStreetAddress)) throw error;
    return { reason: error.message };
  }
}

// The free-text address customers had before Sites. The schema no longer
// declares it, so only a deployment the migration has not yet run on holds it.
type LegacyCustomer = Doc<"customers"> & { site?: string };

// Every customer fits one run: there are a handful, and moveOntoSites writes
// them all in one transaction.
export const legacyAddresses = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("customers").take(1000)).flatMap((c: LegacyCustomer) =>
      c.site === undefined
        ? []
        : [{ customerId: c._id, name: c.name, address: c.site }],
    ),
});

// Every customer's outcome in one transaction, clearing each legacy address as
// it goes, so the report and the data can never disagree.
export const moveOntoSites = internalMutation({
  args: {
    outcomes: v.array(
      v.object({
        customerId: v.id("customers"),
        name: v.string(),
        address: v.string(),
        found: v.optional(v.object({ address: place, unit: v.string() })),
        reason: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, a): Promise<Report> => {
    const report: Report = { migrated: [], failed: [] };
    for (const o of a.outcomes) {
      const customer = await ctx.db.get(o.customerId);
      if (!customer) continue;
      if (o.found) {
        const { address, unit } = o.found;
        // Added by hand on the Sites tab before this ran: nothing to create.
        const existing = await findSite(ctx, customer._id, address.placeId, unit);
        const siteId =
          existing?._id ??
          (await insertSite(ctx, customer._id, address, {
            addressLine2: unit,
            accessNotes: "",
          }));
        const site = await ctx.db.get(siteId);
        report.migrated.push({ customer: o.name, site: site!.name });
      } else if (o.reason) {
        report.failed.push({ customer: o.name, address: o.address, reason: o.reason });
      }
      // Rewritten without the legacy field, which the schema no longer declares.
      await ctx.db.replace(customer._id, {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      });
    }
    return report;
  },
});
