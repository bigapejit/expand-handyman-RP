import { pacificDay } from "./invoice-standing";
import { formatCents, formatCentsExact } from "./money";

// **Pay now** (CONTEXT.md) as rules and words: which ways to pay the Pay
// sheet offers, the **Zelle tag** and the address Zelle's own page opens
// for it, where a Stripe payment lives in Stripe's dashboard, the notes under
// the Pay sheet's rows, and every sentence the panel and the invoice link's
// bar say about a payment, in the words spec #121 settled. Pure, so the
// server, the pages and the tests read the one wording. The Zelle and check
// steps are instructions rather than words about a payment, and stay with the
// sheet that shows them (components/pay-bar.tsx).

// How Stripe moved the money: from a checking account or on a card.
export type PayMethod = "bank" | "card";

// The largest Amount Due, in cents, that Pay by card is offered for: $1,000.
// Above it the bank is the one way through Stripe, at the same price, since
// neither carries a fee.
export const CardUpToCents = 100_000;

// The ways the Pay sheet sends to Stripe, in the order it lists them: the
// bank always, the card only while the Amount Due is $1,000.00 or less. Who
// may pay at all (a sent invoice, something due, nothing paid or on its way)
// is the link's question, not this one.
export function waysToPay(amountDueCents: number): PayMethod[] {
  return amountDueCents <= CardUpToCents ? ["bank", "card"] : ["bank"];
}

// Under the Pay sheet's rows, whichever ways it lists: the price on the paper
// is the price, however it is paid.
export const NoFeeNote = "No fee on any of them.";

// Why the Pay sheet has no card row, and the refusal when a card is asked for
// anyway: the sheet and the server say the one sentence, and it names the
// limit the rule above keeps, so the two never disagree.
export const CardLimitNote = `Card is for invoices up to ${formatCents(CardUpToCents, "en-US")}.`;

// Zelle's own rule for a tag: 6 to 40 characters, letters, digits and
// hyphens, and case does not matter.
const ZelleTagPattern = /^[a-z0-9-]{6,40}$/i;

// What the Zelle tag setting says when a typed tag breaks the rule.
export const ZelleTagRule =
  "A Zelle tag is 6 to 40 letters, digits and hyphens, like expandhandyman.";

// A typed tag as it is kept, in lower case since Zelle ignores case, or null
// when it is not a tag Zelle would accept. The paper prints it to every
// customer, so a tag Zelle would refuse is never saved.
export function readZelleTag(typed: string): string | null {
  const tag = typed.trim();
  return ZelleTagPattern.test(tag) ? tag.toLowerCase() : null;
}

// What the "Try opening it in your bank's app" button opens: Zelle's find
// your bank page with the payee in its `data`, the string the bank's own QR
// code for the tag decodes to, byte for byte (docs/research/
// zelle-on-the-invoice.md on research/zelle-on-the-invoice). The name is the
// one the bank's code carries; the page never shows it.
export function zelleQrUrl(tag: string): string {
  const data = btoa(JSON.stringify({ token: tag, name: "EXPAND", action: "PAYMENT" }));
  return `https://enroll.zellepay.com/qr-codes?data=${data}`;
}

// A Stripe payment in Stripe's dashboard, for the owner's "See it in Stripe".
// A test-mode key's payments live under `/test`, so the dev deployment's links
// open the sandbox and production's open the live account.
export function stripePaymentUrl(
  paymentIntentId: string,
  secretKey: string | null | undefined,
): string {
  const mode = secretKey?.startsWith("sk_test_") ? "/test" : "";
  return `https://dashboard.stripe.com${mode}/payments/${encodeURIComponent(paymentIntentId)}`;
}

// The Pacific day a Stripe event happened, from its `created`, which Stripe
// gives in seconds: a payment's day is the day its confirming event came,
// never the day the customer pressed Pay.
export function stripeEventDay(createdSeconds: number): string {
  return pacificDay(createdSeconds * 1000);
}

const Months = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

// A Pacific day as the panel and the bar say it, "Sept 23". The paper keeps
// its own "9/23/2026" (lib/invoice-paper.ts, `stampDate`).
export function shortDay(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${Months[month - 1]} ${date}`;
}

// ── The panel ─────────────────────────────────────────────────────────────

// One payment as the panel's green sentence reads it, the same shape for
// every way money arrives: the day, then who or what recorded it and, for
// Stripe's, how the money moved. A Stripe payment on a void invoice says so
// and what to do about it; the owner's never meets a void invoice, since Void
// is refused while it stands.
export function paidSentence(
  payment: { receivedOn: string; source: "owner" | "stripe"; method?: PayMethod | null },
  onVoidInvoice = false,
): string {
  const day = shortDay(payment.receivedOn);
  if (payment.source === "owner") return `Paid ${day}, marked by you.`;
  const how = payment.method ? `by ${payment.method} through Stripe` : "through Stripe";
  return onVoidInvoice
    ? `Paid ${day}, ${how}, on a void invoice. Refund it in Stripe.`
    : `Paid ${day}, ${how}.`;
}

// Under the sentences when an invoice holds more than one payment: money the
// customer sent twice, which only Stripe can send back.
export const PaidTwice = "Paid twice. Refund one in Stripe.";

// A bank payment Stripe accepted and the bank has not yet confirmed, as the
// owner's amber box reads it: the bold head, then the rest.
export function ownerOnItsWay(onItsWay: { amountCents: number; acceptedOn: string }): {
  head: string;
  body: string;
} {
  const amount = formatCentsExact(onItsWay.amountCents);
  return {
    head: "Payment on its way.",
    body: `A bank payment of ${amount} was accepted ${shortDay(onItsWay.acceptedOn)} through Stripe. Banks take up to 4 business days to confirm it, and the invoice reads Paid once they do.`,
  };
}

// Why an invoice is unpaid again after Stripe had its money, as the panel's
// grey note reads it until the invoice is paid, on its way again or void. The
// reason is the bank's or Stripe's own words, shown only to the owner.
export type StripeNote = {
  kind: "returned" | "refunded" | "dispute_lost";
  method: PayMethod;
  amountCents: number;
  acceptedOn: string;
  endedOn: string;
  reason: string | null;
};

export function stripeNoteSentence(note: StripeNote): string {
  const amount = formatCentsExact(note.amountCents);
  const accepted = shortDay(note.acceptedOn);
  const ended = shortDay(note.endedOn);
  switch (note.kind) {
    case "returned": {
      // The reason ends the clause, whatever Stripe ended its own words with.
      const reason = note.reason?.trim().replace(/[.\s]+$/, "");
      return `${capitalized(note.method)} payment of ${amount} accepted ${accepted} was returned ${ended}${reason ? `: ${reason}` : ""}. The customer was emailed to pay again.`;
    }
    case "refunded":
      return `${capitalized(note.method)} payment of ${amount} from ${accepted} was refunded ${ended} in Stripe.`;
    case "dispute_lost":
      return `The dispute on the ${note.method} payment of ${amount} from ${accepted} was lost ${ended}.`;
  }
}

// ── The invoice link's bar ────────────────────────────────────────────────

// A bank payment on its way, as the customer reads it: the row's bold head
// and the rest of the row, and the sentence where the Pay button was, so
// nobody pays twice.
export function customerOnItsWay(onItsWay: { amountCents: number; acceptedOn: string }): {
  head: string;
  row: string;
  help: string;
} {
  const amount = formatCentsExact(onItsWay.amountCents);
  return {
    head: "Payment on its way",
    row: `bank payment of ${amount} accepted ${shortDay(onItsWay.acceptedOn)}.`,
    help: `Your bank payment of ${amount} is on its way. Banks take up to 4 business days to confirm it, and this invoice will read Paid once they do.`,
  };
}

// A **Returned payment**, as the customer reads it above the unpaid bar: no
// reason, which is between the bank and the owner, only that it did not go
// through and how to pay again.
export function customerReturned(returned: { amountCents: number; acceptedOn: string }): string {
  return `Your bank returned the payment of ${formatCentsExact(returned.amountCents)} from ${shortDay(returned.acceptedOn)}. You can pay again below, or by Zelle or check as How to pay says.`;
}

function capitalized(method: PayMethod): string {
  return method === "bank" ? "Bank" : "Card";
}
