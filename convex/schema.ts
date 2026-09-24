import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
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
// One **Invoice line** (CONTEXT.md): a description and whole cents before
// tax, negative for a credit.
export const invoiceLine = v.object({ description: v.string(), cents: v.number() });
// What Send fixes on an invoice beside its number and date, so later edits to
// the customer, the site or the proposal never change a sent invoice. The
// deposit invoice is made sent, so Approve writes it from the frozen offer.
export const frozenInvoice = v.object({
  customerName: v.string(),
  site: v.object({ street: v.string(), city: v.string() }),
  // The Proposal ID and the proposal's display name, as the paper prints them.
  proposalCode: v.string(),
  proposalName: v.string(),
  sentTo: v.string(),
});
// Which paper a sent or void invoice is, as its stamp makes it
// (lib/invoice-paper.ts, `invoicePaperState`): what a PDF copy of it, and the
// render pass that prints one, are bound to.
export const invoicePaperState = v.union(v.literal("sent"), v.literal("paid"), v.literal("void"));
export const signingLinkEndedReason = v.union(
  v.literal("approved"),
  v.literal("declined"),
  v.literal("withdrawn"),
  v.literal("resent"),
);
// Where a deal stands with the owner (CONTEXT.md, **Stage**; lib/pipeline.ts).
export const dealStage = v.union(
  v.literal("new"),
  v.literal("talking"),
  v.literal("booked"),
  v.literal("estimating"),
  v.literal("quoted"),
  v.literal("won"),
  v.literal("lost"),
);
// Where a deal came from (CONTEXT.md, **Source**). Only the webhook says
// Thumbtack; the owner picks one of the rest.
export const handSource = v.union(
  v.literal("referral"),
  v.literal("repeat"),
  v.literal("website"),
  v.literal("phone"),
);
export const dealSource = v.union(v.literal("thumbtack"), handSource);
// A file on a lead or a message, as Thumbtack describes it. The file stays on
// Thumbtack; only its link is kept.
export const leadAttachment = v.object({
  fileName: v.string(),
  fileSize: v.number(),
  mimeType: v.string(),
  url: v.string(),
  description: v.optional(v.string()),
});
export default defineSchema({
  customers: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    // The **Thumbtack number** mark: the phone came with a lead and may be a
    // relay that stops working. Dropped when the owner saves another number.
    phoneFrom: v.optional(v.literal("thumbtack")),
  }),
  // A **Lead** (CONTEXT.md): one Thumbtack request for work, under the
  // customer it made or matched. Thumbtack's negotiation ID is the dedupe key,
  // because its webhooks may arrive more than once.
  leads: defineTable({
    customerId: v.id("customers"),
    negotiationId: v.string(),
    thumbtackCustomerId: v.string(),
    // The number as Thumbtack sent it. The customer holds it normalized, or
    // nothing when it is not a number the customer dialog could save again.
    phone: v.optional(v.string()),
    // When Thumbtack made the lead, not when the webhook landed.
    arrivedAt: v.number(),
    category: v.string(),
    description: v.string(),
    details: v.array(v.object({ question: v.string(), answer: v.string() })),
    location: v.object({
      address1: v.optional(v.string()),
      address2: v.optional(v.string()),
      city: v.string(),
      state: v.string(),
      zipCode: v.string(),
    }),
    attachments: v.array(leadAttachment),
    // Thumbtack's own estimate and what the lead cost, both as it words them.
    estimate: v.optional(
      v.object({
        type: v.string(),
        total: v.optional(v.string()),
        pricePerUnit: v.optional(v.string()),
        unitQuantity: v.optional(v.number()),
        unitName: v.optional(v.string()),
      }),
    ),
    leadPrice: v.optional(v.string()),
    // The **Deal** the lead became, which holds its stage. Absent only on a
    // lead from before deals, until migrations:dealsFromLeads runs.
    dealId: v.optional(v.id("deals")),
    // Legacy: the stage lived here before deals. Rows from then still carry
    // it; nothing reads it.
    stage: v.optional(dealStage),
    stageChangedAt: v.optional(v.number()),
    lastMessageAt: v.optional(v.number()),
    lastCustomerMessageAt: v.optional(v.number()),
    // The owner's latest message on Thumbtack: a customer message after one
    // is the customer answering, which moves New to Talking.
    lastBusinessMessageAt: v.optional(v.number()),
    // When the owner last opened the lead in the app. **Unread** is a
    // customer message after it.
    openedAt: v.optional(v.number()),
  })
    .index("by_negotiation", ["negotiationId"])
    .index("by_customer", ["customerId"])
    .index("by_thumbtack_customer", ["thumbtackCustomerId"]),
  // A **Deal** (CONTEXT.md): one job the owner is chasing for a customer, on
  // the **Pipeline**. A Thumbtack lead makes one as it arrives; the owner adds
  // the rest by hand. The site is absent until one is known.
  deals: defineTable({
    customerId: v.id("customers"),
    siteId: v.optional(v.id("sites")),
    title: v.string(),
    source: dealSource,
    stage: dealStage,
    stageChangedAt: v.number(),
    // The owner's own **Notes**, never shown to the customer.
    notes: v.string(),
    // The owner's guess at the job, whole dollars in cents, before any
    // proposal says better.
    ballparkCents: v.optional(v.number()),
    // The **Lead** behind a Thumbtack deal.
    leadId: v.optional(v.id("leads")),
    // The proposal that last moved the deal, by being sent or approved: the
    // offer the card and panel read. Absent on a deal no proposal has moved.
    proposalId: v.optional(v.id("proposals")),
    // Proposals the deal once held and let go of, on moving to another site
    // or being repointed to another customer. Kept so an approval of one of
    // them is never given to another job for want of a holder.
    letGoProposalIds: v.optional(v.array(v.id("proposals"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_stage", ["stage", "stageChangedAt"])
    .index("by_lead", ["leadId"]),
  // One message of a **Thumbtack chat**, from either side. Read-only: the app
  // never sends one.
  leadMessages: defineTable({
    leadId: v.id("leads"),
    messageId: v.string(),
    from: v.union(v.literal("customer"), v.literal("business")),
    text: v.string(),
    attachments: v.array(leadAttachment),
    sentAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_lead", ["leadId", "sentAt"]),
  // Every delivery to the Thumbtack webhook, taken or refused, kept as it came
  // so the first real payloads can be checked against the research.
  thumbtackEvents: defineTable({
    eventType: v.string(),
    receivedAt: v.number(),
    outcome: v.union(
      v.literal("lead"),
      v.literal("message"),
      v.literal("duplicate"),
      v.literal("ignored"),
      v.literal("rejected"),
    ),
    body: v.any(),
    note: v.optional(v.string()),
  }).index("by_received", ["receivedAt"]),
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
  // A **Photo** (CONTEXT.md): a picture the owner took at a site, shrunk in
  // the browser to two JPEGs and kept as two files (ADR 0003). The full image
  // is at most 2000px on its long edge and its size is kept here; the
  // thumbnail is at most 400px. `takenAt` is the camera time the original
  // file carried, absent when it carried none, as every iPhone camera shot
  // does; `addedAt` is when it was saved, always. No caption, no tag.
  photos: defineTable({
    siteId: v.id("sites"),
    fullId: v.id("_storage"),
    thumbId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    addedAt: v.number(),
    takenAt: v.optional(v.number()),
  })
    // By upload time within a site, so the Sites list reads a site's newest
    // photo off the index.
    .index("by_site", ["siteId", "addedAt"]),
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
  // A request for payment on one approved proposal (CONTEXT.md, **Invoice**).
  // The site and the customer are copied from the proposal when it is made, so
  // a hub tab and the lists read by index. Money is never stored: it is read
  // from the lines and the rate (lib/invoice-money.ts).
  invoices: defineTable({
    proposalId: v.id("proposals"),
    siteId: v.id("sites"),
    customerId: v.id("customers"),
    kind: v.union(v.literal("deposit"), v.literal("final"), v.literal("typed")),
    // A typed invoice's title; the other two are named by their kind.
    title: v.optional(v.string()),
    state: v.union(v.literal("draft"), v.literal("sent"), v.literal("void")),
    lines: v.array(invoiceLine),
    // Copied from the proposal's frozen tax when the invoice is made, 0 where
    // the proposal charges none (lib/invoice-money.ts, `invoiceTaxRate`).
    taxRate: v.number(),
    // Written by Send, with the frozen block: the count from the `invoice`
    // sequence that `INV-` is printed in front of, and the day it went out,
    // which is also its due date. A draft has neither.
    number: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    frozen: v.optional(frozenInvoice),
    // Written by Void, which keeps the number and the link. The reason is the
    // owner's and never reaches the customer.
    voidedAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
    // The **PDF copy** (CONTEXT.md; ADR 0002): the invoice paper as a file,
    // made the first time someone presses Download, with the paper state it
    // printed. Mark paid, Mark unpaid, Void and Re-send each let it go, and a
    // draft never has one.
    pdfCopy: v.optional(
      v.object({
        storageId: v.id("_storage"),
        paperState: invoicePaperState,
        renderedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_proposal", ["proposalId"])
    .index("by_customer", ["customerId"])
    .index("by_site", ["siteId"])
    .index("by_state_sent", ["state", "sentAt"]),
  // One per Send or Re-send of an invoice (CONTEXT.md, **Invoice link**): the
  // shape of `signingLinks`, kept apart so proposal code reads only its own
  // rows. Only a re-send ends one; Void and Mark paid never do.
  invoiceLinks: defineTable({
    invoiceId: v.id("invoices"),
    token: v.string(),
    sentTo: v.string(),
    sentAt: v.number(),
    email: v.optional(emailOutcome),
    endedAt: v.optional(v.number()),
    endedReason: v.optional(v.literal("resent")),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_token", ["token"]),
  // A **Payment** (CONTEXT.md): that a sent invoice's money arrived, and
  // nothing about how much or how. At most one per invoice, which Mark paid
  // checks before it writes one. Never edited: Mark unpaid deletes the row,
  // and refuses one the app wrote from Stripe. Its presence is what makes the
  // invoice's **Standing** read Paid.
  payments: defineTable({
    invoiceId: v.id("invoices"),
    // The Pacific calendar day the money arrived, `YYYY-MM-DD`
    // (lib/invoice-standing.ts, `pacificDay`).
    receivedOn: v.string(),
    // Who recorded it: the owner by hand, or, once Pay now exists, the app
    // from Stripe.
    source: v.union(v.literal("owner"), v.literal("stripe")),
    // The recorder's sign-in subject, or `stripe`.
    recordedBy: v.string(),
    recordedAt: v.number(),
    // The Stripe payment a `stripe` row came from, so a webhook delivered
    // twice finds the row it already wrote. Nothing writes it yet.
    stripePaymentIntentId: v.optional(v.string()),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_stripe_payment_intent", ["stripePaymentIntentId"]),
  // Counters that run across the whole business, one row per name. `invoice`
  // holds the last Invoice number given; the first is 1001.
  sequences: defineTable({
    name: v.literal("invoice"),
    last: v.number(),
  }).index("by_name", ["name"]),
  // A **Staff member** (CONTEXT.md): one email let into the console, from the
  // moment it is invited. The email, lower-cased, is the one key. The Clerk
  // ids are what Resend invite and Remove undo on Clerk; `clerkUserId` is set
  // on first sign-in, which is what moves the row from invited to Has access.
  // The owner's pinned accounts get a row the same way, with no inviter.
  staff: defineTable({
    email: v.string(),
    invitedAt: v.number(),
    // The inviter's email; empty on a row a first sign-in made.
    invitedBy: v.string(),
    clerkInvitationId: v.optional(v.string()),
    clerkAllowlistId: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    name: v.optional(v.string()),
    firstSeenAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_clerkUserId", ["clerkUserId"]),
  // The business's few settings the owner edits in the app, in one row. Read
  // at render time, so a change reaches every paper without a deploy.
  settings: defineTable({
    // The Zelle address the invoice paper prints; absent until the owner sets
    // one, when the paper prints lib/expand-business.ts's default.
    zelleEmail: v.optional(v.string()),
  }),
  // A **Render pass** (CONTEXT.md; ADR 0002): what the renderer opens the
  // paper with, at `/paper/<token>`. One per render, expiring within minutes
  // and deleted when the render ends, and naming one of two papers: a
  // proposal in the state being rendered, under the signing link it went out
  // under; or an invoice in the paper state being rendered, with the day on
  // its stamp. Reading the paper through one never touches any log.
  renderPasses: defineTable(
    v.union(
      v.object({
        token: v.string(),
        proposalId: v.id("proposals"),
        state: v.union(v.literal("sent"), v.literal("approved")),
        linkId: v.id("signingLinks"),
        expiresAt: v.number(),
      }),
      v.object({
        token: v.string(),
        invoiceId: v.id("invoices"),
        paperState: invoicePaperState,
        // The day on a PAID or VOID stamp: marked unpaid and then paid on
        // another day, the paper is paid again but not the sheet this pass
        // was made for.
        stampDay: v.optional(v.string()),
        expiresAt: v.number(),
      }),
    ),
  ).index("by_token", ["token"]),
  // The view log (ADR 0001): every open of a proposal's signing link.
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
});
