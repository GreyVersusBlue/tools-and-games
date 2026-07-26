# board-check

Dev-only tooling. Nothing in here is linked from the board, and none of it runs
in a visitor's browser. It exists so a session can actually *render* the site
instead of reasoning about CSS and hoping.

```
npm install          # also vendors three.js 0.160.0 and 0.169.0
npm run check        # integrity sweep + collision guard, both exit non-zero on failure
npm run shoot        # writes reviewable PNGs to ./shots/
```

## Why this is not Playwright

Playwright and Puppeteer both download their browser from a CDN at install
time, and those CDNs are unreachable from some sandboxes. `@sparticuz/chromium`
ships the Chromium binary *inside the npm tarball*, so `npm install` is
sufficient. `puppeteer-core` then drives it. If you are on a normal machine with
network access, regular Playwright is nicer; this exists for the constrained
case.

## The two shims

`harness.mjs` intercepts requests so a render is the real thing and not a
degraded approximation:

- **`fonts.googleapis.com/css2?...`** is answered with an `@font-face` sheet
  built from local `@fontsource` packages. Without this, every heading falls
  back to a system serif and any measurement of text width is fiction. The
  resolver maps a family name to its package (`Zilla Slab` to `zilla-slab`) and
  picks the nearest available weight, so adding a font to a project page usually
  just means `npm i @fontsource/<name>`.
- **`cdn.jsdelivr.net/npm/three@<ver>/...`** is rewritten to a vendored copy.

Anything else offsite is refused and recorded in `page.__blocked`, which is how
you find out what the site actually depends on at runtime. Currently that is
three.js from jsdelivr (Aphelion, Castle Conundrum, The Fourth Quarter) and
textures from `dl.polyhaven.org` (Golden Hour, Castle Conundrum). Golden Hour
already vendors three.js locally in `libs/`; the others do not.

## The scripts

### `check-integrity.mjs`

Parses every `.js`/`.mjs`, every inline `<script>`, and every `.json` on the
site. Exits 1 on any failure.

This is here because `Castle Conundrum/src/npc.js` contained JSON instead of
JavaScript, which meant `main.js` could not `import { NPC }` and the game hung
on its loading screen. It went unnoticed because the previous check verified
that files *resolved*, not that they *parsed*. Resolving is not enough.

### `check-collisions.mjs`

The pin, the genre ribbon and the NEW POSTING flag all occupy the top ~22px of a
quest card, and the eyebrow is centred text that grows toward both corners as
the string lengthens. Version 2 had 10 real overlaps across nine viewport
widths. Version 3 reserves a band with `#quest-board .notice { padding-top:
2.15rem }`.

The measurement is **true 2D rectangle intersection** against the eyebrow's
actual glyph run, obtained with a `Range` rather than the block box. Horizontal
proximity is not a collision. Measuring only the horizontal axis produced a
much scarier and entirely wrong number once already, so do not simplify it back.

### `shoot-board.mjs`

Renders the states that are impossible to check by reading source: each
breakpoint, the four `data-new` cards together, the ledger filter active, the
suite cross-link lit, Town Services, JS disabled, and the 404 as served from a
subpath. Output lands in `./shots/`.

It also reports whether any `.unfurl` elements attached. Zero means no preview
JPEGs exist yet, which is currently expected.

### `capture-previews.mjs`

**Unfinished.** Loads all seven projects and screenshots them, but the per-game
`drive` steps are guesses and several produce idle opening frames rather than
gameplay. Read the header comment before using it. Output goes to
`./candidates/` and should never be promoted to `assets/previews/` sight unseen.

## Adding a check

Keep the pattern: measure something a person would otherwise have to eyeball,
print the number, and exit non-zero. A check that only prints is a check that
gets ignored.
