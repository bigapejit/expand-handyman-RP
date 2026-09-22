import { beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { PDFDocument, degrees } from "pdf-lib";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { completePdf, pagePoint } from "../lib/pdf";
import {
  validateFields,
  sha256,
  resizeField,
  signingDate,
  type SignatureField,
} from "../lib/signing";
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
  return { t, owner, id, token, original, customerId };
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
    expect(await t.mutation(api.documents.opened, { token })).not.toBeNull();
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
  test("resizing changes both dimensions without moving or overflowing the field", () => {
    const resized = resizeField(field, 0.5, 0.2);
    expect(resized).toMatchObject({
      x: field.x,
      y: field.y,
      width: 0.5,
      height: 0.2,
    });
    const clamped = resizeField(field, 2, 2);
    expect(clamped.x + clamped.width).toBeCloseTo(1);
    expect(clamped.y + clamped.height).toBeCloseTo(1);
    expect(resizeField(field, -1, -1)).toMatchObject({
      width: 0.1,
      height: 0.025,
    });
  });
  test("dates use the actual signing instant in the business timezone", () => {
    expect(signingDate(Date.UTC(2026, 8, 10, 1))).toBe("09/09/2026");
  });
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

describe("Owner signatures and FRSG decisions", () => {
  test("only the owner can apply their signature, and issuing requires a customer signature", async () => {
    const { t, owner, id } = await fixture();
    await owner.mutation(api.documents.withdraw, { id });
    const ownerField: SignatureField = { ...field, kind: "ownerSignature" };
    await owner.mutation(api.documents.saveFields, {
      id,
      fields: [ownerField],
    });
    await expect(
      owner.mutation(api.documents.issue, { id, token: "b".repeat(64) }),
    ).rejects.toThrow("customer signature");
    await owner.mutation(api.documents.saveFields, {
      id,
      fields: [
        ownerField,
        { ...field, id: "customer", kind: "customerSignature" },
      ],
    });
    await expect(
      owner.mutation(api.documents.issue, { id, token: "b".repeat(64) }),
    ).rejects.toThrow("Apply your signature");
    await expect(
      t.mutation(api.documents.applyOwnerSignature, {
        id,
        name: "Test Owner",
        consent: true,
      }),
    ).rejects.toThrow("Owner access");
    await expect(
      owner.mutation(api.documents.applyOwnerSignature, {
        id,
        name: "Test Owner",
        consent: false,
      }),
    ).rejects.toThrow("Confirm");
    const signature = await owner.mutation(api.documents.applyOwnerSignature, {
      id,
      name: "Test Owner",
      consent: true,
    });
    await owner.mutation(api.documents.issue, { id, token: "b".repeat(64) });
    expect(
      (await t.query(api.documents.forSigner, { token: "b".repeat(64) }))
        ?.ownerSignature,
    ).toEqual(signature);
    await expect(
      owner.mutation(api.documents.applyOwnerSignature, {
        id,
        name: "Changed Owner",
        consent: true,
      }),
    ).rejects.toThrow("Only drafts");
  });
  test("both signers and separately placed dates survive verified PDF completion", async () => {
    const { t, owner, id, original, token } = await fixture();
    await owner.mutation(api.documents.withdraw, { id });
    const fields: SignatureField[] = [
      { ...field, kind: "customerSignature" },
      {
        ...field,
        id: "customer-date",
        x: 0.6,
        width: 0.2,
        height: 0.035,
        kind: "customerDate",
      },
      { ...field, id: "owner-signature", page: 1, kind: "ownerSignature" },
      {
        ...field,
        id: "owner-date",
        page: 1,
        x: 0.6,
        width: 0.2,
        height: 0.035,
        kind: "ownerDate",
      },
    ];
    await owner.mutation(api.documents.saveFields, { id, fields });
    const ownerSignature = await owner.mutation(
      api.documents.applyOwnerSignature,
      { id, name: "Test Owner", consent: true },
    );
    await owner.mutation(api.documents.issue, { id, token });
    const attemptId = "two-signatures-attempt-1234";
    const intent = await t.mutation(api.documents.beginSigning, {
      token,
      name: "Test Customer",
      title: "Homeowner",
      consent: true,
      attemptId,
    });
    const completed = await completePdf(
      original,
      fields,
      { ...intent, documentId: id, originalHash: await sha256(original) },
      ownerSignature,
    );
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array(completed)], { type: "application/pdf" }),
      ),
    );
    const forgedOwner = await completePdf(
      original,
      fields,
      { ...intent, documentId: id, originalHash: await sha256(original) },
      { ...ownerSignature, name: "Someone Else" },
    );
    const forgedId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array(forgedOwner)], { type: "application/pdf" }),
      ),
    );
    await expect(
      t.action(api.pdfActions.finish, {
        token,
        attemptId,
        storageId: forgedId,
        userAgent: "test",
      }),
    ).rejects.toThrow("could not be verified");
    await t.action(api.pdfActions.finish, {
      token,
      attemptId,
      storageId,
      userAgent: "test",
    });
    expect((await owner.query(api.documents.get, { id }))?.signerTitle).toBe(
      "Homeowner",
    );
  });
  test("declining stops an in-flight completion and records the reason for staff", async () => {
    const { t, owner, id, token, original } = await fixture();
    const attemptId = "decline-race-attempt-1234";
    await t.mutation(api.documents.beginSigning, {
      token,
      name: "Test Signer",
      consent: true,
      attemptId,
    });
    await t.mutation(api.documents.decline, {
      token,
      reason: "Please update the scope.",
    });
    await expect(
      t.mutation(api.documents.beginSigning, {
        token,
        name: "Test Signer",
        consent: true,
        attemptId,
      }),
    ).rejects.toThrow("declined");
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array(original)])),
    );
    await expect(
      t.mutation(internal.documents.commitSigned, {
        id,
        token,
        attemptId,
        signedId: storageId,
        signedHash: "fake",
        userAgent: "test",
      }),
    ).rejects.toThrow("withdrawn");
    expect((await owner.query(api.documents.get, { id }))?.declineReason).toBe(
      "Please update the scope.",
    );
    await owner.mutation(api.documents.withdraw, { id });
    expect(await t.query(api.documents.forSigner, { token })).toBeNull();
  });
});

describe("Customer details frozen onto a document", () => {
  const renamed = { name: "Renamed Customer", site: "Renamed Site" };
  test("an issued document keeps the name and site it was issued with", async () => {
    const { t, owner, id, token, customerId } = await fixture();
    await t.run((ctx) => ctx.db.patch(customerId, renamed));
    expect(await t.query(api.documents.forSigner, { token })).toMatchObject({
      customerName: "Test Customer",
      site: "Test Site",
    });
    expect(await owner.query(api.documents.get, { id })).toMatchObject({
      customerName: "Test Customer",
      site: "Test Site",
    });
    expect((await owner.query(api.documents.list, {}))[0]).toMatchObject({
      customerName: "Test Customer",
      site: "Test Site",
    });
  });
  test("a draft reflects the live customer, before issuance and after withdrawal", async () => {
    const { t, owner, id, customerId } = await fixture();
    await owner.mutation(api.documents.withdraw, { id });
    await t.run((ctx) => ctx.db.patch(customerId, renamed));
    expect(await owner.query(api.documents.get, { id })).toMatchObject({
      customerName: "Renamed Customer",
      site: "Renamed Site",
    });
    const token = "b".repeat(64);
    await owner.mutation(api.documents.issue, { id, token });
    await t.run((ctx) =>
      ctx.db.patch(customerId, { name: "Later", site: "Later Site" }),
    );
    expect(await owner.query(api.documents.get, { id })).toMatchObject({
      customerName: "Renamed Customer",
      site: "Renamed Site",
    });
  });
  test("the backfill freezes issued documents that predate the copy, and leaves drafts alone", async () => {
    const { t, owner, id, customerId } = await fixture();
    const strip = () =>
      t.run((ctx) =>
        ctx.db.patch(id, { customerName: undefined, site: undefined }),
      );
    const stored = () =>
      t.run(async (ctx) => {
        const d = await ctx.db.get(id);
        return { customerName: d?.customerName, site: d?.site };
      });
    await strip();
    await t.mutation(internal.migrations.backfillCustomerDetails, {});
    expect(await stored()).toEqual({
      customerName: "Test Customer",
      site: "Test Site",
    });
    await owner.mutation(api.documents.withdraw, { id });
    await t.run((ctx) => ctx.db.patch(customerId, renamed));
    await t.mutation(internal.migrations.backfillCustomerDetails, {});
    expect(await stored()).toEqual({
      customerName: undefined,
      site: undefined,
    });
  });
});
