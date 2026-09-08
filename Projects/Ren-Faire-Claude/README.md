# Faire Weekend

A browser-based renaissance faire management sim, modeled loosely on the
Maryland Renaissance Festival. Run the office, contract performers and
vendors backstage, build out the grounds, schedule the day, open the gates,
and see how you did.

No build step. Static files only — open `index.html` directly or serve the
folder (e.g. `npx serve .`) and it runs. Hosted the same way as this
account's other GitHub Pages projects.

## Files

- `index.html` — app shell + font links. As of Stage 19 the shell is a real
  layout rather than a single column: a sticky `#hud` (wordmark + `#ledger`)
  above a `#board` that holds a **permanently visible `#grounds` section**
  (the site plan) beside `#desk` (`#tabs` + `#content`). Report, weekend-end,
  victory, and game-over phases hide the map and take the whole board via
  `#board.is-fullwidth`.
- `css/style.css` — all styling. Rewritten in Stage 19 around a dark
  "operations room" direction (bark/vellum/brass/wine/moss tokens) replacing
  the Stage 1–18 parchment system. The signature element is the grounds map
  rendered as a surveyor's plat — double-ruled sheet, title cartouche, inline
  SVG compass rose, and per-terrain CSS textures (stippled canopy for woods,
  contour lines for hills, cart-rut grain for the path) — with structures as
  raised tokens rather than flat glyphs. Type is Grenze Gotisch (display) /
  Fraunces (prose) / Barlow Semi Condensed (all UI and every number, tabular
  figures). Responsive at 1080px and 720px; `prefers-reduced-motion` honoured.
  As of Stage 20, `--vellum-faint` and a new `--wine-text` token were
  lightened to clear WCAG AA contrast (4.5:1) against the dark panel
  backgrounds they're used as small text on — both measured under 3.1:1
  before the fix. See `HISTORY.md`, Faire Weekend stage 19, for the full audit.
- `js/data.js` — content: the grounds grid/terrain legend (authored at its full extent, 14×12 as of Phase 4, now threaded by a real path network — the row-2 artery plus a col-3 spur and, as of Stage 12, a second col-10 spur with an eastward connector so the grounds-expansion territory has path frontage), an `ENTRANCE` constant (Stage 17 — the front gate the path-distance BFS walks out from), a `GRID_EXPANSIONS` unlock schedule for how much of that grid is actually buildable at a given weekend, buildable structure types (stage/food/vendor/demo) with terrain cost/capacity modifiers and, as of Stage 12, a `footprint` (stage is 2×2; everything else defaults to 1×1), a `PLACEMENT_RULES` table (terrain bans — including, as of Stage 18, food/craft stalls banned from hill terrain — minimum stage-to-stage spacing, `requiresPathFrontage` (Stage 12), and, as of Stage 18, same-kind stall-to-stall spacing (`stallSpacingKinds`/`minStallSpacing`) and a per-kind build cap (`maxBuiltByKind`, currently just demo camps at 3)), performers (16: 15 as of Stage 9, and Phase 4's headliner who carries `unlockRenown`), vendors (12, as of Stage 9), ad/marketing campaigns, one shared contract-type catalog (Day Rate/Weekend Package/Season Contract) used by both performers and, as of Stage 7, vendors, and the random event pool (including Stage 9's roster-composition-gated "backstage drama" events) — each campaign, contract, and grounds-expansion tier tagged with the weekend (`unlockSeason`) it becomes available, **As of Stage 19**: `TIME_BLOCKS` entries carry a `heat` value (how much sun As of Phase 3, also `RELATIONSHIP` (the per-act relationship deltas and tiers), `NEGOTIATION` (the commitment and fee lists every offer is priced off) and `ARCS` (eight acts, a beat at each edge, a choice a set of numbers). As of Phase 4, `RENOWN` (what the second track pays for), `CARRYOVER` (its schema number and what crosses a closed season), a fourth `GRID_EXPANSIONS` tier gated on `unlockRenown` as well as its weekend, and two South Meadow rows on the grid.
  is on the crowd, 0–1) which weights how much a stage's shade counts toward
  crowd quality that block; a new `GROUNDS_DRAW` table (per-kind draw points,
  floor, coefficient, ceiling) drives how much of a crowd the built grounds
  pull on their own; and `CONFIG` gained `perGuestCost` plus the ticket-price
  elasticity/satisfaction knobs (`priceAnchor`, `priceElasticityDivisor`,
  `priceFactorFloor`/`Ceiling`, `priceSatisfactionPenaltyPerDollar`,
  `priceSatisfactionBonusPerDollar`). Stage 19 also rescaled most authored
  money — `baseOverhead`, `upkeepRate`, `wristbandCut`, `startingCash`,
  `bankruptcyFloor`, `winCondition.minCash`, every structure base cost,
  `stage.baseCapacity`, and every performer/vendor/campaign rate — see
  `HISTORY.md` for the measurements that prompted it. Also config (including
  `seasonLength`, days per weekend, and, as of Stage 10, `demolishFeeMult`/`relocateDiscountMult`/`maxPlotNameLength`, as of Stage 15, `escalatingBuildCostRate` for the same-kind escalating build-cost curve, and, as of Stage 16, `bankruptcyFloor` and `winCondition` — the loss/win thresholds). As of Stage 22, a new `WEEKEND_DAY_ATTENDANCE` table keyed by `weekendDay` (Friday 0.85x, Saturday 1.2x, Sunday 0.95x) gives the three days of a weekend a real shape instead of being mechanically identical. As of Phase 2, a `WEATHER` table — seven skies, each with a `heatMult` scaling every block's authored sun, an `attendanceMult`, a `satisfactionDelta`, and `early`/`late` draw weights that ramp across `WEATHER_SEASON_SPAN` weekends so the late season is the cool wet one — plus `WEATHER_SHADE_CEILING` (the bound on the shade weight, not on the heat) and `DEFAULT_WEATHER_ID` (`fair`, the neutral row everything unstamped falls back to). No logic.
- `js/engine.js` — pure simulation math (RNG, scheduling validation, terrain/adjacency lookup, build-cost quoting, campaign lookup, contract-aware performer AND vendor cost, season-unlock checks, the currently-unlocked grounds size and next expansion (Stage 8), quirk-aware performer popularity including the block-conditional `night_owl` quirk (Stage 9), the `EVENT_REQUIREMENTS` gating map for random events, weekend-summary aggregation, day simulation, `stallSummary`/`STALL_KIND_BY_VENDOR_TYPE` for the per-kind stall vacancy tracker (Stage 10), `isLegalPlacement` — the terrain-ban/stage-spacing/path-frontage check sitting alongside `quoteBuild` as the other half of "can this be built here" (as of Stage 18, also a same-kind stall-spacing check and a per-kind build-count cap, and the terrain-ban refusal message is now built dynamically from whatever terrain is actually still allowed rather than a hardcoded suggestion), the footprint primitives everything above runs on (`footprintFor`/`footprintCells`/`plotFootprintCells`/`isFootprintWithinCurrentGrid` and `hasPathFrontage`, Stage 12), per-plot daily upkeep (`plotUpkeep`/`totalUpkeep`, Stage 13), and, as of Stage 14, `computeFootTraffic` — turns each built food/vendor stall's terrain+adjacency `traffic` attribute into a per-stall sales multiplier relative to the day's average stall, wired into `simulateDay`'s vendor-revenue calc so placement (path frontage, proximity to a stage or a now-functional demo camp) has a real economic payoff, not just a cosmetic stat), and, as of Stage 15, `countBuiltOfKind` plus a `quoteBuild(kind, x, y, builtPlots, excludeId)` that compounds a same-kind structure's price by `CONFIG.escalatingBuildCostRate` per already-*built* one of that kind, and `previewCommitAll` — prices a whole batch of planning plots being committed together in order, so a same-kind cluster committed at once escalates against itself exactly like committing one at a time would, and, as of Stage 16, `checkBankruptcy(cash)` and `checkWinCondition(state)` — the two pure predicates the loss/win phases in state.js are built on), and, as of Stage 17, `computePathDistances()` (a memoized BFS along path tiles from `ENTRANCE`), `reachabilityDistance(plot)`, and `computeReachability(builtPlots)` — a gate-distance sales/draw multiplier (0.8×-1.2×, grouped separately for stages vs. stalls) wired into both `simulateDay`'s vendor-revenue calc and its per-block stage draw-weight, layered on top of Stage 14's foot-traffic multiplier rather than replacing
  it. And, as of Stage 19, `computeGroundsDraw(builtPlots)` — the term that
  finally makes the built grounds an input to *attendance itself* rather than
  only to how a fixed crowd gets divided up (built stages, staffed stalls,
  and demo camps produce draw points with square-root diminishing returns);
  `priceFactor`/`ticketRevenueIndex`/`priceSatisfactionDelta` — the ticket
  elasticity curve (now peaking mid-slider rather than at the maximum price)
  and the crowd's reaction to being charged; and `blockQualityWeights(block)`
  — per-block sightline/shade/popularity weights, where shade's weight scales
  with the block's `heat` and the slack rolls into sightline, so a hilltop
  stage is superb in cool blocks and punishing at Afternoon while a shaded
  grove is the reverse. As of Stage 22, `simulateDay`'s attendance formula
  gained one more term reading `WEEKEND_DAY_ATTENDANCE[state.weekendDay]`
  (falling back to a neutral 1x for a state that never set `weekendDay`). As
  of Phase 2, `blockQualityWeights(block, weather)` takes the day's sky as
  well as the block, and the weather quintet lives here:
  `weatherById`/`weatherFor` (lookup with a neutral fallback),
  `weatherWeightAt` (the early→late season ramp), `rollWeather(weatherSeed,
  season, weekendDay)` (pure — the same three arguments always answer the same
  sky), `nextCalendarDay` (the one model of the shape `nextDay` and
  `startNextWeekend` walk), and `forecastWeather` (tomorrow's, exactly).
  `simulateDay` reads `state.weather` rather than rolling it, so it takes no
  new draw from the day's own rng and every seed still rolls the events it
  rolled before the phase. No DOM.
- `js/state.js` — the game-state object and the actions that change it (immutable-style: every action returns a new state). As of Stage 22, persistence goes through the shared `assets/js/gvb-save.js` module (key unchanged: `renn-faire-sim-save-v1`) rather than hand-rolled `localStorage` calls — `validate` is the old bare check, everything else `loadState` used to fill in now lives in `repair` (content drift, not schema drift — locked decision #50), and `defaults` is `createInitialState` itself, passed as a factory. Also owns performer AND vendor contract commitments, the weekend/season boundary (`nextDay` hard-stops into a `weekendEnd` phase at the end of each weekend; `startNextWeekend` rolls over into the next one), and gates construction against the currently-unlocked grounds footprint rather than the grid's full authored extent. A planning → commit construction flow (`placePlot`/`commitPlot`/`commitAllPlots`/`deletePlanningPlot`/`movePlanningPlot`, all free/reversible until committed) plus paid `demolishPlot`/`relocatePlot`/`renamePlot` for already-built plots, individual vendor-to-stall seating (`assignVendorToPlot`/`unassignVendorFromPlot`/`autoFillStalls`), and a `hireVendor` hiring cap split correctly between food and craft stalls. `buildPlot`/`placePlot`/`movePlanningPlot`/`relocatePlot` all check `isLegalPlacement` and refuse an illegal siting before any money moves; as of Stage 12 their bounds checks are footprint-aware (`isFootprintWithinCurrentGrid`) and `buildPlot`/`placePlot` stamp each plot's own `w`/`h` onto its record at creation time. `loadState` migrates old saves, including (Stage 12) backfilling `w:1,h:1` onto every pre-Stage-12 plot regardless of kind. As of Stage 15, `buildPlot`/`placePlot`/`movePlanningPlot`/`relocatePlot` all thread `state.builtPlots` (and, where the plot being priced is itself already built, its own id to exclude) into `quoteBuild` so the same-kind escalating cost curve applies; `commitPlot` and `commitAllPlots` both re-quote live at commit time (via `previewCommitAll` for the batch case) rather than trusting a plan's possibly-stale placement-time price, closing a loophole where planning several same-kind plots before committing any would otherwise dodge the escalation. As of Stage 16, `runDay` flags a new `bankrupt` field the moment cash crosses `CONFIG.bankruptcyFloor` (the report ticket for that day still shows normally); `nextDay` checks that flag first and routes to a terminal `'gameOver'` phase instead of continuing, and separately checks `checkWinCondition` at every weekend boundary, routing to a one-time `'victory'` phase (guarded by a new `victoryAchieved` field so it can only fire once per save) instead of `'weekendEnd'` the first time every threshold is met; a new `acknowledgeVictory` action drops from `'victory'` into the normal `'weekendEnd'` screen without altering cash/reputation/victoryAchieved, so the sandbox continues uninterrupted afterward. `loadState` migrates pre-Stage-16 saves missing either field to `false`. As of Phase 2, `createInitialState(weatherSeed)` is deterministic — it defaults to the exported `DEFAULT_WEATHER_SEED` constant — and `newGame()` is the one function that draws a real seed off the clock; `main.js` calls `newGame()` when there is no save, and it is the save slot's `defaults` factory, so a reset starts a new season rather than replaying the constant one (#232). `createInitialState`, `nextDay` and `startNextWeekend` each stamp the new day's `weather` id, and `repair` backfills a pre-Phase-2 save with `fair` and the same named seed constant, deliberately: a seed redrawn on every load would rewrite the forecast under a player who pressed F5. As of Phase 3, `relationships`/`arcBeats`/`actTraits` are three additive maps filled by `repair`; `contractPerformer`/`hireVendor` take a contract id or an offer `{ commitDays, cancelFeeMult }` and store what `quoteContract` priced, with the record's own `cancelFeeMult` and `label`; `runDay` applies the day's relationship deltas; `resolveBeat` is the one writer of the last two maps; releasing an act deletes its relationship (#235). As of Phase 4, the save slot is at version 2 (key unchanged) with a real `migrate` for the first time: a pre-carryover save enters as run 1 with an empty `carryover` record and the mood renown its completed weekends earned, tallied once (#243), while `repair` fills zeros for a current-version save missing a field. `renown`, `carryover` (`{ schema, run, seasons, startedWith }`), `tenure`, `demolished` and `lastRenown` are the new fields; `nextDay` ticks every contracted act's tenure at the weekend boundary and then awards the weekend's renown, once; `demolishPlot` counts; `contractPerformer` refuses a performer whose `unlockRenown` the faire has not earned before any quote is made; `closeSeason` is the run boundary (from `weekendEnd` or `victory`, at the target weekend or later, with or without the win), banking `seasonRecord` and opening the next run on `carryoverPreview` — renown whole, reputation as the start plus half of what stood above it, arcs kept, everything else fresh, the weather seed derived by `nextRunSeed` rather than drawn off the clock.
- `js/ui.js` — state → HTML string rendering. No event listeners. `renderGroundsMap`'s ghost-cell loop renders an illegal open cell as a non-interactive `.plot-marker.blocked` marker (with the refusal reason in its title) instead of just omitting the ghost there; as of Stage 12, built/ghost/blocked markers span their real multi-cell footprint via CSS grid `span`, and occupancy checks cover a plot's whole footprint rather than just its anchor cell. As of Stage 15, the build palette's "from $X" tags, the ghost-cell ground-map preview, a planning plot's "Commit — $X" button/tag, and the "Commit All" batch total all re-quote live off current `state.builtPlots` so what a player sees always matches what they'll actually be charged. As of Stage 16, `renderVictory` and `renderGameOver` render the two new terminal-ish screens (same ticket-stub shell as the day report/weekend summary, gold-accented for victory, wine-accented for game over). As of Stage 17, the grounds map renders a `.gate-marker` at `ENTRANCE`, and both the map tooltip and every plot card (stages included, not just stalls) show a gate-reach multiplier alongside foot traffic. As of Stage 18, the build palette shows "N/cap built" instead of a price once a per-kind build cap (`PLACEMENT_RULES.maxBuiltByKind`) is reached, and the grounds-map legend gained a line noting the new stall hill ban. As
  of Stage 19, the map/grounds-status/build-palette moved out of
  `renderFairFloor` into a new top-level `renderGroundsPanel` (rendered into
  `#grounds`, always visible), leaving `renderFairFloor` to own only the plot
  cards and the day's schedule; `renderLedger` gained meters and a permanent
  grounds-draw readout; `renderOffice` gained a sparkline of the real
  ticket-revenue curve (with the player's price and the curve's peak both
  marked), per-guest margin, and a break-even-gate figure; the schedule table
  marks each block's `heat` with sun pips; and the day report explains the
  crowd it reports via a draw breakdown rather than presenting attendance as
  an oracle. As of Phase 2, `renderLedger` carries a permanent "today's sky"
  slot with sun pips and a tooltip naming all three of the day's weather
  multipliers; `renderForecast` puts tomorrow's sky on the Office desk, named
  by weekday, with its three numbers as a table and how much more or less of a
  gate that is than today; the schedule table's sun pips are drawn at *today's*
  effective heat rather than the authored one, so a scorcher visibly moves the
  morning and a downpour flattens the afternoon; and the ticket stub carries a
  Weather row — rendered only when the day actually has one, so a report from
  before this phase shows nothing rather than inventing neutral multipliers.
- `js/main.js` — the only file that touches `document`. Owns the mutable
  "current state" reference, wires DOM events, re-renders after every action.
  As of Stage 19 it populates `#grounds` and `#content` separately, toggles
  `#board.is-fullwidth` for the full-bleed phases, delegates clicks/changes
  from `#app` (rather than `#content`) so the persistent map is covered by
  the same handlers, updates the ticket-price readout live on `input`, and
  routes a transient flash message to whichever surface the player was
  acting on — the grounds panel while a build/move is pending, the tab panel
  otherwise, never both. As of Stage 22, mounts `gvb-save.js`'s export/import
  save bar in `#footer` (visible in every phase, including mid-report) —
  `#resetBtn` stays the only "erase everything" control.

  **As of Stage 21 the save is written at the top of `render()`, not the
  bottom.** It used to sit below the early return that the report, weekend-end,
  victory and game-over phases take, so the game never wrote a save while a
  report was on screen: reloading on a day's takings rewound to before the
  gates opened. That read as forgiving, but `runDay()` seeds off `Date.now()`,
  so the replayed day came back with *different* numbers. Measured across 400
  seeds on a four-plot grounds, one day's net ran −$301 to +$1,265 and its
  reputation gain 0 to +5 — so reloading was worth about three times the median
  day's profit, and could reach the win condition's reputation floor in a
  quarter of the days it should take. **A day is now final once the gates
  close**, in all four of those phases. The trade is deliberate: the same change
  also stops an accidental reload throwing away a day the player already earned,
  and it makes bankruptcy a real loss rather than something you reload past.
- **Phase 1 increment 2 changed what those two multipliers are for.** Neither `computeFootTraffic` nor `computeReachability` scales a stall's sales any more: the gross is `spentAt` off the walk. `computeFootTraffic` is the *estimate* the build palette and plot cards show before the gates open (and the page labels it "est."); `measureFootTraffic(arrivals, builtPlots)` is its measured twin, computed off the walk's own arrival counts with the same relative-to-mean shape and the same 0.6×-1.6× clamp, and it is what the day report carries and what the best/worst-sited-stall log line reads. Reachability still scales a stage's per-block draw weight, and is a reported statistic for stalls. `isLegalPlacement` also refuses a stall or demo camp whose only path frontage cannot be walked from the gate — the col-3 spur ruling (#227).
- `js/guests.js` — Phase 1 (guests who walk): the crowd as people. `spawnGuests(n, rng)` turns the attendance number into at most 400 typed agents (families, revellers, history buffs, day-trippers, from `GUESTS` in `data.js`), each standing for `attendance / sampled` people; `buildAttractions(state)` gives every built stage, seated stall and demo camp the reachable path cell it is served from, and names the ones no walk from the gate reaches; `walkGuests(state, guests, rng)` steps each guest up to `GUESTS.stepsPerBlock` hops per time block toward whatever pulls hardest (need × quality × archetype taste × shade-in-heat × a repeat penalty, over distance), serves the need on arrival and takes the stall's ticket out of the purse. Pure; `simulateDay` calls it with its own rng stream and puts the aggregates on the report as `guests`. Increment 2 made this the economy: `spentAt` is the money each stall took, and `simulateDay` bills the vendor's gross off it rather than off a conversion rate on attendance. The gate takes its share of the purse first, so `spawnGuests` takes the ticket price.
- `tests/smoke.mjs` — jsdom-based smoke test suite (`npm test` runs it and `tests/guests.mjs`)
- `tests/guests.mjs` — Phase 1's suite, pure Node: the route tree, routes between cells, spawning, attractions, the walk's invariants (nobody off-grid, purse + spent is the purse they came with, arrivals sum every way), taste, heat, distance, the unreachable spur, the seam into `simulateDay`, a forty-seed event fingerprint pinned against the Stage 22 engine, and a 30-day run through the state layer
- `package.json` / `package-lock.json` / `.gitignore` — dev-only. They exist
  solely so `npm test` can install jsdom; nothing in them runs on the static
  GitHub Pages deploy, and nothing in `index.html` imports from them. Keep
  them: deleting them takes the smoke suite with them.
- `assets/fonts/` — the three vendored type families, woff2 only. See the
  README in that folder for source, licence, and which weights are here and why.
- `WISHLIST.md` — the plan: eight ranked phases, the standing backlog, and the open questions. Stages 1-22 are recorded in the repo root's `HISTORY.md`

## Running the tests

```
npm install
npm test
```

1,825 checks in `tests/smoke.mjs` and 168 in `tests/guests.mjs` (see the file
list above for what the second one covers). The first: pure engine/state logic (RNG determinism, terrain/grid data
integrity, buildable-structure catalog integrity, terrain-driven cost/
capacity quoting, stage-adjacency effects on sightline/traffic, scheduling
conflicts, day-simulation invariants, attendance responding sensibly to
price and popularity, ad-campaign catalog integrity, campaign launch/
cooldown/attendance-boost behavior, contract-type catalog integrity,
Weekend Package and Season Contract discount/commitment/cancellation-fee
behavior for BOTH performers and vendors, season-unlock gating for
campaigns and both kinds of contracts, `GRID_EXPANSIONS` catalog integrity
and season-gated grounds-expansion behavior, `effectivePopularity`
including the block-conditional `night_owl` quirk (unit-tested directly,
plus a `simulateDay`-level Golden-Hour-vs-Morning satisfaction check), an
`EVENT_POOL`/`EVENT_REQUIREMENTS`/`EVENT_EFFECTS` integrity block covering
the Stage 9 "backstage drama" events, the weekend hard-stop/summary/
rollover cycle, a 50-day fuzz run with no throws/NaNs, the full
planning→commit→move→demolish→relocate→rename plot lifecycle, the
split food/craft hire cap, individual vendor seating/auto-fill, the
seated-vs-unseated revenue split, a `loadState` migration test for
pre-Stage-10 saves, `isLegalPlacement` (terrain bans, stage-spacing, the
`excludeId` self-exemption, and a still-planning stage counting for
spacing) checked both directly and end-to-end through
`buildPlot`/`placePlot`/`movePlanningPlot`/`relocatePlot`, and, as of
Stage 12, a dedicated footprint/path-frontage block: `footprintFor`/
`footprintCells`/`plotFootprintCells` defaults and overrides, `quoteBuild`
refusing a footprint that runs off the authored map edge,
`isFootprintWithinCurrentGrid` catching a footprint that clears its own
anchor but still hangs off the fence line, `hasPathFrontage` (on-path,
beside-path, two-away, and footprint-interior-neighbor cases),
`isLegalPlacement`'s frontage integration end-to-end through `buildPlot`,
footprint-vs-footprint occupancy (a second plot refused on both the
anchor AND a non-anchor cell of an existing stage), and a `loadState`
migration test confirming a pre-Stage-12 stage backfills to 1×1, never
today's 2×2 — plus a DOM boot check covering tab-switching, the full
build-placement flow (confirmed to never offer a ghost cell past the
current fence line, that placement is free until a Commit click actually
charges for it, and that an illegal cell renders as a blocked marker with
an explanatory title while a legal one still renders as a clickable
ghost), the grounds-status line naming the current tier and next
expansion, a vendor hire-under-contract/let-go-early flow (including
auto-seating), a full 3-day weekend walkthrough ending at the weekend-end
summary screen and rolling into Weekend 2, and a regression test for a
post-ship crash fix (two prima-donna performers sharing a time block
previously threw; see `HISTORY.md`), a per-plot daily-upkeep block (Stage
13: built-vs-planning-vs-missing plots, upkeep scaling with a plot's own
stored cost, the total costs line including it), and, as of Stage 14, a
`computeFootTraffic` block (empty/undefined input, a lone stall always at
`mult === 1`, a planning stall excluded from both the result and the mean,
a well-sited-vs-isolated two-stall comparison, clamp bounds, stages never
appearing in the result) plus a `simulateDay`-level block confirming the
same vendor earns more revenue at a better-trafficked stall while
attendance itself is unaffected, and DOM checks confirming the multiplier
renders on both the Fair Floor plot card and the Backstage seat note.
And, as of Stage 15, an escalating-build-cost block: `countBuiltOfKind`
(kind-specific, built-only, `excludeId` self-exemption), `quoteBuild`'s
new optional `builtPlots`/`excludeId` params defaulting to zero
escalation (so every pre-Stage-15 call/test is unaffected), escalation
compounding as `(1+rate)^builtCount` across a second and third same-kind
build, a different kind being unaffected by another kind's built count,
`buildPlot` end-to-end (a second built food stall costing more than the
first, a stage unaffected by two built food stalls), `commitAllPlots`
pricing a same-kind batch in commit order so it matches building them one
at a time instead of letting every planned-but-uncommitted plot quote at
"1st built" pricing, `relocatePlot` excluding a plot's own built record
from its own new-site quote, and a DOM check that the build palette's
"from $X" price tag rises once one of that kind is already built.
And, as of Stage 16, a win/loss-condition block: `checkBankruptcy`/
`checkWinCondition` unit-tested at and around their thresholds;
`runDay` flagging `bankrupt` (and NOT before then) once cash crosses the
floor while the report ticket still shows normally; `nextDay` routing to
`'gameOver'` and freezing day/weekendDay once bankrupt, and staying there
on a repeat call; `nextDay` firing `'victory'` exactly once at a weekend
boundary that clears every threshold, `acknowledgeVictory` dropping into
the normal `'weekendEnd'` screen without touching cash/reputation, a later
weekend that still clears every threshold NOT refiring victory once
already achieved, and falling one point short of any single threshold
correctly skipping victory; a `loadState` migration test for pre-Stage-16
saves; the 50-day fuzz run updated to treat victory and bankruptcy as
legitimate outcomes of a long random run rather than failures; and two
DOM boot tests that preload a save already parked in `'gameOver'`/
`'victory'` and confirm the right screen renders, and that its one button
(Start a New Faire / Continue the Faire) does the right thing.
And, as of Stage 17, a reachability block: `computePathDistances`
(ENTRANCE at distance 0, the row-2 artery's full-width straight walk,
non-path cells never appearing, memoization, and a pinned-down assertion
for a pre-existing terrain-authoring gap — the col-3 spur is disconnected
from the gate at row 3, discovered while building this stage), a
`reachabilityDistance`/`computeReachability` block (near-vs-far comparison,
the documented 0.8×-1.2× clamp, the lone-plot-is-always-exactly-1× guarantee,
stages and stalls scored in separate groups so one doesn't contaminate the
other's mean, planning plots excluded, and a gate-unreachable plot pinned to
the worst multiplier instead of corrupting the group mean with `Infinity`),
a `simulateDay`-level block (two stalls/two stages sited near vs. far from
the gate, using the same two-built/one-seated technique as the Stage 14
foot-traffic test to isolate gate-distance as the only variable — the near
stall/stage scores above 1×, the far one below, attendance itself is
unaffected, and the near stall earns more house revenue), and DOM checks
confirming the gate marker renders on the grounds map and a built stage's
card shows its gate-reach tag.
And, as of Stage 18, a legality-rules block: `PLACEMENT_RULES` data
integrity for all three new entries; the hill ban refusing both food and
craft stalls (but not a stage or demo camp) with a message that doesn't
suggest hill as an alternative, checked directly and end-to-end through
`buildPlot`; same-kind stall spacing (two food stalls or two craft stalls
too close refused, a food stall beside a craft stall allowed, a
still-planning stall counting toward the spacing, the `excludeId`
self-exemption), checked directly and end-to-end through `buildPlot`; the
demo camp cap (three build normally, a fourth refused with the refusal
message, still-planning demo camps counting toward the cap too, a
different kind unaffected), checked directly and end-to-end through
`buildPlot`/`placePlot`; and two DOM checks confirming the build palette
shows "3/3 built" once the demo cap is reached (with no ghost cell
offered anywhere for that kind), and that a hill cell renders as a
blocked marker naming the hill ban when Food Stall is selected.
And, as of Stage 19, a `computeGroundsDraw` block (empty grounds at the
floor, planning plots and unstaffed stalls contributing nothing, diminishing
returns proven by comparing an early step against a late one, the ceiling
holding, an unknown kind returning 0 rather than NaN); a price-elasticity
block (the anchor being neutral, the revenue curve peaking strictly *inside*
the slider rather than at either end, and the overcharge penalty outweighing
the undercharge bonus); a `blockQualityWeights` block (weights summing to 1
in every block, every block authoring a valid `heat`, shade counting for more
in the hottest block than the coolest, the slack rolling into sightline, and
— the actual payoff — a grove stage measurably closing the gap on a hilltop
stage as the day heats up — a gap Phase 2's weather turns into an outright
swap, since a scorcher runs every block's sun at 2.60x and shade outweighs
the view); and DOM checks that the map stays visible from
the Office tab, lives in its own `#grounds` section outside the tab panel,
that the Office renders the price curve, and that the HUD carries the
grounds-draw readout.
And, as of Stage 21, Section 1h — the save-matches-the-screen block. It boots
`main.js` against a shared in-memory storage, clicks through a real day, and
asserts the save on disk says `report` while a report is on screen and carries
the same attendance the ticket stub shows; then boots a *second* JSDOM against
that same storage (which is what a reload is) and asserts it comes back to the
same report, with the same cash, with no Open the Gates button, and without
duplicating the day in history. The weekend-end phase gets the same
play-then-reload treatment, and a separate block drives a bankrupt report
through to `gameOver` and confirms that phase reaches the save rather than
leaving a stale report on disk — plus that Start a New Faire persists, so a
reload can't resurrect a folded run. Every assertion in the section fails if
`saveState()` moves back below the early return in `render()`; that is how it
was checked.

**Plus a new class of test — Section 1g, tagged `SIGNIFICANCE:`** (six
checks through Stage 21, seven as of Stage 22, eleven as of Phase 2, thirteen as of Phase 3). Everything else in this
suite asserts that a mechanic is *correctly implemented*; these assert that
it is *strategically load-bearing*. Stage 18 shipped with a fully green
suite and a dominant "build nothing, charge maximum" strategy precisely
because no test ever asked whether the numbers mattered. They check that an
empty field loses money and bleeds reputation, that building a stage
substantially grows attendance, that neither end of the ticket slider is
cash-optimal, that price is a real cash-versus-goodwill trade, that daily
costs are a meaningful share of revenue rather than a rounding error, that
upkeep on a developed grounds is a real line item, that stage capacity is
low enough to eventually force a second stage, and, as of Stage 22, that
Saturday draws a measurably bigger crowd (and more cash) than Friday or
Sunday. Phase 1 increment 2 added three more — the ticket-price trade on a
faire that actually sells things, siting deciding money rather than a
tooltip, and the band `wristbandCut` sets from both ends — after finding that
all seven of the originals passed untouched under a rewritten economy, because
every state they used was a bare stage with nobody selling anything. Phase 2
added an eleventh: on the hottest authored day a grove stage has the happier
crowd and gains reputation where a hilltop loses it, and on the coolest the
hilltop takes it back. **Run these against any future balance change, not just
the correctness suite** — if one starts failing, a tuning tweak has quietly
made part of the game pointless. And check what state each one runs on before
trusting a pass.

**Stage 22, 740 → 783 checks.** Adopted the shared `assets/js/gvb-save.js`
save module (no test changes beyond the module swap — same key, same flat
on-disk shape, plus a `__v` field nothing reads); added the
`WEEKEND_DAY_ATTENDANCE` significance check above; and added a new
DOM-driven Section 22 that clicks ten player-facing actions
(`contract`/`release`/`hireVendor`'s day-rate let-go path/`launchCampaign`/
`autoFillStalls`/`unassignVendor`/`demolishPlot`/`selectMove`+`moveTo`/
`deletePlanningPlot`/`renamePlot`) and dispatches `change`/`input` on the
ticket-price slider and both `<select>`s (schedule, vendor assignment) —
none of which any suite had ever exercised — plus a round-trip test of the
new footer save bar's Export/Import buttons through the real `gvb-save.js`
pipeline (a captured `Blob` for export, a synthesized `File` + `change`
event on the hidden file input for import).

**Phase 1, 783 → 857 checks**, plus a second suite: `tests/guests.mjs` (168)
covers the walk, and Section 1g gained checks 8, 9 and 10 for the economy the
walk now drives.

**Phase 2, 857 → 1,118 checks**, in two new sections. **Section 1i** is the
weather itself, pure: the table's integrity, the neutral fallback, the
early→late season ramp measured off 2,400 sampled days per weekend rather
than read back off the table, the three quality weights staying non-negative
and summing to 1 for every authored block/sky pair, the shade ceiling being a
guard rail nothing in play reaches, `blockQualityWeights(block)` with no sky
weighing *exactly* what it did before the phase, and — the load-bearing one —
a save walked through a whole weekend rollover comparing each forecast against
the day that actually arrives. **Section 25** is the same story on screen:
today's sky in the HUD with its numbers in the tooltip, tomorrow's on the
Office desk and demonstrably tomorrow's rather than today's rendered twice,
the schedule's sun pips redrawn at the day's effective heat, and the ticket
stub's Weather row read as a row rather than as text anywhere in the stub —
which matters, because the first version read the whole stub and deleting the
row outright left the suite green: the bad-weather warning and the draw
breakdown both name the sky too.

**Phase 3, 1,118 → 1,652 checks**, in two new sections. **Section 1j** is
the acts' story, pure: the `RELATIONSHIP` table and its tiers, every `ARCS`
beat checked for a real subject, a tier id, two or more choices, and only the
effect keys `resolveBeat` reads (with popularity on performers and quality on
vendors); `performerFor`/`vendorFor` laying traits over the catalog;
`bestBlockFor`; `quoteContract` quoting the three quick picks at exactly their
pre-phase rates and the negotiated grid within two and three points of them;
signing and release through the quote; the day's relationship deltas for
every rule in the table, including a stage shrunk until it overflows and a
stall walked onto the disconnected spur by hand; the two gated events across
300 seeds each way; beats pending, resolved, refused and re-priced; and a
pre-arc save coming through `repair` at neutral. **Section 26** is the same
on screen: mood tags on every contracted row, a beat card whose choice button
resolves into the save and re-prices the roster row, a negotiation row driven
through the delegated `change` listener and signed at the rate it showed, the
ticket stub's Backstage row, and an old-shape contract rendering on its
option row.

**Phase 4, 1,652 → 1,825 checks**, in two new sections. **Section 1k** is
pure: the `RENOWN` and `CARRYOVER` tables and the two renown gates in the
catalog; the South Meadow's connector reachable from the gate, inside a
day's walk, and not joined to the col-3 spur; the three renown lines each
toggled on and off alone; the expansion gate on weekend and renown
together; the headliner refused and then signed; tenure written, ticked,
deleted and restarted; the demolition count; the boundary award applied
once with tenure ticked first; `canCloseSeason`, `seasonRecord`,
`carryoverPreview` and `closeSeason` end to end, twice, and pure; the
migration from a Stage 22 save, a pre-Stage-22 save and a version-1 export
with every original key compared, against a version-2 save that is repaired
to zero rather than tallied; and a scripted manager playing two seasons
from a real start, the first to the win and the second to the meadow.
**Section 27** is the screens: the HUD slot and its tooltip, the
weekend-end stub's renown lines (and its "nothing this weekend" line), the
season close with its ledger and the save it writes, the victory ledger
with both ways on, the headliner's bar on Backstage turning into buttons at
20, the fence hint naming its renown, and a version-1 save booting straight
into the new shape.

**A trap Section 27 is written around, and Section 25 before it, worth knowing
before adding another DOM section:** a fixture written straight to storage
without `__v` reads as a pre-Phase-4 save and `migrate` re-tallies its
renown on the way in, so Section 27's `boot` stamps `__v: 2` unless the
fixture says otherwise. And `main.js`'s `$` reads `globalThis.document`, so booting a
second JSDOM steals the first one's renders. Everything a boot needs to
assert has to happen before the next boot starts.
