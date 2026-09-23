import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Unknown, WashingtonNoticeToCustomer } from "../lib/expand-business";

const modules = import.meta.glob("../convex/**/*.ts");

// DOR's answer for a Vancouver address: 8.9% at location 0605.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

// Outbound HTTP, stubbed at fetch: DOR answers from `dor`, Resend from
// `resend`, and every call to Resend is kept to be asserted on.
let dor: ReturnType<typeof vi.fn>;
let resend: ReturnType<typeof vi.fn>;
let resendCalls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[];

beforeEach(() => {
  // Scheduled email sends run only when a test calls `deliver()`. On real
  // timers a send would fire after its test had finished with the database.
  vi.useFakeTimers();
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("APP_ORIGIN", "https://staff.expandhandyman.com/");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("EMAIL_REPLY_TO", "");
  dor = vi.fn(
    async () =>
      new Response(vancouverRate, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } }),
  );
  resend = vi.fn(async () => Response.json({ id: "resend-message-1" }));
  resendCalls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.resend.com/")) return dor(input, init);
    resendCalls.push({
      url,
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

// A Send refusal's data. Through an action, convex-test hands a ConvexError's
// data on as JSON rather than as the object; the client reads either
// (lib/utils.ts, `errorMessage`).
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
  const customer = (email = "maria@example.com", name = "Maria Delgado") =>
    t.run((ctx) => ctx.db.insert("customers", { name, email, phone: "" }));
  const site = (customerId: Id<"customers">, name = "1300FRANKLIN") =>
    t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name,
        addressLine1: "1300 Franklin St",
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
  const solution = async (siteId: Id<"sites">, title: string, unitCostCents?: number) => {
    const solutionId = await owner.mutation(api.solutions.create, { siteId, title });
    await owner.mutation(api.solutions.update, {
      solutionId,
      description: `Scope for ${title}.`,
      ...(unitCostCents === undefined
        ? {}
        : { lineItems: [{ name: `${title} labor`, quantity: 2, unitCostCents, unit: "HR" }] }),
    });
    return solutionId;
  };
  // A draft with priced work at a Washington site: everything Send asks for.
  const sendable = async (email?: string) => {
    const customerId = await customer(email);
    const siteId = await site(customerId);
    const solutionId = await solution(siteId, "Fix gate", 25_000);
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [solutionId] });
    return { customerId, siteId, solutionId, proposalId };
  };
  const read = async (customerId: Id<"customers">, proposalId: Id<"proposals">) => {
    const tab = await owner.query(api.proposals.forCustomer, { customerId });
    const found = tab.proposals.find((p) => p.proposalId === proposalId);
    if (!found) throw new Error("Proposal not on the tab.");
    return found;
  };
  const liveToken = async (customerId: Id<"customers">, proposalId: Id<"proposals">) => {
    const token = (await read(customerId, proposalId)).liveToken;
    if (!token) throw new Error("No live link.");
    return token;
  };
  // Runs the scheduled email sends to completion.
  const deliver = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, owner, stranger, customer, site, solution, sendable, read, liveToken, deliver };
}

describe("proposals.send", () => {
  test("refuses a proposal with no solutions", async () => {
    const { owner, customer, site } = fixture();
    const siteId = await site(await customer());
    const proposalId = await owner.action(api.proposals.create, { siteId });
    expect(await refusal(owner.action(api.proposals.send, { proposalId }))).toMatchObject(
      { code: "no_solutions" },
    );
  });

  test("refuses a proposal holding an unpriced solution", async () => {
    const { owner, customer, site, solution } = fixture();
    const siteId = await site(await customer());
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, {
      proposalId,
      solutionIds: [await solution(siteId, "Fix gate", 25_000), await solution(siteId, "Paint")],
    });
    expect(await refusal(owner.action(api.proposals.send, { proposalId }))).toMatchObject(
      { code: "unpriced_solution" },
    );
  });

  test("refuses a Washington proposal with no tax rate", async () => {
    const { owner, customer, site, solution } = fixture();
    dor.mockImplementation(async () => new Response("down", { status: 503 }));
    const siteId = await site(await customer());
    const proposalId = await owner.action(api.proposals.create, { siteId });
    await owner.mutation(api.proposals.update, {
      proposalId,
      solutionIds: [await solution(siteId, "Fix gate", 25_000)],
    });
    expect(await refusal(owner.action(api.proposals.send, { proposalId }))).toMatchObject(
      { code: "no_tax_rate" },
    );
  });

  test("refuses when the customer has no email address", async () => {
    const { owner, sendable } = fixture();
    const { proposalId } = await sendable("");
    expect(await refusal(owner.action(api.proposals.send, { proposalId }))).toMatchObject(
      { code: "no_email", message: "The customer has no email address to send it to." },
    );
  });

  test("names every reason at once", async () => {
    const { owner, customer, site } = fixture();
    dor.mockImplementation(async () => new Response("down", { status: 503 }));
    const siteId = await site(await customer("not an email"));
    const proposalId = await owner.action(api.proposals.create, { siteId });
    expect(await refusal(owner.action(api.proposals.send, { proposalId }))).toMatchObject(
      { blockers: ["no_solutions", "no_tax_rate", "no_email"] },
    );
  });

  test("the panel is told the same reasons before Send is pressed", async () => {
    const { owner, read, sendable } = fixture();
    const { customerId, proposalId } = await sendable("");
    expect((await read(customerId, proposalId)).sendBlockers).toEqual(["no_email"]);
    await owner.mutation(api.proposals.update, { proposalId, solutionIds: [] });
    expect((await read(customerId, proposalId)).sendBlockers).toEqual([
      "no_solutions",
      "no_email",
    ]);
  });

  test("is not held up by the unknown L&I registration", async () => {
    const { owner, read, sendable } = fixture();
    expect(WashingtonNoticeToCustomer.text).toContain(Unknown);
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    expect((await read(customerId, proposalId)).state).toBe("sent");
  });

  test("sends only a draft", async () => {
    const { owner, sendable } = fixture();
    const { proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await expect(owner.action(api.proposals.send, { proposalId })).rejects.toThrow(
      /Only a draft proposal can be sent/,
    );
  });

  test("turns away anyone who is not the owner", async () => {
    const { t, stranger, sendable } = fixture();
    const { proposalId } = await sendable();
    await expect(stranger.action(api.proposals.send, { proposalId })).rejects.toThrow(
      /Owner access required/,
    );
    await expect(t.action(api.proposals.send, { proposalId })).rejects.toThrow(
      /Owner access required/,
    );
  });
});

describe("What Send freezes", () => {
  test("later edits to the solutions, customer and site change nothing the sent proposal shows", async () => {
    vi.setSystemTime(new Date("2026-09-23T17:00:00Z"));
    const { t, owner, read, liveToken, sendable } = fixture();
    const { customerId, siteId, solutionId, proposalId } = await sendable();
    await owner.mutation(api.proposals.update, { proposalId, notes: "Gate hardware extra." });
    await owner.action(api.proposals.send, { proposalId });
    const sentRow = await read(customerId, proposalId);
    const sentPaper = await owner.query(api.proposals.paper, { proposalId });

    vi.setSystemTime(new Date("2026-09-24T17:00:00Z"));
    await owner.mutation(api.solutions.update, {
      solutionId,
      title: "Rebuild gate",
      description: "A different scope.",
      lineItems: [{ name: "Lumber", quantity: 9, unitCostCents: 99_900, unit: "EA" }],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(customerId, { name: "Maria Renamed", email: "new@example.com" });
      // An address correction rebuilds the site name, and with it any live
      // Proposal ID.
      await ctx.db.patch(siteId, { name: "1302FRANKLIN", addressLine1: "1302 Franklin St" });
    });

    expect(await read(customerId, proposalId)).toMatchObject({
      code: "1300FRANKLIN-P1",
      title: "Fix gate",
      solutions: [{ solutionId, title: "Fix gate", priceCents: 55_000 }],
      money: sentRow.money,
      notes: "Gate hardware extra.",
      sentTo: "maria@example.com",
    });
    const paper = await owner.query(api.proposals.paper, { proposalId });
    expect(paper).toEqual(sentPaper);
    expect(paper).toMatchObject({
      code: "1300FRANKLIN-P1",
      sentAt: Date.parse("2026-09-23T17:00:00Z"),
      customerName: "Maria Delgado",
      site: { street: "1300 Franklin St", city: "Vancouver, WA 98660" },
      estimator: { name: "Andrew Putilin", email: "andrew@cogtex.ai" },
      solutions: [
        {
          title: "Fix gate",
          scopeOfWork: "Scope for Fix gate.",
          lineItems: [{ name: "Fix gate labor", quantity: 2, unit: "HR" }],
        },
      ],
      notes: "Gate hardware extra.",
      tax: { source: "lookup", rate: 0.089, locationCode: "0605" },
      // Two hours at $250 marked up 10%: $550, and 8.9% tax on it.
      subtotalCents: 55_000,
      taxCents: 4_895,
      totalCents: 59_895,
      depositPercent: 50,
    });
    expect(paper?.terms.length).toBe(11);
    // The customer's link shows the same frozen paper.
    const token = await liveToken(customerId, proposalId);
    expect(await t.query(api.signingLinks.paper, { token })).toEqual({
      ...sentPaper,
      unpricedSolutions: undefined,
    } as unknown as typeof sentPaper);
  });

  test("keeps no line item costs in the frozen offer", async () => {
    const { t, owner, sendable } = fixture();
    const { proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    const frozen = (await t.run((ctx) => ctx.db.get(proposalId)))?.frozen;
    expect(frozen?.solutions[0].lineItems).toEqual([
      { name: "Fix gate labor", quantity: 2, unit: "HR" },
    ]);
  });

  test("a sent proposal can no longer be edited or deleted", async () => {
    const { owner, sendable } = fixture();
    const { proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await expect(
      owner.mutation(api.proposals.update, { proposalId, notes: "Later" }),
    ).rejects.toThrow(/Only a draft/);
    await expect(owner.mutation(api.proposals.remove, { proposalId })).rejects.toThrow(
      /Only a draft/,
    );
  });
});

describe("Withdraw", () => {
  test("ends the link as withdrawn and returns a draft reading its live solutions", async () => {
    const { t, owner, read, liveToken, sendable, deliver } = fixture();
    const { customerId, solutionId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    const token = await liveToken(customerId, proposalId);
    resendCalls = [];

    await owner.mutation(api.proposals.withdraw, { proposalId });
    await deliver();

    // Nobody is emailed.
    expect(resendCalls).toEqual([]);
    await owner.mutation(api.solutions.update, {
      solutionId,
      lineItems: [{ name: "Lumber", quantity: 1, unitCostCents: 10_000 }],
    });
    const row = await read(customerId, proposalId);
    expect(row).toMatchObject({
      state: "draft",
      sentAt: null,
      sentTo: null,
      liveToken: null,
      solutions: [{ solutionId, priceCents: 11_000 }],
    });
    expect(row.links).toMatchObject([{ endedReason: "withdrawn" }]);
    expect(await t.query(api.signingLinks.resolve, { token })).toBe("ended");
    expect(await t.query(api.signingLinks.paper, { token })).toBeNull();
    const stored = await t.run((ctx) => ctx.db.get(proposalId));
    expect(stored?.frozen).toBeUndefined();
    expect(stored?.sentAt).toBeUndefined();
  });

  test("withdraws only a sent proposal", async () => {
    const { owner, sendable, stranger } = fixture();
    const { proposalId } = await sendable();
    await expect(owner.mutation(api.proposals.withdraw, { proposalId })).rejects.toThrow(
      /Only a sent proposal can be withdrawn/,
    );
    await owner.action(api.proposals.send, { proposalId });
    await expect(stranger.mutation(api.proposals.withdraw, { proposalId })).rejects.toThrow(
      /Owner access required/,
    );
  });

  test("a withdrawn proposal sent again freezes what it offers then", async () => {
    const { t, owner, read, sendable } = fixture();
    const { customerId, siteId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await owner.mutation(api.proposals.withdraw, { proposalId });
    await t.run((ctx) => ctx.db.patch(siteId, { name: "1302FRANKLIN" }));
    await owner.action(api.proposals.send, { proposalId });
    const row = await read(customerId, proposalId);
    expect(row.code).toBe("1302FRANKLIN-P1");
    expect(row.links.map((link) => link.endedReason)).toEqual([null, "withdrawn"]);
  });
});

describe("Re-send", () => {
  test("keeps the frozen offer, sends to the customer's current email, and ends the old link as resent", async () => {
    vi.setSystemTime(new Date("2026-09-23T17:00:00Z"));
    const { t, owner, read, liveToken, sendable, deliver } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    const first = await liveToken(customerId, proposalId);
    const paper = await owner.query(api.proposals.paper, { proposalId });

    vi.setSystemTime(new Date("2026-09-25T17:00:00Z"));
    await t.run((ctx) =>
      ctx.db.patch(customerId, { name: "Maria Renamed", email: "Maria.New@Example.com " }),
    );
    resendCalls = [];
    await owner.action(api.proposals.resend, { proposalId });
    await deliver();

    const row = await read(customerId, proposalId);
    const second = await liveToken(customerId, proposalId);
    expect(second).not.toBe(first);
    expect(row).toMatchObject({ state: "sent", sentTo: "maria.new@example.com" });
    expect(row.links).toMatchObject([
      {
        sentTo: "maria.new@example.com",
        sentAt: Date.parse("2026-09-25T17:00:00Z"),
        endedReason: null,
      },
      { sentTo: "maria@example.com", endedReason: "resent" },
    ]);
    // Nothing on the paper moves, not even the date it was sent.
    expect(await owner.query(api.proposals.paper, { proposalId })).toEqual(paper);
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0].body).toMatchObject({
      to: ["maria.new@example.com"],
      text: expect.stringContaining("Hello Maria Delgado,"),
    });
    expect(await t.query(api.signingLinks.resolve, { token: first })).toBe("ended");
    expect(await t.query(api.signingLinks.paper, { token: first })).toBeNull();
    expect(await t.query(api.signingLinks.resolve, { token: second })).toBe("proposal");
  });

  test("is refused when the customer no longer has an email", async () => {
    const { t, owner, read, sendable } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await t.run((ctx) => ctx.db.patch(customerId, { email: "" }));
    expect(await refusal(owner.action(api.proposals.resend, { proposalId }))).toMatchObject(
      { code: "no_email" },
    );
    expect((await read(customerId, proposalId)).links).toMatchObject([{ endedReason: null }]);
  });

  test("re-sends only a sent proposal, and only for the owner", async () => {
    const { owner, stranger, sendable } = fixture();
    const { proposalId } = await sendable();
    await expect(owner.action(api.proposals.resend, { proposalId })).rejects.toThrow(
      /Only a sent proposal can be re-sent/,
    );
    await owner.action(api.proposals.send, { proposalId });
    await expect(stranger.action(api.proposals.resend, { proposalId })).rejects.toThrow(
      /Owner access required/,
    );
  });
});

describe("The signing-link email", () => {
  test("goes through Resend with an idempotency key, tags, a User-Agent and no attachment", async () => {
    const { owner, read, liveToken, sendable, deliver } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    expect((await read(customerId, proposalId)).links[0].email).toBeNull();
    await deliver();

    const token = await liveToken(customerId, proposalId);
    const [link] = (await read(customerId, proposalId)).links;
    expect(resendCalls).toHaveLength(1);
    const [call] = resendCalls;
    expect(call.url).toBe("https://api.resend.com/emails");
    expect(call.headers).toMatchObject({
      authorization: "Bearer re_test",
      "content-type": "application/json",
      "idempotency-key": `signing-link/${link.linkId}`,
      "user-agent": expect.stringMatching(/^expand-handyman\//),
    });
    expect(call.body).toEqual({
      from: "Expand Handyman <proposals@expandhandyman.com>",
      to: ["maria@example.com"],
      reply_to: "contact@expandhandyman.com",
      subject: "Your Expand Handyman proposal for 1300 Franklin St",
      text: [
        "Hello Maria Delgado,",
        "",
        "Andrew Putilin at Expand Handyman has sent you a proposal for 1300 Franklin St, Vancouver, WA 98660: Fix gate, $598.95.",
        "",
        "Read it and approve or decline it here:",
        `https://staff.expandhandyman.com/sign/${token}`,
        "",
        "This link is yours alone. Reply to this email with any questions.",
      ].join("\n"),
      tags: [{ name: "letter", value: "signing_link" }],
    });
    expect(link.email).toEqual({ outcome: "sent", id: "resend-message-1" });
    // The link the panel copies is the one the email carried.
    expect((await read(customerId, proposalId)).liveUrl).toBe(
      `https://staff.expandhandyman.com/sign/${token}`,
    );
  });

  test("takes the From and Reply-To a deployment names", async () => {
    vi.stubEnv("EMAIL_FROM", "Expand Test <test@expandhandyman.com>");
    vi.stubEnv("EMAIL_REPLY_TO", "owner@example.com");
    const { owner, sendable, deliver } = fixture();
    const { proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    expect(resendCalls[0].body).toMatchObject({
      from: "Expand Test <test@expandhandyman.com>",
      reply_to: "owner@example.com",
    });
  });

  test("logs the letter and records notSent when there is no Resend key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("APP_ORIGIN", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { owner, read, liveToken, sendable, deliver } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    expect(resendCalls).toEqual([]);
    const token = await liveToken(customerId, proposalId);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`/sign/${token}`));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Subject: Your Expand Handyman proposal for 1300 Franklin St"),
    );
    expect((await read(customerId, proposalId)).links[0].email).toEqual({
      outcome: "notSent",
      reason: "noApiKey",
    });
  });

  test("records Resend's refusal, and the proposal stays Sent with its link to copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resend.mockImplementation(async () =>
      Response.json({ message: "The domain is not verified" }, { status: 403 }),
    );
    const { t, owner, read, sendable, deliver } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    const row = await read(customerId, proposalId);
    expect(row.state).toBe("sent");
    expect(row.links[0].email).toEqual({ outcome: "fault", fault: "HTTP_403" });
    expect(await t.query(api.signingLinks.resolve, { token: row.liveToken! })).toBe("proposal");
  });

  test("records a request that never reached Resend", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    resend.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const { owner, read, sendable, deliver } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    expect((await read(customerId, proposalId)).links[0].email).toEqual({
      outcome: "fault",
      fault: "REQUEST_FAILED",
    });
  });

  test("is a fault, not a send, when a deployment with a key names no app origin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("APP_ORIGIN", "");
    const { owner, read, sendable, deliver } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await deliver();
    expect(resendCalls).toEqual([]);
    expect((await read(customerId, proposalId)).links[0].email).toEqual({
      outcome: "fault",
      fault: "MISSING_APP_ORIGIN",
    });
  });
});

describe("/sign/<token>", () => {
  test("tells a document's token from a proposal's, and serves the document as before", async () => {
    const { t, owner, customer, liveToken, sendable } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    const proposalToken = await liveToken(customerId, proposalId);

    const documentToken = "d".repeat(64);
    const documentCustomerId = await customer("doc@example.com", "Doc Customer");
    const documentId = await t.run(async (ctx) =>
      ctx.db.insert("documents", {
        customerId: documentCustomerId,
        customerName: "Doc Customer",
        title: "Deck agreement",
        originalId: await ctx.storage.store(new Blob(["%PDF"])),
        originalHash: "hash",
        pageCount: 1,
        fields: [],
        status: "ready",
        token: documentToken,
        issuedAt: 0,
      }),
    );

    expect(await t.query(api.signingLinks.resolve, { token: documentToken })).toBe("document");
    expect(await t.query(api.documents.forSigner, { token: documentToken })).toMatchObject({
      _id: documentId,
      title: "Deck agreement",
    });
    expect(await t.query(api.signingLinks.paper, { token: documentToken })).toBeNull();

    expect(await t.query(api.signingLinks.resolve, { token: proposalToken })).toBe("proposal");
    expect(await t.query(api.documents.forSigner, { token: proposalToken })).toBeNull();
    expect(await t.query(api.signingLinks.paper, { token: proposalToken })).toMatchObject({
      code: "1300FRANKLIN-P1",
    });

    expect(await t.query(api.signingLinks.resolve, { token: "nothing-here" })).toBe("unknown");
    expect(await t.query(api.signingLinks.resolve, { token: "  " })).toBe("unknown");
  });
});

describe("Proposal views", () => {
  test("the customer's open is a view and marks the link Opened; the owner's is a preview", async () => {
    const { t, owner, read, liveToken, sendable } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    const token = await liveToken(customerId, proposalId);

    const previewId = await owner.mutation(api.signingLinks.opened, { token, userAgent: "Owner" });
    expect(await t.run((ctx) => ctx.db.get(previewId!))).toMatchObject({
      proposalId,
      token,
      viewer: "owner",
      proposalState: "sent",
    });
    expect((await read(customerId, proposalId)).opened).toBe(false);

    const viewId = await t.mutation(api.signingLinks.opened, { token, userAgent: "iPhone" });
    expect(await t.run((ctx) => ctx.db.get(viewId!))).toMatchObject({
      viewer: "customer",
      userAgent: "iPhone",
      viewedMs: 0,
    });
    expect((await read(customerId, proposalId)).opened).toBe(true);
  });

  test("Opened counts only the current link, and an ended link logs nothing", async () => {
    const { t, owner, read, liveToken, sendable } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    const first = await liveToken(customerId, proposalId);
    await t.mutation(api.signingLinks.opened, { token: first });
    expect((await read(customerId, proposalId)).opened).toBe(true);

    await owner.action(api.proposals.resend, { proposalId });
    expect((await read(customerId, proposalId)).opened).toBe(false);
    expect(await t.mutation(api.signingLinks.opened, { token: first })).toBeNull();
    await t.mutation(api.signingLinks.opened, { token: await liveToken(customerId, proposalId) });
    expect((await read(customerId, proposalId)).opened).toBe(true);
    expect(await t.mutation(api.signingLinks.opened, { token: "unknown" })).toBeNull();
  });

  test("the heartbeat and the close beacon count only visible time", async () => {
    vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
    const { t, owner, liveToken, sendable } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    const token = await liveToken(customerId, proposalId);
    const viewId = await t.mutation(api.signingLinks.opened, { token });

    vi.setSystemTime(new Date("2026-09-23T10:00:20Z"));
    await t.mutation(api.signingLinks.seen, { viewId: viewId!, token });
    // A tab hidden for an hour adds nothing.
    vi.setSystemTime(new Date("2026-09-23T11:00:20Z"));
    await t.mutation(api.signingLinks.seen, { viewId: viewId!, token });
    vi.setSystemTime(new Date("2026-09-23T11:00:40Z"));
    const res = await t.fetch("/seen", {
      method: "POST",
      body: JSON.stringify({ viewId, token, kind: "proposal" }),
    });
    expect(res.status).toBe(204);
    // Another token cannot move it.
    vi.setSystemTime(new Date("2026-09-23T11:00:50Z"));
    await t.mutation(api.signingLinks.seen, { viewId: viewId!, token: "other" });

    expect(await t.run((ctx) => ctx.db.get(viewId!))).toMatchObject({
      lastSeenAt: Date.parse("2026-09-23T11:00:40Z"),
      viewedMs: 40_000,
    });
  });

  test("a view's closing beacon still counts after its link is withdrawn", async () => {
    vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
    const { t, owner, liveToken, sendable } = fixture();
    const { customerId, proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    const token = await liveToken(customerId, proposalId);
    const viewId = await t.mutation(api.signingLinks.opened, { token });
    vi.setSystemTime(new Date("2026-09-23T10:00:15Z"));
    await owner.mutation(api.proposals.withdraw, { proposalId });
    // The page swaps to "no longer live" and sends what it had read.
    await t.fetch("/seen", {
      method: "POST",
      body: JSON.stringify({ viewId, token, kind: "proposal" }),
    });
    expect((await t.run((ctx) => ctx.db.get(viewId!)))?.viewedMs).toBe(15_000);
  });

  test("the staff paper writes nothing to the view log", async () => {
    const { t, owner, sendable } = fixture();
    const { proposalId } = await sendable();
    await owner.action(api.proposals.send, { proposalId });
    await owner.query(api.proposals.paper, { proposalId });
    expect(await t.run((ctx) => ctx.db.query("proposalViews").collect())).toEqual([]);
  });
});
