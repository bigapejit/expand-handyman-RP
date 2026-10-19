// Makes the key pair the ChatGPT connector signs its Convex tokens with
// (lib/mcp-auth.ts), and prints where each half goes:
//
//   node scripts/make-mcp-key.mjs
//
// The private key goes to Vercel as MCP_JWT_PRIVATE_KEY, the only place it is
// ever kept. The public key goes to Convex as MCP_JWKS, a data URI that
// convex/auth.config.ts trusts tokens from. Nothing is written to disk.
//
// Running it again makes a new pair: set both halves again, then redeploy, and
// a connected ChatGPT keeps working because it never sees this key.
//
// The key id is the public key's RFC 7638 thumbprint, which is what
// lib/mcp-auth.ts works out from the private key when it signs, so the two
// halves agree without a third value to copy.

import { calculateJwkThumbprint, exportJWK, exportPKCS8, generateKeyPair } from "jose";

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const pem = await exportPKCS8(privateKey);
const jwk = await exportJWK(publicKey);
const kid = await calculateJwkThumbprint(jwk);
const jwks = { keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] };
const dataUri = `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`;

console.log(`ChatGPT connector key, id ${kid}

1. Vercel: Project expand-handyman-rp, Settings, Environment Variables.
   Name MCP_JWT_PRIVATE_KEY, environments Production and Preview, sensitive.
   Paste the whole block below, both BEGIN and END lines included:

${pem}
2. Convex: set the public key on production (and on dev, for previews):

npx convex env set --prod MCP_JWKS "${dataUri}"
npx convex env set MCP_JWKS "${dataUri}"

3. Redeploy both (merging to main does it), so Convex reads the new MCP_JWKS.

Keep the private key out of Git, chat and email. If it leaks, run this again.`);
