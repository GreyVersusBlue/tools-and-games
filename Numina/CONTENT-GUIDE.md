# Numina Content Guide

How to convert the source books (in `source-material/`) into site pages. Every
page of the site is a markdown file under `src/`. Drop converted markdown into
the file listed below, run `npm run build && npm test`, and commit source +
built output together.

## Ground rules for converted markdown

1. **One file per book chapter** — the target files already exist as stubs with
   the book's section headings in place. Paste prose under the matching heading.
2. **No top-level `#` heading** — the page title comes from frontmatter.
   Book sections are `##`, subsections `###`.
3. **Plain markdown only.** No HTML needed; tables as markdown tables.
   Avoid literal `{{` or `{%` sequences (Nunjucks delimiters) — if the text
   ever needs them, escape by wrapping in backticks.
4. **Keep the frontmatter block** at the top of each stub and fill in any
   empty fields (e.g. a nation's `capital`) as you discover them in the text.
5. **Cross-links**: link between pages with root-relative paths, e.g.
   `[Rues](/lore/nations/rues/)` or `[Vitality](/mechanics/skills/attributes-vitality/)`.
   The build rewrites them for the deployed URL automatically.
6. Smart quotes from the PDF are fine; the build typographer normalizes
   straight quotes anyway. Fix hyphenation artifacts from PDF line wraps
   (`cul- ture` → `culture`) when you spot them.

## Frontmatter schemas

**Standard page** (everything except nations):

```yaml
---
title: Faith & Religion
order: 5            # position in the section sidebar
summary: One-sentence teaser shown on section landing pages.
printable: true     # only on mechanics pages meant for the print packet
cardsheet: true     # dense one-or-two-sheet card; see below
toc: false          # optional; force the "On this page" contents off or on
---
```

`printable` adds a "Print this page" button and starts each `##` section on a
fresh sheet — right for a long rules chapter, wrong for a cheat sheet. Pages
that must stay short in print (currently just Combat Quick Reference) set
`cardsheet: true` **as well**, which cancels those page breaks and shrinks the
type. If you add content to a cardsheet page, re-check the print preview: the
target is one or two sheets.

**A new page also needs an entry in `src/_data/nav.json`.** Nothing else picks
it up — the sidebars and the section landing-page cards are both generated from
that file, and `npm test` fails if a built page under `lore/`, `mechanics/`, or
`new-to-numina/` is missing from it. Nation pages are the one exception; they
come from a collection.

Long pages get an **"On this page"** contents block automatically: it appears
when the rendered page has at least 1,200 words *and* at least four `##`/`###`
headings, which covers every ported rules chapter and nation while leaving
stubs and short pages alone. Set `toc: true` to force it onto a shorter page, or
`toc: false` to suppress it. Nothing else is needed — the list is generated from
the page's own headings at build time.

**Nation page** (`src/lore/nations/*.md`):

```yaml
---
name: Aluvair
title: Aluvair
order: 1            # book order (alphabetical)
color: "#7a9b6d"    # accent color; also fills this nation's map region
capital: ""         # fill in from the text if the book names one
demonym: ""         # e.g. "Aluvairi" — fill in if the book uses one
summary: One-sentence teaser shown on the nations index cards.
---
```

## Chapter → file map

### Campaign Guide (`source-material/campaign-book-2025.pdf`)

| Book chapter | Target file |
| --- | --- |
| Introduction / The World of Aeledd / Fortune's Bend | `src/lore/world.md` |
| Characters (Creating a Character, Character History, A "Heroic Game") | `src/lore/characters.md` |
| Nations & Cultures — one chapter per nation | `src/lore/nations/<slug>.md` (16 files exist; slugs below) |
| Peoples of Aeledd (Aspects, Foundations) | `src/lore/peoples.md` |
| Faith and Religion (Genesori, Faith, Zenith/Chosen/Exemplars, Convocations) | `src/lore/religion.md` |
| Travel and Commerce (The Lattice, Travel, Economy) | `src/lore/travel-commerce.md` |
| The Realms (Aeledd, Shade, Void, Divine, Noteworthy Beings) | `src/lore/realms.md` |
| A Brief History (prose) | `src/lore/history.md` |
| Historical Timeline (the dated table) | `src/_data/timeline.json` — see schema below |

Nation slugs: `aluvair`, `dovenost`, `mists-of-eltiel`, `five-duchies`,
`kindaria`, `konnigstrava`, `ldahn-linenation`, `melluria`, `merrigor`,
`myos-islands`, `ophrailes`, `principalities-of-the-reach`, `rues`,
`spyndelmere`, `tbarris`, `vale-of-scyllina`.

### Rulebook (`source-material/rules-2026-v3.51.pdf`)

| Book chapter | Target file |
| --- | --- |
| Welcome to Numina | `src/mechanics/new-players.md` |
| Accelerant Core Rules | `src/mechanics/core-rules.md` |
| Rules of Etiquette + safety material (Caution/Clarification/Emergency, contact rules, alcohol policy) | `src/mechanics/etiquette-safety.md` |
| Building a Character | `src/mechanics/building-a-character.md` |
| Numina Specific Rules + Adventurer Skills (overview) | `src/mechanics/skills/index.md` |
| Aspects | `src/mechanics/skills/aspects.md` |
| Foundations | `src/mechanics/skills/foundations.md` |
| Cultures | `src/mechanics/skills/cultures.md` |
| Domains | `src/mechanics/skills/domains.md` |
| Excellencies | `src/mechanics/skills/excellencies.md` (still a stub — not yet converted from the PDF) |
| Expressions | `src/mechanics/skills/expressions.md` |
| Open Skills | `src/mechanics/skills/open-skills.md` |
| Attributes + Vitality | `src/mechanics/skills/attributes-vitality.md` |
| Hidden Excellencies and Expressions | `src/mechanics/skills/hidden-excellencies-expressions.md` |
| Alchemy / Tinkering / Arcaneering Formulas + Magic Items | `src/mechanics/crafting.md` |
| Numina Weapon Construction Guidelines | `src/mechanics/weapon-construction.md` |

### Pages with no book chapter behind them

Some pages are written rather than ported, and are maintained by hand:

| Page | What it is |
| --- | --- |
| `src/new-to-numina/*.md` | Community knowledge — what a weekend feels like, packing, NPCing, etiquette, the FAQ. Sourced from the Discord logs, not the books. |
| `src/lore/glossary.md` | One `##` per term; the site's cross-link hub. |
| `src/lore/notable-figures.md` | Index of named individuals. Each entry is one line plus a link to the page that actually covers them — deliberately not a second copy of the nation pages. |
| `src/mechanics/combat-reference.md` | A condensation of Core Rules and Etiquette & Safety onto one printable card. Derived, so if a rule changes, change it in the source chapter *and* here. |

### Writing from the Discord logs

`discord-logs/` (gitignored, not in version control) holds channel exports plus
digests under `summaries/`, and question-and-answer versions under
`summaries/new-player-friendly/`. When you write a page from them:

1. **Site voice, no real names.** These are semi-private community
   conversations and the site is public. Write "the community's own rule is…",
   never "so-and-so said in Discord that…". This applies to staff too.
2. **Don't hardcode anything volatile.** Prices, dates, and system URLs move.
   Point at the official site or the registration store instead — the "$100 per
   event" that sat on Quick Reference for two years was a verbatim lift of a
   2024 Discord message.
3. **Check the logs against each other, and against the site.** They contain
   years of superseded answers and a fair number of contradictions. Prefer the
   most recent statement from staff, and if two sources disagree, ask rather
   than picking one.
4. **Link, don't duplicate.** Most new-player questions are already answered
   somewhere on the site. A second copy will drift from the first.
5. **Mind spoilers and provenance for in-play material.** The plot channels mix
   live campaign secrets, player theories, staff-run NPCs, and player
   characters, sometimes in the same sentence. Anything player-facing gets a
   spoiler warning; anything you cannot confidently identify as an NPC stays
   off the page.

## Timeline data (`src/_data/timeline.json`)

One object per dated event, oldest first. Schema:

```json
{
  "sort": -1400,
  "date": "1400 AF",
  "era": "Before the Age of Works",
  "title": "Garioch strikes Rues from the world",
  "summary": "Rues is isolated and the Lattice is broken.",
  "nations": ["rues"],
  "href": "/lore/nations/rues/"
}
```

- `sort`: number that orders events — use the negative year for AF dates and
  the positive year for AW dates.
- `era`: groups events under a sticky header; keep era names consistent.
- `nations` (optional): slugs, colors the event's timeline dot.
- `href` (optional): "read more" link.
- The file is seeded with real events from the book's Historical Timeline —
  correct or extend freely.

## Glossary (`src/lore/glossary.md`)

One `##` heading per term, definition paragraph below it. Headings get anchor
ids automatically (`/lore/glossary/#the-lattice`), so glossary terms can be
linked from anywhere.

## After adding content

```sh
cd Numina
npm install        # first time only
npm run build      # regenerates the committed site + search index
npm test           # smoke checks: pages built, links resolve, search fresh
```

Commit the markdown **and** the regenerated output in the same commit.
