import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOwner } from "./auth";
import { siteAddress } from "../lib/sites";

// PROTOTYPE (issue #90): the reads the site-first pages need and nothing on
// main has yet. Throwaway; the real build writes its own.

// Every site across every customer, for the Sites list: address, customer,
// proposal count and when it was last touched.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const sites = await ctx.db.query("sites").take(2000);
    const customers = new Map<string, string>();
    for (const c of await ctx.db.query("customers").take(2000))
      customers.set(c._id, c.name);
    const rows = await Promise.all(
      sites.map(async (site) => {
        const proposals = await ctx.db
          .query("proposals")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .collect();
        const lastActivity = Math.max(
          site.updatedAt,
          ...proposals.map((p) => p.updatedAt),
        );
        return {
          siteId: site._id,
          customerId: site.customerId,
          customerName: customers.get(site.customerId) ?? "",
          name: site.name,
          address: siteAddress(site),
          street: [site.addressLine1, site.addressLine2].filter(Boolean).join(", "),
          proposalCount: proposals.length,
          lastActivity,
        };
      }),
    );
    return rows.sort((a, b) => b.lastActivity - a.lastActivity);
  },
});

// One site for its page header: the address, the customer it belongs to and
// the counts the tabs show. Null when the id names no site.
export const get = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const site = await ctx.db.get(a.siteId);
    if (!site) return null;
    const customer = await ctx.db.get(site.customerId);
    const [proposals, solutions, invoices] = await Promise.all([
      ctx.db.query("proposals").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
      ctx.db.query("solutions").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
      ctx.db.query("invoices").withIndex("by_site", (q) => q.eq("siteId", site._id)).collect(),
    ]);
    return {
      site,
      address: siteAddress(site),
      street: [site.addressLine1, site.addressLine2].filter(Boolean).join(", "),
      cityLine: [site.city, [site.region, site.postalCode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", "),
      customer: customer
        ? { customerId: customer._id, name: customer.name, email: customer.email, phone: customer.phone }
        : null,
      counts: {
        proposals: proposals.length,
        solutions: solutions.length,
        invoices: invoices.length,
      },
    };
  },
});
