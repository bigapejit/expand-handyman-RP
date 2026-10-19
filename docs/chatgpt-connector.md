# ChatGPT connector

The owner can estimate by chatting with ChatGPT, with the staff app as its backend. ChatGPT finds customers, sites and proposals, adds a customer and a site, writes Solutions, assembles a draft Proposal and runs Job math. Sending, withdrawing, deleting, payments and invoices stay in the app: no tool does any of them, so nothing ChatGPT does reaches a customer or moves money.

Money goes in and out of every tool in dollars. Inside, it is whole cents like the rest of the app. Every write answers with a link to the thing in the app.

## Tools

Read only:

- `find_customers`: search by name, phone or email; each customer comes with their sites.
- `get_site`: a site's address, customer, solutions (line items, prices, one-line Job math) and proposals.
- `list_proposals`: every proposal, grouped as drafts, sent, approved and declined; or one state.
- `get_proposal`: one proposal by id or Proposal ID (`1215MAIN-P2`): solutions with line items and costs, subtotal, tax, total, deposit, balance, what blocks sending, and links to the proposal and its paper.
- `job_math`: price, hours, other costs and an optional wage, with the owner's saved percentages: buckets, take-home doing it yourself, max W-2 wage, what to charge.

Writes:

- `create_customer`: name and an email or phone. Warns when another customer has the same email or phone.
- `create_site`: looks the typed address up with Google. One clear match is saved and read back for the owner to confirm. Several possible matches save nothing and come back as candidates; ChatGPT asks the owner and calls again with the chosen `place_id`.
- `create_solution` and `update_solution`: title, Scope of Work, line items (name, quantity, unit, unit cost), markup, material allowance. Answer with the app's price and a one-line Job math. `update_solution` replaces the whole list of line items when given one, so ChatGPT marks it as able to overwrite and asks first.
- `create_proposal`: a draft at a site from some of its solutions, with an optional deposit percent, name and notes.
- `add_solutions_to_proposal`: adds solutions to the end of a draft.

## How it works

- `/mcp` (`app/mcp/route.ts`) is a remote MCP server over streamable HTTP, built with `mcp-handler` 2. The tools are in `lib/chatgpt-connector.ts`, the server in `lib/chatgpt-mcp.ts`.
- ChatGPT signs in with OAuth 2.1 (authorization code with PKCE) against Clerk. `/.well-known/oauth-protected-resource/mcp` names Clerk as the authorization server; a request without a valid token gets 401 with `WWW-Authenticate` pointing there.
- The route checks the Clerk OAuth token, looks the person up in Clerk, and signs a five-minute token for them with `MCP_JWT_PRIVATE_KEY` (`lib/mcp-auth.ts`). Convex trusts it as a second provider in `convex/auth.config.ts`, using the public key in `MCP_JWKS`.
- The tools call the app's existing Convex functions with that token, so `requireOwner` guards every read and write exactly as in the browser. Someone not on the Staff list gets 403 before any tool runs.

## Owner checklist

1. **Make the key.** In the repo, run `node scripts/make-mcp-key.mjs`. It prints three things to do:
   - In Vercel (project `expand-handyman-rp`, Settings, Environment Variables), add `MCP_JWT_PRIVATE_KEY` for Production and Preview, marked sensitive, with the whole private key block.
   - Run the two `npx convex env set ... MCP_JWKS ...` lines it prints (production, then dev).
   - Keep the private key out of Git, chat and email.
2. **Clerk dashboard** (production instance, then dev if you want previews to work):
   - Configure, OAuth applications: turn on **Dynamic client registration** and **Client ID Metadata Document** support (ChatGPT prefers CIMD and falls back to registration).
   - Set the **default scopes for dynamic clients** to `profile` and `email`.
   - Leave access tokens as **JWTs** (the default).
3. **Deploy.** Merge the pull request. The Vercel build runs `convex deploy`, which picks up `MCP_JWKS`. If you set `MCP_JWKS` after merging, redeploy.
4. **Connect ChatGPT.** Settings, Apps & Connectors (some plans call it Connectors or Plugins), Advanced settings: turn on developer mode if asked. Then Create (Add custom MCP server):
   - URL: `https://staff.expandhandyman.com/mcp`
   - Authentication: OAuth
   - Sign in with the same Google/Clerk account you use for the staff app.
5. **Try it.** In a new chat, turn the connector on and ask: "Find customer Maria." Then: "Run job math on a $1,200 job, 10 hours, $250 materials."

Plan caveat: some ChatGPT plans only let custom connectors use read-only tools, or only in deep research. If the write tools are missing, that is the plan, not the app.

## If it doesn't work

- **ChatGPT says it can't sign in**: step 2 is not done, or the dynamic client's scopes don't include `profile` and `email`.
- **"could not check this account's access"**: `MCP_JWT_PRIVATE_KEY` is missing on Vercel, or `MCP_JWKS` is missing on Convex, or Convex was not redeployed after it was set. The Vercel function log has the detail.
- **"not on the Expand Handyman Staff list"**: ChatGPT was connected with another account. Disconnect it in ChatGPT and connect again with the staff account.
- **New key**: run the script again, replace both values, redeploy. ChatGPT stays connected; it never sees this key.
