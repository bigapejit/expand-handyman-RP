// Prove the paper before production has rendered anything. Ported from FRSG's
// scripts/render-pdf-check.ts.
//
// Points Cloudflare Browser Run at one page (a preview's `/paper/<pass>`) with
// the very request the Convex action sends (lib/proposal-pdf.ts), writes the
// PDF it gets back, and reads it with pypdf: how many sheets, what is on each
// (a blank trailing sheet is the Chrome quirk FRSG's ProposalPageRules guards
// against, and an empty last sheet is how it shows), and which faces are
// embedded (Tinos and Homemade Apple, not a fallback).
//
// A render pass lives only for a render, so mint one by hand on the preview's
// Convex deployment for a Sent or Approved proposal, then run the check within
// its five minutes:
//
//   npx convex run proposalPdf:mintRenderPass \
//     '{"proposalId":"<id>","token":"<43 random URL-safe characters>"}'
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_BROWSER_RENDERING_TOKEN=… \
//     npx tsx scripts/render-pdf-check.ts https://<preview>/paper/<token> [out.pdf] [<Proposal ID>]
//
// `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
// makes a token. The two variables are the ones production Convex carries
// (docs/deployment.md). The third argument is the Proposal ID the renderer
// foots the sheets with, which `mintRenderPass` prints as `code`.

import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  BrowserTimeHeader,
  looksLikePdf,
  proposalPdfRequest,
} from "../lib/proposal-pdf";

async function main() {
  const [, , pageUrl, outArg, codeArg] = process.argv;
  if (!pageUrl) {
    console.error("Usage: npx tsx scripts/render-pdf-check.ts <page url> [out.pdf] [<Proposal ID>]");
    process.exit(2);
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_BROWSER_RENDERING_TOKEN?.trim();
  if (!accountId || !apiToken) {
    console.error(
      "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_BROWSER_RENDERING_TOKEN (production Convex's own values).",
    );
    process.exit(2);
  }

  const outPath = resolve(outArg ?? "render-pdf-check.pdf");
  const request = proposalPdfRequest({
    accountId,
    apiToken,
    url: pageUrl,
    code: codeArg ?? "UNKNOWN-P0",
  });

  console.log(`Rendering ${pageUrl}`);
  console.log(`Request body: ${request.init.body}`);

  const started = Date.now();
  const response = await fetch(request.url, request.init);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const elapsed = Date.now() - started;

  if (!response.ok || !looksLikePdf(bytes)) {
    console.error(
      `Cloudflare answered ${response.status} in ${elapsed} ms:\n${new TextDecoder().decode(bytes.subarray(0, 2000))}`,
    );
    process.exit(1);
  }

  await writeFile(outPath, bytes);
  console.log(
    `Wrote ${outPath}: ${bytes.byteLength} bytes in ${elapsed} ms; browser time ${response.headers.get(BrowserTimeHeader) ?? "unreported"} ms.`,
  );

  // pypdf, sheet by sheet, the method FRSG's verifications have used since its
  // issue #216.
  const inspect = `
import sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
fonts = set()
print(f"Sheets: {len(reader.pages)}")
for index, page in enumerate(reader.pages, start=1):
    words = len((page.extract_text() or "").split())
    print(f"  sheet {index}: {words} words")
    resources = page.get("/Resources") or {}
    for name, font in (resources.get("/Font") or {}).items():
        try:
            fonts.add(str(font.get_object().get("/BaseFont")))
        except Exception:
            pass
print("Fonts: " + (", ".join(sorted(fonts)) or "none reported"))
`;
  const python = spawnSync("python", ["-c", inspect, outPath], { encoding: "utf8" });
  if (python.error || python.status !== 0) {
    console.log(
      `pypdf not run (${python.error?.message ?? python.stderr.trim()}). Read the file by hand: python -m pip install pypdf`,
    );
  } else {
    process.stdout.write(python.stdout);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
