import { beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { PDFDocument, degrees } from "pdf-lib";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { completePdf, pagePoint } from "../lib/pdf";
import { validateFields, sha256 } from "../lib/signing";
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
describe("Access and document lifecycle", () => {
  test("anonymous and other staff cannot read or create admin data", async () => {
    const { t } = await fixture();
    await expect(t.query(api.documents.list, {})).rejects.toThrow(
      "Owner access",
    );
    await expect(
      t
        .withIdentity({
          subject: "other",
          email: "other@example.com",
          emailVerified: true,
        })
        .mutation(api.documents.uploadUrl, {}),
    ).rejects.toThrow("Owner access");
    await expect(
      t
        .withIdentity({
          subject: "impostor",
          email: "andrew@cogtex.ai",
          emailVerified: false,
        })
        .query(api.documents.customers, {}),
    ).rejects.toThrow("Owner access");
  });
  test("link exposes one document, tracks first view, and withdrawal revokes file access", async () => {
    const { t, owner, id, token } = await fixture();
    expect(await t.query(api.documents.forSigner, { token: "bad" })).toBeNull();
    const first = await t.query(api.documents.forSigner, { token });
    expect(first?.title).toBe("Test agreement");
    expect(first).not.toHaveProperty("originalId");
    await t.mutation(api.documents.opened, { token });
    const viewed = (await owner.query(api.documents.get, { id }))?.viewedAt;
    await t.mutation(api.documents.opened, { token });
    expect((await owner.query(api.documents.get, { id }))?.viewedAt).toBe(
      viewed,
    );
    await expect(
      owner.mutation(api.documents.saveFields, { id, fields: [] }),
    ).rejects.toThrow("Only drafts");
    await owner.mutation(api.documents.withdraw, { id });
    expect(await t.query(api.documents.forSigner, { token })).toBeNull();
    expect(
      await t.query(internal.documents.fileAccess, {
        id,
        token,
        signed: false,
      }),
    ).toBeNull();
  });
  test("retries are idempotent and a completed signature cannot be edited", async () => {
    const { t, owner, id, token, original } = await fixture();
    const attemptId = "attempt-".repeat(5);
    const args = { token, name: "Test Signer", consent: true, attemptId };
    await expect(
      t.mutation(api.documents.beginSigning, { ...args, consent: false }),
    ).rejects.toThrow("consent");
    const intent = await t.mutation(api.documents.beginSigning, args);
    expect((await t.mutation(api.documents.beginSigning, args)).signedAt).toBe(
      intent.signedAt,
    );
    await expect(
      t.mutation(api.documents.beginSigning, {
        ...args,
        attemptId: "different-attempt-123456789",
      }),
    ).rejects.toThrow("already in progress");
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
    await t.action(api.pdfActions.finish, {
      token,
      attemptId,
      storageId,
      userAgent: "test",
    });
    const doc = await owner.query(api.documents.get, { id });
    expect(doc?.status).toBe("signed");
    expect(doc?.signerName).toBe("Test Signer");
    expect(doc?.signedHash).toBe(await sha256(completed));
    await expect(
      owner.mutation(api.documents.withdraw, { id }),
    ).rejects.toThrow("locked");
    await expect(
      owner.mutation(api.documents.saveFields, { id, fields: [] }),
    ).rejects.toThrow("Only drafts");
    expect((await PDFDocument.load(completed)).getPageCount()).toBe(3);
  });
  test("tampered completion is rejected and cannot mark the document signed", async () => {
    const { t, owner, id, token, original } = await fixture();
    const attemptId = "tamper-test-1234567890123";
    await t.mutation(api.documents.beginSigning, {
      token,
      name: "Test Signer",
      consent: true,
      attemptId,
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array(original)], { type: "application/pdf" }),
      ),
    );
    await expect(
      t.action(api.pdfActions.finish, {
        token,
        attemptId,
        storageId,
        userAgent: "test",
      }),
    ).rejects.toThrow("could not be verified");
    expect((await owner.query(api.documents.get, { id }))?.status).not.toBe(
      "signed",
    );
  });
});
describe("PDF geometry", () => {
  test("maps displayed coordinates through all page rotations and crop offsets", () => {
    const crop = { x: 10, y: 20, width: 600, height: 800 };
    expect(pagePoint(30, 40, crop, 0)).toEqual({ x: 40, y: 780 });
    expect(pagePoint(30, 40, crop, 90)).toEqual({ x: 50, y: 50 });
    expect(pagePoint(30, 40, crop, 180)).toEqual({ x: 580, y: 60 });
    expect(pagePoint(30, 40, crop, 270)).toEqual({ x: 570, y: 790 });
  });
  test("rejects fields outside a page and non-finite geometry", () => {
    expect(() => validateFields([{ ...field, page: 2 }], 2)).toThrow();
    expect(() => validateFields([{ ...field, x: 0.99 }], 2)).toThrow();
    expect(() => validateFields([{ ...field, y: NaN }], 2)).toThrow();
    expect(() => validateFields([field, { ...field }], 2)).toThrow();
  });
});
