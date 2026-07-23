# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 7

**Playable end-to-end.** Everything from Stages 1–6 still works. New this
stage: vendors are contracted under the exact same deal shapes performers
are — Day Rate, Weekend Package, and (Weekend 3+) Season Contract — instead
of a flat always-open hire/fire.

## What was built this stage

- **`js/data.js`** — no new content catalog. `CONTRACT_OPTIONS`'s doc
  comment was updated to note it's now a *shared* catalog (performers and
  vendors both key into it) rather than performer-only; no field or value
  changes, so this alone is zero-risk to anything Stage 1–6 already relies
  on.
- **`js/engine.js`** — added `effectiveVendorCost(state, vendorId)`,
  mirroring `effectivePerformerCost` exactly: returns the contracted daily
  rate if `state.vendorContracts[vendorId]` exists, else the vendor's
  listed `cost`. `simulateDay`'s `vendorCosts` total now calls this instead
  of reading `v.cost` directly, so a discounted vendor actually pays less
  in the daily ledger and report, the same way a discounted performer
  already did.
- **`js/state.js`** — added `vendorContracts: {}` to initial state (and to
  `clone()`'s deep-copy list — applying the Stage 4 clone-bug lesson
  proactively, same as Stage 5 and 6 did). `hireVendor(state, vendorId,
  contractId='open')` gained the `contractId` param (default keeps every
  old 2-arg call site working untouched), an `isSeasonUnlocked` check
  identical to `contractPerformer`'s, and now records
  `vendorContracts[vendorId] = { contractId, dailyCost,
  commitDaysRemaining }`. `fireVendor(state, vendorId)` now mirrors
  `releasePerformer`: charges a cancellation fee
  (`cancelFeeMult × dailyCost × commitDaysRemaining`) if let go before a
  commitment lapses, returns it as `fee` for the UI to flash, and is free
  once the commitment has run its course. `nextDay` ticks
  `vendorContracts` commitments down in its own loop, right alongside the
  existing performer-contract tick (same "ticks once per elapsed day,
  never auto-removes on lapse" invariant). `loadState` migrates old saves
  missing `vendorContracts` to `{}`.
- **`js/ui.js`** — `renderBackstage`'s vendor rows now mirror the performer
  rows exactly: an uncontracted vendor shows one button per unlocked
  contract type (with the discounted rate in the label) plus a "next
  unlock" hint tag if a tier is still season-gated; a contracted vendor
  shows its contract label and either a running-commitment warning tag
  (with days left) or a plain hint tag once free, and a Let go button.
  `renderOffice`'s ledger total now sums vendor cost via
  `effectiveVendorCost` instead of the flat listed cost. The Vendors &
  Stalls section hint now mentions the shared contract options.
- **`js/main.js`** — `hireVendor` action now passes
  `el.dataset.contract || 'open'` through to `State.hireVendor` (same
  pattern as the existing `contract` action for performers). `fireVendor`
  now flashes a cancellation-fee message when `res.fee > 0`, mirroring the
  `release` action.
- **`tests/smoke.mjs`** — 259 checks now (was 231): a full open→signed
  weekend-package→early-release→fee-charged cycle for vendors (mirroring
  the performer version line for line), a nextDay tick-down test
  confirming a vendor is never auto-removed once its commitment lapses, a
  `simulateDay` test confirming vendor wages reflect the contracted rate,
  a season-gating test refusing a vendor Season Contract before Weekend 3
  and succeeding once the existing Weekend-3 walk-forward test reaches it,
  and a DOM-level test that builds a food plot, clicks an actual Weekend
  Package hire button in Backstage, confirms the contract label renders,
  clicks Let Go, and confirms the cancellation-fee flash appears.

## What the next stage needs

Read `js/engine.js`'s `effectiveVendorCost` and `js/state.js`'s
`hireVendor`/`fireVendor` first — they're the whole feature, built by
copying the already-proven `effectivePerformerCost` /
`contractPerformer`/`releasePerformer` pattern from Stage 5 with `vendor`
substituted for `performer` almost everywhere. `ui.js`'s vendor rows in
`renderBackstage` show how the display side mirrors the performer rows.

**Next logical chunks, roughly in the order I'd tackle them:**

1. **Grounds expansion as a season unlock.** Still open from Stage 6's
   backlog — the season-unlock plumbing (`isSeasonUnlocked`, locked-card UI
   pattern) is generic and now proven twice over (campaigns, and both
   performer and vendor contracts), but `GRID`/`terrainAt`/`quoteBuild` are
   still pure `(x,y) => value` functions with no `state` parameter, so
   gating grid size behind a season would mean threading `state` through
   them and their `ui.js` call sites — a bigger, different-shaped change,
   still worth doing on its own.
2. **More stalls/performers, backstage drama events.** Content pools are
   still small (10/8/6/4 campaigns/3 contract tiers) — low-risk filler
   whenever a stage needs a smaller task.
3. **Build-time legality rules.** Right now any kind can be built on any
   terrain (deliberately relaxed since Stage 3 — see that stage's retro).
4. **Crowd flow / bottlenecks as their own system.** Real positions and
   free placement both exist to build this on. Still substantial work.
5. **A cap or cost curve on total structures.** Nothing currently stops a
   player from tiling the entire 70-cell grid if they have the cash.
6. **A hard end to the game / a win condition.** `season` still increments
   forever with no ceiling — there's no "campaign complete" state, just an
   ever-growing weekend counter. Worth deciding whether that's the design
   (an endless-weekends sim) or whether a fixed number of weekends with a
   final scorecard is wanted.

**Things intentionally deferred (kickoff doc explicitly allows this):**
weather, rival faires, animal handling beyond the falconer performer role,
deep reputation splits (currently one scalar 0–100), true contract-price
*negotiation* (still open since Stage 5 — what exists is a fixed choice
between published deals, not haggling, and that's true for vendors now
too). Also still deferred: grounds expansion as a season unlock (see
next-chunk #1) and any kind of end-of-game / win-condition state.

## Retro

**Went well:**
- Copying the Stage 5 performer-contract pattern for vendors almost
  mechanically — same field names (`contractId`/`dailyCost`/
  `commitDaysRemaining`), same function shapes
  (`effectiveXCost`/`XContract-or-hireX`/`releaseX-or-fireX`), same
  `isSeasonUnlocked` gating call — meant there was no new design to do,
  just a faithful port. The two systems now sharing one `CONTRACT_OPTIONS`
  catalog (rather than a duplicated vendor-only copy) also means a future
  balance change or new tier only needs to happen once.
- Applying the "deep-copy every new state field in `clone()`" lesson from
  Stage 4's cash bug before writing a single test this time — added
  `vendorContracts` to `clone()` in the same edit that added it to
  `createInitialState()`, rather than as an afterthought once a test caught
  a shared-reference bug.
- Writing the vendor tests as close mirrors of the existing performer
  tests (same structure, same assertions, `vendor`/`vend_cider` swapped in
  for `performer`/`perf_jouster_1`) made it fast to confirm nothing about
  the vendor path diverges from the already-trusted performer path, and
  made any accidental divergence easy to spot by diffing the two test
  blocks.

**Dead end / thing to know about before you repeat it:**
- None this stage — this was the cleanest port of the six so far, likely
  because Stage 5 had already done the hard design thinking (contract
  shapes, fee math, the "never auto-remove on lapse" rule) and this stage
  only had to apply it to a second entity type.

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
