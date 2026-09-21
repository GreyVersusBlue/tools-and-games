# Signal City: the plan

A browser game about programming traffic lights. You never drive; you set
the signals, and the cars do the rest, obeying them or not according to who
is behind the wheel. Asked for by Devon on 2026-09-21. `BACKLOG.md` ranks the
open work; this file is the plan it points at.

## What shipped (milestones 0 to 6 and the green wave, 2026-09-21)

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

## What is next, in order

7. **M7, the rest: the events** (½): rush-hour surge (`demandCurve` is read
   by the spawner already; no level uses it), power outage (`setDark`; the
   cars already treat dark as a four-way stop; nothing calls it), VIP
   motorcade, ambulance under a timer, lane closure, school-zone flashing
   yellow window, funeral procession. Each wants a level or a scripted
   moment on one, a line in the panel or the HUD saying what is happening,
   and a check. The platoon diagram is corridor-only; an event on a single
   box does not need it.
8. **M8 campaign and unlocks** (1): six levels, stars spent on sensors,
   protected turns, roundabout conversion, extra phases.
9. **M9 endless and sandbox** (1): an intersection per survived day, a grid
   generator from `js/rng.js`, a roundabout node type.

## Known gaps and decisions

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
