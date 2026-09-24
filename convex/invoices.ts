import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwner } from "./auth";
import { appOrigin } from "./email";
import {
  endInvoiceLinks,
  invoiceLinksFor,
  mintInvoiceLink,
  fixedInvoicePaperOf,
} from "./invoiceLinks";
import { offerTitle, type FrozenProposal } from "./offers";
import {
  invoiceStamp,
  paymentFor,
  paymentOnItsWayFor,
  paymentsFor,
  stripeNoteFor,
} from "./payments";
import { discardPdfCopy } from "./pdfCopyFiles";
import { invoiceLine } from "./schema";
import { zelleTag } from "./settings";
import { mintLinkToken } from "./signingLinks";
import { sendableEmail } from "../lib/customer";
import { ExpandBusiness, Unknown } from "../lib/expand-business";
import {
  depositLine,
  finalInvoiceLines,
  invoiceMoney,
  invoiceNumberLabel,
  invoiceTaxRate,
  type InvoiceLine,
} from "../lib/invoice-money";
import type { PaperInvoice } from "../lib/invoice-paper";
import { invoiceStanding, isCalendarDay, pacificDay } from "../lib/invoice-standing";
import {
  compareInvoiceRows,
  invoiceRowTitle,
  invoiceSendBlockerMessage,
  invoiceSendBlockers,
  matchesInvoiceFilter,
  newestSentFirst,
  oldestSentFirst,
  type InvoiceSendBlocker,
} from "../lib/invoices";
import { stripePaymentUrl } from "../lib/pay-now";
import { signingUrl } from "../lib/signing-link";
import { siteCityLine, siteStreetLine } from "../lib/sites";

// Invoices (CONTEXT.md, **Invoice**): requests for payment that belong to one
// approved proposal. This holds the **Deposit invoice**, which Approve makes
// already sent; **Job done** and New invoice, which make the final and typed
// invoices as drafts; draft editing, Delete and **Send**; the pieces every
// Send shares: the business-wide number sequence and the link with its email;
// the owner's lists, panel and Dashboard card, each row with its
// **Standing**; the staff paper; **Re-send**; and the two things the owner
// does to a sent invoice afterwards: **Mark paid** (and back) and **Void**.

// The deposit invoice, made in the mutation that records the customer's
// signature: one line for the Deposit they signed for, the rate and the
// frozen block copied from the offer as Send froze it, a number from the
// sequence and a fresh link, its email scheduled beside the approval emails.
// A Deposit of nothing makes nothing. Runs under the customer's link, as
// Approve itself does: nobody at Expand lifts a finger.
export async function makeDepositInvoice(
  ctx: MutationCtx,
  approved: {
    proposal: Doc<"proposals">;
    frozen: FrozenProposal;
    // The proposal's display name, as the signed copy reads it.
    proposalName: string;
    customerId: Id<"customers">;
    token: string;
    now: number;
  },
): Promise<Id<"invoices"> | null> {
  const { proposal, frozen, proposalName, now } = approved;
  const line = depositLine({ ...frozen, name: proposalName });
  if (!line) return null;

  const invoiceId = await ctx.db.insert("invoices", {
    proposalId: proposal._id,
    siteId: proposal.siteId,
    customerId: approved.customerId,
    kind: "deposit",
    state: "sent",
    lines: [line],
    taxRate: invoiceTaxRate(frozen.tax),
    number: await nextInvoiceNumber(ctx),
    sentAt: now,
    frozen: {
      customerName: frozen.customerName,
      site: { street: frozen.site.street, city: frozen.site.city },
      proposalCode: frozen.code,
      proposalName,
      sentTo: frozen.sentTo,
    },
    createdAt: now,
    updatedAt: now,
  });
  await emailNewInvoiceLink(ctx, {
    invoiceId,
    token: approved.token,
    // The Estimator named on the paper the customer just signed.
    senderName: frozen.estimator.name,
    now,
  });
  return invoiceId;
}

// The next **Invoice number**. One counter for the whole business, read and
// bumped in the mutation that sends, so two sends at once are serialized by
// Convex on this row and never share a number, and a number once given is
// never given again. The first is 1001.
export async function nextInvoiceNumber(ctx: MutationCtx): Promise<number> {
  const sequence = await ctx.db
    .query("sequences")
    .withIndex("by_name", (q) => q.eq("name", "invoice"))
    .unique();
  const number = (sequence?.last ?? FirstInvoiceNumber - 1) + 1;
  if (sequence) await ctx.db.patch(sequence._id, { last: number });
  else await ctx.db.insert("sequences", { name: "invoice", last: number });
  return number;
}

const FirstInvoiceNumber = 1001;

// One fresh link to a sent invoice, and the email that carries it, scheduled
// to run once this mutation commits. The letter is written from the invoice
// as sent, so it names what the paper prints, stamp included: a re-sent paid
// or void invoice is not a demand for payment.
export async function emailNewInvoiceLink(
  ctx: MutationCtx,
  send: { invoiceId: Id<"invoices">; token: string; senderName: string; now: number },
) {
  const invoice = await ctx.db.get(send.invoiceId);
  const { frozen, number } = invoice ?? {};
  if (!invoice || !frozen || number === undefined)
    throw new Error("Only a sent invoice has a link to email.");
  const stamp = invoiceStamp(invoice, await paymentFor(ctx, invoice._id));
  const linkId = await mintInvoiceLink(ctx, {
    invoiceId: invoice._id,
    token: send.token,
    sentTo: frozen.sentTo,
    sentAt: send.now,
  });
  await ctx.scheduler.runAfter(0, internal.invoiceEmails.sendInvoiceLink, {
    linkId,
    token: send.token,
    to: frozen.sentTo,
    customerName: frozen.customerName,
    // The letter still reads without a name on the account that sent it.
    senderName:
      send.senderName.trim() && send.senderName !== Unknown
        ? send.senderName.trim()
        : "Your estimator",
    number: invoiceNumberLabel(number),
    siteStreet: frozen.site.street,
    firstLine: invoice.lines[0]?.description ?? "",
    amountDueCents: invoiceMoney(invoice.lines, invoice.taxRate).amountDueCents,
    ...(stamp ? { stamp } : {}),
  });
}

// Today, as the page says it: a Pacific calendar day, `YYYY-MM-DD`. Asked of
// the page rather than read from the clock here, because a query's result is
// kept until what it read changes, and a day read here would go stale at
// midnight with the page still open.
const today = v.string();

function requireDay(day: string) {
  if (!isCalendarDay(day)) throw new Error("Today has to be a day written YYYY-MM-DD.");
}

// The Invoices page: every invoice across every customer, filtered by the
// page's Segmented (lib/invoices.ts) and ordered overdue first, then unpaid,
// newest sent first. Unpaid, Overdue and Paid read only sent invoices, by
// index; All reads every one, drafts and void included. The page searches the
// rows itself.
export const list = query({
  args: {
    filter: v.union(
      v.literal("unpaid"),
      v.literal("overdue"),
      v.literal("paid"),
      v.literal("all"),
    ),
    today,
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    requireDay(a.today);
    const invoices =
      a.filter === "all"
        ? await ctx.db.query("invoices").collect()
        : await ctx.db
            .query("invoices")
            .withIndex("by_state_sent", (q) => q.eq("state", "sent"))
            .collect();
    const rows = await invoiceRows(ctx, invoices, a.today);
    return rows
      .filter((row) => matchesInvoiceFilter(a.filter, row))
      .sort(compareInvoiceRows);
  },
});

// The site page's Invoices tab: every invoice at the site, newest first,
// drafts and void included, read by its index. For reading and sending;
// nothing here makes one.
export const forSite = query({
  args: { siteId: v.id("sites"), today },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    requireDay(a.today);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_site", (q) => q.eq("siteId", a.siteId))
      .collect();
    return (await invoiceRows(ctx, invoices, a.today)).sort(newestSentFirst);
  },
});

// An approved proposal's Invoices section: its own invoices, in the order
// they were made, so the deposit comes first and the final one last. Only an
// approved proposal has any.
export const forProposal = query({
  args: { proposalId: v.id("proposals"), today },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    requireDay(a.today);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_proposal", (q) => q.eq("proposalId", a.proposalId))
      .collect();
    return (await invoiceRows(ctx, invoices, a.today)).sort(
      (x, y) => x.createdAt - y.createdAt,
    );
  },
});

// The invoice panel: one invoice whole, read by the id the page address
// carries, which may be anything a link was typed as, so an id naming no
// invoice opens nothing rather than failing. Its header, its lines and money,
// where Re-send would go now, every link it has had, newest first, with the
// live one's address to copy, and its money as Stripe and the owner recorded
// it: every payment, a bank payment on its way, and the grey note left by
// one that went back.
export const panel = query({
  args: { invoiceId: v.string(), today },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    requireDay(a.today);
    const invoiceId = ctx.db.normalizeId("invoices", a.invoiceId);
    const invoice = invoiceId ? await ctx.db.get(invoiceId) : null;
    if (!invoice) return null;
    const [row] = await invoiceRows(ctx, [invoice], a.today);
    const proposal = await proposalOf(ctx, invoice);
    const payments = await paymentsFor(ctx, invoice._id);
    const onItsWay = await paymentOnItsWayFor(ctx, invoice._id);
    const note = await stripeNoteFor(ctx, invoice);
    // The secret key is read only to know whether the links go to Stripe's
    // test mode; nothing here talks to Stripe.
    const stripeUrl = (paymentIntentId: string) =>
      stripePaymentUrl(paymentIntentId, process.env.STRIPE_SECRET_KEY);
    const customer = await ctx.db.get(invoice.customerId);
    // Two sends in the same millisecond still list newest first.
    const links = (await invoiceLinksFor(ctx, invoice._id)).sort(
      (x, y) => y.sentAt - x.sentAt || y._creationTime - x._creationTime,
    );
    const live = links.find((link) => link.endedAt === undefined);
    const customerEmail = customer ? sendableEmail(customer.email) : null;
    return {
      ...row,
      // A typed invoice's title as stored, for its field; the row title above
      // is what everything else calls the invoice.
      typedTitle: invoice.title ?? null,
      proposalCode: proposal.code,
      proposalName: proposal.name,
      lines: invoice.lines,
      taxRate: invoice.taxRate,
      money: invoiceMoney(invoice.lines, invoice.taxRate),
      // Where Send or Re-send would go now, or null when the customer has no
      // address to send to.
      customerEmail,
      // Why a draft's Send would be refused now, asked exactly as Send asks.
      sendBlockers:
        invoice.state === "draft" ? invoiceSendBlockers(invoice.lines, customerEmail) : [],
      // The earliest payment, the one the paper's stamp carries, and who
      // recorded it: one the app wrote from Stripe cannot be taken back here.
      payment: payments[0]
        ? { receivedOn: payments[0].receivedOn, source: payments[0].source }
        : null,
      // Every payment, earliest first, as the green sentences read them
      // (lib/pay-now.ts, `paidSentence`), each Stripe one with where it lives
      // in Stripe. More than one is money that came twice.
      payments: payments.map((row) => ({
        receivedOn: row.receivedOn,
        source: row.source,
        method: row.method ?? null,
        stripeUrl: row.stripePaymentIntentId ? stripeUrl(row.stripePaymentIntentId) : null,
      })),
      // A bank payment Stripe accepted and the bank has not yet confirmed.
      onItsWay: onItsWay
        ? {
            amountCents: onItsWay.amountCents,
            acceptedOn: pacificDay(onItsWay.acceptedAt),
            stripeUrl: stripeUrl(onItsWay.stripePaymentIntentId),
          }
        : null,
      // Why the invoice is owed again after Stripe had its money, while that
      // still explains it (`stripeNoteFor`).
      note:
        note && note.status !== "on_its_way" && note.status !== "paid"
          ? {
              kind: note.status,
              method: note.method,
              amountCents: note.amountCents,
              acceptedOn: pacificDay(note.acceptedAt),
              endedOn: pacificDay(note.endedAt ?? note.acceptedAt),
              reason: note.reason ?? null,
              customerEmailed: note.customerEmailed ?? null,
              stripeUrl: stripeUrl(note.stripePaymentIntentId),
            }
          : null,
      voidedAt: invoice.voidedAt ?? null,
      voidReason: invoice.voidReason ?? null,
      // Only the live link's token is handed over: it is the one the panel
      // offers to copy, and an ended one opens nothing. The address is built
      // the way the email built it, so the two are the same string; null
      // where this deployment names no origin, and the panel builds it from
      // its own.
      liveToken: live?.token ?? null,
      liveUrl: live ? signingUrl(appOrigin(), live.token) : null,
      links: links.map((link) => ({
        linkId: link._id,
        sentTo: link.sentTo,
        sentAt: link.sentAt,
        email: link.email ?? null,
        endedAt: link.endedAt ?? null,
        endedReason: link.endedReason ?? null,
      })),
    };
  },
});

// The staff paper: any invoice as its **Invoice paper**, for the owner. A
// sent or void invoice is the paper its link shows; a draft is laid out as if
// sent now, with "Draft" where the number goes, from the customer and site as
// they are now and the proposal as signed. A query, so opening it is never
// logged anywhere. The day a draft would be sent is the page's to say, for
// the reason `today` is.
export const paper = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (
    ctx,
    a,
  ): Promise<
    | (Omit<PaperInvoice, "sentAt"> & {
        state: Doc<"invoices">["state"];
        sentAt: number | null;
      })
    | null
  > => {
    await requireOwner(ctx);
    const invoice = await ctx.db.get(a.invoiceId);
    if (!invoice) return null;
    if (invoice.state !== "draft") {
      const sent = await fixedInvoicePaperOf(ctx, invoice);
      return sent ? { ...sent, state: invoice.state } : null;
    }
    const zelle = await zelleTag(ctx);
    return {
      ...(await blockAsItStands(ctx, invoice)),
      state: invoice.state,
      number: "Draft",
      sentAt: null,
      lines: invoice.lines,
      taxRate: invoice.taxRate,
      zelleTag: zelle,
      mailingAddress: ExpandBusiness.mailingAddress,
      stamp: null,
    };
  },
});

// **Job done** (CONTEXT.md), before it is pressed: the lines the final
// invoice would start with and what they come to, so the button can ask first
// when that is nothing or a credit. Null wherever Job done is not offered: on
// a proposal that is not approved, and while its final invoice is a draft or
// sent. A void one does not count, so voiding it brings Job done back.
export const finalPrefill = query({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const proposal = await ctx.db.get(a.proposalId);
    if (!proposal || proposal.state !== "approved" || !proposal.frozen) return null;
    const invoices = await invoicesOnProposal(ctx, proposal._id);
    if (holdsFinalInvoice(invoices)) return null;
    const lines = prefilledFinalLines(proposal, proposal.frozen, invoices);
    return { lines, money: invoiceMoney(lines, invoiceTaxRate(proposal.frozen.tax)) };
  },
});

// Job done: the final invoice raised as a draft, prefilled with the proposal
// at its price before tax less every invoice already sent on it. The proposal
// does not change state. Returns the draft, for the panel to open.
export const jobDone = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a): Promise<Id<"invoices">> => {
    await requireOwner(ctx);
    const { proposal, frozen } = await requireApproved(ctx, a.proposalId);
    const invoices = await invoicesOnProposal(ctx, proposal._id);
    if (holdsFinalInvoice(invoices))
      throw new Error("This proposal already has its final invoice.");
    return insertDraft(ctx, proposal, frozen, {
      kind: "final",
      lines: prefilledFinalLines(proposal, frozen, invoices),
    });
  },
});

// New invoice: an empty **typed invoice** on an approved proposal, for the
// owner to title and write. Any number of them. Returns the draft.
export const createTyped = mutation({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, a): Promise<Id<"invoices">> => {
    await requireOwner(ctx);
    const { proposal, frozen } = await requireApproved(ctx, a.proposalId);
    return insertDraft(ctx, proposal, frozen, { kind: "typed", lines: [] });
  },
});

// One edit of one **Draft invoice**: a typed invoice's title, and the lines,
// stored whole each time, so adding, editing, removing and reordering are all
// the same edit. A line with no description is kept (Send names it). Only a
// draft: Send fixes the lines for good.
export const update = mutation({
  args: {
    invoiceId: v.id("invoices"),
    title: v.optional(v.string()),
    lines: v.optional(v.array(invoiceLine)),
  },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const invoice = await requireDraft(ctx, a.invoiceId, "edited");
    const patch: Partial<Doc<"invoices">> = {};
    if (a.title !== undefined) {
      if (invoice.kind !== "typed")
        throw new Error("Only a typed invoice has a title; the others are named by their kind.");
      // Patching a field to undefined is what removes it: an emptied title
      // puts the invoice back to being called an Invoice.
      patch.title = a.title.trim().slice(0, TitleMaxLength) || undefined;
    }
    if (a.lines !== undefined) patch.lines = storedLines(a.lines);
    await ctx.db.patch(invoice._id, { ...patch, updatedAt: Date.now() });
  },
});

// A draft is disposable: nobody has seen it and it has no number, so deleting
// it leaves nothing behind.
export const remove = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const invoice = await requireDraft(ctx, a.invoiceId, "deleted");
    await ctx.db.delete(invoice._id);
  },
});

// **Send** (CONTEXT.md, **Send (an invoice)**): a draft emailed to the
// customer as a private link. An action only so the token comes from real
// randomness, as a proposal's Send does; everything else lands in one
// mutation, so the number, the frozen block, the link and the email go
// together or not at all.
export const send = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.invoices.sendWithLink, {
      invoiceId: a.invoiceId,
      token: mintLinkToken(),
    });
  },
});

// Takes the next number from the sequence in this same mutation, so two sends
// at once never share one; fixes the customer, the site and the proposal as
// the draft's staff paper showed them, and the address it goes to; mints the
// link and schedules its email, which names the owner who sent it. The email
// is scheduled, never awaited: a Resend outage leaves the invoice sent, with
// its link to copy.
export const sendWithLink = internalMutation({
  args: { invoiceId: v.id("invoices"), token: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const invoice = await requireDraft(ctx, a.invoiceId, "sent");
    const customer = await ctx.db.get(invoice.customerId);
    const sentTo = customer ? sendableEmail(customer.email) : null;
    // Asked again here, whatever the panel said, because a stale panel is
    // exactly how a blank line would otherwise reach a customer.
    refuseSend(invoiceSendBlockers(invoice.lines, sentTo));
    // Refused above; this only tells the type checker so.
    if (sentTo === null) return;
    // The draft's paper can say Unknown for a site that has gone; a sent
    // invoice must never fix that on the customer's copy.
    if (!(await ctx.db.get(invoice.siteId))) throw new Error("Site not found.");

    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    await ctx.db.patch(invoice._id, {
      state: "sent",
      number: await nextInvoiceNumber(ctx),
      sentAt: now,
      frozen: { ...(await blockAsItStands(ctx, invoice)), sentTo },
      updatedAt: now,
    });
    await emailNewInvoiceLink(ctx, {
      invoiceId: invoice._id,
      token: a.token,
      senderName: identity?.name ?? "",
      now,
    });
  },
});

// **Re-send** (CONTEXT.md): a sent invoice emailed again, to the customer's
// current address, with a fresh link. An action only so the token comes from
// real randomness, as Send's does; everything else lands in one mutation.
export const resend = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.invoices.resendWithLink, {
      invoiceId: a.invoiceId,
      token: mintLinkToken(),
    });
  },
});

// Nothing on the invoice moves, not its lines, number, date, payment or Void:
// only where it went. The old link ends as `resent`, so the email it sat in
// stops opening anything, and the letter names the owner who re-sent it. The
// PDF copy goes, as a proposal's does on Re-send. A
// void invoice is re-sent too, whatever its standing: its link opens the
// paper stamped VOID (`invoiceStillOpenedBy`).
export const resendWithLink = internalMutation({
  args: { invoiceId: v.id("invoices"), token: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const invoice = await ctx.db.get(a.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.state === "draft" || !invoice.frozen)
      throw new Error("Only a sent or void invoice can be re-sent.");
    const customer = await ctx.db.get(invoice.customerId);
    const sentTo = customer ? sendableEmail(customer.email) : null;
    if (sentTo === null)
      throw new ConvexError({
        code: "no_email",
        message: "The customer has no email address to send it to.",
      });

    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    await endInvoiceLinks(ctx, invoice._id, now);
    await discardPdfCopy(ctx, invoice);
    await ctx.db.patch(invoice._id, {
      frozen: { ...invoice.frozen, sentTo },
      updatedAt: now,
    });
    await emailNewInvoiceLink(ctx, {
      invoiceId: invoice._id,
      token: a.token,
      senderName: identity?.name ?? "",
      now,
    });
  },
});

// **Mark paid** (CONTEXT.md): the owner recording that a sent invoice's money
// arrived, and on which Pacific day, today unless they say otherwise. Only
// where no payment stands, and never while a bank payment is on its way
// through Stripe, so the record and the money cannot disagree; a void
// invoice owes nothing to record. A credit is marked paid too, once the
// owner has refunded it by hand. The paper is stamped PAID with the day, so
// a PDF copy of the unstamped sheet goes, and nobody is emailed.
export const markPaid = mutation({
  args: { invoiceId: v.id("invoices"), receivedOn: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    // Always there once `requireOwner` has passed; asked again for the type.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Owner access required.");
    const invoice = await ctx.db.get(a.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.state !== "sent") throw new Error("Only a sent invoice can be marked paid.");
    if (await paymentFor(ctx, invoice._id))
      throw new Error("This invoice is already marked paid.");
    if (await paymentOnItsWayFor(ctx, invoice._id)) throw new Error(OnItsWayRefusal);
    const now = Date.now();
    const today = pacificDay(now);
    const receivedOn = a.receivedOn ?? today;
    if (!isCalendarDay(receivedOn))
      throw new Error("The day the money arrived has to be a day written YYYY-MM-DD.");
    // Calendar days written this way sort as they fall.
    if (receivedOn > today) throw new Error("The money can't have arrived after today.");
    await ctx.db.insert("payments", {
      invoiceId: invoice._id,
      receivedOn,
      source: "owner",
      recordedBy: identity.subject,
      recordedAt: now,
    });
    await discardPdfCopy(ctx, invoice);
    await ctx.db.patch(invoice._id, { updatedAt: now });
  },
});

// Mark unpaid: the owner's payment taken back, stamp and all, with the PDF
// copy that bore it, and the invoice reads Unpaid or Overdue again as its sent
// day says. A payment the app recorded from Stripe is money that really
// moved, and is never taken back by hand: only the owner's own row goes, and
// a Stripe payment beside it keeps the invoice Paid.
export const markUnpaid = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const invoice = await ctx.db.get(a.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    const payments = await paymentsFor(ctx, invoice._id);
    if (payments.length === 0) throw new Error("This invoice is not marked paid.");
    const payment = payments.find((row) => row.source === "owner");
    if (!payment)
      throw new Error("This invoice was paid online, so it can't be marked unpaid here.");
    await ctx.db.delete(payment._id);
    await discardPdfCopy(ctx, invoice);
    await ctx.db.patch(invoice._id, { updatedAt: Date.now() });
  },
});

// **Void** (CONTEXT.md): a wrong sent invoice cancelled, with an optional
// reason the customer never sees. Refused while any payment stands, the
// owner's or Stripe's, so taking money off the books is always a step of its
// own, and while a bank payment is on its way, so the record and the money
// cannot disagree. It keeps its number, its
// frozen block and its link, which now opens the paper stamped VOID; its PDF
// copy goes, and nobody is emailed. A void final invoice gives Job done back (`holdsFinalInvoice`),
// and the next final invoice does not take it off (lib/invoice-money.ts).
// Exported as `voidInvoice`, since `void` is a word the language keeps.
export const voidInvoice = mutation({
  args: { invoiceId: v.id("invoices"), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const invoice = await ctx.db.get(a.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.state !== "sent") throw new Error("Only a sent invoice can be voided.");
    const payments = await paymentsFor(ctx, invoice._id);
    if (payments.some((row) => row.source === "stripe"))
      throw new Error("This invoice was paid through Stripe. Refund it in Stripe first to void it.");
    if (payments.length > 0)
      throw new Error("This invoice is marked paid. Mark it unpaid first to void it.");
    if (await paymentOnItsWayFor(ctx, invoice._id)) throw new Error(OnItsWayRefusal);
    const now = Date.now();
    const reason = a.reason?.trim().slice(0, VoidReasonMaxLength);
    await discardPdfCopy(ctx, invoice);
    await ctx.db.patch(invoice._id, {
      state: "void",
      voidedAt: now,
      ...(reason ? { voidReason: reason } : {}),
      updatedAt: now,
    });
  },
});

// The Dashboard's Invoices card, "Owed to you": every sent invoice still
// owed, read by index so drafts and void ones are never scanned, and paid
// ones left out. Overdue oldest first, the longest waited on at the top, then
// Unpaid newest sent first, as the Invoices page orders them, with a payment
// on its way among the unpaid, since it is owed until the bank confirms it;
// and what they come to together. A credit still to refund is owed the other
// way, so it takes its amount off the total.
export const dashboard = query({
  args: { today },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    requireDay(a.today);
    const sent = await ctx.db
      .query("invoices")
      .withIndex("by_state_sent", (q) => q.eq("state", "sent"))
      .collect();
    const rows = await invoiceRows(ctx, sent, a.today);
    const overdue = rows.filter((row) => row.standing === "overdue").sort(oldestSentFirst);
    const unpaid = rows
      .filter((row) => row.standing === "unpaid" || row.standing === "on_its_way")
      .sort(newestSentFirst);
    const owedCents = [...overdue, ...unpaid].reduce((sum, row) => sum + row.amountDueCents, 0);
    return { owedCents, overdue, unpaid };
  },
});

// Invoices as every list shows them: the row title, the customer, the amount
// due tax included, and the standing as of `today`, read from the invoice's
// payments and any bank payment on its way each time and never stored. Only
// a sent invoice can have one, so a draft or void one is not asked.
async function invoiceRows(ctx: QueryCtx, invoices: Doc<"invoices">[], today: string) {
  const customerNames = new Map<Id<"customers">, string>();
  const customerName = async (invoice: Doc<"invoices">) => {
    // A sent invoice is named as it was sent; a draft by the customer now.
    if (invoice.frozen) return invoice.frozen.customerName;
    if (!customerNames.has(invoice.customerId))
      customerNames.set(
        invoice.customerId,
        (await ctx.db.get(invoice.customerId))?.name ?? Unknown,
      );
    return customerNames.get(invoice.customerId) ?? Unknown;
  };
  return Promise.all(
    invoices.map(async (invoice) => {
      const { amountDueCents } = invoiceMoney(invoice.lines, invoice.taxRate);
      const sent = invoice.state === "sent";
      const hasPayment = sent && (await paymentFor(ctx, invoice._id)) !== null;
      const hasPaymentOnItsWay =
        sent && !hasPayment && (await paymentOnItsWayFor(ctx, invoice._id)) !== null;
      return {
        invoiceId: invoice._id,
        customerId: invoice.customerId,
        siteId: invoice.siteId,
        proposalId: invoice.proposalId,
        kind: invoice.kind,
        state: invoice.state,
        number: invoice.number ?? null,
        title: invoiceRowTitle({
          number: invoice.number ?? null,
          kind: invoice.kind,
          title: invoice.title,
        }),
        customerName: await customerName(invoice),
        amountDueCents,
        standing: invoiceStanding(
          {
            state: invoice.state,
            sentAt: invoice.sentAt,
            amountDueCents,
            hasPayment,
            hasPaymentOnItsWay,
          },
          today,
        ),
        sentAt: invoice.sentAt ?? null,
        createdAt: invoice.createdAt,
      };
    }),
  );
}

// The proposal an invoice belongs to, as the invoice names it: its Proposal ID
// and display name as signed. A sent invoice froze both; a draft reads them
// from the proposal, which is approved and so frozen too.
async function proposalOf(ctx: QueryCtx, invoice: Doc<"invoices">) {
  if (invoice.frozen)
    return { code: invoice.frozen.proposalCode, name: invoice.frozen.proposalName };
  const proposal = await ctx.db.get(invoice.proposalId);
  const frozen = proposal?.frozen;
  if (!proposal || !frozen) return { code: Unknown, name: Unknown };
  return {
    code: frozen.code,
    name: offerTitle(proposal, frozen),
  };
}

// What a draft would freeze if it were sent now: the customer and the site as
// they are, and the proposal as signed. The draft's staff paper prints exactly
// this, so what the owner checked is what Send fixes.
async function blockAsItStands(ctx: QueryCtx, invoice: Doc<"invoices">) {
  const [site, customer, proposal] = await Promise.all([
    ctx.db.get(invoice.siteId),
    ctx.db.get(invoice.customerId),
    proposalOf(ctx, invoice),
  ]);
  return {
    customerName: customer?.name ?? Unknown,
    site: site
      ? { street: siteStreetLine(site), city: siteCityLine(site) }
      : { street: Unknown, city: "" },
    proposalCode: proposal.code,
    proposalName: proposal.name,
  };
}

function invoicesOnProposal(ctx: QueryCtx, proposalId: Id<"proposals">) {
  return ctx.db
    .query("invoices")
    .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
    .collect();
}

// One final invoice at a time: a draft or a sent one holds the place, and a
// void one gives it back.
function holdsFinalInvoice(invoices: readonly Doc<"invoices">[]): boolean {
  return invoices.some((invoice) => invoice.kind === "final" && invoice.state !== "void");
}

// The final invoice's lines as Job done starts them (lib/invoice-money.ts),
// the proposal named as the signed copy reads it.
function prefilledFinalLines(
  proposal: Doc<"proposals">,
  frozen: FrozenProposal,
  invoices: readonly Doc<"invoices">[],
): InvoiceLine[] {
  return finalInvoiceLines(
    {
      name: offerTitle(proposal, frozen),
      subtotalCents: frozen.subtotalCents,
    },
    invoices,
  );
}

// Only an approved proposal is invoiced: every invoice sits under Terms the
// customer signed.
async function requireApproved(ctx: MutationCtx, proposalId: Id<"proposals">) {
  const proposal = await ctx.db.get(proposalId);
  if (!proposal) throw new Error("Proposal not found.");
  if (proposal.state !== "approved" || !proposal.frozen)
    throw new Error("Only an approved proposal can be invoiced.");
  return { proposal, frozen: proposal.frozen };
}

// A draft final or typed invoice, copying the site and the customer from the
// proposal so the lists read by index, and the rate from its frozen tax.
async function insertDraft(
  ctx: MutationCtx,
  proposal: Doc<"proposals">,
  frozen: FrozenProposal,
  draft: { kind: "final" | "typed"; lines: InvoiceLine[] },
): Promise<Id<"invoices">> {
  const site = await ctx.db.get(proposal.siteId);
  if (!site) throw new Error("Site not found.");
  const now = Date.now();
  return ctx.db.insert("invoices", {
    proposalId: proposal._id,
    siteId: site._id,
    customerId: site.customerId,
    kind: draft.kind,
    state: "draft",
    lines: draft.lines,
    taxRate: invoiceTaxRate(frozen.tax),
    createdAt: now,
    updatedAt: now,
  });
}

// Send fixes a draft for good, so once an invoice has left Draft nothing may
// still change it or take it away.
async function requireDraft(ctx: MutationCtx, invoiceId: Id<"invoices">, act: string) {
  const invoice = await ctx.db.get(invoiceId);
  if (!invoice) throw new Error("Invoice not found.");
  if (invoice.state !== "draft") throw new Error(`Only a draft invoice can be ${act}.`);
  return invoice;
}

// Lines as stored: whole cents of either sign, descriptions trimmed and cut at
// a length nothing legitimate reaches, and no more of them than any invoice
// has.
function storedLines(lines: readonly InvoiceLine[]): InvoiceLine[] {
  if (lines.length > LinesMax) throw new Error(`An invoice holds at most ${LinesMax} lines.`);
  return lines.map((line) => {
    if (!Number.isSafeInteger(line.cents) || Math.abs(line.cents) > LineMaxCents)
      throw new Error("A line's amount is whole cents, under $10 million either way.");
    return {
      description: line.description.trim().slice(0, DescriptionMaxLength),
      cents: line.cents,
    };
  });
}

// Every reason Send is refused, in one sentence, so fixing one thing is never
// followed by being told the next. The code names the first, for a caller
// that wants to branch.
function refuseSend(blockers: readonly InvoiceSendBlocker[]) {
  if (blockers.length === 0) return;
  throw new ConvexError({
    code: blockers[0],
    blockers: [...blockers],
    message: blockers.map(invoiceSendBlockerMessage).join(" "),
  });
}

// Why Mark paid and Void wait while a bank payment confirms.
const OnItsWayRefusal = "A bank payment is on its way through Stripe. Wait for it to confirm.";

const TitleMaxLength = 200;
const VoidReasonMaxLength = 500;
const DescriptionMaxLength = 500;
const LinesMax = 100;
const LineMaxCents = 999_999_999;
