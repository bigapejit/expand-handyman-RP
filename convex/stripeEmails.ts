import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { appOrigin, emailReplyTo, sendEmail, sendsEmail } from "./email";
import { paymentFor, paymentOnItsWayFor } from "./payments";
import { ExpandBusiness } from "../lib/expand-business";
import { pacificDay } from "../lib/invoice-standing";
import { formatCentsExact } from "../lib/money";
import { shortDay, stripePaymentUrl } from "../lib/pay-now";
import { signingPath, signingUrl } from "../lib/signing-link";

// The two letters of a **Returned payment** (CONTEXT.md), the only mail the
// app sends about a Stripe payment, because it is the only moment Stripe is
// silent: its receipt and the owner's payment and dispute notifications are
// switched on in Stripe's dashboard, and there is no thank-you or reminder
// from the app. Plain text in the words spec #121 settled ("Emails"), from
// the sender and with the reply-to the invoice email uses, scheduled by
// `applyStripeEvent` once it has committed, so a Resend outage never undoes
// the return. Each is keyed on the payment intent, so a retried action sends
// neither twice. While another bank payment for the invoice is still on its
// way the customer is not asked to pay again, and only the owner hears of it;
// the same when, by the time the letters go, the invoice was voided or paid
// or another payment set off since the return committed.

export const sendReturnedPayment = internalAction({
  args: {
    paymentIntentId: v.string(),
    invoiceId: v.id("invoices"),
    // `INV-1004`.
    number: v.string(),
    // What Stripe took, which is what came back.
    amountCents: v.number(),
    // The name and address the invoice went to, as sent.
    customerName: v.string(),
    to: v.string(),
    // The link to pay again through: the invoice's live link, or its newest.
    token: v.optional(v.string()),
    // The bank's words, for the owner only.
    reason: v.optional(v.string()),
    // Another bank payment for the invoice still on its way, from a second
    // session minted before either completed: the customer's money may yet
    // arrive that way, so only the owner is written to.
    stillOnItsWay: v.optional(v.object({ amountCents: v.number(), acceptedOn: v.string() })),
  },
  handler: async (ctx, a) => {
    const amount = formatCentsExact(a.amountCents, "en-US");
    let customer: OwnerLetter["customer"];
    if (a.stillOnItsWay) customer = { kind: "still_on_its_way", ...a.stillOnItsWay };
    else {
      // The return's mutation found the invoice still owed, but this runs in
      // a transaction of its own, after it: a Void, Mark paid or another
      // session's completion may have landed between, and a letter asking
      // the customer to pay an invoice that is no longer payable must not go.
      // This check is the last word. One the mutation already left unasked is
      // not asked here even if the other payment has come back too since:
      // that return writes letters of its own.
      const notAsked = await ctx.runQuery(internal.stripeEmails.whyNotAskAgain, {
        invoiceId: a.invoiceId,
      });
      const url = a.token ? signingUrl(appOrigin(), a.token) : null;
      const emailed = notAsked ? false : await sendCustomerLetter(a, amount, url);
      // Kept for the owner's grey note, which otherwise could only guess.
      await ctx.runMutation(internal.stripeEmails.recordCustomerLetter, {
        paymentIntentId: a.paymentIntentId,
        emailed,
      });
      customer = notAsked ?? (emailed ? { kind: "emailed" } : { kind: "not_emailed" });
    }

    const owner = await sendEmail({
      to: ExpandBusiness.email,
      subject: `Bank payment on ${a.number} was returned`,
      text: ownerLetter({
        ...a,
        amount,
        customer,
        stripeUrl: stripePaymentUrl(a.paymentIntentId, process.env.STRIPE_SECRET_KEY),
      }),
      idempotencyKey: `returned-payment/${a.paymentIntentId}/owner`,
      tags: { letter: "returned_payment_owner" },
    });
    if (owner.outcome === "fault")
      console.error(`Returned payment letter to the owner was not sent (${owner.fault}).`);
  },
});

// Why the customer is not to be asked to pay the invoice again, or null while
// it still owes: sent, with no payment and none on its way, which is when the
// link has its Pay button back. A void invoice says so before a payment on
// it, since its paper reads VOID whatever Stripe wrote.
export const whyNotAskAgain = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, a): Promise<NotAsked | null> => {
    const invoice = await ctx.db.get(a.invoiceId);
    if (!invoice || invoice.state !== "sent") return { kind: "voided" };
    if (await paymentFor(ctx, invoice._id)) return { kind: "paid" };
    const other = await paymentOnItsWayFor(ctx, invoice._id);
    if (other)
      return {
        kind: "still_on_its_way",
        amountCents: other.amountCents,
        acceptedOn: pacificDay(other.acceptedAt),
      };
    return null;
  },
});

// Whether the customer's letter went, on the return it was about. A payment
// intent is one payment, so its returned row is the one.
export const recordCustomerLetter = internalMutation({
  args: { paymentIntentId: v.string(), emailed: v.boolean() },
  handler: async (ctx, a) => {
    const rows = await ctx.db
      .query("stripePayments")
      .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", a.paymentIntentId))
      .collect();
    for (const row of rows)
      if (row.status === "returned") await ctx.db.patch(row._id, { customerEmailed: a.emailed });
  },
});

// The customer's letter, and whether the owner's may say it went. The owner's
// letter is the only word that the customer believes they have paid, and
// nothing retries this action, so it says "has been emailed" only when the
// customer's letter really went: a deployment that sends mail but names no
// origin has no link to give, and a send that faults never arrived. One that
// sends no mail at all writes both letters to the log, with the link's path,
// and that counts as sent.
async function sendCustomerLetter(
  a: { paymentIntentId: string; number: string; customerName: string; to: string; token?: string },
  amount: string,
  url: string | null,
): Promise<boolean> {
  if (url === null && sendsEmail()) {
    console.error(
      `Returned payment letter to ${a.to} not sent: no app origin is configured (APP_ORIGIN).`,
    );
    return false;
  }
  const customer = await sendEmail({
    to: a.to,
    subject: `Your payment for Invoice ${a.number} did not go through`,
    text: customerLetter({ ...a, amount, url: url ?? (a.token ? signingPath(a.token) : "") }),
    replyTo: emailReplyTo(),
    idempotencyKey: `returned-payment/${a.paymentIntentId}/customer`,
    tags: { letter: "returned_payment_customer" },
  });
  if (customer.outcome !== "fault") return true;
  console.error(`Returned payment letter to ${a.to} was not sent (${customer.fault}).`);
  return false;
}

// No reason: that is between the bank and the owner. Only that it did not go
// through and how to pay again.
function customerLetter(letter: {
  customerName: string;
  number: string;
  amount: string;
  url: string;
}): string {
  return [
    `Hello ${letter.customerName},`,
    "",
    `Your bank returned your payment of ${letter.amount} for ${letter.number}. It did not go through.`,
    "",
    "Pay again here:",
    letter.url,
    "",
    "Or pay by Zelle or check as the invoice says. Reply to this email with any questions.",
  ].join("\n");
}

type OwnerLetter = {
  number: string;
  amount: string;
  reason?: string;
  customerName: string;
  to: string;
  // What became of the customer: asked to pay again, not reachable, or left
  // alone because the invoice no longer asks for the money.
  customer: { kind: "emailed" } | { kind: "not_emailed" } | NotAsked;
  stripeUrl: string;
};

// Why the customer was left alone: another bank payment of theirs is still on
// its way, or, by the time the letters went, the invoice was voided or paid.
type NotAsked =
  | { kind: "still_on_its_way"; amountCents: number; acceptedOn: string }
  | { kind: "voided" }
  | { kind: "paid" };

function ownerLetter(letter: OwnerLetter): string {
  // The reason ends the sentence, whatever Stripe ended its own words with.
  const reason = letter.reason?.trim().replace(/[.\s]+$/, "");
  return [
    `Bank payment on ${letter.number} for ${letter.amount} was returned${reason ? `: ${reason}` : ""}.`,
    "",
    customerLine(letter),
    "",
    `See it in Stripe: ${letter.stripeUrl}`,
  ].join("\n");
}

function customerLine({ customer, customerName, to }: OwnerLetter): string {
  const who = `customer (${customerName}, ${to})`;
  switch (customer.kind) {
    case "emailed":
      return `The ${who} has been emailed to pay again.`;
    case "not_emailed":
      return `The ${who} could not be emailed. Ask them to pay again.`;
    case "still_on_its_way":
      return `Another bank payment of ${formatCentsExact(customer.amountCents, "en-US")} accepted ${shortDay(customer.acceptedOn)} is still on its way, so the ${who} was not asked to pay again.`;
    case "voided":
      return `The invoice was voided meanwhile, so the ${who} was not asked to pay again.`;
    case "paid":
      return `Another payment landed meanwhile, so the ${who} was not asked to pay again.`;
  }
}
