import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./auth";
import { lookUpPlace } from "./places";
import { decidedAt } from "./signingLinks";
import { insertSite, place } from "./sites";
import { parseCustomer, usDigits } from "../lib/customer";
import { parseSiteDetails, siteCityLine, siteStreetLine } from "../lib/sites";
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

// The New deal dialog's customer picker: the few customers whose name matches
// what the owner typed, searched on the server so that a customer older than
// the newest thousand `list` reads can still be picked. With nothing typed,
// the newest few, the ones a fresh deal is most likely for.
const PickerSize = 6;
export const search = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    await requireOwner(ctx);
    const typed = text.trim();
    const found = typed
      ? await ctx.db
          .query("customers")
          .withSearchIndex("search_name", (q) => q.search("name", typed))
          .take(PickerSize)
      : await ctx.db.query("customers").order("desc").take(PickerSize);
    return Promise.all(
      found.map(async (c) => ({
        _id: c._id,
        name: c.name,
        siteCount: (
          await ctx.db
            .query("sites")
            .withIndex("by_customer", (q) => q.eq("customerId", c._id))
            .collect()
        ).length,
      })),
    );
  },
});

// The ChatGPT connector's find_customers: the customers whose name, email or
// phone number matches what the owner said, each with their sites and how many
// proposals each holds, read off indexes so that a customer older than the
// newest thousand `list` reads is found too. A name is searched as the New
// deal picker searches it; an email or a phone number is matched from its
// start, a phone by its digits however they were spaced. Name matches come
// first. Says how many more matched than it returns, counting up to a cap.
const FoundCap = 100;
export const find = query({
  args: { text: v.string(), limit: v.number() },
  handler: async (ctx, { text, limit }) => {
    await requireOwner(ctx);
    const typed = text.trim();
    if (!typed) return { customers: [], more: 0 };
    const startsWith = (index: "by_email" | "by_phone", field: "email" | "phone", start: string) =>
      ctx.db
        .query("customers")
        .withIndex(index, (q) =>
          // `\uffff` sorts after every character an email or phone holds.
          q.gte(field, start).lt(field, `${start}\uffff`),
        )
        .take(FoundCap);
    // Typing with no letter in it is a phone number, not a name.
    const phoneShaped = /^[\d\s().+-]+$/.test(typed);
    const email = typed.toLowerCase();
    // A typed country code is dropped, even ahead of a number half typed.
    const digits = usDigits(typed.replace(/^\+\s*1/, ""));
    const found = [
      ...(phoneShaped
        ? []
        : await ctx.db
            .query("customers")
            .withSearchIndex("search_name", (q) => q.search("name", typed))
            .take(FoundCap)),
      ...(email.length >= 3 ? await startsWith("by_email", "email", email) : []),
      ...(phoneShaped && digits.length >= 3
        ? await startsWith("by_phone", "phone", `+1${digits}`)
        : []),
    ];
    const unique = [...new Map(found.map((c) => [c._id, c])).values()];
    const customers = await Promise.all(
      unique.slice(0, limit).map(async (c) => {
        const sites = await ctx.db
          .query("sites")
          .withIndex("by_customer", (q) => q.eq("customerId", c._id))
          .collect();
        return {
          _id: c._id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          sites: await Promise.all(
            sites.map(async (site) => ({
              siteId: site._id,
              streetLine: siteStreetLine(site),
              cityLine: siteCityLine(site),
              proposalCount: (
                await ctx.db
                  .query("proposals")
                  .withIndex("by_site", (q) => q.eq("siteId", site._id))
                  .collect()
              ).length,
            })),
          ),
        };
      }),
    );
    return { customers, more: Math.max(0, unique.length - limit) };
  },
});

// Name, email and phone, and optionally the first site with its unit and
// access notes. An action, because the picked address is looked up with Google
// before anything is written. Says which site it made, so a customer added
// with one lands on that site's page.
export const add = action({
  args: {
    ...contact,
    firstSite: v.optional(
      v.object({
        placeId: v.string(),
        sessionToken: v.string(),
        addressLine2: v.optional(v.string()),
        accessNotes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (
    ctx,
    a,
  ): Promise<{ customerId: Id<"customers">; siteId: Id<"sites"> | null }> => {
    await requireOwner(ctx);
    const customer = parseCustomer(a);
    const typed = {
      addressLine2: a.firstSite?.addressLine2 ?? "",
      accessNotes: a.firstSite?.accessNotes ?? "",
    };
    parseSiteDetails(typed);
    const found = a.firstSite
      ? await lookUpPlace(a.firstSite.placeId, a.firstSite.sessionToken)
      : undefined;
    return ctx.runMutation(internal.customers.insert, {
      ...customer,
      firstSite: found
        ? {
            place: found.address,
            // A unit typed beside the address wins over the one Google read.
            addressLine2: typed.addressLine2.trim() || found.unit,
            accessNotes: typed.accessNotes,
          }
        : undefined,
    });
  },
});

// The customer and the first site in one transaction: a refused site leaves no
// customer behind.
export const insert = internalMutation({
  args: {
    ...contact,
    firstSite: v.optional(
      v.object({ place, addressLine2: v.string(), accessNotes: v.string() }),
    ),
  },
  handler: async (ctx, { firstSite, ...a }) => {
    await requireOwner(ctx);
    const customerId = await ctx.db.insert("customers", parseCustomer(a));
    const siteId = firstSite
      ? await insertSite(ctx, customerId, firstSite.place, firstSite)
      : null;
    return { customerId, siteId };
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
    const customer = parseCustomer(a, stored);
    await ctx.db.patch(customerId, {
      ...customer,
      ...(customer.phone === stored.phone ? {} : { phoneFrom: undefined }),
    });
  },
});
