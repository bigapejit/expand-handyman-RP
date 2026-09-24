import { v, type Infer } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { fixedInvoicePaperOf, invoiceStillOpenedBy } from "./invoiceLinks";
import type { pdfSheet } from "./schema";
import { sentPaper } from "./offers";
import { paperStillOpenedBy, signingLinksForProposal } from "./signingLinks";
import {
  invoicePaperState,
  type InvoicePaperState,
  type PaperInvoice,
} from "../lib/invoice-paper";
import type { PaperProposal } from "../lib/proposal-paper";
import { invoicePdfCopyFilename, pdfCopyFilename, pdfCopyStateFor } from "../lib/pdf-copy";

// The two paper adapters behind the **PDF copy** (CONTEXT.md; ADR 0002), ported
// from FRSG's convex/proposalPdfFiles.ts: the one place that knows what a
// proposal's or an invoice's file is kept against, what it is called, which
// sheet a **Render pass** prints, and who may read it. convex/pdfCopies.ts is
// the module that renders and serves the file, and it asks these adapters
// everything that differs between the two papers. They are kept apart from it
// so that the lifecycles in convex/proposals.ts and convex/invoices.ts can call
// `discardPdfCopy` without pulling in the renderer behind it.

// How a Download names its paper. The owner names the proposal or the
// invoice by id; the customer names nothing but the token of their
// **Signing link** or **Invoice link**, which is the whole of their authority.
export const pdfPaperRef = v.union(
  v.object({ proposalId: v.id("proposals") }),
  v.object({ signingToken: v.string() }),
  v.object({ invoiceId: v.id("invoices") }),
  v.object({ invoiceToken: v.string() }),
);
export type PdfPaperRef = Infer<typeof pdfPaperRef>;

// A paper by id, once whoever named it has been let through. A render pass
// and a sheet both fit it as they stand.
export const pdfPaperId = v.union(
  v.object({ proposalId: v.id("proposals") }),
  v.object({ invoiceId: v.id("invoices") }),
);
export type PdfPaperId = Infer<typeof pdfPaperId>;

// The one sheet a render pass prints and a file is kept against
// (convex/schema.ts, `pdfSheet`).
export type PdfSheet = Infer<typeof pdfSheet>;

// What the renderer is shown at `/paper/<pass>`.
export type RenderPage =
  | { subject: "proposal"; paper: PaperProposal }
  | { subject: "invoice"; paper: PaperInvoice };

// One proposal or one invoice as the PDF copy module reads it.
export type PdfPaper = {
  id: PdfPaperId;
  // The sheet it stands on now, and what every page is footed with: the
  // **Proposal ID** or the invoice number. Nothing for a paper with no PDF
  // copy to make: a draft of either, or a declined proposal.
  print: { sheet: PdfSheet; code: string } | null;
  // The stored file, only while it is of the paper's present state, and what
  // it is saved as.
  copy: { storageId: Id<"_storage">; filename: string } | null;
  // Whatever file the row holds, of any state: one of another state is
  // superseded when a new one is kept.
  held: Id<"_storage"> | null;
  page: RenderPage | null;
};

// The paper an id names, with no question asked of who is asking: callers
// ask that first.
export async function pdfPaperOf(ctx: QueryCtx, id: PdfPaperId): Promise<PdfPaper | null> {
  if ("proposalId" in id) {
    const proposal = await ctx.db.get(id.proposalId);
    return proposal ? proposalPdfPaper(ctx, proposal) : null;
  }
  const invoice = await ctx.db.get(id.invoiceId);
  return invoice ? invoicePdfPaper(ctx, invoice) : null;
}

// The paper a Download's ref opens, and the rule for who may read it. An id
// reads the paper; the owner check is the caller's, before it gets here. A
// token reads it only while its link still opens the paper, by the very rule
// the customer's page reads (`paperStillOpenedBy`, `invoiceStillOpenedBy`):
// a replaced or withdrawn link opens nothing, and neither does one link's
// token passed as the other kind.
export async function pdfPaperNamedBy(
  ctx: QueryCtx,
  ref: PdfPaperRef,
): Promise<PdfPaper | null> {
  if ("signingToken" in ref) {
    const opened = await paperStillOpenedBy(ctx, ref.signingToken);
    return opened ? proposalPdfPaper(ctx, opened.proposal) : null;
  }
  if ("invoiceToken" in ref) {
    const opened = await invoiceStillOpenedBy(ctx, ref.invoiceToken);
    return opened ? invoicePdfPaper(ctx, opened.invoice) : null;
  }
  return pdfPaperOf(ctx, ref);
}

// Whether a ref names its paper by id, which only the owner may do.
export function namesById(ref: PdfPaperRef): ref is PdfPaperId {
  return "proposalId" in ref || "invoiceId" in ref;
}

// Which paper a ref is for, and so what Download's sentences call it.
export function subjectOf(ref: PdfPaperRef): "proposal" | "invoice" {
  return "proposalId" in ref || "signingToken" in ref ? "proposal" : "invoice";
}

// Whether two sheets are the same one. Only the fields a sheet is named by
// are compared, so a render pass, which carries its token and expiry beside
// them, compares as the sheet it was minted for. A proposal's link and an
// invoice's stamp day are part of the name: an offer withdrawn and sent again
// is Sent both times but not the same sheet, and nor is an invoice marked
// unpaid and then paid on another day.
export function sameSheet(a: PdfSheet, b: PdfSheet): boolean {
  if ("proposalId" in a)
    return (
      "proposalId" in b &&
      a.proposalId === b.proposalId &&
      a.state === b.state &&
      a.linkId === b.linkId
    );
  return (
    "invoiceId" in b &&
    a.invoiceId === b.invoiceId &&
    a.paperState === b.paperState &&
    a.stampDay === b.stampDay
  );
}

// The row takes the file as its **PDF copy** of the sheet it was printed
// from. Whether it should is the caller's decision, made just before.
export async function keepPdfCopy(
  ctx: MutationCtx,
  sheet: PdfSheet,
  storageId: Id<"_storage">,
  renderedAt: number,
): Promise<void> {
  if ("proposalId" in sheet)
    await ctx.db.patch(sheet.proposalId, {
      pdfCopy: { storageId, state: sheet.state, renderedAt },
    });
  else
    await ctx.db.patch(sheet.invoiceId, {
      pdfCopy: { storageId, paperState: sheet.paperState, renderedAt },
    });
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

// The proposal's adapter. Its file is kept per state: the offer while it is
// Sent, the **Signed copy** once Approved. A Sent proposal's file after
// Approve is the unsigned offer, and handing it out as the signed copy would
// be handing out the wrong document, so until the signed copy's first
// Download there is no file to give. The sheet also names the signing link,
// so a file of an offer never passes for the one sent after it.
async function proposalPdfPaper(ctx: QueryCtx, proposal: Doc<"proposals">): Promise<PdfPaper> {
  const id = { proposalId: proposal._id };
  const { frozen, pdfCopy } = proposal;
  const state = pdfCopyStateFor(proposal.state);
  const linkId = state ? await paperLinkOf(ctx, proposal) : null;
  const sent = sentPaper(proposal);
  return {
    id,
    print:
      frozen && state && linkId ? { sheet: { ...id, state, linkId }, code: frozen.code } : null,
    copy:
      frozen && state && pdfCopy?.state === state
        ? {
            storageId: pdfCopy.storageId,
            filename: pdfCopyFilename(frozen.code, { signed: state === "approved" }),
          }
        : null,
    held: pdfCopy?.storageId ?? null,
    page: sent ? { subject: "proposal", paper: sent } : null,
  };
}

// The invoice's adapter. Its file is kept per **Paper state**, sent, paid or
// void, and read wholly from what Send fixed, stamped from its payment or its
// Void: a file of the unstamped sheet is never handed out once the sheet says
// PAID. A draft has no fixed paper, and nothing to keep.
async function invoicePdfPaper(ctx: QueryCtx, invoice: Doc<"invoices">): Promise<PdfPaper> {
  const id = { invoiceId: invoice._id };
  const { pdfCopy } = invoice;
  const paper = await fixedInvoicePaperOf(ctx, invoice);
  const sheet = paper ? { ...id, ...invoiceSheetOf(paper) } : null;
  return {
    id,
    print: paper && sheet ? { sheet, code: paper.number } : null,
    copy:
      paper && sheet && pdfCopy?.paperState === sheet.paperState
        ? {
            storageId: pdfCopy.storageId,
            filename: invoicePdfCopyFilename(paper.number, { void: sheet.paperState === "void" }),
          }
        : null,
    held: pdfCopy?.storageId ?? null,
    page: paper ? { subject: "invoice", paper } : null,
  };
}

// The signing link a proposal's paper went out under: a Sent proposal's live
// link, which Withdraw and Re-send both end, or the link an Approved one was
// signed through. Send and Re-send each mint a new one, so it names the offer
// exactly as the customer was handed it, where the state alone would not tell
// an offer from the one sent after it was withdrawn.
async function paperLinkOf(
  ctx: QueryCtx,
  proposal: Doc<"proposals">,
): Promise<Id<"signingLinks"> | null> {
  if (proposal.state === "approved") return proposal.signature?.signingLinkId ?? null;
  if (proposal.state !== "sent") return null;
  const live = (await signingLinksForProposal(ctx, proposal._id)).find(
    (link) => link.endedAt === undefined,
  );
  return live?._id ?? null;
}

// Which sheet an invoice's paper is: its paper state, and the day on its
// stamp. Two papers in the same state differ only by that day, as when the
// owner marks it unpaid and then paid on another day, so a render is bound to
// both. An unstamped paper has no day, and the field is left off rather than
// set to nothing.
function invoiceSheetOf(paper: PaperInvoice): {
  paperState: InvoicePaperState;
  stampDay?: string;
} {
  const paperState = invoicePaperState(paper);
  return paper.stamp ? { paperState, stampDay: paper.stamp.day } : { paperState };
}
