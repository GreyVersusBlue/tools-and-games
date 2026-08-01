# General Site Improvements — session notes

Partial pass. Nine of the twenty project notes files (01–09) are round-2
updates; eleven (10–20) are still the round-1 copies verbatim (byte-identical
to `Claude Prompts/archive/round-1/notes/`, checked with `diff` against each).
Per this prompt's own sequencing section, task one (apply shared-file
requests) and task two (bump the version, write the handoff) don't run until
all twenty exist. This session does the "do now" item only, then stops.

## What changed

Nothing in any file I own. No shared-file request was applied, the version
line is untouched (still `version 9`), and `gvb-site-handoff-v9.md` was not
written — writing it now from nine of twenty notes files would be exactly the
"claims to summarise twenty-one sessions but saw six" failure mode this
prompt calls out by name.

## What I verified

**Torchbearer fixture check (the one "do now" task independent of the other
threads).** `Projects/torchbearer/test/` contains only `smoke.mjs`; no
`*.torchsave.json` exists, and prompt 10's own notes file is still the
round-1 copy — its thread hasn't run this round. No fixture to transcribe
from. Leaving this for a later round, per the prompt's own instruction not to
build one blind.

**The live problem this prompt's own refresh flagged is still live**, confirmed
directly rather than taken on faith:

```
cd Tools/board-check && npm run check
  FAIL newindex.html
       references offsite host(s): fonts.googleapis.com, fonts.gstatic.com
  331 units checked, 1 broken

npm run social:check
  only parsed 17 notices out of index.html — the notice markup has
  changed shape, fix the regexes rather than shipping a partial sweep

node assets/js/gvb-save.test.mjs
  50 passed, 0 failed
```

`newindex.html` and `index.html`'s notice markup are unchanged from what this
prompt's own text described — this is the same standing problem, not a new
one. Fixing it is filed under task one by this prompt's own text, so it
waits with everything else in task one rather than getting jumped ahead of
the eleven threads still to come.

**Read all twenty-two notes files that exist.** The nine round-2 files (01–09)
already carry real shared-file requests and are worth flagging now so they
don't get lost in the noise of a future twenty-file read:

- **Three independent threads (Closing Time, The Fourth Quarter, Golden Hour)
  found and reported the same bug**: `Tools/board-check`'s
  `page.waitForFunction(fn, null, { timeout })` calls break under this
  environment's `puppeteer-core`, because its signature is
  `(fn, options, ...args)`, not Playwright's `(fn, arg, options)` — `null`
  lands in `options` and throws. This is why `npm run games` currently fails
  for every game, not just the ones those three sessions touched. Golden
  Hour's version of the fix is the cleanest (branches on `page.__engine`,
  which `harness.mjs` already sets, so both engines keep working rather than
  just papering over the Linux path). Exact call sites collected by Fourth
  Quarter: `drive.mjs:58`; `play-games.mjs:68, 112, 125, 156, 264, 531, 643,
  749, 781, 797`; `capture-previews.mjs:261, 332`; `games.mjs:165, 217`;
  `play-castle.mjs:386` (this last one is prompt 05's file, not mine — worth
  asking Castle Conundrum's thread to apply its share, or applying it as part
  of task one with a note, since the bug is real regardless of who owns the
  line). This is the single highest-value item for the eventual task one pass
  — every other thread's `npm run games`/`npm run previews` verification has
  been degraded or blocked by it.
- **Castle Conundrum (05) asks for a recapture** of its preview/OG pair —
  second time this has been asked, still not done. Recipe unchanged
  (`npm run previews` → name the frame in `candidates/chosen.json` → `npm run
  promote`).
- **Closing Time (06) also flags** that `Tools/board-check/.gitignore`
  excludes `package-lock.json`, so every session's `npm install` floats on
  whatever's newest that day — worth considering committing the lockfile
  (keeping `node_modules/` ignored) so a dependency drift like the
  `waitForFunction` break above shows up as a reviewable diff next time
  instead of a silent breakage.
- Anathema Archive (01), Pathfinder Campaigns (02), Pathfinder Characters (03),
  Aphelion (04), and Faire Weekend (09) all confirm no shared-file request —
  checked, not assumed, in each case.
- The Pathfinder Campaigns/Characters font-merge recommendation is repeated a
  third time (02, plus 03's round-1 finding), still explicitly not a solo
  task for either prompt.

## Requests applied, and requests refused

None applied this session — task one hasn't started. Nothing above is a
refusal either; it's a record of what's already waiting, so it isn't lost by
the time all twenty exist.

## Deliberately not done

**Task one and task two are both outstanding and need a second pass.** Eleven
threads have not yet posted round-2 notes: Torchbearer (10), The Absalom
Inheritance (11), Coffee Shop Sim (12), Daredevil (13), Integer Foundry (14),
The Fracture Cycle (15), Final Grade Checker (16), Image to PDF (17), Name
Picker (18), Schedule Visualizer/Browser (19), Seating Chart Generator (20).
Writing `gvb-site-handoff-v9.md` or applying shared-file requests now would
mean acting on nine of twenty threads and missing whatever the other eleven
ask for — including any new `gvb-save.js` gaps, board `href` changes, or
preview requests they raise. The prompt is explicit that this is worse than
waiting.

Did not fix the `newindex.html`/`sync-social-tags.mjs` live problem this
session, even though it's independent of the other eleven threads in the
sense that no notes file's request depends on it. The prompt's own text
files it under task one; leaving it there rather than jumping the gate on my
own judgment call, since fixing the regex touches the same notice markup that
board `href` changes from the remaining eleven threads could also touch.

## Next session

Ordered by value per effort, for whoever runs the second pass once all twenty
project notes files exist:

1. **Fix the `waitForFunction` bug across `Tools/board-check`** — three
   independent reports, exact fix already drafted (Golden Hour's
   `page.__engine` branch), exact call sites already collected (Fourth
   Quarter's list). This unblocks `npm run games`/`npm run previews`
   verification for everything else in task one, so do it first.
2. **Fix `newindex.html`'s offsite font hotlinks and `sync-social-tags.mjs`'s
   regex**, per this prompt's own live-problem section — needs a decision on
   what `newindex.html` actually is (board redesign in progress? vendor its
   fonts like `index.html`/`404.html` did under locked decision #43? drop the
   notice card pointing at it until it's finished?) before the regex fix,
   since the regex fix depends on what the final notice markup looks like.
3. Apply the nine round-2 shared-file requests already on file (waitForFunction
   fix above, Castle Conundrum recapture, gitignore/lockfile question), then
   whatever the remaining eleven ask for.
4. Torchbearer's preview/OG: still no fixture. Still deferred.
5. Bump the version line and write `gvb-site-handoff-v9.md` last, once
   everything above is actually applied and verified — not before.
