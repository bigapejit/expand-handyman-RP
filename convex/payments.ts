import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { pacificDay } from "../lib/invoice-standing";
import type { InvoiceStamp } from "../lib/invoice-paper";

// An invoice's **Payment**s (CONTEXT.md), read wherever its standing, its
// paper or its panel is. The owner's Mark paid writes one only where none
// stands, but the app writes one whenever Stripe says money arrived, so an
// invoice may hold several: earliest first, by the day the money arrived and
// then by when it was recorded.
export async function paymentsFor(
  ctx: QueryCtx,
  invoiceId: Id<"invoices">,
): Promise<Doc<"payments">[]> {
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
  // Calendar days written YYYY-MM-DD sort as they fall.
  return payments.sort(
    (x, y) =>
      (x.receivedOn < y.receivedOn ? -1 : x.receivedOn > y.receivedOn ? 1 : 0) ||
      x.recordedAt - y.recordedAt,
  );
}

// The earliest payment, or nothing: the one whose day the paper's PAID stamp
// carries, since that is when the invoice was first paid.
export async function paymentFor(
  ctx: QueryCtx,
  invoiceId: Id<"invoices">,
): Promise<Doc<"payments"> | null> {
  return (await paymentsFor(ctx, invoiceId))[0] ?? null;
}

// Every **Pay now** through Stripe whose session completed on the invoice,
// in the order Stripe accepted them.
export async function stripePaymentsFor(
  ctx: QueryCtx,
  invoiceId: Id<"invoices">,
): Promise<Doc<"stripePayments">[]> {
  const rows = await ctx.db
    .query("stripePayments")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
  return rows.sort((x, y) => x.acceptedAt - y.acceptedAt);
}

// The bank payment the invoice is waiting on, if any: its **Payment on its
// way** is nothing more than this row being there. Minting refuses a second
// session while one is on its way, so there is at most one in practice; the
// first accepted stands for them if two sessions raced.
export async function paymentOnItsWayFor(
  ctx: QueryCtx,
  invoiceId: Id<"invoices">,
): Promise<Doc<"stripePayments"> | null> {
  return (
    (await stripePaymentsFor(ctx, invoiceId)).find((row) => row.status === "on_its_way") ??
    null
  );
}

// The Stripe payment behind the panel's grey note: the newest one returned,
// refunded or lost in a dispute, kept only while the invoice is back to
// owing, which is while it holds no payment, has none on its way and is not
// void. Once any of those changes the note has nothing left to explain.
export async function stripeNoteFor(
  ctx: QueryCtx,
  invoice: Pick<Doc<"invoices">, "_id" | "state">,
): Promise<Doc<"stripePayments"> | null> {
  if (invoice.state === "void") return null;
  if (await paymentFor(ctx, invoice._id)) return null;
  const rows = await stripePaymentsFor(ctx, invoice._id);
  if (rows.some((row) => row.status === "on_its_way")) return null;
  const ended = rows.filter(
    (row) =>
      row.status === "returned" || row.status === "refunded" || row.status === "dispute_lost",
  );
  return (
    ended.sort((x, y) => (y.endedAt ?? y.acceptedAt) - (x.endedAt ?? x.acceptedAt))[0] ?? null
  );
}

// What the invoice's paper is stamped with: VOID from the day it was voided,
// or PAID from the day its money first arrived. VOID wins over any payment:
// Void is refused while a payment stands, but a Stripe payment may still land
// on an invoice voided while the customer was on Stripe's page, and the
// paper must never tell them a void invoice was paid. Void always writes
// `voidedAt`; the last change stands in only for a row written some other
// way, so the stamp still has a day.
export function invoiceStamp(
  invoice: Pick<Doc<"invoices">, "state" | "voidedAt" | "updatedAt">,
  payment: Pick<Doc<"payments">, "receivedOn"> | null,
): InvoiceStamp | null {
  if (invoice.state === "void")
    return { kind: "void", day: pacificDay(invoice.voidedAt ?? invoice.updatedAt) };
  if (invoice.state === "sent" && payment) return { kind: "paid", day: payment.receivedOn };
  return null;
}
