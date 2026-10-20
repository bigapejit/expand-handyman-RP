import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";

import {
  callTool,
  centsFrom,
  ConnectorTools,
  dollarsOf,
  pickAddress,
  refusalMessage,
  type ConvexCaller,
  type ToolContext,
} from "./chatgpt-connector";
import { DefaultJobMathSettings } from "./job-math";

// A stand-in for Convex: each function answers from a handler named the way
// Convex names it (`solutions:update`), and every call is recorded, so a test
// can say what was written and that nothing was.
type Handler = (args: Record<string, unknown>) => unknown;

function fakeConvex(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const call = async (ref: FunctionReference<"query" | "mutation" | "action">, args = {}) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    const handler = handlers[name];
    if (!handler) throw new Error(`No fake for ${name}`);
    return handler(args as Record<string, unknown>);
  };
  const convex = { query: call, mutation: call, action: call } as unknown as ConvexCaller;
  const context: ToolContext = {
    convex,
    origin: "https://staff.expandhandyman.com",
    newSessionToken: () => "session-token-1",
  };
  const writes = () =>
    calls.filter((c) => !/:(list|get|forSite|suggest)$/.test(c.name)).map((c) => c.name);
  return { context, calls, writes };
}

function tool(name: string) {
  const found = ConnectorTools.find((t) => t.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return found;
}

const settings = { zelleTag: "expandhandyman", jobMath: DefaultJobMathSettings };

const site = {
  site: { _id: "site1", name: "1215MAIN" },
  streetLine: "1215 Main St",
  cityLine: "Vancouver, WA 98660",
  customerId: "cust1",
  customerName: "Maria Delgado",
  accessNotes: "",
};

// A stored solution as `solutions.get` reads it, cents and all.
function storedSolution(overrides: Record<string, unknown> = {}) {
  return {
    _id: "sol1",
    siteId: "site1",
    siteName: "1215MAIN",
    title: "Replace gutters",
    description: "Take down the old gutters and hang new ones.",
    lineItems: [
      { name: "Labor", quantity: 8, unit: "HR", unitCostCents: 4_550 },
      { name: "Gutter", quantity: 120, unit: "LF", unitCostCents: 325 },
    ],
    markupPercent: 10,
    materialAllowanceCents: null,
    // 8 × 45.50 + 120 × 3.25 = 754.00; × 1.1 = 829.40, rounded up to 830.
    price: { costCents: 75_400, priceCents: 83_000 },
    updatedAt: 0,
    deletable: true,
    ...overrides,
  };
}

function draftProposal(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "prop1",
    siteId: "site1",
    siteName: "1215MAIN",
    code: "1215MAIN-P1",
    name: null,
    title: "Replace gutters",
    state: "draft",
    recommended: false,
    solutions: [{ solutionId: "sol1", title: "Replace gutters", priceCents: 83_000 }],
    notes: null,
    tax: { source: "lookup", rate: 0.089 },
    money: { subtotalCents: 83_000, taxCents: 7_387, totalCents: 90_387 },
    depositPercent: 50,
    payment: {
      deposit: { kind: "percent", percent: 50 },
      depositCents: 45_194,
      balanceCents: 45_193,
    },
    sendBlockers: [],
    ...overrides,
  };
}

describe("dollars and cents", () => {
  test("dollars become whole cents, and cents read back as dollars", () => {
    expect(centsFrom(45.5, "Cost")).toBe(4_550);
    expect(centsFrom(0.1 + 0.2, "Cost")).toBe(30);
    expect(centsFrom(1_250, "Cost")).toBe(125_000);
    expect(dollarsOf(83_000)).toBe(830);
    expect(dollarsOf(7_387)).toBe(73.87);
  });

  test("a figure finer than a cent is refused, not rounded", () => {
    expect(() => centsFrom(12.345, "Line 1's unit cost")).toThrow(
      "Line 1's unit cost must be dollars and cents, such as 12.50.",
    );
    expect(() => centsFrom(Number.NaN, "The price")).toThrow("The price must be dollars and cents");
  });
});

describe("every tool", () => {
  test("has a snake_case name, a description and all three hints ChatGPT asks for", () => {
    const names = ConnectorTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ConnectorTools) {
      expect(t.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(t.description.length).toBeGreaterThan(40);
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations.destructiveHint).toBe("boolean");
      expect(typeof t.annotations.openWorldHint).toBe("boolean");
    }
  });

  test("offers no way to send, delete, invoice or take payment", () => {
    for (const t of ConnectorTools)
      expect(t.name).not.toMatch(/send|delete|remove|invoice|pay|withdraw|decline|approve/);
  });

  test("only the reads say they are read-only", () => {
    const reads = ConnectorTools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
    expect(reads.sort()).toEqual(
      ["find_customers", "get_proposal", "get_site", "job_math", "list_proposals"].sort(),
    );
  });
});

describe("refusals", () => {
  test("a Convex refusal reaches ChatGPT as the app's own sentence", async () => {
    const { context } = fakeConvex({
      "sites:get": () => site,
      "solutions:create": () => {
        throw new Error(
          "[CONVEX M(solutions:create)] [Request ID: 1] Server Error Uncaught Error: Owner access required. Sign in with the authorized account. Called by client",
        );
      },
    });
    expect(
      await callTool(tool("create_solution"), { site_id: "site1", title: "Gutters" }, context),
    ).toEqual({
      ok: false,
      message: "Owner access required. Sign in with the authorized account.",
    });
  });

  test("a refusal that names its reasons keeps its sentence", () => {
    expect(
      refusalMessage(
        new ConvexError({ code: "no_email", message: "The customer has no email address to send it to." }),
      ),
    ).toBe("The customer has no email address to send it to.");
  });

  test("an id Convex never gave out says to look it up again", () => {
    expect(
      refusalMessage(
        new Error(
          "[CONVEX A(sites:add)] [Request ID: 2] Server Error ArgumentValidationError: Value does not match validator.\nPath: .customerId\nValue: \"maria\"\nValidator: v.id(\"customers\")",
        ),
      ),
    ).toMatch(/not one the app gave out. Look it up again/);
  });

  test("arguments the schema refuses never reach Convex", async () => {
    const { context, calls } = fakeConvex({});
    const result = await callTool(tool("create_solution"), { title: "Gutters" }, context);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/site_id/);
    expect(calls).toEqual([]);
  });
});

describe("create_solution", () => {
  test("stores dollars as cents and answers with the app's price in dollars, Job math and a link", async () => {
    const { context, calls, writes } = fakeConvex({
      "sites:get": () => site,
      "solutions:create": () => "sol1",
      "solutions:get": () => storedSolution(),
      "settings:get": () => settings,
    });
    const result = await callTool(
      tool("create_solution"),
      {
        site_id: "site1",
        title: " Replace gutters ",
        scope_of_work: "Take down the old gutters and hang new ones.",
        line_items: [
          { name: "Labor", quantity: 8, unit: "HR", unit_cost_dollars: 45.5 },
          { name: "Gutter", quantity: 120, unit: "LF", unit_cost_dollars: 3.25 },
        ],
      },
      context,
    );

    // One mutation writes the whole solution, so nothing is left half-written.
    expect(writes()).toEqual(["solutions:create"]);
    expect(calls.find((c) => c.name === "solutions:create")?.args).toEqual({
      siteId: "site1",
      title: "Replace gutters",
      description: "Take down the old gutters and hang new ones.",
      lineItems: [
        { name: "Labor", quantity: 8, unit: "HR", unitCostCents: 4_550 },
        { name: "Gutter", quantity: 120, unit: "LF", unitCostCents: 325 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      output: {
        solution_id: "sol1",
        site_id: "site1",
        title: "Replace gutters",
        scope_of_work: "Take down the old gutters and hang new ones.",
        line_items: [
          { name: "Labor", quantity: 8, unit: "HR", unit_cost_dollars: 45.5, line_cost_dollars: 364 },
          { name: "Gutter", quantity: 120, unit: "LF", unit_cost_dollars: 3.25, line_cost_dollars: 390 },
        ],
        markup_percent: 10,
        material_allowance_dollars: null,
        cost_dollars: 754,
        price_dollars: 830,
        // $830: buckets take $249, other costs $390, leaving $191 for 8 hours;
        // 25% set aside leaves $143.25, about $18/hr.
        job_math: expect.stringMatching(/^You keep about \$18\/hr doing it yourself; /),
        link: "https://staff.expandhandyman.com/sites/site1/solutions?solution=sol1",
      },
    });
  });

  test("refuses a figure it can't store before writing anything", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [
        { line_items: [{ name: "Labor", quantity: 1, unit_cost_dollars: 45.555 }] },
        /Line 1's unit cost must be dollars and cents/,
      ],
      [{ line_items: [{ name: " ", quantity: 1, unit_cost_dollars: 5 }] }, /Line 1: Every Line Item needs a name/],
      [{ markup_percent: 12.5 }, /Markup must be a whole percent/],
      [{ material_allowance_dollars: 250.5 }, /Material Allowance must be a whole number of dollars/],
    ];
    for (const [args, message] of cases) {
      const { context, writes } = fakeConvex({ "sites:get": () => site });
      const result = await callTool(
        tool("create_solution"),
        { site_id: "site1", title: "Gutters", ...args },
        context,
      );
      expect(result.ok === false && result.message).toMatch(message);
      expect(writes()).toEqual([]);
    }
  });

  test("names a site that doesn't exist and writes nothing", async () => {
    const { context, writes } = fakeConvex({ "sites:get": () => null });
    const result = await callTool(tool("create_solution"), { site_id: "nope", title: "Gutters" }, context);
    expect(result.ok === false && result.message).toMatch(/No site has the id nope/);
    expect(writes()).toEqual([]);
  });
});

describe("update_solution", () => {
  test("changes only what is named, can take the allowance off, and says the price before", async () => {
    const { context, calls } = fakeConvex({
      "solutions:get": () => storedSolution(),
      "solutions:update": () => null,
      "settings:get": () => settings,
    });
    const result = await callTool(
      tool("update_solution"),
      { solution_id: "sol1", markup_percent: 20, material_allowance_dollars: null },
      context,
    );
    expect(calls.find((c) => c.name === "solutions:update")?.args).toEqual({
      solutionId: "sol1",
      markupPercent: 20,
      materialAllowanceCents: null,
    });
    expect(result.ok && result.output).toMatchObject({ price_before_dollars: 830, price_dollars: 830 });
  });

  test("is marked as able to overwrite what the owner wrote", () => {
    expect(tool("update_solution").annotations.destructiveHint).toBe(true);
  });
});

describe("pickAddress", () => {
  const place = (placeId: string, mainText: string, secondaryText: string) => ({
    placeId,
    mainText,
    secondaryText,
  });

  test("takes Google's only suggestion", () => {
    const only = place("p1", "4410 NE 94th St", "Vancouver, WA, USA");
    expect(pickAddress("4410 ne 94th", [only])).toEqual({ kind: "picked", suggestion: only });
  });

  test("among several, takes the one whose street and city the typing names", () => {
    const right = place("p1", "4410 NE 94th St", "Vancouver, WA, USA");
    const wrong = place("p2", "4410 NE 94th St", "Seattle, WA, USA");
    expect(pickAddress("4410 NE 94th St, Vancouver WA", [wrong, right])).toEqual({
      kind: "picked",
      suggestion: right,
    });
  });

  test("asks rather than guesses when the typing doesn't settle it", () => {
    const a = place("p1", "4410 NE 94th St", "Vancouver, WA, USA");
    const b = place("p2", "4410 NE 94th Ave", "Vancouver, WA, USA");
    expect(pickAddress("4410 NE 94th, Vancouver", [a, b])).toEqual({
      kind: "choose",
      candidates: [a, b],
    });
    expect(pickAddress("anything", [])).toEqual({ kind: "none" });
  });
});

describe("create_site", () => {
  const suggestions = [
    { placeId: "p1", mainText: "4410 NE 94th St", secondaryText: "Vancouver, WA, USA" },
    { placeId: "p2", mainText: "4410 NE 94th Ave", secondaryText: "Vancouver, WA, USA" },
  ];

  test("returns the candidates and saves nothing when the address is ambiguous", async () => {
    const { context, writes } = fakeConvex({ "places:suggest": () => suggestions });
    const result = await callTool(
      tool("create_site"),
      { customer_id: "cust1", address: "4410 NE 94th, Vancouver" },
      context,
    );
    expect(writes()).toEqual([]);
    expect(result.ok && result.output).toEqual({
      status: "choose_address",
      message: expect.stringContaining("Nothing was saved"),
      candidates: [
        { place_id: "p1", address: "4410 NE 94th St, Vancouver, WA, USA" },
        { place_id: "p2", address: "4410 NE 94th Ave, Vancouver, WA, USA" },
      ],
    });
  });

  test("saves the chosen place in the lookup's own session and reads back Google's address", async () => {
    const { context, calls } = fakeConvex({
      "sites:add": () => "site1",
      "sites:get": () => site,
    });
    const result = await callTool(
      tool("create_site"),
      { customer_id: "cust1", address: "1215 Main", place_id: "p9", unit: "Apt 2" },
      context,
    );
    expect(calls.map((c) => c.name)).toEqual(["sites:add", "sites:get"]);
    expect(calls[0].args).toEqual({
      customerId: "cust1",
      placeId: "p9",
      sessionToken: "session-token-1",
      addressLine2: "Apt 2",
      accessNotes: "",
    });
    expect(result.ok && result.output).toMatchObject({
      status: "created",
      site_id: "site1",
      address: "1215 Main St, Vancouver, WA 98660",
      link: "https://staff.expandhandyman.com/sites/site1",
    });
  });

  test("says when Google finds nothing", async () => {
    const { context } = fakeConvex({ "places:suggest": () => [] });
    const result = await callTool(tool("create_site"), { customer_id: "c", address: "nowhere" }, context);
    expect(result.ok === false && result.message).toMatch(/Google found no street address/);
  });
});

describe("find_customers", () => {
  test("finds by name, phone or email, each with their sites and links", async () => {
    const customers = [
      { _id: "cust1", name: "Maria Delgado", email: "maria@example.com", phone: "+13605551234" },
      { _id: "cust2", name: "Sam Ortiz", email: "sam@delgado-law.com", phone: "" },
      { _id: "cust3", name: "Lee Park", email: "", phone: "+15035550000" },
    ];
    const sites = [
      {
        siteId: "site1",
        customerId: "cust1",
        customerName: "Maria Delgado",
        streetLine: "1215 Main St",
        cityLine: "Vancouver, WA 98660",
        proposalCount: 2,
        lastActivity: 0,
      },
    ];
    const { context } = fakeConvex({ "customers:list": () => customers, "sites:list": () => sites });

    const byName = await callTool(tool("find_customers"), { query: "delgado" }, context);
    expect(byName.ok && byName.output).toEqual({
      customers: [
        {
          customer_id: "cust1",
          name: "Maria Delgado",
          email: "maria@example.com",
          phone: "(360) 555-1234",
          link: "https://staff.expandhandyman.com/customers/cust1",
          sites: [
            {
              site_id: "site1",
              address: "1215 Main St, Vancouver, WA 98660",
              proposal_count: 2,
              link: "https://staff.expandhandyman.com/sites/site1",
            },
          ],
        },
        expect.objectContaining({ customer_id: "cust2", email: "sam@delgado-law.com", phone: null, sites: [] }),
      ],
      more_matches: 0,
    });

    const byPhone = await callTool(tool("find_customers"), { query: "503 555" }, context);
    expect(byPhone.ok && (byPhone.output.customers as { name: string }[]).map((c) => c.name)).toEqual([
      "Lee Park",
    ]);

    const none = await callTool(tool("find_customers"), { query: "nobody" }, context);
    expect(none.ok && none.output.message).toMatch(/create_customer adds one/);
  });
});

describe("list_proposals", () => {
  const rows = [
    { proposalId: "p3", siteId: "s1", customerId: "c1", customerName: "Maria", code: "1215MAIN-P3", title: "Deck", state: "draft", totalCents: 120_050 },
    { proposalId: "p2", siteId: "s1", customerId: "c1", customerName: "Maria", code: "1215MAIN-P2", title: "Fence", state: "sent", totalCents: 50_000 },
    { proposalId: "p1", siteId: "s1", customerId: "c1", customerName: "Maria", code: "1215MAIN-P1", title: "Gutters", state: "approved", totalCents: 90_387 },
  ];

  test("groups them as drafts, sent and approved, totals in dollars", async () => {
    const { context } = fakeConvex({ "proposals:list": () => rows });
    const result = await callTool(tool("list_proposals"), {}, context);
    const output = result.ok ? result.output : {};
    expect(Object.keys(output)).toEqual(["drafts", "sent", "approved", "declined"]);
    expect(output.drafts).toEqual({
      label: "Drafts, not yet sent",
      count: 1,
      proposals: [
        {
          proposal_id: "p3",
          proposal_code: "1215MAIN-P3",
          title: "Deck",
          customer: "Maria",
          site_id: "s1",
          total_dollars: 1_200.5,
          link: "https://staff.expandhandyman.com/proposals/p3",
        },
      ],
    });
  });

  test("shows one group when asked for one state", async () => {
    const { context } = fakeConvex({ "proposals:list": () => rows });
    const result = await callTool(tool("list_proposals"), { state: "sent" }, context);
    expect(result.ok && Object.keys(result.output)).toEqual(["sent"]);
  });
});

describe("get_proposal", () => {
  test("finds it by Proposal ID and reads its money in dollars, with each solution's line items", async () => {
    const { context } = fakeConvex({
      "proposals:list": () => [
        { proposalId: "prop1", siteId: "site1", customerId: "cust1", customerName: "Maria Delgado", code: "1215MAIN-P1", title: "Replace gutters", state: "draft", totalCents: 90_387 },
      ],
      "proposals:forSite": () => ({
        customerEmail: null,
        solutions: [],
        proposals: [draftProposal({ sendBlockers: ["no_email"] })],
      }),
      "sites:get": () => site,
      "solutions:forSite": () => [storedSolution()],
      "settings:get": () => settings,
    });
    const result = await callTool(tool("get_proposal"), { proposal: "1215main-p1" }, context);
    expect(result.ok && result.output).toMatchObject({
      proposal_id: "prop1",
      proposal_code: "1215MAIN-P1",
      state: "draft",
      subtotal_dollars: 830,
      tax_rate: 0.089,
      tax_dollars: 73.87,
      total_dollars: 903.87,
      deposit: { percent: 50, dollars: 451.94 },
      balance_dollars: 451.93,
      send_blockers: ["The customer has no email address to send it to."],
      customer: { customer_id: "cust1", name: "Maria Delgado" },
      site: { site_id: "site1", address: "1215 Main St, Vancouver, WA 98660" },
      solutions: [
        expect.objectContaining({
          solution_id: "sol1",
          price_dollars: 830,
          line_items: expect.arrayContaining([
            expect.objectContaining({ name: "Labor", unit_cost_dollars: 45.5 }),
          ]),
        }),
      ],
      link: "https://staff.expandhandyman.com/proposals/prop1",
      paper_link: "https://staff.expandhandyman.com/proposals/prop1/paper",
    });
  });

  test("says how to find one it doesn't know", async () => {
    const { context } = fakeConvex({ "proposals:list": () => [] });
    const result = await callTool(tool("get_proposal"), { proposal: "XYZ-P9" }, context);
    expect(result.ok === false && result.message).toMatch(/No proposal is XYZ-P9. list_proposals/);
  });
});

describe("get_site", () => {
  test("lists the customer's open deals a proposal here could be for, each with a Pipeline link", async () => {
    const { context } = fakeConvex({
      "sites:get": () => site,
      "solutions:forSite": () => [],
      "proposals:forSite": () => ({ customerEmail: null, solutions: [], proposals: [] }),
      "deals:openAtSite": () => [
        { dealId: "deal1", title: "Gutters", stage: "estimating", hasSite: true },
      ],
      "settings:get": () => settings,
    });
    const result = await callTool(tool("get_site"), { site_id: "site1" }, context);
    expect(result.ok && result.output.open_deals).toEqual([
      {
        deal_id: "deal1",
        title: "Gutters",
        stage: "Estimating",
        link: "https://staff.expandhandyman.com/?deal=deal1",
      },
    ]);
  });
});

describe("create_proposal", () => {
  test("makes a draft for the deal named, offering the named solutions with the deposit asked for", async () => {
    const { context, calls, writes } = fakeConvex({
      "sites:get": () => site,
      "solutions:forSite": () => [storedSolution()],
      "proposals:create": () => "prop1",
      "proposals:forSite": () => ({
        customerEmail: "maria@example.com",
        solutions: [],
        proposals: [draftProposal({ depositPercent: 30 })],
      }),
    });
    const result = await callTool(
      tool("create_proposal"),
      { site_id: "site1", solution_ids: ["sol1", "sol1"], deal_id: "deal1", deposit_percent: 30 },
      context,
    );
    // One action inserts the draft with everything in it.
    expect(writes()).toEqual(["proposals:create"]);
    expect(calls.find((c) => c.name === "proposals:create")?.args).toEqual({
      siteId: "site1",
      solutionIds: ["sol1"],
      dealId: "deal1",
      depositPercent: 30,
    });
    expect(result.ok && result.output).toMatchObject({ proposal_id: "prop1", state: "draft" });
  });

  test("refuses a solution from another site, or a deposit that isn't a whole percent, before making anything", async () => {
    for (const [args, message] of [
      [{ solution_ids: ["sol9"] }, /not solutions at this site: sol9/],
      [{ solution_ids: ["sol1"], deposit_percent: 33.5 }, /whole percent between 0 and 100/],
    ] as const) {
      const { context, writes } = fakeConvex({
        "sites:get": () => site,
        "solutions:forSite": () => [storedSolution()],
      });
      const result = await callTool(tool("create_proposal"), { site_id: "site1", ...args }, context);
      expect(result.ok === false && result.message).toMatch(message);
      expect(writes()).toEqual([]);
    }
  });
});

describe("add_solutions_to_proposal", () => {
  const list = () => [
    { proposalId: "prop1", siteId: "site1", customerId: "cust1", customerName: "Maria", code: "1215MAIN-P1", title: "Gutters", state: "draft", totalCents: 0 },
  ];

  test("adds to the end, keeping what it already offers in place", async () => {
    const { context, calls } = fakeConvex({
      "proposals:list": list,
      "proposals:forSite": () => ({ customerEmail: null, solutions: [], proposals: [draftProposal()] }),
      "solutions:forSite": () => [storedSolution(), storedSolution({ _id: "sol2" })],
      "proposals:update": () => null,
    });
    await callTool(
      tool("add_solutions_to_proposal"),
      { proposal: "prop1", solution_ids: ["sol1", "sol2"] },
      context,
    );
    expect(calls.find((c) => c.name === "proposals:update")?.args).toEqual({
      proposalId: "prop1",
      solutionIds: ["sol1", "sol2"],
    });
  });

  test("refuses a proposal past Draft", async () => {
    const { context, writes } = fakeConvex({
      "proposals:list": list,
      "proposals:forSite": () => ({
        customerEmail: null,
        solutions: [],
        proposals: [draftProposal({ state: "sent" })],
      }),
    });
    const result = await callTool(
      tool("add_solutions_to_proposal"),
      { proposal: "1215MAIN-P1", solution_ids: ["sol2"] },
      context,
    );
    expect(result.ok === false && result.message).toMatch(/1215MAIN-P1 is sent, and only a draft/);
    expect(writes()).toEqual([]);
  });
});

describe("job_math", () => {
  test("takes dollars, reads the owner's saved percentages, and answers in dollars", async () => {
    const { context } = fakeConvex({ "settings:get": () => settings });
    const result = await callTool(
      tool("job_math"),
      { price_dollars: 1_000, hours: 10, other_costs_dollars: 100 },
      context,
    );
    expect(result.ok && result.output).toMatchObject({
      buckets: [
        { name: "Profit", percent: 10, dollars: 100 },
        { name: "Marketing", percent: 10, dollars: 100 },
        { name: "Ops", percent: 10, dollars: 100 },
      ],
      left_for_labor_dollars: 600,
      you_do_it: {
        pay_dollars: 600,
        tax_set_aside_percent: 25,
        tax_set_aside_dollars: 150,
        take_home_dollars: 450,
        take_home_per_hour_dollars: 45,
      },
      w2_worker: { at_wage: { wage_per_hour_dollars: 30, wages_dollars: 300 } },
      link: "https://staff.expandhandyman.com/job-math?price=1000&hours=10&other=100",
    });
  });
});
