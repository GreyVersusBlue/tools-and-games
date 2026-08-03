# Faire Weekend — session notes

## What changed

**Task one, the real remaining gap: mobile tap targets.** `css/style.css`'s
375px-and-under breakpoint used to shrink the grid to `--cell: 30px` to fit
the whole grounds map without scrolling — which put every one of the 38
plot markers at 26px, the primary interaction on the whole page, well
under the 44px touch minimum. The buttons (27-28px) and tabs (40px) were
under it too. Fix, in order of how load-bearing each piece is:

- **Plot markers**: `--cell` at the `max-width: 720px` breakpoint goes
  30px → 48px. The marker's own margin (2px a side, unchanged, set once at
  global scope) makes a 48px cell a 44px marker — exact, not a buffer.
  Shrinking further was never available (a legible glyph needs more room,
  not less); growing and accepting that the map now regularly needs to
  scroll is the actual design move here, not a tweak.
- **The eastern-columns scroll, made discoverable**: at 48px cells the
  widest unlocked tier (Deep Woods Trail, 14×10) runs 672px wide against a
  375px phone, so panning right is now the normal case, not an edge case.
  `.plat-sheet` gets the standard "scroll shadow" treatment: two gradients
  painted in the map's own paper colour scroll *with* the content
  (`background-attachment: local`), masking two more gradients painted in
  shadow that stay fixed to the viewport (`background-attachment: scroll`).
  The shadow only shows through where the paper-coloured cover has
  scrolled clear of that edge — fades in on the right on load, moves to
  both edges mid-scroll, disappears on the left once fully panned. Reflects
  actual scroll position; doesn't go stale like a static "swipe →" label
  would.
- **Buttons, tabs, and the footer controls** (`.btn`, `.tab-btn`,
  `#save-bar button`, `#resetBtn`) all get `min-height: 44px` plus
  `display: inline-flex; align-items: center; justify-content: center`
  inside the same breakpoint, so no variant (small, primary, danger, the
  two gvb-save.js footer buttons) can quietly fall back under the floor
  regardless of its own font/padding.

Verified live in a real rendered 375×812 page (not just arithmetic): a 1×1
ghost marker measures exactly 44×44px, `.tab-btn`/`.btn.small` measure
exactly 44px tall, and `.plat-sheet.scrollWidth` (497) genuinely exceeds
its `clientWidth` (309) on the starting 10×7 grounds — the scroll affordance
has real content to earn its keep on, not just the widest tier.

**A second, unplanned finding while measuring the above: the desktop board
split was being set by the wrong element.** `#board`'s grid used
`grid-template-columns: minmax(0, auto) minmax(340px, 1fr)` — an "auto"
track sizes off the *max-content* of everything inside it, including a
`flex-wrap` row measured as if it never wraps. Hiding each child of `.plat`
in turn (in a live browser, not guessed) found the 4-button build palette
(Stage/Food/Craft/Demo, one line) was contributing ~293px more than the map
itself needed, stretching the grounds column to 839px on a 1280px desktop
even on the empty 10×7 starting grounds (map + legend + status alone
measured ~546px) — and starving the desk column (Office/Backstage/Fair
Floor, i.e. most of the game) to its 340px floor. Fixed with
`grid-template-columns: fit-content(710px) minmax(340px, 1fr)`, 710px being
the widest any tier legitimately needs (Deep Woods Trail, 14×10, is 703.4px
including both paddings, at the desktop 46px cell). Desk width on a 1280px
desktop: 373px → 502px, confirmed live.

**One mistake caught before it shipped:** the first version wrote
`minmax(0, fit-content(710px))`. `fit-content()` cannot nest inside
`minmax()` per the grid spec — a browser silently drops the whole
declaration as invalid, which collapsed `#board` to a single implicit
column and stacked the map on top of the desk instead of beside it. Caught
by re-measuring in the live browser after the first edit (both columns
reported the full board width), not by trusting the CSS on read. Fixed by
using the bare `fit-content(710px)` (which already provides its own floor
internally) instead of nesting it.

**Task two: re-ran round 2's wiring audit** (grep every `data-action` in
`main.js`, cross-reference against `tests/smoke.mjs` and
`Tools/board-check/play-games.mjs`'s `faire-weekend` block — the method,
not automatic, that found ten gaps last round). Found one more:
**`cancelMove`** — the move-in-progress banner's Cancel button — was never
clicked by either suite. `selectMove`/`moveTo` were covered; backing out of
a relocate without picking a destination wasn't. New test in
`tests/smoke.mjs` Section 22: selects Relocate, confirms destination ghosts
appear, clicks Cancel, confirms the ghosts are gone and the plot is exactly
where it started, uncharged. Every other `data-action` (24 total, including
`commitAll`, covered only in `play-games.mjs` not `smoke.mjs` — still a
real gap-check pass, not a miss) and both `<select>`s plus the ticket-price
slider are covered by one suite or the other. No new `data-action` or
`<select>`/slider exists to audit beyond what round 2 already mapped.

## What I verified

- `npm install --prefix "Projects/Ren-Faire-Claude"` once, then
  `node tests/smoke.mjs` from inside the project → **801 passed, 0
  failed** (was 783 at the start of this session: +5 from the `cancelMove`
  test, +9 from a Section 23 mobile-touch-target regression block, +4 from
  a Section 24 desktop-board-column regression block — see below).
- **Locked decision #34, four times**, each reverted and rerun:
  - `--cell` back to 30px at the mobile breakpoint → the marker-size
    assertion failed by name (26px, not ≥44px); restored, clean.
  - `min-height: 44px` back to 30px on `.btn`/`.tab-btn`/`#save-bar
    button`/`#resetBtn` → all four assertions failed by name; restored,
    clean.
  - `main.js`'s `cancelMove` switch case renamed so nothing handles it →
    the new Section 22 test failed by name ("Cancel actually exits move
    mode"); restored, clean.
  - `#board`'s column reverted to the invalid `minmax(0,
    fit-content(710px))`, then separately shrunk to `fit-content(500px)` →
    both Section 24 assertions failed by name (the nesting guard, then the
    cap-too-small guard); restored, clean each time. 801 passed after every
    restore.
- **A real rendered 375×812 page**, not just arithmetic: a 1×1 ghost
  marker's `getBoundingClientRect()` is exactly 44×44; `.tab-btn` and
  `.btn.small` are exactly 44px tall; `.plat-sheet.scrollWidth` (497) >
  `.clientWidth` (309) on the starting grounds, so the scroll affordance
  has real content to show, not just a theoretical worst case.
- **A real rendered 1280×900 page**, before and after the `#board` fix:
  grounds column 839px → 710px, desk column 373px → 502px. Also checked the
  1080px tablet breakpoint (`#board` reverts to a single stacked column
  there, untouched by this fix) still measures full-width for both
  sections, and the widest unlocked tier's arithmetic (14×10 at the
  desktop 46px cell = 703.4px including both paddings) clears the 710px cap
  by 6.6px — not reproducible live without playing to Weekend 4, so checked
  by calculation and guarded by the Section 24 cap-vs-703.4 assertion
  instead.
- `cd Tools/board-check && npm run check` → **360 units checked, 0
  broken; 0 collisions across nine widths, tightest gap 9.1px.**
- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed** (module
  untouched this session).
- `npm run social:check` → **6 pages out of sync, including
  `Projects/Ren-Faire-Claude/index.html`.** Not this session's doing:
  `index.html`, `sync-social-tags.mjs`, and the board are explicitly
  off-limits (Prompt 22's files), I never touched `index.html`
  (`git diff -- index.html` is empty), and the same run flagged five other,
  unrelated projects' pages (`daredevil`, `torchbearer`, `fourth-quarter`,
  `orbital`, the root `newindex.html`) as drifted simultaneously — reads
  like a board-level change mid-flight from another session working in
  this same repo concurrently, not something scoped to this project.
  Flagging per house rules, not fixing.
- `cd Tools/board-check && node play-games.mjs faire-weekend` → **Faire
  Weekend's own 18 checks, 0 failed** — build/commit/schedule/weekend-
  rollover flow, the report-phase save/reload lock, and "no page or console
  errors" all still clean with this session's CSS and test changes in
  place. Confirms the desktop `#board` column fix didn't break any real
  click/drag interaction, not just that the numbers came out right.

## Shared-file requests

**None.** Nothing this session touched needed a `gvb-save.js` change, a
board/`index.html` change, or a `Tools/board-check` change — the mobile and
desktop layout work is entirely `css/style.css`, and the wiring-audit fix is
entirely `tests/smoke.mjs`.

## Deliberately not done

- **The 1080px tablet breakpoint's own cell size (38px → 34px markers)
  wasn't touched.** The round-2 finding and this round's task were both
  scoped to the 375×812 phone case specifically (44px is a touch-target
  guideline; 1080px-and-under is more likely a mouse-driven narrow
  laptop/tablet window than a thumb). Leaving it alone rather than
  guessing whether tablets in the wild are touch-first enough to warrant
  the same fix without being asked.
- **A fully adaptive desktop board-column width.** The `fit-content(710px)`
  cap is fixed at the *largest* tier's requirement rather than shrinking
  further for a smaller one still in progress — so a fresh Home Grounds
  save still carries some empty mat to the right of the map (710px column
  vs. ~656px of actual map+chrome), just far less than the 839px it used to
  claim. A genuinely adaptive version would need the live `--cols`/`--cell`
  values threaded from `ui.js` up onto `#board` (or `:root`) so a `calc()`
  could size the column off the actual current tier instead of a fixed
  worst case — main.js doesn't currently expose grid-size info at that
  scope, and reaching for it felt like more surface area than this pass's
  remaining budget justified for a cosmetic residual. Left as a named
  follow-up, not a silent gap.
- **`select`/`input[type=range]` touch sizing.** Round 2's tour measured
  plot markers, buttons, and tabs specifically; it never measured the
  ticket-price slider or the schedule/vendor `<select>`s. Not touching
  what wasn't measured.

## Next session

1. **The layout/spacing/density review is still owed** — this round spent
   its time on task one (mobile tap targets, plus the desktop `#board`
   column bug found while measuring it) rather than a general pass.
   Everything needed (server, game, `shots/games/` for before/afters) is
   still in place.
2. **A fully adaptive `#board` column width**, if the residual dead space
   on smaller grounds tiers bothers Devon in practice — see "Deliberately
   not done" above for the shape of the fix.
3. **Re-run the wiring audit again after any future session adds a new
   `data-action` or `<select>`/slider.** This round's re-run found one real
   gap (`cancelMove`) that round 2's own list missed — the method isn't
   automatic and needs repeating, not a one-time pass.
4. `perGuestCost`/`upkeepRate`/`winCondition`/`bankruptcyFloor` are still
   the economy numbers most likely to need adjusting after real play,
   unchanged assessment from four rounds running.
5. True guest-agent/pathfinding simulation remains the one fully untouched
   item since this project's earliest sessions.
