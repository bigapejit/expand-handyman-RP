import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");

// The customers table as it stood before Sites, with its free-text address, so
// the one-off migration has something to move.
const legacySchema = defineSchema({
  ...schema.tables,
  customers: defineTable({
    ...schema.tables.customers.validator.fields,
    site: v.optional(v.string()),
  }),
});

const component = (longText: string, types: string[], shortText = longText) => ({
  longText,
  shortText,
  types,
});
const places: Record<string, object> = {
  "place-94th": {
    id: "place-94th",
    addressComponents: [
      component("4410", ["street_number"]),
      component("Northeast 94th Street", ["route"], "NE 94th St"),
      component("Vancouver", ["locality"]),
      component("Washington", ["administrative_area_level_1"], "WA"),
      component("United States", ["country"], "US"),
      component("98665", ["postal_code"]),
    ],
    location: { latitude: 45.69, longitude: -122.61 },
  },
  "place-apt": {
    id: "place-apt",
    addressComponents: [
      component("4", ["subpremise"]),
      component("1215", ["street_number"]),
      component("Main Street", ["route"], "Main St"),
      component("Vancouver", ["locality"]),
      component("Washington", ["administrative_area_level_1"], "WA"),
      component("United States", ["country"], "US"),
      component("98660", ["postal_code"]),
    ],
    location: { latitude: 45.63, longitude: -122.67 },
  },
  // A street with no house number: one match, but not a street address.
  "place-route": {
    id: "place-route",
    addressComponents: [
      component("Fourth Plain Boulevard", ["route"], "Fourth Plain Blvd"),
      component("Vancouver", ["locality"]),
      component("United States", ["country"], "US"),
    ],
    location: { latitude: 45.64, longitude: -122.6 },
  },
};

// What Google suggests for each legacy address, by the text typed.
const suggestions: Record<string, string[]> = {
  "4410 NE 94th St, Vancouver WA": ["place-94th"],
  "1215 Main St Apt 4, Vancouver": ["place-apt"],
  "Main St": ["place-94th", "place-apt", "place-route"],
  "Fourth Plain Blvd": ["place-route"],
};

let googleDown = false;
const google = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  if (googleDown) return new Response("{}", { status: 503 });
  const url = new URL(String(input));
  if (url.pathname === "/v1/places:autocomplete") {
    const { input: typed } = JSON.parse(String(init?.body));
    return Response.json({
      suggestions: (suggestions[typed] ?? []).map((placeId) => ({
        placePrediction: {
          placeId,
          structuredFormat: { mainText: { text: typed }, secondaryText: { text: "" } },
        },
      })),
    });
  }
  const place = places[decodeURIComponent(url.pathname.replace("/v1/places/", ""))];
  return place ? Response.json(place) : new Response("{}", { status: 404 });
});

beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "server-key");
  googleDown = false;
  google.mockClear();
  vi.stubGlobal("fetch", google);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fixture() {
  const t = convexTest(legacySchema, modules);
  const customer = (name: string, site?: string) =>
    t.run((ctx) =>
      ctx.db.insert("customers", {
        name,
        email: `${name.split(" ")[0].toLowerCase()}@example.com`,
        phone: "",
        site,
      }),
    );
  const migrate = () => t.action(internal.migrations.sitesFromCustomers, {});
  const sitesOf = (customerId: string) =>
    t.run(async (ctx) =>
      (await ctx.db.query("sites").collect()).filter(
        (s) => s.customerId === customerId,
      ),
    );
  const legacyText = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("customers").collect()).map((c) => c.site ?? null),
    );
  return { t, customer, migrate, sitesOf, legacyText };
}

describe("migrations.sitesFromCustomers", () => {
  test("one confident match becomes a site named from its street", async () => {
    const { customer, migrate, sitesOf } = fixture();
    const maria = await customer("Maria Delgado", "4410 NE 94th St, Vancouver WA");
    expect(await migrate()).toEqual({
      migrated: [{ customer: "Maria Delgado", site: "441094TH" }],
      failed: [],
    });
    expect(await sitesOf(maria)).toMatchObject([
      {
        name: "441094TH",
        placeId: "place-94th",
        addressLine1: "4410 NE 94th St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98665",
        accessNotes: "",
        lastProposalNumber: 0,
      },
    ]);
  });

  test("a matched apartment keeps its unit", async () => {
    const { customer, migrate, sitesOf } = fixture();
    const ben = await customer("Ben Okafor", "1215 Main St Apt 4, Vancouver");
    await migrate();
    expect(await sitesOf(ben)).toMatchObject([
      { name: "1215MAIN", addressLine2: "#4" },
    ]);
  });

  test("no match, several matches or a match that is no street address create no site", async () => {
    const { customer, migrate, sitesOf } = fixture();
    const ids = [
      await customer("Nobody Known", "Behind the old mill"),
      await customer("Several Places", "Main St"),
      await customer("Only A Street", "Fourth Plain Blvd"),
    ];
    const { migrated, failed } = await migrate();
    expect(migrated).toEqual([]);
    expect(failed).toEqual(
      expect.arrayContaining([
        {
          customer: "Nobody Known",
          address: "Behind the old mill",
          reason: "Google found no match.",
        },
        {
          customer: "Several Places",
          address: "Main St",
          reason: "Google found 3 matches.",
        },
        {
          customer: "Only A Street",
          address: "Fourth Plain Blvd",
          reason: expect.stringContaining("no street address"),
        },
      ]),
    );
    expect(failed).toHaveLength(3);
    for (const id of ids) expect(await sitesOf(id)).toEqual([]);
  });

  test("clears every legacy address, blank ones included, so the field can be dropped", async () => {
    const { customer, migrate, legacyText } = fixture();
    await customer("Maria Delgado", "4410 NE 94th St, Vancouver WA");
    await customer("Nobody Known", "Behind the old mill");
    await customer("Blank Address", "  ");
    await customer("Added After Sites");
    const report = await migrate();
    // A blank address is nothing to move and nothing to report.
    expect([...report.migrated, ...report.failed].map((r) => r.customer)).toEqual([
      "Maria Delgado",
      "Nobody Known",
    ]);
    expect(await legacyText()).toEqual([null, null, null, null]);
    expect(await migrate()).toEqual({ migrated: [], failed: [] });
  });

  test("a customer who already has that site is not given a second one", async () => {
    const { t, customer, migrate, sitesOf } = fixture();
    const maria = await customer("Maria Delgado", "4410 NE 94th St, Vancouver WA");
    // The owner added it on the Sites tab before the migration ran.
    await t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId: maria,
        name: "441094TH",
        placeId: "place-94th",
        addressLine1: "4410 NE 94th St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98665",
        latitude: 45.69,
        longitude: -122.61,
        accessNotes: "Gate code 1234",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    expect(await migrate()).toEqual({
      migrated: [{ customer: "Maria Delgado", site: "441094TH" }],
      failed: [],
    });
    expect(await sitesOf(maria)).toMatchObject([{ accessNotes: "Gate code 1234" }]);
  });

  test("each customer's lookup is one Places session", async () => {
    const { customer, migrate } = fixture();
    await customer("Maria Delgado", "4410 NE 94th St, Vancouver WA");
    await customer("Ben Okafor", "1215 Main St Apt 4, Vancouver");
    await migrate();
    const sessions = google.mock.calls.map(([input, init]) => {
      const url = new URL(String(input));
      return url.pathname === "/v1/places:autocomplete"
        ? JSON.parse(String(init?.body)).sessionToken
        : url.searchParams.get("sessionToken");
    });
    expect(sessions).toHaveLength(4);
    expect(new Set(sessions).size).toBe(2);
    for (const [, init] of google.mock.calls)
      expect(new Headers(init?.headers).get("X-Goog-Api-Key")).toBe("server-key");
  });

  test("a Google fault writes nothing, so the run can be repeated", async () => {
    const { customer, migrate, sitesOf, legacyText } = fixture();
    const maria = await customer("Maria Delgado", "4410 NE 94th St, Vancouver WA");
    googleDown = true;
    await expect(migrate()).rejects.toThrow("Google address lookup failed (HTTP 503)");
    expect(await sitesOf(maria)).toEqual([]);
    expect(await legacyText()).toEqual(["4410 NE 94th St, Vancouver WA"]);
  });

  test("refuses to run without the Google key", async () => {
    const { customer, migrate, legacyText } = fixture();
    await customer("Maria Delgado", "4410 NE 94th St, Vancouver WA");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    await expect(migrate()).rejects.toThrow("GOOGLE_MAPS_API_KEY");
    expect(google).not.toHaveBeenCalled();
    expect(await legacyText()).toEqual(["4410 NE 94th St, Vancouver WA"]);
  });
});
