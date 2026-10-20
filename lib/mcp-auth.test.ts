import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
} from "jose";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  clerkAuthServerUrl,
  connectorClaims,
  isChatGptClientId,
  McpTokenAudience,
  McpTokenIssuer,
  mintConvexToken,
  protectedResourceMetadata,
  readAllowedClientIds,
  readPrivateKeyPem,
  refuseConnectorToken,
} from "./mcp-auth";

// A pair made the way scripts/make-mcp-key.mjs makes one, with the JWKS
// Convex would hold.
async function keyPair() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(jwk);
  return {
    pem: await exportPKCS8(privateKey),
    jwks: { keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] },
    kid,
  };
}

const owner = {
  clerkUserId: "user_3J6OISrWt6DvDROVHAuXmFrad2l",
  email: "andrew.p@expandhandyman.com",
  emailVerified: true,
  name: "Andrew Putilin",
};

describe("mintConvexToken", () => {
  test("signs a token Convex's custom JWT provider accepts as the same person", async () => {
    const { pem, jwks, kid } = await keyPair();
    const now = Math.floor(Date.now() / 1000);
    const token = await mintConvexToken(owner, pem, now);

    // Convex requires kid, alg and typ in the header.
    expect(decodeProtectedHeader(token)).toEqual({ alg: "ES256", kid, typ: "JWT" });
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: McpTokenIssuer,
      audience: McpTokenAudience,
      algorithms: ["ES256"],
    });
    expect(payload).toEqual({
      sub: owner.clerkUserId,
      iss: "https://staff.expandhandyman.com/mcp",
      aud: "expand-mcp",
      iat: now,
      exp: now + 300,
      email: "andrew.p@expandhandyman.com",
      email_verified: true,
      name: "Andrew Putilin",
    });
  });

  test("is refused by a key it was not signed with", async () => {
    const signer = await keyPair();
    const other = await keyPair();
    const token = await mintConvexToken(owner, signer.pem);
    await expect(jwtVerify(token, createLocalJWKSet(other.jwks))).rejects.toThrow();
  });

  test("goes stale after five minutes", async () => {
    const { pem, jwks } = await keyPair();
    const then = Math.floor(Date.now() / 1000) - 301;
    const token = await mintConvexToken(owner, pem, then);
    await expect(jwtVerify(token, createLocalJWKSet(jwks))).rejects.toThrow(/exp/);
  });
});

describe("connectorClaims", () => {
  test("carries an unverified email as unverified, so the gate does not count it", () => {
    expect(connectorClaims({ ...owner, emailVerified: false })).toEqual({
      email: "andrew.p@expandhandyman.com",
      email_verified: false,
      name: "Andrew Putilin",
    });
  });

  test("names nothing it does not know", () => {
    expect(connectorClaims({ clerkUserId: "user_1", emailVerified: false })).toEqual({});
  });
});

describe("readPrivateKeyPem", () => {
  test("puts back newlines a single-line field turned into \\n", async () => {
    const { pem } = await keyPair();
    expect(readPrivateKeyPem(pem.replace(/\n/g, "\\n"))).toBe(pem.trim());
  });

  test("says how to set it up when it is missing or not a PKCS8 PEM", () => {
    for (const raw of [undefined, "", "-----BEGIN EC PRIVATE KEY-----"])
      expect(() => readPrivateKeyPem(raw)).toThrow(/MCP_JWT_PRIVATE_KEY.*make-mcp-key/);
  });
});

describe("clerkAuthServerUrl", () => {
  test("reads Clerk's Frontend API out of the publishable key", () => {
    const key = (host: string, kind: string) =>
      `pk_${kind}_${Buffer.from(`${host}$`).toString("base64")}`;
    expect(clerkAuthServerUrl(key("optimal-termite-7763.clerk.accounts.dev", "test"))).toBe(
      "https://optimal-termite-7763.clerk.accounts.dev",
    );
    expect(clerkAuthServerUrl(key("clerk.expandhandyman.com", "live"))).toBe(
      "https://clerk.expandhandyman.com",
    );
  });

  test("refuses a missing key", () => {
    expect(() => clerkAuthServerUrl(undefined)).toThrow("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });
});

describe("protectedResourceMetadata", () => {
  test("names /mcp as the resource and Clerk as its authorization server", () => {
    expect(
      protectedResourceMetadata("https://staff.expandhandyman.com", "https://clerk.expandhandyman.com"),
    ).toMatchObject({
      resource: "https://staff.expandhandyman.com/mcp",
      authorization_servers: ["https://clerk.expandhandyman.com"],
      bearer_methods_supported: ["header"],
    });
  });

  test("lists the connector's own scope only when one is required", () => {
    const origin = "https://staff.expandhandyman.com";
    const clerk = "https://clerk.expandhandyman.com";
    expect(protectedResourceMetadata(origin, clerk).scopes_supported).toEqual(["profile", "email"]);
    expect(protectedResourceMetadata(origin, clerk, " ").scopes_supported).toEqual([
      "profile",
      "email",
    ]);
    expect(protectedResourceMetadata(origin, clerk, "staff_app").scopes_supported).toEqual([
      "profile",
      "email",
      "staff_app",
    ]);
  });
});

describe("isChatGptClientId", () => {
  test("takes a metadata document on OpenAI's hosts or their subdomains", () => {
    for (const id of [
      "https://chatgpt.com/oauth/client.json",
      "https://openai.com/chatgpt/client-metadata.json",
      "https://auth.openai.com/oauth/cimd",
      "https://connectors.chatgpt.com/client",
      "https://CHATGPT.COM/client",
    ])
      expect(isChatGptClientId(id), id).toBe(true);
  });

  test("refuses lookalikes, plain http, user names before the host and random ids", () => {
    for (const id of [
      "https://chatgpt.com.evil.com/client",
      "https://evilchatgpt.com/client",
      "https://openai.com.example/client",
      "https://notopenai.com/client",
      "http://chatgpt.com/client",
      "https://chatgpt.com@evil.com/client",
      "https://chatgpt.com:x@evil.com/client",
      "https://user@chatgpt.com/client",
      "chatgpt.com",
      "oauth_2a8f9c7e1b",
      "",
    ])
      expect(isChatGptClientId(id), id).toBe(false);
  });
});

describe("readAllowedClientIds", () => {
  test("reads a comma-separated list, trimmed, with blanks dropped", () => {
    expect(readAllowedClientIds(" abc, def ,,")).toEqual(["abc", "def"]);
    expect(readAllowedClientIds(undefined)).toEqual([]);
  });
});

describe("refuseConnectorToken", () => {
  const chatgpt = "https://chatgpt.com/oauth/client.json";

  test("takes ChatGPT's metadata document client with no setup", () => {
    expect(refuseConnectorToken({ clientId: chatgpt, scopes: ["profile"] }, {})).toBeUndefined();
  });

  test("takes a registered client only when MCP_ALLOWED_CLIENT_IDS lists it exactly", () => {
    const token = { clientId: "oauth_abc123", scopes: ["profile"] };
    expect(refuseConnectorToken(token, { allowedClientIds: "oauth_xyz, oauth_abc123" })).toBeUndefined();
    expect(refuseConnectorToken(token, { allowedClientIds: "oauth_abc12" })).toMatchObject({
      status: 403,
      error: "access_denied",
    });
  });

  test("refuses any other client by its id and says where to allow it", () => {
    const refusal = refuseConnectorToken(
      { clientId: "https://chatgpt.com.evil.com/c", scopes: ["profile", "email"] },
      { allowedClientIds: "" },
    );
    expect(refusal).toMatchObject({ status: 403, error: "access_denied" });
    expect(refusal?.description).toContain('"https://chatgpt.com.evil.com/c"');
    expect(refusal?.description).toContain("MCP_ALLOWED_CLIENT_IDS");
  });

  test("asks for the required scope only once MCP_REQUIRED_SCOPE is set", () => {
    const token = { clientId: chatgpt, scopes: ["profile", "email"] };
    expect(refuseConnectorToken(token, { requiredScope: "" })).toBeUndefined();
    expect(refuseConnectorToken(token, { requiredScope: "staff_app" })).toEqual({
      status: 403,
      error: "insufficient_scope",
      description: expect.stringContaining('"staff_app"'),
      headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="staff_app"' },
    });
    expect(
      refuseConnectorToken({ ...token, scopes: ["profile", "staff_app"] }, { requiredScope: "staff_app" }),
    ).toBeUndefined();
  });

  test("checks the client before the scope", () => {
    expect(
      refuseConnectorToken({ clientId: "someone-else", scopes: [] }, { requiredScope: "staff_app" }),
    ).toMatchObject({ error: "access_denied" });
  });
});

describe("convex/auth.config.ts", () => {
  // The config reads its env when the module loads, so each case loads it
  // afresh.
  async function providers(env: Record<string, string>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return (await import("../convex/auth.config")).default.providers;
  }
  afterEach(() => vi.unstubAllEnvs());

  test("trusts the issuer and audience tokens are minted with, once MCP_JWKS is set", async () => {
    expect(
      await providers({ CLERK_JWT_ISSUER_DOMAIN: "https://clerk.example.com", MCP_JWKS: "data:x" }),
    ).toEqual([
      { domain: "https://clerk.example.com", applicationID: "convex" },
      {
        type: "customJwt",
        issuer: McpTokenIssuer,
        applicationID: McpTokenAudience,
        jwks: "data:x",
        algorithm: "ES256",
      },
    ]);
  });

  test("trusts no connector token on a deployment without the key", async () => {
    expect(
      await providers({ CLERK_JWT_ISSUER_DOMAIN: "https://clerk.example.com", MCP_JWKS: "" }),
    ).toEqual([{ domain: "https://clerk.example.com", applicationID: "convex" }]);
  });
});
