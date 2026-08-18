# Numina batch 2 — in-page navigation for long rules pages (audit #8 / E4)

Work in `Projects/Numina/` (Eleventy site, source in `src/`, **built output
is committed** — the deploy serves this repo as-is). Repo convention for
every change: edit `src/`, run `npm run build`, run `npm test`, and commit
source + regenerated output together. Builds are deterministic; a no-op
rebuild produces no diff. Never hand-edit generated files (`index.html`,
`lore/`, `mechanics/`, `search/`, `css/`, `js/`, `fonts/`, `assets/`,
`pagefind/` at the project root).

Full context lives in `numina-audit-2026-08.md` at the repo root (read it if
present).

## The problem

Rules-reference pages are very long — `src/mechanics/core-rules.md` is
~17,800 words on one page — and players need to cite specific rules to each
other (typically pasting links into Discord). Heading ids already exist
(markdown-it-anchor is configured in `eleventy.config.mjs`), but there is no
visible way to discover or copy them, no in-page table of contents, and
anchor jumps land with the target heading hidden under the sticky header.

Keep pages whole — build navigation, don't split chapters.

## Build three things

1. **"On this page" table of contents.** On content pages rendered through
   `src/_includes/layouts/page.njk`, generate a TOC of the page's `h2`s
   (include `h3`s only if it stays scannable — use judgment per the actual
   content; core-rules has many). Generate it at build time from the
   rendered content (an Eleventy filter over the page content, or the
   `eleventy-plugin-toc` approach — your choice, but no client-side JS
   requirement for the basic list). Only render it on pages above a
   sensible length threshold or behind an opt-in frontmatter flag —
   decide which and apply it so all the long mechanics pages get it while
   trivia-length pages (e.g. a stub) don't.
   - Desktop: place it where it doesn't fight the existing left sidebar —
     a bordered block between the `h1` and the content, or a right-hand
     column if the shell layout accommodates it cleanly. Collapsible via
     `<details>` is acceptable and matches existing patterns.
   - Mobile: collapsed by default.
   - Style it inside the site's established design system (parchment/gold/
     green tokens, `--caps` small-caps family, the existing framed-panel
     treatment — see `.card`/`.infobox` in `src/css/main.css`). It should
     look like it was always part of the site.
   - Exclude it from search indexing (`data-pagefind-ignore`) and from
     print output (`src/css/print.css` hides chrome already — follow that
     pattern).

2. **Visible heading permalinks.** Configure markdown-it-anchor to emit a
   copyable anchor affordance on `h2`/`h3` (its `permalink` option) — the
   common pattern: a subtle link marker revealed on hover/focus, always
   visible on touch devices, with an accessible name like "Link to this
   section" rather than a bare symbol. Style it with the existing gold
   ornament color, sized so it never reflows the heading. Make sure it's
   keyboard-focusable and excluded from print.

3. **Anchor landing fix.** Add `scroll-margin-top` (header height + breathing
   room — `--header-h` exists in `main.css`) to heading elements so anchor
   jumps, search sub-results, and glossary term links land with the heading
   visible below the sticky header. Also gate the existing
   `html { scroll-behavior: smooth }` behind
   `@media (prefers-reduced-motion: no-preference)` while you're in there.

## Verify

- `npm run build && npm test` clean; run the build twice to confirm output
  is still deterministic (no diff on the second build).
- Update `test/smoke.mjs` if the TOC or permalinks change assumptions it
  checks (e.g. internal-link resolution now sees `#` anchors — it already
  strips fragments; confirm).
- Screenshot with headless Chromium (Playwright preinstalled; use
  `executablePath: '/opt/pw-browsers/chromium'` or the installed headless
  shell) against a local static server serving the repo root:
  `/Projects/Numina/mechanics/core-rules/` at 1440px and 390px, light and
  dark themes, including one screenshot after navigating to a `#fragment`
  URL to prove the landing position, and one showing the hover state of a
  permalink. Look at the screenshots before calling it done.
- Confirm Pagefind sub-result links (from `/search/`) now land correctly.

## Done means

All of the above verified, committed in logical chunks (source + regenerated
output together). If `main` moves before you push (another Numina session is
running concurrently), merge `origin/main`, resolve source conflicts
normally, and resolve any conflict in generated output by re-running
`npm run build` — never hand-merge generated files. Push your branch and
open a PR with the screenshots' findings summarized and a note on the TOC
threshold/flag decision you made.
