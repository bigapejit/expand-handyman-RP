import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderPageToPdf } from "../convex/proposalPdfRenderer";
import {
  BrowserTimeHeader,
  ProposalPaperReadySelector,
  proposalPdfFooterTemplate,
} from "../lib/proposal-pdf";

// The renderer seam, ported from FRSG and stubbed at `fetch` exactly as
// convex/email.ts's Resend is: what it asks Cloudflare for, and the three
// answers it gives back: rendered, this deployment does not render, or a named
// fault.

const pageUrl = "https://staff.expandhandyman.com/paper/pass_123";
const code = "441094TH-P1";
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n");

function stubCloudflare(response: Response) {
  const fetchStub = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

function rendered(browserMs = "8421") {
  return new Response(pdfBytes, {
    status: 200,
    headers: { "Content-Type": "application/pdf", [BrowserTimeHeader]: browserMs },
  });
}

function requestOf(fetchStub: ReturnType<typeof stubCloudflare>) {
  const call = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
  return { url: call[0], init: call[1], body: JSON.parse(String(call[1].body)) };
}

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct_42");
  vi.stubEnv("CLOUDFLARE_BROWSER_RENDERING_TOKEN", "cf_test_token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("rendering a page through Cloudflare Browser Rendering", () => {
  it("posts the page URL with the print options and the document-ready wait", async () => {
    const fetchStub = stubCloudflare(rendered());

    const result = await renderPageToPdf({ url: pageUrl, code });

    expect(result.outcome).toBe("rendered");
    if (result.outcome !== "rendered") throw new Error("expected a render");
    expect(result.browserMs).toBe(8421);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(pdfBytes);
    expect(result.blob.type).toBe("application/pdf");

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const request = requestOf(fetchStub);
    expect(request.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct_42/browser-rendering/pdf",
    );
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      Authorization: "Bearer cf_test_token",
      "Content-Type": "application/json",
    });
    expect(request.body).toEqual({
      url: `${pageUrl}?footer=renderer`,
      gotoOptions: { waitUntil: "load", timeout: 30_000 },
      waitForSelector: { selector: ProposalPaperReadySelector, timeout: 30_000 },
      rejectRequestPattern: [".*/sign/.*"],
      pdfOptions: {
        format: "letter",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: proposalPdfFooterTemplate(code),
      },
    });
  });

  it("never asks the browser to open a signing link", async () => {
    const fetchStub = stubCloudflare(rendered());

    await renderPageToPdf({ url: pageUrl, code });

    const request = requestOf(fetchStub);
    expect(request.body.url).not.toMatch(/\/sign\//);
    const [pattern] = request.body.rejectRequestPattern as string[];
    expect(new RegExp(pattern).test("https://staff.expandhandyman.com/sign/abc")).toBe(true);
    expect(new RegExp(pattern).test(pageUrl)).toBe(false);
  });

  it("reads no browser time when the header is missing", async () => {
    stubCloudflare(
      new Response(pdfBytes, { status: 200, headers: { "Content-Type": "application/pdf" } }),
    );

    const result = await renderPageToPdf({ url: pageUrl, code });

    expect(result).toMatchObject({ outcome: "rendered", browserMs: null });
  });
});

describe("a deployment that does not render", () => {
  it.each([
    ["CLOUDFLARE_ACCOUNT_ID"],
    ["CLOUDFLARE_BROWSER_RENDERING_TOKEN"],
  ])("without %s makes no request and says so", async (name) => {
    vi.stubEnv(name, "");
    const fetchStub = stubCloudflare(rendered());

    const result = await renderPageToPdf({ url: pageUrl, code });

    expect(result).toEqual({ outcome: "notRendered", reason: "noRenderer" });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("what stops a render this deployment meant to make", () => {
  it("names the network when Cloudflare cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.cloudflare.com");
      }),
    );

    expect(await renderPageToPdf({ url: pageUrl, code })).toEqual({
      outcome: "fault",
      fault: "REQUEST_FAILED",
    });
  });

  // Someone is waiting on Download, so a provider that never answers is given
  // up on rather than waited out, and the giving up is the same fault as never
  // reaching it.
  it("gives up on a Cloudflare that never answers", async () => {
    const fetchStub = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const rendering = renderPageToPdf({ url: pageUrl, code });
    const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    init.signal!.dispatchEvent(new Event("abort"));

    expect(await rendering).toEqual({ outcome: "fault", fault: "REQUEST_FAILED" });
  });

  it("carries Cloudflare's status when it refuses", async () => {
    stubCloudflare(
      new Response(JSON.stringify({ success: false, errors: [{ message: "timed out" }] }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(await renderPageToPdf({ url: pageUrl, code })).toEqual({
      outcome: "fault",
      fault: "HTTP_429",
    });
  });

  it("refuses a 2xx that is not a PDF", async () => {
    stubCloudflare(
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(await renderPageToPdf({ url: pageUrl, code })).toEqual({
      outcome: "fault",
      fault: "NOT_A_PDF",
    });
  });
});
