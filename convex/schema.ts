import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export const field = v.object({
  id: v.string(),
  page: v.number(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
  kind: v.optional(
    v.union(
      v.literal("customerSignature"),
      v.literal("customerDate"),
      v.literal("ownerSignature"),
      v.literal("ownerDate"),
    ),
  ),
});
// One line of a solution's cost buildup. The unit is a plain string so an
// off-list one reaches lib/solution-pricing.ts's `lineItemFault` and is refused
// in words rather than by the validator.
export const solutionLineItem = v.object({
  name: v.string(),
  quantity: v.number(),
  unitCostCents: v.number(),
  unit: v.optional(v.string()),
});
// The rate a proposal charges and where it came from, as lib/proposal-pricing.ts
// reads it. `none` is a site outside Washington, which charges no tax; a
// missing rate under either other source is a Washington site nobody has a
// rate for yet, which is not a rate of zero. The location code and quarter are
// DOR's own, kept so the proposal can say which rate it charged.
export const proposalTax = v.object({
  source: v.union(v.literal("lookup"), v.literal("override"), v.literal("none")),
  rate: v.optional(v.number()),
  locationCode: v.optional(v.string()),
  period: v.optional(v.string()),
});
export default defineSchema({
  customers: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    // Legacy free-text address from before Sites. New customers have none; the
    // one-off migration moves these onto Sites and drops the field.
    site: v.optional(v.string()),
  }),
  // One verified street address of a customer, as Google's parts. The printed
  // address is built from the parts (lib/sites.ts), never stored.
  sites: defineTable({
    customerId: v.id("customers"),
    name: v.string(),
    addressLine1: v.string(),
    addressLine2: v.string(),
    city: v.string(),
    region: v.string(),
    postalCode: v.string(),
    placeId: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    accessNotes: v.string(),
    lastProposalNumber: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_place", ["customerId", "placeId"])
    .index("by_place", ["placeId"]),
  // One priced piece of handyman work at a site (CONTEXT.md, **Solution**):
  // FRSG's shape keyed to a site, without the roof-record links. No price is
  // stored; lib/solution-pricing.ts works it out from the line items and the
  // markup on every read.
  solutions: defineTable({
    siteId: v.id("sites"),
    title: v.string(),
    // The Scope of Work, under FRSG's field name.
    description: v.string(),
    lineItems: v.optional(v.array(solutionLineItem)),
    // Whole percent. Absent means the default markup; a stored zero is work
    // offered at cost.
    markupPercent: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]),
  // The Catalog (CONTEXT.md): every line item name the owner has saved, with
  // what it last cost and was last counted in. Suggestions are a prefix scan
  // over the normalized name, never a table scan.
  catalogEntries: defineTable({
    normalizedName: v.string(),
    name: v.string(),
    lastUnitCostCents: v.number(),
    lastUnit: v.optional(v.string()),
    useCount: v.number(),
    updatedAt: v.number(),
  }).index("by_normalized_name", ["normalizedName"]),
  // An offer assembled from a site's solutions (CONTEXT.md, **Proposal**):
  // FRSG's shape keyed to a site. A draft stores its solutions' ids and reads
  // them live, so nothing about their prices is kept here. Send adds the
  // frozen offer, its stamp and the decision.
  proposals: defineTable({
    siteId: v.id("sites"),
    // Issued from the site's `lastProposalNumber`; with the site name it makes
    // the Proposal ID.
    number: v.number(),
    name: v.optional(v.string()),
    state: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("approved"),
      v.literal("declined"),
    ),
    // In the order the proposal offers them.
    solutionIds: v.array(v.id("solutions")),
    recommended: v.boolean(),
    depositPercent: v.number(),
    tax: proposalTax,
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]),
  documents: defineTable({
    customerId: v.id("customers"),
    // Copied from the customer when the signing link is issued, so editing a
    // customer never rewrites an issued document. Absent on drafts.
    customerName: v.optional(v.string()),
    site: v.optional(v.string()),
    title: v.string(),
    originalId: v.id("_storage"),
    originalHash: v.string(),
    pageCount: v.number(),
    fields: v.array(field),
    status: v.union(
      v.literal("draft"),
      v.literal("ready"),
      v.literal("viewed"),
      v.literal("signed"),
      v.literal("declined"),
    ),
    token: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    signedAt: v.optional(v.number()),
    signedId: v.optional(v.id("_storage")),
    signedHash: v.optional(v.string()),
    signerName: v.optional(v.string()),
    signerTitle: v.optional(v.string()),
    ownerSignature: v.optional(
      v.object({ name: v.string(), signedAt: v.number() }),
    ),
    declinedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
    consent: v.optional(v.string()),
    consentVersion: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    intent: v.optional(
      v.object({
        id: v.string(),
        name: v.string(),
        signedAt: v.number(),
        title: v.optional(v.string()),
      }),
    ),
  })
    .index("by_token", ["token"])
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"])
    .index("by_status_signed", ["status", "signedAt"])
    .index("by_status_declined", ["status", "declinedAt"]),
  documentViews: defineTable({
    documentId: v.id("documents"),
    token: v.string(),
    viewer: v.union(v.literal("owner"), v.literal("customer")),
    documentStatus: v.union(
      v.literal("ready"),
      v.literal("viewed"),
      v.literal("signed"),
      v.literal("declined"),
    ),
    openedAt: v.number(),
    lastSeenAt: v.number(),
    viewedMs: v.number(),
    userAgent: v.optional(v.string()),
  })
    .index("by_document", ["documentId", "openedAt"])
    .index("by_document_viewer", ["documentId", "viewer", "openedAt"]),
});
