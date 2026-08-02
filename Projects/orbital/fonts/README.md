# Vendored fonts

Five woff2 files, the exact weights `index.html`/`css/orbital.css` actually
set:

| File | Family | Weight | Style |
| --- | --- | --- | --- |
| `space-grotesk-latin-400-normal.woff2` | Space Grotesk | 400 | normal |
| `space-grotesk-latin-500-normal.woff2` | Space Grotesk | 500 | normal |
| `space-grotesk-latin-700-normal.woff2` | Space Grotesk | 700 | normal |
| `space-mono-latin-400-normal.woff2` | Space Mono | 400 | normal |
| `space-mono-latin-700-normal.woff2` | Space Mono | 700 | normal |

Source: the `@fontsource/space-grotesk` and `@fontsource/space-mono` npm
packages (latin subset). Both fonts are licensed under the **SIL Open Font
License, Version 1.1** — Space Grotesk © 2018 Florian Karsten, Space Mono ©
2016 Colophon Foundry. Full license text ships with each `@fontsource`
package's own `LICENSE` file.

## Why these are in the repo

The original build hotlinked both families from `fonts.googleapis.com` /
`fonts.gstatic.com` via `<link rel="preconnect">` tags plus a `css2`
stylesheet link. The board's integrity check
(`Tools/board-check/check-integrity.mjs`) fails any page that references an
offsite host, so those links are gone and `@font-face` rules in
`css/orbital.css` point at the five files above instead.
