import { describe, expect, test } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import { handwritingFont } from "../lib/handwriting-font";
import { fieldTextLayout } from "../lib/pdf";

const font = fontkit.create(
  Uint8Array.from(atob(handwritingFont), (c) => c.charCodeAt(0)),
);

describe("Signature placement uses the visible ink", () => {
  test.each(["Andrew Putilin", "Patricia Black", "Gregory Young"])(
    "%s sits just above the field's bottom edge",
    async (name) => {
      const height = 50;
      const layout = await fieldTextLayout(name, 200, height, false);
      const bottomOfInk =
        layout.baseline -
        (font.layout(name).bbox.minY * layout.size) / font.unitsPerEm;
      expect(bottomOfInk).toBeCloseTo(height - 2, 1);
    },
  );
});
