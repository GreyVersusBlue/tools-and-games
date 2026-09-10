# Faire Weekend — Feature Wishlist

**Status: twenty-two stages are shipped, three rounds of site-wide review have
run over them, and Phases 1 through 8 are done — every phase in this file.**
The suites stand at **2,118 passed** (`node tests/smoke.mjs`), **168 passed**
(`node tests/guests.mjs`), **172 passed** (`node tests/mapview.mjs`) and **136
passed** (`node tests/wiring.mjs`), 0 failed, with `play-games.mjs
faire-weekend` at 18 checks and `tools/touch-readout.mjs` at 24, 0 failed.
Every stage's plan and how it landed is in the repo root's `HISTORY.md` and in
`README.md`; nothing here repeats them. **Phase 1 closed in two increments** —
the crowd, then the economy it spends in — **Phase 2 gave the season
weather**, **Phase 3 gave the acts a story**, **Phase 4 gave the faire a life
past its season**, **Phase 5 was the layout review owed for four rounds**,
**Phase 6 made the ground a canvas and the map a view**, **Phase 7 put a crew
on the gate**, and **Phase 8 made the wiring audit a test instead of a
person**. Arc one and arc two are both closed.

**There is no open phase.** What is left is in *What this leaves for a later
arc* at the bottom of this file, and none of it is ranked on `BACKLOG.md`; a
new arc needs a row there first.

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

What it stopped being in Phase 4 is a faire that ends at its win screen: a
season closes deliberately, banks a record, and the next one opens on
renown carried whole, half the standing above the start, and the acts'
stories. What it stopped being in Phase 3 is a faire whose acts are price
lookups: every contracted
act carries a relationship the day moves, eight of them have an arc, and a
contract is a negotiation the relationship prices. What it stopped being in Phase 1 is a
spreadsheet with a plat drawn on it. The gate is still one number
(`baseAttendance × priceMult × popularityFactor × adFactor ×
groundsDraw.mult × weekendDayFactor × weatherMult × jitter`), but what that
crowd does once it is inside is four hundred agents walking the path network,
and the stalls' takings are the money those agents handed over rather than a
coefficient on the average.

## The architecture that is there

- **`js/data.js` (919)** — content only, no logic, deliberately JSON-shaped so
  it could become fetched `.json` untouched. `CONFIG` (every tunable number
  with the paragraph explaining why it is that number), `GROUNDS_DRAW`, four
  `TIME_BLOCKS` each with a `weight` and a `heat` (0.15/0.85/1.0/0.25),
  `WEEKEND_DAY_ATTENDANCE` (Fri 0.85 / Sat 1.2 / Sun 0.95), the seven-row
  `WEATHER` table with its early/late season weight ramp, a 14×10 `GRID`
  with authored `TERRAIN_ROWS`, `ENTRANCE`, three `GRID_EXPANSIONS` tiers
  (10×7 at weekend 1, 12×8 at 2, 14×10 at 4), `PLACEMENT_RULES`, and the
  catalogs: 4 structure types, 16 performers, 12 vendors, 4 campaigns, 3
  contract options, 12 events — and, from Phase 3, `RELATIONSHIP` (the
  deltas and the five tiers), `NEGOTIATION` (the commitment and fee lists
  every offer is priced off) and `ARCS` (eight subjects, sixteen beats).
  From Phase 4: the grid is 14×12 (two South Meadow rows), a fourth
  `GRID_EXPANSIONS` tier carries `unlockRenown`, the sixteenth performer
  carries one too, and `RENOWN` and `CARRYOVER` say what the second track
  pays for and what crosses a closed season. From Phase 7: `CREW` (six
  rows, three roles, a `covers` in heads), `CREW_RULES` (the gate ceiling,
  the mood a queue costs, the watch's two pressure numbers and the
  herald's pull), an `incident: true` flag on the two `EVENT_POOL` rows a
  watch is hired against, and `baseOverhead` down to 1,900.
- **`js/engine.js` (1,653)** — pure, no DOM. Fifty-odd exports: `makeRng`, the
  footprint primitives, `isLegalPlacement`, `quoteBuild`, `computeFootTraffic`,
  `computePathDistances`/`computeReachability`, `computeGroundsDraw`, the
  price-elasticity trio, `blockQualityWeights`, `totalUpkeep`,
  `checkBankruptcy`/`checkWinCondition`, the Phase 2 weather quintet
  (`weatherById`/`weatherFor`/`weatherWeightAt`/`rollWeather`/`forecastWeather`
  plus `nextCalendarDay`), the Phase 3 set (`performerFor`/`vendorFor`,
  `relationshipOf`/`relationshipTier`, `bestBlockFor`, `quoteContract` and
  `offerDiscount`, `pendingBeats`/`beatById`), the Phase 4 set
  (`renownOf`, `moodRenown`/`weekendRenown`, `isExpansionUnlocked`,
  `signingBar`, `nextRunSeed`), the Phase 7 set (`crewById`/`crewOf`/
  `crewCovers`, `gateCapacity`/`admitAtGate`/`turnedAwaySatisfactionDelta`,
  `crowdExposure`/`incidentWeightMult`/`incidentCostMult`, `announcerPull`/
  `relieveOverflow`, `effectiveCrewCost`) — and `simulateDay`, 300-odd lines
  that read all of it and return a day, its relationship deltas included.
- **`js/state.js` (1,016)** — the state object and ~28 actions, each returning
  `{ state, error }` with a *new* state. Owns the planning→commit build flow,
  performer and vendor contracts, the weekend boundary (`nextDay` parks in
  `weekendEnd`, `startNextWeekend` rolls over), and the `gameOver`/`victory`
  routes. Persistence went to `assets/js/gvb-save.js` at Stage 22: key
  `renn-faire-sim-save-v1`, everything `loadState` used to backfill now in
  `repair`, `migrate` a no-op, `defaults: newGame` as a factory. Phase 2 split
  `createInitialState(seed)` (deterministic) from `newGame()` (the one thing
  that reads the clock) — see #232 and the conventions below. Phase 3 added
  `relationships`, `arcBeats` and `actTraits` (all additive, all filled by
  `repair`), routed `contractPerformer`/`hireVendor` through `quoteContract`
  so a contract record carries its own `cancelFeeMult` and `label`, and added
  `resolveBeat`, the one writer of the last two maps. Phase 4 bumped the
  slot to version 2 and gave it a real `migrate` for the first time: a
  pre-carryover save enters as run 1 with an empty record and the mood
  renown its completed weekends earned (#243). `renown`, `carryover`,
  `tenure`, `demolished` and `lastRenown` are the new fields; `nextDay`
  ticks tenure and awards the weekend at the boundary; `closeSeason` is
  the run boundary, with `canCloseSeason`, `seasonRecord` and
  `carryoverPreview` as the pure reads the screens share with it.
  Phase 7 added `crew` and `crewContracts` (additive, filled by `repair`,
  which also prunes an id the catalog has dropped), `contractCrew` and
  `releaseCrew` — the same resolveTerms/quoteContract path the two older
  payrolls use — and one more commitment loop in `nextDay`. Crew take no
  relationship and no tenure (#256).
- **`js/ui.js` (1,156)** — state → HTML strings, eleven renderers, no listeners.
  `renderGroundsPanel` owns the plat map, status line and build palette;
  `renderFairFloor` owns plot cards and the schedule; `renderForecast` owns
  tomorrow's sky on the Office desk; `renderBackstage` owns the mood tags,
  the beat cards and the negotiation row; the four end-of-something screens
  share one ticket-stub shell, and from Phase 4 the victory screen and the
  weekend-end desk at the target weekend share `renderCarryLedger`. Phase 7 hung a third roster
  table off the Tiring House (`renderCrewTable` plus `renderCrewCoverage`,
  three gauges reading the last day actually played) and gave the ticket
  stub a `renderGateRow` that only draws on a day the fence held somebody
  back.
- **`js/main.js` (346)** — the only file that touches `document`. Holds the
  mutable state, delegates `click`/`change`/`input` off `#app`, re-renders
  after every action, mounts gvb-save's export/import bar in `#footer`; its
  `handleAction` is a 30-case switch, and `ui.negotiating` is the one piece
  of view state Backstage reads — and, from Phase 7, it carries `kind:
  'crew'` as well as `'performer'` and `'vendor'`.
- **`css/style.css` (1,244)** — the "operations room" palette and the
  surveyor's-plat map. Two width breakpoints, 1080px and 720px, and one
  pointer query: `--cell` is 46px at any width, 48px on a coarse pointer
  (#249), and the plat column is sized off `--cols` from Phase 5 (#246).
- **`tools/shoot-states.mjs` (Phase 5)** — the camera. Plays a scripted
  season under Node, writes seventeen states into the save slot, boots the
  real page in Chromium at 1280, 1080, 820 (touch) and 375 (touch), clicks
  through the desk tabs, and writes a full-page PNG per state per viewport
  into `Tools/board-check/shots/games/faire-weekend/` with a
  `measurements.json` of live rectangles beside them. `npm run shoot`, or
  `--label before` / `--label after` for a pair. Needs `playwright-core`
  (a devDependency) and a Chromium on disk (`CHROME=` overrides the
  container's path). It asserts nothing; Section 28 is the guard.
- **`tests/smoke.mjs` (4,941)** — the largest test file in the repo, 1,859
  assertions, no framework: an `assert()` counter and a `mod()` helper turning
  a path into a `file://` URL so Windows can run it. Sections 1–1g and 1i–1k
  are pure; 20, 21, 23, 24 and the first half of 28 parse `style.css` and
  `index.html` as text; 1h, 22, 25, 26, 27 and the rest of 28 build a JSDOM and re-import `js/main.js` cache-busted, which
  is a reload. **A second JSDOM steals the first one's renders** — `main.js`'s `$`
  reads `globalThis.document` — so everything a boot needs to assert has to
  happen before the next boot.

The load-bearing habit is what the layering implies: **anything worth testing
is a pure function in `engine.js` with a suite, and `main.js` is a thin wire.**
It breaks down in two places — `ui.js`, 860 lines of template literals with
real logic inside them (live re-quoting, tag thresholds, ghost-cell legality)
that only the DOM sections reach, and `simulateDay`, pure but undecomposed.

## Conventions a new builder must know

- **`data.js` has no logic, `engine.js` has no DOM, `ui.js` has no listeners,
  only `main.js` touches `document`.** That is why the whole simulation
  imports under plain Node and most of the 857 assertions cost nothing to run.
- **Every action returns a new state and an optional error**, and refuses
  *before* money moves — the four placement actions all check
  `isLegalPlacement` first.
- **Never change the storage key** (#36). It is `renn-faire-sim-save-v1`, and
  an existing save carries no `__v`, which `gvb-save.js` reads as version 0.
- **`migrate` is version drift; `repair` is every load** (#37, #50). Every
  backfill this game does — `vendorContracts`, plot `status`/`w`/`h`, the
  auto-seat pass — is content drift and lives in `repair`. Phase 4 is the
  one exception and the reason the slot is at version 2: the carryover
  tally off an old save's history runs once, in `migrate`, because run on
  every load it would overwrite what the boundary earned since (#243).
  **A test fixture written straight to storage needs `__v: 2`**, or it is
  read as a pre-Phase-4 save and its renown is re-tallied on the way in;
  Section 27's `boot` stamps it.
- **`createInitialState()` is deterministic; `newGame()` reads the clock**
  (#232). The weather seed went into the factory first and the suite refused
  it inside a minute: two fresh states built a millisecond apart got different
  skies, and every test that compares two fresh states was comparing two
  different days. Anything else that wants per-save randomness goes in
  `newGame()`, and a test that asserts determinism against code that *might*
  call `Date.now()` has to stub the clock, or it passes by luck.
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
  `SIGNIFICANCE:`.** Thirteen checks, each asserting a mechanic
  is *strategically load-bearing* rather than merely implemented. Stage 18
  shipped fully green with "build nothing, charge maximum" strictly optimal.
  Run these against every balance change — and check what state each one runs
  on before trusting a pass. Phase 1 increment 2 rewrote the economy under
  all seven of the original checks and every one still passed, because every
  state they used was a bare stage with nothing for sale. Checks 8, 9 and 10
  exist because of that, and check 11 (weather deciding which ground is the
  good ground) is deliberately asserted on mood and reputation rather than on
  the day's net, because terrain does not move attendance and the net would
  have passed under a broken weather term. Checks 12 and 13 (Phase 3) are
  that a Devoted act and a Sour one ask different money for the same terms,
  and that an arc's choice is a different day on the same seed.
- **An act's numbers are read through `performerFor`/`vendorFor`, never
  `performerById`/`vendorById`, wherever they can move** (#240). The catalog
  is content; the save's `actTraits` is where an arc's popularity, quality,
  quirk and rate changes live. `performerById` is still right for a name.
- **A relationship leaves with the act** (#235), and **a contract record
  carries its own fee and label** (#237) — read the record, not the option.
- **Verify a guard-rail by reintroducing the bug it guards** (#34). Round 3
  did it four times and caught two real mistakes before they shipped, and
  Phase 3 ran twenty-three breaks and found two assertions that did not
  fail — one crashed, one guarded dead code.
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
  weekend 6 is a satisfying place to arrive. **Partly answered by Phase 1
  increment 2:** `perGuestCost` stays at 5, ruled rather than assumed. It was
  the first candidate for absorbing the walk-based stall economy's revenue
  uplift, and SIGNIFICANCE 3 refused it — a per-head cost scales with the
  crowd whether or not anything is being sold, so at $11 a head "charge the
  maximum" is correct again on a faire with no stalls (#228). `wristbandCut`
  moved instead, 0.28 → 0.12. The other three are still open, and increment 2
  pinned one edge of the win condition: a built-out faire cannot bank $25,000
  in two weekends. **Phase 4 pinned the other edge, and it is the one that
  matters:** a scripted manager playing from a real start — building toward
  the gate, the best vendors, the biggest draws on every stage in every
  block, every beat answered, the price at the anchor — banked $28,000 to
  $104,000 by Weekend 6 across six seeds and a dozen builds, and never
  took reputation past 63 from 50. Satisfaction sits in the 60s once the
  crowd outgrows the stages (a stage near capacity drops 0.15 of quality,
  and attendance grows with the reputation the bar wants), so the cash
  bar is trivial and the reputation bar is out of reach for any manager
  that file could write. A careful human may do better; nobody has. The
  full-run test says so out loud and seeds reputation at 70. `minCash`
  and `minReputation` are the two numbers to look at together.
- ~~**Should winning end the run?**~~ *Answered by Phase 4 (#241, #242):
  winning does not end the run and closing the season is the player's
  call, from the victory screen or the weekend-end desk at Weekend 6 or
  later, with or without the win. The second track is renown.*
- ~~**Is the 1080px breakpoint a touch device?**~~ *Answered by Phase 5
  (#249): a width is not a pointer. The 721–1080 band is where every iPad
  lives, so the 38px cell is gone at every width, and the touch sizes (a
  48px cell, 44px buttons, slider and `<select>`s) hang off
  `(pointer: coarse)`, which the browser answers for itself.*
- ~~**Does the fixed `fit-content(710px)` board column bother you?**~~
  *Answered by Phase 5 (#246), and the "~54px" was an undercount: the Home
  Grounds column measured 710px with 469px of map in it, and the empty
  187px was the map's brown gap colour, not paper (#247). `main.js` sets
  `--cols` on `#board` and the column is a `calc()` off it: 525px on the
  Home Grounds, the desk 517 → 702px.*

## The standing backlog

Open and unclaimed. Add here rather than starting a new list.

**Surface**
- ~~Layout/spacing/density review, owed since Stage 20 and now four rounds
  running. Needs a browser and eyes, not arithmetic.~~ *Phase 5, with
  `tools/shoot-states.mjs` as the browser.*
- ~~`#board`'s `fit-content(710px)` cap is a fixed worst case, not adaptive;
  the 1080px breakpoint's cell size was scoped out of round 3's fix; and the
  slider and two `<select>`s have never been measured for touch size at
  all.~~ *Phase 5: #246, #249, and measured (16px, 31px, 32px on a fine
  pointer; 44px on a coarse one).*
- The plot cards are one column on a 1280 desktop: the desk is 514px on
  Deep Woods Trail and `.plot-grid`'s 240px minimum needs 491px inside
  `#content`'s 45px of padding. Thirteen cards run 1,450px tall. Phase 5
  measured it and left it, because a 220px minimum makes every card's
  three buttons wrap and gains about 20px a row; the honest fix is a
  denser card, which is a design question rather than a measurement.
- The HUD at 820px wraps its six figures into two rows (142px tall). It is
  not sticky-cost on a tablet the way the phone's was; noted, not fixed.
- The readout under the plat has a two-line floor and no ceiling, so a long
  preview on a 375px phone runs to three or four lines and pushes the build
  palette down by that much. Phase 6 increment 2 measured it (69px against a
  51px floor on a phone, 51px on a tablet) and left it: the sentence would
  have to lose the drops clause or the gate hops to fit two lines at 315px,
  and both are the parts a player is building for. A denser readout — the
  numbers as a small row rather than a sentence — is a design question, not
  a measurement.
- ~~Mobile tap targets all under 44px.~~ *Closed round 3: `--cell` 30px → 48px
  at the 720px breakpoint (exactly 44px of marker given the 2px margin), a
  `min-height: 44px` floor on the four button classes, and a scroll-shadow on
  `.plat-sheet` now that panning east is normal.*
- ~~`--vellum-faint` and `--wine` fail WCAG AA on dark panels.~~ *Closed Stage
  20; Section 20 re-runs the contrast math against hex values parsed back out
  of `style.css`.*

**Simulation**
- ~~True guest-agent/pathfinding simulation — the one fully untouched item from
  Stage 9 on.~~ *Phase 1 increment 1: `js/guests.js` walks a sampled crowd
  across the path network every block. The economy still reads Stage 22's
  coefficients; that is increment 2.*
- ~~Weather, still the obvious fit for `TIME_BLOCKS.heat`, authored per block
  and constant forever.~~ *Phase 2: a seven-row `WEATHER` table, a heat
  multiplier on every block, and an exact one-day forecast on the Office desk.
  Derived from a per-save seed and the calendar rather than the day's rng
  (#231), which is what lets the forecast exist at all.*
- The col-3 path spur is disconnected from the gate at row 3, found building
  Stage 17 and pinned by a `computePathDistances` assertion rather than fixed.
  Since Phase 1 increment 1 the day report names any built plot that fronts
  it; the ruling is Phase 1's next increment.
- `simulateDay` is 260 undecomposed lines. A drag-to-reorder move for planning
  plots is still unbuilt too.

**Content**
- A third contractable role (security, gate staff, an announcer). ~~Multi-
  weekend performer arcs; negotiation rather than a fixed rate.~~ *Phase 3:
  `ARCS` with a beat at each edge for eight acts, and `quoteContract` pricing
  every contract off a commitment, a fee and the relationship.*
- More arcs: seven performers and ten vendors have none, and every arc has
  exactly one beat per edge. The shape is in `data.js`; adding one is a row
  and the integrity suite checks it.
- The relationship deltas (`RELATIONSHIP` in `data.js`) have not been played
  through a season. Reaching Devoted takes about eight good days on the
  bill; reaching Sour takes ten days benched. Whether that is the right pace
  is a question for real play, like Q27's numbers.
- More filler for `EVENT_POOL` (12), `AD_CAMPAIGNS` (4), and the quirk set
  (four quirks across fifteen performers, one of them blank).
- ~~A second, deeper win track;~~ *Phase 4: renown, and the season that
  closes on it.* A photo-mode/postcard export off `summarizeWeekend`; a
  build-preview of a placement's effect on grounds draw.
- More renown sources. Three lines pay today (mood, acts kept, grounds
  intact) and the kept line does most of the work: a first run lands 24–32
  by Weekend 6 with the mood line firing once or twice. A weather-beaten
  weekend survived, a beat answered, a Devoted act on the bill are the
  obvious next three; the shape is `weekendRenown` and its lines.
- The `carryover.seasons` record is banked and printed on the ledger once,
  at the close. Nothing shows past seasons afterwards — a hall of closed
  seasons on the Office desk is a renderer away.

**Tooling**
- The `data-action` wiring audit is a person with grep, and it found a real
  gap in each of the last two rounds it ran. 30 distinct actions: 27 with a
  case in `main.js`'s switch, plus `schedule`, `assignVendor` and (Phase 3)
  `offerTerm` on the delegated `change` listener. Phase 3's five new actions
  are all clicked or changed in Section 26; Phase 4's one (`closeSeason`)
  is clicked from both screens in Section 27. 31 distinct actions now.
- `commitAll` is covered only in `play-games.mjs`, never in `smoke.mjs` —
  known and accepted, written down nowhere the tests can see.
- ~~`README.md` still says "783 checks" and "the 709-check suite".~~ *Fixed
  with Phase 1 increment 1: 802 + 151 across two suites.*

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

## Phase 1 — Guests who walk — **shipped, two increments**

**The crowd was one number the grounds multiplied, and nobody in it had ever
taken a step. It is four hundred agents now, and what they spend is the
stalls' takings.**

**Increment 1 (PR #191, 2026-09-08): the crowd exists and walks.** `GUESTS`
in `data.js` (four archetypes, needs, purses, affinities, and the walk's
eight tunables with a paragraph each), `js/guests.js` (pure), `tests/
guests.mjs`, `computePathRoutes()` and `pathRouteTo()` in `engine.js` with
`computePathDistances()` reading off the same tree, a `guests` block on every
day report, and a "Where the crowd went" line on the ticket stub. At most 400
agents are walked and each stands for `attendance / 400` (#223); the walk has
its own rng stream so forty seeds still roll the events they rolled before
(#224); a stall a guest cannot afford pulls nothing, and that is the one purse
rule (#225).

**Increment 2 (2026-09-08): the economy.** Ticket revenue is still
`attendance × price` — the gate charges what it charges and the walk has no
vote in it. Everything else about a stall's day is the walk's now.

- [x] **`guests.js`, pure, with its own suite.** *Increment 1.*
- [x] **Walk them.** *Increment 1.*
- [x] **Reconcile with the economy, don't replace it.** *Done (#226). A
  stall's gross is `spentAt` — money guests physically handed over, one
  arrival at a time out of purses the walk tracks — scaled by `represents`,
  with `CONFIG.wristbandCut` taken off the top. The `attendance × 0.12 ×
  quality/7 × footTraffic × reachability` line is gone and both clamped
  siting bands cap nothing now. `computeFootTraffic` survives as the
  estimate the build palette shows before the gates open (labelled "est." on
  the page); `measureFootTraffic` is its measured twin off the walk's arrival
  counts, and it is what the report carries. Both are on the ticket stub, per
  stall, beside what that stall took.*
- [x] **Fix or rule on the col-3 spur.** *Ruled (#227): the terrain gap
  stays, an already-built stall on the spur takes $0 and is named on the
  report, and building a new one is refused with its own sentence before
  money moves. Fixing the terrain was rejected — it would turn a clearing a
  save may have built on into a path tile.*
- [x] **Keep the seven `SIGNIFICANCE:` checks meaningful.** *Done, and the
  finding was that all seven passed untouched because every state they use
  is a bare stage with nobody selling anything — not one of them could see
  the stall economy. Three were added (the price trade on a faire that
  sells things, siting deciding money, and the band `wristbandCut` sets from
  both ends) and two Stage 14/17 assertions were rewritten against the new
  model. Check 3 is also what refused `perGuestCost` as the balance knob and
  sent the change to `wristbandCut` instead (#228).*
- [x] **Determinism and a fuzz block.** *Increment 1.*

**Three numbers moved and each is a locked decision:** `wristbandCut` 0.28 →
0.12 (#228), the gate taking its share of the purse before a guest reaches a
stall (#229), and `stepsPerBlock` 12 → 6 (#230, because at 12 a guest crossed
the whole season-1 grounds inside one block and gate distance cost nothing).
The ledger landed at: empty field -$1,177 a day (unchanged), day-one build
-$191 → +$248, mid faire +$2,448 → +$3,626, built-out +$7,184 → +$8,980.

*Save:* none, either increment. Guests die with the report, only aggregates
reach `history`, and no key changed.

## Phase 2 — Weather worth checking — **shipped (PR #195)**

**Every time block knew exactly how hot it was, and no two days had ever been
different. Seven skies now, drawn off the calendar rather than the day, with
tomorrow's on the desk before you commit to it.**

`TIME_BLOCKS` carries `heat` per block and `blockQualityWeights` already uses
it properly: shade's weight is `0.25 × heat` and the slack rolls into
sightline, so a hilltop stage is the best seat at Morning Procession (heat
0.15) and the worst at Afternoon (1.0). That is most of a weather system with
the weather hardcoded. Stage 22 proved the shape: a table, one term, and a
tooltip naming the number on screen.

- [x] **A `WEATHER` table in `data.js`.** *Seven rows — scorching, warm and
  clear, fair, overcast, crisp and cool, drizzle, downpour — each a name, a
  note, a heat multiplier, an attendance multiplier and a satisfaction delta,
  plus the early/late season weights. `fair` is the neutral row and is neutral
  on all three, because everything written before this phase falls back to it.*
- [x] **One roll per day.** *Done, but not off the day seed (#231). `runDay`'s
  seed is `Date.now()`-derived and generated when the gates open, so a forecast
  drawn from it could not exist. Weather is a pure function of a per-save
  `weatherSeed` and the calendar instead, stamped at the top of each day by
  `createInitialState`/`nextDay`/`startNextWeekend`. A reload shows the sky it
  showed the first time, and `simulateDay` takes no new draw from the day's own
  rng, so every seed rolls the events it rolled before.*
- [x] **`heat` becomes per-day as well as per-block.**
  *`blockQualityWeights(block, weather)`, with the shade **weight** capped
  rather than the heat (#233), so the three weights stay non-negative and
  summing to 1 for any table anyone authors. At heat ≤ 1 the arithmetic is
  identical to the pre-phase line, which is why ~850 existing assertions did
  not move.*
- [x] **A forecast one day ahead, on the Office desk.** *Exact, not a band
  (#234). Names tomorrow by weekday, carries the note and all three numbers,
  and says how much more or less of a gate that is than today.*
- [x] **A season with a shape.** *Each row's draw weight ramps linearly from
  its `early` to its `late` value across `WEATHER_SEASON_SPAN` (6) weekends and
  holds flat past the end. Weekend 1 is 48% hot days and 10% wet; weekend 6 is
  10% hot and 30% wet, with the crisp autumn day up from 4% to 19%. No row's
  weight ever reaches zero, so the ramp changes odds rather than gating
  content. The cost of all of it is a small tax with large variance: the mean
  gate multiplier runs 0.963 in weekend 1 and 0.926 in weekend 6.*
- [x] **A `SIGNIFICANCE:` check.** *Check 11. A grove stage has the happier
  crowd on the hottest authored day (53.3 against the hilltop's 45.3) and loses
  badly on the coolest (34.3 against 65.3), and the flip is worth reputation.
  Asserted on mood rather than on the day's net on purpose: terrain does not
  move attendance and satisfaction does not move today's cash, so a net-based
  version of this check would pass under a completely broken weather term.*

*Save:* additive, as planned — `weather` and `weatherSeed` on the state,
`repair` defaulting the first to fair and the second to a named constant. No
key changed. A `history` entry carries the whole `WEATHER` row rather than an
id, so a report written today still reads correctly if the table is retuned,
and a report written before this phase shows no weather row at all rather than
inventing neutral multipliers the day never ran under.

## Phase 3 — Acts with a story — **shipped (PR #197)**

**Fifteen performers, and hiring one is a price lookup.**

`CONTRACT_OPTIONS` is three rows shared by performers and vendors, and a
performer is a popularity number, a role, and at most one quirk. Nothing
anybody does on Friday changes what they cost or draw on Saturday, and the
Season Contract's only argument is its discount.

- [x] **A relationship number per contracted performer and vendor**, moved by
  what the day did: scheduled into their best block, left off the bill, sulked
  through a shared slot as a `prima_donna`, played a stage that overflowed.
  *`RELATIONSHIP` in `data.js`, `state.relationships[id]` 0-100 from neutral
  50, deltas computed in `simulateDay` and applied by `runDay`. A packed house
  pleases the act (#238); the best block is the quirk's (#236); the number
  leaves with the act (#235).*
- [x] **Arcs in `data.js`.** A beat unlocks at a relationship threshold, offers
  a choice, and changes a number — popularity, rate, a quirk gained or shed.
  *`ARCS`: eight subjects, a beat at Sour and at Devoted each, thirty-six
  choices. `resolveBeat` writes `arcBeats` and `actTraits`; the traits are
  read through `performerFor`/`vendorFor` (#240). A beat waits without
  blocking the gates (#239).*
- [x] **Negotiation instead of a price tag.** A counter-offer trading rate
  against commitment length against cancellation fee, priced through
  `effectivePerformerCost`/`effectiveVendorCost`, not a fourth cost path.
  *`quoteContract` is the one quote and the quick picks are points on its
  grid (#237); the act names its price for the terms, ±15% by relationship.*
- [x] **Two more `EVENT_POOL` entries gated on the new state**, through
  `EVENT_REQUIREMENTS` — which fails closed on an unrecognised key, so a typo
  makes an event ineligible rather than always-eligible. *`evt_encore` on a
  Devoted act, `evt_late_call` on a Sour one.*
- [x] **Backstage shows the arc** in the card idiom the roster already uses. A
  relationship the player cannot see is the `weekendDay` mistake again. *A
  mood tag on every contracted row, a `.beat-card` per pending beat, an offer
  row under the act being negotiated with, and a Backstage row on the stub.*
- [x] **Tests.** Catalog integrity for every arc beat, plus a `repair` test
  proving a pre-arc save loads with every relationship at neutral. *Section
  1j and Section 26, 1,118 → 1,652.*

*Leans on:* `PERFORMERS`/`VENDORS`/`CONTRACT_OPTIONS`/`EVENT_POOL`,
`state.js`'s `contracts`/`vendorContracts`. *Save:* additive — a
`relationships` map keyed by performer and vendor id, filled by `repair`,
plus `arcBeats` and `actTraits`. *Model:* **Claude Opus 5** — worked under
Claude Fable 5.1.

## Phase 4 — A faire that outlives its season — **shipped**

**You win by having $25,000 and 70 reputation at the end of weekend six, and
then the game politely continues doing nothing new.**

`checkWinCondition` fires once, `victoryAchieved` stops it refiring, and
`acknowledgeVictory` drops back into the ordinary weekend-end screen. After
that the sandbox is static: `GRID_EXPANSIONS` runs out at weekend 4, every
campaign and contract tier has unlocked, and weekend 12 is weekend 7 again.

- [x] **A second track with its own currency.** Standing or renown, earned by
  what cash does not measure: satisfaction held high across a weekend, an act
  kept a full season, a grounds built without demolishing anything.
  *`RENOWN` in `data.js`, `state.renown`, tallied by `weekendRenown` at the
  weekend boundary from three lines: the crowd's mood (2 at 70, 4 at 85),
  every act in its third weekend or later (1 each, up to 5), and a weekend
  closed on four or more built plots with nothing torn down this run (1).
  `tenure` and `demolished` are the two records those lines read. The HUD
  carries the number and a tooltip that says what earns it (#241).*
- [x] **A run boundary.** End a season deliberately, bank a carryover record,
  start the next one keeping something specific. *`closeSeason`, from the
  weekend-end desk or the victory screen at Weekend 6 or later, with or
  without the win (#242). It keeps renown whole, reputation as the start
  plus half of what stood above it, and the acts' stories; cash, the
  grounds, the roster and every relationship start over (#244). The next
  season's weather seed is derived from this one's, not the clock.*
- [x] **The carryover schema is the real deliverable.** Versioned, read
  through `migrate` rather than `repair` (schema drift, not content drift —
  #37), designed once, because every later phase inherits it. *`carryover`
  is `{ schema, run, seasons, startedWith }`; the slot is at version 2, the
  key unchanged; `migrateSave` builds the record for a pre-Phase-4 save and
  credits it the mood renown its completed weekends earned, once (#243).*
- [x] **Unlocks hanging off the second track**: a fourth expansion tier past
  Deep Woods Trail, a headliner who will not sign for money alone. *The
  South Meadow, 14×12, at Weekend 5 with 30 renown, two authored rows with
  a connector that stops short of the col-3 spur (#245); The Gilded Company
  of Marrow, draw 10 at $980, at 20 renown, refused before any quote is
  made.*
- [x] **The win screen becomes a ledger** — what was earned, what carries,
  what the next season starts with. *`renderCarryLedger`, on the victory
  screen and on the weekend-end desk once the season can close.*
- [x] **Tests.** A full run reaching the second win and carrying over, plus a
  migration test proving a pre-carryover save enters the new shape with an
  empty record and loses nothing. *Section 1k plays two seasons from a real
  start with a scripted manager — the first to the win, closed from the
  victory screen; the second to the South Meadow on carried renown — and
  loads a Stage 22 save, a pre-Stage-22 save and a version-1 export through
  the migration with every original key compared. Section 27 is the
  screens. 1,652 → 1,825.* **The full run seeds reputation at 70 and says
  why** — see Questions for Devon: from a real start no manager the suite
  could write cleared 63, while cash cleared the bar two to four times over.

*Leans on:* `checkWinCondition`, `startNextWeekend`/`acknowledgeVictory`,
`gvb-save.js`'s `migrate`. *Save:* the first non-additive change in this
project's history — a real `migrate`, key unchanged (#36). *Model:* **Claude
Fable 5.1** — a save schema every later phase inherits, and the one place
`migrate` stops being a no-op. Worked under Claude Fable 5.1.

## Arc two — the grounds you can touch

Arc one is about what the simulation knows; arc two is about what the player
can see and do with their hands. It opens with the oldest debt on this page —
a layout review four consecutive rounds have owed and none has paid, because
every session with a browser spent it on an assigned task — which is also the
cheapest phase here. The arc ships on arc one's terms unchanged, model named
per phase. **Ranked by impact, and the order is the recommendation**; the last
phase is an and-also for the machine rather than for the player.

## Phase 5 — The review that has been owed four rounds — **shipped**

**Nobody has ever looked at this game's layout with a real eye and a real
browser.** *Phase 5 did, with `tools/shoot-states.mjs`: 17 states × 4
viewports, before and after, and every number below is off a live
`getBoundingClientRect`.*

Stage 20 audited contrast with arithmetic because no browser was available;
round 3 measured tap targets in a live 375×812 page and fixed them. Neither is
a design review. This phase spends a browser on one deliberately.

- [x] **Shoot the states first.** *`Tools/board-check/shots/games/faire-
  weekend/{before,after}/`, 68 PNGs a set, at 1280×900, 1080×900, 820×1180
  and 375×812: four plan states across the three tabs plus a ghost-marker
  palette and an open offer row, a report, three weekend-ends, the victory
  screen and a game over. The before set was the argument: the Fair Floor
  was 1,820px wide at a 1280 viewport, Backstage 1,310, the phone 1,093.*
- [x] **Fix density where it is measurably wrong**, naming the measurement
  each time. *The three named offenders were measured and are not: a plot
  card carries at most four tags in two lines at 0.78rem, the meters are
  108×5, the sparkline 42px tall with 21 bars. What was wrong: a 187px
  brown slab east of the Home Grounds map (445px at 1080) because
  `.grounds-map` stretched to the sheet (#247); the schedule table's five
  175px `<select>`s pushing the page out to 1,820px and the roster table's
  nowrap tag setting it at 541px in a 517px desk, both now inside
  `.table-scroll` boxes (#248); a 191px sticky HUD on a 375×812 phone, now
  137 (#250); "200 guests" wrapping in the ledger; the price slider running
  19px past a 340px panel.*
- [x] **Settle the `fit-content(710px)` board column.** *Threaded: `main.js`
  sets `--cols` on `#board` and the column is
  `fit-content(calc(cols × cell + gaps + 34px + 1.4rem))`, which Section 24
  adds up from the sheet's own rules — the first draft said 32px and the
  suite caught it. Home Grounds 710 → 525px, desk 517 → 702px (#246).*
- [x] **Rule on the 1080px breakpoint's 38px cell**, and **measure the slider
  and the two `<select>`s**. *The 38px cell is gone: the band is the tablet
  band, and a 657px map pans on a sheet that already knew how. Touch
  sizes hang off `(pointer: coarse)` (#249). Measured on a fine pointer and
  left alone: slider 275×16 at 1280, 129×16 at 375; schedule `<select>`s
  175×31, offer-row 190×32 and 134×32. On a coarse pointer all are 44px
  tall, and the schedule `<select>`s are 102px wide so three stages fit.*
- [x] **Guard what you fix.** *Section 28, 34 assertions, and Sections 23
  and 24 rewritten for the rules that moved. Twenty-seven breaks, every one
  caught by the assertion whose text claims it, three of them by more than
  one (the nested `minmax` by eight).*

*Leans on:* `css/style.css`, `Tools/board-check`'s `shots/`. *Save:* none.
*Model:* **Claude Opus 5** — CSS and judgement, with a browser open.

## Phase 6 — A map you can pan, zoom and preview into — **shipped, two increments**

**The grounds are a CSS grid of DOM markers, and the fix for a phone was to
make them bigger and let the page scroll sideways.** *Increment 1 (PR #203)
made the ground a canvas and the map a view: it pans, zooms and pinches on
every width, the sheet no longer scrolls, and the markers stayed in the DOM
under the same transform (#251, #252). Increment 2 built the preview and the
readout that shows it, and the refusal, on a phone (#253, #254).*

`renderGroundsMap` emits a `.terrain-cell` per cell of the unlocked grid — 70
on Home Grounds, 140 on Deep Woods Trail — plus a marker per plot and, while a
build kind is selected, a ghost or blocked marker on every open cell. At
`--cell: 48px` the widest tier is 672px against a 375px phone, which is why
round 3 had to add a scroll shadow. A real plat pans and zooms, and that same
surface is where a build preview belongs.

- [x] **Canvas, with the plat drawn on it** — double rule, cartouche, compass
  rose, per-terrain textures — in grid units under one pan/zoom transform.
  *`js/plat.js`. The `.terrain-cell` divs are gone (70 to 168 nodes a
  render); the grid holds the gate, the plots and the ghosts and rides the
  view as a CSS transform from its own origin. The SVG compass left the
  sheet for the canvas's bottom band, with the tier's name and a scale
  bar. The "more this way" shade is painted from the view's own edges
  rather than from a scroll position.*
- [x] **`mapview.js`, pure, with its suite.** Screen point → cell, cell →
  rect, pan clamped to content bounds, pinch midpoint → new scale. This is the
  half where a wrong answer is silent: the map still draws, it just puts the
  stall one cell over. *`tests/mapview.mjs`, 172 checks. Also the rest
  rules: never above scale 1 (#247 kept), never under the pointer's floor
  (44px markers on a coarse pointer at any stage width), the stage's height
  fixed at rest so a zoom does not grow the page.*
- [x] **Build preview, which is the point.** `computeGroundsDraw` is a pure
  function of a plots array and the handoff already names it ready for exactly
  this: splice the candidate into a copy of `builtPlots`, call it, show the
  delta *before* the player pays. Same for foot traffic and reachability.
  *`previewPlacement(kind, x, y, builtPlots, excludeId)` in `engine.js`,
  pure: the candidate goes in as `status: 'built'` and, for a stall, with a
  vendor seated, because all three functions skip a planning plot and the
  draw skips an empty stall — spliced any other way every cell on the map
  reads +0.00. It returns the draw both sides, the candidate's own gate
  reach and foot traffic, and `drops`, the built plots whose own numbers
  fall to pay for it, which is the half of the trade a cost quote can never
  show. The suite checks the promise against the outcome: build the
  previewed plot for real, seat it, and the three numbers match.*
- [ ] **Keep the refusals, and the focus targets.** A blocked cell carries
  `isLegalPlacement`'s reason in a `title` and a canvas has no `title`, so
  that sentence needs a hover/tap readout; the DOM markers were also free
  focus targets, so keyboard cell selection and a text list of plots have to
  be built or the map becomes pointer-only. *Kept, by keeping the markers
  in the DOM (#251): every `title`, every focus target and every
  `data-action` is where it was, and Section 22 did not change. Increment 2
  paid the rest: a `.plat-readout` live region under the sheet takes
  whatever the pointer, a tap or the keyboard is on — a blocked cell's
  refusal, a built plot's stats, the build preview — written on
  `pointerover`, which is the event a tap fires before its click and the
  only one a phone ever gives the map (#254).*
- [x] **Rewrite Sections 23 and 24 against the canvas, not around it.** They
  assert `.plot-marker` and `.plat-sheet` geometry and they will break; the
  44px guarantee still has to be provable through the canvas's own hit-test.
  Reintroduce each bug and watch it fail (#34). *Section 23 reads the stage
  and proves the floor through `mapview.js`; Section 24 adds `FRAME` to its
  sum; Section 28's slab guard is a grid with no background; Section 29 is
  the page under gestures. Thirty-two breaks, thirty-one caught by name and
  one test rewritten because it could not tell (#147).*

*Leans on:* `renderGroundsPanel`/`renderGroundsMap`, `engine.js`'s pure
draw/traffic/reachability functions, `.plat-sheet`. *Save:* none — pan and
zoom are session state and belong in `main.js`'s `ui` object beside
`pendingBuild`/`pendingMove`. *Model:* **Claude Fable 5.1** — hit-test
geometry, plus a refactor that removes the DOM assertions currently serving as
its own safety net.

*Shipped as:* increment 1 PR #203 (Fable 5.1), increment 2 PR #205 (Opus 5 —
the model the session actually ran on; the row named Fable 5.1 and the batch
rule says to say so). Nothing was saved: pan, zoom and the readout are all
session state in `ui`.

## Phase 7 — A third crew — **shipped**

**You contracted performers and hired vendors, and nobody worked the gate.**

`baseOverhead` was $2,200 a day and its own comment said it covered gate staff
and insurance; `perGuestCost` at $5 said it covered gate and grounds staffing
too. Both stood in for people the player never hired.

- [x] **A `CREW` table in `data.js`** — six rows, three roles, two tiers each,
  every one gated by `unlockSeason` like the rest of the catalogs. `covers`
  is the one field they add and the whole design of the phase: a crew is
  worth what the crowd it covers is worth, and nothing to a faire whose crowd
  it already covers twice over.
- [x] **They read off the crowd, not off a flat bonus.** Gate staff raise the
  number of guests the fence can pass (`CREW_RULES.baseCapacity` 550, +1,300
  across both tiers); everybody past it is turned away, pays nothing, buys
  nothing and sours the crowd that got in. The watch scales both the weight
  and the bill of every `incident:`-flagged row in `EVENT_POOL`, against the
  crowd it did *not* cover above `calmCrowd`. The herald moves a block's
  overflow into the blocks with room — not toward an even quarter of the day,
  which was draft one and cost mood on a spread bill (#259).
- [x] **They ride the existing contract catalog.** One `contractedCost(act,
  contract)` with three callers replaced two copies of the same six lines,
  and `quoteContract` gained a `'crew'` kind and nothing else (#258).
- [x] **Lowered `baseOverhead` by what the crew now costs explicitly**:
  2,200 → 1,900, the gate's share of the stand-in and not the whole crew
  bill (#255). Every `SIGNIFICANCE:` check was re-run against it; the one
  that had to be re-derived was the full-run test's season-one headliner
  signing, and Section 1g's `base()` turned out to have been building
  fixtures nobody could be scheduled on since Stage 19 (#260).
- [x] **Three `SIGNIFICANCE:` checks of its own**, 14 through 16 — the
  mandated one (an unstaffed gate costs far more than the wages), its
  counterpart (a crowd let in with nowhere to stand is not a happier crowd,
  so the gate buys money and owes stages), the watch's two claims, and the
  herald's two.

*Leaned on:* `CONTRACT_OPTIONS`, `engine.js`'s cost functions, `simulateDay`.
*Save:* additive — `crew` and `crewContracts`, filled by `repair`, slot still
at version 2. *Model:* **Claude Opus 5**.

## Phase 8 — The wiring audit, automatic — DONE

Shipped as `tests/wiring.mjs`, 136 checks, run by `npm test` after the other
three suites. Decisions #262, #263 and #264.

- [x] **Extract the inventory.** The audit reads `js/ui.js` and `js/main.js`
  as text: thirty `data-action` names off the markup, thirty-three `case`
  labels off `handleAction`, three `dataset.action` branches and one
  id-matched input off the delegated change listener. An action nothing
  answers and a case nothing emits each fail by name.
- [x] **Extract the coverage.** `tests/smoke.mjs` and
  `Tools/board-check/play-games.mjs` are read as text, read-only, and every
  action has to appear in one of them. **This is why the audit is its own
  file and not a Section of `smoke.mjs`** (#262): a text scan that lives in a
  file it scans reads its own inventory back as coverage and passes forever.
- [x] **The interpolated emitter is resolved, not listed** (#263). `ui.js`'s
  three contract buttons interpolate their action name, so `contract`,
  `contractCrew` and `hireVendor` are literals nowhere; the audit finds the
  enclosing function, works out which parameter it is, and reads that
  argument off every call site. A non-literal argument fails by name, and a
  second interpolation site anywhere fails until it is resolved too.
- [x] **An allowlist that deletes itself** (#264). `placeAt` (through
  `.plot-marker.ghost[data-x][data-y]`), `offerTerm` (through
  `select[data-term=`) and `commitAll` (play-games only) each carry their
  reason, and each entry is checked from both ends — the selector has to
  still be in the suite it names, and the entry has to still be needed.
  Clicking `placeAt` by name fails the audit until its entry is deleted.
- [x] **The other event path is covered.** `ticketPrice` is matched by
  element id rather than by action, so it is inventoried separately and
  asserted both to exist in `ui.js` and to be reached by a suite.
- [x] **What it found on its first run:** `contractCrew` and `releaseCrew`,
  shipped by Phase 7 the round before, had never been clicked by anything.
  Section 22 now contracts a gate crew through its Day Rate button, lets a
  day-rate crew go for nothing, and breaks a crew's Weekend Package for the
  fee. `tests/smoke.mjs` 2,108 → 2,118.
- [x] **Broken on purpose fifteen times** (#34), including both mandated
  breaks. Two assertion wordings were wrong and were rewritten: a coverage
  loop that ran over emitted-plus-handled claimed the page emitted an action
  it did not (#147), and the resolver's spot-check named a cause that was
  false the moment a fourth call site made it fail the other way.

*Left for whoever wants it:* the audit says nothing about `data-tab`, and
nothing about whether an action's *outcome* is asserted rather than just its
click. Both are real, neither is what round 2 and round 3 kept finding.

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
