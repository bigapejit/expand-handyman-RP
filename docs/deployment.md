# Deployment and verification

## Production

- App: https://staff.expandhandyman.com
- Private repository: https://github.com/bigapejit/expand-handyman-RP
- Vercel project: `expand-handyman-rp`, connected to GitHub `main`.
- Convex production: `dashing-cricket-260`; development: `glorious-donkey-718`.
- Clerk application: Expand Handyman, separate production and development instances.
- Clerk allows `andrew@cogtex.ai` and `*@expandhandyman.com`. Production backend access is pinned to the existing owner's Clerk user ID with `OWNER_CLERK_ID`, so changing the owner's primary email preserves access; a verified email listed in `OWNER_EMAIL` counts too. Other accounts on the domain get in only once invited from the Staff page (see Staff invitations below). The development deployment lists the owner's dev account and `andrew.p@expandhandyman.com`; the browser-test seed pins its QA account in `QA_CLERK_ID` only.
- Porkbun: staff A record points to Vercel; Clerk API, account portal and email verification CNAME records are configured. Existing website and email records were preserved.

The owner must create their first production account and verify their own email. No production user password was created during setup.

Production Vercel builds run `npx convex deploy` themselves (`vercel.json`), so a push to `main` deploys both; the notes below that say to run it by hand after merging predate that. Deploy Convex by hand with `npx convex deploy --yes` only when the backend must move ahead of the app. Keep `.env.local` and `.env.production.local` out of Git.

## Staff invitations

The console is invite-only. The Staff page lists everyone let in, in the `staff` table, and anyone on it can invite or remove others; the owner's accounts pinned by `OWNER_CLERK_ID`, `OWNER_EMAIL` and, on dev, `QA_CLERK_ID` are always let in and can't be removed. The gate (`convex/auth.ts`) lets in those, a verified email with a `staff` row, and the Clerk id a row learned at its first sign-in.

Invite puts the email on Clerk's sign-up allowlist and has Clerk send an invitation pointing at `APP_ORIGIN/sign-up`. The row moves from Waiting to sign up to Has access the first time the person opens the console. Remove revokes a waiting invitation, deletes the allowlist entry the invite made, deletes a signed-in person's Clerk account, and always deletes the `staff` row last, so they are refused on their next request even if a Clerk call failed.

Convex calls Clerk's Backend API with `CLERK_SECRET_KEY`. Dev already has the test key; production needs the live key from the Clerk dashboard (API keys):

```
npx convex env set CLERK_SECRET_KEY sk_live_… --prod
```

Without it, Invite says "Invitations aren't set up on this deployment yet." and removing someone still deletes their row.

## Legacy uploaded documents

The app began as a portal for uploading a PDF, placing signature fields on it and sending it for signature. That feature was removed on 2026-09-23: proposals, which the app makes itself, are what customers sign now. Nothing was migrated. The `documents` and `documentViews` tables, the `/file` endpoint that served the PDFs, the `/documents` pages, the Dashboard's Documents card, the Customer page's Documents section, the `backfillCustomerDetails` migration and the PDF.js and pdf-lib dependencies are gone. The `access` query the owner gate reads moved to `auth.ts`, and the upload URL the Photos tab uses to `photos.ts`.

A customer opening an old document link now sees "This link is no longer live", and the signed PDF can no longer be downloaded through it. Convex accepts the schema without the two tables even where they still hold rows: they just stop being declared, and nothing in the app reads them. To tidy a deployment by hand, download any signed PDF worth keeping first, from the dashboard's Files page by the storage id in the row's `signedId` (`originalId` is the upload); then delete those files, and the `documents` and `documentViews` tables from the Data page. Files hold the proposal and invoice PDF copies and the site photos too, so delete only by those ids.

## Sites and address lookup

A customer's addresses are Sites, added with New site on the Sites list or the customer's page, or created with the customer, and corrected or deleted from Edit site on the site's own page. Every site is a Google Places pick: the browser asks Convex for suggestions (`places.suggest`), and saving a site looks the picked place up again on the server, so no site holds an address Google did not return. Both calls share one session token per dialog, so Google bills a lookup as one session.

The Google key lives only on the Convex deployments, never in the browser or on Vercel, and every lookup requires the owner's sign-in. Before the site dialog can find addresses:

1. In Google Cloud, enable **Places API (New)** and create an API key restricted to it. Convex calls Google from its own servers, so restrict the key by API, not by referrer or IP.
2. Set it on both deployments:

```
npx convex env set GOOGLE_MAPS_API_KEY <key>
npx convex env set --prod GOOGLE_MAPS_API_KEY <key>
```

Without it the address box says "Address lookup is not set up". This adds the `sites` table and a placeholder `proposals` table, so run `npx convex deploy --yes` after merging. Customers added before Sites kept their old address text until the one-off migration below moved it onto sites.

## Moving legacy addresses onto Sites

Customers created before Sites carried one free-text address in `customers.site`. A one-off action looks each non-empty one up through the same Places calls as the address box. When Google suggests exactly one place and that place is a street address, it becomes the customer's site; anything else creates no site and is reported with the original text, so the owner can add it by hand from the customer's page. Every lookup runs before anything is written, so a Google or network fault changes nothing and the run can simply be repeated. Each customer's legacy address is cleared as it is reported, which is what lets the schema drop the field.

`GOOGLE_MAPS_API_KEY` must be set on the deployment first (see above). Then:

```
npx convex run --prod migrations:sitesFromCustomers
```

It prints `{ migrated: [{ customer, site }], failed: [{ customer, address, reason }] }`: the site name each migrated customer now has, and the original text of each address that failed. A customer who already had that site, added by hand, is listed as migrated to it and gets no second one. Keep that output: after the run the failed addresses exist nowhere else. A second run finds nothing to do. Nine tests in `tests/site-migration.test.ts` cover it with stubbed Places responses.

Once it has run on a deployment, that deployment holds no legacy addresses and the schema no longer declares `customers.site`. Convex refuses a schema that existing rows break, so a deployment the migration has not run on cannot take the schema without the field. Run the migration there first, from a build that still declares the field: pushing the schema drop before it would fail, and on production that fails the Vercel build, which runs `convex deploy`.

## Sending proposals

Send, Re-send and Withdraw live in the proposal panel. Send freezes the offer and mints a signing link at `/sign/<token>`, the address invoice links share; the page asks Convex which of the two a token belongs to. Each Send or Re-send is one row in `signingLinks`, and Withdraw or Re-send ends the previous row rather than deleting it, which is the panel's link history. Opens of a proposal's link are logged in `proposalViews` (ADR 0001): the owner's own opens are previews, the page heartbeats every twenty seconds while visible and beacons `POST /seen` on hide, and a gap longer than thirty seconds adds nothing.

The signing-link email goes through Resend from a scheduled Convex action (`convex/email.ts`), plain text and with no attachment. Its outcome, `sent` with Resend's message id, `notSent` or `fault` with its code, is written onto the link, and a failed email never undoes the Send: the panel says "Email not sent" and offers the link to copy. These Convex variables drive it:

| Variable | Production | Development and previews |
| --- | --- | --- |
| `RESEND_API_KEY` | the sending-only key for `expandhandyman.com` | unset: the letter is written to the Convex log and the link records `notSent` |
| `APP_ORIGIN` | `https://staff.expandhandyman.com` | the dev origin, or unset |
| `EMAIL_FROM` | optional; defaults to `Expand Handyman <proposals@expandhandyman.com>` | optional |
| `EMAIL_REPLY_TO` | optional; defaults to `contact@expandhandyman.com` | optional |

A deployment with a key but no `APP_ORIGIN` records the fault `MISSING_APP_ORIGIN` instead of sending a letter with no link. This adds the `signingLinks` and `proposalViews` tables, so run `npx convex deploy --yes` after merging. Then send one proposal to the owner's own address and check that it arrives From `proposals@expandhandyman.com` with Reply-To `contact@expandhandyman.com`. `tests/proposal-sending.test.ts` covers every blocker, what Send freezes, Withdraw, Re-send, each email outcome with Resend stubbed at `fetch`, token resolution, and views versus owner previews.

## PDF copies

Download, in the proposal panel, on the staff paper page and in the signing page's top bar, hands over a sent or approved proposal as a PDF copy (ADR 0002). The first press renders the paper through Cloudflare Browser Run and stores the file in Convex; later presses, the owner's or the customer's, get the same file. Withdraw, Re-send and either Decline delete the sent file, and so does Approve; the signed copy is made on its first download and never replaced. Nothing renders at Send or Approve.

The renderer never opens a signing link. Each render mints a render pass, a random token for one proposal in one state, and Cloudflare opens `/paper/<pass>?footer=renderer`. The pass stops working after five minutes and is deleted when the render ends; the page's query writes nothing, so a render is never a view. With `?footer=renderer` the page leaves its own footer off and Cloudflare draws the Proposal ID and `Page: N` on every sheet, because its Chromium is older than the page-margin boxes the page uses for a browser's print.

Owner setup, once, before the first production render:

1. In FRSG's Cloudflare account, create an API token for Expand with the single permission **Account → Browser Rendering → Edit**. Keep it separate from FRSG's own token so either can be revoked alone.
2. Set both variables on production Convex only:

```
npx convex env set --prod CLOUDFLARE_ACCOUNT_ID <FRSG's account id>
npx convex env set --prod CLOUDFLARE_BROWSER_RENDERING_TOKEN <the Expand token>
```

Dev and preview deployments stay without them and answer "This deployment does not render PDFs." Production also needs `APP_ORIGIN`, already set for email, because that is the origin Cloudflare opens. Rendering shares FRSG's Workers Free allowance: one request every ten seconds and ten browser-minutes a day. Past either, Download says "Too many PDFs have been made for now" and a later press, after ten seconds or after midnight UTC, renders again. Every render logs its `X-Browser-Ms-Used`.

Before the first production render, prove the paper against a Vercel preview whose Convex deployment has a sent proposal. Mint a pass on the deployment the preview reads (add `--prod` or `--preview-name <name>` to `npx convex run` if that isn't dev) and run the check within five minutes, using the production values of the two variables locally. If the preview is behind Vercel Deployment Protection, Cloudflare's browser stops at its login: append `?x-vercel-protection-bypass=<secret>` to the page URL.

```
npx convex run pdfCopies:mintRenderPass '{"paper":{"proposalId":"<id>"},"token":"<43 URL-safe characters>"}'
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_BROWSER_RENDERING_TOKEN=… npx tsx scripts/render-pdf-check.ts https://<preview>/paper/<token> check.pdf <code>
```

`"paper":{"invoiceId":"<id>"}` mints a pass for a sent, paid or void invoice's paper instead, footed with its invoice number.

It prints the sheet count, the words on each sheet (an empty last sheet is a fault) and the embedded fonts, which should be Tinos and, on a signed copy, Homemade Apple. `python -m pip install pypdf` enables that read-out.

This adds the `renderPasses` table and the `pdfCopy` field on proposals, so run `npx convex deploy --yes` after merging. `tests/pdf-copies.test.ts` covers both papers, a proposal and an invoice, running the rules they share over each: render passes (single use, expiry, bound to one sheet, never a view), which states keep a file, and who may download, with Cloudflare stubbed at `fetch`; `tests/pdf-renderer.test.ts` covers the request and each renderer outcome.
