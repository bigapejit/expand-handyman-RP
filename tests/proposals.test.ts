import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

// DOR's answer for a Vancouver address, as lib/wa-sales-tax.test.ts records
// it: 8.9% at location 0605 in Q3 2026.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;
// An address DOR could not place, answered with the ZIP centroid's rate.
const zipCentroidGuess = `<?xml version="1.0" encoding="utf-8"?><response loccode="3400" localrate=".019" rate=".084" code="5" xmlns=""><addressline code="3400" street="NOWHERE" househigh="9" houselow="9" evenodd="O" state="WA" zip="98660" period="Q32026" rta="N" ptba="" cez="" /><rate name="CLARK COUNTY" code="3400" staterate=".065" localrate=".019" /></response>`;

let dor: ReturnType<typeof vi.fn>;

function answerWith(body: string, status = 200) {
  dor.mockImplementation(
    async () =>
      new Response(body, { status, headers: { "content-type": "text/xml; charset=utf-8" } }),
  );
}

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  dor = vi.fn();
  answerWith(vancouverRate);
  vi.stubGlobal("fetch", dor);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
  });
  const stranger = t.withIdentity({
    subject: "someone",
    email: "someone@example.com",
    emailVerified: true,
  });
  const customer = (name = "Maria Delgado") =>
    t.run((ctx) =>
      ctx.db.insert("customers", { name, email: `${name}@example.com`, phone: "" }),
    );
  // Sites come from Google through sites.add; a proposal only needs one to
  // exist, so it is written straight in.
  const site = (
    customerId: Id<"customers">,
    name: string,
    address: Partial<{ addressLine1: string; city: string; region: string; postalCode: string }> = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name,
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        ...address,
        placeId: `place-${name}`,
        latitude: 45.63,
        longitude: -122.67,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
  const solution = async (
    siteId: Id<"sites">,
    title: string,
    unitCostCents?: number,
  ) => {
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title });
    if (unitCostCents !== undefined)
      await owner.mutation(api.solutions.update, {
        solutionId,
        lineItems: [{ name: title, quantity: 1, unitCostCents }],
      });
    return solutionId;
  };
  const create = (siteId: Id<"sites">) => owner.action(api.proposals.create, { siteId });
  const tab = (customerId: Id<"customers">) =>
    owner.query(api.proposals.forCustomer, { customerId });
  const read = async (customerId: Id<"customers">, proposalId: Id<"proposals">) => {
    const found = (await tab(customerId)).proposals.find((p) => p.proposalId === proposalId);
    if (!found) throw new Error("Proposal not on the tab.");
    return found;
  };
  const setState = (
    proposalId: Id<"proposals">,
    state: "draft" | "sent" | "approved" | "declined",
  ) => t.run((ctx) => ctx.db.patch(proposalId, { state }));
  return { t, owner, stranger, customer, site, solution, create, tab, read, setState };
}

describe("proposals.create", () => {
  test("starts an empty draft at the site with the default deposit", async () => {
    const { customer, site, create, read } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1300FRANKLIN");
    const proposalId = await create(siteId);
    expect(await read(customerId, proposalId)).toMatchObject({
      siteId,
      siteName: "1300FRANKLIN",
      code: "1300FRANKLIN-P1",
      name: null,
      title: "Untitled proposal",
      state: "draft",
      recommended: false,
      depositPercent: 50,
      notes: null,
      solutions: [],
      money: { subtotalCents: 0, taxCents: 0, totalCents: 0 },
    });
  });

  test("numbers per site, never reusing a deleted draft's number", async () => {
    const { owner, customer, site, create, read } = fixture();
    const customerId = await customer();
    const siteA = await site(customerId, "1300FRANKLIN");
    const siteB = await site(customerId, "441094TH");
    const first = await create(siteA);
    const second = await create(siteA);
    const other = await create(siteB);
    await owner.mutation(api.proposals.remove, { proposalId: second });
    const third = await create(siteA);
    expect((await read(customerId, first)).code).toBe("1300FRANKLIN-P1");
    expect((await read(customerId, other)).code).toBe("441094TH-P1");
    expect((await read(customerId, third)).code).toBe("1300FRANKLIN-P3");
  });

  test("looks up the WA rate from the site's street and city or ZIP", async () => {
    const { customer, site, create, read } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1300FRANKLIN");
    const proposalId = await create(siteId);
    const url = new URL(String(dor.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://webgis.dor.wa.gov/webapi/AddressRates.aspx");
    expect(url.searchParams.get("addr")).toBe("1300 Franklin St");
    expect(url.searchParams.get("city")).toBe("Vancouver");
    expect(url.searchParams.get("zip")).toBe("98660");
    expect((await read(customerId, proposalId)).tax).toEqual({
      source: "lookup",
      rate: 0.089,
      locationCode: "0605",
      period: "Q32026",
    });
  });

  test("leaves no rate when the lookup fails, until the owner types one", async () => {
    const { owner, customer, site, create, read } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1300FRANKLIN");

    answerWith(zipCentroidGuess);
    const notFound = await create(siteId);
    expect((await read(customerId, notFound)).tax).toEqual({ source: "lookup" });

    answerWith("<html>Request Rejected</html>", 200);
    const blocked = await create(siteId);
    expect((await read(customerId, blocked)).tax).toEqual({ source: "lookup" });

    dor.mockRejectedValue(new Error("socket hang up"));
    const unreachable = await create(siteId);
    expect((await read(customerId, unreachable)).tax).toEqual({ source: "lookup" });

    await owner.mutation(api.proposals.update, { proposalId: unreachable, taxRate: 0.086 });
    expect((await read(customerId, unreachable)).tax).toEqual({
      source: "override",
      rate: 0.086,
    });
  });

  test("charges no tax outside Washington, and never asks DOR", async () => {
    const { owner, customer, site, solution, create, read } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1221SW", {
      addressLine1: "1221 SW 4th Ave",
      city: "Portland",
      region: "OR",
      postalCode: "97204",
    });
    const proposalId = await create(siteId);
    expect(dor).not.toHaveBeenCalled();
    const deck = await solution(siteId, "Deck", 100_000);
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [deck] });
    expect(await read(customerId, proposalId)).toMatchObject({
      tax: { source: "none" },
      money: { subtotalCents: 110_000, taxCents: 0, totalCents: 110_000 },
    });
    await expect(
      owner.mutation(api.proposals.update, { proposalId, taxRate: 0.08 }),
    ).rejects.toThrow("not in Washington");
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer, site } = fixture();
    const siteId = await site(await customer(), "1300FRANKLIN");
    await expect(stranger.action(api.proposals.create, { siteId })).rejects.toThrow(
      "Owner access required",
    );
  });
});

describe("proposals.update", () => {
  test("prices the picked solutions, taxing the whole subtotal once", async () => {
    const { owner, customer, site, solution, create, read } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1300FRANKLIN");
    // $1,000.00 cost at 10% is $1,100; $333.33 cost is $366.66, so $367.
    const deck = await solution(siteId, "Deck repair", 100_000);
    const gutters = await solution(siteId, "Gutters", 33_333);
    const proposalId = await create(siteId);
    await owner.mutation(api.proposals.update, {
      proposalId,
      solutionIds: [gutters, deck],
    });
    expect(await read(customerId, proposalId)).toMatchObject({
      title: "Gutters + Deck repair",
      solutions: [
        { solutionId: gutters, title: "Gutters", priceCents: 36_700 },
        { solutionId: deck, title: "Deck repair", priceCents: 110_000 },
      ],
      // 8.9% of $1,467 is $130.563, rounded once to $130.56.
      money: { subtotalCents: 146_700, taxCents: 13_056, totalCents: 159_756 },
    });
  });

  test("an unpriced solution adds nothing to the subtotal", async () => {
    const { owner, customer, site, solution, create, read } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1300FRANKLIN");
    const unpriced = await solution(siteId, "Paint");
    const proposalId = await create(siteId);
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [unpriced] });
    expect(await read(customerId, proposalId)).toMatchObject({
      solutions: [{ priceCents: null }],
      money: { subtotalCents: 0, taxCents: 0, totalCents: 0 },
    });
  });

  test("refuses a solution written for another site", async () => {
    const { owner, customer, site, solution, create } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1300FRANKLIN");
    const elsewhere = await solution(await site(customerId, "441094TH"), "Fence");
    const proposalId = await create(siteId);
    await expect(
      owner.mutation(api.proposals.update, { proposalId, solutionIds: [elsewhere] }),
    ).rejects.toThrow("own site");
  });

  test("names, notes and the deposit, with emptied text going back to nothing", async () => {
    const { owner, customer, site, create, read } = fixture();
    const customerId = await customer();
    const proposalId = await create(await site(customerId, "1300FRANKLIN"));
    await owner.mutation(api.proposals.update, {
      proposalId,
      name: "  Option A ",
      notes: " Excludes permits. ",
      depositPercent: 100,
    });
    expect(await read(customerId, proposalId)).toMatchObject({
      name: "Option A",
      title: "Option A",
      notes: "Excludes permits.",
      depositPercent: 100,
      payment: { depositPercent: 100, finalPercent: 0 },
    });
    await owner.mutation(api.proposals.update, { proposalId, name: " ", notes: "" });
    expect(await read(customerId, proposalId)).toMatchObject({
      name: null,
      title: "Untitled proposal",
      notes: null,
    });
  });

  test("refuses a deposit outside 0 to 100 and a rate typed as a percent", async () => {
    const { owner, customer, site, create } = fixture();
    const proposalId = await create(await site(await customer(), "1300FRANKLIN"));
    for (const depositPercent of [-1, 101, 12.5])
      await expect(
        owner.mutation(api.proposals.update, { proposalId, depositPercent }),
      ).rejects.toThrow("whole percent");
    await expect(
      owner.mutation(api.proposals.update, { proposalId, taxRate: 8.9 }),
    ).rejects.toThrow("decimal of the whole");
  });

  test("an override keeps the location code and drops the quarter", async () => {
    const { owner, customer, site, create, read } = fixture();
    const customerId = await customer();
    const proposalId = await create(await site(customerId, "1300FRANKLIN"));
    await owner.mutation(api.proposals.update, { proposalId, taxRate: 0.09 });
    expect((await read(customerId, proposalId)).tax).toEqual({
      source: "override",
      rate: 0.09,
      locationCode: "0605",
    });
  });

  test("edits only a draft", async () => {
    const { owner, customer, site, create, setState } = fixture();
    const proposalId = await create(await site(await customer(), "1300FRANKLIN"));
    await setState(proposalId, "sent");
    await expect(
      owner.mutation(api.proposals.update, { proposalId, name: "Later" }),
    ).rejects.toThrow("Only a draft");
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer, site, create } = fixture();
    const proposalId = await create(await site(await customer(), "1300FRANKLIN"));
    await expect(
      stranger.mutation(api.proposals.update, { proposalId, name: "Mine" }),
    ).rejects.toThrow("Owner access required");
  });
});

describe("proposals.setRecommended", () => {
  test("keeps at most one Recommended proposal per site", async () => {
    const { owner, customer, site, create, read } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1300FRANKLIN");
    const first = await create(siteId);
    const second = await create(siteId);
    const elsewhere = await create(await site(customerId, "441094TH"));
    await owner.mutation(api.proposals.setRecommended, { proposalId: first, recommended: true });
    await owner.mutation(api.proposals.setRecommended, {
      proposalId: elsewhere,
      recommended: true,
    });
    await owner.mutation(api.proposals.setRecommended, {
      proposalId: second,
      recommended: true,
    });
    expect((await read(customerId, first)).recommended).toBe(false);
    expect((await read(customerId, second)).recommended).toBe(true);
    // Another site's mark is its own.
    expect((await read(customerId, elsewhere)).recommended).toBe(true);

    await owner.mutation(api.proposals.setRecommended, {
      proposalId: second,
      recommended: false,
    });
    expect((await read(customerId, second)).recommended).toBe(false);
  });

  test("moves on a proposal in any state", async () => {
    const { owner, customer, site, create, read, setState } = fixture();
    const customerId = await customer();
    const proposalId = await create(await site(customerId, "1300FRANKLIN"));
    await setState(proposalId, "sent");
    await owner.mutation(api.proposals.setRecommended, { proposalId, recommended: true });
    expect((await read(customerId, proposalId)).recommended).toBe(true);
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer, site, create } = fixture();
    const proposalId = await create(await site(await customer(), "1300FRANKLIN"));
    await expect(
      stranger.mutation(api.proposals.setRecommended, { proposalId, recommended: true }),
    ).rejects.toThrow("Owner access required");
  });
});

describe("proposals.duplicate", () => {
  test.each(["draft", "sent", "approved", "declined"] as const)(
    "copies a %s proposal into a new draft with the next number",
    async (state) => {
      const { owner, customer, site, solution, create, read, setState } = fixture();
      const customerId = await customer();
      const siteId = await site(customerId, "1300FRANKLIN");
      const deck = await solution(siteId, "Deck", 100_000);
      const original = await create(siteId);
      await owner.mutation(api.proposals.update, {
        proposalId: original,
        name: "Option A",
        solutionIds: [deck],
        notes: "Excludes permits.",
        depositPercent: 30,
        taxRate: 0.09,
      });
      await owner.mutation(api.proposals.setRecommended, {
        proposalId: original,
        recommended: true,
      });
      await setState(original, state);

      const copy = await owner.mutation(api.proposals.duplicate, { proposalId: original });
      expect(await read(customerId, copy)).toMatchObject({
        code: "1300FRANKLIN-P2",
        state: "draft",
        // The name and the mark tell two options apart, so neither is copied.
        name: null,
        recommended: false,
        solutions: [{ solutionId: deck }],
        notes: "Excludes permits.",
        depositPercent: 30,
        tax: { source: "override", rate: 0.09, locationCode: "0605" },
      });
      expect((await read(customerId, original)).state).toBe(state);
    },
  );

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer, site, create } = fixture();
    const proposalId = await create(await site(await customer(), "1300FRANKLIN"));
    await expect(stranger.mutation(api.proposals.duplicate, { proposalId })).rejects.toThrow(
      "Owner access required",
    );
  });
});

describe("proposals.remove", () => {
  test("deletes a draft", async () => {
    const { owner, customer, site, create, tab } = fixture();
    const customerId = await customer();
    const proposalId = await create(await site(customerId, "1300FRANKLIN"));
    await owner.mutation(api.proposals.remove, { proposalId });
    expect((await tab(customerId)).proposals).toEqual([]);
  });

  test.each(["sent", "approved", "declined"] as const)(
    "refuses a %s proposal",
    async (state) => {
      const { owner, customer, site, create, tab, setState } = fixture();
      const customerId = await customer();
      const proposalId = await create(await site(customerId, "1300FRANKLIN"));
      await setState(proposalId, state);
      await expect(owner.mutation(api.proposals.remove, { proposalId })).rejects.toThrow(
        "Only a draft",
      );
      expect((await tab(customerId)).proposals).toHaveLength(1);
    },
  );

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer, site, create } = fixture();
    const proposalId = await create(await site(await customer(), "1300FRANKLIN"));
    await expect(stranger.mutation(api.proposals.remove, { proposalId })).rejects.toThrow(
      "Owner access required",
    );
  });
});

describe("proposals.forCustomer", () => {
  test("lists proposals across the customer's sites with the solutions to pick from", async () => {
    const { customer, site, solution, create, tab } = fixture();
    const customerId = await customer();
    const franklin = await site(customerId, "1300FRANKLIN");
    const ninetyFourth = await site(customerId, "441094TH");
    const deck = await solution(franklin, "Deck", 100_000);
    const fence = await solution(ninetyFourth, "Fence");
    await create(ninetyFourth);
    await create(franklin);
    await create(await site(await customer("Someone Else"), "1ELSEWHERE"));

    const read = await tab(customerId);
    expect(read.proposals.map((p) => p.code)).toEqual(["1300FRANKLIN-P1", "441094TH-P1"]);
    expect(read.solutions).toEqual([
      { solutionId: deck, siteId: franklin, title: "Deck", price: { costCents: 100_000, priceCents: 110_000 } },
      { solutionId: fence, siteId: ninetyFourth, title: "Fence", price: null },
    ]);
  });

  test("drops a deleted solution from a draft", async () => {
    const { owner, customer, site, solution, create, read } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1300FRANKLIN");
    const deck = await solution(siteId, "Deck", 100_000);
    const proposalId = await create(siteId);
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [deck] });
    await owner.mutation(api.solutions.remove, { solutionId: deck });
    expect((await read(customerId, proposalId)).solutions).toEqual([]);
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer } = fixture();
    await expect(
      stranger.query(api.proposals.forCustomer, { customerId: await customer() }),
    ).rejects.toThrow("Owner access required");
  });
});

describe("proposals.list", () => {
  test("lists every proposal with its customer, newest first", async () => {
    const { owner, customer, site, solution, create, setState } = fixture();
    const maria = await customer("Maria Delgado");
    const sam = await customer("Sam Park");
    const mariaSite = await site(maria, "1300FRANKLIN");
    const deck = await solution(mariaSite, "Deck", 100_000);
    const first = await create(mariaSite);
    await owner.mutation(api.proposals.update, { proposalId: first, solutionIds: [deck] });
    const second = await create(await site(sam, "441094TH"));
    await setState(second, "sent");

    expect(await owner.query(api.proposals.list, {})).toEqual([
      expect.objectContaining({
        proposalId: second,
        customerId: sam,
        customerName: "Sam Park",
        code: "441094TH-P1",
        title: "Untitled proposal",
        state: "sent",
        totalCents: 0,
      }),
      expect.objectContaining({
        proposalId: first,
        customerId: maria,
        customerName: "Maria Delgado",
        code: "1300FRANKLIN-P1",
        title: "Deck",
        state: "draft",
        // $1,100 plus 8.9% tax.
        totalCents: 119_790,
      }),
    ]);
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger } = fixture();
    await expect(stranger.query(api.proposals.list, {})).rejects.toThrow(
      "Owner access required",
    );
  });
});

describe("the Customers list", () => {
  test("says where each customer's proposals stand", async () => {
    const { owner, customer, site, create, setState } = fixture();
    const quiet = await customer("Quiet Customer");
    const drafting = await customer("Drafting Customer");
    const waiting = await customer("Waiting Customer");
    await create(await site(drafting, "1DRAFT"));
    const waitingSite = await site(waiting, "1WAIT");
    await create(waitingSite);
    await setState(await create(waitingSite), "sent");

    const activity = Object.fromEntries(
      (await owner.query(api.customers.list, {})).map((c) => [c._id, c.proposalActivity]),
    );
    expect(activity[quiet]).toEqual({ kind: "quiet", label: "No proposals" });
    expect(activity[drafting]).toEqual({ kind: "quiet", label: "1 draft" });
    expect(activity[waiting]).toEqual({ kind: "awaiting", label: "1 awaiting a signature" });
  });
});

describe("deleting a site", () => {
  test("is refused once it has a proposal, a draft included", async () => {
    const { owner, customer, site, create } = fixture();
    const siteId = await site(await customer(), "1300FRANKLIN");
    await create(siteId);
    await expect(owner.mutation(api.sites.remove, { siteId })).rejects.toThrow(
      "has proposals",
    );
  });
});
