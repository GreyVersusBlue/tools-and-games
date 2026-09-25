# Signal City: the plan

A browser game about programming traffic lights. You never drive; you set
the signals, and the cars do the rest, obeying them or not according to who
is behind the wheel. Asked for by Devon on 2026-09-21. `BACKLOG.md` ranks the
open work; this file is the plan it points at. Milestones 0 to 9 are done;
the **Roadmap** section below is the development list from here, written
after a review on 2026-09-24, in build order, with everything that needs a
real device or a person at the end.

## What shipped (milestones 0 to 9 and the UI pass, 2026-09-21 to 2026-09-24)

- **M0 scaffold**: `Projects/signal-city/` with `index.html`, `css/`, `js/`,
  `test/`, this file; the board card; an area in
  `Tools/board-check/ownership.json`; a Site CI matrix entry.
- **M1 signal model** (`js/signals.js`, `test/signals.mjs`, 83 checks):
  movements, a conflict matrix derived from ring geometry rather than a hand
  table, phases the constructor refuses if they conflict, permissive lefts
  flagged as such, green → yellow → all-red → green with tunable times and a
  minimum green, manual and timed modes with offsets, `elapsed` and `queue`
  rules, flashing red, flashing yellow on major legs, dark, and priority
  preemption that returns to the plan.
- **M1b sprites** (`js/sprites.js`, `sprites.html`, `test/sprites.mjs`, 20
  checks): eight silhouettes drawn procedurally in metres, four glossy
  palettes each, cached to offscreen canvases per scale, a gallery page that
  exports a sheet.
- **M2 network and physics** (`js/network.js`, `js/cars.js`, `js/sim.js`,
  `test/sim.mjs`, 73 checks): lanes as arc-length polylines, cubic turn
  curves, IDM following with a real reaction delay read from ring buffers,
  the dilemma-zone yellow rule, red-light rolls, box entry by conflict
  geometry with crossing points, a swept probe for anything sitting on a
  car's line, SAT collisions, Poisson spawning, fixed 1/60 s steps and a
  seed-determined hash.
- **M3 archetypes**: the eight stat rows in `js/cars.js` and their
  tick-level faults: granny's early stop, aggressive's short headway and
  yellow punching, tourist hesitation and wrong turns, trucker delay and the
  wide sweep that ties up the neighbouring lane, student jitter and jerk and
  never running a red, rideshare pickups, emergency ignoring signals and the
  player-triggered corridor.
- **M4 scoring and level 1** (`js/scoring.js`, `js/levels/pack-01.js`,
  `js/save.js`, `test/scoring.mjs`, 31 checks): throughput, safety and
  satisfaction meters, stars (survive; average wait; zero collisions), soft
  and hard modes, "First Light" (one 4-way, two phases, standard and granny)
  and a Free Play board with the whole mix and two ambulance calls, a save
  under `signal_city_v1` through `gvb-save.js`.
- **M5 signal mechanics 2 to 4, the panel, levels 2 and 3** (HISTORY.md
  #544 to #553): the yellow and all-red sliders through
  `Controller.setTiming`; protected left phases on "Four Ways" (two lanes
  each way, the inner lane a left bay, `standardPhases(legs, { lefts:
  true })`), the arrow lamp drawn from a real phase; flashing red (a
  four-way stop with first come, first served) and flashing yellow on the
  main road as a mode with a button back to the phases; the rule panel that
  adds, edits, reorders and removes `elapsed` rules live and shows `queue`
  rules asleep until M6's sensors; "Stem" (a T-junction where the all-red
  is the lesson) and "Four Ways". The fault that gives the all-red its
  meaning is new: a driver whose green is on its way anticipates it and,
  once it comes, looks at the light and not the box (`greenTrust` in
  `js/cars.js`). `tools/calibrate.mjs` is the six-seeds-by-four-cycles table
  behind every level's targets. 103 + 85 + 44 + 20 + 53 checks.
- **M6 pedestrians, sensors, the corridor, levels 4 and 5** (HISTORY.md
  #554 to #562): a walk is a flag on a through phase (`walks` on the phase,
  `peds: true` on `standardPhases`), a call per leg (`Controller.callPed`,
  `World.callPed`, the panel's buttons, scripted `calls` and Poisson
  `pedDemand`), WALK then a flashing clearance sized from the road's width,
  the green held until the clearance ends, a call unserved past `pedWait`
  costing satisfaction the way a honk does, and walkers on the zebra at 1.1
  to 1.7 m/s who hold the box for anything turning onto their leg. Induction
  loops: `sensors: true` wakes the `queue` rules, `loops` names the lanes
  that have one, the renderer draws the rectangle and lights it, and a rule
  carries `after` (the green it may not cut short). The corridor: `nodes:
  2` builds two boxes on one east-west street with their legs laid end to
  end (`linkNodes`), a controller per node with `controllers[i]` overriding
  `controller` (an offset, a start phase), the handoff through
  `Car.newApproach()`, the panel driving the box it selects, the camera
  framing both. "Crossing" (Four Ways with calls on every leg, loops in the
  bays) and "Two Blocks" (the corridor on a timed plan, the east box 16 s
  behind). 107 + 128 + 51 + 20 + 73 checks.
- **M7, first increment: the green wave** (HISTORY.md #563 to #566): the
  offset slider on Two Blocks, 0 to a cycle less one, through
  `Controller.setOffset`: the controller keeps the stage it is in and pays
  the difference over the greens to come, each cut no shorter than the
  minimum green or stretched to at most twice its plan, whichever way round
  the cycle is fewer seconds, every change still through yellow and
  all-red, a hand on the phases meanwhile counting toward it (`shift` is
  what is still owed; `cyclePosition`, `clone`, `forecast`). The platoon
  visualiser (`js/wave.js`, `test/wave.mjs`): a time-space diagram in the
  panel, distance across and time down, each box a column coloured by the
  head its two throughs show (twenty seconds of samples above the now line,
  fifty of forecast below), a line from every green start at the speed a
  standard car holds to where it lands at the other box, and the main
  street's cars as dots twice a second. 138 + 137 + 59 + 20 + 23 + 83
  checks.

- **M7, second increment: three events and Rush Hour** (HISTORY.md #567 to
  #570): a level's `events` list is scripted moments, `{ kind, at, for }`
  each, started when the clock reaches `at` and ended `for` seconds later
  (`World.active`, `activeEvent(kind)`). The surge (`{ scale }`)
  multiplies every leg's demand on top of the level's `demandCurve`
  (`demandScale()`). The outage calls `setDark()` on every box and refuses
  every command that needs power (`requestPhase`, the new `World.setFlash`
  door, `requestPriority`; the page disables the buttons) until it ends,
  when each box comes back through an all-red to the phase it was in. The
  ambulance (`{ leg, turn, within }`) spawns an emergency vehicle with
  `within` seconds to leave the map; past that it is late
  (`stats.ambulanceLate`, an `ambulance-late` event, five honks' worth of
  satisfaction and 50 points). The corridor changed under it: it is green
  for every movement off the vehicle's entry leg, not its own alone, and
  it holds until the vehicle is through the box plus 6 s, capped at 60
  (`_holdPriority`). The panel's event line says what is on and for how
  long, and the board announces each start. "Rush Hour": one crossroads,
  the surge at 60 s for 100 at 1.7, the power out at 110 s for 30, the
  ambulance from W at 185 s with 40 s. 138 + 167 + 65 + 20 + 23 + 95
  checks.

- **M7, the rest: four events, and levels 7 and 8** (HISTORY.md #571 to
  #576): the platoons, `{ kind: 'motorcade' | 'procession', at, leg,
  turn, size, spacing }`, two archetypes of their own (`motorcade` fast
  and tight, `procession` slow and tight, both obeying the light like a
  standard car) spawned one member at a time; a platoon is split when a
  member is held at its stop line by the light while another is past the
  box (`stats.platoonSplits`, a `split` event, five honks' worth and 50
  points, once), and a motorcade takes the priority corridor (E, or a
  click on any member; the hold covers every member, the ones still to
  arrive included) where a procession gets none. The hand on the green:
  pressing the green phase again calls `Controller.holdGreen`, and its
  elapsed rule counts from now (`heldT`). The lane closure, `{ kind:
  'closure', at, for, leg, lane, length }`: `Network.close`/`open`,
  `lanesForTurn(turn, leg)` leaving a closed lane out, traffic still
  arriving in every lane (the cones stand 54 m from the box, the map edge
  is 110 m out), a car in the closed lane merging onto the open lane's
  path at its own `s` before the taper when there is room ahead and behind
  (`_mergeTick`, `_roomFor`; the body slides across over a second,
  `Car.easeLateral`) or holding at the taper (`car.mergeS`, read by
  `drive`) until there is, and the zipper: a car in the open lane coming up
  behind one waiting at the taper takes it as its leader (`leaderOf`) and
  slows for it. The renderer draws the taper, the cones, the tint and the
  sign. The school zone, `{ kind: 'school', at, for, scale, peds }`:
  `world.speedScale` (the product of every zone in force, read by `drive`)
  and `pedScale()` on the pedestrian calls, whose Poisson clock now runs
  `pedScale` times faster with intervals drawn at the level's rate, under a
  flashing beacon on every leg. Three zebra rules that the new boards
  forced (#575): a permissive left that can still stop short of a zebra
  with people on it does, a permissive left that sees walkers on its exit
  zebra before it has committed holds at its own yield point in its lane,
  and speed decides who yields on a zebra (a walker passes a car standing
  still; a standing car holds for a walker in its lane ahead). Granny's
  cautious stop lets go when the green is extended. "School Run" (two
  lanes each way with walks, the zone at 40 s for 90 at half speed and
  four times the calls, W's curb lane closed at 150 s for 90) and "Main
  Street" (one lane each way, a motorcade of 5 from W at 50 s, a
  procession of 8 from N at 160 s, a 22 s rule to hold against, `boxStall:
  45`). `tools/calibrate.mjs` gained `--hold` (the hand under a platoon)
  and a splits column. The level select's scrim centres with `safe`
  (#132). 148 + 240 + 75 + 24 + 23 + 106 checks.

- **The UI clarity and visual pass** (2026-09-23, asked for by Devon ahead
  of M8, both increments in one PR): event banners queue in the board's
  top-left corner in the DOM instead of drawing over each other at the box;
  lanes whose movement is green are washed green (amber on yellow) and a
  hovered or focused phase card draws its movements as arrows on the board;
  phase cards draw the box with one arrow per movement; `Controller.cause`
  (read-only) names what started every change and the Signal line, the
  firing rule's card and a 60 s strip show it; the panel is five tabs, each
  level opening on its lesson's, with the hint and keys behind "?"; the
  Satisfaction line is four stats and the board fills the window. The
  visuals: sidewalks and curbed corners, rooftops with shadows, trees,
  noisy asphalt, all on a ground canvas under the board drawn once per
  camera and slid under a drag; soft car shadows; brake lamps and
  indicators from `Car.braking` and `Car.indicator` (read-only); lamp
  glows and a wash at every stop line; dusk on Rush Hour, night in the
  outage. Frames cost less than before it: 22 ms against 27 on Rush Hour
  at 115 s, 3 against 5.5 on First Light, under a software Chromium.
  163 + 252 + 75 + 24 + 23 + 156 checks.

- **M8, first increment: the campaign and the shop** (HISTORY.md #588
  to #593): the eight starred levels in pack order, each shut until the
  one before has a star (or it has been played, for saves from before
  M8), Free Play always open, the next level outlined. `js/campaign.js`
  (`test/campaign.mjs`) reads what is open, the stars to spend and the
  shop off the save, with no new field: a bought item is its id in
  `save.unlocks`, and the stars to spend are stars earned less the price
  of what is owned. Three things on the shelf, each once its teaching
  level has a star: protected turns (3 stars, after Four Ways), an arrow
  phase per street's lefts; extra phases (4, after the Stem), one phase
  per leg; sensors (5, after Crossing), loops in every lane of a level
  with rules. `loadout` folds them into a copy of the level, and
  `Controller`'s `extra` option appends the phases after the level's own,
  where `next` never goes (`cycle`, `lastBase`, `_after`): owned and
  unpressed they change nothing. A timed plan takes none. The panel
  marks a bought phase + with a note. 176 + 252 + 75 + 24 + 23 + 22 +
  169 checks.

- **M8, second increment: the roundabout** (HISTORY.md #594 to #599),
  node and sale together. `roundabout: true` on a network builds a ring:
  one lane on a 12 m centre line, anticlockwise on the screen, a splitter
  island on every leg and a yield line where the stop line was. Every car
  yields to anything that would reach its join before it could get in with
  1.5 s to spare (`cars.js ringVerdict`), the ring slows for a car merging
  in ahead of it (`leaderOf`), and the node's controller is built dark and
  refuses every command. The shop sells it at 6 after Rush Hour; it
  converts First Light, the Stem and Free Play (`campaign.js
  convertible`), each scored on its own `ring` calibration, and the owned
  item's button switches it off for the session. `tools/calibrate.mjs
  --ring` measures a converted board. 176 + 274 + 75 + 24 + 23 + 35 + 182
  checks.

- **M9, first increment: the grid** (HISTORY.md #601 to #606), no new
  mode yet. `js/grid.js growCells(seed, count)` grows a 4 by 3 district a
  box at a time from one seeded generator: the first box in the middle
  and a signal, each later one next to a built one (weighted by built
  neighbours squared), a T on the edge at 0.25 with its missing leg facing
  out, a ring at 0.2, one lane everywhere, 150 to 260 vehicles an hour on
  every leg, and the first n boxes of a seed the same whatever count is
  asked for. `gridLevel` makes it a runnable level (a 20 s rule at every
  signal, no target). `network.js buildCells` takes `cells: [{ at: [col,
  row], ...own }]`, puts each at its cell times 220 m and joins neighbours
  both ways through `linkNodes`, north-south included; a leg into a box
  with no leg back, two lane counts on one join and two boxes on a cell
  all throw. Two bugs from box one fixed with it: the crossing cache per
  node (#602) and the tourist's wrong turn at its own box (#603). The page
  runs one through `__signalCity.startGrid(seed, count)`: boxes by number,
  three to a row, the stage and cause lines on the selected box, the ring
  note and strip following the selection, a ring's phases disabled, the
  camera down to 1.2 px/m. 176 + 274 + 75 + 24 + 23 + 35 + 34 + 194
  checks (`test/grid.mjs` is new).

- **M9, second increment: endless** (HISTORY.md #608 to #613). `js/endless.js
  dayLevel(seed, day)` is day n of a city: `gridLevel(seed, n)` up to twelve
  boxes, demand 10% up a day, 180 s, a target of 20 plus 8 a day with no
  cap (a full district clears a flat 50 to 130 a day and nothing locks at
  21 days' traffic, so the target is what ends a run), a 20 s wait target.
  A day ends the run if the grid locks or the target is missed; collisions
  cost points. The seed is rolled per run and Again replays it. Each new day
  is a new World, and `carryOver` keeps every old box's rules and timing.
  The card comes after the levels and opens on a star from Two Blocks; the
  end card reads the day, the run and the best, with Next day or Again. The
  best is `endless: { days, points, seed, runs }` through `repair`,
  `signal_city_v1` unchanged, recorded after every day. `convertible` now
  refuses a grid. `tools/calibrate.mjs --endless` prints the days. 176 +
  274 + 75 + 24 + 23 + 35 + 34 + 39 + 209 checks (`test/endless.mjs` is new).

- **M9, third increment: the sandbox** (HISTORY.md #614 to #618). Free
  Play's card has a district row under it: a stepper from one box to
  twelve and, past one, the city with New city. One box is Free Play
  itself, the same object (`grid.js districtLevel(base, seed, 1) ===
  base`), so it runs and hashes as it always did. A district is
  `gridLevel(seed, n)` with Free Play's name, drivers, five minutes,
  controls and two ambulances: no target (the HUD counts, the end card
  names the district), nothing recorded, the save unchanged. The
  ambulances come in on the first box, in build order, whose leg of that
  name spawns (`spawningLegs`), and a banner names the box. The
  roundabout converts only the one box, and the row says so when it is
  owned. M9 is done. 176 + 274 + 75 + 24 + 23 + 35 + 46 + 39 + 227 checks.

## Roadmap (from 2026-09-24)

Milestones 0 to 9 are done and nothing from the brief is left. This is the
development list that replaced "What is next", built from a review of the
shipped game on 2026-09-24 and the open items it inherited (the `games.mjs`
recipe and preview, the trucker's sweep, the one-box priority corridor, the
time of day per level). It is in build order. **R1 to R14 all run in a
cloud container as it stands today**: Node for every suite, and the
harness's headless Chromium (SwiftShader on Linux) for `test/browser.mjs`,
`games.mjs` and the preview capture, which is enough for a 2D canvas with
no pointer lock. **H1 to H4 need a real device, real ears or a person**, and
come last on purpose: nothing in R1 to R14 waits on them.

Size and Model follow `BACKLOG.md`'s columns. None of these is ranked in
`BACKLOG.md` yet; a row gets ranked there before anyone builds it.

### Before you start: the cloud setup

- `test/browser.mjs` imports `Tools/board-check/harness.mjs`, which needs
  that folder's packages: `cd Tools/board-check && npm install` once per
  container, or the suite dies of `ERR_MODULE_NOT_FOUND` before it runs a
  check. The postinstall pulls two copies of three.js for other projects;
  let it.
- The suites, run from `Projects/signal-city/`, and their counts on
  2026-09-24: `node test/signals.mjs` 176, `sim.mjs` 274, `scoring.mjs`
  75, `sprites.mjs` 24, `wave.mjs` 23, `campaign.mjs` 35, `grid.mjs` 46,
  `endless.mjs` 39, `browser.mjs` 227. 919 checks, all green, all in Site
  CI. `browser.mjs` writes its screenshots to `test/shots/` (ignored).
- Nothing in this project asserts anything real-time (#53 does not
  reach it), so a pass here is a pass. The frame-cost numbers are the one
  exception, and they are H2.

### The evidence behind R1 to R4

Every level run as it ships, with no input at all, six seeds each
(cleared / target, average wait, collisions, stars):

| Level | With no input |
| --- | --- |
| First Light, Stem, Four Ways | locks on all six (right: nothing runs the lights) |
| Crossing | 55 to 63 / 48, 47 to 52 s, 0 collisions: ★ on all six |
| Two Blocks | 87 to 103 / 80: ★★★ on 5, ★★ on 1 |
| Rush Hour | 65 to 83 / 56, 10 to 17 s: ★★★ on all six |
| School Run | 91 to 103 / 88: ★★★ on 2, ★★ on 1, ★ on 3 |
| Main Street | 65 to 76 / 60, 10 to 15 s: ★★★ on all six |
| Free Play | ★★★ on 2, ★★ on 4 (a sandbox; no change wanted) |

Rush Hour, School Run and Main Street open with a 22 s `elapsed` rule and
Two Blocks with a timed plan, and that default earns the stars on its own.
The skill each level teaches (the offset, the ambulance corridor, the
held procession) moves points and never a star: #570 made a late ambulance
a points cost and Main Street's second star is recorded as loose. So half
the campaign can be three-starred by watching it. Every level ships
`mode: 'soft'`, and the hard mode in `scoring.js` (one collision ends the
run) is used by none.

### R1. A reference hand, and a no-input table: done (HISTORY.md #636, #637)

`node tools/calibrate.mjs all --baseline --hand` prints both tables and the
hand against no input (about 25 minutes here); `--hand=phases,platoons,
corridor,offset` plays only the parts named. The no-input table matched the
one above cell for cell. The full hand beats no input on cleared or wait on
five levels and not on four: Two Blocks ties (its shipped 16 s is the
sweep's best offset), and Rush Hour, Main Street and Free Play lose both
because the corridor and the held procession cost the board. The greedy
alone (`--hand=phases`) beats no input on all three. That is R2's problem
measured: playing the lesson costs the wait star.

### R2. The lesson decides a star: done (HISTORY.md #639, #640)

A level with a default carries `lesson: { kind, ... }` and the move it
teaches is its second star (`scoring.js lessonMet`): Rush Hour the
ambulance on time on its corridor, Main Street no split platoon, Two
Blocks at most half the cars one box hands on stopping again at the next,
School Run no walk call over 40 s. Two Blocks ships both boxes on one clock
(offset 0), because at its old 16 s no input already made the progression.
The card names the second star and the end card says whether it was
played. `test/stars.mjs` in Site CI plays every starred level six seeds
with no input and fails a level that three-stars. **Left open, for R3**:
R1's hand, taught to answer a walk call (`answerWalks`), earns School
Run's three stars on 0 of 6 seeds (the lesson on at most 2 of 6 with any walk move tried), because a walk and its clearance put
any call's worst wait near 40 s under every hand tried; #639 has the
numbers.

### R3. Hard mode on one level: done (HISTORY.md #641)

Rush Hour ships `mode: 'hard'`, not School Run. R1's hand collides on
School Run (seeds 4 to 6), Main Street (4 and 5) and Two Blocks (1), and
runs Rush Hour clean on all six with three stars on each. Rush Hour's
crash is the corridor called on the shipped rule: the W left's arrow
meets an E through left in the box on seeds 2, 5 and 6 at 1.5 s of
all-red and on none at 2.5 s, so the all-red slider is what keeps the
run alive there. `test/scoring.mjs` crashes two cars through the World
on the shipped Rush Hour (the run ends with the "does not forgive one"
reason) and on the shipped Main Street (it goes on), and `test/browser.mjs`
checks that only Rush Hour's card says "one collision ends it".

### R4. Endless: measure the hand, then fix the ramp: done (HISTORY.md #648)

The hand does not fix endless, and the ramp cannot make it. Run through
`--endless`, R1's hand first misses on day 11, 12, 10, 11, 6, 10 against
no input's 11, 12, 11, 11, 2, 10: its phase choice does not raise a
district's capacity, and the target climbs to that capacity. A run now
starts on day 3's district (three boxes, a target of 36, still 8 more a
day), which cuts two idle days and moves nothing else. An event a day from
day 4 ships off: a surge box-blocked the hand on day 4 of seeds 4 and 5.
So N is 0. `test/endless.mjs` plays each seed hands-off and then with the
imported `handStep`, and holds that the hand lasts at least as long as no
input on five seeds of six over the first six days (`--full` plays them to
the end), and that where no input misses early (seed 5) the hand gets
through that day. Five, not the row's four: with events on the hand holds
on exactly four, so four would pass the lever the calibration turned down. Raising N needs a hand that reads spillback or a lever
beyond the ramp; a hand that skipped queues with a full exit and cut a
green over a car stalled 12 s in the box did not change the lock.

### R5. The site's side: board check, preview, card copy

**Size ¼. Model Sonnet 5. Shared files: say so in the PR body.**

- A `signal-city` recipe in `Tools/board-check/games.mjs`: load First
  Light, press 2, run 20 s at 1x, assert the Signal line reads "Changed by
  you", cleared is above zero and there are no page errors. Break it by
  pointing the key at a phase that does not exist.
- A preview in `capture-previews.mjs`: Rush Hour at dusk mid-surge, or a
  district of six in the sandbox. Capture on Linux, promote through
  `promote-previews.mjs` into `assets/previews/signal-city.jpg` and
  `assets/og/signal-city.jpg`, then `npm run social` and `social:check`.
  SwiftShader draws a 2D canvas the same as a GPU; this one is not a draft.
- The card in `index.html` and `landing.html` still says "one
  crossroads". Mention the district and endless.
- Fold in #585 while here: `DUSK_LEVELS` in `render.js` becomes a `light`
  field on the level (`'dusk'`), read by `lightFor`. Every level renders
  the same; the browser suite's dusk check holds it.

`cd Tools/board-check && npm run check && npm run social:check && node
ci-check.mjs` is the bar.

### R6. The priority corridor follows the vehicle across boxes

**Size ½. Model Opus 5. Open call first (architect).** A car keeps
`priority` across a handoff, so the next box does not hold for it and E
does not offer it again (Known gaps). The sandbox's ambulances cross two to
four boxes. The call: at the next box, is the corridor automatic (the
player called the vehicle once, and the city's pre-emption follows it,
which is how real emergency pre-emption works), or does the player call it
again at each box? Recommended: automatic once called, so the lesson stays
"call it early" and a district does not ask for a key press per box.
Changes Two Blocks and Main Street under play, so re-run their calibration
(Main Street's motorcade takes the corridor) and record both tables. Guard
in `test/grid.mjs`: an ambulance called at box 1 of a three-box route is
held for at box 2; break it by clearing the request on handoff and watch
that line fail. Ask the World where the car is, not the helper that
decided (#614's lesson).

### R7. Sound

**Size ½. Model Fable 5.1.** The game is silent, and it counts honks. A
`js/audio.js` on Web Audio, every sound synthesized in code, so nothing is
vendored and nothing is fetched: a horn per archetype (the trucker's low,
the aggressive driver's short and repeated), the relay click of a signal
change, a siren that rises as the vehicle nears the box and pans with its
x, a crash, the pedestrian push-button chirp, and a traffic bed whose
level follows the cars on screen. Caps: at most three horns a second, so
Rush Hour's surge is a jam and not a noise. The context starts on the
first input. The mute switch is `settings.sound`, **already in the save
and already defaulting to true** (`js/save.js fresh()`), so there is no
storage change. Tests: a Node check with a stub `AudioContext` that counts
what a seeded Rush Hour asks to play (the siren starts when the ambulance
spawns, stops when it leaves, a surge's honks never pass the cap), and a
browser check that the switch writes `settings.sound` and a reload keeps
it. Whether it sounds right is H3, not this row.

### R8. The phone layout, in emulation

**Size ¼. Model Opus 5.** There is one breakpoint (760 px: the panel goes
under the board) and nothing has ever loaded the page at phone size. Zoom
is the wheel and the + and - keys, so a phone cannot zoom at all, and
hover is how a car is picked for the pointer cursor. Add a section to
`test/browser.mjs` at 390 by 844 with `hasTouch`: the board fills the
width, every phase card and the Levels button are reachable by scrolling,
a tap on a phase card changes the signal, a tap on an ambulance calls its
corridor. Add two-pointer pinch zoom to `js/input.js` (the camera already
has `zoomBy`), and a tap that did not move picks a car, as the click does
now. Watch for #132 on the level list: a centred scroll container needs
`safe`. How it feels under a thumb is H1.

### R9. A rule that calls a phase instead of cutting one

**Size ½. Model Opus 5.** Known gaps: a `queue` rule cuts the running green
as soon as its `after` has run, which on Crossing cut every through short
and locked 3 of 6 seeds at 4 s, so the level ships `after: 16`. A real
actuated controller *calls* the phase for its next turn and *skips* a
phase nobody is waiting for. Add `then: 'call'` (the phase runs at its
turn in the sequence, not now) and a skip-when-empty flag on a phase for
levels with sensors. Crossing's calibration re-runs with the call form; if
it beats `after: 16` the level's default can move to it. Sensors are a
shop item, so this gives the purchase something new to do.

### R10. Entry metering: a hand in a roundabout run

**Size ½. Model Fable 5.1.** With the ring bought, a run has nothing to
press (#599). Entry metering is the real fix for a dominant leg: a signal
on one approach that holds that leg for a few seconds when the leg it
starves has queued past a loop. One meter per ring, on the leg the player
picks, with a red time slider; the ring's controller stays dark apart from
it. It extends #595's ring without a two-lane ring (still refused). Each
converted board gets a `ring.meter` calibration: the meter set well should
beat the bare ring's wait on at least four of six seeds, or the item is
not worth selling.

### R11. The trucker's sweep as geometry

**Size 1. Model Fable 5.1.** Known gaps: the wide sweep is a rule (a
turning truck ties up every other lane of its entry and exit legs until it
clears) and "wrong in the way a diagram is". Model the trailer: a second
body hinged at the fifth wheel, following the tractor's path with the
off-tracking of a tractor-trailer, swept against the other lanes' paths by
the same SAT test collisions use, so a truck blocks only the lanes its
trailer actually crosses. Every level with trucks shifts, so re-run all
calibrations and hold every shipped target, or move it and say so in
`HISTORY.md`. A 1 because the calibration is the job, not the geometry.

### R12. Lane changes on a corridor segment

**Size ½. Model Opus 5.** A car handed from one box to the next keeps its
lane, so on a two-lane corridor with a left bay a car in the inner lane can
only turn left (Known gaps). Two Blocks runs one lane each way so nothing
shows it today. Give the segment a lane change: a gap-acceptance swap on
the straight between boxes toward a lane that allows the car's next turn,
the same path swap the zipper uses. Needed before any two-lane corridor
level, and a prerequisite for R13's second corridor level.

### R13. More board: a second pack

**Size 2+. Model Fable 5.1. After R2, R6 and R12.** Eight levels teach
eight ideas. Candidates that use what exists: a two-lane corridor with a
green wave both ways (the two-way wave wants travel time at half a cycle;
Two Blocks' 43 s cycle is not 31, so a new block length), a grid of three
where the ambulance crosses every box (R6), a ring with a metered leg
(R10), an outage on a timed corridor (its return wants `setOffset`'s
shift, Known gaps). Each level gets R1's two tables and R2's rule from the
first commit. One increment a session, a level or two at a time.

### R14. Endless keeps a day that was left halfway

**Size ½. Model Sonnet 5. Low priority.** #612: nothing is saved mid-day,
so a run closed in the middle loses that day. The fix is an
`endless.pending` record (seed, day, carried rules) that `repair` fills
empty on older saves, key unchanged. Only worth doing if R4 makes runs
long enough that losing a day hurts.

### Needs a real device, real ears or a person (last)

None of these can be done from a cloud container, and none blocks R1 to
R14. They are the same kind of row as the site's real-hardware passes.

- **H1. A touch playtest on real glass** (after R8). A phone and a tablet:
  can a thumb hit a phase card mid-surge, does pinch fight the page's own
  scroll, is an ambulance big enough to tap at 12 boxes. **Size ¼. Model
  Opus 5.**
- **H2. Frame cost on a real GPU.** Every number here is software
  Chromium: 22 ms a frame on Rush Hour at 115 s (#584), and the 12-box
  district zoomed out has never been timed on anything else. A low-end
  laptop and a phone, with the frame times written down, and the
  district's cars and trees checked for what drops first. **Size ¼. Model
  Sonnet 5.**
- **H3. An hour with ears on** (after R7). Horn density at Rush Hour's
  surge, whether the siren is heard before the ambulance is seen, the
  traffic bed's level against the rest, fatigue over a long endless run.
  **Size ½. Model Fable 5.1.**
- **H4. A first-time player on the retuned campaign** (after R2). Someone
  who has not seen the game plays First Light to Main Street while you
  watch: does the lesson star read, where do they stall, does anyone find
  the Timing tab on Two Blocks without the hint. Devon's to arrange.
  **Size ½. Model Opus 5.**

## Known gaps and decisions

- The priority corridor is one box's. A car keeps `priority` across a
  handoff, so on a corridor or a district the next box does not hold for
  it and E does not offer it again (`priorityNearest` skips a car that has
  it). On one box it never mattered; the sandbox's ambulances cross two to
  four boxes. Clearing it on handoff would change Two Blocks and Main
  Street under play, so it waits for a row of its own. A district has no
  target and no calibration: it is a sandbox (#615).

- A grid's edge legs end in grass inside the district: a box whose
  neighbour cell is empty has a 110 m spawning leg that stops where cars
  appear. The generator fills the district compactly, so it reads as
  suburbs being built, but nothing draws a road end. The grid has no
  target outside endless (the HUD reads "/ 1" through the debug hook).
  At 12 boxes the camera is at 1.27 px/m and a car is 6 px long; the
  wheel zooms to three times that. `test/grid.mjs` runs twelve boxes for
  90 s and the calibration for 240 s at about 17 s a run: a longer
  endless day will want the suite to sample, not soak.

- Endless's early days ask little: a hands-off city clears every day to
  the ninth on five of six calibration seeds, which is 27 minutes before
  the target bites. The ramp is the district's capacity, not the target's
  slope: a steeper start fails day one on seeds that clear 25. Whether a
  hand beats the default by enough to matter is unmeasured; the
  calibration plays hands-off only. Nothing is saved mid-day, so a run
  closed in the middle of a day loses that day and counts only the days
  before it (#612).

- The ring is one lane (#595); a two-lane ring is refused, so Four Ways
  and School Run cannot convert. It has no zebras, loops or cones, and
  nothing on a converted board needs them (#597). With nothing to press, a
  ring run plays itself: entry metering (a signal on one approach of a
  ring, the real fix for a dominant leg) would give the player a hand in
  it, and is not built. The switch is the session's and starts on at every
  load (#599).

- The campaign's locks are the select's, not `start()`'s (#588). A bought
  item cannot be sold back, and there is no per-run toggle: an unpressed
  bought phase costs nothing (#590). Split phases carry no walks, so a
  pedestrian call waits through one.

- The UI pass saves nothing: a level opens on its lesson's tab every time,
  so a remembered last tab would only ever be overruled, and the save and
  `signal_city_v1` are untouched.
- The strip reads the controller's log, which keeps 200 transitions; at a
  change every 2 s that is 400 s, far more than the strip's 60.
- The Stem's side with no leg is a straight curb with a square of
  pavement at each end, not a curve. Cones and school beacons are not
  tinted at dusk or night (the beacons glow on purpose; the cones do not).
- A zoom redraws the ground once per wheel step (about 5 ms of a frame
  here); only a drag slides it.

- A permissive left on a one-lane approach holds its whole queue while it
  waits for a gap. That is real and it is also why level 1 runs 6% lefts.
  Level 3 gives the lefts a bay and an arrow of their own instead, because
  on a shared inner lane a protected left at the head of the queue holds
  every through behind it for the whole through phase, and that locked the
  four-phase board on 4 of 6 seeds before the bay (#549).
- Two permissive phases on Four Ways' network are faster than its four
  (11 to 27 s average wait against 26 to 33 s) and not clean (1 to 5
  collisions per six runs against 0). The level ships the four; "unplayable
  on two" is true of the level as built, where phases 1 and 3 alone starve
  the bay and gridlock every seed, not of permissive lefts in general.
- Queue rules sleep on a level without `sensors: true` and fire on one with
  it. A queue rule cuts the running green as soon as its `after` seconds
  have run (the minimum green by default): at 4 s Crossing's bays cut every
  through short and the board locked on 3 of 6 seeds, so the level ships
  `after: 16`. A rule that *calls* a phase for its next turn in the
  sequence, the way an actuated controller does, is not built.
- A corridor's handoff keeps the car in its lane: at the second box it picks
  among the turns that lane allows, so on a two-lane corridor with a left
  bay a car that arrived in the inner lane can only turn left. Two Blocks
  runs one lane each way. Lane changes on the segment are not built.
- Two Blocks' 30 s cycles gridlock on 2 to 3 of 6 seeds at every offset:
  a permissive left waiting for a gap in a platoon holds its one-lane
  queue past the 120 s limit. The level ships a 22 s main green, where no
  seed locks.
- The offset slider does not use `_alignToPlan`: that is the constructor's
  and a jump. `setOffset` keeps the running stage and pays the difference
  over the greens to come (#563). It takes the shorter way round the cycle,
  so on Two Blocks' 43 s cycle a move of 30 s is 13 s of stretch, and it
  never cuts a green below the minimum green, so a big cut can take two or
  three greens to pay; the panel's note says what is still owed until it is
  paid.
- The wave on Two Blocks runs one way at a time. 220 m at a standard car's
  14 m/s is 15.7 s, so with the east box 16 s behind a platoon released at
  the east box's green start reaches the west box 0.3 s before its green
  and one released at the west box lands 11 s into the east box's red; at
  27 s it is the other way about. `test/wave.mjs` holds both numbers. A
  two-way wave on a two-phase plan wants the travel time to be half a
  cycle, and 43 s is not 31; whether the level should say so is M8's, with
  the campaign.
- The forecast steps a clone without a sensor, so on a level with loops the
  diagram draws the timed plan and not what a queue rule will do to it.
  Two Blocks has no sensors.
- The trucker's "wide" sweep is a rule, not off-tracking geometry: a turning
  truck ties up the other lanes of its entry and exit legs until its trailer
  clears the box. Readable, testable, and wrong in the way a diagram is.
- Collisions in the mixed run come from the hazards the brief asked for:
  yellow punchers meeting a left finishing on the all-red, tailgaters with a
  reaction delay, red-runners. Standard-only traffic at 900 veh/h on a green
  never touches (test/sim.mjs).
- Nothing real-time is asserted anywhere, so #53 does not reach this
  project: the loop is fixed-step and every suite is arithmetic.
- Rush Hour's corridor costs the board. Calibrated on a 22 s cycle over
  six seeds: with the corridor called 2 s after the ambulance arrives it
  is on time on all six and the board clears 59 to 77 at 13 to 21 s
  average wait; never called, it is late on 3 of 6 and the board clears
  65 to 83 at 10 to 17 s. Target 56 and waitTarget 20 make the corridor
  the first star and a good hand on the phases the second. Before the
  corridor was widened to the whole entry leg, calling it early made the
  ambulance late on 3 of 6 seeds: a left turner at the head of the one
  lane sat on a red W-L through the whole hold (#569).
- An outage on a timed plan (Two Blocks) is not scripted anywhere yet:
  the box comes back to the phase it was in through an all-red, and its
  offset drifts by however long the dark lasted, because `_alignToPlan`
  is the constructor's and a jump (#563). If a corridor level ever gets
  an outage, the return wants to go through `setOffset`'s shift.
- A platoon member obeys the light like anyone else: a funeral
  procession's follow-through on a red (a courtesy law in much of the
  world) is not built, because with it a procession could only be split
  by something intruding, and the split is meant to be the signal's doing
  and so the player's (#571). The motorcade's escort is the corridor.
- IDM settles a platoon below its archetype's `vmax`: at 8 m/s and a 2 s
  spacing the procession's followers run 6.6 to 7.2 m/s, and the eighth
  hearse reaches the line 34 s after the first rather than the 28 the
  spacing alone would give. That is why the suite's held procession is
  held twice and Main Street's hint says the green is a long one.
- The lane closure's spawner still sends cars into the closed lane, on
  purpose: the cones are 54 m from the box and the map edge 110 m out, so
  the merge is the event. A first draft kept spawns out of the closed lane
  and the closure did nothing visible: on School Run seed 3 no car was in
  the lane when the cones went up (#573).
- The merge has no lane change anywhere else: a car changes lanes only
  out of a closed lane, at the taper, by a path swap. A right-turner
  merging into a lane with no right becomes a through.
- A car that stands on a zebra is walked past, and never strikes anyone
  under 1 m/s (#575). Two rules tried and dropped on the way: holding a
  through at the box edge for walkers on its exit zebra (its body sat on
  the entry zebra and two throughs on opposite legs held each other's
  walkers; Crossing's average wait rose 6 s), and nothing else. The rules
  that stayed leave Crossing's calibration exactly where #558 recorded it.
- `boxStall` is 45 s on Main Street: a permissive left waiting mid-box for
  a 30 s procession is not a gridlock (#576). Every other level keeps 30.
- Main Street's second star is loose: the 22 s rule alone waits 10 to 15
  s and the hand under each platoon 10 to 26 s, so holding the green
  costs the wait target on 2 of 6 seeds. The split is a points and
  satisfaction cost, not a star, by #570's rule for the ambulance.
