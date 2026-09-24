import { afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");

afterEach(() => vi.unstubAllEnvs());

// Who the deployment lets in as the Owner, read through the gate's own query.
function access(env: Record<string, string>, identity?: { subject: string; email: string; emailVerified: boolean }) {
  for (const [key, value] of Object.entries({ OWNER_CLERK_ID: "", OWNER_EMAIL: "", QA_CLERK_ID: "", ...env }))
    vi.stubEnv(key, value);
  const t = convexTest(schema, modules);
  const caller = identity ? t.withIdentity(identity) : t;
  return caller.query(api.auth.access, {}).then((r) => r.owner);
}

const owner = { subject: "user_owner", email: "andrew.p@expandhandyman.com", emailVerified: true };

describe("isOwner", () => {
  test("the pinned Clerk id is the owner whatever their email", async () => {
    expect(await access({ OWNER_CLERK_ID: "user_owner" }, { ...owner, email: "renamed@example.com" })).toBe(true);
  });

  test("a pinned id matches exactly as Clerk cases it", async () => {
    const id = "user_3J6OISrWt6DvDROVHAuXmFrad2l";
    expect(await access({ OWNER_CLERK_ID: id }, { ...owner, subject: id, emailVerified: false })).toBe(true);
    expect(
      await access({ OWNER_CLERK_ID: id }, { ...owner, subject: id.toLowerCase(), emailVerified: false }),
    ).toBe(false);
  });

  test("a verified owner email still counts once an id is pinned", async () => {
    expect(await access({ OWNER_CLERK_ID: "user_someone_else", OWNER_EMAIL: "andrew.p@expandhandyman.com" }, owner)).toBe(true);
  });

  test("lists: several ids and several emails, any case, spaces ignored", async () => {
    expect(await access({ OWNER_CLERK_ID: "user_a, user_owner" }, owner)).toBe(true);
    expect(
      await access({ OWNER_EMAIL: "andrew@cogtex.ai, Andrew.P@ExpandHandyman.com" }, owner),
    ).toBe(true);
  });

  test("the QA account pinned by the browser-test seed gets in beside the owner", async () => {
    const env = { OWNER_CLERK_ID: "user_owner", QA_CLERK_ID: "user_qa" };
    expect(await access(env, { subject: "user_qa", email: "qa+clerk_test@expandhandyman.com", emailVerified: true })).toBe(true);
    expect(await access(env, owner)).toBe(true);
  });

  test("an unverified email, a stranger and no sign-in are refused", async () => {
    const env = { OWNER_CLERK_ID: "user_owner", OWNER_EMAIL: "andrew.p@expandhandyman.com" };
    expect(await access(env, { subject: "user_x", email: "andrew.p@expandhandyman.com", emailVerified: false })).toBe(false);
    expect(await access(env, { subject: "user_x", email: "someone@expandhandyman.com", emailVerified: true })).toBe(false);
    expect(await access(env)).toBe(false);
  });

  test("nothing configured lets nobody in", async () => {
    expect(await access({}, owner)).toBe(false);
  });
});
