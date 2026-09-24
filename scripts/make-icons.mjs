// Draws the home-screen icons from the company logo. Run `node scripts/make-icons.mjs`
// after changing public/logo.svg; the PNGs it writes are committed.
//
// Two shapes because Android and iOS crop differently:
//  - icon-*.png ("any"): the logo at 60% of the canvas; iOS rounds the corners itself.
//  - icon-maskable-*.png ("maskable"): the logo at 48%, inside Android's safe
//    zone, so adaptive launchers can cut a circle or squircle without clipping.
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const logo = await readFile(new URL("../public/logo.svg", import.meta.url));
const out = new URL("../public/icons/", import.meta.url);
await mkdir(out, { recursive: true });

// The logo's own dark grey and amber sit on white in the sidebar, so the icon
// keeps that: a white tile, never the dark grey, which would swallow the "E".
const background = "#ffffff";

async function tile(size, logoShare, file) {
  const width = Math.round(size * logoShare);
  const mark = await sharp(logo).resize({ width }).png().toBuffer();
  const { height } = await sharp(mark).metadata();
  await sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([
      {
        input: mark,
        left: Math.round((size - width) / 2),
        top: Math.round((size - height) / 2),
      },
    ])
    .png()
    .toFile(fileURLToPath(new URL(file, out)));
}

await tile(192, 0.6, "icon-192.png");
await tile(512, 0.6, "icon-512.png");
await tile(192, 0.48, "icon-maskable-192.png");
await tile(512, 0.48, "icon-maskable-512.png");
await tile(180, 0.6, "apple-touch-icon.png");
console.log("icons written to public/icons");
