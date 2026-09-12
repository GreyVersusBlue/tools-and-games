# Numina — Feature Wishlist

**Status: Phases 5 and 6 shipped on 2026-09-12; the first open phase is
Phase 7 — The print packet and the offline kit, on Claude Opus 5, a
one-session row.** The site is built, deployed and green — 57 pages, 394
assertions in `npm test` and 32 more in `test/a11y/`'s browser suite, CI on
every PR touching `Numina/**` in two jobs — and the
August 2026 audit's engineering, sharing/SEO, A5 cross-linking, all of section
B, and A2, A3, A6 and A7 are done. `src/_data/skills.json` holds **428 skills
in 59 tables** — the Excellencies chapter went in whole in Phase 6, 30 of them
and 239 skills, straight out of the PDF because nothing had ever converted it
— and `test/skills.test.mjs` pins it. Two build transforms read it: every
skill row has an anchor, and the first mention of every glossary term, nation
and skill name in a chapter links to its page. Two prompt batches ran before
this file existed, and their prompt files are retired; the audit label each
item answered is in `HISTORY.md`. What is left of the audit's content section
is A1, A4 and A8, which Phases 7 and 8 carry.

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
nothing about the *structure* of what it publishes. The rulebook's 428 skills
live in 59 markdown tables across ten files, and to the build they are prose
with pipes in it. Nothing can look up a skill, price a build, validate a
prerequisite, or say what changed when the rulebook moved from v3.51 to
v3.52. That is the largest thing missing, and arc one is about it.

## The architecture that is there

Bottom-up, all paths relative to `Numina/`:

- **`src/_data/`** — `site.json` (354 B; its `origin` is the only place the
  deployed origin is written down, so a domain move is a one-line change),
  `nav.json` (sidebars and landing-page cards by hand — a second
  source of truth for titles and order that the smoke test guards rather than
  fixes), `timeline.json` (18 dated events in 2 eras, every row of the book's
  Historical Timeline), `skills.json`
  (generated; see CONTENT-GUIDE) and `autolink.json` (the terms the
  cross-linker must not link, each with the collision it avoids).
- **`eleventy.config.mjs`** (221 lines) — `PATH_PREFIX = "/Numina/"`, the
  markdown-it-anchor wiring, five filters, and the two transforms of Phase 2
  (`skillAnchors` and `autolink`, both scoped to `<main>` and both running
  after `EleventyHtmlBasePlugin`, so both emit prefixed URLs). `tocData` builds the contents list
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
  twitter card on all 57 pages; the sitemap matches the built pages both
  ways; every content page is in `nav.json`; no unexpected top-level entries.
- **`.github/workflows/numina-ci.yml`** — on PRs touching `Numina/**`:
  `npm ci`, `npm run build`, `git diff --exit-code` against everything except
  `pagefind/`, then `npm test`.

The load-bearing habit is **determinism**: no timestamps, a sitemap
collection sorted rather than left in Eleventy's date order (file dates do
not survive a git clone), and a CI story resting entirely on a second build
producing no diff. The habit that breaks down is **data-not-code**:
`timeline.json` is the only content the build can reason about. Everything
else — 428 skills, 16 nations' frontmatter, every glossary term — is prose or
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
- ~~**Should the Excellencies chapter be ported at all?**~~ **Answered by
  Phase 6, 2026-09-12: just unconverted, and it is ported now** (locked #318).
  The chapter is 16 pages of `rules-2026-v3.51.pdf`, printed in full with 30
  Excellencies and 239 skills in the same five-column tables the rest of the
  chapter uses. Nothing about it reads as withheld; there was simply no
  `source-material/markdown/` file, which is a gap in the conversion and not a
  decision by staff. The hidden table stays a separate, still-hidden thing.
- **Do the eight nations with a blank `capital` have one?** Kindaria,
  Merrigor, Mists of Eltiel, Myos Islands, the Principalities of the Reach,
  Rues, T'barris and the Vale of Scyllina are `capital: ""`; five are
  `demonym: ""` (the Five Duchies' entry says outright that it has none). If
  the book does not name them, the infobox should collapse rather than render
  a flag chip over one "See also" row.
- **Is the custom-domain move happening, and when?** README calls it a
  one-line `PATH_PREFIX` change and `site.json`'s `origin` feeds every
  absolute URL — but `test/smoke.mjs` hardcodes both `PREFIX` and `ORIGIN`.
  **And does `numinalarp.com` serve HTTPS?** Batch 1 could not verify from its
  sandbox and neither could Phase 5, which was refused at the network egress
  before a request left the box. The links stay `http://` until somebody with
  a browser can say (locked #319); this half of the question needs one person
  and one page load.
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
- ~~Audit §B~~ — all seven landed in Phase 4: the map is `role="group"`,
  there is a skip link, the era headers are `<h2>`, `table { display: block }`
  is gone, gold text is `--gold-text` at 4.80:1, the toggle carries
  `aria-pressed`, and axe runs in CI. (`scroll-margin-top` and motion-gated
  smooth scroll had landed in batch 2.)
- Zero cross-links in ported content → Phase 2. (~~189 skills unreadable by
  the build~~ and ~~no rulebook version diff~~ landed in Phase 1.)
- ~~`excellencies.md`'s live stub, 183-word `history.md`, 17-event timeline,
  635-word glossary~~ and ~~no "come play" path~~ all landed in Phases 5 and 6.

**Unclaimed**
- Four things the skill data shows that the prose hid (Phase 1, not fixed
  because the rule is not to invent facts): `Empower Fire` and `Enhance Fire`
  are the only Empower/Enhance pair in six Domains whose Verbal cell is `N/A`
  rather than `Thread Skill`, so they alone carry `thread: false`; the hidden
  table spells `Lighting` twice (Mindblade, Steelforge); three Savant rows
  have a blank Verbal; and `First Aid` and `Diagnose` in `index.md` have
  descriptions that begin mid-sentence, a conversion artefact from the PDF.
  Check each against `rules-2026-v3.51.pdf` and fix the markdown, then re-run
  the extractor.
- **Three defects in the Excellencies chapter as the PDF prints them**, left
  faithful and flagged rather than patched, the same call the four below got.
  `Healing Venom` (Poison Blade) has a description that begins "venom as your
  base." — the first line of the sentence is missing from the book, exactly like
  `First Aid` and `Diagnose` below. `Shift Loads` (Grenadier) begins "Attribute
  to instantly change" and is missing a "Spend 1". `Take Ground` (Combatant)
  ends mid-clause on a comma. Check each against a printed copy and fix the
  markdown, then re-run the extractor.
- **Two more, smaller, in the same chapter.** `Hand out Weapons` (Bladesmith)
  has a Verbal of "Grant Melee Attack 2 Damage" over a description that says
  "Gain one use of 'Grant Melee Attack 3 Damage.'" — 2 or 3, the book says both.
  `Reverse Protection` (Beguiler) says "For Physical, choose Force or Force."
- **The timeline and `rues.md` spell the empire differently.** The book's
  Historical Timeline row says "Mecurian Empire" and `lore/nations/rues.md` says
  "Mercurian Empire". `timeline.json` carries the book's spelling. One of them
  is a typo and the PDF is the place to settle which.
- **The character builder still takes an Excellency as a typed name.** The
  chapter it would pick from exists now (Phase 6), but offering the list means
  pricing the skills inside a chosen Excellency, and `build-rules.js` does not
  implement that. The comments in `build-rules.js` and `build-view.js` say so.
  Wiring it up is a builder phase, not a content one.
- `building-a-character.md` prints "Assign Your Attributes (Steps 8–10)"
  above "Choosing Skills (Steps 1–7)". The book's order, presumably, but it
  reads as a mistake.
- `notable-figures.md` is 27 one-line entries pointing at the pages that
  actually cover those people. Nothing checks that the people it names are
  still named on the pages it points at.
- `world.md` is 397 words for "The World of Aeledd", the first stop off the
  home page's second hero button.
- `firebase.json` sets `no-cache` on `**/sw.js`. No service worker has ever
  existed. (Phase 7 would write one.)
- `tools/social-card.mjs` needs a Playwright the project does not depend on
  and a local server on port 8099, and is documented only in its own header
  comment. Nothing re-runs it when the palette changes.
- CI runs on pull requests only, never on `main`. It has an accessibility
  check now (Phase 4's `a11y` job); it still has no HTML validation.

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

**Shipped 2026-09-12, PR #236.** `HISTORY.md`, "Numina, arc one", carries the
full account and decisions #297 to #299.

189 skills in 29 tables in 9 files, in three header shapes, is the whole
mechanical content of Numina — and to Eleventy it was a paragraph with pipes.
This phase turned it into `src/_data/skills.json` via a re-runnable
extractor, with a suite that pins it so a v3.52 bump is a reviewable diff
instead of a reread. Nothing user-visible shipped; two phases stand on it.

- [x] **`tools/extract-skills.mjs`.** Parses the tables out of
  `src/mechanics/skills/*.md`, keyed by file and by the heading above each
  table. The three header shapes become one record:
  `{ id, name, group, groupKind, cost, verbal, description, attribute, thread, source }`,
  `source` being the page URL plus the heading anchor.
- [x] **The costs that aren't numbers.** `cost.kind` is `cp`, `included` or
  `see-description`; `attribute.kind` is `spend`, `none`, `thread`, `uses`,
  `see-description`, `blank` or `unlisted`, each keeping `raw`. A shape nobody
  has decided about throws with the file, line and cell.
- [x] **The other tables** under their own keys: `cultures` (16), `attributes`
  (6 rows, the "Cost of next attribute" modelled as `unpublished`), `hidden`
  (22, not the 21 this file said) and `currency` (3). Crafting's 96 formula
  rows are a different shape and are left; an unknown header throws.
- [x] **`test/skills.test.mjs`, in `npm test`.** Committed JSON equals a fresh
  extraction; every markdown row is a record exactly once by an independent
  count; every `source` anchor is in the built HTML; ids unique, seven pinned
  literally; totals pinned (189 / 29 / 16 / 6 / 22).
- [x] **A diffable version bump,** in CONTENT-GUIDE.md under "Skill data":
  replace the chapter markdown, re-run the extractor, read the JSON diff,
  rebuild. Sorted keys, document order, no timestamps.

*Model:* **Claude Fable 5.1**, as named, and the session ran on it.

## Phase 2 — A page for every skill, and links between them

**Shipped 2026-09-12, PR #239.** `HISTORY.md`, "Numina, arc one", carries the
full account and decisions #300 to #303.

CONTENT-GUIDE rule 5 said to cross-link and 39 ported chapters contained zero
links; a skill had no address to link to either. This phase generated both off
Phase 1's `skills.json`: 189 skill anchors, 122 cross-links on 43 pages, and an
index page for all 189. This is audit A5, done by machine rather than by 39
careful passes.

- [x] **A stable anchor per skill,** from the record's id —
  `/mechanics/skills/domains/#airs-last-stand` — with a CSS-drawn `§`
  permalink and `data-pagefind-ignore`, the way the heading permalink already
  does it. A page that repeats a name gets `group-name` (four `Holding`s).
  Rows match by heading + text, never position; a record with no row stops the
  build.
- [x] **A skill index page,** `/mechanics/skills/all-skills/`: all 189 by name,
  group, kind and cost, filterable by text and group, `data-pagefind-body`,
  and in `nav.json`. The filter is progressive — the list is complete without
  JS, in print, and to Pagefind.
- [x] **Generated cross-links.** First mention per page, never in a heading,
  table header, existing link or code span, never self-linking, and idempotent
  because an existing link to the target is what spends the term. The list
  derives from `skills.json`, the nation pages and the glossary's `##`
  headings; `src/_data/autolink.json` holds 12 exclusions, each with its
  collision — and each has to *do* something or the suite fails. One-word skill
  names and terms two records claim are dropped by rule, not by list.
- [x] **Infoboxes: collapsed, not filled.** Three nations carry only the "See
  also" row — the Principalities of the Reach, Rues and T'barris — and get no
  infobox now. There was nothing to fill: `source-material/markdown/` records
  that the book names no capital or demonym for any of them. The "8 nations"
  in this file's earlier text was counting empty `capital` fields, five of
  which sit beside a demonym that renders.
- [x] **Smoke test extended:** no page body links to itself, every cross-page
  `#fragment` resolves to an id on its target, the autolinker is idempotent
  over all 56 built pages, and the exclusion file is honest. Plus five checks
  in `skills.test.mjs` on the anchors and the index page. 118 assertions to
  130.

*Model:* **Claude Opus 5**, as named, and the session ran on it.

## Phase 3 — The character builder

**Fifty CP, ten numbered steps, a hard cap of three Excellencies, an
escalating cost curve, and every player doing the arithmetic on paper.**

`building-a-character.md` lays out ten steps and a cost structure — first
Excellency 5 CP with each subsequent one a CP dearer, Expressions likewise,
up to three Aspect skills, two Foundation and two Culture skills, attributes
capped at 10 and Vitality at 7 — then asks the player to do the arithmetic on
paper. With `skills.json` it becomes a page: client-side, same-origin,
dependency-free like everything else here, and loudly unofficial.

**Increment 1 shipped (2026-09-12, decisions #304 to #309): the arithmetic,
with no page.** `src/js/build-rules.js` prices a build and refuses to price
what the book does not publish; the Aspect and Foundation lists are in
`skills.json`; `test/build-rules.test.mjs` is 113 assertions. Q36 was answered
yes, on the condition that nothing is guessed (#304). Q32 is still open and
was not pre-answered — the module works without it by leaving those purchases
unpriced.

**Increment 2 shipped (2026-09-12, decisions #310 to #313): the picker, and
the build kept and shared.** `/mechanics/character-builder/` is the page:
`src/js/build-view.js` renders each step from `offered()` as HTML strings,
`src/js/build-state.js` packs the build into `localStorage` (`numina.build`)
and the URL fragment, and `src/js/builder.js` is the only file that touches
the browser. `test/builder.test.mjs` is 88 assertions over the two pure
modules and the built page.

**Increment 3 shipped (2026-09-12, decisions #314 and #315): the printable
card.** `renderCard()` in `src/js/build-view.js`, a "Your card" section on
the page with a print button, `cardsheet: true` on the page and `print.css`
rules keyed on `main.builder-page` that hide everything but the card.
`test/builder.test.mjs` is 119 assertions. The phase is finished; nothing is
left in it.

- [x] **`src/js/build-rules.js`, pure, with its suite.** A build in, a
  verdict out: CP spent and remaining, which selections are legal, which
  prerequisites are unmet, which caps are hit. No DOM. The cost curve lives
  here — and the phase is blocked on the attribute numbers (see Questions)
  and must refuse to guess them. *Done: `priceBuild()` returns
  `cp{budget,spent,remaining,exact,unpriced}`, `problems`, `provisional`,
  `purchases`, `granted` and `attributes`. A raised Prowess, Insight,
  Fortitude or Vitality lands in `cp.unpriced` with the chart's own words and
  flips `cp.exact` false, so `cp.spent` is a floor (#305); the two "See
  Description" skills get the same treatment. `offered(build, catalog)` says
  what each of the ten steps may show, which is what the picker reads.*
- [x] **The picker,** in the book's own step order: Aspects, Foundation,
  Culture, Domain, Excellencies, Expressions, Open Skills, then attributes
  and Vitality. Each step lists exactly what `skills.json` says that choice
  unlocks, with cost, verbal and description inline and a link to the anchor.
  Step 5 has no list to show: the Excellencies chapter is a stub, so an
  Excellency is a name the player types (#306) and `offered()` returns
  `choices: null` for it. *Done: `src/mechanics/character-builder.njk` and
  `src/js/build-view.js`. The form is the state and a step re-renders only
  when what it offers changes (#310); Tongue of Aspect is one box per chosen
  Aspect (#312); `skills.json` and the anchor map are inlined in the page as
  two JSON islands rather than fetched (#313). Problems render under the step
  they belong to; the verdict says "at least" and quotes the chart when a
  purchase is unpriced.*
- [x] **Say what is provisional.** Excellency and Expression purchases "must
  be unlocked in-game", hidden ones need staff approval, a third Expression
  requires emailing staff. Part of the verdict, not fine print. *Done:
  `verdict.provisional`, and every verdict carries `unofficial: true`. The
  page still has to render it.*
- [x] **Persist and share.** `localStorage` under a `numina.` key (matching
  `numina.theme`), plus the build encoded in the URL fragment so a player can
  paste it to a friend or staff. No server, no account. *Done:
  `src/js/build-state.js`, key `numina.build`, versioned, every load through
  `repair`. The fragment is short keys in step order
  (`a=arcane&f=military&x=Deadeye&at=purpose:6`), rewritten with
  `replaceState` on every change; a fragment in a pasted link wins over the
  save, and an empty build clears both (#311).*
- [x] **A printable character card** on the existing `cardsheet` print
  treatment: chosen skills with verbals and attribute costs, attributes,
  Vitality, CP total. One sheet carried to the event — the feature that
  justifies the phase. `verdict.granted` and `verdict.purchases` are the two
  lists it prints. *Done: one skill table, Adventurer's rows first then step
  order, each row name, source, CP, uses (the record's `attribute`) and
  verbal; the six attributes at their values; a CP line that is "At least"
  with the unpriced purchase named and the chart quoted when Prowess,
  Insight, Fortitude or Vitality is raised, and never a total (#305);
  problems, Staff flags and the share URL under it. Measured at Letter in a
  headless Chromium: one page. The card is on screen too, under the verdict
  (#315).*
- [x] **Suite and smoke.** Every cap, every escalating cost, every "Included"
  skill priced at zero, one known-good 50 CP build costed to the CP; plus a
  smoke check that the builder's data matches `skills.json`. *Done:
  `test/build-rules.test.mjs`, wired into `npm test` third. The 50 CP build
  is Arcane/Military/Aluvair/Air with one Excellency and the Performer
  Expression, and it costs 50 exactly. Eighteen guard-rails broken on purpose;
  two of them went green the first time and the assertions were rewritten
  (#147). `test/builder.test.mjs` checks the page's markup under Node — the
  view is strings, so no browser is needed — and the built page's islands.
  The session that shipped increment 2 also drove the page in a real
  Chromium, but that check is not in the suite: Numina's CI installs no
  browser.*

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

## Phase 4 — The accessibility and mobile pass — DONE (PR #251)

**The map was the site's best feature and a screen reader could not see any of
it.** All seven of audit section B's findings shipped, plus the two visual nits
listed in the standing backlog beside them.

- [x] **Expose the map.** `world-map.njk`'s svg is `role="group"` with its
  `aria-label` kept, so all 16 `<a class="map-region">` children stay in the
  accessibility tree and each region's `<title>` names its link. axe's
  `nested-interactive` rule fires on the old `role="img"` — "element has
  focusable descendants" — which is the diagnosis in one line.
- [x] **Skip link.** First focusable thing in `base.njk`, off-screen until
  focused, targeting a `<main>` that now carries `id="main"` and
  `tabindex="-1"` in all nine templates (`page.njk`, `index.njk`, the three
  section indexes, the nations index, all-skills, the builder, search) so that
  pressing it moves focus and not only the scroll.
- [x] **Tables keep their semantics.** `table { display: block }` is gone;
  `div.table-scroll { overflow-x: auto }` carries the scroll. Markdown tables
  are wrapped by a markdown-it renderer rule, `all-skills.njk` and
  `build-view.js`'s three runtime tables by hand, and `print.css` sets the
  wrapper back to `overflow: visible` so a wide table breaks across sheets
  instead of being clipped at the page edge.
- [x] **Timeline eras and the theme toggle.** The era is an `<h2>`, not a
  `<p aria-hidden="true">`. The toggle carries `aria-pressed`, `theme.js`
  syncs it on load, on click, and on an OS theme change under a visitor who
  has never pressed it.
- [x] **Gold that passes AA.** `--gold-text` split out: `#7d5f18`, 4.80:1 on
  `--paper`, for every run of gold text. `--gold` (3.11:1) is left to the
  ornaments and the map. Both nits fixed: `hr`'s sprig sits in a gap in the
  rule now (two half-width gradients) instead of under a flat `--paper` patch
  on a textured body, and `--header-h` is `5.0625rem`, the header's measured
  height.
- [x] **axe in CI,** over home, a nation, Core Rules and the search page, in
  both themes, failing the build. `Numina/test/a11y/`, its own package.

**What the phase found that the audit did not.** Two things, both on record as
locked decisions:

- **`--header-h` understated the header; it did not overstate it** (#316). The
  standing backlog said 5rem overstated the real header and the sticky era
  chips floated with a gap. Measured in Chromium at three widths the header is
  80.97px and 5rem is 80px, so a stuck chip sat just under the header's bottom
  edge. It is 5.0625rem now and `layout.mjs` measures both.
- **axe's contrast rule is blind on this site** (#317). Every surface is a
  colour under an alpha-0.07 noise texture and the chrome is masked
  pseudo-elements over it, so axe returns "incomplete" rather than a ratio —
  642 of 710 text nodes on Core Rules. `axe.mjs` runs a second contrast-only
  pass with the decoration flattened, which sees the real colours and does
  catch `--gold` at 3.11:1 by name; `smoke.mjs` computes the ratio from the
  token values and needs no browser at all.

*Left where it is:* the `hr` seam is the one fix in this phase with no
automated guard — it is a texture matching a texture, and the check would have
to be a screenshot. Verified by eye, by inserting an `<hr>` into a page in the
browser, because no Numina page renders one today.

## Phase 5 — Come play — DONE (PR #TBD)

**A stranger could read 136,000 words about Aeledd and never learn that Numina
is a real thing you can attend.** Audit A2 and A7, plus D4's `http://`.

- [x] **One sentence under the tagline** in `src/index.njk`'s hero, in
  `.hero__plain`: what a LARP is, and that this one meets in person.
- [x] **A "Come play" partial**, `src/_includes/partials/come-play.njk`, on the
  home page, the New to Numina landing page and the foot of
  `mechanics/new-players.md` (a `comePlay: true` frontmatter flag and a hook in
  `page.njk`, the same shape `showTimeline` already had). Three links, all of
  them off `site.official.*` — the partial hardcodes no URL, and `smoke.mjs`
  fails if it grows one. `site.official.registration` is the new key.
  `new-players.md`'s "How to Join" lost its two duplicated bullets and now
  points at the block.
- [x] **Index the landing pages.** All four carry `data-pagefind-body` and a
  `data-pagefind-meta` section now. 56 of 57 built pages are in the index; the
  search page is the one that is out, and `smoke.mjs` asserts that it is the
  only one.
- [ ] **Fix the scheme.** Still `http://`, deliberately, and the reason is a
  comment in `site.json` now rather than a checkbox here: locked decision #319.
  The host is blocked at this sandbox's network egress, so the second session
  in a row could not tell whether it answers on https. A `http://` link to a
  host that redirects works; a `https://` link to a host that does not serve it
  fails outright, so the safe reading wins until somebody can load it. That is
  the whole of this phase that is not done.

## Phase 6 — Excellencies, history, and the timeline — DONE (PR #TBD)

**A sidebar link on every skills page led to 34 words telling the reader to
consult CONTENT-GUIDE.md.** Audit A3 and A6.

- [x] **Excellencies ported, all of it.** The chapter runs pages 60 to 75 of
  `rules-2026-v3.51.pdf` and was never converted, so it came out of the PDF
  directly with `pdfplumber`'s table finder: **30 Excellencies and 239 skills**,
  thirteen aligned to a single Domain under `## Air` through `## Water` and
  seventeen under `## Multi-Aligned Excellencies`, `###` per Excellency and the
  five-column table under it, exactly the shape `domains.md` and
  `expressions.md` use. `skills.json` went 189 → 428 in 29 → 59 tables with no
  special case in the extractor's walk, but four new Attribute shapes and one
  new table header (Inferno's column is headed "Effect / Verbal") had to be
  named — see CONTENT-GUIDE. **This answers Q33: not withheld, just
  unconverted** (locked #318).
- [x] **`history.md`** is 919 words, not 183: an Age of Faith section (Fate
  sundered, the churches, the War of the Heavens, the isolation, the centuries
  known through Rues) and an Age of Works section (the Pronouncement, the
  century the nations remember, Valarmore and the Vargoth, Fortune's Bend
  again). Dates are left to the timeline. Every claim traces to
  `campaign-book-2025.pdf` or a page already in `src/`; the nations and terms
  it names are linked, by hand where the autolinker will not (Rues is excluded)
  and by the autolinker everywhere else.
- [x] **The timeline**, enriched rather than extended, because the book's
  Historical Timeline was already ported whole and the campaign book contains
  no other AW or AF date anywhere (locked #320). Every event now has an `href`
  that resolves and a `nations` where one applies, the book's 124 row is split
  into the two events it actually prints, and `smoke.mjs` resolves a `#fragment`
  in an `href` against the ids of the page it points at.
- [x] **The glossary earns its job**: 635 → 952 words, ten new terms, all of
  them rules vocabulary the chapters use constantly and it lacked — Centering,
  Flurry, Long Rest, Packet, Place of Peace, Short Rest, Surge, Trait, Verbal,
  Vitality. Cross-links went 122 to 194 on 45 pages as a result.

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
