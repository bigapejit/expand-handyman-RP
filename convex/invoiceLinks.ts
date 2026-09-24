import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { invoiceStamp, paymentFor } from "./payments";
import { emailOutcome } from "./schema";
import { zelleEmail } from "./settings";
import { invoiceNumberLabel } from "../lib/invoice-money";
import type { PaperInvoice } from "../lib/invoice-paper";

// An invoice's **Invoice link** (CONTEXT.md): minted by each Send or Re-send
// of an invoice, and answering the public `/sign/<token>` page with the
// invoice paper. Nothing is signed through it, and opening it is never
// logged (ADR 0001 stops at documents and proposals).
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
// stamped from its payment or its Void, with the Zelle address as the
// settings hold it now. A draft has no fixed paper, and gets none here.
export async function fixedInvoicePaperOf(
  ctx: QueryCtx,
  invoice: Doc<"invoices">,
): Promise<PaperInvoice | null> {
  const [zelle, payment] = await Promise.all([
    zelleEmail(ctx),
    paymentFor(ctx, invoice._id),
  ]);
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
    zelleEmail: zelle,
    stamp: invoiceStamp(invoice, payment),
  };
}

// What the customer's invoice link shows: the paper, stamped once paid or
// void, or nothing once the link opens nothing. A query, and the page reports
// no open: nothing is logged.
export const page = query({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<{ paper: PaperInvoice } | null> => {
    const opened = await invoiceStillOpenedBy(ctx, a.token);
    if (!opened) return null;
    const paper = await fixedInvoicePaperOf(ctx, opened.invoice);
    return paper ? { paper } : null;
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
