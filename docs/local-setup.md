# Run your own instance

This guide connects a local checkout to your own development services. The
business deployment at `staff.expandhandyman.com` requires an authorized staff
account; cloning this repository does not provide access to its data or accounts.

## Check the code without service accounts

Install Node.js 20.9 or newer and npm, then:

```sh
git clone https://github.com/bigapejit/expand-handyman-RP.git
cd expand-handyman-RP
npm ci
npm test
npm run typecheck
```

Tests run against local fixtures and stubs. This is the quickest way to explore
the application's rules without setting up its integrations.

## Start the interactive app

### 1. Create development services

- Create your own **Clerk development application** with an email-based sign-in
  method. Copy its publishable key, secret key, and Frontend API/issuer URL from
  the Clerk dashboard.
- Prepare your own **Convex account/project**. The CLI below can create a project
  and development deployment when you first run it.

Configure Clerk's Convex integration/JWT template named `convex` using the
[official integration guide](https://docs.convex.dev/auth/clerk). This app expects
`aud: convex` and the `email` and `email_verified` claims. The existing browser-test
setup script uses these template claims:

```json
{
  "aud": "convex",
  "email": "{{user.primary_email_address}}",
  "email_verified": "{{user.email_verified}}",
  "name": "{{user.full_name}}"
}
```

### 2. Configure the frontend and initialize Convex

Copy `.env.example` to `.env.local` (on PowerShell:
`Copy-Item .env.example .env.local`). Set your own Clerk development values:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

These are placeholders. The secret key stays local or in service settings; it
must not be committed. `.env.local` is ignored by Git.

Run:

```sh
npx convex dev
```

Follow the CLI prompts to select/create your project. It writes the development
`CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local` and syncs the
backend. Keep this command running in its terminal.

### 3. Configure backend authentication

In your **development Convex deployment's Settings → Environment Variables**, set:

| Variable | Value |
| --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Your Clerk development application's Frontend API/issuer URL |
| `OWNER_EMAIL` | Your own sign-in email; verify that email in Clerk |
| `CLERK_SECRET_KEY` | Your own Clerk development secret key; needed for staff invitations |
| `APP_ORIGIN` | `http://localhost:3210` |

After creating your user, you can also set `OWNER_CLERK_ID` to its Clerk user ID.
The backend accepts the pinned ID or a verified email in `OWNER_EMAIL`. The Convex
CLI syncs `auth.config.ts` using the issuer setting; confirm the dev terminal has
successfully synced after configuring it.

If you enable Clerk's sign-up allowlist, add your owner email before signing up.
Other staff can later be invited through the app's Staff page. Every admitted staff
member has the same application permissions.

### 4. Run Next.js

In a second terminal:

```sh
npm run dev
```

Open **http://localhost:3210**, create/sign into your own Clerk user, and verify its
email. Start with a fictional customer record. Creating a site requires the
Google Places integration below; the app does not bundle an interactive demo
database or automatically seed customer records.

## Configure features as needed

These variables belong on the relevant **Convex deployment**, rather than in the
public repository. Basic navigation and customer management can be explored
before the additional integrations are configured.

| Feature | Configuration |
| --- | --- |
| Site address lookup | `GOOGLE_MAPS_API_KEY`, restricted to Google Places API (New); required to create sites through address lookup |
| Stripe Checkout | Your Stripe **test-mode** `STRIPE_SECRET_KEY`, matching `STRIPE_WEBHOOK_SECRET`, and `APP_ORIGIN`; configure the webhook for your own Convex deployment |
| Proposal/invoice email | Your Resend `RESEND_API_KEY`, verified sender domain, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and `APP_ORIGIN`; with no sending key, development logs the message instead of sending it |
| PDF download | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_BROWSER_RENDERING_TOKEN`, and `APP_ORIGIN`; the renderer must be able to reach the paper page at that origin |
| Thumbtack lead ingestion | Your own Thumbtack webhook connection and `THUMBTACK_WEBHOOK_SECRET` |

Cloudflare cannot reach `localhost` on your computer. Use a reachable deployment
of your own app to exercise cloud PDF rendering; the paper UI can still be viewed
locally. Use fictional records and Stripe test mode during development.

Provider event lists and workflow details are in [deployment.md](deployment.md).
That file also contains notes for the existing business deployment: substitute
your own project names, domains, credentials, and owner identity when following
its integration instructions.

## Deploy your own copy

Fork the repository and connect your fork to your own Vercel project. Configure
the matching Clerk keys and Convex frontend URL in Vercel, and a production
`CONVEX_DEPLOY_KEY` for **your** Convex project so the existing production build
command can deploy it. Set production backend integration variables separately
in Convex. See the [official Convex/Vercel deployment guide](https://docs.convex.dev/production/hosting/vercel).

Run `npm test`, `npm run typecheck`, and `npm run build` with your own configuration
before deployment. The repository's `vercel.json` runs `npx convex deploy --cmd
'npm run build'` for production builds. Configure development/preview environments
to use your development services and production to use your production services.

Your frontend can use a Vercel-provided URL or a domain you control. It does not
need the original business's domain. Clerk's production domain configuration and
provider webhook/origin settings must match your deployment.
