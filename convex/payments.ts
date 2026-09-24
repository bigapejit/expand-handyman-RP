import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { pacificDay } from "../lib/invoice-standing";
import type { InvoiceStamp } from "../lib/invoice-paper";

// An invoice's **Payment** (CONTEXT.md), read wherever its standing or its
// paper is: the row Mark paid wrote, or nothing. Mark paid writes one at most,
// so the first is the only one.
export function paymentFor(
  ctx: QueryCtx,
  invoiceId: Id<"invoices">,
): Promise<Doc<"payments"> | null> {
  return ctx.db
    .query("payments")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .first();
}

// What the invoice's paper is stamped with: VOID from the day it was voided,
// or PAID from the day its money arrived. Void is refused while a payment
// stands, so the two never meet; VOID wins if they somehow did.
export function invoiceStamp(
  invoice: Pick<Doc<"invoices">, "state" | "voidedAt" | "updatedAt">,
  payment: Pick<Doc<"payments">, "receivedOn"> | null,
): InvoiceStamp | null {
  if (invoice.state === "void")
    return { kind: "void", day: pacificDay(invoice.voidedAt ?? invoice.updatedAt) };
  if (invoice.state === "sent" && payment) return { kind: "paid", day: payment.receivedOn };
  return null;
}
