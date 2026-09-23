import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

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
  // Sites come from Google through sites.add; a solution only needs one to
  // exist, so it is written straight in.
  const site = (customerId: Id<"customers">, name: string) =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name,
        addressLine1: `${name} Main St`,
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: `place-${name}`,
        latitude: 45.63,
        longitude: -122.67,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
  const proposal = (
    siteId: Id<"sites">,
    state: "draft" | "sent" | "approved" | "declined",
    solutionIds: Id<"solutions">[],
  ) => t.run((ctx) => ctx.db.insert("proposals", { siteId, state, solutionIds }));
  const list = (customerId: Id<"customers">) =>
    owner.query(api.solutions.forCustomer, { customerId });
  return { t, owner, stranger, customer, site, proposal, list };
}

describe("solutions.create", () => {
  test("starts an untitled, unpriced solution at the chosen site", async () => {
    const { owner, customer, site, list } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1215MAIN");
    const solutionId = await owner.mutation(api.solutions.create, { siteId });
    expect(await list(customerId)).toEqual([
      expect.objectContaining({
        _id: solutionId,
        siteId,
        siteName: "1215MAIN",
        title: "Untitled solution",
        description: "",
        lineItems: [],
        markupPercent: 10,
        price: null,
        deletable: true,
      }),
    ]);
  });

  test("lists every solution across the customer's sites, tagged with the site", async () => {
    const { owner, customer, site, list } = fixture();
    const customerId = await customer();
    const home = await site(customerId, "4410NE94TH");
    const rental = await site(customerId, "1215MAIN");
    const elsewhere = await site(await customer("Someone Else"), "77OAK");
    await owner.mutation(api.solutions.create, { siteId: home, title: "Gutters" });
    await owner.mutation(api.solutions.create, { siteId: rental, title: "Deck" });
    await owner.mutation(api.solutions.create, { siteId: home, title: "Fence" });
    await owner.mutation(api.solutions.create, { siteId: elsewhere, title: "Roof" });
    expect(
      (await list(customerId)).map((s) => [s.siteName, s.title]),
    ).toEqual([
      ["1215MAIN", "Deck"],
      ["4410NE94TH", "Gutters"],
      ["4410NE94TH", "Fence"],
    ]);
  });

  test("refuses a site that no longer exists", async () => {
    const { t, owner, customer, site } = fixture();
    const siteId = await site(await customer(), "1215MAIN");
    await t.run((ctx) => ctx.db.delete(siteId));
    await expect(owner.mutation(api.solutions.create, { siteId })).rejects.toThrow(
      "Site not found",
    );
  });
});

describe("solutions.update", () => {
  async function oneSolution() {
    const f = fixture();
    const customerId = await f.customer();
    const siteId = await f.site(customerId, "1215MAIN");
    const solutionId = await f.owner.mutation(api.solutions.create, { siteId });
    const read = async () => (await f.list(customerId))[0];
    return { ...f, customerId, siteId, solutionId, read };
  }

  test("saves the title and the scope of work, trimmed", async () => {
    const { owner, solutionId, read } = await oneSolution();
    await owner.mutation(api.solutions.update, {
      solutionId,
      title: "  Replace gutters ",
      description: " Remove and haul away the old gutters.\n",
    });
    expect(await read()).toMatchObject({
      title: "Replace gutters",
      description: "Remove and haul away the old gutters.",
    });
  });

  test("refuses an empty title", async () => {
    const { owner, solutionId } = await oneSolution();
    await expect(
      owner.mutation(api.solutions.update, { solutionId, title: "  " }),
    ).rejects.toThrow("A Solution needs a title");
  });

  test("prices the line items at the default 10%, rounded up to the whole dollar", async () => {
    const { owner, solutionId, read } = await oneSolution();
    await owner.mutation(api.solutions.update, {
      solutionId,
      lineItems: [
        { name: " Gutter ", quantity: 40, unit: "LF", unitCostCents: 1_250 },
        { name: "Labor", quantity: 6, unit: "HR", unitCostCents: 7_500 },
        { name: "Disposal", quantity: 1, unitCostCents: 4_545 },
      ],
    });
    const solution = await read();
    // $500 + $450 + $45.45 = $995.45 of cost; × 1.10 = $1,094.995 → $1,095.
    expect(solution.price).toEqual({ costCents: 99_545, priceCents: 109_500 });
    // A line saved without a unit is one of a thing, and names are trimmed.
    expect(solution.lineItems).toEqual([
      { name: "Gutter", quantity: 40, unit: "LF", unitCostCents: 1_250 },
      { name: "Labor", quantity: 6, unit: "HR", unitCostCents: 7_500 },
      { name: "Disposal", quantity: 1, unit: "EA", unitCostCents: 4_545 },
    ]);
  });

  test("prices at the solution's own markup, zero included", async () => {
    const { owner, solutionId, read } = await oneSolution();
    const lineItems = [{ name: "Deck boards", quantity: 1, unitCostCents: 100_000 }];
    await owner.mutation(api.solutions.update, { solutionId, lineItems, markupPercent: 25 });
    expect(await read()).toMatchObject({
      markupPercent: 25,
      price: { costCents: 100_000, priceCents: 125_000 },
    });
    await owner.mutation(api.solutions.update, { solutionId, markupPercent: 0 });
    expect(await read()).toMatchObject({
      markupPercent: 0,
      price: { costCents: 100_000, priceCents: 100_000 },
    });
  });

  test("shows no price once every line is taken off, not $0", async () => {
    const { owner, solutionId, read } = await oneSolution();
    await owner.mutation(api.solutions.update, {
      solutionId,
      lineItems: [{ name: "Paint", quantity: 2, unitCostCents: 4_000 }],
    });
    await owner.mutation(api.solutions.update, { solutionId, lineItems: [] });
    expect((await read()).price).toBeNull();
  });

  test("refuses a line or a markup that is not one, and keeps what was stored", async () => {
    const { owner, solutionId, read } = await oneSolution();
    const line = { name: "Paint", quantity: 1, unitCostCents: 4_000 };
    for (const bad of [
      { ...line, name: " " },
      { ...line, quantity: -1 },
      { ...line, unitCostCents: 12.5 },
      { ...line, unit: "SQ" },
    ])
      await expect(
        owner.mutation(api.solutions.update, { solutionId, lineItems: [bad] }),
      ).rejects.toThrow("Line Item");
    await expect(
      owner.mutation(api.solutions.update, { solutionId, markupPercent: 12.5 }),
    ).rejects.toThrow("whole percent");
    expect(await read()).toMatchObject({ lineItems: [], markupPercent: 10 });
  });
});

describe("the catalog", () => {
  async function saving() {
    const f = fixture();
    const siteId = await f.site(await f.customer(), "1215MAIN");
    const save = async (lineItems: { name: string; quantity: number; unit?: string; unitCostCents: number }[]) => {
      const solutionId = await f.owner.mutation(api.solutions.create, { siteId });
      await f.owner.mutation(api.solutions.update, { solutionId, lineItems });
      return solutionId;
    };
    const suggest = (prefix: string) =>
      f.owner.query(api.catalog.suggestions, { prefix });
    return { ...f, save, suggest };
  }

  test("suggests the names used most, with the last unit and unit cost", async () => {
    const { save, suggest } = await saving();
    await save([{ name: "Drywall patch", quantity: 1, unitCostCents: 5_000 }]);
    await save([{ name: "Drywall sheet", quantity: 3, unit: "EA", unitCostCents: 1_800 }]);
    await save([{ name: "drywall  PATCH", quantity: 2, unit: "SF", unitCostCents: 6_000 }]);
    await save([{ name: "Door hinge", quantity: 3, unitCostCents: 900 }]);
    expect(await suggest(" DRY")).toEqual([
      { name: "drywall  PATCH", lastUnit: "SF", lastUnitCostCents: 6_000 },
      { name: "Drywall sheet", lastUnit: "EA", lastUnitCostCents: 1_800 },
    ]);
  });

  test("offers at most six, and nothing for a blank prefix", async () => {
    const { save, suggest } = await saving();
    await save(
      Array.from({ length: 8 }, (_, i) => ({
        name: `Paint coat ${i}`,
        quantity: 1,
        unitCostCents: 100 * (i + 1),
      })),
    );
    // Used twice, so it ranks first among eight used once.
    await save([{ name: "Paint coat 7", quantity: 1, unitCostCents: 999 }]);
    const offered = await suggest("paint");
    expect(offered).toHaveLength(6);
    expect(offered[0]).toEqual({ name: "Paint coat 7", lastUnit: "EA", lastUnitCostCents: 999 });
    expect(await suggest("   ")).toEqual([]);
  });

  test("counts a name used twice in one save once", async () => {
    const { save, suggest } = await saving();
    await save([
      { name: "Caulk", quantity: 1, unitCostCents: 700 },
      { name: "caulk", quantity: 2, unitCostCents: 800 },
    ]);
    await save([{ name: "Caulking gun", quantity: 1, unitCostCents: 1_500 }]);
    await save([{ name: "Caulking gun", quantity: 1, unitCostCents: 1_500 }]);
    expect(await suggest("caulk")).toEqual([
      { name: "Caulking gun", lastUnit: "EA", lastUnitCostCents: 1_500 },
      { name: "caulk", lastUnit: "EA", lastUnitCostCents: 800 },
    ]);
  });

  test("learns only from line items that were saved", async () => {
    const { owner, save, suggest } = await saving();
    const solutionId = await save([{ name: "Faucet", quantity: 1, unitCostCents: 12_000 }]);
    await owner.mutation(api.solutions.update, { solutionId, title: "Kitchen" });
    await owner.mutation(api.solutions.update, { solutionId, markupPercent: 20 });
    // Only the one save of lines counted: a second one outranks it.
    await save([{ name: "Faucet cartridge", quantity: 1, unitCostCents: 3_000 }]);
    await save([{ name: "Faucet cartridge", quantity: 1, unitCostCents: 3_000 }]);
    expect((await suggest("fauc")).map((s) => s.name)).toEqual([
      "Faucet cartridge",
      "Faucet",
    ]);
  });

  test("a taken suggestion is an ordinary line with no tie back", async () => {
    const { save, suggest, t } = await saving();
    const first = await save([{ name: "Smoke detector", quantity: 1, unitCostCents: 3_500 }]);
    const [taken] = await suggest("smoke");
    const second = await save([
      { name: taken.name, quantity: 2, unit: taken.lastUnit, unitCostCents: taken.lastUnitCostCents },
    ]);
    // The catalog learns a new cost from a third solution...
    await save([{ name: "Smoke detector", quantity: 1, unitCostCents: 4_200 }]);
    expect((await suggest("smoke"))[0].lastUnitCostCents).toBe(4_200);
    // ...and neither solution that already holds the line changes.
    const stored = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(first), ctx.db.get(second)]),
    );
    expect(stored.map((s) => s?.lineItems?.[0].unitCostCents)).toEqual([3_500, 3_500]);
  });
});

describe("solutions.remove", () => {
  test("deletes a solution and drops it from the draft proposals offering it", async () => {
    const { t, owner, customer, site, proposal, list } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1215MAIN");
    const kept = await owner.mutation(api.solutions.create, { siteId });
    const gone = await owner.mutation(api.solutions.create, { siteId });
    const draftId = await proposal(siteId, "draft", [kept, gone]);
    await owner.mutation(api.solutions.remove, { solutionId: gone });
    expect((await list(customerId)).map((s) => s._id)).toEqual([kept]);
    expect((await t.run((ctx) => ctx.db.get(draftId)))?.solutionIds).toEqual([kept]);
  });

  test("refuses once a sent or decided proposal includes it", async () => {
    const { owner, customer, site, proposal, list } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1215MAIN");
    for (const state of ["sent", "approved", "declined"] as const) {
      const solutionId = await owner.mutation(api.solutions.create, { siteId });
      await proposal(siteId, state, [solutionId]);
      await expect(owner.mutation(api.solutions.remove, { solutionId })).rejects.toThrow(
        "in a sent or decided proposal",
      );
    }
    const listed = await list(customerId);
    expect(listed).toHaveLength(3);
    expect(listed.every((s) => !s.deletable)).toBe(true);
  });

  test("goes with its site when an empty site is deleted", async () => {
    const { t, owner, customer, site, list } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1215MAIN");
    await owner.mutation(api.solutions.create, { siteId });
    await owner.mutation(api.sites.remove, { siteId });
    expect(await list(customerId)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("solutions").collect())).toEqual([]);
  });
});

describe("owner only", () => {
  test("every solution and catalog function turns away anyone else", async () => {
    const { t, owner, stranger, customer, site } = fixture();
    const customerId = await customer();
    const siteId = await site(customerId, "1215MAIN");
    const solutionId = await owner.mutation(api.solutions.create, { siteId });
    for (const caller of [t, stranger]) {
      for (const call of [
        () => caller.query(api.solutions.forCustomer, { customerId }),
        () => caller.query(api.catalog.suggestions, { prefix: "pa" }),
        () => caller.mutation(api.solutions.create, { siteId }),
        () => caller.mutation(api.solutions.update, { solutionId, title: "Mine" }),
        () => caller.mutation(api.solutions.remove, { solutionId }),
      ])
        await expect(call()).rejects.toThrow("Owner access required");
    }
  });
});
