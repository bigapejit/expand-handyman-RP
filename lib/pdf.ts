import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { signatureFont } from "./signature-font";
import {
  CONSENT,
  type SignatureField,
  type SignatureRecord,
  validateFields,
} from "./signing";

// Map a point in PDF.js's displayed, top-left coordinate system back into
// the PDF's crop box. This handles portrait, landscape and rotated scans.
export function pagePoint(
  x: number,
  y: number,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number,
) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: crop.x + y, y: crop.y + x };
    case 180:
      return { x: crop.x + crop.width - x, y: crop.y + y };
    case 270:
      return { x: crop.x + crop.width - y, y: crop.y + crop.height - x };
    default:
      return { x: crop.x + x, y: crop.y + crop.height - y };
  }
}
export async function completePdf(
  original: Uint8Array,
  fields: SignatureField[],
  signature: SignatureRecord,
) {
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  validateFields(fields, pdf.getPageCount());
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    Uint8Array.from(atob(signatureFont), (c) => c.charCodeAt(0)),
    { subset: true },
  );
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const unsupported = [...signature.name].some(
    (c) => !font.getCharacterSet().includes(c.codePointAt(0)!),
  );
  if (unsupported)
    throw new Error(
      "Please enter your name using Latin characters for this signature font.",
    );
  for (const field of fields) {
    const page = pdf.getPage(field.page);
    const crop = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const w = rot % 180 ? crop.height : crop.width;
    const h = rot % 180 ? crop.width : crop.height;
    const boxW = field.width * w,
      boxH = field.height * h;
    const size = Math.min(
      32,
      boxH * 0.6,
      (boxW - 8) / font.widthOfTextAtSize(signature.name, 1),
    );
    const point = pagePoint(
      field.x * w + 4,
      field.y * h + boxH * 0.65,
      crop,
      rot,
    );
    page.drawText(signature.name, {
      ...point,
      size,
      font,
      rotate: degrees(rot),
      color: rgb(0.12, 0.14, 0.15),
    });
    const datePoint = pagePoint(
      field.x * w + 4,
      field.y * h + boxH * 0.93,
      crop,
      rot,
    );
    page.drawText(new Date(signature.signedAt).toISOString().slice(0, 10), {
      ...datePoint,
      size: Math.min(8, boxH * 0.18),
      font: regular,
      rotate: degrees(rot),
      color: rgb(0.3, 0.3, 0.3),
    });
  }
  const certificate = pdf.addPage([612, 792]);
  certificate.drawText("EXPAND HANDYMAN", {
    x: 48,
    y: 736,
    size: 12,
    font: regular,
    color: rgb(0.55, 0.36, 0.04),
  });
  certificate.drawText("Signature record", {
    x: 48,
    y: 690,
    size: 26,
    font: regular,
  });
  certificate.drawText(signature.name, {
    x: 48,
    y: 638,
    size: Math.min(36, 510 / font.widthOfTextAtSize(signature.name, 1)),
    font,
  });
  const lines = [
    `Signed at: ${new Date(signature.signedAt).toISOString()} (UTC)`,
    `Document ID: ${signature.documentId}`,
    "Method: typed electronic signature via a private document link",
    `Signature fields: ${fields.length}`,
    "",
    "Original document SHA-256:",
    signature.originalHash,
    "",
    "Consent recorded:",
    ...CONSENT.match(/.{1,78}(?:\s|$)/g)!.map((s) => s.trim()),
    "",
    "The original document and this signature record are retained by Expand Handyman.",
  ];
  let y = 588;
  for (const line of lines) {
    certificate.drawText(line, {
      x: 48,
      y,
      size: 10,
      font: regular,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 22;
  }
  pdf.setCreationDate(new Date(signature.signedAt));
  pdf.setModificationDate(new Date(signature.signedAt));
  pdf.setProducer("Expand Handyman");
  pdf.setCreator("Expand Handyman");
  return pdf.save({ useObjectStreams: false });
}
