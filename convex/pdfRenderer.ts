// The app's single door to a PDF renderer, ported from FRSG's
// convex/proposalPdfRenderer.ts. Everything that turns a page into a file goes
// through `renderPageToPdf`, so the renderer, the request it takes and the rule
// for a deployment that has no renderer are each decided once here, in the
// shape convex/email.ts gave Resend. It is the switch point ADR 0002 keeps: a
// Chromium of Expand's own would be a second implementation of this function
// and nothing above it would change.
//
// Nothing throws. A caller gets one of three answers: the page was rendered,
// this deployment does not render at all, or something stopped a render that
// was meant to happen and it is named.
//
// The renderer is Cloudflare Browser Run's REST `/pdf` endpoint
// (lib/pdf-copy.ts). Two variables name it, set on production Convex only:
// the account whose browser time is spent (FRSG's), and Expand's own API token
// with "Browser Rendering - Edit". Preview and dev deployments carry neither
// and render nothing (docs/deployment.md).

import { BrowserTimeHeader, looksLikePdf, pdfCopyRequest } from "../lib/pdf-copy";

// Everything that can stop a render this deployment meant to make.
// `HTTP_${number}` carries Cloudflare's own status, so a spent daily allowance
// or the free plan's one request per ten seconds (429) is told from a page that
// never produced its letterhead without a second lookup. `NOT_A_PDF` is a 2xx
// whose body is something else, refused here rather than stored as a file
// nobody can open.
export type RenderFault = "REQUEST_FAILED" | "NOT_A_PDF" | `HTTP_${number}`;

export type RenderResult =
  | {
      outcome: "rendered";
      blob: Blob;
      // Browser time this render spent, in milliseconds, from Cloudflare's
      // own header; null on a response that carried none.
      browserMs: number | null;
    }
  // Nothing was attempted and nothing is wrong: a preview deployment, CI and a
  // local machine name no renderer.
  | { outcome: "notRendered"; reason: "noRenderer" }
  | { outcome: "fault"; fault: RenderFault };

// How long the endpoint gets, end to end. The request already allows the page
// half a browser-minute to load and half to say it is ready, and Cloudflare
// stops a render at the minute itself, so anything past this is the provider
// not answering rather than a slow page.
const RenderTimeoutMs = 90_000;

// Whether this deployment renders at all: both variables, or neither counts.
export function hasRenderer(): boolean {
  return rendererConfig() !== null;
}

function rendererConfig(): { accountId: string; apiToken: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_BROWSER_RENDERING_TOKEN?.trim();
  return accountId && apiToken ? { accountId, apiToken } : null;
}

// `code` is the **Proposal ID** the renderer foots every sheet with.
export async function renderPageToPdf(page: { url: string; code: string }): Promise<RenderResult> {
  const config = rendererConfig();
  if (!config) {
    console.log(`PDF not rendered (no renderer configured). Page: ${page.url}`);
    return { outcome: "notRendered", reason: "noRenderer" };
  }

  const request = pdfCopyRequest({ ...config, url: page.url, code: page.code });

  let response: Response;
  try {
    // Given up on rather than waited out: someone is looking at a Download
    // button. An abort lands in the same catch as an unreachable host, and is
    // the same fault: the request did not happen.
    response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(RenderTimeoutMs),
    });
  } catch {
    console.error(`PDF of ${page.code} failed to reach Cloudflare Browser Run.`);
    return { outcome: "fault", fault: "REQUEST_FAILED" };
  }

  if (!response.ok) {
    console.error(
      `PDF of ${page.code} rejected by Cloudflare Browser Run (${response.status}): ${(await readText(response)) ?? "no body"}`,
    );
    return { outcome: "fault", fault: `HTTP_${response.status}` };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    console.error(
      `PDF of ${page.code} came back as something other than a PDF: ${new TextDecoder().decode(bytes.subarray(0, 300))}`,
    );
    return { outcome: "fault", fault: "NOT_A_PDF" };
  }

  const browserMs = readBrowserMs(response.headers.get(BrowserTimeHeader));
  console.log(
    `PDF of ${page.code} rendered: ${bytes.byteLength} bytes, ${browserMs === null ? "browser time unreported" : `${browserMs} ms of browser time`}.`,
  );

  return {
    outcome: "rendered",
    blob: new Blob([bytes], { type: "application/pdf" }),
    browserMs,
  };
}

function readBrowserMs(header: string | null): number | null {
  if (header === null) return null;
  const parsed = Number(header);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readText(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}
