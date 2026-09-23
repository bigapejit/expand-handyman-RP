import { beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
const modules = import.meta.glob("../convex/**/*.ts");
const field = {
  id: "signature-1",
  page: 0,
  x: 0.12,
  y: 0.7,
  width: 0.35,
  height: 0.08,
};
beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
  vi.stubEnv("OWNER_CLERK_ID", "");
});
function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
  });
  return { t, owner };
}
type Fixture = ReturnType<typeof setup>;
async function customer({ owner }: Fixture, name: string) {
  return owner.mutation(api.documents.addCustomer, {
    name,
    email: "customer@example.com",
    phone: "(555) 123-4567",
    site: "1 Main St",
  });
}
async function document(
  { t, owner }: Fixture,
  customerId: Id<"customers">,
  title: string,
  token?: string,
) {
  const originalId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })),
  );
  const id = await owner.mutation(internal.documents.createVerified, {
    customerId,
    title,
    originalId,
    originalHash: "hash",
    pageCount: 1,
  });
  await owner.mutation(api.documents.saveFields, { id, fields: [field] });
  if (token) await owner.mutation(api.documents.issue, { id, token });
  return id;
}

describe("Dashboard documents", () => {
  test("is the owner's only", async () => {
    const { t } = setup();
    await expect(t.query(api.documents.dashboard, {})).rejects.toThrow();
  });

  test("lists documents out for signature oldest first, with drafts and decided ones left out", async () => {
    const f = setup();
    const ada = await customer(f, "Ada");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-01T17:00:00Z"));
      const older = await document(f, ada, "Older", "a".repeat(64));
      vi.setSystemTime(new Date("2026-09-10T17:00:00Z"));
      const newer = await document(f, ada, "Newer", "b".repeat(64));
      await document(f, ada, "Draft");
      await document(f, ada, "Declined", "c".repeat(64));
      await f.t.mutation(api.documents.decline, {
        token: "c".repeat(64),
        reason: "",
      });
      const board = await f.owner.query(api.documents.dashboard, {});
      expect(board.out.map((d) => d._id)).toEqual([older, newer]);
      expect(board.out[0]).toMatchObject({
        title: "Older",
        customerName: "Ada",
        issuedAt: new Date("2026-09-01T17:00:00Z").getTime(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("counts only the customer's opens of the current link", async () => {
    const f = setup();
    const ada = await customer(f, "Ada");
    const id = await document(f, ada, "Agreement", "a".repeat(64));
    await f.owner.mutation(api.documents.opened, { token: "a".repeat(64) });
    let board = await f.owner.query(api.documents.dashboard, {});
    expect(board.out[0]).toMatchObject({ customerViews: 0 });
    expect(board.out[0].lastViewedAt).toBeUndefined();

    await f.t.mutation(api.documents.opened, { token: "a".repeat(64) });
    await f.owner.mutation(api.documents.withdraw, { id });
    await f.owner.mutation(api.documents.issue, { id, token: "b".repeat(64) });
    board = await f.owner.query(api.documents.dashboard, {});
    expect(board.out[0]).toMatchObject({ customerViews: 0 });

    await f.t.mutation(api.documents.opened, { token: "b".repeat(64) });
    await f.t.mutation(api.documents.opened, { token: "b".repeat(64) });
    board = await f.owner.query(api.documents.dashboard, {});
    const views = await f.t.run((ctx) =>
      ctx.db.query("documentViews").order("desc").first(),
    );
    expect(board.out[0]).toMatchObject({
      customerViews: 2,
      lastViewedAt: views?.openedAt,
    });
  });

  test("counts a first view recorded before the view log as one open", async () => {
    const f = setup();
    const ada = await customer(f, "Ada");
    const id = await document(f, ada, "Agreement", "a".repeat(64));
    await f.t.run((ctx) =>
      ctx.db.patch(id, { status: "viewed", viewedAt: 1_000 }),
    );
    const board = await f.owner.query(api.documents.dashboard, {});
    expect(board.out[0]).toMatchObject({
      customerViews: 1,
      lastViewedAt: 1_000,
    });
  });

  test("lists the last 8 signed or declined documents, most recent first", async () => {
    const f = setup();
    const ada = await customer(f, "Ada");
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const id = await document(f, ada, `Doc ${i}`, String(i).repeat(64));
      await f.t.run((ctx) =>
        ctx.db.patch(
          id,
          i % 2
            ? { status: "declined", declinedAt: 1_000 + i, declineReason: "No" }
            : { status: "signed", signedAt: 1_000 + i, signerName: "Ada L" },
        ),
      );
      ids.push(id);
    }
    const board = await f.owner.query(api.documents.dashboard, {});
    expect(board.out).toEqual([]);
    expect(board.decided.map((d) => d._id)).toEqual(ids.slice(2).reverse());
    expect(board.decided[0]).toMatchObject({
      status: "declined",
      decidedAt: 1_009,
      customerName: "Ada",
      declineReason: "No",
    });
    expect(board.decided[1]).toMatchObject({
      status: "signed",
      decidedAt: 1_008,
      signerName: "Ada L",
    });
  });

  test("dates an answer with no recorded time by when the document was created", async () => {
    const f = setup();
    const ada = await customer(f, "Ada");
    const id = await document(f, ada, "Legacy", "a".repeat(64));
    await f.t.run((ctx) => ctx.db.patch(id, { status: "signed" }));
    const created = (await f.t.run((ctx) => ctx.db.get(id)))!._creationTime;
    const board = await f.owner.query(api.documents.dashboard, {});
    expect(board.decided[0]).toMatchObject({ _id: id, decidedAt: created });
  });

  test("picks recent answers by when they were answered, not when uploaded", async () => {
    const f = setup();
    const ada = await customer(f, "Ada");
    const early = await document(f, ada, "Uploaded first", "f".repeat(64));
    await f.t.run((ctx) =>
      ctx.db.patch(early, { status: "signed", signedAt: 2_000 }),
    );
    for (let i = 0; i < 9; i++) {
      const id = await document(f, ada, `Doc ${i}`, String(i).repeat(64));
      await f.t.run((ctx) =>
        ctx.db.patch(id, { status: "signed", signedAt: 1_000 + i }),
      );
    }
    const board = await f.owner.query(api.documents.dashboard, {});
    expect(board.decided).toHaveLength(8);
    expect(board.decided[0]._id).toBe(early);
  });
});

describe("A customer's documents", () => {
  test("are only theirs, newest first, and only for the owner", async () => {
    const f = setup();
    const ada = await customer(f, "Ada");
    const bob = await customer(f, "Bob");
    const first = await document(f, ada, "First");
    await document(f, bob, "Bob's");
    const second = await document(f, ada, "Second");
    await expect(
      f.t.query(api.documents.forCustomer, { customerId: ada }),
    ).rejects.toThrow();
    const docs = await f.owner.query(api.documents.forCustomer, {
      customerId: ada,
    });
    expect(docs.map((d) => d._id)).toEqual([second, first]);
    expect(docs[0]).toMatchObject({ title: "Second", status: "draft" });
  });
});
