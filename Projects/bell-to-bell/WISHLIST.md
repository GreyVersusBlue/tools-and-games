# Bell to Bell — Feature Wishlist

**Status: Phase 1 has shipped. The game is at T7 plus Phase 1 — tickets T1
through T7 and "A day with more than two periods in it" are built and playable,
`tests/smoke.mjs` prints 257 PASS lines and no FAIL, and `tests/balance.mjs`
runs six styles through 4th period, one style across three seating charts,
three styles through each later period, and the whole day back to back on one
Bandwidth pool. The first open phase is Phase 2 — Kids nobody authored, on
**Claude Fable 5.1**.**
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
seconds, an intercom interruption at minute 19, an Observation at minute 30, and
four endings. Take the report screen's offer and you get 5th, and then 6th —
same room, a different twelve kids each time, each with its own tell schedule
and lesson, out of `data/period5.json` and `data/period6.json`. The day itself
is `data/periods.json`, three rows deep.

The mechanic it is built around is **Withitness**: hold SHIFT and the room goes
thermal and every tell in line of sight annotates itself. Three things keep that
a game rather than a cheat button. It drains Bandwidth. Mastery ticks down while
you are in it, because you are standing at the front staring at nothing. And
Hypervigilance rises, which never disables the ability — it makes the ability
lie, and you cross the room, and it is a granola bar. The line of sight is a real
raycast against furniture defined in `data/room.json`, which is why the seating
chart and the classroom builder are the same puzzle as the vision mode.

What it is not: a school day, a semester, or a year. The treatment
(`docs/BELL-TO-BELL-treatment.md`, 468 lines) describes six subjects with
distinct hazard profiles, eight bureaucracy minigames of which one is built,
seven Calendar bosses, rumor propagation on the seating graph, a hidden fifth
meter, and a ten-year meta-arc. Three periods of one of those days exist, and
what carries between them is your seating chart, your furniture layout, what you
watched happen, and your Bandwidth — Mastery, Fidelity, Rapport and Restlessness
still reset from `CFG.start` at every bell, because they are facts about walking
into a room rather than facts about the day.

## The architecture that is there

3,422 lines across 30 files in `src/`, 42 KB of JSON across eleven files in
`data/`, and 142 MB in `Assets/`.

**The three-free core** — nine modules, 1,075 lines, importing neither three.js
nor the DOM, and therefore the only part of the game the Node suites can reach:

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
`src/periods.js` (77 lines, three-free), which reads `data/periods.json` and
hands `main.js` one resolved period; everything in `main.js` is period-agnostic
and it no longer names a class or a save slot anywhere. `endPeriod()` at 359 runs `learnFrom`, persists, and hands the
report a `restart` action that writes a `persist` key and calls
`location.reload()`. That reload *is* the period transition — there is no
teardown/rebuild path, because the linear boot sequence already runs once per
page load.

**Where the habits break down.** Content-not-code holds: a new tell type,
intervention, beat, reaction or post-conference response is a JSON edit. The
pure-module-plus-suite habit holds for the nine modules above and stops dead at
the module boundary — `systems/tells.js` and `systems/withitness.js` are
dependency-injected factories with no suite at all, and `world/`, `ui/` and
`main.js` have never been executed by anything but a browser. Roughly 31% of
`src/` is under test, and the untested 69% includes the tell lifecycle. The other
soft spot is persistence, and Phase 1 took the worst of it: `persist.js` is 86
lines, its keys are built by `slot(periodId, key)` and `dayKey(key)` rather than
typed out, and the six flat pre-slot names migrate on read exactly once. What is
still soft is that it has no browser-side suite of its own — the migration is
asserted against an injected fake store, not against `localStorage`.

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
  cd tests && node smoke.mjs      # 191 assertions; prints "all green"
  cd tests && node balance.mjs    # six styles, three charts, two periods
  SPREAD=1 node balance.mjs       # the front-row spread comparison
  node --check src/<file>.js      # syntax check one module
  ```
  `smoke.mjs` asserts; `balance.mjs` does not — it prints a table you read.
  Paste that table into the closing report so the next session can diff it.
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

- **Authoring or generation?** T6 shipped a second hand-authored roster,
  schedule and lesson; T7 one hand-authored observation at a fixed minute 30.
  Both deliberate — prove the authored shape before automating it. Phase 2 is
  the automation. Now, or does a third authored period come first?
- **Does the period need a fail state?** Answered "still no" three times.
  Confirming it lets Phase 3 stop designing around the possibility.
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
  4th to 4 seconds in 5th and 6th. Nobody has played that.
- The day is three periods and then it restarts. There is no Tuesday, and
  nothing distinguishes the last period of the day from the first except its
  authored content.

**Content**
- Beats and tells are hand-authored and never vary. Three rosters, three
  schedules, three lessons, forever.
- The Observation fires at `atMinute: 30` in every period, unannounced, always.
  Three periods in a day means AP Reyes now walks in three times before lunch
  is over, which reads as a bug and is not one yet.
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

## Phase 2 — Kids nobody authored

**Two rosters and two tell schedules is the whole game's content, and both were
typed by hand.**

The handoff's own open question, asked and deferred twice. The argument for
answering it now is that the authored shape has been proved twice and the
harness to validate a generated one already exists: `balance.mjs` runs a whole
period headlessly in milliseconds and prints where six play styles land, so a
generator can be held to that band by construction rather than by taste.

- [ ] **`systems/roster.js`, pure, with its suite.** Seeded generation of twelve
  students — name, shirt, `tension`, `aptitude`, `steady` — against
  distributions in `data/generation.json`, guaranteeing what the roster
  actually needs: at least one genuine stabiliser, an aptitude spread wide
  enough for reteach to mean something, and no two names that read alike on the
  chart.
- [ ] **`systems/scheduler.js`, pure, with its suite.** Compose a tell schedule
  from the generated roster and the existing `data/tells.json` types: minute,
  type, seat, pair, life. The invariants are the interesting part — a `pair`
  tell needs two students the chart can actually seat adjacent, exactly one
  `QUIET` per period, the total unresolved-tell pressure inside a band, and no
  two tells stacked on one seat inside one another's lifespan.
- [ ] **A band, not a number.** Encode the balance table's acceptable ranges as
  `data/generation.json` → `bands`: where mastery, restless and missed should
  land for "ideal (never scans)" and "never checks, never looks". A period
  outside the band is rejected and re-rolled, with a reroll cap and a loud
  failure.
- [ ] **A seed you can name.** The whole generator runs off one integer, printed
  on the report screen, so a class that produced something funny can be typed
  back in.
- [ ] **`balance.mjs` grows a soak.** Fifty seeds through two play styles;
  min/max/mean per meter, failing loudly if any seed leaves the band. That is
  the whole safety net for this phase. Beats stay authored: voice is what
  generation is worst at, and nothing here needs to write a lesson.

*Leans on:* `systems/chart.js`'s `resolveSchedule`, `data/tells.json` types,
`tests/balance.mjs`. *Save:* additive — the seed, stored per period slot, so a
reload regenerates the same class. *Model:* **Claude Fable 5.1** — a generator
that must compose content satisfying invariants the balance harness only checks
after the fact, where a bad distribution reads as "the game got easier" rather
than as a bug.

## Phase 3 — The semester remembers

**Every meter resets at every bell, so nothing you did on Monday exists on
Tuesday.**

`createState()` reads `CFG.start` and hands back mastery 38, fidelity 62,
rapport 55, bandwidth 100 — the same four numbers for 4th period, for 5th, and
for the 5th you reached after doing something remarkable in 4th. Treatment §8's
four ending-by-meter-shape titles are already in `data/events.json` as
`endings`; they have nothing longitudinal to read.

- [ ] **`systems/semester.js`, pure, with its suite.** A record per class —
  cumulative comprehension by student, Rapport, Fidelity, discovered edges and
  stabilisers, observations survived — advanced by one `advanceDay(record,
  periodResults)`. Pure in, pure out; `main.js` never does date arithmetic.
- [ ] **Mastery persists per student, not per class.** The twelve numbers carry
  forward and `CFG.lesson.forgetPerSec` gets a between-days sibling so the
  weekend costs something. Constraint 7 holds: the record stores twelve values,
  never a `mastery` scalar.
- [ ] **Fidelity is admin's running opinion.** Carried across days and decaying
  toward the district mean rather than sitting still — the Mastery-vs-Fidelity
  tension only bites if last week's choice is still on the books.
- [ ] **Escalation, per treatment §6.2.** Sustained low Fidelity schedules
  consequences from `data/admin.json`: a second observation the same week, a
  "quick check-in," a growth plan. Content driven off bands in the record, all
  of it sincere and none of it villainous (constraint 6). Surfaced in a Friday
  Report — five days of meters and three lines about what changed, reusing
  `ui/report.js`'s layout and not its logic.
- [ ] **`balance.mjs` grows a week.** Five days, three periods each, one style,
  as a fifteen-row table with the record's state at each bell. The failure it
  catches is drift — a per-day cost that looks trivial and compounds to zero
  mastery by Thursday.

*Leans on:* Phase 1's slots, `systems/lesson.js`'s comprehension array,
`data/events.json`'s endings. *Save:* a new `semester` record, versioned from
day one, additive to Phase 1's slots and never overwriting them. *Model:*
**Claude Fable 5.1** — a longitudinal model where a wrong decay constant is
invisible for six simulated weeks and then decides the ending.

## Phase 4 — The bureaucracy answers back

**AP Reyes visits at minute 30 of every period forever, asks one question, and
accepts one of three answers.**

`data/observation.json` is a good file and `systems/observation.js` is 110 lines
of clean phase machine. What they lack is variation and depth, both data-shaped
now that Phase 3 gives an observation something to be a consequence of. This is
the arc's content phase: no new pure module, one existing system widened.

- [ ] **She does not always come, and sometimes she tells you.** `atMinute`
  becomes a window plus a per-period probability, and an `announced` variant
  puts the visit on the schedule days ahead — §6.1's other half, and what turns
  Fidelity into something you can prepare for. Leave the surprise variant's
  nine-second Admin Proximity Alert exactly as it is; it is the funnier one.
- [ ] **The post-conference becomes a tree.** `conference.options` grows a
  `then` key and `ui/conference.js` loops until an option has none. Two or
  three exchanges, three responses each, effects at every node — the shape §6.1
  shows and T7 deliberately did not build.
- [ ] **A follow-up you actually owe.** The affirming answer already says it
  costs you one; with Phase 3's record it can schedule it, and forgetting it is
  a Fidelity hit next week.
- [ ] **More look-fors than fit in one window.** A rubric drawn from a pool
  rather than five fixed rows, so two observations are not the same performance
  twice. `config.js` gains a key per one-shot look-for; `main.js`'s action
  dispatch reads the pool.
- [ ] **Smoke assertions.** The announced variant scheduling and firing, the
  tree's traversal and its per-node effects, an owed follow-up surviving a day
  boundary, and a pooled rubric never repeating a look-for in one window.

*Leans on:* `systems/observation.js`, `ui/conference.js`, Phase 3's semester
record. *Save:* additive — owed follow-ups on the semester record. *Model:*
**Claude Opus 5** — content tables and dialogue depth on a phase machine that
already works, with a suite already shaped for it.

## Arc two — the room you are standing in

Arc one builds the calendar. Arc two turns back to the forty-seven minutes:
what the room is made of, what it weighs, what you can notice without holding
SHIFT, and who can play it. Ranked by impact too, but genuinely independent of
each other and of arc one — any of them can be pulled forward when a session
wants a shorter phase. Same model convention, same definition of finished,
`balance.mjs` in every closing report.

## Phase 5 — Subject is the weather

**Six subjects are specified in detail and the game teaches Social Studies.**

Treatment §4 is the most build-ready unbuilt section in the document: each
subject is a passive, a curse, a hazard profile and a signature minigame, and
three of those four are data shapes this project already has. A subject does
not change a system — it changes which tells are common, what the events say,
and one number on the meters.

- [ ] **`data/subjects/*.json`.** One file per subject: display copy, a tell-type
  weighting Phase 2's scheduler consumes, meter start modifiers, flavor
  overrides for events and interventions. Social Studies ships as the file
  describing what already exists — the honest test of whether the shape is
  right.
- [ ] **Science, with the Hazard meter.** The first subject that adds a rule: a
  fifth tracked value that rises with lab days and, at cap, generates an
  incident report. It is one number, one band table in `data/events.json`, and
  a consequence — not a new system.
- [ ] **ELA, with THE STACK.** Essays as physical objects accumulating on the
  teacher's desk with collision, through the existing prop loader and
  `world/room.js`'s fixture placement. Grading debt you can see from across the
  room is the best visual idea in the treatment and it costs one mesh and a
  counter. Math ships alongside it as two data rows: an unearned starting
  Rapport penalty, and the line a student says aloud in every unit.
- [ ] **Subject picks the room, not the code.** Verify by adding a subject with
  a JSON file and no `.js` edit, and say so in the closing report. If it needed
  a code change, the seam is wrong.
- [ ] **`balance.mjs` runs each subject.** One representative style per subject,
  printed as a table, so a hazard profile that makes a subject unplayable shows
  up as a row rather than as a complaint.

*Leans on:* `data/events.json`, `world/room.js`, and Phase 2's scheduler
weighting if it has landed — without it the weighting applies to the authored
schedules instead. *Save:* additive — one `subject` key, on the semester record
if Phase 3 exists and on the period slot if it does not. *Model:* **Claude Opus
5** — content tables and flavor against seams that already exist.

## Phase 6 — What the room weighs

**142 MB of assets, 82 MB of it referenced by nothing, and a three.js that
comes from somebody else's CDN.**

Measured from `data/assets.json` against the tree: 1,037 files, 932 unreferenced.
It is not one problem. The Kenney kit's six-format duplicate is the famous cause
and the smallest (17 MB, of which the game loads four `.glb`); `Props/` is 53 MB
for 20 props of which 11 are named; `textures/` carries variants the game
genuinely picked between and documented. So a prune must distinguish "shipped in
a format nothing reads" from "the alternate we chose against," and keep the
second as a catalog rather than deleting it.

- [ ] **A manifest check.** `tests/assets.mjs`: walk `Assets/`, resolve every
  path in `data/assets.json` including glTF `.bin` sidecars and texture
  directories, print referenced/unreferenced counts and bytes. Run before and
  after; it is the phase's evidence and it stays as a regression check.
- [ ] **Prune the format duplicates.** Delete the `.stl` / `.obj` / `.mtl` /
  `.fbx` / `.dae` trees from the Kenney kit — 700 files, ~12.8 MB, zero of
  which any loader in `src/` can read.
- [ ] **Prune what the catalog does not name.** The nine unnamed `Props/`
  directories, headed by the sapling. Anything an alternates block names stays,
  and anything deleted comes out of the alternates block in the same commit, so
  `assets.json` never advertises a file that is gone.
- [ ] **Vendor three.js.** `libs/three.module.js` and `libs/addons/`, import map
  pointed at `./libs/`, matching School Generator exactly. This closes the
  project's only offsite request and matches a site decision made in session 4.
- [ ] **Teach the sweep to read an import map.** `check-integrity.mjs` reads
  `href`/`src` attributes on resource tags, so an import map's URLs — in the
  script body, not an attribute — are invisible to it. Parse
  `<script type="importmap">` bodies as JSON and sweep their values. Shared
  tooling: call it out in the PR, because it will find other pages.
- [ ] **A loading budget in the smoke suite.** Assert the manifest's referenced
  total stays under a stated ceiling, so the next asset has to argue for itself.

*Leans on:* `data/assets.json`, `world/models.js`, `Tools/board-check/check-integrity.mjs`.
*Save:* none. *Model:* **Claude Opus 5** — asset accounting and a vendoring
move with a manifest check standing behind both.

## Phase 7 — Things you can notice without holding SHIFT

**Every tell is a box or a sphere, every student wears a torus, and a whisper
makes no sound.**

Handoff gaps 2, 4 and 5 together, because they are one problem: the room
communicates almost nothing outside the vision mode, undercutting the design's
own Tier 1 / Tier 2 distinction — the thing T1's held postures were built to
create. A phone under a desk should read as a shape a teacher recognises before
it reads as an annotation. Gap 5 is also T8, the next ticket the handoff named.

- [ ] **Real tell meshes.** `buildMesh` in `systems/tells.js` gets a per-type
  geometry: a phone in a lap, a folded note mid-pass, a paper angled toward the
  next desk. Built from the props the prune kept, or from primitives assembled
  with intent. Every mesh registers with the material registry so it swaps in
  thermal view.
- [ ] **Retire the torus.** Replace `TorusGeometry(0.19, 0.018, 6, 20)` over
  every head with something that reads in a crowd of twelve — a desk-surface
  tint, or a posture the reaction system already holds. It stays deliberately
  unregistered with the material registry, comment intact.
- [ ] **Whisper audio, directional.** A `PannerNode` at the tell's position,
  radio-crackle syllables rather than words, fragments authored in
  `data/tells.json` beside the `WHISPER` type. It ducks *up* under Withitness,
  not down. And a whisper you cannot see stays faintly audible — attenuated,
  not occluded, the one cue in the game that survives a blind spot.
- [ ] **Furniture that does not overlap.** T5's gap 9: `chart.moveOccluder`
  clamps to `room.bounds` and nothing else, so the cabinet can sit on a desk.
  Add desk and occluder rectangles to the clamp — mandatory once the furniture
  is visible in 3D as well as in plan.
- [ ] **The first suites for `tells.js` and `withitness.js`.** 160 lines and 39,
  both dependency-injected factories, neither ever executed under Node. Stub
  the scene and the audio; cover birth/expiry/resolve, the occlusion call, and
  the toggle's costs.
- [ ] **Verify in a browser.** Playwright, headless Chromium, as T7 did — and
  as T7 recorded, the frame clock runs slow under software rendering, so poll
  state rather than assume durations.

*Leans on:* `systems/tells.js`, `world/students.js`, `world/materials.js`,
`audio.js`, Phase 6's surviving props. *Save:* none. *Model:* **Claude Opus 5**
— geometry, materials and Web Audio against registries that already exist.

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
