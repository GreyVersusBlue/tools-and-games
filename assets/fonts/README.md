# The site's own fonts

Five woff2 files, 106.8 KB total, backing the three typefaces `index.html` and
`404.html` share: Alegreya (body text, plus the board-note italic), Alegreya SC
(every small-caps label — eyebrows, ribbons, the plaque, the footer), and
Grenze Gotisch (the carved sign's `<h1>` at 700, and each notice's `<h3>` at 500).

| File | Weight / style |
| --- | --- |
| `alegreya-latin-400-normal.woff2` | Alegreya 400 normal |
| `alegreya-latin-400-italic.woff2` | Alegreya 400 italic |
| `alegreya-sc-latin-400-normal.woff2` | Alegreya SC 400 normal |
| `grenze-gotisch-latin-500-normal.woff2` | Grenze Gotisch 500 normal |
| `grenze-gotisch-latin-700-normal.woff2` | Grenze Gotisch 700 normal |

Those five combinations are the whole of it — read from the CSS, not from the old
hotlink, which asked for more than either page uses (Alegreya SC 500, an extra
Alegreya italic weight). Latin subset only; neither page renders outside it.

Source: [Fontsource](https://fontsource.org) `@fontsource/alegreya`,
`@fontsource/alegreya-sc`, `@fontsource/grenze-gotisch`, all v5.3.0 — the same
files Google Fonts serves, repackaged, and the same version already vendored in
`Tools/board-check/node_modules` for `harness.mjs`'s font shim. Copied
byte-for-byte from there; nothing at runtime references `node_modules`. All
three families are licensed **SIL Open Font License 1.1**.

## Why here and not per-project

Locked decision #17 says each *project* vendors its own copy, so nothing is
shared across projects — a parallel-safety rule for twenty sessions that can't
see each other's work. `index.html` and `404.html` are not a project, they are
the site itself, and they are the two pages this thread owns outright. Putting
one shared copy in `assets/fonts/`, next to `assets/js/gvb-save.js` (the other
deliberately shared runtime file in the repo), avoids two copies of the same
five files with no parallel-safety reason to duplicate them. This is locked
decision #43 — see the handoff.

## Why these are in the repo at all

Both pages hotlinked `fonts.googleapis.com` for their entire history, which
`page.__blocked` never caught: `harness.mjs`'s `prepPage()` fulfills a Google
Fonts request locally, from the same `@fontsource` packages this folder copies
from, before its blocked-list check runs. See `Tools/board-check/harness.mjs`'s
`page.__shimmed` and `check-integrity.mjs`'s static sweep, both added the same
session this was vendored, for what closed that hole.
