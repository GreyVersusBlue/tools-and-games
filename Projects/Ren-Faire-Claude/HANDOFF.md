# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 20

**Playable end-to-end, no new mechanics this stage.** Stage 19 rebuilt the
whole economy and the whole interface in one pass, and flagged its own
biggest risk in its own retro: *no browser was available in the build
sandbox, so the visual work was reviewed by reading rather than by
looking.* This stage went back and actually checked that, by the only
means available in a browser-less sandbox — a computed audit rather than
a fresh guess.

**What was checked.** Every `color:` declaration in `css/style.css` was
paired with the actual background it renders against (panel body, card
body, HUD gradient, or the light ticket-stub) and run through the real
WCAG relative-luminance formula, not eyeballed. Twenty-some pairs were
checked; eighteen already passed comfortably (14.8:1 for primary body text
down to a worst-case 4.3:1 on the one pair that's WCAG-AA-large-only by
design). Two failed outright:

- **`--vellum-faint` (`#6F6450`), used as small text on dark panels** —
  wordmark subtitle, HUD sub-labels, inactive tab labels, every table
  header (schedule/roster/ledger), plot-card kind tags, the map legend,
  campaign cooldown tags — measured **2.9–3.1:1** against the panel and
  card backgrounds it actually sits on. WCAG AA requires 4.5:1 for text
  this size; none of it qualifies for the 3.0:1 large-text exception.
  This wasn't a one-off — it's the single token this build uses for
  *every* secondary label across the whole dark interface, so the miss
  was systemic rather than local.
- **`--wine`, used as text color for negative values** (`.ledger-label.bad`
  in the HUD, `.ledger-table td.neg` in the Office) — measured **2.54:1**
  against the dark backgrounds it sits on. This is the color whose entire
  job is telling the player their cash just went negative; a 2.54:1 red on
  near-black is the one place illegibility would actually cost someone
  the game.

**The fix.** Both tokens were lightened along their existing hue (same
warm tan, same wine red — this is a luminance correction, not a palette
change) to the minimum value that clears 4.5:1 against every background
each one is actually used on: `--vellum-faint` → `#93846A` (4.6–4.9:1),
and a new `--wine-text` (`#CD6677`, 4.5–4.6:1) introduced specifically for
text-on-dark use so `--wine` itself is untouched everywhere it's a border,
a background tint, or a hover state — none of which carry the same
contrast obligation and all of which already read fine. Everything else
audited (the ticket-stub's light-background palette, button states, the
plot-marker terrain overlays) was already comfortably within spec and was
left alone.

**Guarded against regression.** A new smoke-suite section parses the
actual hex values back out of `style.css` and re-runs the same WCAG
contrast math the audit used, plus checks that the two fixed call sites
reference `--wine-text` rather than the original `--wine`. If a future
stage darkens either token again, or a new call site quietly reaches for
`--wine` on a dark background instead of `--wine-text`, this fails instead
of waiting for the next "no browser available" caveat. 675 → **684
checks**.

**What this stage did not do.** It did not attempt layout, spacing, or
information-density review — those genuinely need eyes on a rendered
page (or a real screenshot tool), not arithmetic, and remain an open item
below. It also did not touch any game mechanic, balance number, or the
Stage 19 economy rework; nothing in `data.js`, `engine.js`, or `state.js`
changed.

## Backlog

Unchanged from Stage 19, plus one addition:

- **Layout/spacing/density review still needs real eyes on a rendered
  page.** This stage's audit was contrast-only because that's the one
  visual property checkable by computation alone; whether the new
  permanent-map layout actually reads well at 1080px/720px, whether
  anything overlaps or crowds, is still an open question the moment a
  browser (or a screenshot-capable tool) is available.
- `perGuestCost`, `upkeepRate`, and `winCondition`/`bankruptcyFloor` are
  still the three economy numbers most likely to need adjusting after
  real play (unchanged from Stage 19 — nothing here touched them).
- **True guest-agent/pathfinding simulation** remains the one fully
  untouched item from Stage 9 on. Standing, not-yet-requested options: a
  drag-to-reorder move, more content-pool filler, more legality rules.
- **Weather** is still a natural fit given `TIME_BLOCKS.heat` — unchanged
  from Stage 19's backlog note.

## What the next stage needs

The Section 1g `SIGNIFICANCE:` tests from Stage 19 are still the ones to
run against any future balance change (see prior status notes preserved
in the changelog below for the full list of what they check).
`computeGroundsDraw` is still a pure function of the plots array, ready
for a build-preview to call speculatively.

If a browser or screenshot tool becomes available before the layout item
above is picked up, that's the highest-value next visual pass — this
stage closed the one gap that was checkable blind, not the whole caveat.

## Wishlist (not yet scoped, no priority order)

Unchanged from Stage 19: guest archetypes, weather/random days, a third
contractable staff role (security/gate staff/an announcer), multi-stage
performer story arcs, a photo-mode/postcard export, a second deeper win
track, a per-day weather roll modulating `heat`, and a build-preview
showing a placement's effect on grounds draw before committing.

## Retro

**Went well:**
- Diagnosing before fixing, same discipline as Stage 19: the audit ran
  every color pair through the actual formula before touching any hex
  value, so the two fixes are the two real failures — not a guess at
  what "looked dark" plus collateral changes to tokens that were already
  fine.
- Both fixes were pure token/value edits with no HTML or JS touched and
  no new stored state, so the fix carried zero risk to the 675 existing
  checks (all still green) and needed no save migration.
- Writing the contrast math as a smoke-suite check (not just a one-off
  script) means this stays caught automatically instead of depending on
  a future stage remembering to re-run a Python file that isn't part of
  the repo.

**Things to know before repeating:**
- **A computed audit is not a substitute for looking at the page.**
  Contrast ratios catch color-pair legibility; they say nothing about
  whether text wraps badly, whether the sticky HUD overlaps content at
  an odd viewport, or whether the surveyor's-plat map actually reads as
  intended at 720px. That's still owed.
- The fixed hex values (`#93846A`, `#CD6677`) were derived by lightening
  along the original HSL hue/saturation until the contrast threshold
  cleared — a mechanical process, not a designer's eye — so they're
  correct-by-formula but worth a glance if a screen ever becomes
  available, in case the specific tone reads oddly against the warm
  palette even though the numbers pass.

## Changelog

- **Stage 19** — economy responsiveness + full visual rebuild, the first
  stage aimed at a systemic problem rather than a new mechanic. Diagnosis
  by 250-seeded-day sweeps found an empty field earned +$5,420/day
  (a full build paid back in 1.1 days), ticket price peaked at exactly
  the slider max, `state.builtPlots` was never read by attendance at all
  (Stages 12/14/17 only resliced a crowd the map had no vote in), and
  satisfaction was capped near 68 by an anti-correlated sightline/shade
  data table. Fixes: new `computeGroundsDraw` makes built stages/staffed
  stalls/demo camps multiply attendance itself (sqrt-diminishing,
  0.25x-1.65x); costs rescaled and coupled to scale (`baseOverhead` 150→
  2200, `upkeepRate` 2.5%→7%, `wristbandCut` 0.65→0.28, new `perGuestCost`
  $5, rates/build-costs ×2-2.5); price elasticity retuned so cash peaks at
  $19 and reputation at $16 (two different optima); new `heat`-weighted
  `blockQualityWeights` turned the dead shade/sightline tradeoff into a
  real scheduling puzzle; `bankruptcyFloor`/`winCondition.minCash`/
  `stage.baseCapacity` all rescaled to match. Net measured: empty field
  +$5,420/day → −$1,245/day; satisfaction range 56–68 → 47–89. Visual
  rebuild replaced the Stage 1–18 parchment look with a dark "night before
  gates open" operations room: a real app shell with the grounds map
  permanently visible beside a tabbed desk, Grenze Gotisch/Fraunces/Barlow
  Semi Condensed type, the map redrawn as a surveyor's plat (double-ruled
  sheet, compass rose, per-terrain CSS textures), and the new mechanics
  made legible via a grounds-draw meter, a revenue sparkline, and a
  break-even readout. New `SIGNIFICANCE:`-tagged test class (Section 1g,
  six checks) asserts mechanics are strategically load-bearing, not just
  correctly implemented — added because Stage 18 shipped fully green with
  a dominant do-nothing strategy. 629 → 675 checks. Caveat flagged: no
  browser was available to review the visuals, reviewed by reading
  instead (addressed by Stage 20). Delivered as renn-faire-sim-stage19.zip.

- **Stage 18** — three more build-time legality rules, all standing
  "not yet requested" options from the Stage 17/11/12 backlog. New
  `PLACEMENT_RULES.terrainBans.food`/`.vendor` (both `['hill']`) ban
  stalls from hill terrain; new `stallSpacingKinds`/`minStallSpacing`
  refuse two same-kind stalls sitting directly touching (cross-kind is
  still fine); new `maxBuiltByKind` (`{demo: 3}`) hard-caps demo camps.
  All three reuse Stage 11's `PLACEMENT_RULES`/`isLegalPlacement` pattern
  exactly, with zero new plot fields and no save migration.
  `isLegalPlacement`'s terrain-ban refusal message became generated
  rather than hardcoded (the old string would have told a refused player
  to try the very terrain that just refused them). The demo cap being the
  first *non-spatial* rule is why `renderBuildPalette` gained an
  "N/cap built" state. Most of the stage went into fixing ~a dozen
  pre-existing fixtures that incidentally used adjacent food stalls or
  hill anchors as generic scaffolding. 599 → 629 checks.


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

