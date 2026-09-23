# FRSG payment recording, inventoried for porting onto invoices

Research resolving issue #60 (Wayfinder research, map #59). Question: what did FRSG build
to record money received by hand against an Approved Proposal, what ports verbatim once
"proposal" becomes "invoice", what has to be rewritten, and exactly what FRSG left for the
"later collection effort" that Stripe and Plaid would plug into.

Date: 2026-09-23. Sources are the FRSG source itself (shallow clone of
https://github.com/bigapejit/frsg-app at commit `d6c8e09`, PR #427 merged), FRSG issues #193
and #217, FRSG PR #236 (the implementation), and Expand's own `origin/main` at `e8f3734`.
Line numbers below are from those commits.

---

## TL;DR

- FRSG's payment recording is small: one table, one 210-line pure-rules module with 30
  tests, one 204-line Convex module with three mutations and one shared read, and a
  ~380-line panel block. Nothing is stored on the Proposal but an optional `settled` mark;
  the standing is derived from the rows on every read.
- **Ports verbatim** (find-and-replace `proposalId` -> `invoiceId`): the `payments` table
  shape, `paymentMethodValidator`, the method list and labels, `paymentFault` and its
  messages, the calendar-day helpers, `canDeletePayment`, `recordPayment` and
  `deletePayment`, the `RecordPaymentForm` and `PaymentRow` components, and the
  dollars/date field helpers (Expand already has the dollars ones).
- **Must be rewritten**: everything that reads the *standing*. FRSG's standing is two lines
  ("Deposit received", "Paid in full") computed off a percent split of one Proposal total.
  Expand's invoice standing is four states (Unpaid, Partly paid, Paid, Overdue) computed
  off one invoice amount and a due date. `Ledger`, `proposalStanding`, `termsCoverage`,
  `paymentDue`, `requireApproved`, the projection fields, the standing box in the panel,
  and the Roof Report line all change shape or disappear.
- **The seam for Stripe/Plaid** is exactly two things: the `online` member of the method
  union (accepted by the validator, refused by every hand path) and the optional
  `processorReference` column that no hand path writes. Five places in code know about
  `online`; all five port as-is.
- **Delete-only, no edit** is a deliberate rule (issue #193): a wrong figure is deleted and
  recorded again; only the recorder may delete; an `online` row can never be deleted by
  hand. With Expand's single owner the "recorder only" half is trivially true, but the
  fields that carry it (`recordedBy`, `recordedByName`) are what make an `online` row
  undeletable, so they stay.

---

## 1. Where the decisions came from

| Source | What it settled |
|---|---|
| FRSG issue #193 "Payment Terms and the manual paid mark" (grilled 2026-09-01, 9 questions) | Two-part terms (deposit on signing, final on completion) as whole percents; Payment is a record not a tick (amount, method, date received, note); recorded on an Approved Proposal only, by any staff; standing derived from the running total; delete by the recorder only, no correcting entries; Settled mark with a one-line reason; customer sees only two quiet lines; the door for collection is "an `online` Payment carrying its processor reference, which staff cannot edit or delete". Explicitly **no ADR**: "nothing here is hard to reverse". |
| FRSG issue #217 "Payments and Settled on an Approved Proposal" (build ticket) | The schema, the rules module, the panel, the report line, and the acceptance figures ($10,200 split 50/50; $5,100 -> Deposit received; $10,200 -> Paid in full; 0% never shows Deposit received; Settled short -> Paid in full; overpayment -> Paid in full). |
| FRSG PR #236 (merged 2026-09-03) | The implementation and its judgement calls (section 6 below). |
| FRSG `CONTEXT.md` lines 286-296 | Glossary entries **Payment Terms**, **Payment**, **Settled**. |

Issue #193 also lists what was deliberately *not* decided: the payment-received email,
what a change order does to Payment Terms after a deposit is in, refunds, and everything
about collecting money.

## 2. Inventory of what exists in FRSG

### 2.1 Schema (`convex/schema.ts`, 1939 lines)

- `paymentMethodValidator` (lines 239-247): a `v.union` of `v.literal`s **derived from**
  `PaymentMethods` in `shared/proposal-standing.ts`, so the schema and the rules list
  cannot drift.
- `proposals.settled?` (lines 1432-1443): `{ reason, by, byName, at }`, written once, no
  un-settling.
- `payments` table (lines 1457-1479):

  ```ts
  payments: defineTable({
    proposalId: v.id("proposals"),
    amountCents: v.number(),
    method: paymentMethodValidator,
    receivedOn: v.string(),               // calendar day, YYYY-MM-DD
    note: v.optional(v.string()),
    processorReference: v.optional(v.string()),  // only the later collection effort writes it
    recordedBy: v.string(),
    recordedByName: v.string(),
    recordedAt: v.number(),
  }).index("by_proposal", ["proposalId"]),
  ```

  The table comment says why there is no running total and no "paid" tick on the Proposal:
  "its standing is derived from these rows every time it is read, so a deleted Payment takes
  its share of the standing with it and nothing can drift."

### 2.2 Rules (`shared/proposal-standing.ts`, 210 lines; tests `shared/proposal-standing.test.ts`, 260 lines, 30 tests)

Pure functions, no database, no clock. In file order:

| Lines | Export | What it is |
|---|---|---|
| 19-37 | `PaymentMethods`, `PaymentMethod`, `StaffPaymentMethods`, `StaffPaymentMethod` | The five methods (`check`, `cash`, `bank_transfer`, `card_outside_app`, `online`) and the four staff may pick. |
| 39-52 | `paymentMethodLabel` | "Check", "Cash", "Bank transfer", "Card, outside the app", "Online". |
| 56-65 | `ProposalStanding`, `standingLabel` | `"deposit_received" \| "paid_in_full"` and their two labels. |
| 69-74 | `Ledger` | `{ totalCents, depositPercent, paidCents, settled }`: what the standing is read off. |
| 82-89 | `proposalStanding(ledger)` | settled -> paid_in_full; total > 0 && paid >= total -> paid_in_full; depositCents > 0 && paid >= depositCents -> deposit_received; else null. |
| 95-111 | `PartCoverage`, `termsCoverage(ledger)` | Per Payment Terms line: `received` / `due` / `settled`, or null for a part with no share (deposit at 0%, final at 100%). |
| 117-128 | `PaymentDue`, `paymentDue(ledger)` | What the next payment defaults to: what is left of the deposit until covered, then what is left of the total; null once covered or Settled. |
| 133-160 | `PaymentFault`, `paymentFault(attempt)`, `paymentFaultMessage` | `payment_amount_invalid` (non-integer or <= 0 cents), `payment_method_reserved` (`online`), `payment_date_invalid` (not a calendar day). |
| 165-171 | `canDeletePayment(payment, subject)` | `online` -> false; otherwise `recordedBy === subject`. |
| 176-187 | `SettledFault`, `settledFault(reason)`, `settledFaultMessage` | `settled_reason_required` on a blank reason. |
| 192-202 | `isCalendarDay(value)` | Strict `YYYY-MM-DD` that round-trips through `Date.UTC`. |
| 207-210 | `calendarDayAtUtc(day)` | The day as the UTC instant it began, for every surface that prints one. |

`proposalStanding` and `paymentDue` depend on `splitPayment(totalCents, depositPercent)`
from `shared/proposal-pricing.ts` lines 93-105 (percent only).

Test file `describe` blocks: where a Proposal stands (9 cases incl. 0%, 100%, $0 total,
Settled short, overpayment); how each terms line stands (3); what the next Payment defaults
to (6); what makes a Payment refusable (5); who may delete (3); Settled fault (1); method
labels (1).

### 2.3 Mutations and the shared read (`convex/proposalPayments.ts`, 204 lines; tests `convex/proposalPayments.integration.test.ts`, 441 lines, 18 tests)

| Lines | Export | Rule |
|---|---|---|
| 37-67 | `recordPayment({ proposalId, amountCents, method, receivedOn, note? })` | `requireStaffIdentity`; `requireApproved` (state `approved` **and** `frozen` present, else `proposal_not_approved`); `paymentFault` as a coded `ConvexError`; note trimmed, capped at 200, dropped when blank; inserts with `recordedBy = identity.subject`, `recordedByName`, `recordedAt = Date.now()`. Returns `{ paymentId }`. The mutation's `method` arg is the **full** validator (including `online`) so the refusal is a coded error, not an argument-validation crash. |
| 73-96 | `deletePayment({ paymentId })` | `canDeletePayment`; refuses with `payment_method_reserved` for an `online` row or `payment_not_yours` for anybody but the recorder; plain `Error` for a missing row. Hard delete. |
| 103-131 | `markSettled({ proposalId, reason })` | `requireApproved`; `proposal_already_settled` if marked; `settled_reason_required`; reason trimmed, capped at 500; patches `settled` and `updatedBy/updatedAt`. **A Settled Proposal still accepts a Payment** (test at line 428). |
| 168-204 | `readPayments(ctx, proposal): PaymentsRead` | The one read every surface shares: `{ payments (sorted by recordedAt), paidCents, standing, due }`; empty and null for anything not Approved. |

Integration test blocks: Recording (6: any staff on Approved; refused on Draft/Sent/Declined;
`online` refused; amount and date faults; requires sign-in; note trimming), Deleting (4:
recorder's; refused for another staff; refused for `online` even by whoever it names;
missing row), Where the Proposal stands (3: standing and due off the running total; the
customer sees one line and no figure; **the Signed Copy is byte-for-byte unchanged** before
and after Payments and Settled), Marking Settled (5).

### 2.4 Projection to staff (`convex/proposals.ts`, 1998 lines)

- `forSite` (lines 101-157) reads the viewer's identity "once here: whether each Payment's
  delete button is theirs to press" and calls `readPayments` per Proposal.
- `proposalForStaff` (lines 1266-1345) emits `payments[] { paymentId, amountCents, method,
  receivedOn, note, recordedByName, recordedAt, deletable }`, `paidCents`, `standing`,
  `due`, `settled { reason, byName, at } | null`. `deletable` is computed server-side with
  `canDeletePayment(payment, viewerSubject)` and is "the one per-viewer answer in the whole
  projection".

### 2.5 Staff panel (`apps/web/components/site-proposals.tsx`, 2132 lines; helpers in `apps/web/lib/proposals.ts`, 390 lines; tests `apps/web/lib/proposals.test.ts` lines 326-406)

- `Payments` (lines 1615-1738): rendered only for `state === "approved"`, after the Payment
  Terms block. A standing box (emerald when Paid in full) with `standingLine`
  ("Nothing received yet" / label), `dueLine` ("Deposit due: $3,811.50"), `settledLine`,
  and two `CoverageRow`s (deposit / final: amount plus Received / Due / Settled). Then the
  list of `PaymentRow`s, then either `RecordPaymentForm`, `SettleForm`, or the two buttons
  **Record a Payment** and **Mark as Settled** (the latter hidden once Settled or Paid in
  full). Footer text tells staff the customer sees only the two lines.
- `RecordedPayment` (lines 1740-1745): "exactly the mutation's arguments past the Proposal".
- `PaymentRow` (lines 1776-1827): `paymentLine` ("$3,811.50 · Check · Sep 2, 2026 — Check
  #1042") over `recordedLine` ("Recorded by Wren Newhire, Sep 2, 2026"); a trash icon drawn
  only when `deletable`, which flips to an inline two-step "Delete this Payment / Keep it".
- `RecordPaymentForm` (lines 1832-1938): amount pre-filled from `due.cents` via
  `dollarsField`, method `<select>` over `StaffPaymentMethods`, `type="date"` defaulting to
  `todayField()`, note with placeholder "Check #1042"; refused locally with `paymentFault`
  using the same sentence the server would use.
- `SettleForm` (lines 1942-2000): one input "Why it is Settled", placeholder "Let the last
  $200 go after the callback"; buttons **Mark as Settled** / **Keep it open**.
- `rowStandingLine` (lines 2120-2127): the list row appends "· Deposit received" / "· Paid in
  full" after "Signed".
- `apps/web/lib/proposals.ts` lines 301-390: `standingLine`, `dueLine`, `coverageLabel`,
  `paymentLine`, `recordedLine`, `settledLine`, `calendarDay` (formats `YYYY-MM-DD` in UTC),
  `todayField` (local calendar day), `dollarsField`, `readDollarsField`.

### 2.6 The customer's line (Roof Report)

- `convex/proposalReportData.ts` lines 39-45: over the frozen projection, `standing:
  (await readPayments(ctx, proposal)).standing`. Layered on *outside* the frozen projection
  because that projection also feeds the Signed Copy, which never changes.
- `apps/web/components/roof-report/report-proposals.tsx` line 67: `standing?: ProposalStanding | null`.
- `apps/web/components/roof-report/proposal-list-row.tsx` lines 39 and 71-82: "Proposal 2 ·
  Signed · Deposit received". Sent and Declined ignore it.
- `walkthrough.test.tsx` lines 1003-1030 assert the two labels appear and that "balance",
  "Received", "Recorded" never leak to the customer.

### 2.7 Other consumers

- `convex/sites.ts` lines 189-206: `isOutstanding` reads `readPayments(...).standing`; an
  Approved Proposal at `paid_in_full` "has nothing left to watch and falls off the row" of
  the Sites and Customers indexes. Two tests in `convex/sites.test.ts` lines 359-414.
- `shared/deal-timeline.ts` lines 120-125 and 592-602: each Payment becomes a
  `paymentRecorded` fact on the Deal timeline (amount, method, who, when).
  `apps/web/lib/deal-timeline.ts` lines 89-92 words it.
- `calendarDayAtUtc` and `isCalendarDay` are reused by paper signatures
  (`shared/proposal-signing.ts` line 19, `convex/proposals.ts` line 1050) and Deal
  activities (`shared/deal-activities.ts` line 13). Expand's `lib/proposal-signing.ts` may
  already carry a copy; check before porting.

## 3. The standing rules and faults, in one place

Standing (`proposalStanding`, lines 82-89), evaluated in this order:

1. `settled` -> `paid_in_full` (whatever `paidCents` is, including 0).
2. `totalCents > 0 && paidCents >= totalCents` -> `paid_in_full` (overpayment reads paid; a $0
   Proposal is never paid by nothing arriving).
3. `depositCents > 0 && paidCents >= depositCents` -> `deposit_received` (never at a 0%
   deposit; at 100% the deposit is the total so rule 2 fires first).
4. otherwise `null` ("Nothing received yet" in the panel; no line for the customer).

Next payment defaults (`paymentDue`, lines 119-128): null if settled or paid >= total;
`{ part: "deposit", cents: depositCents - paidCents }` while the deposit is short and
`depositPercent > 0`; else `{ part: "final", cents: totalCents - paidCents }`.

Faults, each a `ConvexError({ code, message })` so the form can refuse locally with the same
sentence:

| Code | When | Message |
|---|---|---|
| `payment_amount_invalid` | not an integer, or <= 0 | "A Payment is a whole number of cents above zero." |
| `payment_method_reserved` | `method === "online"` on record or delete | record: "Online Payments are recorded by the app, never by hand."; delete: "An online Payment is the app's record, and cannot be deleted by hand." |
| `payment_date_invalid` | `receivedOn` is not `YYYY-MM-DD` of a real day | "The date received must be a calendar day." |
| `payment_not_yours` | delete by anybody but `recordedBy` | "Only the Staff Member who recorded a Payment can delete it." |
| `proposal_not_approved` | record or settle on anything not Approved+frozen | "Only an Approved Proposal can take a Payment." / "...be marked Settled." |
| `proposal_already_settled` | second `markSettled` | "This Proposal is already marked Settled." |
| `settled_reason_required` | blank reason | "Say in a line why this Proposal is Settled." |

Nothing checks the amount against what is due: "a check may be short, or two may cover one
part, and the running total is what decides the standing" (`proposalPayments.ts` lines 32-34).

## 4. The delete-only rule and why

Issue #193: "Mistakes: the Staff Member who recorded it can **delete** it. No correcting
entries, no audit trail beyond who recorded it and when." The code comment
(`proposalPayments.ts` lines 24, 69-72) and the schema comment (lines 1465-1468) restate it:
"`recordedBy` is the whole audit trail and the whole delete rule — only the Staff Member who
recorded a Payment may delete it, and nothing edits one."

Three reasons are visible in the sources:

1. **No edit means no drift.** Because standing is derived from rows, deleting a row is a
   complete undo; an edit endpoint would need its own fault set and its own "who may" rule
   for no gain.
2. **The recorder-only rule is the cheapest ownership model.** FRSG has several staff;
   "only yours" avoids a role system for payments. The panel draws the delete button only
   where the server would allow it (`deletable`), so a refusal only happens on a stale panel.
3. **The same predicate is what makes `online` rows untouchable.** `canDeletePayment` says
   `online` -> false before it looks at the recorder, so a processor-written row can never be
   removed by hand, and the delete mutation words that refusal separately so "not yours" does
   not send the recorder looking for who else.

For Expand: `requireOwner` (`convex/auth.ts` lines 14-19) admits exactly one Clerk subject, so
`recordedBy === subject` is always true for a hand-recorded row. Keep the rule and the
fields anyway: the map lists staff roles as a later effort, and the `online` half of the
predicate is the seam.

## 5. What FRSG left for the later collection effort (the Stripe/Plaid seam)

Issue #193: "An **online** Payment is just another record on the same list, method
'online', carrying its processor reference, which staff cannot edit or delete. Nothing else
has to be held now."

Every place in code that knows about it, all of which port unchanged:

| Where | What |
|---|---|
| `shared/proposal-standing.ts` 15-25 | `"online"` is in `PaymentMethods`, not in `StaffPaymentMethods`. Comment: "reserved for a later collection effort that would attach a processor's reference: staff never record, edit or delete one by hand, and the app never collects money itself." |
| `shared/proposal-standing.ts` 146 | `paymentFault` returns `payment_method_reserved` for `online`. |
| `shared/proposal-standing.ts` 169 | `canDeletePayment` returns false for `online` before checking the recorder. |
| `convex/schema.ts` 1467-1475 (comment) and 1475 (column) | `processorReference: v.optional(v.string())` on `payments`, "written only by the later collection effort's `online` Payments; a hand-recorded row never carries one." |
| `convex/proposalPayments.ts` 41, 83-87 | `recordPayment` accepts the full validator so `online` is refused with a code; `deletePayment` words the `online` refusal separately. |

What a later Stripe or Plaid ticket therefore has to add, and nothing more: an internal
mutation (webhook or bank-match handler) that inserts a `payments` row with
`method: "online"`, `processorReference`, `amountCents`, `receivedOn`, and some
`recordedBy/recordedByName` convention for "the app" (FRSG never chose one; the row shape
requires strings). The standing and every surface that reads it pick the row up with no
change. Not held: the processor's own status (pending/succeeded/refunded), fee, payout,
currency, or a link from the invoice to a Stripe Invoice/PaymentIntent id. Refunds were
explicitly parked (#193: "refunds belong to the collection map").

## 6. Judgement calls recorded in PR #236 that the port should inherit

- `receivedOn` is a calendar-day string, not a timestamp: a check dated the 2nd was received
  on the 2nd in every time zone. Printed in UTC (`calendarDay`) so one day never reads as two.
- Standing and due are derived, never stored.
- A Settled Proposal still accepts a Payment: Settled closes the standing, not the record.
- `deletable` is computed server-side from the viewer's subject.
- `online` rides in the validator and is refused in code, so the schema is ready without a
  migration.
- Delete asks once inline, not with a browser confirm.
- Trim caps: note 200, Settled reason 500.
- No ADR; glossary only.

## 7. What Expand has on `main` that the port must fit

| Expand file | Relevant facts |
|---|---|
| `convex/schema.ts` (342 lines) `proposals` lines 176-232 | States `draft/sent/approved/declined`; `depositPercent` **and** `depositCents?` (set-amount Deposit, PR #58); `frozen?`; `approvedAt`, `signature`; `pdfCopy?`. No `settled`, no payments table. Index `by_state_sent`. |
| `lib/proposal-pricing.ts` (288 lines) lines 84-148 | `Deposit = { kind: "percent" } \| { kind: "amount" }`; `splitPayment(totalCents, deposit)` returns `{ deposit, depositCents, balanceCents }`; `paymentRows` drops a $0 row. **Different signature from FRSG's** `splitPayment(totalCents, depositPercent)`, so FRSG's `Ledger.depositPercent` does not transfer as-is. |
| `convex/auth.ts` (24 lines) | `requireOwner`: one subject (`OWNER_CLERK_ID`) or one verified email. There is no `identityDisplayName`; `convex/proposals.ts` lines 319-338 read `identity.name` / `identity.email` with `Unknown` as fallback. |
| `convex/proposals.ts` (1246 lines) | `forCustomer` (86-165) builds the tab per site; `proposalForOwner` (602-633) is the projection; `decisionForOwner` (685-701) is where Approved facts land; `dashboard` (218-271) reads `by_state_sent`. No per-viewer field exists yet. |
| `components/customer-proposals.tsx` (910 lines) | `ProposalPanel` (197-432) inside `SidePanel`; `MoneyBlock` (597-837) shows deposit/balance rows and edits the Deposit on a draft; `ProposalSending` (`components/proposal-sending.tsx`, 385 lines, lines 318-345) is the Approved section ("Approved by ... on ..."). The panel has one `refusal` line at the top (lines 216-218); FRSG's `working`/`attempt` pattern is already there. |
| `lib/proposals.ts` (202 lines) | Already has `dollarsField` and `readDollarsField` (tested at `lib/proposals.test.ts` 184-186). No `todayField`, `calendarDay`, `paymentLine`. |
| `components/proposal-paper.tsx` lines 355-370 | The Grand Total block prints `paymentRows`; this is where a proposal's "billed / paid" view would go later (map: "not yet specified"). |
| `components/proposals-index.tsx` (94 lines), `components/dashboard-proposals.tsx` (142 lines) | Flat index with `Segmented` state filter and dashboard cards: the rails the Invoices page and card reuse. |
| `tests/*.test.ts` (10 files, `convex-test` with `import.meta.glob("../convex/**/*.ts")`) | Integration tests live in `tests/`, not beside the module; unit tests in `lib/*.test.ts`. FRSG's `shared/` is Expand's `lib/`. |
| `CONTEXT.md` (126 lines) lines 65-71 | **Deposit** ends "The proposal only states these payment terms; payments are not recorded." **Balance** exists. No Payment, Settled, Invoice entries. |

## 8. Port map: proposal -> invoice

Assumption from map #59: an invoice row has an amount of its own (deposit, progress, or
balance), belongs to an approved proposal, is sent to the customer by link, and reads
Unpaid / Partly paid / Paid / Overdue.

### Ports verbatim (rename only)

| FRSG | Expand target | Change |
|---|---|---|
| `payments` table, `by_proposal` index | `payments` table, `by_invoice` | `proposalId: v.id("proposals")` -> `invoiceId: v.id("invoices")`. Keep `processorReference?`, `recordedBy`, `recordedByName`, `recordedAt`, `receivedOn` as a day string. |
| `paymentMethodValidator` derived from `PaymentMethods` | same, in `convex/schema.ts` importing from `lib/` | none |
| `PaymentMethods`, `StaffPaymentMethods`, `paymentMethodLabel` | `lib/invoice-standing.ts` (or `lib/payments.ts`) | none; consider whether "Card, outside the app" is the owner's wording |
| `paymentFault`, `paymentFaultMessage`, `PaymentFault` | same | none |
| `isCalendarDay`, `calendarDayAtUtc` | same (check `lib/proposal-signing.ts` for an existing copy) | none |
| `canDeletePayment` | same | none; trivially true for the owner but keeps `online` undeletable |
| `recordPayment`, `deletePayment` (`convex/proposalPayments.ts` 37-96) | `convex/invoicePayments.ts` | `requireStaffIdentity` -> `requireOwner` + `ctx.auth.getUserIdentity()`; `identityDisplayName` -> the `identity.name ?? Unknown` pattern; `requireApproved` -> an invoice-state guard (section 8.2) |
| Integration tests for record/delete (`proposalPayments.integration.test.ts` 104-279) | `tests/invoice-payments.test.ts` | rename; the "another Staff Member" case has no second identity to use, so it becomes "an `online` row is refused even for the owner" |
| `RecordPaymentForm`, `PaymentRow`, `RecordedPayment` (`site-proposals.tsx` 1740-1938) | a new `components/invoice-payments.tsx` used by the invoice panel | Tailwind classes and `FieldLabel`/`Input`/`Button` already match Expand's `side-panel.tsx` and `ui/` |
| `paymentLine`, `recordedLine`, `calendarDay`, `todayField` (`apps/web/lib/proposals.ts` 332-376) and their tests (326-406) | `lib/invoices.ts` | none; `dollarsField`/`readDollarsField` already exist in `lib/proposals.ts` |
| The unit tests for methods, faults, delete, calendar day (10 of the 30) | `lib/invoice-standing.test.ts` | rename; the standing/coverage/due cases (18) are replaced (below) |

### Must be rewritten

1. **`Ledger` and `proposalStanding` -> `invoiceStanding`.** FRSG reads one Proposal total
   and a percent split. An invoice has its own `amountCents` and a due date. The four-state
   answer is roughly: `settled` (if kept) or `paid >= amount` -> `paid`; `0 < paid < amount` ->
   `partly_paid`; `paid === 0` and `today > dueOn` -> `overdue`; else `unpaid`. Overdue needs a
   `dueOn` on the invoice and a "today" input the pure function must take as an argument
   (FRSG's rules take no clock). Whether Partly paid past the due date reads Overdue or
   Partly paid is a grilling question. Acceptance figures should be rewritten from the
   FRSG $10,200 set to invoice amounts.
2. **`termsCoverage` disappears.** Its two lines (deposit / final) become invoice *kinds*
   (deposit invoice, progress invoice, balance invoice); coverage per line is now the
   standing of each invoice.
3. **`paymentDue` becomes "what is left of this invoice"**: `amountCents - paidCents`, or
   null once covered or settled. The `part` field goes.
4. **`requireApproved` -> an invoice-state guard.** FRSG refuses on Draft/Sent/Declined;
   Expand refuses on whatever invoice states the grilling tickets settle (a draft invoice, a
   voided one). The "a check that arrives early waits" sentence maps to "money cannot be
   recorded against an invoice that has not been issued", if that is wanted.
5. **`readPayments(ctx, proposal)` -> `readPayments(ctx, invoice)`**: same shape minus `due.part`,
   plus the four-state standing. Still the single read every surface shares (panel, index
   page, dashboard card, customer link, proposal's money view).
6. **The projection.** `proposalForStaff`'s `payments[]`, `paidCents`, `standing`, `due`,
   `settled` move onto the invoice projection. The proposal projection gains only what the
   map's "proposal's view of its money" ticket decides (billed vs paid), derived from its
   invoices' rows, never stored.
7. **The standing box** (`site-proposals.tsx` 1636-1678): replace the two `CoverageRow`s with
   the invoice's amount, paid, and remaining; the emerald style on Paid; a new Overdue style.
8. **The customer's line.** FRSG shows the customer only "Deposit received"/"Paid in full"
   and hides every figure because the Proposal is an offer, not a bill. An invoice *is* the
   bill, so its link will almost certainly show amount, paid to date, and balance due; that
   inverts FRSG's "never a balance" rule and the walkthrough tests that enforce it. Decide
   in a grilling ticket; do not port `reportProposalsForSite`'s `standing` layering.
9. **`isOutstanding`** (`sites.ts` 202-206) has no Expand equivalent; the analogous rule is
   which invoices the dashboard card and the Overdue filter show.
10. **Settled.** FRSG puts it on the Proposal. On an invoice it would mean "write off the
    remainder with a reason" (`settled_reason_required`, written once, still takes a
    Payment). Keep the mutation shape if the owner wants it; it is the only way a short
    balance invoice ever reads Paid. Whether it lives on the invoice, on the proposal, or
    nowhere is a grilling question. Map #59 also lists a **Void** decision for the books
    ticket; Void and Settled are different acts (nothing owed vs. owed and let go) and should
    get separate glossary entries.

### Drop

- The Roof Report row/stamp line and `walkthrough.test.tsx` cases (Expand has no Roof Report).
- The Deal timeline `paymentRecorded` fact (Expand has no Deals).
- `payment_not_yours` wording can stay but will never fire for the single owner.

## 9. Open questions this inventory surfaces for the grilling tickets

1. Does an invoice carry a due date (needed for Overdue), and is it typed by the owner or
   derived (e.g. deposit on approval, balance on completion)?
2. Does the customer's invoice link show payments received and balance due? (FRSG: never.)
3. Is Settled kept, and on which record?
4. What do `recordedBy`/`recordedByName` hold for a future `online` row: a fixed sentinel
   such as `"stripe"` / `"Stripe"`, or a nullable pair? FRSG never decided; picking a
   sentinel now costs nothing and avoids a migration.
5. Should the method list change for a handyman (are Zelle/Venmo "bank transfer"? Is
   "Card, outside the app" the owner's wording?)

## Sources

- FRSG clone `C:/Users/andyp/AppData/Local/Temp/frsg-app` at `d6c8e09`:
  `convex/proposalPayments.ts` (204), `convex/proposalPayments.integration.test.ts` (441),
  `shared/proposal-standing.ts` (210), `shared/proposal-standing.test.ts` (260),
  `shared/proposal-pricing.ts` (229), `convex/schema.ts` (1939), `convex/proposals.ts` (1998),
  `convex/proposalReportData.ts` (384), `convex/sites.ts`, `convex/sites.test.ts` (597),
  `apps/web/components/site-proposals.tsx` (2132), `apps/web/lib/proposals.ts` (390),
  `apps/web/lib/proposals.test.ts` (406), `apps/web/components/roof-report/report-proposals.tsx`
  (173), `apps/web/components/roof-report/proposal-list-row.tsx`, `shared/deal-timeline.ts`,
  `CONTEXT.md` (449) lines 286-296.
- FRSG issues: https://github.com/bigapejit/frsg-app/issues/193 (resolution comment),
  https://github.com/bigapejit/frsg-app/issues/217; PR https://github.com/bigapejit/frsg-app/pull/236.
- Expand `origin/main` at `e8f3734`: `convex/schema.ts`, `convex/auth.ts`, `convex/proposals.ts`,
  `components/customer-proposals.tsx`, `components/proposal-sending.tsx`,
  `components/proposal-paper.tsx`, `lib/proposal-pricing.ts`, `lib/proposals.ts`, `tests/`,
  `CONTEXT.md`.
