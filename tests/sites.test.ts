import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
const session = "11111111-2222-3333-4444-555555555555";

// Two real-looking places Google knows, keyed by place id.
const places: Record<string, object> = {
  "place-94th": {
    id: "place-94th",
    addressComponents: [
      { longText: "4410", shortText: "4410", types: ["street_number"] },
      { longText: "Northeast 94th Street", shortText: "NE 94th St", types: ["route"] },
      { longText: "Vancouver", shortText: "Vancouver", types: ["locality", "political"] },
      { longText: "Washington", shortText: "WA", types: ["administrative_area_level_1", "political"] },
      { longText: "United States", shortText: "US", types: ["country", "political"] },
      { longText: "98665", shortText: "98665", types: ["postal_code"] },
    ],
    location: { latitude: 45.69, longitude: -122.61 },
  },
  "place-main": {
    id: "place-main",
    addressComponents: [
      { longText: "1215", shortText: "1215", types: ["street_number"] },
      { longText: "Main Street", shortText: "Main St", types: ["route"] },
      { longText: "Vancouver", shortText: "Vancouver", types: ["locality", "political"] },
      { longText: "Washington", shortText: "WA", types: ["administrative_area_level_1", "political"] },
      { longText: "United States", shortText: "US", types: ["country", "political"] },
      { longText: "98660", shortText: "98660", types: ["postal_code"] },
    ],
    location: { latitude: 45.63, longitude: -122.67 },
  },
  // One apartment in a building, picked from a subpremise suggestion.
  "place-apt": {
    id: "place-apt",
    addressComponents: [
      { longText: "4", shortText: "4", types: ["subpremise"] },
      { longText: "1215", shortText: "1215", types: ["street_number"] },
      { longText: "Main Street", shortText: "Main St", types: ["route"] },
      { longText: "Vancouver", shortText: "Vancouver", types: ["locality", "political"] },
      { longText: "Washington", shortText: "WA", types: ["administrative_area_level_1", "political"] },
      { longText: "United States", shortText: "US", types: ["country", "political"] },
      { longText: "98660", shortText: "98660", types: ["postal_code"] },
    ],
    location: { latitude: 45.63, longitude: -122.67 },
  },
  // A street with no house number: not something a site can be.
  "place-route": {
    id: "place-route",
    addressComponents: [
      { longText: "Main Street", shortText: "Main St", types: ["route"] },
      { longText: "Vancouver", shortText: "Vancouver", types: ["locality"] },
      { longText: "United States", shortText: "US", types: ["country"] },
    ],
    location: { latitude: 45.63, longitude: -122.67 },
  },
};

// Every outbound call goes through here; nothing reaches Google.
const google = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.pathname === "/v1/places:autocomplete")
    return Response.json({
      suggestions: [
        {
          placePrediction: {
            placeId: "place-94th",
            structuredFormat: {
              mainText: { text: "4410 NE 94th St" },
              secondaryText: { text: "Vancouver, WA, USA" },
            },
          },
        },
      ],
    });
  const place = places[decodeURIComponent(url.pathname.replace("/v1/places/", ""))];
  return place ? Response.json(place) : new Response("{}", { status: 404 });
});

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "server-key");
  google.mockClear();
  vi.stubGlobal("fetch", google);
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
  const customer = async (name = "Maria Delgado", email = "maria@example.com") =>
    (await owner.action(api.customers.add, { name, email, phone: "" })).customerId;
  const addSite = (
    customerId: Id<"customers">,
    placeId = "place-94th",
    addressLine2 = "",
  ) =>
    owner.action(api.sites.add, {
      customerId,
      placeId,
      sessionToken: session,
      addressLine2,
      accessNotes: "",
    });
  // A proposal written straight in, last edited when given: only its site and
  // its last edit matter to the Sites list and the site header.
  const proposal = (siteId: Id<"sites">, updatedAt = 0) =>
    t.run((ctx) =>
      ctx.db.insert("proposals", {
        siteId,
        number: 1,
        state: "draft",
        solutionIds: [],
        recommended: false,
        depositPercent: 50,
        tax: { source: "lookup" },
        createdAt: 0,
        updatedAt,
      }),
    );
  return { t, owner, stranger, customer, addSite, proposal };
}

const calls = () => google.mock.calls.map(([input]) => new URL(String(input)));

describe("places.suggest", () => {
  test("asks Google for US street addresses with the lookup's session token", async () => {
    const { owner } = fixture();
    const suggestions = await owner.action(api.places.suggest, {
      input: "4410 NE 94",
      sessionToken: session,
    });
    expect(suggestions).toEqual([
      {
        placeId: "place-94th",
        mainText: "4410 NE 94th St",
        secondaryText: "Vancouver, WA, USA",
      },
    ]);
    const [, init] = google.mock.calls[0];
    expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe("server-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      input: "4410 NE 94",
      sessionToken: session,
      includedRegionCodes: ["us"],
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
    });
  });

  test("does not call Google for a couple of letters", async () => {
    const { owner } = fixture();
    expect(
      await owner.action(api.places.suggest, { input: " 44 ", sessionToken: session }),
    ).toEqual([]);
    expect(google).not.toHaveBeenCalled();
  });

  test("turns away anyone who is not the owner, before calling Google", async () => {
    const { t, stranger } = fixture();
    for (const caller of [t, stranger])
      await expect(
        caller.action(api.places.suggest, { input: "4410 NE 94", sessionToken: session }),
      ).rejects.toThrow("Owner access required");
    expect(google).not.toHaveBeenCalled();
  });

  test("says so when the deployment has no Google key", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const { owner } = fixture();
    await expect(
      owner.action(api.places.suggest, { input: "4410 NE 94", sessionToken: session }),
    ).rejects.toThrow("Address lookup is not set up");
  });
});

describe("sites.add", () => {
  test("stores Google's address parts and names the site from the street", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    await addSite(customerId, "place-94th", " Apt 2 ");
    const [site] = await owner.query(api.sites.forCustomer, { customerId });
    expect(site).toMatchObject({
      name: "441094TH",
      addressLine1: "4410 NE 94th St",
      addressLine2: "Apt 2",
      city: "Vancouver",
      region: "WA",
      postalCode: "98665",
      placeId: "place-94th",
      latitude: 45.69,
      longitude: -122.61,
      streetLine: "4410 NE 94th St, Apt 2",
      cityLine: "Vancouver, WA 98665",
      proposalCount: 0,
    });
    // The details call closes the lookup's billing session.
    expect(calls().at(-1)?.searchParams.get("sessionToken")).toBe(session);
  });

  test("keeps the unit of a picked apartment unless the owner typed one", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    await addSite(customerId, "place-apt");
    await addSite(customerId, "place-apt", "Apt 4B");
    const units = (await owner.query(api.sites.forCustomer, { customerId })).map(
      (s) => s.addressLine2,
    );
    expect(units.sort()).toEqual(["#4", "Apt 4B"]);
  });

  test("refuses the same place and unit twice for one customer", async () => {
    const { customer, addSite } = fixture();
    const customerId = await customer();
    await addSite(customerId, "place-94th", "Apt 2");
    await expect(addSite(customerId, "place-94th", " apt  2")).rejects.toThrow(
      "This customer already has that site",
    );
  });

  test("takes another unit in the same building as its own site", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    await addSite(customerId, "place-94th", "Apt 2");
    await addSite(customerId, "place-94th", "Apt 3");
    await addSite(customerId, "place-94th");
    expect(await owner.query(api.sites.forCustomer, { customerId })).toHaveLength(3);
  });

  test("saves an address another customer already has, and names them", async () => {
    const { owner, customer, addSite } = fixture();
    const landlord = await customer("Harlow Property Group", "ops@harlow.example");
    const tenant = await customer();
    await addSite(landlord);
    await addSite(tenant);
    expect(await owner.query(api.sites.forCustomer, { customerId: tenant })).toHaveLength(1);
    expect(await owner.query(api.sites.atPlace, { placeId: "place-94th" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: landlord, customerName: "Harlow Property Group" }),
        expect.objectContaining({ customerId: tenant, customerName: "Maria Delgado" }),
      ]),
    );
  });

  test("refuses a place that is not a street address", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    await expect(addSite(customerId, "place-route")).rejects.toThrow(
      "Google has no street address for that place",
    );
    expect(await owner.query(api.sites.forCustomer, { customerId })).toEqual([]);
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer } = fixture();
    const customerId = await customer();
    await expect(
      stranger.action(api.sites.add, {
        customerId,
        placeId: "place-94th",
        sessionToken: session,
        addressLine2: "",
        accessNotes: "",
      }),
    ).rejects.toThrow("Owner access required");
    await expect(
      stranger.query(api.sites.forCustomer, { customerId }),
    ).rejects.toThrow("Owner access required");
    await expect(
      stranger.query(api.sites.atPlace, { placeId: "place-94th" }),
    ).rejects.toThrow("Owner access required");
    expect(google).not.toHaveBeenCalled();
  });
});

describe("sites.update", () => {
  test("changes the unit and access notes without asking Google again", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId);
    google.mockClear();
    await owner.action(api.sites.update, {
      siteId,
      addressLine2: "Unit B",
      accessNotes: "Gate code 1234",
    });
    expect(google).not.toHaveBeenCalled();
    const [site] = await owner.query(api.sites.forCustomer, { customerId });
    expect(site).toMatchObject({
      addressLine2: "Unit B",
      accessNotes: "Gate code 1234",
      name: "441094TH",
    });
  });

  test("rebuilds the site name when the address is picked again", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId);
    await owner.action(api.sites.update, {
      siteId,
      placeId: "place-main",
      sessionToken: session,
      addressLine2: "",
      accessNotes: "",
    });
    const [site] = await owner.query(api.sites.forCustomer, { customerId });
    expect(site).toMatchObject({ name: "1215MAIN", addressLine1: "1215 Main St" });
  });

  test("refuses an edit that would duplicate another of the customer's sites", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    await addSite(customerId, "place-94th");
    const other = await addSite(customerId, "place-main");
    await expect(
      owner.action(api.sites.update, {
        siteId: other,
        placeId: "place-94th",
        sessionToken: session,
        addressLine2: "",
        accessNotes: "",
      }),
    ).rejects.toThrow("This customer already has that site");
    // Saving a site unchanged is not a duplicate of itself.
    await owner.action(api.sites.update, {
      siteId: other,
      addressLine2: "",
      accessNotes: "Side door",
    });
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer, addSite } = fixture();
    const siteId = await addSite(await customer());
    await expect(
      stranger.action(api.sites.update, { siteId, addressLine2: "", accessNotes: "" }),
    ).rejects.toThrow("Owner access required");
  });
});

describe("sites.remove", () => {
  test("deletes a site with no proposals or invoices, and its solutions with it", async () => {
    const { t, owner, customer, addSite } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId);
    const kept = await addSite(customerId, "place-main");
    await owner.mutation(api.solutions.create, { siteId });
    await owner.mutation(api.solutions.create, { siteId: kept });
    await owner.mutation(api.sites.remove, { siteId });
    expect(await owner.query(api.sites.get, { siteId })).toBeNull();
    expect(await owner.query(api.sites.forCustomer, { customerId })).toMatchObject([
      { _id: kept },
    ]);
    const solutions = await t.run((ctx) => ctx.db.query("solutions").collect());
    expect(solutions.map((solution) => solution.siteId)).toEqual([kept]);
  });

  test("refuses while the site has any proposal, a draft included", async () => {
    const { owner, customer, addSite, proposal } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId);
    await proposal(siteId);
    await expect(owner.mutation(api.sites.remove, { siteId })).rejects.toThrow(
      "This site has proposals, so it can't be deleted.",
    );
    expect(await owner.query(api.sites.get, { siteId })).toMatchObject({
      counts: { proposals: 1 },
    });
  });

  test("refuses while the site has any invoice, even with its proposal gone", async () => {
    const { t, owner, customer, addSite, proposal } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId);
    const proposalId = await proposal(siteId);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        proposalId,
        siteId,
        customerId,
        kind: "typed",
        state: "draft",
        lines: [],
        taxRate: 0,
        createdAt: 0,
        updatedAt: 0,
      });
      // Only the invoice is left to hold the site.
      await ctx.db.delete(proposalId);
    });
    await expect(owner.mutation(api.sites.remove, { siteId })).rejects.toThrow(
      "This site has invoices, so it can't be deleted.",
    );
    expect(await owner.query(api.sites.get, { siteId })).toMatchObject({
      counts: { proposals: 0, invoices: 1 },
    });
  });

  test("names both when the site has proposals and invoices", async () => {
    const { t, owner, customer, addSite, proposal } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId);
    const proposalId = await proposal(siteId);
    await t.run((ctx) =>
      ctx.db.insert("invoices", {
        proposalId,
        siteId,
        customerId,
        kind: "typed",
        state: "draft",
        lines: [],
        taxRate: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await expect(owner.mutation(api.sites.remove, { siteId })).rejects.toThrow(
      "This site has proposals and invoices, so it can't be deleted.",
    );
  });

  test("turns away anyone who is not the owner", async () => {
    const { owner, stranger, customer, addSite } = fixture();
    const siteId = await addSite(await customer());
    await expect(stranger.mutation(api.sites.remove, { siteId })).rejects.toThrow(
      "Owner access required",
    );
    expect(await owner.query(api.sites.get, { siteId })).not.toBeNull();
  });
});

describe("customers.add", () => {
  test("adds a customer with no site", async () => {
    const { owner, customer } = fixture();
    const customerId = await customer();
    expect(await owner.query(api.sites.forCustomer, { customerId })).toEqual([]);
    expect(google).not.toHaveBeenCalled();
  });

  test("adds a customer with no site and says there is none", async () => {
    const { owner } = fixture();
    const added = await owner.action(api.customers.add, {
      name: "Maria Delgado",
      email: "maria@example.com",
      phone: "",
    });
    expect(added.siteId).toBeNull();
  });

  test("creates the first site with the customer, and says which site it made", async () => {
    const { owner } = fixture();
    const { customerId, siteId } = await owner.action(api.customers.add, {
      name: "Maria Delgado",
      email: "maria@example.com",
      phone: "",
      firstSite: { placeId: "place-94th", sessionToken: session },
    });
    const sites = await owner.query(api.sites.forCustomer, { customerId });
    expect(sites).toMatchObject([
      { _id: siteId, name: "441094TH", addressLine2: "", accessNotes: "" },
    ]);
    const [row] = await owner.query(api.customers.list, {});
    expect(row).toMatchObject({ _id: customerId, siteCount: 1 });
  });

  test("stores the unit and access notes typed beside the first site", async () => {
    const { owner } = fixture();
    const { siteId } = await owner.action(api.customers.add, {
      name: "Maria Delgado",
      email: "maria@example.com",
      phone: "",
      firstSite: {
        placeId: "place-apt",
        sessionToken: session,
        addressLine2: " Apt 4B ",
        accessNotes: " Gate code 1234 ",
      },
    });
    if (!siteId) throw new Error("No first site.");
    // A typed unit wins over the one Google read from the picked place.
    expect(await owner.query(api.sites.get, { siteId })).toMatchObject({
      streetLine: "1215 Main St, Apt 4B",
      accessNotes: "Gate code 1234",
    });
  });

  // New site from the Sites list with a new customer: someone else already
  // having the address is a warning in the dialog, never a refusal.
  test("saves a first site at an address another customer already has", async () => {
    const { owner, customer, addSite } = fixture();
    const landlord = await customer("Harlow Property Group", "ops@harlow.example");
    await addSite(landlord, "place-94th", "Apt 2");
    const { customerId, siteId } = await owner.action(api.customers.add, {
      name: "Maria Delgado",
      email: "maria@example.com",
      phone: "",
      firstSite: {
        placeId: "place-94th",
        sessionToken: session,
        addressLine2: "Apt 2",
        accessNotes: "Tenant; call first",
      },
    });
    expect(await owner.query(api.sites.atPlace, { placeId: "place-94th" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: landlord, addressLine2: "Apt 2" }),
        expect.objectContaining({ siteId, customerId, addressLine2: "Apt 2" }),
      ]),
    );
  });

  test("refuses access notes too long for a site, before asking Google", async () => {
    const { owner } = fixture();
    await expect(
      owner.action(api.customers.add, {
        name: "Maria Delgado",
        email: "maria@example.com",
        phone: "",
        firstSite: {
          placeId: "place-94th",
          sessionToken: session,
          accessNotes: "x".repeat(1001),
        },
      }),
    ).rejects.toThrow("Keep access notes under 1,000 characters.");
    expect(google).not.toHaveBeenCalled();
    expect(await owner.query(api.customers.list, {})).toEqual([]);
  });

  test("keeps the unit of a picked apartment on the first site", async () => {
    const { owner } = fixture();
    const { customerId } = await owner.action(api.customers.add, {
      name: "Maria Delgado",
      email: "maria@example.com",
      phone: "",
      firstSite: { placeId: "place-apt", sessionToken: session },
    });
    expect(await owner.query(api.sites.forCustomer, { customerId })).toMatchObject([
      {
        name: "1215MAIN",
        addressLine2: "#4",
        streetLine: "1215 Main St, #4",
        cityLine: "Vancouver, WA 98660",
      },
    ]);
  });

  test("adds nothing when the first site's address is refused", async () => {
    const { owner } = fixture();
    await expect(
      owner.action(api.customers.add, {
        name: "Maria Delgado",
        email: "maria@example.com",
        phone: "",
        firstSite: { placeId: "place-route", sessionToken: session },
      }),
    ).rejects.toThrow("Google has no street address");
    expect(await owner.query(api.customers.list, {})).toEqual([]);
  });

  test("validates before asking Google", async () => {
    const { owner } = fixture();
    await expect(
      owner.action(api.customers.add, {
        name: "Maria Delgado",
        email: "",
        phone: "",
        firstSite: { placeId: "place-94th", sessionToken: session },
      }),
    ).rejects.toThrow("Add an email or phone number.");
    expect(google).not.toHaveBeenCalled();
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger } = fixture();
    await expect(
      stranger.action(api.customers.add, { name: "X", email: "x@example.com", phone: "" }),
    ).rejects.toThrow("Owner access required");
    await expect(stranger.query(api.customers.list, {})).rejects.toThrow(
      "Owner access required",
    );
  });
});

describe("customers.list", () => {
  test("counts each customer's sites", async () => {
    const { owner, customer, addSite } = fixture();
    const maria = await customer();
    const ben = await customer("Ben Okafor", "ben@example.com");
    await addSite(maria, "place-94th");
    await addSite(maria, "place-main");
    const rows = await owner.query(api.customers.list, {});
    expect(rows.find((r) => r._id === maria)?.siteCount).toBe(2);
    expect(rows.find((r) => r._id === ben)?.siteCount).toBe(0);
  });
});

describe("customers.update", () => {
  test("normalizes what the dialog sends, legacy raw values included", async () => {
    const { t, owner, customer } = fixture();
    const customerId = await customer();
    // A row saved before validation existed.
    await t.run((ctx) =>
      ctx.db.patch(customerId, {
        email: " Maria@Example.COM",
        phone: "555.123.4567",
      }),
    );
    const saved = await t.run((ctx) => ctx.db.get(customerId));
    await owner.mutation(api.customers.update, {
      customerId,
      name: " Maria D. ",
      email: saved!.email,
      phone: saved!.phone,
    });
    expect(await t.run((ctx) => ctx.db.get(customerId))).toMatchObject({
      name: "Maria D.",
      email: "maria@example.com",
      phone: "+15551234567",
    });
  });

  test("runs the same validation as add", async () => {
    const { owner, customer } = fixture();
    const customerId = await customer();
    const saved = { customerId, name: "Maria", email: "maria@example.com", phone: "" };
    for (const [patch, message] of [
      [{ email: "", phone: "" }, "Add an email or phone number."],
      [{ phone: "555-12" }, "Enter a valid US phone number."],
      [{ email: "not-an-email" }, "Enter a valid email address."],
      [{ name: " " }, "Enter the customer name."],
    ] as const)
      await expect(
        owner.mutation(api.customers.update, { ...saved, ...patch }),
      ).rejects.toThrow(message);
  });

  test("saves an email another customer already uses", async () => {
    const { owner, customer } = fixture();
    await customer("Harlow Property Group", "ops@harlow.example");
    const tenant = await customer();
    await owner.mutation(api.customers.update, {
      customerId: tenant,
      name: "Maria Delgado",
      email: "ops@harlow.example",
      phone: "",
    });
    const rows = await owner.query(api.customers.list, {});
    expect(rows.filter((r) => r.email === "ops@harlow.example")).toHaveLength(2);
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer } = fixture();
    const customerId = await customer();
    await expect(
      stranger.mutation(api.customers.update, {
        customerId,
        name: "Taken over",
        email: "x@example.com",
        phone: "",
      }),
    ).rejects.toThrow("Owner access required");
  });
});

describe("sites.forCustomer", () => {
  test("gives the customer page each of their sites: the address over two lines, access notes and proposal count", async () => {
    const { owner, customer, addSite, proposal } = fixture();
    const maria = await customer();
    const ben = await customer("Ben Okafor", "ben@example.com");
    const home = await addSite(maria, "place-94th", "Apt 2");
    const rental = await addSite(maria, "place-main");
    await addSite(ben, "place-apt");
    await owner.action(api.sites.update, {
      siteId: rental,
      addressLine2: "",
      accessNotes: "Key in the lockbox",
    });
    await proposal(home);
    await proposal(home);

    const cards = await owner.query(api.sites.forCustomer, { customerId: maria });
    expect(
      cards.map(({ _id, streetLine, cityLine, accessNotes, proposalCount }) => ({
        _id,
        streetLine,
        cityLine,
        accessNotes,
        proposalCount,
      })),
    ).toEqual([
      {
        _id: rental,
        streetLine: "1215 Main St",
        cityLine: "Vancouver, WA 98660",
        accessNotes: "Key in the lockbox",
        proposalCount: 0,
      },
      {
        _id: home,
        streetLine: "4410 NE 94th St, Apt 2",
        cityLine: "Vancouver, WA 98665",
        accessNotes: "",
        proposalCount: 2,
      },
    ]);
  });
});

describe("sites.list", () => {
  test("lists every site with its customer, address and proposal count, last touched first", async () => {
    const { t, owner, customer, addSite, proposal } = fixture();
    const maria = await customer();
    const ben = await customer("Ben Okafor", "ben@example.com");
    const home = await addSite(maria, "place-94th", "Apt 2");
    const rental = await addSite(maria, "place-main");
    const bens = await addSite(ben, "place-apt");
    await t.run(async (ctx) => {
      await ctx.db.patch(home, { updatedAt: 1_000 });
      await ctx.db.patch(rental, { updatedAt: 3_000 });
      await ctx.db.patch(bens, { updatedAt: 2_000 });
    });
    // A proposal edited since its site was lifts the site; an older one
    // changes nothing but the count.
    await proposal(home, 5_000);
    await proposal(home, 500);
    await proposal(bens, 1_500);

    expect(await owner.query(api.sites.list, {})).toEqual([
      {
        siteId: home,
        customerId: maria,
        customerName: "Maria Delgado",
        streetLine: "4410 NE 94th St, Apt 2",
        cityLine: "Vancouver, WA 98665",
        proposalCount: 2,
        lastActivity: 5_000,
      },
      {
        siteId: rental,
        customerId: maria,
        customerName: "Maria Delgado",
        streetLine: "1215 Main St",
        cityLine: "Vancouver, WA 98660",
        proposalCount: 0,
        lastActivity: 3_000,
      },
      {
        siteId: bens,
        customerId: ben,
        customerName: "Ben Okafor",
        streetLine: "1215 Main St, #4",
        cityLine: "Vancouver, WA 98660",
        proposalCount: 1,
        lastActivity: 2_000,
      },
    ]);
  });

  test("moves a site up when it is edited", async () => {
    const { t, owner, customer, addSite } = fixture();
    const maria = await customer();
    const older = await addSite(maria, "place-94th");
    const newer = await addSite(maria, "place-main");
    await t.run(async (ctx) => {
      await ctx.db.patch(older, { updatedAt: 1_000 });
      await ctx.db.patch(newer, { updatedAt: 2_000 });
    });
    await owner.action(api.sites.update, {
      siteId: older,
      addressLine2: "",
      accessNotes: "Side door",
    });
    const rows = await owner.query(api.sites.list, {});
    expect(rows.map((row) => row.siteId)).toEqual([older, newer]);
  });

  test("is empty with no sites", async () => {
    const { owner, customer } = fixture();
    await customer();
    expect(await owner.query(api.sites.list, {})).toEqual([]);
  });

  test("turns away anyone who is not the owner", async () => {
    const { t, stranger } = fixture();
    for (const caller of [t, stranger])
      await expect(caller.query(api.sites.list, {})).rejects.toThrow("Owner access required");
  });
});

describe("sites.get", () => {
  test("reads the header: the address over two lines, whose it is, access notes and each tab's count", async () => {
    const { t, owner, customer, addSite, proposal } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId, "place-94th", "Apt 2");
    await owner.action(api.sites.update, {
      siteId,
      addressLine2: "Apt 2",
      accessNotes: "Gate code 1234",
    });
    await owner.mutation(api.solutions.create, { siteId, title: "Gutters" });
    await owner.mutation(api.solutions.create, { siteId, title: "Fence" });
    const first = await proposal(siteId);
    await proposal(siteId);
    await t.run((ctx) =>
      ctx.db.insert("invoices", {
        proposalId: first,
        siteId,
        customerId,
        kind: "typed",
        state: "draft",
        lines: [],
        taxRate: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    // Another site's work is not counted here, even the same customer's.
    const other = await addSite(customerId, "place-main");
    await owner.mutation(api.solutions.create, { siteId: other, title: "Deck" });
    await proposal(other);

    expect(await owner.query(api.sites.get, { siteId })).toEqual({
      site: expect.objectContaining({ _id: siteId, name: "441094TH", customerId }),
      streetLine: "4410 NE 94th St, Apt 2",
      cityLine: "Vancouver, WA 98665",
      customerId,
      customerName: "Maria Delgado",
      accessNotes: "Gate code 1234",
      counts: { proposals: 2, solutions: 2, photos: 0, invoices: 1 },
    });
  });

  test("counts nothing on a new site", async () => {
    const { owner, customer, addSite } = fixture();
    const siteId = await addSite(await customer());
    expect((await owner.query(api.sites.get, { siteId }))?.counts).toEqual({
      proposals: 0,
      solutions: 0,
      photos: 0,
      invoices: 0,
    });
  });

  test("opens nothing for an id that names no site", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    const gone = await addSite(customerId);
    await owner.mutation(api.sites.remove, { siteId: gone });
    for (const siteId of [gone, "not-an-id", customerId])
      expect(await owner.query(api.sites.get, { siteId })).toBeNull();
  });

  test("turns away anyone who is not the owner", async () => {
    const { t, stranger, customer, addSite } = fixture();
    const siteId = await addSite(await customer());
    for (const caller of [t, stranger])
      await expect(caller.query(api.sites.get, { siteId })).rejects.toThrow(
        "Owner access required",
      );
  });
});
