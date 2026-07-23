# HANDOFF — Faire Weekend

Living document, updated in place each stage. Older stage summaries get
condensed into the changelog at the bottom rather than kept as prose above.

## Status as of Stage 9

**Playable end-to-end.** Everything from Stages 1–8 still works. New this
stage: content-pool filler (5 more performers, 4 more vendors) plus a new
category of "backstage drama" random events gated on roster composition,
and the first quirk (`night_owl`) whose effect actually depends on which
time block a performer is playing.

## What was built this stage

- **`js/data.js`** — `PERFORMERS` grew from 10 to 15 (a third musician and
  magician, another jester, a second falconer, a third living-history
  camp — two of the new five carry the new `night_owl` quirk).
  `VENDORS` grew from 8 to 12 (two more food carts, two more craft
  stalls). `EVENT_POOL` gained four new "backstage drama" entries
  (`evt_diva_standoff`, `evt_musicians_jam`, `evt_falconer_show`,
  `evt_gossip_wagon`), each gated by a `requires` string keyed to roster
  composition rather than a single quirk/vendor flag.
- **`js/engine.js`** — added `QUIRKS.night_owl` (+20% draw in Golden Hour,
  −10% in Morning Procession, no change midday/afternoon — the first
  quirk whose effect varies by block). Pulled `effectivePopularity`
  out of `simulateDay`'s old private nested closure into a proper
  module-level exported function, since it needed to become independently
  testable once its behavior started depending on the `blockId` argument
  it always accepted but never used. `simulateDay`'s event `ctx` gained
  four new flags (`hasMultiplePrimaDonnas`, `hasTwoMusicians`,
  `hasFalconerScheduled`, `bigRoster`) computed from the roster/schedule,
  feeding the new events. `rollEvents`' old requires-check was an if/else
  chain that silently defaulted to "always eligible" for any unrecognized
  `requires` string — harmless while only two ever existed, but a real
  landmine for a fourth stage of new events. Replaced it with an exported
  `EVENT_REQUIREMENTS` lookup map (`requires` string → predicate function)
  that fails closed (ineligible) on an unrecognized key instead, and added
  the four new predicates plus the two pre-existing ones to it. Four new
  `EVENT_EFFECTS` entries for the new events.
- **`js/ui.js`** — `quirkTitle`/`quirkDesc` (the Backstage roster's
  quirk-tag tooltip) gained a `night_owl` entry. No other UI changes —
  new performers/vendors render through the exact same table rows the
  original ten/eight already did, and new events flow through the exact
  same report log line every other event already used.
- **`js/main.js`** — untouched. Nothing about this stage needed a new
  action or a new UI affordance.
- **`tests/smoke.mjs`** — 342 checks now (was 282): a dedicated
  `effectivePopularity` unit-test block covering crowd_pleaser (block-
  independent) and night_owl (golden/morning/midday/afternoon/no-block-
  context) directly against the pure function; a `simulateDay`-level
  integration test confirming the *same* night_owl performer scheduled
  into Golden Hour yields better average satisfaction than the same
  performer scheduled into Morning Procession, averaged over 30 seeds to
  smooth jitter (same pattern as the existing ticket-price/attendance
  tests); an `EVENT_POOL`/`EVENT_REQUIREMENTS`/`EVENT_EFFECTS` integrity
  block confirming every `requires` string used actually has a matching
  predicate, every predicate is false against an all-false ctx and true
  once its own flag is set, every `effectId` has a matching effect
  function, and that the four new effects produce well-shaped
  cash/rep/satisfaction deltas with the expected sign (diva_standoff net-
  negative, musicians_jam net-positive).

## What the next stage needs

Read `js/engine.js`'s `EVENT_REQUIREMENTS`/`EVENT_EFFECTS` and
`effectivePopularity` first — that's the whole feature.
`js/data.js`'s `EVENT_POOL` shows how a new event's `requires` string
wires up (it must have a matching `EVENT_REQUIREMENTS` entry, checked by
smoke.mjs, or it's dead-on-arrival ineligible by design).

**Next logical chunks, roughly in the order I'd tackle them:**

1. **Build-time legality rules.** Right now any kind can be built on any
   terrain (deliberately relaxed since Stage 3 — see that stage's retro).
   Worth deciding whether this is still the right call now that the
   grounds have grown to up to 140 cells (Stage 8) — more room may mean
   less need to relax the rule for space reasons.
2. **Crowd flow / bottlenecks as their own system.** Real positions and
   free placement both exist to build this on. Still substantial work.
3. **A cap or cost curve on total structures.** Nothing currently stops a
   player from tiling the entire currently-unlocked grid if they have the
   cash — up to 140 cells at full expansion.
4. **A hard end to the game / a win condition.** `season` still increments
   forever with no ceiling, and grounds expansion also caps out at
   Weekend 4 with nothing new to reach after. Worth deciding whether
   that's the design (an endless-weekends sim) or whether a fixed number
   of weekends with a final scorecard is wanted.
5. **More content-pool filler**, if a future stage needs a smaller task:
   PERFORMERS/VENDORS/EVENT_POOL can all keep growing following this
   stage's pattern (new roster entries + new roster-composition-gated
   events via `EVENT_REQUIREMENTS`).

**Things intentionally deferred (kickoff doc explicitly allows this):**
weather, rival faires, animal handling beyond the falconer performer role,
deep reputation splits (currently one scalar 0–100), true contract-price
*negotiation* (what exists is a fixed choice between published deals, not
haggling, for both performers and vendors), and any kind of end-of-game /
win-condition state.

## Retro

**Went well:**
- Pulling `effectivePopularity` out of `simulateDay`'s private closure
  into a proper exported function paid for itself immediately — it made
  `night_owl` directly unit-testable with plain objects (no state/schedule
  scaffolding needed) rather than only observable indirectly through a
  full `simulateDay` run. Worth remembering for future quirks: if a
  quirk's effect depends on anything beyond "is this performer playing at
  all," the function computing it probably needs to not be a private
  nested closure.
- Fixing `rollEvents`' silent "unrecognized requires → always eligible"
  fallback while adding new requires strings, rather than leaving it and
  hoping none of the four new ones would ever typo-collide with nothing.
  It was free to fix (a lookup map isn't more code than an if/else chain)
  and turns a whole class of future typo into a loud, test-caught failure
  instead of a silent one.
- Choosing roster-*composition* gates (two prima donnas, two scheduled
  musicians, a scheduled falconer, a big roster) rather than single-quirk
  gates for the new events kept them feeling like "backstage drama"
  (things that emerge from who you've hired and scheduled together)
  rather than just more copies of the existing single-flag pattern
  (`hasChaosProne`/`hasVendor`).

**Dead end / thing to know about before you repeat it:**
- None this stage.

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
