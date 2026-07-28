# Vendored type — Faire Weekend

Through Stage 20 these three families were hotlinked from
`fonts.googleapis.com`. Stage 21 vendored them. **Nothing in this project makes
an offsite request any more, and nothing at runtime references `node_modules`.**

Why it mattered enough to do: `gvb-site-handoff-v7.md` §5 claimed the site made
zero offsite requests site-wide, and that was wrong — this game was still
calling out on every load. The board-check suite could not see it, because
`prepPage()` in `Tools/board-check/harness.mjs` fulfills Google Fonts requests
locally from bundled `@fontsource` packages *before* the blocked-list check
runs, so a font hotlink never reaches `page.__blocked`. **`page.__blocked` is
not the check for this. Grep `index.html` for `fonts.googleapis.com` instead.**

Beyond the accuracy of the claim: hotlinked fonts hand a third party the IP
address of everyone who opens the game, and a page that renders the same way
for everyone is better than one that depends on a CDN being up.

## What is here

| File | Bytes | What it is |
| --- | ---: | --- |
| `fraunces-latin-var-normal.woff2` | 67,304 | Fraunces, variable, `opsz 9..144` + `wght 100..900` |
| `fraunces-latin-var-italic.woff2` | 81,520 | the same, italic |
| `grenze-gotisch-latin-var-normal.woff2` | 42,328 | Grenze Gotisch, variable, `wght 100..900` |
| `barlow-semi-condensed-latin-400-normal.woff2` | 22,300 | static |
| `barlow-semi-condensed-latin-600-normal.woff2` | 22,984 | static |
| `barlow-semi-condensed-latin-700-normal.woff2` | 23,244 | static |
| **Total** | **259,680 (253.6 KB)** | |

For scale: Golden Hour's vendored sand pair is 370 KB, and Castle Conundrum's
asset kit is 178 MB. This is not a heavy folder (locked decision #42 — measure
before deciding an asset is too heavy, and this was measured).

## Which weights, and how that was decided

Not by reading the old `<link>` tag. Every screen in the game — all three desk
tabs, each build kind selected, the day report, the weekend summary, the
victory and game-over stubs — was walked with `getComputedStyle`, collecting
every `(family, weight, style)` triple that actually had text rendered in it:

| Family | Measured on screen | Old hotlink asked for |
| --- | --- | --- |
| Grenze Gotisch | 400, 500 | 400, 500, **700** |
| Fraunces | 400 normal, 400 italic, **700 normal** | 400, 600 normal, 400 italic |
| Barlow Semi Condensed | 400, 600, 700 | 400, **500**, 600, 700 |

Two things fell out of that:

- **Grenze 700 and Barlow 500 were being fetched and never used.** Barlow 500
  is gone; Grenze's variable file covers the whole axis anyway.
- **Fraunces 700 was being used and never fetched.** A `<td>` in the ledger
  computes to 700 in Fraunces, and the hotlink only ever loaded 400 and 600, so
  the browser was synthesising a faux bold. The variable file covers
  `100..900`, so that text now renders in the real cut. This got better by
  accident, which is the usual reward for measuring instead of assuming.

## Subsets

**`latin` only.** Every character the game can render was checked against the
Google Fonts subset ranges: nothing in `data.js`, `engine.js`, `state.js`,
`ui.js`, `main.js` or `index.html` needs `latin-ext` or `vietnamese`.

The arrows and ornaments the UI does use — `→` (U+2192), `↔`, `★`, `⛲`, `✕`,
`➔`, `✨` — sit outside *every* subset these three families publish, so they
fell back to a system font under the hotlink too. Nothing changed there.

## Variable vs static

Fraunces and Grenze Gotisch both ship variable versions; Barlow Semi Condensed
does not (Google Fonts has no variable cut of it), so those three are statics.

Fraunces keeps its **optical-size axis**, which is what the old URL was asking
for (`ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400`). `font-optical-sizing`
defaults to `auto`, so the browser drives it off font-size with no extra CSS.
The alternative is fontsource's `wght`-only cut, which drops `opsz` and would
save 66,548 bytes across the pair — worth knowing about, deliberately not taken,
because vendoring should not quietly change how the page renders. Measured
Fraunces sizes on screen run 13.76px to 22.4px, so the axis is doing modest work
rather than none.

Grenze Gotisch's variable file is 42,328 bytes against 33,104 for static 400 +
500. The extra 9 KB buys one file instead of two and no new download the next
time a heading wants a weight that isn't already here.

## Sources and licences

Both licences are **SIL Open Font License 1.1** (<https://openfontlicense.org>),
which permits redistribution of the font files with the work.

- **Fraunces** — Copyright 2020 The Fraunces Project Authors,
  <https://github.com/undercasetype/Fraunces>.
  Files taken from the npm package `@fontsource-variable/fraunces@5.3.0`
  (`files/fraunces-latin-standard-{normal,italic}.woff2`), renamed on the way in.
- **Grenze Gotisch** — Copyright The Grenze Gotisch Project Authors,
  <https://github.com/omnibus-type/Grenze-Gotisch>.
  From `@fontsource-variable/grenze-gotisch@5.3.0`
  (`files/grenze-gotisch-latin-wght-normal.woff2`).
- **Barlow Semi Condensed** — Copyright The Barlow Project Authors,
  <https://github.com/jpt/barlow>.
  From `@fontsource/barlow-semi-condensed@5.x`, already on disk in
  `Tools/board-check/node_modules/` for the offline board render.

`@fontsource` republishes Google Fonts' own builds unchanged; these are the same
bytes the CDN was serving.

## If you need to change a weight

1. Add or change the `@font-face` block at the top of `../../css/style.css` —
   that is the only place these files are referenced.
2. Re-run the measurement before adding a static cut. The script is three lines
   of `getComputedStyle` over `document.querySelectorAll('*')`, filtered to
   elements with their own text node; see the table above for what it produced.
3. `grep -n "fonts.googleapis.com" ../../index.html` must stay at zero hits.
   The smoke suite asserts this (`tests/smoke.mjs`, Section 21).
