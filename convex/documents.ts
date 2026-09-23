import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner, isOwner } from "./auth";
import { field } from "./schema";
import { parseCustomer } from "../lib/customer";
import {
  CONSENT,
  CONSENT_VERSION,
  signerName,
  validateFields,
  validateSigningSetup,
} from "../lib/signing";

// A document that has been issued carries its own copy of the customer's name
// and site and never reads the customer record again. A draft has no copy yet,
// so it still shows the live customer.
export async function customerDetails(ctx: QueryCtx, d: Doc<"documents">) {
  if (d.customerName !== undefined && d.site !== undefined)
    return { customerName: d.customerName, site: d.site };
  const c = await ctx.db.get(d.customerId);
  return { customerName: c?.name ?? "", site: c?.site ?? "" };
}
export const access = query({
  args: {},
  handler: async (ctx) => ({ owner: await isOwner(ctx) }),
});
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return Promise.all(
      (await ctx.db.query("documents").order("desc").take(500)).map(
        async (d) => ({
          ...d,
          ...(await customerDetails(ctx, d)),
          lastViewedAt:
            (
              await ctx.db
                .query("documentViews")
                .withIndex("by_document_viewer", (q) =>
                  q.eq("documentId", d._id).eq("viewer", "customer"),
                )
                .order("desc")
                .first()
            )?.openedAt ?? d.viewedAt,
          originalId: undefined,
          signedId: undefined,
        }),
      ),
    );
  },
});
// The Dashboard's Documents card: what is out with a customer, the one waiting
// longest first, then the few most recently answered. Opens are counted on the
// current link only, so a withdrawn and reissued document starts unopened.
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const documents = await ctx.db.query("documents").order("desc").take(500);
    const out = await Promise.all(
      documents
        .filter((d) => d.status === "ready" || d.status === "viewed")
        .sort((a, b) => (a.issuedAt ?? 0) - (b.issuedAt ?? 0))
        .map(async (d) => {
          const views = (
            await ctx.db
              .query("documentViews")
              .withIndex("by_document_viewer", (q) =>
                q.eq("documentId", d._id).eq("viewer", "customer"),
              )
              .collect()
          ).filter((view) => view.token === d.token);
          return {
            _id: d._id,
            title: d.title,
            customerName: (await customerDetails(ctx, d)).customerName,
            issuedAt: d.issuedAt,
            // A first view from before the view log existed is one open.
            customerViews: views.length || (d.viewedAt ? 1 : 0),
            lastViewedAt: views.at(-1)?.openedAt ?? d.viewedAt,
          };
        }),
    );
    const decided = await Promise.all(
      documents
        .flatMap((d) =>
          d.status === "signed" || d.status === "declined"
            ? [{ d, decidedAt: (d.signedAt ?? d.declinedAt) as number }]
            : [],
        )
        .sort((a, b) => b.decidedAt - a.decidedAt)
        .slice(0, 8)
        .map(async ({ d, decidedAt }) => ({
          _id: d._id,
          title: d.title,
          customerName: (await customerDetails(ctx, d)).customerName,
          status: d.status as "signed" | "declined",
          decidedAt,
          signerName: d.signerName,
          declineReason: d.declineReason,
        })),
    );
    return { out, decided };
  },
});
export const customers = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return ctx.db.query("customers").order("desc").take(1000);
  },
});
export const addCustomer = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    site: v.string(),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    return ctx.db.insert("customers", parseCustomer(a));
  },
});
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return ctx.storage.generateUploadUrl();
  },
});
export const get = query({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    await requireOwner(ctx);
    const d = await ctx.db.get(id);
    if (!d) return null;
    return {
      ...d,
      ...(await customerDetails(ctx, d)),
      originalId: undefined,
      signedId: undefined,
    };
  },
});
export const saveFields = mutation({
  args: { id: v.id("documents"), fields: v.array(field) },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const d = await ctx.db.get(a.id);
    if (!d || d.status !== "draft")
      throw new Error("Only drafts can be edited.");
    if (a.fields.length) validateFields(a.fields, d.pageCount);
    await ctx.db.patch(d._id, { fields: a.fields });
  },
});
export const issue = mutation({
  args: { id: v.id("documents"), token: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const d = await ctx.db.get(a.id);
    if (!d) throw new Error("Document not found.");
    if (d.status === "signed") throw new Error("Signed documents are locked.");
    if (d.token) return d.token;
    validateSigningSetup(d.fields, d.pageCount, d.ownerSignature);
    if (!/^[a-f0-9]{64}$/.test(a.token))
      throw new Error("Invalid signing link.");
    if (
      await ctx.db
        .query("documents")
        .withIndex("by_token", (q) => q.eq("token", a.token))
        .unique()
    )
      throw new Error("Please generate a new link.");
    await ctx.db.patch(d._id, {
      status: "ready",
      token: a.token,
      issuedAt: Date.now(),
      ...(await customerDetails(ctx, d)),
    });
    return a.token;
  },
});
export const withdraw = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const d = await ctx.db.get(a.id);
    if (!d || d.status === "signed")
      throw new Error("Signed documents are locked.");
    await ctx.db.patch(d._id, {
      status: "draft",
      customerName: undefined,
      site: undefined,
      token: undefined,
      issuedAt: undefined,
      viewedAt: undefined,
      intent: undefined,
      declinedAt: undefined,
      declineReason: undefined,
    });
  },
});
export const forSigner = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const d = await ctx.db
      .query("documents")
      .withIndex("by_token", (q) => q.eq("token", a.token))
      .unique();
    if (!d || d.status === "draft" || !a.token) return null;
    return {
      _id: d._id,
      title: d.title,
      ...(await customerDetails(ctx, d)),
      fields: d.fields,
      pageCount: d.pageCount,
      status: d.status,
      signedAt: d.signedAt,
      signerName: d.signerName,
      signerTitle: d.signerTitle,
      ownerSignature: d.ownerSignature,
      declinedAt: d.declinedAt,
      declineReason: d.declineReason,
      originalHash: d.originalHash,
    };
  },
});
export const opened = mutation({
  args: { token: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const d = await ctx.db
      .query("documents")
      .withIndex("by_token", (q) => q.eq("token", a.token))
      .unique();
    if (!d || d.status === "draft" || !a.token) return null;
    const now = Date.now();
    const viewer = (await isOwner(ctx)) ? "owner" : "customer";
    const viewId = await ctx.db.insert("documentViews", {
      documentId: d._id,
      token: a.token,
      viewer,
      documentStatus: d.status,
      openedAt: now,
      lastSeenAt: now,
      viewedMs: 0,
      userAgent: a.userAgent?.slice(0, 500),
    });
    if (viewer === "customer" && d.status === "ready")
      await ctx.db.patch(d._id, { status: "viewed", viewedAt: now });
    return viewId;
  },
});
const seenArgs = { viewId: v.id("documentViews"), token: v.string() };
// Heartbeats arrive every 20 seconds while the tab is visible. A longer gap since
// the last one means the tab was hidden, and that time is not counted as reading.
export const MAX_SEEN_STEP = 30_000;
async function touchView(
  ctx: MutationCtx,
  a: { viewId: Id<"documentViews">; token: string },
) {
  const view = await ctx.db.get(a.viewId);
  if (!view || view.token !== a.token) return;
  const now = Date.now();
  const gap = now - view.lastSeenAt;
  if (gap <= 0) return;
  await ctx.db.patch(view._id, {
    lastSeenAt: now,
    viewedMs: view.viewedMs + (gap <= MAX_SEEN_STEP ? gap : 0),
  });
}
export const seen = mutation({
  args: seenArgs,
  handler: (ctx, a) => touchView(ctx, a),
});
export const recordSeen = internalMutation({
  args: seenArgs,
  handler: (ctx, a) => touchView(ctx, a),
});
export const views = query({
  args: { id: v.id("documents") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const d = await ctx.db.get(a.id);
    if (!d) return [];
    return (
      await ctx.db
        .query("documentViews")
        .withIndex("by_document", (q) => q.eq("documentId", a.id))
        .order("desc")
        .take(500)
    ).map((row) => ({ ...row, previousLink: row.token !== d.token }));
  },
});
export const beginSigning = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    title: v.optional(v.string()),
    consent: v.boolean(),
    attemptId: v.string(),
  },
  handler: async (ctx, a) => {
    const d = await ctx.db
      .query("documents")
      .withIndex("by_token", (q) => q.eq("token", a.token))
      .unique();
    if (!d || d.status === "draft")
      throw new Error("This signing link is no longer available.");
    if (d.status === "signed")
      throw new Error(
        "This document has already been signed. Refresh to download it.",
      );
    if (d.status === "declined")
      throw new Error("This document has been declined.");
    if (!a.consent) throw new Error("Please confirm your consent to sign.");
    const name = signerName(a.name);
    const title = (a.title ?? "").trim();
    if (title.length > 100 || /[\x00-\x1f]/.test(title))
      throw new Error("Use a title under 100 characters.");
    if (a.attemptId.length < 20 || a.attemptId.length > 100)
      throw new Error("Invalid signing attempt.");
    if (d.intent && Date.now() - d.intent.signedAt < 600_000) {
      if (
        d.intent.name !== name ||
        d.intent.id !== a.attemptId ||
        (d.intent.title ?? "") !== title
      )
        throw new Error(
          "A signing attempt is already in progress. Retry in this tab or wait 10 minutes.",
        );
      return { ...d.intent, uploadUrl: await ctx.storage.generateUploadUrl() };
    }
    const intent = { id: a.attemptId, name, title, signedAt: Date.now() };
    await ctx.db.patch(d._id, { intent });
    return { ...intent, uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const signingData = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) =>
    ctx.db
      .query("documents")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique(),
});
export const fileAccess = internalQuery({
  args: {
    id: v.id("documents"),
    token: v.optional(v.string()),
    signed: v.boolean(),
  },
  handler: async (ctx, a) => {
    const d = await ctx.db.get(a.id);
    if (!d) return null;
    if (a.token) {
      if (d.token !== a.token || d.status === "draft") return null;
    } else {
      await requireOwner(ctx);
    }
    return { storageId: a.signed ? d.signedId : d.originalId, title: d.title };
  },
});
export const createVerified = internalMutation({
  args: {
    customerId: v.id("customers"),
    title: v.string(),
    originalId: v.id("_storage"),
    originalHash: v.string(),
    pageCount: v.number(),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    if (!(await ctx.db.get(a.customerId)))
      throw new Error("Customer not found.");
    if (!a.title.trim() || a.title.length > 200)
      throw new Error("Enter a document title under 200 characters.");
    return ctx.db.insert("documents", {
      ...a,
      title: a.title.trim(),
      fields: [],
      status: "draft",
    });
  },
});
export const commitSigned = internalMutation({
  args: {
    id: v.id("documents"),
    token: v.string(),
    attemptId: v.string(),
    signedId: v.id("_storage"),
    signedHash: v.string(),
    userAgent: v.string(),
  },
  handler: async (ctx, a) => {
    const d = await ctx.db.get(a.id);
    if (
      !d ||
      d.token !== a.token ||
      d.status === "draft" ||
      d.status === "declined"
    )
      throw new Error("This signing link was withdrawn.");
    if (d.status === "signed") return { duplicate: true };
    if (d.intent?.id !== a.attemptId)
      throw new Error("Signing attempt expired. Please try again.");
    await ctx.db.patch(d._id, {
      status: "signed",
      signedId: a.signedId,
      signedHash: a.signedHash,
      signerName: d.intent.name,
      signerTitle: d.intent.title,
      signedAt: d.intent.signedAt,
      consent: CONSENT,
      consentVersion: CONSENT_VERSION,
      userAgent: a.userAgent.slice(0, 500),
    });
    return { duplicate: false };
  },
});

export const applyOwnerSignature = mutation({
  args: { id: v.id("documents"), name: v.string(), consent: v.boolean() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const d = await ctx.db.get(a.id);
    if (!d || d.status !== "draft")
      throw new Error("Only drafts can be signed by the owner.");
    if (!a.consent)
      throw new Error("Confirm that you are applying your own signature.");
    const ownerSignature = { name: signerName(a.name), signedAt: Date.now() };
    await ctx.db.patch(d._id, { ownerSignature });
    return ownerSignature;
  },
});

export const decline = mutation({
  args: { token: v.string(), reason: v.string() },
  handler: async (ctx, a) => {
    const d = await ctx.db
      .query("documents")
      .withIndex("by_token", (q) => q.eq("token", a.token))
      .unique();
    if (!d || d.status === "draft")
      throw new Error("This link is no longer live.");
    if (d.status === "signed") throw new Error("Signed documents are locked.");
    if (d.status === "declined") return;
    if (a.reason.length > 1000)
      throw new Error("Keep your reason under 1,000 characters.");
    await ctx.db.patch(d._id, {
      status: "declined",
      declinedAt: Date.now(),
      declineReason: a.reason.trim(),
      intent: undefined,
    });
  },
});
