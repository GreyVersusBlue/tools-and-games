# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 6

**Playable end-to-end, now with a real weekend/season structure.**
Everything from Stages 1–5 still works. New this stage: a weekend is a
hard 3-day arc (Fri/Sat/Sun) that ends in a **weekend-end summary screen**
instead of silently rolling into the next weekend, and reaching later
weekends **unlocks new content**: the Kingdom Proclamation ad campaign
(Weekend 2+) and the Season Contract performer-contract tier (Weekend 3+).

## What was built this stage

- **`js/data.js`** — added `CONFIG.seasonLength = 3` (days per weekend).
  Every `AD_CAMPAIGNS` entry and `CONTRACT_OPTIONS` entry gained an
  `unlockSeason` field (existing three campaigns and two contract types all
  `unlockSeason: 1`, i.e. available from the start — fully backward
  compatible). Added one new campaign, `ad_proclamation` ("Kingdom
  Proclamation", `unlockSeason: 2`, the biggest attendance boost yet), and
  one new contract type, `season` ("Season Contract", `unlockSeason: 3`,
  deeper discount and longer commitment than the Weekend Package —
  `priceMult: 0.72`, `commitDays: 6`, `cancelFeeMult: 0.6`).
- **`js/engine.js`** — added `isSeasonUnlocked(state, unlockSeason)` (a
  missing/undefined `unlockSeason` defaults to 1, so nothing needed
  retrofitting) and `summarizeWeekend(history, count)`, a pure aggregator
  that takes the trailing `count` entries of `state.history` and returns
  total attendance, total net cash, average satisfaction, summed
  reputation delta, and the best/worst day by `cashDelta` — this is the
  entire weekend-summary screen's data.
- **`js/state.js`** — added `season: 1` to initial state. Reworked
  `nextDay`: it still ticks contracts/campaigns exactly once per call (same
  logic as Stage 4/5, unchanged), but if the day that just elapsed was the
  weekend's last day (`weekendDay >= CONFIG.seasonLength`), it stops there
  and sets `phase = 'weekendEnd'` instead of advancing
  `day`/`weekendDay`/`season` — those three only move once the player calls
  the new `startNextWeekend(state)` action, which does no ticking of its
  own (that already happened in the `nextDay` call that produced
  `weekendEnd`) and just rolls `day += 1, weekendDay = 1, season += 1,
  phase = 'plan'`. `contractPerformer` and `launchCampaign` both gained an
  `isSeasonUnlocked` check up front, refusing with "X unlocks in Weekend
  N" if the season requirement isn't met yet. `loadState` migrates old
  saves missing `season` to `season: 1`.
- **`js/ui.js`** — new `renderWeekendEnd(state, summary)`: a ticket-stub
  styled screen (reusing the report screen's visual language) showing
  total attendance, average crowd mood, a per-day attendance/net line for
  each of the weekend's days, the weekend's total net and reputation
  change, an unlock notice if anything new unlocks next weekend, and a
  "Begin Weekend N+1" button. `renderMarketing` now shows a locked,
  dashed-border card ("Unlocks in Weekend N") for any campaign not yet
  reachable instead of a normal Launch card. `renderBackstage`'s
  uncontracted-performer row now filters contract-type buttons down to
  unlocked ones only, with a small hint tag naming the next one to unlock.
  `renderLedger` now shows "Weekend N" as the headline instead of a bare
  day count (day count moved to the subline).
- **`js/main.js`** — `render()` gained a branch for `phase === 'weekendEnd'`
  (tabs cleared, `UI.renderWeekendEnd` shown, computing the summary via
  `summarizeWeekend(state.history, CONFIG.seasonLength)`), and
  `handleAction` gained a `startNextWeekend` case. No changes to `wire()`
  or the delegation pattern.
- **`css/style.css`** — `.campaign-card.locked` (dashed border, dimmed) and
  `.unlock-note` (gold, centered); the weekend-summary screen otherwise
  reuses `.ticket-stub`'s existing styling with no new rules needed.
- **`tests/smoke.mjs`** — 231 checks now (was 177): catalog-integrity
  checks for the new `unlockSeason` fields, unit tests for
  `isSeasonUnlocked` and `summarizeWeekend`, a full nextDay hard-stop →
  `weekendEnd` → `startNextWeekend` cycle test, season-gating tests for
  both the new campaign and the new contract type (refused too early,
  succeeds once the weekend threshold is walked forward to), an update to
  the 50-day fuzz loop so it calls `startNextWeekend` whenever it lands on
  `weekendEnd` (otherwise the day counter would stall at the first weekend
  boundary), and a DOM-level walkthrough of a full 3-day weekend via the
  actual Open the Gates / Next Day buttons ending at the weekend-summary
  screen and rolling into Weekend 2.

## What the next stage needs

Read `js/data.js`'s `CONFIG.seasonLength` and the `unlockSeason` fields on
`AD_CAMPAIGNS`/`CONTRACT_OPTIONS` first, then `engine.js`'s
`isSeasonUnlocked`/`summarizeWeekend`, then `state.js`'s `nextDay` /
`startNextWeekend` split — that's the entire weekend-boundary mechanism.
`ui.js`'s `renderWeekendEnd` and the `weekendEnd`-phase branch in
`main.js`'s `render()` show how it's drawn.

**Next logical chunks, roughly in the order I'd tackle them:**

1. **Vendor contract depth, mirroring performers.** Still open from Stage
   5's backlog — vendors are still a flat hire/fire. The `CONTRACT_OPTIONS`
   pattern (and now the `unlockSeason` gating pattern too) could extend to
   `hireVendor`/`fireVendor` with the hard parts already solved twice over.
2. **Grounds expansion as a season unlock.** The season-unlock plumbing
   built this stage (`isSeasonUnlocked`, locked-card UI pattern) is
   generic — a natural next use is unlocking more of the 10×7 grid (or a
   larger grid entirely) at a later weekend, rather than gating only
   campaigns/contracts. This would need `GRID`/`terrainAt`/`quoteBuild` to
   become season-aware (currently pure functions of `(x,y)` only, no
   `state` parameter) — a bigger change than this stage's additive one,
   flagged here rather than attempted alongside it.
3. **More stalls/performers, backstage drama events.** Content pools are
   still small (10/8/6/4 campaigns/3 contract tiers) — low-risk filler
   whenever a stage needs a smaller task.
4. **Build-time legality rules.** Right now any kind can be built on any
   terrain (deliberately relaxed since Stage 3 — see that stage's retro).
5. **Crowd flow / bottlenecks as their own system.** Real positions and
   free placement both exist to build this on. Still substantial work.
6. **A cap or cost curve on total structures.** Nothing currently stops a
   player from tiling the entire 70-cell grid if they have the cash.
7. **A hard end to the game / a win condition.** `season` now increments
   forever with no ceiling — there's no "campaign complete" state, just an
   ever-growing weekend counter. Worth deciding whether that's the design
   (an endless-weekends sim) or whether a fixed number of weekends with a
   final scorecard is wanted.

**Things intentionally deferred (kickoff doc explicitly allows this):**
weather, rival faires, animal handling beyond the falconer performer role,
deep reputation splits (currently one scalar 0–100), true contract-price
*negotiation* (Stage 5's deferral, still open). Also deferred this stage
specifically: grounds expansion as a season unlock (see next-chunk #2
above — the unlock plumbing is ready, but making the grid itself
season-aware is a separate, larger change) and any kind of end-of-game /
win-condition state.

## Retro

**Went well:**
- Splitting `nextDay` (ticks once per elapsed day, stops at `weekendEnd`)
  from a new `startNextWeekend` (rolls the counters over, no ticking)
  meant the tick-once-per-day invariant from Stage 4/5 needed zero changes
  — it was tempting to fold the season rollover into `nextDay` itself with
  an `if (weekendDay > seasonLength)` branch that both ticks *and* rolls
  over in one call, but that would have made "how many times has a
  commitment/cooldown ticked" depend on which branch fired, which is
  exactly the kind of subtle asymmetry Stage 4's clone bug punished once
  already. Two small functions with one clear job each avoided it.
- Giving `AD_CAMPAIGNS`/`CONTRACT_OPTIONS` entries an `unlockSeason` field
  that defaults to 1 when absent (via `isSeasonUnlocked`'s `|| 1` fallback)
  meant zero migration was needed for the five pre-existing entries — same
  "new field defaults to old behavior" pattern that made Stage 5's
  `contractId` parameter and Stage 4's additive fields land cleanly.
- Writing the season-gating test as "refused before the threshold, then
  walk the state forward with real `nextDay`/`startNextWeekend` calls and
  confirm it succeeds after" (rather than just constructing a state object
  with `season: 3` by hand) exercises the actual rollover path the player
  will walk through, not just the gate check in isolation.

**Dead end / thing to know about before you repeat it:**
- First pass at the fuzz-run update only added `startNextWeekend` handling
  inside the loop's success path without checking `s.phase` on literally
  every iteration — the loop has no concept of which iteration number
  corresponds to a weekend boundary, it just asks `nextDay` what phase came
  back and reacts to that. Simpler once written as "if weekendEnd,
  immediately also call startNextWeekend" every single iteration, rather
  than trying to precompute which iterations would need it.
- Held off on making `GRID`/`terrainAt`/`quoteBuild` season-aware (to gate
  grounds expansion behind a season unlock) once it became clear that
  would mean threading `state` through several currently-pure
  `(x, y) => value` functions that `ui.js` calls in tight loops while
  rendering the grid — a real change, but a different-shaped one than this
  stage's additive unlocks, and better done on its own. See next-chunk #2.

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
