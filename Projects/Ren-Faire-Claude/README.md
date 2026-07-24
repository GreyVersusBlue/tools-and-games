# Faire Weekend

A browser-based renaissance faire management sim, modeled loosely on the
Maryland Renaissance Festival. Run the office, contract performers and
vendors backstage, build out the grounds, schedule the day, open the gates,
and see how you did.

No build step. Static files only — open `index.html` directly or serve the
folder (e.g. `npx serve .`) and it runs. Hosted the same way as this
account's other GitHub Pages projects.

## Files

- `index.html` — shell + font links
- `css/style.css` — all styling (parchment/forest/wine/gold design system)
- `js/data.js` — content: the grounds grid/terrain legend (authored at its full extent, 14×10, now threaded by a real path network — the row-2 artery plus a col-3 spur and, as of Stage 12, a second col-10 spur with an eastward connector so the grounds-expansion territory has path frontage), a `GRID_EXPANSIONS` unlock schedule for how much of that grid is actually buildable at a given weekend, buildable structure types (stage/food/vendor/demo) with terrain cost/capacity modifiers and, as of Stage 12, a `footprint` (stage is 2×2; everything else defaults to 1×1), a `PLACEMENT_RULES` table (terrain bans, minimum stage-to-stage spacing, and, as of Stage 12, `requiresPathFrontage`), performers (15, as of Stage 9), vendors (12, as of Stage 9), ad/marketing campaigns, one shared contract-type catalog (Day Rate/Weekend Package/Season Contract) used by both performers and, as of Stage 7, vendors, and the random event pool (including Stage 9's roster-composition-gated "backstage drama" events) — each campaign, contract, and grounds-expansion tier tagged with the weekend (`unlockSeason`) it becomes available, config (including `seasonLength`, days per weekend, and, as of Stage 10, `demolishFeeMult`/`relocateDiscountMult`/`maxPlotNameLength`, as of Stage 15, `escalatingBuildCostRate` for the same-kind escalating build-cost curve, and, as of Stage 16, `bankruptcyFloor` and `winCondition` — the loss/win thresholds). No logic.
- `js/engine.js` — pure simulation math (RNG, scheduling validation, terrain/adjacency lookup, build-cost quoting, campaign lookup, contract-aware performer AND vendor cost, season-unlock checks, the currently-unlocked grounds size and next expansion (Stage 8), quirk-aware performer popularity including the block-conditional `night_owl` quirk (Stage 9), the `EVENT_REQUIREMENTS` gating map for random events, weekend-summary aggregation, day simulation, `stallSummary`/`STALL_KIND_BY_VENDOR_TYPE` for the per-kind stall vacancy tracker (Stage 10), `isLegalPlacement` — the terrain-ban/stage-spacing/path-frontage check sitting alongside `quoteBuild` as the other half of "can this be built here", the footprint primitives everything above runs on (`footprintFor`/`footprintCells`/`plotFootprintCells`/`isFootprintWithinCurrentGrid` and `hasPathFrontage`, Stage 12), per-plot daily upkeep (`plotUpkeep`/`totalUpkeep`, Stage 13), and, as of Stage 14, `computeFootTraffic` — turns each built food/vendor stall's terrain+adjacency `traffic` attribute into a per-stall sales multiplier relative to the day's average stall, wired into `simulateDay`'s vendor-revenue calc so placement (path frontage, proximity to a stage or a now-functional demo camp) has a real economic payoff, not just a cosmetic stat), and, as of Stage 15, `countBuiltOfKind` plus a `quoteBuild(kind, x, y, builtPlots, excludeId)` that compounds a same-kind structure's price by `CONFIG.escalatingBuildCostRate` per already-*built* one of that kind, and `previewCommitAll` — prices a whole batch of planning plots being committed together in order, so a same-kind cluster committed at once escalates against itself exactly like committing one at a time would, and, as of Stage 16, `checkBankruptcy(cash)` and `checkWinCondition(state)` — the two pure predicates the loss/win phases in state.js are built on). No DOM.
- `js/state.js` — the game-state object and the actions that change it (immutable-style: every action returns a new state). Also owns localStorage save/load, performer AND vendor contract commitments, the weekend/season boundary (`nextDay` hard-stops into a `weekendEnd` phase at the end of each weekend; `startNextWeekend` rolls over into the next one), and gates construction against the currently-unlocked grounds footprint rather than the grid's full authored extent. A planning → commit construction flow (`placePlot`/`commitPlot`/`commitAllPlots`/`deletePlanningPlot`/`movePlanningPlot`, all free/reversible until committed) plus paid `demolishPlot`/`relocatePlot`/`renamePlot` for already-built plots, individual vendor-to-stall seating (`assignVendorToPlot`/`unassignVendorFromPlot`/`autoFillStalls`), and a `hireVendor` hiring cap split correctly between food and craft stalls. `buildPlot`/`placePlot`/`movePlanningPlot`/`relocatePlot` all check `isLegalPlacement` and refuse an illegal siting before any money moves; as of Stage 12 their bounds checks are footprint-aware (`isFootprintWithinCurrentGrid`) and `buildPlot`/`placePlot` stamp each plot's own `w`/`h` onto its record at creation time. `loadState` migrates old saves, including (Stage 12) backfilling `w:1,h:1` onto every pre-Stage-12 plot regardless of kind. As of Stage 15, `buildPlot`/`placePlot`/`movePlanningPlot`/`relocatePlot` all thread `state.builtPlots` (and, where the plot being priced is itself already built, its own id to exclude) into `quoteBuild` so the same-kind escalating cost curve applies; `commitPlot` and `commitAllPlots` both re-quote live at commit time (via `previewCommitAll` for the batch case) rather than trusting a plan's possibly-stale placement-time price, closing a loophole where planning several same-kind plots before committing any would otherwise dodge the escalation. As of Stage 16, `runDay` flags a new `bankrupt` field the moment cash crosses `CONFIG.bankruptcyFloor` (the report ticket for that day still shows normally); `nextDay` checks that flag first and routes to a terminal `'gameOver'` phase instead of continuing, and separately checks `checkWinCondition` at every weekend boundary, routing to a one-time `'victory'` phase (guarded by a new `victoryAchieved` field so it can only fire once per save) instead of `'weekendEnd'` the first time every threshold is met; a new `acknowledgeVictory` action drops from `'victory'` into the normal `'weekendEnd'` screen without altering cash/reputation/victoryAchieved, so the sandbox continues uninterrupted afterward. `loadState` migrates pre-Stage-16 saves missing either field to `false`.
- `js/ui.js` — state → HTML string rendering. No event listeners. `renderGroundsMap`'s ghost-cell loop renders an illegal open cell as a non-interactive `.plot-marker.blocked` marker (with the refusal reason in its title) instead of just omitting the ghost there; as of Stage 12, built/ghost/blocked markers span their real multi-cell footprint via CSS grid `span`, and occupancy checks cover a plot's whole footprint rather than just its anchor cell. As of Stage 15, the build palette's "from $X" tags, the ghost-cell ground-map preview, a planning plot's "Commit — $X" button/tag, and the "Commit All" batch total all re-quote live off current `state.builtPlots` so what a player sees always matches what they'll actually be charged. As of Stage 16, `renderVictory` and `renderGameOver` render the two new terminal-ish screens (same ticket-stub shell as the day report/weekend summary, gold-accented for victory, wine-accented for game over).
- `js/main.js` — the only file that touches `document`. Owns the mutable "current state" reference, wires DOM events, re-renders after every action.
- `tests/smoke.mjs` — jsdom-based smoke test suite (`npm test`)
- `HANDOFF.md` — status, what's next, and retro notes for whoever (or whatever model) picks this up next

## Running the tests

```
npm install
npm test
```

573 checks: pure engine/state logic (RNG determinism, terrain/grid data
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
previously threw; see HANDOFF.md), a per-plot daily-upkeep block (Stage
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
