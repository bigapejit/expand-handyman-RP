# Deployment and verification

## Production

- App: https://staff.expandhandyman.com
- Private repository: https://github.com/bigapejit/expand-handyman-RP
- Vercel project: `expand-handyman-rp`, connected to GitHub `main`.
- Convex production: `dashing-cricket-260`; development: `glorious-donkey-718`.
- Clerk application: Expand Handyman, separate production and development instances.
- Owner signup is restricted to `andrew@cogtex.ai`. Backend access also requires that exact verified email until `OWNER_CLERK_ID` is pinned.
- Porkbun: staff A record points to Vercel; Clerk API, account portal and email verification CNAME records are configured. Existing website and email records were preserved.

The owner must create their first production account and verify their own email. No production user password was created during setup.

Deploy Convex with `npx convex deploy --yes` when backend or shared PDF code changes. Push frontend changes to `main` for Vercel deployment. Keep `.env.local` and `.env.production.local` out of Git.

## Verification on 2026-09-09

- Automated tests cover owner authorization, private link scope, view tracking, withdrawal, signing retries, immutable completed documents, tampered PDF rejection and rotated page geometry.
- A synthetic development customer and two-page PDF exercised the real authenticated upload API, browser field placement, link creation, customer consent and signing, persisted completion and reopening.
- Desktop and mobile customer layouts were inspected. Full-font embedding fixes missing Allura letters in downloaded PDFs; normal and rotated pages and the signature record were checked visually.
- Production HTTPS and the Clerk login screen were checked. The first production owner session remains for the owner to complete.
- Browser automation could not operate Chrome's file chooser because the extension's file URL access was disabled. The upload was verified through the authenticated API; the rest of the flow was exercised in the browser.

Development helpers in `scripts/prepare-browser-test.mjs`, `scripts/create-test-pdf.mjs`, and `scripts/upload-test-document.ts` use a synthetic test identity. The authentication/upload helpers refuse production credentials. Test artifacts and temporary login links live in ignored `test-results/`.

## FRSG customer flow and placement update

The customer screen now ports the original FRSG paper-screen CSS and signing-sheet markup, including the bottom Sign/Decline bar, live name preview, optional title, yellow tag and Homemade Apple font. Only Expand branding and uploaded-document wording replace proposal-specific information. No FRSG business terms or notice text are added to uploaded PDFs.

Eleven tests cover the expanded lifecycle: owner signature authorization and freezing, requirement for a customer signature, independently placed dates, two-signer PDF verification, forged owner-signature rejection, decline/completion races and two-dimensional resize bounds. A browser test confirmed corner resizing changes width and height without moving the field. Desktop and mobile customer screens were inspected, and a synthetic customer completed the FRSG sheet against a document with an owner signature and four fields. The saved PDF was inspected on normal and rotated pages.

`scripts/prepare-signing-preview.ts` prepares that four-field synthetic development fixture. Existing signed files remain stored unchanged. Previously issued unsigned links keep their placed fields; withdraw them to add new fields or an owner signature.

Signature alignment now measures the handwriting's visible glyph bounds instead of its font-wide ascender/descender spacing. Preview and PDF export share one layout calculation, with visible ink positioned two PDF points above the field's bottom edge. The editor shows a customer-name preview and bottom alignment guide. Three regression cases cover both ordinary names and descending letters; all 14 tests pass. A rendered PDF with explicit placement boxes confirms signatures and dates sit above their bottom guides.

## View log

Every open of a signing link is recorded in the `documentViews` table with who opened it, the link token, the document status at the time, the user agent and a last-seen time. The owner's own opens are recognised from their Clerk session and logged as previews, so they never change document status. Customers' first view still moves a document from "Link ready" to "Viewed". The signing page heartbeats every twenty seconds while visible and beacons `POST /seen` on hide; each update adds only the time since the previous one, and a gap longer than thirty seconds adds nothing. Documents viewed before this change fall back to their first-viewed time in the feed and dashboard. The editor's Activity card lists every open with its duration, a "You" tag and a "Previous link" tag, and the dashboard shows the last customer view. Twelve tests in `tests/views.test.ts` cover the owner/customer split, heartbeat clamping, previous-link tagging, opens after signing or declining, the beacon endpoint and the duration formatter.

This adds a table and two indexes, so run `npx convex deploy --yes` after merging.

## Frozen customer details

A document is a snapshot. Issuing its signing link copies the customer's name onto the document, and from then on the dashboard, the editor and the signing page read that copy, so renaming a customer never rewrites an issued or signed document. A draft has no copy and still shows the live customer; withdrawing a link drops the copy and returns the document to the live customer until it is issued again. Documents issued before Sites also copied the customer's one free-text address; they keep showing it in the document editor's header, and a withdrawn one drops it with the rest of the copy.

Documents issued before this change carry no copy, and until they are backfilled they still follow a renamed customer. Run the one-off backfill immediately after `npx convex deploy --yes`:

```
npx convex run --prod migrations:backfillCustomerDetails
```

It skips drafts and any document already frozen, so it is safe to run twice. It freezes a bounded page per run and reports `done: false` if more are waiting; repeat until it reports `done: true`. Five tests in `tests/signing.test.ts` cover the frozen issued document, the site text kept by documents issued before Sites, edits reaching only drafts, the live draft and the backfill.

## Sites and address lookup

A customer's addresses are Sites, managed on the customer page's Sites tab and optionally created with the customer. Every site is a Google Places pick: the browser asks Convex for suggestions (`places.suggest`), and saving a site looks the picked place up again on the server, so no site holds an address Google did not return. Both calls share one session token per dialog, so Google bills a lookup as one session.

The Google key lives only on the Convex deployments, never in the browser or on Vercel, and every lookup requires the owner's sign-in. Before the Sites tab can find addresses:

1. In Google Cloud, enable **Places API (New)** and create an API key restricted to it. Convex calls Google from its own servers, so restrict the key by API, not by referrer or IP.
2. Set it on both deployments:

```
npx convex env set GOOGLE_MAPS_API_KEY <key>
npx convex env set --prod GOOGLE_MAPS_API_KEY <key>
```

Without it the address box says "Address lookup is not set up". This adds the `sites` table and a placeholder `proposals` table, so run `npx convex deploy --yes` after merging. Customers added before Sites keep their old address text until the one-off migration moves it onto sites.

## Moving legacy addresses onto Sites

Customers created before Sites carry one free-text address in `customers.site`. A one-off action looks each non-empty one up through the same Places calls as the address box. When Google suggests exactly one place and that place is a street address, it becomes the customer's site; anything else creates no site and is reported with the original text, so the owner can add it by hand on the customer's Sites tab. Every lookup runs before anything is written, so a Google fault changes nothing and the run can simply be repeated. Each customer's legacy address is cleared as it is reported, which is what lets the schema drop the field.

`GOOGLE_MAPS_API_KEY` must be set on the deployment first (see above). Then:

```
npx convex run --prod migrations:sitesFromCustomers
```

It prints `{ migrated: [{ customer, site }], failed: [{ customer, address, reason }] }`: the site name each migrated customer now has, and the original text of each address that failed. A customer who already had that site, added by hand, is listed as migrated to it and gets no second one. Keep that output: after the run the failed addresses exist nowhere else. A second run finds nothing to do. Eight tests in `tests/site-migration.test.ts` cover it with stubbed Places responses.
