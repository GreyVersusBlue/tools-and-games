# Vendored fonts

Seven woff2 files, **100.3 KB** for the set. Latin subset only.

| File | KB | Used by |
| --- | --- | --- |
| `alfa-slab-one-latin-400-normal.woff2` | 18.6 | `--display` — the title, every heading, `.btn-main`, the stunt verdict, canvas titles |
| `oswald-latin-400-normal.woff2` | 12.0 | `--ui` — body text, choice buttons |
| `oswald-latin-500-normal.woff2` | 12.4 | choice subtext, canvas HUD labels |
| `oswald-latin-600-normal.woff2` | 12.4 | section labels, canvas gauge labels |
| `oswald-latin-700-normal.woff2` | 12.4 | canvas balance prompts |
| `space-mono-latin-400-normal.woff2` | 16.1 | `--mono` — stat chips |
| `space-mono-latin-700-normal.woff2` | 16.3 | the stunt score |

## Sources and licences

All three come from the official [Fontsource](https://fontsource.org) npm
packages at **5.3.0**, which repackage the Google Fonts originals. These are
byte-identical copies of the `files/*-latin-*-normal.woff2` each package ships —
nothing was re-subset or re-encoded.

| Family | Package | Copyright |
| --- | --- | --- |
| Alfa Slab One | `@fontsource/alfa-slab-one@5.3.0` | Copyright 2016 The Alfa Slab One Project Authors, reserved font name "Alfa Slab" |
| Oswald | `@fontsource/oswald@5.3.0` | Copyright 2016 The Oswald Project Authors |
| Space Mono | `@fontsource/space-mono@5.3.0` | Copyright 2016 The Space Mono Project Authors |

All three are **SIL Open Font License 1.1**. The OFL requires the copyright
notice and licence to travel with the font files, so the full text of each sits
next to them as `LICENSE-AlfaSlabOne.txt`, `LICENSE-Oswald.txt` and
`LICENSE-SpaceMono.txt`. It permits redistribution as part of a larger work,
which is what this is.

Two of the three were already in this repo and were copied rather than fetched:
Oswald from `Tools/board-check/node_modules/@fontsource/oswald/` (there for the
render harness) and Space Mono from `Projects/corner-and-kettle/fonts/`, which
had vendored the same two weights. Each project keeps its own copy — locked
decision #17 — so these are copies, not references.

## Why these are in the repo

`daredevil_r4.html` used to carry two `preconnect`s and a stylesheet link to
`fonts.googleapis.com`, asking for Alfa Slab One, Oswald 300/400/500/600/700 and
Space Mono 400/700. Session 9 replaced them with `@font-face` rules pointing here.

- 100.3 KB, against a page that already ships 335 KB of HTML
- it stops handing Google the IP address of everyone who opens the page, on a
  page where a full run takes about an hour of reading
- it matches what v4 decided for three.js and what session 7 decided for Golden
  Hour's sand texture

**Oswald 300 is not here.** The Google URL asked for it and nothing on the page
has ever set `font-weight:300`, so vendoring it would have been 12 KB of nothing.

**A caveat for anyone checking this with the harness.** `page.__blocked` will not
catch a font hotlink coming back: `prepPage()` in `Tools/board-check/harness.mjs`
*fulfills* `fonts.googleapis.com` requests locally from its own `@fontsource`
packages before the blocked-list check runs. The check that works is a grep of
the HTML for `fonts.googleapis.com`, and it is in
`Projects/daredevil/test/smoke-page.mjs`.
