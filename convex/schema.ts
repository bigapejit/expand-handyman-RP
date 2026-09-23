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
// The offer as Send froze it (CONTEXT.md, **Send**): FRSG's frozen block, plus
// everything else the paper prints that could otherwise move under it — the
// Proposal ID, the customer's name, the site's address, the email it went to
// and the Estimator. Every reader of a proposal past Draft reads this and never
// the live solutions, customer or site. Line items keep only what the customer
// reads; their costs stay live and internal.
export const frozenProposal = v.object({
  code: v.string(),
  customerName: v.string(),
  // The state is kept for the Notice to Customer, which is Washington's: the
  // offer answers to the state it was sent in, wherever the site moves after.
  // Absent on proposals sent before it was frozen.
  site: v.object({ street: v.string(), city: v.string(), region: v.optional(v.string()) }),
  sentTo: v.string(),
  estimator: v.object({ name: v.string(), email: v.string() }),
  solutions: v.array(
    v.object({
      solutionId: v.id("solutions"),
      title: v.string(),
      scopeOfWork: v.string(),
      priceCents: v.number(),
      lineItems: v.array(
        v.object({ name: v.string(), quantity: v.number(), unit: v.string() }),
      ),
      // Whole-dollar cents, printed on the paper. Absent when the solution had
      // none, and on every proposal sent before allowances existed.
      materialAllowanceCents: v.optional(v.number()),
    }),
  ),
  subtotalCents: v.number(),
  taxCents: v.number(),
  totalCents: v.number(),
  depositPercent: v.number(),
  // A set Deposit, overriding the percent (lib/proposal-pricing.ts,
  // `storedDeposit`). Absent on a percent Deposit, and on every proposal sent
  // before set amounts existed.
  depositCents: v.optional(v.number()),
  tax: proposalTax,
  terms: v.array(v.object({ heading: v.string(), body: v.string() })),
  notes: v.optional(v.string()),
});
// What became of the email that carried a signing link, as convex/email.ts
// answers: Resend took it, this deployment sends no mail, or something stopped
// a send that was meant to happen. Absent while the scheduled send is in flight.
export const emailOutcome = v.union(
  v.object({ outcome: v.literal("sent"), id: v.optional(v.string()) }),
  v.object({ outcome: v.literal("notSent"), reason: v.literal("noApiKey") }),
  v.object({ outcome: v.literal("fault"), fault: v.string() }),
);
// The customer's **Signature** on an approved proposal (CONTEXT.md), FRSG's
// electronic signature for one recipient: no contact, no title, no network
// address (ADR 0001 keeps none), and no paper path. Everything a certificate
// of completion prints is here, with the proposal as signed sealed into one
// canonical string and its SHA-256 fingerprint (lib/proposal-signing.ts).
export const proposalSignature = v.object({
  signerName: v.string(),
  signingLinkId: v.id("signingLinks"),
  signedAt: v.number(),
  userAgent: v.optional(v.string()),
  // The earliest customer view of the link that signed; absent when the view
  // log has none, as when the page's own report of the open never landed.
  firstOpenedAt: v.optional(v.number()),
  consentWording: v.string(),
  consentWordingVersion: v.string(),
  noticeShown: v.boolean(),
  noticeTicked: v.boolean(),
  noticeWording: v.optional(v.string()),
  noticeWordingVersion: v.optional(v.string()),
  sealed: v.object({ document: v.string(), fingerprint: v.string() }),
});
export const signingLinkEndedReason = v.union(
  v.literal("approved"),
  v.literal("declined"),
  v.literal("withdrawn"),
  v.literal("resent"),
);
export default defineSchema({
  customers: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.string(),
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
  // stored; lib/solution-pricing.ts works it out from the line items, the
  // markup and the material allowance on every read.
  solutions: defineTable({
    siteId: v.id("sites"),
    title: v.string(),
    // The Scope of Work, under FRSG's field name.
    description: v.string(),
    lineItems: v.optional(v.array(solutionLineItem)),
    // Whole percent. Absent means the default markup; a stored zero is work
    // offered at cost.
    markupPercent: v.optional(v.number()),
    // The **Material allowance**, in whole-dollar cents of at least $1.
    // Absent means the solution has none.
    materialAllowanceCents: v.optional(v.number()),
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
    // The Deposit (CONTEXT.md): the percent is always kept, so switching back
    // from a set amount finds the one the owner last chose; a set amount, when
    // there is one, overrides it.
    depositPercent: v.number(),
    depositCents: v.optional(v.number()),
    tax: proposalTax,
    notes: v.optional(v.string()),
    // Written by Send and dropped by Withdraw. A Re-send keeps both: the
    // offer and the date it was made are unchanged, only where it went moves.
    frozen: v.optional(frozenProposal),
    sentAt: v.optional(v.number()),
    // The decision, final either way. Approve writes the signature; a decline
    // says who made it, because only the customer's own keeps their link
    // readable and emails the owner.
    approvedAt: v.optional(v.number()),
    signature: v.optional(proposalSignature),
    declinedAt: v.optional(v.number()),
    declinedBy: v.optional(v.union(v.literal("customer"), v.literal("owner"))),
    declineReason: v.optional(v.string()),
    // The emails the decision sent, in the order they were scheduled, each
    // with what became of it once its send has written back. Recorded, never
    // read by the lifecycle: the decision stands whatever the mail did.
    decisionEmails: v.optional(
      v.array(v.object({ to: v.string(), email: v.optional(emailOutcome) })),
    ),
    // The **PDF copy** (CONTEXT.md; ADR 0002): the paper as a file, made the
    // first time someone presses Download and kept while the proposal stays in
    // the state it was made for. Only Sent and Approved have one.
    pdfCopy: v.optional(
      v.object({
        storageId: v.id("_storage"),
        state: v.union(v.literal("sent"), v.literal("approved")),
        renderedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site", ["siteId"])
    // The Dashboard reads Sent and decided proposals by state and never scans
    // the drafts; Sent ones come out oldest send first.
    .index("by_state_sent", ["state", "sentAt"]),
  // One per Send or Re-send (CONTEXT.md, **Signing link**). A link is never
  // deleted: ending it keeps the row as the record of what went where and how
  // it finished, which is the panel's link history.
  signingLinks: defineTable({
    proposalId: v.id("proposals"),
    token: v.string(),
    sentTo: v.string(),
    sentAt: v.number(),
    email: v.optional(emailOutcome),
    endedAt: v.optional(v.number()),
    endedReason: v.optional(signingLinkEndedReason),
  })
    .index("by_proposal", ["proposalId"])
    .index("by_token", ["token"]),
  // A **Render pass** (CONTEXT.md; ADR 0002): what the renderer opens the
  // paper with, at `/paper/<token>`. One per render, for one proposal in the
  // state being rendered and under the signing link it went out under,
  // expiring within minutes and deleted when the render ends. Reading the
  // paper through one never touches the view log.
  renderPasses: defineTable({
    token: v.string(),
    proposalId: v.id("proposals"),
    state: v.union(v.literal("sent"), v.literal("approved")),
    linkId: v.id("signingLinks"),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),
  // The proposal half of the view log, the same shape and rules as
  // `documentViews` (ADR 0001).
  proposalViews: defineTable({
    proposalId: v.id("proposals"),
    token: v.string(),
    viewer: v.union(v.literal("owner"), v.literal("customer")),
    proposalState: v.union(
      v.literal("sent"),
      v.literal("approved"),
      v.literal("declined"),
    ),
    openedAt: v.number(),
    lastSeenAt: v.number(),
    viewedMs: v.number(),
    userAgent: v.optional(v.string()),
  })
    .index("by_proposal", ["proposalId", "openedAt"])
    .index("by_token_viewer", ["token", "viewer", "openedAt"]),
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
