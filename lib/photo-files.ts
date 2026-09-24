import {
  exifTakenAt,
  fitLongEdge,
  FULL_LONG_EDGE,
  THUMB_LONG_EDGE,
} from "./photos";

// The browser half of a **Photo** (ADR 0003): the picked file made into the
// two JPEGs the site keeps, before anything is uploaded. Browser-only, and
// checked by hand on the owner's phone rather than by tests.

/** A file this browser cannot open as a picture: an HEIC photo on Android, or not a photo at all. */
export class PhotoUnreadable extends Error {
  constructor() {
    super("Can't open this file. Save photos as JPEG.");
  }
}

export type ShrunkPhoto = {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  takenAt?: number;
};

export async function shrinkPhoto(file: File): Promise<ShrunkPhoto> {
  // The camera time first, from the original: the JPEGs a canvas writes
  // carry no metadata.
  const takenAt = await readTakenAt(file);
  const image = await openImage(file);
  try {
    const full = await shrink(file, image, FULL_LONG_EDGE);
    // The thumbnail is made from the full image, so the original is decoded
    // once however large it is.
    const thumb = await shrink(full, full, THUMB_LONG_EDGE);
    return {
      full: await jpeg(full),
      thumb: await jpeg(thumb),
      width: full.width,
      height: full.height,
      takenAt,
    };
  } finally {
    URL.revokeObjectURL(image.src);
  }
}

// EXIF's DateTimeOriginal, read by exifreader, which is loaded only once a
// photo is picked. No camera time, or a file it cannot parse, is simply none:
// the photo then shows as Added.
async function readTakenAt(file: File) {
  try {
    const { load } = await import("exifreader");
    const tags = await load(file);
    return exifTakenAt(
      tags.DateTimeOriginal?.description,
      tags.OffsetTimeOriginal?.description,
    );
  } catch {
    return undefined;
  }
}

// The picture as an image element: its size, upright as the camera held it,
// and the fallback to draw from where resizing is missing. A file the browser
// cannot decode fails here, before anything is uploaded.
function openImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      reject(new PhotoUnreadable());
    };
    image.src = URL.createObjectURL(file);
  });
}

// `source` brought down to `longEdge` on its long side, in a canvas that size.
// createImageBitmap resizes it, by height for a portrait picture; where its
// resize options are missing, or the bitmap comes back turned the other way
// (Safari before 16 ignores the camera's rotation there), the picture is drawn
// from `fallback` instead, and a bitmap the browser left full size is scaled
// by the draw either way.
async function shrink(
  source: Blob | HTMLCanvasElement,
  fallback: HTMLImageElement | HTMLCanvasElement,
  longEdge: number,
) {
  const width = fallback instanceof HTMLImageElement ? fallback.naturalWidth : fallback.width;
  const height = fallback instanceof HTMLImageElement ? fallback.naturalHeight : fallback.height;
  if (!width || !height) throw new PhotoUnreadable();
  const target = fitLongEdge(width, height, longEdge);
  const portrait = height > width;

  let bitmap: ImageBitmap | null = null;
  if (typeof createImageBitmap === "function") {
    try {
      bitmap = await createImageBitmap(source, {
        ...(portrait ? { resizeHeight: target.height } : { resizeWidth: target.width }),
        resizeQuality: "high",
      });
      if (bitmap.width !== bitmap.height && bitmap.height > bitmap.width !== portrait) {
        bitmap.close();
        bitmap = null;
      }
    } catch {
      bitmap = null;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't shrink photos.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap ?? fallback, 0, 0, target.width, target.height);
  bitmap?.close();
  return canvas;
}

function jpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This browser can't shrink photos."))),
      "image/jpeg",
      0.85,
    ),
  );
}
