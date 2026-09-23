import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./auth";
import { lookUpPlace } from "./places";
import { insertSite, place } from "./sites";
import { parseCustomer } from "../lib/customer";

const contact = { name: v.string(), email: v.string(), phone: v.string() };

// The Customers list and every customer picker. Duplicate email and phone
// warnings are worked out in the dialog against this same list.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const customers = await ctx.db.query("customers").order("desc").take(1000);
    const siteCount = new Map<Id<"customers">, number>();
    for (const site of await ctx.db.query("sites").take(10_000))
      siteCount.set(site.customerId, (siteCount.get(site.customerId) ?? 0) + 1);
    return customers.map((c) => ({ ...c, siteCount: siteCount.get(c._id) ?? 0 }));
  },
});

// Name, email and phone, and optionally the first site. An action, because the
// picked address is looked up with Google before anything is written.
export const add = action({
  args: {
    ...contact,
    firstSite: v.optional(
      v.object({ placeId: v.string(), sessionToken: v.string() }),
    ),
  },
  handler: async (ctx, a): Promise<Id<"customers">> => {
    await requireOwner(ctx);
    const customer = parseCustomer(a);
    const found = a.firstSite
      ? await lookUpPlace(a.firstSite.placeId, a.firstSite.sessionToken)
      : undefined;
    return ctx.runMutation(internal.customers.insert, {
      ...customer,
      place: found?.address,
      unit: found?.unit ?? "",
    });
  },
});

// The customer and the first site in one transaction: a refused site leaves no
// customer behind.
export const insert = internalMutation({
  args: { ...contact, place: v.optional(place), unit: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const customerId = await ctx.db.insert("customers", parseCustomer(a));
    if (a.place)
      await insertSite(ctx, customerId, a.place, {
        addressLine2: a.unit,
        accessNotes: "",
      });
    return customerId;
  },
});

// Same fields and rules as add. Issued documents keep the name they were
// issued with, so only drafts follow an edit.
export const update = mutation({
  args: { customerId: v.id("customers"), ...contact },
  handler: async (ctx, { customerId, ...a }) => {
    await requireOwner(ctx);
    if (!(await ctx.db.get(customerId))) throw new Error("Customer not found.");
    await ctx.db.patch(customerId, parseCustomer(a));
  },
});
