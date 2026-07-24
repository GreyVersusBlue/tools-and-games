# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 18

**Playable end-to-end.** Everything from Stages 1–17 still works. This
stage ships **three more build-time legality rules** — all three were
standing, explicitly-named "not yet requested" options in the Stage 17
backlog (and the Stage 11/12 backlog before that): a hill ban for
food/craft stalls, same-kind stall-to-stall spacing, and a hard cap on
demo camps. **True guest-agent/pathfinding simulation** remains the one
fully-untouched backlog item from Stage 9 on; **a drag-to-reorder move**
and **retuning the Stage 16 win/loss thresholds** also remain standing,
not-yet-requested options.

**What changed, concretely:**
- **Food/craft stalls can no longer be built on a hill.** New
  `data.js` `PLACEMENT_RULES.terrainBans.food`/`.vendor` entries (both
  `['hill']`) — a cart-based stall needs level ground, unlike a stage
  (hill is already its *best* terrain — highest sightline, a
  `capacityMult` bonus) or a demo camp (a fixed living-history/falconer
  site, not a cart). This is the first terrain ban that isn't about the
  path, so `isLegalPlacement`'s refusal message is no longer a hardcoded
  "try a nearby clearing, hill, or woods" string (which would now be
  self-contradicting for a stall) — it's built from whichever terrain
  actually hit and whatever terrain is still allowed for that kind.
- **Two stalls of the same kind can't crowd the same corner.** New
  `PLACEMENT_RULES.stallSpacingKinds` (`['food', 'vendor']`) and
  `minStallSpacing` (1) — two food stalls, or two craft stalls, can't sit
  directly touching. A food stall right beside a craft stall is still
  fine (a real market-row layout); the rule is same-kind only, mirroring
  `minStageSpacing`'s existing shape exactly (same footprint-cell-to-
  footprint-cell check, same "a still-planning plot claims its spot too"
  rule, so laying out several same-kind plans crowded together and bulk-
  committing them can't dodge it).
- **Demo camps are capped at 3 at once.** New
  `PLACEMENT_RULES.maxBuiltByKind` (`{ demo: 3 }`) — a demo camp is a
  living-history reenactor or a falconer's mews, a real person/animal on
  site rather than a purchased structure, so the faire only has so many
  to field regardless of how much open ground is left. Keyed by kind
  (not a bare `demo`-specific field) so a future stage could cap
  something else the same way with no new code path. Counts any status
  (built or still-planning), same reasoning as the other two rules above.
  Unlike the two rules above, this cap isn't spatial — it blocks *every*
  cell at once once reached, not just some — so it's also the first
  legality rule surfaced directly in the build palette (`renderBuildPalette`
  now shows "N/cap built" instead of a price once a capped kind is maxed
  out) rather than only discoverable by trying a cell.
- **The grounds-map legend gained a line** noting the new stall hill ban,
  next to the existing path-frontage/stage-footprint hint.

## What was built this stage

- **`js/data.js`** — `PLACEMENT_RULES.terrainBans` gained `food: ['hill']`
  and `vendor: ['hill']`; new `PLACEMENT_RULES.stallSpacingKinds`
  (`['food', 'vendor']`) and `minStallSpacing` (1); new
  `PLACEMENT_RULES.maxBuiltByKind` (`{ demo: 3 }`). No other authored
  content changed — no new fields on a saved plot, no save migration.
- **`js/engine.js`** — `isLegalPlacement`'s terrain-ban check now builds
  its refusal message from the actual hit terrain and `TERRAIN_LEGEND`
  rather than a hardcoded path-specific string; a new same-kind stall-
  spacing check sits right after the existing stage-spacing check (same
  shape, generalized to whichever kind is in `stallSpacingKinds`); a new
  per-kind build-count check (`maxBuiltByKind`) sits just before the
  path-frontage check. All three read straight off `PLACEMENT_RULES` —
  no new exported functions were needed, `isLegalPlacement` is still the
  single entry point every caller already used.
- **`js/ui.js`** — `renderBuildPalette` shows "N/cap built" (with a title
  explaining the cap) instead of the usual escalating-price tag once a
  capped kind's count (built + planning) reaches its
  `PLACEMENT_RULES.maxBuiltByKind` limit; new import of `PLACEMENT_RULES`
  from `data.js`. `renderGroundsMap`'s legend gained one line about the
  stall hill ban. No changes were needed to the existing blocked-marker
  rendering — it already surfaces whatever `reason` string
  `isLegalPlacement` returns, generically, so all three new refusals show
  up there for free.
- **`tests/smoke.mjs`** — 629 checks now (was 599): a `PLACEMENT_RULES`
  data-integrity block for all three new entries; a hill-ban block (food
  and craft both refused on hill, stage and demo both still allowed, the
  message not suggesting hill as an alternative, checked directly and
  end-to-end through `buildPlot`); a stall-spacing block (same-kind too-
  close refused, cross-kind allowed, a still-planning stall claiming its
  spacing, the `excludeId` self-exemption, checked directly and end-to-
  end through `buildPlot`); a demo-cap block (three build fine, a fourth
  refused, still-planning demos counting toward the cap, a different kind
  unaffected, checked directly and end-to-end through
  `buildPlot`/`placePlot`); and two DOM checks (the build palette shows
  "3/3 built" once the demo cap is reached, with no ghost cell offered
  anywhere for that kind; a hill cell renders as a blocked marker naming
  the hill ban when Food Stall is selected). Fixing roughly a dozen
  pre-existing test fixtures that incidentally collided with the new
  rules (two food stalls that used to sit directly adjacent as pure
  occupancy-check scaffolding, or anchored on a hill cell for the same
  reason) took longer than writing the new checks — see the Retro below.

## Backlog (three more legality rules now shipped; guest-agent simulation remains)

**Hill ban / stall spacing / demo cap are now shipped** (this stage) —
the three standing, explicitly-named options from the Stage 17 backlog.
**True guest-agent/pathfinding simulation** (individual guests actually
walking the grounds, path congestion emerging from where crowds bunch
up) remains open as a considerably bigger lift than anything shipped so
far — everything through Stage 18 is still attribute/multiplier math,
not agents. A drag-to-reorder/true click-and-drag move, more content-
pool filler, and retuning the Stage 16 win/loss thresholds after real
play all remain standing, not-yet-requested options, unchanged from
Stage 17.

## What the next stage needs

`PLACEMENT_RULES.maxBuiltByKind` is a plain `{ kind: cap }` map — a
future stage capping a second kind (say, a stage cap, or a craft-stall
cap) just adds another entry; `isLegalPlacement`'s check already reads
the map generically and needs no changes. The same is true of
`stallSpacingKinds`/`minStallSpacing` for a third kind that should get
same-kind spacing.

**The demo cap is the first legality rule that isn't spatial** — every
other rule (terrain bans, stage spacing, stall spacing, path frontage)
can be discovered by trying a specific cell, so the existing blocked-
marker-on-hover pattern was enough on its own. A hard count cap blocks
every cell at once, which is why this stage also surfaced it directly in
the build palette rather than leaving it purely cell-discoverable. A
future stage adding another non-spatial rule (something gated on total
cash spent, or total roster size, say) should probably follow the same
"surface it in the palette/relevant panel, not just the map" instinct.

**A ready-made test-fixture trap for future stages:** several existing
smoke-test fixtures used two food stalls built directly adjacent (or
anchored on a hill cell) purely as generic occupancy-check scaffolding,
with no relation to the actual rule under test. Adding a new placement
rule can silently break fixtures like that in a completely unrelated
part of the suite — when a new rule ships, grep the test file for every
existing call to the kind(s) it touches, not just the tests written
specifically for it.

## Wishlist (not yet scoped, no priority order)

Unchanged from Stage 17 — still held over from the Stage 14 kickoff
prompt: guest archetypes, weather/random days, a third contractable
staff role (security/gate staff/an announcer), multi-stage performer
story arcs, a photo-mode/postcard export, and a second, deeper win track
(e.g. a reputation-only milestone independent of cash).

## Retro

**Went well:**
- All three rules reused `PLACEMENT_RULES`'s existing data-only shape
  exactly — no new exported engine functions, no new stored plot fields,
  no save migration. The stage-spacing pattern Stage 11 established
  (small data table + one check in `isLegalPlacement`, any status counts,
  `excludeId` self-exemption) turned out to generalize cleanly to a
  second axis (stalls) and a completely different shape of rule (a count
  cap, not a spatial one) with almost no new plumbing.
- Rewriting the terrain-ban message to be generated (hit terrain +
  "what's still allowed") rather than hardcoded paid for itself
  immediately — the old message would have told a player refused for
  building a food stall on a hill to "try a nearby clearing, hill, or
  woods instead," recommending the very terrain that just refused them.

**Dead end / thing to know about before you repeat it:**
- The bulk of this stage's time went into fixing pre-existing test
  fixtures, not writing the new feature or its own tests. Several tests
  elsewhere in the suite used two adjacent food stalls, or a food stall
  anchored on a known-hill cell, purely as generic "build two things"
  or "build on top of something" scaffolding — completely unrelated to
  placement legality. The new hill ban and stall-spacing rules broke
  roughly a dozen of these in ways that had nothing to do with what
  those tests were actually checking. The fix each time was the same:
  swap the incidental kind for one the new rule doesn't touch (`demo`
  has no hill ban and no spacing rule, so it was the safe substitute
  throughout) rather than relitigating the fixture's actual intent.
  Worth remembering for any future placement rule: grep for every
  existing call to the kind(s) about to be restricted, not just the
  tests written specifically for the new rule.
- First pass at the stage-on-hill sanity check (confirming a stage is
  still allowed on a hill) anchored at a cell where the stage's 2×2
  footprint spilled onto the path row below it — tripping the *existing*
  path ban, not testing anything about the new hill ban. Moved the
  anchor up one row so the whole footprint stays on hill.

## Changelog


- **Stage 17** — reachability-gated draw, the specific sub-item the
  backlog had named alongside "deeper crowd-flow" since Stage 9. New
  `data.js` `ENTRANCE` (`{x:0, y:2}`, the row-2 artery's western end);
  new `engine.js` `computePathDistances()` (memoized BFS along path
  tiles from `ENTRANCE`), `reachabilityDistance(plot)`, and
  `computeReachability(builtPlots)` (a 0.8×-1.2× gate-distance
  multiplier, scored separately for stages vs. stalls so a lone built
  plot of either kind is always exactly 1×); wired into `simulateDay`
  alongside Stage 14's foot-traffic multiplier (not replacing it) for
  both stage draw-weight and vendor stall sales. Building the BFS
  surfaced a real pre-existing terrain-authoring bug — the col-3 path
  spur has a gap at row 3, disconnecting it from the gate — handled
  gracefully (pinned to the worst multiplier, excluded from its group's
  mean) rather than fixed, and flagged for whichever future stage does
  true pathfinding. New `.gate-marker` on the grounds map; a "gate
  reach" tag on plot cards for stages AND stalls. 599-check smoke suite
  (was 573). Backlog: reachability-gated draw shipped; true guest-agent/
  pathfinding/path-congestion simulation remains the one fully-untouched
  piece of "deeper crowd-flow." Delivered as renn-faire-sim-stage17.zip.
- **Stage 16** — win/loss conditions, the first of the two backlog items
  that had sat fully untouched since Stage 9. New `CONFIG.winCondition`
  (`{seasonTarget:6, minReputation:70, minCash:4000}`) and
  `CONFIG.bankruptcyFloor` (-1500); new pure `checkBankruptcy(cash)`/
  `checkWinCondition(state)`; `runDay` flags a new `bankrupt` field the
  moment cash crosses the floor (that day's report ticket still shows
  normally first); `nextDay` checks `bankrupt` first and routes to a
  terminal `'gameOver'` phase, and separately checks `checkWinCondition`
  at the existing weekend-boundary check, routing to a one-time
  `'victory'` phase (guarded by a new `victoryAchieved` flag) instead of
  `'weekendEnd'` the first time every threshold is met. New
  `acknowledgeVictory` action drops from `'victory'` into the normal
  `'weekendEnd'` screen untouched otherwise — win is a celebration, not an
  ending. New `renderVictory`/`renderGameOver` reuse the existing
  `.ticket-stub` shell (gold/wine border accents). `loadState` migrates
  pre-Stage-16 saves missing either field to `false`. 573-check smoke
  suite (was 532) — pure threshold tests, state-level bankruptcy/victory
  flow tests, a `loadState` migration test, and 2 DOM boot tests that
  preload a save already parked in `gameOver`/`victory`; the pre-existing
  50-day fuzz run needed an actual fix (not just new assertions) since its
  loop only knew how to route through `weekendEnd` and would have gotten
  stuck the first time a long run organically won or went bankrupt.
  Dead end worth knowing: a "no plots built" day can still swing several
  thousand dollars positive (attendance/ticket revenue pays out on
  reputation alone, no stage required), so a bankruptcy test needs a much
  deeper starting deficit than intuition suggests to stay ruined. Backlog:
  win/loss condition shipped; deeper crowd-flow (guest agents, path
  congestion, reachability-gated stage draw) remains the one fully-
  untouched backlog item. Delivered as renn-faire-sim-stage16.zip.
- **Stage 15** — escalating build cost, the other half of the old
  "structure cap or cost curve" backlog item Stage 13's upkeep only
  partly addressed. New `CONFIG.escalatingBuildCostRate` (0.15);
  `quoteBuild` gained optional `builtPlots`/`excludeId` params (default:
  zero escalation, fully backward compatible) and now multiplies its
  terrain-adjusted cost by `(1+rate)^builtCount` before rounding — the
  Nth *built* structure of a kind costs more than the first, per kind,
  with still-planning plots never counting (mirrors upkeep's "not real
  until committed" rule). New `countBuiltOfKind`/`previewCommitAll`
  engine.js helpers; the latter closes a real loophole where planning
  several same-kind plots before committing any would let every one of
  them quote at "1st built" pricing — `commitAllPlots` (state.js) and the
  "Commit All" UI total (ui.js) both price a batch commit in order
  against the same shared function so they can't drift apart.
  `buildPlot`/`placePlot`/`movePlanningPlot`/`relocatePlot` all thread
  `state.builtPlots` through, with `excludeId` so a plot never escalates
  against its own already-built record when relocated. `commitPlot` now
  re-quotes live at commit time and writes the actual charged cost back
  onto the plot, rather than trusting a possibly-stale placement-time
  quote. The build palette's "from $X" tags, the ghost-cell preview, a
  planning plot's Commit button/tag, and the Commit All total all re-quote
  live so the UI never shows a stale number. 532-check smoke suite (was
  501) — 31 new checks across pure-logic, state-level, and DOM layers.
  Zero new stored fields, zero save migration. Backlog: the structure
  cap/cost-curve item is now fully addressed between Stage 13 and this
  stage; a win condition and deeper crowd-flow remain fully untouched.
  Delivered as renn-faire-sim-stage15.zip.

- **Stage 14** — crowd-flow-as-a-system, phase 1, tackling the
  backlog's longest-standing item. New engine.js `computeFootTraffic
  (builtPlots)` turns every built food/vendor stall's existing terrain+
  adjacency `traffic` attribute into a per-stall sales multiplier
  relative to the day's average stall (clamped 0.6x-1.6x); `simulateDay`
  now scales each seated vendor's buyer count by their own plot's
  multiplier instead of flat attendance, verified via a same-seed
  comparison showing the identical vendor earns more at a better-sited
  stall while attendance itself is unaffected. `computePlotAttributes`
  gained a food/vendor-only traffic bonus from nearby built demo camps
  (`nearbyDemos`), giving demo camps their first mechanical purpose
  beyond gating random events. A lone built stall's multiplier is
  always exactly 1, reproducing the pre-Stage-14 flat formula bit-for-
  bit (zero economy-wide rebalancing). A flavor-log line calls out a
  ≥1.3x spread between two staffed stalls in the same day; the Fair
  Floor plot card, grounds-map tooltip, and Backstage seat note all
  surface the multiplier. Zero new stored fields, zero save migration.
  501-check smoke suite (was 480) — 21 new checks across pure-logic,
  simulateDay-level, and DOM layers. Dead end worth knowing: the
  older Stage 2 adjacency math (traffic/sightline) is anchor-only, not
  footprint-aware like Stage 12's placement-legality checks — left
  as-is, flagged for a future stage. Backlog: crowd-flow item now
  partially addressed (deeper guest-agent/pathfinding simulation still
  open as a bigger future lift); an escalating build-cost curve and a
  win condition remain fully untouched. Delivered as
  renn-faire-sim-stage14.zip.
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
- **Stage 13** — daily upkeep, requested as economic pressure against
  overbuilding after Stage 12's review. New `CONFIG.upkeepRate` (2.5%)
  and engine.js `plotUpkeep`/`totalUpkeep`: every *built* plot costs
  that fraction of its own already-stored `cost` per day (0 for a
  still-`'planning'` plot), needing zero new fields and zero save
  migration since `plot.cost` has existed since Stage 3. `simulateDay`'s
  old `150 + builtStages.length*20` overhead stand-in is now a flat
  `CONFIG.baseOverhead` (150) plus this real, separate `upkeep` line;
  both surface in the Office ledger preview and the report ticket as
  distinct rows. Backlog's structure-cap/cost-curve item is now
  partially addressed (ongoing pressure exists; an escalating
  build-time cost curve is still open); 480-check smoke suite (was
  467) — 13 new checks for the pure upkeep functions and a
  `simulateDay`-level block confirming it scales with plot count and
  is excluded for planning plots. Rate is untuned beyond first
  principles and may need adjusting after real play.

