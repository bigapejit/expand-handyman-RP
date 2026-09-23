# Thumbtack webhooks: payloads and how a pro switches them on

Research for ticket #79 (map #77). Checked 2026-09-23.

Each fact is marked **confirmed** (with the page that says it) or **unverified**.

## Short answers

- **A pro can switch webhooks on alone.** No partner grant, no OAuth. You set them up at `thumbtack.com/pro/webhooks/list` for leads, messages and reviews. **Confirmed**, [Manage Webhooks in Thumbtack][self-serve].
- **The message webhook can carry the pro's own replies.** The payload has `from: "Business" | "Customer"`, plus a `business` object that is only there "if the sender is the business". The testing guide says the event fires "when either party sends a message". **Confirmed**, [OpenAPI spec][spec] and [Testing guide][testing].
  - **Unverified:** whether a reply the owner types *in the Thumbtack app* fires the webhook on a *self-serve* webhook. The self-serve page lists messages as "incoming customer messages". The old v2 API was customer-only. A five-minute live test settles it (see the end of this file).
- **The lead webhook has name, phone, address, category, description, answers, estimate, lead price, IDs and a timestamp. It has no email.** **Confirmed**, [spec][spec]. The phone is probably a Thumbtack proxy number (**unverified**).
- **There is no lead-update webhook in the v4 API.** The only lead event is `NegotiationCreatedV4`. **Confirmed**, [spec][spec]. The self-serve page says "status updates" are included, but no documented event or payload backs that up (**unverified**).
- **Webhook auth is Basic auth or a custom header that you pick.** There is no signing secret and no HMAC. **Confirmed**, [spec][spec]. Whether the self-serve screen lets you set auth: **unverified**. Retry policy: **not documented anywhere I could read**.
- **Message history exists:** `GET /v4/negotiations/{id}/messages`, up to 20 per page, with `sentBefore`/`sentAfter` filters. It needs an OAuth token. **Confirmed**, [spec][spec] and [Messages][messages].

## Sources read

| Source | Readable? |
|---|---|
| [developers.thumbtack.com/docs/overview][overview] | Yes (server-rendered) |
| [Manage Webhooks in Thumbtack][self-serve] (`/docs/pro-integrations/self-serve-webhooks`) | Yes |
| [Leads][leads] (`/docs/pro-integrations/negotiations`) | Yes |
| [Negotiations Implementation Guide][impl] | Yes |
| [Messages][messages] (`/docs/pro-integrations/messages`) | Yes |
| [Pro Profiles][businesses] (`/docs/pro-integrations/businesses`, webhook CRUD) | Yes |
| [Testing Your Pro Integration][testing] | Yes |
| [Getting Started][getting-started], [Authentication][auth], [Troubleshooting][troubleshooting], [Changelog][changelog] | Yes |
| [OpenAPI spec v4.0.0][spec] (`api.thumbtack.com/docs/thumbtack_api_latest.json`, the data behind `/api-reference`) | Yes, JSON |
| [pro-api.thumbtack.com/docs][v2] (old v2 API) | Yes. The banner says "This API is now deprecated." |
| [help.thumbtack.com/article/how-to-create-a-webhook][help] | **No.** It is a JavaScript-rendered Salesforce page. curl and WebFetch both get only the "Thumbtack Help" header, and search engines have no text snippet for it. |
| `thumbtack.com/pro/webhooks/list` (the self-serve screen) | Not tried. It needs a pro login. |

There are two API generations. v4 (`api.thumbtack.com/api/v4/...`, "negotiations") is current. v2 (`pro-api.thumbtack.com/v2/...`, "leads") is deprecated. The map's note about `POST /v2/business/{businessId}/lead/{leadId}/message` refers to the deprecated v2 API. The v4 equivalent is `POST /api/v4/negotiations/{negotiationID}/messages`.

## 1. How webhooks are switched on

### Self-serve, with no integration

**Confirmed**, [Manage Webhooks in Thumbtack][self-serve] (last updated Jun 18 2026). Verbatim:

> Create and manage webhooks for leads, messages, and reviews directly from your Thumbtack account — no integration required.

> Go to your Thumbtack account to create, edit, pause, or delete webhooks.

> Set up webhooks yourself from inside Thumbtack — create, edit, pause, and delete — for these event families:
> Leads (negotiation*) — new leads, status updates
> Messages (message*) — incoming customer messages
> Reviews (review*) — new reviews from customers
>
> This is the simplest path if you want real-time events delivered to a tool you already use — no developer required, no API integration, no OAuth.

The comparison table on the same page says: best for "Setting up webhooks for your own business, or one you've hired a dev to wire up". Effort is "None — set up in the UI". It covers "One Thumbtack business at a time". Auth is "Your Thumbtack account".

> Both paths can run side-by-side — managing webhooks here won't block partner-managed webhooks set up via the API for the same business.

Its reasons to use the API instead include:

> Webhook auth managed by your system rather than the pro

That line implies the self-serve screen lets the pro set webhook auth. **Unverified:** I could not read the screen or the help article.

- The "Get Started" link goes to `https://thumbtack.com/pro/webhooks/list`. **Confirmed** (link target in the page HTML).
- The help article link is `https://help.thumbtack.com/article/how-to-create-a-webhook`. It was unreadable (see Sources).
- Getting Started says the same thing: "Just need webhooks for one Thumbtack business? You can manage webhooks for leads, messages, and reviews directly in your Thumbtack account — no API integration required." **Confirmed**, [Getting Started][getting-started].

### API route (partners, needs OAuth)

**Confirmed**, [Pro Profiles][businesses] and [spec][spec]. `POST /api/v4/businesses/{businessID}/webhooks`. The request below is verbatim from the Pro Profiles page:

```
POST /api/v4/businesses/{{businessID}}/webhooks HTTP/2
authorization: Bearer {{authCode}}
content-type: application/json
{
    "webhookURL": "<your webhook URL>",
    "eventTypes": [
        "MessageCreatedV4",
        "NegotiationCreatedV4"
    ],
    "enabled": false,
    "auth": {
        "username": "hello",
        "password": "world"
    }
}
```

- Business webhook event types (spec `BusinessWebhookEventTypeV4`): `MessageCreatedV4`, `NegotiationCreatedV4`, `ReviewCreatedV4`, `PresetJobMatchedV4`, `PresetJobStatusChangedV4`, `PresetJobCancelledV4`, `PresetJobUpdatedV4`, `PresetJobCompletedV4`. **Confirmed.** The PresetJob events belong to on-demand orders, not ordinary leads.
- `webhookURL` must match `^https://…`. **Confirmed**, spec `HttpsURL`.
- There is also a test endpoint, `POST /v4/businesses/{businessID}/webhooks/test-negotiation` ("Create a test negotiation for a Business"). **Confirmed**, spec. It needs OAuth.

## 2. Verifying calls, and retries

- **Auth options (confirmed, spec `WebhookAuthV4`).** "The authentication method to use when calling the webhook URL. If not provided, no authentication will be used." It is one of:
  - `WebhookBasicAuthV4` `{ username, password }`, sent as HTTP Basic.
  - `WebhookCustomHeaderAuthV4` `{ header, value }`: "The header name needed for a webhook's authentication."
  - `authType` enum: `None`, `Basic`, `CustomHeader`.
- **No signing secret or HMAC (confirmed by absence).** The spec has no signature field or header for Thumbtack's outgoing webhooks. The only HMAC in the spec is `JobberHmacAuth` (`X-Jobber-Hmac-SHA256`), which is a security scheme for a Jobber-specific endpoint and has nothing to do with these webhooks. So the check is a shared secret: compare the Basic credentials or the custom header value.
- **Response contract (confirmed, spec, every webhook).** "2XX: Return a 2XX status to indicate that the data was received successfully". 4XX/5XX: "Return a non-200 error code indicating unsuccessful processing of webhook data".
- **Retry policy: unverified. Not documented** in the v4 docs, the spec, the troubleshooting page or the v2 docs. Nothing says whether Thumbtack retries, how often, or for how long. Plan for at-least-once *and* possibly-never delivery: dedupe on `messageID` / `negotiationID`.
- The deprecated v2 docs had one related rule: "Sometimes messages might be delivered for leads that were created before the corresponding business was enabled in the API. In these cases, partners will not have seen that lead come through ProAPI before, and they should return 202." **Confirmed** for v2 only, [v2 docs][v2]. **Unverified** whether v4 does the same, but expect messages for leads the app has never seen.

## 3. Lead webhook: `NegotiationCreatedV4`

Every webhook body is `{ "event": {...}, "data": {...} }`. **Confirmed**, spec `webhooks.NegotiationCreatedV4`.

`event` (required: all four):

| Field | Type | Notes |
|---|---|---|
| `eventType` | string | `"NegotiationCreatedV4"` |
| `description` | string | "A description of the webhook event" |
| `webhookID` | string (int64) | |
| `triggeredAt` | date-time | "The date and time the event was triggered" |

`data` (a Negotiation; required: `negotiationID`, `createdAt`, `customer`, `business`, `request`, `estimate`):

| Field | Type | Notes |
|---|---|---|
| `negotiationID` | string (int64) | The lead ID |
| `createdAt` | date-time | |
| `customer.customerID` | string (int64) | required |
| `customer.firstName` | string | required, example `"John"` |
| `customer.lastName` | string | required, example `"Doe"` |
| `customer.phone` | string | required, example `"555-555-5555"` |
| `business.businessID` | string (int64) | required |
| `business.name` | string | required |
| `business.imageURL` | uri | required |
| `business.phoneNumber` | string | optional |
| `business.accessCode` | string | "The access code allows business associates who are not pre-registered to contact the customer through the proxy phone number" |
| `request.requestID` | string | required |
| `request.customerID` | string | required |
| `request.contactedBusinesses[]` | array | "The businesses that were successfully contacted." Each has businessID, name, imageURL, phoneNumber, negotiationID |
| `request.description` | string | required. The customer's free text |
| `request.category.categoryID` / `.name` | string | required, e.g. `"House Cleaning"` |
| `request.proposedTimes[]` | `{start, end}` | optional |
| `request.booking` | `{start, duration}` | optional. Duration in minutes |
| `request.location` | `{address1, address2, city, state, zipCode}` | required. Only city/state/zip are required inside it |
| `request.travelPreferences[]` | enum | `CustomerTravelToProvider`, `ProviderTravelToCustomer`, `Remote` |
| `request.details[]` | `{question, answer}` | required. The request form Q&A |
| `request.attachments[]` | `{fileName, fileSize, mimeType, url, description}` | required (may be empty) |
| `estimate` | `{type, pricePerUnit, unitQuantity, unitName, total}` | required. `type`: `Fixed`, `PerUnit`, `OnSite`, `Hourly`, `MoreInfo` |
| `status` | enum | `Open`, `Canceled`, `Picked` |
| `leadPrice` | string | e.g. `"$25.00"`. What the pro pays Thumbtack |
| `leadPriceBreakdown` | `{subtotal, salesTax}` | optional, added 2026-05-11 ([changelog][changelog]) |
| `chargeState` | enum | `Created`, `Pending`, `Charged`, `Refunded` |
| `refundDetails` | object | optional |
| `requestReviewLink` | uri | shareable review link for this lead |
| `refundRequestLink` | uri | deeplink to the refund survey |

Against the ticket's checklist:

- **Customer name:** yes, first and last. **Confirmed.** Note that the message payloads and `GET` examples use `displayName` like `"Olivia Y."` (last initial only), while the lead webhook schema has a full `lastName`. **Unverified** whether real payloads carry the full last name.
- **Phone:** yes, and required. **Masked or proxy: unverified.** The `accessCode` description mentions "the proxy phone number", which suggests customers are reached through a Thumbtack proxy. The docs never say whether `customer.phone` is that proxy or the real number. The map's plan to label it "Thumbtack number" fits either way.
- **Email:** **not in the payload.** **Confirmed** by absence in the spec's Negotiation schema.
- **Address:** yes, `request.location`, with street lines optional. The deprecated v2 docs said street address is given only for lead types `INSTANT_BOOK, BOOKING, INSTANT_CONSULT, SERVICE_CALL`. **Unverified** for v4.
- **Category, description, price (estimate + leadPrice), lead ID, business ID, timestamps:** yes. **Confirmed.**
- **No deep link to the conversation** in the payload. **Confirmed** by absence. The "Send message" button will have to build a Thumbtack URL itself (**unverified** URL pattern).

### Sample payloads (verbatim)

There is no verbatim `NegotiationCreatedV4` sample on any page. The Leads page says the webhook sends "the full lead payload", and the closest verbatim sample is the `GET` response on that page. It uses a trimmed shape, with `displayName` and `category` at the top level, which does not match the webhook schema exactly. [Leads][leads]:

```json
{
  "negotiationID": "519153480500518912",
  "status": "active",
  "category": {
    "categoryID": "201565295100608806",
    "name": "Kitchen Remodel"
  },
  "customer": {
    "customerID": "519153480034934784",
    "displayName": "Olivia Y.",
    "location": {
      "city": "San Francisco",
      "state": "CA",
      "zipCode": "94117"
    }
  },
  "business": {
    "businessID": "468046965846925323",
    "name": "Robert's Remodeling"
  },
  "details": [
    {
      "question": "Project scope",
      "answer": "Full kitchen renovation"
    }
  ],
  "createTime": "2024-06-13T17:18:01Z"
}
```

The doc sample and the spec disagree on several fields: `status: "active"` versus the spec enum `Open/Canceled/Picked`, `createTime` versus `createdAt`, and `customer.displayName` versus `firstName`/`lastName`. Trust the spec, and log the first real payload to check.

Deprecated v2 lead sample, for reference only. Verbatim from [v2 docs][v2]:

```json
{
  "leadID": "299614694480093245",
  "createTimestamp": "1498760294",
  "request": {
    "requestID": "2999842694480093245",
    "category": "Interior Painting",
    "categoryID": "122681972262289742",
    "title": "Interior Painting",
    "description": "There is a stain on the door that needs to be touched up.",
    "schedule": "Date: Tue, May 05 2020\nTime: 6:00 PM\nLength: 3.5 hours",
    "location": {
      "address1": "101 Alma Street",
      "address2": "",
      "city": "Palo Alto",
      "state": "CA",
      "zipCode": "94301"
    },
    "travelPreferences": "Professional must travel to my address.",
    "details": [
      {
        "question": "Type of property",
        "answer": "Home"
      },
      {
        "question": "Number of rooms",
        "answer": "4 rooms"
      }
    ],
    "attachments": [
      {
        "fileName": "door.jpg",
        "fileSize": 1139,
        "mimeType": "image/jpeg",
        "url": "https://www.thumbtack.com/attachment/b180b7d3bf981dd2896732f979f44fbf45fc4224/door.jpg",
        "description": "my stain"
      }
    ]
  },
  "customer": {
    "customerID": "331138063184986319",
    "name": "John Davis",
    "phone": "1234567890"
  },
  "business": {
    "businessID": "286845156044809661",
    "name": "Tim's Painting Business"
  },
  "leadType": "INSTANT_BOOK",
  "leadPrice": null,
  "chargeState": null
}
```

## 4. Message webhook: `MessageCreatedV4`

**Confirmed**, spec `webhooks.MessageSentV4`. The event is titled "New Message sent on a Negotiation thread" and its `eventType` enum is `MessageCreatedV4`. `data` is the same `MessageV4` schema used by the list and send endpoints.

`data` (required: `messageID`, `negotiationID`, `from`, `text`, `sentAt`):

| Field | Type | Notes |
|---|---|---|
| `messageID` | string (int64) | Dedupe key |
| `negotiationID` | string (int64) | Links to the lead |
| `from` | enum | **`"Business"` or `"Customer"`**. The sender field |
| `customer` | `{customerID, displayName}` | "Customer info if the sender is the customer. Not present if the message is from a business." |
| `business` | `{businessID, displayName}` | "Business info if the sender is the business. Not present if the message is from a customer." |
| `text` | string | "Text of the message" |
| `attachments[]` | `{fileName, fileSize, mimeType, url, description}` | |
| `sentAt` | date-time | e.g. `"2024-10-23T11:43:52Z"` |

### Does it carry the pro's own replies?

- **Yes, the schema supports pro replies. Confirmed.** It has a direction field (`from`), and a `business` block exists only for business-sent messages ([spec][spec]).
- **The docs say it fires for both sides. Confirmed.** Verbatim, [Testing][testing]: "If you subscribe to message events, a `MessageCreatedV4` event when either party sends a message".
- **Conflicting line. Confirmed text.** The self-serve page describes the family as "Messages (message*) — incoming customer messages" ([self-serve][self-serve]).
- **Old v2 behaviour. Confirmed, deprecated.** "Messages will be coming from the Thumbtack customer to the Partner's Pro" ([v2][v2]).
- **Still unverified:** that a reply the owner types in the Thumbtack pro app, as opposed to one sent through the API, triggers the webhook, and that it does so on a *self-serve* webhook. The v4 docs lean yes. The self-serve page's wording leans no.

**How to settle it in five minutes.** Point a self-serve message webhook at a webhook.site URL. Have someone send the owner a message on a real or old lead, then have the owner reply in the Thumbtack app. If a second event arrives with `"from": "Business"`, the board gets the full chat from webhooks alone.

### Sample payloads (verbatim)

There is no verbatim webhook body. This is the list endpoint's response, whose items share the webhook's `data` schema. Verbatim from [Messages][messages]:

```json
{
  "data": [
    {
      "messageID": "519153481515696128",
      "negotiationID": "519153480500518912",
      "customer": {
        "customerID": "519153480034934784",
        "displayName": "Olivia Y."
      },
      "from": "Customer",
      "text": "Are you available on my date?",
      "attachments": [],
      "sentAt": "2024-06-13T17:18:01Z"
    }
  ],
  "pagination": {
    "limit": 3
  }
}
```

Deprecated v2 message sample, which has no sender field. Verbatim from [v2 docs][v2]:

```json
{
  "leadID": "299614694480093245",
  "customerID": "331138063184986319",
  "businessID": "286845156044809661",
  "message": {
    "messageID": "8699842694484326245",
    "createTimestamp": "1498760294",
    "text": "Do you offer fridge cleaning or is that extra?",
    "attachments": [
      {
        "fileName": "fridge.jpg",
        "fileSize": 3940,
        "mimeType": "image/jpeg",
        "url": "https://www.thumbtack.com/attachment/b180b7d3bf981dd2896732f979f44fbf45fc4224/fridge.jpg",
        "description": "refrigerator"
      }
    ]
  }
}
```

## 5. Lead update webhook

- **v4 API: none. Confirmed.** Neither the spec's `webhooks` section (`NegotiationCreatedV4`, `MessageSentV4`, `IncentiveUsedV4`, `ReviewCreatedV4`) nor the business event-type enum has a negotiation-updated or status-changed event. The only "status changed" events are the on-demand `PresetJob*` ones.
- **Self-serve UI: unverified.** The page lists "Leads (negotiation*) — new leads, status updates". The `*` and "status updates" suggest the screen may offer more negotiation events than the public spec shows. I found no event name or payload for them. Check the event list on the self-serve screen.
- **Deprecated v2 "Update Lead": confirmed, deprecated.** It reported only the lead price and charge state, not the job status. Verbatim: "Currently, lead price is generated after generating the leads, so Thumbtack needs a new updateLead API for sending updated payload to any Partner." Sample: `{"leadID": "465324000282984455", "leadPrice": "$26.00", "chargeState": "Charged",}`.
- **The reverse direction exists.** `POST /api/v4/negotiations/{id}/job-status` lets *us* tell Thumbtack `not_scheduled`, `appt_scheduled`, `job_complete`, `invoice_paid`, `customer_cancel` or `pro_cancel`. It needs OAuth scope `supply::negotiations.write`. **Confirmed**, [Leads][leads]. This is out of scope for v1, but relevant later.

So for board columns, v1 cannot rely on Thumbtack to say a lead was lost or hired. Columns will have to move from the owner's own actions, or from `GET /v4/negotiations/{id}` polling once there is a token (`status`: `Open`/`Canceled`/`Picked`).

## 6. Message history for backfill

- **`GET /api/v4/negotiations/{negotiationID}/messages` (confirmed, [spec][spec], [Messages][messages]).** Messages page: "You can also fetch message history for active leads."
  - Query params: `limit` (1–20, default 10), `sentBefore`, `sentAfter` (date-time).
  - OAuth scope: `supply::messages.read`.
  - Returns the same `MessageV4` shape, including `from`. So backfill would include the pro's own past replies.
  - "for active leads": **unverified** whether closed or old leads are readable.
- **Lead list for a business: unverified.** The Leads page shows `GET /api/v4/businesses/{{businessID}}/negotiations`, but that path is **not in the OpenAPI spec**. Only `GET /v4/negotiations/{negotiationID}` is. So backfilling leads you have no ID for may not be possible.
- All of these need an OAuth access token, which means a partner grant. Self-serve webhooks give no token. **Confirmed** by the self-serve comparison table (the API path needs "OAuth2 partner credentials").

## 7. Auth facts that affect the "later" fog

**Confirmed**, [Authentication][auth]. Access tokens last 3600 s. Refresh tokens need the `offline_access` scope, are "single use with a grace period of 60 seconds", and are "valid for up to 180 days", with each exchange resetting the window. This matches the map's notes.

## Open items for the owner or a live test

1. On `thumbtack.com/pro/webhooks/list`, which event types are listed? Is there a lead status-update event? Can you set a username/password or a header?
2. Live test: does replying in the Thumbtack app fire a `MessageCreatedV4` with `"from": "Business"` on a self-serve webhook?
3. From the first real lead: is `customer.phone` a proxy number? Is `lastName` a full name or an initial?
4. Does Thumbtack retry after a 5XX? Log the delivery attempts during the first week.

[overview]: https://developers.thumbtack.com/docs/overview
[self-serve]: https://developers.thumbtack.com/docs/pro-integrations/self-serve-webhooks
[leads]: https://developers.thumbtack.com/docs/pro-integrations/negotiations
[impl]: https://developers.thumbtack.com/docs/pro-integrations/negotiations/implementation
[messages]: https://developers.thumbtack.com/docs/pro-integrations/messages
[businesses]: https://developers.thumbtack.com/docs/pro-integrations/businesses
[testing]: https://developers.thumbtack.com/docs/pro-integrations/testing
[getting-started]: https://developers.thumbtack.com/docs/getting-started
[auth]: https://developers.thumbtack.com/docs/getting-started/authentication
[troubleshooting]: https://developers.thumbtack.com/docs/getting-started/troubleshooting
[changelog]: https://developers.thumbtack.com/docs/changelog
[spec]: https://api.thumbtack.com/docs/thumbtack_api_latest.json
[v2]: https://pro-api.thumbtack.com/docs/
[help]: https://help.thumbtack.com/article/how-to-create-a-webhook
