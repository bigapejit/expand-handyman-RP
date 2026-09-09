export const CONSENT =
  "I have reviewed this document and agree to sign it electronically. I understand that my typed name is my signature.";
export const CONSENT_VERSION = "2026-09-09";
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export type SignatureField = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type SignatureRecord = {
  name: string;
  signedAt: number;
  documentId: string;
  originalHash: string;
};
export function validateFields(fields: SignatureField[], pages: number) {
  if (!fields.length || fields.length > 30)
    throw new Error("Place between 1 and 30 signature fields.");
  if (new Set(fields.map((f) => f.id)).size !== fields.length)
    throw new Error("Signature field IDs must be unique.");
  for (const f of fields) {
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
