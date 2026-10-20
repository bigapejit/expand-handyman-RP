// The **ChatGPT connector** (CONTEXT.md): a remote MCP server ChatGPT talks to
// over streamable HTTP, at https://staff.expandhandyman.com/mcp.
//
// The server itself, and why it is mcp-handler 2, is lib/chatgpt-mcp.ts.
//
// Every request goes through three gates, in order:
// 1. withMcpAuth: a Clerk OAuth access token is required. Without a valid one
//    the answer is 401 with a WWW-Authenticate header pointing at the
//    protected resource metadata, which is how ChatGPT learns to sign in.
// 2. staffOnly: the token must come from ChatGPT, and carry the connector's
//    scope when MCP_REQUIRED_SCOPE names one (lib/mcp-auth.ts says why);
//    any other gets 403 before anything is minted. Then the token's owner is
//    looked up in Clerk, a five-minute Convex token is signed for them, and
//    Convex is asked through `auth.access` whether they are a **Staff
//    member**. Anyone else gets 403 with a sentence saying so, before any
//    tool runs.
// 3. Each tool calls the app's own public Convex functions with that token,
//    so `requireOwner` guards every read and write as it does in the browser.

import { auth, clerkClient } from "@clerk/nextjs/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { ConvexHttpClient } from "convex/browser";
import { getPublicOrigin, withMcpAuth } from "mcp-handler";

import { api } from "@/convex/_generated/api";
import type { ToolContext } from "@/lib/chatgpt-connector";
import { connectorMcpHandler } from "@/lib/chatgpt-mcp";
import {
  mintConvexToken,
  ProtectedResourceMetadataPath,
  readPrivateKeyPem,
  refuseConnectorToken,
  type ConnectorPerson,
} from "@/lib/mcp-auth";
import { errorMessage } from "@/lib/utils";

// What the gates hand the tools, on the request's AuthInfo.
type ConnectorExtra = { userId: string; convexToken?: string; origin?: string };

function convexAs(token: string): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set.");
  const client = new ConvexHttpClient(url);
  client.setAuth(token);
  return client;
}

// A tool's view of the request: Convex as the staff member, and the origin
// its links start with. The staff gate has always set both by now.
function toolContext(authInfo: AuthInfo | undefined): ToolContext {
  const extra = authInfo?.extra as ConnectorExtra | undefined;
  if (!extra?.convexToken || !extra.origin) throw new Error("Not signed in.");
  return { convex: convexAs(extra.convexToken), origin: extra.origin };
}

const mcp = connectorMcpHandler(toolContext);

// Gate 1's check. `auth({ acceptsToken: "oauth_token" })` has Clerk verify
// the bearer as an OAuth access token it issued; a session token, an API key
// or anything else reads as signed out, and withMcpAuth answers 401. Clerk
// hands back the token's client id and scopes, which staffOnly checks, but no
// audience to check (lib/mcp-auth.ts).
async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const signedIn = await auth({ acceptsToken: "oauth_token" });
  if (!signedIn.isAuthenticated || !signedIn.userId) return undefined;
  const extra: ConnectorExtra = { userId: signedIn.userId };
  return {
    token: bearerToken,
    clientId: signedIn.clientId ?? "",
    scopes: signedIn.scopes ?? [],
    extra,
  };
}

// Who the token belongs to, as the staff app's gate would see them signed in
// to the browser: their Clerk id, primary email and whether it is verified.
async function personFor(userId: string): Promise<ConnectorPerson> {
  const user = await (await clerkClient()).users.getUser(userId);
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  return {
    clerkUserId: user.id,
    email: primary?.emailAddress,
    emailVerified: primary?.verification?.status === "verified",
    name: user.fullName ?? undefined,
  };
}

function refused(
  status: number,
  error: string,
  description: string,
  headers?: Record<string, string>,
): Response {
  return Response.json({ error, error_description: description }, { status, headers });
}

// Gate 2.
async function staffOnly(req: Request): Promise<Response> {
  const extra = req.auth?.extra as ConnectorExtra | undefined;
  if (!req.auth || !extra?.userId) return refused(401, "invalid_token", "Sign in again.");

  const refusal = refuseConnectorToken(
    { clientId: req.auth.clientId, scopes: req.auth.scopes },
    {
      allowedClientIds: process.env.MCP_ALLOWED_CLIENT_IDS,
      requiredScope: process.env.MCP_REQUIRED_SCOPE,
    },
  );
  if (refusal) {
    // Logged so the owner can find a ChatGPT client id to allow, or see who
    // else tried.
    console.warn(`ChatGPT connector refused OAuth client ${req.auth.clientId}: ${refusal.error}`);
    return refused(refusal.status, refusal.error, refusal.description, refusal.headers);
  }

  let convexToken: string;
  let isStaff: boolean;
  try {
    const person = await personFor(extra.userId);
    convexToken = await mintConvexToken(person, readPrivateKeyPem(process.env.MCP_JWT_PRIVATE_KEY));
    isStaff = (await convexAs(convexToken).query(api.auth.access)).owner;
  } catch (error) {
    // A missing key, a Convex deployment that doesn't trust the connector's
    // tokens yet (MCP_JWKS), or Clerk or Convex being unreachable. Logged for
    // the owner; ChatGPT gets the sentence.
    console.error("ChatGPT connector could not check access:", error);
    return refused(
      503,
      "temporarily_unavailable",
      `The staff app could not check this account's access: ${errorMessage(error)}`,
    );
  }
  if (!isStaff)
    return refused(
      403,
      "access_denied",
      "This account is not on the Expand Handyman Staff list. Connect ChatGPT with the account you sign in to the staff app with.",
    );

  req.auth = { ...req.auth, extra: { ...extra, convexToken, origin: getPublicOrigin(req) } };
  return mcp(req);
}

const handler = withMcpAuth(staffOnly, verifyToken, {
  required: true,
  resourceMetadataPath: ProtectedResourceMetadataPath,
});

export { handler as GET, handler as POST, handler as DELETE };
