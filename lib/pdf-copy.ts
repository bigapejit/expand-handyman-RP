// The one request that turns a proposal or invoice paper into a **PDF copy**,
// and the names the file goes by (CONTEXT.md; ADR 0002). Ported from FRSG's
// shared/proposal-pdf.ts. The renderer is Cloudflare Browser Run's REST `/pdf`
// endpoint: a hosted Chromium that opens a URL and hands back bytes.
//
// It sits in lib/ rather than in convex/ because two callers build the very
// same request: the Convex action behind Download, and
// scripts/render-pdf-check.ts, which a developer points at a preview page to
// prove the paper before production has rendered anything. One builder is what
// makes that check worth running: a script that assembled its own body would
// prove a request the action never sends.
//
// It imports nothing, on purpose: tsx runs the check script's imports as they
// are, and the `@/` alias does not resolve there.

// Which paper a proposal in a given state has as its PDF copy: the offer while
// it is Sent, the signed copy once Approved, and nothing at all as a Draft
// (nothing is frozen) or once Declined (an offer Expand no longer means is not
// handed out as a file). Asked by the server that stores the file and by every
// surface that decides whether to offer Download.
export type PdfCopyState = "sent" | "approved";

export function pdfCopyStateFor(state: string): PdfCopyState | null {
  return state === "sent" || state === "approved" ? state : null;
}

export type PdfCopyRequest = {
  accountId: string;
  apiToken: string;
  // The page to print: the paper at its render pass (`/paper/<pass>`). Never a
  // signing link, which logs a view on every open (ADR 0001); the request
  // below refuses that path outright as a second guard.
  url: string;
  // What the sheets are footed with: the **Proposal ID**, or the invoice
  // number, `INV-1001`.
  code: string;
};

// The footer, drawn by the renderer rather than by the page.
//
// The page foots its own sheets for a browser's print with CSS page-margin
// boxes (components/proposal-paper.tsx, ProposalPageRules), which Chrome has
// drawn since 131. The Chromium behind Cloudflare's endpoint measured 119 (FRSG,
// 2026-09-04), so a PDF it printed carried no footer at all. Chrome's own
// header and footer templates have existed for years, so the renderer draws
// the footer itself and opens the page with this flag so the page leaves its
// own off: a renderer that catches up one day would otherwise print two.
export const RendererFooterParam = { name: "footer", value: "renderer" } as const;

export function rendererPageUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set(RendererFooterParam.name, RendererFooterParam.value);
  return url.toString();
}

// The template is laid out by Chrome in a document of its own, which sees
// none of the page's faces: Tinos is asked for anyway, and the fallbacks are
// what the renderer's Linux carries. Liberation Serif is metrically Times.
// The 6pt at the bottom lifts the line to where a page-margin box centres it,
// so the same proposal foots the same whichever of the two printed it.
export function pdfCopyFooterTemplate(code: string): string {
  const face =
    "font-family: Tinos, 'Times New Roman', 'Liberation Serif', Times, serif; font-size: 9.5pt; color: #000;";
  return (
    `<div style="width: 100%; box-sizing: border-box; margin: 0 0 6pt; padding: 0 0.6in; ${face} display: flex; justify-content: space-between; align-items: baseline;">` +
    `<span>${escapeHtml(code)}</span>` +
    `<span>Page: <span class="pageNumber"></span></span>` +
    `</div>`
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// What the request waits for before printing. The page hydrates from a Convex
// query (a snapshot on `load` is skeletons), then asks for the paper's faces
// and the letterhead's image, and marks its root `data-paper="ready"` once all
// three have arrived (components/paper-screen.tsx). The letterhead's name is
// the first thing the paper draws, so the pair says: the data is here, and
// everything the paper is drawn with is here. The invoice paper sits in the
// same screen under the same letterhead (components/invoice-paper.tsx), so
// one mark serves both papers.
export const ProposalPaperReadySelector =
  '.paper-screen[data-paper="ready"] .pd-letterhead-name';

// Half a browser-minute for the page to load and half for it to say it is
// ready; a page that has not produced its letterhead by then is not going to,
// and Cloudflare would stop the render at the minute anyway.
export const ProposalPaperReadyTimeoutMs = 30_000;

// A path the renderer must never fetch, as the endpoint's regular expression.
// `/sign/<token>` is the customer's private link, and opening it is a view.
export const SigningLinkRequestPattern = ".*/sign/.*";

export function pdfRendererEndpoint(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/pdf`;
}

// The body Cloudflare's `/pdf` takes: Puppeteer's own options, by their
// Puppeteer names. `preferCSSPageSize` is what lets `@page { size: letter
// portrait; margin: … }` in app/paper-print.css decide the sheet rather than
// the endpoint's default; `printBackground` keeps the certificate's grey
// bands. The footer is the renderer's, drawn in the bottom margin the page's
// own `@page` rule leaves; the header template is empty rather than absent,
// because Chrome's default header is the page title and the date.
export function pdfCopyRequestBody(url: string, code: string) {
  return {
    url: rendererPageUrl(url),
    gotoOptions: { waitUntil: "load", timeout: ProposalPaperReadyTimeoutMs },
    waitForSelector: {
      selector: ProposalPaperReadySelector,
      timeout: ProposalPaperReadyTimeoutMs,
    },
    rejectRequestPattern: [SigningLinkRequestPattern],
    pdfOptions: {
      format: "letter",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: pdfCopyFooterTemplate(code),
    },
  };
}

export function pdfCopyRequest(request: PdfCopyRequest): {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
} {
  return {
    url: pdfRendererEndpoint(request.accountId),
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pdfCopyRequestBody(request.url, request.code)),
    },
  };
}

// The response header that says how much of the day's browser time this
// render spent, in milliseconds. Logged on every render so the free tier's
// daily cap is visible before it is hit.
export const BrowserTimeHeader = "X-Browser-Ms-Used";

// The four bytes every PDF starts with. Cloudflare answers some refusals as
// JSON with a 2xx, so the status alone does not say "this is a PDF".
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

// "Expand Handyman Proposal 441094TH-P2.pdf", and "… (signed).pdf" once the
// file is the **Signed copy**: what the paper is called wherever it is saved.
// The signed paper says so in its own name because a customer ends up holding
// both in one folder, and the offer and the contract must not be told apart
// only by the date on them.
export function pdfCopyFilename(code: string, options: { signed?: boolean } = {}): string {
  return paperFilename("Proposal", code, options.signed ? " (signed)" : "");
}

// "Expand Handyman Invoice INV-1001.pdf", and "… (void).pdf" for a void
// invoice, so a void invoice saved beside the one that replaced it is never
// read as money owed. Sent and paid share a name: the PAID stamp on the sheet
// says which.
export function invoicePdfCopyFilename(number: string, options: { void?: boolean } = {}): string {
  return paperFilename("Invoice", number, options.void ? " (void)" : "");
}

// Characters no file system takes are dropped rather than escaped, so the
// name stays readable.
function paperFilename(paper: "Proposal" | "Invoice", id: string, suffix: string): string {
  const name = id
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "")
    .trim();
  return `Expand Handyman ${paper}${name ? ` ${name}` : ""}${suffix}.pdf`;
}
