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
  const customer = (name = "Maria Delgado", email = "maria@example.com") =>
    owner.action(api.customers.add, { name, email, phone: "" });
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
  return { t, owner, stranger, customer, addSite };
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
      address: "4410 NE 94th St, Apt 2, Vancouver, WA 98665",
      proposalCount: 0,
    });
    // The details call closes the lookup's billing session.
    expect(calls().at(-1)?.searchParams.get("sessionToken")).toBe(session);
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
  test("deletes a site with no proposals", async () => {
    const { owner, customer, addSite } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId);
    await owner.mutation(api.sites.remove, { siteId });
    expect(await owner.query(api.sites.forCustomer, { customerId })).toEqual([]);
  });

  test("refuses while the site has any proposal, a draft included", async () => {
    const { t, owner, customer, addSite } = fixture();
    const customerId = await customer();
    const siteId = await addSite(customerId);
    await t.run((ctx) => ctx.db.insert("proposals", { siteId }));
    await expect(owner.mutation(api.sites.remove, { siteId })).rejects.toThrow(
      "has proposals",
    );
    const [site] = await owner.query(api.sites.forCustomer, { customerId });
    expect(site.proposalCount).toBe(1);
  });

  test("turns away anyone who is not the owner", async () => {
    const { stranger, customer, addSite } = fixture();
    const siteId = await addSite(await customer());
    await expect(stranger.mutation(api.sites.remove, { siteId })).rejects.toThrow(
      "Owner access required",
    );
  });
});

describe("customers.add", () => {
  test("adds a customer with no site", async () => {
    const { owner, customer } = fixture();
    const customerId = await customer();
    expect(await owner.query(api.sites.forCustomer, { customerId })).toEqual([]);
    expect(google).not.toHaveBeenCalled();
  });

  test("creates the first site with the customer", async () => {
    const { owner } = fixture();
    const customerId = await owner.action(api.customers.add, {
      name: "Maria Delgado",
      email: "maria@example.com",
      phone: "",
      firstSite: { placeId: "place-94th", sessionToken: session },
    });
    const sites = await owner.query(api.sites.forCustomer, { customerId });
    expect(sites).toMatchObject([{ name: "441094TH", addressLine2: "" }]);
    const [row] = await owner.query(api.customers.list, {});
    expect(row).toMatchObject({ _id: customerId, siteCount: 1 });
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
    // A row saved before validation existed, with a legacy site string.
    await t.run((ctx) =>
      ctx.db.patch(customerId, {
        email: " Maria@Example.COM",
        phone: "555.123.4567",
        site: "4410 NE 94th St",
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
      // Not the dialog's to change; the migration moves it onto a site.
      site: "4410 NE 94th St",
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
