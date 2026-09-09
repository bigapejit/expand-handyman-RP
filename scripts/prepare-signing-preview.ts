import { createClerkClient } from "@clerk/backend";
import { ConvexHttpClient } from "convex/browser";
import { readFile, writeFile } from "node:fs/promises";
import { api } from "../convex/_generated/api";
import type { SignatureField } from "../lib/signing";

async function main() {
  if (
    !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
    !process.env.CONVEX_DEPLOYMENT?.startsWith("dev:")
  )
    throw new Error("Development only.");
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const fixture = JSON.parse(
    await readFile("test-results/document.json", "utf8"),
  );
  const login = JSON.parse(
    await readFile("test-results/browser-login.json", "utf8"),
  );
  const session = await clerk.sessions.createSession({ userId: login.userId });
  try {
    const jwt = await clerk.sessions.getToken(session.id, "convex");
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    client.setAuth(jwt.jwt);
    const fields: SignatureField[] = [
      {
        id: "customer",
        kind: "customerSignature",
        page: 0,
        x: 0.1,
        y: 0.64,
        width: 0.4,
        height: 0.09,
      },
      {
        id: "customer-date",
        kind: "customerDate",
        page: 0,
        x: 0.6,
        y: 0.69,
        width: 0.2,
        height: 0.035,
      },
      {
        id: "owner",
        kind: "ownerSignature",
        page: 1,
        x: 0.1,
        y: 0.64,
        width: 0.4,
        height: 0.09,
      },
      {
        id: "owner-date",
        kind: "ownerDate",
        page: 1,
        x: 0.6,
        y: 0.69,
        width: 0.2,
        height: 0.035,
      },
    ];
    await client.mutation(api.documents.saveFields, { id: fixture.id, fields });
    await client.mutation(api.documents.applyOwnerSignature, {
      id: fixture.id,
      name: "Test Owner",
      consent: true,
    });
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    await client.mutation(api.documents.issue, { id: fixture.id, token });
    await writeFile(
      "test-results/customer-preview.json",
      JSON.stringify({
        id: fixture.id,
        token,
        url: `http://localhost:3210/sign/${token}`,
      }),
    );
    console.log(
      "Development preview prepared with owner signature and four fields.",
    );
  } finally {
    await clerk.sessions.revokeSession(session.id);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
