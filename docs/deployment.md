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
