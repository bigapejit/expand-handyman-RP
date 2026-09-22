# Producing a proposal PDF on demand

Research resolving [issue #12](https://github.com/bigapejit/expand-handyman-RP/issues/12) (part of
the wayfinder map, [#8](https://github.com/bigapejit/expand-handyman-RP/issues/8)).

Date: 2026-09-22. Primary sources are FRSG's code at `bigapejit/frsg-app` (main, `6e9768d`), the
vendors' own documentation, and MDN's browser-compat data; each claim links to the page it came from.

## Question

The proposal paper will be a Next.js page styled by FRSG's `proposal-document.css` and `print.css`.
PDFs are never rendered on send and never attached to email; the paper must match FRSG's look
exactly; the owner and the customer may each want a PDF on demand. What are the viable ways to hand
them one, and what does each cost in fidelity, fonts, per-page footer, latency, money and setup?

## TL;DR

**Port FRSG's Cloudflare renderer and call it only from the Download button.** FRSG's
`convex/proposalPdf.ts` already contains the on-demand path in full — `downloadForStaff` /
`downloadForCustomer` read a stored file, and `renderForStaff` / `renderForCustomer` render one when
there is none — with the render-at-Send and render-at-Approve scheduling bolted on beside it. Expand
takes the module and deletes the scheduling and the email hand-off (`postLetter`, `attachmentRead`,
`letterAfterRenderValidator`). Nothing else changes: `shared/proposal-pdf.ts` builds the request,
`convex/proposalPdfRenderer.ts` sends it, and the file is stored once per proposal state and never
replaced once Approved.

Why this one:

- **It is the only server option whose footer is proven on this exact paper.** FRSG measured
  Cloudflare's Chromium at 119 on 2026-09-04, below the 131 that CSS page-margin boxes need, and
  solved it by having the renderer draw the footer itself (`footerTemplate` with the Proposal ID and
  `pageNumber`) while the page, opened as `?footer=renderer`, writes no `@page` rules at all. Two
  PDFs of the same proposal, one from the customer's Chrome and one from Cloudflare, foot at the same
  `(43pt, 760pt)`. That work is done and verified; Expand inherits it by copying the files.
- **Nothing to host, nothing to bundle, no plan decision.** Two Convex environment variables
  (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_BROWSER_RENDERING_TOKEN`), no change to the Vercel project.
- **The cost is a cap, not a bill.** Workers Free: 10 browser-minutes a day, roughly 60 renders;
  past that Download says so until midnight and nothing else in the app is touched. Workers Paid,
  if ever needed: $5 a month with 10 browser-hours included, then $0.09 an hour.
- **On demand with a cache is cheaper than on demand without one.** A Sent proposal is frozen
  (FRSG ADR-0024), so its paper cannot change until Approve or Withdraw; rendering it once and
  handing the same bytes to the owner and the customer spends one browser-run per state instead of
  one per click, and an Approved proposal's file is the signed record and must never be re-rendered
  anyway.

Browser print-to-PDF (option 1) stays available for free — FRSG's paper screen already loads the
faces on mount so a Ctrl+P prints Tinos — but it is not "the PDF": Safari and Firefox draw no
footer at all, and Chrome's own date/title header appears unless the customer unticks it.

The one thing FRSG does not hand over: its renderer opens the paper at the Site's permanent
**report token** (`/report/<token>/proposals/<id>`), which is minted by the Roof Report machinery
Expand is not porting. Expand needs an equivalent renderer-addressable page that never logs a view.
The simplest port keeps the shape — a per-site paper token minted lazily by `renderTarget` — and it
also answers the map's open question about owner preview without a report token. See
[The page the renderer opens](#the-page-the-renderer-opens).

---

## What is being rendered

Established from FRSG's code, which the map says Expand copies exactly (minus roof sketches).

- The paper is `components/roof-report/proposal-document.tsx` styled by
  `app/report/proposal-document.css`, drawn inside `paper-screen.tsx` (`app/paper-screen.css`).
  Expand already carries the paper-screen CSS and the sign bar for uploaded-PDF signing
  (`app/paper-screen.css` in this repo, including its `@media print` block).
- Print rules the file has to honour, from `print.css` and `proposal-document.css`:
  - `@page { size: letter portrait; margin: 0.55in 0.6in 0.75in }` — the 0.75in bottom margin is
    the room the footer sits in.
  - Every `.pd-page` is a block that starts a page (`break-before: page`), never a fixed 11in box,
    so nothing overruns silently; the letterhead is drawn at the top of each block rather than as
    a running header.
  - `printBackground` matters: the Certificate of Completion's bands are `background: #dcdcdc`,
    and neither stylesheet sets `print-color-adjust`.
- **The footer is drawn three different ways, on purpose.** For a browser's print,
  `ProposalPageRules` in `proposal-document.tsx` injects `@page proposalN { @bottom-left { content:
  "<Proposal ID>" } @bottom-right { content: "Page: " counter(page) } }` and names the page on every
  ancestor through `:has()`, because Chrome otherwise closes the job with a blank trailing sheet
  (verified in FRSG issue #216). For the server render, the page is opened with `?footer=renderer`,
  writes no `@page` rules, and Puppeteer's `footerTemplate`
  (`shared/proposal-pdf.ts`, `proposalPdfFooterTemplate`) draws the same two strings 6pt above the
  page edge. The third way is no footer at all, which is what every browser without margin-box
  support prints.
- **Fonts travel with the app.** `app/report/fonts.css` declares Tinos (metric-compatible with
  Times New Roman, four faces, ~795 KB of WOFF2) and Homemade Apple with `font-display: block`;
  `lib/paper-fonts.ts` loads them before any print. FRSG measured a Linux Chromium asked for Times
  New Roman drawing DejaVu Serif before this, and Tinos after (issue #256). Expand's `public/fonts`
  has Homemade Apple (and Allura, for the uploaded-PDF path) but **not Tinos**; the four Tinos
  files come across with the paper. The footer template is laid out by Chrome in a document of its
  own that sees none of the page's faces, so it asks for Tinos and falls back to Liberation Serif,
  which is metrically Times — the two footers measure the same either way.
- **Readiness.** The page hydrates from a Convex query; a renderer that snapshots on `load` gets
  skeletons. `paper-screen.tsx` marks its root `data-paper="ready"` once the query, the faces and
  the letterhead image have all arrived, and the renderer waits for
  `.paper-screen[data-paper="ready"] .pd-letterhead-name`.
- **Never through a signing link.** In FRSG, opening `/sign/<token>` stamps `firstOpenedAt`; in
  Expand, [ADR-0001](../adr/0001-view-tracking-in-convex.md) logs every open of a signing link and
  moves a document from "Link ready" to "Viewed". A renderer opening the signing address would
  forge a customer view. FRSG's request refuses `.*/sign/.*` outright via `rejectRequestPattern`.

### Browser-feature floor for the page's own footer

| Feature | Chrome / Edge | Safari | Firefox | Source |
|---|---|---|---|---|
| `@page` margin boxes (`@bottom-left`, `@bottom-right`, `counter(page)`) | **131** | not supported | not supported | [MDN BCD `css/at-rules/page.json`](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/page.json): margin at-rules `chrome: 131`, `firefox: false`, `safari: false`; [Chrome blog](https://developer.chrome.com/blog/print-margins) |
| `@page size` | 15 | 18.2 | 95 | same BCD file |
| Named pages / `page-orientation` | 85 | not supported | 122 | same BCD file |
| `:has()` (the blank-sheet fix) | 105 | 15.4 | 121 | [MDN `:has()`](https://developer.mozilla.org/en-US/docs/Web/CSS/:has) |

Safari 18.2's release note says it "adds support for `@page` margin descriptors"
([WebKit blog](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/)) — that is the
`margin` property inside `@page`, not the margin *boxes*; BCD still lists the boxes as unsupported.
So the page's own footer exists only in Chromium 131+. Every server option below has to either run
Chromium ≥ 131 or draw the footer with `footerTemplate` the way FRSG does.

---

## The page the renderer opens

Every server-side option (2, 3 and the hosted APIs in 4) is a headless browser fetching a public
URL, so all of them need the same thing first: **an address at which the paper renders without a
signed-in owner and without logging a view.**

FRSG's answer is the Site's permanent `reportToken`, minted at the Roof Report's first Release and,
failing that, by `renderTarget` itself (`ensureReportToken(ctx, site)` in `convex/proposalPdf.ts`).
`proposalUnderReportToken` serves only a Sent or Approved proposal under it, and the same address is
what the staff panel opens and what the Signed Copy email links to. Expand has no Roof Report and no
Releases, and the map lists "owner preview of a draft proposal without a report token" as
unspecified.

The smallest change that keeps FRSG's shape: give each Site a `paperToken` (same generator as the
signing token, same "unguessable, permanent" trust model as FRSG's report token), minted lazily by
`renderTarget` or at Send. The renderer opens `/paper/<paperToken>/proposals/<id>?footer=renderer`;
the customer's Download in the signing top bar and the owner's Download in the panel both resolve to
the same stored file; and the owner's draft preview can hang off the same route with the staff
signal FRSG already uses (`isStaffRequest`). A short-lived single-use render token would also work
and leaks less if the URL ever ends up in a vendor log, but it is a second token type with its own
lifecycle for no gain a Sent proposal needs — the report address is already the address the
customer holds.

Whichever token, the query behind it must be a *different* query from the signing link's, so that
nothing on that path touches `documentViews`.

---

## Option 1 — Browser print-to-PDF via the existing print stylesheet

The customer or owner presses Ctrl+P (or a "Print" button that calls `loadPaperFonts()` then
`window.print()`, the pattern in FRSG's `walkthrough.tsx`) and chooses "Save as PDF".

**What FRSG's CSS already handles.** Letter portrait and the margins (`@page`), page breaks per
sheet, the letterhead on every sheet, hiding the screen chrome (`.paper-top`, `.paper-bar`,
`.pd-sign-here`, `.pd-pencil`), undoing the phone-scale transform, the fonts (loaded on mount by
`paper-screen.tsx`), and — in Chrome 131+ only — the Proposal ID and `Page: N` footer through
margin boxes with the `:has()` guard against the blank trailing sheet.

**What it cannot control.**

- **No footer outside Chromium 131+.** Safari and Firefox print no Proposal ID and no page numbers
  (table above). A customer on an iPhone gets an unfooted contract.
- **Chrome adds its own header/footer on top.** Chrome's write-up: "the browser will automatically
  add some page margin content if there is room for it to display. It will do this even if you
  have added content. These automatically generated headers and footers can be turned off in the
  print dialog" ([Chrome blog](https://developer.chrome.com/blog/print-margins)). The page fills
  the bottom row; the date and title still land in the top margin unless the customer unticks
  "Headers and footers". Worth verifying on the real paper — FRSG's issue #216 verification
  stubbed `window.print` and did not go through the dialog.
- **Backgrounds are off by default.** Chrome's dialog has "Background graphics" unticked; the
  certificate's grey bands vanish unless the user ticks it or the CSS gains
  `print-color-adjust: exact` (which FRSG's stylesheets do not set).
- **Paper size, scale and margins are the user's.** A dialog set to A4 or "Fit to page" reflows
  the sheets; `preferCSSPageSize` has no equivalent for a human.
- **No stored file.** Nothing is retained, so the owner's copy and the customer's copy are
  whatever each browser produced that day, and the Signed Copy is not an immutable record.

Fidelity: exact in Chrome 131+ with the right dialog settings; degraded elsewhere. Fonts: exact
(self-hosted, loaded before print). Per-page footer: Chromium 131+ only. Latency: instant. Cost:
none. Setup: none beyond copying the CSS, fonts and `ProposalPageRules`.

**Verdict:** keep it as the free fallback that costs nothing to carry, not as the Download button.

---

## Option 2 — FRSG's Cloudflare Browser Run renderer, called only from Download

Cloudflare renamed Browser Rendering to **Browser Run** in April 2026
([changelog](https://developers.cloudflare.com/changelog/post/2026-04-15-br-rename/)); the REST
"Quick Action" `/pdf` endpoint, its account-id path and the token permission are unchanged and are
exactly what FRSG's `shared/proposal-pdf.ts` sends:

```
POST https://api.cloudflare.com/client/v4/accounts/<accountId>/browser-rendering/pdf
Authorization: Bearer <token with "Browser Rendering - Edit">
{ url, gotoOptions, waitForSelector, rejectRequestPattern,
  pdfOptions: { format: "letter", printBackground: true, preferCSSPageSize: true,
                displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate } }
```

([/pdf endpoint](https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/): body
limit 50 MB; `pdfOptions` are Puppeteer's own; `addStyleTag`, `setExtraHTTPHeaders`, `cookies`,
`rejectRequestPattern` supported.)

**Account and token.** One Cloudflare account (free), its account id, and a custom API token with
the single permission *Browser Rendering – Edit*, set on the production Convex deployment with
`npx convex env set --prod`. FRSG documents the exact clicks in
`docs/agents/convex-deployments.md`. With neither variable set, `hasRenderer()` is false and
Download answers "This deployment does not render PDFs" — previews and dev render nothing, by
design.

**Pricing and limits** ([pricing](https://developers.cloudflare.com/browser-rendering/platform/pricing/),
[limits](https://developers.cloudflare.com/browser-rendering/platform/limits/)):

| | Workers Free | Workers Paid ($5/month minimum, [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)) |
|---|---|---|
| Browser time | 10 minutes per day | 10 hours per month included, then $0.09 per hour |
| Quick Action requests | 1 every 10 seconds | 30 per second |
| Browser timeout | 60 s per render | 60 s (extendable for sessions, not Quick Actions) |
| Past the cap | 429 until midnight UTC | billed |

Quick Actions are charged for browser hours only, never for concurrent browsers. Monthly totals are
rounded to the nearest hour (1,799 s or less rounds *down*). FRSG budgets about 10 s of browser
time per proposal — "about 60 Proposal renders" a day on Free — and logs the endpoint's
`X-Browser-Ms-Used` header on every render so the day's spend is visible. At Expand's volume the
Free plan is the plan; the **1-request-per-10-seconds** Quick Action limit on Free is the one to
notice — two Downloads inside ten seconds means one gets a 429, which FRSG's renderer surfaces as
`HTTP_429` and Download reports as "could not be rendered". With the per-state cache, a second
press finds the file and never hits the endpoint.

**Fidelity.** Chromium, `preferCSSPageSize` honouring the page's `@page`, `printBackground` on.
FRSG measured this endpoint's Chromium at **119** (issue #257 verification, 2026-09-04) — below
the 131 margin-box floor — which is why the footer is the renderer's `footerTemplate` and the page
is opened as `?footer=renderer`. Cloudflare publishes no Chromium version and reserves the right to
move it ("sessions close ... when Browser Run releases updates"); the `?footer=renderer` flag is
what keeps a future upgrade from footing every sheet twice. Cloudflare also now offers
**Kitesurf**, a non-Chromium engine for agents, opt-in via `browser=kitesurf` and "not
pixel-perfect" ([Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/)); the default
stays Chromium and Expand must never opt in for the paper.

**Fonts.** The page's own (Tinos, Homemade Apple, self-hosted). The certificate's `Arial` is the
one face nobody ships; FRSG's open note is that Cloudflare's image aliases it to something
Liberation-Sans-like and the bands still fit.

**Latency.** Page load (Next.js + Convex WebSocket + fonts + logo) plus print; FRSG allows 30 s to
load and 30 s for `data-paper="ready"`, gives Cloudflare 90 s end to end, and the Convex action
that awaits it runs well inside Convex's 10-minute Node action limit
([Convex limits](https://docs.convex.dev/production/state/limits)). Expect single-digit seconds
from a cold press of Download; instant on the second press.

**Setup.** Copy `shared/proposal-pdf.ts`, `convex/proposalPdfRenderer.ts`,
`convex/proposalPdfFiles.ts` and `convex/proposalPdf.ts` minus the scheduling (`renderProposalPdf`'s
`email` argument, `postLetter`, `attachmentRead`); copy `scripts/render-pdf-check.ts` (it needs
Python `pypdf` for the sheet-by-sheet check); copy `PaperDownload` from `paper-screen.tsx`; add the
`document` field to the proposal schema; set two env vars. Cloudflare's browser has to reach the
paper over the public internet, so dev renders nothing unless dev has a public origin — the same
gap FRSG lives with.

**Credential exposure.** The paper token sits in the URL Cloudflare fetches and therefore in
Cloudflare's request logs; FRSG accepted the same for its report token. If that ever matters,
`setExtraHTTPHeaders` or `cookies` can carry it instead.

---

## Option 3 — A Vercel route handler with `@sparticuz/chromium-min` + `puppeteer-core`

`app/api/proposal-pdf/route.ts` (`export const maxDuration = 60`; Next 16's route segment config
supports it and the Node runtime is the default — the Edge runtime is deprecated, per
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md`)
launches Chromium, opens the same `?footer=renderer` URL, waits for the same selector, and calls
`page.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true, displayHeaderFooter:
true, headerTemplate, footerTemplate })`. A Convex action `fetch`es it with a shared secret and
stores the blob exactly as in option 2 — Cloudflare's endpoint *is* this call, hosted.

**Bundle size.** Vercel Functions cap the uncompressed bundle at **250 MB**
([limits](https://vercel.com/docs/functions/limitations)). `@sparticuz/chromium@153.0.0` unpacks
to ~70 MB on npm and its README says the binary is ~130 MB uncompressed and the compressed archive
"exceeds 50 MB"; `@sparticuz/chromium-min@153.0.0` is 46 KB and downloads a Brotli pack from a URL
you host ([README](https://github.com/Sparticuz/chromium), [npm](https://registry.npmjs.org/@sparticuz/chromium/latest)).
Vercel's own guide prescribes `puppeteer-core` + `chromium-min` for this reason
([Vercel KB](https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel)); its template
packs the binary into `public/chromium-pack.tar` at `postinstall` and downloads it from the
deployment's own static origin at runtime
([template](https://vercel.com/templates/next.js/puppeteer-on-vercel)). Alternatively, "large
functions" allow up to 5 GB behind `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` on Fluid compute, which would
let the full package bundle. Next 16 lists both `@sparticuz/chromium` and `@sparticuz/chromium-min`
in its built-in `serverExternalPackages` list, so no config is needed to keep them out of the
server bundle
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`).

**Chromium version.** `@sparticuz/chromium@153` is Chromium 153, pinned in `package.json`, so the
page's own margin-box footer would work *and* `footerTemplate` works; Expand could drop
`?footer=renderer` here, but keeping it makes the route interchangeable with option 2.

**Memory, duration, cold start.** Sparticuz recommends 1,600 MB+; Vercel gives 2 GB / 1 vCPU by
default on every plan, 4 GB on Pro. Duration: 300 s default and maximum on Hobby, 800 s on Pro
([duration](https://vercel.com/docs/functions/configuring-functions/duration)). Cold start is the
pack download to `/tmp`, extraction and browser launch — seconds, on every cold instance — and this
time *is* felt by the person who pressed Download, unlike FRSG's send-time render. Response body
limit 4.5 MB; a proposal PDF is hundreds of KB, but a route that returns bytes to Convex is
nonetheless bounded by it.

**Cost.** Fluid compute in `iad1`: $0.128 per active-CPU-hour, $0.0106 per GB-hour, $0.60 per
million invocations ([pricing](https://vercel.com/docs/functions/usage-and-pricing)). A 10 s render
on 2 GB with ~6 s of CPU is about $0.0003; Hobby includes 4 CPU-hours and 360 GB-hours a month. The
real cost is the plan: Vercel's fair-use guidelines restrict Hobby to "non-commercial personal use
only" and define commercial as any deployment "used for the purpose of financial gain of anyone
involved" ([fair use](https://vercel.com/docs/limits/fair-use-guidelines)). A handyman business's
staff app is commercial on that definition whichever option is chosen; nothing in this repo records
which plan `expand-handyman-rp` is on (`docs/deployment.md` names the project, not the plan). Pro is
$20 per seat per month.

**Fonts.** Sparticuz ships Open Sans only; the page's self-hosted Tinos and Homemade Apple cover
the paper, and the footer template's Liberation Serif fallback is *not* guaranteed on this image —
FRSG's footer template lists Tinos, Times New Roman, Liberation Serif, Times, serif, and on
Sparticuz the resolved face would be whatever `serif` maps to. Bundle a Tinos file for the footer via
`chromium.font()` or accept a footer in a different serif.

**Setup.** Two new dependencies, a route handler, a shared secret between Convex and the route, a
pack-hosting step in the build, and a plan check. Everything Cloudflare does for free in option 2,
run by Expand.

**Verdict:** the right shape if Cloudflare ever fails Expand (its Chromium regresses, the free cap
becomes a bill, the vendor is retired), and it slots in behind the same `renderPageToPdf` seam.
Not the first move.

---

## Option 4 — Anything else credible

| Option | Why not (or when) |
|---|---|
| **Hosted HTML-to-PDF APIs** — Browserless ($0 for 1,000 units/month, then $25/month; a unit is ≤30 s of browser time, [pricing](https://www.browserless.io/pricing)), PDFShift ($9/month), api2pdf (~$1–2/month), DocRaptor (Prince engine, $15/month) | Same calling shape as option 2 with a worse price or a different engine. FRSG's `docs/research/server-side-pdf.md` compared them on 2026-09-03; nothing has changed the ranking. DocRaptor is Prince, not Chromium, so every verified Chrome quirk (`:has()`, the blank sheet, the 2pt sliver) would need re-verifying. |
| **Gotenberg** (self-hosted Chromium container) | Its docs say not to expose it to the public internet; Convex has no private network into a Fly/Railway box, so it needs an auth proxy — new infrastructure for a few dozen renders a month. |
| **Chromium inside a Convex `"use node"` action** | Not possible. Convex bundles plus external packages are capped at 45 MB zipped / 240 MB unzipped, and the docs name Puppeteer as a package that "does not currently work" because "browser binary installation exceeds the size limit" ([bundling](https://docs.convex.dev/functions/bundling)). |
| **pdf-lib layout** (already installed for uploaded-PDF signing) | pdf-lib "does not support the use of HTML or CSS when adding content to a PDF" ([README](https://github.com/Hopding/pdf-lib)); it would be a second hand-written layout of the paper that can never match the print — exactly what FRSG's ADR-0026 rejected ("a client-side PDF engine ... a second layout that never matches the print"). Keep pdf-lib for what it does now. |
| **`@react-pdf/renderer`** | Same objection: a second layout in a non-CSS engine. |
| **Cloudflare Kitesurf** | Not Chromium, "not pixel-perfect", beta. The paper is defined by Chrome's print pipeline. |
| **Vercel Sandbox** (Firecracker microVMs, [docs](https://vercel.com/docs/sandbox)) | Could run a full Chrome, but it is a per-run VM with its own SDK and billing, built for untrusted agent code; far more machinery than a 10-second render warrants. |
| **Chromium ≥ 131 on Cloudflare** (so the page's own margin boxes work and `footerTemplate` is unneeded) | Not in Expand's gift; Cloudflare publishes no version. Design for either, as FRSG does. |

---

## Comparison

| | 1. Browser print | 2. Cloudflare Browser Run (Download only) | 3. Vercel route + Sparticuz | Hosted API (Browserless) |
|---|---|---|---|---|
| Engine | The reader's browser | Chromium (measured 119 on 2026-09-04; version theirs) | Chromium 153, pinned | Chromium, version theirs |
| Fidelity to the paper | Exact in Chrome 131+ with the right dialog ticks; footerless in Safari/Firefox; Chrome adds its own header | Exact; verified on FRSG's paper | Exact in principle; unverified on this paper | Exact in principle; unverified |
| Fonts | Self-hosted, loaded before print | Self-hosted on the page; footer in Tinos → Liberation Serif fallback | Self-hosted on the page; footer serif not guaranteed (Open Sans image) | Self-hosted on the page; footer fallback unknown |
| Per-page footer (Proposal ID, Page: N) | Chromium 131+ only | `footerTemplate`, page opened `?footer=renderer` | Either mechanism | `footerTemplate` |
| Stored, immutable Signed Copy | No | Yes — one file per state in Convex storage, Approved never replaced | Yes, same | Yes, same |
| Latency on Download | Instant (user-driven) | Single-digit seconds cold, instant once cached | Cold start (pack download + launch) + render; instant once cached | Similar to 2 |
| Cost at Expand's volume | $0 | $0 on Workers Free (10 min/day ≈ 60 renders; 1 request/10 s); $5/month for 10 h if ever needed | Fractions of a cent per render; Pro plan required for commercial use ($20/seat) | $0 up to 1,000 units/month; $25/month next tier |
| Setup | Copy CSS, fonts, `ProposalPageRules` | Copy four FRSG modules minus scheduling; two Convex env vars; a paper-token route | Two deps, route handler, pack hosting, shared secret, plan check | API key on Convex; new request builder |
| Operational risk | The customer's dialog settings | Vendor moves Chromium under us (mitigated by stored bytes and `?footer=renderer`); free-tier 429s | Cold starts felt by the user; Lambda size/memory tuning | Vendor pricing and version drift |
| Reversible? | n/a | Yes: `renderPageToPdf` is the seam; option 3 slots behind it | Yes, same seam | Yes, same seam |

---

## Recommendation and integration shape

**Option 2, cached per state, behind FRSG's existing seam; option 1 stays as the free fallback.**

1. **Port** `shared/proposal-pdf.ts`, `convex/proposalPdfRenderer.ts`, `convex/proposalPdfFiles.ts`
   and `convex/proposalPdf.ts`. In `proposalPdf.ts` delete the `email` argument of
   `renderProposalPdf`, `postLetter`, `attachmentRead` and the `proposalEmails` import; keep
   `renderForStaff`, `renderForCustomer`, `renderTarget`, `recordDocument`, `downloadForStaff`,
   `downloadForCustomer`, `customerPaperProposal`. Do **not** schedule `renderProposalPdf` from
   `send` or `approve` — that is the whole of "never rendered on send". Rename the FRSG filename
   prefix in `proposalPdfFilename` to Expand's.
2. **Address.** Add a per-site paper token minted by `renderTarget` (FRSG's `ensureReportToken`
   role) and a `/paper/<token>/proposals/<id>` route that reads a query which never writes to
   `documentViews`. Honour `?footer=renderer` in the page exactly as FRSG's `page.tsx` does.
3. **Download.** Copy `PaperDownload` from `paper-screen.tsx` for the customer's top bar and sign
   bar, and the panel's Download for the owner: read `downloadFor*`; if null, call `renderFor*`,
   then open the URL it returns. FRSG's `refusalMessage` copy covers the 429 and the no-renderer
   cases.
4. **Cache policy** is FRSG's `recordDocument`: one file per state, the Sent file deleted when the
   Approved file lands or on Withdraw, the Approved file never replaced. Every render logs
   `X-Browser-Ms-Used`.
5. **Fonts.** Copy the four Tinos WOFF2 files and `fonts.css`; keep `lib/paper-fonts.ts` so a
   browser print (option 1) sets the same glyphs.
6. **Before the first production render**, run `scripts/render-pdf-check.ts` against a preview URL
   of the ported paper and read sheet count, last-sheet words and embedded faces, as FRSG's
   `convex-deployments.md` prescribes.
7. **Keep the seam.** If Cloudflare disappoints, option 3 is a second implementation of
   `renderPageToPdf` and nothing above it changes.

## Open risks

1. **Cloudflare's Chromium is not ours.** 119 when FRSG measured; unversioned; may move. Stored
   bytes make an Approved proposal immune; a Sent proposal re-rendered after a vendor change could
   look different from the customer's screen. Re-run `render-pdf-check` after any suspected change.
2. **Free-tier rate limit.** One Quick Action per 10 s; a 429 is a named fault, not a crash, and a
   second press finds the cached file. Watch the logs; $5/month removes it.
3. **The certificate's Arial** is unshipped on every Linux renderer. FRSG left it open; check the
   first production Signed Copy's page count.
4. **Chrome's own header on browser print** and the "Background graphics" tick are unverified on
   the real paper; if option 1 is ever advertised as a feature, verify through the actual dialog and
   consider `print-color-adjust: exact` for the certificate bands.
5. **Dev renders nothing** without a public origin. Same as FRSG; the check script against a
   Vercel preview is the substitute.
6. **Vercel plan.** Not a PDF question, but the fair-use definition of commercial use applies to
   the whole deployment; confirm the plan in the dashboard regardless of which option ships.

## Sources

- FRSG (`bigapejit/frsg-app`, main `6e9768d`): `docs/research/server-side-pdf.md`,
  `shared/proposal-pdf.ts`, `convex/proposalPdfRenderer.ts`, `convex/proposalPdf.ts`,
  `apps/web/app/report/print.css`, `apps/web/app/report/proposal-document.css`,
  `apps/web/app/report/fonts.css`, `apps/web/lib/paper-fonts.ts`,
  `apps/web/components/roof-report/proposal-document.tsx` (`ProposalPageRules`),
  `apps/web/components/roof-report/paper-screen.tsx` (`PaperDownload`, `data-paper`),
  `apps/web/app/report/[token]/proposals/[proposalId]/page.tsx`, `scripts/render-pdf-check.ts`,
  `docs/agents/convex-deployments.md`, `docs/verification/issue-216-save-as-pdf-proposals.md`,
  `issue-256-fonts-on-the-paper.md`, `issue-257-proposal-document.md` (Chromium 119 measurement),
  `issue-258-signed-states-and-certificate.md`, `issue-262-pdf-on-the-emails.md`,
  `docs/adr/0026-proposals-sign-on-the-document-and-honor-paper.md`.
- Expand: `package.json` (Next 16.3.4, pdf-lib, pdfjs-dist), `convex/pdfActions.ts`, `lib/pdf.ts`,
  `app/paper-screen.css`, `public/fonts/`, `docs/adr/0001-view-tracking-in-convex.md`,
  `docs/deployment.md`, `node_modules/next/dist/docs/...` (`serverExternalPackages.md`,
  `route-segment-config/maxDuration.md`, `runtime.md`).
- Cloudflare: [Browser Run pricing](https://developers.cloudflare.com/browser-rendering/platform/pricing/),
  [limits](https://developers.cloudflare.com/browser-rendering/platform/limits/),
  [/pdf Quick Action](https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/),
  [FAQ](https://developers.cloudflare.com/browser-run/faq/),
  [changelog](https://developers.cloudflare.com/browser-run/changelog/),
  [rename to Browser Run](https://developers.cloudflare.com/changelog/post/2026-04-15-br-rename/),
  [Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/),
  [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- Vercel: [Functions limits](https://vercel.com/docs/functions/limitations),
  [duration](https://vercel.com/docs/functions/configuring-functions/duration),
  [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing),
  [fair use](https://vercel.com/docs/limits/fair-use-guidelines),
  [Puppeteer on Vercel KB](https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel),
  [Puppeteer on Vercel template](https://vercel.com/templates/next.js/puppeteer-on-vercel),
  [Vercel Sandbox](https://vercel.com/docs/sandbox).
- Sparticuz: [README](https://github.com/Sparticuz/chromium),
  [npm `@sparticuz/chromium`](https://registry.npmjs.org/@sparticuz/chromium/latest) (153.0.0, ~70 MB unpacked),
  [npm `@sparticuz/chromium-min`](https://registry.npmjs.org/@sparticuz/chromium-min/latest) (46 KB).
- Puppeteer: [PDFOptions](https://pptr.dev/api/puppeteer.pdfoptions).
- Print CSS: [Chrome 131 page margin boxes](https://developer.chrome.com/blog/print-margins),
  [MDN BCD `css/at-rules/page.json`](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/page.json),
  [MDN `@page`](https://developer.mozilla.org/en-US/docs/Web/CSS/@page),
  [WebKit: Safari 18.2](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/).
- Convex: [limits](https://docs.convex.dev/production/state/limits),
  [bundling and external packages](https://docs.convex.dev/functions/bundling).
- Others: [pdf-lib README](https://github.com/Hopding/pdf-lib),
  [Browserless pricing](https://www.browserless.io/pricing).
