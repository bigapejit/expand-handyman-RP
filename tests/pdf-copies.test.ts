import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { BrowserTimeHeader } from "../lib/pdf-copy";
import { SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// The **PDF copy** (CONTEXT.md; ADR 0002): rendered only when someone presses
// Download, kept for as long as the proposal stays in that state, and reached
// by the renderer through a short-lived render pass rather than a signing link.
// Cloudflare, Resend and DOR are all stubbed at `fetch`.

// DOR's answer for a Vancouver address: 8.9% at location 0605.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj <<>> endobj\n");

// What Cloudflare does with each render request. The default prints the page;
// a test can swap it to refuse, or to look at the page while it is "open".
type Renderer = (request: { url: string; body: { url: string } }) => Promise<Response>;
const printPdf: Renderer = async () =>
  new Response(pdfBytes, {
    status: 200,
    headers: { "Content-Type": "application/pdf", [BrowserTimeHeader]: "9000" },
  });
let renderer: Renderer;
let renders: { url: string; body: { url: string } }[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 24, 3, 30));
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("APP_ORIGIN", "https://staff.expandhandyman.com");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct_42");
  vi.stubEnv("CLOUDFLARE_BROWSER_RENDERING_TOKEN", "cf_test_token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  renderer = printPdf;
  renders = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.cloudflare.com/")) {
      const request = { url, body: JSON.parse(String(init?.body)) };
      renders.push(request);
      return renderer(request);
    }
    if (url.startsWith("https://api.resend.com/")) return Response.json({ id: "resend-1" });
    return new Response(vancouverRate, { status: 200, headers: { "content-type": "text/xml" } });
  });
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
  const stranger = t.withIdentity({
    subject: "someone",
    email: "someone@example.com",
    emailVerified: true,
  });
  const deliver = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  // A sent proposal at 1300 Franklin St: one solution, two hours of labor.
  const sent = async () => {
    const customerId = await t.run((ctx) =>
      ctx.db.insert("customers", { name: "Maria Delgado", email: "maria@example.com", phone: "" }),
    );
    const siteId = await t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: "1300FRANKLIN",
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: "place-1300FRANKLIN",
        latitude: 45.63,
        longitude: -122.67,
        accessNotes: "",
        lastProposalNumber: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
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
    return { customerId, siteId, proposalId, token: await liveToken(customerId, proposalId) };
  };
  const liveToken = async (customerId: Id<"customers">, proposalId: Id<"proposals">) => {
    const tab = await owner.query(api.proposals.forCustomer, { customerId });
    const token = tab.proposals.find((p) => p.proposalId === proposalId)?.liveToken;
    if (!token) throw new Error("No live link.");
    return token;
  };
  const approve = (token: string) =>
    t.action(api.proposals.approve, {
      token,
      signerName: "Maria Delgado",
      consentTicked: true,
      noticeTicked: true,
      consentWordingVersion: SigningConsent.version,
      noticeWordingVersion: WashingtonNoticeToCustomer.version,
    });
  // Every file in Convex storage, and every render pass still standing.
  const storedFiles = () => t.run((ctx) => ctx.db.system.query("_storage").collect());
  const passes = () => t.run((ctx) => ctx.db.query("renderPasses").collect());
  return { t, owner, stranger, deliver, sent, liveToken, approve, storedFiles, passes };
}

// The pass the renderer was sent to, read off the URL Cloudflare was asked to
// open.
function passOf(request: { body: { url: string } }): string {
  const url = new URL(request.body.url);
  const match = /^\/paper\/([^/]+)$/.exec(url.pathname);
  if (!match) throw new Error(`Not a render pass: ${request.body.url}`);
  return match[1];
}

describe("the owner's Download", () => {
  test("renders a sent proposal once and hands over the stored file after", async () => {
    const { owner, sent, storedFiles } = fixture();
    const { proposalId } = await sent();

    expect(await owner.query(api.pdfCopies.downloadForOwner, { proposalId })).toBeNull();
    const first = await owner.action(api.pdfCopies.renderForOwner, { proposalId });
    expect(first).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Proposal 1300FRANKLIN-P1.pdf",
    });
    expect(renders).toHaveLength(1);
    expect(renders[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct_42/browser-rendering/pdf",
    );
    expect(renders[0].body.url).toMatch(
      /^https:\/\/staff\.expandhandyman\.com\/paper\/[A-Za-z0-9_-]{32,}\?footer=renderer$/,
    );

    const stored = await owner.query(api.pdfCopies.downloadForOwner, { proposalId });
    expect(stored).toEqual({
      url: first.outcome === "ready" ? first.url : null,
      filename: "Expand Handyman Proposal 1300FRANKLIN-P1.pdf",
    });
    // A later press renders nothing new.
    expect(await owner.action(api.pdfCopies.renderForOwner, { proposalId })).toMatchObject({
      outcome: "ready",
    });
    expect(renders).toHaveLength(1);
    expect(await storedFiles()).toHaveLength(1);
  });
});

describe("the render pass", () => {
  test("opens the paper for the render alone, and never as a view", async () => {
    const { t, owner, sent, passes } = fixture();
    const { proposalId } = await sent();
    let seen: unknown = undefined;
    renderer = async (request) => {
      // The renderer's browser, reading the page it was sent to.
      seen = await t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    await owner.action(api.pdfCopies.renderForOwner, { proposalId });

    expect(seen).toMatchObject({
      proposalId,
      code: "1300FRANKLIN-P1",
      state: "sent",
      customerName: "Maria Delgado",
    });
    // Used once: the render is over and the pass with it.
    expect(await t.query(api.pdfCopies.paper, { pass: passOf(renders[0]) })).toBeNull();
    expect(await passes()).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("proposalViews").collect())).toHaveLength(0);
  });

  test("is random for every render", async () => {
    const { owner, sent } = fixture();
    const first = await sent();
    const second = await sent();

    await owner.action(api.pdfCopies.renderForOwner, { proposalId: first.proposalId });
    await owner.action(api.pdfCopies.renderForOwner, { proposalId: second.proposalId });

    expect(passOf(renders[0])).not.toBe(passOf(renders[1]));
    expect(passOf(renders[0])).not.toBe(first.token);
  });

  test("stops opening the paper within minutes", async () => {
    const { t, owner, sent } = fixture();
    const { proposalId } = await sent();
    let seen: unknown = undefined;
    renderer = async (request) => {
      // The clock alone moves, so it is the pass's own expiry that answers
      // and not the scheduled clean-up.
      vi.setSystemTime(Date.now() + 5 * 60_000);
      seen = await t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    await owner.action(api.pdfCopies.renderForOwner, { proposalId });

    expect(seen).toBeNull();
  });

  test("opens only the state it was made for", async () => {
    const { t, owner, sent, approve, storedFiles } = fixture();
    const { proposalId, token } = await sent();
    let seen: unknown = undefined;
    renderer = async (request) => {
      // The customer signs while the offer is rendering.
      await approve(token);
      seen = await t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    const download = await owner.action(api.pdfCopies.renderForOwner, { proposalId });

    expect(seen).toBeNull();
    // The offer's file arrived after the offer had become a contract, and was
    // let go rather than handed out as the signed copy.
    expect(download).toEqual({
      outcome: "unavailable",
      reason: "This proposal changed while its PDF was being made. Press Download again.",
    });
    expect(await storedFiles()).toHaveLength(0);
  });

  test("is gone even when the render fails, and a 429 says so plainly", async () => {
    const { owner, sent, passes, storedFiles } = fixture();
    const { proposalId } = await sent();
    renderer = async () =>
      new Response(JSON.stringify({ success: false }), { status: 429 });

    const download = await owner.action(api.pdfCopies.renderForOwner, { proposalId });

    expect(download).toEqual({
      outcome: "unavailable",
      reason: "Too many PDFs have been made for now. Try again later.",
    });
    expect(await passes()).toHaveLength(0);
    expect(await storedFiles()).toHaveLength(0);
  });

  test("never outlives its minutes, even when the render never ends", async () => {
    const { t, deliver, sent, passes } = fixture();
    const { proposalId } = await sent();
    await t.mutation(internal.pdfCopies.mintRenderPass, {
      proposalId,
      token: "a".repeat(43),
    });
    expect(await passes()).toHaveLength(1);

    await deliver();

    expect(await passes()).toHaveLength(0);
  });
});

describe("which states keep a PDF copy", () => {
  // A sent proposal whose offer has already been downloaded once.
  async function downloaded(f: ReturnType<typeof fixture>) {
    const made = await f.sent();
    await f.owner.action(api.pdfCopies.renderForOwner, { proposalId: made.proposalId });
    expect(await f.storedFiles()).toHaveLength(1);
    return made;
  }

  test("a draft has none, and makes none", async () => {
    const f = fixture();
    const { proposalId } = await f.sent();
    await f.owner.mutation(api.proposals.withdraw, { proposalId });

    expect(await f.owner.action(api.pdfCopies.renderForOwner, { proposalId })).toEqual({
      outcome: "unavailable",
      reason: "Only a sent or approved proposal has a PDF.",
    });
    expect(renders).toHaveLength(0);
  });

  test("Withdraw lets the sent file go, and the next Send renders afresh", async () => {
    const f = fixture();
    const { proposalId } = await downloaded(f);

    await f.owner.mutation(api.proposals.withdraw, { proposalId });
    expect(await f.storedFiles()).toHaveLength(0);

    await f.owner.action(api.proposals.send, { proposalId });
    expect(await f.owner.query(api.pdfCopies.downloadForOwner, { proposalId })).toBeNull();
    await f.owner.action(api.pdfCopies.renderForOwner, { proposalId });
    expect(renders).toHaveLength(2);
  });

  test("Re-send lets the sent file go", async () => {
    const f = fixture();
    const { proposalId } = await downloaded(f);

    await f.owner.action(api.proposals.resend, { proposalId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.owner.query(api.pdfCopies.downloadForOwner, { proposalId })).toBeNull();
  });

  test("the owner's Decline lets the sent file go, and a declined proposal has none", async () => {
    const f = fixture();
    const { proposalId } = await downloaded(f);

    await f.owner.mutation(api.proposals.decline, { proposalId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.owner.action(api.pdfCopies.renderForOwner, { proposalId })).toMatchObject({
      outcome: "unavailable",
    });
    expect(renders).toHaveLength(1);
  });

  test("the customer's Decline lets the sent file go", async () => {
    const f = fixture();
    const { proposalId, token } = await downloaded(f);

    await f.t.mutation(api.proposals.declineFromLink, { token });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.owner.query(api.pdfCopies.downloadForOwner, { proposalId })).toBeNull();
  });

  test("Approve lets the sent file go, and the signed copy is made on its first download", async () => {
    const f = fixture();
    const { proposalId, token } = await downloaded(f);

    await f.approve(token);

    // The offer's file is not the signed copy, and is not kept beside it.
    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.owner.query(api.pdfCopies.downloadForOwner, { proposalId })).toBeNull();
    expect(await f.owner.action(api.pdfCopies.renderForOwner, { proposalId })).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Proposal 1300FRANKLIN-P1 (signed).pdf",
    });
    expect(await f.storedFiles()).toHaveLength(1);
  });

  test("the signed copy is never replaced, even by a press that raced the first", async () => {
    const f = fixture();
    const { proposalId, token } = await f.sent();
    await f.approve(token);
    // The customer presses Download while the owner's first render is still
    // printing: both find no file, and both render.
    let customerPress: Promise<unknown> | undefined;
    renderer = async (request) => {
      if (!customerPress)
        customerPress = f.t.action(api.pdfCopies.renderForCustomer, { token });
      else return printPdf(request);
      await customerPress;
      return printPdf(request);
    };

    const owners = await f.owner.action(api.pdfCopies.renderForOwner, { proposalId });

    expect(renders).toHaveLength(2);
    // The customer's render landed first and is the record; the owner's,
    // landing second, was let go, and both were handed the same file.
    expect(await customerPress).toEqual(owners);
    expect(await f.storedFiles()).toHaveLength(1);
    await f.owner.action(api.pdfCopies.renderForOwner, { proposalId });
    expect(renders).toHaveLength(2);
  });
});

describe("who may download", () => {
  test("only the owner, through the staff Download", async () => {
    const { stranger, t, sent } = fixture();
    const { proposalId } = await sent();

    await expect(stranger.query(api.pdfCopies.downloadForOwner, { proposalId })).rejects.toThrow(
      /Owner access required/,
    );
    await expect(t.action(api.pdfCopies.renderForOwner, { proposalId })).rejects.toThrow(
      /Owner access required/,
    );
    expect(renders).toHaveLength(0);
  });

  test("the customer, while their link opens the paper, and never as a view", async () => {
    const { t, owner, sent } = fixture();
    const { proposalId, token } = await sent();

    expect(await t.query(api.pdfCopies.downloadForCustomer, { token })).toBeNull();
    const rendered = await t.action(api.pdfCopies.renderForCustomer, { token });
    expect(rendered).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Proposal 1300FRANKLIN-P1.pdf",
    });
    // The same bytes the owner gets.
    expect(await t.query(api.pdfCopies.downloadForCustomer, { token })).toEqual(
      await owner.query(api.pdfCopies.downloadForOwner, { proposalId }),
    );
    expect(renders).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("proposalViews").collect())).toHaveLength(0);
  });

  test("the customer's signed copy, through the link that signed it", async () => {
    const { t, sent, approve } = fixture();
    const { token } = await sent();
    await approve(token);

    expect(await t.action(api.pdfCopies.renderForCustomer, { token })).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Proposal 1300FRANKLIN-P1 (signed).pdf",
    });
  });

  test("nothing for a replaced link, a withdrawn one, or one that names nothing", async () => {
    const { t, owner, sent, liveToken } = fixture();
    const replaced = await sent();
    await owner.action(api.pdfCopies.renderForOwner, { proposalId: replaced.proposalId });
    await owner.action(api.proposals.resend, { proposalId: replaced.proposalId });
    await owner.action(api.pdfCopies.renderForOwner, { proposalId: replaced.proposalId });
    // The new link has a file; the old one still gets nothing.
    expect(
      await t.query(api.pdfCopies.downloadForCustomer, {
        token: await liveToken(replaced.customerId, replaced.proposalId),
      }),
    ).not.toBeNull();
    const withdrawn = await sent();
    await owner.mutation(api.proposals.withdraw, { proposalId: withdrawn.proposalId });
    const rendersBefore = renders.length;

    for (const token of [replaced.token, withdrawn.token, "no-such-link"]) {
      expect(await t.query(api.pdfCopies.downloadForCustomer, { token })).toBeNull();
      expect(await t.action(api.pdfCopies.renderForCustomer, { token })).toEqual({
        outcome: "unavailable",
        reason: "This proposal is not available.",
      });
    }
    expect(renders).toHaveLength(rendersBefore);
  });

  test("nothing for a proposal the customer declined, though its link still reads", async () => {
    const { t, sent } = fixture();
    const { token } = await sent();
    await t.mutation(api.proposals.declineFromLink, { token, reason: "Too dear." });

    expect(await t.query(api.signingLinks.page, { token })).not.toBeNull();
    expect(await t.query(api.pdfCopies.downloadForCustomer, { token })).toBeNull();
    expect(await t.action(api.pdfCopies.renderForCustomer, { token })).toMatchObject({
      outcome: "unavailable",
    });
    expect(renders).toHaveLength(0);
  });

  test("a deployment without Cloudflare's credentials renders nothing and says so", async () => {
    vi.stubEnv("CLOUDFLARE_BROWSER_RENDERING_TOKEN", "");
    const { t, owner, sent, passes } = fixture();
    const { proposalId, token } = await sent();

    const said = {
      outcome: "unavailable",
      reason: "This deployment does not render PDFs.",
    };
    expect(await owner.action(api.pdfCopies.renderForOwner, { proposalId })).toEqual(said);
    expect(await t.action(api.pdfCopies.renderForCustomer, { token })).toEqual(said);
    expect(renders).toHaveLength(0);
    expect(await passes()).toHaveLength(0);
  });
});

describe("a proposal that moves while its PDF is being made", () => {
  test("a file of the withdrawn offer is never kept for the offer sent after it", async () => {
    const { t, owner, sent, storedFiles } = fixture();
    const { proposalId } = await sent();
    let seen: unknown = undefined;
    renderer = async (request) => {
      // Offer A is printing when the owner takes it back and sends offer B.
      await owner.mutation(api.proposals.withdraw, { proposalId });
      await owner.mutation(api.proposals.update, { proposalId, notes: "Offer B." });
      await owner.action(api.proposals.send, { proposalId });
      seen = await t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    const download = await owner.action(api.pdfCopies.renderForOwner, { proposalId });

    // A's pass never opens B's paper, and A's bytes are let go.
    expect(seen).toBeNull();
    expect(download).toMatchObject({ outcome: "unavailable" });
    expect(await storedFiles()).toHaveLength(0);
    expect(await owner.query(api.pdfCopies.downloadForOwner, { proposalId })).toBeNull();
  });

  test("a file rendered before a Re-send is not kept for the new link", async () => {
    const { owner, sent, storedFiles } = fixture();
    const { proposalId } = await sent();
    renderer = async (request) => {
      await owner.action(api.proposals.resend, { proposalId });
      return printPdf(request);
    };

    await owner.action(api.pdfCopies.renderForOwner, { proposalId });

    expect(await storedFiles()).toHaveLength(0);
  });

  test("a customer whose link is replaced mid-render is handed nothing", async () => {
    const { t, owner, sent } = fixture();
    const { proposalId, token } = await sent();
    renderer = async (request) => {
      await owner.action(api.proposals.resend, { proposalId });
      return printPdf(request);
    };

    expect(await t.action(api.pdfCopies.renderForCustomer, { token })).toEqual({
      outcome: "unavailable",
      reason: "This proposal is not available.",
    });
  });
});
