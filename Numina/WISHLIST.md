# Numina — Feature Wishlist

**Status: nothing here has shipped yet. The site is built, deployed and
green — 55 pages, 136,410 words of source markdown, `npm test` passing every
check, CI on every PR touching `Numina/**` — and the August 2026 audit's
engineering and sharing/SEO sections are done while its content and
accessibility sections are not. The first open phase is Phase 1, on Claude
Fable 5.1.** Two prompt
batches ran before this file existed, and their prompt files are retired; the
audit label each item answered is in `HISTORY.md`. Between them: the
new-player rewrite, the
source-book deploy fix, mobile sidebar and map legibility, favicon and Open
Graph and sitemap, the CI job, and the build-time contents with heading
permalinks. What they did not touch is the audit's sections A and B, and that
is where this file starts.

## What it is

A static reference site for the Numina LARP — the world of Aeledd, campaign
Numina III — at `Numina/` in this repo, served at `/Numina/` on
greyversusblue.com. Eleventy 3.1 reads `src/` and writes the built site back
into the project root, and **that output is committed**, because Firebase
Hosting deploys this repo as-is with `public: "."` and no build step of its
own. A content change is therefore a two-part commit: the markdown and the
regenerated HTML together.

It is a *reading* site and nothing else. Fifty markdown pages carry the
campaign guide's lore (sixteen nations, peoples, faiths, realms, travel and
commerce) and the rulebook's mechanics (Accelerant core rules, etiquette and
safety, character building, ten skills pages, crafting, weapon
construction), plus seven hand-written "New to Numina" pages sourced from the
community's Discord rather than the books. Search is self-hosted Pagefind over
the built HTML, and there are zero offsite runtime requests: vendored woff2,
inline-SVG map and ornaments, and a smoke test that fails on an unexpected
host in an `href`.

What it is not: it holds no state, runs no application code beyond a
seventeen-line theme toggle and two inline disclosure one-liners, and knows
nothing about the *structure* of what it publishes. The rulebook's 189 skills
live in 29 markdown tables across nine files, and to the build they are prose
with pipes in it. Nothing can look up a skill, price a build, validate a
prerequisite, or say what changed when the rulebook moved from v3.51 to
v3.52. That is the largest thing missing, and arc one is about it.

## The architecture that is there

Bottom-up, all paths relative to `Numina/`:

- **`src/_data/`** — `site.json` (354 B; its `origin` is the only place the
  deployed origin is written down, so a domain move is a one-line change),
  `nav.json` (2.9 KB of sidebars and landing-page cards by hand — a second
  source of truth for titles and order that the smoke test guards rather than
  fixes), and `timeline.json` (17 dated events in 2 eras — the only
  structured content on the site).
- **`eleventy.config.mjs`** (137 lines) — `PATH_PREFIX = "/Numina/"`, the
  markdown-it-anchor wiring, four filters. `tocData` builds the contents list
  from the *rendered* HTML by matching `<h2|h3 … id="…">`, so it can never
  disagree with the ids anchor emitted. `pageByUrl` exists because Nunjucks
  has no `equalto` test and the `selectattr` chain it replaced rendered
  `collections.all[0]`'s summary on every card.
- **`src/_includes/`** — `base.njk` (45: head, metadata, pre-paint theme
  script, `printable`/`cardsheet` body classes), `page.njk` (22: sidebar,
  crumb, TOC gate, timeline), `nation.njk` (14: the infobox), `sidebar.njk`
  (40), `header.njk` (21), `toc.njk` (29), `timeline.njk` (29), `footer.njk`
  (9), three ornaments — and **`world-map.njk`** (197), the whole cartography
  system: three literal dictionaries (`mapPaths`, `mapLabels`, `mapShorts`,
  16 keys each), a turbulence-displaced coastline, one
  `<a class="map-region">` per nation.
- **`src/css/main.css`** (874) — every token, the parchment texture, ledger
  tables, ornament masks, the map. `print.css` (62): chrome hidden,
  `printable` breaks each `##` onto a fresh sheet, `cardsheet` cancels those
  breaks and shrinks to 7.5pt.
- **`tools/clean.mjs`** (27) deletes eleven generated top-level entries before
  every build, its `GENERATED` list deliberately duplicated in the smoke test.
  **`tools/social-card.mjs`** (109) is outside `npm run build`: it screenshots
  the real `/lore/nations/` page in Playwright so the og:image inherits the
  site's own fonts and map art.
- **`test/smoke.mjs`** (187) — the safety net: source pages have non-empty
  output; internal links and same-page `#fragment`s resolve; offsite hosts
  stay on a five-entry allowlist; Pagefind has at least as many fragments as
  `data-pagefind-body` pages; 16 nations reachable from the nations index;
  timeline `href`s resolve; every font the CSS names exists; canonical + OG +
  twitter card on all 55 pages; the sitemap matches the built pages both
  ways; every content page is in `nav.json`; no unexpected top-level entries.
- **`.github/workflows/numina-ci.yml`** — on PRs touching `Numina/**`:
  `npm ci`, `npm run build`, `git diff --exit-code` against everything except
  `pagefind/`, then `npm test`.

The load-bearing habit is **determinism**: no timestamps, a sitemap
collection sorted rather than left in Eleventy's date order (file dates do
not survive a git clone), and a CI story resting entirely on a second build
producing no diff. The habit that breaks down is **data-not-code**:
`timeline.json` is the only content the build can reason about. Everything
else — 189 skills, 16 nations' frontmatter, every glossary term — is prose or
hand-maintained duplication.

## Conventions a new builder must know

- **A new top-level file in `Numina/` fails `npm test` until it is named.**
  `test/smoke.mjs`'s hygiene check holds an allowlist of everything that may
  sit beside the generated output; this file had to be added to it before CI
  would pass on the pull request that introduced it. Anything else that lands
  at the top level goes in the same list, or in `GENERATED` if the build made
  it.
- **Edit `src/`, run `npm run build`, run `npm test`, commit source and
  regenerated output together.** The deploy serves the repo as-is, so a
  source change without its rebuild ships a site that does not match its
  source. CI fails the PR for exactly this.
- **Never hand-edit the generated tree.** `index.html`, `sitemap.xml`,
  `lore/`, `mechanics/`, `new-to-numina/`, `search/`, `css/`, `js/`, `fonts/`,
  `assets/` and `pagefind/` at the project root are output; `tools/clean.mjs`
  deletes them before every build. Its `GENERATED` list and the smoke test's
  copy must stay identical — a new generated directory means editing both.
- **A new page needs a `nav.json` entry or `npm test` fails.** Nothing else
  picks it up: the sidebars and the landing-page card grids are generated
  from it. Nation pages are the sole exception — they come from a collection.
- **`pagefind/` is excluded from the CI rebuild diff, and only that.** Its
  chunk names are content hashes over a sharding that is not stable across
  machines, so a fresh runner writes the same index under different names.
  The HTML it derives from is covered, and `npm test` checks staleness.
- **Zero offsite runtime requests, enforced.** `OFFSITE_ALLOWED` is five
  hosts: `www.numinalarp.com`, `numina.lorelogic.info`, `discord.gg`,
  `pagefind.app`, and our own `greyversusblue.com` (canonical and OG URLs are
  absolute by spec). A sixth is a decision, not a detail. No CDN, no webfont
  host, no analytics.
- **Internal links are root-relative in source** —
  `[Rues](/lore/nations/rues/)` — and `EleventyHtmlBasePlugin` rewrites them
  to the path prefix at build time. A hand-written `/Numina/…` in source is a
  bug the smoke test misses; an unprefixed `/…` in *output* is one it catches.
- **Don't invent facts, and say where they came from.** Every rules or lore
  claim comes from `rules-2026-v3.51.pdf`, `campaign-book-2025.pdf`, or a
  page already in `src/`. Details that move — prices, dates, registration —
  are linked to, never hardcoded: CONTENT-GUIDE names the "$100 per event"
  that sat on Quick Reference for two years as a verbatim lift from a 2024
  Discord message.
- **Discord-sourced pages carry extra rules**: site voice and no real names
  (staff included), cross-check logs that hold years of superseded answers,
  link rather than duplicate, spoiler-warn in-play material, and omit
  anything you cannot confidently identify as an NPC.
- **The TOC is a heuristic with an override, not a flag.** A page gets one at
  ≥1,200 rendered words *and* ≥4 `h2`/`h3`s; `toc: false` suppresses,
  `toc: true` forces; 32 of 55 pages qualify. Groups wider than
  `TOC_WIDE_GROUP` (8) go multi-column, because Core Rules' "Effects and
  Calls" alone has 55 subsections.
- **The permalink `§` mark is drawn in CSS, on purpose.** Pagefind builds
  sub-result titles from the heading's own text, so a real character in the
  heading surfaces in search as "Vitality §Link to this section"; the
  accessible name comes from `aria-label`.
- **`source-material/**` and `discord-logs/**` are in `firebase.json`'s
  ignore list.** The books are copyrighted and were briefly downloadable from
  the live site; that ignore rule is the only thing keeping them off the web.
- **The test invocation is `npm test` from `Numina/`** (`node test/smoke.mjs`,
  runs from anywhere), against the *committed* build. `npm run build` is
  `clean && eleventy && pagefind`; `npm run serve` is the dev server.
  Node 22+.

## Questions for Devon

- **What is the attribute cost curve?** `skills/attributes-vitality.md` gives
  "Cost to Increase: *Cost of next attribute*" for Prowess, Insight,
  Fortitude and Vitality — circular, and the escalating numbers appear
  nowhere in `src/` or `source-material/markdown/`. A CP calculator cannot be
  written without them. Are they in the PDF's chart and the conversion
  dropped it, or genuinely unpublished?
- **Should the Excellencies chapter be ported at all?**
  `skills/excellencies.md` is 34 words of developer-facing stub and there is
  no `source-material/markdown/skills/excellencies.md` — the one skills
  chapter with no conversion behind it. Meanwhile
  `hidden-excellencies-expressions.md` names 21 hidden ones openly. Withheld
  deliberately, or just unconverted?
- **Do the eight nations with a blank `capital` have one?** Kindaria,
  Merrigor, Mists of Eltiel, Myos Islands, the Principalities of the Reach,
  Rues, T'barris and the Vale of Scyllina are `capital: ""`; five are
  `demonym: ""` (the Five Duchies' entry says outright that it has none). If
  the book does not name them, the infobox should collapse rather than render
  a flag chip over one "See also" row.
- **Is the custom-domain move happening, and when?** README calls it a
  one-line `PATH_PREFIX` change and `site.json`'s `origin` feeds every
  absolute URL — but `test/smoke.mjs` hardcodes both `PREFIX` and `ORIGIN`.
  And does `numinalarp.com` serve HTTPS? `site.json` and
  `quick-reference.md` both link `http://`; batch 1 asked and could not
  verify from its sandbox either.
- **Is a character builder welcome?** The footer says "Unofficial player
  reference", `expressions.md` sends players to NuminaRules@gmail.com to
  confirm a third-Expression build, and Excellency and Expression purchases
  "must be unlocked in-game". A builder that prices a legal-looking character
  staff would reject is worse than none. Phase 3 assumes yes with loud
  caveats; say so before it is built if that is wrong.

## The standing backlog

Open and unclaimed. What a phase below already claims is described there with
its files, not repeated here; add to this list rather than starting a second.

**Claimed, and listed here only so nothing is lost if a phase is dropped**
- Audit §B, all still true: the map's `role="img"`, no skip link,
  `aria-hidden` era headers, `table { display: block }`, light-mode `--gold`
  at ≈3.1:1, no `aria-pressed` on the theme toggle → Phase 4. (~~`scroll-
  margin-top`~~ and ~~motion-gated smooth scroll~~ landed in batch 2.)
- Zero cross-links in ported content; 189 skills unreadable by the build; no
  rulebook version diff → Phases 1–2.
- `excellencies.md`'s live stub, 183-word `history.md`, 17-event timeline,
  635-word glossary → Phase 6. No "come play" path → Phase 5.

**Unclaimed**
- `building-a-character.md` prints "Assign Your Attributes (Steps 8–10)"
  above "Choosing Skills (Steps 1–7)". The book's order, presumably, but it
  reads as a mistake.
- `notable-figures.md` is 27 one-line entries pointing at the pages that
  actually cover those people. Nothing checks that the people it names are
  still named on the pages it points at.
- `world.md` is 397 words for "The World of Aeledd", the first stop off the
  home page's second hero button.
- The four landing pages have no `data-pagefind-body`, so 50 of 55 built
  pages are indexed. Harmless, inconsistent. (Phase 5 fixes it in passing.)
- `firebase.json` sets `no-cache` on `**/sw.js`. No service worker has ever
  existed. (Phase 7 would write one.)
- `hr::before`'s flat patch seams against the textured body around the leaf
  ornament; `--header-h` (5rem) overstates the real header, so sticky
  timeline-era chips float with a gap.
- `tools/social-card.mjs` needs a Playwright the project does not depend on
  and a local server on port 8099, and is documented only in its own header
  comment. Nothing re-runs it when the palette changes.
- CI runs on pull requests only, never on `main`, with no accessibility or
  HTML validation check.

## Arc one — the rules as data

The site publishes a rulebook and understands none of it. Arc one changes
what the site *is*: the skill tables become a data layer, pages and
cross-links are generated off it, and a character builder sits on top — the
thing a player would actually open at an event, and the thing no amount of
further prose substitutes for. The phases are **ranked by impact, and the
order is the recommendation**; each depends on the one before it.

The model convention here: **most phases run on Claude Opus 5.** **Claude
Fable 5.1** is named only where a wrong answer would be silent — the
extraction schema everything downstream inherits, and the CP rules engine.
Content ports, template and CSS work, and test wiring around an existing
pattern are Opus. Every phase names its model and says why in a clause.

A phase is *finished* only when its branch has become a pull request, that
pull request has merged to main with CI green, and the closing report names
the **next open phase's number and its named model** — so whoever runs the
arc next knows which session to open without opening this file.

## Phase 1 — The skill table becomes a record

**Every skill in the game is a row in a markdown table, and nothing in the
build can read a row.**

189 skills in 29 tables in 9 files, in three header shapes, is the whole
mechanical content of Numina — and to Eleventy it is a paragraph with pipes.
This phase turns it into `src/_data/skills.json` via a re-runnable extractor,
with a suite that pins it so a v3.52 bump becomes a reviewable diff instead
of a reread. Nothing user-visible ships; two phases stand on it.

- [ ] **`tools/extract-skills.mjs`.** Parse the skill tables out of
  `src/mechanics/skills/*.md`, keyed by file and by the `###` heading above
  each table (the Domain, Expression, Foundation type or Culture the skills
  belong to). Normalize the three header shapes into one record:
  `{ id, name, group, groupKind, cost, verbal, description, attribute, source }`,
  where `source` is the page URL plus the heading anchor so every record
  links back to the prose it came from.
- [ ] **The costs that aren't numbers.** `Included`, `See Description` and
  blank all appear in the Cost column; `Attribute` carries `1 Fortitude`,
  `N/A`, `This is a Thread Skill`, and prose. Model them explicitly and fail
  the extraction on a shape nobody has decided about, rather than coercing it
  to zero.
- [ ] **The other tables** belong in the same file under their own keys:
  Cultures' 16 research topics, the two attribute charts, and the 21 hidden
  Excellencies and Expressions. Crafting's 96 formula rows are a different
  shape — note them and leave them.
- [ ] **`test/skills.test.mjs`, wired into `npm test`.** Every table row
  appears exactly once in the JSON, every record's `source` anchor exists in
  the built HTML, ids are unique and stable, totals pinned (189 skills, 29
  tables) so a silent drop fails.
- [ ] **A diffable version bump,** documented in CONTENT-GUIDE.md: replace
  the chapter markdown, re-run the extractor, read the JSON diff, then
  rebuild. Sorted keys, no timestamps — CI's rebuild check is unforgiving.

*Leans on:* `src/mechanics/skills/*.md`, `test/smoke.mjs`'s reporting style.
*Build/output:* a committed `src/_data/skills.json` plus its extractor; no
HTML changes, so the built-output diff should be empty. *Model:* **Claude
Fable 5.1** — a schema every later phase inherits, extracted from prose where
a mis-parsed cost is silent and permanent.

## Phase 2 — A page for every skill, and links between them

**CONTENT-GUIDE rule 5 says to cross-link, and 39 ported chapters contain
zero links.**

With `skills.json` in hand the site can generate what nobody wrote by hand: a
deep link per skill, and an automatic first-mention link for every skill,
nation and glossary term in every ported chapter. This is audit A5 — the item
it called "materially improve both navigation and search relevance" — done by
machine rather than by 39 careful passes.

- [ ] **A stable anchor per skill,** derived from the record's id, so
  `/mechanics/skills/domains/#airs-last-stand` pastes into Discord. Keep the
  ids out of Pagefind sub-result titles the way the permalink already does.
- [ ] **A skill index page** listing all 189 by name, group and cost,
  filterable client-side, indexed, and entered in `nav.json` or the smoke
  test fails.
- [ ] **Generated cross-links.** A build-time filter linking the first
  mention of each glossary term, nation and skill name in a page's rendered
  body to its canonical page. First mention only, never inside a heading, a
  table header, an existing link or a code span, never self-linking. The term
  list comes from `skills.json`, `collections.nations` and the glossary's own
  `##` headings, so it maintains itself — with an explicit `_data` exclusion
  list for terms too ambiguous to autolink ("Garb" is a Culture skill, an
  Expression skill and an ordinary noun; "Rues" is a nation and a verb), one
  comment per entry naming the collision it avoids.
- [ ] **Fill the infoboxes, or collapse them.** `capital`/`demonym` from the
  book where named (see Questions), and `nation.njk` rendering no infobox at
  all when it would carry only the "See also" row — 8 nations today get a
  flag chip and nothing else.
- [ ] **Extend the smoke test:** no page links to itself, and the autolinker
  is idempotent over already-linked HTML.

*Leans on:* Phase 1's `skills.json`, `eleventy.config.mjs`'s filters,
`test/smoke.mjs`'s link resolver. *Build/output:* every ported chapter's
committed HTML changes — expect a large, mostly mechanical diff, and review
the linker's summary rather than the diff. *Model:* **Claude Opus 5** —
template and filter work over a schema that already exists.

## Phase 3 — The character builder

**Fifty CP, ten numbered steps, a hard cap of three Excellencies, an
escalating cost curve, and every player doing the arithmetic on paper.**

`building-a-character.md` lays out ten steps and a cost structure — first
Excellency 5 CP with each subsequent one a CP dearer, Expressions likewise,
up to three Aspect skills, two Foundation and two Culture skills, attributes
capped at 10 and Vitality at 7 — then asks the player to do the arithmetic on
paper. With `skills.json` it becomes a page: client-side, same-origin,
dependency-free like everything else here, and loudly unofficial.

- [ ] **`src/js/build-rules.js`, pure, with its suite.** A build in, a
  verdict out: CP spent and remaining, which selections are legal, which
  prerequisites are unmet, which caps are hit. No DOM. The cost curve lives
  here — and the phase is blocked on the attribute numbers (see Questions)
  and must refuse to guess them.
- [ ] **The picker,** in the book's own step order: Aspects, Foundation,
  Culture, Domain, Excellencies, Expressions, Open Skills, then attributes
  and Vitality. Each step lists exactly what `skills.json` says that choice
  unlocks, with cost, verbal and description inline and a link to the anchor.
- [ ] **Say what is provisional.** Excellency and Expression purchases "must
  be unlocked in-game", hidden ones need staff approval, a third Expression
  requires emailing staff. Part of the verdict, not fine print.
- [ ] **Persist and share.** `localStorage` under a `numina.` key (matching
  `numina.theme`), plus the build encoded in the URL fragment so a player can
  paste it to a friend or staff. No server, no account.
- [ ] **A printable character card** on the existing `cardsheet` print
  treatment: chosen skills with verbals and attribute costs, attributes,
  Vitality, CP total. One sheet carried to the event — the feature that
  justifies the phase.
- [ ] **Suite and smoke.** Every cap, every escalating cost, every "Included"
  skill priced at zero, one known-good 50 CP build costed to the CP; plus a
  smoke check that the builder's data matches `skills.json`.

*Leans on:* Phase 1's `skills.json`, `building-a-character.md`,
`attributes-vitality.md`, `print.css`'s `cardsheet` mode. *Build/output:* one
page and a JS module in the committed build; per-player state lives in
`localStorage` and the URL fragment, never in the repo. *Model:* **Claude
Fable 5.1** — a rules engine where a mispriced build looks perfectly correct
and is wrong at the character-approval desk.

## Arc two — the finishing pass

Arc one builds something new; arc two finishes what is here. Every phase is
already specified: the audit wrote most of the fixes as one-line diffs, the
two batches established the pattern for doing them, and CONTENT-GUIDE says
how the content ports must read. Same ranking rule, same model convention,
same definition of finished. Arc two can run before, after or alongside arc
one — only Phase 8's related-links task waits on arc one.

## Phase 4 — The accessibility and mobile pass

**The map is the site's best feature and a screen reader cannot see any of
it.**

Audit section B is seven findings, six written as one-line fixes; two shipped
in batch 2 and the rest are untouched. The map is the headline: `role="img"`
flattens its subtree, so all 16 nation links inside it are unreachable — and
the home page has no card grid beside it to fall back to.

- [ ] **Expose the map.** `world-map.njk:62` to `role="group"`, keeping the
  existing `aria-label`, so the `<a class="map-region">` children stay in the
  accessibility tree and each region's `<title>` names its link.
- [ ] **Skip link.** "Skip to content" as the first focusable thing in
  `base.njk`, targeting `<main>`, visually hidden until focused. Check the
  home page and both index templates, not just `page.njk`.
- [ ] **Tables keep their semantics.** Replace `main.css:237`'s
  `table { display: block }` with a `div.table-scroll { overflow-x: auto }`
  wrapper (a markdown-it rule, or a post-render filter beside `tocData`), and
  confirm `print.css`'s table overrides still apply.
- [ ] **Timeline eras and the theme toggle.** Drop `aria-hidden` from
  `.timeline__era` and promote it to a heading; add `aria-pressed` to
  `.theme-toggle` and keep it in sync in `theme.js`.
- [ ] **Gold that passes AA.** Darken light-mode `--gold` for text uses (or
  split a `--gold-text` token) until `.hero__kicker` and `.crumb` clear 4.5:1
  on `--paper`, without touching the ornament and map golds. Fix the two
  visual nits while in there: `hr::before`'s seam and `--header-h`'s gap.
- [ ] **axe in CI,** over home, a nation, Core Rules and the search page,
  failing the build. This is the task that stops section B coming back.

*Leans on:* `world-map.njk`, `base.njk`, `main.css`, `timeline.njk`,
`theme.js`, `numina-ci.yml`. *Build/output:* every page's committed HTML
changes (skip link, table wrappers); no data changes. *Model:* **Claude
Opus 5** — CSS and template work the audit specified line by line.

## Phase 5 — Come play

**A stranger can read 136,000 words about Aeledd and never learn that Numina
is a real thing you can attend.**

The two official links live in footer fine print, the registration host only
inside FAQ and Quick Reference prose, and the home page opens with "Numina
III · The Age of Works" — wonderful for a returning player, opaque to someone
arriving from a search result. Audit A2 and A7, plus D4's `http://`.

- [ ] **One sentence under the tagline** in `src/index.njk`'s hero: what a
  LARP is, and that this one meets in person.
- [ ] **A "Come play" partial** pointing at `site.official.website` for dates
  and pricing, `discord.gg` for questions and `numina.lorelogic.info` for
  registration, on the home page, the New to Numina landing page and the foot
  of `mechanics/new-players.md`. Put the registration host in `site.json` so
  it stops living in three prose paragraphs. No dates, no prices, no
  registration mechanics in the markup — CONTENT-GUIDE's rule, and the reason
  it exists is on record.
- [ ] **Fix the scheme.** `site.json` and `quick-reference.md` both link
  `http://www.numinalarp.com`. Check HTTPS, upgrade if it answers, leave a
  comment saying why if it does not.
- [ ] **Index the landing pages.** The four have no `data-pagefind-body`, so
  a search for "join" or "NPC" cannot surface the page that answers it.
  Adding it takes the index from 50 pages to 54 — the search page itself
  stays out — and the smoke test's freshness check follows automatically.

*Leans on:* `src/index.njk`, `src/_data/site.json`, `new-to-numina/index.njk`,
`mechanics/new-players.md`. *Build/output:* committed HTML wherever the block
lands, plus a `site.json` key. *Model:* **Claude Opus 5** — copy and template
wiring against links that already exist.

## Phase 6 — Excellencies, history, and the timeline

**A sidebar link on every skills page leads to 34 words telling the reader to
consult CONTENT-GUIDE.md.**

Four thin spots, all named in audit A3 and A6, all content work under rules
the guide already states. Excellencies is the urgent one: linked from the
sidebar and every skills page, present in the search index, and addressed to
a developer.

- [ ] **Port Excellencies** — the one skills chapter with no
  `source-material/markdown/` conversion behind it, so it comes out of
  `rules-2026-v3.51.pdf` directly. Match `domains.md` and `expressions.md`
  exactly (`###` per Excellency, then the five-column table) so Phase 1's
  extractor takes it with no special case. If it is withheld instead (see
  Questions), replace the stub with a player-facing note naming the rulebook
  section and drop it from the search index.
- [ ] **`history.md`** is 183 words for "A Brief History" of a world with
  sixteen nations and a broken Lattice. Extend from the campaign book's own
  history chapter, cross-link the nations and eras it names, leave the dated
  events to the timeline.
- [ ] **The timeline.** 17 events in 2 eras, which the guide invites
  extending. Add events from the book's Historical Timeline with `nations`
  slugs and `href`s so the dots color and "Read more" resolves — the smoke
  test checks every `href` against a built page.
- [ ] **The glossary earns its job.** 635 words for the site's designated
  cross-link hub, and Phase 2's autolinker is only as good as its term list.
  Add the terms the rules chapters use and it lacks.

*Leans on:* `source-material/rules-2026-v3.51.pdf`, `campaign-book-2025.pdf`,
`_data/timeline.json`, and CONTENT-GUIDE's provenance and spoiler rules —
read them before the first paragraph, not after.
*Build/output:* new committed pages and an extended `timeline.json`; if
Phase 1 has landed, re-run the extractor and expect `skills.json` to grow.
*Model:* **Claude Opus 5** — porting to a format the guide specifies and six
sibling chapters demonstrate.

## Phase 7 — The print packet and the offline kit

**The rules exist as six printable pages, and an event is a weekend in a
field with no signal.**

`print.css` already does per-chapter page breaks (`printable`) and a dense
carried card (`cardsheet`), and six pages use them. What it cannot do is
combine: a player wanting Core Rules plus Combat Reference plus their own
Domain prints three times and staples. And `firebase.json` has set `no-cache`
on `**/sw.js` since batch 1, for a service worker that never existed.

- [ ] **A packet builder page.** Tick the chapters you want, get one
  paginated document with a cover, a combined contents and continuous page
  numbering — client-side, assembled from the already-built HTML.
- [ ] **Three prebuilt packets:** a New Player Kit (new-players, day in the
  life, what to pack, etiquette and safety), the Combat Card (the existing
  cardsheet, unchanged), and an NPC packet — each one link a staffer can send.
- [ ] **A service worker** precaching every page, both stylesheets, the five
  woff2 files and the Pagefind bundle, so the site works in a field. The
  version string must derive from the build and be deterministic, or CI's
  rebuild check fails on it.
- [ ] **Say when it is stale.** An offline banner naming the cached build,
  and an update path that does not require knowing what a service worker is.
- [ ] **Extend `clean.mjs` and `smoke.mjs` together.** `sw.js` becomes a
  generated top-level entry, so it goes in `GENERATED` *and* the hygiene list;
  both deliberate copies must move. Pin the precache manifest against the
  built pages so a page added later cannot be left out of the kit.

*Leans on:* `print.css`, `tools/clean.mjs`, `test/smoke.mjs`,
`firebase.json`'s `sw.js` header. *Build/output:* a generated `sw.js` and a
packet page; the precache manifest must be sorted so two builds still produce
no diff. *Model:* **Claude Opus 5** — assembly over existing CSS modes, with
determinism as the only sharp edge.

## Phase 8 — Search and navigation, upgraded

**Search is a page you navigate to, and the site knows nothing about what is
related to what.**

Pagefind 1.5 ships a Component UI its own docs recommend over the classic
`pagefind-ui.js` the search page loads — better accessibility, a keyboard
modal. And once `skills.json` exists the site can answer "what else should I
read" without anyone hand-maintaining a list.

- [ ] **Component UI.** Replace the `new PagefindUI({…})` call in
  `search.njk`, keeping the `?q=` handoff, sub-results and the `<noscript>`
  fallback. Vendored under `pagefind/`; the offsite allowlist must not grow.
- [ ] **A search modal** on `/` and `Ctrl+K` from any page, focus-trapped,
  escape to close, with the header form still working with JS off.
- [ ] **Related links from the data.** A "See also" block generated from
  `skills.json` and the nations collection — a Domain links its Excellencies,
  a nation its culture skills and timeline events, an event its nations. Not
  hand-written, or it drifts.
- [ ] **Derive the sidebar, or keep guarding it.** `nav.json` duplicates
  titles and order that frontmatter already carries. Either generate the
  sidebar from collections and delete the file, or leave the smoke-test guard
  and write down that the duplication is deliberate. Not both.
- [ ] **CI on `main` too, and HTML validation.** `numina-ci.yml` runs on pull
  requests only, so a direct push to `main` is unchecked. Add `push: main`
  and an HTML validity check beside Phase 4's axe run.

*Leans on:* `src/search.njk`, `pagefind/`, `_data/nav.json`, Phase 1's
`skills.json`, `numina-ci.yml`. *Build/output:* a new vendored Pagefind
bundle plus committed HTML wherever a "See also" lands; if the sidebar is
derived, `nav.json` leaves `src/_data/` and the smoke test with it. *Model:*
**Claude Opus 5** — one search component for another, and links generated
from a schema that already exists.

## What this leaves for a later arc

- **A rulebook version-diff report.** Phase 1 makes v3.51 → v3.52 diffable;
  nothing renders that diff as a page players can read, and "what changed at
  the start of the season" is a good question.
- **The map as real geography.** The figcaption says "placeholder geography"
  and means it. Sixteen hand-authored region paths against an actual campaign
  map is a project, not a task.
- **Crafting as data.** Roughly a hundred rows of formulas and Machina in
  `crafting.md`, a different shape from the skill tables, and the natural input to a crafting
  planner the way `skills.json` is to the builder.
- **A public plot log.** The Discord holds years of campaign events, and
  CONTENT-GUIDE's spoiler and provenance rules exist because somebody already
  thought carefully about publishing them.
- **The custom-domain move.** README says one line. It is one line plus the
  smoke test's two hardcoded constants, the sitemap origin and every absolute
  OG URL — cheap, not free, and best done deliberately.
