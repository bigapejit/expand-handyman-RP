import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

beforeEach(() => {
  // Scheduled email sends never run: nothing here is about the email, and on
  // real timers a send would fire after its test had finished with the database.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-01T17:00:00Z"));
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("RESEND_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// Sites in Oregon, which charges no sales tax, so a draft is sendable without
// asking the Department of Revenue for a rate.
function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
    name: "Andrew Putilin",
  });
  const customer = (name: string) =>
    t.run((ctx) =>
      ctx.db.insert("customers", {
        name,
        email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
        phone: "",
      }),
    );
  const site = (customerId: Id<"customers">, name: string) =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name,
        addressLine1: "1300 Main St",
        addressLine2: "",
        city: "Portland",
        region: "OR",
        postalCode: "97201",
        placeId: `place-${name}`,
        latitude: 45.52,
        longitude: -122.68,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
  const draft = async (siteId: Id<"sites">, title = "Fix gate", unitCostCents = 25_000) => {
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title });
    await owner.mutation(api.solutions.update, {
      solutionId,
      lineItems: [{ name: `${title} labor`, quantity: 1, unitCostCents, unit: "HR" }],
    });
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [solutionId] });
    return proposalId;
  };
  const sentAt = async (siteId: Id<"sites">, at: string, title?: string) => {
    vi.setSystemTime(new Date(at));
    const proposalId = await draft(siteId, title);
    await owner.action(api.proposals.send, { proposalId });
    return proposalId;
  };
  const liveToken = async (proposalId: Id<"proposals">) => {
    const link = await t.run((ctx) =>
      ctx.db
        .query("signingLinks")
        .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
        .filter((q) => q.eq(q.field("endedAt"), undefined))
        .unique(),
    );
    if (!link) throw new Error("No live link.");
    return link.token;
  };
  // The customer's answer as Approve and Decline will record it: the proposal
  // moves, and its live link ends for the same reason at the same moment.
  const decide = async (
    proposalId: Id<"proposals">,
    state: "approved" | "declined",
    at: string,
  ) => {
    const when = Date.parse(at);
    await t.run(async (ctx) => {
      await ctx.db.patch(proposalId, { state, updatedAt: when });
      const links = await ctx.db
        .query("signingLinks")
        .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
        .collect();
      for (const link of links)
        if (link.endedAt === undefined)
          await ctx.db.patch(link._id, { endedAt: when, endedReason: state });
    });
  };
  const board = () => owner.query(api.proposals.dashboard, {});
  return { t, owner, customer, site, draft, sentAt, liveToken, decide, board };
}

describe("The Dashboard's Proposals", () => {
  test("is the owner's only", async () => {
    const { t } = fixture();
    await expect(t.query(api.proposals.dashboard, {})).rejects.toThrow("Owner access required");
  });

  test("lists Sent proposals oldest first, across customers, leaving drafts and decided ones out", async () => {
    const { customer, site, draft, sentAt, decide, board } = fixture();
    const maria = await customer("Maria Delgado");
    const sam = await customer("Sam Park");
    const mariaSite = await site(maria, "1300MAIN");
    const samSite = await site(sam, "4410NE94TH");
    const newer = await sentAt(mariaSite, "2026-09-10T17:00:00Z", "Paint fence");
    const older = await sentAt(samSite, "2026-09-02T17:00:00Z", "Fix gate");
    await draft(mariaSite);
    await decide(await sentAt(samSite, "2026-09-03T17:00:00Z"), "approved", "2026-09-04T17:00:00Z");

    const { awaiting } = await board();
    expect(awaiting.map((row) => row.proposalId)).toEqual([older, newer]);
    expect(awaiting[0]).toEqual({
      proposalId: older,
      customerId: sam,
      customerName: "Sam Park",
      code: "4410NE94TH-P1",
      title: "Fix gate",
      // $250 at the default 10% markup, untaxed in Oregon.
      totalCents: 27_500,
      sentAt: Date.parse("2026-09-02T17:00:00Z"),
      customerViews: 0,
      lastViewedAt: null,
    });
  });

  test("names each row as it was sent, not as the customer reads now", async () => {
    const { t, customer, site, sentAt, board } = fixture();
    const maria = await customer("Maria Delgado");
    await sentAt(await site(maria, "1300MAIN"), "2026-09-02T17:00:00Z");
    await t.run((ctx) => ctx.db.patch(maria, { name: "Maria Delgado-Reyes" }));
    expect((await board()).awaiting[0].customerName).toBe("Maria Delgado");
  });

  test("counts the customer's opens of the current link only, never the owner's previews", async () => {
    const { t, owner, customer, site, sentAt, liveToken, board } = fixture();
    const proposalId = await sentAt(await site(await customer("Maria"), "1300MAIN"), "2026-09-02T17:00:00Z");
    const first = await liveToken(proposalId);

    vi.setSystemTime(new Date("2026-09-03T17:00:00Z"));
    await owner.mutation(api.signingLinks.opened, { token: first });
    expect((await board()).awaiting[0]).toMatchObject({ customerViews: 0, lastViewedAt: null });

    await t.mutation(api.signingLinks.opened, { token: first });
    expect((await board()).awaiting[0]).toMatchObject({
      customerViews: 1,
      lastViewedAt: Date.parse("2026-09-03T17:00:00Z"),
    });

    // A re-send is a fresh link, and the old one's opens no longer count.
    await owner.action(api.proposals.resend, { proposalId });
    expect((await board()).awaiting[0]).toMatchObject({ customerViews: 0, lastViewedAt: null });

    const second = await liveToken(proposalId);
    vi.setSystemTime(new Date("2026-09-04T17:00:00Z"));
    await t.mutation(api.signingLinks.opened, { token: second });
    vi.setSystemTime(new Date("2026-09-05T17:00:00Z"));
    await t.mutation(api.signingLinks.opened, { token: second });
    await owner.mutation(api.signingLinks.opened, { token: second });
    expect((await board()).awaiting[0]).toMatchObject({
      customerViews: 2,
      lastViewedAt: Date.parse("2026-09-05T17:00:00Z"),
    });
  });

  test("lists the last 8 decided proposals, latest decision first", async () => {
    const { customer, site, sentAt, decide, board } = fixture();
    const siteId = await site(await customer("Maria Delgado"), "1300MAIN");
    const decided = [];
    for (let day = 1; day <= 10; day++) {
      const proposalId = await sentAt(siteId, `2026-08-${String(day).padStart(2, "0")}T17:00:00Z`);
      await decide(
        proposalId,
        day % 2 ? "declined" : "approved",
        `2026-09-${String(10 + day)}T17:00:00Z`,
      );
      decided.push(proposalId);
    }

    const { awaiting, decided: rows } = await board();
    expect(awaiting).toEqual([]);
    expect(rows.map((row) => row.proposalId)).toEqual(decided.slice(2).reverse());
    expect(rows[0]).toEqual({
      proposalId: decided[9],
      customerId: expect.any(String),
      customerName: "Maria Delgado",
      code: "1300MAIN-P10",
      title: "Fix gate",
      totalCents: 27_500,
      state: "approved",
      decidedAt: Date.parse("2026-09-20T17:00:00Z"),
    });
    expect(rows[1]).toMatchObject({ state: "declined", decidedAt: Date.parse("2026-09-19T17:00:00Z") });
  });

  test("orders decided proposals by when they were decided, not sent or last touched", async () => {
    const { owner, customer, site, sentAt, decide, board } = fixture();
    const siteId = await site(await customer("Maria Delgado"), "1300MAIN");
    const sentFirst = await sentAt(siteId, "2026-08-01T17:00:00Z");
    const sentLast = await sentAt(siteId, "2026-08-02T17:00:00Z");
    await decide(sentLast, "declined", "2026-09-02T17:00:00Z");
    await decide(sentFirst, "approved", "2026-09-03T17:00:00Z");
    // Marking the older decision Recommended afterwards is not a decision.
    vi.setSystemTime(new Date("2026-09-10T17:00:00Z"));
    await owner.mutation(api.proposals.setRecommended, { proposalId: sentLast, recommended: true });

    expect((await board()).decided.map((row) => row.proposalId)).toEqual([sentFirst, sentLast]);
  });
});

describe("The Customers list hint", () => {
  test("counts proposals awaiting a signature across every site", async () => {
    const { owner, customer, site, draft, sentAt, decide } = fixture();
    const maria = await customer("Maria Delgado");
    const home = await site(maria, "1300MAIN");
    const rental = await site(maria, "4410NE94TH");
    await sentAt(home, "2026-09-02T17:00:00Z");
    await sentAt(rental, "2026-09-03T17:00:00Z");
    await decide(await sentAt(rental, "2026-09-04T17:00:00Z"), "approved", "2026-09-05T17:00:00Z");
    await draft(home);

    const row = (await owner.query(api.customers.list, {})).find((c) => c._id === maria);
    expect(row?.proposalActivity).toEqual({ kind: "awaiting", label: "2 awaiting a signature" });
  });

  test("names the latest decision across every site, however the proposals were touched since", async () => {
    const { owner, customer, site, draft, sentAt, decide } = fixture();
    const maria = await customer("Maria Delgado");
    const home = await site(maria, "1300MAIN");
    const rental = await site(maria, "4410NE94TH");
    const declined = await sentAt(home, "2026-09-02T17:00:00Z");
    const approved = await sentAt(rental, "2026-09-03T17:00:00Z");
    await decide(declined, "declined", "2026-09-04T17:00:00Z");
    await decide(approved, "approved", "2026-09-06T17:00:00Z");
    await draft(home);
    vi.setSystemTime(new Date("2026-09-10T17:00:00Z"));
    await owner.mutation(api.proposals.setRecommended, { proposalId: declined, recommended: true });

    const row = (await owner.query(api.customers.list, {})).find((c) => c._id === maria);
    expect(row?.proposalActivity).toEqual({ kind: "decided", state: "approved" });
  });
});
