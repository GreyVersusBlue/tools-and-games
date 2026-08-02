# Refresh — round 2 notes

This refresh ran after prompt 21's round-2 pass completed on its own branch and was merged into
`main`. All twenty project threads (01–20) had posted round-2 notes, and prompt 21 had run twice
(a partial pass that correctly stopped early, then a full pass) — applied every shared-file
request, fixed a live site-wide breakage and a repo-wide `puppeteer-core` bug, bumped the site to
version 10, and written `gvb-site-handoff-v9.md`. This refresh also carries two new durable process
rules, added to prompt 22 itself at Devon's explicit request: projects with nothing outstanding now
move to `Claude Prompts/Stable/`, and projects with a genuine open decision for Devon now carry a
"Questions for Devon" block directly in their own prompt file.

**A note on how this file came to exist.** This round's refresh was done twice, independently, by
two separate sessions. A first pass ran on `origin/claude/prompts-project-review-dvo3zj`, a remote
branch that was never merged — everything above this note, and the bulk of the refreshed prompts,
is that session's work. A second session (mine) started this same refresh from scratch, discovered
the unmerged branch partway through its own survey, and — per Devon's explicit direction — adopted
that branch's work as the base rather than duplicating it, then layered its own findings on top.
Those findings are recorded in "What this session added on top" below, and folded into the relevant
projects' prompts (05, 07, 08, 14, 21) and into the tables/lists elsewhere in this file. The
practical difference between the two sessions: this one happened to run on a machine where
`harness.mjs`'s real-Chrome/Playwright branch applies, not the Linux/software-rendered sandbox the
first session (and both rounds' 21 threads) used — so several things the first pass correctly left
as "needs a fair environment" got a real, concrete answer here.

## Where the notes and the repository disagreed

**`gvb-site-handoff-v9.md` is wrong about Corner & Kettle's and Seating Chart Generator's test
inversions.** The handoff's backlog table says both projects' "one expected-failing test each"
(the `gvb-save.js` construction-time-throw assertion, written deliberately to fail once the fix
landed) is "still outstanding two rounds running" and "neither project's round-2 notes mention
inverting it." **This is false, checked by actually running both suites fresh**, not by trusting
either the handoff or the project notes:

```
node Projects/corner-and-kettle/test/smoke-save.mjs   → 166 passed, 0 failed
node Tools/seating-chart/test/smoke-seating.mjs        → 153 passed, 0 failed
```

Both are clean. Reading both projects' own round-2 notes files confirms this directly: Corner &
Kettle's notes describe inverting "one assertion in section 9 ('blocked storage')," and Seating
Chart's notes describe the same thing as its own explicit task one, with the before/after count
(122/1 failed → 123/0, later growing to 153/0 as more assertions were added the same session).
Both projects did the work; the handoff's own author either didn't re-run the suites before writing
that line or misread the two projects' notes. Removed this from both projects' task lists in the
refreshed prompts and from prompt 21's own carried-forward backlog — it was already closed before
this refresh started.

## Fresh numbers

Every figure below is something I ran myself this refresh, except where noted.

| Check | Old figure (round-1 refresh baseline) | Fresh figure this round |
| --- | --- | --- |
| `npm run check` (units) | 329, 0 broken | **335 units, 0 broken** |
| `npm run check` (collisions) | 0, tightest gap 9.2px | **0, tightest gap 3.5px** |
| `npm run social:check` | 22 notices, 22 current | **17 notices, 17 current** (Devon consolidated six Tools notices into one card mid-round; a real, correct drop) |
| `node assets/js/gvb-save.test.mjs` | 50 passed | **50 passed, 0 failed** (unchanged — module untouched functionally this round beyond the fixes already counted in the 50) |
| `npm run tools` | 18 checks | **18 checks, 0 failed** |
| `npm run games` | 126 checks, 0 failed | 119/8 on the Linux sandbox (first-pass session); **137 checks, 3 FAILED, identical on two separate runs** on this session's fair (real Chrome/Playwright) environment — see "What this session added on top" |
| Site version | 9 | **10** |
| Current handoff | v8 | **v9** |
| Locked decisions | through #50 | **through #53** |
| `gvb-save.js` adopters | 11 | **11** (unchanged this round) |
| `Claude Prompts/Stable/` | did not exist | **exists, holds 01 and 15** |

Per-project test suites, all re-run by me directly during this refresh:

| Project | Suite | Result |
| --- | --- | --- |
| 01 Anathema Archive | `Pathfinder/tests/anathema.test.mjs` | 33/33 |
| 04 Aphelion | `test/smoke-state.mjs` | 23/23 |
| 06 Closing Time | `tools/smoke.mjs` | 100/100 |
| 07 The Fourth Quarter | `smoke-campaign.mjs` / `smoke-engine.mjs` | 196/196, 190/190 |
| 08 Golden Hour | `test/smoke.mjs` | 38/38 |
| 09 Faire Weekend | `tests/smoke.mjs` | 783/783 |
| 10 Torchbearer | `test/smoke.mjs` | 95/95 |
| 11 The Absalom Inheritance | `test/smoke.mjs` | 281/281 |
| 12 Corner & Kettle | `test/smoke-save.mjs` | **166/166 — not 1 failed, see "Where the notes and repository disagreed"** |
| 13 Daredevil | `test/smoke-save.mjs` | 53/53 |
| 14 Integer Foundry | `test/smoke-targets.mjs` | 94/94 |
| 14 Integer Foundry | `test/browser.mjs` | **ABORTS — real bug, see "Found but not fixed"** |
| 15 The Fracture Cycle | `test/smoke.mjs` | 26/26 |
| 16 Final Grade Checker | `grade-math.test.mjs` | 130/130 |
| 18 Name Picker | `test/smoke.mjs` | 213/213 |
| 18 Name Picker | `test/browser.mjs` | **ABORTS — real bug, see "Found but not fixed"** |
| 19 Schedule Visualizer | `Tools/schedule/test/smoke.mjs` | 67/67 |
| 20 Seating Chart Generator | `test/smoke-seating.mjs` | **153/153 — not 122/1, see above** |
| 20 Seating Chart Generator | `test/drive-seating.mjs` | **ABORTS — real bug, see "Found but not fixed"** |

## What this session added on top

Everything above this point (and most of what follows) is the first, unmerged-branch session's
work, adopted as the base per Devon's direction. This section is what got layered on afterward, from
running the whole suite twice on a fair (real Chrome/Playwright) environment rather than the Linux
sandbox both rounds' work happened on.

- **Castle Conundrum's preview recapture is unblocked and done, not just theoretically possible.**
  `npm run play` passed all 32 beats with real movement; `npm run previews castle-conundrum` reached
  gameplay at 6.48m off the gatehouse (the requested 6.4m standoff). Fresh candidates are sitting in
  `Tools/board-check/candidates/`, `chosen.json` already names a frame. Prompt 05's task two rewritten
  from "attempt this from a fair environment" to "look at what's already there and promote."
- **Golden Hour's wading/footprint beats: verified for real, and they fail — but the bug is in
  `play-games.mjs`, not Golden Hour's code.** Reproduced twice, identical (eye y 7.85→10.08/10.09
  instead of settling; 0 footprint instances). The suite leaves the camera heading inland (two prior
  look-tests, no re-aim before the wading test) so `KeyW` walks away from the sea instead of into it.
  Golden Hour's own `test/smoke.mjs` (38/38) already proves the game logic is correct in isolation.
  Moved this from prompt 08's task list to prompt 21's — see below.
- **The Fourth Quarter's Real Estate walk-to-station beat: verified for real, and it fails — also not
  a game bug.** `drive.mjs`'s `walkTo()` steers via a raw `camera.rotation.set()` write that Fourth
  Quarter's own per-frame camera code (`player.js:182-184`) silently overwrites every frame — exactly
  what locked decision #35 already warns about for any game that doesn't use `PointerLockControls`.
  Moved from prompt 07's task list to prompt 21's.
- **Daredevil's Stunt Run timeout (flagged in `gvb-site-handoff-v9.md` §4 as one of several
  environment-sensitive findings) does not reproduce on a fair environment.** `smoke-page.mjs` passed
  44/44 clean including four stunt-run results, no retry needed. Confirms it was this sandbox's
  rendering slowness, consistent with the Castle Conundrum/Golden Hour/Fourth Quarter pattern. No
  prompt change needed — 13-daredevil.md never listed it as an open item to begin with.
- **Integer Foundry's `test/browser.mjs` engine-mismatch bug has three more instances than the first
  pass found.** The first session's survey (and `gvb-site-handoff-v9.md` §3) named only line 199.
  Direct inspection this session found the identical `waitForFunction(fn, null, opts)` shape at
  lines 302-304, 315-317, and 349-351 too — four sites total, same fix (`drive.mjs`'s `waitFor()`).
  Updated prompt 14's task one and house rules to cover all four.
- **A new environment-specific false positive, found and written into prompt 21, not fixed (outside
  a refresh session's boundary):** `npm run social:check` reports 5 pages "out of date" on a Windows
  checkout with `core.autocrlf=true` even though their content is byte-for-byte correct — the
  generator joins lines with `\n`, but autocrlf rewrites the most-recently-checked-out files to
  `\r\n`. Verified by hand for `daredevil/index.html`: every generated field matches exactly, only
  line endings differ. Needs either a `.gitattributes` entry or a normalizing comparison in
  `sync-social-tags.mjs` — flagged in prompt 21's own file rather than fixed here.

None of this contradicts the first session's work — it answers questions that session correctly
left open pending a fair environment, and finds one new thing (Integer Foundry's extra call sites)
its survey didn't reach. Two prompts (05, 08, 07, 14, 21) got edited again on top of the first
session's rewrite to reflect it; nothing in "What I changed in each prompt" below needed reverting.

## What I changed in each prompt

- **01 Anathema Archive** — moved to `Stable/`. Verified "nothing outstanding" fresh (suite still
  33/0). Added a "Questions for Devon" block for the `Pathfinder/data/` shared-interface question,
  raised repeatedly by 10 and 11 but owned by 01's boundary.
- **02 Pathfinder Campaigns** — closed the merge-with-03 recommendation (Devon decided
  "harmonize, don't share" this round); documented the `[shared]` comment markers; promoted the
  generator's Chronological-view sync as the only remaining task.
- **03 Pathfinder Characters** — same merge closure, documented from this side (the session that
  actually did the harmonize work with Devon's sign-off); the `</style>`-truncation bug it found
  and fixed is now a house rule.
- **04 Aphelion** — marked the EVA distance readout done; kept touch/gamepad input as the one
  remaining (still no forcing signal).
- **05 Castle Conundrum** — promoted the hall-table/statue-in-wall bug to task one with exact
  numbers; documented the preview recapture as blocked by environment (locked decision #53), not
  neglect; found via direct grep that `play-castle.mjs`'s own engine-mismatch fix is bigger than
  the handoff's "one-line" description (12 `waitForTimeout` calls, 3 `textContent` calls, not just
  the one `waitForFunction`) and wrote the exact fix using `drive.mjs`'s exported helpers.
- **06 Closing Time** — marked all four previous tasks done; kept the per-client filter exactness
  and the post-ending "what's next" as the small remaining items.
- **07 The Fourth Quarter** — marked the venue-ladder door, seat-count fix, audio conversion, and
  mute toggle done; added a "Questions for Devon" block for the day-based difficulty curve
  decision; flagged that its own new Real Estate suite needs re-verification from a fair
  environment.
- **08 Golden Hour** — marked 4 of 5 backlog items done; kept the real low-end-GPU measurement and
  dune grass as remaining; flagged its own new beats need re-verification from a fair environment.
- **09 Faire Weekend** — marked adoption, weekend-shape, and the wiring audit done; promoted mobile
  tap targets and the three-round-deferred layout review to the top.
- **10 Torchbearer** — marked Assurance, the potion fix, Shield Block, and the preview (now applied
  by prompt 21) all done; kept the three feature-scoped inert hooks (Feint, reload, edge-outwit) as
  the real remaining work.
- **11 The Absalom Inheritance** — marked the second area done; promoted character creation to
  task one as the single highest-value item now that there's more content to replay through.
- **12 Corner & Kettle** — marked all five of the previous round's tasks done, including the test
  inversion (corrected from the handoff's wrong claim); added the newly-found `drive-save.mjs`
  engine-mismatch bug (8 instances) as task one.
- **13 Daredevil** — marked the restructure, Work the Crowd, and the Ruthie prose fixes done;
  documented the new `Projects/daredevil/` file layout and the redirect-stub pattern; kept the
  gzip-remeasurement and broader prose sweep as remaining.
- **14 Integer Foundry** — marked the difficulty-curve rework done; added the newly-confirmed
  `test/browser.mjs` engine-mismatch bug (line 199, still present, matches the handoff's own
  finding) as task one.
- **15 The Fracture Cycle** — moved to `Stable/`. Verified "nothing outstanding" fresh (suite still
  26/0, zero edits made this round per its own notes).
- **16 Final Grade Checker** — marked the QP-rounding fix, CSV export, and add-row button done;
  added a "Questions for Devon" block for the report-card-revisit question and the QP
  threshold-spacing verification; kept the screenshot gap (two rounds running) as a task.
- **17 Image to PDF** — marked the rotation control done; kept the EXIF-on-a-real-photo
  verification (two rounds without a camera) and the screenshot gap as remaining.
- **18 Name Picker** — marked the browser suite and the history day-boundary decision done; added
  the newly-found `test/browser.mjs` engine-mismatch bug (both `waitForFunction` and multiple
  `textContent` calls) as task one.
- **19 Schedule Visualizer** — marked the full simulation-module read and the PDF-size fix done;
  closed the committed-schedule-data question (Devon: leave it); added a "Questions for Devon"
  block for the storage-quota decision blocking `gvb-save.js` adoption; promoted the restructure
  (now unblocked) to task one.
- **20 Seating Chart Generator** — marked all four of the previous round's tasks done, including
  the test inversion (corrected from the handoff's wrong claim); added the newly-found
  `drive-seating.mjs` engine-mismatch bug (`textContent` and `isHidden`) as task one.
- **21 General Site Improvements** — rewrote heavily. Documented both passes this round (partial,
  then full); the live `newindex.html`/`sync-social-tags.mjs` fix; the `waitForFunction` fix and
  its rendering-environment follow-on finding (locked decision #53); the three resolved Devon
  decisions; the new cross-cutting bug-class finding (three more project-owned instances beyond
  what its own fix reached); the new "Questions for Devon" convention and how it interacts with the
  handoff. Version bump target is now 10→11, handoff target `gvb-site-handoff-v10.md`.
- **22 Refresh prompts** — not rewritten (per its own rule), but edited to add the two durable
  process rules at Devon's explicit request: the `Stable/` folder convention and the "Questions for
  Devon" block convention, plus matching updates to the archive/survey/verification/notes-heading
  sections.

## Stable/active moves

- **01 Anathema Archive** → moved into `Stable/`. Verified: test suite 33/0 fresh, `renderNpc`
  sweep and the FABLE-PROGRESS comment fix both confirmed on disk, all three of its own tasks from
  the previous refresh closed.
- **15 The Fracture Cycle** → moved into `Stable/`. Verified: test suite 26/0 fresh, its own round-2
  session made zero edits and explicitly re-confirmed round 1's claims rather than assuming them.

No project moved back out of `Stable/` this round — this is the first round the folder exists.

## Questions raised for Devon

- **01 Anathema Archive**: is `Pathfinder/data/` a published interface or private to prompts
  01-03? Raised a fourth and fifth time this round (Torchbearer, The Absalom Inheritance). Still
  open — not answered this round.
- **07 The Fourth Quarter**: should the night loop have a day-based difficulty curve, and what
  shape? New this round (rent-by-tier answered half the question; the day-based half is still
  open). Not answered this round.
- **16 Final Grade Checker**: does any report card graded in the QP-rounding-bug window need
  revisiting? Are the QP threshold numbers themselves right? Both new this round (the rounding
  *direction* was answered directly by Devon mid-round — that part is resolved and removed from
  the question; the two remaining sub-questions are still open).
- **19 Schedule Visualizer**: how should `gvb-save.js` storage quota be handled for this project's
  unusually large save state? Carried forward from round 1, still open, still blocking task six's
  adoption.

Three questions were resolved and removed this round (not carried into any "Questions for Devon"
block, since they're now closed): the Pathfinder Campaigns/Characters merge (harmonize, don't
share), the committed schedule data (leave it), and the Final Grade Checker's rounding *direction*
(quality points don't round up at .5, unlike the percentage average).

## Projects that are done

**01 Anathema Archive** and **15 The Fracture Cycle** — both moved to `Claude Prompts/Stable/` this
round, both verified against the live repo rather than trusted on their own notes' say-so. See
"Stable/active moves" above.

No other project reached that bar. Several (10, 12, 20) closed every task from their previous
round's list, but each still has a real next item (feature-scoped inert hooks, a playthrough
re-measurement, a cosmetic geometry fix) rather than nothing at all.

## Projects that never ran

None. All twenty of prompts 01-20 ran this round, and prompt 21 ran twice (as designed) and
applied every request.

## Found but not fixed

- **The `waitForFunction`/`textContent`/`isHidden` engine-mismatch bug class is bigger than prompt
  21's own round-2 fix covered.** Prompt 21 fixed every instance in `Tools/board-check/**` and, in
  the course of that work, additionally found (but correctly did not fix, being outside its
  boundary) the identical bug in `Tools/board-check/play-castle.mjs` (prompt 05's) and
  `Projects/integer-foundry/test/browser.mjs` (prompt 14's). **This refresh's own survey — running
  every project's test suite fresh rather than trusting notes files — found two more instances
  prompt 21's pass never mentioned**: `Tools/name-picker/test/browser.mjs` (both the
  `waitForFunction` shape and multiple `page.textContent()` calls) and
  `Tools/seating-chart/test/drive-seating.mjs` (`page.textContent()` and `page.isHidden()`, both
  Playwright-only). A sixth instance, `Projects/corner-and-kettle/test/drive-save.mjs`, has **eight
  separate occurrences** of the `waitForFunction(fn, null, opts)` shape, the most of any file found.
  All three of these new findings are now written into their respective projects' own prompts as
  task one, with exact line numbers and the fix (import `waitFor`/`textContent` from
  `Tools/board-check/drive.mjs`, which already exports engine-aware versions). Put a note in
  prompt 21's own refreshed file flagging that this bug class turned out broader than first found,
  in case a seventh instance surfaces in a future round's project-owned test file.
- **The handoff/notes disagreement on Corner & Kettle's and Seating Chart's test inversions** — see
  "Where the notes and the repository disagreed" above. Not a code bug, but worth recording as a
  finding: `gvb-site-handoff-v9.md`'s own backlog table is wrong on this one point, and future
  sessions citing it for "what's still outstanding" should verify against the actual test file
  rather than the handoff's summary.
- **Two real bugs in shared test tooling, found by re-running `npm run games` on a fair environment**
  (see "What this session added on top") — `play-games.mjs`'s golden-hour wading-test sequencing,
  and `drive.mjs`'s `walkTo()` raw camera-rotation write. Both written into prompt 21's own file as
  action items, not fixed here — they're `Tools/board-check/**`, outside a refresh session's
  boundary either way.
- **A Windows-checkout `core.autocrlf` false positive in `npm run social:check`** (see "What this
  session added on top") — five recently-touched pages report DRIFT with byte-identical content,
  purely from a line-ending mismatch between the generator (`\n`) and what autocrlf rewrites on
  checkout (`\r\n`). Written into prompt 21's file with the fix direction (`.gitattributes` or a
  normalizing comparison); not fixed here.

## Next round

Roughly in order of value per effort, reading across all twenty-one refreshed prompts:

1. **Prompt 05** (Castle Conundrum), task two — look at the candidates already sitting in
   `Tools/board-check/candidates/` and run `npm run promote`. This is now a five-minute judgment
   call, not an environment-blocked attempt — the highest value-per-effort item on the whole board.
2. **Prompt 05** (Castle Conundrum), task one — the hall table and gothic statue embedded in the
   back wall: a decorative prop that's been fully invisible for at least two rounds, with exact
   numbers already worked out.
3. **Prompt 21**, two small fixes in shared test tooling, both root-caused and ready to apply: the
   golden-hour wading-test camera re-aim in `play-games.mjs`, and a `lookAt`-style steering option
   for `drive.mjs`'s `walkTo()` for games that hand-roll their own camera rotation (Fourth Quarter
   first). Both cheap, both mechanical, both currently blocking real coverage of features that
   already shipped.
4. **Prompt 11** (The Absalom Inheritance) — character creation is now the single biggest gap
   between this and "a CRPG," and there's more content than ever to replay through once it exists.
5. **Prompts 12, 14, 18, 20's own newly-found `waitForFunction`/`textContent`/`isHidden` fixes** —
   each is a small, mechanical, well-scoped fix now that the pattern and the working replacement
   (`drive.mjs`'s exported helpers) are known. Prompt 14 now has four call sites confirmed, not one.
6. **Prompt 09** (Faire Weekend) — mobile tap targets, a real design pass, three rounds overdue.
7. **Prompt 19** (Schedule Visualizer) — the restructure is now unblocked after round 2's full read
   of the simulation module; two sessions is still the right estimate.
8. **Prompt 10** (Torchbearer) — a Feint action unlocks real content (a core PF2e verb this engine
   doesn't have yet) beyond the one feat it was scoped for.
9. **The four open "Questions for Devon" blocks** (01, 07, 16, 19) — none is code, all are cheap for
   Devon to resolve, and each has been carried forward at least once already.
10. Everything else per each prompt's own task list — none of it is urgent, all of it is real.

Skip **prompts 01 and 15** (both in `Stable/`) unless Devon wants to deliberately expand either's
scope.
