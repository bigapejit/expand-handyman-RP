# What a Stripe payment and a Plaid-matched bank transaction need the payment record to hold

Research for [#61](https://github.com/bigapejit/expand-handyman-RP/issues/61), part of the Invoices map [#59](https://github.com/bigapejit/expand-handyman-RP/issues/59). Checked against Stripe, Plaid, Relay and Convex primary sources on 2026-09-23. Every claim links to the page it came from.

## Short answer

1. **One `payments` table, one row per money event, amounts in signed cents.** Hand-recorded rows are positive. Stripe refunds and disputes arrive later as negative rows on the same invoice. An invoice's standing is the sum. Nothing else in the schema needs to change for Stripe or Plaid; both add optional fields.
2. **`source` says who wrote the row; `method` says how the money moved.** `source`: `owner` | `stripe` | `bank`. `method`: `check` | `cash` | `bank_transfer` | `card` | `other`. Stripe rows get `method` from the payment method type (`card`, `us_bank_account` → `bank_transfer`).
3. **Stripe: use a Checkout Session per invoice, not Stripe Invoicing.** The app already owns the invoice paper and number. Stripe Invoicing would issue a second number, a second hosted page and a 0.4% per-invoice fee for nothing the app lacks. Everything arrives on `checkout.session.completed` (and `checkout.session.async_payment_succeeded` for ACH). Store `stripePaymentIntentId` as the row's identity; `stripeChargeId`, `stripeBalanceTransactionId`, `stripeFeeCents`, `stripeNetCents`, `stripeAvailableOn` arrive a little later on `charge.updated`.
4. **Plaid: `transaction_id` is the row's identity, but only once the transaction has posted.** A pending transaction is removed and re-added as a new `transaction_id` when it posts, linked back by `pending_transaction_id`. Money in has a negative `amount`. Relay is reachable through Plaid: Relay's own pages say Plaid links a Relay account by Relay login and shares balances and transaction data. Relay has no public API.
5. **Four things to settle now or pay for later:** signed amounts (refunds), a `kind` on each row (payment vs refund vs dispute), the owner's delete rule scoped to `source = owner` only, and standing that tolerates an overpaid invoice. Details in "What would force a schema change later".

## What the app has now

- Money is whole cents in `v.number()` fields (`totalCents`, `depositCents`, `materialAllowanceCents`) in `convex/schema.ts`. Calendar days are `YYYY-MM-DD` strings; instants are ms numbers (`sentAt`, `signedAt`). Customer-facing dates render in `America/Los_Angeles` (`convex/proposalEmails.ts`).
- The reference model is FRSG's `payments` table: `proposalId, amountCents, method, receivedOn, note?, processorReference?, recordedBy, recordedByName, recordedAt`, indexed `by_proposal`. Rules there: no edits (delete and re-record), delete only by the recorder, no amount check against what is due, `online` refused by the hand-record mutation and reserved for "the later collection effort's to write, with a processor reference" (`C:/Users/andyp/AppData/Local/Temp/frsg-app/convex/proposalPayments.ts`, `convex/schema.ts` lines 1467-1479, `shared/proposal-standing.ts`).
- `convex/http.ts` already hosts `httpAction` routes (`/file`, `/seen`). A Stripe or Plaid webhook is one more route there.

## Stripe

### Which Stripe product

| | Checkout Session (payment mode) | Payment Link | Stripe Invoicing |
|---|---|---|---|
| Amount for one invoice | `line_items[].price_data.unit_amount`, ad hoc, no Product needed | Same `price_data` at link creation ([API](https://docs.stripe.com/payment-links/api)) | Stripe builds its own invoice with its own `number` ([Invoice object](https://docs.stripe.com/api/invoices/object)) |
| URL lifetime | `expires_at` 30 min to 24 h, default 24 h ([create](https://docs.stripe.com/api/checkout/sessions/create)) | Permanent until `active=false`; cap uses with `restrictions.completed_sessions.limit` ([Payment Link object](https://docs.stripe.com/api/payment-link/object?query=restrictions)) | Hosted invoice page, permanent |
| What the webhook carries | `checkout.session.completed` with the session | Same event; session has `payment_link` set ([Checkout Session object](https://docs.stripe.com/api/checkout/sessions/object)) | `invoice.paid`, `invoice.payment_succeeded` |
| Extra fee | None beyond processing | None ("Included with Payments", [pricing](https://stripe.com/pricing)) | 0.4% per paid invoice on Starter, on top of processing ([Invoicing pricing](https://stripe.com/invoicing/pricing)) |
| Partial payments | One session = one amount; mint a session for "amount still owed" | Same | Whole payments only: "You can't apply a portion of a payment toward an invoice" ([apply payments](https://docs.stripe.com/invoicing/apply-payments)); `paid_out_of_band` marks the whole invoice paid ([overview](https://docs.stripe.com/invoicing/overview)) |
| Currency | USD unless `adaptive_pricing` is turned on | "Adaptive Pricing is always enabled for Payment Links" ([API](https://docs.stripe.com/payment-links/api)) | USD |

Recommendation: a **Checkout Session minted on demand** when the customer presses Pay on the invoice's private page (the `/sign/[token]` rail). The emailed link points at the app, never at a raw Stripe URL, so the 24-hour expiry does not matter and the amount is always "what is still owed" at click time. Stripe's fulfilment guide says "Payment Links use Checkout, so all of the information below applies to both" ([fulfilment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)), so switching to a Payment Link with `completed_sessions.limit = 1` later changes nothing in the record.

Put the app's invoice id in **both** `client_reference_id` (max 200 chars) and `metadata.invoiceId`, and again in `payment_intent_data.metadata.invoiceId` ([create](https://docs.stripe.com/api/checkout/sessions/create?query=payment_intent_data)). Refunds and disputes reference the charge and PaymentIntent, not the session ("The Dispute object exposes charge and a nullable payment_intent, but doesn't include a direct reference to an invoice", [disputes API](https://docs.stripe.com/disputes/api)), so the PaymentIntent must carry the invoice id too.

### What arrives, and when

**On `checkout.session.completed`** ("Occurs when a Checkout Session has been successfully completed", [event types](https://docs.stripe.com/api/events/types)), from the [Checkout Session object](https://docs.stripe.com/api/checkout/sessions/object):

| Field | Prefix | Store as | Why |
|---|---|---|---|
| `id` | `cs_` | `stripeCheckoutSessionId` | Fulfilment must be safe "when called multiple times with the same Checkout Session ID" ([fulfilment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)) |
| `payment_intent` | `pi_` | `stripePaymentIntentId` (indexed) | "The ID of the PaymentIntent for Checkout Sessions in `payment` mode." The stable identity of the money; refunds and disputes point here |
| `payment_status` | | not stored; gate | `paid`, `unpaid`, `no_payment_required`. "Check the payment_status property to determine if it requires fulfillment." ACH completes with `unpaid` |
| `amount_total` | | `amountCents` | "Total of all items after discounts and taxes are applied", smallest currency unit |
| `currency` | | assert `usd` | Adaptive Pricing off on Sessions by default |
| `client_reference_id`, `metadata` | | lookup key | "can be used to reconcile the Session with your internal systems" |
| `customer_details.email` | | optional `payerEmail` | Who paid, for the activity feed |

**For ACH Direct Debit** the session completes before the money is confirmed. "Delayed payment methods generate a `checkout.session.async_payment_succeeded` event when payment succeeds later" ([fulfilment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)); settlement is "Up to 4 business days (T+4)" and the customer can dispute for 60 calendar days ([ACH](https://docs.stripe.com/payments/ach-direct-debit)). Record the payment row only when `payment_status` is `paid`, whichever event brings it.

**Charge, fee, net, availability** come from the Charge and its Balance Transaction, not from the session:

| Field | Prefix | Store as | Source |
|---|---|---|---|
| `PaymentIntent.latest_charge` | `ch_` | `stripeChargeId` | "ID of the latest Charge object created by this PaymentIntent" ([PaymentIntent](https://docs.stripe.com/api/payment_intents/object)) |
| `Charge.balance_transaction` | `txn_` | `stripeBalanceTransactionId` | "ID of the balance transaction that describes the impact of this charge on your account balance (not including refunds or disputes)" ([Charge](https://docs.stripe.com/api/charges/object)) |
| `BalanceTransaction.fee` | | `stripeFeeCents` | "Fees (in the smallest currency unit) paid for this transaction" ([Balance Transaction](https://docs.stripe.com/api/balance_transactions/object)) |
| `BalanceTransaction.net` | | `stripeNetCents` | "Net impact to a Stripe balance ... `amount` - `fee`" |
| `BalanceTransaction.available_on` | | `stripeAvailableOn` (ms) | "The date that the transaction's net funds become available in the Stripe balance" |
| `Charge.payment_method_details.type` | | `method` | `card` → `card`; `us_bank_account` → `bank_transfer` |
| `Charge.receipt_url` | | `stripeReceiptUrl` | "kept up-to-date to the latest state of the charge, including any refunds" |

Timing caveat: with the default `capture_method=automatic_async`, "The `balance_transaction` field on the Charge object might be `null` immediately after confirmation" and is `null` on the `charge.succeeded` and `payment_intent.succeeded` webhooks; "listen for the `charge.updated` event to know when the balance transaction becomes available", SLA "1 hour after the successful PaymentIntent confirmation" ([asynchronous capture](https://docs.stripe.com/payments/payment-intents/asynchronous-capture)). So the Stripe row is **inserted without fee/net** and **patched** when `charge.updated` arrives (or when a scheduled action retrieves the charge with `expand[]=balance_transaction`). Fee, net and availability are therefore optional fields even on a Stripe row.

Fees for reference: cards "2.9% + 30¢ per successful transaction for domestic cards"; ACH "0.8% ... $5.00 cap" ([pricing](https://stripe.com/pricing)).

### Payout timing

US default payout schedule is 2 business days ([payouts](https://docs.stripe.com/payouts)). A payout (`po_`) has `arrival_date` ("Date that you can expect the payout to arrive in the bank") and `status` `paid | pending | in_transit | canceled | failed`; `payout.paid` fires "whenever a payout is *expected* to be available in the destination account" ([Payout object](https://docs.stripe.com/api/payouts/object), [event types](https://docs.stripe.com/api/events/types)). Which charges a payout contains is a query, not a field on the charge: `GET /v1/balance_transactions?payout=po_...` "For automatic Stripe payouts only, only returns transactions that were paid out on the specified payout ID" ([list](https://docs.stripe.com/api/balance_transactions/list)), once `reconciliation_status` is `completed`.

Recommendation: **do not store a payout id on the payment row now.** `stripeBalanceTransactionId` plus `stripeAvailableOn` is enough to derive it later. The payout matters for the Plaid effort (below), not for invoice standing.

### Idempotency

- Delivery is at-least-once and unordered: "Stripe doesn't guarantee the delivery of events in the order that they're generated"; "Webhook endpoints might occasionally receive the same event more than once. You can guard against duplicated event receipts by logging the event IDs you've processed"; "In some cases, two separate Event objects are generated and sent. To identify these duplicates, use the ID of the object in `data.object` along with the `event.type`" ([webhooks](https://docs.stripe.com/webhooks)). Retries run "for up to three days with an exponential back off". Don't use `created` to order or dedupe.
- Signature verification needs the raw body (`await req.text()` in the `httpAction`, then `stripe.webhooks.constructEventAsync`). Return 2xx fast: Checkout "waits up to 10 seconds for your server to respond to the webhook event delivery before redirecting your customer" ([fulfilment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)).
- In Convex a mutation is a serializable transaction with OCC and automatic re-run on conflict ([OCC](https://docs.convex.dev/database/advanced/occ)), so "look up `stripePaymentIntentId` by index, insert only if absent" inside **one** mutation is race-free. Dedupe on the **object id** (`pi_`, `re_`, `du_`), not only on `evt_`: two different events can describe the same money.
- Outgoing: pass `Idempotency-Key` (up to 255 chars, pruned after 24 h, replays return the saved result) when creating the Checkout Session, keyed on invoice id + amount ([idempotent requests](https://docs.stripe.com/api/idempotent_requests)).
- The `@convex-dev/stripe` component verifies signatures and creates Checkout Sessions but its docs do not address idempotency of event handling ([component](https://www.convex.dev/components/stripe)); the payment row dedupe above is still the app's job.

### Refunds

- A refund (`re_`) has `amount`, `charge`, `payment_intent`, `balance_transaction`, `status` `pending | requires_action | succeeded | failed | canceled`, `reason` ([Refund object](https://docs.stripe.com/api/refunds/object)).
- "You can issue more than one refund against a charge, but you can't refund a total greater than the original charge amount." "Stripe's processing fees from the original transaction aren't returned." Events: `refund.created`, `refund.updated`, `refund.failed`; `charge.refunded` fires "including partial refunds" ([refunds](https://docs.stripe.com/refunds)). `Charge.refunded` is `true` only when fully refunded; `Charge.amount_refunded` is the running total ([Charge](https://docs.stripe.com/api/charges/object)).
- ACH: full refunds only, 180-day window, "take up to 3 business days", "can't be canceled" ([ACH](https://docs.stripe.com/payments/ach-direct-debit)).
- A failed refund returns money to your balance via `failure_balance_transaction` ([refunds](https://docs.stripe.com/refunds)).

Record: one **negative** row per refund, `kind = refund`, `stripeRefundId` (indexed for dedupe), `stripePaymentIntentId` of the original, `amountCents = -refund.amount`, inserted on `refund.created` only when `status = succeeded` (or patched to settled on `refund.updated`). A failed refund is a further positive `kind = refund_reversal` row, or a delete of the pending row; pick one in the refund ticket.

### Disputes

- A dispute (`du_`) has `amount` ("Usually the amount of the charge, but it can differ"), `charge`, `payment_intent`, `status` (`warning_needs_response`, `warning_under_review`, `warning_closed`, `needs_response`, `under_review`, `won`, `lost`, `prevented`), `evidence_details.due_by`, and `balance_transactions`: "List of zero, one, or two balance transactions that show funds withdrawn and reinstated" ([Dispute object](https://docs.stripe.com/api/disputes/object)).
- "Stripe in turn debits your Stripe balance for the disputed amount plus a dispute fee"; "we never return the dispute received fee"; "the full dispute lifecycle ... can take 2-3 months"; a payment can be disputed more than once ([how disputes work](https://docs.stripe.com/disputes/how-disputes-work), [disputes API](https://docs.stripe.com/disputes/api)). US fee "$15.00 for each dispute you receive" ([pricing](https://stripe.com/pricing)).
- Events: `charge.dispute.created`, `charge.dispute.funds_withdrawn` ("funds are removed from your account due to a dispute"), `charge.dispute.closed` (status becomes `lost`, `warning_closed`, or `won`), `charge.dispute.funds_reinstated` ([event types](https://docs.stripe.com/api/events/types)). An inquiry (`warning_*`) withdraws nothing yet.
- ACH disputes: 60 calendar days, "final with no process for appeal", "can only be disputed once" ([ACH](https://docs.stripe.com/payments/ach-direct-debit)).

Record: a negative `kind = dispute` row on `funds_withdrawn` (amount = `dispute.amount`), a positive `kind = dispute_reversal` row on `funds_reinstated`, both carrying `stripeDisputeId`. The invoice reads Unpaid or Partly paid while the money is gone, which is the truth. The $15 fee is a Stripe cost, not customer money; it does not belong on the invoice.

## Plaid Transactions

### `/transactions/sync`

- Request `cursor` ("If omitted, the entire history of updates will be returned, starting with the first-added transactions on the Item"), `count` default 100 max 500. Response `added`, `modified` ("ordered by ascending last modified time"), `removed` (objects with `transaction_id` and `account_id`), `has_more`, `next_cursor` ("valid for at least 1 year"), `transactions_update_status` (`NOT_READY`, `INITIAL_UPDATE_COMPLETE`, `HISTORICAL_UPDATE_COMPLETE`) ([Transactions API](https://plaid.com/docs/api/products/transactions/#transactionssync)).
- "After successfully pulling all currently available pages, you can store the cursor for later requests"; "if you encounter an error during pagination, it's important to restart the pagination loop from the beginning" ([add to app](https://plaid.com/docs/transactions/add-to-app/)). Store `next_cursor` only after the last page.
- `SYNC_UPDATES_AVAILABLE` webhook carries `initial_update_complete` (30 days ready) and `historical_update_complete` (up to 24 months) ([webhooks](https://plaid.com/docs/transactions/webhooks/)). History requested at link time: `transactions.days_requested` default 90, max 730 ([Link](https://plaid.com/docs/api/link/)).
- One Item per login: "linking the same account at the same institution twice will result in two Items with different `item_id` values" ([Link](https://plaid.com/docs/api/link/)).

### Which fields identify a transaction

From the [Transaction object](https://plaid.com/docs/api/products/transactions/) and [transactions data](https://plaid.com/docs/transactions/transactions-data/):

| Field | Meaning | Store as |
|---|---|---|
| `transaction_id` | "The unique ID of the transaction. Like all Plaid identifiers, the `transaction_id` is case sensitive." | `plaidTransactionId` (indexed) |
| `pending` | "When `true`, identifies the transaction as pending or unsettled. Pending transaction details (name, type, amount, category ID) may change before they are settled." | gate: match posted only |
| `pending_transaction_id` | "The ID of a posted transaction's associated pending transaction, where applicable." | `plaidPendingTransactionId` |
| `account_id` | "This value will not change unless Plaid can't reconcile the account with the data returned by the financial institution." | `plaidAccountId` |
| `amount` | "Positive values when money moves out of the account; negative values when money moves in. For example, debit card purchases are positive; credit card payments, direct deposits, and refunds are negative." | `amountCents = round(-amount * 100)` |
| `iso_currency_code` | ISO 4217 | assert `USD` |
| `date` | "For pending transactions, the date that the transaction occurred; for posted transactions, the date that the transaction posted", `YYYY-MM-DD` | `receivedOn` |
| `authorized_date` | "the day the transaction was authorized by the financial institution" | prefer for `receivedOn` when present |
| `name` / `merchant_name` / `original_description` | Bank text; `original_description` only with `options.include_original_description: true` | `bankDescription` (for the owner to recognise the payer) |
| `check_number` | "only populated for check transactions" | `bankCheckNumber` |
| `payment_channel` | `online`, `in store`, `other` ("transactions that relate to banks, e.g. fees or deposits") | not needed |

Pending to posted is a **remove plus add with a new id**: "the transition from a pending to posted transaction will be represented through the /transactions/sync endpoint with the pending transaction's `transaction_id` in the `removed` field of the response and the new posted transaction in the `added` section"; "If Plaid matches the pending transaction to the new posted transaction, the pending transaction's id will be marked in the `pending_transaction_id` of the posted transaction"; "their name and amount may change"; "In some cases, a pending transaction may not convert to a posted transaction at all and will simply disappear"; posting takes "about one to five business days ... up to fourteen days in rare situations" ([transactions data](https://plaid.com/docs/transactions/transactions-data/)).

Recommendation: the Plaid effort **matches posted transactions only**. If it ever shows pending ones, it shows them as "money on the way" without writing a payment row. When a posted transaction arrives with `pending_transaction_id`, look up any earlier match by that id and move it; that is the only reason to keep `plaidPendingTransactionId`.

### Is Relay reachable through Plaid?

Yes, by Relay's own account. Relay: "Plaid connects Relay to any platform that uses Plaid as its bank-linking service. You sign in with your Relay login and Plaid links the account in seconds, without account and routing numbers" ([What platforms does Relay work with](https://relayfi.com/hc/en-us/articles/360060916631-What-platforms-does-Relay-work-with/)); "Share account and routing numbers, account balances and transaction data with money apps in Plaid and Yodlee's networks"; "you will be prompted to enter the username and password associated with each account" ([Relay Plaid integrations](https://relayfi.com/integrations/plaid)). Relay's 2FA controls third-party access such as Plaid, and Plaid is enabled under Settings > Integrations ([SMS 2FA](https://support.relayfi.com/hc/en-us/articles/9208835879700-SMS-two-factor-authentication-2FA), [Setting up payroll](https://support.relayfi.com/hc/en-us/articles/27779962109716-Setting-up-payroll-on-Relay)).

Relay has **no public API**: its integrations page lists only direct feeds to QuickBooks Online, Xero, Gusto, Hubdoc and Dext, Plaid and Yodlee, and CSV/OFX export ([What platforms does Relay work with](https://relayfi.com/hc/en-us/articles/360060916631-What-platforms-does-Relay-work-with/), [Integrations](https://relayfi.com/integrations/)). So Plaid is the route.

Not verified from Plaid's side: Plaid does not publish its institution list; `/institutions/search` needs API credentials ([Institutions API](https://plaid.com/docs/api/institutions/)). A third-party coverage index lists "Relay Financial" as a Plaid institution ([Fintable](https://fintable.io/coverage/banks/United%20States/30681_relay-financial)). Five-minute check for the Plaid ticket: open Plaid Link in sandbox, search "Relay". Also confirm Plaid production access for the Transactions product; that is an application, not a switch.

### Stripe payouts inside the bank feed

A Stripe payout lands in Relay as **one** Plaid transaction for several invoices' net (after fees). The bank matcher must never turn that deposit into a payment row; those invoices are already paid by their `source = stripe` rows. Rule for the Plaid ticket: a deposit that matches a `payout.amount` (or is described as Stripe) is matched to the payout, not to an invoice. Nothing to store now; `stripeBalanceTransactionId` makes the link derivable through `balance_transactions?payout=`.

## Recommended row shape

```ts
payments: defineTable({
  invoiceId: v.id("invoices"),
  // Signed cents. Hand rows are positive. Refunds and disputes are negative.
  amountCents: v.number(),
  kind: paymentKindValidator,      // "payment" | "refund" | "refund_reversal" | "dispute" | "dispute_reversal"
  source: paymentSourceValidator,  // "owner" | "stripe" | "bank"
  method: paymentMethodValidator,  // "check" | "cash" | "bank_transfer" | "card" | "other"
  receivedOn: v.string(),          // YYYY-MM-DD, owner's calendar (America/Los_Angeles)
  note: v.optional(v.string()),
  recordedBy: v.string(),          // Clerk subject, or "stripe" / "plaid" for machine rows
  recordedByName: v.string(),
  recordedAt: v.number(),

  // Stripe, written by the later collection effort. All optional.
  stripePaymentIntentId: v.optional(v.string()),     // pi_  identity of a payment row
  stripeCheckoutSessionId: v.optional(v.string()),   // cs_
  stripeChargeId: v.optional(v.string()),            // ch_
  stripeBalanceTransactionId: v.optional(v.string()),// txn_
  stripeFeeCents: v.optional(v.number()),
  stripeNetCents: v.optional(v.number()),
  stripeAvailableOn: v.optional(v.number()),         // ms
  stripeReceiptUrl: v.optional(v.string()),
  stripeRefundId: v.optional(v.string()),            // re_  identity of a refund row
  stripeDisputeId: v.optional(v.string()),           // du_  identity of a dispute row
  payerEmail: v.optional(v.string()),

  // Plaid, written by the later bank-feed effort. All optional.
  plaidTransactionId: v.optional(v.string()),        // identity of a bank row
  plaidPendingTransactionId: v.optional(v.string()),
  plaidAccountId: v.optional(v.string()),
  bankDescription: v.optional(v.string()),
  bankCheckNumber: v.optional(v.string()),
  matchedBy: v.optional(v.string()),                 // who confirmed the match
  matchedAt: v.optional(v.number()),
})
  .index("by_invoice", ["invoiceId"])
  .index("by_stripePaymentIntentId", ["stripePaymentIntentId"])
  .index("by_stripeRefundId", ["stripeRefundId"])
  .index("by_stripeDisputeId", ["stripeDisputeId"])
  .index("by_plaidTransactionId", ["plaidTransactionId"]);
```

Only the first block ships in this effort. Adding optional fields and indexes to a Convex table later is a schema edit with no data migration, so the Stripe and Plaid blocks can land with their own tickets; they are listed here so the names are decided once. Flat prefixed fields rather than a nested `stripe: {}` object: simpler validators, plain index paths, and FRSG's precedent (`processorReference`).

Vocabulary, plainly:

- **Source** — who wrote the row. `owner` typed it. `stripe` came from a webhook. `bank` came from a Plaid transaction the owner matched.
- **Method** — how the money moved. `check`, `cash`, `bank_transfer` (ACH, wire, Zelle), `card`, `other`. Stripe fills it from the payment method type; the owner picks it for hand rows; a bank row is `bank_transfer` unless `check_number` is set.
- **Kind** — what the row does to the invoice. `payment` adds. `refund` and `dispute` take away. `refund_reversal` and `dispute_reversal` give back.

Standing for one invoice = `sum(amountCents)` over its rows, compared to the invoice total: 0 → Unpaid (or Overdue past the due date), between → Partly paid, ≥ total → Paid. Same rule for all three sources.

## What would force a schema change later if ignored now

1. **Refunds and disputes as negative rows.** If the standing function or a validator assumes every row is positive, or if `amountCents` is checked `> 0` in the schema, refunds need a redesign. Decide now: signed amounts, `kind` on every row, and standing as a sum. Hand rows stay positive in the mutation, not in the schema.
2. **Delete versus tombstone.** FRSG lets the recorder hard-delete a hand row. That is fine for `source = owner`. A Stripe row must not be hand-deletable: the webhook would be redelivered (up to three days) and dedupe by `stripePaymentIntentId` would then miss it and re-insert. Scope the delete rule to `source = owner` from day one. Machine rows change only through further rows (refund, dispute) or by patching fee fields.
3. **"No edits" scoped to the owner.** Stripe rows are legitimately patched once when `charge.updated` brings fee and net. Write the rule as "the owner never edits a payment", not "a payment row is immutable".
4. **Overpayment must be a legal state.** A customer can pay a Checkout link the moment after the owner records a check. Do not reject payments that exceed the balance (FRSG already does not); show Paid and let the owner refund or credit. Also do not derive "amount still owed" from anywhere but the sum.
5. **Money that has not arrived is not a payment.** ACH via Stripe completes Checkout before it settles; Plaid shows pending transactions. Keep the `payments` table to settled money. If the UI needs "payment in progress", the Stripe effort adds a small `checkoutSessions` table (invoice, `cs_` id, status, expires), not a status column on payments.
6. **Two ids for one pending-then-posted bank transaction.** Match on posted rows; keep `plaidPendingTransactionId` so an early match can be moved. Without it a pending match would silently duplicate when the posted one arrives.
7. **Do not let the bank matcher see Stripe payouts as customer money.** Rule above; no field needed, but the Plaid ticket must state it.
8. **`receivedOn` needs a timezone rule.** Stripe gives Unix seconds; Plaid gives a calendar day. Define `receivedOn` as the day in `America/Los_Angeles` (already the app's customer-facing zone) and convert Stripe's `created` with it, so the owner's ledger and the bank's day line up.
9. **USD only, and keep it that way on purpose.** Turn Adaptive Pricing off on Checkout Sessions (default) and avoid Payment Links (always on). Then no `currency` field is needed. If a `currency` ever appears, it is a signal that this decision was reopened.

## Identifier cheat sheet

| Prefix | Object | Arrives on |
|---|---|---|
| `cs_` | Checkout Session | `checkout.session.completed`, `checkout.session.async_payment_succeeded` |
| `pi_` | PaymentIntent | same, as `session.payment_intent` |
| `ch_` | Charge | `PaymentIntent.latest_charge`; `charge.succeeded`, `charge.updated` |
| `txn_` | Balance Transaction | `Charge.balance_transaction` (may be null at first) |
| `po_` | Payout | `payout.paid`; contents via `balance_transactions?payout=` |
| `re_` | Refund | `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded` |
| `du_` | Dispute | `charge.dispute.created`, `funds_withdrawn`, `closed`, `funds_reinstated` |
| `evt_` | Event | every webhook; log for dedupe |
| `plink_` | Payment Link | `session.payment_link` if a link was used |
| Plaid `transaction_id` | bank transaction | `/transactions/sync` `added` / `modified` / `removed` |

## Sources

Stripe
- Checkout Session object: https://docs.stripe.com/api/checkout/sessions/object
- Create a Checkout Session: https://docs.stripe.com/api/checkout/sessions/create and https://docs.stripe.com/api/checkout/sessions/create?query=payment_intent_data
- Fulfil orders: https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Payment Links API and tracking: https://docs.stripe.com/payment-links/api , https://docs.stripe.com/payment-links/url-parameters , https://docs.stripe.com/api/payment-link/object?query=restrictions
- Invoicing: https://docs.stripe.com/api/invoices/object , https://docs.stripe.com/api/invoice-payment/object , https://docs.stripe.com/invoicing/overview , https://docs.stripe.com/invoicing/apply-payments , https://stripe.com/invoicing/pricing
- PaymentIntent, Charge, Balance Transaction, Payout: https://docs.stripe.com/api/payment_intents/object , https://docs.stripe.com/api/charges/object , https://docs.stripe.com/api/balance_transactions/object , https://docs.stripe.com/api/balance_transactions/list , https://docs.stripe.com/api/payouts/object , https://docs.stripe.com/payouts
- Asynchronous capture: https://docs.stripe.com/payments/payment-intents/asynchronous-capture
- Webhooks, events, idempotency: https://docs.stripe.com/webhooks , https://docs.stripe.com/api/events/object , https://docs.stripe.com/api/events/types , https://docs.stripe.com/api/idempotent_requests
- Refunds: https://docs.stripe.com/refunds , https://docs.stripe.com/api/refunds/object
- Disputes: https://docs.stripe.com/disputes/how-disputes-work , https://docs.stripe.com/disputes/api , https://docs.stripe.com/api/disputes/object
- ACH Direct Debit: https://docs.stripe.com/payments/ach-direct-debit
- Pricing: https://stripe.com/pricing

Plaid
- Transactions API (object and /transactions/sync): https://plaid.com/docs/api/products/transactions/
- Transactions data (pending vs posted): https://plaid.com/docs/transactions/transactions-data/
- Add Transactions to your app: https://plaid.com/docs/transactions/add-to-app/
- Transactions webhooks: https://plaid.com/docs/transactions/webhooks/
- Link token (days_requested, item_id): https://plaid.com/docs/api/link/
- Institutions API: https://plaid.com/docs/api/institutions/

Relay
- What platforms does Relay work with: https://relayfi.com/hc/en-us/articles/360060916631-What-platforms-does-Relay-work-with/
- Plaid integrations page: https://relayfi.com/integrations/plaid
- Integrations overview: https://relayfi.com/integrations/
- SMS 2FA (third-party access): https://support.relayfi.com/hc/en-us/articles/9208835879700-SMS-two-factor-authentication-2FA
- Third-party coverage index (not primary): https://fintable.io/coverage/banks/United%20States/30681_relay-financial

Convex
- OCC and transactions: https://docs.convex.dev/database/advanced/occ
- Stripe component: https://www.convex.dev/components/stripe

Repo
- `convex/schema.ts`, `convex/http.ts`, `convex/proposalEmails.ts` (this repo)
- FRSG `convex/proposalPayments.ts`, `convex/schema.ts`, `shared/proposal-standing.ts` at `C:/Users/andyp/AppData/Local/Temp/frsg-app`
