import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { PdfPaperId, PdfPaperRef } from "../convex/pdfCopyFiles";
import { WashingtonNoticeToCustomer } from "../lib/expand-business";
import { BrowserTimeHeader, ProposalPaperReadySelector } from "../lib/pdf-copy";
import { SigningConsent } from "../lib/proposal-signing";

const modules = import.meta.glob("../convex/**/*.ts");

// The **PDF copy** (CONTEXT.md; ADR 0002): rendered only when someone presses
// Download, kept while the paper stays on the sheet it printed, and reached by
// the renderer through a short-lived **Render pass** rather than a signing or
// invoice link. One module serves both papers, so the rules they share run
// once over each paper's adapter, a sent proposal and a deposit invoice, and
// what only one paper does follows in its own describe. Cloudflare, Resend and
// DOR are all stubbed at `fetch`.

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
  // A sent proposal at 1300 Franklin St: one solution, two hours of labor.
  // Every one is 1300FRANKLIN-P1, on a site of its own of the same name.
  const sent = async (siteName = "1300FRANKLIN") => {
    const customerId = await t.run((ctx) =>
      ctx.db.insert("customers", { name: "Maria Delgado", email: "maria@example.com", phone: "" }),
    );
    const siteId = await t.run((ctx) =>
      ctx.db.insert("sites", {
        customerId,
        name: siteName,
        addressLine1: "1300 Franklin St",
        addressLine2: "",
        city: "Vancouver",
        region: "WA",
        postalCode: "98660",
        placeId: `place-${++sites}`,
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
    return { proposalId, token: await liveSigningToken(proposalId) };
  };
  // That proposal, approved by its customer, and the deposit invoice Approve
  // made and sent with it: INV-1001 for the first.
  const deposit = async () => {
    const { proposalId, token: signingToken } = await sent(`1300FRANKLIN${sites + 1}`);
    await t.action(api.proposals.approve, {
      token: signingToken,
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
    return { proposalId, invoiceId: invoice._id, token: await liveInvoiceToken(invoice._id) };
  };
  const liveSigningToken = async (proposalId: Id<"proposals">) => {
    const link = (await t.run((ctx) => ctx.db.query("signingLinks").collect())).find(
      (l) => l.proposalId === proposalId && l.endedAt === undefined,
    );
    if (!link) throw new Error("No live signing link.");
    return link.token;
  };
  const liveInvoiceToken = async (invoiceId: Id<"invoices">) => {
    const link = (await t.run((ctx) => ctx.db.query("invoiceLinks").collect())).find(
      (l) => l.invoiceId === invoiceId && l.endedAt === undefined,
    );
    if (!link) throw new Error("No live invoice link.");
    return link.token;
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
  // The owner's press and the owner's read of the stored file.
  const render = (paper: PdfPaperRef) => owner.action(api.pdfCopies.render, { paper });
  const stored = (paper: PdfPaperRef) => owner.query(api.pdfCopies.download, { paper });
  // What the row says it holds.
  const copyOf = (id: PdfPaperId) =>
    t.run(
      async (ctx) =>
        ("proposalId" in id ? await ctx.db.get(id.proposalId) : await ctx.db.get(id.invoiceId))
          ?.pdfCopy ?? null,
    );
  // Every file in Convex storage, every render pass still standing, every
  // view logged, and everything scheduled.
  const storedFiles = () => t.run((ctx) => ctx.db.system.query("_storage").collect());
  const passes = () => t.run((ctx) => ctx.db.query("renderPasses").collect());
  const views = () => t.run((ctx) => ctx.db.query("proposalViews").collect());
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return {
    t,
    owner,
    stranger,
    deliver,
    sent,
    deposit,
    liveSigningToken,
    liveInvoiceToken,
    approve,
    render,
    stored,
    copyOf,
    storedFiles,
    passes,
    views,
    scheduled,
  };
}
type Fixture = ReturnType<typeof fixture>;

// The pass the renderer was sent to, read off the URL Cloudflare was asked to
// open.
function passOf(request: RenderRequest): string {
  const url = new URL(request.body.url);
  const match = /^\/paper\/([^/]+)$/.exec(url.pathname);
  if (!match) throw new Error(`Not a render pass: ${request.body.url}`);
  return match[1];
}

// One paper made for a test: what the owner names it by, what its customer
// names it by, and the token of the link the customer holds.
type Made = { id: PdfPaperId; customer: PdfPaperRef; token: string };

function proposalOf(made: Made): Id<"proposals"> {
  if (!("proposalId" in made.id)) throw new Error("Not a proposal.");
  return made.id.proposalId;
}

function invoiceOf(made: Made): Id<"invoices"> {
  if (!("invoiceId" in made.id)) throw new Error("Not an invoice.");
  return made.id.invoiceId;
}

// What the shared rules need to know of one paper's adapter.
type Subject = {
  name: "proposal" | "invoice";
  make: (f: Fixture) => Promise<Made>;
  filename: string;
  // What every sheet is footed with.
  code: string;
  // What the renderer should be shown through the pass.
  seen: (made: Made) => object;
  // A move off the sheet being printed.
  moveOff: (f: Fixture, made: Made) => Promise<unknown>;
  // A paper of this kind with no PDF copy to make.
  noCopy: (f: Fixture) => Promise<PdfPaperId>;
  resend: (f: Fixture, made: Made) => Promise<unknown>;
  // Refs a customer might hold that open nothing, each made dead its own way.
  deadRefs: (f: Fixture, made: Made) => Promise<PdfPaperRef[]>;
  reasons: { gone: string; none: string; changed: string };
  // Whether a Re-send leaves the sheet as it was, so a file of it that lands
  // afterwards is still the paper; and what the row then says it holds.
  keptAcrossResend: boolean;
  sentCopy: object;
};

const proposalSubject: Subject = {
  name: "proposal",
  make: async (f) => {
    const { proposalId, token } = await f.sent();
    return { id: { proposalId }, customer: { signingToken: token }, token };
  },
  filename: "Expand Handyman Proposal 1300FRANKLIN-P1.pdf",
  code: "1300FRANKLIN-P1",
  seen: (made) => ({
    subject: "proposal",
    paper: {
      proposalId: proposalOf(made),
      code: "1300FRANKLIN-P1",
      state: "sent",
      customerName: "Maria Delgado",
    },
  }),
  // The customer signs while the offer is printing.
  moveOff: (f, made) => f.approve(made.token),
  noCopy: async (f) => {
    const { proposalId } = await f.sent();
    await f.owner.mutation(api.proposals.withdraw, { proposalId });
    return { proposalId };
  },
  resend: (f, made) => f.owner.action(api.proposals.resend, { proposalId: proposalOf(made) }),
  deadRefs: async (f, made) => {
    const proposalId = proposalOf(made);
    await f.render(made.id);
    await f.owner.action(api.proposals.resend, { proposalId });
    await f.render(made.id);
    // The new link has a file; the old one still gets nothing.
    expect(
      await f.t.query(api.pdfCopies.download, {
        paper: { signingToken: await f.liveSigningToken(proposalId) },
      }),
    ).not.toBeNull();
    const withdrawn = await f.sent();
    await f.owner.mutation(api.proposals.withdraw, { proposalId: withdrawn.proposalId });
    return [made.token, withdrawn.token, "no-such-link"].map((signingToken) => ({ signingToken }));
  },
  reasons: {
    gone: "This proposal is not available.",
    none: "Only a sent or approved proposal has a PDF.",
    changed: "This proposal changed while its PDF was being made. Press Download again.",
  },
  // A Re-send mints a new signing link, and the sheet names its link.
  keptAcrossResend: false,
  sentCopy: { state: "sent" },
};

const invoiceSubject: Subject = {
  name: "invoice",
  make: async (f) => {
    const { invoiceId, token } = await f.deposit();
    return { id: { invoiceId }, customer: { invoiceToken: token }, token };
  },
  filename: "Expand Handyman Invoice INV-1001.pdf",
  code: "INV-1001",
  seen: () => ({
    subject: "invoice",
    paper: {
      number: "INV-1001",
      customerName: "Maria Delgado",
      site: { street: "1300 Franklin St" },
      stamp: null,
    },
  }),
  // The owner marks it paid while the unstamped paper is printing.
  moveOff: (f, made) => f.owner.mutation(api.invoices.markPaid, { invoiceId: invoiceOf(made) }),
  noCopy: async (f) => {
    const { proposalId } = await f.deposit();
    return { invoiceId: await f.owner.mutation(api.invoices.createTyped, { proposalId }) };
  },
  resend: (f, made) => f.owner.action(api.invoices.resend, { invoiceId: invoiceOf(made) }),
  deadRefs: async (f, made) => {
    const invoiceId = invoiceOf(made);
    await f.owner.action(api.invoices.resend, { invoiceId });
    await f.render(made.id);
    // The new link has the file; the old one still gets nothing.
    expect(
      await f.t.query(api.pdfCopies.download, {
        paper: { invoiceToken: await f.liveInvoiceToken(invoiceId) },
      }),
    ).not.toBeNull();
    // A signing link's token opens no invoice.
    const signing = (await f.t.run((ctx) => ctx.db.query("signingLinks").collect()))[0].token;
    return [made.token, signing, "no-such-link"].map((invoiceToken) => ({ invoiceToken }));
  },
  reasons: {
    gone: "This invoice is not available.",
    none: "Only a sent or void invoice has a PDF.",
    changed: "This invoice changed while its PDF was being made. Press Download again.",
  },
  // Re-send changes where the invoice went, never the sheet.
  keptAcrossResend: true,
  sentCopy: { paperState: "sent" },
};

describe.each([
  ["a proposal", proposalSubject],
  ["an invoice", invoiceSubject],
] as const)("%s's PDF copy", (_, s) => {
  // A paper whose file has already been made once.
  async function downloaded(f: Fixture) {
    const made = await s.make(f);
    await f.render(made.id);
    expect(await f.storedFiles()).toHaveLength(1);
    return made;
  }

  describe("the owner's Download", () => {
    test("renders once and hands over the stored file after", async () => {
      const f = fixture();
      const made = await s.make(f);

      expect(await f.stored(made.id)).toBeNull();
      const first = await f.render(made.id);
      expect(first).toMatchObject({ outcome: "ready", filename: s.filename });
      expect(renders).toHaveLength(1);
      expect(renders[0].url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/acct_42/browser-rendering/pdf",
      );
      expect(renders[0].body.url).toMatch(
        /^https:\/\/staff\.expandhandyman\.com\/paper\/[A-Za-z0-9_-]{32,}\?footer=renderer$/,
      );
      // It waits for the paper's ready mark, and foots every sheet with the
      // paper's own code.
      expect(renders[0].body.waitForSelector.selector).toBe(ProposalPaperReadySelector);
      expect(renders[0].body.pdfOptions.footerTemplate).toContain(`<span>${s.code}</span>`);

      expect(await f.stored(made.id)).toEqual({
        url: first.outcome === "ready" ? first.url : null,
        filename: s.filename,
      });
      // A later press renders nothing new.
      expect(await f.render(made.id)).toMatchObject({ outcome: "ready" });
      expect(renders).toHaveLength(1);
      expect(await f.storedFiles()).toHaveLength(1);
    });

    test("a press that finds the stored file renders nothing and mints no pass", async () => {
      const f = fixture();
      const made = await downloaded(f);
      const scheduledBefore = (await f.scheduled()).length;
      // Even a deployment that does not render hands over what it holds, as
      // the stored-file read beside the button already does.
      vi.stubEnv("CLOUDFLARE_BROWSER_RENDERING_TOKEN", "");

      expect(await f.render(made.id)).toMatchObject({ outcome: "ready", filename: s.filename });
      expect(renders).toHaveLength(1);
      expect(await f.passes()).toHaveLength(0);
      // Minting a pass schedules its drop; nothing new was scheduled.
      expect(await f.scheduled()).toHaveLength(scheduledBefore);
    });
  });

  describe("the render pass", () => {
    test("opens the paper for the render alone, and never as a view", async () => {
      const f = fixture();
      const made = await s.make(f);
      const viewsBefore = await f.views();
      let seen: unknown = undefined;
      renderer = async (request) => {
        // The renderer's browser, reading the page it was sent to.
        seen = await f.t.query(api.pdfCopies.paper, { pass: passOf(request) });
        return printPdf(request);
      };

      await f.render(made.id);

      expect(seen).toMatchObject(s.seen(made));
      // Used once: the render is over and the pass with it.
      expect(await f.t.query(api.pdfCopies.paper, { pass: passOf(renders[0]) })).toBeNull();
      expect(await f.passes()).toHaveLength(0);
      expect(await f.views()).toEqual(viewsBefore);
    });

    test("is random for every render, and never the link's token", async () => {
      const f = fixture();
      const first = await s.make(f);
      const second = await s.make(f);

      await f.render(first.id);
      await f.render(second.id);

      expect(passOf(renders[0])).not.toBe(passOf(renders[1]));
      expect(passOf(renders[0])).not.toBe(first.token);
    });

    test("stops opening the paper within minutes", async () => {
      const f = fixture();
      const made = await s.make(f);
      let seen: unknown = undefined;
      renderer = async (request) => {
        // The clock alone moves, so it is the pass's own expiry that answers
        // and not the scheduled clean-up.
        vi.setSystemTime(Date.now() + 5 * 60_000);
        seen = await f.t.query(api.pdfCopies.paper, { pass: passOf(request) });
        return printPdf(request);
      };

      await f.render(made.id);

      expect(seen).toBeNull();
    });

    test("opens only the sheet it was made for", async () => {
      const f = fixture();
      const made = await s.make(f);
      let seen: unknown = undefined;
      renderer = async (request) => {
        await s.moveOff(f, made);
        seen = await f.t.query(api.pdfCopies.paper, { pass: passOf(request) });
        return printPdf(request);
      };

      const answer = await f.render(made.id);

      expect(seen).toBeNull();
      // The file arrived after the paper had moved, and was let go rather than
      // handed out as the paper it now is.
      expect(answer).toEqual({ outcome: "unavailable", reason: s.reasons.changed });
      expect(await f.storedFiles()).toHaveLength(0);
    });

    test("is gone even when the render fails, and a 429 says so plainly", async () => {
      const f = fixture();
      const made = await s.make(f);
      renderer = async () => new Response(JSON.stringify({ success: false }), { status: 429 });

      expect(await f.render(made.id)).toEqual({
        outcome: "unavailable",
        reason: "Too many PDFs have been made for now. Try again later.",
      });
      expect(await f.passes()).toHaveLength(0);
      expect(await f.storedFiles()).toHaveLength(0);
    });

    test("never outlives its minutes, even when the render never ends", async () => {
      const f = fixture();
      const made = await s.make(f);
      await f.t.mutation(internal.pdfCopies.mintRenderPass, {
        paper: made.id,
        token: "a".repeat(43),
      });
      expect(await f.passes()).toHaveLength(1);

      await f.deliver();

      expect(await f.passes()).toHaveLength(0);
    });
  });

  describe("which papers keep a PDF copy", () => {
    test("one with no PDF copy has none, and makes none", async () => {
      const f = fixture();
      const id = await s.noCopy(f);

      expect(await f.render(id)).toEqual({ outcome: "unavailable", reason: s.reasons.none });
      expect(await f.stored(id)).toBeNull();
      expect(renders).toHaveLength(0);
      expect(await f.passes()).toHaveLength(0);
    });

    test("Re-send lets the stored file go", async () => {
      const f = fixture();
      const made = await downloaded(f);

      await s.resend(f, made);

      expect(await f.storedFiles()).toHaveLength(0);
      expect(await f.stored(made.id)).toBeNull();
    });

    // The one rule the two papers answer differently: a proposal's sheet
    // names its signing link, which a Re-send replaces, and an invoice's does
    // not name its link at all.
    test("a file that lands after a Re-send is kept only if the sheet is unchanged", async () => {
      const f = fixture();
      const made = await s.make(f);
      renderer = async (request) => {
        await s.resend(f, made);
        return printPdf(request);
      };

      const answer = await f.render(made.id);

      if (s.keptAcrossResend) {
        expect(answer).toMatchObject({ outcome: "ready", filename: s.filename });
        expect(await f.copyOf(made.id)).toMatchObject(s.sentCopy);
        expect(await f.storedFiles()).toHaveLength(1);
      } else {
        expect(answer).toEqual({ outcome: "unavailable", reason: s.reasons.changed });
        expect(await f.copyOf(made.id)).toBeNull();
        expect(await f.storedFiles()).toHaveLength(0);
      }
    });
  });

  describe("who may download", () => {
    test("only the owner, through the staff Download", async () => {
      const f = fixture();
      const made = await s.make(f);

      await expect(
        f.stranger.query(api.pdfCopies.download, { paper: made.id }),
      ).rejects.toThrow(/Owner access required/);
      await expect(f.t.action(api.pdfCopies.render, { paper: made.id })).rejects.toThrow(
        /Owner access required/,
      );
      expect(renders).toHaveLength(0);
    });

    test("the customer, while their link opens the paper, and never as a view", async () => {
      const f = fixture();
      const made = await s.make(f);
      const viewsBefore = await f.views();

      expect(await f.t.query(api.pdfCopies.download, { paper: made.customer })).toBeNull();
      expect(await f.t.action(api.pdfCopies.render, { paper: made.customer })).toMatchObject({
        outcome: "ready",
        filename: s.filename,
      });
      // The same bytes the owner gets.
      expect(await f.t.query(api.pdfCopies.download, { paper: made.customer })).toEqual(
        await f.stored(made.id),
      );
      expect(renders).toHaveLength(1);
      expect(await f.views()).toEqual(viewsBefore);
    });

    test("nothing for a link that no longer opens the paper, or names nothing", async () => {
      const f = fixture();
      const made = await s.make(f);
      const dead = await s.deadRefs(f, made);
      const rendersBefore = renders.length;

      for (const paper of dead) {
        expect(await f.t.query(api.pdfCopies.download, { paper })).toBeNull();
        expect(await f.t.action(api.pdfCopies.render, { paper })).toEqual({
          outcome: "unavailable",
          reason: s.reasons.gone,
        });
      }
      expect(renders).toHaveLength(rendersBefore);
    });

    test("a customer whose link is replaced mid-render is handed nothing", async () => {
      const f = fixture();
      const made = await s.make(f);
      renderer = async (request) => {
        await s.resend(f, made);
        return printPdf(request);
      };

      expect(await f.t.action(api.pdfCopies.render, { paper: made.customer })).toEqual({
        outcome: "unavailable",
        reason: s.reasons.gone,
      });
    });

    test("a deployment without Cloudflare's credentials renders nothing and says so", async () => {
      vi.stubEnv("CLOUDFLARE_BROWSER_RENDERING_TOKEN", "");
      const f = fixture();
      const made = await s.make(f);

      const said = { outcome: "unavailable", reason: "This deployment does not render PDFs." };
      expect(await f.render(made.id)).toEqual(said);
      expect(await f.t.action(api.pdfCopies.render, { paper: made.customer })).toEqual(said);
      expect(renders).toHaveLength(0);
      expect(await f.passes()).toHaveLength(0);
    });
  });
});

describe("a proposal's PDF copy, by state", () => {
  // A sent proposal whose offer has already been downloaded once.
  async function downloaded(f: Fixture) {
    const made = await f.sent();
    await f.render({ proposalId: made.proposalId });
    expect(await f.storedFiles()).toHaveLength(1);
    return made;
  }

  test("Withdraw lets the sent file go, and the next Send renders afresh", async () => {
    const f = fixture();
    const { proposalId } = await downloaded(f);

    await f.owner.mutation(api.proposals.withdraw, { proposalId });
    expect(await f.storedFiles()).toHaveLength(0);

    await f.owner.action(api.proposals.send, { proposalId });
    expect(await f.stored({ proposalId })).toBeNull();
    await f.render({ proposalId });
    expect(renders).toHaveLength(2);
  });

  test("the owner's Decline lets the sent file go, and a declined proposal has none", async () => {
    const f = fixture();
    const { proposalId } = await downloaded(f);

    await f.owner.mutation(api.proposals.decline, { proposalId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.render({ proposalId })).toEqual({
      outcome: "unavailable",
      reason: "Only a sent or approved proposal has a PDF.",
    });
    expect(renders).toHaveLength(1);
  });

  test("the customer's Decline lets the sent file go", async () => {
    const f = fixture();
    const { proposalId, token } = await downloaded(f);

    await f.t.mutation(api.proposals.declineFromLink, { token });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored({ proposalId })).toBeNull();
  });

  test("Approve lets the sent file go, and the signed copy is made on its first download", async () => {
    const f = fixture();
    const { proposalId, token } = await downloaded(f);

    await f.approve(token);

    // The offer's file is not the signed copy, and is not kept beside it.
    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored({ proposalId })).toBeNull();
    expect(await f.render({ proposalId })).toMatchObject({
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
        customerPress = f.t.action(api.pdfCopies.render, { paper: { signingToken: token } });
      else return printPdf(request);
      await customerPress;
      return printPdf(request);
    };

    const owners = await f.render({ proposalId });

    expect(renders).toHaveLength(2);
    // The customer's render landed first and is the record; the owner's,
    // landing second, was let go, and both were handed the same file.
    expect(await customerPress).toEqual(owners);
    expect(await f.storedFiles()).toHaveLength(1);
    await f.render({ proposalId });
    expect(renders).toHaveLength(2);
  });

  test("the customer's signed copy, through the link that signed it", async () => {
    const f = fixture();
    const { token } = await f.sent();
    await f.approve(token);

    expect(
      await f.t.action(api.pdfCopies.render, { paper: { signingToken: token } }),
    ).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Proposal 1300FRANKLIN-P1 (signed).pdf",
    });
  });

  test("nothing for a proposal the customer declined, though its link still reads", async () => {
    const f = fixture();
    const { token } = await f.sent();
    await f.t.mutation(api.proposals.declineFromLink, { token, reason: "Too dear." });

    expect(await f.t.query(api.signingLinks.page, { token })).not.toBeNull();
    expect(await f.t.query(api.pdfCopies.download, { paper: { signingToken: token } })).toBeNull();
    expect(await f.t.action(api.pdfCopies.render, { paper: { signingToken: token } })).toEqual({
      outcome: "unavailable",
      reason: "Only a sent or approved proposal has a PDF.",
    });
    expect(renders).toHaveLength(0);
  });

  test("an invoice link's token opens no proposal", async () => {
    const f = fixture();
    const { token } = await f.deposit();

    expect(await f.t.query(api.pdfCopies.download, { paper: { signingToken: token } })).toBeNull();
    expect(await f.t.action(api.pdfCopies.render, { paper: { signingToken: token } })).toEqual({
      outcome: "unavailable",
      reason: "This proposal is not available.",
    });
    expect(renders).toHaveLength(0);
  });

  test("a file of the withdrawn offer is never kept for the offer sent after it", async () => {
    const f = fixture();
    const { proposalId } = await f.sent();
    let seen: unknown = undefined;
    renderer = async (request) => {
      // Offer A is printing when the owner takes it back and sends offer B.
      await f.owner.mutation(api.proposals.withdraw, { proposalId });
      await f.owner.mutation(api.proposals.update, { proposalId, notes: "Offer B." });
      await f.owner.action(api.proposals.send, { proposalId });
      seen = await f.t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    const answer = await f.render({ proposalId });

    // A's pass never opens B's paper, and A's bytes are let go.
    expect(seen).toBeNull();
    expect(answer).toMatchObject({ outcome: "unavailable" });
    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored({ proposalId })).toBeNull();
  });
});

describe("an invoice's PDF copy, by paper state", () => {
  // A deposit invoice whose paper has already been downloaded once.
  async function downloaded(f: Fixture) {
    const made = await f.deposit();
    await f.render({ invoiceId: made.invoiceId });
    expect(await f.storedFiles()).toHaveLength(1);
    return made;
  }

  test("a void invoice's file says so in its name", async () => {
    const f = fixture();
    const { invoiceId } = await f.deposit();
    await f.owner.mutation(api.invoices.voidInvoice, { invoiceId });

    expect(await f.render({ invoiceId })).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Invoice INV-1001 (void).pdf",
    });
  });

  test("a paid invoice's file is named as the sent one was", async () => {
    const f = fixture();
    const { invoiceId } = await f.deposit();
    await f.owner.mutation(api.invoices.markPaid, { invoiceId });

    expect(await f.render({ invoiceId })).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Invoice INV-1001.pdf",
    });
  });

  test("the pass carries the paper state it was made for, stamp and all", async () => {
    const f = fixture();
    const { invoiceId } = await f.deposit();
    await f.owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-08-31" });
    let seen: unknown = undefined;
    renderer = async (request) => {
      const pass = (await f.passes())[0];
      expect(pass).toMatchObject({ invoiceId, paperState: "paid", stampDay: "2026-08-31" });
      seen = await f.t.query(api.pdfCopies.paper, { pass: passOf(request) });
      return printPdf(request);
    };

    await f.render({ invoiceId });

    expect(seen).toMatchObject({
      subject: "invoice",
      paper: { stamp: { kind: "paid", day: "2026-08-31" } },
    });
  });

  test("never keeps a paid paper whose day changed while it printed", async () => {
    const f = fixture();
    const { invoiceId } = await f.deposit();
    await f.owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-08-30" });
    renderer = async (request) => {
      // Paid on the 30th is printing when the owner corrects it to the 31st:
      // paid before and paid after, but not the same sheet.
      await f.owner.mutation(api.invoices.markUnpaid, { invoiceId });
      await f.owner.mutation(api.invoices.markPaid, { invoiceId, receivedOn: "2026-08-31" });
      return printPdf(request);
    };

    expect(await f.render({ invoiceId })).toMatchObject({ outcome: "unavailable" });
    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.copyOf({ invoiceId })).toBeNull();
  });

  test("the stored copy records the paper state it printed", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);

    expect(await f.copyOf({ invoiceId })).toMatchObject({ paperState: "sent" });
  });

  test("Mark paid lets the sent file go, and the next Download prints the stamp", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);

    await f.owner.mutation(api.invoices.markPaid, { invoiceId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored({ invoiceId })).toBeNull();
    await f.render({ invoiceId });
    expect(renders).toHaveLength(2);
    expect(await f.copyOf({ invoiceId })).toMatchObject({ paperState: "paid" });
  });

  test("Mark unpaid lets the paid file go", async () => {
    const f = fixture();
    const { invoiceId } = await f.deposit();
    await f.owner.mutation(api.invoices.markPaid, { invoiceId });
    await f.render({ invoiceId });
    expect(await f.storedFiles()).toHaveLength(1);

    await f.owner.mutation(api.invoices.markUnpaid, { invoiceId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored({ invoiceId })).toBeNull();
  });

  test("Void lets the sent file go, and the void one is its own", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);

    await f.owner.mutation(api.invoices.voidInvoice, { invoiceId });

    expect(await f.storedFiles()).toHaveLength(0);
    expect(await f.stored({ invoiceId })).toBeNull();
    await f.render({ invoiceId });
    expect(await f.copyOf({ invoiceId })).toMatchObject({ paperState: "void" });
    expect(await f.stored({ invoiceId })).toMatchObject({
      filename: "Expand Handyman Invoice INV-1001 (void).pdf",
    });
  });

  // A payment that reached the table some other way than Mark paid, which
  // would have let the file go: the sent paper is still not the paid one.
  const paidBehindItsBack = (f: Fixture, invoiceId: Id<"invoices">) =>
    f.t.run((ctx) =>
      ctx.db.insert("payments", {
        invoiceId,
        receivedOn: "2026-09-01",
        source: "owner",
        recordedBy: "owner",
        recordedAt: Date.now(),
      }),
    );

  test("a file is handed out only while the invoice is in the paper state it printed", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);

    await paidBehindItsBack(f, invoiceId);

    expect(await f.stored({ invoiceId })).toBeNull();
  });

  test("a file the row still holds for another paper state is replaced, and its bytes go", async () => {
    const f = fixture();
    const { invoiceId } = await downloaded(f);
    await paidBehindItsBack(f, invoiceId);

    expect(await f.render({ invoiceId })).toMatchObject({ outcome: "ready" });
    expect(renders).toHaveLength(2);
    expect(await f.copyOf({ invoiceId })).toMatchObject({ paperState: "paid" });
    // The sent file went when the paid one was kept.
    expect(await f.storedFiles()).toHaveLength(1);
  });

  test("the customer's void invoice, through the link Void kept", async () => {
    const f = fixture();
    const { invoiceId, token } = await f.deposit();
    await f.owner.mutation(api.invoices.voidInvoice, { invoiceId });

    expect(
      await f.t.action(api.pdfCopies.render, { paper: { invoiceToken: token } }),
    ).toMatchObject({
      outcome: "ready",
      filename: "Expand Handyman Invoice INV-1001 (void).pdf",
    });
  });
});
