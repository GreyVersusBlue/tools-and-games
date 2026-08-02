# Pathfinder Campaigns — session notes

## Note from prompt 03's round-2 session (2026-07-31) — read this first

A round-2 session on prompt 03 touched this file with Devon's explicit
sign-off, extending that prompt's normal boundary to include this page. It
added `[shared]` comment markers to the `<style>` block and bottom `<script>`
at every point that's byte-identical with `characters.html`'s copy of the
same rules (palette vars, `.embers`/`.ember`/keyframes, `.tome`/`.corner*`,
`header.masthead` through `.subtitle`, `main{}`, `footer`, both bottom media
queries, the ember-seeding script) — no CSS/JS logic changed, only comments.
It also caught and fixed a real bug it introduced in the first pass: a
comment that spelled out the literal text `</style>` inside this file's
`<style>` block, which closed the element ~150 lines early per HTML's raw-text
tokenizer rules and silently dropped every rule after it (`.campaign-title`,
`.roster`, `.scenario`, `table.chronicle`, etc.) from being valid CSS. Fixed
and reverified live (`.campaign-title`/`.scenario-title` compute to
`Cinzel, serif` again, `#gm` keeps its `active` class on load, tab switching
works). Full account, including why the merge didn't become an actual shared
file (locked decision #17), is in
`Claude Prompts/notes/03-pathfinder-characters-notes.md`. Everything below
this note is that prior round-1 session's own record, unedited.

## What changed

**Built the generator script round 1 left as a standing idea, item 2 in its
own "Next session" list.** Round 1 deliberately kept this page hardcoded
(no `localStorage`, no live editor — a DM's chronicle that updates a
handful of times a year is better served by git-versioned HTML than by
browser storage that can silently drift) but flagged that a small local
script turning structured input into the page's HTML blocks would cut
authoring friction without giving up that property. Nobody had built it.

Added `Pathfinder/campaigns-assets/generator/`:

- `generate.mjs` — a dependency-free Node script with three modes
  (`campaign`, `scenario-group`, `scenario`) matching the page's three
  hand-authored block types. Each mode reads a JSON file and prints the
  matching HTML block to stdout. It does not write to `campaigns.html` —
  you paste the output in and commit it like any other edit, so every
  change is still reviewed and diffable, which was the whole point of
  leaving this page hardcoded in the first place.
- `examples/campaign.json`, `examples/scenario-group.json`,
  `examples/scenario.json` — real data (Rise of the Runelords, Kaeta
  Jadeharbor's PFS log, Checkers' one-shot) so the shape is obvious without
  reading the script.
- `README.md` — the JSON schema for each mode, field by field, plus what
  the tool deliberately doesn't do (see below).

Did not touch `campaigns.html` itself. Total new content: 5 files, all
under my own boundary (`campaigns-assets/`, already mine from round 1's
font work).

## What I verified

- Ran all three modes against their example JSON and diffed the output by
  eye against the real blocks already in `campaigns.html`:
  - `node generate.mjs campaign` against the Rise of the Runelords
    `<article>` (lines 331-362 of the page) — matches: same classes, same
    nesting, same pill/roster/bio structure.
  - `node generate.mjs scenario-group` against Kaeta Jadeharbor's log
    (lines 448-478) — matches, including which columns get `class="num"`.
  - `node generate.mjs scenario` against Checkers' one-shot (lines
    518-523) — matches.
  - Also hand-built a coming-soon test case (ribbon with `sequel: true`,
    empty roster) and confirmed it matches "Return of the Runelords" (lines
    403-417) exactly: `.coming-soon` class present, `.ribbon.sequel`
    present, no `.roster` div emitted when the roster array is empty.
- `node Tools/board-check/check-integrity.mjs` → **338 units checked, 1
  broken**. The one failure is `newindex.html` referencing
  `fonts.googleapis.com`/`fonts.gstatic.com` — not my file, not touched by
  me, and unrelated to anything in this session (it's not even in the
  Pathfinder table this prompt cycle tracks). Flagging it here since it's a
  real, currently-failing check, but it isn't mine to fix.
- `cd Tools/board-check && npm run check` → same result, **338 units, 1
  broken** (the same pre-existing `newindex.html` failure). 0 collisions.
- `npm run social:check` (from `Tools/board-check/`) → **failed**, but not
  on anything I touched: `only parsed 17 notices out of index.html — the
  notice markup has changed shape, fix the regexes rather than shipping a
  partial sweep`. `index.html` is prompt 21's file, not mine, and up to
  twenty other sessions are running in parallel right now per this cycle's
  own README — this reads like another thread mid-edit on `index.html`,
  not something introduced by anything in my boundary. Not a shared-file
  request (I don't know what changed or what the fix is), just flagging it
  loudly because it's a hard failure of a check the prompt told me to run,
  and whoever's mid-edit on `index.html` — or prompt 21 when it does its
  final pass — should know before assuming 22/22 notices are current.
- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed**. Not
  required (this page isn't an adopter and my script doesn't touch it) but
  cheap, and confirms I haven't broken shared tooling.
- `git status --porcelain` reviewed in full: only
  `Pathfinder/campaigns-assets/generator/` is new and mine.
  `Projects/aphelion/**` shows modified and `Pathfinder/tests/` shows
  untracked — both other threads' work landing mid-session, not mine.
  `Pathfinder/campaigns.html` itself shows no changes, confirming I didn't
  touch it.

## Shared-file requests

None. Nothing here needed a change to `index.html`, `gvb-save.js`,
`Tools/board-check/**`, or the generated preview/OG assets. (See the
`social:check` failure above — flagged, not a request, since I don't have
a fix.)

**The merge recommendation from round 1 still stands, unchanged.** I did
not open `characters.html` or gather new evidence this round — round 1's
finding (both pages independently vendored the exact same five font files,
79,676 bytes each) is still the strongest signal available and is fully
written up in round 1's version of this file
(`Claude Prompts/archive/round-1/notes/02-pathfinder-campaigns-notes.md`).
This prompt's own text (Task one) is explicit that acting on it solo — even
just re-confirming it — isn't the point; it needs a single session with
both `campaigns.html` and `characters.html` open at once. I didn't create
that session. If prompt 03's round-2 thread also re-flags this
independently again, that's a third independent signal pointing the same
way.

## Deliberately not done

**Did not build the Chronological-view merge/sort step.** The
Chronological tab is the same per-character scenarios re-sorted by scenario
number across each org. A future version of the generator could take the
same per-character JSON this round's tool already reads and derive that
table automatically instead of hand-keeping both views in sync — but that's
a real merge-and-sort feature, not a template-filling one, and nothing
today suggests the two views have actually drifted apart. Building it
speculatively, before there's a real sync problem, is exactly the kind of
scope creep the "keep it a small script, not a live editor" reasoning was
meant to avoid. Documented as a known gap in the generator's own README
instead.

**Did not act on Task one (the merge with `characters.html`).** Per the
prompt's own instruction — not a task for a solo run. See Shared-file
requests above.

**Did not fix `newindex.html`'s offsite font references or investigate the
`social:check` parse failure on `index.html`.** Neither file is in my
boundary (`Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/`, and
new folders under `Pathfinder/` named for this page). Flagged both above
so they don't get lost.

**Did not re-verify fonts/ARIA/contrast on `campaigns.html` itself.** The
prompt's own text says to re-check only if the page changes, and this
session made zero edits to the page — only added a new, separate tool
alongside it.

## Next session

Ordered by value per effort:

1. **Merge `campaigns.html` and `characters.html`'s shared CSS/fonts.**
   Unchanged from round 1's #1 recommendation — see Shared-file requests.
   Needs a single session with both files in scope, still hasn't happened
   across two rounds.
2. **If the generator actually gets used and the two chronicle views drift
   out of sync, build the merge/sort step described above.** Not worth
   doing ahead of an actual need.
3. **Someone should look at why `npm run social:check` only parsed 17 of
   `index.html`'s notices.** Not this page's problem to solve, but it's a
   hard failure right now and worth surfacing before prompt 21's final
   pass assumes a clean board.
4. **Cosmetic, low priority:** nothing new stood out on `campaigns.html`
   itself this round — no edits were made to it, so round 1's pass (card
   chrome, ember animation, foil-sweep title, contrast) still stands as
   the last real review of the page's rendering.
