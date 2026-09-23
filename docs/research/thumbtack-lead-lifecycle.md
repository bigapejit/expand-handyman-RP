# Thumbtack lead lifecycle and the deep link to a conversation

Research for [#80](https://github.com/bigapejit/expand-handyman-RP/issues/80), part of map #77. Checked 2026-09-23.

Each fact is tagged **confirmed** (with the source that says so) or **unverified** (inferred, second-hand, or not documented anywhere I could read).

## Short answer

- The webhook reports a lead **once**, when it is created, plus **every message**. No documented webhook fires when a lead is hired, declined, archived, expired or refunded. Our board has to move cards itself.
- A single conversation opens at `https://www.thumbtack.com/pro-inbox/messages/{negotiationID}`, built from the `negotiationID` in the webhook. Two independent third-party integrations build it that way. Thumbtack does not document it, so it is **unverified**.
- There is no documented mobile deep link to a conversation. The Thumbtack Pro iOS app does not claim `/pro-inbox` links, so on an iPhone the link above opens the browser, not the app.
- A **lead** (direct lead) is a customer who contacted the pro directly. The pro pays automatically. An **opportunity** is a customer who contacted other pros. The pro sends a free quote and pays only if the customer replies. Direct leads arrive by webhook. Whether opportunities do is **unverified**.

## Sources and how they were read

| Source | Readable? |
|---|---|
| developers.thumbtack.com docs pages | Yes. Server-rendered HTML. |
| v4 OpenAPI spec `https://api.thumbtack.com/docs/thumbtack_api_latest.json` (linked from developers.thumbtack.com/api-reference) | Yes. The JSON file itself. |
| pro-api.thumbtack.com/docs (legacy v2, marked "deprecated") | Yes. |
| help.thumbtack.com articles | No with plain HTTP (JavaScript shell only). Read through the `r.jina.ai` rendering proxy, which returns the article text. The article URLs cited below are the originals. |
| community.thumbtack.com | Yes. Posts by Thumbtack staff are flagged "Administrator, Moderator" on the page. These count as second-hand. |
| thumbtack.com `/.well-known/apple-app-site-association` and `assetlinks.json` | Yes. |
| thumbtack.com `/pro-inbox/*` | Not fetched. `robots.txt` has `Disallow: /pro-inbox/`, and the pages need a login. |

## 1. Lead states from the pro's side

There is no single "lead status" field. Thumbtack tracks a lead in four separate places. Each one has its own values and its own owner.

### 1a. Where the lead sits: Jobs, then Messages

| State | Who moves it | Status |
|---|---|---|
| **New** (a label in the Jobs "For you" tab; means the pro hasn't seen it yet) | Thumbtack sets it. It clears when the pro views the lead. | confirmed: [respond-to-leads](https://help.thumbtack.com/article/respond-to-leads) |
| **Responded**: the lead moves from Jobs (`/pro-leads`) to Messages (`/pro-inbox/`) | The pro, by replying | confirmed: [respond-to-leads](https://help.thumbtack.com/article/respond-to-leads), [my-messages](https://help.thumbtack.com/article/my-messages), [messaging-guide](https://help.thumbtack.com/article/messaging-guide) |
| **Declined by pro** ("Can't do it") | The pro | confirmed: [respond-to-leads](https://help.thumbtack.com/article/respond-to-leads) ("If you're not interested… Select Can't do it") |
| **Archived** (a Messages filter) | The pro only. Archiving may need the pro to have replied or declined first. | Filter: confirmed, [my-messages](https://help.thumbtack.com/article/my-messages). Reply-first rule: unverified (a staff guess in [community #1630](https://community.thumbtack.com/discussion/1630)). |
| **Sent quotes** (opportunity quoted, no customer reply yet) | The pro, by quoting | confirmed: [my-messages](https://help.thumbtack.com/article/my-messages) |

### 1b. Hire status (the pro's dropdown at the top of the chat)

The pro picks one of: **Not scheduled yet**, **Scheduled**, **Job done**, **No hire**. The matching inbox filters are **Pending**, **Job confirmed**, **Job done** and **Not hired**.

- Who moves it: the pro, from the dropdown. The customer can also tell Thumbtack the pro was hired, when leaving a review or when asked how the project went. Confirmed: [keep-track-of-my-hires](https://help.thumbtack.com/article/keep-track-of-my-hires), [my-messages](https://help.thumbtack.com/article/my-messages).
- An integration can also set it. `POST /api/v4/negotiations/{negotiationID}/job-status` takes `not_scheduled`, `appt_scheduled`, `job_complete`, `invoice_paid`, `customer_cancel` or `pro_cancel`. The docs say these signals "update the lead's labels in the Thumbtack messenger". This needs an OAuth token with the scope `supply::negotiations.write`. Confirmed: [developers.thumbtack.com/docs/pro-integrations/negotiations](https://developers.thumbtack.com/docs/pro-integrations/negotiations).
- According to a community member, a losing pro sees "hired another pro" only if the winning pro updates their own status. Unverified: [community #1013](https://community.thumbtack.com/discussion/1013).

### 1c. Customer-side events

| Event | Who | Status |
|---|---|---|
| Customer says they're no longer interested, or cancels. Thumbtack says "we'll let you know". | Customer, then Thumbtack notifies the pro | confirmed: [messaging-guide](https://help.thumbtack.com/article/messaging-guide) ("When a customer's plan changes") |
| Customers are asked to message pros when they hire someone else or cancel. This is only a chat message, not a status. | Customer | confirmed: [chat-with-pros](https://help.thumbtack.com/article/chat-with-pros) |
| **Expired**: an opportunity can no longer be quoted after 48 hours, once 5 pros have shown interest, or when the customer cancels | Thumbtack | confirmed: [opportunities](https://help.thumbtack.com/article/opportunities) |
| Direct leads expire | I found no documented expiry | unverified |

### 1d. Billing

- The API object has `chargeState` (`Created`, `Pending`, `Charged`, `Refunded`), `leadPrice`, `refundDetails` and `refundRequestLink`. Confirmed: the `NegotiationV4` schema in the [v4 spec](https://api.thumbtack.com/docs/thumbtack_api_latest.json).
- Some refunds happen automatically, for example a Trust & Safety flag or a Smart Match lead the pro declines. Everything else goes through a request the pro files within 45 days, and Thumbtack decides. Confirmed: [refund-policy](https://help.thumbtack.com/article/refund-policy). Billing is out of scope for the map.

### 1e. The API's own `status` field

- `NegotiationV4.status` can be `Open`, `Canceled` or `Picked`. Confirmed: [v4 spec](https://api.thumbtack.com/docs/thumbtack_api_latest.json).
- What each value means, and who sets it, is not documented. "Picked" could mean the customer chose this pro, but that is **unverified**.

## 2. What the webhooks report

| Event | What it carries | Status |
|---|---|---|
| `NegotiationCreatedV4` | The full lead at creation: `negotiationID`, customer (name and phone), request, estimate, `status`, `leadPrice`, `chargeState` | confirmed: [v4 spec](https://api.thumbtack.com/docs/thumbtack_api_latest.json) `webhooks`, [negotiations doc](https://developers.thumbtack.com/docs/pro-integrations/negotiations) |
| `MessageCreatedV4` | Each message, with `negotiationID` | confirmed: [v4 spec](https://api.thumbtack.com/docs/thumbtack_api_latest.json), [testing guide](https://developers.thumbtack.com/docs/pro-integrations/testing) |
| `ReviewCreatedV4` | A new review | confirmed: v4 spec |
| `PresetJob*V4` (Matched, StatusChanged, Cancelled, Updated, Completed) | Preset jobs only, with statuses `won`, `lost`, `expired`, `declined`, `cancelled` and a `deepLink` field | confirmed: v4 spec, `BusinessWebhookEventTypeV4` |
| A lead or negotiation **status update** event | **None in the spec.** The full list of business webhook event types is `MessageCreatedV4`, `NegotiationCreatedV4`, `ReviewCreatedV4` and the five `PresetJob*V4` events. | confirmed absent: [v4 spec](https://api.thumbtack.com/docs/thumbtack_api_latest.json) |

- The [Manage Webhooks](https://developers.thumbtack.com/docs/pro-integrations/self-serve-webhooks) page does say "Leads (negotiation*) — new leads, status updates". No event name or payload for a status update exists anywhere in the spec or the guides. Whether the self-serve webhook ever sends a status update is **unverified**. Build as if it doesn't.
- The legacy v2 "Update Lead" webhook (`PUT …/lead/update`) sends only `leadID`, `leadPrice` and `chargeState`. It exists because the price is set after the lead. It carries no hire or archive state. Confirmed: [pro-api.thumbtack.com/docs](https://pro-api.thumbtack.com/docs/), which is deprecated.
- **Hired, no hire, archived, declined, expired and refunded are not pushed to us.** Refunds and the `Open/Canceled/Picked` status can be pulled with `GET /api/v4/negotiations/{id}`, but that needs an API token (fog on the map). Hire status and archive state are not in the API object at all. Confirmed by what the `NegotiationV4` schema contains.

**Side finding.** A pro can set up the webhook alone, with no partner application. The path is Thumbtack website → Apps → [Manage webhooks](https://www.thumbtack.com/pro/webhooks/list). It covers leads, messages and reviews, has a "Test this webhook" button and a "Recent deliveries" log, and is one-way only. Confirmed: [how-to-create-a-webhook](https://help.thumbtack.com/article/how-to-create-a-webhook) and [self-serve-webhooks](https://developers.thumbtack.com/docs/pro-integrations/self-serve-webhooks). This answers the "unverified what a pro can do alone" note on #77.

## 3. Deep link to one conversation

**Web: `https://www.thumbtack.com/pro-inbox/messages/{negotiationID}`**. Unverified, but well supported:

- A search engine has indexed `https://www.thumbtack.com/pro-inbox/messages/549672207244328965`. The id is 18 digits, the same form as the negotiation ids in the docs (for example `519153480500518912`).
- Two unrelated third-party codebases build this exact URL from the webhook's `negotiationID`:
  - [McDonnies/optima-integrations-public `thumbtack_handler.py`](https://github.com/McDonnies/optima-integrations-public/blob/main/src/handlers/thumbtack_handler.py): `"thumbtack_lead_url": f"https://www.thumbtack.com/pro-inbox/messages/{self.negotiation_id}"`, where `negotiation_id = data.negotiationID`.
  - [drbartender/os `thumbtack-agent/src/index.js`](https://github.com/drbartender/os/blob/main/thumbtack-agent/src/index.js): `replyLeadUrlTemplate … 'https://www.thumbtack.com/pro-inbox/messages/{id}'` ("{id} is replaced with the negotiation id"). The comments show the author opened real threads at this URL in August 2026. Caution: that repo is a browser-automation bot, which Thumbtack's terms forbid. Use it only as evidence of the URL shape.
- Supporting clues:
  - Thumbtack calls the pro–customer thread a "bid" internally. The v4 spec maps "partnerBookingId … maps to the Thumbtack bid PK".
  - The customer app's thread URL is `/request/*/bids/*/messages` (from the iOS app-site-association file).
  - The v4 spec describes `negotiationID` as the "identifier of the business-customer pairing".
  - So negotiation id = bid id = thread id is consistent. Thumbtack never states it.
- Caveat, unverified: a lead the pro hasn't answered yet lives in Jobs (`/pro-leads`), not Messages. The drbartender comments suggest an unanswered lead shows a "respond panel" on a `pro-leads` page. So the link may land on a different view, or redirect, before the pro first replies. This needs a test with a real lead.
- The pro must be logged in to thumbtack.com. `/pro-inbox/sent` redirects to `/login` when logged out. Confirmed with an HTTP check.
- Other official URLs: Messages list `https://www.thumbtack.com/pro-inbox/`, Jobs `https://www.thumbtack.com/pro-leads`, Opportunities `https://www.thumbtack.com/pro-leads/opportunities`. Confirmed: linked from [types-of-leads](https://help.thumbtack.com/article/types-of-leads) and [my-messages](https://help.thumbtack.com/article/my-messages).

**Mobile:**

- The Thumbtack Pro iOS app (`com.thumbtack.wingtip`, confirmed as "Thumbtack for Professionals" by the [iTunes lookup](https://itunes.apple.com/lookup?id=908795016)) claims only these web paths: `/login/mobile/pro/*`, `/dispatcher/*`, `/a/*`, `/pro-calendar*`, `/pro-leads`, `/services`, `/profile/dashboard` and a few others. It does **not** claim `/pro-inbox/*`. Confirmed: [apple-app-site-association](https://www.thumbtack.com/.well-known/apple-app-site-association). So on an iPhone the conversation link opens Safari, not the app. That part is inferred from how universal links work.
- On Android, `com.thumbtack.pro` is listed in [assetlinks.json](https://www.thumbtack.com/.well-known/assetlinks.json) with `handle_all_urls`. Which paths it actually opens is set inside the app. Unverified.
- Help articles link to the pro app through the Branch domain `thumbtackpro.app.link`, which opens the app's home screen. There is no documented per-conversation app link. Only preset jobs get a `deepLink` field, and it isn't a chat link. Confirmed: [pay-for-leads](https://help.thumbtack.com/article/pay-for-leads), v4 spec `PresetJobBaseV4.deepLink`.

## 4. Direct leads vs opportunities (and preset jobs)

| | Lead (direct) | Opportunity ("Open lead") | Preset job |
|---|---|---|---|
| How it starts | Customer found the pro in search and contacted them directly | Customer contacted *other* pros and hasn't hired yet. The pro sends a quote. | A pre-scheduled job the pro claims |
| Payment | Automatic, at the pro's lead price | Quoting is free. The pro is charged only if the customer responds. | A percentage fee on the job |
| Where it shows | Jobs → For you, then Messages after the reply | Jobs → Opportunities, then Messages if the customer responds | Jobs → For you |
| Status | confirmed | confirmed | confirmed |

Sources: [types-of-leads](https://help.thumbtack.com/article/types-of-leads), [opportunities](https://help.thumbtack.com/article/opportunities), [pay-for-leads](https://help.thumbtack.com/article/pay-for-leads).

Do both arrive by webhook?

- **Direct leads: yes.** `NegotiationCreatedV4` is "sent when a customer contacts a business with a request". Confirmed: [negotiations implementation guide](https://developers.thumbtack.com/docs/pro-integrations/negotiations/implementation).
- **Opportunities: unverified.**
  - The docs never mention opportunities.
  - The deprecated v2 lead payload had a `leadType` with values like `REQUEST_A_QUOTE` and `MISMATCH_REQUEST_A_QUOTE` ([pro-api docs](https://pro-api.thumbtack.com/docs/)). The v4 payload has no lead type field at all.
  - My guess is that a negotiation, and so a webhook, appears only once the customer replies to the pro's quote. That is the point where the pro pays and the thread moves to Messages. A real opportunity reply would settle it.
- **Preset jobs** have their own API webhooks (`PresetJob*V4`). The self-serve webhook lists only leads, messages and reviews.

## What this means for the board

The webhook tells us a lead exists and streams its messages. Nothing more. Hired, no hire, archived and expired are never pushed. So:

- Columns have to move in our app: by the owner, or by simple rules such as "customer replied" from message events. They can't mirror Thumbtack's status.
- If the API is granted later, we could push our status *to* Thumbtack with `job-status`. We still couldn't read the pro's dropdown back.
- The Send message button can use `https://www.thumbtack.com/pro-inbox/messages/{negotiationID}`. Before relying on it, test it once with a real lead, both before and after the first reply.
