# Numina

Reference site for the Numina LARP (world of Aeledd, campaign Numina III):
lore from the campaign guide and rules/safety material from the rulebook.

Live at `/Numina/` on greyversusblue.com. Built with Eleventy; the
built output is **committed** because Firebase Hosting deploys this repo
as-is with no CI build step.

## Layout

| Path | What it is |
| --- | --- |
| `src/` | Eleventy source — all content lives here as markdown |
| `source-material/` | The original campaign book + rulebook PDFs |
| `tools/clean.mjs` | Deletes generated output before a rebuild |
| `test/smoke.mjs` | Build/link/search smoke checks (`npm test`) |
| `tools/extract-skills.mjs` | Writes `src/_data/skills.json` from the skill tables in `src/mechanics/skills/` (re-run after editing a table; see CONTENT-GUIDE) |
| `test/skills.test.mjs` | Pins `skills.json` to the source tables and the built anchors (also `npm test`) |
| `src/js/build-rules.js` | The character builder's arithmetic — a build in, a verdict out. Pure: no DOM, runs under Node and in the page |
| `test/build-rules.test.mjs` | Every cap, every escalating cost, one 50 CP build costed to the CP, and the two refusals (also `npm test`) |
| `src/js/build-view.js`, `src/js/build-state.js`, `src/js/builder.js` | The character builder page: the steps and verdict as HTML strings, the `localStorage` record and URL fragment, and the one file that touches the DOM |
| `test/builder.test.mjs` | The fragment and save round-trip, each step lists what `offered()` offers, the verdict says "at least" when a purchase is unpriced, the card prints every skill with its verbal and a CP line that is never a total when a purchase is unpriced, `print.css` hides the form and not the card, and the built page's JSON islands resolve (also `npm test`) |
| `index.html`, `lore/`, `mechanics/`, `search/`, `css/`, `js/`, `fonts/`, `assets/`, `pagefind/` | Generated — never edit by hand |
| `CONTENT-GUIDE.md` | How to port book chapters into `src/` |

## Working on it

Requires Node 22+.

```sh
npm install
npm run serve   # local dev server with live reload
npm run build   # clean + eleventy + pagefind search index
npm test        # smoke checks against the built output, then skills.json, build-rules, the builder page
```

**Every content or template change**: edit `src/`, run `npm run build`, run
`npm test`, commit source + regenerated output together. Builds are
deterministic (no timestamps), so a no-op rebuild produces no diff.

## Search

[Pagefind](https://pagefind.app/) indexes the built HTML into `pagefind/` —
all same-origin static files, no offsite requests at runtime. Only content
inside `<main data-pagefind-body>` is indexed.

## Fonts

Vendored woff2 copies in `src/fonts/` (Grenze Gotisch for display, Alegreya
for body — Fontsource v5.3.0, OFL 1.1), same files as the site-wide
`assets/fonts/`; per-project copies are the repo convention.

## Moving to its own domain later

Change `PATH_PREFIX` in `eleventy.config.mjs` to `"/"`, run `npm run build`,
and deploy the generated output. All internal URLs are written root-relative
in source and rewritten at build time, so no content edits are needed.
