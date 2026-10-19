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
export function protectedResourceMetadata(origin: string, authServerUrl: string) {
  return {
    resource: `${origin}${McpPath}`,
    authorization_servers: [authServerUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["profile", "email"],
    resource_name: "Expand Handyman staff app",
    resource_documentation: `${origin}/`,
  };
}

// The metadata routes answer any origin: a browser-based MCP client reads
// them before it holds a token, and they say nothing that is not public.
export const MetadataCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};
