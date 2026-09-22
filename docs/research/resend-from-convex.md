# Sending link-only proposal emails from Convex through Resend

Research resolving [issue #11](https://github.com/bigapejit/expand-handyman-RP/issues/11), part of
[#8](https://github.com/bigapejit/expand-handyman-RP/issues/8) (signing and proposal roadmap).

Date: 2026-09-22. Every claim below is traced to Resend's docs, Porkbun's API reference, Google's
Workspace docs, Convex's docs, FRSG's code, or a live DNS query made while writing this; links at the
bottom. Nothing was changed: no DNS records, no Resend account, no Convex env vars.

## Question

What exactly is needed to send proposal emails from a Convex action via Resend, From
`proposals@expandhandyman.com`, Reply-To the owner's mailbox, with no attachment?

## Short answer

**Four DNS records, one `fetch`, three env vars, and the free plan.**

- **DNS.** Resend verifies `expandhandyman.com` with a DKIM TXT at `resend._domainkey`, an MX and an SPF
  TXT on the `send` subdomain, and (optionally, recommended) a DMARC TXT at `_dmarc`. **None of them
  collide** with what is live today: the root MX (`smtp.google.com`) and the root SPF
  (`v=spf1 include:_spf.porkbun.com ~all`) stay exactly as they are, because Resend puts its MX and
  SPF on `send.expandhandyman.com`, not the root. `send.*`, `resend._domainkey.*` and `_dmarc.*` all
  return NXDOMAIN right now, so there is nothing to merge. The Porkbun DNS API can add all four
  (`POST /api/json/v3/dns/create/expandhandyman.com`), once "API Access" is switched on for the domain.
- **The call.** FRSG's `convex/email.ts` is a hand-rolled `POST https://api.resend.com/emails` with
  `from`, `to`, `subject`, `text`, `reply_to`; it never throws and returns
  `sent` / `notSent` / `fault`. It runs in Convex's default runtime (no `"use node"`) as an internal
  action scheduled with `ctx.scheduler.runAfter(0, …)` from the mutation that issued the link. Dropping
  attachments removes the only awkward part of it. Port it nearly verbatim; add an `Idempotency-Key`.
- **Env vars** live in the Convex dashboard per deployment (`dashing-cricket-260` prod,
  `glorious-donkey-718` dev), never in Vercel: `RESEND_API_KEY`, `APP_ORIGIN`
  (`https://staff.expandhandyman.com`), and `EMAIL_REPLY_TO` (the owner's real mailbox). Leave the key
  unset on dev and the code logs the letter instead of sending it (`notSent`).
- **Limits.** Free plan: 3,000 emails/month, **100/day**, 3 domains, 30-day log retention; API rate
  limit 10 requests/second per team. A handyman's proposal volume is nowhere near any of these.
- **Later, webhooks.** Store `email.delivered`, `email.bounced`, `email.complained`; skip `opened` and
  `clicked` (FRSG's research and code already made and justified this cut, and Expand's
  `documentViews` table is a better "opened" signal than Resend's).

One thing worth flagging outside the ticket's scope: the root domain's SPF authorises Porkbun's
forwarders, not Google (`_spf.google.com`), and there is no Google DKIM (`google._domainkey`) either.
That does not affect Resend at all, but it means the owner's own Workspace mail from
`@expandhandyman.com` gets no aligned SPF or DKIM pass today. Adding a DMARC record with `p=none` is
still safe (monitor only), but nobody should ever move it to `quarantine`/`reject` until that is fixed.

## Findings

### 1. What is live on `expandhandyman.com` today

Queried on 2026-09-22 with `Resolve-DnsName` against Porkbun's nameservers and Google's `8.8.8.8`:

| Name | Type | Value |
| --- | --- | --- |
| `expandhandyman.com` | NS | `curitiba/fortaleza/maceio/salvador.ns.porkbun.com` |
| `expandhandyman.com` | A | `76.76.21.21` (Vercel) |
| `staff.expandhandyman.com` | A | `76.76.21.21` (Vercel) |
| `expandhandyman.com` | MX | `1 smtp.google.com` |
| `expandhandyman.com` | TXT | `v=spf1 include:_spf.porkbun.com ~all` |
| `expandhandyman.com` | TXT | `google-site-verification=V4U7WTRQBC-…` |
| `_dmarc.expandhandyman.com` | TXT | **does not exist** |
| `google._domainkey.expandhandyman.com` | TXT | **does not exist** |
| `send.expandhandyman.com` | MX / TXT | **does not exist** |
| `resend._domainkey.expandhandyman.com` | TXT | **does not exist** |

So: mail for the domain is received by Google Workspace; the root SPF was written for Porkbun's
email forwarding (`_spf.porkbun.com` expands to `a:fwd1/fwd2/fwd3.porkbun.com a:hognose1.porkbun.com
a:transactional1.porkbun.com ~all`), not for Google; and none of the names Resend needs are taken.

### 2. The DNS records Resend asks for, and the collision check

Resend's own Porkbun guide lists the records for a domain in the default region, with the host names
already trimmed the way Porkbun's form wants them (Porkbun does not strip the domain for you: "Instead
of `send.example.com`, paste only `send`"; "Instead of `resend._domainkey.example.com`, paste only
`resend._domainkey`"):

| Purpose | Host (Porkbun "name") | Type | Value | Prio | TTL |
| --- | --- | --- | --- | --- | --- |
| DKIM | `resend._domainkey` | TXT | `p=<the key Resend shows on the domain page>` | – | 600 |
| Return-Path / bounces | `send` | MX | `feedback-smtp.us-east-1.amazonses.com` | 10 | 600 |
| SPF for the Return-Path | `send` | TXT | `v=spf1 include:amazonses.com ~all` | – | 600 |
| DMARC (optional, add after verification) | `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:<a mailbox the owner reads>;` | – | 600 |

The DKIM value is generated per domain when you click *Add Domain* in the Resend dashboard, so it
cannot be written down here; the other three values are fixed for `us-east-1`. Resend also lists an
optional `inbound` MX for receiving mail through Resend; Expand does not want that (receiving stays with
Google), so do not add it.

**Region.** The MX value embeds the region. Resend offers `us-east-1`, `eu-west-1`, `sa-east-1`,
`ap-northeast-1`, chosen when the domain is added; changing later means deleting and re-adding the
domain and updating DNS. Expand's customers are in the US, so `us-east-1`.

**Why nothing collides.**

- Resend's MX and SPF live on `send.expandhandyman.com` (the default Return-Path subdomain, which the
  docs say Resend "uses the `send` subdomain for the Return-Path address" by default and which can be
  renamed in *Advanced options* if ever wanted). SPF is evaluated against the envelope sender
  (`MAIL FROM`/Return-Path), which will be `…@send.expandhandyman.com`, so the **root SPF does not need
  `include:amazonses.com`** and does not need to change. The root MX is untouched, so inbound mail keeps
  going to Google.
- DKIM is a new name, `resend._domainkey`, and Google's would be `google._domainkey` if it existed.
  Different selectors never collide.
- DMARC alignment: Resend signs DKIM with `d=expandhandyman.com` (the verified domain), and the
  From is `proposals@expandhandyman.com`, so DKIM is strictly aligned; SPF's `send.expandhandyman.com`
  aligns under DMARC's default *relaxed* mode, which matches on the organisational domain
  (RFC 7489 §3.1). A `p=none` DMARC record is therefore safe for Resend traffic from day one.
- Resend's DMARC doc: "If you have a verified domain with Resend, it means you are already passing
  SPF and DKIM." Start with `p=none`, move to `quarantine`/`reject` only "once delivery and
  authentication are confirmed across all email sources". The "all sources" clause is what bites here:
  see §1's note about Google's SPF/DKIM being absent. Google's own guidance says DMARC is required only
  for bulk senders (5,000+ messages/day to Gmail) and that `p=none` is an acceptable policy, so for
  Expand DMARC is hygiene, not a gate.

**Root vs subdomain.** Resend recommends "sending your emails from one or more subdomains (e.g.,
`updates.example.com`) instead of your root domain to isolate your sending reputation". The ticket
fixes the From at `proposals@expandhandyman.com` (root), which is what FRSG does too
(`reports@frsgusa.com`). At Expand's volume (a few transactional letters a week, to people who asked
for them) the reputation-isolation argument is weak, and a root From reads better to a customer. Keep
the root; the cost is nothing today and the option to move to a subdomain later is a second domain in
Resend, not a rewrite.

**Verification timing.** "your domain will often verify within 15 minutes of adding the DNS records.
However, DNS changes can occasionally take up to 72 hours to propagate globally." There is a *Restart
verification* button if it is still pending after that.

**No mailbox is needed for `proposals@`.** "Once a domain is verified in your Resend account, you can
send from any email address at that domain" and "The email address you send from does not need to
exist in another system. However, we recommend using addresses that can receive replies." That last
sentence is exactly why `reply_to` is set to the owner's real mailbox: replies to a nonexistent
`proposals@` would bounce off Google.

### 3. Adding the records through the Porkbun API

Yes, it can. From Porkbun's API v3 reference (v3.34):

- **Prerequisite in the dashboard.** Create a key at *Account → API Access* (the secret "will only be
  visible to you this one time"), then *Account → Domain Management → expandhandyman.com → Details →
  API Access → enable*. A key can be scoped to one domain and/or a source-IP allowlist, which is the
  right shape for a one-off wizard.
- **Endpoint.** `POST https://api.porkbun.com/api/json/v3/dns/create/expandhandyman.com` with JSON
  body `{"apikey","secretapikey","name","type","content","ttl","prio"}`. `name` is "Subdomain for the
  record (e.g. 'www', '*' for wildcard, blank for root). Do not include the domain name itself."
  `ttl` "Minimum is determined by account settings (typically 600)". `prio` is for MX/SRV. The response
  is `{"status":"SUCCESS","id":"<record id>"}`. A `dryRun: true` body field validates without writing.
- **Read-back.** `POST /api/json/v3/dns/retrieve/expandhandyman.com` (or GET with `X-API-Key` /
  `X-Secret-API-Key` headers) lists every editable record, which is how a script confirms the four are
  present before Resend is asked to verify.

The four calls, with the DKIM value left as a placeholder:

```json
{"name":"resend._domainkey","type":"TXT","content":"p=<from Resend>","ttl":600}
{"name":"send","type":"MX","content":"feedback-smtp.us-east-1.amazonses.com","ttl":600,"prio":10}
{"name":"send","type":"TXT","content":"v=spf1 include:amazonses.com ~all","ttl":600}
{"name":"_dmarc","type":"TXT","content":"v=DMARC1; p=none; rua=mailto:<owner mailbox>;","ttl":600}
```

Honest judgement: four records is a two-minute job in Porkbun's UI, and the DKIM value has to be
copied out of the Resend dashboard by a human either way. The API is worth using only if the setup is
wrapped in a `wizard`-style script that also creates the Resend domain (`POST /domains` returns the
records to add) and polls verification. Otherwise the dashboard is fine, and the deployment doc already
records that "Porkbun: staff A record points to Vercel; … Existing website and email records were
preserved", so the owner has done this once.

### 4. The REST call FRSG makes, and its outcome model

`convex/email.ts` in FRSG is the whole provider seam. Stripped of attachments, the request it builds is:

```ts
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from,                 // "Expand Handyman <proposals@expandhandyman.com>"
    to: [to],
    subject,
    text,
    ...(html === undefined ? {} : { html }),
    ...(replyTo === undefined ? {} : { reply_to: replyTo }),  // REST is snake_case; only the SDK says replyTo
  }),
});
```

Resend's documented body for `POST /emails`: `from` (required, `"Name <email@example.com>"`), `to`
(required, string or array, max 50), `subject` (required), `reply_to` (string or array), `text`, `html`,
`headers`, `tags` (name/value ASCII letters, digits, `_`, `-`, max 256 chars each), `attachments`,
`scheduled_at`, `template`, `cc`, `bcc`, `topic_id`. The success response is `{"id":"<uuid>"}` and that
id is the `email_id` every later webhook carries. Optional request header `Idempotency-Key` (max 256
chars): within 24 hours a repeat with the same key "will give the same response, without actually
sending the email again"; Resend suggests the shape `<event-type>/<entity-id>`.

The result type FRSG hands back, and what each arm means for Expand:

| Outcome | When | What the caller does |
| --- | --- | --- |
| `{ outcome: "sent", id }` | 2xx from Resend; `id` parsed from the body, `null` if absent | Store `id` on the document for the webhook join |
| `{ outcome: "notSent", reason: "noApiKey" }` | `RESEND_API_KEY` unset. The full letter is `console.log`ged instead | Nothing is wrong: this is dev, CI, a preview |
| `{ outcome: "fault", fault: "MISSING_RECIPIENT" }` | Customer has no email | Misconfiguration; show it in the UI |
| `{ outcome: "fault", fault: "MISSING_FROM_ADDRESS" }` | No from-address configured | Misconfiguration |
| `{ outcome: "fault", fault: "REQUEST_FAILED" }` | `fetch` threw (network) | Link is live; UI says "email failed, copy the link" |
| `{ outcome: "fault", fault: "HTTP_<status>" }` | Non-2xx; the body is logged | Same, and the status tells you which of the below |

The statuses worth recognising in that log line, from Resend's error reference:

- `403 validation_error` "The `domain.com` domain is not verified" or "You can only send testing
  emails to your own email address" (the latter is what you get on the shared `onboarding@resend.dev`
  sender before a domain is verified).
- `401 missing_api_key` / `403 restricted_api_key` / `403 suspended_api_key`.
- `422 validation_error` / `missing_required_field` / `invalid_parameter` (bad address, empty body).
- `429 daily_quota_exceeded` (the free plan's 100/day), `429 monthly_quota_exceeded`,
  `429 rate_limit_exceeded` (10 req/s per team; `ratelimit-remaining` and `retry-after` headers).
- `500 application_error`, `503 service_unavailable`.

Two details of FRSG's design that matter more than the field list:

- **Nothing throws.** The send runs in an `internalAction` scheduled by the mutation that committed the
  state change. Convex: "Scheduling functions from mutations is atomic with the rest of the mutation …
  if the mutation succeeds, the scheduled function is guaranteed to be scheduled", but actions "are not
  automatically retried" and "execute at most once". So a thrown error there is an unhandled failure
  nobody sees, and the mutation's own outcome (the link is issued) must never depend on Resend being up.
  FRSG writes the result back with `internal.signingLinks.recordEmailOutcome` (`emailOutcome`,
  `emailFault`, `emailId` on the link row) and the staff panel says "email failed, here is the link to
  copy".
- **Default runtime, no Node.** `fetch` is available in Convex's default runtime, so the file has no
  `"use node"` and no SDK dependency. Same for FRSG's webhook verifier, which uses Web Crypto.

**Where it hooks into Expand.** `convex/documents.ts#issue` is the mutation that turns a draft into a
`ready` document and freezes the customer's name and site onto it; the send belongs at the end of that
handler as `await ctx.scheduler.runAfter(0, internal.proposalEmails.sendSigningLink, {...})`. Two
things Expand has to add that FRSG already had:

1. **A server-side origin.** Expand builds the link in the browser
   (`components/document-editor.tsx`: `${window.location.origin}/sign/${doc.token}`); the action has
   no browser, so it needs `APP_ORIGIN` (FRSG: `FRSG_APP_ORIGIN`) to write
   `https://staff.expandhandyman.com/sign/<token>` into the letter.
2. **The customer's address.** `customers.email` exists in the schema already; `issue` should copy it
   onto the document alongside `customerName`/`site` so the letter goes to the address the link was
   issued for, not whatever the customer record says later.

Add two things FRSG does not do, both cheap:

- Send `Idempotency-Key: signing-link/<documentId>/<first 16 hex of token>` so a hand re-run of the
  action (`npx convex run`) or a future retry loop cannot double-send within 24 hours.
- Send `tags: [{ name: "letter", value: "signing_link" }]` so a webhook handler can route by letter
  kind without a read (FRSG's research recommended this; its code never got round to it).

Resend's API intro also says "All API requests must include a `User-Agent` header. Requests without
this header will be rejected with a `403`". FRSG's call sets none and sends from production, so
Convex's `fetch` evidently supplies one; setting `"User-Agent": "expand-handyman/<version>"` explicitly
costs nothing and removes the dependency on that.

**Reply-To.** `reply_to` accepts a string or array. The ticket says "the owner's mailbox". Expand has
one owner and the schema stores no staff email, so the honest sources are (a) the Clerk identity's
email on the session that issued the link, or (b) an env var. Prefer the env var (`EMAIL_REPLY_TO`):
the login identity is `andrew@cogtex.ai` per `docs/deployment.md`, and the mailbox customers should
reply to is a business fact that should not be coupled to whichever address happens to be allowlisted
for login. Fall back to the Clerk email if the var is unset, and treat neither being present as
`MISSING_REPLY_TO`, not as a silent send.

**Do not adopt `@convex-dev/resend`.** Convex's first-party component is real and works (queueing via
workpools, batching to `/emails/batch`, idempotency, a mounted webhook route, `testMode` defaulting to
`true`), but it brings a component, a workpool and a schema of its own for a system that sends one
letter per link issue. FRSG's 150-line `fetch` is the right size, and its webhook verifier is portable
too. Revisit if Expand ever sends in bulk.

### 5. Env vars: names, values, and where they live

All of these are read with `process.env` inside Convex functions, so they are set on the **Convex
deployment**, not on Vercel. Convex: "you can use different values for the same key in dev and prod
deployments"; set them in the dashboard under *Settings → Environment Variables* or with
`npx convex env set NAME value` (dev) / `npx convex env set --prod NAME value` (prod). Convex also
exposes `CONVEX_SITE_URL` (`https://<deployment>.convex.site`) automatically, which is the base of any
future webhook URL.

| Var | Prod `dashing-cricket-260` | Dev `glorious-donkey-718` | Notes |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | `re_…` from Resend → API Keys, permission **`sending_access`**, restricted to `expandhandyman.com` | **leave unset** | Unset means `notSent` and the letter goes to the Convex log; that is the whole dev story. Key permission `sending_access` "Can only send emails"; `domain_id` pins it to one domain. |
| `APP_ORIGIN` | `https://staff.expandhandyman.com` | `http://localhost:3210` (or unset) | Used only to build the URL in the letter. Unset with a key set is a fault (`MISSING_APP_ORIGIN`), as in FRSG. |
| `EMAIL_REPLY_TO` | the owner's real mailbox | same, or unset | See §4. |
| `EMAIL_FROM` (optional override) | default in code: `Expand Handyman <proposals@expandhandyman.com>` | – | FRSG keeps the default as a business fact in `shared/frsg-business.ts` and lets `FRSG_EMAIL_FROM` override it. Do the same; the constant is the decision, the var is an escape hatch. |
| `RESEND_WEBHOOK_SECRET` (later) | `whsec_…` from the webhook's page | a sibling webhook's secret, or unset | Unset: the route 400s everything, mail still sends. |

Record the list in `.env.example` the way the file already does for `CLERK_JWT_ISSUER_DOMAIN` and
`OWNER_CLERK_ID` ("Convex deployment variables: …"), and in `docs/deployment.md`. Nothing here is
`NEXT_PUBLIC_`.

Resend-side setup, in order: add domain (`expandhandyman.com`, region `us-east-1`) → add the records
from §2 → wait for *Verified* → create the API key with `sending_access` scoped to the domain → set
`RESEND_API_KEY` on prod. Until the domain is *Verified*, sends from `proposals@expandhandyman.com`
fail with `403 validation_error` and the only thing that works is `onboarding@resend.dev` to the
account owner's own address.

### 6. Free-tier limits and rate limits

From Resend's pricing page and API reference, checked today:

- **Free:** 3,000 emails/month, "limited to 100 emails per day", 3 domains, 30-day data retention,
  no dedicated IP. Webhooks and open/click tracking are available on every plan (FRSG's research
  confirmed this; the pricing page today shows Pro with "5 webhook endpoints", so expect the free tier
  to allow fewer, which is still enough for one prod endpoint).
- **Pro:** from $20/month for 50,000 emails, $0.90 per extra 1,000, no daily cap, 10 domains.
- **API rate limit:** "The default maximum rate limit is 10 requests per second per team", across all
  keys; headers `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after`; 429 on
  excess, increases on request.

For Expand: one letter per link issue, one per signed copy if that is added later, one per decline.
Even a busy month is two orders of magnitude under the free cap. The one limit to remember is
**100/day**: a bulk "re-send to everyone" feature would need to queue across days or move to Pro.
The **30-day retention** means the Resend dashboard is not an archive; anything the app wants to show
later has to be stored in Convex (which is what §7 is for).

### 7. For later: which webhook events are worth storing

FRSG researched this in `docs/research/resend-signing-link-email-events.md` and then built it
(`convex/resendWebhook.ts`, `convex/http.ts` `/resend/webhook`, `shared/signing-link-email.ts`). The
conclusions transfer to Expand unchanged, and the code is dependency-free and portable.

Resend's eleven email events, from the current event-types page: `sent`, `delivered`,
`delivery_delayed`, `bounced`, `complained`, `opened`, `clicked`, `failed`, `suppressed`, `scheduled`,
`received`.

**Store three:**

| Event | Resend's definition | Why it earns a row |
| --- | --- | --- |
| `email.delivered` | "successfully delivered the email to the recipient's mail server" | The strongest true statement; wording must stop short of "they saw it" |
| `email.bounced` | "the recipient's mail server permanently rejected the email" | The one that means the customer will never sign and nobody knows; payload has `bounce.message`, `bounce.type` (`Permanent`/`Temporary`) |
| `email.complained` | "delivered, but the recipient marked it as spam" | Changes what the owner does next (phone, do not re-send) |

**Skip two, deliberately:** `opened` is a 1×1 GIF fetch that Apple Mail prefetches and Gmail proxies
("not a statistically accurate way of detecting if your users are engaging"), and a plain-text letter
gets no open tracking at all. `clicked` requires domain-wide click tracking, which rewrites every link
onto a Resend redirector, and the signing link is a bearer credential. Expand already has a
better-than-Resend answer: `documentViews` records every open of the signing page, who opened it, and
for how long. Leave open and click tracking **off** on the Resend domain (it is a per-domain setting).

**Mechanics that shape the implementation** (all from Resend's webhook docs, all already handled in
FRSG's code):

- Delivery is at-least-once with retries at 5 s, 5 min, 30 min, 2 h, 5 h, 10 h; events "may arrive out
  of order"; dedupe on the `svix-id` header; order on the payload's `created_at`; always return 200 for
  anything you verified, or the retry ladder runs for ten hours.
- Signature: Svix headers `svix-id`, `svix-timestamp`, `svix-signature` over `<id>.<timestamp>.<raw
  body>` with the `whsec_` secret. FRSG verifies it with `crypto.subtle` in the HTTP action itself (no
  `svix` package, no Node), with a five-minute timestamp window, so the route is testable under
  `convex-test`.
- The join is `data.email_id` = the `id` returned at send. Store it on the document at send. FRSG hit
  a real race here: Resend can deliver (or bounce) before the mutation that writes `emailId` runs, so
  it holds early events in a waiting table and claims them inside the same transaction that writes the
  id. Copy that too.
- Endpoint for prod would be `https://dashing-cricket-260.convex.site/resend/webhook`, subscribed to
  the three events only; secret into `RESEND_WEBHOOK_SECRET`. Webhook source IPs, if Convex ever needs
  them: `44.228.126.217`, `50.112.21.217`, `52.24.126.164`, `54.148.139.208`, `2600:1f24:64:8000::/52`.

## Recommendation

1. **Resend:** create the account, add `expandhandyman.com` in `us-east-1`, no custom return path.
2. **Porkbun (dashboard is fine):** add `resend._domainkey` TXT (value from Resend), `send` MX
   `feedback-smtp.us-east-1.amazonses.com` prio 10, `send` TXT `v=spf1 include:amazonses.com ~all`,
   and after verification `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<owner mailbox>;`. Touch nothing
   on the root: the Google MX and the existing SPF stay.
3. **Separately, and not for this ticket:** fix the root SPF to include `_spf.google.com` (keep
   `_spf.porkbun.com` only if Porkbun forwarding is still used) and turn on Google Workspace DKIM, so
   the owner's own mail authenticates. Do not raise DMARC above `p=none` before that.
4. **Code:** port FRSG's `convex/email.ts` minus attachments and `convex/proposalEmails.ts#sendSigningLink`
   minus the PDF; schedule from `documents.issue`; record `emailOutcome`/`emailFault`/`emailId` on the
   document; copy `customers.email` onto the document at issue; add `Idempotency-Key`, `tags` and an
   explicit `User-Agent`. Default runtime, no SDK, no component.
5. **Env:** `RESEND_API_KEY` (`sending_access`, domain-scoped) on prod only; `APP_ORIGIN` and
   `EMAIL_REPLY_TO` on both; keep the From as a constant in code with an `EMAIL_FROM` override.
6. **Webhooks:** a follow-up ticket; port `resendWebhook.ts` and the `/resend/webhook` route, subscribe
   to `delivered`, `bounced`, `complained` only, and show them on the document's Activity card next to
   the view log.

## Sources

Resend:

- [Domains introduction](https://resend.com/docs/dashboard/domains/introduction): own-domain requirement, subdomain recommendation, links to add-a-domain, return path, regions, DMARC.
- [Add a domain](https://resend.com/docs/add-a-domain): steps, "DKIM and SPF configurations (TXT and MX or CNAME records)", region choice, "often verify within 15 minutes … up to 72 hours", Restart verification.
- [Porkbun DNS guide](https://resend.com/docs/knowledge-base/porkbun): the exact host/value/priority table for MX `send`, TXT `send`, TXT `resend._domainkey`, optional `inbound` MX; "paste only `send`" / "paste only `resend._domainkey`".
- [Custom return path](https://resend.com/docs/dashboard/domains/custom-return-path): default `send` subdomain, naming constraints.
- [Regions](https://resend.com/docs/dashboard/domains/regions): the four regions, chosen at add time, change requires delete and re-add.
- [DMARC](https://resend.com/docs/dashboard/domains/dmarc): `_dmarc` TXT, `v=DMARC1; p=none; rua=…`, "already passing SPF and DKIM", progressive policy.
- [Subdomain or root domain](https://resend.com/docs/knowledge-base/is-it-better-to-send-emails-from-a-subdomain-or-the-root-domain): reputation isolation argument.
- [Create a sender](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend): "send from any email address at that domain", mailbox "does not need to exist".
- [API introduction](https://resend.com/docs/api-reference/introduction): base URL, Bearer auth, User-Agent requirement, status codes.
- [Rate limit](https://resend.com/docs/api-reference/rate-limit): 10 req/s per team, headers, 429.
- [Errors](https://resend.com/docs/api-reference/errors): every error name and status quoted in §4.
- [Send email](https://resend.com/docs/api-reference/emails/send-email): body parameters, `reply_to`, tags constraints, `Idempotency-Key`, `{ id }` response.
- [Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys): 24-hour window, 256 chars, `<event-type>/<entity-id>`.
- [Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key): `full_access` vs `sending_access`, `domain_id`, `re_` prefix.
- [Pricing](https://resend.com/pricing): free 3,000/month, 100/day, 3 domains, 30-day retention; Pro $20, 50,000, 10 domains, 5 webhook endpoints.
- [Webhooks introduction](https://resend.com/docs/dashboard/webhooks/introduction): at-least-once, retry schedule, ordering, `svix-id`, source IPs.
- [Event types](https://resend.com/docs/dashboard/webhooks/event-types): the eleven `email.*` events and definitions.

Porkbun:

- [API v3 full reference (llms-full.txt, v3.34)](https://porkbun.com/llms-full.txt): auth (body or `X-API-Key` headers), `POST /dns/create/{domain}` fields and response, `dns/retrieve`, `dryRun`, TTL minimum, per-key domain/IP scoping, rate-limit headers.
- [OpenAPI spec](https://porkbun.com/api/json/v3/spec): same content, machine-readable.
- [Getting started with the Porkbun API](https://kb.porkbun.com/article/190-getting-started-with-the-porkbun-api): key creation, secret shown once, per-domain "API Access" toggle under Domain Management → Details.

Google:

- [Set up SPF (Workspace)](https://knowledge.workspace.google.com/admin/security/set-up-spf): `v=spf1 include:_spf.google.com ~all`, one SPF record per domain, combining includes.
- [Email sender guidelines](https://support.google.com/a/answer/81126): SPF or DKIM for all senders; SPF, DKIM, DMARC (`p=none` acceptable) and alignment for 5,000+/day senders.

Standards:

- [RFC 7489 §3.1](https://www.rfc-editor.org/rfc/rfc7489#section-3.1): DMARC identifier alignment, relaxed mode matches on the organisational domain.
- [RFC 7208](https://www.rfc-editor.org/rfc/rfc7208): SPF is checked against the `MAIL FROM` (envelope) domain.

Convex:

- [Environment variables](https://docs.convex.dev/production/environment-variables): dashboard settings, per-deployment values, `npx convex env set`, `CONVEX_SITE_URL` / `CONVEX_CLOUD_URL`.
- [CLI](https://docs.convex.dev/cli): `env set/get/list/remove`, `--prod`.
- [Actions](https://docs.convex.dev/functions/actions): `fetch` in the default runtime, 10-minute timeout, schedule from mutations, not auto-retried.
- [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions): scheduling is atomic with the mutation; actions run at most once; `_scheduled_functions` status.
- [get-convex/resend README](https://github.com/get-convex/resend): the first-party component (workpool, batching, `testMode: true` default, `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET`), considered and not adopted.

FRSG (`https://github.com/bigapejit/frsg-app`, read at `C:/Users/andyp/AppData/Local/Temp/frsg-app`):

- `convex/email.ts`: the `fetch`, `EmailResult` (`sent`/`notSent`/`fault`), `EmailFault`, no-key logging.
- `convex/proposalEmails.ts`: `sendSigningLink` internal action, plain-text letter, `replyTo`, `MISSING_APP_ORIGIN`, writes `emailId` back.
- `convex/signingLinks.ts#recordEmailOutcome` and `convex/schema.ts`: `emailOutcome`, `emailFault`, `emailId` (indexed), `signingLinkEmailEvents`, the waiting-events table for the send/webhook race.
- `convex/resendWebhook.ts` and `convex/http.ts` `/resend/webhook`: Web Crypto Svix verification, three events kept, 200 for everything verified.
- `shared/signing-link-email.ts`: the three-word event vocabulary.
- `docs/research/resend-signing-link-email-events.md`: the open/click analysis this document defers to.
- `.env.example` and `docs/agents/convex-deployments.md`: `RESEND_API_KEY`, `FRSG_EMAIL_FROM`, `FRSG_APP_ORIGIN`, `RESEND_WEBHOOK_SECRET` and the `npx convex env set --prod` convention.

This repo:

- `convex/documents.ts#issue`: where the send hooks in; `convex/schema.ts`: `customers.email`, `documents`, `documentViews`.
- `components/document-editor.tsx`: the browser-side signing URL (`/sign/<token>`), which the server cannot build without `APP_ORIGIN`.
- `docs/deployment.md`: deployments `dashing-cricket-260` / `glorious-donkey-718`, Porkbun records already added for Vercel and Clerk.
- Live DNS on 2026-09-22 (`Resolve-DnsName` against Porkbun's nameservers and `8.8.8.8`): the table in §1.
