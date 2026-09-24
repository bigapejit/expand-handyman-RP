import { describe, expect, it } from "vitest";

import { methodOf, prunedStripeEvent, readStripeEvent } from "./stripe-events";

const bankSession = {
  id: "cs_test_1",
  object: "checkout.session",
  status: "complete",
  payment_status: "unpaid",
  payment_method_types: ["us_bank_account"],
  amount_total: 285_437,
  client_reference_id: "k57invoice",
  customer_details: { email: "jane@example.com", name: "Jane Doe" },
  metadata: { invoiceId: "k57invoice", invoiceNumber: "INV-1004", $other: "x", "café": "y" },
  payment_intent: "pi_test_1",
};

const event = (type: string, object: Record<string, unknown>) => ({
  id: "evt_test_1",
  object: "event",
  type,
  created: 1_790_190_000,
  livemode: false,
  request: { id: null, idempotency_key: null },
  data: { object, previous_attributes: { status: "open" } },
});

describe("A Stripe event pruned for the mutation", () => {
  it("keeps only what the rules read, so metadata another integration wrote never reaches Convex", () => {
    expect(prunedStripeEvent(event("checkout.session.completed", bankSession))).toEqual({
      id: "evt_test_1",
      type: "checkout.session.completed",
      created: 1_790_190_000,
      data: {
        object: {
          id: "cs_test_1",
          object: "checkout.session",
          status: "complete",
          payment_status: "unpaid",
          payment_method_types: ["us_bank_account"],
          amount_total: 285_437,
          client_reference_id: "k57invoice",
          metadata: { invoiceId: "k57invoice", invoiceNumber: "INV-1004" },
          payment_intent: "pi_test_1",
        },
      },
    });
  });

  it("keeps an expanded payment intent's state and the bank's words, and nothing else of it", () => {
    const pruned = prunedStripeEvent(
      event("checkout.session.completed", {
        ...bankSession,
        payment_intent: {
          id: "pi_test_1",
          object: "payment_intent",
          status: "requires_payment_method",
          client_secret: "pi_test_1_secret",
          last_payment_error: { code: "insufficient_funds", message: "insufficient funds" },
        },
      }),
    );
    expect((pruned.data as { object: { payment_intent: unknown } }).object.payment_intent).toEqual(
      {
        id: "pi_test_1",
        status: "requires_payment_method",
        last_payment_error: { message: "insufficient funds" },
      },
    );
  });

  it("reads the same pruned as whole", () => {
    const whole = event("checkout.session.completed", bankSession);
    expect(readStripeEvent(prunedStripeEvent(whole))).toEqual(readStripeEvent(whole));
  });
});

describe("A Stripe event as the rules read it", () => {
  it("reads a session's invoice, payment intent, method and amount", () => {
    expect(readStripeEvent(event("checkout.session.async_payment_failed", bankSession))).toEqual({
      eventId: "evt_test_1",
      stripeType: "checkout.session.async_payment_failed",
      created: 1_790_190_000,
      kind: "session",
      type: "async_failed",
      session: {
        id: "cs_test_1",
        invoiceId: "k57invoice",
        paymentIntentId: "pi_test_1",
        method: "bank",
        amountCents: 285_437,
        status: "complete",
        paymentStatus: "unpaid",
        paymentIntentStatus: null,
        failureMessage: null,
      },
    });
  });

  it("falls back to the metadata's invoice when the reference is missing", () => {
    const reading = readStripeEvent(
      event("checkout.session.completed", { ...bankSession, client_reference_id: null }),
    );
    expect(reading.kind === "session" && reading.session.invoiceId).toBe("k57invoice");
  });

  it("tells a full refund from a partial one", () => {
    const refund = (refunded: boolean) =>
      readStripeEvent(
        event("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_1", refunded }),
      );
    expect(refund(true)).toMatchObject({ kind: "refund", paymentIntentId: "pi_1", full: true });
    expect(refund(false)).toMatchObject({ kind: "refund", full: false });
  });

  it("reads a closed dispute's outcome and its reason in words", () => {
    const closed = (status: string) =>
      readStripeEvent(
        event("charge.dispute.closed", {
          id: "dp_1",
          object: "dispute",
          payment_intent: "pi_1",
          status,
          reason: "insufficient_funds",
        }),
      );
    expect(closed("lost")).toMatchObject({
      kind: "dispute",
      paymentIntentId: "pi_1",
      lost: true,
      reason: "insufficient funds",
    });
    expect(closed("won")).toMatchObject({ kind: "dispute", lost: false });
  });

  it("reads every other event as one to record and leave", () => {
    expect(
      readStripeEvent(event("payment_intent.processing", { id: "pi_1", object: "payment_intent" })),
    ).toEqual({
      eventId: "evt_test_1",
      stripeType: "payment_intent.processing",
      created: 1_790_190_000,
      kind: "other",
    });
    expect(readStripeEvent(null)).toEqual({
      eventId: null,
      stripeType: "",
      created: 0,
      kind: "other",
    });
  });
});

describe("How Stripe moved the money", () => {
  it("is the bank for a US bank account, the card for a card, and nothing the app minted otherwise", () => {
    expect(methodOf("us_bank_account")).toBe("bank");
    expect(methodOf("card")).toBe("card");
    expect(methodOf("link")).toBeNull();
    expect(methodOf(undefined)).toBeNull();
  });
});
