# sheet-symbols.woff2

Four glyphs, 2,972 bytes: α (U+03B1), ≈ (U+2248), ■ (U+25A0), ▸ (U+25B8).
They are the characters the printed sheets draw (`js/spec.js`, `js/blueprint.js`)
that neither Public Sans nor IBM Plex Mono's Latin subsets in `/assets/fonts/`
carry. Without this file each machine picked its own fallback face for them.

- Source: Noto Sans Mono Regular, `fonts-noto-mono` 20201225 (Debian/Ubuntu
  package), upstream <https://github.com/notofonts/noto-fonts>.
- Licence: SIL Open Font License 1.1, Copyright 2010, 2012-2020 Google Inc.,
  2015-2020 Google LLC. The OFL allows embedding and subsetting; Noto declares
  no Reserved Font Name.
- Made 2026-11-08 (TG-65, three glyphs; TG-66 added ▸) with the `subset-font`
  npm package (build time only, not a dependency of this repo):
  `subsetFont(ttf, 'α≈■▸', { targetFormat: 'woff2' })` on
  `/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf`. The three-glyph
  recipe reproduces the TG-65 file byte for byte, so the source is the same.
- Used by an `@font-face` in `index.html` and in `test/visual/run.mjs`'s sheet
  harness, declared under the `Public Sans` and `IBM Plex Mono` family names
  with a `unicode-range` of just these four code points, so no other character
  changes face.

▸ is the phasing sheet's current-phase mark (`js/blueprint.js`) and the rail's
fold arrow (`content: '\25b8'` in `index.html`). TG-65 left it out because
covering it redraws the rail arrow in the chrome and moves `chrome-welcome`;
TG-66 took that change, so the arrow is the same glyph on every machine too.
Every other non-Latin character in `index.html` and `js/` is a chrome icon,
which `initGlyphs` draws as SVG (TG-63), or sits in a comment or an HTML table
(the takeoff's `→`); none is drawn on a sheet.

Why one face per weight: a single face spanning 100 to 900 matches a request
for weight 600 ahead of the 700 face and takes the whole family with it (every
capture moved, up to 9%). And the rules in `index.html` are written tight,
without `font-display` or `format()`, because the boot budget in
`test/tools/run.mjs` had under 700 bytes of room left.
