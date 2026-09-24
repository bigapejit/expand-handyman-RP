import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import Stripe from "stripe";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { pacificDay } from "../lib/invoice-standing";
import { stripeNoteSentence } from "../lib/pay-now";
import { SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// DOR's answer for a Vancouver address: 8.9% at location 0605.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

// A moment in Pacific daylight time, UTC-7.
const pdt = (month: number, day: number, hour = 12, minute = 0) =>
  Date.UTC(2026, month - 1, day, hour + 7, minute);
// The same moment as Stripe stamps an event: seconds since the epoch.
const seconds = (ms: number) => Math.floor(ms / 1000);

const WebhookSecret = "whsec_test_expand";

// Outbound HTTP, stubbed at fetch. Stripe's API answers from `stripeAnswer`,
// by default a fresh session for every create and the sessions, payment
// intents and charges a test has put in `sessions`, `intents` and `charges`;
// every call to it is kept, form fields decoded, to be asserted on. Resend
// answers with an id and every letter is kept; DOR answers with Vancouver's
// rate.
type StripeCall = {
  method: string;
  path: string;
  headers: Record<string, string>;
  params: Record<string, string>;
};
let stripeCalls: StripeCall[];
let stripeAnswer: (call: StripeCall) => Response;
let sessions: Map<string, Record<string, unknown>>;
let intents: Map<string, Record<string, unknown>>;
let charges: Map<string, Record<string, unknown>>;
let resendCalls: { headers: Record<string, string>; body: Record<string, unknown> }[];

const stripeError = (status: number, message: string) =>
  Response.json({ error: { type: "invalid_request_error", message } }, { status });

function defaultStripeAnswer(call: StripeCall): Response {
  if (call.method === "POST" && call.path === "/v1/checkout/sessions")
    return Response.json({
      id: "cs_test_minted",
      object: "checkout.session",
      url: "https://checkout.stripe.com/c/pay/cs_test_minted",
    });
  const session = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(call.path);
  if (call.method === "GET" && session) {
    const found = sessions.get(decodeURIComponent(session[1]));
    return found ? Response.json(found) : stripeError(404, "No such checkout.session");
  }
  const intent = /^\/v1\/payment_intents\/([^/]+)$/.exec(call.path);
  if (call.method === "GET" && intent) {
    const found = intents.get(decodeURIComponent(intent[1]));
    return found ? Response.json(found) : stripeError(404, "No such payment_intent");
  }
  const charge = /^\/v1\/charges\/([^/]+)$/.exec(call.path);
  if (call.method === "GET" && charge) {
    const found = charges.get(decodeURIComponent(charge[1]));
    return found ? Response.json(found) : stripeError(404, "No such charge");
  }
  return stripeError(400, `Unexpected ${call.method} ${call.path}`);
}

beforeEach(() => {
  // Noon Pacific on 1 September 2026. Time only moves when a test moves it,
  // so the Overdue boundary and every Pacific day are exact.
  vi.useFakeTimers();
  vi.setSystemTime(pdt(9, 1));
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("APP_ORIGIN", "https://staff.expandhandyman.com");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("EMAIL_REPLY_TO", "");
  // The dev deployment's keys, in Stripe's test mode.
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_51expand");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WebhookSecret);
  stripeCalls = [];
  stripeAnswer = defaultStripeAnswer;
  sessions = new Map();
  intents = new Map();
  charges = new Map();
  resendCalls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.stripe.com")) {
      const address = new URL(url);
      const form = init?.body ? String(init.body) : address.search.slice(1);
      const call = {
        method: init?.method ?? "GET",
        path: address.pathname,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        params: Object.fromEntries(new URLSearchParams(form)),
      };
      stripeCalls.push(call);
      return stripeAnswer(call);
    }
    if (url.startsWith("https://api.resend.com/")) {
      resendCalls.push({
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({ id: `resend-message-${resendCalls.length}` });
    }
    return new Response(vancouverRate, { status: 200, headers: { "content-type": "text/xml" } });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// A refusal's data. Through an action, convex-test hands a ConvexError's data
// on as JSON rather than as the object; the client reads either.
async function refusal(pending: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await pending;
  } catch (error) {
    let data = (error as { data?: unknown }).data;
    while (typeof data === "string") data = JSON.parse(data);
    return data as Record<string, unknown>;
  }
  throw new Error("Expected a refusal.");
}

// **Pay now** where it meets Stripe, through the Convex API as a link holder
// and the owner, and through the webhook route: minting a Checkout Session,
// the success return, every event `applyStripeEvent` acts on, the Returned
// payment letters and what the invoice link's page says of it all. Stripe is
// stubbed at fetch; its events are built here in Stripe's own shape. The
// fixture is tests/stripe-standing.test.ts's.
function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
    name: "Andrew Putilin",
  });
  const customer = (name = "Maria Delgado", email = "maria@example.com") =>
    t.run((ctx) => ctx.db.insert("customers", { name, email, phone: "" }));
  let sites = 0;
  const site = (customerId: Id<"customers">) =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: `1300FRANKLIN${++sites}`,
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: `place-${sites}`,
        latitude: 45.63,
        longitude: -122.67,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
  const deliver = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  // An approved proposal and the deposit invoice Approve made and sent,
  // INV-1001: $299.48 due, half of $598.95 with Washington's 8.9%.
  const approved = async () => {
    const siteId = await site(await customer());
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title: "Fix gate" });
    await owner.mutation(api.solutions.update, {
      solutionId,
      description: "Rehang the gate.",
      lineItems: [{ name: "Gate labor", quantity: 2, unitCostCents: 25_000, unit: "HR" }],
    });
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [solutionId] });
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    const token = (await t.run((ctx) => ctx.db.query("signingLinks").collect())).find(
      (link) => link.proposalId === proposalId && link.endedAt === undefined,
    )?.token;
    if (!token) throw new Error("No live link.");
    await t.action(api.proposals.approve, {
      token,
      signerName: "Maria Delgado",
      consentTicked: true,
      noticeTicked: false,
      consentWordingVersion: SigningConsent.version,
      noticeWordingVersion: WashingtonNoticeToCustomer.version,
    });
    await deliver();
    const invoice = (await t.run((ctx) => ctx.db.query("invoices").collect())).find(
      (i) => i.proposalId === proposalId,
    );
    if (!invoice) throw new Error("No deposit invoice.");
    const link = (await t.run((ctx) => ctx.db.query("invoiceLinks").collect())).find(
      (l) => l.invoiceId === invoice._id,
    );
    if (!link) throw new Error("No invoice link.");
    resendCalls = [];
    return { siteId, proposalId, invoiceId: invoice._id, token: link.token };
  };
  // A sent invoice written straight in beside the proposal's, with its own
  // live link, for the amounts the deposit is not: $0, and either side of
  // the card's $1,000.
  let written = 0;
  const sentInvoice = (proposalId: Id<"proposals">, over: Partial<Doc<"invoices">>) =>
    t.run(async (ctx) => {
      const proposal = (await ctx.db.get(proposalId))!;
      const site = (await ctx.db.get(proposal.siteId))!;
      const invoiceId = await ctx.db.insert("invoices", {
        proposalId,
        siteId: site._id,
        customerId: site.customerId,
        kind: "typed",
        state: "sent",
        lines: [],
        taxRate: 0,
        number: 2000 + ++written,
        sentAt: Date.now(),
        frozen: {
          customerName: "Maria Delgado",
          site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
          proposalCode: "1300FRANKLIN1-P1",
          proposalName: "Fix gate",
          sentTo: "maria@example.com",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...over,
      });
      const token = `written-invoice-link-${written}`.padEnd(43, "x");
      await ctx.db.insert("invoiceLinks", {
        invoiceId,
        token,
        sentTo: "maria@example.com",
        sentAt: Date.now(),
      });
      return { invoiceId, token };
    });
  const pay = (token: string, method: "bank" | "card") =>
    t.action(api.stripePayments.mintCheckoutSession, { token, method });

  // Stripe's objects and events, as the webhook receives them. A session is
  // a card payment already paid unless told otherwise; `bankSession` is one
  // the bank has accepted and not yet confirmed.
  const session = (invoiceId: Id<"invoices">, over: Record<string, unknown> = {}) => ({
    id: "cs_test_1",
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    payment_method_types: ["card"],
    amount_total: 29_948,
    currency: "usd",
    client_reference_id: invoiceId,
    customer_email: "maria@example.com",
    metadata: { invoiceId, invoiceNumber: "INV-1001" },
    payment_intent: "pi_test_1",
    ...over,
  });
  const bankSession = (invoiceId: Id<"invoices">, over: Record<string, unknown> = {}) =>
    session(invoiceId, {
      payment_status: "unpaid",
      payment_method_types: ["us_bank_account"],
      ...over,
    });
  let events = 0;
  const event = (type: string, object: Record<string, unknown>, at = Date.now()) => ({
    id: `evt_test_${++events}`,
    object: "event",
    type,
    created: seconds(at),
    livemode: false,
    data: { object },
  });
  // A card charge, refunded in full unless told otherwise, made the moment
  // the fixture's clock reads; `paidCharge` is one a Pay now made, carrying
  // the metadata Stripe copies from the payment intent.
  const charge = (over: Record<string, unknown> = {}) => ({
    id: "ch_test_1",
    object: "charge",
    payment_intent: "pi_test_1",
    amount: 29_948,
    amount_refunded: 29_948,
    refunded: true,
    created: seconds(Date.now()),
    payment_method_details: { type: "card" },
    metadata: {},
    ...over,
  });
  const paidCharge = (invoiceId: Id<"invoices">, over: Record<string, unknown> = {}) =>
    charge({ metadata: { invoiceId, invoiceNumber: "INV-1001" }, ...over });
  const dispute = (over: Record<string, unknown> = {}) => ({
    id: "dp_test_1",
    object: "dispute",
    charge: "ch_test_1",
    payment_intent: "pi_test_1",
    status: "lost",
    reason: "insufficient_funds",
    ...over,
  });
  const apply = (stripeEvent: Record<string, unknown>, failureReason?: string) =>
    t.mutation(internal.stripePayments.applyStripeEvent, {
      event: stripeEvent,
      ...(failureReason ? { failureReason } : {}),
    });
  // A delivery to the webhook route, signed with the destination's secret
  // unless a header is given.
  const post = async (body: string, signature?: string) =>
    t.fetch("/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature":
          signature ??
          (await Stripe.webhooks.generateTestHeaderStringAsync({
            payload: body,
            secret: WebhookSecret,
            cryptoProvider: Stripe.createSubtleCryptoProvider(),
          })),
      },
      body,
    });

  const today = () => pacificDay(Date.now());
  const list = (filter: "unpaid" | "overdue" | "paid" | "all") =>
    owner.query(api.invoices.list, { filter, today: today() });
  const panel = (invoiceId: Id<"invoices">) =>
    owner.query(api.invoices.panel, { invoiceId, today: today() });
  const page = (token: string) => t.query(api.invoiceLinks.page, { token });
  const paymentsOf = (invoiceId: Id<"invoices">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("payments").collect()).filter((p) => p.invoiceId === invoiceId),
    );
  const stripeRows = () => t.run((ctx) => ctx.db.query("stripePayments").collect());
  const stripeEvents = () => t.run((ctx) => ctx.db.query("stripeEvents").collect());
  // A PDF copy of the invoice as it stands, as a Download would have kept it.
  const pdfCopy = (invoiceId: Id<"invoices">, paperState: "sent" | "paid" | "void") =>
    t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["%PDF-1.7"]));
      await ctx.db.patch(invoiceId, {
        pdfCopy: { storageId, paperState, renderedAt: Date.now() },
      });
      return storageId;
    });
  const pdfCopyKept = (invoiceId: Id<"invoices">, storageId: Id<"_storage">) =>
    t.run(async (ctx) => {
      const invoice = await ctx.db.get(invoiceId);
      return Boolean(invoice?.pdfCopy) && (await ctx.storage.get(storageId)) !== null;
    });
  const letters = (letter: string) =>
    resendCalls.filter((call) =>
      (call.body.tags as { name: string; value: string }[]).some(
        (tag) => tag.name === "letter" && tag.value === letter,
      ),
    );
  return {
    t,
    owner,
    customer,
    approved,
    sentInvoice,
    pay,
    session,
    bankSession,
    event,
    charge,
    paidCharge,
    dispute,
    apply,
    post,
    deliver,
    today,
    list,
    panel,
    page,
    paymentsOf,
    stripeRows,
    stripeEvents,
    pdfCopy,
    pdfCopyKept,
    letters,
  };
}

describe("Pay by bank", () => {
  test("sends Stripe one session for the full Amount Due, verified instantly, and returns Stripe's page", async () => {
    const { pay, approved, stripeRows } = fixture();
    const { invoiceId, token } = await approved();

    expect(await pay(token, "bank")).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test_minted",
    });

    expect(stripeCalls).toHaveLength(1);
    const [call] = stripeCalls;
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v1/checkout/sessions");
    expect(call.headers.authorization).toBe("Bearer sk_test_51expand");
    const link = `https://staff.expandhandyman.com/sign/${token}`;
    expect(call.params).toEqual({
      mode: "payment",
      submit_type: "pay",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "29948",
      "line_items[0][price_data][product_data][name]": "Invoice INV-1001",
      "payment_method_types[0]": "us_bank_account",
      "payment_method_options[us_bank_account][verification_method]": "instant",
      "payment_method_options[us_bank_account][financial_connections][permissions][0]":
        "payment_method",
      customer_email: "maria@example.com",
      client_reference_id: invoiceId,
      "metadata[invoiceId]": invoiceId,
      "metadata[invoiceNumber]": "INV-1001",
      "payment_intent_data[description]": "Invoice INV-1001, Expand Handyman",
      "payment_intent_data[metadata][invoiceId]": invoiceId,
      "payment_intent_data[metadata][invoiceNumber]": "INV-1001",
      // Thirty minutes from now in Stripe's seconds, and a minute's margin so
      // Stripe's clock never finds it under its thirty-minute floor.
      expires_at: String(seconds(Date.now()) + 31 * 60),
      success_url: `${link}?session={CHECKOUT_SESSION_ID}`,
      cancel_url: link,
    });
    // Minting writes nothing: no row exists before the session completes.
    expect(await stripeRows()).toEqual([]);
  });
});

describe("Pay by card", () => {
  test("sends a card session, with no bank options", async () => {
    const { pay, approved } = fixture();
    const { token } = await approved();
    await pay(token, "card");
    const [call] = stripeCalls;
    expect(call.params["payment_method_types[0]"]).toBe("card");
    expect(call.params["payment_method_types[1]"]).toBeUndefined();
    expect(
      Object.keys(call.params).filter((key) => key.startsWith("payment_method_options")),
    ).toEqual([]);
    expect(call.params["line_items[0][price_data][unit_amount]"]).toBe("29948");
  });

  test("is offered up to $1,000.00 exactly and refused a cent over, where the bank still goes", async () => {
    const { pay, approved, sentInvoice, page } = fixture();
    const { proposalId } = await approved();
    const atLimit = await sentInvoice(proposalId, {
      lines: [{ description: "Fence", cents: 100_000 }],
    });
    const over = await sentInvoice(proposalId, {
      lines: [{ description: "Fence", cents: 100_001 }],
    });

    expect((await page(atLimit.token))?.ways).toEqual(["bank", "card"]);
    expect((await page(over.token))?.ways).toEqual(["bank"]);
    await pay(atLimit.token, "card");
    expect(await refusal(pay(over.token, "card"))).toEqual({
      code: "card_limit",
      message: "Card is for invoices up to $1,000.",
    });
    await pay(over.token, "bank");
    expect(stripeCalls.map((call) => call.params["payment_method_types[0]"])).toEqual([
      "card",
      "us_bank_account",
    ]);
  });
});

describe("Pay now refused", () => {
  test("on an ended link, a draft, a void, a $0 or a paid invoice, and one with a payment on its way, without asking Stripe", async () => {
    const { t, owner, pay, page, approved, sentInvoice, apply, event, bankSession } = fixture();
    const { proposalId, invoiceId, token } = await approved();

    const nothingDue = await sentInvoice(proposalId, { lines: [] });
    expect(await refusal(pay(nothingDue.token, "bank"))).toEqual({
      code: "nothing_due",
      message: "Nothing is due on this invoice.",
    });
    const credit = await sentInvoice(proposalId, {
      lines: [{ description: "Credit", cents: -5_000 }],
    });
    expect((await refusal(pay(credit.token, "bank"))).code).toBe("nothing_due");
    // Nothing is owed, so the link shows no bar at all.
    expect(await page(credit.token)).toMatchObject({ payable: false, ways: [] });

    const draft = await sentInvoice(proposalId, {
      state: "draft",
      lines: [{ description: "Extra", cents: 10_000 }],
    });
    const ended = { code: "link_ended", message: "This link is no longer live." };
    expect(await refusal(pay(draft.token, "bank"))).toEqual(ended);
    expect(await refusal(pay("no-such-link-".padEnd(43, "x"), "bank"))).toEqual(ended);

    const paid = await sentInvoice(proposalId, {
      lines: [{ description: "Extra", cents: 10_000 }],
    });
    await owner.mutation(api.invoices.markPaid, { invoiceId: paid.invoiceId });
    expect(await refusal(pay(paid.token, "card"))).toEqual({
      code: "paid",
      message: "This invoice is already paid.",
    });

    const voided = await sentInvoice(proposalId, {
      lines: [{ description: "Extra", cents: 10_000 }],
    });
    await owner.mutation(api.invoices.voidInvoice, { invoiceId: voided.invoiceId });
    expect(await refusal(pay(voided.token, "card"))).toEqual({
      code: "void",
      message: "This invoice was voided, so nothing is due on it.",
    });

    await apply(event("checkout.session.completed", bankSession(invoiceId)));
    expect(await refusal(pay(token, "bank"))).toEqual({
      code: "on_its_way",
      message: "A bank payment for this invoice is already on its way.",
    });

    // A re-send ends the link the first email carried.
    await t.run(async (ctx) => {
      const link = (await ctx.db.query("invoiceLinks").collect()).find(
        (l) => l.token === nothingDue.token,
      )!;
      await ctx.db.patch(link._id, { endedAt: Date.now(), endedReason: "resent" });
    });
    expect(await refusal(pay(nothingDue.token, "bank"))).toEqual(ended);

    expect(stripeCalls).toEqual([]);
  });

  test("outside the $0.50 to $999,999.99 Stripe will charge, where the sheet still opens for Zelle and check", async () => {
    const { pay, approved, sentInvoice, page } = fixture();
    const { proposalId } = await approved();
    const tooSmall = await sentInvoice(proposalId, {
      lines: [{ description: "Washer", cents: 49 }],
    });
    const tooLarge = await sentInvoice(proposalId, {
      lines: [{ description: "Estate", cents: 100_000_000 }],
    });
    const outOfRange = {
      code: "stripe_range",
      message: "Bank and card are for invoices from $0.50 to $999,999.99.",
    };

    for (const { token } of [tooSmall, tooLarge]) {
      expect(await page(token)).toMatchObject({ payable: true, ways: [] });
      expect(await refusal(pay(token, "bank"))).toEqual(outOfRange);
      expect(await refusal(pay(token, "card"))).toEqual(outOfRange);
    }
    expect(stripeCalls).toEqual([]);
  });

  test("with a plain sentence where the deployment has no Stripe key or no app origin", async () => {
    const { pay, approved, page } = fixture();
    const { token } = await approved();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notSetUp = {
      code: "stripe_not_set_up",
      message:
        "Paying by bank or card is not switched on yet. Please pay by Zelle or check as How to pay says.",
    };
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(await refusal(pay(token, "bank"))).toEqual(notSetUp);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_51expand");
    vi.stubEnv("APP_ORIGIN", "");
    expect(await refusal(pay(token, "card"))).toEqual(notSetUp);
    expect(stripeCalls).toEqual([]);
    // The rest of the link carries on without Stripe.
    expect((await page(token))?.paper.number).toBe("INV-1001");
  });

  test("with a sentence of its own when Stripe turns the session down", async () => {
    const { pay, approved } = fixture();
    const { token } = await approved();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripeAnswer = () => stripeError(400, "This account cannot take bank payments.");
    expect(await refusal(pay(token, "bank"))).toEqual({
      code: "stripe_unavailable",
      message:
        "Stripe could not open its page just now. Please try again in a minute, or pay by Zelle or check.",
    });
  });
});

describe("A card payment Stripe completed", () => {
  test("records a Stripe payment on the Pacific day of the event, and the invoice reads Paid, stamp and all", async () => {
    const { apply, event, session, approved, paymentsOf, stripeRows, list, page, panel } =
      fixture();
    const { invoiceId, token } = await approved();

    // Half past eleven at night in Vancouver is already the 4th in UTC.
    vi.setSystemTime(pdt(9, 3, 23, 30));
    await apply(event("checkout.session.completed", session(invoiceId)));

    const [payment] = await paymentsOf(invoiceId);
    expect(payment).toMatchObject({
      receivedOn: "2026-09-03",
      source: "stripe",
      recordedBy: "stripe",
      method: "card",
      stripePaymentIntentId: "pi_test_1",
    });
    expect(await stripeRows()).toMatchObject([
      {
        invoiceId,
        stripeCheckoutSessionId: "cs_test_1",
        stripePaymentIntentId: "pi_test_1",
        method: "card",
        amountCents: 29_948,
        acceptedAt: pdt(9, 3, 23, 30),
        status: "paid",
        paymentId: payment._id,
      },
    ]);
    expect((await list("paid")).map((row) => row.invoiceId)).toEqual([invoiceId]);
    expect(await page(token)).toMatchObject({
      paper: { stamp: { kind: "paid", day: "2026-09-03" } },
      payable: false,
      ways: [],
      stripe: null,
    });
    expect((await panel(invoiceId))?.payments).toEqual([
      {
        receivedOn: "2026-09-03",
        source: "stripe",
        method: "card",
        stripeUrl: "https://dashboard.stripe.com/test/payments/pi_test_1",
      },
    ]);
  });

  test("delivered twice, records one payment and one event", async () => {
    const { apply, event, session, approved, paymentsOf, stripeRows, stripeEvents } = fixture();
    const { invoiceId } = await approved();
    const completed = event("checkout.session.completed", session(invoiceId));
    await apply(completed);
    await apply(completed);
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
    expect(await stripeRows()).toHaveLength(1);
    expect(await stripeEvents()).toMatchObject([
      { eventId: completed.id, type: "checkout.session.completed", receivedAt: Date.now() },
    ]);
  });

  test("lets the PDF copy of the unstamped sheet go", async () => {
    const { apply, event, session, approved, pdfCopy, pdfCopyKept } = fixture();
    const { invoiceId } = await approved();
    const storageId = await pdfCopy(invoiceId, "sent");
    await apply(event("checkout.session.completed", session(invoiceId)));
    expect(await pdfCopyKept(invoiceId, storageId)).toBe(false);
  });

  test("on an invoice voided while the customer was on Stripe's page, is recorded and the paper stays VOID", async () => {
    const { owner, apply, event, session, approved, paymentsOf, page, panel, pdfCopy, pdfCopyKept } =
      fixture();
    const { invoiceId, token } = await approved();
    vi.setSystemTime(pdt(9, 2));
    await owner.mutation(api.invoices.voidInvoice, { invoiceId });
    const storageId = await pdfCopy(invoiceId, "void");

    vi.setSystemTime(pdt(9, 2, 12, 10));
    await apply(event("checkout.session.completed", session(invoiceId)));

    expect(await paymentsOf(invoiceId)).toHaveLength(1);
    expect(await panel(invoiceId)).toMatchObject({
      state: "void",
      payments: [{ receivedOn: "2026-09-02", source: "stripe", method: "card" }],
    });
    // The void paper offers no way to pay and says nothing about Stripe, whatever
    // Stripe recorded on it.
    expect(await page(token)).toMatchObject({
      paper: { stamp: { kind: "void", day: "2026-09-02" } },
      payable: false,
      ways: [],
      stripe: null,
    });
    // The VOID sheet is still the sheet, so its copy stays.
    expect(await pdfCopyKept(invoiceId, storageId)).toBe(true);
  });

  test("a second time on an invoice already paid, is recorded beside the first", async () => {
    const { apply, event, session, approved, paymentsOf, panel } = fixture();
    const { invoiceId } = await approved();
    await apply(event("checkout.session.completed", session(invoiceId)));
    vi.setSystemTime(pdt(9, 2));
    await apply(
      event(
        "checkout.session.completed",
        session(invoiceId, { id: "cs_test_2", payment_intent: "pi_test_2" }),
      ),
    );
    expect(await paymentsOf(invoiceId)).toHaveLength(2);
    expect((await panel(invoiceId))?.payments.map((p) => [p.receivedOn, p.stripeUrl])).toEqual([
      ["2026-09-01", "https://dashboard.stripe.com/test/payments/pi_test_1"],
      ["2026-09-02", "https://dashboard.stripe.com/test/payments/pi_test_2"],
    ]);
  });

  test("for a session the app did not mint, changes nothing", async () => {
    const { apply, event, session, approved, paymentsOf, stripeRows, stripeEvents } = fixture();
    const { invoiceId } = await approved();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await apply(
      event(
        "checkout.session.completed",
        session(invoiceId, { client_reference_id: null, metadata: {} }),
      ),
    );
    await apply(
      event(
        "checkout.session.completed",
        session(invoiceId, { client_reference_id: "not-an-invoice", metadata: {} }),
      ),
    );
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeRows()).toEqual([]);
    // Still recorded, so a redelivery is a no-op.
    expect(await stripeEvents()).toHaveLength(2);
  });
});

describe("A bank payment Stripe accepted", () => {
  test("reads Payment on its way everywhere, with no payment and the Pay button gone, and holds off Mark paid and Void", async () => {
    const { owner, apply, event, bankSession, approved, paymentsOf, stripeRows, list, page, today } =
      fixture();
    const { invoiceId, token } = await approved();
    await apply(event("checkout.session.completed", bankSession(invoiceId)));

    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeRows()).toMatchObject([
      { method: "bank", status: "on_its_way", acceptedAt: Date.now(), amountCents: 29_948 },
    ]);
    // Days later the invoice would be Overdue, but money is coming.
    vi.setSystemTime(pdt(9, 20));
    expect((await list("unpaid")).map((row) => [row.invoiceId, row.standing])).toEqual([
      [invoiceId, "on_its_way"],
    ]);
    const card = await owner.query(api.invoices.dashboard, { today: today() });
    expect(card.owedCents).toBe(29_948);
    expect(await page(token)).toMatchObject({
      paper: { stamp: null },
      payable: false,
      ways: [],
      stripe: { kind: "on_its_way", amountCents: 29_948, acceptedOn: "2026-09-01" },
    });
    const waiting = "A bank payment is on its way through Stripe. Wait for it to confirm.";
    await expect(owner.mutation(api.invoices.markPaid, { invoiceId })).rejects.toThrow(waiting);
    await expect(owner.mutation(api.invoices.voidInvoice, { invoiceId })).rejects.toThrow(
      waiting,
    );
  });

  test("delivered twice, keeps one payment on its way", async () => {
    const { apply, event, bankSession, approved, stripeRows } = fixture();
    const { invoiceId } = await approved();
    const completed = event("checkout.session.completed", bankSession(invoiceId));
    await apply(completed);
    await apply({ ...completed, id: "evt_test_other" });
    expect(await stripeRows()).toHaveLength(1);
  });

  test("reads Paid, stamped with the Pacific day the bank confirmed it, and its PDF copy goes", async () => {
    const { apply, event, bankSession, approved, paymentsOf, stripeRows, page, pdfCopy, pdfCopyKept } =
      fixture();
    const { invoiceId, token } = await approved();
    await apply(event("checkout.session.completed", bankSession(invoiceId)));
    const storageId = await pdfCopy(invoiceId, "sent");
    // Payment on its way leaves the paper as it was.
    expect(await pdfCopyKept(invoiceId, storageId)).toBe(true);

    vi.setSystemTime(pdt(9, 7, 6));
    const succeeded = event(
      "checkout.session.async_payment_succeeded",
      bankSession(invoiceId, { payment_status: "paid" }),
    );
    await apply(succeeded);
    await apply(succeeded);

    const payments = await paymentsOf(invoiceId);
    expect(payments).toMatchObject([
      { receivedOn: "2026-09-07", source: "stripe", method: "bank", stripePaymentIntentId: "pi_test_1" },
    ]);
    expect(await stripeRows()).toMatchObject([
      { status: "paid", acceptedAt: pdt(9, 1), paymentId: payments[0]._id },
    ]);
    expect(await page(token)).toMatchObject({
      paper: { stamp: { kind: "paid", day: "2026-09-07" } },
      stripe: null,
    });
    expect(await pdfCopyKept(invoiceId, storageId)).toBe(false);
  });

  test("confirmed before its completion arrived, is paid, and the late completion changes nothing", async () => {
    const { apply, event, bankSession, approved, paymentsOf, stripeRows, list } = fixture();
    const { invoiceId } = await approved();
    const completed = event("checkout.session.completed", bankSession(invoiceId));
    vi.setSystemTime(pdt(9, 5));
    await apply(
      event(
        "checkout.session.async_payment_succeeded",
        bankSession(invoiceId, { payment_status: "paid" }),
      ),
    );
    await apply(completed);

    expect(await paymentsOf(invoiceId)).toMatchObject([
      { receivedOn: "2026-09-05", method: "bank" },
    ]);
    expect(await stripeRows()).toMatchObject([{ status: "paid", method: "bank" }]);
    expect((await list("paid")).map((row) => row.invoiceId)).toEqual([invoiceId]);
  });

  test("the session expiring unpaid writes nothing", async () => {
    const { apply, event, bankSession, approved, stripeRows, stripeEvents } = fixture();
    const { invoiceId } = await approved();
    await apply(
      event(
        "checkout.session.expired",
        bankSession(invoiceId, { status: "expired", payment_intent: null }),
      ),
    );
    expect(await stripeRows()).toEqual([]);
    expect(await stripeEvents()).toMatchObject([{ type: "checkout.session.expired" }]);
  });
});

describe("A Returned payment", () => {
  const returnedFor = async (f: ReturnType<typeof fixture>) => {
    const { invoiceId, token } = await f.approved();
    await f.apply(f.event("checkout.session.completed", f.bankSession(invoiceId)));
    vi.setSystemTime(pdt(9, 12, 9));
    const failed = f.event("checkout.session.async_payment_failed", f.bankSession(invoiceId));
    await f.apply(failed, "insufficient funds");
    return { invoiceId, token, failed };
  };

  test("ends Payment on its way and puts the invoice back to Overdue from its sent day, with the Pay button back", async () => {
    const f = fixture();
    const { invoiceId, token } = await returnedFor(f);

    expect(await f.paymentsOf(invoiceId)).toEqual([]);
    expect(await f.stripeRows()).toMatchObject([
      { status: "returned", endedAt: pdt(9, 12, 9), reason: "insufficient funds" },
    ]);
    expect((await f.list("overdue")).map((row) => row.invoiceId)).toEqual([invoiceId]);
    expect(await f.page(token)).toMatchObject({
      paper: { stamp: null },
      ways: ["bank", "card"],
      stripe: { kind: "returned", amountCents: 29_948, acceptedOn: "2026-09-01" },
    });
    expect((await f.panel(invoiceId))?.note).toMatchObject({
      kind: "returned",
      endedOn: "2026-09-12",
      reason: "insufficient funds",
    });
  });

  test("emails the customer to pay again, with no reason, and the owner with the reason", async () => {
    const f = fixture();
    const { token } = await returnedFor(f);
    await f.deliver();

    const [customer] = f.letters("returned_payment_customer");
    expect(customer.headers["idempotency-key"]).toBe("returned-payment/pi_test_1/customer");
    expect(customer.body).toMatchObject({
      to: ["maria@example.com"],
      subject: "Your payment for Invoice INV-1001 did not go through",
      reply_to: "contact@expandhandyman.com",
      tags: [{ name: "letter", value: "returned_payment_customer" }],
    });
    expect(customer.body.text).toBe(
      [
        "Hello Maria Delgado,",
        "",
        "Your bank returned your payment of $299.48 for INV-1001. It did not go through.",
        "",
        "Pay again here:",
        `https://staff.expandhandyman.com/sign/${token}`,
        "",
        "Or pay by Zelle or check as the invoice says. Reply to this email with any questions.",
      ].join("\n"),
    );

    const [owner] = f.letters("returned_payment_owner");
    expect(owner.headers["idempotency-key"]).toBe("returned-payment/pi_test_1/owner");
    expect(owner.body).toMatchObject({
      to: ["contact@expandhandyman.com"],
      subject: "Bank payment on INV-1001 was returned",
      tags: [{ name: "letter", value: "returned_payment_owner" }],
    });
    expect(owner.body.text).toBe(
      [
        "Bank payment on INV-1001 for $299.48 was returned: insufficient funds.",
        "",
        "The customer (Maria Delgado, maria@example.com) has been emailed to pay again.",
        "",
        "See it in Stripe: https://dashboard.stripe.com/test/payments/pi_test_1",
      ].join("\n"),
    );
    expect(resendCalls).toHaveLength(2);
    expect(await f.stripeRows()).toMatchObject([{ status: "returned", customerEmailed: true }]);
  });

  test("tells the owner to ask the customer to pay again when the customer's letter did not go", async () => {
    const f = fixture();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stubbed = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith("https://api.resend.com/") &&
      String(init?.body).includes("returned_payment_customer")
        ? new Response("Resend is down", { status: 500 })
        : stubbed(input, init),
    );
    await returnedFor(f);
    await f.deliver();

    expect(f.letters("returned_payment_customer")).toEqual([]);
    expect(f.letters("returned_payment_owner")[0].body.text).toContain(
      "The customer (Maria Delgado, maria@example.com) could not be emailed. Ask them to pay again.",
    );
  });

  test("keeps in the owner's grey note that the customer could not be emailed when Resend refused the letter", async () => {
    const f = fixture();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stubbed = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith("https://api.resend.com/") &&
      String(init?.body).includes("returned_payment_customer")
        ? Response.json(
            { name: "validation_error", message: "Invalid `to` field." },
            { status: 422 },
          )
        : stubbed(input, init),
    );
    const { invoiceId } = await returnedFor(f);
    const note = async () => {
      const panelNote = (await f.panel(invoiceId))?.note;
      if (!panelNote) throw new Error("No grey note.");
      return stripeNoteSentence(panelNote);
    };
    // Until the letter's send has run, the note says what it is about to do.
    expect(await note()).toBe(
      "Bank payment of $299.48 accepted Sept 1 was returned Sept 12: insufficient funds. The customer was emailed to pay again.",
    );

    await f.deliver();
    expect((await f.stripeRows())[0].customerEmailed).toBe(false);
    expect(await note()).toBe(
      "Bank payment of $299.48 accepted Sept 1 was returned Sept 12: insufficient funds. The customer could not be emailed. Ask them to pay again.",
    );
  });

  test("tells the owner the same when the deployment has no origin to link the customer to", async () => {
    const f = fixture();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("APP_ORIGIN", "");
    await returnedFor(f);
    await f.deliver();

    expect(f.letters("returned_payment_customer")).toEqual([]);
    expect(f.letters("returned_payment_owner")[0].body.text).toContain(
      "The customer (Maria Delgado, maria@example.com) could not be emailed. Ask them to pay again.",
    );
  });

  test("delivered twice, or told again under another event, writes one return and two letters", async () => {
    const f = fixture();
    const { failed } = await returnedFor(f);
    await f.apply(failed, "insufficient funds");
    await f.apply({ ...failed, id: "evt_test_again" }, "insufficient funds");
    await f.deliver();
    expect(await f.stripeRows()).toHaveLength(1);
    expect(resendCalls).toHaveLength(2);
  });

  test("while another bank payment is still on its way, asks the customer nothing and tells the owner why", async () => {
    const f = fixture();
    const { invoiceId, token } = await f.approved();
    // Two tabs: both sessions minted before either completed, so both are
    // on their way.
    await f.apply(f.event("checkout.session.completed", f.bankSession(invoiceId)));
    vi.setSystemTime(pdt(9, 2));
    await f.apply(
      f.event(
        "checkout.session.completed",
        f.bankSession(invoiceId, { id: "cs_test_2", payment_intent: "pi_test_2" }),
      ),
    );
    vi.setSystemTime(pdt(9, 5));
    await f.apply(
      f.event("checkout.session.async_payment_failed", f.bankSession(invoiceId)),
      "insufficient funds",
    );
    await f.deliver();

    expect(f.letters("returned_payment_customer")).toEqual([]);
    expect(f.letters("returned_payment_owner")[0].body.text).toBe(
      [
        "Bank payment on INV-1001 for $299.48 was returned: insufficient funds.",
        "",
        "Another bank payment of $299.48 accepted Sept 2 is still on its way, so the customer (Maria Delgado, maria@example.com) was not asked to pay again.",
        "",
        "See it in Stripe: https://dashboard.stripe.com/test/payments/pi_test_1",
      ].join("\n"),
    );
    expect((await f.list("unpaid")).map((row) => [row.invoiceId, row.standing])).toEqual([
      [invoiceId, "on_its_way"],
    ]);
    expect(await f.page(token)).toMatchObject({
      payable: false,
      stripe: { kind: "on_its_way", acceptedOn: "2026-09-02" },
    });
    expect(await f.panel(invoiceId)).toMatchObject({
      onItsWay: { acceptedOn: "2026-09-02" },
      note: null,
    });
  });

  test("sends the customer to the invoice's live link after a re-send", async () => {
    const f = fixture();
    const { invoiceId } = await f.approved();
    await f.apply(f.event("checkout.session.completed", f.bankSession(invoiceId)));
    await f.owner.action(api.invoices.resend, { invoiceId });
    await f.deliver();
    resendCalls = [];
    const live = (await f.t.run((ctx) => ctx.db.query("invoiceLinks").collect())).find(
      (link) => link.invoiceId === invoiceId && link.endedAt === undefined,
    )!;

    await f.apply(f.event("checkout.session.async_payment_failed", f.bankSession(invoiceId)));
    await f.deliver();
    expect(f.letters("returned_payment_customer")[0].body.text).toContain(
      `https://staff.expandhandyman.com/sign/${live.token}`,
    );
    // No reason came, and the owner's letter says only that it was returned.
    expect(f.letters("returned_payment_owner")[0].body.text).toMatch(
      /^Bank payment on INV-1001 for \$299\.48 was returned\.\n/,
    );
  });
});

describe("A full refund", () => {
  test("removes the Stripe payment, and the invoice is owed again from its sent day, with the plain Pay button and no note", async () => {
    const { apply, event, session, charge, approved, paymentsOf, stripeRows, list, page, panel, pdfCopy, pdfCopyKept } =
      fixture();
    const { invoiceId, token } = await approved();
    await apply(event("checkout.session.completed", session(invoiceId)));
    const storageId = await pdfCopy(invoiceId, "paid");

    vi.setSystemTime(pdt(9, 10));
    const refunded = event("charge.refunded", charge());
    await apply(refunded);
    await apply(refunded);

    expect(await paymentsOf(invoiceId)).toEqual([]);
    const [row] = await stripeRows();
    expect(row).toMatchObject({ status: "refunded", endedAt: pdt(9, 10) });
    expect(row.paymentId).toBeUndefined();
    expect((await list("overdue")).map((row) => row.invoiceId)).toEqual([invoiceId]);
    expect(await page(token)).toMatchObject({
      paper: { stamp: null },
      ways: ["bank", "card"],
      stripe: null,
    });
    expect((await panel(invoiceId))?.note).toMatchObject({ kind: "refunded", endedOn: "2026-09-10" });
    expect(await pdfCopyKept(invoiceId, storageId)).toBe(false);
  });

  test("but not a partial one, which changes nothing", async () => {
    const { apply, event, session, charge, approved, paymentsOf, stripeRows } = fixture();
    const { invoiceId } = await approved();
    await apply(event("checkout.session.completed", session(invoiceId)));
    await apply(event("charge.refunded", charge({ refunded: false, amount_refunded: 1_000 })));
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
    expect(await stripeRows()).toMatchObject([{ status: "paid" }]);
  });

  test("is not undone by a completion delivered late", async () => {
    const { apply, event, session, charge, approved, paymentsOf } = fixture();
    const { invoiceId } = await approved();
    const completed = event("checkout.session.completed", session(invoiceId));
    await apply(completed);
    await apply(event("charge.refunded", charge()));
    await apply({ ...completed, id: "evt_test_late" });
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });

  test("told before its completion, is kept from the charge, and the late completion writes no payment", async () => {
    const { apply, event, session, paidCharge, approved, paymentsOf, stripeRows, list, page, panel } =
      fixture();
    const { invoiceId, token } = await approved();
    const paid = paidCharge(invoiceId);
    const completed = event("checkout.session.completed", session(invoiceId));

    vi.setSystemTime(pdt(9, 10));
    await apply(event("charge.refunded", paid));
    const [ended] = await stripeRows();
    expect(ended).toMatchObject({
      invoiceId,
      stripePaymentIntentId: "pi_test_1",
      method: "card",
      amountCents: 29_948,
      acceptedAt: pdt(9, 1),
      status: "refunded",
      endedAt: pdt(9, 10),
    });
    expect(ended.stripeCheckoutSessionId).toBeUndefined();

    await apply(completed);
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeRows()).toMatchObject([
      { stripeCheckoutSessionId: "cs_test_1", status: "refunded", endedAt: pdt(9, 10) },
    ]);
    expect((await list("overdue")).map((row) => row.invoiceId)).toEqual([invoiceId]);
    expect(await list("paid")).toEqual([]);
    expect(await page(token)).toMatchObject({ paper: { stamp: null }, ways: ["bank", "card"] });
    expect((await panel(invoiceId))?.note).toMatchObject({
      kind: "refunded",
      method: "card",
      acceptedOn: "2026-09-01",
      endedOn: "2026-09-10",
    });
  });

  test("told first on a charge no Pay now made, is recorded and changes nothing", async () => {
    const { apply, event, session, charge, approved, paymentsOf, stripeRows, stripeEvents } =
      fixture();
    const { invoiceId } = await approved();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await apply(event("charge.refunded", charge({ payment_intent: "pi_elsewhere" })));
    expect(await stripeRows()).toEqual([]);
    expect(await stripeEvents()).toMatchObject([{ type: "charge.refunded" }]);

    await apply(event("checkout.session.completed", session(invoiceId)));
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
  });
});

describe("A dispute", () => {
  test("lost, removes the payment and keeps the reason for the owner's note", async () => {
    const { apply, event, bankSession, dispute, approved, paymentsOf, stripeRows, panel } =
      fixture();
    const { invoiceId } = await approved();
    await apply(event("checkout.session.completed", bankSession(invoiceId)));
    await apply(
      event(
        "checkout.session.async_payment_succeeded",
        bankSession(invoiceId, { payment_status: "paid" }),
      ),
    );
    vi.setSystemTime(pdt(10, 2));
    const lost = event("charge.dispute.closed", dispute());
    await apply(lost);
    await apply(lost);

    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeRows()).toMatchObject([
      { status: "dispute_lost", endedAt: pdt(10, 2), reason: "insufficient funds" },
    ]);
    expect((await panel(invoiceId))?.note).toMatchObject({
      kind: "dispute_lost",
      method: "bank",
      endedOn: "2026-10-02",
    });
  });

  test("lost before its bank payment's completion, keeps the row lost, and neither late event writes a payment", async () => {
    const { apply, event, bankSession, paidCharge, dispute, approved, paymentsOf, stripeRows, list, page, panel } =
      fixture();
    const { invoiceId, token } = await approved();
    const paid = paidCharge(invoiceId, { payment_method_details: { type: "us_bank_account" } });

    vi.setSystemTime(pdt(10, 2));
    await apply(event("charge.dispute.closed", dispute({ charge: paid })));
    await apply(event("checkout.session.completed", bankSession(invoiceId)));
    await apply(
      event(
        "checkout.session.async_payment_succeeded",
        bankSession(invoiceId, { payment_status: "paid" }),
      ),
    );

    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeRows()).toMatchObject([
      {
        stripeCheckoutSessionId: "cs_test_1",
        method: "bank",
        acceptedAt: pdt(9, 1),
        status: "dispute_lost",
        endedAt: pdt(10, 2),
        reason: "insufficient funds",
      },
    ]);
    expect((await list("overdue")).map((row) => row.invoiceId)).toEqual([invoiceId]);
    expect(await page(token)).toMatchObject({
      paper: { stamp: null },
      ways: ["bank", "card"],
      stripe: null,
    });
    expect((await panel(invoiceId))?.note).toMatchObject({
      kind: "dispute_lost",
      method: "bank",
      endedOn: "2026-10-02",
    });
  });

  test("lost first, is refused without its charge, and kept from the charge the webhook passes", async () => {
    const { t, apply, event, session, dispute, approved, paymentsOf, stripeRows, stripeEvents } =
      fixture();
    const { invoiceId } = await approved();
    const lost = event("charge.dispute.closed", dispute());
    await expect(apply(lost)).rejects.toThrow(/No charge to tell/);
    expect(await stripeEvents()).toEqual([]);

    await t.mutation(internal.stripePayments.applyStripeEvent, {
      event: lost,
      charge: { invoiceId, method: "card", amountCents: 29_948, created: seconds(Date.now()) },
    });
    await apply(event("checkout.session.completed", session(invoiceId)));
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeRows()).toMatchObject([{ status: "dispute_lost", method: "card" }]);
  });

  test("won or closed any other way, leaves the payment standing", async () => {
    const { apply, event, session, dispute, approved, paymentsOf, stripeRows } = fixture();
    const { invoiceId } = await approved();
    await apply(event("checkout.session.completed", session(invoiceId)));
    await apply(event("charge.dispute.closed", dispute({ status: "won" })));
    await apply(event("charge.dispute.closed", dispute({ status: "warning_closed" })));
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
    expect(await stripeRows()).toMatchObject([{ status: "paid" }]);
  });
});

describe("The success return", () => {
  test("reads a paid card session back from Stripe and stamps the paper before the webhook lands; the webhook then adds nothing", async () => {
    const { t, apply, event, session, approved, paymentsOf, page } = fixture();
    const { invoiceId, token } = await approved();
    sessions.set(
      "cs_test_1",
      session(invoiceId, {
        payment_intent: { id: "pi_test_1", object: "payment_intent", status: "succeeded" },
      }),
    );

    expect(
      await t.action(api.stripePayments.applyCheckoutReturn, { token, sessionId: "cs_test_1" }),
    ).toEqual({ applied: true });
    expect(stripeCalls).toMatchObject([
      {
        method: "GET",
        path: "/v1/checkout/sessions/cs_test_1",
        params: { "expand[0]": "payment_intent" },
      },
    ]);
    expect(await paymentsOf(invoiceId)).toMatchObject([
      { receivedOn: "2026-09-01", source: "stripe", method: "card" },
    ]);
    expect((await page(token))?.paper.stamp).toEqual({ kind: "paid", day: "2026-09-01" });

    await apply(event("checkout.session.completed", session(invoiceId)));
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
  });

  test("writes no payment for a session whose money a refund already sent back", async () => {
    const { t, apply, event, session, paidCharge, approved, paymentsOf, stripeRows, page } =
      fixture();
    const { invoiceId, token } = await approved();
    await apply(event("charge.refunded", paidCharge(invoiceId)));
    sessions.set(
      "cs_test_1",
      session(invoiceId, {
        payment_intent: { id: "pi_test_1", object: "payment_intent", status: "succeeded" },
      }),
    );

    await t.action(api.stripePayments.applyCheckoutReturn, { token, sessionId: "cs_test_1" });
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeRows()).toMatchObject([
      { stripeCheckoutSessionId: "cs_test_1", status: "refunded" },
    ]);
    expect((await page(token))?.paper.stamp).toBeNull();
  });

  test("dates the payment by when the customer paid on Stripe's page, not by when the page came back", async () => {
    const { t, session, approved, paymentsOf } = fixture();
    const { invoiceId, token } = await approved();
    sessions.set(
      "cs_test_1",
      session(invoiceId, {
        payment_intent: {
          id: "pi_test_1",
          object: "payment_intent",
          status: "succeeded",
          created: seconds(pdt(9, 1, 23, 58)),
        },
      }),
    );
    // Back on the link a few minutes later, after midnight.
    vi.setSystemTime(pdt(9, 2, 0, 3));

    await t.action(api.stripePayments.applyCheckoutReturn, { token, sessionId: "cs_test_1" });
    expect(await paymentsOf(invoiceId)).toMatchObject([{ receivedOn: "2026-09-01" }]);
  });

  test("reads a bank session back as Payment on its way", async () => {
    const { t, bankSession, approved, page } = fixture();
    const { invoiceId, token } = await approved();
    sessions.set(
      "cs_test_1",
      bankSession(invoiceId, {
        payment_intent: { id: "pi_test_1", object: "payment_intent", status: "processing" },
      }),
    );
    await t.action(api.stripePayments.applyCheckoutReturn, { token, sessionId: "cs_test_1" });
    expect((await page(token))?.stripe).toMatchObject({ kind: "on_its_way" });
  });

  test("applies nothing for a session still open, or one whose bank payment already failed", async () => {
    const { t, session, bankSession, approved, stripeRows } = fixture();
    const { invoiceId, token } = await approved();
    sessions.set("cs_test_open", session(invoiceId, { id: "cs_test_open", status: "open", payment_status: "unpaid" }));
    sessions.set(
      "cs_test_failed",
      bankSession(invoiceId, {
        id: "cs_test_failed",
        payment_intent: {
          id: "pi_test_1",
          object: "payment_intent",
          status: "requires_payment_method",
          last_payment_error: { message: "insufficient funds" },
        },
      }),
    );
    const back = (sessionId: string) =>
      t.action(api.stripePayments.applyCheckoutReturn, { token, sessionId });
    expect(await back("cs_test_open")).toEqual({ applied: false });
    await back("cs_test_failed");
    expect(await stripeRows()).toEqual([]);
  });

  test("refuses a session paid on another invoice, and asks Stripe nothing for an address that names no session", async () => {
    const { t, session, approved, sentInvoice, paymentsOf } = fixture();
    const { proposalId, invoiceId, token } = await approved();
    const other = await sentInvoice(proposalId, {
      lines: [{ description: "Extra", cents: 10_000 }],
    });
    sessions.set("cs_test_1", session(invoiceId));

    expect(
      await refusal(
        t.action(api.stripePayments.applyCheckoutReturn, {
          token: other.token,
          sessionId: "cs_test_1",
        }),
      ),
    ).toEqual({
      code: "wrong_invoice",
      message: "That payment was made on another invoice, not this one.",
    });
    expect(await paymentsOf(invoiceId)).toEqual([]);

    stripeCalls = [];
    expect(
      await t.action(api.stripePayments.applyCheckoutReturn, {
        token,
        sessionId: "../v1/customers",
      }),
    ).toEqual({ applied: false });
    expect(stripeCalls).toEqual([]);
  });
});

describe("Stripe's webhook", () => {
  test("applies an event signed with the destination's secret, once however often it comes", async () => {
    const { post, event, session, approved, paymentsOf, stripeEvents } = fixture();
    const { invoiceId } = await approved();
    const body = JSON.stringify(event("checkout.session.completed", session(invoiceId)));

    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(await paymentsOf(invoiceId)).toMatchObject([{ source: "stripe", method: "card" }]);
    expect(await stripeEvents()).toHaveLength(1);
  });

  test("refuses a bad signature or an unreadable body with 400, and writes nothing", async () => {
    const { t, post, event, session, approved, paymentsOf, stripeEvents } = fixture();
    const { invoiceId } = await approved();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = JSON.stringify(event("checkout.session.completed", session(invoiceId)));
    const forged = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret: "whsec_someone_else",
      cryptoProvider: Stripe.createSubtleCryptoProvider(),
    });

    expect((await post(body, forged)).status).toBe(400);
    expect((await post(body, "")).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    const unsigned = await t.fetch("/stripe/webhook", { method: "POST", body });
    expect(unsigned.status).toBe(400);
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeEvents()).toEqual([]);
  });

  test("answers 200 to an event the app leaves alone, and records it", async () => {
    const { post, event, approved, stripeRows, stripeEvents } = fixture();
    await approved();
    const body = JSON.stringify(
      event("payment_intent.processing", { id: "pi_test_1", object: "payment_intent" }),
    );
    expect((await post(body)).status).toBe(200);
    expect(await stripeRows()).toEqual([]);
    expect(await stripeEvents()).toMatchObject([{ type: "payment_intent.processing" }]);
  });

  test("is shut, 401 and nothing written, while this deployment has no signing secret", async () => {
    const { post, event, session, approved, paymentsOf, stripeEvents } = fixture();
    const { invoiceId } = await approved();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const body = JSON.stringify(event("checkout.session.completed", session(invoiceId)));
    expect((await post(body)).status).toBe(401);
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeEvents()).toEqual([]);
  });

  test("asks Stripe for a returned payment's reason when the event does not carry it", async () => {
    const { post, event, bankSession, approved, stripeRows, deliver, letters } = fixture();
    const { invoiceId } = await approved();
    await post(JSON.stringify(event("checkout.session.completed", bankSession(invoiceId))));
    intents.set("pi_test_1", {
      id: "pi_test_1",
      object: "payment_intent",
      status: "requires_payment_method",
      last_payment_error: { message: "The customer's account has insufficient funds." },
    });

    const failed = event("checkout.session.async_payment_failed", bankSession(invoiceId));
    expect((await post(JSON.stringify(failed))).status).toBe(200);
    expect(stripeCalls.map((call) => [call.method, call.path])).toEqual([
      ["GET", "/v1/payment_intents/pi_test_1"],
    ]);
    expect(await stripeRows()).toMatchObject([
      { status: "returned", reason: "The customer's account has insufficient funds." },
    ]);
    await deliver();
    expect(letters("returned_payment_owner")[0].body.text).toMatch(
      /^Bank payment on INV-1001 for \$299\.48 was returned: The customer's account has insufficient funds\.\n/,
    );
  });
});

describe("Stripe's webhook, a dispute lost before its completion", () => {
  test("asks Stripe for the charge the event names only by id, and the late completion writes no payment", async () => {
    const { post, event, session, paidCharge, dispute, approved, paymentsOf, stripeRows } =
      fixture();
    const { invoiceId } = await approved();
    charges.set("ch_test_1", paidCharge(invoiceId));

    vi.setSystemTime(pdt(10, 2));
    const lost = JSON.stringify(event("charge.dispute.closed", dispute()));
    expect((await post(lost)).status).toBe(200);
    expect(stripeCalls.map((call) => [call.method, call.path])).toEqual([
      ["GET", "/v1/charges/ch_test_1"],
    ]);
    expect(await stripeRows()).toMatchObject([
      {
        invoiceId,
        stripePaymentIntentId: "pi_test_1",
        method: "card",
        amountCents: 29_948,
        acceptedAt: pdt(9, 1),
        status: "dispute_lost",
        endedAt: pdt(10, 2),
        reason: "insufficient funds",
      },
    ]);

    const completed = JSON.stringify(event("checkout.session.completed", session(invoiceId)));
    expect((await post(completed)).status).toBe(200);
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await stripeRows()).toMatchObject([
      { stripeCheckoutSessionId: "cs_test_1", status: "dispute_lost" },
    ]);
  });

  test("answers 500 and records nothing when Stripe cannot say what the charge was, so it comes again", async () => {
    const { post, event, dispute, approved, stripeRows, stripeEvents } = fixture();
    await approved();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lost = JSON.stringify(event("charge.dispute.closed", dispute()));
    expect((await post(lost)).status).toBe(500);
    expect(await stripeRows()).toEqual([]);
    expect(await stripeEvents()).toEqual([]);
  });

  test("records a dispute on a charge no Pay now made, and changes nothing", async () => {
    const { post, event, charge, dispute, approved, stripeRows, stripeEvents } = fixture();
    await approved();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    charges.set("ch_test_1", charge());
    const lost = JSON.stringify(event("charge.dispute.closed", dispute()));
    expect((await post(lost)).status).toBe(200);
    expect(await stripeRows()).toEqual([]);
    expect(await stripeEvents()).toMatchObject([{ type: "charge.dispute.closed" }]);
  });
});
