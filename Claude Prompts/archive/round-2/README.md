# Archive — round 2

Snapshot of `Claude Prompts/` immediately before prompt 22's round-2 refresh, taken 2026-08-01.
Site version at the time: **10** (`index.html`'s footer read "version 10 · the ledger is square").

This is the round-1-refreshed set of twenty-two prompts, plus every notes file the round-2 sessions
wrote. Prompt 21 (General Site Improvements) ran twice this round — a first pass that correctly
stopped after only nine of twenty project threads had posted notes, and a second, full pass once all
twenty existed, which applied every shared-file request, fixed two live site-wide breakages, and
wrote `gvb-site-handoff-v9.md`. The single `21-general-site-improvements-notes.md` file in this
archive is that second pass's final version; the first pass's text is only in git history (see the
`General Site Improvements: partial pass, tasks one/two deferred` commit if you need it).

## Which prompts produced a notes file

All twenty-one did. Nothing sat idle this round.

## What shipped, one line per project

| # | Project | What shipped |
| --- | --- | --- |
| 01 | Anathema Archive | Built the first test suite (33 checks), swept every NPC shard for the round-1 duplication bug class and found none, fixed a stale roadmap comment. Nothing outstanding. |
| 02 | Pathfinder Campaigns | Built a JSON-to-HTML generator script so the page stays hand-authored but not hand-typed; the campaigns/characters merge recommendation stands a third time. |
| 03 | Pathfinder Characters | With Devon's sign-off, harmonized (not merged) the two pages' shared chrome with `[shared]` drift-guard comments — this round's answer to the recurring merge question, and the merge question is now closed as "harmonize, don't share." |
| 04 | Aphelion | Built the EVA distance-only signal readout. Touch/gamepad input still waiting on an actual reason. |
| 05 | Castle Conundrum | Shrank shipped assets 46→29 MB, fixed a wall-scale bug that also broke the hall's proportions, gave columns and braziers real geometry/colliders. Found (not fixed) the hall table and gothic statue embedded in the back wall. |
| 06 | Closing Time | Gave the career a real ending at day 336, collapsed the mobile topbar, added a real Ledger filter, fixed a content-removal crash. |
| 07 | The Fourth Quarter | Gave the fully-built venue ladder an actual door into the game (a station, a panel, a dark-night flow), fixed a seat-count lie and a room-rebuild leak, made rent scale with venue tier. |
| 08 | Golden Hour | Wading depth that rides the tide, footprints in wet sand, a second sand texture to break tiling — 4 of 5 backlog items done with zero new asset bytes. |
| 09 | Faire Weekend | Adopted `gvb-save.js`, gave the weekend a real day-of-week shape, click-tested ten previously-unexercised UI actions. Mobile tap targets still under the touch minimum. |
| 10 | Torchbearer | Fixed Assurance, fixed the potion-heal bug (real, reachable, silently under-healing), fixed Shield Block double-granting, committed a real save fixture that unblocked its preview. |
| 11 | The Absalom Inheritance | Built a second area (the Reliquary) — five of eight engine files touched to give "which area is the PC in" a real answer — and found + fixed a stall bug the balance harness caught that a browser playthrough never would have. |
| 12 | Corner & Kettle (Coffee Shop Sim) | Fixed the flat difficulty curve at high prestige, closed the mid-shift reload exploit, made baristas hand off finished drinks instead of auto-serving, added keyboard shortcuts. |
| 13 | Daredevil | Restructured the largest file in the repo (356 KB monolith → 4 files) now that a full regression suite existed to prove nothing broke, wired the previously-unreachable Work the Crowd minigame, fixed two continuity holes in the prose. |
| 14 | Integer Foundry | Replaced a magnitude-based difficulty ramp with a tile-cost-based one, fixing a stretch (orders 15-30) that had gone flat forever once a multiply unlock existed. |
| 15 | The Fracture Cycle | Verified everything round 1 shipped is still true; made zero edits. Second round running with nothing outstanding. |
| 16 | Final Grade Checker | Asked Devon directly and found a real grading bug: quality points don't round up at .5, only the percentage average does. Fixed the asymmetry; replaced the dead xlsx export with CSV; added an add-row button. |
| 17 | Image to PDF | Added a per-page 90°-rotation control for sideways scans, verified pixel-correct against real generated PDFs. |
| 18 | Name Picker | Built the browser suite round 1 flagged as the top gap (44 checks); decided and shipped `np_history`'s day-boundary clear. |
| 19 | Schedule Visualizer/Browser | Read the entire ~4,400-line pathfinding/congestion/playback engine for the first time — confirmed it's a real traffic model, not a toy. Fixed a 21 MB PDF export down to ~190 KB and two accessibility gaps. Restructure still pending. |
| 20 | Seating Chart Generator | Added named room zones with a solver constraint, four layout presets, and a print-all-sections feature. |
| 21 | General Site Improvements | Full pass, second attempt this round. Fixed a live `newindex.html`/`sync-social-tags.mjs` breakage Devon introduced outside the prompt process; fixed a `puppeteer-core` incompatibility that had broken `npm run games` for every game all round; applied every shared-file request from all twenty threads; found (and could not fix, environment-limited) that this sandbox's software-rendered three.js is too slow/inconsistent for real-time movement assertions to be trusted here. Version bumped 9→10, wrote `gvb-site-handoff-v9.md`. |
| 22 | Refresh prompts | This file's own prompt. Round 1's refresh is archived at `archive/round-1/`. |

Full detail for any of the above is in this folder's own `notes/<name>-notes.md`, not repeated here.
