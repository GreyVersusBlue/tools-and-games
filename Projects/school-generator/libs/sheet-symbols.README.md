# sheet-symbols.woff2

Three glyphs, 2,956 bytes: α (U+03B1), ≈ (U+2248), ■ (U+25A0).
They are the characters the printed sheets draw (`js/spec.js`, `js/blueprint.js`)
that neither Public Sans nor IBM Plex Mono's Latin subsets in `/assets/fonts/`
carry. Without this file each machine picked its own fallback face for them.

- Source: Noto Sans Mono Regular, `fonts-noto-mono` 20201225 (Debian/Ubuntu
  package), upstream <https://github.com/notofonts/noto-fonts>.
- Licence: SIL Open Font License 1.1, Copyright 2010, 2012-2020 Google Inc.,
  2015-2020 Google LLC. The OFL allows embedding and subsetting; Noto declares
  no Reserved Font Name.
- Made 2026-11-08 (TG-65) with the `subset-font` npm package (build time only,
  not a dependency of this repo): `subsetFont(ttf, 'α≈■', { targetFormat: 'woff2' })`.
- Used by an `@font-face` in `index.html` and in `test/visual/run.mjs`'s sheet
  harness, declared under the `Public Sans` and `IBM Plex Mono` family names
  with a `unicode-range` of just these three code points, so no other character
  changes face.

Left out on purpose: ▸ (U+25B8), which the phasing sheet's current-phase mark
and the rail's fold arrow (`content: '\25b8'` in `index.html`) both draw.
Covering it would redraw the rail arrow in the chrome and move
`chrome-welcome` by 1,245 px, and this change was to touch no other glyph.
