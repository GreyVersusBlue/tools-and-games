# Refresh — round 1 notes

This is prompt 22's first run. Round 1 (prompts 01–21) had fully completed before this session
started: all twenty project threads had written notes, and prompt 21 had applied every shared-file
request, bumped the site to version 9, and written `gvb-site-handoff-v8.md`. So this refresh covers
a complete round, not a partial one.

## Where the notes and the repository disagreed

Nothing from round 1's own work disagreed with what's on disk — every claim I spot-checked (line
counts, byte sizes, test-suite pass counts, hotlink greps, storage keys, restructure paths) matched
what the twenty-one notes files reported. That itself is worth recording: round 1's sessions were
unusually careful about "should work" vs. verified fact.

**The one real disagreement is external to round 1 entirely.** While this refresh was running,
Devon committed directly to the repo (not through any of the twenty-one prompts): a new
`newindex.html` (554 lines, hotlinks `fonts.googleapis.com`/`fonts.gstatic.com`) and a change to
`index.html` that links to it and alters the notice markup. As of this writing:

- `cd Tools/board-check && npm run check` reports **1 broken** (`newindex.html`'s offsite hotlinks).
- `npm run social:check` reports **`only parsed 17 notices out of index.html — the notice markup has
  changed shape, fix the regexes rather than shipping a partial sweep`** — a hard failure, not a
  drift warning.

This is not a round-1 regression and none of the twenty project threads caused it or could have —
it landed after round 1 finished. It's squarely in prompt 21's boundary (`index.html` and, by
extension, `newindex.html`), so I added it to prompt 21's refreshed file as a "live problem found
while refreshing this prompt" section, ahead of the normal task list. Two of the twenty rewrite
sessions (Name Picker's and Seating Chart's refreshes) independently ran into the same breakage
mid-verification and handled it correctly on their own — noting it honestly as a current, unrelated
fact rather than either hiding it or wrongly asserting a clean "0 broken" they could no longer
reproduce. I did not touch `newindex.html` or `index.html` myself; both are outside my boundary
(`Claude Prompts/**` only).

## Fresh numbers

Every figure below is something I ran myself, except where noted otherwise.

| Check | Old figure (round 1's baseline, v7-era) | Fresh figure this round |
| --- | --- | --- |
| `npm run check` (units) | 235 | 327–329 at the time most prompts were refreshed; now **331 units, 1 broken** because of the `newindex.html` issue above (was 0 broken for the great majority of this session) |
| `npm run check` (collisions) | 0, tightest gap 7.1px | 0, tightest gap **9.2px** |
| `npm run social:check` | 23 notices, 23 current | **22 notices, 22 current** for most of this session; now failing outright to parse (see above) |
| `node assets/js/gvb-save.test.mjs` | 39 passed | **50 passed, 0 failed** |
| `npm run tools` (new this round) | did not exist | **18 checks, 0 failed** |
| `npm run games` | 94 checks | **126 checks, 0 failed** (per prompt 21's own end-of-round-1 verification; not rerun by me — it opens a real visible browser window) |
| `npm run play` (Castle Conundrum) | 22 beats | **29 beats** |
| Bestiary Gallery | present, 23,894 requests | **deleted** |
| Site version | 8 | **9** |
| Live offsite hotlinks, repo-wide | 15 pages | **0** (confirmed by a fresh repo-wide grep; the only hits left are historical comments saying what used to be hotlinked, not live tags) — except `newindex.html`, which is new and not one of the twenty numbered projects |
| `gvb-save.js` adopters | 1 (The Fourth Quarter) | **11** |

Per-project test suites, all re-run by at least one of the rewrite sessions and confirmed current
as of this refresh:

| Project | Suite | Result |
| --- | --- | --- |
| 04 Aphelion | `test/smoke-state.mjs` | 23/23 |
| 05 Castle Conundrum | `npm run play` | 29/29 |
| 06 Closing Time | `tools/smoke.mjs` | 76/76 |
| 07 The Fourth Quarter | `test/smoke-campaign.mjs` / `smoke-engine.mjs` | 189/189, 190/190 |
| 08 Golden Hour | `test/smoke.mjs` | 33/33 |
| 09 Faire Weekend | `tests/smoke.mjs` | 737/737 |
| 10 Torchbearer | `test/smoke.mjs` | 86/86 |
| 11 The Absalom Inheritance | `test/smoke.mjs` / `test/balance.mjs 2000` | 244/244, 59.3% (band 45–90%) |
| 12 Corner & Kettle | `test/smoke-save.mjs` / `test/drive-save.mjs` | 161/162 (1 expected failure — see below) / 90/90 |
| 13 Daredevil | `test/smoke-save.mjs` / `test/smoke-page.mjs` | 53/53, 44/44 |
| 14 Integer Foundry | `test/smoke-targets.mjs` / `test/browser.mjs` | 90/90, 56/56 |
| 15 The Fracture Cycle | `test/smoke.mjs` | 26/26 |
| 16 Final Grade Checker | `grade-math.test.mjs` | 119/119 |
| 18 Name Picker | `test/smoke.mjs` / `test/blocked-storage.html` | 207/207, 10/10 |
| 19 Schedule Visualizer | `Tools/schedule/test/smoke.mjs` | 42/42 |
| 20 Seating Chart Generator | `test/smoke-seating.mjs` / `test/drive-seating.mjs` | **122/123 (1 expected failure — see below)** / 81/81 |

**Two expected failures, both by design, both already flagged as each project's own next task.**
Corner & Kettle's `smoke-save.mjs` and Seating Chart's `smoke-seating.mjs` each contain one
assertion written on purpose to expect the *old*, pre-fix `gvb-save.js` behavior (a
construction-time throw). That fix landed this round (locked decisions #47–#49), so both
assertions now fail exactly as their own authors predicted ("it will fail loudly and want
inverting when the fix lands"). This isn't a regression; it's each project's own test file
correctly detecting that its target moved. I put "invert this one assertion" as task one in both
projects' refreshed prompts, worded as their own remaining loose end, not a cross-project request.

## What I changed in each prompt

Full detail is in each prompt file and in the individual completion summaries; this is the one-line
version.

- **01 Anathema Archive** — marked the three renderer bugs and the orphaned-JSON deletion as fixed
  history; promoted "build a test suite" to task one; corrected the storage-key count.
- **02 Pathfinder Campaigns** — marked fonts/heading/ARIA/contrast fixes as done; task one is now
  the campaigns/characters merge recommendation, explicitly framed as a joint session, not solo.
- **03 Pathfinder Characters** — same pattern as 02, independently confirming the same merge
  recommendation; marked its own fixes as done.
- **04 Aphelion** — both original tasks (fonts, `gvb-save.js`) are done; promoted the EVA
  direction-hint and touch/gamepad items as the only remaining (low-urgency) work.
- **05 Castle Conundrum** — corrected the wall-blur root cause in place (was mis-diagnosed in an
  earlier handoff as a UV/resolution bug; it's a missing `magFilter` + site-wide anisotropy issue,
  now fixed); promoted "shrink what ships" and the hall rebuild to the top.
- **06 Closing Time** — marked adoption and both content-drift bugs as fixed; promoted the
  year-336 career-ending idea and the mobile topbar as the real remaining work.
- **07 The Fourth Quarter** — marked the 3-mount save bar and the 7-bug legacy-save audit as done;
  task one is now giving the (fully-written, currently unreachable) venue ladder a door into the
  game.
- **08 Golden Hour** — marked all of round 1's fixes and new beach content as done; promoted
  wading-depth and sand-tiling as the next concrete items.
- **09 Faire Weekend** — the report-phase save policy is now locked decision #45, cited directly;
  task one is the fully-scoped `gvb-save.js` adoption (the plan was already written out last
  round, this is a checklist now).
- **10 Torchbearer** — fixed every stale `Projects/Torchbearer files/` boundary path to
  `Projects/torchbearer/`; task one is still the preview/OG card, pending a real playthrough save.
- **11 The Absalom Inheritance** — marked the unwinnable→59.3%-winnable fix, the ES-module
  restructure (URL unchanged), and the save/keyboard/mobile work as done; task one is a second
  content area.
- **12 Corner & Kettle** — marked adoption and both accessibility fixes as done; task one is
  inverting its own now-stale test assertion (see above), task two is the two-line prestige-floor
  fix.
- **13 Daredevil** — marked all 5 previously-unfixable wiring bugs as fixed (the game could not be
  completed by anyone before this round); fixed the stale Torchbearer path reference; task one is
  the now-safe restructure into `Projects/daredevil/`.
- **14 Integer Foundry** — marked the unfillable-order fix as done; dropped three stale
  cross-project "next session" items after confirming each was actually done by its own project
  (Closing Time's adoption, The Fourth Quarter's save-bar move, Castle Conundrum's wall fix); the
  one genuinely-own remaining item is revisiting the difficulty curve.
- **15 The Fracture Cycle** — **marked "nothing outstanding as of round 1" at the top**, verified
  against the live repo (all 5 endings reachable, save round-trips, zero offsite requests, 26/26
  tests). Droppable from round 2 unless Devon wants to expand scope.
- **16 Final Grade Checker** — kept the grading-arithmetic finding prominent at the top (this is
  the single most consequential finding of the whole round); task one is checking the
  quality-point thresholds against the real CCPS policy document.
- **17 Image to PDF** — marked jsPDF vendoring and the functional gaps (JPEG/WEBP, quality
  presets, EXIF rotation, reorder) as done; task one is a rotation control for sideways scans.
- **18 Name Picker** — marked the full 13-key `gvb-save.js` adoption and the fairness-bug fix as
  done; task one is a `play-games.mjs` browser suite (transcription of already-hand-run beats).
- **19 Schedule Visualizer / Schedule Browser** — fixed every reference to the two renamed files;
  kept the committed-schedule-data security flag exactly as prominent as it was; task one is still
  that same Devon decision.
- **20 Seating Chart Generator** — marked adoption, print rewrite, keyboard, and solver fixes as
  done; task one is inverting its own now-stale test assertion (see above).
- **21 General Site Improvements** — rewrote heavily myself (not delegated). Collapsed the four
  "do now" round-1 tasks into "done"; the only remaining independent task is a contingent
  Torchbearer preview pickup; added the `newindex.html`/`index.html` live problem found during
  this refresh; kept both Devon-decision items (grading correction, schedule data) prominent;
  version bump target is now 9→10, handoff target is `gvb-site-handoff-v9.md`.

## Projects that are done

**15 The Fracture Cycle** — marked at the top of its own prompt as having nothing outstanding as
of round 1 (2026-07-30), verified against the live repo this round. Droppable from round 2 unless
Devon wants to expand its scope (a 4th prong, deeper side content) — that would be a deliberate
scope decision, not a bug-fix session.

No other project reached that bar. 02/03, 04, 11, 13 all shipped large, complete-feeling sessions
in round 1, but each still has a real, concrete next item (a cross-file merge, an EVA content
addition, a second area, a restructure) rather than "nothing left."

## Projects that never ran

None. All twenty of prompts 01–20 ran in round 1, and prompt 21 ran last and applied every request.

## Found but not fixed

- **The `newindex.html`/`index.html` regression** (see "Where the notes and the repository
  disagreed," above). Not fixable by me — outside `Claude Prompts/**`. Put in prompt 21's task
  list, at the top, ahead of its normal apply-requests/write-handoff pair.
- **The Final Grade Checker's grading-arithmetic correction** — whether any real report card graded
  before the fix needs revisiting. Not code; Devon's call. Surfaced again at the top of prompt 21.
- **The committed schedule data in `Tools/schedule-browser.html`** — the school-security question
  from round 1. Not code; Devon's call. Surfaced again at the top of prompt 21 and at the top of
  prompt 19's own file.
- **The Pathfinder Campaigns/Characters merge recommendation** — raised independently by both
  prompts 02 and 03 in round 1, reconfirmed by this refresh (both prompts still recommend it, for
  the same reasons, and still correctly refuse to attempt it solo). Not a bug — a standing
  suggestion for a joint session, noted in prompt 21's handoff-writing task so it doesn't go quiet
  a third time.

## Next round

Roughly in order of value per effort, reading across all twenty-one refreshed prompts:

1. **Prompt 21's live-problem fix** (`newindex.html`/`index.html`) — this is blocking two of the
   site's own health checks right now and should probably run before anything else, regardless of
   round-2 sequencing, since `npm run check`/`social:check` are the baseline every other prompt's
   verification section depends on.
2. **Prompt 07** (The Fourth Quarter) — the venue ladder is fully written, tested, and wired up
   except for one missing UI station. Cheapest large win on the board.
3. **Prompt 16** (Final Grade Checker) — ten minutes against the real CCPS policy document closes
   the last unverified assumption in a tool that sets report card grades.
4. **Prompt 09** (Faire Weekend) — the `gvb-save.js` adoption is fully scoped, essentially a
   checklist.
5. **Prompt 13** (Daredevil) — the restructure is now safe (a full regression suite exists to
   diff before/after), and it's the largest single file in the repo.
6. **Prompt 11** (The Absalom Inheritance) — a second content area is the cheapest way to double
   play time, and the content format is already built for it.
7. **Prompts 12 and 20** — one-line test inversions, five minutes each, unblocks a clean
   `gvb-save.js` adopter list.
8. **Prompt 10** (Torchbearer) — still waiting on someone to actually play the 9-step builder once
   to generate a save fixture; everything downstream of that is transcription.
9. Everything else, per each prompt's own task list — none of it is urgent, all of it is real.

Skip **prompt 15** unless Devon wants to deliberately expand its scope.
