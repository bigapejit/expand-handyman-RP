# Expand Handyman RP

Staff portal for Expand Handyman: sites, priced solutions, proposals the customer approves through a private link, invoices with Pay now, site photos and Thumbtack leads. Built with Next.js, shadcn/Base UI, Convex and Clerk. UI primitives, navigation structure and the customer signing interaction are adapted from [FRSG](https://github.com/bigapejit/frsg-app). The words the app uses are defined in [CONTEXT.md](CONTEXT.md).

## Use

1. Sign in at https://staff.expandhandyman.com with the owner account. On first use, choose **Create your account**, use **andrew@cogtex.ai**, and verify your email. Let others in from the **Staff** page: **Invite someone** emails them a link to create their account.
2. Add a site with **New site** on the **Sites** list, or from the customer's page. Every site address is picked from Google's suggestions.
3. On the site, add solutions with their line items, then assemble a proposal from them and **Send** it. The customer approves or declines through the signing link in the email.
4. Approval raises the deposit invoice; **Job done** raises the final invoice. Invoices go out as private links with Pay now.

A signing or invoice link is a bearer credential: share it only with the intended customer. No customer login or independent identity verification is performed.

## Development

Run `npm install`, configure `.env.local` using `.env.example`, then `npx convex dev` and `npm run dev`. The app runs at http://localhost:3210.

Configure `CLERK_JWT_ISSUER_DOMAIN`, `OWNER_CLERK_ID`, `OWNER_EMAIL` and `GOOGLE_MAPS_API_KEY` in each Convex deployment. The owner is the pinned Clerk id or any verified email in `OWNER_EMAIL`; both may list several values separated by commas. On dev, `scripts/prepare-browser-test.mjs` pins its QA account in `QA_CLERK_ID` and never touches the owner's. Clerk's `convex` JWT template must include `aud: convex`, `email`, and `email_verified`. The deployment setup also restricts Clerk signups to an allowlist; the Staff page adds each invited email to it and needs `CLERK_SECRET_KEY` on the Convex deployment (see [docs/deployment.md](docs/deployment.md)).

Run `npm test`, `npm run typecheck`, and `npm run build` before deploying. Production Vercel builds run `npx convex deploy` themselves, so a push to `main` deploys the app and the backend together.

## Signing integrity

A proposal's offer is frozen when it is sent, and the customer's approval seals it with a SHA-256 fingerprint that the signed copy's certificate of completion prints. The customer signing screen reuses FRSG's `paper-screen.css`, sign-bar markup and Homemade Apple handwriting font; the font's Apache license is in `public/fonts/HomemadeApple-LICENSE.txt`.

See [deployment and verification](docs/deployment.md).
