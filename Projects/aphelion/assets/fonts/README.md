# Vendored fonts

Five woff2 files, 93.2 KB total (95,400 bytes), the exact weights `index.html`
actually sets:

| File | Family | Weight | Style |
| --- | --- | --- | --- |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono | 400 | normal |
| `ibm-plex-mono-latin-500-normal.woff2` | IBM Plex Mono | 500 | normal |
| `lora-latin-400-normal.woff2` | Lora | 400 | normal |
| `lora-latin-500-normal.woff2` | Lora | 500 | normal |
| `lora-latin-400-italic.woff2` | Lora | 400 | italic |

Source: the `@fontsource/ibm-plex-mono` and `@fontsource/lora` npm packages
already on disk at `Tools/board-check/node_modules/@fontsource/` (latin subset).
Both fonts are licensed under the **SIL Open Font License, Version 1.1** —
IBM Plex Mono © 2017 IBM Corp., Lora © 2011 The Lora Project Authors. Full
license text ships with each `@fontsource` package's own `LICENSE` file.

## Why these are in the repo

`index.html` used to hotlink both families from `fonts.googleapis.com` /
`fonts.gstatic.com` — the two `<link rel="preconnect">` tags plus a `css2`
stylesheet link. That handed Google the IP address of everyone who opened the
game and made Aphelion one of four games in the regression suite where
`page.__blocked` couldn't see the hotlink, because `harness.mjs`'s `prepPage()`
fulfills Google Fonts requests locally before the blocked-list check ever runs.

Vendoring them: `@font-face` rules in `index.html` point at the five files
above, the `preconnect`/stylesheet links are gone, and a `grep` for
`fonts.googleapis.com` in `index.html` now finds nothing.
