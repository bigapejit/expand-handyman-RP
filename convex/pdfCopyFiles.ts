import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { invoiceStamp, paymentFor } from "./payments";
import { invoicePaperState, type InvoicePaperState } from "../lib/invoice-paper";
import { pdfCopyStateFor } from "../lib/pdf-copy";

// The one place that reads a proposal's or an invoice's stored **PDF copy**
// (CONTEXT.md; ADR 0002), ported from FRSG's convex/proposalPdfFiles.ts: the
// file the present state calls for, and how a file is let go of. Kept apart
// from convex/pdfCopies.ts, which renders and serves the file, because the
// lifecycles in convex/proposals.ts and convex/invoices.ts need these answers
// without pulling in the renderer behind them.

export type PdfCopy = NonNullable<Doc<"proposals">["pdfCopy"]>;

// The stored file, only while it is the paper the proposal's state calls for.
// A Sent proposal's file after Approve is the unsigned offer, and handing it
// out as the signed copy would be handing out the wrong document; until the
// signed copy's first Download there is no file to give.
export function currentPdfCopyOf(proposal: Doc<"proposals">): PdfCopy | null {
  const copy = proposal.pdfCopy;
  if (!copy) return null;
  return copy.state === pdfCopyStateFor(proposal.state) ? copy : null;
}

// Every move off the sheet a file was made of lets the file go. For a
// proposal that is every move out of Sent: Withdraw, **Re-send** and Decline
// take the offer back, and **Approve** turns it into a contract whose signed
// copy is a different paper. For an invoice it is Mark paid, Mark unpaid and
// Void, each of which changes the stamp, and a **Re-send**, which is a
// proposal's re-send over again. The bytes are deleted and the row forgets
// them, so a later Download renders the paper as it now stands, and no row
// pins a file nobody will hand out. The caller's own patch follows; this only
// lets go of the file.
export async function discardPdfCopy(
  ctx: MutationCtx,
  paper: Doc<"proposals"> | Doc<"invoices">,
): Promise<void> {
  if (!paper.pdfCopy) return;
  await ctx.storage.delete(paper.pdfCopy.storageId);
  await ctx.db.patch(paper._id, { pdfCopy: undefined });
}

export type InvoicePdfCopy = NonNullable<Doc<"invoices">["pdfCopy"]>;

// Which paper a sent or void invoice is now: sent, or stamped PAID or VOID.
// A draft has no paper to keep, and answers nothing.
export async function invoicePaperStateOf(
  ctx: QueryCtx,
  invoice: Doc<"invoices">,
): Promise<InvoicePaperState | null> {
  if (invoice.state === "draft") return null;
  return invoicePaperState({ stamp: invoiceStamp(invoice, await paymentFor(ctx, invoice._id)) });
}

// An invoice's stored file, only while it is the paper the invoice stands on:
// a file of the unstamped sheet is never handed out once the sheet says PAID.
export async function currentInvoicePdfCopyOf(
  ctx: QueryCtx,
  invoice: Doc<"invoices">,
): Promise<InvoicePdfCopy | null> {
  const copy = invoice.pdfCopy;
  if (!copy) return null;
  return copy.paperState === (await invoicePaperStateOf(ctx, invoice)) ? copy : null;
}

