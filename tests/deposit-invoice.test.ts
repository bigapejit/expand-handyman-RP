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

// Outbound HTTP, stubbed at fetch: DOR answers with Vancouver's rate, Resend
// from `resend`, and every call to Resend is kept to be asserted on.
let resend: ReturnType<typeof vi.fn>;
let resendCalls: { headers: Record<string, string>; body: Record<string, unknown> }[];

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

type Deposit = { depositPercent: number } | { depositCents: number };

function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
    name: "Andrew Putilin",
  });
  const customer = () =>
    t.run((ctx) =>
      ctx.db.insert("customers", { name: "Maria Delgado", email: "maria@example.com", phone: "" }),
    );
  const site = (customerId: Id<"customers">, region = "WA") =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: "1300FRANKLIN",
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region,
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
  // A sent proposal whose one solution, "Fix gate", is two hours at $250
  // marked up 10%: $550.00, and $598.95 with Washington's 8.9%.
  const sent = async (options: { deposit?: Deposit; region?: string } = {}) => {
    const siteId = await site(await customer(), options.region);
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title: "Fix gate" });
    await owner.mutation(api.solutions.update, {
      solutionId,
      description: "Rehang the gate.",
      lineItems: [{ name: "Gate labor", quantity: 2, unitCostCents: 25_000, unit: "HR" }],
    });
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [solutionId] });
    if (options.deposit)
      await owner.mutation(api.proposals.update, { proposalId, ...options.deposit });
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    resendCalls = [];
    const token = (await t.run((ctx) => ctx.db.query("signingLinks").collect())).find(
      (link) => link.proposalId === proposalId && link.endedAt === undefined,
    )?.token;
    if (!token) throw new Error("No live link.");
    return { siteId, proposalId, token };
  };
  const approve = (token: string) =>
    t.action(api.proposals.approve, {
      token,
      signerName: "Maria Delgado",
      consentTicked: true,
      noticeTicked: false,
      consentWordingVersion: SigningConsent.version,
      noticeWordingVersion: WashingtonNoticeToCustomer.version,
    });
  const deliver = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const invoicesOn = (proposalId: Id<"proposals">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("invoices").collect()).filter((i) => i.proposalId === proposalId),
    );
  // The letters of one kind Resend was asked to send.
  const letters = (kind: string) =>
    resendCalls.filter((call) =>
      (call.body.tags as { value: string }[]).some((tag) => tag.value === kind),
    );
  // The customer's invoice link, as the email carried it.
  const linkIn = (call: { body: Record<string, unknown> }) => {
    const match = /\/sign\/([A-Za-z0-9_-]+)/.exec(String(call.body.text));
    if (!match) throw new Error("No link in the letter.");
    return match[1];
  };
  return { t, sent, approve, deliver, invoicesOn, letters, linkIn };
}

describe("Approve makes the deposit invoice", () => {
  test("sent, numbered INV-1001, with the Deposit's share before tax and the frozen block", async () => {
    const { t, sent, approve, deliver, invoicesOn } = fixture();
    const { siteId, proposalId, token } = await sent();
    const customerId = (await t.run((ctx) => ctx.db.get(siteId)))!.customerId;
    await approve(token);

    const invoices = await invoicesOn(proposalId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      proposalId,
      siteId,
      customerId,
      kind: "deposit",
      state: "sent",
      number: 1001,
      sentAt: Date.now(),
      // Half of $598.95 is $299.48, whose share before 8.9% tax is $275.00.
      lines: [{ description: "Deposit (50%) for Fix gate", cents: 27_500 }],
      taxRate: 0.089,
      frozen: {
        customerName: "Maria Delgado",
        site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
        proposalCode: "1300FRANKLIN-P1",
        proposalName: "Fix gate",
        sentTo: "maria@example.com",
      },
    });
    await deliver();
  });

  test("names a set Deposit without a percent", async () => {
    const { sent, approve, deliver, invoicesOn } = fixture();
    const { proposalId, token } = await sent({ deposit: { depositCents: 20_000 } });
    await approve(token);
    expect((await invoicesOn(proposalId))[0].lines).toEqual([
      // $200.00 taken back to its share before 8.9% tax.
      { description: "Deposit for Fix gate", cents: 18_365 },
    ]);
    await deliver();
  });

  test("copies a rate of 0 from a proposal that charges no tax", async () => {
    const { sent, approve, deliver, invoicesOn } = fixture();
    const { proposalId, token } = await sent({ region: "OR" });
    await approve(token);
    const [invoice] = await invoicesOn(proposalId);
    expect(invoice).toMatchObject({
      taxRate: 0,
      lines: [{ description: "Deposit (50%) for Fix gate", cents: 27_500 }],
    });
    await deliver();
  });

  test("makes nothing for a 0% or a $0 Deposit, and sends no invoice email", async () => {
    const { t, sent, approve, deliver, letters } = fixture();
    const percent = await sent({ deposit: { depositPercent: 0 } });
    const amount = await sent({ deposit: { depositCents: 0 } });
    await approve(percent.token);
    await approve(amount.token);
    await deliver();

    expect(await t.run((ctx) => ctx.db.query("invoices").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("invoiceLinks").collect())).toEqual([]);
    expect(letters("invoice_link")).toEqual([]);
    expect(letters("approval")).toHaveLength(4);
  });

  test("gives two approvals consecutive numbers from the one business-wide sequence", async () => {
    const { sent, approve, deliver, invoicesOn } = fixture();
    const first = await sent();
    const second = await sent();
    await approve(first.token);
    await approve(second.token);
    expect((await invoicesOn(first.proposalId))[0].number).toBe(1001);
    expect((await invoicesOn(second.proposalId))[0].number).toBe(1002);
    await deliver();
  });

  test("a refused Approve makes no invoice and takes no number", async () => {
    const { t, sent, approve, deliver, invoicesOn } = fixture();
    const { proposalId, token } = await sent();
    await approve(token);
    await expect(approve(token)).rejects.toThrow(/no longer live/);
    expect(await invoicesOn(proposalId)).toHaveLength(1);
    const second = await sent();
    await approve(second.token);
    expect((await invoicesOn(second.proposalId))[0].number).toBe(1002);
    expect(await t.run((ctx) => ctx.db.query("invoices").collect())).toHaveLength(2);
    await deliver();
  });
});

describe("The invoice link email", () => {
  test("goes out beside the approval emails, from the Estimator, with the first line, amount due and link", async () => {
    const { t, sent, approve, deliver, letters, linkIn } = fixture();
    const { proposalId, token } = await sent();
    await approve(token);
    const [link] = await t.run((ctx) => ctx.db.query("invoiceLinks").collect());
    expect(link).toMatchObject({ sentTo: "maria@example.com", sentAt: Date.now() });
    expect(link.email).toBeUndefined();
    await deliver();

    expect(letters("approval")).toHaveLength(2);
    const [letter] = letters("invoice_link");
    expect(letters("invoice_link")).toHaveLength(1);
    expect(letter.headers["idempotency-key"]).toBe(`invoice-link/${link._id}`);
    expect(letter.body).toEqual({
      from: "Expand Handyman <proposals@expandhandyman.com>",
      to: ["maria@example.com"],
      reply_to: "contact@expandhandyman.com",
      subject: "Your Expand Handyman invoice for 1300 Franklin St",
      text: [
        "Hello Maria Delgado,",
        "",
        "Andrew Putilin at Expand Handyman has sent you Invoice INV-1001 for 1300 Franklin St: Deposit (50%) for Fix gate, $299.48. It is due on receipt.",
        "",
        "See it and how to pay here:",
        `https://staff.expandhandyman.com/sign/${link.token}`,
        "",
        "This link is yours alone. Reply to this email with any questions.",
      ].join("\n"),
      tags: [{ name: "letter", value: "invoice_link" }],
    });
    expect(linkIn(letter)).toBe(link.token);
    expect(link.invoiceId).toBe((await t.run((ctx) => ctx.db.query("invoices").collect()))[0]._id);

    const recorded = await t.run((ctx) => ctx.db.get(link._id));
    expect(recorded?.email).toEqual({ outcome: "sent", id: "resend-message-1" });
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.state).toBe("approved");
  });

  test("a failed send is written to the link and leaves the invoice sent", async () => {
    const { t, sent, approve, deliver, invoicesOn } = fixture();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { proposalId, token } = await sent();
    resend.mockImplementation(async () => new Response("down", { status: 503 }));
    await approve(token);
    await deliver();
    const [link] = await t.run((ctx) => ctx.db.query("invoiceLinks").collect());
    expect(link.email).toEqual({ outcome: "fault", fault: "HTTP_503" });
    expect((await invoicesOn(proposalId))[0].state).toBe("sent");
  });
});

describe("The invoice link", () => {
  test("opens the invoice paper for a sent invoice, with its pay bar, logging nothing", async () => {
    const { t, sent, approve, deliver, letters, linkIn } = fixture();
    const { token } = await sent();
    await approve(token);
    await deliver();
    const invoiceToken = linkIn(letters("invoice_link")[0]);

    expect(await t.query(api.signingLinks.resolve, { token: invoiceToken })).toBe("invoice");
    const page = await t.query(api.invoiceLinks.page, { token: invoiceToken });
    expect(page).toEqual({
      paper: {
        number: "INV-1001",
        sentAt: Date.now(),
        customerName: "Maria Delgado",
        site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
        proposalCode: "1300FRANKLIN-P1",
        proposalName: "Fix gate",
        lines: [{ description: "Deposit (50%) for Fix gate", cents: 27_500 }],
        taxRate: 0.089,
        zelleTag: "expandhandyman",
        mailingAddress: null,
        stamp: null,
      },
      // The pay bar under it: $299.48 owed, so Pay by card is offered beside
      // Pay by bank, and Stripe has nothing to tell yet.
      payable: true,
      ways: ["bank", "card"],
      zelleTag: "expandhandyman",
      mailingAddress: null,
      invoiceNumber: "INV-1001",
      amountDueCents: 29_948,
      stripe: null,
    });

    // An invoice link is not a signing link: the proposal's view log never
    // hears of it, and nothing about it is logged anywhere.
    expect(await t.mutation(api.signingLinks.opened, { token: invoiceToken })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("proposalViews").collect())).toEqual([]);
    // The proposal's own link still opens the signed copy.
    expect(await t.query(api.signingLinks.resolve, { token })).toBe("proposal");
  });

  test("prints the Zelle tag the settings hold", async () => {
    const { t, sent, approve, deliver, letters, linkIn } = fixture();
    const { token } = await sent();
    await approve(token);
    await deliver();
    await t.run((ctx) => ctx.db.insert("settings", { zelleTag: "expand-handyman-wa" }));
    const page = await t.query(api.invoiceLinks.page, {
      token: linkIn(letters("invoice_link")[0]),
    });
    expect(page?.paper.zelleTag).toBe("expand-handyman-wa");
  });

  test("a link a re-send has ended is still an invoice's, and opens nothing", async () => {
    const { t, sent, approve, deliver } = fixture();
    const { token } = await sent();
    await approve(token);
    await deliver();
    const [link] = await t.run((ctx) => ctx.db.query("invoiceLinks").collect());
    await t.run((ctx) => ctx.db.patch(link._id, { endedAt: Date.now(), endedReason: "resent" }));
    expect(await t.query(api.signingLinks.resolve, { token: link.token })).toBe("invoice");
    expect(await t.query(api.invoiceLinks.page, { token: link.token })).toBeNull();
  });

  test("an unknown token still opens nothing", async () => {
    const { t } = fixture();
    const unknown = "x".repeat(43);
    expect(await t.query(api.signingLinks.resolve, { token: unknown })).toBe("unknown");
    expect(await t.query(api.invoiceLinks.page, { token: unknown })).toBeNull();
    expect(await t.query(api.invoiceLinks.page, { token: "" })).toBeNull();
  });
});
