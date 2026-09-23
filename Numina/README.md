# Numina

Reference site for the Numina LARP (world of Aeledd, campaign Numina III):
lore from the campaign guide and rules/safety material from the rulebook.

Live at `/Numina/` on greyversusblue.com. Built with Eleventy; the
built output is **committed** because the site is served from this repo
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
| `test/a11y/` | The checks that need a rendered page, in their own `package.json` because they need a browser and the site does not: axe-core over five pages in both themes (`axe.mjs`); the skip link moving focus, a table still computing to `display: table`, `aria-pressed` following the click, `--header-h` matching the header (`layout.mjs`); the packet assembly, the page counter and the offline kit (`packet.mjs`); the search modal, its focus trap and the `?q=` handoff (`search.mjs`); and `html-validate` over every built page, which needs no browser but lives here for the same reason (`html.mjs`) |
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

The accessibility pass needs a browser, so it is a second install and is not in
`npm test`:

```sh
cd test/a11y && npm install && npx playwright install chromium
node axe.mjs      # axe-core, five pages, light and dark
node layout.mjs   # the skip link, the tables, the toggle, --header-h
node packet.mjs   # the packet assembly, the page counter, the offline kit
node search.mjs   # the search modal, the focus trap, the ?q= handoff
node html.mjs     # html-validate over every built page (no browser needed)
```

All five run against the committed build, so `npm run build` first. All five
run in CI on every PR that touches `Numina/**`, and on every push to `main`.

**Every content or template change**: edit `src/`, run `npm run build`, run
`npm test`, commit source + regenerated output together. Builds are
deterministic (no timestamps), so a no-op rebuild produces no diff.

## Search

[Pagefind](https://pagefind.app/) indexes the built HTML into `pagefind/` —
all same-origin static files, no offsite requests at runtime. Only content
inside `<main data-pagefind-body>` is indexed.

Two ways in, and both use Pagefind's Component UI (the custom-element set it has
recommended over the Default UI since 1.5). `/search/` is the page, built from
`pagefind-config`, `-input`, `-summary` and `-results` in `src/search.njk`, and
it reads `?q=` so the header form can hand a term to it. Ctrl+K (Cmd+K on an
Apple platform) or the header button opens the same search in a modal:
`src/js/search-modal.js` fetches the 217 KB bundle the first time one of them is
used and not before, then builds a `pagefind-modal`, whose `<dialog>` is what
traps focus and handles Escape. The header keeps a plain form for a visitor
without JavaScript, and the script is what hides it.

`bundle-path` on `pagefind-config` has to carry the `/Numina/` prefix itself —
pass it through the `url` filter, unlike the `href` and `src` beside it, which
EleventyHtmlBasePlugin already rewrites. Get it wrong and nothing looks broken:
the elements render, the input takes typing, and every search comes back empty
because the index 404'd. `test/a11y/search.mjs` is the check for that.

## Fonts

Vendored woff2 copies in `src/fonts/` (Grenze Gotisch for display, Alegreya
for body — Fontsource v5.3.0, OFL 1.1), same files as the site-wide
`assets/fonts/`; per-project copies are the repo convention.

## Moving to its own domain later

Change `PATH_PREFIX` in `eleventy.config.mjs` to `"/"`, run `npm run build`,
and deploy the generated output. All internal URLs are written root-relative
in source and rewritten at build time, so no content edits are needed.
