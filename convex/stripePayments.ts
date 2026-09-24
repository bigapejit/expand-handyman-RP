import Stripe from "stripe";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { appOrigin } from "./email";
import { invoiceLinkForToken, invoiceStillOpenedBy } from "./invoiceLinks";
import { paymentFor, paymentOnItsWayFor } from "./payments";
import { discardInvoicePdfCopy } from "./pdfCopyFiles";
import { invoiceMoney, invoiceNumberLabel } from "../lib/invoice-money";
import { pacificDay } from "../lib/invoice-standing";
import {
  CardLimitNote,
  stripeEventDay,
  StripeRangeNote,
  waysToPay,
  type PayMethod,
} from "../lib/pay-now";
import { signingUrl } from "../lib/signing-link";
import {
  prunedStripeEvent,
  readCharge,
  readStripeEvent,
  type ChargeReading,
  type StripeEventReading,
} from "../lib/stripe-events";

// **Pay now** (CONTEXT.md) where it meets Stripe: minting the Checkout
// Session Pay by bank and Pay by card go to, the success return that reads
// the session back when the customer lands on the link again, and
// `applyStripeEvent`, the one mutation every word from Stripe goes through,
// the webhook's (convex/http.ts) and the success return's alike. The app only
// listens: refunds and disputes are the owner's to handle in Stripe's
// dashboard, and what comes of them is applied here.
//
// The client is made inside each handler, never at import, because neither
// deployment has STRIPE_SECRET_KEY yet and every other function in the app
// must still load without it. It talks through `fetch`, which the Convex
// runtime has and the tests stub.

// This deployment's Stripe secret key, or null where none is set, when Pay by
// bank and Pay by card are refused and the rest of the link still works.
export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

// A webhook delivery checked against the destination's signing secret, with
// Web Crypto, since the Convex runtime has no Node crypto. Throws on a bad
// signature or a body that is not an event. Needs no secret key: the
// signature is all that proves the body came from Stripe.
export function verifiedStripeEvent(
  body: string,
  signature: string,
  webhookSecret: string,
): Promise<Stripe.Event> {
  return Stripe.webhooks.constructEventAsync(
    body,
    signature,
    webhookSecret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}

const payMethod = v.union(v.literal("bank"), v.literal("card"));

// How long a customer has on Stripe's page before the session expires: the
// spec's 30 minutes, long enough to log in to a bank, short enough that a
// session minted before a re-send or a Void is soon gone. Thirty is also the
// shortest Stripe allows, counted from when its own clock creates the
// session, so asking for exactly thirty from this clock would land a few
// seconds short and be refused; the extra minute is that margin.
const SessionMinutes = 30;
const SessionMarginSeconds = 60;

// What the Pay sheet shows when this deployment cannot send anyone to Stripe:
// no secret key yet, or no origin to bring the customer back to.
const NotSetUp =
  "Paying by bank or card is not switched on yet. Please pay by Zelle or check as How to pay says.";

// Pay by bank or Pay by card, pressed on the Pay sheet: a Checkout Session
// for the full Amount Due, no fee, and the address of Stripe's page for the
// sheet to go to. Runs under the invoice link, as Approve runs under a
// signing link, and only while that link is live and the invoice still owes
// (`checkoutFor`). No Stripe Customer, no Tax, no Invoicing: one line,
// named for the invoice, and Stripe's mandate email and receipt go to the
// address the invoice went to.
export const mintCheckoutSession = action({
  args: { token: v.string(), method: payMethod },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const checkout = await ctx.runQuery(internal.stripePayments.checkoutFor, a);
    if ("refusal" in checkout) throw new ConvexError(checkout.refusal);
    const secretKey = stripeSecretKey();
    const linkUrl = signingUrl(appOrigin(), a.token.trim());
    if (!secretKey || !linkUrl) {
      console.error(
        `Pay by ${a.method} on ${checkout.number} refused: this deployment has no ${secretKey ? "APP_ORIGIN" : "STRIPE_SECRET_KEY"}.`,
      );
      throw new ConvexError({ code: "stripe_not_set_up", message: NotSetUp });
    }
    const metadata = { invoiceId: checkout.invoiceId, invoiceNumber: checkout.number };
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      submit_type: "pay",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: checkout.amountDueCents,
            product_data: { name: `Invoice ${checkout.number}` },
          },
        },
      ],
      ...(a.method === "bank"
        ? {
            payment_method_types: ["us_bank_account"],
            // Instant verification only: a customer is never asked to
            // confirm micro-deposits days later, and a payment is on its way
            // for the bank's four days and no longer.
            payment_method_options: {
              us_bank_account: {
                verification_method: "instant",
                financial_connections: { permissions: ["payment_method"] },
              },
            },
          }
        : { payment_method_types: ["card"] }),
      customer_email: checkout.sentTo,
      client_reference_id: checkout.invoiceId,
      metadata,
      payment_intent_data: {
        description: `Invoice ${checkout.number}, Expand Handyman`,
        metadata,
      },
      expires_at: Math.floor(Date.now() / 1000) + SessionMinutes * 60 + SessionMarginSeconds,
      success_url: `${linkUrl}?session={CHECKOUT_SESSION_ID}`,
      cancel_url: linkUrl,
    };
    let url: string | null = null;
    try {
      url = (await stripeClient(secretKey).checkout.sessions.create(params)).url;
    } catch (error) {
      console.error(`Stripe refused a session for ${checkout.number}: ${messageOf(error)}`);
    }
    if (!url)
      throw new ConvexError({
        code: "stripe_unavailable",
        message:
          "Stripe could not open its page just now. Please try again in a minute, or pay by Zelle or check.",
      });
    return { url };
  },
});

// Whether the link's invoice may be paid through Stripe this way now, and if
// so what the session is made of. Every refusal is a sentence the Pay sheet
// shows as it stands.
export const checkoutFor = internalQuery({
  args: { token: v.string(), method: payMethod },
  handler: async (
    ctx,
    a,
  ): Promise<
    | { refusal: { code: string; message: string } }
    | { invoiceId: Id<"invoices">; number: string; amountDueCents: number; sentTo: string }
  > => {
    const refusal = (code: string, message: string) => ({ refusal: { code, message } });
    // Only the live link pays: a re-send ends the old one, and an old email
    // must not be a way to pay.
    const opened = await invoiceStillOpenedBy(ctx, a.token);
    if (!opened) return refusal("link_ended", "This link is no longer live.");
    const { invoice } = opened;
    if (invoice.state !== "sent" || !invoice.frozen || invoice.number === undefined)
      return refusal("void", "This invoice was voided, so nothing is due on it.");
    const { amountDueCents } = invoiceMoney(invoice.lines, invoice.taxRate);
    if (amountDueCents <= 0) return refusal("nothing_due", "Nothing is due on this invoice.");
    if (await paymentFor(ctx, invoice._id))
      return refusal("paid", "This invoice is already paid.");
    if (await paymentOnItsWayFor(ctx, invoice._id))
      return refusal("on_its_way", "A bank payment for this invoice is already on its way.");
    // Stripe refuses a charge outside its range, so it is never asked.
    const ways = waysToPay(amountDueCents);
    if (ways.length === 0) return refusal("stripe_range", StripeRangeNote);
    if (!ways.includes(a.method)) return refusal("card_limit", CardLimitNote);
    return {
      invoiceId: invoice._id,
      number: invoiceNumberLabel(invoice.number),
      amountDueCents,
      sentTo: invoice.frozen.sentTo,
    };
  },
});

// The success return: the customer back on the link from Stripe's page, with
// the session's id in the address. The session is read from Stripe itself,
// never taken from the address, and applied through `applyStripeEvent` as if
// its completion had just arrived, so the paper is right the moment the
// customer is back, whether or not the webhook has landed yet; whichever
// comes second finds the work done. A session not yet complete applies
// nothing, and nor does anything that goes wrong reaching Stripe: the
// webhook still records the payment.
export const applyCheckoutReturn = action({
  args: { token: v.string(), sessionId: v.string() },
  handler: async (ctx, a): Promise<{ applied: boolean }> => {
    const invoiceId = await ctx.runQuery(internal.stripePayments.invoiceLinkedBy, {
      token: a.token,
    });
    const secretKey = stripeSecretKey();
    const sessionId = a.sessionId.trim();
    if (!invoiceId || !secretKey || !/^cs_\w+$/.test(sessionId)) return { applied: false };
    let session: Stripe.Checkout.Session;
    try {
      session = await stripeClient(secretKey).checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });
    } catch (error) {
      console.error(`Stripe session ${sessionId} could not be read back: ${messageOf(error)}`);
      return { applied: false };
    }
    if (session.client_reference_id !== invoiceId)
      throw new ConvexError({
        code: "wrong_invoice",
        message: "That payment was made on another invoice, not this one.",
      });
    if (session.status !== "complete") return { applied: false };
    // Dated when the customer paid on Stripe's page, which is when Stripe
    // made the payment intent, not when the page came back: a return
    // reloaded after midnight must not move the payment's day.
    const intent = session.payment_intent;
    const paidAt =
      intent && typeof intent === "object" && typeof intent.created === "number"
        ? intent.created
        : Math.floor(Date.now() / 1000);
    await ctx.runMutation(internal.stripePayments.applyStripeEvent, {
      event: prunedStripeEvent({
        type: "checkout.session.completed",
        created: paidAt,
        data: { object: session },
      }),
    });
    return { applied: true };
  },
});

// The invoice a link belongs to, live or ended: a customer who paid and was
// re-sent the invoice meanwhile still lands on the old link, and the money
// still records. Only a token Expand minted names one.
export const invoiceLinkedBy = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<Id<"invoices"> | null> =>
    (await invoiceLinkForToken(ctx, a.token))?.invoiceId ?? null,
});

// The bank's words for a returned payment, for an `async_payment_failed`
// event that came without them: Stripe keeps them on the payment intent,
// which the event only names. Read before the mutation, which cannot call
// out; nothing at all if Stripe cannot be asked.
export async function failureReasonFromStripe(
  event: StripeEventReading,
): Promise<string | undefined> {
  if (event.kind !== "session" || event.type !== "async_failed") return undefined;
  const { paymentIntentId, failureMessage } = event.session;
  const secretKey = stripeSecretKey();
  if (failureMessage || !paymentIntentId || !secretKey) return undefined;
  try {
    const intent = await stripeClient(secretKey).paymentIntents.retrieve(paymentIntentId);
    return intent.last_payment_error?.message || undefined;
  } catch (error) {
    console.error(`Stripe payment ${paymentIntentId} could not be read: ${messageOf(error)}`);
    return undefined;
  }
}

// The charge a lost dispute was over, for a `charge.dispute.closed` event
// that names it only by id: if no completion came before it, the dispute's
// row is written from the charge. Read before the mutation, which cannot
// call out; nothing if Stripe cannot be asked, when the mutation refuses the
// event only if it needed the charge, and Stripe delivers it again.
export async function disputedChargeFromStripe(
  event: StripeEventReading,
): Promise<ChargeReading | undefined> {
  if (event.kind !== "dispute" || !event.lost || event.charge || !event.chargeId) return undefined;
  const { chargeId } = event;
  const secretKey = stripeSecretKey();
  if (!secretKey) return undefined;
  try {
    return readCharge(await stripeClient(secretKey).charges.retrieve(chargeId)) ?? undefined;
  } catch (error) {
    console.error(`Stripe charge ${chargeId} could not be read: ${messageOf(error)}`);
    return undefined;
  }
}

const chargeReading = v.object({
  invoiceId: v.union(v.string(), v.null()),
  method: v.union(payMethod, v.null()),
  amountCents: v.number(),
  created: v.number(),
});

// Everything Stripe says about a payment, applied: the webhook's events and
// the success return's session (spec #121, the events table). An event is
// taken once, by its `evt_` id, and every rule is idempotent on the object
// besides, so the same payment told twice, or out of order, or by both the
// webhook and the success return, ends the same. Unknown and unused event
// types are recorded too, so a redelivery is still a no-op.
export const applyStripeEvent = internalMutation({
  args: {
    // A pruned Stripe event (lib/stripe-events.ts), narrowed below.
    event: v.any(),
    // The bank's words for a returned payment, when the webhook had to ask
    // Stripe for them.
    failureReason: v.optional(v.string()),
    // A lost dispute's charge, when the webhook had to ask Stripe for it.
    charge: v.optional(chargeReading),
  },
  handler: async (ctx, a) => {
    const event = readStripeEvent(a.event);
    if (event.eventId !== null) {
      const eventId = event.eventId;
      const seen = await ctx.db
        .query("stripeEvents")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .first();
      if (seen) return;
      await ctx.db.insert("stripeEvents", {
        eventId,
        type: event.stripeType,
        receivedAt: Date.now(),
      });
    }
    switch (event.kind) {
      case "session":
        return applySession(ctx, event, a.failureReason);
      case "refund":
        // A partial refund changes nothing: a payment is there or gone.
        if (event.full && event.paymentIntentId)
          await endPayment(ctx, event.paymentIntentId, event.charge, {
            status: "refunded",
            endedAt: event.created * 1000,
          });
        return;
      case "dispute":
        // Only a lost dispute sends the money back; one won or merely opened
        // leaves the payment standing.
        if (event.lost && event.paymentIntentId)
          await endPayment(ctx, event.paymentIntentId, event.charge ?? a.charge ?? null, {
            status: "dispute_lost",
            endedAt: event.created * 1000,
            reason: event.reason ?? undefined,
          });
        return;
      case "other":
        return;
    }
  },
});

async function applySession(
  ctx: MutationCtx,
  event: StripeEventReading & { kind: "session" },
  failureReason: string | undefined,
) {
  const { session } = event;
  // An expired session was never completed, so nothing was written for it.
  if (event.type === "expired") return;
  const invoiceId = session.invoiceId ? ctx.db.normalizeId("invoices", session.invoiceId) : null;
  const invoice = invoiceId ? await ctx.db.get(invoiceId) : null;
  const { paymentIntentId, method } = session;
  // A session the app did not mint (the Stripe account may take other
  // payments) names no invoice here, and is left alone.
  if (!invoice || !paymentIntentId || !method || !session.id) {
    console.warn(`Stripe session ${session.id || "(no id)"} is not an invoice's; left alone.`);
    return;
  }
  const payment = {
    invoice,
    sessionId: session.id,
    paymentIntentId,
    method,
    amountCents: session.amountCents,
    at: event.created * 1000,
    day: stripeEventDay(event.created),
  };
  switch (event.type) {
    case "completed":
      await acceptedAtCompletion(ctx, payment);
      // A card's money is in at once; a bank's is on its way until the bank
      // confirms it, unless the payment intent, when the success return read
      // it, has already failed.
      if (session.paymentStatus === "paid") return recordPaid(ctx, payment);
      if (
        session.paymentStatus === "unpaid" &&
        (session.paymentIntentStatus === null || session.paymentIntentStatus === "processing")
      )
        return recordOnItsWay(ctx, payment);
      return;
    case "async_succeeded":
      return recordPaid(ctx, payment);
    case "async_failed":
      return recordReturned(ctx, payment, failureReason ?? session.failureMessage ?? undefined);
  }
}

type StripePaymentFacts = {
  invoice: Doc<"invoices">;
  sessionId: string;
  paymentIntentId: string;
  method: PayMethod;
  amountCents: number;
  // When the event happened, in milliseconds, and its Pacific day.
  at: number;
  day: string;
};

const Ended = new Set<Doc<"stripePayments">["status"]>(["returned", "refunded", "dispute_lost"]);

// The row a session's payment already has: the one written for the session,
// or else the one a full refund or a lost dispute wrote for its payment
// intent before the completion arrived, which learns its session here.
async function rowForSession(ctx: MutationCtx, payment: StripePaymentFacts) {
  const row = await ctx.db
    .query("stripePayments")
    .withIndex("by_checkout_session", (q) => q.eq("stripeCheckoutSessionId", payment.sessionId))
    .first();
  if (row) return row;
  const endedFirst = (await rowsForIntent(ctx, payment.paymentIntentId)).find(
    (row) => row.stripeCheckoutSessionId === undefined,
  );
  if (!endedFirst) return null;
  await ctx.db.patch(endedFirst._id, { stripeCheckoutSessionId: payment.sessionId });
  return { ...endedFirst, stripeCheckoutSessionId: payment.sessionId };
}

function rowsForIntent(ctx: QueryCtx, paymentIntentId: string) {
  return ctx.db
    .query("stripePayments")
    .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", paymentIntentId))
    .collect();
}

function paymentsForIntent(ctx: QueryCtx, paymentIntentId: string) {
  return ctx.db
    .query("payments")
    .withIndex("by_stripe_payment_intent", (q) => q.eq("stripePaymentIntentId", paymentIntentId))
    .collect();
}

// The money arrived: a card at completion, a bank when it confirms. The
// payment's day is the Pacific day of the event that said so, never the day
// the customer pressed Pay. Written whatever the invoice now reads, even
// void or already paid, because money that moved is never hidden; never
// twice for one payment intent; and never for a payment already gone back,
// which a late delivery must not bring back to life.
async function recordPaid(ctx: MutationCtx, payment: StripePaymentFacts) {
  const row = await rowForSession(ctx, payment);
  if (row && Ended.has(row.status)) return;
  const [existing] = await paymentsForIntent(ctx, payment.paymentIntentId);
  const paymentId =
    existing?._id ??
    (await ctx.db.insert("payments", {
      invoiceId: payment.invoice._id,
      receivedOn: payment.day,
      source: "stripe",
      recordedBy: "stripe",
      recordedAt: Date.now(),
      method: payment.method,
      stripePaymentIntentId: payment.paymentIntentId,
    }));
  if (row) await ctx.db.patch(row._id, { status: "paid", paymentId });
  else
    await ctx.db.insert("stripePayments", {
      ...rowFields(payment),
      status: "paid",
      paymentId,
    });
  if (!existing) await paperChanged(ctx, payment.invoice);
  else if (payment.method === "card" && payment.day < existing.receivedOn) {
    // A card's money is confirmed by its completion, which both the webhook
    // and the success return tell, each reading that moment a few seconds
    // apart: the webhook by the event's time, the return by when Stripe made
    // the payment intent, just before. Across Pacific midnight the two fall
    // on different days, and the paper must not carry whichever request won
    // the race, so the earlier day wins, as `acceptedAtCompletion` only ever
    // moves the row's time earlier: it is the first moment anyone saw the
    // money. A later day never moves it on. A bank's money is confirmed only
    // by its own event, days after the completion the return reads, so a
    // bank payment keeps the day it was written with.
    await ctx.db.patch(existing._id, { receivedOn: payment.day });
    await paperChanged(ctx, payment.invoice);
  }
}

// A completion delivered after another event already wrote its session's
// row: Stripe does not promise the order. A confirmation or a return that
// came first dated the row by its own day, days after the customer paid; the
// payment was accepted when its session completed, so the completion's time
// replaces any later one, and every sentence that says when reads the day
// the customer paid. A refund or a lost dispute that came first dated it by
// the charge, made a moment before the completion, so that time normally
// stands. Only ever a later one: the success return dates its completion by
// the payment intent's making, a moment before the webhook's own, and the
// webhook's arriving second must not move it on.
async function acceptedAtCompletion(ctx: MutationCtx, payment: StripePaymentFacts) {
  const row = await rowForSession(ctx, payment);
  if (row && payment.at < row.acceptedAt) await ctx.db.patch(row._id, { acceptedAt: payment.at });
}

// A bank payment accepted and not yet confirmed: the invoice reads Payment
// on its way. Nothing when the session already has its row, which may be
// paid already if the confirmation came first, or ended if a return, a full
// refund or a lost dispute did.
async function recordOnItsWay(ctx: MutationCtx, payment: StripePaymentFacts) {
  if (await rowForSession(ctx, payment)) return;
  await ctx.db.insert("stripePayments", { ...rowFields(payment), status: "on_its_way" });
}

// A **Returned payment** (CONTEXT.md): the bank refused the debit, so the
// payment on its way ends and the invoice owes again from its sent day. The
// paper never showed it, so no PDF copy goes. Stripe emails nobody, so the
// app writes to the customer and the owner, once, and only while the
// invoice still owes: a payment since, or a Void, leaves nothing to pay
// again. Minting refuses while a payment is on its way, but two sessions
// minted before either completed (two tabs) can both be on their way; while
// the other still is, the invoice reads Payment on its way and the link has
// no Pay button, so the customer is not asked to pay again and only the
// owner is told. The letters go after this commits, so the action asks all
// of this again before it writes to the customer.
async function recordReturned(
  ctx: MutationCtx,
  payment: StripePaymentFacts,
  reason: string | undefined,
) {
  const row = await rowForSession(ctx, payment);
  if (row && row.status !== "on_its_way") return;
  const ended = { status: "returned" as const, endedAt: payment.at, reason };
  const returnedId =
    row?._id ?? (await ctx.db.insert("stripePayments", { ...rowFields(payment), ...ended }));
  if (row) await ctx.db.patch(row._id, ended);

  const { invoice } = payment;
  if (invoice.state !== "sent" || !invoice.frozen || invoice.number === undefined) return;
  if (await paymentFor(ctx, invoice._id)) return;
  const other = await paymentOnItsWayFor(ctx, invoice._id);
  // Not asked, so should the grey note ever read this return, it says to ask.
  if (other) await ctx.db.patch(returnedId, { customerEmailed: false });
  await ctx.scheduler.runAfter(0, internal.stripeEmails.sendReturnedPayment, {
    paymentIntentId: payment.paymentIntentId,
    invoiceId: invoice._id,
    number: invoiceNumberLabel(invoice.number),
    amountCents: payment.amountCents,
    ...(reason ? { reason } : {}),
    ...(other
      ? {
          stillOnItsWay: {
            amountCents: other.amountCents,
            acceptedOn: pacificDay(other.acceptedAt),
          },
        }
      : {}),
  });
}

// A full refund or a lost dispute, done in Stripe's dashboard: the money went
// back, so the payment goes, stamp and all, and the Stripe payment keeps why
// for the owner's grey note. A second telling finds nothing left to remove.
async function endPayment(
  ctx: MutationCtx,
  paymentIntentId: string,
  charge: ChargeReading | null,
  ended: PaymentEnded,
) {
  const rows = await rowsForIntent(ctx, paymentIntentId);
  if (rows.length === 0) return endedBeforeCompletion(ctx, paymentIntentId, charge, ended);
  for (const row of rows)
    if (!Ended.has(row.status)) await ctx.db.patch(row._id, { ...ended, paymentId: undefined });
  for (const payment of await paymentsForIntent(ctx, paymentIntentId)) {
    await ctx.db.delete(payment._id);
    const invoice = await ctx.db.get(payment.invoiceId);
    if (invoice) await paperChanged(ctx, invoice);
  }
}

type PaymentEnded = {
  status: "refunded" | "dispute_lost";
  endedAt: number;
  reason?: string;
};

// A full refund or a lost dispute told before the completion of the session
// it ends, which Stripe does not promise to deliver first: the row is
// written already ended, from the charge, so the completion, when it comes,
// finds the money gone and writes no payment. No `payments` row was ever
// written, so the paper has nothing to change. A charge whose metadata names
// no invoice of the app's was not a Pay now, and is left alone. With no
// charge at all, which a dispute's event does not carry and Stripe could not
// be asked for, there is no telling, so the event is refused, unrecorded,
// for Stripe to deliver again.
async function endedBeforeCompletion(
  ctx: MutationCtx,
  paymentIntentId: string,
  charge: ChargeReading | null,
  ended: PaymentEnded,
) {
  if (!charge)
    throw new Error(`No charge to tell whether Stripe payment ${paymentIntentId} was a Pay now.`);
  const invoiceId = charge.invoiceId ? ctx.db.normalizeId("invoices", charge.invoiceId) : null;
  const invoice = invoiceId ? await ctx.db.get(invoiceId) : null;
  if (!invoice || !charge.method) {
    console.warn(`Stripe payment ${paymentIntentId} is not an invoice's; left alone.`);
    return;
  }
  await ctx.db.insert("stripePayments", {
    invoiceId: invoice._id,
    stripePaymentIntentId: paymentIntentId,
    method: charge.method,
    amountCents: charge.amountCents,
    acceptedAt: charge.created * 1000,
    ...ended,
  });
}

// The fields a Stripe payment's row is made with, whichever event came first.
function rowFields(payment: StripePaymentFacts) {
  return {
    invoiceId: payment.invoice._id,
    stripeCheckoutSessionId: payment.sessionId,
    stripePaymentIntentId: payment.paymentIntentId,
    method: payment.method,
    amountCents: payment.amountCents,
    acceptedAt: payment.at,
  };
}

// A payment written or removed changes a sent invoice's stamp, so its PDF
// copy goes, as Mark paid and Mark unpaid let it go. A void invoice's paper
// reads VOID whatever Stripe wrote, and keeps its copy.
async function paperChanged(ctx: MutationCtx, invoice: Doc<"invoices">) {
  if (invoice.state !== "sent") return;
  await discardInvoicePdfCopy(ctx, invoice);
  await ctx.db.patch(invoice._id, { updatedAt: Date.now() });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
