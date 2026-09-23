// The faces the paper is set in, named once. Ported from FRSG's
// lib/paper-fonts.ts.
//
// The stacks below are the paper's typography, and they are here rather than
// only in CSS because one of the places that sets them is not a stylesheet:
// the printed footer is a CSS string a component builds for `@page` margin
// boxes. A custom property would not reach it — `@page` does not inherit the
// document's custom properties in every browser, and that footer is exactly
// the fragile corner where a silent fallback would go unnoticed. So the stacks
// are exported here, the component imports them, and `paper-fonts.test.ts`
// reads the stylesheet off disk and asserts it still says the same thing.
//
// The faces themselves are declared in `app/paper-fonts.css` and served from
// `public/fonts/`; `docs/paper-fonts.md` records where the files came from.

/**
 * Everything on the paper that is not the signature: the proposal paper and
 * its printed footer.
 *
 * Tinos first, because it is the face this app carries. Times New Roman is
 * behind it for the moment before Tinos lands and for a browser that refuses
 * WOFF2; it is metric-compatible, so falling back changes the glyphs but not
 * where the lines break.
 */
export const paperSerifStack = 'Tinos, "Times New Roman", Times, serif';

/**
 * The signature alone.
 *
 * Homemade Apple covers Latin and no more — about 230 glyphs. A signer whose
 * name carries `ř`, or Vietnamese, or Greek, would otherwise fall through to
 * whatever the reader's system calls `cursive`, which is Comic Sans on
 * Windows and something else again on the Linux renderer: the very
 * disagreement between two copies of one contract that self-hosting is here to
 * end. So the paper's own serif sits between the two, and only a script the
 * app carries no face for at all reaches the generic fallback.
 */
export const paperScriptStack = '"Homemade Apple", Tinos, cursive';

/**
 * Every face a printed sheet can call for, as font shorthands.
 *
 * `FontFaceSet.load` matches these against the faces the document declares and
 * ignores the families it has never heard of, so passing the whole stack asks
 * for exactly the parts of it this app carries.
 */
export const paperPrintFaces = [
  `10.5pt ${paperSerifStack}`,
  `bold 10.5pt ${paperSerifStack}`,
  `italic 10.5pt ${paperSerifStack}`,
  `bold italic 10.5pt ${paperSerifStack}`,
  `14pt ${paperScriptStack}`,
] as const;

/** Long enough for a cold fetch on a slow connection, short enough that a font
 *  that is never coming does not hold the print dialogue shut. */
export const paperFontTimeoutMs = 3000;

/** The part of `FontFaceSet` this module uses, so a test can stand in for it. */
export type PaperFontFaceSet = {
  load: (font: string) => Promise<unknown>;
  ready: Promise<unknown>;
};

/**
 * Ask for every face a printed sheet can need, and wait for them.
 *
 * A face is fetched only once something on the page is set in it, and
 * `font-display: block` hides the text until it lands. `window.print()` and a
 * headless renderer's print are both synchronous:
 * called cold, it lays the sheets out in the middle of `font-display: block`'s
 * blocking period, and the customer saves a PDF of invisible text or of the
 * fallback face. Asking first turns that into a wait.
 *
 * It never rejects and never waits forever. A face that fails to load, a
 * browser with no `document.fonts`, a fetch that hangs — each of them ends
 * with the sheet printed in whatever is available, which is what would have
 * happened anyway. Printing is the customer's request; a font is not allowed
 * to refuse it.
 *
 * `allSettled`, not `all`: one face failing fast must not cut short the wait
 * for the others. A missing bold italic returning 404 in a few milliseconds
 * while regular Tinos is still on the wire would otherwise hand the print
 * dialogue a sheet whose body copy is still inside the blocking period —
 * which is the very failure this function exists to prevent. Only the timeout
 * ends the wait early.
 */
export async function loadPaperFonts(
  fonts: PaperFontFaceSet | undefined = typeof document === "undefined"
    ? undefined
    : document.fonts,
  timeoutMs: number = paperFontTimeoutMs,
): Promise<void> {
  if (!fonts) return;
  const arrived = Promise.allSettled(paperPrintFaces.map((face) => fonts.load(face))).then(
    () => fonts.ready,
  );
  const gaveUp = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([arrived, gaveUp]).catch(() => undefined);
}
