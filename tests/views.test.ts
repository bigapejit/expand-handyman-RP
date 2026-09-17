import { beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { PDFDocument, degrees } from "pdf-lib";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { sha256 } from "../lib/signing";
import { completePdf } from "../lib/pdf";
import { duration } from "../lib/utils";
import { MAX_SEEN_STEP } from "../convex/documents";
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
async function fixture() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    subject: "owner",
    email: "andrew@cogtex.ai",
    emailVerified: true,
  });
  const customerId = await owner.mutation(api.documents.addCustomer, {
    name: "Test Customer",
    email: "",
    phone: "",
    site: "Test Site",
  });
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([400, 600]).setRotation(degrees(90));
  const original = await pdf.save();
  const originalId = await t.run((ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array(original)], { type: "application/pdf" }),
    ),
  );
  const id = await owner.mutation(internal.documents.createVerified, {
    customerId,
    title: "Test agreement",
    originalId,
    originalHash: await sha256(original),
    pageCount: 2,
  });
  await owner.mutation(api.documents.saveFields, { id, fields: [field] });
  const token = "a".repeat(64);
  await owner.mutation(api.documents.issue, { id, token });
  return { t, owner, id, token, original };
}

describe("View log", () => {
  test("an owner preview is logged without touching the document", async () => {
    const { t, owner, id, token } = await fixture();
    const viewId = await owner.mutation(api.documents.opened, {
      token,
      userAgent: "Owner Browser",
    });
    expect(viewId).not.toBeNull();
    const rows = await t.run((ctx) => ctx.db.query("documentViews").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      documentId: id,
      token,
      viewer: "owner",
      documentStatus: "ready",
      userAgent: "Owner Browser",
    });
    expect(rows[0].lastSeenAt).toBe(rows[0].openedAt);
    const doc = await owner.query(api.documents.get, { id });
    expect(doc?.status).toBe("ready");
    expect(doc?.viewedAt).toBeUndefined();
  });
  test("customer views accumulate and only the first sets viewedAt", async () => {
    const { t, owner, id, token } = await fixture();
    await t.mutation(api.documents.opened, { token });
    const first = await owner.query(api.documents.get, { id });
    expect(first?.status).toBe("viewed");
    expect(first?.viewedAt).toBeTypeOf("number");
    await t.mutation(api.documents.opened, { token });
    const second = await owner.query(api.documents.get, { id });
    expect(second?.viewedAt).toBe(first?.viewedAt);
    const rows = await t.run((ctx) => ctx.db.query("documentViews").collect());
    expect(rows.map((r) => r.viewer)).toEqual(["customer", "customer"]);
    expect(rows.map((r) => r.documentStatus)).toEqual(["ready", "viewed"]);
    expect(rows.every((r) => r.userAgent === undefined)).toBe(true);
  });
  test("an unknown or withdrawn token logs nothing", async () => {
    const { t, owner, id, token } = await fixture();
    expect(await t.mutation(api.documents.opened, { token: "bad" })).toBeNull();
    await owner.mutation(api.documents.withdraw, { id });
    expect(await t.mutation(api.documents.opened, { token })).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("documentViews").collect()),
    ).toEqual([]);
  });
});

describe("Heartbeat", () => {
  test("seen advances lastSeenAt only for the matching token and never backwards", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
      const { t, token } = await fixture();
      const viewId = await t.mutation(api.documents.opened, { token });
      const opened = await t.run(async (ctx) => ctx.db.get(viewId!));
      vi.setSystemTime(new Date("2026-09-17T10:00:20Z"));
      await t.mutation(api.documents.seen, { viewId: viewId!, token });
      const beat = await t.run(async (ctx) => ctx.db.get(viewId!));
      expect(beat?.lastSeenAt).toBe(Date.now());
      expect(beat?.openedAt).toBe(opened?.openedAt);
      vi.setSystemTime(new Date("2026-09-17T10:01:00Z"));
      await t.mutation(api.documents.seen, {
        viewId: viewId!,
        token: "b".repeat(64),
      });
      expect(
        (await t.run(async (ctx) => ctx.db.get(viewId!)))?.lastSeenAt,
      ).toBe(beat?.lastSeenAt);
      vi.setSystemTime(new Date("2026-09-17T09:59:00Z"));
      await t.mutation(api.documents.seen, { viewId: viewId!, token });
      expect(
        (await t.run(async (ctx) => ctx.db.get(viewId!)))?.lastSeenAt,
      ).toBe(beat?.lastSeenAt);
    } finally {
      vi.useRealTimers();
    }
  });
  test("a heartbeat after a long hidden gap does not count the gap as reading", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
      const { t, token } = await fixture();
      const viewId = await t.mutation(api.documents.opened, { token });
      vi.setSystemTime(new Date("2026-09-17T10:00:20Z"));
      await t.mutation(api.documents.seen, { viewId: viewId!, token });
      vi.setSystemTime(new Date("2026-09-17T14:00:00Z"));
      await t.mutation(api.documents.seen, { viewId: viewId!, token });
      expect(
        (await t.run(async (ctx) => ctx.db.get(viewId!)))?.lastSeenAt,
      ).toBe(Date.parse("2026-09-17T10:00:20Z") + MAX_SEEN_STEP);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("The view feed", () => {
  test("returns every open newest first and tags previous links", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
      const { t, owner, id, token } = await fixture();
      await owner.mutation(api.documents.opened, { token });
      vi.setSystemTime(new Date("2026-09-17T10:01:00Z"));
      await t.mutation(api.documents.opened, { token });
      vi.setSystemTime(new Date("2026-09-17T10:02:00Z"));
      await t.mutation(api.documents.opened, { token });
      const feed = await owner.query(api.documents.views, { id });
      expect(feed).toHaveLength(3);
      expect(feed.map((r) => r.viewer)).toEqual([
        "customer",
        "customer",
        "owner",
      ]);
      expect(feed.map((r) => r.openedAt)).toEqual([
        Date.parse("2026-09-17T10:02:00Z"),
        Date.parse("2026-09-17T10:01:00Z"),
        Date.parse("2026-09-17T10:00:00Z"),
      ]);
      expect(feed.every((r) => r.previousLink === false)).toBe(true);
      await owner.mutation(api.documents.withdraw, { id });
      const withdrawn = await owner.query(api.documents.views, { id });
      expect(withdrawn).toHaveLength(3);
      expect(withdrawn.every((r) => r.previousLink)).toBe(true);
      const next = "b".repeat(64);
      await owner.mutation(api.documents.issue, { id, token: next });
      vi.setSystemTime(new Date("2026-09-17T10:03:00Z"));
      await t.mutation(api.documents.opened, { token: next });
      const reissued = await owner.query(api.documents.views, { id });
      expect(reissued).toHaveLength(4);
      expect(reissued[0].openedAt).toBe(Date.parse("2026-09-17T10:03:00Z"));
      expect(reissued[0].previousLink).toBe(false);
      expect(reissued.slice(1).every((r) => r.previousLink)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  test("views and list reject anonymous callers", async () => {
    const { t, id } = await fixture();
    await expect(t.query(api.documents.views, { id })).rejects.toThrow(
      "Owner access",
    );
    await expect(t.query(api.documents.list, {})).rejects.toThrow(
      "Owner access",
    );
  });
});

describe("The dashboard column", () => {
  test("lastViewedAt follows the latest customer view and ignores owner previews", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
      const { t, owner, id, token } = await fixture();
      expect(
        (await owner.query(api.documents.list, {})).find((d) => d._id === id)
          ?.lastViewedAt,
      ).toBeUndefined();
      vi.setSystemTime(new Date("2026-09-17T10:05:00Z"));
      await owner.mutation(api.documents.opened, { token });
      expect(
        (await owner.query(api.documents.list, {})).find((d) => d._id === id)
          ?.lastViewedAt,
      ).toBeUndefined();
      vi.setSystemTime(new Date("2026-09-17T10:06:00Z"));
      await t.mutation(api.documents.opened, { token });
      vi.setSystemTime(new Date("2026-09-17T10:09:00Z"));
      await t.mutation(api.documents.opened, { token });
      const opens = (await owner.query(api.documents.views, { id }))
        .filter((r) => r.viewer === "customer")
        .map((r) => r.openedAt);
      expect(opens).toEqual([
        Date.parse("2026-09-17T10:09:00Z"),
        Date.parse("2026-09-17T10:06:00Z"),
      ]);
      const listed = (await owner.query(api.documents.list, {})).find(
        (d) => d._id === id,
      );
      expect(listed?.lastViewedAt).toBe(opens[0]);
      expect(listed).not.toHaveProperty("originalId");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Opens after the answer", () => {
  test("a signed document records the status at open time and changes nothing", async () => {
    const { t, owner, id, token, original } = await fixture();
    const attemptId = "view-after-signing-12345";
    const intent = await t.mutation(api.documents.beginSigning, {
      token,
      name: "Test Signer",
      consent: true,
      attemptId,
    });
    const completed = await completePdf(original, [field], {
      name: intent.name,
      signedAt: intent.signedAt,
      documentId: id,
      originalHash: await sha256(original),
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array(completed)], { type: "application/pdf" }),
      ),
    );
    await t.action(api.pdfActions.finish, {
      token,
      attemptId,
      storageId,
      userAgent: "test",
    });
    const before = await owner.query(api.documents.get, { id });
    expect(before?.status).toBe("signed");
    await t.mutation(api.documents.opened, { token });
    const feed = await owner.query(api.documents.views, { id });
    expect(feed[0].documentStatus).toBe("signed");
    const after = await owner.query(api.documents.get, { id });
    expect(after?.status).toBe("signed");
    expect(after?.signedAt).toBe(before?.signedAt);
  });
  test("a declined document records the status at open time", async () => {
    const { t, owner, id, token } = await fixture();
    await t.mutation(api.documents.decline, { token, reason: "Not yet." });
    await t.mutation(api.documents.opened, { token });
    const feed = await owner.query(api.documents.views, { id });
    expect(feed[0].documentStatus).toBe("declined");
    const doc = await owner.query(api.documents.get, { id });
    expect(doc?.status).toBe("declined");
    expect(doc?.viewedAt).toBeUndefined();
  });
});

describe("The close beacon", () => {
  test("posting to /seen advances lastSeenAt and survives junk bodies", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
      const { t, token } = await fixture();
      const viewId = await t.mutation(api.documents.opened, { token });
      const before = await t.run(async (ctx) => ctx.db.get(viewId!));
      vi.setSystemTime(new Date("2026-09-17T10:00:20Z"));
      const res = await t.fetch("/seen", {
        method: "POST",
        body: JSON.stringify({ viewId, token }),
      });
      expect(res.status).toBe(204);
      expect(
        (await t.run(async (ctx) => ctx.db.get(viewId!)))?.lastSeenAt,
      ).toBe(Date.now());
      const seenAt = Date.now();
      vi.setSystemTime(new Date("2026-09-17T10:00:40Z"));
      for (const body of ["not json", JSON.stringify({ token }), ""])
        expect((await t.fetch("/seen", { method: "POST", body })).status).toBe(
          204,
        );
      expect((await t.fetch("/seen", { method: "OPTIONS" })).status).toBe(204);
      expect(
        (await t.run(async (ctx) => ctx.db.get(viewId!)))?.lastSeenAt,
      ).toBe(seenAt);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Reading a view's length", () => {
  test("rounds down to whole minutes and hours", () => {
    expect(duration(0)).toBe("under a minute");
    expect(duration(59_000)).toBe("under a minute");
    expect(duration(3 * 60_000 + 40_000)).toBe("3 min");
    expect(duration(60 * 60_000)).toBe("1 hr");
    expect(duration(72 * 60_000)).toBe("1 hr 12 min");
    expect(duration(-5)).toBe("under a minute");
  });
});
