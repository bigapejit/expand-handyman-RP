# The paper's faces

Two families, self-hosted so that the customer's browser, the staff print
dialogue and the server renderer all set the proposal paper in the same glyphs.
The files live in `public/fonts/` with their licences beside them; the
`@font-face` rules that name them are in `app/paper-fonts.css`, and the stacks
that call for them in `lib/paper-fonts.ts`. Nothing requests them from Google
Fonts or any other third party at runtime.

This file is out of `public/` on purpose: everything in there is served, and a
customer's origin has no business publishing our issue numbers.

Files, under `public/fonts/`:

| File | Family | Licence |
|---|---|---|
| `Tinos-Regular.woff2` | Tinos 400 upright | SIL OFL 1.1 — `Tinos-OFL.txt` |
| `Tinos-Italic.woff2` | Tinos 400 italic | as above |
| `Tinos-Bold.woff2` | Tinos 700 upright | as above |
| `Tinos-BoldItalic.woff2` | Tinos 700 italic | as above |
| `HomemadeApple-Regular.woff2` | Homemade Apple 400 | Apache 2.0 — `HomemadeApple-LICENSE.txt` |

Tinos is Steve Matteson's serif for the Chrome OS core set, metric-compatible
with Times New Roman: the same advance widths, so a sheet set in it breaks its
lines where Times would. That is the whole reason it is here — a Linux machine
has no Times New Roman and falls back to DejaVu Serif, so the server's PDF copy
of a contract would otherwise differ in typeface from the browser's. Google
relicensed Tinos from Apache 2.0 to the OFL in 2021, so the licence beside it
is the OFL.

Homemade Apple is Font Diner's handwriting face, the signature script.
Copyright (c) 2010 by Font Diner, Inc.; it is latin-only, which is all a
signature needs.

## Making them again

The sources are the TrueType files Google Fonts ships, converted to WOFF2
here — no subsetting, so a name or an address with an accent still sets in the
document's own face rather than falling back mid-line.

```sh
pip install fonttools brotli

# Tinos moved to ofl/ when it was relicensed; Homemade Apple is still under apache/.
base=https://raw.githubusercontent.com/google/fonts/main
for f in Tinos-Regular Tinos-Italic Tinos-Bold Tinos-BoldItalic; do
  curl -sSL -o "$f.ttf" "$base/ofl/tinos/$f.ttf"
done
curl -sSL -o HomemadeApple-Regular.ttf "$base/apache/homemadeapple/HomemadeApple-Regular.ttf"

for f in Tinos-*.ttf HomemadeApple-Regular.ttf; do
  python -m fontTools.ttLib.woff2 compress -o "${f%.ttf}.woff2" "$f"
done

# The licences beside them.
curl -sSL -o Tinos-OFL.txt https://raw.githubusercontent.com/googlefonts/tinos/main/OFL.txt
curl -sSL -o HomemadeApple-LICENSE.txt "$base/apache/homemadeapple/LICENSE.txt"
```

The Tinos files in `public/fonts/` are FRSG's, made that way on 2026-09-03
from Tinos 1.340, and brought here by the proposal paper prototype (#22).
