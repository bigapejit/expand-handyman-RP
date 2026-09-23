import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { pdfCopyStateFor } from "../lib/pdf-copy";

// The one place that reads a proposal's stored **PDF copy** (CONTEXT.md;
// ADR 0002), ported from FRSG's convex/proposalPdfFiles.ts: the file a
// proposal's present state calls for, and how a file is let go of. Kept apart
// from convex/pdfCopies.ts, which renders and serves the file, because the
// lifecycle in convex/proposals.ts needs these answers without pulling in the
// renderer behind them.

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

// Every move out of Sent lets the offer's file go: Withdraw, Re-send and
// Decline take the offer back, and Approve turns it into a contract whose
// signed copy is a different paper. The bytes are deleted and the row forgets
// them, so a later Download renders the paper as it now stands, and no
// proposal pins a file nobody will hand out. The caller's own patch follows;
// this only lets go of the file.
export async function discardPdfCopy(ctx: MutationCtx, proposal: Doc<"proposals">): Promise<void> {
  if (!proposal.pdfCopy) return;
  await ctx.storage.delete(proposal.pdfCopy.storageId);
  await ctx.db.patch(proposal._id, { pdfCopy: undefined });
}
