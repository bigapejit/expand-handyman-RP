import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// DOR's answer for a Vancouver address: 8.9% at location 0605.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

beforeEach(() => {
  // 8:30pm Pacific on 23 September, which is already the 24th in UTC.
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 24, 3, 30));
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("APP_ORIGIN", "https://staff.expandhandyman.com");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("EMAIL_REPLY_TO", "");
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

type Deposit = { depositPercent: number } | { depositCents: number };

// **Pay now** right after signing: the signed proposal's bar offers "Pay the
// $299.48 deposit", which opens the deposit invoice's link with the Pay sheet
// open, for exactly as long as the deposit is owed. The signing link's page
// query carries it as `deposit`, the invoice link's token and Amount Due.
function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
    name: "Andrew Putilin",
  });
  const deliver = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  // A sent proposal whose one solution, "Fix gate", is two hours at $250
  // marked up 10%: $550.00, and $598.95 with Washington's 8.9%. Its Deposit
  // is half unless told otherwise: $299.48.
  const sent = async (deposit?: Deposit) => {
    const customerId = await t.run((ctx) =>
      ctx.db.insert("customers", { name: "Maria Delgado", email: "maria@example.com", phone: "" }),
    );
    const siteId = await t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: "1300FRANKLIN",
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: "place-1300FRANKLIN",
        latitude: 45.63,
        longitude: -122.67,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title: "Fix gate" });
    await owner.mutation(api.solutions.update, {
      solutionId,
      description: "Rehang the gate.",
      lineItems: [{ name: "Gate labor", quantity: 2, unitCostCents: 25_000, unit: "HR" }],
    });
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [solutionId] });
    if (deposit) await owner.mutation(api.proposals.update, { proposalId, ...deposit });
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    const token = (await t.run((ctx) => ctx.db.query("signingLinks").collect())).find(
      (link) => link.proposalId === proposalId && link.endedAt === undefined,
    )?.token;
    if (!token) throw new Error("No live link.");
    return { proposalId, token };
  };
  // Signed through the link, which makes the deposit invoice sent.
  const signed = async (deposit?: Deposit) => {
    const { proposalId, token } = await sent(deposit);
    await t.action(api.proposals.approve, {
      token,
      signerName: "Maria Delgado",
      consentTicked: true,
      noticeTicked: false,
      consentWordingVersion: SigningConsent.version,
      noticeWordingVersion: WashingtonNoticeToCustomer.version,
    });
    await deliver();
    const invoiceId = (await t.run((ctx) => ctx.db.query("invoices").collect())).find(
      (invoice) => invoice.proposalId === proposalId,
    )?._id;
    return { proposalId, token, invoiceId };
  };
  // The live link of an invoice, as its latest email carried it.
  const liveInvoiceToken = async (invoiceId: Id<"invoices">) =>
    (await t.run((ctx) => ctx.db.query("invoiceLinks").collect())).find(
      (link) => link.invoiceId === invoiceId && link.endedAt === undefined,
    )?.token;
  const deposit = async (token: string) =>
    (await t.query(api.signingLinks.page, { token }))?.deposit;
  return { t, owner, deliver, sent, signed, liveInvoiceToken, deposit };
}

describe("Pay the deposit, on the signed proposal's bar", () => {
  test("offers the deposit invoice's live link and its Amount Due once the customer has signed", async () => {
    const { t, signed, liveInvoiceToken, deposit } = fixture();
    const { token, invoiceId } = await signed();
    const invoiceToken = await liveInvoiceToken(invoiceId!);

    expect(await deposit(token)).toEqual({ token: invoiceToken, amountDueCents: 29_948 });
    // The token opens the deposit invoice's own link, where the Pay sheet
    // offers the ways to pay the same $299.48.
    expect(await t.query(api.signingLinks.resolve, { token: invoiceToken! })).toBe("invoice");
    const invoicePage = await t.query(api.invoiceLinks.page, { token: invoiceToken! });
    expect(invoicePage).toMatchObject({ amountDueCents: 29_948, ways: ["bank", "card"] });
  });

  test("is not offered on a proposal still waiting to be signed", async () => {
    const { sent, deposit } = fixture();
    const { token } = await sent();
    expect(await deposit(token)).toBeNull();
  });

  test("is absent when the proposal had no Deposit", async () => {
    const { t, signed, deposit } = fixture();
    const { token } = await signed({ depositPercent: 0 });
    expect(await t.run((ctx) => ctx.db.query("invoices").collect())).toEqual([]);
    expect(await deposit(token)).toBeNull();
  });

  test("goes once the deposit is marked paid, and comes back when it is marked unpaid", async () => {
    const { owner, signed, deposit } = fixture();
    const { token, invoiceId } = await signed();
    await owner.mutation(api.invoices.markPaid, { invoiceId: invoiceId! });
    expect(await deposit(token)).toBeNull();

    await owner.mutation(api.invoices.markUnpaid, { invoiceId: invoiceId! });
    expect(await deposit(token)).toMatchObject({ amountDueCents: 29_948 });
  });

  test("goes once Stripe has recorded the deposit paid", async () => {
    const { t, signed, deposit } = fixture();
    const { token, invoiceId } = await signed();
    await t.run((ctx) =>
      ctx.db.insert("payments", {
        invoiceId: invoiceId!,
        receivedOn: "2026-09-23",
        source: "stripe",
        recordedBy: "stripe",
        recordedAt: Date.now(),
        method: "card",
        stripePaymentIntentId: "pi_test_1",
      }),
    );
    expect(await deposit(token)).toBeNull();
  });

  test("goes while a bank payment for the deposit is on its way, and comes back once it is returned", async () => {
    const { t, signed, deposit } = fixture();
    const { token, invoiceId } = await signed();
    const onItsWay = await t.run((ctx) =>
      ctx.db.insert("stripePayments", {
        invoiceId: invoiceId!,
        stripeCheckoutSessionId: "cs_test_1",
        stripePaymentIntentId: "pi_test_1",
        method: "bank",
        amountCents: 29_948,
        acceptedAt: Date.now(),
        status: "on_its_way",
      }),
    );
    expect(await deposit(token)).toBeNull();

    // A **Returned payment** puts the deposit back to owing, and the bar
    // offers it again.
    await t.run((ctx) =>
      ctx.db.patch(onItsWay, {
        status: "returned",
        endedAt: Date.now(),
        reason: "insufficient funds",
      }),
    );
    expect(await deposit(token)).toMatchObject({ amountDueCents: 29_948 });
  });

  test("goes once the deposit invoice is void", async () => {
    const { owner, signed, deposit } = fixture();
    const { token, invoiceId } = await signed();
    await owner.mutation(api.invoices.voidInvoice, { invoiceId: invoiceId! });
    expect(await deposit(token)).toBeNull();
  });

  test("follows a re-send to the invoice's new link, and never offers the ended one", async () => {
    const { t, owner, deliver, signed, liveInvoiceToken, deposit } = fixture();
    const { token, invoiceId } = await signed();
    const first = await liveInvoiceToken(invoiceId!);
    await owner.action(api.invoices.resend, { invoiceId: invoiceId! });
    await deliver();
    const second = await liveInvoiceToken(invoiceId!);
    expect(second).not.toBe(first);
    expect(await deposit(token)).toEqual({ token: second, amountDueCents: 29_948 });

    // With no live link left at all, there is nothing the button could open.
    await t.run(async (ctx) => {
      for (const link of await ctx.db.query("invoiceLinks").collect())
        if (link.endedAt === undefined)
          await ctx.db.patch(link._id, { endedAt: Date.now(), endedReason: "resent" });
    });
    expect(await deposit(token)).toBeNull();
  });
});
