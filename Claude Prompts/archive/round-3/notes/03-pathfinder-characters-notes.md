# Pathfinder Characters — session notes (round 3)

**Recommendation: move this prompt to `Stable/` next time prompt 23 runs.** Three
rounds running now (1, 2, 3) with nothing outstanding and no real code change needed
since round 1 — see "Next session" below for the full case. Same bar prompts 01 and
15 were held to when they moved.

## What changed

Nothing. `Pathfinder/characters.html` is unchanged since round 2's commit (730 lines,
still `git log -- Pathfinder/characters.html` last touched by round 2's work). This
session was a verification pass: confirm the font vendoring, heading order, contrast
fix, and the round-2 `[shared]` marker work against `campaigns.html` all still hold,
and check for drift in the twin pages' shared chrome. None found — see below.

Vendored fonts, re-confirmed: five `.woff2` files in
`Pathfinder/characters-assets/fonts/` totaling **79,676 bytes / 77.8 KB**
(cinzel-latin-700-normal 15,184 + cinzel-latin-900-normal 14,804 +
crimson-pro-latin-400-italic 19,104 + crimson-pro-latin-400-normal 18,336 +
oswald-latin-400-normal 12,248), unchanged from round 2.

## What I verified

- **`[shared]`-marker drift check against `campaigns.html`**, the actual task this
  round (prompt item 4). Pulled every block either file marks `[shared]` and compared
  by hand: `:root`'s first 14 vars, `.embers`/`.ember`/`@keyframes drift`, `.tome`/
  `.corner*` (excluding the documented `max-width` difference, 1040px vs 960px),
  `header.masthead` through `.subtitle`, `main{}`, `footer`/`footer a`, both bottom
  media queries, and the ember-seeding `<script>` block. **All still byte-identical
  between the two files.** No drift to flag.
- `grep -c "fonts.googleapis.com\|fonts.gstatic.com" Pathfinder/characters.html
  Pathfinder/campaigns.html` → 0 for both.
- `grep -n "</style>"` / `"</script>"` on both files → exactly one match each, the
  real closing tag. Re-ran specifically because of round 2's truncation bug; no
  recurrence.
- `cd Tools/board-check && npm run check` → **351 units checked, 0 broken, 0
  collisions across nine widths, tightest vertical gap 9.1px.** (Counts moved from
  the 335-units/3.5px baseline documented in this prompt — that's other threads'
  board growth this round, e.g. Orbital's card, not anything on this page. Nothing in
  the collision report touches `.dossier` or `.muster`.)
- Live-server check (`gvb-static-site` launch config, `npx serve` on port 47681, not
  `file://` — same tooling note as round 2):
  - `document.fonts.ready` then `[...document.fonts]`: all five faces
    `status:"loaded"` on `characters.html`.
  - Heading order: `H1.title` → 9× (`H2.dossier-name` → one or more `H3`), no skips,
    across all nine dossiers.
  - Mobile (375×812): the `max-width:600px` query applies (`.tome` margin 0,
    border-width 6px; `main` padding 32px/17.6px/48px, matching `2rem 1.1rem 3rem`).
  - Cross-checked the twin: `campaigns.html`'s `.campaign-title` computed
    `font-family` is still `"Cinzel, serif"` and `#gm.classList.contains('active')`
    is still `true` on load — confirming round 2's `</style>`-truncation fix hasn't
    regressed.
  - No console errors on either page.

## Shared-file requests

Nothing needed from `Pathfinder/data/`. No edit needed in `campaigns.html` — the
drift check came back clean.

**Not a request, a heads-up for whoever runs prompt 22 next:** `npm run social:check`
this round reports **18 notices · 12 already current · 1 had no block · 5 out of
date · 0 failed**, with drift listed on `Projects/daredevil/index.html`,
`Projects/torchbearer.html`, `Projects/fourth-quarter/index.html`,
`Projects/Ren-Faire-Claude/index.html`, `Projects/orbital/index.html`, and
`newindex.html`. That's a real regression from the "18 notices, 18 current, 0 out of
date" state prompt 23 most recently confirmed. **None of the six drifted pages are
`Pathfinder/characters.html` or `campaigns.html`** — confirmed by grepping both for
offsite hosts (0 matches) and by this page not appearing in the drift list at all.
Flagging so it doesn't get mistaken for something this thread caused.

## Deliberately not done

**Still not creating a shared CSS/asset file between this page and `campaigns.html`.**
The merge question is closed (round 2, Devon's call: harmonize via `[shared]`
comments, don't share a file — locked decision #17 stays in force for this pair).
Not re-litigating it.

**Still not touching the font-file-naming mismatch** between this page's fontsource
convention and `campaigns.html`'s short form. Same bytes, cosmetic only, not worth
the churn.

**Still not adding a `<template>` dossier block or adopting `gvb-save.js`.** Neither
requested this round. Same reasoning as rounds 1 and 2 — see
`Claude Prompts/archive/round-2/notes/03-pathfinder-characters-notes.md` for the
full account.

## Next session

1. **Move `03-pathfinder-characters.md` to `Stable/` next time prompt 23 runs.**
   Nothing outstanding on this page across three consecutive rounds: fonts vendored
   and verified round 1, heading order and contrast fixed round 1, twin-page
   `[shared]` chrome added round 2 and reconfirmed drift-free round 3. The only
   things left on this project (the `<template>` block, `gvb-save.js` adoption) are
   both explicitly Devon's call and neither has been requested in three rounds — that's
   the same bar prompts 01 and 15 were held to before they moved to `Stable/`. If a
   real change surfaces later (campaigns.html's shared chrome drifts, Devon wants the
   template block or `gvb-save.js` built, `Pathfinder/data/` becomes relevant), it
   moves back to the live folder with a real task list, same as the `Stable/` folder's
   own rule.
2. **The `social:check` drift on six other pages** (above) is prompt 22's to fix, not
   this page's.
3. Template block / `gvb-save.js` adoption — still open, still Devon's call, still
   not built.
