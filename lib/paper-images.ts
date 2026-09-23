// The pictures a printed proposal paper carries, and waiting for them. Ported
// from FRSG's lib/paper-images.ts.
//
// A print lays the sheets out of whatever is in the document at the instant it
// is called, and an `<img>` still on the wire at that instant prints as a hole.
// So the paper screen asks for the faces first (`paper-fonts.ts`) and then for
// the pictures, and only then says it is ready to print.

/**
 * Every image the paper draws — today the letterhead's logo — fetched and
 * decoded, or given up on.
 *
 * It never rejects: an image that fails is a hole on the page, which is what it
 * would have been anyway, and not a reason to keep the reader waiting for a
 * letterhead that is already there.
 */
export async function paperImagesSettled(): Promise<void> {
  if (typeof document === "undefined") return;
  const images = Array.from(
    document.querySelectorAll<HTMLImageElement>(".proposal-document img"),
  );
  await Promise.allSettled(
    images.map((image) => (image.complete ? Promise.resolve() : image.decode())),
  );
}
