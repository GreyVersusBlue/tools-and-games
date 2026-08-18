# Numina site audit — August 2026

Scope: `Projects/Numina/` — source (`src/`), templates, CSS/JS, built output,
search, tests, deploy config, and the rendered site (desktop + mobile,
light + dark themes, via headless Chromium against the committed build).
Audience considered: prospective players evaluating Numina, and current
players looking up rules/lore. Lore text itself was out of scope by request.

## What's working well

- **Engineering hygiene is genuinely good.** Deterministic committed builds
  (a no-op rebuild produces no diff — verified), a clean-before-build
  manifest, and a smoke test that checks built pages, internal links,
  offsite-host allowlist, search freshness, fonts, and output hygiene.
- **No offsite runtime dependencies**: vendored fonts, self-hosted Pagefind,
  inline SVG ornament/map system. Fast, private, and resilient.
- **Dark theme done right**: pre-paint inline script (no flash), respects
  `prefers-color-scheme`, explicit toggle persisted to localStorage.
- **Print stylesheet** with page-break control on the printable rules packet
  pages is a thoughtful touch few reference sites have.
- **Search works well**, including the header form's `?q=` handoff into
  Pagefind, sub-result anchors, and a `<noscript>` fallback.
- The **visual identity is cohesive** — the ornament family, ledger tables,
  drop caps, and the map cartouche/compass read as one designed system, and
  the map's "placeholder geography" disclosure is honest.

---

## A. Content for the target audience (highest impact)

**A1. "New Players Start Here" doesn't deliver what it promises.**
It is the primary hero CTA and the single most important page for the
prospective-player demographic, but it's 172 words: a CP-budget note and a
"see the campaign book" paragraph. Its own summary promises "what a LARP
event is like, what you need, and how to join your first game" — none of
which is on the page. Even without inventing lore, it could cover: what a
LARP weekend looks like, what to bring/borrow, costume expectations, how
NPCing works as a low-cost first taste, and a link to registration.

**A2. There is no path to actually joining.**
Nowhere on the site says when or where events run, what they cost, or how to
register. The official-site and Discord links exist only in the footer fine
print. A small "Come play" call-out (home page and/or new-players page)
pointing at numinalarp.com's schedule/signup and the Discord would convert
interested readers into players.

**A3. The Excellencies page is a live stub.**
`/mechanics/skills/excellencies/` is linked from the sidebar and every
skills page, renders "Stub page. The matching rulebook chapter goes here —
see the porting format in CONTENT-GUIDE.md", and is indexed by search. The
message is developer-facing; players just see a broken promise. Until the
chapter is ported, either unlink it or replace the stub text with a
player-facing note ("Not yet converted — see the rulebook PDF, §…").

**A4. Nation infoboxes are mostly empty.**
8 of 16 nations have no `capital`, 5 no `demonym`, so the infobox renders as
just a flag chip and "See also: All nations" (verified on Rues) — it reads
as vestigial. Fill the fields from the book where named, and collapse the
infobox entirely when it has no data rows.

**A5. Zero cross-links in the ported content.**
CONTENT-GUIDE rule 5 (cross-link nations, skills, glossary terms) is unused:
no body page contains a single internal link; only the glossary (21 links
outward) does. Rules text that mentions Vitality, the Lattice, or a nation
never links to it. Even a light first pass (nation names in lore pages,
glossary terms on first mention in mechanics) would materially improve both
navigation and search relevance.

**A6. Thin pages.** `history.md` is 183 words of prose plus a 17-event
timeline the guide itself says to extend; the glossary is 635 words. Both
are load-bearing for lore-seeking players.

**A7. The home page assumes context.** "Numina III · The Age of Works" and
Fortune's Bend are great flavor, but a total newcomer landing from a search
gets no one-liner saying what a LARP is or that this is a real-world game
you can attend in person. One sentence under the tagline would do it.

## B. Accessibility

**B1. The nation map is invisible to screen readers.**
The SVG has `role="img"`, which flattens its entire subtree for assistive
tech — including the 16 `<a class="map-region">` nation links inside it.
Screen-reader users can't perceive or (in most AT) reach those links. Use
`role="group"` with the existing `aria-label` (or drop the role and label
via `<title>`/`aria-labelledby`) so the links stay exposed. The card grid
below is a mitigating fallback on `/lore/nations/`, but the home-page map
has no adjacent equivalent.

**B2. No skip link.** Keyboard users tab through the header plus up to ~27
sidebar links (9 lore + 16 nations, or 15 mechanics) on every page before
reaching content. Add a "Skip to content" link targeting `<main>`.

**B3. Anchor targets hide under the sticky header.** There's no
`scroll-margin-top` anywhere, so search sub-result links (`#vitality` etc.),
glossary term anchors, and any hand-shared heading link land with the
heading beneath the sticky header. One rule fixes it:
`h1,h2,h3,h4 { scroll-margin-top: calc(var(--header-h) + 1rem); }`.

**B4. Timeline era headers are `aria-hidden`.** "Before the Age of Works"
etc. are real grouping content, but screen-reader users get an undifferen-
tiated list of events. Expose them (they'd also serve better as headings
than `<p>`s).

**B5. `table { display: block }` destroys table semantics.** Mechanics is
the most table-heavy content on the site; `display: block` makes AT stop
announcing row/column relationships. Wrap tables in a `div.table-scroll
{ overflow-x: auto }` (Eleventy/markdown-it can do this with a small rule or
the tables can keep `display: table` inside the wrapper).

**B6. Small gold text is low-contrast in light mode.** `--gold` (#a17c2a)
on `--paper` (#f0e6cd) is ≈3.1:1 — below the 4.5:1 AA threshold at the
sizes used (`.hero__kicker`, `.crumb` label, gold figcaption accents).
Darkening light-mode `--gold` for text uses (or reserving gold for
decorative marks) would fix it without touching the ornament system.

**B7. Theme toggle announces no state.** The button has a static label and
a static "◐" glyph; add `aria-pressed` (or swap the label between "Switch to
dark/light theme").

**B8. Smooth scrolling isn't motion-gated.** Wrap
`html { scroll-behavior: smooth }` in
`@media (prefers-reduced-motion: no-preference)`.

## C. Mobile & design

**C1. The open sidebar pushes content a full screen down on mobile.**
On a phone, every content page starts with the fully expanded section nav
(verified: on Core Rules the `<h1>` sits below the fold). Readers land on
navigation, not the page they tapped. Options: render the disclosure closed
by default at narrow widths (tiny inline script or a `<details>` without
`open` + CSS `details:not([open])` override on desktop), or grid-order the
sidebar after `<main>` on mobile.

**C2. Map labels are unreadable on phones.** 18px text in a 1000-unit
viewBox renders ≈6–7px at 390px width. Since the SVG is inline, CSS can fix
it: bump `.map-region text` size (and hide the decor layer) under a
`max-width` media query — or hide labels on small screens and lean on the
card grid, which already duplicates the links.

**C3. Minor visual nits.** The `hr::before` flat-color patch sits on the
textured body background, producing a faint rectangular seam around the leaf
ornament; `--header-h` (5rem) is taller than the real header, so sticky
timeline-era chips float with a visible gap below the header.

## D. Sharing & SEO

**D1. No favicon** — generic tab icon plus a 404 for `/favicon.ico`. The
leaf ornament (already a data-URI mask) would make a fitting SVG favicon.

**D2. No Open Graph / Twitter card metadata.** LARP communities live on
Discord and Facebook; right now a shared link renders bare. `og:title`,
`og:description` (the per-page `summary` is already there), `og:type`, and
one `og:image` (the map or hero arch would be a beautiful card) would make
every share an advertisement for the game.

**D3. No `sitemap.xml`, `robots.txt`, or canonical URLs.** For "players
searching for information", a sitemap (Eleventy generates one in ~10 lines)
plus canonicals is cheap discoverability. Worth doing before the planned
custom-domain move so nothing needs re-plumbing.

**D4. Footer official-site link is `http://`** (`site.json`). If
numinalarp.com serves HTTPS, upgrade the scheme (couldn't verify from this
sandbox's network).

## E. Technical / repo

**E1. The source books are deployed publicly.** Firebase hosting deploys
the repo with `public: "."` and only ignores dotfiles/node_modules — so
`campaign-book-2025.pdf`, `rules-2026-v3.51.pdf`, and the raw
`source-material/markdown/` conversions are all downloadable from the live
site. The footer says "Content © Zyz Adventures, LLC" — distributing the
full books is probably unintended (and distinct from quoting them in site
pages). Add `**/source-material/**` to `firebase.json`'s ignore list, and
consider whether the PDFs belong in the repo at all if it's public.

**E2. Smoke tests never run in CI.** The PR workflow deploys a preview but
nothing runs `npm test`, so a commit with stale/broken committed output
merges silently — the exact failure mode the tests were written to catch.
A small job (`npm ci && npm test` in `Projects/Numina`) on PRs would close
the loop; add `npm run build && git diff --exit-code` to also catch
"forgot to rebuild".

**E3. `nav.json` is a second source of truth.** Titles and order live in
both frontmatter (`title`, `order`) and `src/_data/nav.json`. A new page
added to `src/` but not `nav.json` builds fine, passes the smoke test, and
is simply unreachable except by search. Either derive the sidebar from
collections (order/frontmatter already exist) or add a smoke check that
every built content page appears in `nav.json`.

**E4. Long rules pages have no in-page navigation.** Core Rules is ~17,800
words on one page. Heading ids already exist (markdown-it-anchor), but
there's no "On this page" TOC and no visible anchor/permalink affordance —
players can't easily deep-link a rule into Discord. A generated TOC on pages
above a size threshold plus hover ¶ links would be the single biggest
usability win for current players. (Splitting Core Rules into chapters is
the larger alternative.)

**E5. 404s strand Numina visitors.** A broken `/Projects/Numina/...` URL
serves the root greyversusblue 404 page, which has no Numina styling or link
back. Firebase supports one `404.html` per site — add a "Looking for
Numina? → /Projects/Numina/" line to it.

**E6. Small cleanups.**
- `eleventy.config.mjs`: `amendLibrary("md", () => {})` is a no-op leftover.
- `firebase.json` sets no cache headers; long-cache for `/pagefind/`
  fragments (content-hashed names) and fonts would speed repeat visits.
- Pagefind 1.5 recommends its new Component UI over `pagefind-ui.js` for new
  integrations (better accessibility, search modal) — optional upgrade.
- Landing pages (`/lore/`, `/mechanics/`, home) aren't in the search index
  (no `data-pagefind-body`) while `/lore/nations/` is — harmless but
  inconsistent.

---

## Suggested priority

1. **A1 + A2** — make the new-player funnel real (content + join links).
2. **B1–B3** — map exposed to AT, skip link, `scroll-margin-top` (three
   small template/CSS changes).
3. **E1** — stop deploying the source books.
4. **C1 + C2** — mobile sidebar and map legibility.
5. **D1–D3** — favicon, OG tags, sitemap (biggest reach-per-line-of-code).
6. **A3–A6** — stub, infobox data, cross-links, thin pages (steady content
   work, aided by CONTENT-GUIDE as-is).
7. **E2–E4** — CI test run, nav single-source, long-page TOC.
