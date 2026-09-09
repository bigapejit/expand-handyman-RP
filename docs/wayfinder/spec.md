# Expand Handyman document signing

Status: MVP implemented and deployed. Proposal builder deferred. See [deployment and verification](../deployment.md).

## Agreed MVP

- One admin, the owner, with authenticated access.
- Customers have one site each.
- Upload an existing PDF; no document authoring required for MVP.
- Preview the PDF and drag signature fields onto its pages.
- Create and copy a private customer signing link; the owner sends it manually.
- One customer signer per document; no customer account required.
- Customer reviews and signs the PDF in their browser.
- Retain completed PDFs so owner and customer can download them later.
- Admin can preview signature placement and see draft, link-ready, viewed and signed states. Live activity viewing is not included in the proposed MVP interpretation.
- Signed documents are frozen; subsequent changes require a new document copy.
- Reuse FRSG UI and signing patterns, with shadcn and Expand branding.
- Customer signing directly reuses FRSG's paper-screen CSS, bottom Sign/Decline bar, opening sheet, yellow Sign here tag and Homemade Apple font. Adapt only branding and uploaded-document wording.
- Place customer signature/date and owner signature/date fields independently. Resize width and height by corner drag, numeric inputs or Shift + arrows.
- The owner applies their signature in the draft before link issuance. Each signer's date uses their own server-recorded signing time. Customers may decline with an optional reason, visible to staff.
- Supplied logo: C:/Users/andyp/Downloads/expand-handyman-favicon.svg. SVG colors: charcoal #2E3337 and amber #E29B0C.

## Deferred

Solutions and priced line items, generated proposals, editable handyman terms, and reuse of FRSG's proposal layout. These remain in the Wayfinder roadmap.

## Excluded

Cloudflare Workers, Resend/email delivery, releases, multiple sites per customer, and additional admin users. Payments and paper-signature recording are not part of the proposed MVP.

## Findings from reference app

Source: https://github.com/bigapejit/frsg-app, main commit prefix 6bd520f, inspected using authenticated GitHub reads.

- Next.js 16, React 19, Tailwind 4, shadcn/Base UI, Convex and Clerk.
- Existing signing uses typed names rendered in script on fixed signature lines. Arbitrary uploaded PDFs and draggable signature fields are new functionality.
- Existing proposal PDF rendering uses Cloudflare Browser Rendering REST; browser PDF completion needs a separate implementation.
- Relevant sources: apps/web/components/site-solutions.tsx, site-proposals.tsx, roof-report/proposal-document.tsx, app/report/proposal-document.css, convex/proposals.ts, signingLinks.ts and proposalSigning.ts.
- Existing proposal preview depends on releases; that dependency must not carry into this app.
- FRSG-specific terms and business details must be replaced in the later proposal phase.

## Agreed technical approach

Reuse Next.js, shadcn, Convex persistence/file storage and Clerk admin authentication. Customer links use private tokens with server-side access checks. Render uploaded PDFs in the browser, save page-relative field coordinates, embed the signature into the PDF in the browser, and persist the completed PDF. Mark signed only after completion is durably saved. Customer signing must work across devices, independently of admin browser storage.

## Signing interaction and lifecycle

- Typed name displayed in script, matching FRSG; no drawn signature pad for MVP.
- Convex and Clerk with an owner-only admin account.
- Link issuance freezes the PDF and fields; replacing an unsigned document invalidates its previous link.

## Implementation acceptance checks

- Owner can add a customer with one site, upload a multipage PDF, place fields on chosen pages, and copy a signing link.
- Field placement remains aligned across admin preview, mobile customer preview and downloaded PDF.
- Customer can open the link without an account, review the PDF, enter their name, consent and sign.
- Completion saves the signed PDF before displaying success; retrying does not create conflicting signed copies.
- Owner sees viewed/signed status and can reopen and download the saved signed PDF; customer can download it too.
- Private files and admin operations are protected; invalidated links stop granting access.
- Signed documents cannot be edited.

## Launch prerequisites

Vercel, production Convex, Clerk owner restrictions and Porkbun DNS are configured. Production URL: https://staff.expandhandyman.com. The owner creates their first production account with andrew@cogtex.ai and verifies their email.
