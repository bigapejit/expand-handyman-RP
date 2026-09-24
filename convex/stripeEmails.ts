import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import { appOrigin, emailReplyTo, sendEmail, sendsEmail } from "./email";
import { ExpandBusiness } from "../lib/expand-business";
import { formatCentsExact } from "../lib/money";
import { stripePaymentUrl } from "../lib/pay-now";
import { signingPath, signingUrl } from "../lib/signing-link";

// The two letters of a **Returned payment** (CONTEXT.md), the only mail the
// app sends about a Stripe payment, because it is the only moment Stripe is
// silent: its receipt and the owner's payment and dispute notifications are
// switched on in Stripe's dashboard, and there is no thank-you or reminder
// from the app. Plain text in the words spec #121 settled ("Emails"), from
// the sender and with the reply-to the invoice email uses, scheduled by
// `applyStripeEvent` once it has committed, so a Resend outage never undoes
// the return. Each is keyed on the payment intent, so a retried action sends
// neither twice.

export const sendReturnedPayment = internalAction({
  args: {
    paymentIntentId: v.string(),
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
  },
  handler: async (_ctx, a) => {
    const amount = formatCentsExact(a.amountCents, "en-US");
    const url = a.token ? signingUrl(appOrigin(), a.token) : null;
    const customerEmailed = await sendCustomerLetter(a, amount, url);

    const owner = await sendEmail({
      to: ExpandBusiness.email,
      subject: `Bank payment on ${a.number} was returned`,
      text: ownerLetter({
        ...a,
        amount,
        customerEmailed,
        stripeUrl: stripePaymentUrl(a.paymentIntentId, process.env.STRIPE_SECRET_KEY),
      }),
      idempotencyKey: `returned-payment/${a.paymentIntentId}/owner`,
      tags: { letter: "returned_payment_owner" },
    });
    if (owner.outcome === "fault")
      console.error(`Returned payment letter to the owner was not sent (${owner.fault}).`);
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

function ownerLetter(letter: {
  number: string;
  amount: string;
  reason?: string;
  customerName: string;
  to: string;
  customerEmailed: boolean;
  stripeUrl: string;
}): string {
  // The reason ends the sentence, whatever Stripe ended its own words with.
  const reason = letter.reason?.trim().replace(/[.\s]+$/, "");
  return [
    `Bank payment on ${letter.number} for ${letter.amount} was returned${reason ? `: ${reason}` : ""}.`,
    "",
    letter.customerEmailed
      ? `The customer (${letter.customerName}, ${letter.to}) has been emailed to pay again.`
      : `The customer (${letter.customerName}, ${letter.to}) could not be emailed. Ask them to pay again.`,
    "",
    `See it in Stripe: ${letter.stripeUrl}`,
  ].join("\n");
}
