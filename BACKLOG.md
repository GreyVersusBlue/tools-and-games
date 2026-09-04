# BACKLOG

The single entry point for open work on greyversusblue.com. Two tiers: a
ranked index you scan, and the ideas underneath it that have no other home.

## Where things stand — start here

**The site is at version 15** (`index.html:575`, and `landing.html:840,861`).
The last thing that shipped is **Bell to Bell Phase 1, "A day with more than
two periods in it" (PR #104)** — the two hardcoded `*5` save slots became a
slot scheme, a period became a row in `data/periods.json`, and a 6th period
was authored to prove the seam. Before it: **this backlog's own consolidation
(PR #102 and #103)**, **The Seal, a studio-style landing mockup at
`landing.html` (PR #101)**, and **the upgrade paths and ten phased wishlists
(PR #100)**, which is where most of the ranking below comes from. No site
version was bumped — Phase 1 shipped no board, tool or page change.

**143 ranked items.** 81 of them are phases in one of the ten project
`WISHLIST.md` files; the other 62 are standalone, and live in Tier 2 below.
Beyond the ranked list there are 223 open bullets in the eleven wishlists'
standing backlogs and 52 open questions for Devon — 418 open items in all.

**Pick up rank 1: `Projects/bell-to-bell` Phase 2, "Kids nobody authored"
(Fable 5.1).** Bell to Bell is the most active project in the repo, it has the
best design doc and the best safety net (`tests/balance.mjs` now simulates a
whole three-period day across five teaching archetypes and three seating
charts), and Phase 1 just built the save format Phase 2 writes generated
rosters into. Two rosters and two tell schedules were the whole game's content
and both were typed by hand; Phase 1 made that three, which is the argument for
automating it rather than authoring a fourth.

**Read this before trusting the order.** Two sources rank the same work
differently, and the table follows `UPGRADE-PATHS.md`'s order because it is
the newest:

- **Daredevil sits at rank 49, and three other sources put it first.**
  `gvb-site-handoff-v10.md` §11, the round-3 refresh notes and prompt 22's
  notes all call the Earl decision "the single biggest open item on the site."
  It is also blocked on Devon (see Questions for Devon, Q3), which is the
  argument for not opening with it.
- Bell to Bell's own `docs/HANDOFF.md` said the next ticket was T8, whisper
  audio, which the wishlist ranks Phase 7 (rank 6).
- The Schedule Visualizer's storage-quota question is Phase 4 (rank 68) here
  and #1 in its own project's notes.
- Six more disagreements of the same kind are listed at the end of Tier 2,
  under **Where the sources disagree**.

**The round system is retired.** For three rounds this repo ran a 22-prompt
parallel split: one prompt per project, each declaring the paths it owned and
the rest of the repo read-only, with the four shared things (`index.html`,
`assets/js/gvb-save.js`, `Tools/board-check/**`, and the generated
`assets/previews` + `assets/og`) belonging to one prompt alone, and every other
session queueing written "Shared-file requests" for it to apply at the end of
the round. It worked, and it is gone: `Claude Prompts/`, the ten
`gvb-site-handoff-v*.md` files and `UPGRADE-PATHS.md` have all been deleted,
their open ideas folded into this file and their record into `HISTORY.md`.
What replaces the concurrency mechanism is three things: the **Ownership**
table in Tier 2, the **Claimed** column below, and the rule in the root
`CLAUDE.md` that shared-file edits now go in the same PR as the project change
rather than into a request queue.

---

# Tier 1 — the ranked index

One line per item, for scanning. `Area` is the folder the work lands in.
`Size` is ¼, ½, 1 or 2+ sessions. `Model` is what the item's own source names
— the wishlists name Claude Opus 5 or Claude Fable 5.1 per phase, and that is
carried here unchanged, not re-decided; `—` means no source named one.
`Claimed` is blank until a session writes its branch name in, and is cleared
after that branch merges.

| Rank | Item | Area | Size | Model | Claimed | Detail |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Phase 2 — Kids nobody authored | `Projects/bell-to-bell` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 2](Projects/bell-to-bell/WISHLIST.md#phase-2--kids-nobody-authored) |
| 2 | Phase 3 — The semester remembers | `Projects/bell-to-bell` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 3](Projects/bell-to-bell/WISHLIST.md#phase-3--the-semester-remembers) |
| 3 | Phase 4 — The bureaucracy answers back | `Projects/bell-to-bell` | 1 | Opus 5 |  | [WISHLIST.md Phase 4](Projects/bell-to-bell/WISHLIST.md#phase-4--the-bureaucracy-answers-back) |
| 4 | Phase 5 — Subject is the weather | `Projects/bell-to-bell` | 1 | Opus 5 |  | [WISHLIST.md Phase 5](Projects/bell-to-bell/WISHLIST.md#phase-5--subject-is-the-weather) |
| 5 | Phase 6 — What the room weighs | `Projects/bell-to-bell` | 1 | Opus 5 |  | [WISHLIST.md Phase 6](Projects/bell-to-bell/WISHLIST.md#phase-6--what-the-room-weighs) |
| 6 | Phase 7 — Things you can notice without holding SHIFT | `Projects/bell-to-bell` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Projects/bell-to-bell/WISHLIST.md#phase-7--things-you-can-notice-without-holding-shift) |
| 7 | Phase 8 — A thumb has never touched this | `Projects/bell-to-bell` | 1 | Opus 5 |  | [WISHLIST.md Phase 8](Projects/bell-to-bell/WISHLIST.md#phase-8--a-thumb-has-never-touched-this) |
| 8 | Phase 1 — Songs you can hear | `Projects/hearth` | 1 | Opus 5 |  | [WISHLIST.md Phase 1](Projects/hearth/WISHLIST.md#phase-1--songs-you-can-hear) |
| 9 | Phase 2 — Decades, not years | `Projects/hearth` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 2](Projects/hearth/WISHLIST.md#phase-2--decades-not-years) |
| 10 | Phase 3 — The migration ladder | `Projects/hearth` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 3](Projects/hearth/WISHLIST.md#phase-3--the-migration-ladder) |
| 11 | Phase 4 — A saga somebody who wasn't watching can read | `Projects/hearth` | 1 | Opus 5 |  | [WISHLIST.md Phase 4](Projects/hearth/WISHLIST.md#phase-4--a-saga-somebody-who-wasnt-watching-can-read) |
| 12 | Phase 5 — The far island becomes a place | `Projects/hearth` | 1 | Opus 5 |  | [WISHLIST.md Phase 5](Projects/hearth/WISHLIST.md#phase-5--the-far-island-becomes-a-place) |
| 13 | Phase 6 — Scarcity that bites | `Projects/hearth` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 6](Projects/hearth/WISHLIST.md#phase-6--scarcity-that-bites) |
| 14 | Phase 7 — Play that reads as play, and four other leftovers | `Projects/hearth` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Projects/hearth/WISHLIST.md#phase-7--play-that-reads-as-play-and-four-other-leftovers) |
| 15 | Phase 8 — Hearth gets a machine that watches it | `Projects/hearth` | ½ | Opus 5 |  | [WISHLIST.md Phase 8](Projects/hearth/WISHLIST.md#phase-8--hearth-gets-a-machine-that-watches-it) |
| 16 | Phase 1 — The rules core comes out of the page | `Projects/torchbearer` | 1 | Opus 5 |  | [WISHLIST.md Phase 1](Projects/torchbearer/WISHLIST.md#phase-1--the-rules-core-comes-out-of-the-page) |
| 17 | Phase 2 — Combat comes out of the page | `Projects/torchbearer` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 2](Projects/torchbearer/WISHLIST.md#phase-2--combat-comes-out-of-the-page) |
| 18 | Phase 3 — Reactions, reach, and an interrupt point | `Projects/torchbearer` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 3](Projects/torchbearer/WISHLIST.md#phase-3--reactions-reach-and-an-interrupt-point) |
| 19 | Phase 4 — Detection: Hide, Seek, cover, invisibility | `Projects/torchbearer` | 1 | Opus 5 |  | [WISHLIST.md Phase 4](Projects/torchbearer/WISHLIST.md#phase-4--detection-hide-seek-cover-invisibility) |
| 20 | Phase 5 — The rest of the action economy | `Projects/torchbearer` | 1 | Opus 5 |  | [WISHLIST.md Phase 5](Projects/torchbearer/WISHLIST.md#phase-5--the-rest-of-the-action-economy) |
| 21 | Phase 6 — A hero who levels | `Projects/torchbearer` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 6](Projects/torchbearer/WISHLIST.md#phase-6--a-hero-who-levels) |
| 22 | Phase 7 — The campaign spine | `Projects/torchbearer` | 2+ | Opus 5 |  | [WISHLIST.md Phase 7](Projects/torchbearer/WISHLIST.md#phase-7--the-campaign-spine) |
| 23 | Phase 8 — The contract, and its first new author | `Projects/torchbearer` | 1 | Opus 5 |  | [WISHLIST.md Phase 8](Projects/torchbearer/WISHLIST.md#phase-8--the-contract-and-its-first-new-author) |
| 24 | Phase 1 — The interrupt point | `Projects/absalom-inheritance` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 1](Projects/absalom-inheritance/WISHLIST.md#phase-1--the-interrupt-point) |
| 25 | Phase 2 — Conditions that expire | `Projects/absalom-inheritance` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 2](Projects/absalom-inheritance/WISHLIST.md#phase-2--conditions-that-expire) |
| 26 | Phase 3 — Templates, and line of effect | `Projects/absalom-inheritance` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 3](Projects/absalom-inheritance/WISHLIST.md#phase-3--templates-and-line-of-effect) |
| 27 | Phase 4 — Creatures that know what they are standing in | `Projects/absalom-inheritance` | 1 | Opus 5 |  | [WISHLIST.md Phase 4](Projects/absalom-inheritance/WISHLIST.md#phase-4--creatures-that-know-what-they-are-standing-in) |
| 28 | Phase 5 — A harness that says which fight killed you | `Projects/absalom-inheritance` | ½ | Opus 5 |  | [WISHLIST.md Phase 5](Projects/absalom-inheritance/WISHLIST.md#phase-5--a-harness-that-says-which-fight-killed-you) |
| 29 | Phase 6 — An area should be a file, not a diff | `Projects/absalom-inheritance` | 1 | Opus 5 |  | [WISHLIST.md Phase 6](Projects/absalom-inheritance/WISHLIST.md#phase-6--an-area-should-be-a-file-not-a-diff) |
| 30 | Phase 7 — Two more heirs, with their own satchels | `Projects/absalom-inheritance` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Projects/absalom-inheritance/WISHLIST.md#phase-7--two-more-heirs-with-their-own-satchels) |
| 31 | Phase 8 — The debts on the surface | `Projects/absalom-inheritance` | ½ | Opus 5 |  | [WISHLIST.md Phase 8](Projects/absalom-inheritance/WISHLIST.md#phase-8--the-debts-on-the-surface) |
| 32 | Phase 1 — The room is a description | `Projects/fourth-quarter` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 1](Projects/fourth-quarter/WISHLIST.md#phase-1--the-room-is-a-description) |
| 33 | Phase 2 — Four rooms, one ladder | `Projects/fourth-quarter` | 2+ | Opus 5 |  | [WISHLIST.md Phase 2](Projects/fourth-quarter/WISHLIST.md#phase-2--four-rooms-one-ladder) |
| 34 | Phase 3 — Feet that find the door | `Projects/fourth-quarter` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 3](Projects/fourth-quarter/WISHLIST.md#phase-3--feet-that-find-the-door) |
| 35 | Phase 4 — The texture diet | `Projects/fourth-quarter` | 1 | Opus 5 |  | [WISHLIST.md Phase 4](Projects/fourth-quarter/WISHLIST.md#phase-4--the-texture-diet) |
| 36 | Phase 5 — The suite runs on every pull request | `Projects/fourth-quarter` | ½ | Opus 5 |  | [WISHLIST.md Phase 5](Projects/fourth-quarter/WISHLIST.md#phase-5--the-suite-runs-on-every-pull-request) |
| 37 | Phase 6 — The league has a season | `Projects/fourth-quarter` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 6](Projects/fourth-quarter/WISHLIST.md#phase-6--the-league-has-a-season) |
| 38 | Phase 7 — Regulars, and the bar across town | `Projects/fourth-quarter` | 2+ | Opus 5 |  | [WISHLIST.md Phase 7](Projects/fourth-quarter/WISHLIST.md#phase-7--regulars-and-the-bar-across-town) |
| 39 | Phase 8 — The night has moments | `Projects/fourth-quarter` | 1 | Opus 5 |  | [WISHLIST.md Phase 8](Projects/fourth-quarter/WISHLIST.md#phase-8--the-night-has-moments) |
| 40 | Phase 9 — A night you can lose | `Projects/fourth-quarter` | 1 | Opus 5 |  | [WISHLIST.md Phase 9](Projects/fourth-quarter/WISHLIST.md#phase-9--a-night-you-can-lose) |
| 41 | Phase 1 — Guests who walk | `Projects/Ren-Faire-Claude` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 1](Projects/Ren-Faire-Claude/WISHLIST.md#phase-1--guests-who-walk) |
| 42 | Phase 2 — Weather worth checking | `Projects/Ren-Faire-Claude` | 1 | Opus 5 |  | [WISHLIST.md Phase 2](Projects/Ren-Faire-Claude/WISHLIST.md#phase-2--weather-worth-checking) |
| 43 | Phase 3 — Acts with a story | `Projects/Ren-Faire-Claude` | 1 | Opus 5 |  | [WISHLIST.md Phase 3](Projects/Ren-Faire-Claude/WISHLIST.md#phase-3--acts-with-a-story) |
| 44 | Phase 4 — A faire that outlives its season | `Projects/Ren-Faire-Claude` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 4](Projects/Ren-Faire-Claude/WISHLIST.md#phase-4--a-faire-that-outlives-its-season) |
| 45 | Phase 5 — The review that has been owed four rounds | `Projects/Ren-Faire-Claude` | 1 | Opus 5 |  | [WISHLIST.md Phase 5](Projects/Ren-Faire-Claude/WISHLIST.md#phase-5--the-review-that-has-been-owed-four-rounds) |
| 46 | Phase 6 — A map you can pan, zoom and preview into | `Projects/Ren-Faire-Claude` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 6](Projects/Ren-Faire-Claude/WISHLIST.md#phase-6--a-map-you-can-pan-zoom-and-preview-into) |
| 47 | Phase 7 — A third crew | `Projects/Ren-Faire-Claude` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Projects/Ren-Faire-Claude/WISHLIST.md#phase-7--a-third-crew) |
| 48 | Phase 8 — The wiring audit, automatic | `Projects/Ren-Faire-Claude` | ½ | Opus 5 |  | [WISHLIST.md Phase 8](Projects/Ren-Faire-Claude/WISHLIST.md#phase-8--the-wiring-audit-automatic) |
| 49 | Phase 1 — The backer-less middle game | `Projects/daredevil` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 1](Projects/daredevil/WISHLIST.md#phase-1--the-backer-less-middle-game) |
| 50 | Phase 2 — Everything the game already wrote and cannot show | `Projects/daredevil` | 1 | Opus 5 |  | [WISHLIST.md Phase 2](Projects/daredevil/WISHLIST.md#phase-2--everything-the-game-already-wrote-and-cannot-show) |
| 51 | Phase 3 — Relationships as a declared thing | `Projects/daredevil` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 3](Projects/daredevil/WISHLIST.md#phase-3--relationships-as-a-declared-thing) |
| 52 | Phase 4 — Danny and Tommy get a way out | `Projects/daredevil` | 1 | Opus 5 |  | [WISHLIST.md Phase 4](Projects/daredevil/WISHLIST.md#phase-4--danny-and-tommy-get-a-way-out) |
| 53 | Phase 5 — A walker that knows what it did not reach | `Projects/daredevil` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 5](Projects/daredevil/WISHLIST.md#phase-5--a-walker-that-knows-what-it-did-not-reach) |
| 54 | Phase 6 — Evenings that cost something | `Projects/daredevil` | 1 | Opus 5 |  | [WISHLIST.md Phase 6](Projects/daredevil/WISHLIST.md#phase-6--evenings-that-cost-something) |
| 55 | Phase 7 — Three stunts that are three stunts | `Projects/daredevil` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Projects/daredevil/WISHLIST.md#phase-7--three-stunts-that-are-three-stunts) |
| 56 | Phase 8 — A workflow that runs the suite, and a real thumb | `Projects/daredevil` | ½ | Opus 5 |  | [WISHLIST.md Phase 8](Projects/daredevil/WISHLIST.md#phase-8--a-workflow-that-runs-the-suite-and-a-real-thumb) |
| 57 | Phase 1 — The skill table becomes a record | `Numina` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 1](Numina/WISHLIST.md#phase-1--the-skill-table-becomes-a-record) |
| 58 | Phase 2 — A page for every skill, and links between them | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 2](Numina/WISHLIST.md#phase-2--a-page-for-every-skill-and-links-between-them) |
| 59 | Phase 3 — The character builder | `Numina` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 3](Numina/WISHLIST.md#phase-3--the-character-builder) |
| 60 | Phase 4 — The accessibility and mobile pass | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 4](Numina/WISHLIST.md#phase-4--the-accessibility-and-mobile-pass) |
| 61 | Phase 5 — Come play | `Numina` | ½ | Opus 5 |  | [WISHLIST.md Phase 5](Numina/WISHLIST.md#phase-5--come-play) |
| 62 | Phase 6 — Excellencies, history, and the timeline | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 6](Numina/WISHLIST.md#phase-6--excellencies-history-and-the-timeline) |
| 63 | Phase 7 — The print packet and the offline kit | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Numina/WISHLIST.md#phase-7--the-print-packet-and-the-offline-kit) |
| 64 | Phase 8 — Search and navigation, upgraded | `Numina` | 1 | Opus 5 |  | [WISHLIST.md Phase 8](Numina/WISHLIST.md#phase-8--search-and-navigation-upgraded) |
| 65 | Phase 1 — The simulation half, in numbers | `Tools/schedule` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 1](Tools/schedule/WISHLIST.md#phase-1--the-simulation-half-in-numbers) |
| 66 | Phase 2 — The editor under the same harness | `Tools/schedule` | 1 | Opus 5 |  | [WISHLIST.md Phase 2](Tools/schedule/WISHLIST.md#phase-2--the-editor-under-the-same-harness) |
| 67 | Phase 3 — A published file the machine can rebuild | `Tools/schedule` | 1 | Opus 5 |  | [WISHLIST.md Phase 3](Tools/schedule/WISHLIST.md#phase-3--a-published-file-the-machine-can-rebuild) |
| 68 | Phase 4 — The storage answer | `Tools/schedule` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 4](Tools/schedule/WISHLIST.md#phase-4--the-storage-answer) |
| 69 | Phase 5 — The seam at 14729 | `Tools/schedule` | ½ | Opus 5 |  | [WISHLIST.md Phase 5](Tools/schedule/WISHLIST.md#phase-5--the-seam-at-14729) |
| 70 | Phase 6 — One conflict engine, and the constraints nobody checks | `Tools/schedule` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 6](Tools/schedule/WISHLIST.md#phase-6--one-conflict-engine-and-the-constraints-nobody-checks) |
| 71 | Phase 7 — Scenarios you can name and compare | `Tools/schedule` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Tools/schedule/WISHLIST.md#phase-7--scenarios-you-can-name-and-compare) |
| 72 | Phase 8 — The tool a keyboard can drive | `Tools/schedule` | 1 | Opus 5 |  | [WISHLIST.md Phase 8](Tools/schedule/WISHLIST.md#phase-8--the-tool-a-keyboard-can-drive) |
| 73 | Phase 1 — The sim without the page | `Projects/corner-and-kettle` | 2+ | Fable 5.1 |  | [WISHLIST.md Phase 1](Projects/corner-and-kettle/WISHLIST.md#phase-1--the-sim-without-the-page) |
| 74 | Phase 2 — `test/balance.mjs` | `Projects/corner-and-kettle` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 2](Projects/corner-and-kettle/WISHLIST.md#phase-2--testbalancemjs) |
| 75 | Phase 3 — The Serve gate, decided | `Projects/corner-and-kettle` | ½ | Opus 5 |  | [WISHLIST.md Phase 3](Projects/corner-and-kettle/WISHLIST.md#phase-3--the-serve-gate-decided) |
| 76 | Phase 4 — The page becomes a view | `Projects/corner-and-kettle` | 2+ | Opus 5 |  | [WISHLIST.md Phase 4](Projects/corner-and-kettle/WISHLIST.md#phase-4--the-page-becomes-a-view) |
| 77 | Phase 5 — Staff who have a week | `Projects/corner-and-kettle` | 1 | Opus 5 |  | [WISHLIST.md Phase 5](Projects/corner-and-kettle/WISHLIST.md#phase-5--staff-who-have-a-week) |
| 78 | Phase 6 — Customers who remember | `Projects/corner-and-kettle` | 1 | Fable 5.1 |  | [WISHLIST.md Phase 6](Projects/corner-and-kettle/WISHLIST.md#phase-6--customers-who-remember) |
| 79 | Phase 7 — A reopening worth doing | `Projects/corner-and-kettle` | 1 | Opus 5 |  | [WISHLIST.md Phase 7](Projects/corner-and-kettle/WISHLIST.md#phase-7--a-reopening-worth-doing) |
| 80 | Phase 8 — Both hands on the keys | `Projects/corner-and-kettle` | ½ | Opus 5 |  | [WISHLIST.md Phase 8](Projects/corner-and-kettle/WISHLIST.md#phase-8--both-hands-on-the-keys) |
| 81 | Phase 9 — Join `npm run games` | `Projects/corner-and-kettle` | ½ | Opus 5 |  | [WISHLIST.md Phase 9](Projects/corner-and-kettle/WISHLIST.md#phase-9--join-npm-run-games) |
| 82 | Decide whether any real report card needs a second look, after the `.75`-band bug | `Tools/final-grade-checker` | ¼ | — |  | [Final Grade Checker](#final-grade-checker) |
| 83 | Review the captured preview candidate and promote it, or recapture | `Tools/board-check` | ¼ | — |  | [Castle Conundrum](#castle-conundrum) |
| 84 | Decide whether `Pathfinder/data/` is a published interface or private | `Pathfinder` | ¼ | — |  | [Questions for Devon](#questions-for-devon) |
| 85 | Build Aphelion's airlock-entry beat, then land the ready-made `#signal` assertion | `Projects/aphelion` | ½ | — |  | [Aphelion](#aphelion) |
| 86 | The `Tools/Name Picker.html` → `name-picker.html` rename, plus `newindex.html`'s one link | `site` | ¼ | — |  | [Name Picker](#name-picker) |
| 87 | Asset diet: 165 MB for 1,525 lines, two thirds of the Poly Haven packs unreferenced | `Projects/Castle Conundrum` | 1 | — |  | [Castle Conundrum](#castle-conundrum) |
| 88 | A data-driven quest graph to replace the 74-line "two booleans" quest manager | `Projects/Castle Conundrum` | 1 | — |  | [Castle Conundrum](#castle-conundrum) |
| 89 | A level editor with URL sharing, on the pattern Hearth already proves | `Projects/orbital` | 1 | — |  | [Orbital](#orbital) |
| 90 | Turn the physics suite's solver into a level generator | `Projects/orbital` | 1 | — |  | [Orbital](#orbital) |
| 91 | Multi-offer escalation wars as a dedicated flow | `Projects/Closing Time` | 1 | — |  | [Closing Time](#closing-time) |
| 92 | Per-client financing types on the buyer side | `Projects/Closing Time` | ½ | — |  | [Closing Time](#closing-time) |
| 93 | A commercial tier at Broker-Track | `Projects/Closing Time` | 1 | — |  | [Closing Time](#closing-time) |
| 94 | Tides as a real axis | `Projects/golden-hour-beach` | 1 | — |  | [Golden Hour](#golden-hour) |
| 95 | The causeway: the top half of the trail rides up to 10.9 m above the hillside | `Projects/blue-hour-trail` | 1 | — |  | [Blue Hour](#blue-hour) |
| 96 | The mountain has no peak — `mountainH` is a ramp in `z` | `Projects/blue-hour-trail` | 1 | — |  | [Blue Hour](#blue-hour) |
| 97 | Configurable grading policies and a "why this grade" audit trail | `Tools/final-grade-checker` | 1 | — |  | [Final Grade Checker](#final-grade-checker) |
| 98 | CI runs almost nothing: no workflow runs `Tools/board-check`, `gvb-save.test.mjs`, or any of the ~20 project suites | `site` | 1 | — |  | [The site itself](#the-site-itself) |
| 99 | One shared asset pipeline (prune, resize, draco/meshopt) for the ~380 MB across three games | `assets` | 2+ | — |  | [The site itself](#the-site-itself) |
| 100 | `gvb-save.js` v2: quota accounting, multi-key namespaces, an IndexedDB tier | `assets` | 1 | — |  | [The site itself](#the-site-itself) |
| 101 | A real-hardware pass: every atmospheric piece's numbers are software rasterization, and touch has never had a thumb on it | `site` | ½ | — |  | [The site itself](#the-site-itself) |
| 102 | An ownership manifest `check-integrity.mjs` enforces; `Tools/prompt-builder.html` is owned by nothing and fails the sweep today | `Tools/board-check` | ½ | — |  | [The site itself](#the-site-itself) |
| 103 | Extend `Pathfinder/tests/anathema.test.mjs` rather than starting a second suite, if the page gains interaction logic | `Pathfinder` | ¼ | — |  | [Anathema Archive](#anathema-archive) |
| 104 | Build the generator's Chronological merge/sort step, if the two chronicle views ever drift | `Pathfinder` | ½ | — |  | [Pathfinder Campaigns](#pathfinder-campaigns) |
| 105 | A commented-out `<template>` dossier block | `Pathfinder` | ¼ | — |  | [Pathfinder Characters](#pathfinder-characters) |
| 106 | In-browser editing via `gvb-save.js`, if the page's role shifts from showcase to living sheet | `Pathfinder` | ½ | — |  | [Pathfinder Characters](#pathfinder-characters) |
| 107 | Re-check the `[shared]` chrome against `campaigns.html` for drift | `Pathfinder` | ¼ | — |  | [Pathfinder Characters](#pathfinder-characters) |
| 108 | Touch/gamepad input — a full second input scheme, not a HUD addition | `Projects/aphelion` | 1 | — |  | [Aphelion](#aphelion) |
| 109 | Tune the cabinet and commode clearance margins tighter against their walls | `Projects/Castle Conundrum` | ¼ | — |  | [Castle Conundrum](#castle-conundrum) |
| 110 | Confirm the gate door's own mesh is symmetric within its bounding box | `Projects/Castle Conundrum` | ¼ | — |  | [Castle Conundrum](#castle-conundrum) |
| 111 | Get a real `npm run games closing-time` pass through the shared suite | `Projects/Closing Time` | ¼ | — |  | [Closing Time](#closing-time) |
| 112 | Multi-career history — a hall of past scorecards | `Projects/Closing Time` | 1 | — |  | [Closing Time](#closing-time) |
| 113 | The unhandled edge case: a deal or listing still under contract on deleted content | `Projects/Closing Time` | ½ | — |  | [Closing Time](#closing-time) |
| 114 | A real hour on the beach with ears on: event pacing, sanderling flush distance, cricket density, night palette banding | `Projects/golden-hour-beach` | ½ | — |  | [Golden Hour](#golden-hour) |
| 115 | A real low-end-GPU run — the world is 10x bigger and every number is software rasterization | `Projects/golden-hour-beach` | ¼ | — |  | [Golden Hour](#golden-hour) |
| 116 | Preview recapture and a board-card description refresh — it undersells the piece by about six features | `Tools/board-check` | ¼ | — |  | [Golden Hour](#golden-hour) |
| 117 | A touch playtest on a real phone — the pill-as-throw-control needs a thumb on glass | `Projects/golden-hour-beach` | ¼ | — |  | [Golden Hour](#golden-hour) |
| 118 | `play-games.mjs` beats off the new `?debug` `__gh` hook | `Tools/board-check` | ½ | — |  | [Golden Hour](#golden-hour) |
| 119 | Add Golden Hour to `assets/js/gvb-save.js`'s "Adopted by" comment | `assets` | ¼ | — |  | [Golden Hour](#golden-hour) |
| 120 | If night proves popular: the owl hunts, and the fireflies drift toward the fire | `Projects/golden-hour-beach` | ½ | — |  | [Golden Hour](#golden-hour) |
| 121 | Register Blue Hour in `Tools/board-check/games.mjs` | `Tools/board-check` | ¼ | — |  | [Blue Hour](#blue-hour) |
| 122 | A `capture-previews.mjs` recipe, then `npm run previews blue-hour` and `npm run promote` | `Tools/board-check` | ¼ | — |  | [Blue Hour](#blue-hour) |
| 123 | A real GPU run: the mist banks' fill cost, the headlamp at decay 1, the lamp's feet-pool at real pixel density | `Projects/blue-hour-trail` | ¼ | — |  | [Blue Hour](#blue-hour) |
| 124 | A touch playtest on real glass — hold-the-bottom-third-to-walk has never had a thumb on it | `Projects/blue-hour-trail` | ¼ | — |  | [Blue Hour](#blue-hour) |
| 125 | An hour on the trail with ears on: dread cooldowns, fog periods, drone gains, the new stingers | `Projects/blue-hour-trail` | ½ | — |  | [Blue Hour](#blue-hour) |
| 126 | The phantom's downhill pan is exactly 0.000 — decide whether to mean it | `Projects/blue-hour-trail` | ½ | — |  | [Blue Hour](#blue-hour) |
| 127 | Beats that change in kind above the fog line, not just in rate | `Projects/blue-hour-trail` | 1 | — |  | [Blue Hour](#blue-hour) |
| 128 | The two conservative model gaps, as one coupled piece of work | `Projects/integer-foundry` | 1 | — |  | [Integer Foundry](#integer-foundry) |
| 129 | Whether the tile-cost hint should be more prominent once targets run past two digits | `Projects/integer-foundry` | ¼ | — |  | [Integer Foundry](#integer-foundry) |
| 130 | A 4th prong or deeper side content, only if Devon expands scope | `Projects/the-fracture-cycle` | 2+ | — |  | [The Fracture Cycle](#the-fracture-cycle) |
| 131 | Get an actual screenshot from a session where the browser pane composites | `Tools/final-grade-checker` | ¼ | — |  | [Final Grade Checker](#final-grade-checker) |
| 132 | The jsPDF-AutoTable column-width warning | `Tools/final-grade-checker` | ¼ | — |  | [Final Grade Checker](#final-grade-checker) |
| 133 | Verify the EXIF fix against a real sideways phone photo | `Tools/image-to-pdf` | ¼ | — |  | [Image to PDF](#image-to-pdf) |
| 134 | A real screenshot of the two-row mobile layout | `Tools/image-to-pdf` | ¼ | — |  | [Image to PDF](#image-to-pdf) |
| 135 | Settings persistence — plain `localStorage`, three primitives — only if a teacher asks | `Tools/image-to-pdf` | ¼ | — |  | [Image to PDF](#image-to-pdf) |
| 136 | The stale "twelve keys" comment in `np-store.js`; there are thirteen | `Tools/name-picker` | ¼ | — |  | [Name Picker](#name-picker) |
| 137 | Exercise multiple rosters under real use — neither browser suite has run more than one | `Tools/name-picker` | ½ | — |  | [Name Picker](#name-picker) |
| 138 | Mobile and accessibility re-verification, carried twice | `Tools/name-picker` | ¼ | — |  | [Name Picker](#name-picker) |
| 139 | Wire `leastPicked()` into a "who's due" display | `Tools/name-picker` | ¼ | — |  | [Name Picker](#name-picker) |
| 140 | An automated assertion for the print-all path's rotation fix | `Tools/seating-chart` | ¼ | — |  | [Seating Chart Generator](#seating-chart-generator) |
| 141 | A committed browser-driven test layer: grid render/unlock, save/reset/wipe, star display | `Projects/orbital` | ½ | — |  | [Orbital](#orbital) |
| 142 | Verify the rotate-to-play gate on a real device or real touch emulation | `Projects/orbital` | ¼ | — |  | [Orbital](#orbital) |
| 143 | Revisit `gvb-save.js` adoption for save-bar UI consistency | `Projects/orbital` | ½ | — |  | [Orbital](#orbital) |

---

# Tier 2 — the ideas with no wishlist home

Sixteen projects and areas have no `WISHLIST.md`. Everything they had lives
here, carried across from their prompt file's "Your task", their notes file's
"Next session", "Deliberately not done" and "Shared-file requests", and any
README roadmap — in the wording those files used, not summarised. The
per-project files themselves are deleted; git history has them.

## Anathema Archive

`Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json
data.py`, `Pathfinder/tests/`.

Round 1 did the open-ended audit (data loading, manifest integrity,
search/filter/keyboard access, mobile layout — all in good shape). Round 2
built the test suite, swept `renderNpc`, and fixed the stale comment. **Nothing
is currently outstanding for this project's own feature work.**

If a future round finds something real:

1. **Extend `Pathfinder/tests/anathema.test.mjs`** rather than starting a
   second suite, if this page gets more interaction logic. The
   `waitFor`/`clickCat`/`clickLevelChip` helpers and the `freshPage()` pattern
   (fresh headless page per scenario, cheap since boot only fetches
   `manifest.json` until a category is picked) should cover new
   state-machine-shaped features without much new plumbing. Two things worth
   knowing if you do: (a) `page.evaluate(fn, arg)` re-parses `fn`'s source in
   the browser, so it can't close over this file's Node-side variables — pass
   anything from here through the single `arg` parameter, or bake a literal
   directly into the function source; (b) the page's top-level `const`/`let`
   bindings (`S`, `openDetail`, etc.) ARE reachable from `page.evaluate` by
   bare name, since Puppeteer/Playwright's `evaluate` shares the page's global
   lexical environment (same mechanism that lets DevTools console see them) —
   just don't route through `window.S`, since top-level `const` never becomes a
   `window` property.
2. **The `Pathfinder/data/` question** needs Devon's answer before any
   cross-project work depends on it. See Q1.

Deliberately not done, and still the right call:

- **The `renderNpc` data-sweep script isn't committed.** It was a one-off
  read-only analysis (load every npc shard, check for AC/HP/Speed/Perception
  duplication in prose) to answer a specific question, not a reusable check —
  there's no ongoing invariant here to guard, since the answer was "this bug
  class doesn't structurally apply to this renderer." If a future session wants
  to re-run something like it, the approach was: for each creature with
  non-empty `system.details.publicNotes`, regex the structured field's value
  against the prose with a word boundary (`\bac\s*48\b` etc.) and hand-check
  any hit — the false-positive rate is real, so hand-checking hits matters more
  than the regex itself.
- **Not adding a `package.json` under `Pathfinder/tests/`.** The suite imports
  `playwright-core`/`puppeteer-core`/`@sparticuz/chromium` indirectly through
  `Tools/board-check/harness.mjs`; Node resolves those bare specifiers relative
  to `harness.mjs`'s own location, not relative to the importing file. No
  dependency of its own to declare, so no manifest to add.
- **Not re-litigating the `gvb-save.js` decision or the file-split question**
  from round 1's notes. Both are still current per that session's reasoning and
  nothing found since changes either call.

## Pathfinder Campaigns

`Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/`.

**Nothing urgent stands out on this page's own rendering or content.** Round
1's pass (card chrome, ember animation, foil-sweep title, contrast) plus round
2's `[shared]` markers still stand as the page's last real content/rendering
review. Round 3 made zero edits and found zero findings.

1. **If the generator gets used and the Chronological tab drifts out of sync
   with the By-Character view**, build the merge/sort step the generator's own
   README documents as a known gap: the Chronological tab is the same
   per-character scenarios, re-sorted by scenario number across each org. The
   generator already reads the same per-character JSON that could derive this
   automatically — not worth building ahead of an actual sync problem. Checked
   again in round 3; still in sync. Building it speculatively is exactly the
   scope creep the "keep it a small script, not a live editor" reasoning was
   written to avoid.
2. **The merge with `characters.html` is answered and closed** — "harmonize,
   don't share", round 2, locked decision #17 stays in force for this pair.
   Don't re-litigate it.

## Pathfinder Characters

`Pathfinder/characters.html`, `Pathfinder/characters-assets/`.

**Nothing urgent on this page itself.** Fonts vendored, heading order fixed,
contrast fixed, now cross-checked against its twin and confirmed to still
match. The merge question — this project's own headline item across two rounds
— is answered; don't re-litigate it.

1. **A commented-out `<template>` dossier block**, if Devon specifically asks
   for it (documentation convenience, not a bug — still not built, still
   Devon's call on style).
2. **In-browser editing via `gvb-save.js`**, only if Devon decides this page's
   role should shift from showcase to living character sheet. Still not
   requested, still not built.
3. **If your own pass finds a `[shared]`-marked rule that's drifted** between
   this file and `campaigns.html`, flag it — that's real, separate work from
   the merge question above.

Still not touching the font-file-naming mismatch between this page's fontsource
convention and `campaigns.html`'s short form. Same bytes, cosmetic only, not
worth the churn.

## Aphelion

`Projects/aphelion/`.

Round 1 vendored the fonts, adopted `gvb-save.js`, and ran a full
fun/performance/audio/accessibility audit. Round 2 built the EVA distance
readout that audit flagged as optional. **Nothing urgent is left on the core
game.** What remains is one low-urgency item the notes have carried across
three rounds now, still with no forcing signal:

1. **The `#signal` regression beat**, if `play-games.mjs` ever gets an
   airlock-entry beat for Aphelion. The assertion body is unchanged since
   round 2:

   ```js
   // after cycling into EVA (main.js's setEVA(true) has run)
   const signal = await p.$eval('#signal', el => el.textContent);
   t.ok(/^SALVAGE \d+m/.test(signal), 'the EVA distance readout shows unscanned sites', signal);
   ```

   The blocker is that the airlock-entry beat doesn't exist yet in Aphelion's
   own game code, and building it blind from outside the project risks getting
   the actual gameplay wrong. Aphelion's own next session builds the
   prerequisite; the assertion is then a five-minute add.
2. **Touch/gamepad input, if this ever needs to run somewhere pointer lock
   isn't an option** (a tablet, say). A full second input scheme, not a HUD
   addition. Round 1's arrow-key look closed the specific gap the original
   audit found (pointer lock denied leaves a player able to walk in a straight
   line and nothing else); this would be a genuine mobile-support feature. Not
   attempted in any round. **Only worth it if there's an actual reason this
   needs to run on a touch device** — still no such reason. Third round
   carrying this with the same conclusion. If a future session wants to settle
   it rather than carry it a fourth time, the honest move is to ask Devon
   directly whether Aphelion ever needs to run on a tablet or phone, rather
   than each round re-deriving "no evidence yet" from scratch.

Two full audit rounds (fun, data-driven extension points, audio, performance,
accessibility) plus a re-check found nothing else worth touching. Inventing a
change to have something to report would be worse than reporting none.

## Castle Conundrum

`Projects/Castle Conundrum/`, `Tools/board-check/play-castle.mjs`.

**As of round 3 the project has no known open bugs.** Round 3 closed all four
of its own tasks (the four objects sealed in the back wall, the preview
recapture and promotion, `play-castle.mjs`'s own engine-mismatch bug, the gate
door's hinge/pivot math) — confirmed independently, not just trusted from
notes: `npm run play` reports 34/34 beats passing, real movement, real GPU
compositing. What's left, in order of value per effort:

1. **The chosen preview candidate needs a look-and-decide.** The candidate is
   sitting in `candidates/`, chosen, dated a fair-environment refresh — but
   whether it's the *right* frame is a call this project's own session should
   make, having asked for the recapture across two rounds. `npm run promote`
   was deliberately scoped to exclude it rather than decide for them.
2. **Cosmetic: the cabinet/commode clearance margins are generous (1.1–1.3 m
   from their side walls), not flush against them** — a future session could
   tune these tighter if the hall reads as too open with them pulled this far
   in. The column positions (world `x -6..-5.2` and `5.2..6`, right where a
   tighter shift would have put them) forced a choice between flush-to-wall and
   clear-of-column; clear-of-column won because it's the one that couldn't be
   skipped. Low value, low effort, purely a judgment call on how the room reads.
3. **Speculative: confirm the gate door's own mesh is symmetric within its own
   bounding box.** Round 3 fixed the sign/rotation error that put the whole
   leaf off-frame; it did not separately verify whether the Poly Haven model's
   authored geometry is centered within that box. No evidence it's actually
   off — worth a look only if someone notices it up close in play.
4. **The asset diet.** 165 MB of assets for 1,525 lines of code, roughly two
   thirds of the Poly Haven packs unreferenced.
5. **A data-driven quest graph.** The quest manager is 74 lines and "two
   booleans." An asset diet plus a data-driven quest graph is a real path; it
   ranked below the top ten because the notes say the piece is finished as
   designed and there is no in-project suite to build behind.

**Two things are decided, not open work, and don't need re-deriving:**

- **Leave the walls stylised.** Five 1k Poly Haven stone sets already sit on
  disk unused. Round 1's before/after pairs settled it.
- **No save.** The quest is one boolean (`hasKeystone`) plus one more
  (`victory`) and about fifteen minutes long. If a future session still wants
  it: there is no existing key to preserve, so locked decision #36 doesn't bind.

## Closing Time

`Projects/Closing Time/`.

**Round 3 closed both items round 2 left open** (the name-substring Ledger
filter, the career-ending dead end). What's left:

1. **Get a real `npm run games closing-time` run in** once `Tools/board-check`
   isn't in use by another thread. Round 3's two changes were verified by hand
   in a real browser and by the Node smoke suite, but not by the project's own
   end-to-end suite.
2. **Multi-career history.** The scorecard's button answers "how do I start the
   next career," not "does this career leave a record anywhere." A save that
   remembers more than the one career currently in progress — a hall of past
   scorecards, say — is a genuinely bigger feature and still out of scope for
   what round 3 asked. Worth raising with Devon if the ending sticks as
   something players actually hit repeatedly, same as the last three rounds'
   notes said.

From the README's own "Design notes for future expansion", which was this
project's only plan and is being retired from that file:

- **The priority-tested slice** — the buyer loop, seller loop, open houses,
  events, brokerages, market drift, referrals, and career ladder — is all live.
  **Natural next layers: commercial tier at Broker-Track, per-client financing
  types on the buyer side, and multi-offer escalation wars as a dedicated
  flow.** A 97-assertion suite would hold them.
- **The unhandled edge case.** `repairCareer()` makes adding and removing
  content from a live career safe — it backfills and drops `listingsState`,
  `market.nb` and `knowledge` entries against what's actually in `data/`. But
  **a deal or listing still actively under contract on deleted content is a
  separate, unhandled edge case: don't delete a listing a save might be
  mid-contract on.**

Two conventions that stay in the README rather than moving here: anything new
added to `S` belongs in `repairCareer()` the same day it's added, especially if
arithmetic touches it; and `log(text, cls, kind, recId)`'s fourth argument tags
a line as belonging to one client, which is what the Ledger's per-client filter
matches on. A handful of `log()` calls are deliberately left without a `recId`
— the weekly rate announcement, the Monday-begins line, brokerage
recruitment/decline — because they aren't about one specific client, and no
per-client filter should ever match them.

## Golden Hour

`Projects/golden-hour-beach/`.

The last big session grew the world 10x on one decision — the shoreline is a
curve, `shorelineZ(x)`, and everything works in shore distance `s = z -
shorelineZ(x)` — and Devon overrode two locked decisions to allow it: the sun
sets now (six keyframes, not two), and there is a save, narrowly (`journal.js`
persists discoveries only; sun position and player position are pointedly
absent from the schema). Source grew from about 1,900 to about 5,600
hand-written lines across 27 modules, with zero new asset bytes and zero
offsite requests.

What's left:

1. **A real hour on the beach, ears on, tuning pass:** event pacing (bait ball
   every 10 to 18 min, whale about 20, both guesses until someone sits through
   them), sanderling flush distance, cricket density, night palette banding on
   a real monitor.
2. **The still-open real low-end-GPU run from the last backlog, now genuinely
   urgent:** the world is 10x bigger and the proxy numbers are software
   rasterization, not a weak real GPU. Confirmed the qualitative direction
   (water stays the dominant relative cost); the actual absolute numbers on a
   weak integrated GPU are still unmeasured. `renderer.info` at the widest home
   view reads 157 draw calls and 316k triangles, against a 300-call budget.
3. **Preview recapture (`npm run previews`) and a board card refresh for the
   description: it undersells the piece by about six features now.**
4. **Touch playtest on a real phone:** the pill-as-throw-control needs a thumb
   on glass, not a mouse pretending.
5. **If night proves popular:** the owl could hunt (one swoop over the dunes,
   no kill shown), and the fireflies could drift toward the fire when it burns.
6. **`Tools/board-check/play-games.mjs` can lean on the new debug hook**
   (`?debug` exposes `window.__gh`: `setSunT` which also syncs the moon,
   `teleport`, `face`, `pos`, `journal`, `events`, `info`). Suggested beats:
   scrub to 1560 and assert star opacity plus a journal DOM entry; teleport to
   the headland and assert the place card; throw a stone and assert the hint
   cycle; reload and assert the journal survived while `sunT` reset. All
   assertions can go against the DOM or `__gh.journal()`, per locked decision
   #39's split.
7. **`assets/js/gvb-save.js` line 32, the "Adopted by" comment: add Golden
   Hour.** Still not done — the comment currently lists eleven adopters and
   Golden Hour is not among them.
8. **Tides as a real axis.** Named as this project's real upgrade path, blocked
   first on the same thing as the real-GPU run above.

Deliberately not done, and still the right call:

- The original quartet (dolphin, gulls, boat, jet) was not migrated into
  `js/creatures/`. It is tuned, tested, and lives fine where it is; a mechanical
  move risks regressions for zero player-visible gain. The registry pattern is
  established for everything new.
- The curlew is not a journal species. Not everything should be collectable.
- No chunk LOD swapping. Measured first: 157 calls and 316k triangles at the
  worst view is nothing, and frustum culling already drops distant chunks.
- No estuary-specific soundscape bus beyond the curlew timer. The reeds and
  distance already quiet the surf; a dedicated layer can wait for ears-on
  tuning.
- The whale has no fluke. Two sprites and restraint.
- **Wildlife retuning is closed**, not carried forward: round 3 watched it for
  real and found no case for changing anything.

## Blue Hour

`Projects/blue-hour-trail/`. Six sessions, no prompt in the numbered system, no
`WISHLIST.md`.

1. **The direction question — settled, session 4.** One reading verb, one
   memory, one findable tool, granted by Devon explicitly and narrowly.
   Anything further in the verbs/persistence/collection direction needs a new
   grant, and Golden Hour parity remains the odd one out. The live choice now
   is: keep pushing into `dread.js`, or write "no save, no verbs, no
   collection" into the record as a locked decision.
2. **Beats in kind above the fog line.** The beats are still the same five
   everywhere on the mountain — only their *rate* changes with altitude.
   Something should change in kind up there. The figure in the lookout is one
   answer and currently the only one. Session 4 filled the slot the original
   task was holding open; more are welcome if they obey the doctrine.
3. **A real GPU run.** Every number on this project is still swiftshader —
   1.0–1.8 fps — now including the headlamp's SpotLight cost and the newly-alive
   mist/breath fill rate, which makes this MORE urgent than before, not less:
   two full-screen-capable transparent systems that had never actually drawn
   are drawing now. Nobody has measured the actual frame rate of this piece
   anywhere. Three specific things to look at now that the session-5 retunes
   landed: the mist banks' fill cost (30 large transparent quads, more of them
   near the camera than before), the headlamp at decay 1 (cheaper than it looks
   — one SpotLight either way), and whether the lamp's feet-pool and 12 m reach
   still read right at a real frame rate and real pixel density. The geometry
   numbers are honest and comfortable — 35 draw calls, 280k triangles against a
   budget of 300 — but this piece leans hard on large transparent billboards in
   fog, which is fill-rate cost software rasterization reports very differently.
4. **A touch playtest on real glass.** The hold-the-bottom-third-to-walk scheme
   has never had a thumb on it — and the logbook's hold-the-chip-to-read and
   the headlamp button have joined it untested.
5. **An hour on the trail with ears on.** The dread cooldowns (55–100 s, first
   beat at 70 s) and the fog periods (211 s and 337 s) are unheard guesses; the
   drone gains, the new radio/transmission stingers, the headlamp partial and
   the descending phantom curve are too. They want a real walk, not a scrub. If
   Devon plays a build and leaves listening notes, tune the constants from
   them; session 4 left every level as authored.
6. **The causeway — Devon's call (session 6).** The top half of the trail rides
   up to 10.9 m above the hillside on both sides and the descent is the view
   that shows it. Three ways out, none of them a cleanup: give `mountainH` a
   term that follows the trail's arc-length height instead of `z` alone; or
   re-anchor `trailYof` to the hillside it actually crosses; or decide a ridge
   trail is what this is and widen the bench so it reads as ground rather than
   a levee. All three move the heightfield and rebaseline `smoke.mjs`, and the
   third also has to answer why the blaze posts stand at the lip of a 10 m
   drop. **Whoever takes it: walk down afterwards, not up.** `smoke.mjs` holds
   10.9 m as a ceiling.
7. **The mountain still has no peak.** `mountainH` is a ramp in `z`, and the
   last stretch of trail still rides a ~5 m berm. Both are invisible under the
   weather session 2 added, and both become real again the instant anyone lifts
   the fog at the summit.
8. **The phantom's downhill pan does nothing — decide whether to mean it**
   (session 6). `downhillAt` returns the reverse of the trail tangent, so for a
   walker facing along the trail the pan is exactly 0.000 in both directions of
   travel; the beat's descent is carried entirely by the falling pitch. Either
   accept that (the honest reading: those steps are behind you or ahead of you,
   and stereo cannot say which) and reword the ladder, or point `downhillAt` at
   the terrain's fall line, which IS lateral on every switchback leg and would
   make the sentence true. The second changes the eyes' drift and the shape's
   head-flip too, since all three read the same function — which is an argument
   for doing it deliberately or not at all. A browser check fails the moment
   anyone changes it, on purpose.
9. **`Tools/board-check/games.mjs` — register the piece** so the integrity,
   collision and preview passes stop skipping it. It boots exactly like Golden
   Hour (click `#overlay`, never the canvas — while the overlay is up it covers
   `#scene` and a canvas click never lands):

   ```js
     'blue-hour': {
       title: 'Blue Hour',
       url: '/Projects/blue-hour-trail/',
       vw: 1320, vh: 800, dsf: 1,
       three: '/Projects/blue-hour-trail/libs/three.module.js',
       intro: ['#overlay'],
       async open(p, { probe } = {}) {
         await p.waitForSelector('#scene');
         if (probe) await probe();
         await p.click('#overlay');
         await p.waitForSelector('#overlay.hidden', attached);
         await wait(1200);
       },
     },
   ```

   There is no `saveKey`: the piece has no save, on purpose, and adding one
   would imply a save it does not have.
10. **`Tools/board-check/capture-previews.mjs` — a recipe, then `npm run
    previews blue-hour` and `npm run promote`** to produce
    `assets/previews/blue-hour.jpg`. The board card at `index.html:460` exists
    but carries no `data-preview`, so this is the half of the original request
    that never landed.

    ```js
      // ---- Blue Hour: stay in the woods. The trail corridor with the footbridge
      // ahead is the piece's best single frame.
      'blue-hour': {
        async play(p, { shot }) {
          await p.keyboard.down('KeyW'); await wait(4000); await p.keyboard.up('KeyW');
          await wait(1500);                 // let the mist layer drift
          await shot('trail');
          const c = await camState(p);
          return `walking at ${c.pos.join(', ')}, yaw ${c.yaw}`;
        },
      },
    ```

    The summit reads at 24.3/255 now and the fire lookout in fog is the
    strongest single frame in the piece, so either shot is defensible; the trail
    recipe is the safer capture (no teleport, no debug hook), and a summit shot
    would give away the figure on the board card, which is an argument against
    it. The `?debug` hook is available to any of these if a deterministic frame
    is wanted. The full set of doors, from session 1:
    `setWeatherT`/`getWeatherT`/`fogT`/`altT` (the fog cycle is this piece's
    sun, and scrubbing it is how you see both phases in one run),
    `teleport`/`face`/`pos`/`surface`, `cairns`/`layout`,
    `trail`/`yawAlongTrail`, `fireDread`, `dread`, and `info`. Nothing in the
    piece itself opens any of them.

    **`yawAlongTrail` exists because of a bug somebody wrote and then had to
    diagnose**: the trailhead sits at z 145 with `BOUNDS.maxZ` at 150, so a
    test that guesses "face +z and hold W" walks into the edge of the world 5 m
    later and reports a movement bug that isn't there. Handing tests the
    centerline is cheaper than every future session rediscovering it.

    **Absolute timing under software GL is worthless here.** The browser suite
    measures its own frame rate and scales its one timing assertion by it
    rather than hard-coding a distance. Under swiftshader it sees **1.7 fps**,
    and `main.js` clamps `dt` to 0.1 s, so the world genuinely runs in slow
    motion at roughly a tenth speed. That clamp is correct — it stops a stalled
    tab from teleporting the walker — but any future session reading a walk
    distance from this piece must scale it.

Deliberately not done, and still the right call:

- **The summit was not rebuilt.** Documented with numbers instead. Every fix
  moves the heightfield or the world layout, and `smoke.mjs` pins expectations
  that would move with it.
- **The `dread.js` split is the only change to a piece file.** A refactor of
  dread's scheduler into a registry (Golden Hour's creature pattern) was
  considered and dropped — it is tuned, it is tested, and a mechanical move
  risks regressions for zero player-visible gain.
- **No LOD or culling work.** Measured first: 35 draw calls and 280k triangles
  against a budget of 300. There is nothing to optimise, and the instancing is
  already doing it.
- **The chip timing is real seconds now** (session 5) — it ticked 1/60 per
  frame, which meant minutes on a slow tab and 2.4 s at 144 Hz. If any future
  UI element grows a timer, tick it by `dt`, not by frame.
- **The logbook proofread is done** (session 5). All ten pages read through the
  overlay in trail order. If the texts ever change again, walk them again — the
  source order is not the mountain's order.

## Integer Foundry

`Projects/integer-foundry.html`, `Projects/integer-foundry/`.

**Nothing is outstanding as things stand.** The one item still on the table is
deliberately parked, not forgotten:

1. **The two conservative model gaps, if Devon or a future session wants them
   despite the coupling argument.** Both are safe-direction (make orders easier
   than they need to be, never harder), so neither is urgent: mergers/splitters
   are left out of the BFS entirely (a board with `Merge x` but not `x2` gets
   orders capped at 47 on a floor that could reach roughly 529); `opBudget`
   divides the floor evenly across sinks placed, ignoring shared prefixes
   through a splitter.

   Round 3 looked at these longer than "not urgent" alone would justify,
   because the prompt flagged `opBudget`'s fix as the smaller, lower-risk one
   of the two, worth picking up on its own. That isn't true, and it is worth
   writing down why so nobody picks it up in isolation expecting a small
   change: `targets.js`'s whole design commits to one invariant on purpose —
   "the answer does not depend on the layout currently on the floor... so an
   order stays fillable after the player tears their line down." `opBudget`
   currently assumes zero sharing between sinks specifically *because* assuming
   sharing would mean reasoning about whether a splitter is actually placed and
   where, which is layout information the rest of the model is built to ignore.
   You cannot correctly credit a sink for "a splitter could share this prefix"
   without first knowing how much a splitter actually saves, and that number
   does not exist anywhere in this codebase yet — mergers and splitters are
   outside `buildCosts` entirely. So `opBudget`'s fix and the BFS-tree fix
   aren't two independent gaps of different sizes; they're one gap. Any
   standalone `opBudget` change would have to guess at a sharing bonus without
   proving it, which is exactly the kind of guess that turns "conservative" into
   "wrong" in the one system here that has to never over-promise. **If this
   gets picked up, it should be picked up as one piece of work, not the smaller
   half of two** — model mergers/splitters as a tree in `buildCosts` first,
   then `opBudget` can credit actual proven sharing instead of guessing at it.
2. **A cosmetic, non-urgent UX observation, Devon's call, not a task**: once
   `×2` is in play, the sink can ask for a three-digit number (`NEEDS 231`) for
   an order that only takes a short line to fill. The tooltip already explains
   the cheap recipe; whether the tile-cost hint should be more prominent than
   the raw number is a design question, not a bug.

## The Fracture Cycle

`Projects/the-fracture-cycle.html`, `Projects/the-fracture-cycle/`.

**Two rounds running with nothing outstanding.** The one real bug (the
unreachable ending) is fixed, the save question is answered and implemented,
the fonts are vendored, the accessibility issues are fixed, and the test suite
passes. Don't invent busywork for a 799-line game with every ending reachable,
a working save, no offsite requests, and no known accessibility or mobile
issues.

The list below is only for if Devon deliberately decides to expand scope —
none of it is an obvious next step:

1. **A 4th prong, or deeper side content.** The three existing prongs and the
   side-hub detour are each a complete beginning/middle/payoff shape, not
   truncated. Adding more would be new content Devon chooses to commission, not
   a gap being filled. If you do this, replay every existing path afterward —
   a narrative game that silently loses a branch gives no error, the choice
   just isn't there.
2. **Re-verify the branch map after any future edit.** If a later round touches
   the story logic at all, rerun `node Projects/the-fracture-cycle/test/smoke.mjs`
   and replay by hand.

Deliberately not done, twice, and still valid: no restructuring (still one
file, still small enough to hold in one read); no mid-story save (the
ending-tracker design was the actual answer to what this game's replay loop
wants, not a placeholder for a "real" save); no `reset` button on the save bar
(still avoiding two adjacent erase-like controls with different scopes —
"Begin the Cycle Anew" already exists).

## Final Grade Checker

`Tools/final_grade_checker.html`, `Tools/final-grade-checker/`.

**Is this tool in a stable, finished state? No — not yet, and it's a "not yet"
outside the code, not inside it.** The arithmetic is done, correct per Devon's
direct confirmation, and the most-tested part of this codebase: 139 assertions,
every QP-affected case hand-verified against a live DOM and a real exported
CSV/PDF, the fix verified load-bearing by reintroducing the old bug and
watching 12 assertions fail on cue.

1. **Decide what, if anything, needs checking on past report cards.** This is
   bigger than round 2's version of the question. Round 2 thought the risk
   window was one round, because it assumed the only bug was rounding at the
   `.5` boundary. It wasn't — the `.75` band was wrong too, and has been wrong
   since this tool's dual-method calculation first went live, not just for one
   round. Any student whose QP average landed on `x.75` (3.75, 2.75, 1.75 or
   0.75 — one more A-quality quarter than B-quality, or B-quality than
   C-quality, and so on) and whose QP method was the one reported, got a letter
   one grade too high, for the tool's entire history until the round-3 fix. Not
   a code decision — needs Devon's read on whether real report cards were
   involved and what to do about it if so. See Q4.
2. **Get an actual screenshot.** Three rounds in a row, identical failure each
   time ("the Browser pane is not displayed, so the page is not compositing
   frames"), including a round-3 attempt after real user interaction with the
   page. At this point it's worth trying from a session where the pane is
   actually displayed, rather than retrying the same approach a fourth time.
   This is a standing gap in the tool's verification history, not a one-off
   environment hiccup.
3. **The jsPDF-AutoTable column-width warning.** Real, reproducible
   (`console.warn`, "Of the table content, 162 units width could not fit
   page"), pre-existing across three rounds, low value. The export still
   produces a correct, readable PDF regardless.
4. **Configurable grading policies and a "why this grade" audit trail** would
   have surfaced the `.75`-band bug years earlier. Worth doing; not major.

Deliberately not done, and still the right call:

- **The jsPDF-AutoTable column-width warning.** Real, reproducible,
  pre-existing, outside every round's assigned scope. The export still produces
  a correct, readable PDF. Confirmed again in round 3 via the same raw-byte
  capture; still just a `console.warn`, not a defect in the output.
- **Checking specific old report cards for the `.75`-band bug.** Devon's answer
  confirmed the direction of the rule but didn't resolve whether any specific
  past report card needs re-checking, and that's not something the code can
  determine. Flagged rather than guessed at.
- **Building support for letter-only quarters.** Closed by round 2 — Devon
  confirmed directly: never seen in practice. Not re-litigated.

Two things stop this tool being filed as closed, and neither is in the code.
Item 1 above is a real open question, not a formality: whether any actual
report card was affected is something only Devon can answer. And there is no
screenshot, three rounds running, the same failure verbatim each time — that is
no longer a one-off environment hiccup to retry past, it is a standing gap in
this tool's verification history that a fourth identical attempt is unlikely to
close. Net: ship the code, it's right; don't file the tool as fully closed
until both get resolved by someone other than a repeat of the same approach.

Closed and not to be re-litigated: the QP-rounding direction question (round 3
revealed it needed a bigger fix than round 2's own answer); the exact QP
threshold numbers (Devon confirmed 4/3/2/1/0 directly, not 3.5/2.5/1.5/0.5);
support for letter-only quarters. There are no `gvb-save.js` requests here and
never will be — the standing FERPA-based decision is that this tool remembers
nothing.

## Image to PDF

`Tools/image-to-pdf.html`, `Tools/image-to-pdf/`.

**Nothing is outstanding as things stand.** Two purely environmental checks
remain, worth doing if the hardware ever allows it, not worth retrying with the
same approach a fourth time:

1. **Verify the EXIF fix against a real sideways phone photo**, from an
   environment with an actual camera or a real device to hand. Three rounds
   running without one — the fix is reasoned correctly from documented browser
   auto-rotation behavior (`Tools/image-to-pdf.html` lines ~899–902), but
   reasoning from spec isn't the standard of proof this tool otherwise holds
   itself to.
2. **A real screenshot of the two-row mobile layout**, from an environment
   where the browser pane actually composites a frame. Three identical failures
   suggest this sandbox specifically can't do it, not that retrying will
   eventually work.

   If a fourth round of flagging these two doesn't get them in front of a
   different environment, it's worth asking whether they are actually blockers
   this tool needs closed, or accepted-permanently-open items — the code has
   held up every other way it's been tested.
3. **Settings persistence, only if an actual teacher asks for it.** Still just
   a convenience, still not a gap in the tool's core job. Third round declining
   the same speculative feature. If built: plain `localStorage` for three
   primitive values, not `gvb-save.js`.

## Name Picker

`Tools/Name Picker.html`, `Tools/name-picker/`.

1. **The rename**, whenever a session owning the board wants to pick it up.
   Exact edit:

   - `Tools/Name Picker.html` → `Tools/name-picker.html` (the folder is already
     `Tools/name-picker/`, so this pairs it up)
   - the board card's `href="Tools/Name%20Picker.html"` →
     `href="Tools/name-picker.html"`, same commit as the rename, or the card
     404s in between.

   Raised three rounds running, and it became a structural deadlock rather than
   repeated caution: the board's Town Services section no longer links to this
   file directly — it links to `newindex.html`, which holds the real
   `href="Tools/Name%20Picker.html"`. Under the old boundary rules no single
   prompt owned both halves, and both sides declined to cross the line. **Under
   the ownership rule in `CLAUDE.md` that blocker is gone**: a single PR can now
   do the rename and the link together. Not urgent; the current path still
   resolves fine. See Q5.
2. **The stale "twelve keys" comment in `np-store.js`.** Its header comment
   says "All twelve"; the real count is thirteen, confirmed everywhere else.
   One line, low urgency, still there.
3. **The three levels / multiple rosters under real use.** `np_rosters` handles
   it structurally; no browser suite has exercised more than one roster at a
   time.
4. **Mobile and accessibility re-verification.** Round 1 checked 375×812 and
   `prefers-reduced-motion`; nothing has touched CSS or layout since, so
   nothing here could have regressed, but a fresh check is due at some point on
   general principle, not because anything points at a problem. Carried twice.
5. **`leastPicked()`** — written and tested, still unused. Fair rotation makes
   it mostly redundant and the Stats tab's own "Least Picked" sort covers the
   same need, but it's a two-line wiring job if anyone wants a "who's due"
   display.
6. **The rotation-persistence question** — still needs an answer to "is a
   reload the same period or the next one," not code. Nobody's asked yet. See
   Q51.

Deliberately not done, and worth knowing why:

- **Nobody has reproduced the engine-mismatch crash in a Linux environment.**
  Round 3's session only had Windows available. The fix is verified by
  construction and by matching every other project's identical fix that round,
  not by watching the crash happen and then not happen.
- **`leastPicked()` stays unwired.** Fair rotation makes it mostly redundant;
  the Stats tab's own "Least Picked" sort covers the same need. It is written
  and tested, so wiring it is two lines whenever somebody wants the display.
- **The rotation-persistence question stays a question.** Same call all three
  rounds made: it needs an answer to "is a reload the same period or the next
  one," not code, and nobody has asked a teacher yet.

No open bugs, no failing checks, no student-data gap.

## Seating Chart Generator

`Tools/Seating Chart Generator.html`, `Tools/seating-chart/`.

**Nothing outstanding from this project's own history.** Both items carried
into round 3 (the puppeteer-core test bug, rotated desk labels) are done, and
the Google Fonts item confirmed clean. This was the first refresh where this
project's own next-session list was genuinely empty of prior carryover.

1. **The print-all path's rotation fix has no automated assertion**, only a
   manual browser check. The existing print-all test's fixture never rotates a
   desk, and reworking it felt like more churn than the one-line fix (shared
   with the already-covered live-floor path) warranted.
2. If a future round adds a fifth layout preset or any other place a desk gets
   rendered, remember **the counter-rotation lives in two places**
   (`renderFloor()` and `buildSectionPrintHTML()`) — a new render path needs the
   same one-liner or it'll reintroduce the sideways-name bug in just that path.

Worth knowing rather than doing: the rotated-label fix does not touch desk
geometry. The solver's neighbour math (`neighborMap`, centre-to-centre
distance) was never actually coupled to a desk's rotated width/height — a
desk's centre doesn't move when it rotates around itself — so there was no
"swap width and height" project hiding under this after all.

## Orbital

`Projects/orbital/`. Merged directly to `main` outside the normal process
(PR #6); one round of real work since.

1. **A committed browser-driven test layer** — level-grid render/unlock,
   save/reset/wipe buttons, star display — now that the physics layer
   underneath is proven solid. Round 1 deliberately left this uncommitted and
   instead hand-drove a live session to get real answers on the
   reset-confirmation and mobile-aim math, which covers the two things a
   browser test would most have been wanted for. What's missing is a
   *committed, repeatable* version. Use `Tools/board-check/harness.mjs`,
   run-only, and `drive.mjs`'s engine-aware `waitFor`/`textContent` helpers
   rather than a bare `page.waitForFunction(fn, null, opts)`, or you'll add a
   new instance of a bug class that has already bitten several other
   project-owned test files this way.
2. **Verify the rotate-to-play gate on a real device or real touch emulation.**
   Round 1 could only prove the surrounding logic is sound (the gate is
   correctly keyed to pointer type, not viewport width) — this environment's
   browser reports a fine pointer even at a 375×812 viewport, so
   `matchMedia("(pointer:coarse)")` never flips true here regardless of window
   size. Needs different hardware to actually see it trigger.
3. **Revisit `gvb-save.js` adoption**, only if Devon wants save-bar UI
   consistency with the other adopters. Round 1 looked at it seriously and
   decided against: the current hand-rolled save (`orbital_progress_v2`, one
   key, already migrating its own `v1` predecessor) has no bug `repair` would
   fix, and the migration was proved to round-trip clean. Adopting would mainly
   buy the shared save-bar UI and export/import-to-file — a real but different
   kind of value.
4. **A level editor with URL sharing.** 961 lines, 22 provably-winnable levels.
   Hearth already proves the URL-hash pattern. The obvious upgrade; small, and
   only one round old.
5. **A level generator off the solver** already in the test suite.

One correction worth carrying, since the file that carried it is deleted:
**the live level count is 22, not the 21 an earlier survey recorded**, and
pack-02 holds 12 levels, not the "11 levels" its own description claimed.

If a fresh preview/OG pass happens and the promoted "Deep Field" frame doesn't
look right in practice, `js/game.js`'s `computePlan()` and the `aim`/`plan`
globals are the fastest way to try another vector interactively from the
console before committing a `games.mjs` recipe. The candidate that shipped:
`deepspace#11`, an aim drag of world-space vector `(dx: 200, dy: -350)` from
`start` (120, 540), which grazes the blackhole at ~75px and the first wormhole
at ~42px and resolves `plan.outcome === "WIN"`.

## Tools/board-check

The site-wide check and regression suite. Owns `check-integrity.mjs`,
`check-collisions.mjs`, `play-games.mjs`, `tools.mjs`, `capture-previews.mjs`,
`promote-previews.mjs`, `sync-social-tags.mjs`, `games.mjs`, `drive.mjs`,
`harness.mjs`; `play-castle.mjs` belongs to Castle Conundrum, and each project
owns its own test folder even where it imports `harness.mjs`/`drive.mjs`
read-only.

Everything open against this folder is filed under the project that needs it:
Castle Conundrum's preview promotion (rank 83), Aphelion's airlock beat (85),
Golden Hour's preview recapture and debug-hook beats (116, 118), Blue Hour's
`games.mjs` entry and preview recipe (121, 122), the ownership manifest (102),
and Corner & Kettle joining `npm run games` (rank 81, its own Phase 9 —
`play-games.mjs` still has no reference to `coffee_shop_sim` or
`corner-and-kettle`, unchanged since round 1).

Two things about this folder that are decided, not open:

- **`play-castle.mjs` belongs to Castle Conundrum, not here.** Castle
  Conundrum is its only consumer, so no other work can conflict with it, and
  Castle work is unverifiable without being able to add beats to it.
- **`npm run games`, `npm run play` and `npm run previews` open real, visible
  browser windows, and only one may run at a time.** Two will steal focus from
  each other and produce frame-motion and walk failures that look exactly like
  bugs. Prefer a project's own Node suite for iteration and save the browser
  suites for the end.

## The site itself

`index.html`, `404.html`, `newindex.html`, `landing.html`, `assets/`, `CNAME`,
`.github/`.

Five things came up in more than one survey and belong to no single project.

1. **CI runs almost nothing.** Three workflows exist (Numina, School
   Generator, the Firebase deploy). No workflow runs `Tools/board-check`,
   `gvb-save.test.mjs`, or any of the ~20 project suites. The School Generator
   workflow is a good template nothing else reuses.
2. **Asset weight.** Bell to Bell, Castle Conundrum and The Fourth Quarter
   together carry ~380 MB: unreferenced props and texture variants, duplicate
   model formats, uncompressed glTF buffers and 2k textures with no smaller
   tier. One shared pipeline (prune, resize, draco/meshopt) pays off three
   times.
3. **`gvb-save.js` v2.** Quota accounting, multi-key namespaces and an
   IndexedDB tier are what the Schedule Visualizer needs and what Hearth's and
   Bell to Bell's growing saves will want.
4. **Real hardware.** The atmospheric pieces' performance numbers are all
   software rasterization (The Fourth Quarter is the exception: its round-1
   frame times were real Chrome). Touch input has "never had a thumb on it" in
   three separate notes files.
5. **Ownership.** `Tools/prompt-builder.html` is owned by no prompt and
   hotlinks Google Fonts. The survey that raised this said it was "swept by no
   check", and that half is now out of date: locked decision #58 extended
   `check-integrity.mjs`'s sweep, and the page is one of the two standing
   `npm run check` failures today —

   ```
   FAIL Tools/prompt-builder.html
        references offsite host(s): fonts.googleapis.com, fonts.gstatic.com
   ```

   so the fonts are a real, currently-red, one-session fix, and the ownership
   manifest is the separate thing that would catch the next unowned page before
   it gets that far. (The other standing failure is
   `Projects/school-generator/tools/walk-shell.html` — an inline script the
   parser reads as a module, `SyntaxError: HTML comments are not allowed in
   modules`, at line 290. Both predate this consolidation.)

One more, from Hearth's own wishlist rather than a site survey, recorded here
because it is a board question: **Hearth is on the homepage (`index.html:492`,
tagged Sim, `data-new`) with no entry in `Tools/board-check/games.mjs` and no
`assets/previews/hearth.jpg`**, so `npm run games` has never opened it and the
card has no preview. Claimed by Hearth's Phase 8 and its standing backlog; see
Q14 for the question underneath it.

---

## Questions for Devon

Every open decision from every source, deduplicated by question, with how many
times and where it was raised. Six of these are cross-project and have been
asked repeatedly; the rest belong to one project each. A question here blocks
its work; a question answered here should be recorded as a locked decision in
`HISTORY.md` and struck from this list.

**The `Where` column names files that no longer exist.** The prompts, the
notes files and the ten handoffs were deleted in this consolidation; they are
cited by name so a raise count can be checked, and `git log` is where they
live. Nothing in that column is a link to follow.

### Asked more than once, across layers

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q1 | **Is `Pathfinder/data/**` a published interface other projects may read, or private to the Pathfinder pages?** 24 JSON files of PF2e rules data sit there. The Absalom Inheritance reads none of it and hand-writes three stat blocks and seven commands into `content/vault.json` instead; Torchbearer would build its own monster and treasure tables if the answer is private. Both considered depending on it and both correctly stopped rather than assume. `UPGRADE-PATHS.md` calls it the highest-leverage *decision* on the site. | **6** | prompt 01's block (the central tracker), prompts 10 and 11 raising it into that block, `Projects/torchbearer/WISHLIST.md`, `Projects/absalom-inheritance/WISHLIST.md`, `UPGRADE-PATHS.md` "Close behind", `gvb-site-handoff-v10.md` "Three things" and §11.4 |
| Q2 | **Should the Serve button require full order completion, now that baristas — not the player — are the main path to a finished cup?** The gate is `cupMatchesEnough()` at line 1392: four lines, checking that a base exists and, if the recipe needs milk, that some milk is poured. Not the right milk, not the syrup, not the toppings, not the shot count. Measured on otherwise identical days: patient serving (waits for `orderIsComplete()`) 41 offered, 41 served, $309 net, 100% accuracy, reputation 50 → 66.4; eager serving (clicks the instant `disabled` comes off) 43/43, $77, 46%, reputation 50 → 19.2. Three answers are all real: tighten the gate to `orderIsComplete()`; keep it loose and put a cue on the button ("still missing: syrup, whip"); or leave it exactly as it is, because the accuracy and reputation hits already are the consequence. **The recommendation is the cue** — `serveSlot()` already prices partial credit deliberately (`earned = recipe.price * (0.35 + 0.65 * ratio)`), so serving a wrong cup for 35% of the price is a designed mechanic, not an oversight, and a hard gate would delete the one lever a player has when four customers are about to walk. What is broken is that the tradeoff is invisible at the moment of the click. | **4** | prompt 12's block, `Projects/corner-and-kettle/WISHLIST.md`, the round-3 refresh notes, `gvb-site-handoff-v10.md` §8 |
| Q3 | **What should "Not interested" to Earl actually do?** Choosing it at `m1_player_response` sets `GS.rels.earl = 'absent'` and `GS.flags.earlResponse = 'not_interested'`, which removes exactly three optional evening cards: the FR1 contract reading, the FR3 renegotiation, the FR4 Vegas call. Milestones 2, 3 and 4 read neither value. `_chapter_m2` picks its entry scene from `stuntOutcome`/`hubEveningsUsed` only, and `showChapter`'s subtitles are fixed strings. Earl comes back, negotiates across three rounds, and `m2_sign` sets `rels.earl = 'backer'` again. Two shapes: **(A)** keep "Earl doesn't take no for an answer" and pay it off with acknowledgment beats at M2, M3 and M4, or **(B)** write a genuinely smaller, self-financed middle game. **The recommendation is B, scoped to Milestone 2 and threaded through 3 and 4** — the FR2 debt scene, the four `debtSource` answers and the Sandra press thread are already the raw material, and A leaves a six-way choice with one cosmetic arm. Called "the single biggest open item on the site" by three separate sources. | **5** | prompt 13's block, `Projects/daredevil/WISHLIST.md` Phase 1, `gvb-site-handoff-v10.md` "Three things" and §11.1, the round-3 refresh notes, prompt 22's notes |
| Q4 | **Does any real report card, at any point in this tool's history, need a second look?** The round-3 fix corrected a bug live since the dual-method calculation first went live — not one round, as round 2 assumed. Any student whose quality-points average landed on an `x.75` value and whose QP method was the one reported got a letter one grade too high, for as long as the tool has existed. Devon confirmed the rule ("a student should only get a letter grade if they earn the FULL quality point... it is rare... but does happen in edge cases") but not whether any specific report card needs revisiting. If this tool graded anything real, that's the same kind of call round 1's percentage fix needed: check old report cards, note it somewhere, or say nothing needs checking. | **5** | prompt 16's block, `gvb-site-handoff-v9.md` "Three things" (the narrower version), `gvb-site-handoff-v10.md` "Three things" and §11.2, the round-3 refresh notes, prompt 22's notes |
| Q5 | **Should the `Tools/Name Picker.html` → `name-picker.html` rename be authorized?** Three rounds running, and it became a structural deadlock rather than repeated caution: the board's Town Services section links to `newindex.html`, which holds the real `href="Tools/Name%20Picker.html"`, so the same-commit change a rename needs is one line in `newindex.html` plus the file rename itself — and under the old boundary rules no single prompt owned both halves. Both sides declined to cross the line twice each. **The ownership rule in `CLAUDE.md` removes the blocker**, so the question is now only whether the rename is wanted at all, or whether "leave it forever" is the actual answer so it stops recurring. | **6** | prompts 18 and 22 carrying the same question from both sides, `gvb-site-handoff-v10.md` §9 and §11.6, prompt 18's notes, prompt 22's notes |
| Q6 | **How should storage quota be handled for `gvb-save.js` adoption in the Schedule Visualizer?** Open three rounds; the answer has been "skip adoption" each time. Measured: 23 `localStorage` call sites remain in `app/` (13 `getItem`, 8 `setItem`, 2 `removeItem`) across seven key families plus five snapshot slots. **Every snapshot is a whole project** — `saveSnapshot` stores `serializeFullProject()`, blueprint included, so a browser with all five slots used holds six copies of the blueprint. **The save paths disagree about what a full disk means**: `saveSnapshot` is the only one that tells the user; `saveSchedules`, `saveVizPrefs` and `saveBlueprintToLocalStorage` `console.warn` and say nothing on screen — and the blueprint one leaves the autosave indicator stuck reading "Saving…", because `updateSaveIndicator()` is inside the `try`; `saveWhatIf` swallows it; **`saveSettings` and `saveLastSavedTime` have no `try`/`catch` at all** (`data-model.js:289` and `:308`) and throw out of their caller. So: (a) one slot holding the whole project — which collides with locked decision #36, since seven keys would become one — or seven slots, which needs `createSaveSlot` to grow a namespace and a shared budget? (b) When the disk is full, which write loses: the newest snapshot, the oldest, or the What-If sandbox? (c) Is IndexedDB spillover for the blueprint acceptable, when nothing else on the site uses it? | **4** | prompt 19's block, `Tools/schedule/WISHLIST.md` Phase 4, the round-3 refresh notes, `gvb-site-handoff-v10.md` §8 |

### Bell to Bell

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q7 | **Authoring or generation?** T6 shipped a second hand-authored roster, schedule and lesson; T7 one hand-authored observation at a fixed minute 30. Both deliberate — prove the authored shape before automating it. Phase 2 is the automation. Now, or does a third authored period come first? | 2 | `Projects/bell-to-bell/WISHLIST.md`, `docs/HANDOFF.md` |
| Q8 | **Does the period need a fail state?** Answered "still no" three times. Confirming it lets Phase 3 stop designing around the possibility. | 2 | wishlist, `docs/HANDOFF.md` |
| Q9 | **Is suppression too strong?** Measured: in every 4th-period balance run exactly one scheduled tell never happens (Priya in front of June); splitting the pairs makes that "2 never happened, 2 found another way" and drops restless from 72 to 44. The handoff's own fix, if it is too strong, is a per-period cap on how much one kid absorbs, not a nerf to the effect — and now watch it across *two* rosters (Priya and Anh both), not just one. | 2 | wishlist, `docs/HANDOFF.md` |
| Q10 | **Is the Observation's ambient Mastery cost calibrated?** `CFG.observation.masteryDrainPerSec` is 0.008 — ~5 points over the window, by design math and not by playtest. In the table it costs the good teacher nothing visible (79 either way) and buys 10 Fidelity if performed. | 2 | wishlist, `docs/HANDOFF.md` |
| Q11 | **Mobile.** Undecided, and the answer determines whether Phase 8 exists. `input.js` has `touchstart`/`touchmove` look and no way to walk or to press E, Q, R, T, O, H, G or F. | 2 | wishlist, `docs/HANDOFF.md` |
| Q12 | **An announced Observation variant?** Treatment §6.1 has both announced and surprise; only unannounced is built. The handoff calls the surprise one funnier and rates this low; Phase 4 assumes yes. | 2 | wishlist, `docs/HANDOFF.md` |
| Q13 | **Should Room Temp reveal direction at all?** "Still unchanged." Room Temp names bands and quadrants only; naming is what the Withitness mode is for. | 1 | `docs/HANDOFF.md` only |

### Hearth

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q14 | **Should Hearth join the board's regression suite?** It is on the homepage (`index.html:492`, tagged Sim, `data-new`) but has no entry in `Tools/board-check/games.mjs` — thirteen games are described there, Hearth is not one — and no `assets/previews/hearth.jpg`, so `npm run games` never opens it and the card has no preview. Its own harness is far better than a board-check `open()` recipe; the question is whether the board wants the shallow smoke test anyway. | 1 | `Projects/hearth/WISHLIST.md` |
| Q15 | **Does Hearth get a CI workflow, and in what shape?** `.github/workflows/` carries `school-generator-ci.yml` and `numina-ci.yml` and nothing for Hearth, so sixteen sprints of regressions have only run on somebody's desk. The full suite is eleven modes of headless Chromium; a PR gate of `soak --days 12` + `determinism` + `save` is minutes. | 1 | wishlist |
| Q16 | **Does the name-recycling quirk stay a feature?** Songs live on names (`songs[].kn` is a list of strings) and the ancestor-naming rule can hand a newborn a dead knower's name, so that child "knows" every song the ancestor knew and can resurrect a lost one. Rare; reads as poetry; fixing it means packing knower identity beyond names. Keep, or pay for identity? | 2 | wishlist, sprint 16 handoff |
| Q17 | **Does the population cap overshoot actually grate?** Six sprints noted it and six concluded it isn't worth one: `popCap()` is `4+houses.length*2`, arrivals respect it, and the birth rule (`js/life.js:102`) allows `people.length<popCap()+1`, so rich islands settle at 47–49 by day 121. The number is one character. Is 49 wrong, or just noticed? | **7** | wishlist, and sprint handoffs 11, 12, 13, 14, 15, 16 |

### Torchbearer

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q18 | **Should Torchbearer be the site's PF2e rules engine, or only its own?** The Absalom Inheritance's round-3 notes name "a real interrupt point in the turn loop that doesn't exist yet" as its number-one next item — the same mechanism Torchbearer's Phase 3 builds. Solving it once, in the project that already advertises itself as a platform, is the recommendation. Whether the two ever *share code* is tied to Q1: locked decision #17 says each project vendors its own copy, so a shared rules module would be a deliberate exception. | 2 | `Projects/torchbearer/WISHLIST.md`, `Projects/absalom-inheritance/WISHLIST.md` |
| Q19 | **Does the engine grow past level 3?** The authoring guide §13 states the intent as "correct-feeling PF2e at level 3, not a rules-complete VTT", and Phase 6 contradicts it on purpose. Worth doing only if a campaign is wanted. | 1 | wishlist |

### The Absalom Inheritance

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q20 | **Is the 53.6% / 79.8% split between builds the design, or a tuning debt?** Round 3 called the asymmetry deliberate. If the two builds are meant to be comparable challenges, `balance.mjs` needs a band per build rather than one shared 45–90% window; if they are an easy mode and a hard mode, the picker should say so, since a player choosing Kessa Vane cannot tell. | 1 | `Projects/absalom-inheritance/WISHLIST.md` |
| Q21 | **Does the adventure grow, or does the engine deepen?** Twelve to sixteen minutes, two rooms, four fights. Arc one deepens the engine on the rooms that exist; arc two spends the same effort on more rooms. A taste question, not a technical one. | 1 | wishlist |

### The Fourth Quarter

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q22 | **Should the ladder be physically bigger?** Four tiers, $0 to $34,000, one 30-seat room, and `buildWorld()` ignores the venue it is handed. Phases 1–3 are the largest single piece of work in that file. Round 2's honest-30-seats fix means nothing currently lies, so this is a want, not a fix. | 3 | wishlist, prompt 07, `Projects/fourth-quarter/README.md` roadmap |
| Q23 | **Should there be a way to lose?** Cash goes negative, turns red, and nothing else happens. Options that fit what exists: a bankruptcy threshold, a lease that can be lost (a downgrade rather than a game over), a bank that stops lending. Round 3 declined to invent one unprompted and was right to. | 3 | wishlist, prompt 07's notes, README roadmap |
| Q24 | **How much of the 2D campaign is actually wanted?** 21 event cards, a 14-week season with a 4-team bracket, regulars, a rival, three distributors. All of it ports; none of it is small; a 3D floor game with a full back office is a different game. Phases 6–9 assume "most of it, in that order." | 2 | wishlist, README roadmap |
| Q25 | **Is 66 MB of texture on first paint acceptable?** 27 JPEGs, 69,218,191 bytes, all 27 loaded by the first room. Uncompressed in GPU memory that is roughly 600 MB with mipmaps (2048² × 4 × 27 × 1.33 — arithmetic, not a measurement). Phase 4 cuts it by an order of magnitude at some visible cost. | 1 | wishlist |
| Q26 | **Has `SPOILAGE_RATE = 0.15` actually been played yet?** One number in `campaign.js`, tune by feel; no assertion depends on the exact value except one asserting 15% of 20 rounds to 3. | 3 | wishlist, prompt 07, README roadmap |

### Faire Weekend

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q27 | **Are the four economy numbers right?** `perGuestCost: 5`, `upkeepRate: 0.07`, `bankruptcyFloor: -6000` and `winCondition`'s three thresholds have been flagged "most likely to need adjusting after real play" for four rounds running, and no round could answer it because nobody has played a full season. The `SIGNIFICANCE:` tests prove they are not degenerate, not that weekend 6 is a satisfying place to arrive. | **4** | `Projects/Ren-Faire-Claude/WISHLIST.md`, prompt 09, the project's notes, `HANDOFF.md` backlog |
| Q28 | **Should winning end the run?** `acknowledgeVictory` drops back into the ordinary weekend-end screen and play continues — but `GRID_EXPANSIONS` runs out at weekend 4, so every weekend after the win is the same weekend. Is the sandbox the intent, or is a second track owed? | 1 | wishlist |
| Q29 | **Is the 1080px breakpoint a touch device?** Round 3 fixed 720px to a 44px floor and deliberately left 1080px at `--cell: 38px` (34px markers), reading a narrow laptop window as mouse-driven. A named exclusion that wants a ruling. The slider and two `<select>`s have never been measured for touch size at all. | 2 | wishlist, the project's notes |
| Q30 | **Does the fixed `fit-content(710px)` board column bother you?** Sized to the widest tier, so a Home Grounds save carries ~54px of empty mat right of the map; adaptive means threading `--cols`/`--cell` from `ui.js` onto `#board`. | 3 | wishlist, prompt 09, the project's notes |

### Daredevil

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q31 | **Is the six-way Earl response at the fair the shape it should be?** Open since round 1. Only option 5, "I need to talk to someone first," reaches `m1_ruthie` and sets `rels.ruthie = 'solid'`, so five of six answers lock Ruthie out of all four hubs and the epilogue for the whole game. Option 5 is also the only one that never sets `rels.earl`, so a Ruthie run carries Earl as `'unknown'` to the ending screen, where the epilogue prints "Earl Maddox. The relationship is still being decided." after a run in which he backed every show. | 3 | `Projects/daredevil/WISHLIST.md`, the project's notes (twice, rounds 2 and 3) |

### Numina

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q32 | **What is the attribute cost curve?** `skills/attributes-vitality.md` gives "Cost to Increase: *Cost of next attribute*" for Prowess, Insight, Fortitude and Vitality — circular, and the escalating numbers appear nowhere in `src/` or `source-material/markdown/`. A CP calculator cannot be written without them. Are they in the PDF's chart and the conversion dropped it, or genuinely unpublished? | 1 | `Numina/WISHLIST.md` |
| Q33 | **Should the Excellencies chapter be ported at all?** `skills/excellencies.md` is 34 words of developer-facing stub and there is no `source-material/markdown/skills/excellencies.md` — the one skills chapter with no conversion behind it. Meanwhile `hidden-excellencies-expressions.md` names 21 hidden ones openly. Withheld deliberately, or just unconverted? | 2 | wishlist, `numina-audit-2026-08.md` A3 |
| Q34 | **Do the eight nations with a blank `capital` have one?** Kindaria, Merrigor, Mists of Eltiel, Myos Islands, the Principalities of the Reach, Rues, T'barris and the Vale of Scyllina are `capital: ""`; five are `demonym: ""` (the Five Duchies' entry says outright that it has none). If the book does not name them, the infobox should collapse rather than render a flag chip over one "See also" row. | 2 | wishlist, audit A4 |
| Q35 | **Is the custom-domain move happening, and when — and does `numinalarp.com` serve HTTPS?** The README calls it a one-line `PATH_PREFIX` change and `site.json`'s `origin` feeds every absolute URL, but `test/smoke.mjs` hardcodes both `PREFIX` and `ORIGIN`. `site.json` and `quick-reference.md` both link `http://`; batch 1 asked and could not verify from its sandbox either. | 2 | wishlist, audit D4 |
| Q36 | **Is a character builder welcome?** The footer says "Unofficial player reference", `expressions.md` sends players to NuminaRules@gmail.com to confirm a third-Expression build, and Excellency and Expression purchases "must be unlocked in-game". A builder that prices a legal-looking character staff would reject is worse than none. Phase 3 assumes yes with loud caveats; say so before it is built if that is wrong. | 1 | wishlist |

### Schedule Visualizer

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q37 | **Is there a copy of the real East Middle project file anywhere?** Three rounds have been unable to regenerate `Tools/schedule-browser.html` end to end because the real blueprint lives in whoever's browser last built it. Phase 3 works around it with no data at all, but a real project export would retire the caveat outright. | 3 | `Tools/schedule/WISHLIST.md`, prompt 19, the project's notes |

### The projects with no wishlist

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q38 | **Does `characters.html` get a commented-out `<template>` dossier block?** Documentation convenience, not a bug. Devon's call on style; not requested in three rounds. | 3 | prompt 03, and its notes in rounds 2 and 3 |
| Q39 | **Should `characters.html` adopt `gvb-save.js` for in-browser editing?** Only if the page's role should shift from showcase to living character sheet. Not requested in three rounds. | 3 | prompt 03, and its notes in rounds 2 and 3 |
| Q40 | **Does Aphelion ever need to run on a tablet or phone?** Three rounds have each re-derived "no evidence yet" from scratch rather than asking. The answer decides whether the touch/gamepad input scheme is worth building. | 3 | prompt 04, and its notes in rounds 2 and 3 |
| Q41 | **Is Castle Conundrum's captured preview candidate the right frame?** It sits in `candidates/`, chosen, dated a fair-environment refresh, deliberately not promoted so this project's own session could look first. | 2 | `gvb-site-handoff-v10.md` §9 and §11.3, prompt 22's notes |
| Q42 | **Is Closing Time's multi-career history worth the save-shape work?** Whether the career ending is more than a one-time wall, and whether players actually hit it repeatedly. Three rounds of notes have said the same. | 3 | prompt 06's notes across three rounds |
| Q43 | **If Golden Hour's night proves popular, should the owl hunt?** One swoop over the dunes, no kill shown; and the fireflies drifting toward the fire when it burns. | 1 | the project's notes |
| Q44 | **Blue Hour's causeway: which of the three ways out?** A `mountainH` term following the trail's arc-length height; re-anchoring `trailYof` to the hillside; or accepting a ridge trail and widening the bench. All three move the heightfield and rebaseline `smoke.mjs`; the third also has to answer why the blaze posts stand at the lip of a 10 m drop. | 1 | prompt 24, session 6 |
| Q45 | **Blue Hour's direction: keep pushing into `dread.js`, or lock "no save, no verbs, no collection" as a decision?** The ending pass committed hard to dread over collection, so Golden Hour parity is now the odd option out and shouldn't be adopted without asking. | 2 | prompt 24, the notes' sessions 2 and 4 |
| Q46 | **Blue Hour's phantom pan: accept 0.000, or point `downhillAt` at the fall line?** The second changes the eyes' drift and the shape's head-flip too, since all three read the same function — an argument for doing it deliberately or not at all. | 1 | prompt 24, session 6 |
| Q47 | **Should Integer Foundry's tile-cost hint be more prominent once `×2` lets a sink ask for a three-digit number?** The tooltip already explains the cheap recipe. A design question, not a bug. | 2 | prompt 14, the project's notes |
| Q48 | **Do Integer Foundry's two model gaps get built despite the coupling argument?** Two rounds have looked hard and declined; the third added a real argument for why they are one piece of work, not two. This is the one thing that would pull the project back off the shelf. | 2 | prompt 14, the project's notes |
| Q49 | **Does The Fracture Cycle get a 4th prong or deeper side content?** Not a gap being filled — new content Devon chooses to commission. Two rounds have said the same. | 2 | prompt 15, the project's notes |
| Q50 | **Are Image to PDF's two environment-blocked checks blockers, or accepted-permanently-open?** The EXIF verification and the mobile screenshot are verified-by-reasoning-only across three straight sessions for the same environmental reason. The code has held up every other way it's been tested. | 3 | prompt 17, and its notes across three rounds |
| Q51 | **Name Picker's rotation persistence: is a reload the same period or the next one?** Not code. Nobody has asked a teacher yet. | 3 | prompt 18, and its notes across three rounds |
| Q52 | **Does Orbital adopt `gvb-save.js` for save-bar UI consistency?** Not needed for correctness — round 1 proved the existing migration round-trips clean. Purely a question of whether UI consistency with the other eleven adopters is wanted. | 2 | prompt 21, the project's notes |

### Answered, kept here so they are not re-asked

- **Should `campaigns.html` and `characters.html`'s shared CSS and fonts be
  merged?** Answered round 2: **harmonize, don't share.** `[shared]` drift-guard
  comments mark every byte-identical rule; locked decision #17 stays in force
  for this pair. Raised independently three times before it was settled.
- **Is one clean verification round enough to call a project done?** Answered by
  Devon, 2026-08-03: **yes**, matching the precedent already set.
- **Should The Fourth Quarter's night loop have a day-based difficulty curve?**
  Answered: **spoilage**, built in round 3. Rent already scaled with venue tier.
- **Are the 3.5/2.5/1.5/0.5 quality-point thresholds right?** Answered: **no** —
  they were not even the right *shape*. The correct thresholds are whole
  numbers, 4/3/2/1/0.
- **Should the committed schedule data stay?** Answered: **leave it as is.** No
  student names, so no FERPA issue; the school-security question (34 real staff
  surnames, rooms, and — combined with the floor plan — every teacher's
  planning-period block, at a public URL) was decided directly: change nothing.

---

## Ownership

Which paths each area owns, and which shared paths it may not change alone.
Lifted from the retired prompt system's boundary table, which is the only place
this was ever written down. **The "shared, do not touch alone" column is now a
"say so in your PR" column, not a queue**: make the edit in your own branch, in
the same commit as the project change, and call it out in the PR body.

| Area | Owns | Shared paths it must not change silently |
| --- | --- | --- |
| Anathema Archive | `Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json data.py`, `Pathfinder/tests/` | `index.html`, `assets/js/gvb-save.js`, `Tools/board-check/**`, `assets/previews` + `assets/og` |
| Pathfinder Campaigns | `Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/` | as above |
| Pathfinder Characters | `Pathfinder/characters.html`, `Pathfinder/characters-assets/` | as above |
| Aphelion | `Projects/aphelion/` | as above |
| Castle Conundrum | `Projects/Castle Conundrum/`, **and `Tools/board-check/play-castle.mjs`**, which is its own | `index.html`, `assets/js/gvb-save.js`, the rest of `Tools/board-check/**`, `assets/previews` + `assets/og` |
| Closing Time | `Projects/Closing Time/` | the four shared |
| The Fourth Quarter | `Projects/fourth-quarter/` | the four shared |
| Golden Hour | `Projects/golden-hour-beach/` | the four shared |
| Faire Weekend | `Projects/Ren-Faire-Claude/` | the four shared |
| Torchbearer | `Projects/torchbearer.html`, `Projects/torchbearer/` | the four shared |
| The Absalom Inheritance | `Projects/absalom_inheritance.html` (shell, URL unchanged), `Projects/absalom-inheritance/` | the four shared |
| Corner & Kettle | `Projects/coffee_shop_sim.html`, `Projects/corner-and-kettle/` | the four shared |
| Daredevil | `Projects/daredevil/` (`Projects/daredevil_r4.html` is a redirect stub) | the four shared |
| Integer Foundry | `Projects/integer-foundry.html`, `Projects/integer-foundry/` | the four shared |
| The Fracture Cycle | `Projects/the-fracture-cycle.html`, `Projects/the-fracture-cycle/` | the four shared |
| Final Grade Checker | `Tools/final_grade_checker.html`, `Tools/final-grade-checker/` | the four shared |
| Image to PDF | `Tools/image-to-pdf.html`, `Tools/image-to-pdf/` | the four shared |
| Name Picker | `Tools/Name Picker.html`, `Tools/name-picker/` | the four shared, plus `newindex.html`'s link to it |
| Schedule Visualizer | `Tools/schedule-visualizer.html`, `Tools/schedule-browser.html` (old dated paths survive as redirect stubs), `Tools/schedule/` | the four shared |
| Seating Chart Generator | `Tools/Seating Chart Generator.html`, `Tools/seating-chart/` | the four shared |
| Orbital | `Projects/orbital/` | the four shared |
| Blue Hour | `Projects/blue-hour-trail/` | the four shared |
| Hearth | `Projects/hearth/` | the four shared |
| Bell to Bell | `Projects/bell-to-bell/` — and its own `CLAUDE.md` governs inside it | the four shared |
| School Generator | `Projects/school-generator/`, `.github/workflows/school-generator-ci.yml` | the four shared |
| Numina | `Numina/` — **but see the constraint below** | the four shared |
| The site | `index.html`, `404.html`, `newindex.html`, `landing.html`, `assets/` (including `assets/fonts/`), `Tools/board-check/` (except `play-castle.mjs` and any project's own test folder), `CNAME` | — |

**A project owns its own test suite**, including a browser-driven one that
imports `Tools/board-check/harness.mjs`/`drive.mjs` read-only —
`Projects/fourth-quarter/test/`, `Tools/name-picker/test/browser.mjs`,
`Tools/seating-chart/test/drive-seating.mjs`,
`Projects/integer-foundry/test/browser.mjs` and others. Those are per-project
files even though they drive a browser the same way the shared tooling does.

**`Numina/test/smoke.mjs:180` enumerates Numina's allowed top-level files.**
`README.md`, `CONTENT-GUIDE.md`, `WISHLIST.md`, `package.json`,
`package-lock.json`, `.gitignore`, `eleventy.config.mjs`, `src`, `test`,
`tools`, `source-material`, `node_modules`, `.cache`, `discord-logs` and the
generated set — and nothing else. **Do not add a new top-level file under
`Numina/`**; `npm test` there fails if you do.

---

## Where the sources disagree

Eight places two sources rank the same work differently. The table follows
`UPGRADE-PATHS.md`, as the newest, in every case. As above, the files named
here were deleted in this consolidation and survive only in git history.

1. **Daredevil.** `UPGRADE-PATHS.md` ranks the project 7 of 10, so its Phase 1
   sits at rank 49. `gvb-site-handoff-v10.md` §11, the round-3 refresh notes
   and prompt 22's notes all rank the Earl decision **#1 on the site**. It is
   also blocked on Devon (Q3), which is the argument for not opening with it.
2. **Bell to Bell's own next ticket.** The wishlist opens with the save-slot
   architecture (rank 1 at the time, shipped as PR #104); `docs/HANDOFF.md`
   says the next ticket is **T8, whisper audio**, which the wishlist ranks
   Phase 7 (rank 6).
3. **Final Grade Checker.** `UPGRADE-PATHS.md` "Close behind" calls it "worth
   doing; not major"; `gvb-site-handoff-v10.md` §11 ranks its report-card
   question **#2 site-wide**. Ranked here at 82 and 97.
4. **`Pathfinder/data/`.** `UPGRADE-PATHS.md` calls it "the highest-leverage
   *decision* on the site" and then files it unphased under "Close behind";
   v10 §11 ranks it #4. Ranked here at 84.
5. **The Schedule Visualizer's quota question.** Its wishlist makes it Phase 4
   (rank 68); prompt 19 and the project's own round-3 notes both rank it **#1**
   — "the largest remaining item and the only one that cannot start without
   Devon."
6. **Castle Conundrum.** `UPGRADE-PATHS.md` says the piece "is finished as
   designed" and ranks nothing; v10 §11 ranks its preview promotion **#3
   site-wide**. Ranked here at 83.
7. **Faire Weekend's layout and density review.** Prompt 09 and the project's
   notes call it "the headline item now", owed four rounds running; the
   wishlist puts it at Phase 5 (rank 45), behind guest agents.
8. **Golden Hour and Blue Hour.** `UPGRADE-PATHS.md` says both are "blocked
   first" on a real-GPU run; each project's own next-session list ranks that
   #2 and #3 respectively. Ranked here at 115 and 123.
