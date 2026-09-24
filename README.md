# Expand Handyman RP

Staff portal for uploaded PDF signing. Built with Next.js, shadcn/Base UI, Convex, Clerk, PDF.js and pdf-lib. UI primitives, navigation structure and customer signing interaction are adapted from [FRSG](https://github.com/bigapejit/frsg-app).

## Use

1. Sign in at https://staff.expandhandyman.com with the owner account. On first use, choose **Create your owner account**, use **andrew@cogtex.ai**, and verify your email.
2. Add a customer, and their sites on the customer page's **Sites** tab. Every site address is picked from Google's suggestions.
3. Upload an unlocked PDF (up to 20 MB / 100 pages).
4. Add customer signature/date fields and, if needed, your own signature/date fields. Drag to position; drag a corner to resize both dimensions, or enter width and height. Apply your own signature before sending.
5. Create a signing link, copy it, and send it yourself.
6. The customer sees the FRSG paper layout, presses the yellow **Sign here** tag or the bottom **Sign document** button, and completes the signing sheet. They may also decline with a reason. The completed PDF is saved and available from the same link and the staff workspace.

Creating a link locks the document and fields. Withdrawing an unsigned link revokes access and makes fields editable again. Signed documents are immutable. Upload a new document for changes. The link is a bearer credential: share it only with the intended customer. No customer login or independent identity verification is performed.

## Development

Run `npm install`, configure `.env.local` using `.env.example`, then `npx convex dev` and `npm run dev`. The app runs at http://localhost:3210.

Configure `CLERK_JWT_ISSUER_DOMAIN`, `OWNER_CLERK_ID`, `OWNER_EMAIL` and `GOOGLE_MAPS_API_KEY` in each Convex deployment. The owner is the pinned Clerk id or any verified email in `OWNER_EMAIL`; both may list several values separated by commas. On dev, `scripts/prepare-browser-test.mjs` pins its QA account in `QA_CLERK_ID` and never touches the owner's. Clerk's `convex` JWT template must include `aud: convex`, `email`, and `email_verified`. The deployment setup also restricts Clerk signups to the owner.

Run `npm test`, `npm run typecheck`, and `npm run build` before deploying. Deploy backend changes with `npx convex deploy --yes`; Vercel deploys the Next.js app from GitHub main. Convex backend deployment is currently a separate command.

## Signing integrity

Signature fields are stored in page-relative coordinates. PDF rotation and crop origins are accounted for. A server-issued signing attempt freezes name and timestamp. The browser embeds the signature and certificate, then uploads the completed PDF. The backend independently reconstructs the same PDF and compares SHA-256 before committing the signature. Retry and withdrawal checks run in an atomic mutation. Files are served through authenticated/token-checked HTTP handlers with no-store caching.

## Roadmap

Uploaded PDFs are the MVP. FRSG-style solutions, priced line items, generated proposals and editable terms are deferred. No Cloudflare Workers, document emails, payments or releases are included.

The customer signing screen reuses FRSG's `paper-screen.css`, sign-bar markup and Homemade Apple handwriting font. The font's Apache license is in `public/fonts/HomemadeApple-LICENSE.txt`. Branding and document-specific wording are adapted for Expand. Date fields use each signer's server-recorded signing time, displayed in America/Los_Angeles; the certificate records UTC timestamps.

See [deployment and verification](docs/deployment.md).
