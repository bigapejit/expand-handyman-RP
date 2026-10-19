import type { AuthConfig } from "convex/server";

// Who Convex takes a signed-in identity from. Either way, `requireOwner`
// (convex/auth.ts) still decides whether that identity is let in.
//
// Clerk's `convex` JWT template, for the staff app in the browser.
const clerk = process.env.CLERK_JWT_ISSUER_DOMAIN
  ? [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }]
  : [];

// The **ChatGPT connector**'s own short-lived tokens, signed by the /mcp route
// for the staff member whose Clerk OAuth token it has just checked
// (lib/mcp-auth.ts, whose McpTokenIssuer and McpTokenAudience these must
// match). MCP_JWKS is the public key as a data URI, printed by
// scripts/make-mcp-key.mjs; a deployment without it trusts no such token.
// Convex reads this file when it deploys, so a new key takes a deploy.
const chatgpt = process.env.MCP_JWKS
  ? [
      {
        type: "customJwt" as const,
        issuer: "https://staff.expandhandyman.com/mcp",
        applicationID: "expand-mcp",
        jwks: process.env.MCP_JWKS,
        algorithm: "ES256" as const,
      },
    ]
  : [];

export default { providers: [...clerk, ...chatgpt] } satisfies AuthConfig;
