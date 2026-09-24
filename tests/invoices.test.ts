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
  // An invoice written straight in, beside a proposal's: the drafts, the void
  // ones and the $0 ones no ticket in reach makes yet.
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
  const letters = () =>
    resendCalls.filter((call) =>
      (call.body.tags as { value: string }[]).some((tag) => tag.value === "invoice_link"),
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
    letters,
    deliver,
  };
}

describe("The Invoices page", () => {
  test("lands on what is owed: overdue first, then unpaid, newest sent first", async () => {
    const { customer, approved, list } = fixture();
    const maria = await customer("Maria Delgado");
    const jon = await customer("Jon Park", "jon@example.com");
    const first = await approved(maria);
    vi.setSystemTime(pdt(9, 2));
    const second = await approved(jon);
    vi.setSystemTime(pdt(9, 6));
    const third = await approved(maria);
    vi.setSystemTime(pdt(9, 7));
    const fourth = await approved(jon);

    // On the 9th, the one sent on the 1st is past its seven full days; the
    // one sent on the 2nd is not, until the 10th.
    vi.setSystemTime(pdt(9, 9, 0, 0));
    const rows = await list("unpaid");
    expect(rows.map((row) => [row.invoiceId, row.standing])).toEqual([
      [first.invoiceId, "overdue"],
      [fourth.invoiceId, "unpaid"],
      [third.invoiceId, "unpaid"],
      [second.invoiceId, "unpaid"],
    ]);
    expect(rows[0]).toMatchObject({
      customerId: maria,
      customerName: "Maria Delgado",
      proposalId: first.proposalId,
      title: "INV-1001 · Deposit",
      state: "sent",
      kind: "deposit",
      number: 1001,
      amountDueCents: 29_948,
      sentAt: pdt(9, 1),
    });

    vi.setSystemTime(pdt(9, 10, 0, 0));
    expect((await list("overdue")).map((row) => row.invoiceId)).toEqual([
      second.invoiceId,
      first.invoiceId,
    ]);
  });

  test("shows paid ones under Paid, and drafts and void ones only under All, void included", async () => {
    const { customer, approved, written, sentBlock, list } = fixture();
    const maria = await customer();
    const { proposalId, invoiceId: deposit } = await approved(maria);
    const draft = await written(proposalId, { kind: "final", lines: [] });
    const nothingDue = await written(proposalId, {
      state: "sent",
      ...sentBlock(1002),
      lines: [{ description: "Warranty call-out", cents: 0 }],
    });
    const voided = await written(proposalId, {
      state: "void",
      ...sentBlock(1003),
      title: "Wrong one",
      lines: [{ description: "Extra", cents: 10_000 }],
      voidedAt: Date.now(),
    });

    expect((await list("unpaid")).map((row) => row.invoiceId)).toEqual([deposit]);
    expect(await list("overdue")).toEqual([]);
    expect((await list("paid")).map((row) => [row.invoiceId, row.standing])).toEqual([
      [nothingDue, "paid"],
    ]);
    const all = await list("all");
    expect(all.map((row) => row.invoiceId).sort()).toEqual(
      [deposit, draft, nothingDue, voided].sort(),
    );
    expect(all[0].invoiceId).toBe(deposit);
    expect(all.find((row) => row.invoiceId === draft)).toMatchObject({
      title: "Draft · Final",
      state: "draft",
      standing: null,
      number: null,
      sentAt: null,
      customerName: "Maria Delgado",
    });
    expect(all.find((row) => row.invoiceId === voided)).toMatchObject({
      title: "INV-1003 · Wrong one",
      state: "void",
      standing: null,
      amountDueCents: 10_890,
    });
  });

  test("names a sent invoice's customer as it was sent, and a draft's as the customer is now", async () => {
    const { t, customer, approved, written, list } = fixture();
    const maria = await customer();
    const { proposalId, invoiceId } = await approved(maria);
    const draft = await written(proposalId, {});
    await t.run((ctx) => ctx.db.patch(maria, { name: "Maria Delgado-Park" }));
    const all = await list("all");
    expect(all.find((row) => row.invoiceId === invoiceId)?.customerName).toBe("Maria Delgado");
    expect(all.find((row) => row.invoiceId === draft)?.customerName).toBe("Maria Delgado-Park");
  });

  test("refuses a day that is not one", async () => {
    const { owner } = fixture();
    await expect(
      owner.query(api.invoices.list, { filter: "all", today: "tomorrow" }),
    ).rejects.toThrow(/day/);
  });
});

describe("The Invoices tab", () => {
  test("lists every invoice of the customer's, newest first, drafts and void included", async () => {
    const { owner, customer, approved, written, sentBlock, today } = fixture();
    const maria = await customer();
    const jon = await customer("Jon Park", "jon@example.com");
    const first = await approved(maria);
    vi.setSystemTime(pdt(9, 3));
    await approved(jon);
    vi.setSystemTime(pdt(9, 4));
    const second = await approved(maria);
    vi.setSystemTime(pdt(9, 5));
    const voided = await written(first.proposalId, {
      state: "void",
      ...sentBlock(1004),
      lines: [{ description: "Extra", cents: 1_000 }],
    });
    vi.setSystemTime(pdt(9, 6));
    const draft = await written(second.proposalId, {});

    const tab = await owner.query(api.invoices.forCustomer, { customerId: maria, today: today() });
    expect(tab.map((row) => row.invoiceId)).toEqual([
      draft,
      voided,
      second.invoiceId,
      first.invoiceId,
    ]);
  });

  test("is empty for a customer with nothing approved", async () => {
    const { owner, customer, sent, today } = fixture();
    const maria = await customer();
    await sent(maria);
    expect(
      await owner.query(api.invoices.forCustomer, { customerId: maria, today: today() }),
    ).toEqual([]);
  });
});

describe("An approved proposal's Invoices section", () => {
  test("lists the proposal's own invoices in the order they were made", async () => {
    const { owner, customer, approved, written, today } = fixture();
    const maria = await customer();
    const { proposalId, invoiceId } = await approved(maria);
    await approved(maria);
    vi.setSystemTime(pdt(9, 2));
    const draft = await written(proposalId, { kind: "final" });
    const rows = await owner.query(api.invoices.forProposal, { proposalId, today: today() });
    expect(rows.map((row) => [row.invoiceId, row.title, row.standing, row.amountDueCents])).toEqual([
      [invoiceId, "INV-1001 · Deposit", "unpaid", 29_948],
      [draft, "Draft · Final", null, 0],
    ]);
  });

  test("has nothing for a proposal that is not approved", async () => {
    const { owner, customer, sent, today } = fixture();
    const { proposalId } = await sent(await customer());
    expect(await owner.query(api.invoices.forProposal, { proposalId, today: today() })).toEqual(
      [],
    );
  });
});

describe("The invoice panel", () => {
  test("reads the invoice whole: header, lines and money, standing and its live link", async () => {
    const { owner, customer, approved, links, today } = fixture();
    const maria = await customer();
    const { proposalId, invoiceId } = await approved(maria);
    const [link] = await links(invoiceId);
    const panel = await owner.query(api.invoices.panel, { invoiceId, today: today() });
    expect(panel).toMatchObject({
      invoiceId,
      customerId: maria,
      proposalId,
      title: "INV-1001 · Deposit",
      kind: "deposit",
      state: "sent",
      standing: "unpaid",
      customerName: "Maria Delgado",
      proposalCode: "1300FRANKLIN1-P1",
      proposalName: "Fix gate",
      lines: [{ description: "Deposit (50%) for Fix gate", cents: 27_500 }],
      taxRate: 0.089,
      money: { subtotalCents: 27_500, taxCents: 2_448, amountDueCents: 29_948 },
      customerEmail: "maria@example.com",
      liveUrl: `https://staff.expandhandyman.com/sign/${link.token}`,
      links: [
        {
          linkId: link._id,
          sentTo: "maria@example.com",
          sentAt: pdt(9, 1),
          email: { outcome: "sent", id: "resend-message-1" },
          endedAt: null,
          endedReason: null,
        },
      ],
    });
  });

  test("says when the email did not go", async () => {
    const { t, owner, customer, approved, links, today } = fixture();
    const { invoiceId } = await approved(await customer());
    const [link] = await links(invoiceId);
    await t.run((ctx) => ctx.db.patch(link._id, { email: { outcome: "fault", fault: "HTTP_503" } }));
    const panel = await owner.query(api.invoices.panel, { invoiceId, today: today() });
    expect(panel?.links[0].email).toEqual({ outcome: "fault", fault: "HTTP_503" });
  });

  test("opens nothing for an id that names no invoice", async () => {
    const { t, owner, customer, approved, today } = fixture();
    const { invoiceId } = await approved(await customer());
    await t.run((ctx) => ctx.db.delete(invoiceId));
    expect(await owner.query(api.invoices.panel, { invoiceId, today: today() })).toBeNull();
    expect(
      await owner.query(api.invoices.panel, { invoiceId: "not-an-id", today: today() }),
    ).toBeNull();
  });
});

describe("Re-send", () => {
  test("ends the old link, mints a new one to the customer's current email and changes nothing else", async () => {
    const { t, owner, customer, approved, links, letters, deliver } = fixture();
    const maria = await customer();
    const { invoiceId } = await approved(maria);
    const before = (await t.run((ctx) => ctx.db.get(invoiceId)))!;
    const [old] = await links(invoiceId);
    await t.run((ctx) => ctx.db.patch(maria, { email: "maria.d@example.com" }));

    vi.setSystemTime(pdt(9, 4));
    await owner.action(api.invoices.resend, { invoiceId });

    const after = (await t.run((ctx) => ctx.db.get(invoiceId)))!;
    expect(after).toEqual({
      ...before,
      frozen: { ...before.frozen!, sentTo: "maria.d@example.com" },
      updatedAt: pdt(9, 4),
    });
    const [ended, fresh] = (await links(invoiceId)).sort((x, y) => x.sentAt - y.sentAt);
    expect(ended).toMatchObject({ _id: old._id, endedAt: pdt(9, 4), endedReason: "resent" });
    expect(fresh).toMatchObject({ sentTo: "maria.d@example.com", sentAt: pdt(9, 4) });
    expect(fresh.endedAt).toBeUndefined();
    expect(fresh.token).not.toBe(old.token);

    await deliver();
    const [letter] = letters();
    expect(letters()).toHaveLength(1);
    expect(letter.headers["idempotency-key"]).toBe(`invoice-link/${fresh._id}`);
    expect(letter.body).toMatchObject({
      to: ["maria.d@example.com"],
      subject: "Your Expand Handyman invoice for 1300 Franklin St",
    });
    // The owner re-sent it, so the letter names the owner; the date on the
    // paper is still the day it was first sent.
    expect(String(letter.body.text)).toContain(
      "Andrew Putilin at Expand Handyman has sent you Invoice INV-1001 for 1300 Franklin St: Deposit (50%) for Fix gate, $299.48.",
    );
    expect(String(letter.body.text)).toContain(`/sign/${fresh.token}`);

    // The old token says the link is no longer live; the new one opens the
    // paper, dated as first sent.
    expect(await t.query(api.signingLinks.resolve, { token: old.token })).toBe("invoice");
    expect(await t.query(api.invoiceLinks.page, { token: old.token })).toBeNull();
    const page = await t.query(api.invoiceLinks.page, { token: fresh.token });
    expect(page?.paper).toMatchObject({ number: "INV-1001", sentAt: pdt(9, 1) });
  });

  test("of a paid invoice thanks the customer rather than asking for the money again", async () => {
    const { owner, customer, approved, letters, deliver } = fixture();
    const { invoiceId } = await approved(await customer());
    await owner.mutation(api.invoices.markPaid, { invoiceId });
    vi.setSystemTime(pdt(9, 4));
    await owner.action(api.invoices.resend, { invoiceId });
    await deliver();
    const text = String(letters()[0].body.text);
    expect(text).toContain("Deposit (50%) for Fix gate, $299.48. It was paid on 9/1/2026. Thank you.");
    expect(text).toContain(`See it here:\n`);
    expect(text).not.toContain("due on receipt");
  });

  test("the panel then lists both links, newest first, the old one ended by the re-send", async () => {
    const { owner, customer, approved, today } = fixture();
    const { invoiceId } = await approved(await customer());
    vi.setSystemTime(pdt(9, 4));
    await owner.action(api.invoices.resend, { invoiceId });
    const panel = await owner.query(api.invoices.panel, { invoiceId, today: today() });
    expect(panel?.links.map((link) => [link.sentAt, link.endedReason])).toEqual([
      [pdt(9, 4), null],
      [pdt(9, 1), "resent"],
    ]);
  });

  test("is refused when the customer has no email now, and nothing changes", async () => {
    const { t, owner, customer, approved, links } = fixture();
    const maria = await customer();
    const { invoiceId } = await approved(maria);
    await t.run((ctx) => ctx.db.patch(maria, { email: "" }));
    expect(await refusal(owner.action(api.invoices.resend, { invoiceId }))).toMatchObject({
      code: "no_email",
      message: "The customer has no email address to send it to.",
    });
    const [link] = await links(invoiceId);
    expect(link.endedAt).toBeUndefined();
    expect(await links(invoiceId)).toHaveLength(1);
  });

  test("is refused for a draft, which has never been sent", async () => {
    const { owner, customer, approved, written } = fixture();
    const { proposalId } = await approved(await customer());
    const draft = await written(proposalId, { kind: "final" });
    await expect(owner.action(api.invoices.resend, { invoiceId: draft })).rejects.toThrow(
      /Only a sent or void invoice can be re-sent/,
    );
  });

  test("works on a void invoice: the fresh link opens the paper stamped VOID and the old one ends", async () => {
    const { t, owner, customer, approved, links, letters, deliver } = fixture();
    const { invoiceId } = await approved(await customer());
    const [old] = await links(invoiceId);
    await owner.mutation(api.invoices.voidInvoice, { invoiceId });

    vi.setSystemTime(pdt(9, 4));
    await owner.action(api.invoices.resend, { invoiceId });
    await deliver();

    const fresh = (await links(invoiceId)).find((link) => link.endedAt === undefined)!;
    expect(fresh.token).not.toBe(old.token);
    expect(await t.query(api.invoiceLinks.page, { token: old.token })).toBeNull();
    const page = await t.query(api.invoiceLinks.page, { token: fresh.token });
    expect(page?.paper.stamp).toEqual({ kind: "void", day: "2026-09-01" });
    expect(letters()).toHaveLength(1);
    // Not a demand for money the paper says is not owed.
    const text = String(letters()[0].body.text);
    expect(text).toContain(
      "Andrew Putilin at Expand Handyman has sent you Invoice INV-1001 for 1300 Franklin St: Deposit (50%) for Fix gate, $299.48. It was voided on 9/1/2026, and nothing is due on it.",
    );
    expect(text).toContain(`See it here:\n`);
    expect(text).not.toContain("due on receipt");
    expect(text).not.toContain("how to pay");
    expect((await t.run((ctx) => ctx.db.get(invoiceId)))!.state).toBe("void");
  });
});

describe("The Zelle setting", () => {
  test("reads pay@expandhandyman.com until the owner sets another, which the paper then prints", async () => {
    const { t, owner, customer, approved, links } = fixture();
    const { invoiceId } = await approved(await customer());
    const [link] = await links(invoiceId);
    expect(await owner.query(api.settings.get, {})).toEqual({
      zelleEmail: "pay@expandhandyman.com",
    });

    await owner.mutation(api.settings.setZelleEmail, { zelleEmail: " Billing@ExpandHandyman.com " });
    expect(await owner.query(api.settings.get, {})).toEqual({
      zelleEmail: "billing@expandhandyman.com",
    });
    const page = await t.query(api.invoiceLinks.page, { token: link.token });
    expect(page?.paper.zelleEmail).toBe("billing@expandhandyman.com");
    const paper = await owner.query(api.invoices.paper, { invoiceId });
    expect(paper?.zelleEmail).toBe("billing@expandhandyman.com");

    // One row, however often it is changed.
    await owner.mutation(api.settings.setZelleEmail, { zelleEmail: "pay2@expandhandyman.com" });
    expect(await t.run((ctx) => ctx.db.query("settings").collect())).toHaveLength(1);
  });

  test("goes back to the default when cleared, and refuses what is not an email", async () => {
    const { owner } = fixture();
    await owner.mutation(api.settings.setZelleEmail, { zelleEmail: "billing@expandhandyman.com" });
    await owner.mutation(api.settings.setZelleEmail, { zelleEmail: "  " });
    expect(await owner.query(api.settings.get, {})).toEqual({
      zelleEmail: "pay@expandhandyman.com",
    });
    await expect(
      owner.mutation(api.settings.setZelleEmail, { zelleEmail: "not an email" }),
    ).rejects.toThrow(/email address/);
  });
});

describe("The staff paper for an invoice", () => {
  test("draws a sent invoice's paper exactly as its link does", async () => {
    const { owner, customer, approved, links, t } = fixture();
    const { invoiceId } = await approved(await customer());
    const [link] = await links(invoiceId);
    const paper = await owner.query(api.invoices.paper, { invoiceId });
    const page = await t.query(api.invoiceLinks.page, { token: link.token });
    expect(paper).toEqual({ ...page!.paper, state: "sent" });
  });

  test("lays a draft out as if sent now, with Draft where the number goes", async () => {
    const { owner, customer, approved, written } = fixture();
    const { proposalId } = await approved(await customer());
    const draft = await written(proposalId, {
      kind: "final",
      lines: [{ description: "Fix gate", cents: 55_000 }],
    });
    expect(await owner.query(api.invoices.paper, { invoiceId: draft })).toEqual({
      state: "draft",
      number: "Draft",
      sentAt: null,
      customerName: "Maria Delgado",
      site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
      proposalCode: "1300FRANKLIN1-P1",
      proposalName: "Fix gate",
      lines: [{ description: "Fix gate", cents: 55_000 }],
      taxRate: 0.089,
      zelleEmail: "pay@expandhandyman.com",
      stamp: null,
    });
  });

  test("writes nothing to any log", async () => {
    const { t, owner, customer, approved } = fixture();
    const { invoiceId } = await approved(await customer());
    await owner.query(api.invoices.paper, { invoiceId });
    expect(await t.run((ctx) => ctx.db.query("proposalViews").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("documentViews").collect())).toEqual([]);
  });
});

describe("A stranger", () => {
  test("is refused everywhere invoices are read, re-sent or set up", async () => {
    const { stranger, customer, approved, today } = fixture();
    const maria = await customer();
    const { proposalId, invoiceId } = await approved(maria);
    const day = today();
    const refused = /Owner access required/;
    await expect(stranger.query(api.invoices.list, { filter: "all", today: day })).rejects.toThrow(
      refused,
    );
    await expect(
      stranger.query(api.invoices.forCustomer, { customerId: maria, today: day }),
    ).rejects.toThrow(refused);
    await expect(
      stranger.query(api.invoices.forProposal, { proposalId, today: day }),
    ).rejects.toThrow(refused);
    await expect(stranger.query(api.invoices.panel, { invoiceId, today: day })).rejects.toThrow(
      refused,
    );
    await expect(stranger.query(api.invoices.paper, { invoiceId })).rejects.toThrow(refused);
    await expect(stranger.action(api.invoices.resend, { invoiceId })).rejects.toThrow(refused);
    await expect(stranger.query(api.settings.get, {})).rejects.toThrow(refused);
    await expect(
      stranger.mutation(api.settings.setZelleEmail, { zelleEmail: "thief@example.com" }),
    ).rejects.toThrow(refused);
  });
});
