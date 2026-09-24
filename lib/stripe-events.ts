import type { PayMethod } from "./pay-now";

// What the app reads of a Stripe event, for **Pay now** (CONTEXT.md): the
// Checkout Session a customer paid through, the charge a full refund was
// made on, or the dispute that closed. Stripe's events carry far more, and
// some of it (metadata another integration wrote on the same account, keys
// Convex cannot store) must never reach a mutation, so the webhook and the
// success return prune an event to `prunedStripeEvent` first, and the one
// mutation that applies it narrows that with `readStripeEvent`. Pure, so the
// rules are read the same from both doors and tested without Stripe.

// The six event types the destinations send that the app acts on or knows
// to leave alone (spec #121, "The webhook"; docs/deployment.md), and every
// other one, which is only recorded.
export type StripeEventReading = {
  // Stripe's `evt_` id; none on the event the success return makes up from a
  // session it fetched itself.
  eventId: string | null;
  // Stripe's own name for the event, as `stripeEvents` records it.
  stripeType: string;
  // Seconds since the epoch, as Stripe gives it: when the event happened.
  created: number;
} & (
  | {
      kind: "session";
      type: "completed" | "async_succeeded" | "async_failed" | "expired";
      session: CheckoutSessionReading;
    }
  | {
      kind: "refund";
      paymentIntentId: string | null;
      // A full refund: Stripe's `refunded`, which a partial one leaves false.
      full: boolean;
      // The charge refunded, which is the event's own object.
      charge: ChargeReading | null;
    }
  | {
      kind: "dispute";
      paymentIntentId: string | null;
      lost: boolean;
      // Stripe's reason code, in words: `insufficient_funds` reads
      // "insufficient funds".
      reason: string | null;
      // The charge disputed: Stripe names it by id, and only an event that
      // came with it expanded carries what it says.
      chargeId: string | null;
      charge: ChargeReading | null;
    }
  | { kind: "other" }
);

export type CheckoutSessionReading = {
  id: string;
  // The invoice the session was minted for, as the app wrote it into
  // `client_reference_id`; not yet known to name a real invoice.
  invoiceId: string | null;
  paymentIntentId: string | null;
  // From the session's `payment_method_types[0]`; null for a session the app
  // did not mint, which offers some other way.
  method: PayMethod | null;
  amountCents: number;
  // `open`, `complete` or `expired`.
  status: string | null;
  // `paid`, `unpaid` or `no_payment_required`.
  paymentStatus: string | null;
  // Only when the payment intent came expanded, as the success return asks
  // for it: `processing`, `succeeded`, or a state that means it failed.
  paymentIntentStatus: string | null;
  // The bank's or Stripe's own words for a failed payment, when the payment
  // intent came expanded with them.
  failureMessage: string | null;
};

// What a charge says of the payment it took, enough to write a Stripe
// payment's row from when a full refund or a lost dispute is told before the
// session's completion. Stripe copies the payment intent's metadata onto the
// charge, so a Pay now's charge names its invoice as the session does.
export type ChargeReading = {
  // As the app wrote it into the metadata; not yet known to name a real
  // invoice, and null on a charge some other payment made.
  invoiceId: string | null;
  // From `payment_method_details.type`.
  method: PayMethod | null;
  amountCents: number;
  // Seconds since the epoch: when the customer paid.
  created: number;
};

const SessionTypes = {
  "checkout.session.completed": "completed",
  "checkout.session.async_payment_succeeded": "async_succeeded",
  "checkout.session.async_payment_failed": "async_failed",
  "checkout.session.expired": "expired",
} as const;

// An event cut down to what `readStripeEvent` reads, in Stripe's own field
// names, so it is still recognisably the event Stripe sent when logged.
export function prunedStripeEvent(event: unknown): Record<string, unknown> {
  const raw = record(event);
  const object = record(record(raw.data).object);
  return {
    id: text(raw.id),
    type: text(raw.type),
    created: count(raw.created),
    data: { object: prunedObject(text(raw.type) ?? "", object) },
  };
}

function prunedObject(type: string, object: Record<string, unknown>): Record<string, unknown> {
  if (type in SessionTypes) {
    const metadata = record(object.metadata);
    const intent = object.payment_intent;
    return {
      id: text(object.id),
      object: text(object.object),
      status: text(object.status),
      payment_status: text(object.payment_status),
      payment_method_types: Array.isArray(object.payment_method_types)
        ? object.payment_method_types.filter((method) => typeof method === "string")
        : [],
      amount_total: count(object.amount_total),
      client_reference_id: text(object.client_reference_id),
      metadata: { invoiceId: text(metadata.invoiceId), invoiceNumber: text(metadata.invoiceNumber) },
      payment_intent:
        typeof intent === "string"
          ? intent
          : typeof intent === "object" && intent !== null
            ? {
                id: text(record(intent).id),
                status: text(record(intent).status),
                last_payment_error: {
                  message: text(record(record(intent).last_payment_error).message),
                },
              }
            : null,
    };
  }
  const charge = object.charge;
  return {
    id: text(object.id),
    object: text(object.object),
    payment_intent: intentId(object.payment_intent),
    refunded: object.refunded === true,
    status: text(object.status),
    reason: text(object.reason),
    ...prunedCharge(object),
    charge:
      typeof charge === "string"
        ? charge
        : typeof charge === "object" && charge !== null
          ? {
              id: text(record(charge).id),
              object: text(record(charge).object),
              ...prunedCharge(record(charge)),
            }
          : null,
  };
}

// What `readCharge` reads of a charge, besides its id.
function prunedCharge(object: Record<string, unknown>): Record<string, unknown> {
  return {
    amount: count(object.amount),
    created: count(object.created),
    payment_method_details: {
      type: text(record(object.payment_method_details).type),
    },
    metadata: { invoiceId: text(record(object.metadata).invoiceId) },
  };
}

// A pruned event as the rules read it. Anything missing reads as nothing
// rather than failing: an event the app cannot use is recorded and left.
export function readStripeEvent(event: unknown): StripeEventReading {
  const raw = record(event);
  const type = text(raw.type) ?? "";
  const known = { eventId: text(raw.id), stripeType: type, created: count(raw.created) ?? 0 };
  const object = record(record(raw.data).object);
  if (type in SessionTypes)
    return {
      ...known,
      kind: "session",
      type: SessionTypes[type as keyof typeof SessionTypes],
      session: readSession(object),
    };
  if (type === "charge.refunded")
    return {
      ...known,
      kind: "refund",
      paymentIntentId: intentId(object.payment_intent),
      full: object.refunded === true,
      charge: readCharge(object),
    };
  if (type === "charge.dispute.closed")
    return {
      ...known,
      kind: "dispute",
      paymentIntentId: intentId(object.payment_intent),
      lost: object.status === "lost",
      reason: text(object.reason)?.replace(/_/g, " ") ?? null,
      chargeId: intentId(object.charge),
      charge: readCharge(object.charge),
    };
  return { ...known, kind: "other" };
}

function readSession(object: Record<string, unknown>): CheckoutSessionReading {
  const intent = object.payment_intent;
  const expanded = typeof intent === "object" && intent !== null ? record(intent) : null;
  const types = Array.isArray(object.payment_method_types) ? object.payment_method_types : [];
  return {
    id: text(object.id) ?? "",
    invoiceId: text(object.client_reference_id) ?? text(record(object.metadata).invoiceId),
    paymentIntentId: intentId(intent),
    method: methodOf(types[0]),
    amountCents: count(object.amount_total) ?? 0,
    status: text(object.status),
    paymentStatus: text(object.payment_status),
    paymentIntentStatus: expanded ? text(expanded.status) : null,
    failureMessage: expanded ? text(record(expanded.last_payment_error).message) : null,
  };
}

// A charge, as Stripe sends it or as the webhook fetched it; null for
// anything that is not one, such as a dispute's charge named only by its id.
export function readCharge(value: unknown): ChargeReading | null {
  const object = record(value);
  if (object.object !== "charge") return null;
  return {
    invoiceId: text(record(object.metadata).invoiceId),
    method: methodOf(record(object.payment_method_details).type),
    amountCents: count(object.amount) ?? 0,
    created: count(object.created) ?? 0,
  };
}

// Stripe's name for a way to pay, on a session or a charge, in the app's words.
export function methodOf(stripeType: unknown): PayMethod | null {
  return stripeType === "us_bank_account" ? "bank" : stripeType === "card" ? "card" : null;
}

// A payment intent or a charge named by its id, or expanded into the object.
function intentId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  return typeof value === "object" && value !== null ? text(record(value).id) : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
