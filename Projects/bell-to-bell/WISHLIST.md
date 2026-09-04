# Bell to Bell — Feature Wishlist

**Status: Phases 1 through 7 have shipped. The game is at T7 plus seven phases:
a four-period day whose 7th period is generated from a seed, a five-day week
the semester record carries each class across with admin's ladder at the end of
it, an AP whose visits are a calendar rather than a metronome, four subjects
that are files rather than branches, an `Assets/` tree that knows what it
weighs, a three.js that is vendored rather than fetched, and tells that are
objects in the room rather than boxes in a vision mode. `tests/smoke.mjs`
prints 561 PASS lines and no FAIL, `tests/assets.mjs` audits the asset
manifest against a budget, and `tests/balance.mjs` runs six styles through 4th
period, one style across three seating charts, three styles through each later
period, the whole day on one Bandwidth pool, fifty generated seeds through the
band (its one assertion), four subjects side by side, one lab day under four
styles, and two styles through a week on the AP's real calendar. The first open
phase is Phase 8 — A thumb has never touched this, on **Claude Opus 5**.**
The prior work through T7 is recorded in the repo root's `HISTORY.md`, with the
balance table as it stood at the end of T7. This file is what comes after: the
architecture as it actually is, the conventions the project already learned,
the standing backlog, and eight ranked phases.

## What it is

A first-person 3D game about teaching, at `Projects/bell-to-bell/index.html`.
No build step, no `node_modules`, no package manager — `package.json` is three
keys and exists only so Node treats the test files as ES modules. It has to be
**served** (`python3 -m http.server 8000`); ES modules do not load over `file://`.

What ships today is **Slice 001 — "One Period"**: forty-seven game-minutes in RM
214, compressed 10:1 by `CFG.timeScale` into about four and a half real ones,
with twelve students, five authored lesson beats summing to exactly 2,000
seconds, an intercom interruption at minute 19, an Observation on some periods
and not others, and four endings. Take the report screen's offer and you get
5th, and then 6th, and then a 7th nobody authored — same room, a different
twelve kids each time, each with its own tell schedule and lesson, out of
`data/period5.json`, `data/period6.json` and a seed. The day itself is
`data/periods.json`, four rows deep, and what each row teaches is a subject
file in `data/subjects/`.

The mechanic it is built around is **Withitness**: hold SHIFT and the room goes
thermal and every tell in line of sight annotates itself. Three things keep that
a game rather than a cheat button. It drains Bandwidth. Mastery ticks down while
you are in it, because you are standing at the front staring at nothing. And
Hypervigilance rises, which never disables the ability — it makes the ability
lie, and you cross the room, and it is a granola bar. The line of sight is a real
raycast against furniture defined in `data/room.json`, which is why the seating
chart and the classroom builder are the same puzzle as the vision mode.

What it is not: a school day, a semester, or a year. The treatment
(`docs/BELL-TO-BELL-treatment.md`, 468 lines) describes six subjects of which
four are files, eight bureaucracy minigames of which one is built,
seven Calendar bosses, rumor propagation on the seating graph, a hidden fifth
meter, and a ten-year meta-arc. Three periods of one of those days exist, and
what carries between them is your seating chart, your furniture layout, what you
watched happen, and your Bandwidth — Mastery, Fidelity, Rapport and Restlessness
still reset from `CFG.start` at every bell, because they are facts about walking
into a room rather than facts about the day.

## The architecture that is there

About 5,500 lines across 39 files in `src/`, 78 KB of JSON across 21 files in
`data/` (five of them subjects), and 142 MB in `Assets/`.

**The three-free core** — seventeen modules importing neither three.js nor the
DOM, and therefore the only part of the game the Node suites can reach. Phases
2 through 5 added eight of them, all pure:

- `systems/simulate.js` (Phase 2) — the period, headless. `balance.mjs`'s old
  `run()` extracted so the generator's band check and the balance table run
  the same code; `STYLES` holds the six play styles by name.
- `systems/rng.js`, `systems/roster.js`, `systems/scheduler.js`,
  `systems/generate.js` (Phase 2) — a seed, twelve kids, their tell schedule,
  and the band check that re-rolls the schedule until two crude teachers land
  inside `data/generation.json`'s ranges. `rosterProblems()` and
  `scheduleProblems()` are the promise lists; the suite breaks each promise on
  purpose and watches the list catch it.
- `systems/semester.js` (Phase 3) — the record. `entering()` says what a class
  opens with, `recordPeriod()` takes what it closed with, `advanceDay()` is the
  night: retention toward the baseline from either side, Fidelity and Rapport
  reverting toward their means, and admin's ladder off the days on the books.
  Versioned from day one, `repair`ed on every load. Phase 4 added the semester
  seed (version 2) and `owed`, the follow-ups you promised AP Reyes.
- `systems/subject.js` (Phase 5) — what a room teaches. Almost all of it is
  merging a subject's JSON over the day's: meter modifiers, tell-type weights
  the Phase 2 scheduler consumes, event and intervention flavor, and the props
  and occluders a subject puts in the room. The one rule it adds is Hazard, and
  Hazard is one number. Nothing in `src/` may name a subject id; the suite
  greps every file to make sure.

The nine that were there before:

- `systems/chart.js` (289) — the seating chart, headless. Desk assignment,
  adjacency, `resolveSchedule` (what the authored tell schedule *becomes* once
  you decide who sits where), suppression, `rechartCost`, `occluderLayout`,
  `viewModel`, and the free function `learnFrom` that turns a finished period
  into discovered edges and stabilisers. The largest module and the one every
  later feature leans on.
- `systems/lesson.js` (225) — beats, per-student comprehension, checks,
  reteach. It **owns Mastery**: the only thing that computes the mean of twelve
  numbers and the only thing that spends `masteryPending`.
- `config.js` (132) — every tuning constant, in one object.
- `systems/observation.js` (110) — the phase machine (`idle → alert → active →
  done`), five look-fors, the ambient drain, the one-exchange conference.
- `systems/interventions.js` (86), `state.js` (74, where `applyEffects` refuses
  to write `mastery` and queues it instead), `systems/roomtemp.js` (72),
  `systems/sightlines.js` (51), `systems/meters.js` (36).

**The three.js half** — `world/students.js` (324, bodies, the reaction tween,
the comprehension aura), `world/room.js` (174), `world/models.js` (160, glTF
loading), `systems/tells.js` (160, tell lifecycle and meshes and the raycast),
`world/materials.js` (116, palette, thermal twins, swap registry),
`world/board.js` (80), `main.js` (468). **The DOM half** — `ui/`, nine files and
349 lines, largest `ui/seating.js` (243, the chart screen); it never imports from
`systems/`, and `ui/dom.js` is the one permitted singleton.

**`main.js` is wiring and one frame loop.** The seam between periods is
`src/periods.js` (three-free), which reads `data/periods.json` and hands
`main.js` one resolved period, generating it from the slot's seed and the day
if the row says `generate`; everything in `main.js` is period-agnostic and it
no longer names a class or a save slot anywhere. `endPeriod()` runs
`learnFrom`, writes the period onto the semester record, persists, and hands
the report a `restart` action that writes `persist` keys and calls
`location.reload()`. That reload *is* the period transition, and the last
period's button is the night: `advanceDay` runs before it, and on Friday the
week screen (`ui/week.js`) sits between the report and Monday. There is no
teardown/rebuild path, because the linear boot sequence already runs once per
page load.

**Where the habits break down.** Content-not-code holds: a new tell type,
intervention, beat, reaction, post-conference response, generated name, note or
rung of admin's ladder is a JSON edit. The pure-module-plus-suite habit holds
for the sixteen modules above and stops dead at the module boundary —
`systems/tells.js` and `systems/withitness.js` are dependency-injected
factories with no suite at all, and `world/`, `ui/` and `main.js` have never
been executed by anything but a browser and the one headless Playwright pass
Phases 2 and 3 ran by hand (it is not committed; the proxy in that session
blocked the three.js CDN and the pass answered the import map from Castle
Conundrum's vendored 0.169). Persistence is where Phase 1 left it: `persist.js`
builds keys with `slot()` and `dayKey()`, the six flat names migrate on read
once, the semester record goes through `repair` on every load, and none of it
has a browser-side suite of its own.

## Conventions a new builder must know

The first twelve are `CLAUDE.md`'s **locked design constraints**, reproduced
because a phase that ignores one will be refused. Do not "improve" them without
asking.

- **Withitness costs Bandwidth *and* drains Mastery while active.** Looking is
  not free: `CFG.scanMasteryDrainPerSec` (0.45) is ~1.7× the best delivery rate.
- **Hypervigilance produces false positives; it never disables the ability.**
  The punishment for over-scanning is a lie, not a lockout.
- **Furniture casts real line-of-sight blind spots.** `systems/tells.js` uses a
  `Raycaster`; `systems/sightlines.js` asks the same question on paper with
  `segmentHitsRect`. Neither becomes a distance check.
- **Proximity is free, boring, and the most effective intervention.** Do not
  buff it.
- **The curveball tell (`QUIET`) is never scored.** No "Empathy +3" — it changes
  the menu options quietly and awards nothing.
- **Kids are never the joke.** Bureaucracy is sincere, not villainous.
- **Mastery is the mean of twelve comprehension values, not a bar.** Nothing
  writes `state.mastery`; anything claiming to cost Mastery goes through
  `state.masteryPending` and the lesson spends it across the room. `applyEffects`
  enforces this for every effect bag in `data/`.
- **Room Temp never names a kid.** Bands and quadrants only; naming is what the
  expensive ability is for.
- **`seat` is who you are; `desk` is where you are.** `seat` is the roster index
  every schedule and test refers to; the chart writes `x`/`z`/`bodyZ`/`col`/`row`
  onto the student and everything downstream reads that. They used to be one
  number and are not going back.
- **Suppression is silent.** A steady neighbour absorbs something and no tell
  spawns, nothing appears, no toast fires. You find out in the report or not at
  all.
- **The curveball is never suppressed and never separated.** `QUIET` carries
  `suppressible: false` in `data/tells.json`; no chart may remove it.
- **The chart labels nothing you have not watched happen.** Edges and
  stabilisers come from `learnFrom` at the bell, never from the roster data that
  defines them.

And the working rules:

- **Content goes in `data/`, logic goes in `src/`.** The project's own test:
  could a teacher with no JavaScript add a new random event by editing one file?
  It should stay yes. Tuning constants go in `src/config.js`, never inline.
- **Systems are factories** — `createChart`, `createLesson`, `createObservation`
  — taking dependencies as an object and returning functions. No module-level
  mutable state, no singletons except `ui/dom.js`. That is what lets both test
  files build a whole lesson under Node against a fake DOM four lines long.
- **`src/ui/` never imports from `src/systems/`.**
- **Anything added to the 3D scene must be registered** with `registry.add(mesh)`
  or it will not swap into thermal view. The comprehension aura is the one
  deliberate exception and says so in a comment.
- **`src/persist.js` is the only thing that touches `localStorage`,** degrading
  to an in-memory `Map` if the browser refuses (private window, `file://`, a
  locked-down district laptop). This is the project's own store, not the site's
  `assets/js/gvb-save.js` — a deliberate divergence, worth knowing before a
  phase adds a tenth key.
- **Run both suites from `tests/`.** They read `../data/*.json` by relative path
  and will not run from the repo root:
  ```bash
  cd tests && node smoke.mjs      # 381 assertions; prints "all green"
  cd tests && node balance.mjs    # six styles, three charts, four periods, the day, the soak, a week
  SPREAD=1 node balance.mjs       # the front-row spread comparison
  SOAK=500 node balance.mjs       # more seeds through the generator
  node --check src/<file>.js      # syntax check one module
  ```
  `smoke.mjs` asserts. `balance.mjs` mostly prints a table you read, with one
  exception since Phase 2: the generator soak exits 1 if any seed lands outside
  `data/generation.json`'s bands, because a check that only prints is a check
  that gets ignored. Paste the table into the closing report so the next
  session can diff it.
- **Voice: deadpan, specific, written for someone who has actually taught.**
  Match `data/interventions.json` and the treatment's event cards. No
  exclamation points except from the sub and the intercom.
- **One ticket at a time, to a runnable state,** and when a change touches both
  data and code, do the data shape first. The T7 record closes with the
  reason: an agent given an open brief on a 40-file repo will refactor things
  that were working.
- **This project sat outside the parallel prompt rounds.** It never had a
  prompt or a notes file, so none of the round-based conventions applied to it,
  and the rounds are retired now in any case. `CLAUDE.md` and this file are the
  whole contract;
  keep them current, because nothing else will.
- **The site's checks do not cover this project.** `Tools/board-check/games.mjs`
  has no Bell to Bell entry, so no browser suite ever opens it, and
  `check-integrity.mjs` parses its modules but misses its one offsite
  dependency: the host sweep reads `href`/`src` attributes on resource tags, and
  this project's three.js lives in the *body* of a `<script type="importmap">`,
  where there is no attribute to match.

## Questions for Devon

The T7 record left these open; nothing in this file resolves them.

- **Authoring or generation?** Answered by shipping: Phase 1 authored a third
  period and Phase 2 generated a fourth, so the day is three authored classes
  and one drawn from a seed. The open version of the question is whether the
  authored three should also become seeds (one JSON edit each, and their names
  would go), or whether authored kids stay authored because the notes are
  better. Nothing depends on the answer.
- **Does the period need a fail state?** Answered "still no" three times.
  Phase 3 designed without one: a bad week gets a growth plan, not a game over.
- **Is suppression too strong?** Measured: in every 4th-period balance run
  exactly one scheduled tell never happens (Priya in front of June); splitting
  the pairs makes that "2 never happened, 2 found another way" and drops
  restless from 72 to 44. The handoff's own fix, if it is too strong, is a
  per-period cap on how much one kid absorbs, not a nerf to the effect.
- **Is the Observation's ambient Mastery cost calibrated?**
  `CFG.observation.masteryDrainPerSec` is 0.008 — ~5 points over the window, by
  design math and not by playtest. In the table it costs the good teacher
  nothing visible (79 either way) and buys 10 Fidelity if performed.
- **Mobile.** Undecided, and the answer determines whether Phase 8 exists.
  `input.js` has `touchstart`/`touchmove` look and no way to walk or to press
  E, Q, R, T, O, H, G or F.
- **An announced Observation variant** (treatment §6.1 has both)? The handoff
  calls the surprise one funnier and rates this low; Phase 4 assumes yes.

## The standing backlog

Open and unclaimed. Pull from here for a phase; add here rather than starting a
new list.

**The day**
- No homeroom, no passing period you play, no planning, no lunch. The four
  minutes between classes are a constant (`CFG.day.passingPeriodRecovery`), not
  a place you stand.
- `CFG.day.passingPeriodRecovery` is 26 by design math and not by playtest: it
  is what makes the good teacher's Withitness budget drop from 14 seconds in
  4th to 4 seconds in 5th, 6th and 7th. Nobody has played that. A fourth period
  made it bite harder: the wanderer opens 7th with 30 Bandwidth, spends the
  period under `CFG.lowBandwidthThreshold`, and closes at 29 Mastery where the
  same teacher closes 4th at 50. That is the pool working as designed, and
  nobody has played it either.
- Nothing distinguishes the last period of the day from the first except its
  content. Phase 3 gave the day a tomorrow; it did not give 7th period a 2:40.

**The week**
- Every number in `CFG.semester` is design math: overnight retention 0.82,
  weekend 0.64, Fidelity reverting 0.7 toward 62 a night, Rapport 0.5 toward
  55. The week table shows the good teacher plateauing at 68 opening and 75
  closing from Wednesday on, and the wanderer meeting AP Reyes on Thursday.
  Nobody has played a week.
- Admin's ladder has three rungs and no simulated style reaches the second.
  The wanderer closes each day at 53 Fidelity, under the check-in's 56 and
  over the second observation's 50. A player who teaches from the back of the
  room all period loses 34 Fidelity and reaches the growth plan by Thursday;
  a style for that teacher is not in `STYLES`.
- Overnight retention relaxes toward the baseline from either side, so a
  wrecked period comes partway back by morning. The alternative, a floor at
  the baseline and nothing coming back, sent the wanderer's 7th from 29 to 12
  by Friday and would have sent it to zero the week after. Whether "they knew
  it last week" is the right story for the recovery is a design call, made
  once, here.
- The record counts what the chart learned but does not own it: `edges` and
  `steadies` per class are read off the `known` slot at the bell. The slot is
  the truth; the record is the report.
- There is one week. Week 2 is week 1 again with the record carried; nothing
  in the lesson data knows it is week 2. The lesson is still "DAY 2 OF 3" every
  day.
- "Start the semester over" on the start screen clears the record, every
  period's chart, discoveries and seed, and the day's Bandwidth. It keeps the
  furniture. There is no confirmation beyond the browser's own `confirm()`.

**Content**
- Beats are hand-authored and never vary, and the generated 7th period reads
  4th period's lesson. Generation stops at the roster and the schedule on
  purpose: voice is what it is worst at.
- The generator's name pool is 93 names, disjoint from the 36 authored ones,
  and a roster takes twelve with no two sharing their first two letters. The
  notes pool is 31 lines. Both will start to repeat across seeds sooner than
  the numbers will.
- The Observation fires at `atMinute: 30` in every period, unannounced, always.
  Four periods in a day means AP Reyes now walks in four times before the
  buses, and the ladder's "second observation the same week" is a longer
  window on a visit that was already happening. Phase 4 is where that stops
  reading as a bug.
- The post-conference is one exchange with three options; treatment §6.1 shows
  a tree.
- Subject is Social Studies and nothing else; §4's six are unbuilt.
- The hidden fifth meter (LEGEND) does not exist. Neither does Bladder.
- Of §6.1's eight bureaucracy minigames, one is built.

**The room**
- Tell meshes are placeholder boxes and spheres (`buildMesh` in
  `systems/tells.js`).
- The comprehension aura is a `TorusGeometry(0.19, 0.018, 6, 20)` over every
  head. Fine at a glance, bad in a crowd of twelve.
- Whisper audio does not exist (T8, next in the handoff's own order).
- T5 does not check furniture against desks or the other occluder — you can
  drag the cabinet onto a desk. Nothing breaks; it looks wrong.
- The front row's advantage may be too small to notice. Do not decide without
  `SPREAD=1 node balance.mjs`.

**Weight and plumbing**
- `Assets/` is 1,037 files and 142 MB, of which **932 files and 82 MB are
  referenced by nothing** in `data/assets.json` — three causes, and the famous
  one is the smallest. The Kenney kit ships 140 models in six formats
  (`.stl/.obj/.mtl/.glb/.fbx/.dae`) and the game loads four `.glb`: 17 MB
  total. `Props/` holds 20 props of which 11 are named, the nine unnamed ones
  being 34 MB including a 21 MB pine sapling in a classroom game. `textures/`
  carries three rug variants (19 MB) and two wall variants where one of each is
  used — and those are listed under `_textureAlternates` / `_artAlternates` /
  `_propAlternates`, a deliberate palette rather than an accident, so a prune
  has to keep the catalog honest instead of just deleting.
- three.js 0.160.0 hotlinks from `cdn.jsdelivr.net`. The site vendored its CDN
  three.js copies in session 4 and has reported zero offsite requests since
  (bar Golden Hour's sand texture); School Generator's import map points at
  `./libs/three.module.js`. This is a regression no check catches.
- No CI. `.github/workflows/` has three files and none runs these two suites.
- `systems/tells.js` (160) and `systems/withitness.js` (39) are
  dependency-injected factories with no test file.
- The generator's band check runs two headless periods per attempt at boot,
  about 25 ms each in Node. At the reroll cap of 24 that is a second of boot on
  a bad seed; no seed in 1,400 tried needed more than 3.

## Arc one — the school day

The slice is one period, run twice. Everything the treatment promises past it —
a lesson you did not write, a class that remembers yesterday, an AP who
escalates — is downstream of a save format that can hold more than two classes,
which is why the save architecture is Phase 1 and not Phase 4. Arc one builds
for the player who finished 5th period and wants to know what 6th is like, and
then what Tuesday is like. The phases are **ranked by impact, and the order is
the recommendation**.

The model convention for this project: most phases run on **Claude Opus 5**.
**Claude Fable 5.1** is named only where it earns it — the save schema every
later phase inherits, the generator that must compose content landing inside a
balance band, and the longitudinal model where a wrong number is silent for six
simulated weeks. A phase is *finished* only when its branch has become a pull
request, that pull request has merged to main with CI green, and the closing
report names the **next open phase's number and its named model**, plus the
fresh `balance.mjs` table so the next session can diff it without running it.

## Phase 1 — A day with more than two periods in it — **SHIPPED**

**There were two save slots, they were called `chart` and `chart5`, and the
second one was the first one with a `5` typed on the end.**

Shipped. The full record — what moved where, the migration's four properties,
the 6th period's balance row and the whole-day table — is in the repo root's
`HISTORY.md` under "Bell to Bell, through Phase 1". In short:

- [x] **A period is data.** `data/periods.json`, one row per period, presentation
  fields literal and content fields pointers. `periodFor()` moved out of
  `main.js` into `src/periods.js` and became a lookup.
- [x] **Namespaced save slots.** `persist.slot(periodId, key)` and
  `persist.dayKey(key)`. The six flat keys migrate on read, once, idempotently;
  `furniture` stayed global.
- [x] **Resume where you were.** `beginPeriod()` writes the period id.
- [x] **A 6th period, authored.** `data/period6.json` plus one row. No `.js`
  file was touched to add it, which was the phase's own success criterion.
- [x] **Bandwidth crosses the bell.** `CFG.day.passingPeriodRecovery`, 26.
- [x] **The suites follow.** 191 smoke assertions became 257; `balance.mjs`
  loops over the data's periods and runs the whole day on one Bandwidth pool.

What it left open is in the standing backlog above, under **The day**: the
recovery constant is design math rather than playtest, and the Observation now
fires three times in one day.

## Phase 2 — Kids nobody authored — **SHIPPED**

**Two rosters and two tell schedules is the whole game's content, and both were
typed by hand.**

Shipped, with Phase 3, in one pull request. The full record, the promises each
generator keeps, the one the scheduler had to learn from the chart, and the
soak numbers, is in the repo root's `HISTORY.md` under "Bell to Bell, through
Phase 3". In short:

- [x] **`systems/roster.js`, pure, with its suite.** Stratified draws, so the
  room always has a calm end and a loud end; `rosterProblems()` is the promise
  list, and the suite breaks each promise on purpose.
- [x] **`systems/scheduler.js`, pure, with its suite.** Every invariant the
  wishlist named plus one it did not: the August chart may swallow at most two
  tells, because the first seed that missed the band was a roster whose
  stabilisers sat next to everything.
- [x] **A band, not a number.** `data/generation.json` → `bands`, checked by
  `systems/generate.js` against `systems/simulate.js`, which is `balance.mjs`'s
  runner extracted so the two cannot drift. A miss re-rolls the schedule and
  never the roster.
- [x] **A seed you can name.** Six digits, stored in the period slot, on the
  report screen and editable on the start screen.
- [x] **`balance.mjs` grows a soak.** Fifty seeds; exits 1 on any miss.

What it did not do: touch the lesson. 7th period teaches 4th period's.

## Phase 3 — The semester remembers — **SHIPPED**

**Every meter resets at every bell, so nothing you did on Monday exists on
Tuesday.**

Shipped, with Phase 2. The record, the constants and the two week tables are in
`HISTORY.md` under "Bell to Bell, through Phase 3". In short:

- [x] **`systems/semester.js`, pure, with its suite.** `entering`,
  `recordPeriod`, `advanceDay`, `weekSummary`; `main.js` does no date
  arithmetic. Versioned 1 from day one, `repair`ed on every load.
- [x] **Mastery persists per student, not per class.** Twelve values by seat and
  a baseline to relax toward; `CFG.semester.retainOvernight` and
  `retainWeekend` are `forgetPerSec`'s between-days siblings. Constraint 14.
- [x] **Fidelity is admin's running opinion.** Reverting 0.7 a night toward the
  district's 62, which is what keeps a good week off the 100 ceiling.
- [x] **Escalation, per treatment §6.2.** Three rungs in `data/admin.json`, each
  a line, a number of days, an effect bag, a PA and a report line. The Friday
  Report is `ui/week.js` on the report screen's card.
- [x] **`balance.mjs` grows a week.** Twenty rows per style, two styles, the
  record at each bell.

What it did not do: give 7th period a 2:40, or the lesson a Tuesday. Rapport
and Fidelity carry per class; the observation still fires every period.

## Phase 4 — The bureaucracy answers back — **SHIPPED**

**AP Reyes visits at minute 30 of every period forever, asks one question, and
accepts one of three answers.**

Shipped. `data/observation.json` went from 95 lines to 260;
`systems/observation.js` from 112 to 210. No new pure module, one existing
system widened.

- [x] **She does not always come, and sometimes she tells you.** `visitFor` is
  a pure function of the semester seed, the day index and the period id:
  whether she comes at all (58%), where in a 24..34 window she arrives, whether
  it was on the calendar days ahead (34% of visits, 1-3 days' lead), and which
  five look-fors she brought. Nothing about the calendar is stored, so
  `announcedAhead` reads Thursday off this morning and gets the same answer
  twice. The semester record carries the seed (version 2; a version 1 record
  migrates forward with seed 0). Announced visits skip the nine-second Admin
  Proximity Alert, which stayed exactly as it was.
- [x] **The post-conference becomes a tree.** Four nodes, three options each,
  effects at every one; options carry `then` and `ui/conference.js` loops until
  an answer has nothing after it. Two exchanges deep, with a step cap so a data
  file that loops a `then` cannot trap the player on the screen.
- [x] **A follow-up you actually owe.** Naming a specific Thursday books a
  look-for, a period and a due day on `record.owed`. You keep it by doing the
  thing in that room on a later day, with nobody watching. The night its day
  goes past marks it broken, the next morning charges Fidelity −5 once and
  sends one email about it, and then it is gone. Three of the tree's answers
  book one; being vague books nothing.
- [x] **More look-fors than fit in one window.** Nine in the pool, five drawn
  without replacement. `config.js` has one key per one-shot look-for, named
  `look:<key>`, and `main.js`'s dispatch hands the suffix straight to
  `satisfy()` without knowing what is in the pool. index.html's five hardcoded
  rubric rows are gone. Pressing one she did not bring scores nothing and says
  why.
- [x] **Smoke assertions.** 58 of them, on the calendar's purity and its
  announcement window, the skipped period, the pool draw, the key/pool/letter
  correspondence, the tree's reachability and traversal, and the follow-up's
  whole life including a day boundary and a repair. Four were broken on purpose
  and watched to fail first.

What it did not do: move a balance number. The headless sim takes an explicit
visit and defaults to the one the table has always run, so every band in
`data/generation.json` is unchanged.

## Arc two — the room you are standing in

Arc one builds the calendar. Arc two turns back to the forty-seven minutes:
what the room is made of, what it weighs, what you can notice without holding
SHIFT, and who can play it. Ranked by impact too, but genuinely independent of
each other and of arc one — any of them can be pulled forward when a session
wants a shorter phase. Same model convention, same definition of finished,
`balance.mjs` in every closing report.

## Phase 5 — Subject is the weather — **SHIPPED**

**Six subjects are specified in detail and the game teaches Social Studies.**

Shipped. `data/subjects.json` is a manifest and `data/subjects/*.json` are the
subjects; `src/systems/subject.js` is 180 lines of merging plus one rule.

- [x] **`data/subjects/*.json`.** Four files: display copy, a tell-type
  weighting the Phase 2 scheduler consumes, meter start modifiers, and flavor
  overrides for events, interventions and missed-tell copy. Social Studies
  ships as the file describing what already exists, and the suite holds it to
  that: 4th period plays identically with it and without it, to the thousandth
  of a meter point.
- [x] **Science, with the Hazard meter.** One number that rises on lab days
  with how loud the room is and with anything unhandled in it, reads off a band
  table in `data/events.json` next to Room Temp's, and at the cap generates an
  incident report worth Fidelity −8. It does not cross the bell, so constraint
  13 still has exactly one carried meter. A lab day lands at 46 for the good
  teacher, 90 for the one who never looks up, and tops out with an incident for
  the one who never checks.
- [x] **ELA, with THE STACK.** Essays accumulate on the semester record — five
  a period on, three a night off — and are drawn as props on the teacher's desk
  through the same prop manifest and the same `world/room.js` fixture
  placement everything else in RM 214 uses. Past fourteen they stop fitting and
  the overflow is a real occluder with real collision and a real blind spot.
  Math ships alongside as two data rows: an unearned Rapport −9, and the line a
  student says aloud in every unit.
- [x] **Subject picks the room, not the code.** Verified two ways. No file
  under `src/` may name a subject id, in code or in a comment, and the suite
  greps all 39 of them. And a fifth subject built entirely as JSON in the test
  resolves through `periodFor` and plays a whole period with its meters, its
  hazard and its room, with no edit to anything in `src/`.
- [x] **`balance.mjs` runs each subject.** One representative style through 4th
  period under each, as a table, plus Science's lab day under four styles so a
  hazard profile that makes a subject unplayable is a row rather than a
  complaint.

What it did not do: change what the shipped day teaches. All four periods are
Social Studies, because they all teach the same U.S. History unit and a subject
that disagreed with its own lesson would be worse than no subject. Putting 6th
period in an ELA room is one line in `data/periods.json` and a lesson somebody
has to write.

## Phase 6 — What the room weighs — **SHIPPED**

**142 MB of assets, 82 MB of it referenced by nothing, and a three.js that
comes from somebody else's CDN.**

Shipped. `Assets/` arrived at 149,313,216 bytes across 1,037 files and leaves
at 76,685,204 across 269. `tests/assets.mjs` is the thing that made the prune
arguable rather than a guess, and it stays as the regression check.

- [x] **A manifest check.** `tests/assets.mjs` walks `Assets/` and resolves
  every path `data/assets.json` names, including the `.bin` sidecars and
  `textures/` folders a `.gltf` names but the manifest does not. It sorts the
  tree into referenced, cataloged and unreferenced, and it fails rather than
  prints on five things: a referenced path missing, a cataloged path gone, a
  `_pruned` path back on disk, either byte total over its `_budget` ceiling,
  and the `_budget` block itself being deleted. All five were broken on purpose
  and watched to fail.
- [x] **Prune the format duplicates.** The Kenney kit's `.dae` / `.fbx` /
  `.obj` / `.stl` trees: 700 files, 13,384,129 bytes, and `GLTFLoader` is the
  only loader in `src/`.
- [x] **Prune what the catalog does not name.** The nine unnamed `Props/`
  directories, 35,514,776 bytes, headed by a 21.9 MB outdoor pine sapling in a
  game that has never been outdoors.
- [x] **A third prune the bullets above did not name, found by the check.**
  Every Poly Haven texture set ships a preview sphere — a `.gltf` and a 2.37 MB
  `.bin` beside the `textures/` folder. `materials.js` builds its jpg filenames
  out of `dir` and `base` and never opens either one. Ten sets, 23,696,840
  bytes, the same "shipped in a format nothing reads" case as the `.stl` trees
  and larger than either named prune.
- [x] **The catalog became machine-readable.** Three prose alternates blocks
  are now one `_alternates` (paths that must still resolve) and a `_pruned`
  record (paths that must still be gone, and why each one went). The check
  reads both, so `assets.json` can no longer advertise a file that is not
  there, and nothing can quietly come back.
- [x] **Vendor three.js.** r160 in `libs/` — the revision the CDN was serving,
  so no `src/` change — with `GLTFLoader`, `SkeletonUtils` and the
  `BufferGeometryUtils` that `GLTFLoader` itself reaches for. That is the whole
  closure and `smoke.mjs` asserts it stays closed. Verified in a browser: the
  page loads and plays with zero requests leaving the origin.
- [x] **Teach the sweep to read an import map.** `check-integrity.mjs` parses
  `<script type="importmap">` bodies as JSON and sweeps their values, and fails
  a malformed map and a local target that does not exist. Shared tooling, and
  the honest result is that it found no other page: every other import map in
  the repo was already local. Bell to Bell was the only offender.
- [x] **A loading budget.** `_budget` in `data/assets.json`, asserted by
  `assets.mjs` and by `smoke.mjs`, sitting just above the measured 62,102,693
  referenced bytes and 3,745,076 unreferenced. Raising it is where the next
  asset argues for itself.

*Left standing:* 140 `.glb` files in the Kenney kit's GLTF format of which the
game places four. They are 2.2 MB together and they are the kit, so they read
as a catalog rather than as waste — but nothing in `assets.json` says so, and a
later session could reasonably move them into `_alternates` or delete them.

## Phase 7 — Things you can notice without holding SHIFT — **SHIPPED**

**Every tell is a box or a sphere, every student wears a torus, and a whisper
makes no sound.**

Shipped, and the phase turned out to have a prerequisite nobody had written
down: `systems/tells.js` imported `three` by bare specifier, which only
resolves against the import map, so no Node test could load it and the file had
never been executed by anything. `src/three.js` is the seam that fixed that —
one module that turns the bare specifier into a path — and every file under
`src/` goes through it now.

- [x] **Real tell meshes.** `buildMesh` moved out of `systems/tells.js` and
  into `world/tellmesh.js`, and a tell type names its shape in
  `data/tells.json`. A phone is a 6.8 × 13.5 cm slab tilted on a thigh with a
  screen at minimum brightness; a note is two planes meeting at a fold; copying
  is two sheets on two desks, each angled at the other, because the tell is the
  angle and not the paper.
- [x] **And the Tier 1 / Tier 2 line the treatment draws (§3.3), which is what
  the phase title is about.** A tell mesh is two buckets. The *object* is in
  the room whether or not you are looking — dark, small, low, registered with
  the material registry so Withitness swaps it hot. What the vision *infers* —
  the note's route line, the copying thread, the shape of a conversation — is
  drawn only while SHIFT is held and is deliberately unregistered. A
  hypervigilance false positive is all inference and no object, which is what a
  false positive is.
- [x] **Retire the torus.** Twelve 19 cm rings at one height over twelve heads
  read as twelve identical halos: you could see that some were red without
  being able to say whose. The comprehension aura is now the desk surface,
  which is the thing a student is already identified by from the front of the
  room. Twelve of those are a heat map you read in one pass. The body bobs and
  the desk does not, so the idle bob is subtracted back out of it every frame.
- [x] **Whisper audio, directional.** A `PannerNode` at the tell's position,
  with fragments authored in `data/tells.json` beside the `WHISPER` type. The
  fragments are phrases and you never hear the phrase: `audio.js` renders one
  band-passed noise burst per syllable at a vowel-derived centre frequency,
  falling the way a sentence does, so what arrives is the rhythm of a sentence
  and never a word of it. It ducks *up* under Withitness while the room ducks
  down, and a whisper behind the cabinet drops to `occludedScale` rather than
  to nothing — the one cue in the game that survives a blind spot.
- [x] **Furniture that does not overlap.** T5's gap 9. `clampOccluder` knew
  about the walls and nothing else, so the storage cabinet could be dropped on
  a desk. It now resolves overlaps against every desk footprint and the other
  occluder by pushing along the axis of least penetration, re-applies the walls
  after each push, and leaves the furniture where it was if six passes cannot
  find a free spot — sliding it into a wall beats sliding it into a desk. The
  shipped layout in `data/room.json` is untouched by it, which the suite
  asserts, and a saved layout from before the clamp is repaired on load rather
  than trusted.
- [x] **The first suites for `tells.js` and `withitness.js`.** Birth, expiry,
  resolve, the blind spot against a real `THREE.Mesh` and a real raycast, the
  false positive, both material buckets, the registry swap, and every locked
  cost of the toggle. Ten guards broken on purpose and watched to fail,
  including the raycast replaced with a distance check (locked constraint 3)
  and the Mastery drain removed (locked constraint 1).
- [x] **Verify in a browser.** Headless Chromium, software rendered, polling
  state rather than assuming durations (#53). It found a real bug the Node
  suite could not: `audio.setListener` handed a plain object to three's
  `getWorldDirection`, which wants a `Vector3` and throws — every frame. The
  forward vector now comes off the camera's world matrix. The verified run:
  three r160 resolved from `./libs/`, zero offsite requests, zero toruses in
  the scene, twelve desk auras, and a tell whose vision bucket appears while
  SHIFT is down and is gone when it is up.

## Phase 8 — A thumb has never touched this

**`input.js` lets a phone look around the room and gives it no way to walk or
to teach.**

Gap 3, open since the first handoff, and one of three places in the repo where
the site's own notes say touch has never had a thumb on it. The look handler is
already there (`touchstart` / `touchmove` / `touchend`, lines 27–37); what is
missing is locomotion and every action key. The chart screen has its own
problem: it is a drag-and-drop plan view driven by `pointerdown`, which is the
one interaction here that touch is *better* at, and it has never been tried.

- [ ] **Walk with a thumb.** A left-half virtual stick feeding the same movement
  vector `input.js` builds from WASD. One code path, two input sources.
- [ ] **The actions, on screen.** E / Q / R / T and the four Observation
  look-fors as a HUD strip, generated from `CFG.keys` so a new key never needs
  a second edit. Withitness becomes hold-to-scan on its own control; the
  five-second wait-time hold has to work under it, which is the interesting
  case.
- [ ] **Withitness on a small screen.** The thermal CSS overlay, the tell
  annotations and the rubric box are all absolutely positioned for a desktop
  viewport. `styles/main.css` is 283 lines; this is a media query pass, not a
  rewrite.
- [ ] **The chart screen, properly.** `ui/seating.js`'s drag already runs on
  pointer events; make the desks big enough for a fingertip, and confirm a swap
  and a furniture drag both work on a real phone.
- [ ] **Decide the frame budget.** Twelve rigged glTF characters, a lit room and
  the thermal swap on a mid-range phone is an open question nobody has measured.
  Measure it, write the number down, and if it fails, name what gets dropped
  (character LODs, texture tier, shadow) rather than shipping something that
  stutters.

*Leans on:* `input.js`, `styles/main.css`, `ui/seating.js`, `config.js`'s `keys`.
*Save:* none. *Model:* **Claude Opus 5** — input plumbing and CSS against an
existing key table.

## What this leaves for a later arc

Deliberately not phased, in rough order of how much someone would enjoy
building them:

- **The rest of §6.1** — THE COPIER first (the mascot: 7:14 a.m., 340 pages, a
  tray that lies, and a colleague with four pages whom letting cut banks
  Colleague Goodwill), then the Data Meeting's card defense, the Paperwork
  Tower, Sub Plans and the after-action note, the Fire Drill, Hall Duty, and
  LUNCH — 22 MINUTES, a resource-allocation screen that starts commenting on
  you around February.
- **The classroom economy** (§5.1) — four currencies, the catalog, the Free
  Pile, DONORSELECT. The builder exists; the money does not, and the sightline
  puzzle was always the good half.
- **Rumor mechanics and the hall pass economy** (§7.1), propagating on the
  seating graph `chart.js` already computes. The graph is built; nothing walks
  it.
- **Blowups** (§7.1) — an escalation state with a six-second pre-window, never
  played for laughs, awarding nothing but Legend. The highest-risk content in
  the treatment and the one that most needs the tone contract enforced.
- **The Calendar Bosses** (§6.3), including a ninety-second State Testing
  Season that is deliberately miserable.
- **The multi-year meta-arc** (§8.2), which needs Phase 3's semester record
  first and then needs it to survive a decade.
- **The small things** (§10): the clock that moves backward by one minute once,
  the stapler that goes missing in Q1 with no quest to retrieve it, the chair
  you cannot bring yourself to sit in.
