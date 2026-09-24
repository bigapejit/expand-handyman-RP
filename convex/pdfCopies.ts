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
import { fixedInvoicePaperOf, invoiceStillOpenedBy } from "./invoiceLinks";
import { currentInvoicePdfCopyOf, currentPdfCopyOf } from "./pdfCopyFiles";
import { hasRenderer, renderPageToPdf, type RenderFault } from "./pdfRenderer";
import { invoicePaperState as invoicePaperStateValidator } from "./schema";
import {
  mintLinkToken,
  paperStillOpenedBy,
  sentPaper,
  signingLinksForProposal,
} from "./signingLinks";
import { invoiceNumberLabel } from "../lib/invoice-money";
import {
  invoicePaperState,
  type InvoicePaperState,
  type PaperInvoice,
} from "../lib/invoice-paper";
import type { PaperProposal } from "../lib/proposal-paper";
import {
  invoicePdfCopyFilename,
  pdfCopyFilename,
  pdfCopyStateFor,
  type PdfCopyState,
} from "../lib/pdf-copy";

// The **PDF copy** (CONTEXT.md; ADR 0002), ported from FRSG's
// convex/proposalPdf.ts without its Send and Approve scheduling or its email
// hand-off: nothing renders until someone presses Download. The first press
// renders the paper as it now stands and stores it; every later press, the
// owner's or the customer's, gets the same bytes.
//
// Two papers have one. A proposal's is kept per state: a Sent file goes when
// the offer does (convex/pdfCopyFiles.ts), and an Approved file is the signed
// copy and is never replaced. An invoice's is kept per **paper state**, sent,
// paid or void, and Mark paid, Mark unpaid, Void and Re-send each let it go
// (convex/invoices.ts). A draft of either has none.
//
// The renderer is a browser with no sign-in, so it reads the paper through a
// **Render pass**: a random token for one proposal in one state, or one
// invoice in one paper state, minted for one render, expiring within minutes
// and deleted when the render ends. It never opens a signing or invoice link;
// a signing link would log a view (ADR 0001), and nothing here writes to any
// log.
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

// Which paper a Download is for, and what its sentences call it.
type Subject = "proposal" | "invoice";

// Where a render leaves things.
type RenderOutcome =
  | { outcome: "rendered" }
  // The file for this state already exists; nothing was rendered.
  | { outcome: "kept" }
  // The paper moved off the state being rendered before the file landed, and
  // the file was let go.
  | { outcome: "moved" }
  // No such paper, or one in a state with no PDF copy.
  | { outcome: "nothing" }
  | { outcome: "notRendered"; reason: "noRenderer" }
  | { outcome: "fault"; fault: RenderFault | "MISSING_APP_ORIGIN" };

type StoredFile = { url: string; filename: string };

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
    const result = await renderProposal(ctx, a.proposalId);
    return answer(result, await ctx.runQuery(internal.pdfCopies.downloadRead, a), "proposal");
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
    if (!proposalId) return { outcome: "unavailable", reason: NotAvailable.proposal };
    const result = await renderProposal(ctx, proposalId);
    // Asked again: a link replaced or withdrawn while the paper printed no
    // longer opens it, and is handed nothing.
    const after = await ctx.runQuery(internal.pdfCopies.customerDownloadRead, a);
    if (!after) return { outcome: "unavailable", reason: NotAvailable.proposal };
    return answer(result, after.file, "proposal");
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

// Download of an invoice for the owner, from the invoice panel and the staff
// paper page: the file for the invoice's present paper state, or null, and the
// button then asks `renderInvoiceForOwner`.
export const invoiceDownloadForOwner = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    return invoiceDownloadOf(ctx, await ctx.db.get(a.invoiceId));
  },
});

export const renderInvoiceForOwner = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a): Promise<PdfDownload> => {
    await requireOwner(ctx);
    const result = await renderInvoice(ctx, a.invoiceId);
    return answer(
      result,
      await ctx.runQuery(internal.pdfCopies.invoiceDownloadRead, a),
      "invoice",
    );
  },
});

// Download of an invoice for the customer, from the invoice link's top bar,
// with the link's token as the whole of their authority and only while it
// still opens the paper (`invoiceStillOpenedBy`, the rule the page reads): a
// link a re-send replaced gets nothing. Nothing about it is logged.
export const invoiceDownloadForCustomer = query({
  args: { token: v.string() },
  handler: async (ctx, a) =>
    invoiceDownloadOf(ctx, (await invoiceStillOpenedBy(ctx, a.token))?.invoice ?? null),
});

export const renderInvoiceForCustomer = action({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<PdfDownload> => {
    const invoiceId = await ctx.runQuery(internal.pdfCopies.invoiceOpenedBy, {
      token: a.token,
    });
    if (!invoiceId) return { outcome: "unavailable", reason: NotAvailable.invoice };
    const result = await renderInvoice(ctx, invoiceId);
    // Asked again: a link a re-send replaced while the paper printed no longer
    // opens it, and is handed nothing.
    const after = await ctx.runQuery(internal.pdfCopies.invoiceCustomerDownloadRead, a);
    if (!after) return { outcome: "unavailable", reason: NotAvailable.invoice };
    return answer(result, after.file, "invoice");
  },
});

export const invoiceCustomerDownloadRead = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const opened = await invoiceStillOpenedBy(ctx, a.token);
    return opened ? { file: await invoiceDownloadOf(ctx, opened.invoice) } : null;
  },
});

export const invoiceOpenedBy = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<Id<"invoices"> | null> =>
    (await invoiceStillOpenedBy(ctx, a.token))?.invoice._id ?? null,
});

// The paper at `/paper/<pass>`, for the renderer, while the pass stands and
// its paper is still the one the pass was minted for: a proposal as its
// customer reads it, or an invoice as its link shows it, stamp and all. A
// query, so opening it writes nothing anywhere.
export const paper = query({
  args: { pass: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<
    | { subject: "proposal"; paper: PaperProposal }
    | { subject: "invoice"; paper: PaperInvoice }
    | null
  > => {
    const pass = await passFor(ctx, a.pass);
    if (!pass || pass.expiresAt <= Date.now()) return null;
    if ("invoiceId" in pass) {
      const invoice = await ctx.db.get(pass.invoiceId);
      const paper = invoice ? await fixedInvoicePaperOf(ctx, invoice) : null;
      if (!paper || !invoicePaperStillMeant(paper, pass)) return null;
      return { subject: "invoice", paper };
    }
    const proposal = await ctx.db.get(pass.proposalId);
    if (!proposal || !(await paperStillMeant(ctx, proposal, pass))) return null;
    const sent = sentPaper(proposal);
    return sent ? { subject: "proposal", paper: sent } : null;
  },
});

// What Download is handed after a render: the file for the paper as it now
// stands, or why there is none.
function answer(result: RenderOutcome, file: StoredFile | null, subject: Subject): PdfDownload {
  if (file) return { outcome: "ready", ...file };
  return { outcome: "unavailable", reason: unavailableReason(result, subject) };
}

// What minting a pass hands back: nothing when there is no paper to print,
// nothing new when the paper's present state already has a file, or the pass
// and what the render must carry to the record.
type Minted<Target> =
  | null
  | { already: true }
  | ({ already: false; passId: Id<"renderPasses">; token: string; code: string } & Target);

// One render of either paper: mint a pass, have the renderer open the paper
// through it, and offer the bytes to the paper's record, which may decline
// them. The two subjects differ only in how a pass is minted and a file
// recorded.
async function render<Target>(
  ctx: ActionCtx,
  // Named in the log when the deployment names no origin.
  what: string,
  mint: (token: string) => Promise<Minted<Target>>,
  record: (
    target: Target,
    storageId: Id<"_storage">,
    renderedAt: number,
  ) => Promise<keyof typeof RecordedOutcome>,
): Promise<RenderOutcome> {
  // Asked first and before anything is written: a deployment with no
  // renderer is simply one that does not render, and mints no pass for a page
  // nobody is going to open.
  if (!hasRenderer()) return { outcome: "notRendered", reason: "noRenderer" };
  const origin = appOrigin();
  if (!origin) {
    console.error(`${what} not rendered: no app origin is configured (APP_ORIGIN).`);
    return { outcome: "fault", fault: "MISSING_APP_ORIGIN" };
  }

  // The pass's token comes from the action's real randomness, as a signing
  // link's does; a mutation's generator is seeded.
  const target = await mint(mintLinkToken());
  if (target === null) return { outcome: "nothing" };
  if (target.already) return { outcome: "kept" };

  try {
    const rendered = await renderPageToPdf({
      url: `${origin}/paper/${target.token}`,
      code: target.code,
    });
    if (rendered.outcome !== "rendered") return rendered;
    const storageId = await ctx.storage.store(rendered.blob);
    return { outcome: RecordedOutcome[await record(target, storageId, Date.now())] };
  } finally {
    // Used once, whatever became of the render.
    await ctx.runMutation(internal.pdfCopies.dropRenderPass, { passId: target.passId });
  }
}

function renderProposal(ctx: ActionCtx, proposalId: Id<"proposals">): Promise<RenderOutcome> {
  return render(
    ctx,
    `Proposal ${proposalId}`,
    (token) => ctx.runMutation(internal.pdfCopies.mintRenderPass, { proposalId, token }),
    (target, storageId, renderedAt) =>
      ctx.runMutation(internal.pdfCopies.recordPdfCopy, {
        proposalId,
        storageId,
        state: target.state,
        linkId: target.linkId,
        renderedAt,
      }),
  );
}

function renderInvoice(ctx: ActionCtx, invoiceId: Id<"invoices">): Promise<RenderOutcome> {
  return render(
    ctx,
    `Invoice ${invoiceId}`,
    (token) => ctx.runMutation(internal.pdfCopies.mintInvoiceRenderPass, { invoiceId, token }),
    (target, storageId, renderedAt) =>
      ctx.runMutation(internal.pdfCopies.recordInvoicePdfCopy, {
        invoiceId,
        storageId,
        paperState: target.paperState,
        stampDay: target.stampDay,
        renderedAt,
      }),
  );
}

// What a proposal's render needs, and the pass it opens the paper with.
export const mintRenderPass = internalMutation({
  args: { proposalId: v.id("proposals"), token: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<Minted<{ state: PdfCopyState; linkId: Id<"signingLinks"> }>> => {
    const proposal = await ctx.db.get(a.proposalId);
    if (!proposal?.frozen) return null;
    const state = pdfCopyStateFor(proposal.state);
    if (!state) return null;
    if (proposal.pdfCopy?.state === state) return { already: true };
    const linkId = await paperLinkOf(ctx, proposal);
    if (!linkId) return null;
    requirePassToken(a.token);
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

// What an invoice's render needs: the pass, bound to the invoice's present
// paper state and to its last change, and the invoice number every sheet is
// footed with. Nothing for a draft, which has no paper to keep.
export const mintInvoiceRenderPass = internalMutation({
  args: { invoiceId: v.id("invoices"), token: v.string() },
  handler: async (
    ctx,
    a,
  ): Promise<Minted<InvoicePrint>> => {
    const invoice = await ctx.db.get(a.invoiceId);
    const paper = invoice ? await fixedInvoicePaperOf(ctx, invoice) : null;
    if (!invoice || !paper) return null;
    const print = invoicePrintOf(paper);
    if (invoice.pdfCopy?.paperState === print.paperState) return { already: true };
    requirePassToken(a.token);
    const passId = await ctx.db.insert("renderPasses", {
      token: a.token,
      invoiceId: invoice._id,
      ...print,
      expiresAt: Date.now() + RenderPassTtlMs,
    });
    await ctx.scheduler.runAfter(RenderPassTtlMs, internal.pdfCopies.dropRenderPass, { passId });
    return {
      already: false,
      passId,
      token: a.token,
      ...print,
      code: paper.number,
    };
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
  handler: async (ctx, a): Promise<keyof typeof RecordedOutcome> => {
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

// The invoice's half of the same decision. The invoice may have been marked
// paid or unpaid, or voided, while its paper printed; each of those lets a
// stored file go, and a file that lands after one of them is of a paper the
// invoice no longer stands on, so it goes too. A re-send lets the file go but
// leaves the sheet as it was, so a file of it that lands afterwards is still
// the paper, and is kept.
export const recordInvoicePdfCopy = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    storageId: v.id("_storage"),
    paperState: invoicePaperStateValidator,
    stampDay: v.optional(v.string()),
    renderedAt: v.number(),
  },
  handler: async (ctx, a): Promise<keyof typeof RecordedOutcome> => {
    const invoice = await ctx.db.get(a.invoiceId);
    const paper = invoice ? await fixedInvoicePaperOf(ctx, invoice) : null;
    if (!invoice || !paper || !invoicePaperStillMeant(paper, a)) {
      await ctx.storage.delete(a.storageId);
      return "discarded";
    }
    if (invoice.pdfCopy?.paperState === a.paperState) {
      await ctx.storage.delete(a.storageId);
      return "kept";
    }
    if (invoice.pdfCopy) await ctx.storage.delete(invoice.pdfCopy.storageId);
    await ctx.db.patch(invoice._id, {
      pdfCopy: { storageId: a.storageId, paperState: a.paperState, renderedAt: a.renderedAt },
    });
    return "recorded";
  },
});

export const downloadRead = internalQuery({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => downloadOf(ctx, await ctx.db.get(a.proposalId)),
});

export const invoiceDownloadRead = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a) => invoiceDownloadOf(ctx, await ctx.db.get(a.invoiceId)),
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

// Which sheet an invoice's paper is: its paper state, and the day on its
// stamp. Two papers in the same state differ only by that day, as when the
// owner marks it unpaid and then paid on another day, so a render is bound to
// both.
type InvoicePrint = { paperState: InvoicePaperState; stampDay?: string };

function invoicePrintOf(paper: PaperInvoice): InvoicePrint {
  const paperState = invoicePaperState(paper);
  return paper.stamp ? { paperState, stampDay: paper.stamp.day } : { paperState };
}

// Whether a render begun for one sheet of an invoice is still of the paper
// the invoice stands on.
function invoicePaperStillMeant(paper: PaperInvoice, render: InvoicePrint): boolean {
  const now = invoicePrintOf(paper);
  return now.paperState === render.paperState && now.stampDay === render.stampDay;
}

async function downloadOf(
  ctx: QueryCtx,
  proposal: Doc<"proposals"> | null,
): Promise<StoredFile | null> {
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

async function invoiceDownloadOf(
  ctx: QueryCtx,
  invoice: Doc<"invoices"> | null,
): Promise<StoredFile | null> {
  if (!invoice || invoice.number === undefined) return null;
  const copy = await currentInvoicePdfCopyOf(ctx, invoice);
  if (!copy) return null;
  const url = await ctx.storage.getUrl(copy.storageId);
  if (!url) return null;
  return {
    url,
    filename: invoicePdfCopyFilename(invoiceNumberLabel(invoice.number), {
      void: copy.paperState === "void",
    }),
  };
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

// What the render amounts to, by what became of its file.
const RecordedOutcome = {
  recorded: "rendered",
  kept: "kept",
  discarded: "moved",
} as const;

// A token that opens no paper, said in Download's own words rather than
// borrowing one of the render's.
const NotAvailable = {
  proposal: "This proposal is not available.",
  invoice: "This invoice is not available.",
} as const satisfies Record<Subject, string>;

// Why a Download came back empty, in words the person who pressed it can use.
function unavailableReason(result: RenderOutcome, subject: Subject): string {
  switch (result.outcome) {
    case "notRendered":
      return "This deployment does not render PDFs.";
    case "nothing":
      return subject === "proposal"
        ? "Only a sent or approved proposal has a PDF."
        : "Only a sent or void invoice has a PDF.";
    case "fault":
      // The free plan's cap: one render every ten seconds, and ten
      // browser-minutes a day, which comes back at midnight UTC. Which of the
      // two it was, Cloudflare doesn't say.
      return result.fault === "HTTP_429"
        ? "Too many PDFs have been made for now. Try again later."
        : "The PDF couldn't be made. Try again in a moment.";
    case "moved":
      // Approved, most likely, while the offer was printing, or an invoice
      // marked paid while its unstamped paper was: the paper as it now stands
      // is the next press's to make.
      return `This ${subject} changed while its PDF was being made. Press Download again.`;
    default:
      return "The PDF is not available.";
  }
}
