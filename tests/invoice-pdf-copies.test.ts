import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { BrowserTimeHeader, ProposalPaperReadySelector } from "../lib/pdf-copy";
import { SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// An invoice's **PDF copy** (CONTEXT.md; ADR 0002): rendered only when someone
// presses Download, kept while the invoice's paper stays sent, paid or void as
// it was printed, and reached by the renderer through a render pass bound to
// that paper state. Cloudflare, Resend and DOR are all stubbed at `fetch`.
// The proposal half is tests/pdf-copies.test.ts.

// DOR's answer for a Vancouver address: 8.9% at location 0605.
const vancouverRate = `<?xml version="1.0" encoding="utf-8"?><response loccode="0605" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="0605" street="FRANKLIN ST" househigh="1300" houselow="1300" evenodd="E" state="WA" zip="98660" plus4="2801" period="Q32026" rta="N" ptba="Clark PTBA" cez="" /><rate name="VANCOUVER" code="0605" staterate=".065" localrate=".024" /></response>`;

const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj <<>> endobj\n");

// What Cloudflare does with each render request. The default prints the page;
// a test can swap it to refuse, or to look at the page while it is "open".
type RenderRequest = {
  url: string;
  body: {
    url: string;
    waitForSelector: { selector: string };
    pdfOptions: { footerTemplate: string };
  };
};
type Renderer = (request: RenderRequest) => Promise<Response>;
const printPdf: Renderer = async () =>
  new Response(pdfBytes, {
    status: 200,
    headers: { "Content-Type": "application/pdf", [BrowserTimeHeader]: "9000" },
  });
let renderer: Renderer;
let renders: RenderRequest[];

// A moment in Pacific daylight time, UTC-7.
const pdt = (month: number, day: number, hour = 12) => Date.UTC(2026, month - 1, day, hour + 7);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(pdt(9, 1));
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
  let sites = 0;
  // A proposal at 1300 Franklin St, sent and approved by its customer, and the
  // deposit invoice Approve made and sent with it: INV-1001 for the first.
  const deposit = async () => {
    const customerId = await t.run((ctx) =>
      ctx.db.insert("customers", { name: "Maria Delgado", email: "maria@example.com", phone: "" }),
    );
    const siteId = await t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: `1300FRANKLIN${++sites}`,
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: `place-${sites}`,
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
    const signing = (await t.run((ctx) => ctx.db.query("signingLinks").collect())).find(
      (link) => link.proposalId === proposalId && link.endedAt === undefined,
    );
    if (!signing) throw new Error("No live signing link.");
    await t.action(api.proposals.approve, {
      token: signing.token,
      signerName: "Maria Delgado",
      consentTicked: true,
      noticeTicked: false,
      consentWordingVersion: SigningConsent.version,
      noticeWordingVersion: WashingtonNoticeToCustomer.version,
    });
    await deliver();
    const invoice = (await t.run((ctx) => ctx.db.query("invoices").collect())).find(
      (i) => i.proposalId === proposalId,
    );
    if (!invoice) throw new Error("No deposit invoice.");
    return { proposalId, invoiceId: invoice._id, token: await liveToken(invoice._id) };
  };
  const liveToken = async (invoiceId: Id<"invoices">) => {
    const link = (await t.run((ctx) => ctx.db.query("invoiceLinks").collect())).find(
      (l) => l.invoiceId === invoiceId && l.endedAt === undefined,
    );
    if (!link) throw new Error("No live invoice link.");
    return link.token;
  };
  const download = (invoiceId: Id<"invoices">) =>
    owner.action(api.pdfCopies.render, { paper: { invoiceId } });
  const stored = (invoiceId: Id<"invoices">) =>
    owner.query(api.pdfCopies.download, { paper: { invoiceId } });
  const copyOf = async (invoiceId: Id<"invoices">) =>
    (await t.run((ctx) => ctx.db.get(invoiceId)))?.pdfCopy ?? null;
  // Every file in Convex storage, and every render pass still standing.
  const storedFiles = () => t.run((ctx) => ctx.db.system.query("_storage").collect());
  const passes = () => t.run((ctx) => ctx.db.query("renderPasses").collect());
  return {
    t,
    owner,
    stranger,
    deliver,
    deposit,
    liveToken,
    download,
    stored,
    copyOf,
    storedFiles,
    passes,
  };
}

// The pass the renderer was sent to, read off the URL Cloudflare was asked to
// open.
function passOf(request: RenderRequest): string {
  const url = new URL(request.body.url);
  const match = /^\/paper\/([^/]+)$/.exec(url.pathname);
  if (!match) throw new Error(`Not a render pass: ${request.body.url}`);
  return match[1];
}

describe("the owner's Download", () => {
  test("renders a sent invoice once and hands over the stored file after", async () => {
    const { owner, deposit, download, stored, storedFiles } = fixture();
    const { invoiceId } = await deposit();

    expect(await stored(invoiceId)).toBeNull();
    const first = await download(invoiceId);
    expect(first).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Invoice INV-1001.pdf",
    });
    expect(renders).toHaveLength(1);
    expect(renders[0].body.url).toMatch(
      /^https:\/\/staff\.expandhandyman\.com\/paper\/[A-Za-z0-9_-]{32,}\?footer=renderer$/,
    );
    // It waits for the paper's ready mark, and foots every sheet with the
    // invoice number.
    expect(renders[0].body.waitForSelector.selector).toBe(ProposalPaperReadySelector);
    expect(renders[0].body.pdfOptions.footerTemplate).toContain("<span>INV-1001</span>");

    expect(await stored(invoiceId)).toEqual({
      url: first.outcome === "ready" ? first.url : null,
      filename: "Expand Handyman Invoice INV-1001.pdf",
    });
    // A later press renders nothing new.
    expect(await owner.action(api.pdfCopies.render, { paper: { invoiceId } })).toMatchObject(
      { outcome: "ready" },
    );
    expect(renders).toHaveLength(1);
    expect(await storedFiles()).toHaveLength(1);
  });

  test("a void invoice's file says so in its name", async () => {
    const { owner, deposit, download } = fixture();
    const { invoiceId } = await deposit();
    await owner.mutation(api.invoices.voidInvoice, { invoiceId });

    expect(await download(invoiceId)).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Invoice INV-1001 (void).pdf",
    });
  });

  test("a paid invoice's file is named as the sent one was", async () => {
    const { owner, deposit, download } = fixture();
    const { invoiceId } = await deposit();
    await owner.mutation(api.invoices.markPaid, { invoiceId });

    expect(await download(invoiceId)).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Invoice INV-1001.pdf",
    });
  });
});

describe("an invoice's render pass", () => {
  test("opens the invoice paper for the render alone, and logs nothing", async () => {
    const { t, deposit, download, passes } = fixture();
    const { invoiceId } = await deposit();
    const viewsBefore = await t.run((ctx) => ctx.db.query("proposalViews").collect());
    let seen: unknown = undefined;
    renderer = async (request) => {
      // The renderer's browser, reading the page it was sent to.
      seen = await t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    await download(invoiceId);

    expect(seen).toMatchObject({
      subject: "invoice",
      paper: {
        number: "INV-1001",
        customerName: "Maria Delgado",
        site: { street: "1300 Franklin St" },
        stamp: null,
      },
    });
    // Used once: the render is over and the pass with it.
    expect(await t.query(api.pdfCopies.paper, { pass: passOf(renders[0]) })).toBeNull();
    expect(await passes()).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("proposalViews").collect())).toEqual(viewsBefore);
  });

  test("carries the paper state it was made for, stamp and all", async () => {
    const { t, owner, deposit, download } = fixture();
    const { invoiceId } = await deposit();
    await owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-08-31" });
    let seen: unknown = undefined;
    renderer = async (request) => {
      const pass = (await t.run((ctx) => ctx.db.query("renderPasses").collect()))[0];
      expect(pass).toMatchObject({ invoiceId, paperState: "paid", stampDay: "2026-08-31" });
      seen = await t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    await download(invoiceId);

    expect(seen).toMatchObject({
      subject: "invoice",
      paper: { stamp: { kind: "paid", day: "2026-08-31" } },
    });
  });

  test("is random for every render", async () => {
    const { deposit, download } = fixture();
    const first = await deposit();
    const second = await deposit();

    await download(first.invoiceId);
    await download(second.invoiceId);

    expect(passOf(renders[0])).not.toBe(passOf(renders[1]));
    expect(passOf(renders[0])).not.toBe(first.token);
  });

  test("stops opening the paper within minutes", async () => {
    const { t, deposit, download } = fixture();
    const { invoiceId } = await deposit();
    let seen: unknown = undefined;
    renderer = async (request) => {
      vi.setSystemTime(Date.now() + 5 * 60_000);
      seen = await t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    await download(invoiceId);

    expect(seen).toBeNull();
  });

  test("opens only the paper state it was made for", async () => {
    const { t, owner, deposit, download, storedFiles } = fixture();
    const { invoiceId } = await deposit();
    let seen: unknown = undefined;
    renderer = async (request) => {
      // The owner marks it paid while the unstamped paper is rendering.
      await owner.mutation(api.invoices.markPaid, { invoiceId });
      seen = await t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    const answer = await download(invoiceId);

    expect(seen).toBeNull();
    expect(answer).toEqual({
      outcome: "unavailable",
      reason: "This invoice changed while its PDF was being made. Press Download again.",
    });
    expect(await storedFiles()).toHaveLength(0);
  });

  test("never keeps a paid paper whose day changed while it printed", async () => {
    const { owner, deposit, download, storedFiles, copyOf } = fixture();
    const { invoiceId } = await deposit();
    await owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-08-30" });
    renderer = async (request) => {
      // Paid on the 30th is printing when the owner corrects it to the 31st:
      // paid before and paid after, but not the same sheet.
      await owner.mutation(api.invoices.markUnpaid, { invoiceId });
      await owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-08-31" });
      return printPdf(request);
    };

    expect(await download(invoiceId)).toMatchObject({ outcome: "unavailable" });
    expect(await storedFiles()).toHaveLength(0);
    expect(await copyOf(invoiceId)).toBeNull();
  });

  test("a file that lands after a Re-send is still the paper, and is kept", async () => {
    const { owner, deposit, download, copyOf } = fixture();
    const { invoiceId } = await deposit();
    renderer = async (request) => {
      // Re-send changes where the invoice went, never the sheet.
      await owner.action(api.invoices.resend, { invoiceId });
      return printPdf(request);
    };

    expect(await download(invoiceId)).toMatchObject({ outcome: "ready" });
    expect(await copyOf(invoiceId)).toMatchObject({ paperState: "sent" });
  });

  test("is gone even when the render fails, and a 429 says so plainly", async () => {
    const { deposit, download, passes, storedFiles } = fixture();
    const { invoiceId } = await deposit();
    renderer = async () => new Response(JSON.stringify({ success: false }), { status: 429 });

    expect(await download(invoiceId)).toEqual({
      outcome: "unavailable",
      reason: "Too many PDFs have been made for now. Try again later.",
    });
    expect(await passes()).toHaveLength(0);
    expect(await storedFiles()).toHaveLength(0);
  });

  test("never outlives its minutes, even when the render never ends", async () => {
    const { t, deliver, deposit, passes } = fixture();
    const { invoiceId } = await deposit();
    await t.mutation(internal.pdfCopies.mintRenderPass, {
      paper: { invoiceId },
      token: "a".repeat(43),
    });
    expect(await passes()).toHaveLength(1);

    await deliver();

    expect(await passes()).toHaveLength(0);
  });
});

describe("which invoices keep a PDF copy", () => {
  // A deposit invoice whose paper has already been downloaded once.
  async function downloaded(f: ReturnType<typeof fixture>) {
    const made = await f.deposit();
    await f.download(made.invoiceId);
    expect(await f.storedFiles()).toHaveLength(1);
    return made;
  }

  test("a draft has none, and makes none", async () => {
    const { owner, deposit, download, passes } = fixture();
    const { proposalId } = await deposit();
    const draftId = await owner.mutation(api.invoices.createTyped, { proposalId });

    expect(await download(draftId)).toEqual({
      outcome: "unavailable",
      reason: "Only a sent or void invoice has a PDF.",
    });
    expect(await owner.query(api.pdfCopies.download, { paper: { invoiceId: draftId } }))
      .toBeNull();
    expect(renders).toHaveLength(0);
    expect(await passes()).toHaveLength(0);
  });

  test("the stored copy records the paper state it printed", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);

    expect(await f.copyOf(invoiceId)).toMatchObject({ paperState: "sent" });
  });

  test("Mark paid lets the sent file go, and the next Download prints the stamp", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);

    await f.owner.mutation(api.invoices.markPaid, { invoiceId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored(invoiceId)).toBeNull();
    await f.download(invoiceId);
    expect(renders).toHaveLength(2);
    expect(await f.copyOf(invoiceId)).toMatchObject({ paperState: "paid" });
  });

  test("Mark unpaid lets the paid file go", async () => {
    const f = fixture();
    const { invoiceId } = await f.deposit();
    await f.owner.mutation(api.invoices.markPaid, { invoiceId });
    await f.download(invoiceId);
    expect(await f.storedFiles()).toHaveLength(1);

    await f.owner.mutation(api.invoices.markUnpaid, { invoiceId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored(invoiceId)).toBeNull();
  });

  test("Void lets the sent file go, and the void one is its own", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);

    await f.owner.mutation(api.invoices.voidInvoice, { invoiceId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored(invoiceId)).toBeNull();
    await f.download(invoiceId);
    expect(await f.copyOf(invoiceId)).toMatchObject({ paperState: "void" });
    expect(await f.stored(invoiceId)).toMatchObject({
      filename: "Expand Handyman Invoice INV-1001 (void).pdf",
    });
  });

  test("Re-send lets the file go", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);

    await f.owner.action(api.invoices.resend, { invoiceId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored(invoiceId)).toBeNull();
  });

  test("a file is handed out only while the invoice is in the paper state it printed", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);
    // A payment that reached the table some other way than Mark paid, which
    // would have let the file go: the sent paper is still not the paid one.
    await f.t.run((ctx) =>
      ctx.db.insert("payments", {
        invoiceId,
        receivedOn: "2026-09-01",
        source: "owner",
        recordedBy: "owner",
        recordedAt: Date.now(),
      }),
    );

    expect(await f.stored(invoiceId)).toBeNull();
  });
});

describe("who may download an invoice", () => {
  test("only the owner, through the staff Download", async () => {
    const { t, stranger, deposit } = fixture();
    const { invoiceId } = await deposit();

    await expect(
      stranger.query(api.pdfCopies.download, { paper: { invoiceId } }),
    ).rejects.toThrow(/Owner access required/);
    await expect(t.action(api.pdfCopies.render, { paper: { invoiceId } })).rejects.toThrow(
      /Owner access required/,
    );
    expect(renders).toHaveLength(0);
  });

  test("the customer, while their link opens the paper, and never logged", async () => {
    const { t, deposit, stored } = fixture();
    const { invoiceId, token } = await deposit();
    const viewsBefore = await t.run((ctx) => ctx.db.query("proposalViews").collect());

    expect(await t.query(api.pdfCopies.download, { paper: { invoiceToken: token } })).toBeNull();
    expect(await t.action(api.pdfCopies.render, { paper: { invoiceToken: token } })).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Invoice INV-1001.pdf",
    });
    // The same bytes the owner gets.
    expect(await t.query(api.pdfCopies.download, { paper: { invoiceToken: token } })).toEqual(
      await stored(invoiceId),
    );
    expect(renders).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("proposalViews").collect())).toEqual(viewsBefore);
  });

  test("the customer's void invoice, through the link Void kept", async () => {
    const { t, owner, deposit } = fixture();
    const { invoiceId, token } = await deposit();
    await owner.mutation(api.invoices.voidInvoice, { invoiceId });

    expect(await t.action(api.pdfCopies.render, { paper: { invoiceToken: token } })).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Invoice INV-1001 (void).pdf",
    });
  });

  test("nothing for a replaced link, a signing link, or one that names nothing", async () => {
    const { t, owner, deposit, download, liveToken } = fixture();
    const { invoiceId, token: replaced } = await deposit();
    await owner.action(api.invoices.resend, { invoiceId });
    await download(invoiceId);
    // The new link has the file; the old one still gets nothing.
    expect(
      await t.query(api.pdfCopies.download, {
        paper: { invoiceToken: await liveToken(invoiceId) },
      }),
    ).not.toBeNull();
    const signing = (await t.run((ctx) => ctx.db.query("signingLinks").collect()))[0].token;
    const rendersBefore = renders.length;

    for (const token of [replaced, signing, "no-such-link"]) {
      expect(await t.query(api.pdfCopies.download, { paper: { invoiceToken: token } })).toBeNull();
      expect(await t.action(api.pdfCopies.render, { paper: { invoiceToken: token } })).toEqual({
        outcome: "unavailable",
        reason: "This invoice is not available.",
      });
    }
    expect(renders).toHaveLength(rendersBefore);
  });

  test("a customer whose link is replaced mid-render is handed nothing", async () => {
    const { t, owner, deposit } = fixture();
    const { invoiceId, token } = await deposit();
    renderer = async (request) => {
      await owner.action(api.invoices.resend, { invoiceId });
      return printPdf(request);
    };

    expect(await t.action(api.pdfCopies.render, { paper: { invoiceToken: token } })).toEqual({
      outcome: "unavailable",
      reason: "This invoice is not available.",
    });
  });

  test("a deployment without Cloudflare's credentials renders nothing and says so", async () => {
    vi.stubEnv("CLOUDFLARE_BROWSER_RENDERING_TOKEN", "");
    const { t, deposit, download, passes } = fixture();
    const { invoiceId, token } = await deposit();

    const said = { outcome: "unavailable", reason: "This deployment does not render PDFs." };
    expect(await download(invoiceId)).toEqual(said);
    expect(await t.action(api.pdfCopies.render, { paper: { invoiceToken: token } })).toEqual(said);
    expect(renders).toHaveLength(0);
    expect(await passes()).toHaveLength(0);
  });
});
