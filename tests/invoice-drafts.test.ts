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
  const invoice = (invoiceId: Id<"invoices">) => t.run((ctx) => ctx.db.get(invoiceId));
  const invoicesOn = (proposalId: Id<"proposals">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("invoices").collect()).filter((i) => i.proposalId === proposalId),
    );
  const panel = (invoiceId: Id<"invoices">) =>
    owner.query(api.invoices.panel, { invoiceId, today: today() });
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
    invoice,
    invoicesOn,
    panel,
  };
}

// The approved proposal in the fixture is "Fix gate", $550 before tax at
// 8.9%, and Approve sent its deposit invoice, INV-1001, for $275 before tax.
const gate = { description: "Fix gate", cents: 55_000 };
const lessDeposit = { description: "Less deposit invoiced (INV-1001)", cents: -27_500 };

describe("Job done", () => {
  test("raises the final invoice as a draft, prefilled with the price less the deposit invoice", async () => {
    const { owner, customer, approved, invoice, panel } = fixture();
    const maria = await customer();
    const { proposalId, siteId } = await approved(maria);

    // What the button will make, asked before it is pressed.
    expect(await owner.query(api.invoices.finalPrefill, { proposalId })).toEqual({
      lines: [gate, lessDeposit],
      money: { subtotalCents: 27_500, taxCents: 2_448, amountDueCents: 29_948 },
    });

    const invoiceId = await owner.mutation(api.invoices.jobDone, { proposalId });
    const made = await invoice(invoiceId);
    expect(made).toMatchObject({
      proposalId,
      siteId,
      customerId: maria,
      kind: "final",
      state: "draft",
      lines: [gate, lessDeposit],
      taxRate: 0.089,
    });
    expect(made?.number).toBeUndefined();
    expect(made?.sentAt).toBeUndefined();
    expect(made?.frozen).toBeUndefined();
    expect(await panel(invoiceId)).toMatchObject({
      title: "Draft · Final",
      standing: null,
      money: { subtotalCents: 27_500, taxCents: 2_448, amountDueCents: 29_948 },
      sendBlockers: [],
      links: [],
      liveUrl: null,
    });
    // The proposal itself does not change state.
    expect(
      (await owner.query(api.proposals.forCustomer, { customerId: maria })).proposals[0].state,
    ).toBe("approved");
  });

  test("takes off every invoice sent on the proposal in number order, skipping void ones and drafts", async () => {
    const { owner, customer, approved, written, sentBlock, invoice } = fixture();
    const { proposalId } = await approved(await customer());
    await written(proposalId, {
      kind: "typed",
      title: "Framing midway",
      state: "sent",
      lines: [{ description: "Framing midway", cents: 10_000 }],
      ...sentBlock(1004),
    });
    await written(proposalId, {
      kind: "typed",
      state: "void",
      lines: [{ description: "Wrong one", cents: 9_900 }],
      ...sentBlock(1003),
      voidedAt: Date.now(),
    });
    await written(proposalId, {
      kind: "typed",
      lines: [{ description: "Still a draft", cents: 5_000 }],
    });
    const invoiceId = await owner.mutation(api.invoices.jobDone, { proposalId });
    expect((await invoice(invoiceId))?.lines).toEqual([
      gate,
      lessDeposit,
      { description: "Less invoiced (INV-1004)", cents: -10_000 },
    ]);
  });

  test("is refused once a final invoice is a draft or sent, and offered again once that draft is deleted", async () => {
    const { owner, customer, approved, invoicesOn } = fixture();
    const { proposalId } = await approved(await customer());
    const first = await owner.mutation(api.invoices.jobDone, { proposalId });

    expect(await owner.query(api.invoices.finalPrefill, { proposalId })).toBeNull();
    await expect(owner.mutation(api.invoices.jobDone, { proposalId })).rejects.toThrow(
      /already has its final invoice/,
    );
    expect(await invoicesOn(proposalId)).toHaveLength(2);

    await owner.mutation(api.invoices.remove, { invoiceId: first });
    expect(await owner.query(api.invoices.finalPrefill, { proposalId })).not.toBeNull();
    const second = await owner.mutation(api.invoices.jobDone, { proposalId });

    await owner.action(api.invoices.send, { invoiceId: second });
    expect(await owner.query(api.invoices.finalPrefill, { proposalId })).toBeNull();
    await expect(owner.mutation(api.invoices.jobDone, { proposalId })).rejects.toThrow(
      /already has its final invoice/,
    );
  });

  test("comes back once the final invoice is void, which it no longer takes off", async () => {
    const { t, owner, customer, approved, invoice } = fixture();
    const { proposalId } = await approved(await customer());
    const first = await owner.mutation(api.invoices.jobDone, { proposalId });
    await owner.action(api.invoices.send, { invoiceId: first });
    await t.run((ctx) => ctx.db.patch(first, { state: "void", voidedAt: Date.now() }));

    const second = await owner.mutation(api.invoices.jobDone, { proposalId });
    expect((await invoice(second))?.lines).toEqual([gate, lessDeposit]);
  });

  test("reports a balance of nothing or a credit before it is pressed, for the button to ask first", async () => {
    const { owner, customer, approved, written, sentBlock } = fixture();
    const { proposalId } = await approved(await customer());
    await written(proposalId, {
      kind: "typed",
      state: "sent",
      lines: [{ description: "The rest, early", cents: 27_500 }],
      ...sentBlock(1002),
    });
    expect((await owner.query(api.invoices.finalPrefill, { proposalId }))?.money).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      amountDueCents: 0,
    });
    await written(proposalId, {
      kind: "typed",
      state: "sent",
      lines: [{ description: "Extra", cents: 1_000 }],
      ...sentBlock(1003),
    });
    expect(
      (await owner.query(api.invoices.finalPrefill, { proposalId }))?.money.amountDueCents,
    ).toBe(-1_089);
  });

  test("is refused on a proposal that is not approved, as New invoice is", async () => {
    const { owner, customer, sent, invoicesOn } = fixture();
    const { proposalId } = await sent(await customer());
    expect(await owner.query(api.invoices.finalPrefill, { proposalId })).toBeNull();
    await expect(owner.mutation(api.invoices.jobDone, { proposalId })).rejects.toThrow(
      /Only an approved proposal/,
    );
    await expect(owner.mutation(api.invoices.createTyped, { proposalId })).rejects.toThrow(
      /Only an approved proposal/,
    );
    expect(await invoicesOn(proposalId)).toEqual([]);
  });
});

describe("New invoice", () => {
  test("makes an empty typed draft at the proposal's rate", async () => {
    const { owner, customer, approved, invoice, panel } = fixture();
    const maria = await customer();
    const { proposalId, siteId } = await approved(maria);
    const invoiceId = await owner.mutation(api.invoices.createTyped, { proposalId });
    expect(await invoice(invoiceId)).toMatchObject({
      proposalId,
      siteId,
      customerId: maria,
      kind: "typed",
      state: "draft",
      lines: [],
      taxRate: 0.089,
    });
    expect(await panel(invoiceId)).toMatchObject({
      title: "Draft · Invoice",
      typedTitle: null,
      sendBlockers: ["no_lines"],
    });
    // Any number of them, beside the final invoice.
    await owner.mutation(api.invoices.jobDone, { proposalId });
    await owner.mutation(api.invoices.createTyped, { proposalId });
  });
});

describe("Editing a draft", () => {
  test("changes its title and lines, and the money follows", async () => {
    const { owner, customer, approved, invoice, panel } = fixture();
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.createTyped, { proposalId });
    await owner.mutation(api.invoices.update, {
      invoiceId,
      title: "  Framing midway ",
      lines: [
        { description: " Framing ", cents: 40_000 },
        { description: "Credit for returned lumber", cents: -5_000 },
      ],
    });
    expect(await invoice(invoiceId)).toMatchObject({
      title: "Framing midway",
      lines: [
        { description: "Framing", cents: 40_000 },
        { description: "Credit for returned lumber", cents: -5_000 },
      ],
    });
    expect(await panel(invoiceId)).toMatchObject({
      title: "Draft · Framing midway",
      typedTitle: "Framing midway",
      money: { subtotalCents: 35_000, taxCents: 3_115, amountDueCents: 38_115 },
    });

    // Reordered and cut down: the lines are stored whole each time.
    await owner.mutation(api.invoices.update, {
      invoiceId,
      lines: [
        { description: "Credit for returned lumber", cents: -5_000 },
        { description: "Framing", cents: 40_000 },
      ],
    });
    expect((await invoice(invoiceId))?.lines.map((line) => line.cents)).toEqual([
      -5_000, 40_000,
    ]);
    await owner.mutation(api.invoices.update, {
      invoiceId,
      lines: [{ description: "Framing", cents: 40_000 }],
    });
    expect((await invoice(invoiceId))?.lines).toEqual([{ description: "Framing", cents: 40_000 }]);
    // An emptied title is no title.
    await owner.mutation(api.invoices.update, { invoiceId, title: " " });
    expect((await invoice(invoiceId))?.title).toBeUndefined();
  });

  test("edits a final invoice's lines, but it has no title to give", async () => {
    const { owner, customer, approved, invoice } = fixture();
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.jobDone, { proposalId });
    const extra = { description: "Approved extra: second hinge", cents: 4_500 };
    await owner.mutation(api.invoices.update, {
      invoiceId,
      lines: [gate, lessDeposit, extra],
    });
    expect((await invoice(invoiceId))?.lines).toEqual([gate, lessDeposit, extra]);
    await expect(
      owner.mutation(api.invoices.update, { invoiceId, title: "Closing" }),
    ).rejects.toThrow(/Only a typed invoice has a title/);
  });

  test("refuses an amount that is not whole cents", async () => {
    const { owner, customer, approved } = fixture();
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.createTyped, { proposalId });
    await expect(
      owner.mutation(api.invoices.update, {
        invoiceId,
        lines: [{ description: "Hinge", cents: 10.5 }],
      }),
    ).rejects.toThrow(/whole cents/);
  });

  test("never changes a sent invoice's lines", async () => {
    const { owner, customer, approved, invoice } = fixture();
    const { proposalId, invoiceId } = await approved(await customer());
    await expect(
      owner.mutation(api.invoices.update, { invoiceId, lines: [gate] }),
    ).rejects.toThrow(/Only a draft invoice can be edited/);
    const final = await owner.mutation(api.invoices.jobDone, { proposalId });
    await owner.action(api.invoices.send, { invoiceId: final });
    await expect(
      owner.mutation(api.invoices.update, { invoiceId: final, lines: [gate] }),
    ).rejects.toThrow(/Only a draft invoice can be edited/);
    expect((await invoice(final))?.lines).toEqual([gate, lessDeposit]);
  });
});

describe("Delete", () => {
  test("leaves no row of a draft", async () => {
    const { owner, customer, approved, invoice, invoicesOn } = fixture();
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.createTyped, { proposalId });
    await owner.mutation(api.invoices.remove, { invoiceId });
    expect(await invoice(invoiceId)).toBeNull();
    expect(await invoicesOn(proposalId)).toHaveLength(1);
  });

  test("works on drafts only", async () => {
    const { owner, customer, approved, invoice } = fixture();
    const { invoiceId } = await approved(await customer());
    await expect(owner.mutation(api.invoices.remove, { invoiceId })).rejects.toThrow(
      /Only a draft invoice can be deleted/,
    );
    expect(await invoice(invoiceId)).not.toBeNull();
  });
});

describe("Send", () => {
  test("is refused for a draft with no lines", async () => {
    const { owner, customer, approved } = fixture();
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.createTyped, { proposalId });
    expect(await refusal(owner.action(api.invoices.send, { invoiceId }))).toMatchObject({
      code: "no_lines",
      blockers: ["no_lines"],
      message: "This invoice has no lines.",
    });
  });

  test("is refused while a line has no description", async () => {
    const { owner, customer, approved, panel } = fixture();
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.jobDone, { proposalId });
    await owner.mutation(api.invoices.update, {
      invoiceId,
      lines: [gate, lessDeposit, { description: "", cents: 4_500 }],
    });
    expect((await panel(invoiceId))?.sendBlockers).toEqual(["blank_line"]);
    expect(await refusal(owner.action(api.invoices.send, { invoiceId }))).toMatchObject({
      code: "blank_line",
      message: "A line on this invoice has no description.",
    });
  });

  test("is refused when the customer has no email address", async () => {
    const { t, owner, customer, approved } = fixture();
    const maria = await customer();
    const { proposalId } = await approved(maria);
    const invoiceId = await owner.mutation(api.invoices.jobDone, { proposalId });
    await t.run((ctx) => ctx.db.patch(maria, { email: "" }));
    expect(await refusal(owner.action(api.invoices.send, { invoiceId }))).toMatchObject({
      code: "no_email",
      message: "The customer has no email address to send it to.",
    });
  });

  test("names every reason at once, and a refused Send changes nothing and takes no number", async () => {
    const { t, owner, customer, approved, invoice, links, panel } = fixture();
    const maria = await customer();
    const { proposalId } = await approved(maria);
    const invoiceId = await owner.mutation(api.invoices.createTyped, { proposalId });
    await t.run((ctx) => ctx.db.patch(maria, { email: "" }));
    expect((await panel(invoiceId))?.sendBlockers).toEqual(["no_lines", "no_email"]);
    expect(await refusal(owner.action(api.invoices.send, { invoiceId }))).toMatchObject({
      code: "no_lines",
      blockers: ["no_lines", "no_email"],
      message: "This invoice has no lines. The customer has no email address to send it to.",
    });
    expect((await invoice(invoiceId))?.state).toBe("draft");
    expect(await links(invoiceId)).toEqual([]);

    await t.run((ctx) => ctx.db.patch(maria, { email: "maria@example.com" }));
    await owner.mutation(api.invoices.update, { invoiceId, lines: [gate] });
    await owner.action(api.invoices.send, { invoiceId });
    expect((await invoice(invoiceId))?.number).toBe(1002);
  });

  test("gives the next number, freezes the block, mints the link and emails it from the owner", async () => {
    const { t, owner, customer, approved, invoice, links, letters, deliver, panel } = fixture();
    const maria = await customer();
    const { proposalId, siteId } = await approved(maria);
    const invoiceId = await owner.mutation(api.invoices.jobDone, { proposalId });
    // A draft is invisible through any link: it has none.
    expect(await links(invoiceId)).toEqual([]);

    vi.setSystemTime(pdt(9, 20));
    await owner.action(api.invoices.send, { invoiceId });
    const sent = await invoice(invoiceId);
    expect(sent).toMatchObject({
      state: "sent",
      number: 1002,
      sentAt: pdt(9, 20),
      lines: [gate, lessDeposit],
      frozen: {
        customerName: "Maria Delgado",
        site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
        proposalCode: "1300FRANKLIN1-P1",
        proposalName: "Fix gate",
        sentTo: "maria@example.com",
      },
    });
    const [link] = await links(invoiceId);
    expect(link).toMatchObject({ sentTo: "maria@example.com", sentAt: pdt(9, 20) });
    expect(await panel(invoiceId)).toMatchObject({
      title: "INV-1002 · Final",
      standing: "unpaid",
      sendBlockers: [],
      liveUrl: `https://staff.expandhandyman.com/sign/${link.token}`,
    });

    await deliver();
    const [letter] = letters();
    expect(letters()).toHaveLength(1);
    expect(letter.headers["idempotency-key"]).toBe(`invoice-link/${link._id}`);
    expect(letter.body).toMatchObject({
      from: "Expand Handyman <proposals@expandhandyman.com>",
      to: ["maria@example.com"],
      reply_to: "contact@expandhandyman.com",
      subject: "Your Expand Handyman invoice for 1300 Franklin St",
    });
    expect(String(letter.body.text)).toContain(
      "Andrew Putilin at Expand Handyman has sent you Invoice INV-1002 for 1300 Franklin St: Fix gate, $299.48. It is due on receipt.",
    );
    expect(String(letter.body.text)).toContain(`/sign/${link.token}`);

    // The customer's link now shows the paper, dated the day it was sent.
    const page = await t.query(api.invoiceLinks.page, { token: link.token });
    expect(page?.paper).toMatchObject({ number: "INV-1002", sentAt: pdt(9, 20) });

    // Later edits to the customer and the site change nothing it shows.
    await t.run(async (ctx) => {
      await ctx.db.patch(maria, { name: "Maria D. Delgado", email: "md@example.com" });
      await ctx.db.patch(siteId, { addressLine1: "1400 Franklin St" });
    });
    expect((await invoice(invoiceId))?.frozen).toEqual(sent?.frozen);
    expect(await owner.query(api.invoices.paper, { invoiceId })).toMatchObject({
      number: "INV-1002",
      customerName: "Maria Delgado",
      site: { street: "1300 Franklin St" },
    });
  });

  test("sends a typed invoice named by its title", async () => {
    const { owner, customer, approved, panel } = fixture();
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.createTyped, { proposalId });
    await owner.mutation(api.invoices.update, {
      invoiceId,
      title: "Framing midway",
      lines: [{ description: "Framing", cents: 40_000 }],
    });
    await owner.action(api.invoices.send, { invoiceId });
    expect((await panel(invoiceId))?.title).toBe("INV-1002 · Framing midway");
  });

  test("a failed email leaves the invoice sent with its link to copy", async () => {
    const { owner, customer, approved, invoice, links, deliver, panel } = fixture();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.jobDone, { proposalId });
    resend.mockImplementation(async () => new Response("down", { status: 503 }));
    await owner.action(api.invoices.send, { invoiceId });
    await deliver();
    const [link] = await links(invoiceId);
    expect(link.email).toEqual({ outcome: "fault", fault: "HTTP_503" });
    expect((await invoice(invoiceId))?.state).toBe("sent");
    expect((await panel(invoiceId))?.liveUrl).toBe(
      `https://staff.expandhandyman.com/sign/${link.token}`,
    );
  });

  test("sends only a draft", async () => {
    const { owner, customer, approved } = fixture();
    const { invoiceId } = await approved(await customer());
    await expect(owner.action(api.invoices.send, { invoiceId })).rejects.toThrow(
      /Only a draft invoice can be sent/,
    );
  });
});

describe("The invoice number", () => {
  test("two sends at once get different numbers", async () => {
    const { owner, customer, approved, invoice } = fixture();
    const { proposalId } = await approved(await customer());
    const final = await owner.mutation(api.invoices.jobDone, { proposalId });
    const typed = await owner.mutation(api.invoices.createTyped, { proposalId });
    await owner.mutation(api.invoices.update, { invoiceId: typed, lines: [gate] });
    await Promise.all([
      owner.action(api.invoices.send, { invoiceId: final }),
      owner.action(api.invoices.send, { invoiceId: typed }),
    ]);
    const numbers = [(await invoice(final))?.number, (await invoice(typed))?.number];
    expect(numbers.sort()).toEqual([1002, 1003]);
  });

  test("is never reused: a deleted draft never had one, and a void invoice keeps its own", async () => {
    const { t, owner, customer, approved, invoice } = fixture();
    const { proposalId, invoiceId: deposit } = await approved(await customer());
    const deleted = await owner.mutation(api.invoices.createTyped, { proposalId });
    await owner.mutation(api.invoices.remove, { invoiceId: deleted });
    await t.run((ctx) => ctx.db.patch(deposit, { state: "void", voidedAt: Date.now() }));

    const final = await owner.mutation(api.invoices.jobDone, { proposalId });
    // The void deposit invoice is not taken off.
    expect((await invoice(final))?.lines).toEqual([gate]);
    await owner.action(api.invoices.send, { invoiceId: final });
    expect((await invoice(final))?.number).toBe(1002);
    expect((await invoice(deposit))?.number).toBe(1001);
  });
});

describe("A stranger", () => {
  test("is refused everywhere a draft is made, edited, deleted or sent", async () => {
    const { owner, stranger, customer, approved } = fixture();
    const { proposalId } = await approved(await customer());
    const invoiceId = await owner.mutation(api.invoices.createTyped, { proposalId });
    const refused = /Owner access required/;
    await expect(stranger.query(api.invoices.finalPrefill, { proposalId })).rejects.toThrow(
      refused,
    );
    await expect(stranger.mutation(api.invoices.jobDone, { proposalId })).rejects.toThrow(
      refused,
    );
    await expect(stranger.mutation(api.invoices.createTyped, { proposalId })).rejects.toThrow(
      refused,
    );
    await expect(
      stranger.mutation(api.invoices.update, { invoiceId, lines: [gate] }),
    ).rejects.toThrow(refused);
    await expect(stranger.mutation(api.invoices.remove, { invoiceId })).rejects.toThrow(refused);
    await expect(stranger.action(api.invoices.send, { invoiceId })).rejects.toThrow(refused);
  });
});
