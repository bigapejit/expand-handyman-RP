import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// DOR's answer for a Vancouver address, for a proposal sent from a deal's site.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 23, 18, 0));
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

function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
    name: "Andrew Putilin",
  });
  const deals = () => t.run((ctx) => ctx.db.query("deals").collect());
  const customers = () => t.run((ctx) => ctx.db.query("customers").collect());
  const customer = (name = "Maria Delgado") =>
    t.run((ctx) =>
      ctx.db.insert("customers", { name, email: "maria@example.com", phone: "+13605550187" }),
    );
  const site = (customerId: Id<"customers">, street = "1300 Franklin St") =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: "1300FRANKLIN",
        addressLine1: street,
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: `place-${street}`,
        latitude: 45.63,
        longitude: -122.67,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
  // A proposal from `siteId` sent through the real Send.
  const send = async (siteId: Id<"sites">) => {
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title: "Fix gate" });
    await owner.mutation(api.solutions.update, {
      solutionId,
      description: "Rehang the gate.",
      lineItems: [{ name: "Gate labor", quantity: 2, unitCostCents: 25_000, unit: "HR" }],
    });
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [solutionId] });
    await owner.action(api.proposals.send, { proposalId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return proposalId;
  };
  // The customer approving a sent proposal through its live link.
  const approve = async (siteId: Id<"sites">, proposalId: Id<"proposals">) => {
    const tab = await owner.query(api.proposals.forSite, { siteId });
    const token = tab.proposals.find((p) => p.proposalId === proposalId)?.liveToken;
    if (!token) throw new Error("No live link.");
    await t.action(api.proposals.approve, {
      token,
      signerName: "Maria Delgado",
      consentTicked: true,
      noticeTicked: true,
      consentWordingVersion: SigningConsent.version,
      noticeWordingVersion: WashingtonNoticeToCustomer.version,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  // One deal as the **Pipeline** reads it.
  const row = async (dealId: Id<"deals">) =>
    (await owner.query(api.deals.board, {})).find((r) => r._id === dealId);
  return { t, owner, deals, customers, customer, site, send, approve, row };
}

describe("create", () => {
  test("makes a deal in New for a customer on file, at one of their sites", async () => {
    const { owner, deals, customer, site } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "  Fence repair, 3 panels  ",
      source: "referral",
      siteId,
      ballparkCents: 90_000,
      notes: " Referred by Ken. ",
    });
    expect(await deals()).toMatchObject([
      {
        _id: dealId,
        customerId,
        siteId,
        title: "Fence repair, 3 panels",
        source: "referral",
        stage: "new",
        stageChangedAt: Date.now(),
        notes: "Referred by Ken.",
        ballparkCents: 90_000,
        createdAt: Date.now(),
      },
    ]);
  });

  test("makes the customer too, from a name alone", async () => {
    const { owner, deals, customers } = fixture();
    await owner.mutation(api.deals.create, {
      customer: { name: " Tom Brandt " },
      title: "Gutter cleaning",
      source: "phone",
    });
    const [made] = await customers();
    expect(made).toMatchObject({ name: "Tom Brandt", email: "", phone: "" });
    expect(await deals()).toMatchObject([{ customerId: made._id, notes: "" }]);
    expect((await deals())[0]).not.toHaveProperty("ballparkCents");
    expect((await deals())[0]).not.toHaveProperty("siteId");
  });

  test("keeps a new customer's number and email in the customer's own form", async () => {
    const { owner, customers } = fixture();
    await owner.mutation(api.deals.create, {
      customer: { name: "Tom Brandt", phone: "(360) 555-0142", email: " Tom@Example.com " },
      title: "Gutter cleaning",
      source: "website",
    });
    expect(await customers()).toMatchObject([
      { name: "Tom Brandt", phone: "+13605550142", email: "tom@example.com" },
    ]);
  });

  test("refuses what the dialog would, and writes nothing", async () => {
    const { owner, deals, customers, customer, site } = fixture();
    const make = (a: Partial<FunctionArgs<typeof api.deals.create>>) =>
      owner.mutation(api.deals.create, {
        customer: { name: "Tom Brandt" },
        title: "Gutter cleaning",
        source: "phone",
        ...a,
      });
    await expect(make({ title: "   " })).rejects.toThrow(/Say what the job is/);
    await expect(make({ customer: { name: "Tom", phone: "555-12" } })).rejects.toThrow(
      /valid US phone/,
    );
    await expect(make({ customer: { name: " " } })).rejects.toThrow(/customer name/);
    await expect(make({ ballparkCents: 12_345 })).rejects.toThrow(/whole number of dollars/);
    // A new customer has no sites, so any site is someone else's.
    const other = await site(await customer("Someone Else"));
    await expect(make({ siteId: other })).rejects.toThrow(/no sites yet/);
    // Thumbtack is the webhook's alone.
    await expect(
      owner.mutation(api.deals.create, {
        customer: { name: "Tom Brandt" },
        title: "Gutter cleaning",
        source: "thumbtack" as "phone",
      }),
    ).rejects.toThrow();
    expect(await deals()).toHaveLength(0);
    expect(await customers()).toHaveLength(1);
  });

  test("refuses a site that is not the customer's", async () => {
    const { owner, deals, customer, site } = fixture();
    const customerId = await customer();
    const other = await site(await customer("Someone Else"));
    await expect(
      owner.mutation(api.deals.create, {
        customer: { customerId },
        title: "Fence repair",
        source: "referral",
        siteId: other,
      }),
    ).rejects.toThrow(/another customer/);
    expect(await deals()).toHaveLength(0);
  });
});

describe("the owner's moves", () => {
  const made = async ({ owner, customer }: ReturnType<typeof fixture>) =>
    owner.mutation(api.deals.create, {
      customer: { customerId: await customer() },
      title: "Fence repair",
      source: "referral",
    });

  test("setStage moves a deal to any stage and stamps when", async () => {
    const f = fixture();
    const dealId = await made(f);
    vi.advanceTimersByTime(60_000);
    await f.owner.mutation(api.deals.setStage, { dealId, stage: "won" });
    expect((await f.deals())[0]).toMatchObject({ stage: "won", stageChangedAt: Date.now() });
    const wonAt = Date.now();
    vi.advanceTimersByTime(60_000);
    await f.owner.mutation(api.deals.setStage, { dealId, stage: "talking" });
    expect((await f.deals())[0].stage).toBe("talking");
    // The same stage again leaves the stamp alone.
    const movedAt = Date.now();
    vi.advanceTimersByTime(60_000);
    await f.owner.mutation(api.deals.setStage, { dealId, stage: "talking" });
    expect((await f.deals())[0].stageChangedAt).toBe(movedAt);
    expect(movedAt).toBeGreaterThan(wonAt);
  });

  test("setNotes keeps the owner's notes, trimmed", async () => {
    const f = fixture();
    const dealId = await made(f);
    await f.owner.mutation(api.deals.setNotes, { dealId, notes: "Gate code 1234\nDog in yard\n" });
    expect((await f.deals())[0].notes).toBe("Gate code 1234\nDog in yard");
    await expect(
      f.owner.mutation(api.deals.setNotes, { dealId, notes: "x".repeat(5001) }),
    ).rejects.toThrow(/5,000/);
  });

  test("setSite takes one of the customer's own sites, or none", async () => {
    const f = fixture();
    const dealId = await made(f);
    const [{ customerId }] = await f.deals();
    const own = await f.site(customerId);
    await f.owner.mutation(api.deals.setSite, { dealId, siteId: own });
    expect((await f.deals())[0].siteId).toBe(own);
    await f.owner.mutation(api.deals.setSite, { dealId, siteId: null });
    expect((await f.deals())[0]).not.toHaveProperty("siteId");
  });

  test("setSite refuses another customer's site", async () => {
    const f = fixture();
    const dealId = await made(f);
    const other = await f.site(await f.customer("Someone Else"));
    await expect(f.owner.mutation(api.deals.setSite, { dealId, siteId: other })).rejects.toThrow(
      /another customer/,
    );
    expect((await f.deals())[0]).not.toHaveProperty("siteId");
  });

  test("deleting a site leaves its deal with none", async () => {
    const f = fixture();
    const dealId = await made(f);
    const [{ customerId }] = await f.deals();
    const siteId = await f.site(customerId);
    await f.owner.mutation(api.deals.setSite, { dealId, siteId });
    await f.owner.mutation(api.sites.remove, { siteId });
    expect((await f.deals())[0]).not.toHaveProperty("siteId");
  });
});

describe("board", () => {
  test("lists every deal newest first, with its customer, site and no lead", async () => {
    const { owner, customer, site } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const older = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
      siteId,
      ballparkCents: 90_000,
    });
    vi.advanceTimersByTime(60_000);
    const newer = await owner.mutation(api.deals.create, {
      customer: { name: "Tom Brandt" },
      title: "Gutter cleaning",
      source: "phone",
    });

    const rows = await owner.query(api.deals.board, {});
    expect(rows.map((r) => r._id)).toEqual([newer, older]);
    expect(rows[1]).toMatchObject({
      customerName: "Maria Delgado",
      phone: "+13605550187",
      email: "maria@example.com",
      title: "Fence repair",
      ballparkCents: 90_000,
      site: { siteId, name: "1300FRANKLIN", line: "1300 Franklin St, Vancouver, WA 98660" },
      proposal: null,
      lead: null,
    });
    expect(rows[0]).toMatchObject({ customerName: "Tom Brandt", site: null, proposal: null });
  });

  test("keeps the newest deals and every open one however many have closed", async () => {
    const { t, owner, customer } = fixture();
    const customerId = await customer();
    await t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++)
        await ctx.db.insert("deals", {
          customerId,
          title: `Old job ${i}`,
          source: "phone",
          stage: "lost",
          stageChangedAt: i,
          notes: "",
          createdAt: i,
          updatedAt: i,
        });
    });
    const fresh = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Gutter cleaning",
      source: "phone",
    });
    const rows = await owner.query(api.deals.board, {});
    expect(rows[0]._id).toBe(fresh);
    // The latest closed are kept, the oldest go.
    expect(rows.some((r) => r.title === "Old job 1000")).toBe(true);
    expect(rows.some((r) => r.title === "Old job 0")).toBe(false);
  });

  test("carries the proposal sent from the deal's site, and Send moves it to Sent out", async () => {
    const { owner, customer, site, send, row } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
      siteId,
    });
    await send(siteId);
    const sent = await row(dealId);
    expect(sent).toMatchObject({
      stage: "quoted",
      proposal: { code: "1300FRANKLIN-P1", state: "sent", opened: false, sentAt: Date.now() },
    });
    expect(sent?.proposal?.totalCents).toBeGreaterThan(0);
  });

  test("a proposal from one site leaves the customer's deal at another site alone", async () => {
    const { owner, customer, site, send, row } = fixture();
    const customerId = await customer();
    const here = await site(customerId, "1300 Franklin St");
    const there = await site(customerId, "88 Main St");
    const dealThere = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Deck boards",
      source: "repeat",
      siteId: there,
    });
    await send(here);
    expect((await row(dealThere))?.stage).toBe("new");
  });

  test("a deal with no site takes the site of the proposal that moves it", async () => {
    const { owner, customer, site, send, row } = fixture();
    const customerId = await customer();
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
    });
    const siteId = await site(customerId);
    await send(siteId);
    expect(await row(dealId)).toMatchObject({
      stage: "quoted",
      site: { siteId },
      proposal: { code: "1300FRANKLIN-P1", state: "sent" },
    });
  });

  test("leaves out a proposal sent before the deal began", async () => {
    const { owner, customer, site, send, row } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    await send(siteId);
    vi.advanceTimersByTime(60_000);
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Deck boards",
      source: "repeat",
      siteId,
    });
    expect((await row(dealId))?.proposal).toBeNull();
  });

  test("a re-send restarts the deal's follow-up clock", async () => {
    const { owner, customer, site, send, row } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
      siteId,
    });
    const proposalId = await send(siteId);
    const first = Date.now();
    vi.advanceTimersByTime(10 * 86_400_000);
    await owner.action(api.proposals.resend, { proposalId });
    expect((await row(dealId))?.proposal).toMatchObject({ state: "sent", sentAt: first + 10 * 86_400_000 });
  });

  test("the approved proposal is the deal's, even with a newer one still out", async () => {
    const { owner, customer, site, send, approve, row } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
      siteId,
    });
    const first = await send(siteId);
    vi.advanceTimersByTime(60_000);
    await send(siteId);
    await approve(siteId, first);
    expect(await row(dealId)).toMatchObject({
      stage: "won",
      proposal: { proposalId: first, code: "1300FRANKLIN-P1", state: "approved" },
    });
  });

  test("a won deal reopened and offered again reads the new offer", async () => {
    const { owner, customer, site, send, approve, row } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
      siteId,
    });
    const first = await send(siteId);
    await approve(siteId, first);
    expect((await row(dealId))?.stage).toBe("won");
    await owner.mutation(api.deals.setStage, { dealId, stage: "estimating" });
    vi.advanceTimersByTime(60_000);
    const second = await send(siteId);
    expect(await row(dealId)).toMatchObject({
      stage: "quoted",
      proposal: { proposalId: second, state: "sent" },
    });
  });

  test("two jobs at one site each keep their own proposal, won one after the other", async () => {
    const { owner, customer, site, send, approve, row } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const first = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
      siteId,
    });
    const p1 = await send(siteId);
    await approve(siteId, p1);
    vi.advanceTimersByTime(30 * 86_400_000);
    const second = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Deck boards",
      source: "repeat",
      siteId,
    });
    const p2 = await send(siteId);
    await approve(siteId, p2);
    expect(await row(first)).toMatchObject({ stage: "won", proposal: { proposalId: p1, state: "approved" } });
    expect(await row(second)).toMatchObject({ stage: "won", proposal: { proposalId: p2, state: "approved" } });
  });

  test("a deal closed by hand shows no later offer from its site", async () => {
    const { owner, customer, site, send, row } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const lost = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
      siteId,
    });
    await owner.mutation(api.deals.setStage, { dealId: lost, stage: "lost" });
    vi.advanceTimersByTime(60_000);
    await send(siteId);
    expect(await row(lost)).toMatchObject({ stage: "lost", proposal: null });
  });

  test("moving a deal to another site lets go of the proposal it read", async () => {
    const { owner, customer, site, send, row } = fixture();
    const customerId = await customer();
    const here = await site(customerId, "1300 Franklin St");
    const there = await site(customerId, "88 Main St");
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
      siteId: here,
    });
    await send(here);
    expect((await row(dealId))?.proposal?.state).toBe("sent");
    await owner.mutation(api.deals.setSite, { dealId, siteId: there });
    expect(await row(dealId)).toMatchObject({ site: { siteId: there }, proposal: null });
  });

  test("a lead from before deals is moved too, getting its deal on the way", async () => {
    const { t, owner, customer, site, send, deals } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const leadId = await t.run((ctx) =>
      ctx.db.insert("leads", {
        customerId,
        negotiationId: "901",
        thumbtackCustomerId: "c-1",
        arrivedAt: Date.UTC(2026, 8, 20),
        category: "Fence Repair",
        description: "Gate sags.",
        details: [],
        location: { city: "Vancouver", state: "WA", zipCode: "98660" },
        attachments: [],
        stage: "booked",
        stageChangedAt: Date.UTC(2026, 8, 21),
      }),
    );
    await send(siteId);
    const [deal] = await deals();
    expect(deal).toMatchObject({ leadId, stage: "quoted" });
    expect(deal.siteId).toBe(siteId);
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.dealId).toBe(deal._id);
    expect((await owner.query(api.deals.board, {}))[0]?.proposal?.state).toBe("sent");
  });

  test("approving a proposal leaves a deal that began after it was sent alone", async () => {
    const { owner, customer, site, send, approve, row } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId);
    const proposalId = await send(siteId);
    vi.advanceTimersByTime(60_000);
    const later = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Deck boards",
      source: "repeat",
      siteId,
    });
    await approve(siteId, proposalId);
    expect(await row(later)).toMatchObject({ stage: "new", proposal: null });
  });
});

describe("dealsFromLeads", () => {
  test("makes each old lead its deal, keeping its stage, and runs again harmlessly", async () => {
    const { t, deals, customer } = fixture();
    const customerId = await customer();
    const leadId = await t.run((ctx) =>
      ctx.db.insert("leads", {
        customerId,
        negotiationId: "900",
        thumbtackCustomerId: "c-1",
        arrivedAt: Date.UTC(2026, 8, 20),
        category: "Fence Repair",
        description: "Gate sags.",
        details: [],
        location: { city: "Vancouver", state: "WA", zipCode: "98660" },
        attachments: [],
        stage: "booked",
        stageChangedAt: Date.UTC(2026, 8, 21),
      }),
    );

    expect(await t.mutation(internal.migrations.dealsFromLeads, {})).toEqual({ made: 1 });
    const [deal] = await deals();
    expect(deal).toMatchObject({
      customerId,
      title: "Fence Repair",
      source: "thumbtack",
      stage: "booked",
      stageChangedAt: Date.UTC(2026, 8, 21),
      notes: "",
      leadId,
      createdAt: Date.UTC(2026, 8, 20),
    });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.dealId).toBe(deal._id);

    expect(await t.mutation(internal.migrations.dealsFromLeads, {})).toEqual({ made: 0 });
    expect(await deals()).toHaveLength(1);
  });
});

describe("owner only", () => {
  test("refuses anyone else", async () => {
    const { t, owner, customer } = fixture();
    const customerId = await customer();
    const dealId = await owner.mutation(api.deals.create, {
      customer: { customerId },
      title: "Fence repair",
      source: "referral",
    });
    const stranger = t.withIdentity({ subject: "someone", email: "someone@example.com", emailVerified: true });
    const refused = /Owner access/;
    await expect(stranger.query(api.deals.board, {})).rejects.toThrow(refused);
    await expect(
      stranger.mutation(api.deals.create, { customer: { customerId }, title: "x", source: "phone" }),
    ).rejects.toThrow(refused);
    await expect(stranger.mutation(api.deals.setStage, { dealId, stage: "lost" })).rejects.toThrow(refused);
    await expect(stranger.mutation(api.deals.setNotes, { dealId, notes: "" })).rejects.toThrow(refused);
    await expect(stranger.mutation(api.deals.setSite, { dealId, siteId: null })).rejects.toThrow(refused);
    await expect(stranger.mutation(api.deals.open, { dealId })).rejects.toThrow(refused);
  });
});
