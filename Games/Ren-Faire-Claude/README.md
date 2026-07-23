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
- `js/data.js` — content: the grounds grid/terrain legend (authored at its full Stage 8 extent, 14×10), a `GRID_EXPANSIONS` unlock schedule for how much of that grid is actually buildable at a given weekend, buildable structure types (stage/food/vendor/demo) with terrain cost/capacity modifiers, performers (15, as of Stage 9), vendors (12, as of Stage 9), ad/marketing campaigns, one shared contract-type catalog (Day Rate/Weekend Package/Season Contract) used by both performers and, as of Stage 7, vendors, and the random event pool (including Stage 9's roster-composition-gated "backstage drama" events) — each campaign, contract, and grounds-expansion tier tagged with the weekend (`unlockSeason`) it becomes available, config (including `seasonLength`, days per weekend). No logic.
- `js/engine.js` — pure simulation math (RNG, scheduling validation, terrain/adjacency lookup, build-cost quoting, campaign lookup, contract-aware performer AND vendor cost, season-unlock checks, the currently-unlocked grounds size and next expansion (Stage 8), quirk-aware performer popularity including the block-conditional `night_owl` quirk (Stage 9), the `EVENT_REQUIREMENTS` gating map for random events, weekend-summary aggregation, day simulation). No DOM.
- `js/state.js` — the game-state object and the actions that change it (immutable-style: every action returns a new state). Also owns localStorage save/load, performer AND vendor contract commitments, the weekend/season boundary (`nextDay` hard-stops into a `weekendEnd` phase at the end of each weekend; `startNextWeekend` rolls over into the next one), and gates `buildPlot` against the currently-unlocked grounds footprint rather than the grid's full authored extent.
- `js/ui.js` — state → HTML string rendering. No event listeners.
- `js/main.js` — the only file that touches `document`. Owns the mutable "current state" reference, wires DOM events, re-renders after every action.
- `tests/smoke.mjs` — jsdom-based smoke test suite (`npm test`)
- `HANDOFF.md` — status, what's next, and retro notes for whoever (or whatever model) picks this up next

## Running the tests

```
npm install
npm test
```

345 checks: pure engine/state logic (RNG determinism, terrain/grid data
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
rollover cycle, a 50-day fuzz run with no throws/NaNs), plus a DOM boot
check covering tab-switching, the full build-placement flow (confirmed to
never offer a ghost cell past the current fence line), the grounds-status
line naming the current tier and next expansion, a vendor
hire-under-contract/let-go-early flow, a full 3-day weekend
walkthrough ending at the weekend-end summary screen and rolling into
Weekend 2, and a regression test for a post-ship crash fix (two
prima-donna performers sharing a time block previously threw; see
HANDOFF.md).
