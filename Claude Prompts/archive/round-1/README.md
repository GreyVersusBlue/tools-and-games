# Archive — round 1

Snapshot of `Claude Prompts/` taken by prompt 22 immediately after round 1 finished:
prompts 01–20 ran in parallel, then prompt 21 applied their shared-file requests,
bumped the site to **version 9**, and wrote `gvb-site-handoff-v8.md`. This folder
holds the complete contents of `Claude Prompts/` as it stood at that moment — all
22 prompt files, the process README (kept here as `process-README-snapshot.md` to
avoid colliding with this round summary), and the whole `notes/` folder — before
prompt 22 refreshed anything.

Site version in `index.html` at archive time: **version 9** ("the tavern is open").

## Which prompts produced a notes file

All twenty of prompts 01–20 ran and each wrote its own notes file, plus prompt 21.
Nothing was left pending going into this refresh. (Prompt 22 has no notes file in
this archive — this snapshot was taken as prompt 22 started, before it wrote one.)

| # | Prompt | Notes file |
| --- | --- | --- |
| 01 | Anathema Archive | done |
| 02 | Pathfinder Campaigns | done |
| 03 | Pathfinder Characters | done |
| 04 | Aphelion | done |
| 05 | Castle Conundrum | done |
| 06 | Closing Time | done |
| 07 | The Fourth Quarter | done |
| 08 | Golden Hour | done |
| 09 | Faire Weekend | done |
| 10 | Torchbearer | done |
| 11 | The Absalom Inheritance | done |
| 12 | Coffee Shop Sim (Corner & Kettle) | done |
| 13 | Daredevil | done |
| 14 | Integer Foundry | done |
| 15 | The Fracture Cycle | done |
| 16 | Final Grade Checker | done |
| 17 | Image → PDF | done |
| 18 | Name Picker | done |
| 19 | Schedule Visualizer/Browser | done |
| 20 | Seating Chart Generator | done |
| 21 | General Site Improvements | done — applied every shared-file request, bumped version, wrote the handoff |

## One line per project — what shipped

- **01 Anathema Archive** — fixed three Foundry-token rendering bugs (double-printed
  heighten text, a `@Damage` parenthesis-parsing bug, missing `@Embed` handling),
  deleted an orphaned duplicate NPC JSON file. No save, no restructure, no shared-file
  requests.
- **02 Pathfinder Campaigns** — vendored fonts, fixed a heading-order gap, added ARIA
  tab semantics to both tab widgets, nudged one contrast ratio. Recommended (not
  requested) a future merge with `characters.html`.
- **03 Pathfinder Characters** — vendored fonts, fixed the same heading-order gap,
  fixed one contrast failure. Same merge recommendation as 02, independently arrived at.
- **04 Aphelion** — vendored fonts, adopted `gvb-save.js` (`aphelion-save-v1`), added
  arrow-key look for pointer-lock-denied browsers, added EVA content (2 POIs, 3 log
  entries), wrote a 23-check smoke suite. Requested `play-games.mjs` save-bar beats
  (applied by 21).
- **05 Castle Conundrum** — fixed the blurry-wall bug (texture magnification filter,
  not a UV/resolution problem), gave the braziers a physical model and un-buried them
  from inside walls, fixed a floating candelabra, moved the Scholar out of the table.
  `play-castle.mjs` grew 22→29 beats. Requested a preview/OG recapture (applied by 21).
- **06 Closing Time** — adopted `gvb-save.js`, found and fixed two content-drift bugs
  (a listing/neighborhood added after a save existed could crash or silently freeze).
  Vendored fonts. Rewrote `tools/smoke.mjs` to actually assert (was print-only).
  Requested three `gvb-save.js` gaps (all applied by 21) and `play-games.mjs` beats
  (applied).
- **07 The Fourth Quarter** — added save-bar mounts to the box score and Tonight
  panel (closing v7 §9's open item), a dev-menu "skip to last call," and a full
  legacy-save arithmetic audit (7 real bugs fixed in `repairCampaign`). Requested
  `play-games.mjs` beats (applied).
- **08 Golden Hour** — audit-driven session (no prior backlog): fixed a sun-glint
  blending bug, fixed `camera.rotation.order` (the driver was reading a false
  heading), added arrow-key look, added beach content (groyne, boulders, driftwood,
  460-piece wrack line, a moving sun), wrote a 33-check smoke suite. Requested
  `play-games.mjs` beats and a preview repromote (both applied).
- **09 Faire Weekend** — decided and shipped the report-phase save policy ("a day is
  final once the gates close"), vendored fonts, grew the smoke suite 684→737 checks.
  Requested a `play-games.mjs` comment fix (applied); deliberately deferred its own
  `gvb-save.js` adoption to next round.
- **10 Torchbearer** — first session. Restructured `Projects/Torchbearer files/` into
  `Projects/torchbearer/` (git mv, URL unchanged), made the two bundled adventure
  packs reachable from the title screen, adopted `gvb-save.js`, fixed a fixed-feat
  bug that meant no Fighter could ever Shield Block, added 8 validator rules, wrote
  an 86-check suite. Requested `mountSaveBar` `filename` support (applied) and a
  preview recipe — explicitly deferred pending a real playthrough save file.
- **11 The Absalom Inheritance** — first session. Found the game was **unwinnable**
  (0/2000 simulated runs), fixed the encounter design (wake sentinels one at a time,
  restore HP at the gate) to 59.3% win rate, restructured into ES modules (URL
  unchanged), adopted `gvb-save.js`, fixed a renderer canvas-sizing bug and a
  mobile-breakpoint bug (0px game board below 900px), added full keyboard play.
  Requested a preview recipe (applied).
- **12 Coffee Shop Sim / Corner & Kettle** — first session. Vendored fonts, adopted
  `gvb-save.js`, found 7 save-related bugs (nested `presets`/`regulars` fields with
  no guards). Requested two `gvb-save.js` fixes (both applied) and a preview (applied).
- **13 Daredevil** — first session, and the largest find of the round: the 207-scene
  game had **never been completable** by any player, due to 5 independent wiring
  bugs (a hub-exhaustion counter that couldn't reach zero, an unrouted minigame
  scene, two flag-gate typos, a missing relationship assignment that hid an entire
  ending, a `res.outcome` vs `res.result` field mismatch). All fixed; game is now
  finishable both ways. Adopted `gvb-save.js`, vendored fonts. Requested a preview
  (applied).
- **14 Integer Foundry** — found the order generator could hand out unfillable
  orders from the 12th order onward (51% unfillable by order 30); replaced with a
  BFS-based reachability solver. Adopted `gvb-save.js` with `slot.autosave` (700ms,
  down from an 8s interval), fixed a grid-resize repair bug, vendored fonts, fixed a
  mobile clipping bug. Requested a `play-games.mjs` seeding removal (applied).
- **15 The Fracture Cycle** — first session. Fixed a genuinely unreachable ending
  (`end_radiant`'s condition could never be met), added an ending-tracker save
  (`fracture-cycle-v1`, deliberately not a mid-story save), vendored fonts, wrote a
  26-check suite. Requested a preview (applied).
- **16 Final Grade Checker** — found and fixed a live grading bug: the "round up at
  .5" rule was actually rounding at .45 at every letter boundary, meaning some
  students were reported a letter grade too high. Wired up a corrected math module
  that existed in git but was never imported. Fixed an importer bug that let a
  system-average column be misread as a real quarter grade. Wrote 119 assertions.
  Requested a `Tools/` sweep script (built as `tools.mjs` by 21).
- **17 Image → PDF** — vendored jsPDF, added JPEG/WEBP input support, added quality
  presets, fixed an EXIF-rotation bug for "Original quality" JPEGs, added per-file
  reorder/remove and per-file error isolation. No shared-file requests.
- **18 Name Picker** — vendored fonts, adopted `gvb-save.js` across all 13 storage
  keys (with a `boxed()` adapter to keep on-disk bytes unchanged), added a "🔒 Data"
  tab for one-click student-data erasure, and fixed the random-pick fairness (was
  independent uniform draws with no memory; now draws without replacement) and a
  biased `sort(() => Math.random()-0.5)` shuffle. Requested two `gvb-save.js` fixes
  (both applied).
- **19 Schedule Visualizer / Schedule Browser** — renamed both dated/versioned
  filenames to permanent ones with redirect stubs left behind, moved the version
  into the page itself (new locked decision #46), vendored fonts, fixed a mobile
  map-scroll bug. **Flagged a possible school-security exposure**: the committed
  `PUBLISHED_DATA` names real EMS staff, rooms, and planning-period schedules
  alongside a floor plan — flagged for Devon's decision, not resolved. Requested two
  board `href` changes (both applied).
- **20 Seating Chart Generator** — adopted `gvb-save.js`, rewrote the print
  stylesheet (was cutting off columns in portrait), added full keyboard operation,
  fixed a solver bug (auto-assign silently dropped all constraints when there were
  more students than desks), added fit-to-window zoom. Requested a `gvb-save.js`
  construction-time-throw fix (applied).
- **21 General Site Improvements** — deleted the Bestiary Gallery (board drops from
  23 to 22 notices), closed the offsite-request measurement blind spot
  (`page.__shimmed` + a static sweep in `check-integrity.mjs`), vendored
  `index.html`/`404.html`'s fonts, reconciled and applied 5 real `gvb-save.js` gaps
  from 4 different adopters, added `tools.mjs` (18 checks over the 6 Tools pages),
  added/fixed 6 games' worth of `play-games.mjs` beats (94→126 checks), captured and
  promoted previews for 4 of 5 preview-less games (Torchbearer deferred, needs a
  real playthrough save), applied every board `href` fix, bumped the version to 9,
  and wrote `gvb-site-handoff-v8.md`.
