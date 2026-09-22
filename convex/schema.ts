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
export default defineSchema({
  customers: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    site: v.string(),
  }),
  documents: defineTable({
    customerId: v.id("customers"),
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
    .index("by_customer", ["customerId"]),
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
