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
  McpTokenAudience,
  McpTokenIssuer,
  mintConvexToken,
  protectedResourceMetadata,
  readPrivateKeyPem,
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
