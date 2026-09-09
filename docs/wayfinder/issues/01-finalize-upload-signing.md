# Finalize the uploaded-PDF signing MVP

Type: grilling
Labels: wayfinder:grilling
Status: resolved
Assignee: Codex
Parent: ../map.md
Blocked by: none

## Question

Should the MVP reuse FRSG's typed signature and Convex/Clerk stack, and freeze each uploaded PDF and its placed fields when issuing its private link?

## Context

The owner has agreed to upload-first scope, one admin, private customer links, retained signed PDFs, and deferring generated proposals. See [MVP scope](../spec.md). A placement preview and viewed/signed status are the current interpretation of admin visibility.

## Comments

Recommendation: typed name rendered in script, matching FRSG; Convex storage and Clerk admin login; link issuance freezes PDF/fields and replacement invalidates old unsigned links. This reuses the existing app while supporting browser PDF completion.

## Answer

The owner confirmed: "yes reuse and then the convex yes that soudns good" in response to the typed-signature and Convex/Clerk recommendations. Reuse FRSG's typed name displayed in script, Next.js/shadcn UI patterns, Convex persistence and file storage, and Clerk login restricted to the owner. Customers use private links without accounts. Use the proposed lifecycle: freeze the PDF and placed fields at link issuance; replacing an unsigned document invalidates its old link. Save the completed PDF before marking the document signed. Admin visibility is placement preview plus viewed/signed status.

Uploaded PDFs are the MVP. Solutions, line items, generated proposals and editable terms remain deferred until after this MVP is functional. The supplied Expand SVG provides the branding. No additional product decisions block MVP implementation; service configuration and hosting remain launch prerequisites.
