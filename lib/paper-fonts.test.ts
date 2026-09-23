import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  loadPaperFonts,
  paperPrintFaces,
  paperScriptStack,
  paperSerifStack,
  type PaperFontFaceSet,
} from "./paper-fonts";

// Two things can go quietly wrong with a self-hosted face, and neither shows up
// in a diff. The stacks can drift: someone edits one of the four places the
// paper names its serif and the other three keep the old answer, so the same
// contract sets in Tinos on one sheet and Times on the next. And a face can be
// declared but not shipped, or shipped and not declared, and the page falls
// back without saying so. So these tests read the stylesheets and the font
// directory off disk and hold them to `paper-fonts.ts`. Ported from FRSG's
// lib/paper-fonts.test.ts.
const web = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const read = (name: string) => readFileSync(web(name), "utf8");

const fontsCss = read("../app/paper-fonts.css");
const documentCss = read("../app/proposal-document.css");

const DECLARED_FILES = [...fontsCss.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map(([, url]) => url);

describe("the paper's stacks", () => {
  it("names the app's own serif before the reader's", () => {
    // Tinos first is the whole point: the machine that has Times New Roman and
    // the machine that has nothing must draw the same glyphs.
    expect(paperSerifStack).toMatch(/^Tinos,/);
    expect(paperSerifStack).toContain("serif");
  });

  it("falls from the script face to a face the app carries, not to the system's", () => {
    // Homemade Apple is Latin-only. A signer named outside it must land on
    // Tinos, which this app ships, rather than on whatever `cursive` means on
    // the reader's machine.
    expect(paperScriptStack).toMatch(/^"Homemade Apple", Tinos,/);
  });

  it("proposal-document.css sets its body copy in the same stack", () => {
    expect(documentCss).toContain(`font-family: ${paperSerifStack};`);
  });

  it("proposal-document.css signs in the same script stack", () => {
    expect(documentCss).toContain(`font-family: ${paperScriptStack};`);
  });

  it("asks for a face of every style the paper can print", () => {
    expect(paperPrintFaces).toHaveLength(5);
    expect(paperPrintFaces).toContain(`bold italic 10.5pt ${paperSerifStack}`);
    expect(paperPrintFaces).toContain(`14pt ${paperScriptStack}`);
  });
});

describe("fonts.css", () => {
  it("declares the four Tinos styles and the script, all blocking", () => {
    const faces = fontsCss.match(/@font-face/g) ?? [];
    expect(faces).toHaveLength(5);
    expect(fontsCss.match(/font-display: block;/g) ?? []).toHaveLength(5);
  });

  it("ships every file it declares", () => {
    expect(DECLARED_FILES).toHaveLength(5);
    for (const url of DECLARED_FILES) {
      expect(existsSync(web(`../public${url}`)), `${url} is declared but not in public/`).toBe(true);
    }
  });

  it("keeps a licence beside the faces", () => {
    expect(existsSync(web("../public/fonts/Tinos-OFL.txt"))).toBe(true);
    expect(existsSync(web("../public/fonts/HomemadeApple-LICENSE.txt"))).toBe(true);
  });

  it("asks for nothing from a third party", () => {
    expect(fontsCss).not.toMatch(/https?:\/\//);
  });
});

describe("loadPaperFonts", () => {
  const fontsThat = (load: (font: string) => Promise<unknown>, ready = Promise.resolve()) =>
    ({ load, ready }) satisfies PaperFontFaceSet;

  it("asks for every face the paper can print, then waits for the set", async () => {
    const asked: string[] = [];
    let readySettled = false;
    const ready = Promise.resolve().then(() => {
      readySettled = true;
    });

    await loadPaperFonts(
      fontsThat(async (font) => {
        asked.push(font);
      }, ready),
    );

    expect(asked).toEqual([...paperPrintFaces]);
    expect(readySettled).toBe(true);
  });

  it("returns without a font set, so a browser that has none still prints", async () => {
    await expect(loadPaperFonts(undefined)).resolves.toBeUndefined();
  });

  it("returns when a face refuses to load", async () => {
    await expect(
      loadPaperFonts(fontsThat(() => Promise.reject(new Error("no such face")))),
    ).resolves.toBeUndefined();
  });

  it("keeps waiting for the rest when one face refuses straight away", async () => {
    // The failure this whole function exists to prevent, reached by the back
    // door: a bold italic that 404s in a millisecond while the regular face is
    // still on the wire. Giving up on the first rejection would hand the print
    // dialogue a sheet whose body copy is still inside the blocking period.
    vi.useFakeTimers();
    try {
      let releaseTheRest: () => void = () => {};
      const rest = new Promise<void>((resolve) => {
        releaseTheRest = resolve;
      });
      let done = false;
      const waiting = loadPaperFonts(
        fontsThat((font) => (font.includes("bold italic") ? Promise.reject(new Error("404")) : rest)),
        3000,
      );
      void waiting.then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(done, "gave up as soon as one face failed").toBe(false);

      releaseTheRest();
      await vi.advanceTimersByTimeAsync(0);
      await waiting;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up rather than hold the print dialogue shut", async () => {
    vi.useFakeTimers();
    try {
      // A fetch that never lands. The sheet still prints — in the fallback
      // face, which is what would have happened without any of this.
      const waiting = loadPaperFonts(fontsThat(() => new Promise(() => {})), 3000);
      let done = false;
      void waiting.then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(2999);
      expect(done).toBe(false);

      await vi.advanceTimersByTimeAsync(2);
      await waiting;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
