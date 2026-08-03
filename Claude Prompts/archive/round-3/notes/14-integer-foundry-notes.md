# Integer Foundry — session notes (round 3)

## What changed

### `test/browser.mjs` — the `waitForFunction(fn, null, opts)` bug, four call sites

`Projects/integer-foundry/test/browser.mjs`. This was task one, named in the prompt with exact
line numbers. Playwright's signature is `waitForFunction(fn, arg, options)`; Puppeteer's is
`waitForFunction(fn, options, ...args)`. A bare `page.waitForFunction(fn, null, opts)` is only
correct under Playwright — under this environment's `puppeteer-core` branch the `null` lands where
`options` belongs and the call throws. `Tools/board-check/drive.mjs` already exports an
engine-aware `waitFor(page, fn, opts)` for exactly this (`page.__engine === 'puppeteer' ?
page.waitForFunction(fn, opts) : page.waitForFunction(fn, null, opts)`), and prompt 22 fixed every
instance of the bare form inside `Tools/board-check/**` last round, explicitly leaving this file
alone since it's mine, not theirs.

Added `import { waitFor } from '../../../Tools/board-check/drive.mjs'` alongside the existing
`harness.mjs` and `games.mjs` imports, and replaced all four bare calls (the export-file-picker
wait at the old line 199, the two "floor is empty" waits at 302-304 and 315-317, and the "an order
landed" wait at 349-351) with `waitFor(p, fn, opts)`. Mechanical, no behavior change intended —
confirmed below.

### Nothing else in the game itself changed

`js/targets.js`, `js/state.js`, the HTML, the save shape — none of it needed edits. Round 2's
curve fix is untouched. See "Deliberately not done" for why the two model gaps stayed that way
again this round, with a sharper reason than last round's.

## What I verified

- `node Projects/integer-foundry/test/smoke-targets.mjs` → **94 checks, 0 failed**. Unchanged from
  round 2 — nothing in this suite touches the file I edited.
- `node Projects/integer-foundry/test/browser.mjs` → **56 checks, 0 failed**. This is the one that
  mattered: before the fix this file aborted outright on the first `waitForFunction` call
  (the export-flow wait). After swapping in `waitFor`, all four sites resolve and every group
  after them runs, including "An order no board can fill" and "Filling whatever the sink asks for"
  — the two groups that depend on the exact waits I touched. Confirms the fix is real, not just
  quiet on the surface.
- `cd Tools/board-check && npm run games` → **137 checks, 3 failed**, and I read the full log
  rather than trusting the summary line. All three failures are outside my boundary: two in
  Golden Hour (a wading-depth settle and a footprints check) and one in The Fourth Quarter
  (walking to a station, never got in range). Integer Foundry's own section is **20 checks, 0
  failed** — including the sink asking for a real rolled number (12), a matching packet filling
  it for +24 ingots, and the sink rolling a fresh order after. Worth flagging: this beat is no
  longer seeding `sinks[0].target = 3` the way round 1 and round 2 both described — it now reads
  whatever the sink actually asks for and builds to it, exactly what round 1's shared-file request
  asked for. That request is not in the repo's uncommitted changes, so someone already applied it
  in a prior pass; **the shared-file request in this project's notes is retired, it's done.**
- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed**.
- `cd Tools/board-check && node check-collisions.mjs` (and the same sweep inside `npm run check`)
  → **0 collisions, tightest vertical gap 9.1px** (was 9.2px last round — a fraction of a pixel,
  not a regression, plausibly another project's card copy shifting layout by a hair; nothing to do
  with this project).
- `cd Tools/board-check && npm run check` → **363 units checked, 0 broken**, plus the collision
  sweep above. Clean. Round 2 flagged this as failing on `newindex.html`'s offsite font hotlinks —
  that's fixed now too, not by me, but worth recording since it means the whole site's integrity
  sweep is green, not just my corner of it.
- `npm run social:check` → 18 notices, 12 current, 6 out of sync (Daredevil, Torchbearer, Fourth
  Quarter, Faire Weekend, Orbital, `newindex.html`). Integer Foundry is not one of them — this is
  mid-round drift from other project threads actively editing right now, and it's prompt 22's job
  to reconcile at the end of the round, not mine. Noting it only so it isn't mistaken for something
  I broke.

**Playtest, not just the numbers (task three).** Ran the actual page in a browser rather than only
reading `rollTarget`'s output:

- Fresh game, no seeding: first order asked for 3, wanted 2 fabricators (`2× +1`). Same feel as
  round 1 and round 2 described — the curve fix doesn't touch the early game and it shows.
- Seeded `ordersFilled: 30` and `unlocked.mul2: true` (the exact stretch round 2's numbers said
  used to go flat), then let the game roll fresh orders under those conditions. Confirmed by hand
  what round 2 only computed: `maxCost` really is 14 on this board once `×2` exists, and the
  rolled *target values* themselves can be large (231, 255, 283 — anything with a cheap
  doubling-and-adding recipe near the 300 cap) while the *tile cost* to build them stays in the
  12-14 range the ramp intends. Built the exact 12-tile recipe the game's own tooltip named for an
  order of 231 (`2× +1, ×2, +1, 3× ×2, +1, ×2, +1, ×2, +1`) by hand in the running page — it filled
  in a few seconds of travel time and paid out 462 ingots (`target × 2 × prestigeMult`), and the
  line's now-stale packets got rejected and logged cleanly once the sink rolled its next order.
  Nothing about this felt broken or grindy: a twelve-tile line is not a big ask on a 46-cell floor,
  and the reward scaling directly off the raw target value (not the tile cost) means buying `×2`
  makes ingots-per-tile-of-effort jump hard, which reads as the upgrade paying for itself, not a
  treadmill.
- One genuine, non-urgent observation from actually looking at the screen rather than the numbers:
  once `×2` is in play, the sink can ask for a three-digit number (`NEEDS 231`) for an order that
  only takes a short line to fill. The tooltip already explains the cheap recipe, so this isn't a
  correctness problem, but a player who doesn't hover the hint might read "231" as a big jump in
  difficulty when it isn't one. Not filing this as a task — it's a cosmetic/UX question about how
  much the raw number vs. the tile-cost hint gets emphasized, and that's Devon's call, not mine to
  redesign. Flagging it so it's not rediscovered from scratch if it ever comes up.
- Locked decision #34, reintroducing the bug on purpose: didn't need to re-derive this — round 2's
  own verification already did it (2590/5000 unfillable at order 30 on the old curve's math, 0/5000
  on the new one) and nothing this session touched the curve or the reachability model, so there
  was nothing new to reintroduce. Re-ran the 2000-rolls-at-400-orders check inside `browser.mjs`
  instead (see above), which is the same guarantee from the live page rather than a standalone
  script.

## Shared-file requests

None. Round 1's request (stop seeding `sinks[0].target` in `play-games.mjs`) is done — confirmed
above, not by me. Nothing new to ask for.

## Deliberately not done

**Task two, the two conservative model gaps**, again. Both are still exactly what round 1 named
and round 2 declined to touch: mergers/splitters left out of `buildCosts`' BFS (a board with
`Merge x` but not `x2` gets capped around 47 on a floor that could reach roughly 529), and
`opBudget` dividing the floor evenly across sinks placed rather than accounting for a shared
prefix through a splitter. Both are safe-direction — they make orders easier than they need to be,
never harder — so leaving them alone costs nothing in correctness, only in how interesting the
harder end of the game could someday be.

I looked at these longer this round than "not urgent" alone would justify, because the prompt
flagged `opBudget`'s fix as the smaller, lower-risk one of the two, worth picking up on its own.
Having actually read `opBudget`'s doc comment and the file's own design note carefully, I don't
think that's true, and it's worth writing down why so nobody picks it up in isolation expecting a
small change:

`targets.js`'s whole design commits to one invariant on purpose — "the answer does not depend on
the layout currently on the floor... so an order stays fillable after the player tears their line
down." `opBudget` currently assumes zero sharing between sinks specifically *because* assuming
sharing would mean reasoning about whether a splitter is actually placed and where, which is
layout information the rest of the model is built to ignore. You cannot correctly credit a sink
for "a splitter could share this prefix" without first knowing how much a splitter actually saves,
and that number does not exist anywhere in this codebase yet — mergers and splitters are outside
`buildCosts` entirely. So `opBudget`'s fix and the BFS-tree fix aren't two independent gaps of
different sizes; they're one gap. Any standalone `opBudget` change would have to guess at a
sharing bonus without proving it, which is exactly the kind of guess that turns "conservative" into
"wrong" in the one system here that has to never over-promise. If this gets picked up, it should be
picked up as one piece of work, not the smaller half of two.

## Is this project stable?

**Yes, as far as I can tell there is nothing outstanding here that's actually Integer Foundry's to
do.** Task one (this session's real work) is fixed and verified. Task three (playtest) came back
clean, with only a cosmetic, non-urgent observation, not a task. Task two (the model gaps) has now
been looked at hard by two separate rounds and declined both times for reasons that hold up, and
this round adds a real argument for why they're not even separable, which should settle it rather
than leaving it as a standing "maybe next round." The one shared-file request this project ever
had is already applied. Every verification command that touches this project's own files is green:
94 (`smoke-targets`), 56 (`browser.mjs`, previously aborting, now passing clean), 20 (this
project's own beat inside `npm run games`), 50 (`gvb-save.test.mjs`), 0 collisions. The three
failures in the wider `npm run games` run are Golden Hour's and The Fourth Quarter's, not this
project's, and the site-wide integrity and collision sweeps are both clean.

I'd recommend this project move to `Claude Prompts/Stable/` on the next prompt-23 refresh,
alongside 01 and 15 — same bar those two were held to (nothing outstanding, re-checked against the
live repo rather than trusting a prior round's own claim). If Devon or a future session disagrees
about the two model gaps being worth doing despite the coupling argument above, that's the one
thing that would pull it back out.

## Next session

If this does move to `Stable/`, there isn't one in the normal sense. If it doesn't, in order:

1. **The two model gaps, as one piece of work, not two.** See above — model mergers/splitters as a
   tree in `buildCosts` first, then `opBudget` can credit actual proven sharing instead of guessing
   at it. Real complexity, real risk to the guard-rail system, still not urgent.
2. **The cosmetic three-digit-order observation above**, if Devon wants it looked at: whether the
   tile-cost hint should be more prominent once the raw target starts running past two digits.
   Nothing to fix in the meantime; the tooltip already carries the real information.
3. **Everything round 1 and round 2 already listed that isn't this project's to do** — the
   site-wide backlog in `gvb-site-handoff-v9.md`. Still not mine, still standing.
