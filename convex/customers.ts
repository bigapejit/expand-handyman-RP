import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./auth";
import { lookUpPlace } from "./places";
import { decidedAt } from "./signingLinks";
import { insertSite, place } from "./sites";
import { parseCustomer } from "../lib/customer";
import { proposalActivity, type ProposalOutcome } from "../lib/proposals";

const contact = { name: v.string(), email: v.string(), phone: v.string() };

// The Customers list and every customer picker. Duplicate email and phone
// warnings are worked out in the dialog against this same list. Each row keeps
// its **Thumbtack number** mark (`phoneFrom`).
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const customers = await ctx.db.query("customers").order("desc").take(1000);
    const siteCount = new Map<Id<"customers">, number>();
    const customerOfSite = new Map<Id<"sites">, Id<"customers">>();
    for (const site of await ctx.db.query("sites").take(10_000)) {
      siteCount.set(site.customerId, (siteCount.get(site.customerId) ?? 0) + 1);
      customerOfSite.set(site._id, site.customerId);
    }
    const proposals = new Map<Id<"customers">, ProposalOutcome[]>();
    for (const proposal of await ctx.db.query("proposals").take(10_000)) {
      const customerId = customerOfSite.get(proposal.siteId);
      if (!customerId) continue;
      const outcome = {
        state: proposal.state,
        decidedAt:
          proposal.state === "approved" || proposal.state === "declined"
            ? await decidedAt(ctx, proposal)
            : null,
      };
      const held = proposals.get(customerId);
      if (held) held.push(outcome);
      else proposals.set(customerId, [outcome]);
    }
    return customers.map((c) => ({
      ...c,
      siteCount: siteCount.get(c._id) ?? 0,
      proposalActivity: proposalActivity(proposals.get(c._id) ?? []),
    }));
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
// issued with, so only drafts follow an edit. A different phone is the owner's
// own number, so the **Thumbtack number** mark goes with the old one.
export const update = mutation({
  args: { customerId: v.id("customers"), ...contact },
  handler: async (ctx, { customerId, ...a }) => {
    await requireOwner(ctx);
    const stored = await ctx.db.get(customerId);
    if (!stored) throw new Error("Customer not found.");
    const customer = parseCustomer(a);
    await ctx.db.patch(customerId, {
      ...customer,
      ...(customer.phone === stored.phone ? {} : { phoneFrom: undefined }),
    });
  },
});
