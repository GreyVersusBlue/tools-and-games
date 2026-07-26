# gvb-site-handoff-v1.md

Handoff from **session 1** (site version 2) → whoever picks this up next.
Written for a fresh session with no memory of this one.

---

## 0. Orientation, in sixty seconds

`greyversusblue.com` is a static GitHub Pages site with a custom domain
(`CNAME` → `greyversusblue.com`). No build step anywhere. Every page is
either a single self-contained HTML file or a folder with an `index.html`
plus loose `js/`, `css/`, `data/` — nothing is bundled, nothing is compiled.

The homepage is a tavern **Guild Board**: wood-plank background, parchment
notice cards pinned at slight rotations, brass plaques as section headers,
wax seals. That visual language is **locked**. Extend it; don't redesign it.

```
/
├── index.html            the Guild Board — self-contained (HTML+CSS+JS, ~35 KB)
├── 404.html              themed not-found page (new this session)
├── CNAME
├── assets/               NEW this session — the only shared-asset dir on the site
│   ├── js/
│   │   ├── gvb-save.js         shared save system (ES module)
│   │   ├── gvb-save.test.mjs   32-check Node smoke suite
│   │   └── README.md           adoption guide
│   ├── og/guild-board.png      1200×630 social preview card
│   └── previews/README.md      hover-unfurl screenshot specs (no images yet)
├── Audio/thepwhatnow.mp3       easter-egg sound
├── Pathfinder/           Anathema_Archive.html, campaigns.html, characters.html
├── Projects/             the games — mix of single-file and folder-based
└── Tools/                the school utilities + creature_artwork_gallery.html
```

Board sections, in DOM order: **Quests** (13 cards, `#quest-board`),
**Pathfinder** (4 cards), **Town Services** (6 cards). Section anchors
`#quests`, `#pathfinder`, `#services` exist and are linked from the 404.

---

## 1. What shipped this session

### The four known issues — all closed

| # | Issue | Resolution |
| --- | --- | --- |
| 1 | "Sports Bar Sim" and "The Fourth Quarter" both pointed at `Projects/fourth-quarter` | "The Fourth Quarter" keeps the 3D folder. "Sports Bar Sim" repointed at the previously orphaned `Projects/The-Fourth-Quarter.html` and restyled as an **archived posting** (see §3). Nothing is a dead duplicate; nothing is orphaned. |
| 2 | `Projects/Castle Conundrum/` had no `index.html` → 404 | `CastleConundrum.html` renamed to `index.html`. All its references were already `./src/…` so nothing else changed. Verified `src/ui.css` and `src/main.js` still resolve. |
| 3 | `Tools/creature_artwork_gallery.html` unlinked | Linked — but into the **Pathfinder** section as "Bestiary Gallery", not Town Services. It is a PF2e bestiary art index (hotlinks Archives of Nethys images), not a school tool. |
| 4 | `Ren-Faire-Claude/` Node scaffolding | **Kept, deliberately.** Not dead weight: `tests/smoke.mjs` imports jsdom, `package.json` declares that devDependency and the `npm test` script, and the project README documents a 675-check suite. Deleting the scaffolding deletes the test suite. Added a note to `Projects/Ren-Faire-Claude/README.md` explaining this so it doesn't get re-flagged. |

### Backlog items built

**Per-project wax seal glyphs.** An inline `<svg><defs>` sprite at the top of
`<body>` defines 16 stroked symbols: `g-sword g-cup g-mug g-flame g-torch
g-book g-house g-anvil g-star g-key g-sun g-pennant g-scroll g-d20 g-helm
g-school`. Each seal is `<span class="seal"><svg class="glyph"><use
href="#g-…"/></svg></span>`. Glyphs are keyed **per project**, not per genre
tag — Aphelion gets a star even though its filter tag is `Sim`. The flat "G"
is gone from every card.

**Ledger index (tag filter rail).** `<div class="ledger" id="ledger">` sits
between the QUESTS plaque and the board and is **built entirely by JS** from
each card's `data-tags` attribute — counts included, so they cannot drift out
of sync with the cards. Real `<button>`s, `aria-pressed`, and an `aria-live`
count line. Filtering toggles `.filtered-out { display:none !important }`.
With JS off there is no rail and the board is unchanged and fully usable.

Current tag distribution (derived, not hard-coded): `Sim 6 · CRPG 2 ·
Narrative 2 · Puzzle 2 · Explore 2`. Castle Conundrum carries two tags
(`Puzzle Explore`); the ribbon shows the first, the filter matches either.

**Genre corner ribbons.** Injected top-right on every quest card, labelled
with the card's primary tag, and clickable — they set the filter and scroll
the ledger into view. Clicking one again clears back to All. Keyboard
reachable (`role="button"`, `tabindex="0"`, Enter/Space).

**Torn "NEW POSTING" flag.** Brass, top-left, jagged right edge via
`clip-path`. Driven by a bare `data-new` attribute — currently on Integer
Foundry, Aphelion, Castle Conundrum, and Faire Weekend. This is a **manual
flag**; move it by hand as things ship.

**Rotating tavern-keeper lines.** Ten of them in the `LINES` array, picked at
random on load, written in the footer's voice. The original line ("Take a
notice down to accept the job…") is entry one and is also the no-JS default
sitting in the HTML.

**PF2e cluster cross-link.** Absalom Inheritance, Torchbearer (Quests) and
Anathema Archive (Pathfinder) each carry `class="has-suite"` and a
`◆ PF2E REMASTER SUITE` mark. Clicking any of them lights all three with a
brass ring (`.suite-lit`) and scrolls to the first — the cluster reads as a
suite across section boundaries. Click again to un-light.

**Town Services parity.** Service cards now carry a **schoolhouse stamp**: a
dashed square in ink-blue, rotated −7°, at 50% opacity (72% on hover), with
the `g-school` glyph. Deliberately not a wax seal — stamped and filed, not
sealed and posted. Card bottom padding went to `2.5rem` to give the stamp a
"filing margin" so it never lands on the last line of a description.

**Open Graph.** Full OG + Twitter card meta on `index.html`, plus an inline
SVG data-URI favicon (wax seal on wood — no extra file, no request).
`assets/og/guild-board.png` is a real 1200×630 render in the site's actual
typefaces — Grenze Gotisch and Alegreya were fetched as `@fontsource` npm
packages and converted woff2→ttf so the card is not a font-substituted
approximation. The generator script is **not** in the repo (see §4).

**Themed 404.** `404.html`: the same wood ground, a scrap of parchment still
pinned with a ragged tear across the bottom two-thirds, "404 — only the top
half is still pinned", a brass RETURN TO THE BOARD button, and three section
deep-links. GitHub Pages serves this for the whole site including subpaths,
so **every link on it is root-absolute** (`/`, `/#quests`). Keep it that way.

**Shared save system.** `assets/js/gvb-save.js` — an ES module generalizing
the Fourth Quarter's campaign save (namespaced key + schema version +
defensive validating load) and adding the part nothing had: file export and
import. `createSaveSlot({ game, key, version, defaults, validate, migrate })`
returns `fresh / load / save / reset / autosave / serialize / deserialize /
exportToFile / promptImport`. Plus `mountSaveBar(container, slot, handlers)`
for a three-button UI restyleable via CSS custom properties.

Export envelope: `{ format:"gvb-save", game, version, savedAt, state }`.
Imports from a different `game` are refused; imports from an older `version`
run the same `migrate` the localStorage path uses. `load()` returns `null` —
never throws — on empty, corrupt, invalid, or a migration that blows up.

### Verification actually run

- Custom link/structure checker over `index.html` and `404.html`:
  **24 and 4 local references resolve**, tag stack balanced, no strays.
  (Directory hrefs are checked for a real `index.html`, so issue #2 would
  have been caught by it.)
- Inline JS of `index.html` extracted and `node --check`'d — clean.
- `node assets/js/gvb-save.test.mjs` → **32 passed, 0 failed**.
- OG card rendered and visually inspected.

**Not verified:** no headless browser was available, so nothing was rendered
in a real engine. The CSS below was reasoned through carefully but a fresh
session should eyeball the board in a browser before building on top of it.

---

## 2. Backlog state

| Item | State |
| --- | --- |
| Per-project wax seal glyphs | **Done** |
| Torn NEW POSTING ribbon | **Done** (manual `data-new` flag) |
| Rotating tavern-keeper lines | **Done** |
| Tag/filter ledger index | **Done** |
| PF2e cluster cross-link | **Done** |
| Themed 404 | **Done** |
| Open Graph tags + card | **Done for the homepage.** Per-project OG tags and per-project screenshots: **untouched** |
| Town Services parity | **Done** |
| Shared save export/import | **Module + tests done. Adopted by zero projects** |
| Hover-unfurl previews | **Mechanism done, images missing** — see §4 |

---

## 3. Locked decisions — do not relitigate

1. **The parchment moved from `.notice` to `.notice::before`.** The old
   `clip-path` on the anchor was clipping every descendant — which is why
   pins rendered as half-domes, and why corner ribbons and hover-unfurl were
   impossible. The anchor now has no background and no clip; `::before`
   paints the parchment at `z-index:-1` inside an `isolation:isolate`
   context, and `.unfurl` sits at `z-index:-2` behind it. **Consequence:**
   pins are now full pushpin heads floating above the card's top edge. This
   is intentional. To revert you would have to give up ribbons and unfurl.
2. **"Sports Bar Sim" is the archive card, not a dead link.** It points at
   `Projects/The-Fourth-Quarter.html` (the original 2D single-file build),
   carries `class="archived"`, and reads "OLD NOTICE — STILL PINNED". The
   `.archived` treatment (desaturated paper, ink-coloured eyebrow, greyed
   seal) is a reusable state for future retirements.
3. **Bestiary Gallery lives under Pathfinder**, not Town Services. Town
   Services means schoolhouse tools.
4. **Ren-Faire's `package.json` / `package-lock.json` / `.gitignore` / `tests/`
   stay.** Reason is in that project's README now.
5. **Seal glyphs are per project; ribbon tags are per genre.** They are two
   different axes on purpose. Don't collapse them.
6. **The ledger rail is generated from the DOM**, never hand-authored. Adding
   a card with `data-tags="Sim"` updates the chip counts automatically. Don't
   hard-code counts.
7. **Interactive spans inside the `<a>` cards** (`.tag-ribbon`, `.suite`,
   `#p-seal`) use `preventDefault()` + `stopPropagation()` to avoid
   navigating. This follows the pattern already in the codebase for the
   Anathema Archive easter egg. It is technically invalid HTML (interactive
   content nested in an anchor) — see §4.
8. **`404.html` links are root-absolute.** Relative links break it on subpaths.
9. **The version line.** `<p class="board-note version">version 2</p>`
   replaced "Postings Last Updated on 7-24-26". **Bump this by one every
   session** — next session ships `version 3`. There is an HTML comment above
   it saying so.

---

## 4. Rough edges and TODOs

**No preview screenshots exist.** `assets/previews/` has only a README. Seven
filenames are already wired via `data-preview` on the cards
(`castle-conundrum.jpg`, `aphelion.jpg`, `golden-hour.jpg`,
`fourth-quarter.jpg`, `faire-weekend.jpg`, `closing-time.jpg`,
`integer-foundry.jpg`). The JS attaches each image **only if it loads**, so
missing files are invisible — no broken-image icons, no layout shift. Drop a
JPEG in with the right name and it appears with no HTML edit. Specs are in
`assets/previews/README.md` (≈330×200, JPEG q80, under ~60 KB, hidden below
760 px and on touch-only devices).

**Per-project OG tags are untouched.** Not one project page has OG meta —
they mostly don't even have a `<meta name="description">`. This wants real
screenshots first, and touching 15+ locked project pages is a session of its
own. Sequence it after previews exist, since the same screenshot can serve
both.

**Nothing adopts `gvb-save.js` yet.** Deliberate: swapping a project's save
functions changes save-key behaviour for anyone mid-campaign. Adopt it one
project at a time, keeping the old key readable through `migrate` for one
version. The Fourth Quarter is the natural first (the module was derived from
it — `SAVE_KEY = "fq3d-save"`, and `loadCampaign()` already has the
field-by-field defensive normalization that would become `migrate`).

**Invalid-HTML caveat.** Interactive spans inside anchors work in every
browser and are keyboard-reachable, but won't validate. The clean fix is
restructuring cards to `<div class="posting">` wrappers containing a
`<a class="notice">` — which would break the `.board .notice:nth-child(3n…)`
rotation selectors and the ledger's `querySelectorAll(".notice")`. Not worth
it unless validation becomes a goal.

**`data-new` is manual.** No dates exist in the markup to automate it. If
this becomes annoying, `data-posted="2026-07"` plus a "newer than N months"
check would work, but that needs real posting dates gathered first.

**The OG generator script isn't in the repo.** It was a scratch script
(PIL + fonts converted from `@fontsource` npm packages). Regenerating the
card means rewriting it. If the board changes enough that the card goes
stale, consider committing the generator under `assets/og/` next time.

**Not rendered in a browser this session.** See the end of §1.

**Unchanged and unreviewed:** every project page, every tool page, all three
Pathfinder pages. This session touched `index.html`, added `404.html` and
`assets/`, renamed one file, and added one paragraph to one README.

---

## 5. Suggested next session

Roughly in order of value per effort:

1. **Open the board in a browser and check it.** Three top-corner elements
   (pin, tag ribbon, NEW flag) were laid out by arithmetic, not by eye.
2. **Capture the seven preview screenshots.** Highest visible payoff on the
   whole list, and unblocks per-project OG images.
3. **Per-project OG tags**, reusing those screenshots. Mechanical, wide.
4. **Adopt `gvb-save.js` in the Fourth Quarter**, as the reference
   integration the other sims can copy.
5. Anything from the original pie-in-the-sky list that still appeals — that
   list was explicitly a menu, not a ceiling.

Remember to bump the version line to `version 3` and write
`gvb-site-handoff-v2.md` before signing off.
