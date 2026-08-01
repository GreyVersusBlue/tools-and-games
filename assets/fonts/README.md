# The site's own fonts

Ten woff2 files, 176.6 KB total, backing the six typefaces `index.html`,
`404.html`, and `newindex.html` share between them:

| File | Weight / style | Used by |
| --- | --- | --- |
| `alegreya-latin-400-normal.woff2` | Alegreya 400 normal | index.html, 404.html |
| `alegreya-latin-400-italic.woff2` | Alegreya 400 italic | index.html, 404.html |
| `alegreya-sc-latin-400-normal.woff2` | Alegreya SC 400 normal | index.html, 404.html |
| `grenze-gotisch-latin-500-normal.woff2` | Grenze Gotisch 500 normal | index.html, 404.html |
| `grenze-gotisch-latin-700-normal.woff2` | Grenze Gotisch 700 normal | index.html, 404.html |
| `space-grotesk-latin-600-normal.woff2` | Space Grotesk 600 normal | newindex.html |
| `public-sans-latin-400-normal.woff2` | Public Sans 400 normal | newindex.html |
| `public-sans-latin-700-normal.woff2` | Public Sans 700 normal | newindex.html |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono 400 normal | newindex.html |
| `ibm-plex-mono-latin-500-normal.woff2` | IBM Plex Mono 500 normal | newindex.html |

Alegreya/Alegreya SC/Grenze Gotisch's five combinations are read from
`index.html`/`404.html`'s CSS, not from the old hotlink, which asked for more
than either page uses (Alegreya SC 500, an extra Alegreya italic weight).
Space Grotesk/Public Sans/IBM Plex Mono's five combinations are the same:
read from `newindex.html`'s CSS (only `.name`/`h1` use Space Grotesk, and only
at 600; body text and `strong`/`b` are the only two Public Sans weights in
use; IBM Plex Mono never goes italic and only appears at 400 and 500) rather
than the hotlink it shipped with, which asked for the full 400–700 range of
both plus italics neither one renders. Latin subset only; none of the three
pages render outside it.

Source: [Fontsource](https://fontsource.org) `@fontsource/alegreya`,
`@fontsource/alegreya-sc`, `@fontsource/grenze-gotisch`, `@fontsource/public-sans`,
`@fontsource/ibm-plex-mono`, all v5.3.0 — the same files Google Fonts serves,
repackaged, and the same version already vendored in
`Tools/board-check/node_modules` for `harness.mjs`'s font shim (copied
byte-for-byte from there). `@fontsource/space-grotesk` isn't one of the twelve
families `board-check/node_modules` carries, so its one file was fetched
straight from the registry (`npm pack @fontsource/space-grotesk@5.3.0`, same
version as the rest) rather than copied locally — nothing at runtime
references `node_modules` either way. All five families are licensed
**SIL Open Font License 1.1**.

## Why here and not per-project

Locked decision #17 says each *project* vendors its own copy, so nothing is
shared across projects — a parallel-safety rule for twenty sessions that can't
see each other's work. `index.html`, `404.html` and `newindex.html` are not a
project, they are the site itself (see locked decision #51), and they are
pages this thread owns outright. Putting one shared copy in `assets/fonts/`,
next to `assets/js/gvb-save.js` (the other deliberately shared runtime file in
the repo), avoids duplicate copies of the same files with no parallel-safety
reason to duplicate them. This is locked decision #43, extended to
`newindex.html` by #51 — see the handoff.

## Why these are in the repo at all

Both pages hotlinked `fonts.googleapis.com` for their entire history, which
`page.__blocked` never caught: `harness.mjs`'s `prepPage()` fulfills a Google
Fonts request locally, from the same `@fontsource` packages this folder copies
from, before its blocked-list check runs. See `Tools/board-check/harness.mjs`'s
`page.__shimmed` and `check-integrity.mjs`'s static sweep, both added the same
session this was vendored, for what closed that hole.
