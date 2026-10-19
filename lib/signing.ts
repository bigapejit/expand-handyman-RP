export const CONSENT =
  "I have reviewed this document and agree to sign it electronically. I understand that my typed name is my signature.";
export const CONSENT_VERSION = "2026-09-09";
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const FIELD_LABELS = {
  customerSignature: "Customer signature",
  customerDate: "Customer signing date",
  ownerSignature: "My signature",
  ownerDate: "My signing date",
} as const;
export type FieldKind = keyof typeof FIELD_LABELS;
export type OwnerSignature = { name: string; signedAt: number };
export type SignatureField = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  // Absent on documents created before separate signature/date placement.
  kind?: FieldKind;
};
export type SignatureRecord = {
  name: string;
  signedAt: number;
  documentId: string;
  originalHash: string;
  title?: string;
};
export const fieldKind = (field: SignatureField): FieldKind =>
  field.kind ?? "customerSignature";
export const isOwnerField = (field: SignatureField) =>
  fieldKind(field).startsWith("owner");
export const isDateField = (field: SignatureField) =>
  fieldKind(field).endsWith("Date");
export function signingDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(timestamp);
}
export function resizeField(
  field: SignatureField,
  width: number,
  height: number,
): SignatureField {
  return {
    ...field,
    width: Math.max(0.1, Math.min(1 - field.x, width)),
    height: Math.max(0.025, Math.min(1 - field.y, height)),
  };
}
export function validateFields(fields: SignatureField[], pages: number) {
  if (!fields.length || fields.length > 30)
    throw new Error("Place between 1 and 30 signature fields.");
  if (new Set(fields.map((f) => f.id)).size !== fields.length)
    throw new Error("Signature field IDs must be unique.");
  for (const f of fields) {
    if (f.kind !== undefined && !(f.kind in FIELD_LABELS))
      throw new Error("Unknown document field.");
    if (
      ![f.page, f.x, f.y, f.width, f.height].every(Number.isFinite) ||
      !Number.isInteger(f.page) ||
      f.page < 0 ||
      f.page >= pages ||
      f.x < 0 ||
      f.y < 0 ||
      f.width < 0.1 ||
      f.height < 0.025 ||
      f.x + f.width > 1.000001 ||
      f.y + f.height > 1.000001
    )
      throw new Error("Keep each signature field within its PDF page.");
  }
}
export function validateSigningSetup(
  fields: SignatureField[],
  pages: number,
  owner?: OwnerSignature,
) {
  validateFields(fields, pages);
  if (!fields.some((f) => fieldKind(f) === "customerSignature"))
    throw new Error("Add at least one customer signature field.");
  if (fields.some(isOwnerField) && !owner)
    throw new Error("Apply your signature before creating the customer link.");
}
export function signerName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100 || /[\x00-\x1f]/.test(name))
    throw new Error("Enter your full name (2–100 characters).");
  return name;
}
export async function sha256(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
