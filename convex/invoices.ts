import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
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
  sentInvoicePaper,
} from "./invoiceLinks";
import { zelleEmail } from "./settings";
import { mintLinkToken } from "./signingLinks";
import { sendableEmail } from "../lib/customer";
import { Unknown } from "../lib/expand-business";
import {
  depositLine,
  invoiceMoney,
  invoiceNumberLabel,
  invoiceTaxRate,
} from "../lib/invoice-money";
import type { PaperInvoice } from "../lib/invoice-paper";
import { invoiceStanding, isPacificDay } from "../lib/invoice-standing";
import {
  compareInvoiceRows,
  invoiceRowTitle,
  matchesInvoiceFilter,
} from "../lib/invoices";
import { proposalDisplayName } from "../lib/proposal-pricing";
import { signingUrl } from "../lib/signing-link";
import { siteCityLine, siteStreetLine } from "../lib/sites";

// Invoices (CONTEXT.md, **Invoice**): requests for payment that belong to one
// approved proposal. This holds the **Deposit invoice**, which Approve makes
// already sent; the pieces every Send shares: the business-wide number
// sequence and the link with its email; the owner's lists and panel, each row
// with its **Standing**; the staff paper; and **Re-send**.

type FrozenProposal = NonNullable<Doc<"proposals">["frozen"]>;

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
// as sent, so it names what the paper prints.
export async function emailNewInvoiceLink(
  ctx: MutationCtx,
  send: { invoiceId: Id<"invoices">; token: string; senderName: string; now: number },
) {
  const invoice = await ctx.db.get(send.invoiceId);
  const { frozen, number } = invoice ?? {};
  if (!invoice || !frozen || number === undefined)
    throw new Error("Only a sent invoice has a link to email.");
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
  });
}

// Today, as the page says it: a Pacific calendar day, `YYYY-MM-DD`. Asked of
// the page rather than read from the clock here, because a query's result is
// kept until what it read changes, and a day read here would go stale at
// midnight with the page still open.
const today = v.string();

function requireDay(day: string) {
  if (!isPacificDay(day)) throw new Error("Today has to be a day written YYYY-MM-DD.");
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

// The customer page's Invoices tab: every invoice for the customer, newest
// first, drafts and void included. For reading and sending; nothing here
// makes one.
export const forCustomer = query({
  args: { customerId: v.id("customers"), today },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    requireDay(a.today);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_customer", (q) => q.eq("customerId", a.customerId))
      .collect();
    return (await invoiceRows(ctx, invoices, a.today)).sort(
      (x, y) =>
        (y.sentAt ?? y.createdAt) - (x.sentAt ?? x.createdAt) || y.createdAt - x.createdAt,
    );
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
// where Re-send would go now, and every link it has had, newest first, with
// the live one's address to copy.
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
    const customer = await ctx.db.get(invoice.customerId);
    // Two sends in the same millisecond still list newest first.
    const links = (await invoiceLinksFor(ctx, invoice._id)).sort(
      (x, y) => y.sentAt - x.sentAt || y._creationTime - x._creationTime,
    );
    const live = links.find((link) => link.endedAt === undefined);
    return {
      ...row,
      proposalCode: proposal.code,
      proposalName: proposal.name,
      lines: invoice.lines,
      taxRate: invoice.taxRate,
      money: invoiceMoney(invoice.lines, invoice.taxRate),
      // Where Send or Re-send would go now, or null when the customer has no
      // address to send to.
      customerEmail: customer ? sendableEmail(customer.email) : null,
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
    const zelle = await zelleEmail(ctx);
    if (invoice.state !== "draft") {
      const sent = sentInvoicePaper(invoice, zelle);
      return sent ? { ...sent, state: invoice.state } : null;
    }
    const [site, customer, proposal] = await Promise.all([
      ctx.db.get(invoice.siteId),
      ctx.db.get(invoice.customerId),
      proposalOf(ctx, invoice),
    ]);
    return {
      state: invoice.state,
      number: "Draft",
      sentAt: null,
      customerName: customer?.name ?? Unknown,
      site: site
        ? { street: siteStreetLine(site), city: siteCityLine(site) }
        : { street: Unknown, city: "" },
      proposalCode: proposal.code,
      proposalName: proposal.name,
      lines: invoice.lines,
      taxRate: invoice.taxRate,
      zelleEmail: zelle,
    };
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

// Nothing on the invoice moves, not its lines, number or date: only where it
// went. The old link ends as `resent`, so the email it sat in stops opening
// anything, and the letter names the owner who re-sent it. The spec lets a
// void invoice be re-sent too, whatever its standing.
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

// Invoices as every list shows them: the row title, the customer, the amount
// due tax included, and the standing as of `today`. Nothing records a
// payment yet, so only an invoice with nothing due reads Paid; Mark paid is
// what will add a recorded payment here.
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
          { state: invoice.state, sentAt: invoice.sentAt, amountDueCents, paid: false },
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
    name: proposalDisplayName(
      proposal.name,
      frozen.solutions.map((solution) => solution.title),
    ),
  };
}
