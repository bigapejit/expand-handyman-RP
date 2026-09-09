import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { requireOwner, isOwner } from "./auth";
import { field } from "./schema";
import {
  CONSENT,
  CONSENT_VERSION,
  signerName,
  validateFields,
} from "../lib/signing";

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
          customer: await ctx.db.get(d.customerId),
          originalId: undefined,
          signedId: undefined,
        }),
      ),
    );
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
    if (
      !a.name.trim() ||
      !a.site.trim() ||
      Object.values(a).some((s) => s.length > 500)
    )
      throw new Error("Enter the customer name and site address.");
    return ctx.db.insert("customers", {
      name: a.name.trim(),
      email: a.email.trim(),
      phone: a.phone.trim(),
      site: a.site.trim(),
    });
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
      customer: await ctx.db.get(d.customerId),
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
    validateFields(d.fields, d.pageCount);
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
      token: undefined,
      issuedAt: undefined,
      viewedAt: undefined,
      intent: undefined,
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
    const c = await ctx.db.get(d.customerId);
    return {
      _id: d._id,
      title: d.title,
      customerName: c?.name ?? "",
      site: c?.site ?? "",
      fields: d.fields,
      pageCount: d.pageCount,
      status: d.status,
      signedAt: d.signedAt,
      signerName: d.signerName,
      originalHash: d.originalHash,
    };
  },
});
export const opened = mutation({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const d = await ctx.db
      .query("documents")
      .withIndex("by_token", (q) => q.eq("token", a.token))
      .unique();
    if (d?.status === "ready")
      await ctx.db.patch(d._id, { status: "viewed", viewedAt: Date.now() });
  },
});
export const beginSigning = mutation({
  args: {
    token: v.string(),
    name: v.string(),
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
    if (!a.consent) throw new Error("Please confirm your consent to sign.");
    const name = signerName(a.name);
    if (a.attemptId.length < 20 || a.attemptId.length > 100)
      throw new Error("Invalid signing attempt.");
    if (d.intent && Date.now() - d.intent.signedAt < 600_000) {
      if (d.intent.name !== name || d.intent.id !== a.attemptId)
        throw new Error(
          "A signing attempt is already in progress. Retry in this tab or wait 10 minutes.",
        );
      return { ...d.intent, uploadUrl: await ctx.storage.generateUploadUrl() };
    }
    const intent = { id: a.attemptId, name, signedAt: Date.now() };
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
    if (!d || d.token !== a.token || d.status === "draft")
      throw new Error("This signing link was withdrawn.");
    if (d.status === "signed") return { duplicate: true };
    if (d.intent?.id !== a.attemptId)
      throw new Error("Signing attempt expired. Please try again.");
    await ctx.db.patch(d._id, {
      status: "signed",
      signedId: a.signedId,
      signedHash: a.signedHash,
      signerName: d.intent.name,
      signedAt: d.intent.signedAt,
      consent: CONSENT,
      consentVersion: CONSENT_VERSION,
      userAgent: a.userAgent.slice(0, 500),
    });
    return { duplicate: false };
  },
});
