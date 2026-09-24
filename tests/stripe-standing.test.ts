import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { pacificDay } from "../lib/invoice-standing";
import { SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// DOR's answer for a Vancouver address: 8.9% at location 0605.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

// A moment in Pacific daylight time, UTC-7.
const pdt = (month: number, day: number, hour = 12, minute = 0) =>
  Date.UTC(2026, month - 1, day, hour + 7, minute);

beforeEach(() => {
  // Noon Pacific on 1 September 2026. Time only moves when a test moves it,
  // so the Overdue boundary is exact.
  vi.useFakeTimers();
  vi.setSystemTime(pdt(9, 1));
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("APP_ORIGIN", "https://staff.expandhandyman.com");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("EMAIL_REPLY_TO", "");
  // The dev deployment's key, in Stripe's test mode. Nothing here calls
  // Stripe: the key only decides where the dashboard links point.
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_51expand");
  vi.stubGlobal("fetch", async (input: string | URL | Request) =>
    String(input).startsWith("https://api.resend.com/")
      ? Response.json({ id: "resend-message-1" })
      : new Response(vancouverRate, { status: 200, headers: { "content-type": "text/xml" } }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// What Stripe leaves on an invoice, written straight into the tables as the
// webhook will write it, and read back through the owner's lists, the panel,
// the Dashboard card and the customer's link: **Payment on its way**, a
// **Returned payment**, a refund, and Stripe payments beside the owner's.
// Nothing here talks to Stripe. The fixture is tests/invoice-payments.test.ts's.
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
  // An approved proposal and the deposit invoice Approve made and sent:
  // $299.48 due, half of $598.95 with Washington's 8.9%.
  const approved = async (customerId: Id<"customers">) => {
    const siteId = await site(customerId);
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
    return { siteId, proposalId, invoiceId: invoice._id, token: link.token };
  };
  // A Pay now whose Checkout Session completed, as `stripePayments` keeps it:
  // a bank payment on its way unless told otherwise.
  const stripePayment = (
    invoiceId: Id<"invoices">,
    over: Partial<Doc<"stripePayments">> = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("stripePayments", {
        invoiceId,
        stripeCheckoutSessionId: "cs_test_1",
        stripePaymentIntentId: "pi_test_1",
        method: "bank",
        amountCents: 29_948,
        acceptedAt: Date.now(),
        status: "on_its_way",
        ...over,
      }),
    );
  // The payment the app writes once Stripe says the money arrived.
  const stripePaid = (
    invoiceId: Id<"invoices">,
    receivedOn: string,
    over: Partial<Doc<"payments">> = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("payments", {
        invoiceId,
        receivedOn,
        source: "stripe",
        recordedBy: "stripe",
        recordedAt: Date.now(),
        method: "card",
        stripePaymentIntentId: "pi_test_1",
        ...over,
      }),
    );
  // The money going back, as the webhook will record it: the row ends as
  // returned, refunded or lost, and its `payments` row, if it had one, goes.
  const ended = (
    rowId: Id<"stripePayments">,
    status: "returned" | "refunded" | "dispute_lost",
    reason?: string,
  ) =>
    t.run(async (ctx) => {
      const row = (await ctx.db.get(rowId))!;
      if (row.paymentId) await ctx.db.delete(row.paymentId);
      await ctx.db.patch(rowId, { status, endedAt: Date.now(), reason, paymentId: undefined });
    });
  const today = () => pacificDay(Date.now());
  const list = (filter: "unpaid" | "overdue" | "paid" | "all") =>
    owner.query(api.invoices.list, { filter, today: today() });
  const panel = (invoiceId: Id<"invoices">) =>
    owner.query(api.invoices.panel, { invoiceId, today: today() });
  const paymentsOf = (invoiceId: Id<"invoices">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("payments").collect()).filter((p) => p.invoiceId === invoiceId),
    );
  return {
    t,
    owner,
    customer,
    approved,
    stripePayment,
    stripePaid,
    ended,
    today,
    list,
    panel,
    paymentsOf,
  };
}

describe("An invoice with a bank payment on its way", () => {
  test("reads Payment on its way in every list, the panel and the Dashboard card, and is still owed", async () => {
    const { owner, customer, approved, stripePayment, list, panel, today } = fixture();
    const { siteId, proposalId, invoiceId } = await approved(await customer());
    await stripePayment(invoiceId);

    const rows = (await list("unpaid")).map((row) => [row.invoiceId, row.standing]);
    expect(rows).toEqual([[invoiceId, "on_its_way"]]);
    expect(await list("paid")).toEqual([]);
    const [siteRow] = await owner.query(api.invoices.forSite, { siteId, today: today() });
    expect(siteRow.standing).toBe("on_its_way");
    const [proposalRow] = await owner.query(api.invoices.forProposal, {
      proposalId,
      today: today(),
    });
    expect(proposalRow.standing).toBe("on_its_way");
    expect(await panel(invoiceId)).toMatchObject({
      standing: "on_its_way",
      payment: null,
      payments: [],
      onItsWay: {
        amountCents: 29_948,
        acceptedOn: "2026-09-01",
        stripeUrl: "https://dashboard.stripe.com/test/payments/pi_test_1",
      },
      note: null,
    });
    const card = await owner.query(api.invoices.dashboard, { today: today() });
    expect(card.unpaid.map((row) => [row.invoiceId, row.standing])).toEqual([
      [invoiceId, "on_its_way"],
    ]);
    expect(card.owedCents).toBe(29_948);
  });

  test("never turns Overdue while it waits, however long the bank takes", async () => {
    const { customer, approved, stripePayment, list, panel } = fixture();
    const { invoiceId } = await approved(await customer());
    await stripePayment(invoiceId);

    vi.setSystemTime(pdt(9, 20));
    expect(await list("overdue")).toEqual([]);
    expect((await list("unpaid")).map((row) => row.standing)).toEqual(["on_its_way"]);
    expect((await panel(invoiceId))?.standing).toBe("on_its_way");
  });

  test("leaves the paper unstamped, on the link and the staff paper", async () => {
    const { t, owner, customer, approved, stripePayment } = fixture();
    const { invoiceId, token } = await approved(await customer());
    await stripePayment(invoiceId);
    const page = await t.query(api.invoiceLinks.page, { token });
    expect(page?.paper.stamp).toBeNull();
    expect((await owner.query(api.invoices.paper, { invoiceId }))?.stamp).toBeNull();
  });

  test("refuses Mark paid and Void, and writes nothing", async () => {
    const { t, owner, customer, approved, stripePayment, paymentsOf } = fixture();
    const { invoiceId } = await approved(await customer());
    await stripePayment(invoiceId);

    const waiting = "A bank payment is on its way through Stripe. Wait for it to confirm.";
    await expect(owner.mutation(api.invoices.markPaid, { invoiceId })).rejects.toThrow(waiting);
    await expect(owner.mutation(api.invoices.voidInvoice, { invoiceId })).rejects.toThrow(
      waiting,
    );
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(invoiceId)))!.state).toBe("sent");
  });

  test("links to the live dashboard where the deployment's key is live", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_51expand");
    const { customer, approved, stripePayment, panel } = fixture();
    const { invoiceId } = await approved(await customer());
    await stripePayment(invoiceId);
    expect((await panel(invoiceId))?.onItsWay?.stripeUrl).toBe(
      "https://dashboard.stripe.com/payments/pi_test_1",
    );
  });
});


describe("A bank payment the bank returned", () => {
  test("puts the invoice back to Overdue counted from its sent day, with the owner's grey note", async () => {
    const { owner, customer, approved, stripePayment, ended, list, panel } = fixture();
    const { invoiceId } = await approved(await customer());
    const rowId = await stripePayment(invoiceId);

    vi.setSystemTime(pdt(9, 12));
    await ended(rowId, "returned", "insufficient funds");

    expect((await list("overdue")).map((row) => row.invoiceId)).toEqual([invoiceId]);
    expect(await panel(invoiceId)).toMatchObject({
      standing: "overdue",
      onItsWay: null,
      note: {
        kind: "returned",
        method: "bank",
        amountCents: 29_948,
        acceptedOn: "2026-09-01",
        endedOn: "2026-09-12",
        reason: "insufficient funds",
        stripeUrl: "https://dashboard.stripe.com/test/payments/pi_test_1",
      },
    });

    // Mark paid is back, and once the money is in the note has nothing left
    // to explain.
    await owner.mutation(api.invoices.markPaid, { invoiceId });
    expect(await panel(invoiceId)).toMatchObject({ standing: "paid", note: null });
  });

  test("keeps the note only until a payment is on its way again or the invoice is void", async () => {
    const { owner, customer, approved, stripePayment, ended, panel } = fixture();
    const { invoiceId } = await approved(await customer());
    const first = await stripePayment(invoiceId);
    vi.setSystemTime(pdt(9, 4));
    await ended(first, "returned", "account closed");
    expect((await panel(invoiceId))?.note?.kind).toBe("returned");

    const again = await stripePayment(invoiceId, {
      stripeCheckoutSessionId: "cs_test_2",
      stripePaymentIntentId: "pi_test_2",
    });
    expect(await panel(invoiceId)).toMatchObject({
      standing: "on_its_way",
      note: null,
      onItsWay: { stripeUrl: "https://dashboard.stripe.com/test/payments/pi_test_2" },
    });

    // The newest one gone back is the one the note tells of.
    vi.setSystemTime(pdt(9, 6));
    await ended(again, "returned", "account closed");
    expect(await panel(invoiceId)).toMatchObject({
      note: {
        endedOn: "2026-09-06",
        stripeUrl: "https://dashboard.stripe.com/test/payments/pi_test_2",
      },
    });
    await owner.mutation(api.invoices.voidInvoice, { invoiceId });
    expect((await panel(invoiceId))?.note).toBeNull();
  });
});

describe("A Stripe payment refunded or lost in a dispute", () => {
  test("leaves the invoice owed from its sent day, and voidable, with a note saying why", async () => {
    const { owner, customer, approved, stripePayment, stripePaid, ended, panel } = fixture();
    const { invoiceId } = await approved(await customer());
    const paymentId = await stripePaid(invoiceId, "2026-09-01");
    const rowId = await stripePayment(invoiceId, { method: "card", status: "paid", paymentId });
    expect((await panel(invoiceId))?.standing).toBe("paid");

    vi.setSystemTime(pdt(9, 10));
    await ended(rowId, "refunded");
    expect(await panel(invoiceId)).toMatchObject({
      standing: "overdue",
      payment: null,
      payments: [],
      note: { kind: "refunded", method: "card", endedOn: "2026-09-10", reason: null },
    });
    await owner.mutation(api.invoices.voidInvoice, { invoiceId });
  });

  test("tells a lost dispute from a refund in the note", async () => {
    const { customer, approved, stripePayment, stripePaid, ended, panel } = fixture();
    const { invoiceId } = await approved(await customer());
    const paymentId = await stripePaid(invoiceId, "2026-09-01", { method: "bank" });
    const rowId = await stripePayment(invoiceId, { status: "paid", paymentId });
    await ended(rowId, "dispute_lost", "fraudulent");
    expect((await panel(invoiceId))?.note).toMatchObject({
      kind: "dispute_lost",
      method: "bank",
      reason: "fraudulent",
    });
  });
});

describe("Stripe payments on one invoice", () => {
  test("are all listed, earliest first, each with where it lives in Stripe, when the money came twice", async () => {
    const { customer, approved, stripePaid, panel } = fixture();
    const { invoiceId } = await approved(await customer());
    vi.setSystemTime(pdt(9, 4));
    await stripePaid(invoiceId, "2026-09-04", { method: "card", stripePaymentIntentId: "pi_c" });
    vi.setSystemTime(pdt(9, 3, 13));
    await stripePaid(invoiceId, "2026-09-03", { method: "bank", stripePaymentIntentId: "pi_b" });

    expect(await panel(invoiceId)).toMatchObject({
      standing: "paid",
      payment: { receivedOn: "2026-09-03", source: "stripe" },
      payments: [
        {
          receivedOn: "2026-09-03",
          source: "stripe",
          method: "bank",
          stripeUrl: "https://dashboard.stripe.com/test/payments/pi_b",
        },
        {
          receivedOn: "2026-09-04",
          source: "stripe",
          method: "card",
          stripeUrl: "https://dashboard.stripe.com/test/payments/pi_c",
        },
      ],
    });
  });

  test("keep Void and Mark paid refused while one stands", async () => {
    const { t, owner, customer, approved, stripePaid } = fixture();
    const { invoiceId } = await approved(await customer());
    await stripePaid(invoiceId, "2026-09-01");
    await expect(owner.mutation(api.invoices.voidInvoice, { invoiceId })).rejects.toThrow(
      "This invoice was paid through Stripe. Refund it in Stripe first to void it.",
    );
    await expect(owner.mutation(api.invoices.markPaid, { invoiceId })).rejects.toThrow(
      /already marked paid/,
    );
    expect((await t.run((ctx) => ctx.db.get(invoiceId)))!.state).toBe("sent");
  });
});

describe("Mark unpaid beside a Stripe payment", () => {
  test("takes back only the owner's own, and the invoice stays paid on Stripe's day", async () => {
    const { t, owner, customer, approved, stripePaid, paymentsOf, panel } = fixture();
    const { invoiceId, token } = await approved(await customer());
    vi.setSystemTime(pdt(9, 5));
    await owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-09-02" });
    // The customer paid by card as well, after the owner had marked it paid.
    await stripePaid(invoiceId, "2026-09-05");
    expect(await panel(invoiceId)).toMatchObject({
      payment: { receivedOn: "2026-09-02", source: "owner" },
      payments: [
        { receivedOn: "2026-09-02", source: "owner", method: null, stripeUrl: null },
        { receivedOn: "2026-09-05", source: "stripe", method: "card" },
      ],
    });
    expect((await t.query(api.invoiceLinks.page, { token }))?.paper.stamp).toEqual({
      kind: "paid",
      day: "2026-09-02",
    });

    await owner.mutation(api.invoices.markUnpaid, { invoiceId });
    expect((await paymentsOf(invoiceId)).map((p) => p.source)).toEqual(["stripe"]);
    expect(await panel(invoiceId)).toMatchObject({
      standing: "paid",
      payment: { receivedOn: "2026-09-05", source: "stripe" },
    });
    expect((await t.query(api.invoiceLinks.page, { token }))?.paper.stamp).toEqual({
      kind: "paid",
      day: "2026-09-05",
    });

    await expect(owner.mutation(api.invoices.markUnpaid, { invoiceId })).rejects.toThrow(
      "This invoice was paid online, so it can't be marked unpaid here.",
    );
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
  });
});

describe("A Stripe payment on a void invoice", () => {
  test("is listed in the panel, but the paper is stamped VOID and never PAID", async () => {
    const { t, owner, customer, approved, stripePaid, panel, list } = fixture();
    const { invoiceId, token } = await approved(await customer());
    vi.setSystemTime(pdt(9, 2));
    await owner.mutation(api.invoices.voidInvoice, { invoiceId });
    // The customer was on Stripe's page when the owner voided it.
    await stripePaid(invoiceId, "2026-09-02");

    const page = await t.query(api.invoiceLinks.page, { token });
    expect(page).toMatchObject({
      paper: { stamp: { kind: "void", day: "2026-09-02" } },
      ways: [],
      stripe: null,
    });
    expect((await owner.query(api.invoices.paper, { invoiceId }))?.stamp).toEqual({
      kind: "void",
      day: "2026-09-02",
    });
    expect(await panel(invoiceId)).toMatchObject({
      state: "void",
      standing: null,
      payments: [{ receivedOn: "2026-09-02", source: "stripe", method: "card" }],
      note: null,
    });
    expect(await list("paid")).toEqual([]);
  });
});

describe("The paper's How to pay", () => {
  test("names the Zelle tag and, with no mailing address supplied, a check handed over in person", async () => {
    const { t, customer, approved } = fixture();
    const { token } = await approved(await customer());
    const page = await t.query(api.invoiceLinks.page, { token });
    expect(page?.paper).toMatchObject({ zelleTag: "expandhandyman", mailingAddress: null });
  });
});
