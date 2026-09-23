import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwner } from "./auth";
import { appOrigin } from "./email";
import { currentPdfCopyOf } from "./pdfCopyFiles";
import { hasRenderer, renderPageToPdf, type RenderFault } from "./pdfRenderer";
import {
  mintLinkToken,
  paperStillOpenedBy,
  sentPaper,
  signingLinksForProposal,
} from "./signingLinks";
import type { PaperProposal } from "../lib/proposal-paper";
import { pdfCopyFilename, pdfCopyStateFor, type PdfCopyState } from "../lib/pdf-copy";

// The **PDF copy** (CONTEXT.md; ADR 0002), ported from FRSG's
// convex/proposalPdf.ts without its Send and Approve scheduling or its email
// hand-off: nothing renders until someone presses Download. The first press
// renders the paper for the proposal's present state and stores it; every
// later press, the owner's or the customer's, gets the same bytes. A Sent file
// goes when the offer does (convex/pdfCopyFiles.ts); an Approved file is
// the signed copy and is never replaced.
//
// The renderer is a browser with no sign-in, so it reads the paper through a
// **Render pass**: a random token for one proposal in one state, minted for one
// render, expiring within minutes and deleted when the render ends. It never
// opens a signing link, which would log a view (ADR 0001), and nothing here
// writes to the view log.
//
// Nothing here throws at a Download that cannot be served: it answers why, in
// a sentence the button can show.

// How long a render pass opens the paper. Cloudflare gives up on a page at a
// minute and the renderer on Cloudflare at ninety seconds, so a pass still
// standing after this is one whose render never finished.
export const RenderPassTtlMs = 5 * 60_000;

// What a Download that found no file gets back: where the bytes now are, or
// why there are none.
export type PdfDownload =
  | { outcome: "ready"; url: string; filename: string }
  | { outcome: "unavailable"; reason: string };

// Where a render leaves things.
type RenderOutcome =
  | { outcome: "rendered" }
  // The file for this state already exists; nothing was rendered.
  | { outcome: "kept" }
  // The proposal left the state being rendered before the file landed, and
  // the file was let go.
  | { outcome: "moved" }
  // No such proposal, or one in a state with no PDF copy.
  | { outcome: "nothing" }
  | { outcome: "notRendered"; reason: "noRenderer" }
  | { outcome: "fault"; fault: RenderFault | "MISSING_APP_ORIGIN" };

// Download for the owner, from the proposal panel and the staff paper page:
// where the file is and what to call it, or null when there is none for the
// proposal's present state, and the button then asks `renderForOwner`.
export const downloadForOwner = query({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    return downloadOf(ctx, await ctx.db.get(a.proposalId));
  },
});

export const renderForOwner = action({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a): Promise<PdfDownload> => {
    await requireOwner(ctx);
    const result = await render(ctx, a.proposalId);
    return answer(result, await ctx.runQuery(internal.pdfCopies.downloadRead, a));
  },
});

// Download for the customer, from the signing page's top bar: the same answer,
// with the signing token as the whole of the reader's authority, and only while
// that link still opens the paper (`paperStillOpenedBy`, the rule the page
// itself reads). A replaced or withdrawn link gets nothing, and a declined
// proposal has no file. Reading it writes nothing, so a Download is never a
// view.
export const downloadForCustomer = query({
  args: { token: v.string() },
  handler: async (ctx, a) =>
    downloadOf(ctx, (await paperStillOpenedBy(ctx, a.token))?.proposal ?? null),
});

export const renderForCustomer = action({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<PdfDownload> => {
    const proposalId = await ctx.runQuery(internal.pdfCopies.proposalOpenedBy, {
      token: a.token,
    });
    if (!proposalId) return { outcome: "unavailable", reason: NotAvailable };
    const result = await render(ctx, proposalId);
    // Asked again: a link replaced or withdrawn while the paper printed no
    // longer opens it, and is handed nothing.
    const after = await ctx.runQuery(internal.pdfCopies.customerDownloadRead, a);
    if (!after) return { outcome: "unavailable", reason: NotAvailable };
    return answer(result, after.file);
  },
});

export const customerDownloadRead = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const opened = await paperStillOpenedBy(ctx, a.token);
    return opened ? { file: await downloadOf(ctx, opened.proposal) } : null;
  },
});

export const proposalOpenedBy = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<Id<"proposals"> | null> =>
    (await paperStillOpenedBy(ctx, a.token))?.proposal._id ?? null,
});

// The paper at `/paper/<pass>`, for the renderer: the proposal as its customer
// reads it, while the pass stands and the proposal is still in the state the
// pass was minted for. A query, so opening it writes nothing anywhere.
export const paper = query({
  args: { pass: v.string() },
  handler: async (ctx, a): Promise<PaperProposal | null> => {
    const pass = await passFor(ctx, a.pass);
    if (!pass || pass.expiresAt <= Date.now()) return null;
    const proposal = await ctx.db.get(pass.proposalId);
    if (!proposal || !(await paperStillMeant(ctx, proposal, pass))) return null;
    return sentPaper(proposal);
  },
});

// What Download is handed after a render: the file for the proposal as it now
// stands, or why there is none.
function answer(
  result: RenderOutcome,
  file: { url: string; filename: string } | null,
): PdfDownload {
  if (file) return { outcome: "ready", ...file };
  return { outcome: "unavailable", reason: unavailableReason(result) };
}

async function render(ctx: ActionCtx, proposalId: Id<"proposals">): Promise<RenderOutcome> {
  // Asked first and before anything is written: a deployment with no
  // renderer is simply one that does not render, and mints no pass for a page
  // nobody is going to open.
  if (!hasRenderer()) return { outcome: "notRendered", reason: "noRenderer" };
  const origin = appOrigin();
  if (!origin) {
    console.error(`Proposal ${proposalId} not rendered: no app origin is configured (APP_ORIGIN).`);
    return { outcome: "fault", fault: "MISSING_APP_ORIGIN" };
  }

  // The pass's token comes from the action's real randomness, as a signing
  // link's does; a mutation's generator is seeded.
  const target = await ctx.runMutation(internal.pdfCopies.mintRenderPass, {
    proposalId,
    token: mintLinkToken(),
  });
  if (target === null) return { outcome: "nothing" };
  if (target.already) return { outcome: "kept" };

  try {
    const rendered = await renderPageToPdf({
      url: `${origin}/paper/${target.token}`,
      code: target.code,
    });
    if (rendered.outcome !== "rendered") return rendered;
    const storageId = await ctx.storage.store(rendered.blob);
    const recorded = await ctx.runMutation(internal.pdfCopies.recordPdfCopy, {
      proposalId,
      storageId,
      state: target.state,
      linkId: target.linkId,
      renderedAt: Date.now(),
    });
    return { outcome: RecordedOutcome[recorded] };
  } finally {
    // Used once, whatever became of the render.
    await ctx.runMutation(internal.pdfCopies.dropRenderPass, { passId: target.passId });
  }
}

// What a render needs, and the pass it opens the paper with. Nothing when the
// proposal has no paper to print, and nothing new when its present state
// already has a file.
export const mintRenderPass = internalMutation({
  args: { proposalId: v.id("proposals"), token: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<
    | null
    | { already: true }
    | {
        already: false;
        passId: Id<"renderPasses">;
        token: string;
        state: PdfCopyState;
        linkId: Id<"signingLinks">;
        code: string;
      }
  > => {
    const proposal = await ctx.db.get(a.proposalId);
    if (!proposal?.frozen) return null;
    const state = pdfCopyStateFor(proposal.state);
    if (!state) return null;
    if (proposal.pdfCopy?.state === state) return { already: true };
    const linkId = await paperLinkOf(ctx, proposal);
    if (!linkId) return null;
    if (!/^[A-Za-z0-9_-]{32,}$/.test(a.token)) throw new Error("Invalid render pass.");
    const passId = await ctx.db.insert("renderPasses", {
      token: a.token,
      proposalId: proposal._id,
      state,
      linkId,
      expiresAt: Date.now() + RenderPassTtlMs,
    });
    // A render that dies before its `finally` still leaves no pass behind.
    await ctx.scheduler.runAfter(RenderPassTtlMs, internal.pdfCopies.dropRenderPass, { passId });
    return { already: false, passId, token: a.token, state, linkId, code: proposal.frozen.code };
  },
});

export const dropRenderPass = internalMutation({
  args: { passId: v.id("renderPasses") },
  handler: async (ctx, a) => {
    if (await ctx.db.get(a.passId)) await ctx.db.delete(a.passId);
  },
});

// The bytes are in storage; this decides whether the row takes them. Between
// the render's start and now the proposal may have moved: approved while the
// offer was printing, withdrawn and sent again (perhaps as a different offer),
// or re-sent under a new link. A file of a paper the proposal no longer stands
// on is deleted rather than kept. So is a second file for a
// state that already has one: the first render to land is the record, and for
// an approved proposal it is the record for good.
export const recordPdfCopy = internalMutation({
  args: {
    proposalId: v.id("proposals"),
    storageId: v.id("_storage"),
    state: v.union(v.literal("sent"), v.literal("approved")),
    linkId: v.id("signingLinks"),
    renderedAt: v.number(),
  },
  handler: async (ctx, a): Promise<"recorded" | "discarded" | "kept"> => {
    const proposal = await ctx.db.get(a.proposalId);
    if (!proposal || !(await paperStillMeant(ctx, proposal, a))) {
      await ctx.storage.delete(a.storageId);
      return "discarded";
    }
    if (proposal.pdfCopy?.state === a.state) {
      await ctx.storage.delete(a.storageId);
      return "kept";
    }
    // A file for another state, which Approve's own discard should already
    // have let go: superseded, and gone.
    if (proposal.pdfCopy) await ctx.storage.delete(proposal.pdfCopy.storageId);
    await ctx.db.patch(proposal._id, {
      pdfCopy: { storageId: a.storageId, state: a.state, renderedAt: a.renderedAt },
    });
    return "recorded";
  },
});

export const downloadRead = internalQuery({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => downloadOf(ctx, await ctx.db.get(a.proposalId)),
});

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

// Whether a render begun for one state under one link is still of the paper
// the proposal stands on.
async function paperStillMeant(
  ctx: QueryCtx,
  proposal: Doc<"proposals">,
  render: { state: PdfCopyState; linkId: Id<"signingLinks"> },
): Promise<boolean> {
  return (
    pdfCopyStateFor(proposal.state) === render.state &&
    (await paperLinkOf(ctx, proposal)) === render.linkId
  );
}

async function downloadOf(
  ctx: QueryCtx,
  proposal: Doc<"proposals"> | null,
): Promise<{ url: string; filename: string } | null> {
  if (!proposal?.frozen) return null;
  const copy = currentPdfCopyOf(proposal);
  if (!copy) return null;
  const url = await ctx.storage.getUrl(copy.storageId);
  if (!url) return null;
  return {
    url,
    filename: pdfCopyFilename(proposal.frozen.code, { signed: copy.state === "approved" }),
  };
}

function passFor(ctx: QueryCtx, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return ctx.db
    .query("renderPasses")
    .withIndex("by_token", (q) => q.eq("token", trimmed))
    .unique();
}

// What the render amounts to, by what became of its file.
const RecordedOutcome = {
  recorded: "rendered",
  kept: "kept",
  discarded: "moved",
} as const;

// A token that opens no paper, said in Download's own words rather than
// borrowing one of the render's.
const NotAvailable = "This proposal is not available.";

// Why a Download came back empty, in words the person who pressed it can use.
function unavailableReason(result: RenderOutcome): string {
  switch (result.outcome) {
    case "notRendered":
      return "This deployment does not render PDFs.";
    case "nothing":
      return "Only a sent or approved proposal has a PDF.";
    case "fault":
      // The free plan's cap: one render every ten seconds, and ten
      // browser-minutes a day, which comes back at midnight UTC. Which of the
      // two it was, Cloudflare doesn't say.
      return result.fault === "HTTP_429"
        ? "Too many PDFs have been made for now. Try again later."
        : "The PDF couldn't be made. Try again in a moment.";
    case "moved":
      // Approved, most likely, while the offer was printing: the signed copy
      // is the next press's to make.
      return "This proposal changed while its PDF was being made. Press Download again.";
    default:
      return "The PDF is not available.";
  }
}
