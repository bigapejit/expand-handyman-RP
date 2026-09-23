import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// The one place that reads a proposal's stored **PDF copy** (CONTEXT.md;
// ADR 0002), ported from FRSG's convex/proposalPdfFiles.ts: which paper a
// proposal in a given state would have, and how a file is let go of. Kept apart
// from convex/proposalPdf.ts, which renders and serves the file, because the
// lifecycle in convex/proposals.ts needs these answers without pulling in the
// renderer behind them.

export type PdfCopy = NonNullable<Doc<"proposals">["pdfCopy"]>;
export type PdfCopyState = PdfCopy["state"];

// Which paper a proposal has to print: the offer while it is Sent, the signed
// copy once Approved, and nothing at all as a Draft (nothing is frozen) or once
// Declined (an offer Expand no longer means is not handed out as a file).
export function pdfCopyStateOf(proposal: Doc<"proposals">): PdfCopyState | null {
  if (proposal.state === "sent" || proposal.state === "approved") return proposal.state;
  return null;
}

// The stored file, only while it is the paper the proposal's state calls for.
// A Sent proposal's file after Approve is the unsigned offer, and handing it
// out as the signed copy would be handing out the wrong document; until the
// signed copy's first Download there is no file to give.
export function currentPdfCopyOf(proposal: Doc<"proposals">): PdfCopy | null {
  const copy = proposal.pdfCopy;
  if (!copy) return null;
  return copy.state === pdfCopyStateOf(proposal) ? copy : null;
}

// Withdraw, Re-send and Decline all take the offer back from the customer, and
// the file that was the offer goes with it: the bytes are deleted and the row
// forgets them, so a later Download renders the paper as it now stands, and a
// declined proposal pins no file nobody can read. The caller's own patch
// follows; this only lets go of the file.
export async function discardPdfCopy(ctx: MutationCtx, proposal: Doc<"proposals">): Promise<void> {
  if (!proposal.pdfCopy) return;
  await ctx.storage.delete(proposal.pdfCopy.storageId);
  await ctx.db.patch(proposal._id, { pdfCopy: undefined });
}
