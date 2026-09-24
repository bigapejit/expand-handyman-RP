import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { invoiceStamp, paymentFor, paymentOnItsWayFor, stripeNoteFor } from "./payments";
import { emailOutcome } from "./schema";
import { zelleTag } from "./settings";
import { ExpandBusiness } from "../lib/expand-business";
import { invoiceMoney, invoiceNumberLabel } from "../lib/invoice-money";
import type { PaperInvoice } from "../lib/invoice-paper";
import { pacificDay } from "../lib/invoice-standing";
import { waysToPay, type PayMethod } from "../lib/pay-now";

// An invoice's **Invoice link** (CONTEXT.md): minted by each Send or Re-send
// of an invoice, and answering the public `/sign/<token>` page with the
// invoice paper. Nothing is signed through it, and opening it is never
// logged (ADR 0001 stops at proposals).
// Like a signing link, the token is the whole access model.

export async function mintInvoiceLink(
  ctx: MutationCtx,
  link: { invoiceId: Id<"invoices">; token: string; sentTo: string; sentAt: number },
): Promise<Id<"invoiceLinks">> {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(link.token)) throw new Error("Invalid invoice link.");
  // Minted fresh for every send and never reused, and never a token a signing
  // link already answers to, since both open at the same address.
  const signing = await ctx.db
    .query("signingLinks")
    .withIndex("by_token", (q) => q.eq("token", link.token))
    .unique();
  if (signing !== null || (await invoiceLinkForToken(ctx, link.token)) !== null)
    throw new Error("Please try sending again.");
  return ctx.db.insert("invoiceLinks", link);
}

// Every link an invoice has had, in no particular order.
export function invoiceLinksFor(ctx: QueryCtx, invoiceId: Id<"invoices">) {
  return ctx.db
    .query("invoiceLinks")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
}

// Ends the invoice's live link, which only a re-send does. The row stays, as
// the record of where the invoice went and how that link finished.
export async function endInvoiceLinks(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  now: number,
) {
  for (const link of await invoiceLinksFor(ctx, invoiceId))
    if (link.endedAt === undefined)
      await ctx.db.patch(link._id, { endedAt: now, endedReason: "resent" });
}

export async function invoiceLinkForToken(ctx: QueryCtx, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return ctx.db
    .query("invoiceLinks")
    .withIndex("by_token", (q) => q.eq("token", trimmed))
    .unique();
}

// The invoice a token still opens onto, or nothing. A link opens its invoice
// until a re-send ends it, whether the invoice is sent or void: Void keeps the
// link, and the paper it opens is stamped VOID. A draft is never linked.
export async function invoiceStillOpenedBy(
  ctx: QueryCtx,
  token: string,
): Promise<{ link: Doc<"invoiceLinks">; invoice: Doc<"invoices"> } | null> {
  const link = await invoiceLinkForToken(ctx, token);
  if (!link || link.endedAt !== undefined) return null;
  const invoice = await ctx.db.get(link.invoiceId);
  if (!invoice || invoice.state === "draft") return null;
  return { link, invoice };
}

// A sent or void invoice as its paper, read wholly from what Send fixed and
// stamped from its earliest payment or its Void, with the Zelle tag as the
// settings hold it now and the mailing address as the business has it. A
// draft has no fixed paper, and gets none here.
export async function fixedInvoicePaperOf(
  ctx: QueryCtx,
  invoice: Doc<"invoices">,
): Promise<PaperInvoice | null> {
  const [zelle, payment] = await Promise.all([zelleTag(ctx), paymentFor(ctx, invoice._id)]);
  return fixedInvoicePaper(invoice, zelle, payment);
}

export function fixedInvoicePaper(
  invoice: Doc<"invoices">,
  zelle: string,
  payment: Pick<Doc<"payments">, "receivedOn"> | null,
): PaperInvoice | null {
  const { frozen, number, sentAt } = invoice;
  if (invoice.state === "draft" || !frozen || number === undefined || sentAt === undefined)
    return null;
  return {
    number: invoiceNumberLabel(number),
    sentAt,
    customerName: frozen.customerName,
    site: frozen.site,
    proposalCode: frozen.proposalCode,
    proposalName: frozen.proposalName,
    lines: invoice.lines,
    taxRate: invoice.taxRate,
    zelleTag: zelle,
    mailingAddress: ExpandBusiness.mailingAddress,
    stamp: invoiceStamp(invoice, payment),
  };
}

// A Stripe payment as the customer's bar tells of it: a bank payment on its
// way, or a **Returned payment** to pay again after. A refund or a lost
// dispute tells the customer nothing: the link is the plain unpaid paper, so
// nothing on it argues with what they asked for.
export type LinkStripeState =
  | { kind: "on_its_way" | "returned"; amountCents: number; acceptedOn: string }
  | null;

export type InvoiceLinkPage = {
  paper: PaperInvoice;
  // The ways the Pay sheet sends to Stripe, bank always and card up to
  // $1,000.00, or none while the invoice owes nothing: not sent, $0 or a
  // credit, paid, or with a payment on its way. Empty, the page shows no Pay
  // button.
  ways: PayMethod[];
  // For the Zelle and check steps, as the paper's How to pay prints them.
  zelleTag: string;
  mailingAddress: string | null;
  invoiceNumber: string;
  amountDueCents: number;
  stripe: LinkStripeState;
};

// What the customer's invoice link shows: the paper, stamped once paid or
// void, and the pay bar under it, or nothing once the link opens nothing. A
// query, and the page reports no open: nothing is logged.
export const page = query({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<InvoiceLinkPage | null> => {
    const opened = await invoiceStillOpenedBy(ctx, a.token);
    if (!opened) return null;
    const { invoice } = opened;
    const paper = await fixedInvoicePaperOf(ctx, invoice);
    if (!paper) return null;
    const { amountDueCents } = invoiceMoney(invoice.lines, invoice.taxRate);
    const sent = invoice.state === "sent";
    const paid = (await paymentFor(ctx, invoice._id)) !== null;
    const onItsWay = sent && !paid ? await paymentOnItsWayFor(ctx, invoice._id) : null;
    // The grey note's payment, which applies only while the invoice owes
    // again; of the three ways money goes back, only a return is told.
    const note = sent && !paid && !onItsWay ? await stripeNoteFor(ctx, invoice) : null;
    const told = onItsWay ?? (note?.status === "returned" ? note : null);
    return {
      paper,
      ways: sent && amountDueCents > 0 && !paid && !onItsWay ? waysToPay(amountDueCents) : [],
      zelleTag: paper.zelleTag,
      mailingAddress: paper.mailingAddress,
      invoiceNumber: paper.number,
      amountDueCents,
      stripe: told
        ? {
            kind: told.status === "on_its_way" ? "on_its_way" : "returned",
            amountCents: told.amountCents,
            acceptedOn: pacificDay(told.acceptedAt),
          }
        : null,
    };
  },
});

// What became of the email that carried the link, written back by the
// scheduled send. It never touches the invoice: the invoice was sent the
// moment its mutation committed.
export const recordEmail = internalMutation({
  args: { linkId: v.id("invoiceLinks"), email: emailOutcome },
  handler: async (ctx, a) => {
    if (await ctx.db.get(a.linkId)) await ctx.db.patch(a.linkId, { email: a.email });
  },
});
