import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");

// The Owner is pinned by id and by email; everyone else gets in only through
// a `staff` row.
beforeEach(() => {
  vi.stubEnv("OWNER_CLERK_ID", "user_owner");
  vi.stubEnv("OWNER_EMAIL", "andrew.p@expandhandyman.com");
  vi.stubEnv("QA_CLERK_ID", "");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_staff");
  vi.stubEnv("APP_ORIGIN", "https://staff.expandhandyman.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const owner = {
  subject: "user_owner",
  email: "andrew.p@expandhandyman.com",
  emailVerified: true,
  name: "Andrew Putilin",
};
const matt = { subject: "user_matt", email: "Matt@ExpandHandyman.com", emailVerified: true, name: "Matt Rivera" };

function staffRow(fields: { email: string; clerkUserId?: string; clerkInvitationId?: string }) {
  return { invitedAt: 1, invitedBy: "andrew.p@expandhandyman.com", ...fields };
}

// Clerk's Backend API, stubbed at fetch. Every call is kept; each path answers
// with the shape Clerk sends, or with `faults` when a test sets one.
type ClerkCall = { method: string; path: string; body: Record<string, unknown> | null; auth: string | null };
function stubClerk(faults: Record<string, Response> = {}) {
  const calls: ClerkCall[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/v1/, "");
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: new Headers(init?.headers).get("authorization"),
    });
    const fault = faults[`${method} ${path}`];
    if (fault) return fault;
    if (path === "/allowlist_identifiers") return Response.json({ id: "alid_1", identifier: "x" });
    if (path === "/invitations") return Response.json({ id: `inv_${calls.length}`, status: "pending" });
    return Response.json({ deleted: true });
  });
  return calls;
}

describe("the gate", () => {
  test("a verified email with a staff row gets in; unverified does not", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com" })));
    expect((await t.withIdentity(matt).query(api.auth.access, {})).owner).toBe(true);
    expect(
      (await t.withIdentity({ ...matt, emailVerified: false }).query(api.auth.access, {})).owner,
    ).toBe(false);
  });

  test("a row's Clerk id gets in whatever the email", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com", clerkUserId: "user_matt" })),
    );
    const renamed = t.withIdentity({ ...matt, email: "matt@elsewhere.com" });
    expect((await renamed.query(api.auth.access, {})).owner).toBe(true);
  });

  test("once the row is deleted the gate refuses, in queries and actions", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com", clerkUserId: "user_matt" })),
    );
    const asMatt = t.withIdentity(matt);
    stubClerk();
    await expect(asMatt.action(api.staff.invite, { email: "not an email" })).rejects.toThrow(
      /Enter an email address/,
    );
    await t.run((ctx) => ctx.db.delete(id));
    expect((await asMatt.query(api.auth.access, {})).owner).toBe(false);
    await expect(asMatt.query(api.staff.list, {})).rejects.toThrow(/Owner access required/);
    await expect(asMatt.action(api.staff.invite, { email: "x@example.com" })).rejects.toThrow(
      /Owner access required/,
    );
  });
});

describe("seen", () => {
  test("makes the caller's row, then keeps it up to date", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const t = convexTest(schema, modules);
      const asOwner = t.withIdentity(owner);
      await asOwner.mutation(api.staff.seen, {});
      let rows = await t.run((ctx) => ctx.db.query("staff").collect());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        email: "andrew.p@expandhandyman.com",
        invitedBy: "",
        clerkUserId: "user_owner",
        name: "Andrew Putilin",
        firstSeenAt: 1000,
        lastSeenAt: 1000,
      });
      vi.setSystemTime(5000);
      await asOwner.mutation(api.staff.seen, {});
      rows = await t.run((ctx) => ctx.db.query("staff").collect());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ firstSeenAt: 1000, lastSeenAt: 5000 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("an invitee's first sign-in claims their invited row", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com", clerkInvitationId: "inv_1" })),
    );
    await t.withIdentity(matt).mutation(api.staff.seen, {});
    const rows = await t.run((ctx) => ctx.db.query("staff").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clerkUserId: "user_matt", name: "Matt Rivera" });
  });

  test("an account that takes up an invite to its new email keeps one row", async () => {
    const t = convexTest(schema, modules);
    const [old, invited] = await t.run(async (ctx) => [
      await ctx.db.insert("staff", staffRow({ email: "matt@old.com", clerkUserId: "user_matt" })),
      await ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com", clerkInvitationId: "inv_1" })),
    ]);
    await t.withIdentity(matt).mutation(api.staff.seen, {});
    expect(await t.run((ctx) => ctx.db.get(old))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(invited))).toMatchObject({ clerkUserId: "user_matt" });
  });
});

describe("list", () => {
  test("marks the Owner's row as root and the caller's as you", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("staff", {
        ...staffRow({ email: "andrew.p@expandhandyman.com", clerkUserId: "user_owner" }),
        name: "Andrew Putilin",
      });
      await ctx.db.insert("staff", {
        ...staffRow({ email: "matt@expandhandyman.com", clerkUserId: "user_matt" }),
        name: "Matt Rivera",
      });
      await ctx.db.insert("staff", staffRow({ email: "dad@example.com" }));
    });
    const list = await t.withIdentity(matt).query(api.staff.list, {});
    expect(list.map((m) => [m.email, m.status, m.root, m.you])).toEqual([
      ["andrew.p@expandhandyman.com", "active", true, false],
      ["matt@expandhandyman.com", "active", false, true],
      ["dad@example.com", "invited", false, false],
    ]);
  });
});

describe("invite", () => {
  test("refuses a bad email and one already on the list", async () => {
    const t = convexTest(schema, modules);
    const calls = stubClerk();
    await t.run((ctx) => ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com" })));
    const asOwner = t.withIdentity(owner);
    await expect(asOwner.action(api.staff.invite, { email: "matt" })).rejects.toThrow(
      /Enter an email address/,
    );
    await expect(
      asOwner.action(api.staff.invite, { email: " Matt@ExpandHandyman.com " }),
    ).rejects.toThrow(/already on the list/);
    await expect(
      asOwner.action(api.staff.invite, { email: "andrew.p@expandhandyman.com" }),
    ).rejects.toThrow(/already on the list/);
    expect(calls).toEqual([]);
  });

  test("allowlists the email, has Clerk send the invite, and records the row", async () => {
    const t = convexTest(schema, modules);
    const calls = stubClerk();
    await t.withIdentity(owner).action(api.staff.invite, { email: "Dad@Example.com" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /allowlist_identifiers",
      "POST /invitations",
    ]);
    expect(calls.every((c) => c.auth === "Bearer sk_test_staff")).toBe(true);
    expect(calls[0].body).toEqual({ identifier: "dad@example.com", notify: false });
    expect(calls[1].body).toEqual({
      email_address: "dad@example.com",
      redirect_url: "https://staff.expandhandyman.com/sign-up",
      notify: true,
      ignore_existing: true,
    });
    const rows = await t.run((ctx) => ctx.db.query("staff").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "dad@example.com",
      invitedBy: "andrew.p@expandhandyman.com",
      clerkAllowlistId: "alid_1",
      clerkInvitationId: "inv_2",
    });
    expect(rows[0].clerkUserId).toBeUndefined();
  });

  test("an email already on Clerk's allowlist is invited without an entry to delete later", async () => {
    const t = convexTest(schema, modules);
    stubClerk({
      "POST /allowlist_identifiers": Response.json(
        { errors: [{ code: "duplicate_record", message: "duplicate allowlist identifier" }] },
        { status: 400 },
      ),
    });
    await t.withIdentity(owner).action(api.staff.invite, { email: "matt@expandhandyman.com" });
    const rows = await t.run((ctx) => ctx.db.query("staff").collect());
    expect(rows[0].clerkAllowlistId).toBeUndefined();
    expect(rows[0].clerkInvitationId).toBe("inv_2");
  });

  test("Clerk's own words come back when it refuses; nothing is recorded", async () => {
    const t = convexTest(schema, modules);
    stubClerk({
      "POST /invitations": Response.json(
        { errors: [{ code: "form_param_format_invalid", message: "is invalid", long_message: "Email address is invalid." }] },
        { status: 422 },
      ),
    });
    await expect(
      t.withIdentity(owner).action(api.staff.invite, { email: "dad@example.com" }),
    ).rejects.toThrow(/Email address is invalid/);
    expect(await t.run((ctx) => ctx.db.query("staff").collect())).toEqual([]);
  });

  test("without a Clerk key it says invitations aren't set up", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    const t = convexTest(schema, modules);
    stubClerk();
    await expect(
      t.withIdentity(owner).action(api.staff.invite, { email: "dad@example.com" }),
    ).rejects.toThrow(/aren't set up/);
  });
});

describe("resend", () => {
  test("revokes the old invitation and keeps the new one", async () => {
    const t = convexTest(schema, modules);
    const calls = stubClerk();
    const id = await t.run((ctx) =>
      ctx.db.insert("staff", staffRow({ email: "dad@example.com", clerkInvitationId: "inv_old" })),
    );
    await t.withIdentity(owner).action(api.staff.resend, { staffId: id });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /invitations/inv_old/revoke",
      "POST /invitations",
    ]);
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.clerkInvitationId).toBe("inv_2");
  });
});

describe("remove", () => {
  test("refuses the Owner's own rows", async () => {
    const t = convexTest(schema, modules);
    const calls = stubClerk();
    const id = await t.run((ctx) =>
      ctx.db.insert("staff", staffRow({ email: "andrew.p@expandhandyman.com", clerkUserId: "user_owner" })),
    );
    await t.run((ctx) => ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com" })));
    await expect(t.withIdentity(matt).action(api.staff.remove, { staffId: id })).rejects.toThrow(
      /can't be removed/,
    );
    expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
    expect(calls).toEqual([]);
  });

  test("deletes a signed-in member's Clerk account and row, and they are locked out", async () => {
    const t = convexTest(schema, modules);
    const calls = stubClerk({ "DELETE /users/user_matt": Response.json({}, { status: 500 }) });
    const id = await t.run((ctx) =>
      ctx.db.insert("staff", {
        ...staffRow({ email: "matt@expandhandyman.com", clerkUserId: "user_matt" }),
        clerkAllowlistId: "alid_matt",
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    await t.withIdentity(owner).action(api.staff.remove, { staffId: id });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "DELETE /allowlist_identifiers/alid_matt",
      "DELETE /users/user_matt",
    ]);
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
    expect((await t.withIdentity(matt).query(api.auth.access, {})).owner).toBe(false);
    vi.restoreAllMocks();
  });

  test("refuses the caller's own row", async () => {
    const t = convexTest(schema, modules);
    const calls = stubClerk();
    const id = await t.run((ctx) =>
      ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com", clerkUserId: "user_matt" })),
    );
    await expect(t.withIdentity(matt).action(api.staff.remove, { staffId: id })).rejects.toThrow(
      /your own access/,
    );
    expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
    expect(calls).toEqual([]);
  });

  test("keeps a Clerk account another row still names", async () => {
    const t = convexTest(schema, modules);
    const calls = stubClerk();
    const [stale, kept] = await t.run(async (ctx) => [
      await ctx.db.insert("staff", staffRow({ email: "matt@old.com", clerkUserId: "user_matt" })),
      await ctx.db.insert("staff", staffRow({ email: "matt@expandhandyman.com", clerkUserId: "user_matt" })),
    ]);
    await t.withIdentity(owner).action(api.staff.remove, { staffId: stale });
    expect(calls).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(stale))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(kept))).not.toBeNull();
  });

  test("cancelling an invite revokes it", async () => {
    const t = convexTest(schema, modules);
    const calls = stubClerk();
    const id = await t.run((ctx) =>
      ctx.db.insert("staff", staffRow({ email: "dad@example.com", clerkInvitationId: "inv_1" })),
    );
    await t.withIdentity(owner).action(api.staff.remove, { staffId: id });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /invitations/inv_1/revoke"]);
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
});
