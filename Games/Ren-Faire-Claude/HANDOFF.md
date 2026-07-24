# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 16

**Playable end-to-end.** Everything from Stages 1–15 still works. This
stage ships the first of the two backlog items that had sat fully
untouched since Stage 9: **a win condition** (deeper crowd-flow — guest
agents, path congestion — remains the other one, still open).

**What changed, concretely:**
- **A one-time "Legendary Faire" victory milestone.** New
  `CONFIG.winCondition` (`{ seasonTarget: 6, minReputation: 70, minCash:
  4000 }`): reach the END of Weekend 6 (or later) with reputation and
  cash both at or above those marks, and the faire earns a celebratory
  milestone screen. This is **not** a hard stop — the player clicks
  "Continue the Faire" and drops straight into the normal weekend-end
  summary, same save, same numbers, nothing about the sandbox changes.
  A new `victoryAchieved` flag on state guarantees it only ever fires
  once per save, so a later weekend that still clears every threshold
  doesn't refire it.
- **A real loss condition: bankruptcy.** New `CONFIG.bankruptcyFloor`
  (-1500). If cash crosses at/under that floor after a day resolves, the
  faire is bankrupt — first time cash has ever had a floor at all; before
  this stage a save could spiral arbitrarily negative forever with no
  consequence beyond the ledger looking bad. The player still sees that
  day's normal report ticket (so they see what went wrong), and the run
  actually ends the next time they click through — a terminal "The Faire
  Folds" screen with a "Start a New Faire" button (the same reset path as
  the header's Reset button, minus the confirmation dialog since the run
  is already over).
- **Both conditions are pure predicates first.** `engine.js` gained
  `checkBankruptcy(cash)` and `checkWinCondition(state)` — trivial,
  independently testable functions with zero side effects. All the
  actual state-machine work (when to check, how to flag, how to route)
  lives in `state.js`, same separation of concerns as every other stage.
- **Two new phases, same rendering pattern as `weekendEnd`.** `'victory'`
  and `'gameOver'` both hide the tabs and take over `#content` with a
  ticket-stub-styled screen (gold-accented border for victory, wine for
  game over) — no new UI pattern, just two more entries in main.js's
  existing phase dispatch.

## What was built this stage

- **`js/data.js`** — two new `CONFIG` entries: `bankruptcyFloor` (-1500)
  and `winCondition` (`{ seasonTarget: 6, minReputation: 70, minCash:
  4000 }`). No other authored content changed.
- **`js/engine.js`** — `checkBankruptcy(cash)` (pure, `cash <=
  CONFIG.bankruptcyFloor`) and `checkWinCondition(state)` (pure, reads
  `state.season`/`reputation`/`cash` against `CONFIG.winCondition`;
  deliberately ignorant of `victoryAchieved` — that guard lives in
  state.js, not here).
- **`js/state.js`** — `createInitialState` gained two new fields:
  `bankrupt` (false) and `victoryAchieved` (false). `runDay` now sets
  `next.bankrupt = checkBankruptcy(next.cash)` after applying the day's
  cashDelta — phase still goes to `'report'` as normal either way, so the
  fatal day's own ticket always shows first. `nextDay` checks
  `state.bankrupt` FIRST, before any of its usual contract/campaign
  ticking: if true, it short-circuits straight to `phase: 'gameOver'` and
  freezes day/weekendDay right there (a second `nextDay` call on an
  already-`gameOver` state is a stable no-op, confirmed by test). If not
  bankrupt, `nextDay` proceeds exactly as before, except at the existing
  weekend-boundary check (`weekendDay >= CONFIG.seasonLength`) it now also
  calls `checkWinCondition` — if true and `!next.victoryAchieved`, it sets
  `victoryAchieved = true` and `phase = 'victory'` instead of
  `'weekendEnd'`. New `acknowledgeVictory(state)` action: clones, sets
  `phase = 'weekendEnd'`, returns — the one and only way out of the
  victory screen, and it changes nothing else (cash/reputation/
  victoryAchieved all pass through untouched), so the weekend-end summary
  and `startNextWeekend` flow afterward work exactly as they always have.
  `loadState` migrates pre-Stage-16 saves missing either new field to
  `false`.
- **`js/ui.js`** — new `renderVictory(state)` and `renderGameOver(state)`,
  both reusing the existing `.ticket-stub` shell (dashed border, two side
  notches) that `renderReport`/`renderWeekendEnd` already use. Victory
  shows weekend/reputation/cash against the configured thresholds and a
  "Continue the Faire" button (`data-action="acknowledgeVictory"`); game
  over shows the same three numbers as a post-mortem and a "Start a New
  Faire" button (`data-action="newFaire"`).
- **`js/main.js`** — `render()` gained two more early-return phase checks
  (`'victory'` → `UI.renderVictory`, `'gameOver'` → `UI.renderGameOver`),
  slotted in next to the existing `'report'`/`'weekendEnd'` ones, same
  pattern. `handleAction`'s switch gained `'acknowledgeVictory'` (calls
  `State.acknowledgeVictory`) and `'newFaire'` (calls `State.resetSave()`
  directly, no confirm — the run is already over, unlike the header Reset
  button which still confirms mid-game).
- **`css/style.css`** — two small ticket-stub border-color overrides,
  `.victory-stub` (gold) and `.gameover-stub` (wine); no new layout rules.
- **`tests/smoke.mjs`** — 573 checks now (was 532): a pure-logic block
  for `checkBankruptcy`/`checkWinCondition` at and around their
  thresholds; a state-level bankruptcy block (`runDay` flagging
  `bankrupt` only once the floor is actually crossed, the fatal day's
  report ticket still showing normally, `nextDay` routing to `gameOver`
  and freezing day/weekendDay, a repeat `nextDay` call staying put, a
  healthy day never flagging); a state-level victory block (firing
  exactly at a weekend boundary that clears every threshold,
  `victoryAchieved` flipping, day/weekendDay/season staying put same as
  `weekendEnd` does, `acknowledgeVictory` dropping into `weekendEnd`
  without touching cash/reputation, a normal `startNextWeekend` after
  that, a later weekend that still clears every threshold NOT refiring
  once already achieved, and falling one point short of any single
  threshold correctly skipping victory); a `loadState` migration test for
  pre-Stage-16 saves; the existing 50-day fuzz run updated to treat
  victory (acknowledge-then-proceed) and bankruptcy (stop early) as
  legitimate outcomes of a long random run rather than test failures —
  this was a real, necessary fix, not just an addition, since the fuzz
  run's original loop only knew about `weekendEnd` and would have gotten
  stuck the first time a long run organically won or went bankrupt; and
  two DOM boot tests that preload a save already parked in `gameOver`/
  `victory` (rather than grinding out real days) and confirm the right
  screen renders plus its one button does the right thing.

## Backlog (win condition now shipped; one backlog item remains untouched)

**A win/loss condition is now shipped** (this stage). **Deeper
crowd-flow** (guest agents, path congestion, reachability-gated stage
draw — Stage 14's foot-traffic multiplier is still attribute-based, not
simulated) remains the one fully-untouched backlog item from the original
Stage 9 list. More/different legality rules (stall-to-stall spacing, a
demo camp cap, terrain-specific stall bans) also remain a standing,
not-yet-requested option, as does a drag-to-reorder/true click-and-drag
move.

## What the next stage needs

Both new thresholds live in one place: `CONFIG.bankruptcyFloor` and
`CONFIG.winCondition` — retune either independently if real play shows
-1500 is too forgiving/punishing, or if Weekend 6/70 reputation/$4000
turns out too easy or too hard to reach. They're independent of each
other and of the escalating-build-cost/upkeep rates (Stages 13/15), so no
cross-tuning is required, but a future stage tightening the economy
should sanity-check both thresholds still make sense afterward.
`checkBankruptcy`/`checkWinCondition` are the only two functions that
know these thresholds — any future stage adding a second win condition
(a "best faire in the land" reputation-only track, say) or a softer
bankruptcy warning (a low-cash alert before the hard floor) should add a
sibling predicate next to these rather than overloading either one.

**Next logical chunks, roughly in the order I'd tackle them:**

1. **Deeper crowd-flow** (guest agents, path congestion, reachability-
   gated stage draw), if Stage 14's attribute-based foot traffic turns
   out to be insufficient after real playtesting. Unchanged from Stage 9.
2. **A drag-to-reorder or true click-and-drag move**, if the current
   "click Move, then tap a new cell" two-step ever feels clunky.
   Unchanged.
3. **More content-pool filler**, same standing option as always.
4. **More legality rules**, same standing options as before (stall-to-
   stall spacing, a demo camp cap, terrain-specific stall bans) — none
   requested yet.
5. **Retuning the win/loss thresholds** after real play, per the section
   above — not urgent, but worth a look once someone has actually played
   several weekends.

**Things intentionally deferred (kickoff doc explicitly allows this):**
weather, rival faires, animal handling beyond the falconer performer
role, deep reputation splits (currently one scalar 0–100), and true
contract-price *negotiation* (a fixed choice between published deals, not
haggling).

## Wishlist (not yet scoped, no priority order)

Held over from the Stage 14 kickoff prompt for future stages to draw
from:

- **Guest archetypes** — a small set of visitor types (families,
  foodies, thrill-seekers) with different draws; a natural input to
  deeper crowd-flow work.
- **Weather/random days** — rained-out days hurting outdoor stages
  more than covered stalls; fits the existing `EVENT_POOL` random-
  event architecture.
- **Staff besides performers/vendors** — security, gate staff, an
  announcer/mayor — a third contractable role reusing the existing
  `CONTRACT_OPTIONS` pattern already built twice.
- **Multi-stage story arcs for performers** — a tournament or a
  running storyline across a weekend's three days, giving
  `TIME_BLOCKS` scheduling some narrative continuity.
- **Photo-mode/postcard export** — pure polish; a "share your faire"
  screenshot feature of the grounds map.
- **A second, deeper win track** — e.g. a reputation-only "best faire
  in the land" milestone independent of cash, now that the first
  win-condition plumbing (`checkWinCondition`/`victoryAchieved`/the
  `'victory'` phase) exists to extend rather than rebuild.

## Retro

**Went well:**
- Treating the win condition as a celebration, not an ending, kept the
  change small and low-risk: no new "are we allowed to keep playing?"
  logic anywhere else in the codebase, no new save shape beyond one
  boolean flag, and zero risk of accidentally locking a player out of
  their own sandbox save.
- Writing `checkBankruptcy`/`checkWinCondition` as trivial pure functions
  first, entirely separate from when/how state.js acts on them, made
  both trivial to unit-test in isolation before touching any state-
  machine wiring at all.
- Reusing the exact `.ticket-stub` shell for both new screens (just a
  border-color override) meant zero new CSS layout, and both screens
  automatically got the notch/dashed-border/centered-heading treatment
  for free.

**Dead end / thing to know about before you repeat it:**
- First pass at the bankruptcy state-level test assumed a state with "no
  plots built" would net a small loss on any given day, so a modest
  starting deficit (floor minus $5,000) would stay ruined after a day
  resolved. Wrong — this game's attendance/ticket-revenue formula pays
  out based on reputation alone, with no stage required to draw a crowd,
  so a single day can swing several thousand dollars positive even with
  zero structures built. Had to push the test's starting deficit far
  deeper (floor minus $50,000) to make the "stays bankrupt regardless of
  the day's own cashDelta" assertion actually safe. Worth remembering for
  any future stage's tests that construct an already-ruined state: don't
  assume a plot-less day is a cheap day.
- The pre-existing 50-day fuzz run needed an actual code change, not just
  new assertions alongside it — its loop only knew how to route through
  `weekendEnd`, so the first time a long random run organically hit
  either new terminal-ish phase it would have silently gotten stuck (the
  loop keeps looping, `runDay`/`nextDay` keep getting called against a
  `victory`/`gameOver` state that never advances day, and the final
  `day === 51` assertion would just fail with no explanation). Since both
  outcomes are now legitimate, the fix was to teach the fuzz loop to
  acknowledge victory and continue, or break early and accept a
  bankruptcy ending — not to suppress or avoid triggering either
  condition.

## Changelog


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

