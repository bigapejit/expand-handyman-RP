import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
import {
  keepPdfCopy,
  namesById,
  pdfPaperId,
  pdfPaperNamedBy,
  pdfPaperOf,
  pdfPaperRef,
  sameSheet,
  subjectOf,
  type PdfPaper,
  type PdfPaperId,
  type PdfSheet,
  type RenderPage,
} from "./pdfCopyFiles";
import { hasRenderer, renderPageToPdf, type RenderFault } from "./pdfRenderer";
import { pdfSheet } from "./schema";
import { mintLinkToken } from "./signingLinks";

// The **PDF copy** (CONTEXT.md; ADR 0002), ported from FRSG's
// convex/proposalPdf.ts without its Send and Approve scheduling or its email
// hand-off: nothing renders until someone presses Download. The first press
// renders the paper as it now stands and stores it; every later press, the
// owner's or the customer's, gets the same bytes.
//
// One module serves both papers. Each paper, a **Proposal** or an
// **Invoice**, supplies an adapter in convex/pdfCopyFiles.ts that says which
// sheet it stands on, what its file is called and who may read it; a
// proposal's file is kept per state and an approved one's is never replaced,
// and an invoice's is kept per **Paper state**. Everything the two share is
// here, once: the **Render pass**, its minutes and its drop, whether a file
// that lands is kept or let go, and the sentences a Download that cannot be
// served comes back with. A draft of either paper has no file.
//
// The renderer is a browser with no sign-in, so it reads the paper through a
// render pass: a random token for one sheet, minted for one render, expiring
// within minutes and deleted when the render ends. It never opens a signing
// or invoice link; a signing link would log a view (ADR 0001), and nothing
// here writes to any log.
//
// Nothing here throws at a Download that cannot be served, except to someone
// who names a paper by id without being the owner: it answers why, in a
// sentence the button can show.

// How long a render pass opens the paper. Cloudflare gives up on a page at a
// minute and the renderer on Cloudflare at ninety seconds, so a pass still
// standing after this is one whose render never finished.
export const RenderPassTtlMs = 5 * 60_000;

// What a Download that found no file gets back: where the bytes now are, or
// why there are none.
export type PdfDownload =
  | { outcome: "ready"; url: string; filename: string }
  | { outcome: "unavailable"; reason: string };

// Which paper a Download is for, and what its sentences call it.
type Subject = "proposal" | "invoice";

type StoredFile = { url: string; filename: string };

// Where a render leaves things.
type RenderOutcome =
  | { outcome: "rendered" }
  // The file for this sheet already exists; nothing was rendered.
  | { outcome: "kept" }
  // The paper moved off the sheet being rendered before the file landed, and
  // the file was let go.
  | { outcome: "moved" }
  // No such paper, or one in a state with no PDF copy.
  | { outcome: "nothing" }
  | { outcome: "notRendered"; reason: "noRenderer" }
  | { outcome: "fault"; fault: RenderFault | "MISSING_APP_ORIGIN" };

// Download, from every surface that draws the button: the proposal and
// invoice panels and both staff paper pages, where the owner names the paper
// by id, and the top bar of a signing or invoice link, where the customer
// names it by the link's token. It answers where the file is and what to
// call it, or null when there is none for the paper's present state, and the
// button then asks `render`. A ref by id is the owner's alone. Reading it
// writes nothing, so a customer's Download is never a view.
export const download = query({
  args: { paper: pdfPaperRef },
  handler: async (ctx, a): Promise<StoredFile | null> => {
    if (namesById(a.paper)) await requireOwner(ctx);
    const paper = await pdfPaperNamedBy(ctx, a.paper);
    return paper ? fileOf(ctx, paper) : null;
  },
});

// The press that found no file: render the paper once, and hand over
// whichever file its present state now has.
export const render = action({
  args: { paper: pdfPaperRef },
  handler: async (ctx, a): Promise<PdfDownload> => {
    if (namesById(a.paper)) await requireOwner(ctx);
    const subject = subjectOf(a.paper);
    const before = await ctx.runQuery(internal.pdfCopies.downloadRead, a);
    if (!before) return { outcome: "unavailable", reason: Unavailable[subject].gone };
    // Landed since the button last read: nothing to make.
    if (before.file) return { outcome: "ready", ...before.file };
    const result = await renderSheet(ctx, before.paper);
    // Asked again, through the same ref: a link replaced or withdrawn while
    // the paper printed no longer opens it, and is handed nothing.
    const after = await ctx.runQuery(internal.pdfCopies.downloadRead, a);
    if (!after) return { outcome: "unavailable", reason: Unavailable[subject].gone };
    return answer(result, after.file, subject);
  },
});

// The paper a ref opens, named by its id for the render to mint a pass
// against, and its file. No owner check: `render` makes it before it gets
// here, and a ref by id would hand the owner's file to anyone, which is why
// this must stay internal.
export const downloadRead = internalQuery({
  args: { paper: pdfPaperRef },
  handler: async (
    ctx,
    a,
  ): Promise<{ paper: PdfPaperId; file: StoredFile | null } | null> => {
    const paper = await pdfPaperNamedBy(ctx, a.paper);
    return paper ? { paper: paper.id, file: await fileOf(ctx, paper) } : null;
  },
});

// The paper at `/paper/<pass>`, for the renderer, while the pass stands and
// its paper is still on the sheet the pass was minted for: a proposal as its
// customer reads it, or an invoice as its link shows it, stamp and all. A
// query, so opening it writes nothing anywhere.
export const paper = query({
  args: { pass: v.string() },
  handler: async (ctx, a): Promise<RenderPage | null> => {
    const pass = await passFor(ctx, a.pass);
    if (!pass || pass.expiresAt <= Date.now()) return null;
    const found = await pdfPaperOf(ctx, pass);
    return found?.print && sameSheet(found.print.sheet, pass) ? found.page : null;
  },
});

// What minting a pass hands back: nothing when there is no paper to print,
// nothing new when the paper's present state already has a file, or the pass,
// the sheet it prints and what every page is footed with.
type Minted =
  | null
  | { already: true }
  | {
      already: false;
      passId: Id<"renderPasses">;
      token: string;
      sheet: PdfSheet;
      code: string;
    };

// The pass a render opens the paper with, bound to the sheet the paper
// stands on now.
export const mintRenderPass = internalMutation({
  args: { paper: pdfPaperId, token: v.string() },
  handler: async (ctx, a): Promise<Minted> => {
    const paper = await pdfPaperOf(ctx, a.paper);
    if (!paper) return null;
    if (paper.copy) return { already: true };
    if (!paper.print) return null;
    requirePassToken(a.token);
    const { sheet, code } = paper.print;
    const passId = await ctx.db.insert("renderPasses", {
      token: a.token,
      ...sheet,
      expiresAt: Date.now() + RenderPassTtlMs,
    });
    // A render that dies before its `finally` still leaves no pass behind.
    await ctx.scheduler.runAfter(RenderPassTtlMs, internal.pdfCopies.dropRenderPass, { passId });
    return { already: false, passId, token: a.token, sheet, code };
  },
});

export const dropRenderPass = internalMutation({
  args: { passId: v.id("renderPasses") },
  handler: async (ctx, a) => {
    if (await ctx.db.get(a.passId)) await ctx.db.delete(a.passId);
  },
});

// The bytes are in storage; this decides whether the row takes them. Between
// the render's start and now the paper may have moved: a proposal approved
// while its offer was printing, withdrawn and sent again (perhaps as a
// different offer), or re-sent under a new link; an invoice marked paid or
// unpaid, or voided. A file of a sheet the paper no longer stands on is
// deleted rather than kept. So is a second file for a sheet that already has
// one: the first render to land is the record, and for an approved proposal
// it is the record for good. An invoice's **Re-send** lets its file go but
// leaves the sheet as it was, so a file of it that lands afterwards is still
// the paper, and is kept.
export const recordPdfCopy = internalMutation({
  args: { sheet: pdfSheet, storageId: v.id("_storage"), renderedAt: v.number() },
  handler: async (ctx, a): Promise<Recorded> => {
    const paper = await pdfPaperOf(ctx, a.sheet);
    if (!paper?.print || !sameSheet(paper.print.sheet, a.sheet)) {
      await ctx.storage.delete(a.storageId);
      return "discarded";
    }
    if (paper.copy) {
      await ctx.storage.delete(a.storageId);
      return "kept";
    }
    // A file of another sheet, which the move off it should already have let
    // go: superseded, and gone.
    if (paper.held) await ctx.storage.delete(paper.held);
    await keepPdfCopy(ctx, a.sheet, a.storageId, a.renderedAt);
    return "recorded";
  },
});

// One render: mint a pass, have the renderer open the paper through it, and
// offer the bytes to the paper's record, which may decline them.
async function renderSheet(ctx: ActionCtx, id: PdfPaperId): Promise<RenderOutcome> {
  // Asked first and before anything is written: a deployment with no
  // renderer is simply one that does not render, and mints no pass for a page
  // nobody is going to open.
  if (!hasRenderer()) return { outcome: "notRendered", reason: "noRenderer" };
  const origin = appOrigin();
  if (!origin) {
    const what = "proposalId" in id ? `Proposal ${id.proposalId}` : `Invoice ${id.invoiceId}`;
    console.error(`${what} not rendered: no app origin is configured (APP_ORIGIN).`);
    return { outcome: "fault", fault: "MISSING_APP_ORIGIN" };
  }

  // The pass's token comes from the action's real randomness, as a signing
  // link's does; a mutation's generator is seeded.
  const minted = await ctx.runMutation(internal.pdfCopies.mintRenderPass, {
    paper: id,
    token: mintLinkToken(),
  });
  if (minted === null) return { outcome: "nothing" };
  if (minted.already) return { outcome: "kept" };

  try {
    const rendered = await renderPageToPdf({
      url: `${origin}/paper/${minted.token}`,
      code: minted.code,
    });
    if (rendered.outcome !== "rendered") return rendered;
    const storageId = await ctx.storage.store(rendered.blob);
    const recorded = await ctx.runMutation(internal.pdfCopies.recordPdfCopy, {
      sheet: minted.sheet,
      storageId,
      renderedAt: Date.now(),
    });
    return { outcome: RecordedOutcome[recorded] };
  } finally {
    // Used once, whatever became of the render.
    await ctx.runMutation(internal.pdfCopies.dropRenderPass, { passId: minted.passId });
  }
}

// What Download is handed after a render: the file for the paper as it now
// stands, or why there is none.
function answer(result: RenderOutcome, file: StoredFile | null, subject: Subject): PdfDownload {
  if (file) return { outcome: "ready", ...file };
  return { outcome: "unavailable", reason: unavailableReason(result, subject) };
}

async function fileOf(ctx: QueryCtx, paper: PdfPaper): Promise<StoredFile | null> {
  if (!paper.copy) return null;
  const url = await ctx.storage.getUrl(paper.copy.storageId);
  return url ? { url, filename: paper.copy.filename } : null;
}

function requirePassToken(token: string) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("Invalid render pass.");
}

function passFor(ctx: QueryCtx, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return ctx.db
    .query("renderPasses")
    .withIndex("by_token", (q) => q.eq("token", trimmed))
    .unique();
}

// What a paper's record did with a rendered file: took it, let it go because
// the paper had moved on, or let it go because a file was already there.
type Recorded = "recorded" | "discarded" | "kept";

// What the render amounts to, by what became of its file.
const RecordedOutcome = {
  recorded: "rendered",
  kept: "kept",
  discarded: "moved",
} as const satisfies Record<Recorded, string>;

// The sentences that name the paper, one set per subject: a ref that opens
// no paper, said in Download's own words rather than borrowing one of the
// render's; a paper with no PDF copy to make; and one that moved while it
// printed. Approved, most likely, while the offer was printing, or an invoice
// marked paid while its unstamped paper was: the paper as it now stands is
// the next press's to make.
const Unavailable = {
  proposal: {
    gone: "This proposal is not available.",
    none: "Only a sent or approved proposal has a PDF.",
    changed: "This proposal changed while its PDF was being made. Press Download again.",
  },
  invoice: {
    gone: "This invoice is not available.",
    none: "Only a sent or void invoice has a PDF.",
    changed: "This invoice changed while its PDF was being made. Press Download again.",
  },
} as const satisfies Record<Subject, Record<"gone" | "none" | "changed", string>>;

// Why a Download came back empty, in words the person who pressed it can use.
function unavailableReason(result: RenderOutcome, subject: Subject): string {
  switch (result.outcome) {
    case "notRendered":
      return "This deployment does not render PDFs.";
    case "nothing":
      return Unavailable[subject].none;
    case "fault":
      // The free plan's cap: one render every ten seconds, and ten
      // browser-minutes a day, which comes back at midnight UTC. Which of the
      // two it was, Cloudflare doesn't say.
      return result.fault === "HTTP_429"
        ? "Too many PDFs have been made for now. Try again later."
        : "The PDF couldn't be made. Try again in a moment.";
    case "moved":
      return Unavailable[subject].changed;
    default:
      return "The PDF is not available.";
  }
}
