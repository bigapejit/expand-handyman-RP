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

// Outbound HTTP, stubbed at fetch: DOR answers with Vancouver's rate, Resend
// from `resend`, and every call to Resend is kept to be asserted on.
let resend: ReturnType<typeof vi.fn>;
let resendCalls: { headers: Record<string, string>; body: Record<string, unknown> }[];

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
  resend = vi.fn(async () => Response.json({ id: "resend-message-1" }));
  resendCalls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.resend.com/"))
      return new Response(vancouverRate, { status: 200, headers: { "content-type": "text/xml" } });
    resendCalls.push({
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return resend(input, init);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Mark paid, Mark unpaid, Void and the Dashboard's Invoices card, through the
// Convex API as the owner and a stranger, with the clock pinned so the
// Overdue boundary and the Pacific day are exact. The fixture is
// tests/invoices.test.ts's.
function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
    name: "Andrew Putilin",
  });
  const stranger = t.withIdentity({
    subject: "someone",
    email: "someone@example.com",
    emailVerified: true,
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
  // A sent proposal whose one solution, "Fix gate", comes to $598.95 with
  // Washington's 8.9%, at a site of the customer given.
  const sent = async (customerId: Id<"customers">) => {
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
    return { siteId, proposalId, token };
  };
  // An approved proposal and the deposit invoice Approve made and sent: $299.48
  // due, half of $598.95.
  const approved = async (customerId: Id<"customers">) => {
    const { siteId, proposalId, token } = await sent(customerId);
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
    resendCalls = [];
    return { siteId, proposalId, invoiceId: invoice._id };
  };
  // An invoice written straight in, beside a proposal's: the drafts, the
  // credits and the $0 ones.
  const written = (proposalId: Id<"proposals">, invoice: Partial<Doc<"invoices">>) =>
    t.run(async (ctx) => {
      const proposal = (await ctx.db.get(proposalId))!;
      const site = (await ctx.db.get(proposal.siteId))!;
      return ctx.db.insert("invoices", {
        proposalId,
        siteId: site._id,
        customerId: site.customerId,
        kind: "typed",
        state: "draft",
        lines: [],
        taxRate: 0.089,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...invoice,
      });
    });
  const sentBlock = (number: number) => ({
    number,
    sentAt: Date.now(),
    frozen: {
      customerName: "Maria Delgado",
      site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
      proposalCode: "1300FRANKLIN1-P1",
      proposalName: "Fix gate",
      sentTo: "maria@example.com",
    },
  });
  const today = () => pacificDay(Date.now());
  const list = (filter: "unpaid" | "overdue" | "paid" | "all") =>
    owner.query(api.invoices.list, { filter, today: today() });
  const links = (invoiceId: Id<"invoices">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("invoiceLinks").collect()).filter((l) => l.invoiceId === invoiceId),
    );
  return {
    t,
    owner,
    stranger,
    customer,
    sent,
    approved,
    written,
    sentBlock,
    today,
    list,
    links,
    deliver,
  };
}

// What is recorded against an invoice, read straight from the table.
const paymentsOf = (t: ReturnType<typeof fixture>["t"], invoiceId: Id<"invoices">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("payments").collect()).filter((p) => p.invoiceId === invoiceId),
  );

describe("Mark paid", () => {
  test("records the day the money arrived, today in Pacific time unless changed, and the invoice reads Paid", async () => {
    const { t, owner, customer, approved, list, today } = fixture();
    const { proposalId, invoiceId } = await approved(await customer());

    // Half past eleven at night in Vancouver is already the 2nd in UTC.
    vi.setSystemTime(pdt(9, 1, 23, 30));
    await owner.mutation(api.invoices.markPaid, { invoiceId });

    expect(await paymentsOf(t, invoiceId)).toEqual([
      expect.objectContaining({
        invoiceId,
        receivedOn: "2026-09-01",
        source: "owner",
        recordedBy: "owner",
        recordedAt: pdt(9, 1, 23, 30),
      }),
    ]);
    expect((await list("unpaid")).map((row) => row.invoiceId)).toEqual([]);
    expect((await list("paid")).map((row) => [row.invoiceId, row.standing])).toEqual([
      [invoiceId, "paid"],
    ]);
    const panel = await owner.query(api.invoices.panel, { invoiceId, today: today() });
    expect(panel).toMatchObject({
      standing: "paid",
      payment: { receivedOn: "2026-09-01", source: "owner" },
    });
    const [row] = await owner.query(api.invoices.forProposal, { proposalId, today: today() });
    expect(row.standing).toBe("paid");
    const [tabRow] = await owner.query(api.invoices.forSite, {
      siteId: row.siteId,
      today: today(),
    });
    expect(tabRow.standing).toBe("paid");
  });

  test("takes the day it is given and stamps the paper PAID with it, on the link and the staff paper", async () => {
    const { t, owner, customer, approved, links } = fixture();
    const { invoiceId } = await approved(await customer());
    const [link] = await links(invoiceId);
    const unstamped = await t.query(api.invoiceLinks.page, { token: link.token });
    expect(unstamped?.paper.stamp).toBeNull();

    vi.setSystemTime(pdt(9, 5));
    await owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-09-03" });

    const page = await t.query(api.invoiceLinks.page, { token: link.token });
    expect(page?.paper.stamp).toEqual({ kind: "paid", day: "2026-09-03" });
    const paper = await owner.query(api.invoices.paper, { invoiceId });
    expect(paper).toEqual({ ...page!.paper, state: "sent" });
  });

  test("records a credit once it is refunded by hand", async () => {
    const { owner, customer, approved, written, sentBlock, today } = fixture();
    const { proposalId } = await approved(await customer());
    const credit = await written(proposalId, {
      kind: "final",
      state: "sent",
      lines: [{ description: "Materials came in under", cents: -12_000 }],
      ...sentBlock(1002),
    });
    await owner.mutation(api.invoices.markPaid, { invoiceId: credit });
    const panel = await owner.query(api.invoices.panel, { invoiceId: credit, today: today() });
    expect(panel?.standing).toBe("paid");
  });

  test("is refused on a draft, a void invoice, a second payment and a day that is not one or is still to come", async () => {
    const { t, owner, customer, approved, written, sentBlock } = fixture();
    const { proposalId, invoiceId } = await approved(await customer());
    const draft = await written(proposalId, { kind: "final" });
    const voided = await written(proposalId, {
      state: "void",
      lines: [{ description: "Wrong", cents: 10_000 }],
      ...sentBlock(1002),
      voidedAt: Date.now(),
    });

    await expect(owner.mutation(api.invoices.markPaid, { invoiceId: draft })).rejects.toThrow(
      /Only a sent invoice can be marked paid/,
    );
    await expect(owner.mutation(api.invoices.markPaid, { invoiceId: voided })).rejects.toThrow(
      /Only a sent invoice can be marked paid/,
    );
    await expect(
      owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-02-30" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    await expect(
      owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-09-02" }),
    ).rejects.toThrow(/after today/);

    await owner.mutation(api.invoices.markPaid, { invoiceId });
    await expect(owner.mutation(api.invoices.markPaid, { invoiceId })).rejects.toThrow(
      /already marked paid/,
    );
    expect(await t.run((ctx) => ctx.db.query("payments").collect())).toHaveLength(1);
  });
});

describe("Mark unpaid", () => {
  test("takes the payment back, stamp and all, and the invoice reads Overdue again when it is", async () => {
    const { t, owner, customer, approved, links, list, today } = fixture();
    const { invoiceId } = await approved(await customer());
    const [link] = await links(invoiceId);
    await owner.mutation(api.invoices.markPaid, { invoiceId });

    vi.setSystemTime(pdt(9, 10));
    expect(await list("overdue")).toEqual([]);
    await owner.mutation(api.invoices.markUnpaid, { invoiceId });

    expect(await paymentsOf(t, invoiceId)).toEqual([]);
    expect((await list("overdue")).map((row) => row.invoiceId)).toEqual([invoiceId]);
    expect(await list("paid")).toEqual([]);
    const panel = await owner.query(api.invoices.panel, { invoiceId, today: today() });
    expect(panel).toMatchObject({ standing: "overdue", payment: null });
    const page = await t.query(api.invoiceLinks.page, { token: link.token });
    expect(page?.paper.stamp).toBeNull();
  });

  test("reads Unpaid again inside the seven days", async () => {
    const { owner, customer, approved, list } = fixture();
    const { invoiceId } = await approved(await customer());
    await owner.mutation(api.invoices.markPaid, { invoiceId });
    await owner.mutation(api.invoices.markUnpaid, { invoiceId });
    expect((await list("unpaid")).map((row) => [row.invoiceId, row.standing])).toEqual([
      [invoiceId, "unpaid"],
    ]);
  });

  test("is refused for a payment the app recorded from Stripe, and for an invoice with none", async () => {
    const { t, owner, customer, approved, today } = fixture();
    const { invoiceId } = await approved(await customer());
    await expect(owner.mutation(api.invoices.markUnpaid, { invoiceId })).rejects.toThrow(
      /not marked paid/,
    );

    await t.run((ctx) =>
      ctx.db.insert("payments", {
        invoiceId,
        receivedOn: "2026-09-01",
        source: "stripe",
        recordedBy: "stripe",
        recordedAt: Date.now(),
        stripePaymentIntentId: "pi_123",
      }),
    );
    await expect(owner.mutation(api.invoices.markUnpaid, { invoiceId })).rejects.toThrow(
      /paid online/,
    );
    expect(await paymentsOf(t, invoiceId)).toHaveLength(1);
    const panel = await owner.query(api.invoices.panel, { invoiceId, today: today() });
    expect(panel?.payment).toEqual({ receivedOn: "2026-09-01", source: "stripe" });
  });
});

describe("Void", () => {
  test("cancels a sent invoice: it keeps its number and live link, its paper is stamped VOID, and it has no standing", async () => {
    const { t, owner, customer, approved, links, list, today } = fixture();
    const { invoiceId } = await approved(await customer());
    const before = (await t.run((ctx) => ctx.db.get(invoiceId)))!;
    const [link] = await links(invoiceId);

    vi.setSystemTime(pdt(9, 3, 23, 30));
    await owner.mutation(api.invoices.voidInvoice, {
      invoiceId,
      reason: "  Billed the wrong deposit.  ",
    });

    const after = (await t.run((ctx) => ctx.db.get(invoiceId)))!;
    expect(after).toEqual({
      ...before,
      state: "void",
      voidedAt: pdt(9, 3, 23, 30),
      voidReason: "Billed the wrong deposit.",
      updatedAt: pdt(9, 3, 23, 30),
    });
    expect(await links(invoiceId)).toEqual([link]);

    expect(await t.query(api.signingLinks.resolve, { token: link.token })).toBe("invoice");
    const page = await t.query(api.invoiceLinks.page, { token: link.token });
    expect(page?.paper).toMatchObject({
      number: "INV-1001",
      stamp: { kind: "void", day: "2026-09-03" },
    });
    expect(await owner.query(api.invoices.paper, { invoiceId })).toEqual({
      ...page!.paper,
      state: "void",
    });

    expect(await list("unpaid")).toEqual([]);
    expect(await list("paid")).toEqual([]);
    expect((await list("all")).map((row) => [row.invoiceId, row.state, row.standing])).toEqual([
      [invoiceId, "void", null],
    ]);
    const panel = await owner.query(api.invoices.panel, { invoiceId, today: today() });
    expect(panel).toMatchObject({
      state: "void",
      standing: null,
      voidedAt: pdt(9, 3, 23, 30),
      voidReason: "Billed the wrong deposit.",
    });
  });

  test("keeps no reason when none is given", async () => {
    const { t, owner, customer, approved } = fixture();
    const { invoiceId } = await approved(await customer());
    await owner.mutation(api.invoices.voidInvoice, { invoiceId, reason: "   " });
    const after = (await t.run((ctx) => ctx.db.get(invoiceId)))!;
    expect(after.state).toBe("void");
    expect(after.voidReason).toBeUndefined();
  });

  test("is refused on a draft, on an invoice already void, and while a payment is recorded", async () => {
    const { t, owner, customer, approved, written } = fixture();
    const { proposalId, invoiceId } = await approved(await customer());
    const draft = await written(proposalId, { kind: "final" });
    await expect(owner.mutation(api.invoices.voidInvoice, { invoiceId: draft })).rejects.toThrow(
      /Only a sent invoice can be voided/,
    );

    await owner.mutation(api.invoices.markPaid, { invoiceId });
    await expect(owner.mutation(api.invoices.voidInvoice, { invoiceId })).rejects.toThrow(
      /Mark it unpaid first/,
    );
    expect((await t.run((ctx) => ctx.db.get(invoiceId)))!.state).toBe("sent");

    await owner.mutation(api.invoices.markUnpaid, { invoiceId });
    await owner.mutation(api.invoices.voidInvoice, { invoiceId });
    await expect(owner.mutation(api.invoices.voidInvoice, { invoiceId })).rejects.toThrow(
      /Only a sent invoice can be voided/,
    );
  });

  test("brings Job done back once the final invoice is voided", async () => {
    const { owner, customer, approved, deliver } = fixture();
    const { proposalId } = await approved(await customer());
    const final = await owner.mutation(api.invoices.jobDone, { proposalId });
    await owner.action(api.invoices.send, { invoiceId: final });
    await deliver();
    expect(await owner.query(api.invoices.finalPrefill, { proposalId })).toBeNull();

    await owner.mutation(api.invoices.voidInvoice, { invoiceId: final });
    // The void final invoice is not taken off the next one: only the deposit.
    const prefill = await owner.query(api.invoices.finalPrefill, { proposalId });
    expect(prefill?.lines.map((line) => line.description)).toEqual([
      "Fix gate",
      "Less deposit invoiced (INV-1001)",
    ]);
    await owner.mutation(api.invoices.jobDone, { proposalId });
  });
});

describe("Mark paid, Mark unpaid and Void", () => {
  test("email nobody", async () => {
    const { owner, customer, approved, deliver } = fixture();
    const first = await approved(await customer());
    const second = await approved(await customer("Jon Park", "jon@example.com"));
    await owner.mutation(api.invoices.markPaid, { invoiceId: first.invoiceId });
    await owner.mutation(api.invoices.markUnpaid, { invoiceId: first.invoiceId });
    await owner.mutation(api.invoices.voidInvoice, { invoiceId: second.invoiceId });
    await deliver();
    expect(resendCalls).toEqual([]);
  });
});

describe("The Dashboard's Invoices card", () => {
  test("totals what is owed, then lists Overdue oldest first and Unpaid newest sent first", async () => {
    const { owner, customer, approved, written, sentBlock } = fixture();
    const maria = await customer();
    const jon = await customer("Jon Park", "jon@example.com");
    const first = await approved(maria);
    vi.setSystemTime(pdt(9, 2));
    const second = await approved(jon);
    vi.setSystemTime(pdt(9, 6));
    const third = await approved(maria);
    const paid = await approved(jon);
    await owner.mutation(api.invoices.markPaid, { invoiceId: paid.invoiceId });
    vi.setSystemTime(pdt(9, 7));
    const fourth = await approved(jon);
    const voided = await approved(maria);
    await owner.mutation(api.invoices.voidInvoice, { invoiceId: voided.invoiceId });
    await written(first.proposalId, { kind: "final", lines: [{ description: "x", cents: 5 }] });
    await written(first.proposalId, {
      state: "sent",
      lines: [{ description: "Nothing due", cents: 0 }],
      ...sentBlock(1100),
    });

    vi.setSystemTime(pdt(9, 10, 0, 0));
    const card = await owner.query(api.invoices.dashboard, { today: pacificDay(Date.now()) });
    expect(card.overdue.map((row) => row.invoiceId)).toEqual([
      first.invoiceId,
      second.invoiceId,
    ]);
    expect(card.unpaid.map((row) => row.invoiceId)).toEqual([
      fourth.invoiceId,
      third.invoiceId,
    ]);
    expect(card.owedCents).toBe(4 * 29_948);
    expect(card.overdue[0]).toMatchObject({
      // The site the row opens on.
      siteId: first.siteId,
      customerId: maria,
      customerName: "Maria Delgado",
      title: "INV-1001 · Deposit",
      number: 1001,
      amountDueCents: 29_948,
      standing: "overdue",
    });
  });

  test("is empty when nothing is owed", async () => {
    const { owner, customer, approved, today } = fixture();
    const { invoiceId } = await approved(await customer());
    await owner.mutation(api.invoices.markPaid, { invoiceId });
    expect(await owner.query(api.invoices.dashboard, { today: today() })).toEqual({
      owedCents: 0,
      overdue: [],
      unpaid: [],
    });
  });
});

describe("A stranger", () => {
  test("can neither record nor take back money, void an invoice nor read the card", async () => {
    const { t, stranger, customer, approved, today } = fixture();
    const { invoiceId } = await approved(await customer());
    const refused = /Owner access required/;
    await expect(stranger.mutation(api.invoices.markPaid, { invoiceId })).rejects.toThrow(refused);
    await expect(stranger.mutation(api.invoices.markUnpaid, { invoiceId })).rejects.toThrow(
      refused,
    );
    await expect(stranger.mutation(api.invoices.voidInvoice, { invoiceId })).rejects.toThrow(
      refused,
    );
    await expect(stranger.query(api.invoices.dashboard, { today: today() })).rejects.toThrow(
      refused,
    );
    expect(await t.run((ctx) => ctx.db.query("payments").collect())).toEqual([]);
  });
});
