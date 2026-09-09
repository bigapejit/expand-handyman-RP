# Expand Handyman signing and proposal roadmap

Labels: wayfinder:map

## Destination

Agree a build-ready path to launch uploaded-PDF customer signing first, then add FRSG-style solutions and generated proposals in a later phase.

## Notes

Use grilling and domain-modeling for unresolved product decisions. Local Markdown is the tracker because this workspace has no configured issue tracker. The current agreed requirements and reference findings are in [MVP scope](spec.md). Prioritize a small, functional MVP and reuse FRSG UI. Logo is supplied locally. No Workers, Resend, or releases.

## Decisions so far

- [Finalize the uploaded-PDF signing MVP](issues/01-finalize-upload-signing.md): implemented with FRSG-style typed signatures, Convex storage, owner-only Clerk login, and upload-first scope.
- Production: https://staff.expandhandyman.com on Vercel, with Porkbun DNS. [Deployment and verification](../deployment.md).

## Not yet specified

[Plan the proposal builder](issues/02-plan-proposal-builder.md) next: solutions, priced line items, generated proposals and editable handyman terms. The owner must create their production login using the allowlisted email before their first staff session.

## Out of scope

Email delivery, Cloudflare Workers, releases, multi-site customers, and multiple admins for MVP.
