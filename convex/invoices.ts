import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mintInvoiceLink } from "./invoiceLinks";
import { Unknown } from "../lib/expand-business";
import {
  depositLine,
  invoiceMoney,
  invoiceNumberLabel,
  invoiceTaxRate,
} from "../lib/invoice-money";

// Invoices (CONTEXT.md, **Invoice**): requests for payment that belong to one
// approved proposal. This holds the **Deposit invoice**, which Approve makes
// already sent, and the pieces every Send shares: the business-wide number
// sequence and the link with its email.

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
async function nextInvoiceNumber(ctx: MutationCtx): Promise<number> {
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
async function emailNewInvoiceLink(
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
