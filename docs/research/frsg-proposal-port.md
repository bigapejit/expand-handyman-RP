# Porting FRSG's Solutions, Proposals, paper and signing to Expand

Research resolving [issue #10](https://github.com/bigapejit/expand-handyman-RP/issues/10)
(part of map [#8](https://github.com/bigapejit/expand-handyman-RP/issues/8)).

Date: 2026-09-22.

## Question

Which FRSG files implement Solutions to Proposals end to end, and which of their dependencies
must be cut for Expand (no roof records, releases, deals, contacts, Cloudflare)?

## Sources

Every path below was read in a shallow clone of
[bigapejit/frsg-app](https://github.com/bigapejit/frsg-app) at merge commit `6e9768d`
(PR #424), and in this repo at `40ee825`. Paths are relative to each repo root. `convex/`,
`shared/` and `docs/` are FRSG's backend and docs; `apps/web/` is FRSG's Next app; Expand's
files are named with an explicit "Expand" prefix. Nothing here is from memory: where a claim
is about behaviour, the function that carries it is named. The one external source is the
statute itself, [RCW 18.27.114](https://app.leg.wa.gov/rcw/default.aspx?cite=18.27.114).

Standing decisions for Expand that every verdict below respects: no roof records, no
Releases, no Deals, no Change Sets, no Contacts (one recipient: the customer), no Cloudflare
render on Send, no PDF attachments, Washington-only tax and the RCW 18.27.114 notice kept,
Terms as a code constant, Notes per Proposal, owner-only staff.

---

## TL;DR

- FRSG's proposal system is **two layers with a clean seam**. `shared/` holds all the rules
  (pricing, tax, payment split, signing consent, notice band, sealing) as pure TypeScript
  with no Convex imports and 1,193 lines of unit tests; `convex/` and `apps/web/` hold the
  I/O. The `shared/` layer ports **verbatim** except for one struct field
  (`linkedRoofItemIds`) and one business-facts file. The I/O layer must be **rewritten around
  Expand's tables**, not copied, because every roofing dependency lives there.
- Roofing reaches the proposal code through exactly **four fields and three imports**:
  `solutions.linkedRoofItemIds`, `frozen.solutions[].linkedRoofItemIds`,
  `proposals.sentAgainstReleaseId`, `sites.reportToken`; and `convex/releases.ts`
  (`latestRelease`, `sketchGeometryForSite`, `sketchGeometryForProposal`, `siteHeading`),
  `convex/liveSnapshot.ts`, `convex/roofItemImages.ts`. Cutting those cuts every sketch page,
  marker number and flagged-record picker.
- **Contacts** are the deepest non-roofing dependency: `signingLinks.contactId`,
  `signature.contactId`, `declinedByContactId`, `send({contactIds})`, `verifiedRecipients`,
  `recipientBlockers`, `clientForSite`, and the whole `Recipients` panel. With one recipient
  per Proposal, a Signing Link needs no Contact and Expand's existing token-on-the-row model
  (`documents.token`) is enough.
- **Cloudflare and Resend** are already behind seams (`convex/proposalPdf*.ts`,
  `convex/proposalEmails.ts`, `convex/email.ts`) and are dropped whole. The only things that
  reach into the lifecycle are `scheduleDocumentRender` / `discardProposalDocument` calls in
  `send`, `resend`, `withdraw`, `decline`, `declineFromLink` and `approve`, and the
  `proposals.document` field.
- Expand **already has** the paper chrome (`app/paper-screen.css`, ported from FRSG and
  carrying unused `.proposal-document`, `.paper-notice*` hooks), an adapted `SignBar`, the
  Homemade Apple font, token issue/withdraw, view logging, and consent recording. What it
  lacks is `proposal-document.css`, `fonts.css` (Tinos), the `ProposalDocument` renderer, the
  Solutions and Proposals staff panels, and every `shared/` rule module.
- Four surprises: (1) FRSG's paper **never prints the Terms text**, only the sentence
  "I/we agree to the terms and conditions of this proposal."; the Terms constant is shown only
  on the staff panel. (2) FRSG's notice band (`$1,000 <= total < $60,000`) is the
  **commercial** rule of RCW 18.27.114; the residential rule has no upper bound, and Expand
  is residential. (3) Expand's `customers.site` is one free-text string, but the DOR lookup
  needs `addressLine1` plus `city` or `postalCode`, and the tax branch needs `region`.
  (4) FRSG's paper prints dates in **UTC**, Expand's signing code prints America/Los_Angeles.

---

## 1. The shape of the thing (domain and lifecycle)

From `CONTEXT.md` (**Solution**, **Line Item**, **Catalog**, **Markup**, **Sales Tax**,
**Proposal**, **Signing Link**, **Signature**, **Notice to Customer**, **Terms**, **Notes and
exclusions**, **Payment Terms**, **Proposal Document**, **Signed Copy**) and
`docs/adr/0024`, `0025`, `0026`:

- A **Solution** is one priced piece of work at a Site: title, Scope of Work, Line Items
  (name, quantity, unit, unit cost), an optional per-Solution Markup, and zero or more flagged
  Roof Records it addresses. Price is never typed: cost is the sum of `quantity x unitCostCents`
  rounded once, marked up by a whole percent (default 10), rounded **up** to the whole dollar.
  A Solution with no Line Items has no price (`null`, not `$0`).
- A **Proposal** is an ordered set of Solutions at a Site plus `depositPercent`, a `tax`
  record, `notes`, an optional `name`, a `recommended` mark (at most one per Site) and a
  per-Site `number` that never compacts. Lifecycle: `draft -> sent -> approved | declined`;
  `withdraw` returns `sent -> draft`. A Draft reads Solutions live; **Send** writes a `frozen`
  copy (title, Scope of Work, price, record links, Line Item name/quantity/unit, totals,
  deposit split, Terms, tax record, Notes, Estimator) and from then on every reader uses the
  copy (ADR-0024). Approve and Decline are the customer's acts through a Signing Link; nobody
  countersigns (ADR-0025). Signing happens on the paper itself, and an ink signature can be
  recorded by staff (ADR-0026).
- A **Signing Link** is minted per Contact at Send, and ended (never deleted) by Approve,
  Decline, Withdraw or a re-send. Live means: link unended AND proposal `sent` AND `frozen`
  present (`liveLinkForToken`). After a decision the paper stays readable through the link
  (`paperStillOpenedBy`) so the signer's tab shows the stamp rather than "expired".
- **Approve** seals the frozen offer to a canonical JSON string with a SHA-256 fingerprint,
  records the consent wording and version the signer saw (and the WA notice wording if it
  applied), the network address, user agent and first-open time, and ends the links.

---

## 2. Backend inventory: `convex/schema.ts` slices

| Slice | Fields (verbatim) | Verdict | What forces the change |
|---|---|---|---|
| `solutionLineItemValidator` (line 74) | `name: string`, `quantity: number`, `unitCostCents: number`, `unit?: string` | **Keep** | none |
| `proposalTaxValidator` (line 93) | `source: "lookup" \| "override" \| "none"`, `rate?: number`, `locationCode?: string`, `period?: string` | **Keep** | none (`"none"` becomes unreachable for a WA-only app but is harmless) |
| `frozenLineItemValidator` (line 104) | `name`, `quantity`, `unit: string` | **Keep** | none |
| `frozenSolutionValidator` (line 115) | `solutionId: id("solutions")`, `title`, `scopeOfWork`, `priceCents`, `linkedRoofItemIds: id("roofItems")[]`, `lineItems?: frozenLineItem[]` | **Adapt**: drop `linkedRoofItemIds` | roof records |
| `proposalEstimatorValidator` (line 137) | `name`, `phone?`, `email?` | **Drop** (owner-only: the Estimator is a constant in the business file, not a per-Send snapshot of a `staffMembers` row) | staff roster |
| `sealedProposalValidator` (line 147) | `document: string`, `fingerprint: string` | **Keep** | none |
| `electronicSignatureValidator` (line 159) | `method?: "electronic"`, `signerName`, `signerTitle?`, `contactId: id("contacts")`, `signingLinkId: id("signingLinks")`, `signedAt`, `networkAddress?`, `userAgent?`, `firstOpenedAt?`, `consentWording`, `consentWordingVersion`, `noticeShown: boolean`, `noticeTicked: boolean`, `noticeWording?`, `noticeWordingVersion?`, `sealed` | **Adapt**: drop `contactId`; `signingLinkId` becomes whatever Expand keys its link by (see section 6) | contacts |
| `paperSignatureValidator` (line 188), `signatureValidator` union | `method: "paper"`, `signerName`, `signerTitle?`, `signedOn`, `scanStorageId`, `recordedBy`, `recordedByName`, `recordedAt`, `sealed` | **Drop** (Expand spec excludes paper-signature recording) | ADR-0026 paper path |
| `signingLinkEndedReasonValidator` (line 207) | union of `SigningLinkEndedReasons` = `["approved","declined","withdrawn","resent"]` from `shared/signing-link.ts` | **Keep** if a link table is kept | none |
| `emailOutcomeValidator`, `signingLinkEmailEventValidator` (lines 225, 237) | `"sent" \| "notSent" \| "fault"`; Resend events | **Drop** | Resend |
| `paymentMethodValidator` (line 247) | from `PaymentMethods` in `shared/proposal-standing.ts` | **Drop** | payments out of MVP |
| `sites.lastProposalNumber` (line 746) | `v.optional(v.number())`; bumped inside the same transaction by `issueProposalNumber` (`convex/proposals.ts` line 1602) | **Adapt**: move to `customers` (one site per customer) | no `sites` table in Expand |
| `sites.reportToken` (line 730) | permanent Roof Report token, also the address of the Signed Copy | **Drop** | Releases / Roof Report |
| `solutions` (line 1298) | `siteId`, `title`, `description`, `position`, `lineItems?`, `markupPercent?`, `linkedRoofItemIds: id("roofItems")[]` (required), `createdBy`, `createdByName`, `updatedBy`, `updatedByName`, `createdAt`, `updatedAt`; index `by_site_position ["siteId","position"]` | **Adapt**: `siteId -> customerId`, drop `linkedRoofItemIds`, audit names can collapse to one owner | roof records, sites |
| `proposals` (line 1337) | `siteId`, `number`, `name?`, `state: draft\|sent\|approved\|declined`, `solutionIds: id("solutions")[]`, `recommended: boolean`, `depositPercent`, `tax`, `notes?`, `frozen?: { solutions: frozenSolution[], subtotalCents, taxCents, totalCents, depositPercent, terms: string, tax, notes?, estimator? }`, `sentAt?`, `sentBy?`, `sentByName?`, `sentAgainstReleaseId?: id("releases")`, `document?: { storageId, renderedAt, state: "sent"\|"approved" }`, `approvedAt?`, `signature?`, `declinedAt?`, `declineReason?`, `declinedByContactId?`, `settled?: {reason, by, byName, at}`, audit six; indexes `by_site ["siteId"]`, `by_state_sent ["state","sentAt"]` | **Adapt**: `siteId -> customerId`; drop `sentAgainstReleaseId` (Releases), `document` (Cloudflare), `declinedByContactId` (contacts), `settled` (payments), `frozen.estimator` (roster); keep everything else including `by_state_sent` for the dashboard | Releases, Cloudflare, contacts, payments |
| `payments` (line 1469) | money received | **Drop** | payments out of MVP |
| `signingLinks` (line 1499) | `proposalId`, `contactId`, `token`, `sentAt`, `firstOpenedAt?`, `endedAt?`, `endedReason?`, `emailOutcome?`, `emailFault?`, `emailId?`; indexes `by_proposal`, `by_token`, `by_email_id` | **Adapt or replace** (section 6): drop `contactId`, `email*`; either keep a one-row-per-send table or put `token` on the proposal as Expand's `documents` already does | contacts, Resend |
| `signingLinkEmailEvents`, `unplacedEmailEvents` | Resend webhook rows | **Drop** | Resend |
| `customerViews`, `customerViewAllowances` | FRSG's view log | **Drop**: Expand's `documentViews` (ADR 0001 in this repo) already does this per token, with heartbeat duration | already covered |
| `catalogEntries` (line 1662) | `normalizedName`, `name`, `lastUnitCostCents`, `lastUnit?`, `useCount`, `updatedAt`; index `by_normalized_name` | **Keep verbatim** | none |
| `counters` (line 1918) | `name`, `value`; `by_name` | not used by proposals (LeakStop order numbers) | n/a |

---

## 3. Backend inventory: `convex/*.ts`

| File (lines) | Exports | Verdict | Forcing dependency |
|---|---|---|---|
| `convex/proposals.ts` (1998) | queries `forSite`, `dashboardForStaff`, `previewForReport`, `previewDocumentForToken`, `staleSiblings`; action `createProposal`; internal `insertDraft`, `storeLookedUpRate`; mutations `updateProposal`, `setRecommended`, `duplicateProposal`, `deleteProposal`, `send`, `withdraw`, `resend`, `decline`, `approve`, `generateUploadUrl`, `recordPaperSignature`, `declineFromLink`; helpers `staleSiblingProposals`, `draftProposalsBySolution`, `dropSolutionFromDrafts`, `ensureReportToken` | **Adapt (rewrite around Expand tables, keeping the lifecycle rules)**. Keep the logic of `insertDraft` (tax source from region, number issue), `storeLookedUpRate` (never overwrites an override or a non-Draft), `updateProposal` (name/solutionIds/notes/deposit/taxRate, `NotesMaxLength = 8000`), `setRecommended` (one per site in one transaction), `duplicateProposal`, `deleteProposal` (Draft only), `send` (`refuseSend(sendBlockers)`, `frozenOffer`), `withdraw` (ends links, clears `frozen` and the Send stamp), `resend` (ends links, mints fresh, `frozen` unchanged), `decline`, `approve` (section 5.3), `declineFromLink` (`ReasonMaxLength = 2000`), `staleSiblings`, `draftProposalsBySolution`, `dropSolutionFromDrafts`. Drop: `previewForReport`/`previewDocumentForToken` (report-token keyed; replace with an owner-auth Draft preview by id), `generateUploadUrl`/`recordPaperSignature`, `ensureReportToken`, `estimatorAtSend`, `verifiedRecipients`/`contactsOfCustomer`/`recipientsOf`, `mintSigningLinkEmails`/`signedCopyLetter`/`scheduleDocumentRender`/`staffEmailFor`/`uniqueAddresses`, `readPayments` plumbing, `requireProposalSending` (role gate; owner-only means `requireOwner`) | roof (`latestRelease` at send/resend lines 761, `sketchGeometryForSite` line 337); contacts; Cloudflare (`discardProposalDocument`, `scheduleDocumentRender`); Resend (`internal.proposalEmails.sendDeclineNote`); payments; staff roles (`hasStaffCapability`, `staffMemberForSubject`) |
| `convex/solutions.ts` (430) | `forSite`, `createSolution`, `updateSolution`, `moveSolution`, `deleteSolution` | **Adapt**: keep the mutations' shape (title required, `verifiedLineItems` via `lineItemFault`, `markupPercentFault`, `rememberLineItems` on every save, `dropSolutionFromDrafts` on delete, manual `position` ordering); drop `linkedRoofItemIds`/`verifiedLinks`, `flagged`/`buildings`/`sections` from `forSite`, `signedUrlEpoch` arg | `liveSnapshot`, `roofItemImages.withDeliveryUrls`, `roofItems` |
| `convex/signingLinks.ts` (243) | `SigningLinkStatus`, `signingLinkStatus`, `signingLinksForProposal`, `mintSigningLinks`, `endSigningLinks`, query `resolve`, `LiveSigningLink`, `liveLinkForToken`, `paperStillOpenedBy`, mutation `markOpened`, internal `recordEmailOutcome`, `linkForToken` | **Adapt**: keep the two liveness readings (`liveLinkForToken` for acts, `paperStillOpenedBy` for reads after a decision), `resolve`'s one-word answer, `markOpened`; drop `contactId`, `recordEmailOutcome`, `placeWaitingEvents`. `mintLinkToken` (`convex/shared.ts` line 152: 24 random bytes, base64url) is generic; Expand mints 32 bytes hex in the browser (`components/document-editor.tsx`) instead, which is a style choice not a conflict | contacts, Resend |
| `convex/proposalSigning.ts` (164) | queries `forSigningLink`, `proposalDocumentForToken`, `signedCopyForToken` | **Adapt**: keep `forSigningLink`'s return shape (`status`, `proposalId`, `number`, `signerName`, `copySentTo`, `noticeRequired`, `declinedWithReason`, `document`), minus `release` and `copySentTo` (no email). Drop the two report-token queries; the Signed Copy reads under the owner's auth or the same signing token | `releases.sketchGeometryForProposal`, `siteHeading`, report token |
| `convex/proposalReportData.ts` (~270) | `reportProposalsForSite`, `proposalUnderReportToken`, `reportProposal`, `draftProposalForReport`, `ProposalClient`, `clientForSite`, `staffAsEstimator`, `ProposalEstimator` | **Adapt**: keep `reportProposal` -> `frozenProposalForReport` (the projection the paper renders from: identity, display name, state, dates, `...frozen`, signature projection) and `draftProposalForReport` (live Solutions "as if Sent now"); drop `proposalUnderReportToken`, `reportProposalsForSite` (`sketchApart`, `standing`), `staffAsEstimator`, `contactNamesForLatestSend`; `clientForSite` collapses to the customer's name | releases type, report token, contacts, payments, roster |
| `convex/catalog.ts` (120) | `normalizeCatalogName`, query `suggestions` (prefix scan on `by_normalized_name`, `SuggestionScanLimit = 500`, `SuggestionsLimit = 6`, ranked by `useCount`), `rememberLineItems` | **Keep verbatim** (swap `requireStaffIdentity` for `requireOwner`) | none |
| `convex/salesTax.ts` (69) | action `lookupForSite`, internal `siteAddress`, `fetchAddressRates` | **Keep**, re-pointed at wherever Expand stores the address (section 5.1) | `sites` shape |
| `convex/proposalSignature.ts` | `StoredSignature`, `PaperSignature`, `isPaperSignature`, `signatureScanIds` | **Drop** except the `StoredSignature` type alias | paper path |
| `convex/proposalPdf.ts`, `proposalPdfFiles.ts`, `proposalPdfRenderer.ts` | Cloudflare Browser Rendering `/pdf` (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_BROWSER_RENDERING_TOKEN`), stored `proposals.document`, `renderForStaff`, `renderForCustomer`, `downloadForStaff`, `downloadForCustomer` | **Drop whole** | Cloudflare, PDF attachments |
| `convex/proposalEmails.ts`, `email.ts`, `signingLinkEmailEvents.ts`, `resendWebhook*.ts` | `sendSigningLink`, `sendSignedCopy`, `sendDeclineNote` over Resend | **Drop whole** | Resend |
| `convex/proposalPayments.ts` | `recordPayment`, `deletePayment`, `markSettled`, `readPayments` | **Drop** | payments |
| `convex/migrations.ts` `numberProposals`, `stampLineItemUnits`, `pinProposalReleases`, `stripRetiredSolutionFields` | backfills | **Drop** (greenfield: make `number` and `unit` required from day one) | history |
| `convex/staffRoles.ts`, `shared/staff-access.ts` | Proposal Sender role | **Drop** | owner-only |

Integration tests to mine, not copy (they use `convex-test`, which Expand already has):
`convex/proposals.integration.test.ts` (792), `proposalSigning.integration.test.ts` (905),
`proposalSending.integration.test.ts` (1086), `solutions.integration.test.ts` (1287),
`salesTax.integration.test.ts` (122).

---

## 4. Shared rules: `shared/*.ts`

All of these import nothing from Convex. Unit tests sit beside each (`*.test.ts`).

| File (lines) | Exports | Verdict | Notes |
|---|---|---|---|
| `shared/money.ts` (26) | `formatCents` (drops `.00`), `formatCentsExact` (paper column) | **Keep verbatim** | test 18 lines |
| `shared/line-item-units.ts` (47) | `LineItemUnits = ["EA","SF","LF","HR","DA","WK"]`, `LineItemUnit`, `DefaultLineItemUnit = "EA"`, `lineItemUnitLabel`, `isLineItemUnit`, `readLineItemUnit` | **Keep**; the list is the one place a unit is validated, so a handyman unit (e.g. "JOB") is one edit | test 47 |
| `shared/solution-pricing.ts` (219) | `DefaultSolutionMarkupPercent = 10`, `MaxSolutionMarkupPercent = 1_000`, `readMarkupPercent`, `MarkupFault`, `markupPercentFault`, `markupFaultMessage`, `SolutionLineItem`, `OfferedLineItem`, `offeredLineItems`, `SolutionPrice`, `lineCostCents`, `priceSolution` (integer arithmetic: `ceil(costCents * (100 + markup) / 10_000)` dollars), `PriceableSolution`, `priceStoredSolution`, `LineItemFault`, `lineItemFault`, `lineItemFaultMessage` | **Keep verbatim** | test 268 |
| `shared/proposal-pricing.ts` (229) | `ProposalTax`, `ProposalMoney`, `chargedTaxRate`, `proposalMoney` (tax = `round(subtotal * rate)` once), `DefaultDepositPercent = 50`, `PaymentSplit`, `splitPayment` (final = remainder), `paymentTermsSentence`, `ProposalFault`, `depositPercentFault`, `taxRateFault` (decimal `< 1`), `proposalFaultMessage`, `SendBlocker`, `sendBlockers` (`no_solutions`, `unpriced_solution`, `no_tax_rate`), `recipientBlockers` (`no_recipients`, `recipient_without_email`), `sendBlockerMessage`, `proposalDisplayName` (`"Untitled proposal"` or titles joined with `" + "`) | **Keep**, minus `recipientBlockers` and its two blocker words | contacts; test 247 |
| `shared/proposal-standing.ts` (210) | `PaymentMethods`, `proposalStanding`, `termsCoverage`, `paymentDue`, payment/settled faults, `isCalendarDay`, `calendarDayAtUtc` | **Drop** (only `isCalendarDay` is imported by `proposal-signing.ts`, for the paper path) | payments |
| `shared/proposal-signing.ts` (273) | `NoticeBandCents = { from: 100_000, below: 6_000_000 }`, `noticeToCustomerApplies`, `SigningConsent = { version: "2026-09-02", wording(n) }`, `signerDisplayName`, `SignatureStamp`, `isDrawableScan`, `SigningFault`, `signingFaults`, `signingFaultMessage`, `SealedProposalInput`, `SealedProposal`, `sealProposal`, `fingerprintOf`, `PaperSignatureFault`, `paperSignatureFaults`, `paperSignatureFaultMessage` | **Adapt**: keep consent, faults, seal; drop `isDrawableScan` and the three `paperSignature*` exports; remove `linkedRoofItemIds` from `SealedProposalInput.offer.solutions`; revisit `NoticeBandCents` (section 5.2); rewrite the wording (it says "on behalf of the customer", which reads oddly when the signer is the customer) | roof records, paper; needs `@noble/hashes` (FRSG `package.json`: `^2.2.0`), which Expand does not have; test 312 |
| `shared/wa-sales-tax.ts` (253) | `AddressRatesEndpoint`, `WaSalesTaxAddress`, `AddressRatesReply`, `WaSalesTaxRate`, `WaSalesTaxFault`, `WaSalesTaxResult`, `isWashingtonRegion`, `addressRatesUrl`, `lookUpWaSalesTax`, `readAddressRates` | **Keep verbatim** (with `docs/research/wa-tax-rate-lookup.md`, which records the live DOR responses the rules came from) | test 244 |
| `shared/frsg-business.ts` (85) | `Unknown = "<unknown>"`, `FrsgBusiness` (`phone`, `email`, `ccbLicense`, `serviceArea`, `fedId`, `emailFrom`, `waContractorRegistration`, `waContractorBond`, `waRegistrationExpires`), `FrsgProposalTerms = Unknown`, `WashingtonNoticeToCustomer = { version: "rcw-18.27.114:2026-09-02", title, acknowledgement, text }` | **Adapt** into an Expand business file: real phone/email, WA L&I registration number, bond and expiry (FRSG left all three `<unknown>`), drop `ccbLicense` (Oregon) and `emailFrom`; write real `Terms` | branding, statute blanks |
| `shared/signing-link.ts` (small), `shared/token-link.ts` | `signingPath`, `signingUrl`, `SigningLinkEndedReasons`; `tokenPath`, `tokenUrl` | **Keep** (Expand builds `${origin}/sign/${token}` inline today) | tests 22 + 35 |
| `shared/proposal-pdf.ts` (198) | `proposalCode(siteName, number) = "<Site>-P<n>"`, then Cloudflare request builders | **Keep only `proposalCode`** | Cloudflare |
| `shared/roof-report-link.ts`, `customer-views.ts`, `signing-link-email.ts`, `staff-access.ts` | report paths, view pages, Resend events, roles | **Drop** | Releases, Resend, roles |

---

## 5. Three wirings the ticket asked about

### 5.1 WA DOR tax lookup

1. `api.proposals.createProposal` (action, `convex/proposals.ts` line 381) runs
   `internal.proposals.insertDraft`, which sets
   `tax: { source: isWashingtonRegion(site.region) ? "lookup" : "none" }` and returns `taxed`.
2. If taxed it runs `api.salesTax.lookupForSite({ siteId })`, whose handler reads the address
   (`addressLine1`, `city`, `region`, `postalCode`) through `internal.salesTax.siteAddress`
   and calls `lookUpWaSalesTax(address, fetchAddressRates)`.
3. `shared/wa-sales-tax.ts` refuses to call DOR unless `addressLine1` and (`city` or
   `postalCode`) are present (`isLookupReady`), builds
   `https://webgis.dor.wa.gov/webapi/AddressRates.aspx?ver=1&output=xml&addr=&city=&zip=`,
   and reads the reply by regex: HTTP not 2xx -> fault; content type without "xml" -> `NOT_XML`
   (the WAF block page); result code 5 or 6 -> `noRate` (5 is the ZIP-centroid trap); codes
   0-4 -> a rate with `locationCode` padded to four digits and `period` like `Q32026`.
4. A rate lands through `internal.proposals.storeLookedUpRate`, which refuses to overwrite a
   non-Draft, a non-`lookup` source, or a rate already present.
5. A staff-typed rate goes through `updateProposal({ taxRate })` (line 467): it becomes
   `source: "override"`, keeps `locationCode`, drops `period`, and is refused on a
   `source: "none"` Proposal (`site_not_taxed`).
6. `sendBlockers` adds `no_tax_rate` when `source !== "none"` and `rate` is undefined, so a WA
   Proposal cannot be Sent without a rate. Send copies the record into `frozen.tax`.
7. The paper prints `Subtotal` and `Sales Tax (x%)` rows only when a rate was charged
   (`GrandTotal` and `taxSentence` in `apps/web/components/roof-report/proposal-document.tsx`).

For Expand: every customer is in Washington, so the `"none"` branch is dead but the
`lookup -> noRate -> override` path is exactly what a handyman needs. The blocker is data:
Expand's `customers.site` is a single string (`convex/schema.ts` in this repo), and the lookup
needs the street line plus city or ZIP as separate fields, and `region` for
`isWashingtonRegion`. An address shape on the customer is a prerequisite ticket.

### 5.2 RCW 18.27.114 Notice to Customer

- Text: `WashingtonNoticeToCustomer` in `shared/frsg-business.ts`. Nine statutory paragraphs
  joined with `"\n\n"`, with the registration number, bond amount and expiry interpolated from
  `FrsgBusiness.waContractorRegistration` / `waContractorBond` / `waRegistrationExpires`.
  The closing "I have received a copy of this disclosure statement." is the tick's label
  (`acknowledgement`), not part of the block. `version` is bumped whenever the text or the
  facts change.
- Whether it applies: `noticeToCustomerApplies(region, totalCents)` in
  `shared/proposal-signing.ts`: `isWashingtonRegion(region) && total >= $1,000 && total < $60,000`.
- Server: `proposalSigning.forSigningLink` returns
  `noticeRequired: noticeToCustomerApplies(site.region, proposal.frozen.totalCents)`.
- Client: `apps/web/components/roof-report/sign-bar.tsx` `SignForm` renders, when
  `noticeRequired`, a `.paper-notice` block with `.paper-notice-title` = `title`,
  `.paper-notice-text` = `text`, and a `.paper-tick` checkbox labelled `acknowledgement`;
  `signingFaults` adds `notice_required` if it is unticked. The page sends
  `noticeWordingVersion: WashingtonNoticeToCustomer.version` with `approve`.
- Mutation: `approve` calls `refuseStaleWording(args.noticeWordingVersion, Notice.version)`
  when required (`wording_stale` -> reload), and writes `noticeShown`, `noticeTicked`,
  `noticeWording: Notice.text`, `noticeWordingVersion` onto the signature.
- Paper: `CertificateOfCompletion` prints `Notice to Customer: <standing>` on the certificate
  page (`"Not applicable" | "Not required" | "Shown and acknowledged" | "Shown; not acknowledged"`)
  and, when `signature.notice` exists, a second `.pd-page.pd-certificate` sheet with the
  **stored** wording, the acknowledgement line and the version.

Two things to change before porting the band. The statute
([RCW 18.27.114](https://app.leg.wa.gov/rcw/default.aspx?cite=18.27.114), read 2026-09-22)
has two arms in subsection (1): "(a) For the repair, alteration, or construction of four or
fewer residential units or accessory structures on such residential property when the bid or
contract price totals one thousand dollars or more; or (b) for the repair, alteration, or
construction of a commercial building when the bid or contract price totals one thousand
dollars or more but less than sixty thousand dollars". FRSG coded arm (b). Expand's work is
arm (a), which has the $1,000 floor and no ceiling, so `NoticeBandCents.below` goes. The same
section requires the contractor to "retain a signed copy of the disclosure statement in his
or her files for a minimum of three years", which is what the `noticeWording` /
`noticeWordingVersion` fields on the signature satisfy. And the three registration blanks must
be real values for Expand; FRSG ships them as `<unknown>` on purpose. (Research note, not
legal advice.)

### 5.3 How `sealProposal` fingerprints the offer

`shared/proposal-signing.ts`, called once from `approve` (`convex/proposals.ts` line 855) and
once from `recordPaperSignature`:

```ts
sealProposal({
  proposalId: proposal._id,
  number: proposal.number,
  name: proposalDisplayName(proposal.name, frozen.solutions.map(s => s.title)),
  site: siteAddressFields(site),        // addressLine1, addressLine2?, city?, region?, postalCode?
  sentAt: proposal.sentAt ?? proposal.updatedAt,
  sentByName: proposal.sentByName ?? proposal.updatedByName,
  offer: frozen,                        // the whole frozen block
})
```

`sealProposal` builds one object with keys `proposalId, number, name, site, sentAt,
sentByName, solutions, subtotalCents, taxCents, totalCents, tax, depositPercent,
paymentTerms (= paymentTermsSentence(depositPercent)), terms, notes`, runs it through
`canonicalJson` (keys sorted at every depth, `undefined` members omitted, no whitespace), and
returns `{ document, fingerprint: sha256(utf8(document)) as lowercase hex }` using
`@noble/hashes/sha2.js`. Deliberately **not** sealed: the Estimator (who to call, not a term),
the signer, the signing time, and the network facts; those live beside `sealed` on the
signature. Because every input was frozen at Send, the same Proposal seals to the same bytes on
any later day, and `fingerprintOf(document)` lets a stored copy be checked without re-sealing.
`solutions[].linkedRoofItemIds` is inside the sealed shape today and drops out for Expand.

Why noble and not Web Crypto: the seal is computed synchronously inside the `approve`
mutation. Expand's `lib/signing.ts` `sha256` is async `crypto.subtle`, used from the browser
and a Node action (`convex/pdfActions.ts`). Reuse FRSG's choice rather than test whether
Convex's mutation runtime exposes `crypto.subtle`.

---

## 6. Web inventory: `apps/web/`

Paths differ from the ticket: the signing route, sign bar and paper screen live in
`components/roof-report/`, and all four stylesheets in `app/report/`. There is one
`proposal-document.tsx` (its parts are private functions), plus a route wrapper and a test.
Aliases: `@convex/*` -> `convex/_generated/*`, `@shared/*` -> `shared/*`.

| File (lines) | What it is | Verdict | Roofing/infra to cut |
|---|---|---|---|
| `components/site-solutions.tsx` (981) | `SiteSolutions({siteId})`: list + side panel, `LineItemTable` (Name/Qty/Unit/Unit cost/Cost, reorder, remove), Markup field, Cost -> Markup -> Price readout, Catalog autocomplete (`api.catalog.suggestions`) | **Adapt** | `flagged`/`sections`/`buildings`, `SolutionRecordPicker`, `RecordMarker`, `RecordPhotoImg`, `RoofFigures`, `useSignedUrlEpoch`, `@/lib/roof-report-presentation`, `@/lib/solution-records`, `staleLinks`/`addressesLine` from `@/lib/solutions` |
| `components/site-proposals.tsx` (2132) | `SiteProposals({siteId})`: `SolutionPicker`, `MoneyReadout` (tax override), `PaymentTerms`, `FrozenOffer` (shows Terms), `RecommendedToggle`, `SendRow` (blockers), `SentActions` (Withdraw / Re-send / Decline), signing URL copy | **Adapt (heavily)** | `Recipients`/`RecipientRow` (contacts), `DownloadPdfButton` (`api.proposalPdf.*`), `RecordPaperSignatureForm`/`PaperSignatureRecord`, `Payments`/`RecordPaymentForm`/`SettleForm`, `api.staffRoles.viewerAccess` gate, `reportPreviewPath`/`signedCopyPath` ("Preview is available after this Site has a Release") |
| `components/roof-report/proposal-document.tsx` (1060) | `ProposalDocument({proposal, site, client?, release?, pending?, footer})`: `Letterhead`, `CoverBlock`, `Letter`, `AgreeAndSign` (two signature lines, pencil, `pd-sign-here` tag), `SolutionBlock` (DESCRIPTION/QTY, Scope of Work), `GrandTotal`, `CertificateOfCompletion`; exports `ProposalClient`, `PendingSignature` | **Adapt (the core of the port)** | `release`/`SketchSheet`/`markerNumbers`/`sketchesFor`/`solutionMarkers` ("Sketch markers: ..."), `"Type of Proposal: Roof repair"`, `.roof-report-shell:has(...)` selectors in `ProposalPageRules`, `/frsg-logo-vertical.svg`, `"FRSG Representative"` label, `InPersonSignerEvents`/scan branch, `footer="renderer"` branch, `ReportSite` from `roof-report-presentation` |
| `components/roof-report/report-proposals.tsx` (173) | `ReportProposal`, `ReportSignature` types (the paper's props shape) | **Keep the two types**, minus `linkedRoofItemIds`, `sketch`, `standing`, `contactNames`, the paper-signature branch | as listed |
| `components/roof-report/proposal-document-route.tsx` (148) + `app/report/[token]/proposals/[proposalId]/page.tsx` | paper under the report token, staff Draft-preview fallback | **Replace** with an owner-auth preview route by proposal id | report token, `useCustomerView`, `RendererFooterParam` |
| `components/roof-report/signing-route.tsx` (242) + `app/sign/[token]/page.tsx` (31) + `app/sign/layout.tsx` (40) | `SigningRoute({token, networkAddress, userAgent, staff})`: `forSigningLink`, `markOpened` once, `approve` with wording versions + IP/UA, `declineFromLink`; page reads `x-forwarded-for` via `forwardedAddress` | **Adapt into Expand's `components/signing-page.tsx`**: swap `PdfPages` for `ProposalDocument`; keep the approve args | `document.release`, `link={{ signingToken }}` download, `ReplayScope`/`isStaffRequest` |
| `components/roof-report/sign-bar.tsx` (407) | `SignBar`, `ReaderBar`, `SignatureInput {signerName, signerTitle, consentTicked, noticeTicked}` | **Re-adapt**: Expand's `components/sign-bar.tsx` (284) is already this file minus the `.paper-notice` block, `noticeTicked`, `SigningConsent.wording(number)`, `totalAndValidity` and the `HelpBeforeNumber`/`paper-tel` line | none |
| `components/roof-report/paper-screen.tsx` (290) | `PaperScreen` (scale-to-fit via `--paper-scale`, `loadPaperFonts` then `paperImagesSettled` -> `data-paper="ready"`), `PaperLoading`, `scrollToCertificate`, `scrollToSignatureLine` | **Adapt**: drop `PaperDownload`/`CustomerPaper`/`release`; the `usePaperFit` logic is what makes the 8.5in sheet readable on a phone | Cloudflare download, `/frsg-logo-horizontal.png` |
| `app/report/proposal-document.css` (590) | `.proposal-document` (8.5in, Tinos 10.5pt), `.pd-page` (11in min, 0.5in/0.45in/0.75in padding), `pd-*` and `pc-*` classes, `.pd-script` (Homemade Apple 14pt `#1a1f7a`), `.pd-sign-here` (`#ffd000`, nudge keyframes), print `break-before` | **Keep verbatim** (recolour if wanted) | none |
| `app/report/paper-screen.css` (421) | `.paper-screen`, `.paper-bar`, `.paper-form*`, `.paper-notice*`, strips, buttons, mobile and print rules | **Already ported** as Expand `app/paper-screen.css` (476 lines, plus `.paper-pdf-*`); diff before touching | none |
| `app/report/print.css` (374) | `@page { size: letter portrait; margin: 0.55in 0.6in 0.75in }` and body reset, then `.roof-report-*`/`.rrp-*` | **Keep only the `@page` block** | Roof Report print |
| `app/report/fonts.css` (72) | `@font-face` Tinos 400/400i/700/700i + Homemade Apple, `font-display: block`, from `public/fonts/*.woff2` (`Tinos-OFL.txt`, `HomemadeApple-LICENSE.txt`) | **Keep**; Expand has Homemade Apple already, needs the four Tinos files | none |
| `app/report/sketch-sheet.css` (73) | roof sketch pages | **Drop** | roof |
| `lib/paper-fonts.ts` (100) | `paperSerifStack`, `paperScriptStack`, `paperPrintFaces`, `paperFontTimeoutMs = 3000`, `loadPaperFonts()` (never rejects) | **Keep verbatim** | none |
| `lib/frsg-letterhead.ts` (28) | `LetterheadName = "Flat Roof Systems Group"`, `letterheadContactLines()` (`NEXT_PUBLIC_FRSG_CONTACT_LINES` override, else service area / phone-email / `OR License ... Fed ID`) | **Adapt** to Expand: name, WA registration line | branding |
| `lib/proposal-paper.ts` (155) | `ValidityDays = 30`, `validUntil`, `PaperTimeZoneLabel = "(UTC+00:00) ..."`, `paperDate`, `paperStamp` (UTC), `paperTitle`, `totalAndValidity`, strips, `telHref`, `paperScale` | **Keep**, but decide the time zone (section 7) | none |
| `lib/paper-images.ts` (33), `lib/signing.ts` (76: `signedStamp`, `declinedStamp`, `contactPhrase`, `forwardedAddress`, `longCalendarDay`) | helpers | **Keep**; note FRSG's `lib/signing.ts` collides by name with Expand's `lib/signing.ts` (different contents), so merge `forwardedAddress` into Expand's or rename | none |
| `lib/solutions.ts` (273), `lib/proposals.ts` (390) | staff-panel field parsing and line wording (`readLineItems`, `draftPrice`, `markupField`, `taxRateField`, `sendBlockedReason`, `sentLine`, `signedLine`, ...) | **Adapt**: drop `FlaggedRecord`/`addressesLine`/`staleLinks` and the recipient/payment lines | roof, contacts, payments |
| `components/side-panel.tsx` (114), `proposal-chips.tsx` (24), `copy-link.tsx` (63), `lib/refusal.ts` (43), `hooks/use-app-origin.ts` (21) | small shared UI | **Keep** | none |
| `components/solution-record-picker.tsx` (452), `hooks/use-customer-view.ts`, `components/replay-scope.tsx`, `lib/roof-sketches.ts`, `roof-plan-drawing.tsx`, `roof-report-print.tsx` | roofing and analytics | **Drop** | roof, view analytics (Expand has `documentViews`) |

Data flow into the paper: `ProposalDocument` is pure and props-driven. Its props come from
`api.proposalSigning.forSigningLink(...).document`, `api.proposalSigning.proposalDocumentForToken`
and `api.proposals.previewDocumentForToken`, each spreading `reportProposal(ctx, proposal)`
plus `site`, `client`, `release`. Expand needs one such query for the signing token and one
for owner preview.

---

## 7. What Expand already has, mapped to FRSG

| Expand (this repo) | FRSG equivalent | Reuse note |
|---|---|---|
| `convex/schema.ts` `documents.status` `draft \| ready \| viewed \| signed \| declined`, `token`, `issuedAt`, `viewedAt`, `signedAt`, `signerName`, `signerTitle`, `consent`, `consentVersion`, `userAgent`, `declinedAt`, `declineReason` | `proposals.state` + `signingLinks` + `signature` | Expand's `ready`/`viewed` split is what FRSG derives from `signingLinks.firstOpenedAt`. A proposal table can keep FRSG's four states and let `documentViews` answer "viewed" |
| `documents.issue`/`withdraw` (`convex/documents.ts`): freeze `customerName`+`site` on issue, clear on withdraw, refuse when signed | `send`/`withdraw`: freeze the offer, end links | Same shape; Expand's version already has the "withdraw invalidates the old link" rule the spec asked for |
| `documents.token` on the row, 64-hex minted in the browser, `by_token` index, "draft = dead link" | `signingLinks` table, `mintLinkToken` server-side, `endedAt`/`endedReason` history | With one recipient, token-on-the-row works. Cost: no `firstOpenedAt` / `endedReason` history per send, but `documentViews` already records opens per token with `previousLink` |
| `documentViews` + `opened`/`seen`/`recordSeen` + `/seen` beacon (ADR 0001) | `signingLinks.markOpened`, `customerViews` | Keep Expand's; FRSG's `firstOpenedAt` on the signature can be read from the earliest customer `documentViews` row for that token |
| `beginSigning` intent + `pdfActions.finish` + `commitSigned` (client renders the PDF, server re-renders and compares SHA-256) | `approve` (seal JSON, no file) | A generated proposal has no uploaded PDF to complete; `approve`'s seal replaces the hash check. Whether Expand stores any PDF of a signed proposal (browser print, or none) is an open decision, since FRSG's answer was Cloudflare and ADR-0026 rejected client-side PDF engines |
| `lib/signing.ts` `CONSENT`, `CONSENT_VERSION = "2026-09-09"`, `signerName` (2-100 chars, no control chars), `signingDate` (America/Los_Angeles `MM/DD/YYYY`), `sha256` (async) | `SigningConsent`, `signerDisplayName`, `paperDate` (UTC), `fingerprintOf` (sync noble) | Two wording constants will coexist unless unified; pick one time zone for paper and certificate (FRSG prints UTC with `PaperTimeZoneLabel`; Expand prints Pacific) |
| `components/sign-bar.tsx` ("Adapted directly from FRSG's roof-report/sign-bar.tsx") | `components/roof-report/sign-bar.tsx` | Add back the notice block and the proposal sum |
| `components/signing-page.tsx` (`paper-screen paper-screen-signing`, heartbeat, `PdfPages`, `SignBar`) | `signing-route.tsx` + `paper-screen.tsx` | Same chrome; swap the pages component for `ProposalDocument` and add `usePaperFit` |
| `app/paper-screen.css` (476) | `app/report/paper-screen.css` (421) | Already carries `.proposal-document`, `.paper-sheets-scaled`, `.paper-notice*`, `.paper-tel`, `.paper-bar-note`, `.paper-strip-note` unused |
| `app/globals.css` Homemade Apple `@font-face`, `.signature-ink`; `lib/handwriting-font.ts` | `fonts.css`, `.pd-script` | Add Tinos; `lib/signature-font.ts` (Allura) is dead and can go |
| `customers {name, email, phone, site}`, `lib/customer.ts` (zod, phone/email normalisation) | `customers` + `sites` (address fields) + `contacts` | Keep; add structured address fields for the tax lookup and the paper's Property block |
| `convex/auth.ts` `requireOwner`/`isOwner` | `requireStaffIdentity`, `requireProposalSending`, `staffMemberForSubject` | One gate replaces three; the Estimator block becomes constants |
| `components/dashboard.tsx` `Status` badge, `staff-shell.tsx`, `brand.tsx` | `proposal-chips.tsx`, `(shell)` layout | Keep Expand's |
| Expand `docs/wayfinder/spec.md` "Findings from reference app" | this document | Supersedes those five bullets |

---

## 8. Dependency-cut matrix

| Standing decision | Where FRSG touches it | Cut |
|---|---|---|
| No roof records | `solutions.linkedRoofItemIds`, `frozenSolution.linkedRoofItemIds`, `SealedProposalInput.offer.solutions[].linkedRoofItemIds`, `solutions.forSite.flagged`, `verifiedLinks`, `SolutionRecordPicker`, `solutionMarkers`, `lib/solution-records.ts`, `lib/solutions.ts` `staleLinks`/`addressesLine` | drop the field everywhere; delete the picker and marker line |
| No Releases | `proposals.sentAgainstReleaseId`, `latestRelease` in `send`/`resend`, `sketchGeometryFor*` in the three document queries, `SketchSheet` pages, `sketch-sheet.css`, `sites.reportToken` and every `*ForToken` query, `reportPreviewPath`/`signedCopyPath`, "Preview is available after this Site has a Release" | drop; preview and Signed Copy become owner-auth reads by id |
| No Deals / Change Sets | Nothing in the proposal modules imports `convex/deals*.ts` or `changeSets.ts`; the dependency runs the other way (the Deal timeline reads `signingLinks.endedReason` and `signingLinkEmailEvents`, issue #318) | none needed beyond not porting |
| No Contacts | `signingLinks.contactId`, `signature.contactId`, `declinedByContactId`, `send({contactIds})`, `resend`, `verifiedRecipients`, `recipientBlockers`, `recipientsOf`, `contactNamesForLatestSend`, `clientForSite`, `forSite.contacts`, `Recipients` panel, `customerStamp("contact:...")` | the customer is the recipient; `signerName` pre-fills from `customers.name` |
| No Cloudflare, no PDF attachments | `proposals.document`, `scheduleDocumentRender`, `discardProposalDocument`, `convex/proposalPdf*.ts`, `shared/proposal-pdf.ts` (all but `proposalCode`), `PaperDownload`, `DownloadPdfButton`, `footer="renderer"`, `ProposalDocumentReadySelector` | drop; keep `print.css`'s `@page` so the browser's own print is a letter sheet |
| No email | `convex/proposalEmails.ts`, `email.ts`, `signingLinkEmailEvents.ts`, `resendWebhook*.ts`, `emailOutcome`/`emailId`, `copySentTo`, `sendDeclineNote` | drop; the owner copies the link (Expand already does this) |
| Washington-only tax and notice kept | section 5.1 and 5.2 | keep verbatim; give the customer an address; fix the residential band and the three registration blanks |
| Terms as a code constant | `FrsgProposalTerms` in `shared/frsg-business.ts`, frozen into `frozen.terms` at Send, shown in `FrozenOffer` only | keep the mechanism; decide whether the paper should print it (FRSG's does not) |
| Notes per Proposal | `proposals.notes` (8,000 chars), `frozen.notes`, sealed, printed in the letter | keep verbatim |
| Owner-only staff | `requireProposalSending`, `hasStaffCapability`, `staffAsEstimator`, `frozen.estimator`, `createdByName`/`updatedByName` | replace with `requireOwner`; Estimator becomes the business constant |

---

## 9. Surprises and gotchas

1. **The paper does not print the Terms.** `proposal-document.tsx` never reads
   `proposal.terms`; line 348 prints only "I/we agree to the terms and conditions of this
   proposal." The Terms text appears solely in the staff panel (`site-proposals.tsx` line 825).
   The customer signs under Terms they can only read in the consent sentence ("including its
   Terms and Payment Terms"). For a handyman with real terms this is a decision, not a copy.
2. **The notice band is the commercial arm of the statute.** `NoticeBandCents.below` exists
   because FRSG is commercial; residential work (RCW 18.27.114(1)(a), quoted in section 5.2)
   has the $1,000 floor and no ceiling.
3. **FRSG ships the WA registration facts as `<unknown>`** and prints the gap. Expand must
   supply registration number, bond and expiry, or the notice is not the statutory notice.
4. **Expand has no address.** `customers.site` is one string. The DOR lookup, the
   `isWashingtonRegion` branch, `siteAddressFields` in the seal and the paper's Property block
   all want `addressLine1`, `addressLine2?`, `city`, `region`, `postalCode`.
5. **UTC versus Pacific.** FRSG's paper and certificate stamp in UTC and say so
   (`PaperTimeZoneLabel`); Expand's `signingDate` uses America/Los_Angeles. One of them wins.
6. **Two SHA-256s.** FRSG seals synchronously with `@noble/hashes` inside a mutation; Expand
   hashes asynchronously with Web Crypto in the browser and a Node action. Add noble.
7. **Two `lib/signing.ts` files** with different exports; FRSG's `forwardedAddress` (reads
   `x-forwarded-for`, `x-real-ip`, `x-vercel-forwarded-for`) is the piece worth keeping.
8. **The proposal number needs a home.** `sites.lastProposalNumber` is bumped in the same
   transaction as the insert; Expand should put it on `customers`. `proposalCode` prints
   `<Site>-P<n>`; Expand has no site name, so the code needs a new first half (customer name,
   or a fixed prefix).
9. **`signingLinks` is optional.** The table exists to hold one link per Contact and the
   Resend join. With one recipient and `documentViews` already logging opens by token, the
   token can sit on the proposal row as it does on `documents`. What is lost is the per-send
   `endedReason` history, which only the Deal timeline read.
10. **`solutions` are per Site, not per Customer, in FRSG**, and a Solution can sit in several
    Draft Proposals at once (`draftProposalsBySolution` shows where an edit lands). With one
    site per customer the sharing rule carries over unchanged with `customerId`.
11. **Line counts for planning.** Keep-verbatim: `shared/` rules about 1,200 lines plus 1,193
    lines of tests; `catalog.ts` 120; `salesTax.ts` 69; `proposal-document.css` 590;
    `fonts.css` 72; `paper-fonts.ts` 100; `proposal-paper.ts` 155. Adapt: `proposals.ts`
    1,998, `solutions.ts` 430, `signingLinks.ts` 243, `proposalSigning.ts` 164,
    `proposalReportData.ts` about 270 on the backend; `site-proposals.tsx` 2,132,
    `site-solutions.tsx` 981, `proposal-document.tsx` 1,060, `sign-bar.tsx` 407,
    `paper-screen.tsx` 290, `signing-route.tsx` 242, `lib/proposals.ts` 390,
    `lib/solutions.ts` 273 on the web. Roughly a third of the adapt lines are the parts being
    cut.
