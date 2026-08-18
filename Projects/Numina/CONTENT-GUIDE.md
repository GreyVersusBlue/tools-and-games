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
---
```

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
cd Projects/Numina
npm install        # first time only
npm run build      # regenerates the committed site + search index
npm test           # smoke checks: pages built, links resolve, search fresh
```

Commit the markdown **and** the regenerated output in the same commit.
