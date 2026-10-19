// How the **ChatGPT connector** (CONTEXT.md) proves who is asking, in two hops.
//
// ChatGPT holds an OAuth access token that Clerk issued to the staff member who
// connected it. Convex trusts only Clerk *session* tokens made from the
// `convex` JWT template, which an OAuth token is not. So the /mcp route checks
// the OAuth token with Clerk, then signs a short-lived token of its own for
// the same person, which convex/auth.config.ts trusts as a second provider.
// The existing queries and mutations then run exactly as they do for the
// browser, and `requireOwner` (convex/auth.ts) keeps deciding who gets in:
// nothing here can let in someone the staff app would refuse.
//
// Pure apart from the signing, so the claims, the metadata and the key
// handling are tested without HTTP, Clerk or Convex.

import { calculateJwkThumbprint, exportJWK, importPKCS8, SignJWT, type JWK } from "jose";

// The issuer and audience convex/auth.config.ts expects. The issuer is a name,
// not an address anything fetches: the public key reaches Convex as a data URI
// (MCP_JWKS), so the same value works on a preview or on localhost.
export const McpTokenIssuer = "https://staff.expandhandyman.com/mcp";
export const McpTokenAudience = "expand-mcp";

// Long enough for one MCP request, which is all a token is minted for; short
// enough that a leaked one is useless within minutes.
export const McpTokenLifetimeSeconds = 5 * 60;

// The person a verified OAuth token belongs to, as Clerk describes them.
export type ConnectorPerson = {
  clerkUserId: string;
  // Their primary email and whether Clerk has verified it. `isOwner` lets in a
  // verified email listed in OWNER_EMAIL or on the Staff page, so the minted
  // token carries the same two facts Clerk's own template does.
  email?: string;
  emailVerified: boolean;
  // Named as the Estimator on a draft's paper, as it is in the browser.
  name?: string;
};

// The claims Convex reads into `ctx.auth.getUserIdentity()`: `sub` becomes
// `subject` (matched against OWNER_CLERK_ID and a staff row's Clerk id), and
// the OIDC `email`, `email_verified` and `name` become the fields of the same
// names that convex/auth.ts and convex/offers.ts read.
export function connectorClaims(person: ConnectorPerson): Record<string, unknown> {
  return {
    ...(person.email ? { email: person.email, email_verified: person.emailVerified } : {}),
    ...(person.name ? { name: person.name } : {}),
  };
}

// The private key as Vercel holds it: a PKCS8 PEM. A PEM pasted into a
// single-line field arrives with literal `\n`s, so those are put back.
export function readPrivateKeyPem(raw: string | undefined): string {
  const pem = (raw ?? "").trim().replace(/\\n/g, "\n");
  if (!pem.includes("BEGIN PRIVATE KEY"))
    throw new Error(
      "The ChatGPT connector is not set up: MCP_JWT_PRIVATE_KEY is missing or is not a PKCS8 PEM. Run scripts/make-mcp-key.mjs.",
    );
  return pem;
}

// The key id: the public key's RFC 7638 thumbprint. scripts/make-mcp-key.mjs
// puts the same one in the JWKS Convex holds, so the two sides agree on it
// without a second value to copy.
async function signingKey(privateKeyPem: string) {
  const key = await importPKCS8(privateKeyPem, "ES256", { extractable: true });
  const jwk = await exportJWK(key);
  const publicJwk: JWK = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  return { key, kid: await calculateJwkThumbprint(publicJwk) };
}

// A token Convex accepts as this person for the next five minutes. Convex
// requires `kid`, `alg` and `typ` in the header and `sub`, `iss` and `exp` in
// the payload, and checks `aud` against the provider's application id.
export async function mintConvexToken(
  person: ConnectorPerson,
  privateKeyPem: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const { key, kid } = await signingKey(privateKeyPem);
  return new SignJWT(connectorClaims(person))
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setSubject(person.clerkUserId)
    .setIssuer(McpTokenIssuer)
    .setAudience(McpTokenAudience)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + McpTokenLifetimeSeconds)
    .sign(key);
}

// Clerk's Frontend API, which is the OAuth authorization server, read out of
// the publishable key the way Clerk's own @clerk/mcp-tools does: the part
// after `pk_live_` is the host, base64-encoded and ending in `$`.
export function clerkAuthServerUrl(publishableKey: string | undefined): string {
  if (!publishableKey) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set.");
  const encoded = publishableKey
    .replace(/^pk_(test|live)_/, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const host = atob(padded).replace(/\$$/, "");
  return `https://${host}`;
}

// The path of the MCP endpoint, and of its RFC 9728 metadata: the resource's
// path appended to the well-known prefix, which is where a client that has
// only the /mcp address looks first.
export const McpPath = "/mcp";
export const ProtectedResourceMetadataPath = `/.well-known/oauth-protected-resource${McpPath}`;

// RFC 9728 Protected Resource Metadata for /mcp: which authorization server
// issues tokens for it and how they travel. Named for /mcp whichever
// well-known path asked, so a client that tries the bare prefix gets the same
// answer.
// The connector's own scope, when MCP_REQUIRED_SCOPE names one, is listed too,
// so ChatGPT asks for it when it signs in.
export function protectedResourceMetadata(
  origin: string,
  authServerUrl: string,
  requiredScope?: string,
) {
  const scope = readRequiredScope(requiredScope);
  return {
    resource: `${origin}${McpPath}`,
    authorization_servers: [authServerUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["profile", "email", ...(scope ? [scope] : [])],
    resource_name: "Expand Handyman staff app",
    resource_documentation: `${origin}/`,
  };
}

// Which OAuth tokens may become a staff member's Convex token.
//
// Clerk issues an OAuth token to any client a signed-in person authorizes, and
// with dynamic client registration or Client ID Metadata Documents turned on,
// any app on the internet can become a client. A token Clerk verifies only
// proves who signed in, not that they meant to hand the staff app to this
// client. So the /mcp route takes a token only from ChatGPT, and, when the
// owner has set one up, only one granted the connector's own scope.
//
// Audience binding relies on the client allowlist: Clerk's verified OAuth
// token, as `auth({ acceptsToken: "oauth_token" })` hands it over, carries the
// client id and scopes but no audience or resource, so this deployment can't
// check that the token was minted for its /mcp.

// The hosts OpenAI serves ChatGPT's Client ID Metadata Documents from. A CIMD
// client's id is the https address of that document.
const ChatGptHosts = ["chatgpt.com", "openai.com"];

// Whether a client id is the address of a metadata document on one of
// OpenAI's hosts or a subdomain of one. Parsed as a URL, so
// `chatgpt.com.evil.com`, `evil-chatgpt.com`, a plain http address or one
// carrying a user name before the host are all refused.
export function isChatGptClientId(clientId: string): boolean {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname;
  return ChatGptHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// MCP_ALLOWED_CLIENT_IDS as a list: comma-separated client ids, matched
// exactly. It is for when ChatGPT registers by dynamic client registration and
// is given a random id that says nothing about who it is.
export function readAllowedClientIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

// MCP_REQUIRED_SCOPE, or nothing when unset or blank.
export function readRequiredScope(raw: string | undefined): string | undefined {
  return raw?.trim() || undefined;
}

// What the route answers a token it won't take: an OAuth error, the sentence
// ChatGPT shows, and any header the error calls for.
export type ConnectorTokenRefusal = {
  status: 403;
  error: "access_denied" | "insufficient_scope";
  description: string;
  headers?: Record<string, string>;
};

// Checks a verified OAuth token's client and scopes against the connector's
// rules, before any Convex token is minted. Nothing comes back for a token
// the connector takes.
export function refuseConnectorToken(
  token: { clientId: string; scopes: string[] },
  env: { allowedClientIds?: string; requiredScope?: string },
): ConnectorTokenRefusal | undefined {
  const allowed =
    isChatGptClientId(token.clientId) ||
    readAllowedClientIds(env.allowedClientIds).includes(token.clientId);
  if (!allowed)
    return {
      status: 403,
      error: "access_denied",
      description: `The staff app only connects to ChatGPT, and this app's OAuth client id is "${token.clientId}". If this is the owner's ChatGPT, add that id to MCP_ALLOWED_CLIENT_IDS on Vercel and connect again.`,
    };
  const scope = readRequiredScope(env.requiredScope);
  if (scope && !token.scopes.includes(scope))
    return {
      status: 403,
      error: "insufficient_scope",
      description: `This connection was not granted the "${scope}" scope. Disconnect and connect again, allowing it.`,
      headers: { "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}"` },
    };
  return undefined;
}

// The metadata routes answer any origin: a browser-based MCP client reads
// them before it holds a token, and they say nothing that is not public.
export const MetadataCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};
