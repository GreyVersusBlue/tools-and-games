# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 10

**Playable end-to-end.** Everything from Stages 1–9 still works. This
stage was a direct response to a reported soft lock ("placed a lot of
food/craft stalls, couldn't start the day, no error text") plus four
specific feature requests: a per-kind stall vacancy tracker, a
planning-then-commit construction flow (with move/delete/demolish/
relocate), individual vendor-to-stall assignment (with an auto-fill
button), and the ability to rename built structures.

**On the soft lock itself:** direct stress-testing (build far more
stalls than hireable vendors, then open the gates) never reproduced a
hard block — "Open the Gates" was never actually disabled in the
pre-Stage-10 code; it always ran and just printed a warning about
unstaffed stalls. What *was* a real bug: `hireVendor`'s cap summed food
and craft stalls into one shared pool, so it was possible to over-hire
one kind against the other kind's stall count with no error at all.
Fixed as part of this stage's stall-kind split (below); the new vacancy
tracker should make this whole class of confusion visible going
forward regardless of what the original trigger actually was.

## What was built this stage

- **`js/data.js`** — three new `CONFIG` constants: `demolishFeeMult`
  (0.3 — the fraction of a plot's build cost charged to tear it down
  once committed), `relocateDiscountMult` (0.85 — on top of the
  demolition fee, what a relocated plot pays for its new site, as a
  discount off building fresh there), and `maxPlotNameLength` (40, for
  `renamePlot`).
- **`js/engine.js`** — new `STALL_KIND_BY_VENDOR_TYPE` (`{food: 'food',
  craft: 'vendor'}`) is the one place that translates between a
  VENDORS entry's `type` vocabulary and a built plot's `kind`
  vocabulary for the same two stall categories; both the hire cap and
  the vacancy tracker read through it rather than duplicating the
  mapping. New `stallSummary(state)` returns `{food, vendor}`, each
  `{total, filled}` — the vacancy tracker's data source.
  `computePlotAttributes` now ignores plots still in `'planning'`
  status when computing nearby-stage adjacency (a plan hasn't been
  built yet, so it can't steal sightline or send traffic).
  `simulateDay` now filters `builtStages`/`builtFoodVendorPlots` to
  `status === 'built'` (a plan draws no crowd and seats no vendor), and
  splits vendor revenue from vendor cost: every *hired* vendor still
  draws wages (`vendorCosts`, unchanged), but only a vendor actually
  *seated* at a built stall sells anything (`activeVendorObjs`) — a
  hired-but-unseated vendor is now pure cost, surfaced as an explicit
  warning (`"N hired vendor(s) are not assigned to a stall..."`) rather
  than a silent shortfall.
- **`js/state.js`** — the biggest change this stage.
  - `buildPlot` (the old instant place-and-pay action) is kept exactly
    as before for backward compatibility, just with `status: 'built'`
    and (for food/vendor kinds) `assignedVendorId: null` added to the
    plot record it produces, so it composes with everything new.
  - New planning → commit flow: `placePlot(state, kind, x, y)` lays a
    plot down for free with `status: 'planning'` (ids come from a new
    `state.nextPlotId` counter — `plot_1`, `plot_2`, ... — decoupled
    from `(x,y)` specifically so relocating a plot later never orphans
    a schedule or vendor-assignment reference to it).
    `commitPlot(state, plotId)` charges the plot's cost and flips it to
    `'built'`. `commitAllPlots(state)` is an all-or-nothing bulk commit
    for every currently-planning plot (charges the combined total once,
    or refuses with the number needed) — built directly for the
    "placed a lot of stalls at once" scenario in the report.
    `deletePlanningPlot`/`movePlanningPlot` are the free operations
    available only while `status === 'planning'`.
  - `demolishPlot(state, plotId)` tears down a *built* plot for
    `CONFIG.demolishFeeMult × cost` (any seated vendor is unassigned,
    not fired — they stay hired and can be reseated).
    `relocatePlot(state, plotId, x, y)` moves a built plot for the
    demolition fee plus `CONFIG.relocateDiscountMult × ⟨new site's
    cost⟩`; the plot keeps its id/name/vendor assignment throughout.
  - `renamePlot(state, plotId, newName)` sets a custom name (trimmed,
    capped at `CONFIG.maxPlotNameLength`, rejecting blank) and flips a
    new `customName` flag so a later relocate's terrain-based
    auto-naming leaves it alone.
  - `hireVendor` now caps food and craft hiring *separately* (the bug
    described above) using `STALL_KIND_BY_VENDOR_TYPE`, and — new —
    auto-seats a freshly hired vendor into the first open matching
    built stall, so the common case ("hire someone, they start
    working") needs no extra click. `fireVendor` now also clears
    whatever plot the fired vendor was seated at.
  - New assignment layer: `assignVendorToPlot`/`unassignVendorFromPlot`
    for manual reseating (a vendor can only be seated at one stall;
    assigning them elsewhere automatically clears their old seat), and
    `autoFillStalls(state)` — deterministic, no RNG — matches every
    hired-but-unseated vendor to an open stall of the right kind, for
    cleanup after a demolition/relocation leaves someone unseated.
  - `loadState` migration: a pre-Stage-10 save's plots get `status:
    'built'` (they were all functionally already-built under the old
    model) and `assignedVendorId: null` backfilled, `nextPlotId`
    defaults to 1, and — importantly — already-hired vendors get
    auto-seated into their already-built matching stalls on load, so an
    old save's economics don't silently break just from loading it in
    the new version.
- **`js/ui.js`** — Backstage gained a `renderStallSummary` block (the
  "N/M filled" gauges for Food/Craft Stalls, plus the Auto-Fill Stalls
  button) and each hired vendor's row now shows `seated: ⟨stall name⟩`
  or a warning that they're earning nothing; unhired-vendor rows show
  "No open ⟨kind⟩ stalls" instead of hire buttons once that kind is
  capped, rather than letting the click fail silently. Fair Floor's
  plot cards (`renderPlotCard`) are now status-aware: a `'planning'`
  card shows Commit/Move/Rename/Delete, a `'built'` one shows
  Relocate/Rename/Demolish, and food/vendor cards get either a
  "seated by ⟨name⟩ + Unassign" line or a `<select>` to seat an open,
  matching, hired-but-unseated vendor. A new commit-all banner appears
  above the plot grid whenever anything is still just a plan.
  `renderGroundsMap` gained a `pendingMove` parameter that reuses the
  exact same ghost-cell mechanism as fresh placement (excluding the
  moving plot's own current cell) to drive both `movePlanningPlot` and
  `relocatePlot` through the map — no new interaction pattern, just the
  existing one pointed at a different action.
- **`js/main.js`** — new `ui.pendingMove` (mirrors `ui.pendingBuild`,
  cleared on tab switch/nextDay/startNextWeekend/reset) plus action
  handlers for `commitPlot`/`commitAll`/`deletePlanningPlot`/
  `selectMove`/`cancelMove`/`moveTo`/`demolishPlot`/`unassignVendor`/
  `autoFillStalls`, and a `renamePlot` handler that uses a plain
  `window.prompt()` (consistent with the existing reset button's
  `confirm()`, no new UI chrome needed). A new `assignVendor` `change`
  handler alongside the existing schedule-select one.
- **`css/style.css`** — `.plot-card.planning`/`.plot-marker.planning`
  (dashed gold) visually distinguish a plan from a built structure on
  both the map and the card grid; `.plot-marker.moving` outlines the
  plot currently being relocated; `.commit-banner` and `.stall-summary`
  /`.stall-gauge` are small new blocks, no layout system changes.
- **`tests/smoke.mjs`** — 422 checks now (was 345): a full pure-logic
  block covering `placePlot`/`commitPlot`/`commitAllPlots` (including
  the all-or-nothing refusal case) /`deletePlanningPlot`/
  `movePlanningPlot`/`demolishPlot`/`relocatePlot` (fee math verified
  exactly against `CONFIG.demolishFeeMult`/`relocateDiscountMult`)/
  `renamePlot` (including that a custom name survives a later
  relocate)/the split food-vs-craft hire cap/`assignVendorToPlot`/
  `unassignVendorFromPlot`/`autoFillStalls`/the demolish-and-fire
  unseat-not-fire behavior/the seated-vs-unseated revenue split in
  `simulateDay`, plus a dedicated `loadState` migration test that seeds
  a hand-built pre-Stage-10 save shape directly into `localStorage` and
  asserts the migration backfills status/assignment/counter correctly.
  The existing Stage 3/7 DOM walkthrough was updated in place for the
  new placeAt-is-free/commit-charges-money flow (it now finds and
  clicks each plot's Commit button before asserting cash changed or
  before trying to hire against it).

## What the next stage needs

Read `js/state.js`'s planning/commit/move/demolish/relocate/assign
functions together — they're one cohesive feature even though they
touch a lot of surface area. `js/engine.js`'s `STALL_KIND_BY_VENDOR_TYPE`
is the thing to reach for anywhere else vendor-type ↔ stall-kind needs
translating.

**Next logical chunks, roughly in the order I'd tackle them:**

1. **Build-time legality rules.** Still deliberately relaxed since
   Stage 3 (any kind on any terrain) — unchanged this stage.
2. **Crowd flow / bottlenecks as their own system.** Unchanged
   candidate from prior stages.
3. **A cap or cost curve on total structures.** Still nothing stopping
   a player from tiling the whole unlocked grid if they have the cash
   — though the demolish/relocate fees at least make *undoing* an
   overbuild cost something now, which didn't exist before this stage.
4. **A hard end to the game / a win condition.** Unchanged.
5. **A drag-to-reorder or true click-and-drag move**, if the current
   "click Move, then tap a new cell" two-step ever feels clunky in
   practice — it reuses the existing ghost-cell mechanism on purpose to
   avoid new interaction patterns, but a direct drag would be a bigger,
   separate lift.
6. **More content-pool filler**, same standing option as always.

**Things intentionally deferred (kickoff doc explicitly allows this):**
weather, rival faires, animal handling beyond the falconer performer role,
deep reputation splits (currently one scalar 0–100), true contract-price
*negotiation* (what exists is a fixed choice between published deals, not
haggling, for both performers and vendors), and any kind of end-of-game /
win-condition state.

## Retro

**Went well:**
- Keeping `buildPlot` around unchanged (just tagging its output with
  `status: 'built'`) instead of rewriting every call site to the new
  `placePlot`+`commitPlot` two-step meant the entire pre-existing test
  suite (345 checks) needed zero behavioral changes — only the one DOM
  walkthrough that actually exercises the *live UI's* placement flow
  needed updating, since that's the one place that changed. Old and new
  construction paths produce the exact same plot shape, so nothing
  downstream (engine, UI, save format) needs to know which path a given
  plot came from.
- Auto-seating a vendor on hire (rather than requiring a separate
  manual assignment click every time) turned what could've been a
  fiddly two-step "hire, then remember to go assign them" flow into
  "hire, done" for the common case, while still leaving manual
  reassign/unassign and Auto-Fill Stalls available for the messier
  cases (post-demolition cleanup, deliberately reshuffling who runs
  which stall).
- Decoupling plot ids from `(x, y)` (via the new `nextPlotId` counter,
  used only by the new `placePlot` path) up front avoided a whole class
  of bug: the old `${x}_${y}` id scheme would have orphaned a stage's
  schedule entries the moment it was relocated to new coordinates.
  Worth remembering for any future stage that makes a previously-static
  identifier mutable.

**Dead end / thing to know about before you repeat it:**
- First pass at the DOM smoke-test fix for the new commit flow grabbed
  `built.builtPlots[0]` assuming it'd be the just-committed plot — but
  array order is push order, not "most recently touched," so it
  actually grabbed an unrelated still-planning plot from earlier in the
  same test and produced a confusingly-wrong failure message rather
  than a crash. Fixed by finding the plot by its known `(x, y)`
  instead. Lesson: when a test builds up multiple plots across several
  state transitions, always re-find the one you care about by an
  identifying property rather than trusting array position.

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
