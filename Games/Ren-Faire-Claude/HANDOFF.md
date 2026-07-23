# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 3

**Playable end-to-end, with true free-form placement.** Everything from
Stages 1–2 still works (contract performers/vendors, schedule four time
blocks, set ticket price, open the gates, read the report, advance the day
with progress carried forward). New this stage: there is no more fixed
catalog of 9 candidate plots. The player picks a structure kind (Stage /
Food Stall / Craft Stall / Demo Camp) and taps *any* open cell on the
terrain grid to build there — cost, capacity, and the auto-generated name
all come from the terrain under that specific cell.

## What was built this stage

- **`js/data.js`** — replaced the 9-entry `PLOTS` catalog with
  `STRUCTURE_TYPES` (4 buildable kinds: `stage`/`food`/`vendor`/`demo`, each
  with a `label`, `icon`, and `baseCost`; `stage` alone also carries
  `baseCapacity`), `TERRAIN_BUILD_MODIFIERS` (per-terrain `costMult`/
  `capacityMult` — clearing is the 1.0x baseline; hill costs more to grade;
  woods costs more to clear; path disrupts traffic during the build but a
  finished stage there seats the most people), and `TERRAIN_NAME`/
  `KIND_NOUN` (auto-naming lookup, e.g. hill + stage → "Hilltop Stage").
  `GRID`/`TERRAIN_ROWS`/`TERRAIN_LEGEND`/`TERRAIN_BASE` from Stage 2 are
  untouched.
- **`js/engine.js`** — added `quoteBuild(kind, x, y)`: the single pure
  function that turns a structure kind + cell into `{ kind, x, y, terrain,
  cost, capacity, name }`. Both `state.js`'s `buildPlot` action and
  `ui.js`'s placement-preview tooltips call this, so the price a player
  sees while placing is exactly what they're charged. `computePlotAttributes`
  keeps its Stage 2 signature but now expects `builtPlots` to be the array
  of full plot *objects* (`state.builtPlots`) rather than catalog ids —
  there's no catalog left to look ids up in, so a built plot's data lives
  entirely in the state record itself. Removed `plotById` entirely (no
  static catalog to look up).
- **`js/state.js`** — `buildPlot(state, plotId)` became
  `buildPlot(state, kind, x, y)`: validates the kind exists, the cell is
  in-grid and unoccupied, calls `quoteBuild` for the price, charges it, and
  pushes a new plot record `{ id: '${x}_${y}', kind, x, y, name, cost,
  [capacity] }` onto `builtPlots`. The plot's `id` is deterministic from
  its cell, so no id-counter field was needed on state. `hireVendor`'s
  open-stall check and `clone()`'s deep-copy both updated to work with
  `builtPlots` holding full objects instead of catalog-id strings.
- **`js/ui.js`** — `renderFairFloor` gained a `pendingBuild` parameter (the
  currently-selected structure kind, or `null`) and now renders: a build
  palette (one button per `STRUCTURE_TYPES` entry, showing icon/label/
  "from $X"), the grounds map with **ghost placement cells** — every open
  cell gets a `+` button quoting `quoteBuild(pendingBuild, x, y)` in its
  tooltip when a kind is selected — and a "Built So Far" list driven
  directly off `state.builtPlots` (no more static candidate cards; nothing
  left to "not yet build" from a list). Built markers/cards are unchanged
  in spirit from Stage 2, just reading straight off the state record
  instead of a joined catalog entry.
- **`js/main.js`** — added `ui.pendingBuild` to the transient (non-saved)
  UI state. New actions: `selectBuild` (sets `pendingBuild`, re-renders),
  `cancelBuild` (clears it), `placeAt` (calls `State.buildPlot(state, kind,
  x, y)`, clears `pendingBuild` on success). Removed the old `build` action
  entirely — there's no more static-id build. `pendingBuild` resets on tab
  switch, `nextDay`, and full reset so it never lingers somewhere
  confusing. No changes to the render-loop shape or the `data-action`
  delegation pattern itself.
- **`tests/smoke.mjs`** — 116 checks now (was 103): a new buildable-catalog
  integrity section, `quoteBuild` cost/capacity/naming checks (hill costs
  more and seats fewer than clearing for the same stage kind), rewrote
  every test that used to reference a static `plot_*` id to instead call
  `State.buildPlot(state, kind, x, y)` at coordinates matching Stage 2's
  terrain grid, and added a DOM interaction test that drives the actual
  build-placement flow: click the Stage palette button → ghost cells
  appear → click one → cash changes, a built marker appears, ghost cells
  disappear.

## What the next stage needs

Read `js/data.js`'s `STRUCTURE_TYPES`/`TERRAIN_BUILD_MODIFIERS` block and
`engine.js`'s `quoteBuild`/`computePlotAttributes` first — together they're
now the entire "what does building X at (x,y) mean" answer. Then skim
`ui.js`'s `renderBuildPalette`/`renderGroundsMap` for how placement mode is
drawn, and `main.js`'s `selectBuild`/`placeAt` handlers for how it's wired.

**Next logical chunks, roughly in the order I'd tackle them:**

1. **Marketing/advertising (Office).** Still just ticket pricing. See
   `fourth-quarter`'s ad-campaign pattern (non-stacking multipliers,
   cooldowns) — slots into `simulateDay`'s attendance calc alongside
   `priceFactor`/`popularityFactor`.
2. **Contract negotiation depth.** Still a flat accept/release toggle.
   Kickoff wants negotiation: counter-offers, multi-day vs. single-day
   contracts, or a reputation-gated audition pool.
3. **Season/progression structure.** `weekendDay` still just cycles
   1→2→3 as a label with no hard stop, no unlocks, no "weekend complete"
   beat. Free placement (this stage) makes "unlock bigger grounds" a much
   more natural progression lever than it would've been on 9 fixed plots —
   e.g. gate `GRID` size or which terrain types are buildable-on behind a
   reputation/cash milestone.
4. **More stalls/performers, backstage drama events.** Content pools are
   still small (10/8/6) — low-risk filler whenever a stage needs a smaller
   task.
5. **Build-time legality rules.** Right now any kind can be built on any
   terrain (I deliberately relaxed the Stage 2 handoff's suggestion that
   "stages probably shouldn't go on path tiles" — see retro below for why).
   If playtesting shows certain kind/terrain combos feel wrong rather than
   just economically bad, add real legality checks to `quoteBuild`
   (returning `null` for a disallowed combo, same as it already does for
   off-grid) rather than relying on cost alone to discourage them.
6. **Crowd flow / bottlenecks as their own system.** Real positions and
   now truly free placement both exist to build this on. Still substantial
   work: actual people-moving-between-plots simulation with path-tile
   bottlenecks. Keep treating `computePlotAttributes`'s adjacency effect as
   the "cheap" version and only build real flow simulation if playtesting
   shows the cheap version isn't compelling enough.
7. **A cap or cost curve on total structures.** Nothing currently stops a
   player from tiling the entire 70-cell grid if they have the cash —
   overhead (`150 + stages*20`) and the stage-adjacency sightline penalty
   are the only economic brakes today. Not urgent (cash is a real
   constraint early on), but worth watching once players have played
   several in-game "weeks" and accumulated a large bankroll.

**Things intentionally deferred (kickoff doc explicitly allows this):**
weather, rival faires, animal handling beyond the falconer performer role,
deep reputation splits (currently one scalar 0–100).

## Retro

**Went well:**
- Making the built plot's `id` a deterministic `${x}_${y}` string (instead
  of a counter field on state) meant `buildPlot` needed zero new state
  fields and the save-file shape barely changed — `builtPlots` just holds
  richer objects than it used to. Worth keeping this "derive the id from
  the thing itself" instinct for future player-generated content instead
  of reaching for an incrementing counter.
- Centering the whole kind+cell → price/capacity/name calculation in one
  pure function (`quoteBuild`) meant the build-preview tooltip and the
  actual charged cost literally call the same code — there was no way for
  those two numbers to drift apart, which is the kind of bug class that's
  otherwise easy to introduce (preview math and commit math silently
  diverging over time).
- The `data-action` delegation pattern from Stage 1 kept paying off: three
  brand-new interactions (`selectBuild`, `cancelBuild`, `placeAt`) needed
  zero new event-listener wiring in `main.js` beyond the switch-case
  entries themselves — `wire()` itself didn't change at all.

**Dead end / thing to know about before you repeat it:**
- The Stage 2 handoff suggested build-legality rules (no stages on path,
  no food on hill). I considered adding this and decided against it for
  now: Stage 1's *original* named plots already broke that exact rule on
  purpose (Whisper Grove was a stage placed in the woods; Kettle Row was a
  food stall placed on the path), so a hard legality wall would have
  contradicted the game's own established flavor. I leaned on cost/capacity
  economics instead (a stage on a path costs more but seats more; a stage
  in the woods is cheaper but seats fewer and has worse sightline) to make
  "wrong" placements a real tradeoff rather than an illegal move. If a
  future stage wants hard restrictions, do it deliberately with new flavor
  reasoning, not as a leftover from this note.
- Early on I had `buildPlot` reject a build if the *kind* already existed
  anywhere on the grounds (thinking "one stage catalog entry per kind" out
  of Stage 1/2 habit) — that's wrong now on purpose, since the entire point
  of this stage is letting the player build as many stages/stalls as they
  can afford, wherever they want. The only uniqueness constraint that
  should exist is "one structure per cell," which is what's implemented.
  If you're touching `buildPlot` again, don't reintroduce a per-kind cap
  without a very deliberate reason.
- I round `quoteBuild`'s cost to the nearest $10 (`Math.round(cost/10)*10`)
  purely for a cleaner-looking price tag in the UI. This means two
  different terrain multipliers can occasionally round to the same
  displayed cost for a cheap-enough base cost (e.g. demo camp, base $350) —
  not currently a problem since the multiplier spread (1.0–1.25x) is wide
  enough to stay distinct at every base cost in `STRUCTURE_TYPES`, but
  worth rechecking this arithmetic if a much cheaper structure kind gets
  added later.

## Changelog

- **Stage 1** — first playable slice: multi-file GitHub-Pages project
  (`data.js`/`engine.js`/`state.js`/`ui.js`/`main.js`), 9 fixed plots with
  authored sightline/shade/traffic, 10 performers/6 roles w/ quirks, 8
  vendors, 6 random day-events, plan phase (Office/Backstage/Fair Floor) →
  open gates → ticket-stub report → next day with progress persisting,
  localStorage save, 47-check smoke suite.
- **Stage 2** — real coordinate grid + terrain (hill/woods/path/clearing)
  for the 9 plots; sightline/shade/traffic derived from terrain plus
  stage-adjacency (nearby built stages hurt each other's sightline, help
  nearby stalls' traffic) instead of authored flat numbers; rendered 2D
  grounds map with clickable build markers; 103-check smoke suite.
- **Stage 3** — true free-form placement: the 9-plot catalog is gone,
  replaced by 4 buildable structure *kinds* the player can place on any
  open grid cell; cost/capacity/name all derive from the specific terrain
  cell via the new `quoteBuild()`; build palette + ghost placement cells
  added to the UI; `state.builtPlots` now holds full plot records instead
  of catalog-id strings; 116-check smoke suite (was 103), including a DOM
  test that drives the full pick-kind → tap-cell → confirm-charged flow.
  Backlog now leads with marketing/ads, contract negotiation depth, and
  season/progression (free placement makes "unlock bigger grounds" a
  natural next lever for that).
