import { describe, expect, it } from "vitest";

import {
  CardLimitNote,
  CardUpToCents,
  customerOnItsWay,
  customerReturned,
  ownerOnItsWay,
  PaidTwice,
  paidSentence,
  readZelleTag,
  shortDay,
  stripeEventDay,
  stripeNoteSentence,
  StripeMaximumCents,
  StripeMinimumCents,
  stripePaymentUrl,
  StripeRangeNote,
  waysToPay,
  zelleQrUrl,
} from "./pay-now";

describe("The ways to pay through Stripe", () => {
  it("offers the bank and the card up to exactly $1,000.00", () => {
    expect(CardUpToCents).toBe(100_000);
    expect(waysToPay(100_000)).toEqual(["bank", "card"]);
    expect(waysToPay(80_042)).toEqual(["bank", "card"]);
  });

  it("offers only the bank a cent over $1,000.00", () => {
    expect(waysToPay(100_001)).toEqual(["bank"]);
    expect(waysToPay(285_437)).toEqual(["bank"]);
  });

  it("says why the card is missing in words that name the same limit", () => {
    expect(CardLimitNote).toBe("Card is for invoices up to $1,000.");
  });

  it("offers neither under Stripe's $0.50 least charge, and both from it", () => {
    expect(StripeMinimumCents).toBe(50);
    expect(waysToPay(49)).toEqual([]);
    expect(waysToPay(50)).toEqual(["bank", "card"]);
  });

  it("offers the bank up to Stripe's $999,999.99 most charge, and neither a cent over", () => {
    expect(StripeMaximumCents).toBe(99_999_999);
    expect(waysToPay(99_999_999)).toEqual(["bank"]);
    expect(waysToPay(100_000_000)).toEqual([]);
  });

  it("says why bank and card are both missing in words that name the same range", () => {
    expect(StripeRangeNote).toBe("Bank and card are for invoices from $0.50 to $999,999.99.");
  });
});

describe("The Zelle tag", () => {
  it("takes 6 to 40 letters, digits and hyphens, and keeps it in lower case", () => {
    expect(readZelleTag("expandhandyman")).toBe("expandhandyman");
    expect(readZelleTag("  Expand-Handyman-2 ")).toBe("expand-handyman-2");
    expect(readZelleTag("abcdef")).toBe("abcdef");
    expect(readZelleTag("a".repeat(40))).toBe("a".repeat(40));
  });

  it("refuses a tag too short, too long, or with anything but letters, digits and hyphens", () => {
    expect(readZelleTag("abcde")).toBeNull();
    expect(readZelleTag("a".repeat(41))).toBeNull();
    expect(readZelleTag("expand handyman")).toBeNull();
    expect(readZelleTag("pay@expandhandyman.com")).toBeNull();
    expect(readZelleTag("expand_handyman")).toBeNull();
    expect(readZelleTag("")).toBeNull();
  });

  it("opens Zelle's page with exactly the string the bank's QR code carries for the tag", () => {
    expect(zelleQrUrl("expandhandyman")).toBe(
      "https://enroll.zellepay.com/qr-codes?data=eyJ0b2tlbiI6ImV4cGFuZGhhbmR5bWFuIiwibmFtZSI6IkVYUEFORCIsImFjdGlvbiI6IlBBWU1FTlQifQ==",
    );
  });
});

describe("A payment in Stripe's dashboard", () => {
  it("is under /test for a test-mode key", () => {
    expect(stripePaymentUrl("pi_3Q2abc", "sk_test_51abc")).toBe(
      "https://dashboard.stripe.com/test/payments/pi_3Q2abc",
    );
  });

  it("is the live account's for a live key, and for a deployment with no key at all", () => {
    expect(stripePaymentUrl("pi_3Q2abc", "sk_live_51abc")).toBe(
      "https://dashboard.stripe.com/payments/pi_3Q2abc",
    );
    expect(stripePaymentUrl("pi_3Q2abc", undefined)).toBe(
      "https://dashboard.stripe.com/payments/pi_3Q2abc",
    );
  });
});

describe("The day of a Stripe event", () => {
  it("is the Pacific calendar day of its created time, given in seconds", () => {
    // 8:30pm Pacific on 23 September 2026 is already the 24th in UTC.
    expect(stripeEventDay(Date.UTC(2026, 8, 24, 3, 30) / 1000)).toBe("2026-09-23");
    expect(stripeEventDay(Date.UTC(2026, 8, 24, 7, 0) / 1000)).toBe("2026-09-24");
  });
});

describe("A day as the panel and the bar say it", () => {
  it("names the month short and the day plainly", () => {
    expect(shortDay("2026-09-23")).toBe("Sept 23");
    expect(shortDay("2026-10-02")).toBe("Oct 2");
    expect(shortDay("2026-06-01")).toBe("June 1");
    expect(shortDay("2026-07-04")).toBe("July 4");
    expect(shortDay("2027-01-15")).toBe("Jan 15");
  });
});

describe("The panel's words", () => {
  it("reads every payment in one green sentence", () => {
    expect(
      paidSentence({ receivedOn: "2026-09-23", source: "stripe", method: "bank" }),
    ).toBe("Paid Sept 23, by bank through Stripe.");
    expect(
      paidSentence({ receivedOn: "2026-09-25", source: "stripe", method: "card" }),
    ).toBe("Paid Sept 25, by card through Stripe.");
    expect(paidSentence({ receivedOn: "2026-09-21", source: "owner" })).toBe(
      "Paid Sept 21, marked by you.",
    );
  });

  it("says when a Stripe payment landed on a void invoice, and what to do about it", () => {
    expect(
      paidSentence({ receivedOn: "2026-09-23", source: "stripe", method: "card" }, true),
    ).toBe("Paid Sept 23, by card through Stripe, on a void invoice. Refund it in Stripe.");
  });

  it("says when the money came twice", () => {
    expect(PaidTwice).toBe("Paid twice. Refund one in Stripe.");
  });

  it("tells the owner a bank payment is on its way, and that the invoice reads Paid once it confirms", () => {
    expect(ownerOnItsWay({ amountCents: 285_437, acceptedOn: "2026-09-23" })).toEqual({
      head: "Payment on its way.",
      body: "A bank payment of $2,854.37 was accepted Sept 23 through Stripe. Banks take up to 4 business days to confirm it, and the invoice reads Paid once they do.",
      unowed: null,
    });
  });

  it("tells the owner a bank payment on its way to a paid invoice would be paid twice", () => {
    const onItsWay = { amountCents: 285_437, acceptedOn: "2026-09-23" };
    expect(ownerOnItsWay(onItsWay, { paid: true, void: false })).toEqual({
      head: "Payment on its way.",
      body: "A bank payment of $2,854.37 was accepted Sept 23 through Stripe. Banks take up to 4 business days to confirm it.",
      unowed: "Already paid. Refund one in Stripe once this confirms.",
    });
  });

  it("tells the owner a bank payment on its way to a void invoice needs refunding, and never that it will read Paid", () => {
    const onItsWay = { amountCents: 285_437, acceptedOn: "2026-09-23" };
    const said = {
      head: "Payment on its way.",
      body: "A bank payment of $2,854.37 was accepted Sept 23 through Stripe. Banks take up to 4 business days to confirm it.",
      unowed: "The invoice is void. Refund this in Stripe once it confirms.",
    };
    expect(ownerOnItsWay(onItsWay, { paid: false, void: true })).toEqual(said);
    expect(ownerOnItsWay(onItsWay, { paid: true, void: true })).toEqual(said);
  });

  it("keeps a grey note of a returned payment, with the bank's reason", () => {
    const returned = {
      kind: "returned" as const,
      method: "bank" as const,
      amountCents: 285_437,
      acceptedOn: "2026-09-23",
      endedOn: "2026-09-26",
    };
    expect(stripeNoteSentence({ ...returned, reason: "insufficient funds" })).toBe(
      "Bank payment of $2,854.37 accepted Sept 23 was returned Sept 26: insufficient funds. The customer was emailed to pay again.",
    );
    expect(stripeNoteSentence({ ...returned, reason: "The account is closed. " })).toBe(
      "Bank payment of $2,854.37 accepted Sept 23 was returned Sept 26: The account is closed. The customer was emailed to pay again.",
    );
    expect(stripeNoteSentence({ ...returned, reason: null })).toBe(
      "Bank payment of $2,854.37 accepted Sept 23 was returned Sept 26. The customer was emailed to pay again.",
    );
  });

  it("says the customer was emailed only when the letter went, or before its send has run", () => {
    const returned = {
      kind: "returned" as const,
      method: "bank" as const,
      amountCents: 285_437,
      acceptedOn: "2026-09-23",
      endedOn: "2026-09-26",
      reason: "insufficient funds",
    };
    const emailed =
      "Bank payment of $2,854.37 accepted Sept 23 was returned Sept 26: insufficient funds. The customer was emailed to pay again.";
    expect(stripeNoteSentence({ ...returned, customerEmailed: true })).toBe(emailed);
    expect(stripeNoteSentence({ ...returned, customerEmailed: null })).toBe(emailed);
    expect(stripeNoteSentence({ ...returned, customerEmailed: false })).toBe(
      "Bank payment of $2,854.37 accepted Sept 23 was returned Sept 26: insufficient funds. The customer could not be emailed. Ask them to pay again.",
    );
  });

  it("keeps a grey note of a refund and of a lost dispute", () => {
    expect(
      stripeNoteSentence({
        kind: "refunded",
        method: "card",
        amountCents: 80_042,
        acceptedOn: "2026-09-23",
        endedOn: "2026-10-02",
        reason: null,
      }),
    ).toBe("Card payment of $800.42 from Sept 23 was refunded Oct 2 in Stripe.");
    expect(
      stripeNoteSentence({
        kind: "dispute_lost",
        method: "bank",
        amountCents: 80_042,
        acceptedOn: "2026-09-23",
        endedOn: "2026-10-02",
        reason: "fraudulent",
      }),
    ).toBe("The dispute on the bank payment of $800.42 from Sept 23 was lost Oct 2.");
  });
});

describe("The invoice link's words", () => {
  it("tells the customer their bank payment is on its way, in the row and where the button was", () => {
    expect(customerOnItsWay({ amountCents: 285_437, acceptedOn: "2026-09-23" })).toEqual({
      head: "Payment on its way",
      row: "bank payment of $2,854.37 accepted Sept 23.",
      help: "Your bank payment of $2,854.37 is on its way. Banks take up to 4 business days to confirm it, and this invoice will read Paid once they do.",
    });
  });

  it("tells the customer their bank returned the payment, with no reason", () => {
    expect(customerReturned({ amountCents: 285_437, acceptedOn: "2026-09-23" })).toBe(
      "Your bank returned the payment of $2,854.37 from Sept 23. You can pay again below, or by Zelle or check as How to pay says.",
    );
  });
});
