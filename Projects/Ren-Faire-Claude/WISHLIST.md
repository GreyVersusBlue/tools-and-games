# Faire Weekend — Feature Wishlist

**Status: twenty-two stages are shipped, three rounds of site-wide review have
run over them, and nothing is left in the prompt's own task list except work
nobody has scoped.** The suite stands at **801 passed, 0 failed**
(`node tests/smoke.mjs`, re-run against this working tree) and
`play-games.mjs faire-weekend` at 18 checks, 0 failed on a fair environment.
Round 3 closed the mobile tap-target debt, found one more never-clicked action
(`cancelMove`) after round 2 had called that audit closed, and left the
layout/density review owed for a fourth round running. Every stage's plan and
how it landed is in the repo root's `HISTORY.md` and in `README.md`; nothing
here repeats them. The first open phase is **Phase 1 — Guests who walk**, on
**Claude Fable 5.1**.

## What it is

A renaissance-faire management sim at `Projects/Ren-Faire-Claude/`, modelled
loosely on the Maryland Renaissance Festival and called Faire Weekend on the
board (the folder name is older than the game). Build the grounds, book the
acts, hire and seat vendors, set the ticket price, schedule four time blocks
across your stages, open the gates. A day resolves into a ticket stub, a
weekend into a summary, and a season either reaches `{ seasonTarget: 6,
minReputation: 70, minCash: 25000 }` or falls through `bankruptcyFloor: -6000`
and ends.

No build step: five ES modules, one stylesheet, three vendored type families,
a 64-line `index.html`. Being ES modules it has to be *served*, and
`package.json`/`node_modules/` exist only because `tests/smoke.mjs` needs
jsdom; nothing in them ships.

What it does well: the grounds are a real economic object. Terrain drives
sightline/shade/traffic, footprints and path frontage and stage spacing decide
what goes where, distance from `ENTRANCE` at (0,2) scales sales and stage
draw, each same-kind build compounds the next one's price by 15%, and every
built plot costs 7% of its own build cost per day forever. Stage 19 tied all
of it to attendance itself through `computeGroundsDraw`, so the site plan
grows the crowd rather than only dividing it.

What it is not: a simulation of people. The crowd is one number —
`baseAttendance × priceMult × popularityFactor × adFactor × groundsDraw.mult ×
weekendDayFactor × jitter` — and every siting mechanic is a coefficient on
averages of it. Nobody walks anywhere. There is also no weather, no act you
have a history with, and nothing to do after the win screen.

## The architecture that is there

- **`js/data.js` (452)** — content only, no logic, deliberately JSON-shaped so
  it could become fetched `.json` untouched. `CONFIG` (every tunable number
  with the paragraph explaining why it is that number), `GROUNDS_DRAW`, four
  `TIME_BLOCKS` each with a `weight` and a `heat` (0.15/0.85/1.0/0.25),
  `WEEKEND_DAY_ATTENDANCE` (Fri 0.85 / Sat 1.2 / Sun 0.95), a 14×10 `GRID`
  with authored `TERRAIN_ROWS`, `ENTRANCE`, three `GRID_EXPANSIONS` tiers
  (10×7 at weekend 1, 12×8 at 2, 14×10 at 4), `PLACEMENT_RULES`, and the
  catalogs: 4 structure types, 15 performers, 12 vendors, 4 campaigns, 3
  contract options, 10 events.
- **`js/engine.js` (1,081)** — pure, no DOM. Forty-odd exports: `makeRng`, the
  footprint primitives, `isLegalPlacement`, `quoteBuild`, `computeFootTraffic`,
  `computePathDistances`/`computeReachability`, `computeGroundsDraw`, the
  price-elasticity trio, `blockQualityWeights`, `totalUpkeep`,
  `checkBankruptcy`/`checkWinCondition` — and `simulateDay`, 250 lines that
  read all of it and return a day.
- **`js/state.js` (687)** — the state object and ~25 actions, each returning
  `{ state, error }` with a *new* state. Owns the planning→commit build flow,
  performer and vendor contracts, the weekend boundary (`nextDay` parks in
  `weekendEnd`, `startNextWeekend` rolls over), and the `gameOver`/`victory`
  routes. Persistence went to `assets/js/gvb-save.js` at Stage 22: key
  `renn-faire-sim-save-v1`, everything `loadState` used to backfill now in
  `repair`, `migrate` a no-op, `defaults: createInitialState` as a factory.
- **`js/ui.js` (817)** — state → HTML strings, ten renderers, no listeners.
  `renderGroundsPanel` owns the plat map, status line and build palette;
  `renderFairFloor` owns plot cards and the schedule; the four
  end-of-something screens share one ticket-stub shell.
- **`js/main.js` (303)** — the only file that touches `document`. Holds the
  mutable state, delegates `click`/`change`/`input` off `#app`, re-renders
  after every action, mounts gvb-save's export/import bar in `#footer`; its
  `handleAction` is a 23-case switch.
- **`css/style.css` (1,060)** — the "operations room" palette and the
  surveyor's-plat map. Two breakpoints, 1080px and 720px; `--cell` is 46px,
  38px, 48px respectively.
- **`tests/smoke.mjs` (3,018)** — the largest test file in the repo, 801
  assertions, no framework: an `assert()` counter and a `mod()` helper turning
  a path into a `file://` URL so Windows can run it. Sections 1–1g are pure;
  20, 21, 23 and 24 parse `style.css` and `index.html` as text; 1h and 22
  build a JSDOM and re-import `js/main.js` cache-busted, which is a reload.

The load-bearing habit is what the layering implies: **anything worth testing
is a pure function in `engine.js` with a suite, and `main.js` is a thin wire.**
It breaks down in two places — `ui.js`, 817 lines of template literals with
real logic inside them (live re-quoting, tag thresholds, ghost-cell legality)
that only the DOM sections reach, and `simulateDay`, pure but undecomposed.

## Conventions a new builder must know

- **`data.js` has no logic, `engine.js` has no DOM, `ui.js` has no listeners,
  only `main.js` touches `document`.** That is why the whole simulation
  imports under plain Node and most of the 801 assertions cost nothing to run.
- **Every action returns a new state and an optional error**, and refuses
  *before* money moves — the four placement actions all check
  `isLegalPlacement` first.
- **Never change the storage key** (#36). It is `renn-faire-sim-save-v1`, and
  an existing save carries no `__v`, which `gvb-save.js` reads as version 0.
- **`migrate` is version drift; `repair` is every load** (#37, #50). Every
  backfill this game does — `vendorContracts`, plot `status`/`w`/`h`, the
  auto-seat pass — is content drift and lives in `repair`.
- **The save slot is built fresh per call, never cached.** `gvb-save.js`
  probes storage once at `createSaveSlot()` and the suite reassigns
  `globalThis.localStorage` per JSDOM boot, so a cached slot freezes onto the
  storage from the first boot in the process. See `slot()` in `state.js`.
- **A day is final once the gates close** (#45, this project's policy, now
  site-wide). The save is written at the *top* of `render()` because the four
  end-of-something phases take an early return. Reloading used to rewind past
  the gates, and since `runDay()` seeds off `Date.now()` the replay came back
  different: across 400 seeds one day's net ran −$301 to +$1,265.
- **Assert against the DOM for what just happened, against the save only for
  what a reload has to survive** (#39).
- **Only *built* plots count, and a stall with nobody seated is a shed.** A
  `planning` plot is free, reversible and invisible to `computeGroundsDraw`,
  `totalUpkeep`, `countBuiltOfKind` and `simulateDay` alike.
- **A refusal is a sentence, not a silent no-op.** `isLegalPlacement` returns
  the reason, and `renderGroundsMap` paints an illegal cell as
  `.plot-marker.blocked` carrying it in a `title` rather than omitting it.
- **A lever nothing on screen names is not a lever.** `weekendDay` was set,
  incremented and displayed for sixteen stages while nothing read it; the
  stage that finally gave it a multiplier also gave the HUD a tooltip naming
  the number.
- **Correctness tests are not enough — see Section 1g, tagged
  `SIGNIFICANCE:`.** Seven checks, twelve assertions, each asserting a
  mechanic is *strategically load-bearing* rather than merely implemented.
  Stage 18 shipped fully green with "build nothing, charge maximum" strictly
  optimal. Run these against every balance change.
- **Verify a guard-rail by reintroducing the bug it guards** (#34). Round 3
  did it four times and caught two real mistakes before they shipped.
- **Nothing leaves the site.** Fonts are vendored, Section 21 asserts it, and
  `index.html` carries a comment where the Google Fonts links were, saying not
  to put them back. Never hand-edit inside the `gvb:social` markers (#31).
- **Run it as:** `npm install --prefix "Projects/Ren-Faire-Claude"` once, then
  `node tests/smoke.mjs` from inside the project; every new import there goes
  through `mod()`, because a bare Windows absolute path reads as the URL
  scheme `c:` and Node refuses it. The browser suite is `cd Tools/board-check
  && node play-games.mjs faire-weekend`, 18 checks — and `Tools/board-check/**`
  is read-only here; a change there is a shared-file request, not an edit.

## Questions for Devon

The prompt file carries no "Questions for Devon" block. These are what the
notes and handoff have deferred rather than answered.

- **Are the four economy numbers right?** `perGuestCost: 5`, `upkeepRate:
  0.07`, `bankruptcyFloor: -6000` and `winCondition`'s three thresholds have
  been flagged "most likely to need adjusting after real play" for four rounds
  running, and no round could answer it because nobody has played a full
  season. The `SIGNIFICANCE:` tests prove they are not degenerate, not that
  weekend 6 is a satisfying place to arrive.
- **Should winning end the run?** `acknowledgeVictory` drops back into the
  ordinary weekend-end screen and play continues — but `GRID_EXPANSIONS` runs
  out at weekend 4, so every weekend after the win is the same weekend. Is the
  sandbox the intent, or is a second track owed (Phase 4)?
- **Is the 1080px breakpoint a touch device?** Round 3 fixed 720px to a 44px
  floor and deliberately left 1080px at `--cell: 38px` (34px markers), reading
  a narrow laptop window as mouse-driven. A named exclusion that wants a
  ruling.
- **Does the fixed `fit-content(710px)` board column bother you?** Sized to
  the widest tier, so a Home Grounds save carries ~54px of empty mat right of
  the map; adaptive means threading `--cols`/`--cell` from `ui.js` onto
  `#board`.

## The standing backlog

Open and unclaimed. Add here rather than starting a new list.

**Surface**
- Layout/spacing/density review, owed since Stage 20 and now four rounds
  running. Needs a browser and eyes, not arithmetic.
- `#board`'s `fit-content(710px)` cap is a fixed worst case, not adaptive
  (round 3's own named follow-up); the 1080px breakpoint's cell size was
  scoped out of round 3's fix; and the slider and two `<select>`s have never
  been measured for touch size at all.
- ~~Mobile tap targets all under 44px.~~ *Closed round 3: `--cell` 30px → 48px
  at the 720px breakpoint (exactly 44px of marker given the 2px margin), a
  `min-height: 44px` floor on the four button classes, and a scroll-shadow on
  `.plat-sheet` now that panning east is normal.*
- ~~`--vellum-faint` and `--wine` fail WCAG AA on dark panels.~~ *Closed Stage
  20; Section 20 re-runs the contrast math against hex values parsed back out
  of `style.css`.*

**Simulation**
- True guest-agent/pathfinding simulation — the one fully untouched item from
  Stage 9 on.
- Weather, still the obvious fit for `TIME_BLOCKS.heat`, authored per block
  and constant forever.
- The col-3 path spur is disconnected from the gate at row 3, found building
  Stage 17 and pinned by a `computePathDistances` assertion rather than fixed.
- `simulateDay` is 250 undecomposed lines. A drag-to-reorder move for planning
  plots is still unbuilt too.

**Content**
- A third contractable role (security, gate staff, an announcer); multi-weekend
  performer arcs; negotiation rather than a fixed rate.
- More filler for `EVENT_POOL` (10), `AD_CAMPAIGNS` (4), and the quirk set
  (four quirks across fifteen performers, one of them blank).
- A second, deeper win track; a photo-mode/postcard export off
  `summarizeWeekend`; a build-preview of a placement's effect on grounds draw.

**Tooling**
- The `data-action` wiring audit is a person with grep, and it found a real
  gap in each of the last two rounds it ran. 25 distinct actions: 23 with a
  case in `main.js`'s switch, plus `schedule` and `assignVendor` on the
  delegated `change` listener.
- `commitAll` is covered only in `play-games.mjs`, never in `smoke.mjs` —
  known and accepted, written down nowhere the tests can see.
- `README.md` still says "783 checks" and "the 709-check suite".

## Arc one — the crowd is people

Twenty-two stages built a faire out of tables and coefficients, and it works:
the grounds are an economic object with real siting, escalation, upkeep, and a
crowd whose size the map has a vote in. What it has never had is anybody in
it. Arc one builds for the player who wants the faire to behave like a place
rather than a spreadsheet with a plat drawn on it. **Ranked by impact, and the
order is the recommendation.**

**The model convention for this project**: most phases run on **Claude Opus
5**. **Claude Fable 5.1** is named only where it earns it — a pure simulation
layer with invariants nothing on screen would reveal, a refactor that removes
the safety net it is refactoring under, or a save schema every later phase
inherits — and each phase says why in one clause. A phase is *finished* only
when its branch has become a pull request, that has merged to main with CI
green, and the closing report names the **next open phase's number and its
named model**.

## Phase 1 — Guests who walk

**The crowd is one number the grounds multiply, and nobody in it has ever
taken a step.**

`computeGroundsDraw` turns built structures into draw points and a multiplier
clamped between 0.25 and 1.65 — a stage 1.0 points, a staffed stall 0.5, a
demo camp 0.35, square root on the sum. Everything Stages 12, 14 and 17 built
on top of it re-slices that aggregate rather than producing it. The hard part
is not the agents; it is landing them on an economy seven `SIGNIFICANCE:`
checks pin. Those checks are the acceptance criteria, not an obstacle.

- [ ] **`guests.js`, pure, with its own suite.** An archetype table in
  `data.js` — families, revellers, history buffs, day-trippers — each with a
  needs vector (food, spectacle, shade, spend) and a budget; `spawnGuests(n,
  rng)` turns the attendance number the formula already computes into a typed
  population, so today's entry point survives the change.
- [ ] **Walk them.** `computePathDistances` already BFSes the path network
  from `ENTRANCE`; extend it to return routes, not just distances, and step
  each guest per block toward what serves its need.
- [ ] **Reconcile with the economy, don't replace it.** Ticket revenue stays
  `attendance × price`; vendor sales become the guests who actually reached a
  stall with money left, and `computeFootTraffic`'s multiplier becomes a
  statistic *derived* from the walk rather than an authored curve.
- [ ] **Fix or rule on the col-3 spur**, which a test pins today because
  aggregate reachability shrugged at it. Agents will not.
- [ ] **Keep the seven `SIGNIFICANCE:` checks meaningful.** Each must still
  pass, or be rewritten to assert the same strategic claim against the new
  model — and that rewrite *is* this phase's design review.
- [ ] **Determinism and a fuzz block.** One `makeRng(seed)` off the day as
  `runDay` does, so a report survives a reload unchanged (#45); extend the
  50-day fuzz run to assert no throws, no NaN, no guest off-grid.

*Leans on:* `computePathDistances`/`computeFootTraffic`/`computeReachability`,
`TERRAIN_ROWS`, `ENTRANCE`. *Save:* none — guests die with the report and only
the day's aggregates reach `history`, so every existing save still loads.
*Model:* **Claude Fable 5.1** — a simulation layer replacing the term every
other mechanic multiplies into, where a wrong answer is a plausible number.

## Phase 2 — Weather worth checking

**Every time block knows exactly how hot it is, and no two days have ever been
different.**

`TIME_BLOCKS` carries `heat` per block and `blockQualityWeights` already uses
it properly: shade's weight is `0.25 × heat` and the slack rolls into
sightline, so a hilltop stage is the best seat at Morning Procession (heat
0.15) and the worst at Afternoon (1.0). That is most of a weather system with
the weather hardcoded. Stage 22 proved the shape: a table, one term, and a
tooltip naming the number on screen.

- [ ] **A `WEATHER` table in `data.js`**, each row a heat multiplier, an
  attendance multiplier, a satisfaction delta and a name, in
  `WEEKEND_DAY_ATTENDANCE`'s content-only idiom.
- [ ] **One roll per day**, seeded off the same day seed and stamped onto the
  state before `simulateDay` runs, so a reloaded report shows the weather it
  showed the first time.
- [ ] **`heat` becomes per-day as well as per-block.**
  `blockQualityWeights(block, weather)`: a scorching Saturday punishes
  hilltops in every block, a grey one flattens the tradeoff entirely.
- [ ] **A forecast one day ahead, on the Office desk.** Weather you learn
  about after committing to a day rate is a tax, not a decision.
- [ ] **A season with a shape.** Later weekends skew cooler and wetter, so
  `seasonTarget: 6` is a run through a season rather than six identical ones.
- [ ] **A `SIGNIFICANCE:` check.** A grove stage out-earns a hilltop on the
  hottest authored day and loses on the coolest.

*Leans on:* `TIME_BLOCKS.heat`, `blockQualityWeights`. *Save:* additive — a
`weather` field on the state and each `history` entry, `repair` defaulting a
missing one to fair exactly as the weekend-day factor falls back to 1.
*Model:* **Claude Opus 5** — a content table, one engine term and a readout,
on a pattern the last stage already shipped.

## Phase 3 — Acts with a story

**Fifteen performers, and hiring one is a price lookup.**

`CONTRACT_OPTIONS` is three rows shared by performers and vendors, and a
performer is a popularity number, a role, and at most one quirk. Nothing
anybody does on Friday changes what they cost or draw on Saturday, and the
Season Contract's only argument is its discount.

- [ ] **A relationship number per contracted performer and vendor**, moved by
  what the day did: scheduled into their best block, left off the bill, sulked
  through a shared slot as a `prima_donna`, played a stage that overflowed.
- [ ] **Arcs in `data.js`.** A beat unlocks at a relationship threshold, offers
  a choice, and changes a number — popularity, rate, a quirk gained or shed.
- [ ] **Negotiation instead of a price tag.** A counter-offer trading rate
  against commitment length against cancellation fee, priced through
  `effectivePerformerCost`/`effectiveVendorCost`, not a fourth cost path.
- [ ] **Two more `EVENT_POOL` entries gated on the new state**, through
  `EVENT_REQUIREMENTS` — which fails closed on an unrecognised key, so a typo
  makes an event ineligible rather than always-eligible.
- [ ] **Backstage shows the arc** in the card idiom the roster already uses. A
  relationship the player cannot see is the `weekendDay` mistake again.
- [ ] **Tests.** Catalog integrity for every arc beat, plus a `repair` test
  proving a pre-arc save loads with every relationship at neutral.

*Leans on:* `PERFORMERS`/`VENDORS`/`CONTRACT_OPTIONS`/`EVENT_POOL`,
`state.js`'s `contracts`/`vendorContracts`. *Save:* additive — a
`relationships` map keyed by performer and vendor id, filled by `repair`.
*Model:* **Claude Opus 5** — content tables and UI wiring over catalogs that
already have integrity suites.

## Phase 4 — A faire that outlives its season

**You win by having $25,000 and 70 reputation at the end of weekend six, and
then the game politely continues doing nothing new.**

`checkWinCondition` fires once, `victoryAchieved` stops it refiring, and
`acknowledgeVictory` drops back into the ordinary weekend-end screen. After
that the sandbox is static: `GRID_EXPANSIONS` runs out at weekend 4, every
campaign and contract tier has unlocked, and weekend 12 is weekend 7 again.

- [ ] **A second track with its own currency.** Standing or renown, earned by
  what cash does not measure: satisfaction held high across a weekend, an act
  kept a full season, a grounds built without demolishing anything.
- [ ] **A run boundary.** End a season deliberately, bank a carryover record,
  start the next one keeping something specific.
- [ ] **The carryover schema is the real deliverable.** Versioned, read
  through `migrate` rather than `repair` (schema drift, not content drift —
  #37), designed once, because every later phase inherits it.
- [ ] **Unlocks hanging off the second track**: a fourth expansion tier past
  Deep Woods Trail, a headliner who will not sign for money alone.
- [ ] **The win screen becomes a ledger** — what was earned, what carries,
  what the next season starts with.
- [ ] **Tests.** A full run reaching the second win and carrying over, plus a
  migration test proving a pre-carryover save enters the new shape with an
  empty record and loses nothing.

*Leans on:* `checkWinCondition`, `startNextWeekend`/`acknowledgeVictory`,
`gvb-save.js`'s `migrate`. *Save:* the first non-additive change in this
project's history — a real `migrate`, key unchanged (#36). *Model:* **Claude
Fable 5.1** — a save schema every later phase inherits, and the one place
`migrate` stops being a no-op.

## Arc two — the grounds you can touch

Arc one is about what the simulation knows; arc two is about what the player
can see and do with their hands. It opens with the oldest debt on this page —
a layout review four consecutive rounds have owed and none has paid, because
every session with a browser spent it on an assigned task — which is also the
cheapest phase here. The arc ships on arc one's terms unchanged, model named
per phase. **Ranked by impact, and the order is the recommendation**; the last
phase is an and-also for the machine rather than for the player.

## Phase 5 — The review that has been owed four rounds

**Nobody has ever looked at this game's layout with a real eye and a real
browser.**

Stage 20 audited contrast with arithmetic because no browser was available;
round 3 measured tap targets in a live 375×812 page and fixed them. Neither is
a design review. This phase spends a browser on one deliberately.

- [ ] **Shoot the states first.** `shots/games/` before-and-afters at
  1280×900, 1080 and 375×812 across all five phases and all three desk tabs.
  The before set is the argument.
- [ ] **Fix density where it is measurably wrong**, naming the measurement
  each time. Likely offenders: a `.plot-card` can carry five stat tags at once
  (sightline/shade/traffic/cap, adjacency, demo camp, foot traffic, gate
  reach), `#ledger`'s meters, the Office price sparkline.
- [ ] **Settle the `fit-content(710px)` board column.** Either thread the live
  `--cols`/`--cell` from `ui.js` onto `#board` so a `calc()` sizes it off the
  current tier, or keep the fixed cap and write down why.
- [ ] **Rule on the 1080px breakpoint's 38px cell**, and **measure the slider
  and the two `<select>`s** — neither was ever measured, which is why round 3
  correctly declined to resize them.
- [ ] **Guard what you fix** the way Sections 23 and 24 do: parse the value
  back out of `style.css`, assert it, reintroduce the bug, watch it fail by
  name (#34).

*Leans on:* `css/style.css`, `Tools/board-check`'s `shots/`. *Save:* none.
*Model:* **Claude Opus 5** — CSS and judgement, with a browser open.

## Phase 6 — A map you can pan, zoom and preview into

**The grounds are a CSS grid of DOM markers, and the fix for a phone was to
make them bigger and let the page scroll sideways.**

`renderGroundsMap` emits a `.terrain-cell` per cell of the unlocked grid — 70
on Home Grounds, 140 on Deep Woods Trail — plus a marker per plot and, while a
build kind is selected, a ghost or blocked marker on every open cell. At
`--cell: 48px` the widest tier is 672px against a 375px phone, which is why
round 3 had to add a scroll shadow. A real plat pans and zooms, and that same
surface is where a build preview belongs.

- [ ] **Canvas, with the plat drawn on it** — double rule, cartouche, compass
  rose, per-terrain textures — in grid units under one pan/zoom transform.
- [ ] **`mapview.js`, pure, with its suite.** Screen point → cell, cell →
  rect, pan clamped to content bounds, pinch midpoint → new scale. This is the
  half where a wrong answer is silent: the map still draws, it just puts the
  stall one cell over.
- [ ] **Build preview, which is the point.** `computeGroundsDraw` is a pure
  function of a plots array and the handoff already names it ready for exactly
  this: splice the candidate into a copy of `builtPlots`, call it, show the
  delta *before* the player pays. Same for foot traffic and reachability.
- [ ] **Keep the refusals, and the focus targets.** A blocked cell carries
  `isLegalPlacement`'s reason in a `title` and a canvas has no `title`, so
  that sentence needs a hover/tap readout; the DOM markers were also free
  focus targets, so keyboard cell selection and a text list of plots have to
  be built or the map becomes pointer-only.
- [ ] **Rewrite Sections 23 and 24 against the canvas, not around it.** They
  assert `.plot-marker` and `.plat-sheet` geometry and they will break; the
  44px guarantee still has to be provable through the canvas's own hit-test.
  Reintroduce each bug and watch it fail (#34).

*Leans on:* `renderGroundsPanel`/`renderGroundsMap`, `engine.js`'s pure
draw/traffic/reachability functions, `.plat-sheet`. *Save:* none — pan and
zoom are session state and belong in `main.js`'s `ui` object beside
`pendingBuild`/`pendingMove`. *Model:* **Claude Fable 5.1** — hit-test
geometry, plus a refactor that removes the DOM assertions currently serving as
its own safety net.

## Phase 7 — A third crew

**You contract performers and hire vendors, and nobody works the gate.**

`baseOverhead` is $2,200 a day and its own comment says it covers gate staff
and insurance; `perGuestCost` at $5 says it covers gate and grounds staffing
too. Both stand in for people the player never hires.

- [ ] **A `CREW` table in `data.js`** — gate staff, security, an announcer —
  with `unlockSeason` gating like every other catalog.
- [ ] **They read off the crowd, not off a flat bonus.** Gate staff raise an
  attendance ceiling, security suppresses the incident half of `EVENT_POOL`,
  an announcer shifts crowd weight between blocks.
- [ ] **They ride the existing contract catalog**, so cost is
  `effectivePerformerCost`'s shape with a third caller, not a third path.
- [ ] **Lower `baseOverhead` by what the crew now costs explicitly.** That
  moves the fixed nut the seven `SIGNIFICANCE:` checks were tuned against —
  expect at least one threshold to need re-deriving rather than nudging.
- [ ] **A `SIGNIFICANCE:` check of its own**: an unstaffed gate at a large
  attendance costs measurably more than the crew's wages, or the role is
  decoration.

*Leans on:* `CONTRACT_OPTIONS`, `engine.js`'s cost functions, `simulateDay`.
*Save:* additive — a `crew` list and `crewContracts` map, filled by `repair`.
*Model:* **Claude Opus 5** — a content table on a cost path two existing roles
already shaped.

## Phase 8 — The wiring audit, automatic

**The audit that found ten dead actions in one round and one more in the next
is a person with grep, and it has to be re-run by hand forever.**

Round 2 mapped every `data-action` against both suites and found ten
player-facing actions no test had ever clicked, plus the whole `change`/`input`
family with zero coverage. Round 3 re-ran it after round 2 called it closed
and found `cancelMove`. There are 25 distinct action names — 23 with a case in
`handleAction`, plus `schedule` and `assignVendor` on the `change` listener —
and nothing but a human knows whether each is exercised.

- [ ] **Extract the inventory.** A test that reads `js/ui.js` and `js/main.js`
  as text, collects every `data-action` literal and every `case` label, and
  asserts the two sets agree — an action with no case, or a case nothing
  emits, fails by name.
- [ ] **Extract the coverage.** Read `tests/smoke.mjs` and `play-games.mjs`'s
  `faire-weekend` block and assert every action appears in one of them.
  Read-only: a change under `Tools/` is a shared-file request.
- [ ] **An allowlist with reasons, not a coverage number** (#13 — a check that
  only prints gets ignored). `commitAll` is covered in `play-games.mjs` and
  not in `smoke.mjs`; that is fine, and the *reason* belongs beside the name.
- [ ] **Cover the other event path too** — `ticketPrice`, `schedule` and
  `assignVendor` arrive through `change`/`input`, which had no coverage at all
  until Stage 22.
- [ ] **Reintroduce both bugs** (#34): delete a `case` and watch it fail by
  name; add a `data-action` nothing clicks and watch that fail by name too.

*Leans on:* Section 22, `main.js`'s `handleAction`, `play-games.mjs`
(read-only). *Save:* none. *Model:* **Claude Opus 5** — test wiring around a
pattern Section 22 already established.

## What this leaves for a later arc

- **Sound.** Nothing here makes a noise, and a faire is loud.
- **A postcard.** The plat at poster size with `summarizeWeekend`'s figures
  stamped on it, downloadable — cheap once Phase 6's canvas exists, awkward
  before it.
- **The `.json` swap `data.js`'s own header comment promises**, so a weekend's
  content could be authored without touching code; and a first run that
  teaches, since there is no tutorial and no start screen.
- **Difficulty settings**, which want Phase 4's carryover schema first so a
  run knows what it started under.
- **Decomposing `simulateDay`.** Worth doing inside Phase 1's rewrite rather
  than as a phase of its own.
- **Anything needing a server.** Zero offsite requests is locked; every phase
  above runs entirely in the page.
