# Proposal PDF copies are rendered on demand by Cloudflare Browser Run

The owner and the customer can each download a sent or approved proposal as a PDF, and it must look exactly like the proposal paper, including a Proposal ID and page-number footer on every sheet. Browser print alone can't guarantee that because Safari and Firefox draw no footer. Chromium can't run inside Convex, and a Vercel Chromium route would need a paid plan and its own packaging. So we port FRSG's Cloudflare Browser Run renderer, on the Cloudflare account FRSG already uses, but call it only when someone presses Download. Nothing renders at Send or at Approve. The file is stored and reused until the proposal's state changes, and an approved proposal's file is never replaced.

The renderer is a headless browser with no sign-in, and it must never open a signing link, because that would log a customer view. Each render therefore creates a short-lived render pass: a random token for one proposal in one state that expires within minutes and is deleted afterwards. The renderer opens the paper at `/paper/<pass>` through a query that never writes to the view log. We rejected FRSG's permanent per-site token: in Expand only the renderer would use it, and a permanent credential sitting in Cloudflare's request logs gains nothing.

## Consequences

- Only production renders. Preview and dev deployments have no Cloudflare credentials and answer "This deployment does not render PDFs"; Ctrl+P on the paper remains the free fallback.
- Expand shares FRSG's Workers Free quota (10 browser-minutes a day, one render request every 10 seconds, per account). Hitting it shows as a failed Download until midnight UTC, not as an app failure; a second press usually finds the stored file.
- The signed copy's PDF is made on its first download, under whatever Chromium Cloudflare runs that day. The data saved at Approve is the record; the file is a rendering of it.
- `renderPageToPdf` stays the switch point: a Vercel Chromium route can replace Cloudflare without anything above it changing.
