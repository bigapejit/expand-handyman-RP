# Expand Handyman RP

Staff portal for uploaded PDF signing. Built with Next.js, shadcn/Base UI, Convex, Clerk, PDF.js and pdf-lib. UI primitives, navigation structure and customer signing interaction are adapted from [FRSG](https://github.com/bigapejit/frsg-app).

## Use

1. Sign in at https://staff.expandhandyman.com with the owner account. On first use, choose **Create your owner account**, use **andrew@cogtex.ai**, and verify your email.
2. Add a customer and their service address.
3. Upload an unlocked PDF (up to 20 MB / 100 pages).
4. Add signature fields to the appropriate pages, drag into position, and save.
5. Create a signing link, copy it, and send it yourself.
6. The customer reviews the PDF and types their name. The completed PDF is saved and available for download from the same link and the staff workspace.

Creating a link locks the document and fields. Withdrawing an unsigned link revokes access and makes fields editable again. Signed documents are immutable. Upload a new document for changes. The link is a bearer credential: share it only with the intended customer. No customer login or independent identity verification is performed.

## Development

Run `npm install`, configure `.env.local` using `.env.example`, then `npx convex dev` and `npm run dev`. The app runs at http://localhost:3210.

Configure `CLERK_JWT_ISSUER_DOMAIN` and `OWNER_CLERK_ID` in each Convex deployment. Until the owner's ID is pinned, `OWNER_EMAIL` is an exact verified-email allowlist. Clerk's `convex` JWT template must include `aud: convex`, `email`, and `email_verified`. The deployment setup also restricts Clerk signups to the owner.

Run `npm test`, `npm run typecheck`, and `npm run build` before deploying. Deploy backend changes with `npx convex deploy --yes`; Vercel deploys the Next.js app from GitHub main. Convex backend deployment is currently a separate command.

## Signing integrity

Signature fields are stored in page-relative coordinates. PDF rotation and crop origins are accounted for. A server-issued signing attempt freezes name and timestamp. The browser embeds the signature and certificate, then uploads the completed PDF. The backend independently reconstructs the same PDF and compares SHA-256 before committing the signature. Retry and withdrawal checks run in an atomic mutation. Files are served through authenticated/token-checked HTTP handlers with no-store caching.

## Roadmap

Uploaded PDFs are the MVP. FRSG-style solutions, priced line items, generated proposals and editable terms are deferred. No Cloudflare Workers, document emails, payments or releases are included.

The signature font is Allura, distributed under the SIL Open Font License in `public/fonts/OFL.txt`.

See [deployment and verification](docs/deployment.md) and the [Wayfinder roadmap](docs/wayfinder/map.md).
