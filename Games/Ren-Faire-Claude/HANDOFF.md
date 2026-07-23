# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 12

**Playable end-to-end.** Everything from Stages 1–11 still works. This
stage reshaped the map/building system on direct player feedback: a
real path *network* instead of one line, a hard requirement that
everything built sits on or beside that network, and stages that are
now physically bigger than every other structure kind.

**What changed, concretely:**
- **Stages are now 2x2**, anchored at `(x,y)` like before but occupying
  four cells. Every other kind (food/craft/demo) stays 1x1. This is the
  first kind-specific footprint the game has ever had, and it's now
  load-bearing everywhere a plot's position is checked: occupancy,
  grid-fence bounds, stage-to-stage spacing, and the new path-frontage
  rule below all operate over a plot's *whole* footprint, not just its
  anchor cell.
- **Path frontage.** Every buildable kind now needs at least one
  footprint cell sitting ON a path tile (food/craft/demo can straddle
  one) or directly beside one (orthogonal neighbor only — a diagonal
  touch doesn't count). A stage/demo camp still can't sit ON the path
  (Stage 11's rule, unchanged), so for those two kinds this only ever
  resolves via the "beside" half of the check.
- **A real path network, not one line.** The row-2 artery still runs
  the full width, but there's now a second north-south spur (column
  10) plus a short eastward connector (row 7, columns 10–13) so the
  Stage 8 grounds-expansion territory (East Meadow / Deep Woods Trail)
  actually has path frontage to build against once unlocked, instead
  of being stranded the moment it opens up.

## What was built this stage

- **`js/data.js`** — `STRUCTURE_TYPES.stage` gained `footprint: { w: 2,
  h: 2 }`; every other kind has no `footprint` field and defaults to
  1x1 via `engine.js`'s `footprintFor()`. `PLACEMENT_RULES` gained
  `requiresPathFrontage: ['stage', 'food', 'vendor', 'demo']` — an
  explicit kind list (not a bare boolean) so a future stage could
  exempt one kind without touching engine logic. `TERRAIN_ROWS` grew a
  second north-south path spur at column 10 (rows 2–9) and an eastward
  connector along row 7 (columns 10–13); everything else in the
  authored map is untouched.
- **`js/engine.js`** — new footprint primitives: `footprintFor(kind)`
  (kind → `{w,h}`, defaulting to 1x1), `footprintCells(x,y,w,h)` (pure
  cell enumerator), `plotFootprintCells(plot)` (reads a *built* plot's
  own stored `w`/`h`, falling back to `footprintFor(plot.kind)` only for
  a fixture/legacy record that predates the field — deliberately never
  re-derives a real plot's size from today's `STRUCTURE_TYPES`, since a
  later footprint change must never reshape something already on the
  grounds), and `isFootprintWithinCurrentGrid(state, kind, x, y)` (the
  state-aware fence-line check, extended to every footprint cell).
  `hasPathFrontage(cells)` checks every cell in a footprint for a path
  tile on itself or an orthogonal (non-diagonal, non-interior) neighbor.
  `quoteBuild` now refuses a footprint that would run off the authored
  map's edge (returns `null`) and returns `w`/`h` alongside its existing
  fields. `isLegalPlacement` was rewritten around the footprint: terrain
  bounds/bans, occupancy (now a full footprint-vs-footprint overlap
  check via `plotFootprintCells`, not a single-cell match), Stage 11's
  stage-spacing rule (now checked cell-to-cell across both footprints),
  then the new frontage check — in that order, first failure wins.
- **`js/state.js`** — `buildPlot`/`placePlot`/`movePlanningPlot`/
  `relocatePlot` all switched their bounds check to
  `isFootprintWithinCurrentGrid` and dropped their old single-cell
  occupancy pre-check (folded into `isLegalPlacement`'s overlap check
  now, so there's exactly one place that logic lives). `buildPlot`/
  `placePlot` stamp `w`/`h` onto the plot record at creation time from
  `footprintFor(kind)` — this is the "own stored size" `
  plotFootprintCells` reads, not a re-derivation. `loadState` backfills
  `w: 1, h: 1` onto every pre-Stage-12 plot unconditionally (even a
  stage — every plot really was 1x1 before this stage existed), never
  the kind's *current* footprint.
- **`js/ui.js`** — `renderGroundsMap`'s occupied-cell set now covers a
  plot's whole footprint (`plotFootprintCells`), so a ghost/blocked
  marker can never render on top of a cell a bigger structure already
  covers. Built markers span their real footprint via CSS grid
  `span`. A ghost/blocked preview also spans its prospective kind's
  full footprint — except the one case where a footprint would run
  past the currently-rendered grid edge, which renders as a single
  blocked cell (spanning past the visible grid would draw outside it).
  Map legend gained a one-line reminder of both new rules.
- **`css/style.css`** — bigger glyph size for `.plot-marker.kind-stage`
  so a spanning 2x2 marker doesn't look like a stretched 1x1 icon.

## Backlog (unchanged priority from Stage 9 on, still ahead)

Crowd-flow-as-a-system, a structure cap/cost curve, and a win
condition remain the leading backlog items — this stage was requested
ahead of them and didn't touch any of the three. Also still standing:
more/different legality rules (stall-to-stall spacing, a demo camp
cap, terrain bans for stalls) as an optional future extension, not
requested yet.


- **`tests/smoke.mjs`** — 441 checks now (was 422): a pure-logic block
  covering both rules directly against `isLegalPlacement` (terrain ban
  for stage/demo, allowed for food/vendor, adjacent-stage refusal,
  distance-2 allowed, `excludeId` self-exemption, a still-planning
  stage counting for spacing), an end-to-end block confirming
  `placePlot`/`buildPlot`/`movePlanningPlot`/`relocatePlot` all surface
  the same refusals through state.js, and a DOM check that an illegal
  cell renders as `.plot-marker.blocked` with an explanatory title
  while a legal one still renders as a clickable ghost.

## What the next stage needs

`js/data.js`'s `PLACEMENT_RULES` is the one place to extend for any
new placement restriction; `js/engine.js`'s `isLegalPlacement` is the
one place that reads it and is already wired into every placement path
in `state.js`, so a new rule added to `PLACEMENT_RULES` needs no
further plumbing unless its *shape* differs from a terrain ban or a
same-kind spacing rule (e.g. a rule involving two different kinds, or
a distance rule that isn't Chebyshev, would need its own branch in
`isLegalPlacement`).

**Next logical chunks, roughly in the order I'd tackle them:**

1. **Crowd flow / bottlenecks as their own system.** Unchanged
   candidate from prior stages.
2. **A cap or cost curve on total structures.** Still nothing stopping
   a player from tiling the whole unlocked grid if they have the cash
   — demolish/relocate fees make *undoing* an overbuild cost something,
   and this stage's legality rules stop a few of the worst layouts
   outright, but there's still no economic pressure against simply
   building everything everywhere.
3. **A hard end to the game / a win condition.** Unchanged.
4. **A drag-to-reorder or true click-and-drag move**, if the current
   "click Move, then tap a new cell" two-step ever feels clunky in
   practice.
5. **More content-pool filler**, same standing option as always.
6. **More legality rules**, if any of these feel worth adding:
   minimum spacing for food/craft stalls from each other (currently
   unrestricted), a hard cap on demo camps, or terrain-specific bans
   for food/vendor (e.g. no stall deep in the woods) — none of these
   were added this stage since the report/backlog only asked for
   "legality rules" in the abstract and the two shipped here were the
   most obviously-missing ones (blocking the one path through the
   grounds, and stacking two stages on the same spot's neighbors).

**Things intentionally deferred (kickoff doc explicitly allows this):**
weather, rival faires, animal handling beyond the falconer performer role,
deep reputation splits (currently one scalar 0–100), true contract-price
*negotiation* (what exists is a fixed choice between published deals, not
haggling, for both performers and vendors), and any kind of end-of-game /
win-condition state.

## Retro

**Went well:**
- Keeping the new rules in one small `PLACEMENT_RULES` data table plus
  one pure `isLegalPlacement` reader mirrors exactly how
  `TERRAIN_BUILD_MODIFIERS`/`quoteBuild` are structured — no new
  architectural pattern, so wiring it into four different state.js
  actions was a one-line addition to each rather than a refactor.
- Making a still-`'planning'` stage count for spacing (unlike
  `computePlotAttributes`, which ignores planning plots) was decided
  deliberately up front rather than discovered as a bug later — the
  scenario it prevents (lay out two stages touching, then
  `commitAllPlots` them both at once) is exactly the kind of one-shot
  bulk action Stage 10 added, so it needed to be caught at `placePlot`
  time, not just at commit time.
- Rendering illegal cells as a visible blocked marker (rather than
  just omitting the ghost) cost one extra branch in an already-short
  loop and meaningfully improves the "why can't I build here" moment,
  consistent with this account's general preference for surfacing
  reasons rather than silent refusals (see Stage 10's whole reason for
  existing).

**Dead end / thing to know about before you repeat it:**
- First pass at the new DOM test for the blocked marker reused a
  `stageBtn` element reference captured near the top of the DOM test
  block, before several renders had already happened. Since
  `main.js`'s `render()` replaces `#content.innerHTML` wholesale on
  every action, that reference was long detached from the live
  document by the time it was clicked again, so the click fired but
  never reached the delegated listener on `#content` — no error, just
  a silently-missing ghost/blocked marker and a confusing failed
  assertion. Fixed by re-querying `doc.querySelector(...)` fresh
  immediately before each click, same as every other click in this
  test file already does. Lesson: never hold onto a DOM element
  reference across a render boundary in this test harness — always
  re-query right before use.

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
- **Stage 4** — marketing/advertising: `AD_CAMPAIGNS` (3 non-stacking
  campaigns, each with cost/attendance-boost/duration/cooldown); new
  `launchCampaign` state action and `campaignById` engine lookup; `nextDay`
  ticks campaign duration and per-campaign cooldowns; `simulateDay`'s
  attendance formula gained an `adFactor`; Office tab gained a Marketing
  section (campaign cards with Launch buttons, running/cooldown status);
  report ticket shows the active campaign's boost when one ran; 151-check
  smoke suite (was 116), including a full launch → expire → cooldown →
  relaunch cycle test. Backlog now leads with contract negotiation depth
  and season/progression.
- **Stage 5** — contract negotiation depth: `CONTRACT_OPTIONS` (Day Rate,
  the old no-commitment behavior, vs. Weekend Package, a 15%-off 3-day
  commitment with an early-cancellation fee); `contractPerformer` gained
  an optional `contractId` param (defaults to `'open'`, fully backward
  compatible); `releasePerformer` now charges a cancellation fee and
  returns it as `fee`; `nextDay` ticks each contract's commitment down
  without ever auto-removing the performer from the roster; new
  `effectivePerformerCost` engine helper feeds both `simulateDay`'s wage
  total and the Office ledger; Backstage now shows both contract-type
  buttons plus running commitment/cooldown-free status; 177-check smoke
  suite (was 151), including a full sign → commit → lapse → free-release
  cycle. Backlog now leads with season/progression structure and
  extending the same contract pattern to vendors.
- **Stage 6** — season/progression structure: `CONFIG.seasonLength = 3`
  makes a weekend a hard 3-day arc; `nextDay` now stops at a new
  `weekendEnd` phase after a weekend's last day instead of silently
  rolling into the next one, and a new `startNextWeekend` action performs
  the actual day/weekendDay/season rollover; new `AD_CAMPAIGNS`/
  `CONTRACT_OPTIONS` entries (Kingdom Proclamation, Season Contract) are
  gated behind `unlockSeason` via the new `isSeasonUnlocked` engine helper
  (defaults to 1, zero migration needed for existing content);
  `summarizeWeekend` aggregates the trailing weekend's history into the
  new weekend-end summary screen (`renderWeekendEnd`); locked-content UI
  treatment added for not-yet-unlocked campaigns/contracts; 231-check
  smoke suite (was 177), including a full hard-stop → summary → rollover
  cycle and a DOM-level 3-day weekend walkthrough. Backlog now leads with
  vendor contract depth and making the grounds grid season-aware for a
  future expansion unlock.
- **Stage 7** — vendor contract depth, mirroring performers: vendors are
  now hired under the same shared `CONTRACT_OPTIONS` catalog performers
  use (Day Rate/Weekend Package/Season Contract) instead of a flat
  always-open hire/fire; new `effectiveVendorCost` engine helper (mirrors
  `effectivePerformerCost`) feeds `simulateDay`'s vendor wage total and the
  Office ledger; `hireVendor(state, vendorId, contractId='open')` gained
  the contract param plus season-unlock gating, `fireVendor` now charges a
  cancellation fee for breaking an active commitment early (mirrors
  `releasePerformer`); `nextDay` ticks `vendorContracts` commitments down
  alongside performer contracts; Backstage's vendor rows now show the same
  contract-type buttons/running-commitment tags/Let go flow as the
  performer roster; 259-check smoke suite (was 231), including a full
  vendor sign to commit to lapse to free-release cycle and a DOM-level
  Weekend Package hire/let-go test. Backlog now leads with grounds
  expansion as a season unlock and small content-pool filler.
- **Stage 8** — grounds expansion as a season unlock: `GRID`/`TERRAIN_ROWS`
  now author the full 14×10 map extent up front; new `GRID_EXPANSIONS`
  (Home Grounds 10×7/Weekend 1, East Meadow 12×8/Weekend 2, Deep Woods
  Trail 14×10/Weekend 4) gates how much of that map is actually buildable,
  via new engine.js helpers `currentGridSize`/`nextGridExpansion`/
  `isWithinCurrentGrid` built on the existing `isSeasonUnlocked` primitive;
  `buildPlot` now refuses a cell past the current fence line instead of
  just past the map's full extent; `renderGroundsMap` renders/offers only
  the currently-unlocked cells, and a new `renderGroundsStatus` line shows
  the current tier and next unlock; the weekend-end unlock notice mentions
  an upcoming grounds expansion alongside campaigns/contracts. Deliberately
  kept `terrainAt`/`quoteBuild` state-independent — only the bounds check
  needed to become state-aware. 282-check smoke suite (was 259), including
  `GRID_EXPANSIONS` catalog integrity, a season-gated expansion walk
  (refused → unlocked → still-refused-past-the-next-tier), and DOM checks
  that no ghost cell is ever offered past the current fence line. Backlog
  now leads with content-pool filler, build-time legality rules, and
  crowd-flow-as-a-system.
- **Stage 9** — content-pool filler + backstage drama events: `PERFORMERS`
  grew 10→15, `VENDORS` grew 8→12; new `QUIRKS.night_owl` (+20% Golden
  Hour draw, −10% Morning Procession draw) is the first quirk whose
  effect depends on which time block is passed in, which meant pulling
  `effectivePopularity` out of `simulateDay`'s private closure into a
  proper exported, independently-testable function; four new "backstage
  drama" events (`evt_diva_standoff`/`evt_musicians_jam`/
  `evt_falconer_show`/`evt_gossip_wagon`) gated on roster composition via
  a new exported `EVENT_REQUIREMENTS` lookup map, which also fixed a
  latent bug where `rollEvents`' old if/else chain silently treated any
  unrecognized `requires` string as always-eligible instead of failing
  closed. 342-check smoke suite (was 282), including a pure
  `effectivePopularity` unit-test block, a `simulateDay`-level test
  confirming night_owl's Golden-Hour-vs-Morning satisfaction difference,
  and an `EVENT_POOL`/`EVENT_REQUIREMENTS`/`EVENT_EFFECTS` integrity block.
  Backlog now leads with build-time legality rules, crowd-flow-as-a-system,
  a structure cap/cost curve, and a win condition.
- **Stage 10** — soft-lock investigation + four requested features: direct
  stress-testing found "Open the Gates" was never actually disabled, but did
  find a real latent bug — `hireVendor`'s cap summed food+craft stalls into
  one shared pool instead of capping each separately — fixed via new
  `STALL_KIND_BY_VENDOR_TYPE`. Shipped: (1) a per-kind "N/M filled" stall
  vacancy tracker (`stallSummary`); (2) a planning→commit construction flow
  (`placePlot`/`commitPlot`/`commitAllPlots`/`deletePlanningPlot`/
  `movePlanningPlot` free and reversible pre-commit, paid `demolishPlot`/
  `relocatePlot` for already-built plots, plot ids decoupled from `(x,y)`
  via `state.nextPlotId`); (3) individual vendor-to-stall seating
  (`assignVendorToPlot`/`unassignVendorFromPlot`/`autoFillStalls`, with
  `hireVendor` auto-seating on hire); (4) `renamePlot`. `simulateDay` now
  splits vendor cost (every hired vendor draws wages) from vendor revenue
  (only a seated vendor sells anything). `buildPlot` kept unchanged for
  backward compatibility, so the full pre-existing suite needed no
  rewrites. `loadState` migrates pre-Stage-10 saves. 422-check smoke suite
  (was 345). Backlog next led with build-time legality rules,
  crowd-flow-as-a-system, a structure cap/cost curve, and a win condition.
- **Stage 11** — build-time legality rules: new `PLACEMENT_RULES` data
  table (a stage/demo camp can't be built on the path; two stages can't
  sit directly touching, Chebyshev distance 1) read by a new pure
  `isLegalPlacement(kind, x, y, builtPlots, excludeId)`, wired into
  `buildPlot`/`placePlot`/`movePlanningPlot`/`relocatePlot`. A
  still-planning stage counts for the spacing check (unlike
  `computePlotAttributes`'s adjacency math, which ignores planning
  plots) so two planned stages can't be laid out touching and then
  bulk-committed together. `renderGroundsMap`'s ghost-cell loop now
  renders an illegal cell as a non-interactive `.plot-marker.blocked`
  marker with the refusal reason in its title, rather than just
  omitting the ghost. 441-check smoke suite (was 422), including a pure
  `isLegalPlacement` block, an end-to-end state.js block, and a DOM
  check for the blocked marker and its title. Backlog now leads with
  crowd-flow-as-a-system, a structure cap/cost curve, and a win
  condition; also floats more/different legality rules (stall-to-stall
  spacing, demo camp cap, terrain bans for stalls) as a standing
  option, not requested this stage.
- **Stage 12** — bigger stage footprints + a real path network + a
  path-frontage requirement, on direct player feedback. `STRUCTURE_TYPES.
  stage` gained a `footprint: {w:2,h:2}` (everything else stays 1x1);
  new engine.js primitives `footprintFor`/`footprintCells`/
  `plotFootprintCells`/`isFootprintWithinCurrentGrid` make a plot's
  whole footprint (not just its anchor) the unit every placement check
  operates over — bounds, occupancy, and Stage 11's stage-spacing rule
  all became footprint-aware. New `hasPathFrontage(cells)` requires
  every built kind to sit on or beside a path tile (orthogonal
  neighbor only); `isLegalPlacement` gained this as its final check.
  `TERRAIN_ROWS` grew a second north-south path spur (column 10) plus
  an eastward connector (row 7, columns 10-13) so the Stage 8 expansion
  territory has path frontage to build against once unlocked, instead
  of being stranded. `buildPlot`/`placePlot` now stamp `w`/`h` onto
  each plot at creation time (read back by `plotFootprintCells` rather
  than re-derived from current `STRUCTURE_TYPES`, so a later footprint
  change can never reshape something already built); `loadState`
  backfills `w:1,h:1` onto every pre-Stage-12 plot unconditionally.
  `renderGroundsMap` renders built/ghost/blocked markers spanning their
  real footprint via CSS grid `span`. Existing stage-spacing tests
  needed new coordinates (a 2x2 footprint changes what "adjacent" vs
  "overlapping" means at the old 1-cell-apart anchors), but no
  existing behavior changed beyond that. 467-check smoke suite (was
  441): 26 new checks covering footprint primitives, the map-edge and
  fence-line footprint bounds checks, path frontage (bare function,
  `isLegalPlacement` integration, and end-to-end through `buildPlot`),
  footprint-vs-footprint occupancy (anchor cell AND non-anchor cell of
  an existing stage both correctly refuse a second plot), and the
  pre-Stage-12 save migration. Backlog unchanged from Stage 9 on:
  crowd-flow-as-a-system, a structure cap/cost curve, and a win
  condition still lead; more/different legality rules remain a
  standing, not-yet-requested option.

