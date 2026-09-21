# Signal City: the plan

A browser game about programming traffic lights. You never drive; you set
the signals, and the cars do the rest, obeying them or not according to who
is behind the wheel. Asked for by Devon on 2026-09-21. `BACKLOG.md` ranks the
open work; this file is the plan it points at.

## What shipped (milestones 0 to 4, 2026-09-21)

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

## What is next, in order

5. **M5 signal mechanics 2 to 4 and the panel** (1): the all-red clearance
   as a slider, protected left phases (the model has them; the level needs
   them and the heads need the arrow lamp wired to a real phase), flashing
   yellow and red as a mode the player can drop into, and the rule panel that
   edits the `rules` list live. Levels 2 (a T-junction) and 3 (a 4-way with
   lefts).
6. **M6 pedestrians, sensors, corridor** (1): pedestrian call buttons with
   serve-within-X, induction loops that fire the `queue` rules (the
   controller already evaluates them from `World.queued`), a level with two
   intersections and connecting road segments (the Path/Car design carries
   `newApproach()` for exactly this), offsets, and then the green wave: the
   offset UI plus a platoon visualiser.
7. **M7 events** (½ each): rush-hour surge (`demandCurve`), power outage
   (`setDark`, the cars already treat dark as four-way stop), VIP motorcade,
   ambulance under a timer, lane closure, school-zone flashing yellow window,
   funeral procession.
8. **M8 campaign and unlocks** (1): six levels, stars spent on sensors,
   protected turns, roundabout conversion, extra phases.
9. **M9 endless and sandbox** (1): an intersection per survived day, a grid
   generator from `js/rng.js`, a roundabout node type.

## Known gaps and decisions

- A permissive left on a one-lane approach holds its whole queue while it
  waits for a gap. That is real and it is also why level 1 runs 6% lefts;
  level 3 is where protected lefts arrive.
- The trucker's "wide" sweep is a rule, not off-tracking geometry: a turning
  truck ties up the other lanes of its entry and exit legs until its trailer
  clears the box. Readable, testable, and wrong in the way a diagram is.
- Collisions in the mixed run come from the hazards the brief asked for:
  yellow punchers meeting a left finishing on the all-red, tailgaters with a
  reaction delay, red-runners. Standard-only traffic at 900 veh/h on a green
  never touches (test/sim.mjs).
- Nothing real-time is asserted anywhere, so #53 does not reach this
  project: the loop is fixed-step and every suite is arithmetic.
