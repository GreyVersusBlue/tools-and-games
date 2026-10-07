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

### R5. The site's side: board check, preview, card copy: done (HISTORY.md #649, #650)

`npm run games signal-city` plays First Light on the plain page: the
card, the 2 key, 20 s at 1x, and the Signal line reads "Changed by you".
The cleared count is read once a car has cleared, up to 65 s in, because
a car counts only past the far end of the map and the first does that
20.9 to 48.3 s in (#649). Pointing the key at a phase that does not
exist fails the Signal line alone. The preview is Rush Hour at dusk,
95 s in, mid-surge, captured on this Windows machine (#650), promoted to
`assets/previews/signal-city.jpg` and `assets/og/signal-city.jpg`, and
the page's social block points at it. The card names the district and
endless, and `landing.html` shows the still in place of the sealed
tile. #585 is folded in: Rush Hour carries `light: 'dusk'` and
`lightFor` reads it; with it set to day, "Rush Hour is played at dusk"
fails alone.

### R6. The priority corridor follows the vehicle across boxes: done (HISTORY.md #682)

Automatic once called. A car the player called is pre-empted at every box
it is handed to (`World._followPriority`, from `_handoff`), so the lesson
stays "call it early". E and a click still call only a car nobody has
called, and a car nobody called is held for nowhere. A ring or a blackout
refuses the follow as it refuses E, and a box already holding the car's
movement (a motorcade's lead got there first) is left to `_holdPriority`.
When the power comes back the corridor is made again at the box each
called car is on (`_resumePriority`, #872).
`test/grid.mjs` calls an ambulance at box 1 of three in a row and reads
each box's light off the World as the car's front reaches that box's stop
line: held at all three, and uncalled at none. With the request cleared on
handoff, the box 2 line fails on "box 2 E-W yellow". The row expected Two
Blocks and Main Street to change, and neither did. Main Street is one box
and Two Blocks has no emergency vehicle, so both `--baseline --hand` tables
match the pre-change tables exactly (#682). The change only affects play
in the Free Play district. There, a called ambulance's time on the map
fell from 30.4 to 28.6 s on four boxes and from 64.3 to 54.1 s on eight.

### R7. Sound: done (HISTORY.md #773)

`js/audio.js`, every voice synthesized on Web Audio: a horn per archetype,
the relay click, a siren that climbs and pans with the ambulance, a crash,
the push-button chirp and a traffic bed, capped at three horns and six
clicks a second of wall time. The context starts on the first input and
`settings.sound` is the switch, a header button and the M key, with no
storage change. `test/audio.mjs` counts what a seeded Rush Hour asks of a
stub `AudioContext`, and `test/browser.mjs` reloads the switch. How it
sounds is H3.

### R8. The phone layout, in emulation: done (HISTORY.md #774)

`test/browser.mjs` loads the page at 390 by 844 with touch: the board fills
the width (it was 300 px of 366 until the column stretched), every phase
card, Levels and the sound switch are reached by scrolling, a tap on a
card changes the signal, a tap 8 px off an ambulance calls its corridor,
two fingers spread and pinch the camera, and the level list passes #132.
`js/input.js` tracks pointers for the pinch and gives a touch a 12 px slop
and a 22 px reach. How it feels under a thumb is H1.

### R9. A rule that calls a phase instead of cutting one: done (HISTORY.md #775, #776)

`then: 'call'` on a queue rule latches a call on the phase serving its
movement and cuts nothing; `skip` on a phase has `next` pass it over until
called, while the box has loops. Crossing moved to it: four call rules on
its bays, the arrows skipping, the 24 s rule kept. With no input six seeds
clear 66.0 at 42.5 s against 59.5 at 50.2 s for the `after: 16` rules, still
one star each, and the hand still beats it. A bought arrow phase that is
called runs after the green it was called in, so sensors bought with the
arrows now buy an actuated left.

### R10. Entry metering: done, on Free Play's ring (HISTORY.md #777, #778)

A meter on one leg of a ring (`World.setMeter`) holds that leg amber 2 s
and red 2 to 12 s when the next leg round has queued 15 m back from its
yield line. `tools/calibrate.mjs --ring --meter` sweeps every leg and red
against the bare ring; `ring.meter` is what it found, and only Free Play's
ring passes the four-of-six rule (S at 3 s, mean wait 10.4 to 7.4 s; S at
6 s after R11), so only Free Play's panel offers the meter. First Light and the Stem carry
`null`: their bare rings wait 1 to 3 s. `test/stars.mjs` holds the rule.
The sweep also found #777: a retried scheduled arrival moved the level's
own spawn time, so Free Play ran differently after its first run in a page.

### R11. The trucker's sweep as geometry: done (HISTORY.md #779, #780)

The trailer is a second body hinged at the tractor's rear, towed along a
heading integrated from the path (`Path.trailerHeading`), so it cuts
inside a turn. `World.sweep` tests tractor and trailer against every other
lane's slices with the collisions' SAT test, and `boxVerdict` holds on that
instead of the old rule. A truck turns left on its own deeper path, because
on a car's the trailer reached a car standing behind its stop line, and a
car held by a sweeping truck waits behind the swept stretch. Every shipped
target held; Free Play's ring target went to 72 and its meter to S at 6 s.
The new truck collisions are trusting starters meeting a trailer on the
all-red.

### R12. Lane changes on a corridor segment: done (HISTORY.md #781)

A car handed to the next box draws its turn from every turn the leg allows.
When its lane does not take that turn it moves over on the straight, one
lane at a time, when the gap is long enough at its speed, the same path swap
the zipper uses; 25 m before the line it gives up and takes its lane's turn.
One lane each way draws exactly as before, so nothing shipped moved.

The gap it asks for counts the cars across the join (#927): a car changes
lanes in its first step at the next box, when the car alongside it in the
lane it wants is still on the last box's exit path, a metre short of being
handed on. `_alongLane` in `sim.js` places such a car in the new lane's
own arc length, by its distance short of the join, for `_laneRoom` and for
the zipper's `_roomFor`. Before, the change was made onto that car: on a
two-lane corridor with one car in ten turning right, seed 4 sideswiped 6
to 8 m past the join at 178.5 s (`test/sim.mjs` keeps that street and
that seed). A join is still a place to change lanes; a car waits for the
gap as it does anywhere on the straight. Not guarded by a run, only by
stand-in cars, because two boxes in a row cannot tell them apart: that the
lane is the one a path leaves its box in and not the one it came in by,
and that the leg it feeds is checked (a grid is one lane each way).

### R13. More board: a second pack (in progress: Market Ring and Boulevard shipped, HISTORY.md #782, #926)

**Size 2+. Model Fable 5.1. After R2, R6 and R12.** Eight levels taught
eight ideas. Pack 2 lives in `js/levels/pack-02.js` and runs on from Main
Street. Shipped: **Market Ring** (2026-10-01), a ring whose east leg
starves the north, its second star the entry meter (`lesson: { kind:
'meter' }`), and **Boulevard** (2026-10-07), the two-lane corridor with a
green wave both ways. Candidates still open: a grid of three where the
ambulance crosses every box (R6), an outage on a timed corridor (its return
wants `setOffset`'s shift, Known gaps). Each level gets R1's two tables and
R2's rule from the first commit. One increment a session, a level or two at
a time.

**Boulevard** (#926) is two boxes 220 m apart, two lanes each way, 600 an
hour each way on the boulevard and 220 on each side street, 240 s, on a
timed plan of 13 s and 9 s with 3 s of yellow and 2.5 s of all-red. That
is a 33 s cycle, and it is the cycle that was changed and not the block:
220 m at a standard car's 14 m/s is 15.7 s, half of 33, so the offset
that carries the eastbound platoon carries the westbound one. It ships on
one clock (#639's rule), opens on Market Ring's star, unlocks the phases
and the offset and no timing slider (a slider moves one box, and two boxes
on different cycles have no offset), and its second star is `progression`
at 30%. R1's two tables, six seeds, `node tools/calibrate.mjs boulevard
--baseline --hand`:

| | cleared (target 88) | average wait | stopping again | three stars | locks |
| --- | --- | --- | --- | --- | --- |
| nothing pressed | 93 to 135 | 7 to 8 s | 77 to 91% | 0 of 6 (one star on all six) | 0 |
| the hand: 16 s, the best of its sweep | 110 to 128 | 3 to 7 s | 4 to 11% | 6 of 6 | 0 |

The hand's sweep in stars over six seeds, 0 to 32 s by fours: 6, 6, 6, 16,
**18**, 13, 8, 6, 6. A finer sweep (a scratch script, six seeds an offset):
12 to 18 s each meet the lesson on all six, 19 and 20 s on four, 8 s on
none. A player does not set the slider at load, so the same 16 s was set
late through `World.setOffset`: 20 s and 30 s into the run it meets the
lesson on six seeds of six, 45 s in on four, a minute in on none, because
the cars that stopped twice before the wave count. The hint says to set it
early. It is not hard mode: R3's test (#641) wants no input clean on six
seeds, and no input collides on seeds 4, 5 and 6. `test/stars.mjs` pins the
table (WAVES), `test/wave.mjs` the geometry, `test/scoring.mjs` the data
and one seed each way, `test/browser.mjs` the card, the tab and the slider.

**Nobody turns on Boulevard, and that is a workaround** (Known gaps, the
lane change at the join). **NOBODY HAS PLAYED IT.** What a person should
look at first: whether 30 to 45 s is long enough to read the diagram and
find the offset on a first play, or whether the bar wants to be looser or
the run longer; then whether a boulevard where no car turns reads as a
street; then the hint, which says "half the cycle" and stops short of the
number.

### R14. Endless keeps a day that was left halfway: done (HISTORY.md #783)

`endless.pending` holds the day a run is on, with every box's rules and
timing as it starts; `repair` fills it with null on older saves, key and
version unchanged. A run closed halfway is offered back under the Endless
card as "Resume day N", replayed from that day's start.

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

## Blender assets (from 2026-09-25; B1 to B3 done 2026-09-30)

Blender-made assets rank above everything else (HISTORY.md #642), which puts
these three rows above R4. The shared plan is [`BACKLOG.md`, "Blender assets: the common plan"](../../BACKLOG.md#blender-assets-the-common-plan). A row gated `blender` runs
on huginn or Devon's Windows machine, and one gated `blender-gpu` on the
Windows machine only (#707); a session that cannot take it skips it and
takes the next row.

**B1. The sprite pipeline: done (HISTORY.md #721 to #723).** A 2D
pipeline in `tools/blender/`, built beside Orbital's the same day (#717, which
merged first and is the one later 2D copies start from): `common.py` (the render settings, the geometry
kit, the packer and a PNG writer of its own), `spec.mjs` (reads every
archetype's size and palettes out of `js/sprites.js`, so the palette has one
home), `budget.json` (the style sheet below as data) and `validate.mjs`, which
runs in Site CI's Signal City entry: 523 checks, no Blender. Nothing here is
shared with another project (#643). The style sheet:

- **Projection.** Straight down through an orthographic camera onto a
  transparent film. A car is built in metres, nose along +x, centred on the
  origin, exactly as `sprites.js` draws it; Blender's +Y is the game's -y, so
  the top of a frame is the side `sprites.js` puts its roof gloss on.
- **Light.** A sun from the front and the -y side, fifty degrees up, and a sky
  brighter toward it, so a crowned roof and a glass pane reflect a gradient
  that runs back from the nose. Cycles on the CPU, 128 samples, seed 0,
  adaptive sampling and the denoiser off, the Standard view transform. That is
  byte-stable across runs and across thread counts on one machine (#721).
- **Scale.** 36 px a metre in the sheet (#722). A frame is
  `ceil(length * 36) + 4` by `ceil(width * 36) + 4`, the canvas `spriteFor()`
  makes at that scale, anchored at its centre.
- **The band.** `spriteFor` draws a frame from the sheet while its own pixels
  per metre are 12 to 36 (`spriteFrom`, `spriteTo`) and the procedural car
  outside that band. Below 12 a car is under 55 sprite pixels long, and a
  district's 6 px car gains nothing from a render. Above 36 the vector car
  stays sharp where an upscaled frame would blur (#722).
- **Palettes.** Separate frames, not a body and a tint mask: a palette carries
  body, glass and accent, and the trailer swaps body and accent (#723).
- **The atlas.** `{ "sheet": { w, h, ppm, pad }, "frames": { name: { x, y, w,
  h, ax, ay } } }`, the common plan's frame map wrapped with the sheet's own
  numbers, which the game needs to scale a frame (#721). A frame is named
  `<archetype>/<palette>/<state>`, and the trailer is `trailer/<palette>/0`.

**B2. The car sheet: done (HISTORY.md #723).** `tools/blender/cars.py` builds
all ten archetypes and the trailer from `sprites.js`'s own hulls, glass, trim
and lamps, in their four palettes, with rideshare's four pulse states (t = 0,
0.25, 0.5, 0.75, the four `spriteFor` caches) and emergency's two light-bar
states: 60 frames, `assets/sprites/cars.png` (1024 x 944, 883,946 bytes) and
`assets/sprites/cars.json`. Eight minutes on huginn with `-t 4`; a second run
leaves `git status --porcelain` empty. `-- standard/0/0` renders named frames
into the gitignored `tools/blender/out/frames/` and writes nothing the game
loads, which is the loop for changing one car.

**B3. Wiring the sheet: done (HISTORY.md #770).** `SHEET_FROM` and `SHEET_TO`
in `js/sprites.js` are the band, held to `budget.json` by `validate.mjs` (525
checks). `spriteFor` draws a cached per-scale copy of the frame from
`cars.json` and the procedural car outside the band; `trailerSpriteFor` does
the trailer; `loadSheet()` is called from `main.js`; `sprites.html` shows the
procedural and rendered cars side by side. `test/sprites.mjs` is 42 checks and
`test/browser.mjs` 238 (one failure that predates the work, the cone-orange
pixel check, fails the same way on `main` under this machine's software
rendering). The sim never reads a sprite. Not looked at: the sheet on a real
GPU at device pixel ratio 2, and a rig on the road at 20 px/m.

## Known gaps and decisions

- The corridor follows its vehicle (#682), and is made again at the box
  its car is on when a blackout ends (#872). A follow into a box already
  pre-empted for a conflicting movement (two ambulances meeting) takes
  the box from the first, as E always has; the first one's leg gets its
  yellow (#875). On eight-box districts #682 read collisions over six
  seeds going from 11 to 14 with every ambulance called on spawn. That
  was six seeds, not the follow (#876): over thirty, at #682's own
  commit, 40 without it and 32 with it, and blocks of six swing from 3
  to 13. A district is a sandbox with no target (#615), so nothing was
  tuned for it. Both things that were left are closed (#918, 2026-10-07).
  A corridor asked for on a leg already green took the rest of that
  phase to red with no yellow, and turned the leg's permissive left
  protected the same step; and a corridor whose hold ended went to red
  itself with no yellow while the phase it had interrupted, red all
  along, showed three seconds of one. Now the movements a corridor drops
  get a yellow and an all-red on a clock of their own while its leg stays
  green, every permissive left of that green stays one until that clock
  has run, and the way out shows the corridor through its own yellow.
  This was Rush Hour's crash: on the 22 s rule the ambulance's call
  always lands on its own leg already green, and the "W left's arrow
  into an E through" of #641 (seeds 2 and 5 at 1.5 s of all-red) was the
  missing yellow, not the all-red. With the corridor called 2 s in, none
  of the six seeds collide at 1, 1.5 or 2.5 s now. A corridor called
  across a green on 0.5 s of all-red still does (seed 3, called 9 s in,
  the same before and after), so the hint's advice holds; whether the
  level should ship a shorter all-red so that the advice bites at the
  setting it ships with is Devon's, and nothing in the level was changed.

- A district "locks" more often with every ambulance followed, and that
  is the design, not a fault in the follow (#918). Thirty seeds, eight
  boxes, before the lights were fixed: 5 locks with the follow, 2 with
  it off, 1 with nobody called; after: 3 (seeds 7, 10, 19), 0 and 1.
  Every one of those locks, on both trees, is the same thing: one
  driver's waiting, added up over the whole trip, reaching the 120 s of
  `gridlockWait` (`sim.js`, the gridlock line in `step`). No box was
  stalled (the longest stall in a box at any of them was 7.6 s against
  the 30 that ends a run) and nothing waited on anything in a ring. On
  city 7 it is car 32, a student crossing four boxes: 14 s at the first,
  58 s at the second behind a corridor across it (7 s of the other
  street's green, 25 s of corridor, then that street's green again in full,
  since a corridor hands the box back to the phase it interrupted), 17 s
  at the third, 31 s at the fourth behind the second ambulance's. Each
  followed box costs its cross street up to a minute, and a trip that
  meets two is over the line. Following every ambulance is simply
  expensive, a district has no target (#615), and the 120 s was set for
  one box. Not changed and worth a decision some day: whether a district
  should count a trip's waiting against 120 s, and whether a corridor
  should hand the box to the street that waited instead of the one it
  interrupted (Rush Hour is tuned on the second).

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
  through short and the board locked on 3 of 6 seeds. Since R9 a queue
  rule may instead *call* its phase for its turn (`then: 'call'`), and a
  `skip` phase nobody called is passed over; Crossing ships that (#776).
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
- Boulevard's wave runs both ways because its cycle is 33 s (#926). It
  has no timing slider on purpose: `setTiming` reaches the selected box
  alone, and a longer all-red at one box would give the two boxes
  different cycles and no offset at all. A slider that moved both boxes
  would let the player break and remake the half-cycle, and is not built.
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
