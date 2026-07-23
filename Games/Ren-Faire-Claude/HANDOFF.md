# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 5

**Playable end-to-end, now with real contract choices.** Everything from
Stages 1–4 still works (marketing campaigns, free-form build placement,
hire vendors, schedule four time blocks, set ticket price, open the gates,
read the report, advance the day with progress carried forward). New this
stage: contracting a performer in Backstage now means picking between a
**Day Rate** (the old behavior — listed cost, no commitment, release
anytime free) and a **Weekend Package** (15% off the daily rate, but a
3-day commitment; breaking it early costs a real cancellation fee).

## What was built this stage

- **`js/data.js`** — added `CONTRACT_OPTIONS`: `open` (day rate — `priceMult:
  1.0`, `commitDays: 0`, `cancelFeeMult: 0`, i.e. exactly the old behavior)
  and `weekend` (`priceMult: 0.85`, `commitDays: 3`, `cancelFeeMult: 0.5`).
  Everything else in `data.js` untouched.
- **`js/engine.js`** — added `effectivePerformerCost(state, performerId)`:
  looks up the performer's actual contracted daily rate from
  `state.contracts`, falling back to the listed cost if no contract record
  exists. `simulateDay`'s `performerCosts` total now calls this instead of
  reading `p.cost` directly, so a Weekend Package's discount actually shows
  up in the day's wage bill.
- **`js/state.js`** — added `contracts: {}` to initial state (keyed by
  performer id: `{ contractId, dailyCost, commitDaysRemaining }`), and made
  `clone()` deep-copy it the same way `activeCampaign`/`campaignCooldowns`
  were deep-copied in Stage 4 (this account has now hit this exact
  "shallow-copy nested object → cross-state mutation" bug twice — see
  retro). `contractPerformer(state, performerId, contractId = 'open')`
  gained the `contractId` parameter (defaulting to `'open'` so every
  existing 2-arg call site keeps its old behavior untouched); it now
  refuses an unrecognized contract type and records the daily rate +
  commitment length under `state.contracts[performerId]`.
  `releasePerformer` now checks that record: if `commitDaysRemaining > 0`,
  it charges `dailyCost × commitDaysRemaining × cancelFeeMult` against
  cash and returns it as `fee` (0 when nothing's owed) so the UI can flash
  the amount. `nextDay` ticks every contract's `commitDaysRemaining` down
  by one (floored at 0) — this only shortens how much longer breaking the
  deal would cost a fee; it deliberately does NOT remove the performer
  from the roster once the commitment ends, keeping the "roster persists
  day to day" rule from Stage 1 intact. Once `commitDaysRemaining` hits 0
  the discounted rate keeps applying (a Weekend Package doesn't revert to
  the listed price) — only the cancellation-fee protection lapses.
- **`js/ui.js`** — `renderBackstage`'s performer rows now show either two
  contract-type buttons (Day Rate / Weekend Package, the latter labeled
  with its discounted $/day) when uncontracted, or a status tag ("Weekend
  Package — N days left" while committed, plain "Weekend Package" once the
  commitment has lapsed) plus Release when contracted. The Cost column
  shows the actual contracted rate once signed. Added a one-line hint under
  the Tiring House heading explaining the tradeoff. `renderOffice`'s roster
  total now sums `effectivePerformerCost` per roster id instead of reading
  `p.cost` directly, so the Ledger Desk matches what `simulateDay` actually
  charges.
- **`js/main.js`** — the `contract` action now passes
  `el.dataset.contract || 'open'` through to `State.contractPerformer`.
  The `release` action now flashes a cancellation-fee message
  ("Broke the Weekend Package early — $N cancellation fee.") whenever
  `res.fee > 0`. No changes to `wire()` or the delegation pattern.
- **`tests/smoke.mjs`** — 177 checks now (was 151): a `CONTRACT_OPTIONS`
  catalog-integrity section, and five new behavior sections covering the
  open-contract default (unchanged cost/free release), Weekend Package
  signing (discounted rate, commitment length, exact cancellation-fee
  math, unknown-contract-type rejection), a full `nextDay` tick-down cycle
  proving the performer stays on the roster after the commitment ends and
  that releasing them afterward is free again, and a `simulateDay` check
  that wages reflect the contracted rate rather than the listed cost.

## What the next stage needs

Read `js/data.js`'s `CONTRACT_OPTIONS` block and `engine.js`'s
`effectivePerformerCost` first — together they're the entire "what does
signing X contract actually cost, day to day" answer. Then skim
`state.js`'s `contractPerformer`/`releasePerformer`/the contract-ticking
block inside `nextDay` for how the commitment lifecycle is enforced, and
`ui.js`'s `renderBackstage` for how it's drawn.

**Next logical chunks, roughly in the order I'd tackle them:**

1. **Season/progression structure.** `weekendDay` still just cycles
   1→2→3 as a label with no hard stop, no unlocks, no "weekend complete"
   beat. Three natural levers now exist to gate behind progression: bigger
   grounds (Stage 3's free placement), a fourth marketing campaign tier
   (Stage 4), and maybe a third, longer/cheaper contract tier (Stage 5,
   e.g. a "Season Contract" for a returning favorite performer).
2. **Vendor contract depth, mirroring performers.** Vendors are still a
   flat hire/fire with no discount-for-commitment option. If Weekend
   Package contracts feel good in playtesting, the exact same
   `CONTRACT_OPTIONS` pattern (cost/commitDays/cancelFeeMult) could extend
   to `hireVendor`/`fireVendor` with minimal new code — the hard part
   (deep-clone discipline, commitment ticking, fee-on-early-release) is
   already solved once.
3. **More stalls/performers, backstage drama events.** Content pools are
   still small (10/8/6/3) — low-risk filler whenever a stage needs a
   smaller task.
4. **Build-time legality rules.** Right now any kind can be built on any
   terrain (deliberately relaxed since Stage 3 — see that stage's retro).
5. **Crowd flow / bottlenecks as their own system.** Real positions and
   free placement both exist to build this on. Still substantial work.
6. **A cap or cost curve on total structures.** Nothing currently stops a
   player from tiling the entire 70-cell grid if they have the cash.
7. **Campaign variety beyond a flat attendance multiplier** (carried over
   from Stage 4 — still open).

**Things intentionally deferred (kickoff doc explicitly allows this):**
weather, rival faires, animal handling beyond the falconer performer role,
deep reputation splits (currently one scalar 0–100). Also deferred this
stage specifically: true price *negotiation* (counter-offers the player
can accept/reject) — what shipped is a fixed choice between two published
deals rather than back-and-forth haggling. If a future stage wants real
counter-offers, the natural hook is `contractPerformer` returning a quoted
price the player can accept or decline before the deal is struck, rather
than the deal applying immediately on click as it does now.

## Retro

**Went well:**
- Defaulting `contractPerformer`'s new `contractId` parameter to `'open'`
  meant every existing call site and every existing test kept working
  completely untouched — this is the second stage in a row (after Stage
  4's non-breaking additions) where a new system slotted in without
  touching a single line of prior behavior for the default case.
- Deciding NOT to auto-remove a performer from the roster when their
  Weekend Package's commitment ends (only the cancellation-fee protection
  lapses) kept faith with the "roster persists day to day" rule this
  project has held since Stage 1, rather than quietly introducing a new
  kind of surprise expiration alongside campaigns' genuinely-expiring
  timers. Two different timer *shapes* (campaigns: hard expiry;
  contracts: soft commitment lapse) living side by side on purpose, not
  by accident.
- Writing the "sign → tick down 3 days → commitment ends → release is free
  again" test as one continuous sequence (rather than testing each
  transition in isolation) is exactly what caught the Stage 4 clone bug
  before it could recur here — cheap insurance now that the pattern's
  been seen once.

**Dead end / thing to know about before you repeat it:**
- Went to write `clone()`'s `contracts` deep-copy and, out of habit,
  almost left it as a shallow `{ ...state.contracts }` — which would
  *look* fine (a fresh top-level object) but still share the same nested
  per-performer objects, reproducing Stage 4's exact `activeCampaign`
  mutation bug on a new field. Caught it before writing the bug this time
  by explicitly checking: does `nextDay` mutate anything living inside
  this field in place? Yes (`commitDaysRemaining -= 1`) → the field needs
  a *per-entry* deep copy (`Object.fromEntries(Object.entries(...).map(([k,
  v]) => [k, { ...v }]))`), not just a copied outer container. Any future
  state field that nextDay (or any action) mutates in place needs this
  same check before its first line of clone() code gets written, not
  after a test catches it.
- Rounding the Weekend Package's `dailyCost` with plain `Math.round(cost *
  0.85)` (no nearest-$5/$10 rounding, unlike `quoteBuild`'s build costs)
  was a deliberate choice, not an oversight — performer costs have never
  been round numbers to begin with (e.g. $260, $190), so forcing a round
  discount rate would have been inconsistent with the existing data.
  Don't "fix" this to match `quoteBuild`'s rounding style without checking
  whether `PERFORMERS.*.cost` itself gets rounded first.

## Changelog## Changelog

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
