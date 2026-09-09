import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { handwritingFont } from "./handwriting-font";
import {
  CONSENT,
  type SignatureField,
  type SignatureRecord,
  validateFields,
  isDateField,
  isOwnerField,
  signingDate,
  type OwnerSignature,
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
let previewFonts:
  | Promise<{
      script: import("pdf-lib").PDFFont;
      regular: import("pdf-lib").PDFFont;
    }>
  | undefined;
const handwriting = fontkit.create(
  Uint8Array.from(atob(handwritingFont), (c) => c.charCodeAt(0)),
);
export async function fieldTextLayout(
  text: string,
  width: number,
  height: number,
  date: boolean,
) {
  previewFonts ??= (async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    return {
      script: await pdf.embedFont(
        Uint8Array.from(atob(handwritingFont), (c) => c.charCodeAt(0)),
      ),
      regular: await pdf.embedFont(StandardFonts.Helvetica),
    };
  })();
  const fonts = await previewFonts;
  const face = date ? fonts.regular : fonts.script;
  // Position visible ink, not the font's line box. Homemade Apple reserves a
  // very large descender area even in names with no descending letters.
  const bounds = date ? undefined : handwriting.layout(text).bbox;
  const units = handwriting.unitsPerEm;
  const inkTop = bounds
    ? bounds.maxY / units
    : face.heightAtSize(1, { descender: false });
  const inkBottom = bounds ? bounds.minY / units : 0;
  const inkLeft = bounds ? bounds.minX / units : 0;
  const inkWidth = bounds
    ? (bounds.maxX - bounds.minX) / units
    : face.widthOfTextAtSize(text, 1);
  const size = Math.min(
    (height - 4) / (inkTop - inkBottom),
    (width - 8) / inkWidth,
  );
  return {
    size,
    x: 4 - inkLeft * size,
    baseline: height - 2 + inkBottom * size,
  };
}
export async function completePdf(
  original: Uint8Array,
  fields: SignatureField[],
  signature: SignatureRecord,
  owner?: OwnerSignature,
) {
  return renderPdf(original, fields, signature, owner);
}
export async function ownerPdf(
  original: Uint8Array,
  fields: SignatureField[],
  owner?: OwnerSignature,
) {
  if (!owner || !fields.some(isOwnerField)) return original;
  return renderPdf(original, fields, undefined, owner);
}
async function renderPdf(
  original: Uint8Array,
  fields: SignatureField[],
  signature?: SignatureRecord,
  owner?: OwnerSignature,
) {
  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  validateFields(fields, pdf.getPageCount());
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    Uint8Array.from(atob(handwritingFont), (c) => c.charCodeAt(0)),
    // Allura's contextual glyphs are lost by pdf-lib/fontkit subsetting.
    // Embed the full font so every letter survives in downloaded PDFs.
    { subset: false },
  );
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const unsupported = [
    ...[signature?.name, owner?.name].filter(Boolean).join(""),
  ].some((c) => !font.getCharacterSet().includes(c.codePointAt(0)!));
  if (unsupported)
    throw new Error(
      "Please enter your name using Latin characters for this signature font.",
    );
  for (const field of fields) {
    const person = isOwnerField(field) ? owner : signature;
    if (!person) continue;
    const page = pdf.getPage(field.page);
    const crop = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const w = rot % 180 ? crop.height : crop.width;
    const h = rot % 180 ? crop.width : crop.height;
    const boxW = field.width * w,
      boxH = field.height * h;
    const date = isDateField(field);
    const text = date ? signingDate(person.signedAt) : person.name;
    const face = date ? regular : font;
    const inkHeight = field.kind === undefined ? boxH * 0.75 : boxH;
    const layout = await fieldTextLayout(text, boxW, inkHeight, date);
    const point = pagePoint(
      field.x * w + layout.x,
      field.y * h + layout.baseline,
      crop,
      rot,
    );
    page.drawText(text, {
      ...point,
      size: layout.size,
      font: face,
      rotate: degrees(rot),
      color: date ? rgb(0, 0, 0) : rgb(0.102, 0.122, 0.478),
    });
    // Older fields included a date beneath the signature. Retain that behavior.
    if (field.kind === undefined) {
      const datePoint = pagePoint(
        field.x * w + 4,
        field.y * h + boxH * 0.93,
        crop,
        rot,
      );
      page.drawText(new Date(person.signedAt).toISOString().slice(0, 10), {
        ...datePoint,
        size: Math.min(8, boxH * 0.18),
        font: regular,
        rotate: degrees(rot),
        color: rgb(0.3, 0.3, 0.3),
      });
    }
  }
  if (signature) {
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
      ...(signature.title ? [`Signer title: ${signature.title}`] : []),
      `Signed at: ${new Date(signature.signedAt).toISOString()} (UTC)`,
      `Document ID: ${signature.documentId}`,
      "Method: typed electronic signature via a private document link",
      `Signature fields: ${fields.length}`,
      ...(owner && fields.some(isOwnerField)
        ? [
            `Owner: ${owner.name}`,
            `Owner signed at: ${new Date(owner.signedAt).toISOString()} (UTC)`,
          ]
        : []),
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
    const wrapped = lines.flatMap((line) => {
      const result: string[] = [];
      let current = "";
      for (const word of line.split(" ")) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && regular.widthOfTextAtSize(candidate, 10) > 516) {
          result.push(current);
          current = word;
        } else current = candidate;
      }
      result.push(current);
      return result;
    });
    for (const line of wrapped) {
      certificate.drawText(line, {
        x: 48,
        y,
        size: 10,
        font: regular,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 22;
    }
  }
  pdf.setCreationDate(new Date((signature ?? owner)!.signedAt));
  pdf.setModificationDate(new Date((signature ?? owner)!.signedAt));
  pdf.setProducer("Expand Handyman");
  pdf.setCreator("Expand Handyman");
  return pdf.save({ useObjectStreams: false });
}
