# Signal City: the plan

A browser game about programming traffic lights. You never drive; you set
the signals, and the cars do the rest, obeying them or not according to who
is behind the wheel. Asked for by Devon on 2026-09-21. `BACKLOG.md` ranks the
open work; this file is the plan it points at.

## What shipped (milestones 0 to 7, the UI pass and M8's first increment, 2026-09-21 to 2026-09-23)

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

## What is next, in order

7. **M8 campaign and unlocks, the rest** (1): roundabout conversion
   (with M9's node type, or the node built here first), and whatever the
   first increment's play shows the prices want. The brief's time of day
   per level (#585) is still render.js's `DUSK_LEVELS`.
8. **M9 endless and sandbox** (1): an intersection per survived day, a grid
   generator from `js/rng.js`, a roundabout node type.

## Known gaps and decisions

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
