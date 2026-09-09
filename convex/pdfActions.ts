"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOwner } from "./auth";
import { MAX_PDF_BYTES, sha256 } from "../lib/signing";
import { completePdf } from "../lib/pdf";
import { PDFDocument } from "pdf-lib";

export const create = action({
  args: {
    storageId: v.id("_storage"),
    customerId: v.id("customers"),
    title: v.string(),
  },
  handler: async (ctx, a): Promise<string> => {
    await requireOwner(ctx);
    const blob = await ctx.storage.get(a.storageId);
    if (!blob || blob.size > MAX_PDF_BYTES)
      throw new Error("Upload a PDF no larger than 20 MB.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(bytes);
    } catch {
      throw new Error(
        "This PDF is unreadable or password protected. Please upload an unlocked PDF.",
      );
    }
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100)
      throw new Error("Use a PDF with 1–100 pages.");
    return ctx.runMutation(internal.documents.createVerified, {
      customerId: a.customerId,
      title: a.title,
      originalId: a.storageId,
      originalHash: await sha256(bytes),
      pageCount: pdf.getPageCount(),
    });
  },
});

export const finish = action({
  args: {
    token: v.string(),
    attemptId: v.string(),
    storageId: v.id("_storage"),
    userAgent: v.string(),
  },
  handler: async (ctx, a): Promise<void> => {
    const d = await ctx.runQuery(internal.documents.signingData, {
      token: a.token,
    });
    if (!d || d.status === "draft")
      throw new Error("This signing link is no longer available.");
    if (d.status === "signed") return;
    if (!d.intent || d.intent.id !== a.attemptId)
      throw new Error("Signing attempt expired. Please try again.");
    const [original, signed] = await Promise.all([
      ctx.storage.get(d.originalId),
      ctx.storage.get(a.storageId),
    ]);
    if (!original || !signed || signed.size > MAX_PDF_BYTES * 2)
      throw new Error("Signed PDF upload failed. Please try again.");
    const expected = await completePdf(
      new Uint8Array(await original.arrayBuffer()),
      d.fields,
      {
        name: d.intent.name,
        signedAt: d.intent.signedAt,
        documentId: d._id,
        originalHash: d.originalHash,
      },
    );
    const expectedHash = await sha256(expected);
    if (
      expectedHash !==
      (await sha256(new Uint8Array(await signed.arrayBuffer())))
    )
      throw new Error(
        "The signed PDF could not be verified. Please reload and try again.",
      );
    await ctx.runMutation(internal.documents.commitSigned, {
      id: d._id,
      token: a.token,
      attemptId: a.attemptId,
      signedId: a.storageId,
      signedHash: expectedHash,
      userAgent: a.userAgent,
    });
  },
});
