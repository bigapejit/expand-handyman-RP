# What it takes to run Plaid Transactions for one owner's Relay account

Research for [#127](https://github.com/bigapejit/expand-handyman-RP/issues/127), part of the map [#126](https://github.com/bigapejit/expand-handyman-RP/issues/126). Checked against Plaid's docs and help center, Relay's help center, Stripe's docs and Convex's docs on 2026-09-23. Every claim links the page it came from.

This builds on [`docs/research/payment-record-shape.md`](https://github.com/bigapejit/expand-handyman-RP/blob/research/payment-record-shape/docs/research/payment-record-shape.md) (#61). That file already covers `/transactions/sync` basics, the Transaction object's identity fields, pending-to-posted as remove-plus-add, the negative sign on money in, and why a Stripe payout is never matched to an invoice. None of that is repeated here.

## Short answer

1. **Use Plaid's free Trial plan. Do not apply for full Production.** Plaid replaced Limited Production with a Trial plan for teams created on or after 2026-04-15. Trial is free and uses real bank data. It allows 10 Production Items, includes Transactions, and has no cap on API calls to Items you have already linked. It needs no payment setup and no security questionnaire, and most applications are approved automatically. **Submitting a full Production application gives up the Trial plan for good.** Ticket #128 currently says to apply for Production. That step should change.
2. **Relay is in Plaid's list as "Relay Financial", `ins_117228`, with Transactions supported.** Plaid's public coverage CSV does not say whether Relay uses OAuth. Relay's own page says Plaid asks for your Relay username and password, which suggests it does not. It makes no difference on desktop web: Plaid runs OAuth in a pop-up and needs no redirect URI there.
3. **Linking needs no page in the app.** Plaid's **Hosted Link** gives the server a Plaid-hosted URL. The owner opens it, and the `public_token` arrives by webhook. That works for the first link and for update mode. The Quickstart is fine for grabbing samples (#129), but it needs a few small edits first, and every Item it creates uses up one of the 10 Trial slots permanently.
4. **Webhooks fit a Convex `httpAction`.** The URL is set per Item in `/link/token/create` (or later with `/item/webhook/update`), not in the dashboard. You verify a webhook with an ES256 JWT in the `Plaid-Verification` header plus a SHA-256 of the raw body. Convex's default runtime has Web Crypto, so no Node action is needed. Reply 200 within 10 seconds.
5. **Relay cannot receive Zelle.** Relay's help center says so plainly. Whatever Zelle money the owner gets lands in some other bank, which would have to be linked as its own Item. Plaid's docs say nothing about whether a payer's name or memo survives into a deposit's description. Only a real Item can show that. A Stripe payout's bank descriptor defaults to `STRIPE`, and Relay's own card and ACH-pull collections also arrive as batched payouts.
6. **History is set once, at link time.** `transactions.days_requested` takes 1 to 730 and defaults to 90, and it cannot be changed afterwards. Relay says a mobile check deposit shows as pending at once and takes up to 7 business days to clear. That is longer than Plaid's usual 1 to 5 business days from pending to posted.

## 1. Access: Sandbox, Trial (the old Limited Production), full Production

### Sandbox

- Free. Unlimited test Items. Test login `user_good` / `pass_good`. Host `sandbox.plaid.com` ([Sandbox overview](https://plaid.com/docs/sandbox/)).
- "All of the institutions that are available in the Plaid Production environment are also available in Sandbox" ([Sandbox institutions](https://plaid.com/docs/sandbox/institutions/)). But institution quirks are not reproduced there: "all OAuth institutions use a single generic flow" ([Sandbox overview, differences table](https://plaid.com/docs/sandbox/)).
- Sandbox Items go into `ITEM_LOGIN_REQUIRED` on their own after 30 days, and `/sandbox/item/reset_login` forces that state ([Sandbox overview](https://plaid.com/docs/sandbox/)). This is useful for testing update mode on dev Convex.
- Transactions test users: `user_transactions_dynamic` (any non-blank password, non-OAuth institution such as First Platypus Bank `ins_109508`) creates new pending transactions and moves old ones to posted on each `/transactions/refresh`. `/sandbox/transactions/create` adds custom transactions. `user_small_business` is a small-business persona with three months of realistic data ([Transactions intro, Testing](https://plaid.com/docs/transactions/)). `/sandbox/item/fire_webhook` fires a webhook on demand ([Sandbox overview](https://plaid.com/docs/sandbox/)).

### Limited Production: gone for new teams, replaced by the Trial plan

- "Limited Production has been replaced with Trial plans for all Plaid teams created on or after April 15, 2026" ([Sandbox overview, Limited Production (deprecated)](https://plaid.com/docs/sandbox/)). "As of April 15, 2026, new Limited Production signups are no longer available for developers in the US and Canada … Existing Limited Production customers retain access" ([Help: Sandbox, Production, Trial plan, Limited Production](https://support.plaid.com/hc/en-us/articles/16110110883479-How-are-Sandbox-Production-Trial-plan-and-Limited-Production-different)).
- For the record, Limited Production did include Transactions. It had "a cap on the number of API calls" per product, "a cap on the total number of Items" (the number is not stated), and no Bank of America, Chase or Wells Fargo ([Sandbox overview](https://plaid.com/docs/sandbox/)). None of this applies to a new Expand Handyman team.

### Trial plan (the path to take)

| | Trial plan |
|---|---|
| Cost | Free. "You will not receive invoices and no payment setup is needed" ([How do I pay my Plaid invoice?](https://support.plaid.com/hc/en-us/articles/16195021021207-How-do-I-pay-my-Plaid-invoice)) |
| Data | Real, in the Production environment. "Plaid has one environment for development (Sandbox) and one for live use (Production). Trial plan and Limited Production are two ways to access Production for free" ([Help: environments](https://support.plaid.com/hc/en-us/articles/16110110883479-How-are-Sandbox-Production-Trial-plan-and-Limited-Production-different)) |
| Items | 10 Production Items. "Removing Items created on a Trial plan (using /item/remove) will not allow you to create more Items" ([Billing: Trial plans](https://plaid.com/docs/account/billing/)) |
| API calls | "API calls against your existing connected Items are not capped" ([What is the Plaid Trial plan?](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan)) |
| Products | Auth, Transactions (with Transactions Refresh), Balance, Identity, Assets, Liabilities, Investments, Statements ([Billing: Trial plans](https://plaid.com/docs/account/billing/)) |
| Who | US/Canada teams created on or after 2026-04-15 that have "not yet applied for or been granted any form of Production access" ([Plans compared](https://support.plaid.com/hc/en-us/articles/16110502116887-What-are-Plaid-s-prices-and-pricing-plans-and-how-do-they-differ)) |
| Approval | "Most Trial plan applications are approved automatically after identity verification. If your application is flagged for manual review, Plaid's Customer Oversight team will follow up within 2–3 business days" ([What is the Plaid Trial plan?](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan)) |
| Paperwork | "no business registration, security questionnaire, or sales process required". You must accept Plaid's Master Services Authorization Agreement and "attestations about keeping your accounts, data, and code secure" (same page) |
| OAuth banks | Most, including Bank of America, Chase and Wells Fargo. "After your account is approved, OAuth access typically becomes available within 6–24 hours" (same page) |
| How to start | Create a Dashboard account, verify the email, then fill in the form at `https://dashboard.plaid.com/trial-plan` ([Billing: Trial plans](https://plaid.com/docs/account/billing/)) |
| End date | Plaid's pages give no expiry date for a Trial plan. None found. |

**Two warnings.**

- "Once you submit a Production access application, you cannot revert to the Trial plan" ([Upgrading from Trial](https://support.plaid.com/hc/en-us/articles/39917307426967-How-do-I-upgrade-from-the-Trial-plan-to-a-paid-Production-plan)). If the team applies for Production first, "the Trial plan is not available — there is currently no self-service way to switch" ([Plans compared](https://support.plaid.com/hc/en-us/articles/16110502116887-What-are-Plaid-s-prices-and-pricing-plans-and-how-do-they-differ)).
- The same upgrade page lists "You are building a commercial product or service" as a reason to upgrade. An in-house tool that watches the business's own account is arguably not that, but Plaid does not say either way. If Plaid ever asks, upgrading costs nothing in rework: "Your existing Trial Items remain connected and continue working" ([Upgrading from Trial](https://support.plaid.com/hc/en-us/articles/39917307426967-How-do-I-upgrade-from-the-Trial-plan-to-a-paid-Production-plan)).

**Every Item counts for good.** One Relay Item for the #129 samples, and possibly a second link done later inside the app, uses 2 of the 10 slots. Linking a Zelle bank uses one more. Do not practise linking in Production; practise in Sandbox.

### Before Link works in Production (Trial or paid)

- **Link use case.** "To use Link with bank data in Production … all customers who created accounts after October 31, 2024 must select a use case description from the Link Customization section of the Dashboard" (`https://dashboard.plaid.com/link/data-transparency-v5`) ([Sandbox overview](https://plaid.com/docs/sandbox/)). The Quickstart's `.env.example` says the same ([plaid/quickstart `.env.example`](https://github.com/plaid/quickstart/blob/master/.env.example)). **This step is not on #128.**
- **Application profile and company profile** in the Dashboard: "must be completed before connecting to certain institutions in Production" ([Add Transactions to your app](https://plaid.com/docs/transactions/add-to-app/)). A Trial plan does not need the OAuth registration items (the security questionnaire and the rest) "until you upgrade to a paid plan" ([OAuth guide](https://plaid.com/docs/link/oauth/)).

### Full Production (only if the Trial stops being enough)

- **The form has four sections:** "Describe your business" (business type, details, industry, app details), "Select your products" (with use cases), "Provide ownership details" (beneficial owners), and "Select your plan" (plan and billing details). You start it from Dashboard Home, "Get Production access", or from Build > Keys > Request access ([Upgrading from Trial](https://support.plaid.com/hc/en-us/articles/39917307426967-How-do-I-upgrade-from-the-Trial-plan-to-a-paid-Production-plan)).
- **Timing:** "Approval for the Production environment takes a couple of business days" ([Help: environments](https://support.plaid.com/hc/en-us/articles/16110110883479-How-are-Sandbox-Production-Trial-plan-and-Limited-Production-different)). "Most applications are reviewed automatically." The security questionnaire unlocks only after approval ([Upgrading from Trial](https://support.plaid.com/hc/en-us/articles/39917307426967-How-do-I-upgrade-from-the-Trial-plan-to-a-paid-Production-plan)). For OAuth banks, "Access to most institutions is available within hours of completing the registration requirements, but some institutions may take up to 5 business days" ([OAuth guide](https://plaid.com/docs/link/oauth/)).
- **Privacy policy or website:** none of the pages read says a privacy policy URL or a public website is required. The launch checklist only says some customers link Plaid's privacy policy from their own, and "it is up to you to determine how to obtain any legally required consents" ([Launch checklist](https://plaid.com/docs/launch-checklist/)). The company-profile form in the Dashboard may ask for a website; that could not be seen without logging in.
- **LEI:** asked for, optionally. "Plaid is not currently enforcing the requirement to have an LEI" ([OAuth guide](https://plaid.com/docs/link/oauth/)).

### What Transactions costs for one Item

- **On Trial: $0.** Pricing models "apply to paid Production plans only" ([How much does Plaid cost?](https://support.plaid.com/hc/en-us/articles/16194632655895-How-much-does-Plaid-cost-and-what-are-the-pricing-models)).
- **On a paid plan: a monthly subscription per Item. Plaid publishes no dollar figure.** "A price list is not available in the documentation. To view pricing, apply for Production access. Pricing information for Pay-as-you-go and Growth plans will be displayed on the last page before you submit your request" ([Billing](https://plaid.com/docs/account/billing/)). The public [pricing page](https://plaid.com/pricing/) lists plans and products with no prices. This research gives no number because none is published.
- **How the subscription bills:** you are charged "as long as a valid `access_token` exists for the Item", even when no calls are made and even when the Item is in an error state. Months are UTC calendar months and are "not pro-rated". It ends only with `/item/remove` or when the user revokes access ([Billing: subscription fee](https://plaid.com/docs/account/billing/)). `/transactions/refresh` is billed per request on top ([Billing: per-request flat fee](https://plaid.com/docs/account/billing/)).
- **Items linked on Trial carry over after an upgrade and start billing:** "it will start being billed on a subscription basis once your PAYG plan is active". Invoices go out on the 8th for the previous month ([Billing after upgrading from Trial](https://support.plaid.com/hc/en-us/articles/42878983841303-How-does-billing-work-after-I-upgrade-from-Trial-to-Pay-as-you-go)). Pay-as-you-go charges a credit card automatically when the invoice is issued ([How do I pay my Plaid invoice?](https://support.plaid.com/hc/en-us/articles/16195021021207-How-do-I-pay-my-Plaid-invoice)).
- **Free on every plan:** Institutions endpoints, Item endpoints and `/accounts/get` ([Billing](https://plaid.com/docs/account/billing/)). Hosted Link: "There is no fee to use Hosted Link if you are not using Plaid to deliver sessions" (same page).
- **Keep `PLAID_PRODUCTS` to `transactions` only.** Auth and Identity are one-time fees charged "whenever the product is successfully added to an Item" ([Billing: one-time fee](https://plaid.com/docs/account/billing/)). The Quickstart's default `PLAID_PRODUCTS=auth,transactions,signal` would add Auth, and Signal is not in the Trial bundle ([What is the Plaid Trial plan?](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan)).

## 2. Relay in Plaid's institution list

- **Listed.** Plaid's public coverage file, generated 2026-08-12, has `ins_117228,Relay Financial,US` with `transactions=1`, `auth=1` and `balance=1`. It also lists `ins_138188,RelayGO Card`, which is Relay's card product, not the checking accounts ([Plaid US coverage CSV](https://plaid.com/documents/us_institution_coverage.csv), linked from [Coverage explorer](https://plaid.com/docs/institutions/)). The explorer page itself says the table "is not updated in real time; for the most up to date data, use /institutions/get".
- **OAuth: not confirmed.** The CSV has no OAuth column. Relay: "When you use Plaid or Yodlee to connect Relay to other money apps, you will be prompted to enter the username and password associated with each account" ([Relay: Plaid and Yodlee](https://relayfi.com/integrations/plaid-and-yodlee/)). That points to a credential connection, not OAuth. Plaid's institution record has a boolean `oauth`, which "will be `true` if OAuth is supported for any Items associated with the institution". An institution that is moving to OAuth also shows `true`, and may get a second `institution_id` ([Institutions API](https://plaid.com/docs/api/institutions/)).
- **Why it barely matters:** on desktop web, "OAuth flows will function properly on web even if you don't set up a redirect URI … will always try to open the OAuth bank's website in a new pop-up window". The redirect URI is required only for mobile apps, and recommended for mobile web ([OAuth guide](https://plaid.com/docs/link/oauth/)). If the owner links from a phone browser and Relay turns out to be OAuth, register an `https` redirect URI in the Dashboard's Allowed redirect URIs and pass it as `redirect_uri` ([Link API](https://plaid.com/docs/api/link/)).
- **Where it does matter:** a credential connection breaks with `ITEM_LOGIN_REQUIRED` when "the user changed their password" or "their multi-factor authentication has expired" ([Item errors](https://plaid.com/docs/errors/item/)). Plaid says OAuth Items "generally remain connected longer" ([OAuth guide](https://plaid.com/docs/link/oauth/)). Plan for the owner to re-link from time to time (section 3).
- **How to check with sandbox keys.** Institution endpoints are free, and Sandbox has the full Production list:

  ```bash
  curl -X POST https://sandbox.plaid.com/institutions/search \
    -H 'Content-Type: application/json' \
    -d '{"client_id":"…","secret":"…","query":"Relay","products":["transactions"],"country_codes":["US"]}'
  ```

  Read `institution_id`, `name` and `oauth` from each result. `/institutions/search` returns at most ten matches and leaves out institutions Plaid does not support for new connections. `/institutions/get_by_id` with `institution_id: "ins_117228"` returns the record directly ([Institutions API](https://plaid.com/docs/api/institutions/)).

## 3. Linking one Item without building a UI

### The four calls

1. `POST /link/token/create` with `products: ["transactions"]`, `country_codes: ["US"]`, `language: "en"`, `client_name`, `user.client_user_id` (any stable id; "Personally identifiable information … should not be used"), `webhook: "https://<deployment>.convex.site/plaid"` and `transactions: { days_requested: N }` ([Link API](https://plaid.com/docs/api/link/), [Transactions intro](https://plaid.com/docs/transactions/)). A link token for a new Item "expires after 4 hours" ([Link API](https://plaid.com/docs/api/link/)).
2. Open Plaid Link with that token. The owner searches "Relay", logs in, passes 2FA and picks accounts.
3. `POST /item/public_token/exchange`. "The `public_token` is ephemeral and expires after 30 minutes. An `access_token` does not expire, but can be revoked by calling /item/remove." Store the `item_id` next to it, because webhooks identify the Item by `item_id` ([Items API](https://plaid.com/docs/api/items/)).
4. Call `/transactions/sync` once with no cursor. That call switches on `SYNC_UPDATES_AVAILABLE` for the Item ([Transactions intro, step 5](https://plaid.com/docs/transactions/)).

The `access_token` belongs in a Convex table that only internal functions read, or in `npx convex env set` as #129 plans. It never goes to the browser.

### Hosted Link: no page needed

Add `hosted_link: {}` to the `/link/token/create` request. The response then carries a `hosted_link_url`, and "you can send a user to this URL". The `public_token` comes back through the `SESSION_FINISHED` webhook, or through `/link/token/get` for six hours after the session. Without Plaid delivering the link, the URL lives 30 minutes by default (`hosted_link.url_lifetime_seconds` changes that). "Hosted Link is fully supported with all Plaid products and Link flows (including update mode)" ([Hosted Link](https://plaid.com/docs/link/hosted-link/)). It costs nothing unless Plaid sends the link by SMS or email ([Billing](https://plaid.com/docs/account/billing/)).

So the app's whole "bank connection" feature can be one button that runs a Convex action and opens the returned URL, plus the `/plaid` webhook that receives `SESSION_FINISHED` and exchanges the token. There is no Plaid SDK and no React component. **This is the simpler version for the spec.**

### Update mode (re-linking the same Item)

- **Triggers:** an `ITEM_LOGIN_REQUIRED` error, either returned from an API call or delivered through the `ITEM` / `ERROR` webhook, and the `PENDING_DISCONNECT` webhook (US/CA). All of them mean "the Item should be re-initialized via update mode" ([Update mode](https://plaid.com/docs/link/update-mode/)).
- **How:** call `/link/token/create` with the Item's `access_token` and no `products`: "No products should be added to the `products` array … when creating a `link_token` for update mode" ([Update mode](https://plaid.com/docs/link/update-mode/)). The `webhook` field "will not have an effect" in update mode ([Link API](https://plaid.com/docs/api/link/)). Hosted Link works here too.
- **After:** "An Item's `access_token` does not change when using Link in update mode, so there is no need to repeat the exchange token process" ([Update mode](https://plaid.com/docs/link/update-mode/)). The cursor and every stored `transaction_id` stay valid.
- **`PENDING_DISCONNECT`** fires "7 days before the existing Item is scheduled for disconnection". It carries a `reason`: `INSTITUTION_MIGRATION` (for example "an institution moves from a non-OAuth integration to an OAuth integration") or `INSTITUTION_TOKEN_EXPIRATION` ([Items API](https://plaid.com/docs/api/items/)).
- **`LOGIN_REPAIRED`** fires when the Item healed without update mode in this app. Clear any "reconnect your bank" banner when it arrives ([Items API](https://plaid.com/docs/api/items/)).
- **`NEW_ACCOUNTS_AVAILABLE`** fires when Plaid sees a new account ([Items API](https://plaid.com/docs/api/items/)). Relay allows up to 20 checking accounts ([Relay: Plaid and Yodlee](https://relayfi.com/integrations/plaid-and-yodlee/)). If the owner opens a new one for customer money, the app only sees it after update mode with account selection ([Update mode](https://plaid.com/docs/link/update-mode/)).

### `/item/remove` and re-linking from scratch

- `/item/remove` makes the `access_token` invalid, and it is "required to end subscription billing for the Item". "On a Trial plan, calling /item/remove does not impact the number of remaining Trial Items" ([Items API](https://plaid.com/docs/api/items/)).
- A fresh link is a new Item: "linking the same account at the same institution twice will result in two Items with different `item_id` values" ([Link API](https://plaid.com/docs/api/link/)). The `account_id` also changes "if the `access_token` is deleted and the same credentials … are used to generate a new `access_token`" ([Transactions API](https://plaid.com/docs/api/products/transactions/)). Plaid does not say whether `transaction_id`s carry over to a new Item. Assume they do not: a fresh link replays history under new ids. Payments already matched keep their old `plaidTransactionId`, so the matcher must not offer a replayed deposit again. Checking amount, date and account mask against matched rows is the guard.
- Use a fresh link only when update mode cannot work. After `USER_PERMISSION_REVOKED`, "If you encounter an error when attempting to create a Link token for update mode on an Item with revoked permissions, create a fresh Link token for the user" ([Items API](https://plaid.com/docs/api/items/)).

### Is the Quickstart a sane way to link before the app has a page?

Yes, for #129's one-off samples, with these edits. They come from reading [`node/index.js`](https://github.com/plaid/quickstart/blob/master/node/index.js) and [`.env.example`](https://github.com/plaid/quickstart/blob/master/.env.example):

- `.env`: `PLAID_ENV=production`, the Production secret, `PLAID_PRODUCTS=transactions` (not the default `auth,transactions,signal`), `PLAID_COUNTRY_CODES=US`.
- The Quickstart **does not set `days_requested`**, so Plaid applies the default of 90 days, which is permanent for that Item. Add `transactions: { days_requested: 180 }` to the `configs` object in `/api/create_link_token`. Asking for more costs nothing extra under a flat subscription. It only makes the first historical pull slower ([Transactions intro](https://plaid.com/docs/transactions/)).
- The Quickstart's `/api/transactions` handler calls `transactionsSync` **without `options.include_original_description`**. Add `options: { include_original_description: true }`, or `original_description` will be missing ([Transactions API](https://plaid.com/docs/api/products/transactions/)). The handler also returns only "the 8 most recent transactions" to the browser. The full pages are printed to the server console by `prettyPrintResponse`, so read samples from there.
- The Quickstart **sets no webhook** ("the Quickstart doesn't support webhooks"). If the build keeps this Item, point it at Convex later with `/item/webhook/update` (`access_token`, `webhook`). That call fires `WEBHOOK_UPDATE_ACKNOWLEDGED` to the new URL ([Items API](https://plaid.com/docs/api/items/)). Keeping this Item saves a Trial slot and a second Relay login.
- It holds the `access_token` in memory only. Copy it from the `/api/set_access_token` response or the console before stopping the server.

## 4. Webhooks

### Where the URL lives

- "Webhooks are typically configured via the `webhook` parameter of /link/token/create". Only some products (Identity Verification, Transfer and others) use the Dashboard ([Webhooks](https://plaid.com/docs/api/webhooks/)). So the URL is stored per Item. Change it with `/item/webhook/update` ([Items API](https://plaid.com/docs/api/items/)).
- The URL "must be in the standard format of `http(s)://(www.)domain.com/` and, if https, must have a valid SSL certificate" ([Webhooks](https://plaid.com/docs/api/webhooks/)). A path such as `https://dashing-cricket-260.convex.site/plaid` has that shape. Plaid's docs do not say whether a path is allowed. Every example in them uses one (`https://webhook.sample.com`, `https://wonderwallet.com/webhook_receiver`), so it is safe.
- Posts come from 52.21.26.131, 52.21.47.157, 52.41.247.19 and 52.88.82.239, which are "subject to change" ([Webhooks](https://plaid.com/docs/api/webhooks/)). Do not allowlist by IP; verify the JWT.

### The webhooks that matter

| `webhook_type` / `webhook_code` | What to do | Source |
|---|---|---|
| `TRANSACTIONS` / `SYNC_UPDATES_AVAILABLE` (`item_id`, `initial_update_complete`, `historical_update_complete`, `environment`) | Run the sync loop for that Item | [Transactions API](https://plaid.com/docs/api/products/transactions/) |
| `TRANSACTIONS` / `INITIAL_UPDATE`, `HISTORICAL_UPDATE`, `DEFAULT_UPDATE`, `TRANSACTIONS_REMOVED` | Ignore. They are sent for backwards compatibility; "It is not necessary to listen for and respond to those webhooks when using /transactions/sync" | same |
| `ITEM` / `ERROR` (an `error` object; `error_code` is `ITEM_LOGIN_REQUIRED` in the common case) | Flag the connection as needing the owner; offer update mode | [Items API](https://plaid.com/docs/api/items/) |
| `ITEM` / `PENDING_DISCONNECT` (`reason`, and the disconnect time) | Same, with the 7-day deadline | same |
| `ITEM` / `USER_PERMISSION_REVOKED` | Try update mode; if the link token fails, fresh link. A revocation made through Plaid also ends the subscription | same, [Billing](https://plaid.com/docs/account/billing/) |
| `ITEM` / `LOGIN_REPAIRED` | Clear the flag | [Items API](https://plaid.com/docs/api/items/) |
| `ITEM` / `NEW_ACCOUNTS_AVAILABLE` | Optional: tell the owner | same |
| `ITEM` / `WEBHOOK_UPDATE_ACKNOWLEDGED` | Ignore (confirms `/item/webhook/update`) | same |
| `LINK` / `SESSION_FINISHED` | Only with Hosted Link: take the `public_token` from the payload and exchange it | [Hosted Link](https://plaid.com/docs/link/hosted-link/) |

### Verifying a webhook

Verification is optional, per Plaid, but it is the only real auth: the URL is public ([Webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/)).

1. Read the `Plaid-Verification` header. It is a JWT. Decode the header without verifying it, reject unless `alg` is `ES256`, and take the `kid`.
2. `POST /webhook_verification_key/get` with `{ client_id, secret, key_id: kid }`, on the host of the environment the webhook came from (`sandbox.plaid.com` or `production.plaid.com`). The answer is a JWK (`kty: EC`, `crv: P-256`, `x`, `y`, `created_at`, `expired_at`). Cache it by `kid`.
3. Verify the JWT signature with that JWK. Reject if `iat` is more than 5 minutes old.
4. Take the SHA-256 of the **raw** request body and compare it, in constant time, with `request_body_sha256` from the JWT payload. "The `request_body_sha256` sent in the JWT payload is sensitive to the whitespace in the webhook body". So hash the exact bytes from `await req.text()`, and never re-serialize parsed JSON.

(All steps from [Webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/).)

### Fit for a Convex `httpAction`

- Convex's default runtime (not `"use node"`) provides `crypto`, `CryptoKey` and `SubtleCrypto` ([Convex runtimes](https://docs.convex.dev/functions/runtimes)). `crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, …)` plus `verify({ name: "ECDSA", hash: "SHA-256" }, …)` checks an ES256 JWT, and `crypto.subtle.digest("SHA-256", …)` gives the body hash. HTTP actions "support request and response body types of `.text()`, `.json()`…", with a 20 MB limit ([Convex HTTP actions](https://docs.convex.dev/functions/http-actions)). `fetch` is available for the key call ([Convex runtimes](https://docs.convex.dev/functions/runtimes)).
- **Reply fast.** "If there is a non-200 response or no response within 10 seconds … Plaid will keep attempting to send the webhook for up to 24 hours", backing off ×4 from 30 seconds ([Webhooks](https://plaid.com/docs/api/webhooks/)). Plaid advises keeping the receiver to "write the webhook into a queue or reliable storage" (same page). In Convex that means verify, write a row or schedule an internal action for the sync, and return 200. The route sits in `convex/http.ts` beside `/thumbtack`.
- **Expect duplicates and gaps.** Webhooks can be "duplicate and out-of-order". After more than 24 hours of downtime "you will lose webhooks", so add polling ([Webhooks](https://plaid.com/docs/api/webhooks/)). A daily Convex cron that runs the same sync loop is enough. `/transactions/sync` costs nothing extra under a subscription ([Billing](https://plaid.com/docs/account/billing/)).
- Plaid checks the bank for new transactions "typically between one and four times per day, depending on the institution" ([Transactions intro](https://plaid.com/docs/transactions/)). So a deposit shows up in the app hours after it lands, not seconds. `/transactions/refresh` forces a check but is billed per call on paid plans ([Billing](https://plaid.com/docs/account/billing/)).

## 5. What a deposit carries

### Field by field, per Plaid's docs

| Field | What Plaid says | For an incoming deposit |
|---|---|---|
| `name` | "deprecated … The merchant name or transaction description … a legacy field that is not actively maintained." Always present from `/transactions/sync` | Filled. Plaid's cleaned-up version of the bank's text |
| `merchant_name` | "For some bank transactions (such as checks or account transfers) where there is no meaningful merchant name, this value will be `null`" | Likely `null` for a check deposit and a person-to-person transfer. May be "Stripe" for a payout |
| `original_description` | "The string returned by the financial institution … only be included if the client has set `options.include_original_description` to `true`" | **The field to match on.** It is whatever Relay (or the Zelle bank) writes |
| `counterparties[]` (`name`, `type`, `entity_id`, `confidence_level`) | "extracted by Plaid from the raw description". Types include `payment_app` ("a transfer or P2P app (e.g. Zelle)"), `financial_institution`, `merchant` and `income_source` ("the payer in an income transaction (e.g., an employer, client …)"). `LOW` confidence means "a cleansed name parsed out of the request description" | Zelle likely yields a `payment_app` "Zelle" entry. Whether the sender appears as a second counterparty is not documented |
| `personal_finance_category` (`primary`, `detailed`, `confidence_level`) | A team that enabled Transactions on or after 2025-12-03 gets v2 only. The relevant v2 values are `TRANSFER_IN_DEPOSIT` ("Cash, checks, and ATM deposits"), `TRANSFER_IN_TRANSFER_IN_FROM_APPS` ("Money transferred into the account from another application"), `TRANSFER_IN_ACCOUNT_TRANSFER`, `TRANSFER_IN_WIRE`, `INCOME_CONTRACTOR` ("Income from freelance or independent contract work") and `INCOME_OTHER` | A hint for sorting, not a match key. A check deposit most likely lands in `TRANSFER_IN_DEPOSIT` |
| `payment_channel` | `online`, `in store`, or `other`: "transactions that relate to banks, e.g. fees or deposits" | Likely `other` for all three |
| `check_number` | "only populated for check transactions" | Could be filled for a deposited check. Plaid's docs do not say whether that means checks written or checks deposited |
| `payment_meta` (`payer`, `payee`, `by_order_of`, `payment_processor`, `ppd_id`, `reference_number`, `payment_method`, `reason`) | "the `payment_meta` key will always appear, but no data elements are guaranteed". `payer` is "For transfers, the party that is paying". `reason` is "The payer-supplied description of the transfer" | The one place a sender name or memo could be structured. Fill rate unknown |
| `date` | "For pending transactions, the date that the transaction occurred; for posted transactions, the date that the transaction posted" | Always filled |
| `authorized_date` | "the day the transaction was authorized by the financial institution" (nullable) | May be `null` for deposits |

Field quotes are from the [Transactions API](https://plaid.com/docs/api/products/transactions/). The PFC values are from [Plaid's taxonomy CSV](https://plaid.com/documents/pfc-taxonomy-all.csv). Plaid's typical fill rates: description 100%, `merchant_name` 97% but "Denominator excludes transactions that do not have an associated merchant, such as … direct deposits", and category 95% ([Transactions intro](https://plaid.com/docs/transactions/)).

**Does the payer's name survive?** Plaid's docs never say. Plaid passes on the bank's text. Its troubleshooting page treats a transaction that "appears differently on the online banking portal" as the bank's doing ([Transactions troubleshooting](https://plaid.com/docs/transactions/troubleshooting/)). A good rule: **what Relay shows in its own transaction list is roughly what `original_description` will hold.** The owner can check that in the Relay app today, before any Plaid work.

### Per deposit type

- **Zelle: not possible into Relay.** "Relay does not currently support Zelle … Zelle support is under evaluation, with no confirmed launch date." For customers who would use Zelle, Relay suggests Quick Request or sharing account and routing numbers for ACH ([Relay: Does Relay integrate with Zelle?](https://relayfi.com/hc/en-us/articles/360046353632-Does-Relay-integrate-with-Zelle/)). Any Zelle money the owner receives lands at another bank. That bank needs its own Item (another Trial slot), and its description format is its own. This partly answers the map's open question "Where Zelle actually lands": it cannot be Relay.
- **Mobile check deposit into Relay.** In the Relay app the owner types "the payer's name (the person or business that wrote the check)" and can "Add a short memo". "The deposit enters review immediately and shows up in your transactions list as pending" and "typically settle[s] within seven business days" ([Relay: Deposit a check](https://relayfi.com/hc/en-us/articles/11369994367124-How-to-Deposit-a-Check-Using-the-Relay-Mobile-App/)). Neither Relay nor Plaid says whether that typed payer name or memo reaches the Plaid feed. **That is the most useful single thing #129 can answer**: if it does, typing the invoice number as the memo makes check matching trivial.
- **Direct ACH into Relay** (a customer's bank "send money", or bill pay). "Incoming ACH funds are available in your Relay Account as soon as the ACH is received" ([Relay: settlement timelines](https://relayfi.com/hc/en-us/articles/12713409670420-Transaction-settlement-and-processing-timelines/)). The originator's company name and entry description ride on the ACH entry. Whether Relay passes them through is what the sample will show.
- **Stripe payout.** The bank descriptor comes from the account-level payout descriptor (Stripe Dashboard > payout settings), or from a per-payout one on manual payouts. "If you don't define an account-level or payout-level statement descriptor, we default to 'STRIPE'". For US ACH payouts it maps to the ACH Company Entry Description, "limit[ed] to 10 characters. Stripe silently truncates". "Beneficiary banks don't guarantee that they'll display statement descriptors" ([Stripe: Payout statement descriptors](https://docs.stripe.com/payouts/statement-descriptors)). So the rule from #61 ("described as Stripe") holds by default. Leave that setting at its default, or keep "STRIPE" in it.
- **Relay's own Invoices and Quick Requests paid by card or ACH pull.** These behave like Stripe payouts. "The payout deposits into your Relay account between 4:00am and 9:00am ET on the settlement day", and the per-invoice breakdown is reconciled that evening ([Relay: Invoice and Quick Request fees and settlement](https://relayfi.com/hc/en-us/articles/32108372442772-Invoices-Quick-Requests-Processing-Fees-Settlement-Timelines-Limits/)). If the owner ever uses them, those batched deposits need the same "set aside, don't match" treatment as Stripe payouts.

### What only a real Item can show

- The exact `original_description` text for a check deposit, a direct ACH and a Stripe payout at Relay, and for a Zelle credit at whichever bank gets them.
- Whether the payer name or memo typed at mobile deposit reaches Plaid.
- Whether `payment_meta.payer` or `reason` is ever filled, and whether `check_number` is filled on deposits.
- Which `counterparties` and `personal_finance_category` Plaid assigns to each.
- Whether Relay sends pending transactions at all. Some banks do not: "Some institutions, such as Capital One and USAA, do not provide pending transaction data" ([Transaction states](https://plaid.com/docs/transactions/transactions-data/)).

#129's checklist already captures all of these. It should add `payment_meta` to the fields it pastes.

## 6. History and sync

- **`days_requested`** goes in `/link/token/create` as `transactions.days_requested`: minimum 1, maximum 730, default 90. "In Production, if a value under 30 is provided, a minimum of 30 days of history will be requested. Once Transactions has been added to an Item, this value cannot be updated" ([Link API](https://plaid.com/docs/api/link/)). History then grows: "Plaid retains every new transaction it sees, so the amount of available history grows for as long as the Item remains connected" ([Transactions intro](https://plaid.com/docs/transactions/)). To get more old history you have to `/item/remove` and link again, which on Trial uses another slot ([Transactions API](https://plaid.com/docs/api/products/transactions/)). The matcher only needs recent history, so 180 for the samples item is plenty.
- **First sync:** there is data only once `SYNC_UPDATES_AVAILABLE` arrives with `initial_update_complete: true` (the last 30 days), and then with `historical_update_complete: true` (everything requested) ([Transactions webhooks](https://plaid.com/docs/transactions/webhooks/)). "It is common that no transactions will be returned during this first call" ([Transactions intro](https://plaid.com/docs/transactions/)). While nothing is ready, `next_cursor` is `""`. The Quickstart sleeps 2 seconds and retries in that case ([Quickstart `node/index.js`](https://github.com/plaid/quickstart/blob/master/node/index.js)).
- **Paging and cursor rules** ([Transactions API](https://plaid.com/docs/api/products/transactions/), [Transactions intro](https://plaid.com/docs/transactions/)):
  - `count` defaults to 100, max 500.
  - Loop while `has_more` is true, passing each `next_cursor`.
  - Keep the cursor you started the loop with. On `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` "the entire pagination request loop must be restarted beginning with the cursor for the first page of the update".
  - Save `next_cursor` only after the page where `has_more` is false. That cursor "will be valid for at least 1 year".
  - `added` and `modified` come "ordered by ascending last modified time". A pending transaction's removal and its posted replacement "aren't guaranteed to be in the same page, but should happen within the same overall update" ([Transaction states](https://plaid.com/docs/transactions/transactions-data/)). Apply a whole update in one Convex mutation, or at least process `removed` after `added` for the same update.
  - Do not use the `account_id` option to watch just one account. It "effectively creates a separate incremental update stream -- and therefore a separate cursor". Sync the whole Item and filter by `account_id` in code.
- **Pending to posted for deposits:** "typically … one to five business days … up to fourteen days in rare situations". A posted transaction "cannot necessarily be considered immutable" and can still come back in `modified` ([Transaction states](https://plaid.com/docs/transactions/transactions-data/)). At Relay specifically: mobile check deposits show pending at once and clear in up to 7 business days. Incoming ACH is available "as soon as the ACH is received", which suggests little or no pending stage ([Relay: settlement timelines](https://relayfi.com/hc/en-us/articles/12713409670420-Transaction-settlement-and-processing-timelines/)). So "match posted only" (#61) means a check can take up to a week and a half to show in the app. If that feels slow, showing pending checks as "money on the way" (without writing a Payment), as #61 allowed, is the fix.
- **How long a Zelle receipt stays pending:** not stated by Plaid, and not applicable to Relay. It depends on the receiving bank, and the sample from that bank will show it.
- **Which date to match on:** for posted rows `date` is the posting day and `authorized_date` (nullable) is the day it started ([Transactions API](https://plaid.com/docs/api/products/transactions/)). Use `authorized_date ?? date` for the "days either side of the sent day" window. Keep #61's `America/Los_Angeles` rule for `receivedOn`: Plaid's dates are plain calendar days with no zone.

## Changes this suggests to tickets #128 and #129

- **#128:** replace "Apply for production access with Transactions as the only product" with "Apply for the **Trial plan** at `dashboard.plaid.com/trial-plan`; do **not** submit a Production application (it permanently gives up Trial)". Add "Set the Link use case under Link > Link Customization > Data Transparency" and "Fill in the application profile and company profile". The Trial plan runs in the Production environment, so once it is approved the Production keys are the ones to set with `--prod`, possibly the same day. The `/institutions/search` check stays, but only to read `oauth`: the id is already known (`ins_117228`).
- **#129:** edit the Quickstart before linking. Set `PLAID_PRODUCTS=transactions`, add `transactions.days_requested` to the link token, and add `include_original_description: true` to the sync call. Read full pages from the server console. Add `payment_meta` to the pasted fields. Drop the Zelle-into-Relay sample, because Relay cannot receive Zelle. Link the Zelle bank instead if the owner wants that sample. Remember each Item permanently uses one of the 10 Trial slots.

## Sources

Plaid docs
- Sandbox overview (incl. Limited Production, deprecated): https://plaid.com/docs/sandbox/
- Sandbox institutions: https://plaid.com/docs/sandbox/institutions/
- Pricing and billing (Trial plans, subscription fee, free endpoints): https://plaid.com/docs/account/billing/
- Launch checklist: https://plaid.com/docs/launch-checklist/
- Transactions intro (integration steps, history, testing, pricing): https://plaid.com/docs/transactions/
- Add Transactions to your app: https://plaid.com/docs/transactions/add-to-app/
- Transaction states (pending and posted): https://plaid.com/docs/transactions/transactions-data/
- Transactions webhooks: https://plaid.com/docs/transactions/webhooks/
- Transactions troubleshooting: https://plaid.com/docs/transactions/troubleshooting/
- Transactions API (sync, Transaction object, SYNC_UPDATES_AVAILABLE): https://plaid.com/docs/api/products/transactions/
- PFC taxonomy CSV: https://plaid.com/documents/pfc-taxonomy-all.csv
- Link API (link token, days_requested, webhook, redirect_uri): https://plaid.com/docs/api/link/
- Hosted Link: https://plaid.com/docs/link/hosted-link/
- Update mode: https://plaid.com/docs/link/update-mode/
- OAuth guide: https://plaid.com/docs/link/oauth/
- Items API (exchange, remove, webhook update, Item webhooks): https://plaid.com/docs/api/items/
- Item errors: https://plaid.com/docs/errors/item/
- Webhooks: https://plaid.com/docs/api/webhooks/
- Webhook verification: https://plaid.com/docs/api/webhooks/webhook-verification/
- Institutions API: https://plaid.com/docs/api/institutions/
- Coverage explorer and CSV: https://plaid.com/docs/institutions/ , https://plaid.com/documents/us_institution_coverage.csv
- Pricing page: https://plaid.com/pricing/
- Quickstart repo: https://github.com/plaid/quickstart (`node/index.js`, `.env.example`)

Plaid help center
- Sandbox, Production, Trial plan and Limited Production: https://support.plaid.com/hc/en-us/articles/16110110883479
- What is the Plaid Trial plan?: https://support.plaid.com/hc/en-us/articles/39994173227159
- Upgrading from Trial to paid Production: https://support.plaid.com/hc/en-us/articles/39917307426967
- Billing after upgrading from Trial: https://support.plaid.com/hc/en-us/articles/42878983841303
- Plans compared: https://support.plaid.com/hc/en-us/articles/16110502116887
- How much does Plaid cost?: https://support.plaid.com/hc/en-us/articles/16194632655895
- How do I pay my Plaid invoice?: https://support.plaid.com/hc/en-us/articles/16195021021207

Relay
- Does Relay integrate with Zelle?: https://relayfi.com/hc/en-us/articles/360046353632-Does-Relay-integrate-with-Zelle/
- Plaid and Yodlee: https://relayfi.com/integrations/plaid-and-yodlee/
- Deposit a check with the mobile app: https://relayfi.com/hc/en-us/articles/11369994367124-How-to-Deposit-a-Check-Using-the-Relay-Mobile-App/
- Transaction settlement timelines: https://relayfi.com/hc/en-us/articles/12713409670420-Transaction-settlement-and-processing-timelines/
- Invoice and Quick Request fees and settlement: https://relayfi.com/hc/en-us/articles/32108372442772-Invoices-Quick-Requests-Processing-Fees-Settlement-Timelines-Limits/

Stripe
- Payout statement descriptors: https://docs.stripe.com/payouts/statement-descriptors

Convex
- Runtimes (Web Crypto in the default runtime): https://docs.convex.dev/functions/runtimes
- HTTP actions: https://docs.convex.dev/functions/http-actions
