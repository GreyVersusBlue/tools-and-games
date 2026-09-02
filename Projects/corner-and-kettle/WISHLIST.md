# Corner & Kettle — Feature Wishlist

**Status: nothing here is shipped yet. Three rounds of sessions have left the
game stable and the balance questions unanswerable — both owned suites pass
clean (`smoke-save.mjs` 166/0, verified by running it while writing this;
`drive-save.mjs` 90/0, per handoff v10 §7's own independent run), round 3's
notes close with "there is no known outstanding defect," and the one open item
is a design question with numbers attached rather than a bug. Nine phases are
open across two arcs; the first is Phase 1 — The sim without the page, on
**Claude Fable 5.1**.** Everything below is planned work, not history. The
project's history lives in `Claude Prompts/notes/12-coffee-shop-sim-notes.md`
and the two archived rounds beside it.

## What it is

A real-time coffee-shop management sim at `Projects/coffee_shop_sim.html` — one
file, 2,542 lines, one URL, no build step. Customers walk into a queue with a
patience meter; you take one to a station, build the drink across seven tabbed
stations (base, milk, blend, syrup, toppings, food, presets), and serve it. A
shift is 136 real seconds (`SHIFT_MS = PHASES.length * 34000`) split into Dawn,
Morning Rush, Afternoon and Evening, each with its own spawn interval and its
own mix of simple drinks, specialty drinks and food. At the end a modal tallies
the day, wages come out, and tomorrow is harder.

Under the counter there is more shop than the counter shows. Fifteen recipes,
four foods, four milks, five syrups, five toppings, most of them locked behind
a chalkboard that is also the whole economy: menu R&D with a three-deep
prerequisite chain (`coldbrew → nitrocoldbrew → affogato`), two espresso tiers
that unlock a recipe each as a side effect, six equipment upgrades, four
ambiance upgrades, one $5,000 business upgrade gated on 80 reputation, a
two-tier loyalty program, streak insurance, station slots 2 through 4, up to
three baristas who can be promoted, trained, specialized and given the day off,
a $120 marketing campaign, and a prestige reset from day 6 that trades
everything for a permanent +5% income per level. Reputation runs 0–100 and
shows as 1–5 stars, eight named regulars keep a standing order across days, one
of four random events fires per shift, and one of seven daily modifiers (three
of the seven slots are `null`) sets the day's flavour.

What it is not: deterministic, headless, or measurable. `Math.random()` appears
eight times, two of them inside the `rand()`/`randInt()` helpers everything
else goes through; the shift advances on `requestAnimationFrame` deltas in
`gameLoop()`; patience ticks on a separate `setInterval(tickPatience, 1000)`;
station progress bars run on `performance.now()` inside `runProgress()`. Three
clocks, none injectable. Every balance claim this
project has made came out of a human or a throwaway script sitting through a
real 136-second shift, and round 1's headline — `offered 41 · served 45 · net
$2,353 · 99% accuracy` — served more customers than it was offered and has
never been reproduced.

The save layer is the one part that is already a module:
`corner-and-kettle/js/save.js`, 371 lines, on top of the shared
`assets/js/gvb-save.js`, key `cornerKettleSave_v1`, with a `repair` pass on
every load. It was split out of the HTML for exactly one reason — so a Node
test could import it. That reason has not yet been applied to anything else.

## The architecture that is there

The single file, by its own `/* ---------- */` section comments: **24–503** the
stylesheet (seven vendored woff2 faces, a hand-written palette, nine layout
sections, no framework); **505–562** the markup, fifty-eight lines, because
everything else is built as HTML strings at runtime; **563–2540** one
`<script type="module">` — 1,978 lines, two imports, no other seams.

Inside that script, in order:

- **577–897, the content tables** (`RECIPES`, `FOODS`, `PHASES`,
  `BARISTA_TIERS`, the three shop-upgrade tables, `DAILY_MODIFIERS`,
  `RANDOM_EVENTS`, `STARTING_UNLOCKS` and the rest). Genuinely data-not-code
  and the file's best habit: a new recipe is one row. Interleaved with them,
  though, are the tuning functions that read `state` directly —
  `spawnFactor()`/`patienceFactor()` at 650/655, `shopTipMult()`,
  `shopSpawnFactorMult()`, `mistakeReduceFactor()` — so the tables cannot be
  imported without importing the live state object too.
- **898–917, the save wiring.** `CATALOG` is built *from* the tables above
  rather than written out again, so the ids `repairSave()` accepts cannot drift
  from the ids the game renders. The pattern the rest of the file should have
  copied and did not.
- **918–1015, utilities, WebAudio and the pixel sprite.** `beep()` synthesizes
  every sound; there is not one audio file in the project.
- **1016–1185, order generation,** where `getOrderRequirements()` (1138)
  returns the ordered `{label, check(slot)}` list that is simultaneously the
  ticket checklist, the barista's work queue and the scoring function. One
  source of "what does this order need" is why the three subsystems agree.
- **1186–1398, rendering.** `cupSvg()` draws the cup from the cup object;
  `renderQueue()`/`renderSlots()` rebuild their DOM as strings.
  `cupMatchesEnough()` (1392), four lines, is the Serve button's entire gate.
- **1399–1651, the stations.** `STATION_TAB_DEFS` is seven rows, each with a
  `needsWork(slot)` predicate driving the "still needed" dot — duplicating, in
  different words, the check inside `getOrderRequirements()`.
- **1652–1793, accept / release / serve.** `serveSlot()` (1689) is the economy
  in one 90-line function: accuracy ratio, `earned = price * (0.35 +
  0.65*ratio)`, tips, combo, regular bonus, daily modifier, critic and birthday
  bonuses, reputation, day stats, toast, sound. Money, morale and messaging all
  leave through one door.
- **1794–1911, the baristas.** `autoAssistStep()` performs one missing step per
  tick in ticket order, `baristaFumble()` breaks exactly one field,
  `orderIsComplete()` (1858) is the strict check, and `runBaristaTick()` claims
  the unclaimed slot with the least patience left and hands the finished cup to
  a human instead of serving it.
- **1912–2301, the chalkboard and the shop economy.** `renderChalkboard()`
  builds ~175 lines of HTML string per render; `doUnlock()` is 145 lines with
  one `if` per purchase type.
- **2302–2540, the day, the save, the master render, boot, and
  `window.__CK_DEBUG__`** — the hook the browser suite drives the game through.

The load-bearing habits, and where they stop. **Data-not-code holds for content
and fails for tuning:** recipes and upgrades are rows; spawn rate, patience,
tips, fumble chance and fatigue are functions that close over `state`. **One
requirements function, three consumers** — but `STATION_TAB_DEFS`' `needsWork`
and `autoAssistStep()` re-derive the same facts by hand, which is where a new
recipe field goes silently unchecked. **Pure module plus suite exists exactly
once:** `js/save.js` has 166 assertions across ten sections, section 10 written
for locked decision #34; nothing else is importable, so nothing else has a Node
test. **`renderAll()` is the only update path, and it writes to disk** — queue,
slots, seven stations and the whole chalkboard, then a synchronous
`JSON.stringify` and `localStorage.setItem`, called from every station click,
every serve and every barista step. Three senior baristas at 1.8s intervals is
roughly two full re-renders and two storage writes a second, all shift.
`gvb-save.js` ships an `autosave(getState, ms)` helper for exactly this, and
this project does not use it.

## Conventions a new builder must know

- **No build step, ever, and zero offsite requests.** Static files served by
  GitHub Pages from the repo root; plain ES modules, no bundler, no
  transpiler, no runtime npm dependency. Anything you add must run by being
  pushed. **Each project vendors its own copy** (locked decision #17): the
  seven faces under `corner-and-kettle/fonts/` are this project's own, not
  shared, and that is correct.
- **Never change the storage key** (locked decision #36). It is
  `cornerKettleSave_v1` and it stays that, whatever the schema does.
- **`migrate` is for version drift; `repair` is for every load** (locked
  decision #37). Save changes stay additive, get their assertions in
  `smoke-save.mjs`, and `repairSave()` unions loaded unlocks with
  `STARTING_UNLOCKS` so a save that lost `drip` cannot leave the order
  generator picking from an empty pool.
- **Build the catalog from the tables, never beside them.** `CATALOG` is
  derived from `RECIPES`/`FOODS`/`SYRUPS`/`TOPPINGS`/`MILKS` in the page, so
  the ids `repair` accepts cannot drift from the ids the game renders. New
  content joins that derivation or it is quietly rejected on load.
- **A check that only prints is a check that gets ignored** (locked decision
  #13). Both suites exit non-zero on any failure; a balance harness has to
  declare a band and fail outside it, the way
  `Projects/absalom-inheritance/test/balance.mjs` does with `BAND`.
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision
  #34). `smoke-save.mjs`'s section 10 asserts every `repairSave` rail twice —
  once as the repaired value, once as the arithmetic that goes wrong without
  it. New rails join that section or they are not verified.
- **Assert against the DOM for anything that just happened, and against the
  save only for what a reload has to survive** (locked decision #39).
- **In `drive-save.mjs`, never write a bare `page.waitForFunction(fn, null,
  opts)`** — Playwright's shape, which puppeteer-core reads as an options
  object and throws on `.polling` (locked decision #52). Use
  `waitFor`/`wait`/`textContent` from `Tools/board-check/drive.mjs`, already
  imported there. Round 3 fixed nine instances, not the eight a single-line
  grep found.
- **A timing assertion that fails under this environment's software-rendered
  Chromium is inconclusive, not confirmed** (locked decision #53) — and every
  number this project has reported came out of a real 136-second shift, which
  is exactly the measurement that environment ruins.
- **The `<head>`'s `gvb:social:start`/`end` block is generated** (locked
  decision #31). Never hand-edit inside the markers; a wrong description is a
  request against `index.html`, which belongs to prompt 22.
- **The board card and the URL belong to prompt 22.** `index.html` line 379
  points at `Projects/coffee_shop_sim.html`. A phase that moves the game to a
  directory follows the Daredevil precedent: `Projects/daredevil_r4.html` is a
  45-line stub with `noindex`, a `meta refresh`, a `rel=canonical` and a
  comment explaining itself, per locked decision #46's Schedule Browser
  pattern. The old URL keeps working and the board is asked, not edited.
- **Windows is the dev machine** (v7 §7): absolute `import()` paths go through
  `pathToFileURL`, as both suites already do. **The invocations that work,
  from the repo root:**
  `node Projects/corner-and-kettle/test/smoke-save.mjs` → 166 passed, 0 failed;
  `node Projects/corner-and-kettle/test/drive-save.mjs` → 90 checks, 0 failed;
  `node assets/js/gvb-save.test.mjs` → 50 passed, when you touch the save
  layer. `npm run games` does not cover this game.

## Questions for Devon

**Should the Serve button require full completion, now that baristas — not the
player — are the main path to a finished cup?** The gate is
`cupMatchesEnough()` at line 1392: four lines, which check that a base exists
and, if the recipe needs milk, that some milk is poured. Not the right milk,
not the syrup, not the toppings, not the shot count. Round 3 measured both
behaviours on otherwise identical days:

| | offered | served | net | avg accuracy | reputation |
| --- | --- | --- | --- | --- | --- |
| patient (waits for `orderIsComplete()`) | 41 | 41 | $309 | 100% | 50 → 66.4 |
| eager (clicks the instant `disabled` comes off) | 43 | 43 | $77 | 46% | 50 → 19.2 |

Three answers are all real: tighten the gate to `orderIsComplete()`; keep it
loose and put a cue on the button ("still missing: syrup, whip"); or leave it
exactly as it is, because the accuracy and reputation hits already are the
consequence.

**The recommendation, for what it is worth, is the cue.** `serveSlot()` already
prices partial credit deliberately — `earned = recipe.price * (0.35 + 0.65 *
ratio)` — so serving a wrong cup for 35% of the price is a designed mechanic,
not an oversight, and a hard gate would delete the one lever a player has when
four customers are about to walk. What is actually broken is that the tradeoff
is invisible at the moment of the click: the ticket shows what is missing, the
button does not care, and round 2's hand-off change put that button in front of
every order in the game instead of only hand-built ones. Phase 3 below builds
the cue and is written so it can be swapped for the hard gate in one commit if
that is the answer instead.

## The standing backlog

Open and unclaimed. Add here rather than starting a new list.

**Measurement**
- No seeded RNG in the page; `Math.random()` is called directly in eight places,
  so no two runs are comparable. Three uncoupled clocks (`gameLoop()` on rAF, `tickPatience`
  on a 1s interval, `runProgress()` on `performance.now()`), none of which can
  outrun wall-clock.
- Round 1's `offered 41 · served 45 · net $2,353 · 99% accuracy` is
  unreproducible and internally inconsistent, and is still what every later
  round compares against. Round 3's day-10 and day-20 numbers exist only in its
  notes, from scripts that were not committed.
- Barista fumble chance (16% junior, 4% senior, ×0.7 trained, ×0.7 grinder) was
  judged fine analytically and never swept.

**The file**
- 1,978 lines in one `<script type="module">`; only the save schema is
  importable, so only the save schema has a Node test.
- `STATION_TAB_DEFS`' `needsWork` and `autoAssistStep()` re-derive what
  `getOrderRequirements()` knows — a new recipe field must be added in three
  places.
- `doUnlock()` is 145 lines of `if (type === ...)`, and every branch that fails
  its affordability test falls through to `toast('Unlocked!')`: buying what you
  cannot afford says you bought it. The only real guard is the `disabled`
  attribute the chalkboard writes, i.e. the view. Training costs `300` as a
  bare literal in two places; every other price is a named constant.
- `renderAll()` writes the save synchronously on every call, barista steps
  included.
- No `README.md` and no `js/README.md`;
  `Projects/daredevil/js/README.md` is the model. `test/README.md` is stale —
  162 assertions, 83 checks and "twelve sections" against 166, 90 and thirteen.
- Dead or half-wired: `state.spawnTimer` (876) is never read;
  `spawnReplacementIfNeeded()` (1777) has an empty body and is still called
  from `tryAcceptCustomer()` at 1668; `cup._blendIce` is set by the blend
  station's "Add ice" button (1608) and read by nothing, so the button toasts
  and does nothing.

**Staff**
- A barista given the day off still costs full wage: `endShift()` and the
  chalkboard total both sum `BARISTA_TIERS[b.level].wage` over all baristas
  with no `working` filter.
- Two tiers, one axis: `trained` is a boolean, `spec` is bar/kitchen/null, no
  per-station skill, and no reason to keep a junior. Fatigue is a pure function
  of `shiftElapsed` — nothing rests, nothing carries between days.

**Customers and prestige**
- `state.regulars` stores a name and a standing order: no visit count, no
  history, no memory of being served badly. Reputation moves ±0.4/−0.8 per
  serve and gates exactly one $5,000 purchase; nothing in the spawn path reads
  it.
- `doPrestige()` resets everything for +5% income and a harder floor — no
  permanent unlock, no growing menu, nothing to look forward to. It clears
  regulars on purpose (their favourites reference syrups the reopened shop no
  longer stocks; the comment at 2282 explains it), which is right today and
  wrong once regulars have histories.

**Elsewhere**
- `npm run games` does not cover this game, though
  `Tools/board-check/games.mjs` already carries a `'corner-and-kettle'` entry
  at line 211 with a working `open()`. It is `play-games.mjs` that has no
  section, and that is prompt 22's file.
- Keyboard: digits 1–7 switch station tabs and `S` serves the focused station.
  Picks inside a station have no shortcuts and would need a per-tab legend,
  because the contents change per tab.

## Arc one — the instruments

Three rounds of sessions have produced one design question and no way to answer
it. Arc one builds for the person who has to decide whether a change made the
game better: a shop that can be run ten thousand times in Node with a seed, a
harness that prints what happened and fails the build when it drifts, the Serve
gate resolved with those numbers behind it, and a file split so that any of it
is possible.

Phases are **ranked by impact, and the order is the recommendation** — and here
it is also a dependency chain: the harness needs the sim importable, and the
Serve gate wants the harness. The model convention for this project: most
phases run on **Claude Opus 5**, and **Claude Fable 5.1** is named only where a
wrong answer would be silent — lifting a live simulation out of a DOM, a
measurement harness whose whole value is that its numbers are true, and a model
layer that feeds order composition. Every phase names its model. A phase is
*finished* only when its branch has become a pull request, that pull request
has merged to main with CI green, and its closing report names the **next open
phase's number and its named model**, so whoever runs the arc never has to open
this file to know which session to start.

## Phase 1 — The sim without the page

**Every number this game has ever reported came from a human sitting through a
real 136-second shift.**

The shop is a simulation wearing a DOM. Nothing about spawning, patience,
barista work, scoring or the economy needs a browser, but all of it reads
`state` as a module-level `let`, writes back through `renderAll()`, and takes
its time from three separate wall-clock sources. This phase gets the model out
without changing one thing a player would notice, on the precedent already in
the repo: `js/save.js` was split out for exactly this reason, and `CATALOG`
proves content can be derived rather than duplicated.

- [ ] **`js/content.js`.** The tables from lines 577–897, moved verbatim, and
  nothing that reads `state`. `SHIFT_MS`/`PHASE_MS` derive here.
- [ ] **`js/sim.js`, pure, no DOM.** `createSim({content, rng, state})` owning
  `spawnFactor`, `patienceFactor`, the `shop*Mult` helpers, `generateOrder`,
  `getOrderRequirements`, `orderIsComplete`, `autoAssistStep`, `baristaFumble`,
  `runBaristaTick`, `tickPatience`, `fireRandomEvent`, `rollDailyModifier`,
  `endShift`, `startNextDay`, and `scoreServe` — the arithmetic half of
  `serveSlot()`, returning `{earned, tip, ratio, happy, repDelta}` and touching
  no DOM.
- [ ] **One clock, injected.** `sim.advance(dtMs)` folds `gameLoop()`'s body,
  the 1-second patience tick and each barista's accumulator into one
  accumulator-driven step. The page calls it from rAF with real deltas; the
  harness calls it with 16.67 and never blocks.
- [ ] **One RNG, injected.** `makeRng(seed)`, copying the shape from
  `Projects/absalom-inheritance/js/rules.js`, replacing all eight direct
  `Math.random()` calls — `rand()`/`randInt()` take the injected one. The page
  passes `Math.random`.
- [ ] **The page becomes a caller.** `serveSlot()` keeps the toast, the sound
  and the DOM; the money comes from `scoreServe`. Delete `state.spawnTimer` and
  `spawnReplacementIfNeeded()` on the way past, and either wire `cup._blendIce`
  to something or remove its button.
- [ ] **`test/smoke-sim.mjs`,** same harness shape as `smoke-save.mjs`: a fixed
  seed gives a fixed order sequence; ticket, barista and scorer read one
  requirement list; `scoreServe` reproduces `0.35 + 0.65*ratio` at 0%, 50% and
  100%; `advance(136000)` once ends the shift exactly as 8,160 calls of 16.67
  do.
- [ ] **`drive-save.mjs` unchanged and still 90/0.** That is the whole proof
  the phase changed nothing. A beat that needs editing to pass is the bug.

*Leans on:* `js/save.js`'s precedent, `Tools/board-check/harness.mjs`.
*Save:* none — `toSaveData`/`applyToState` keep their exact shape.
*Model:* **Claude Fable 5.1** — lifting a live simulation out of a DOM without
changing observed behaviour is the case where a wrong answer is silent and the
only safety net is a browser suite that warps the clock.

## Phase 2 — `test/balance.mjs`

**"Should feel better" is not verification, and it is all this project can
currently produce.**

Absalom's `test/balance.mjs` is 117 lines and it found that the shipped build
could not be won — not "was hard," could not be won, 0% over 2,000 runs. This
project has three rounds of balance claims and no equivalent. With Phase 1's
seeded sim a full day costs milliseconds instead of 136 seconds, so the
question stops being "what happened on Tuesday" and becomes "what happens on
ten thousand Tuesdays."

- [ ] **`test/autopilot.mjs`.** Two scripted players over the sim: *patient*
  (serves only on `orderIsComplete()`) and *eager* (serves the moment
  `cupMatchesEnough()` allows), both accepting in patience order and buying
  nothing; plus *shopper*, which spends on the chalkboard by a stated priority
  list so upgrade paths can be compared.
- [ ] **`test/balance.mjs [runs]`.** Batch over seeds, reporting per day and
  per prestige level: offered, served, walked, drinks vs food, gross, wages,
  net, average accuracy, best streak, reputation delta, with twelve-run detail
  under `--verbose` the way Absalom's does.
- [ ] **A declared band that fails the build.** Export `BAND` with a comment
  saying it is a guard-rail against "unplayable" and "free", not a target, and
  stating the measured value at the time of writing; exit non-zero outside it
  (locked decision #13).
- [ ] **Re-measure the table nobody can reproduce.** Day 10 / prestige 0 and
  day 20 / prestige 1 against round 3's `41/41 · $309 · 100%` and `46/46 · $452
  · 100%`, saying plainly that round 1's `$2,353` assumed a fully-upgraded shop
  and is not the same measurement.
- [ ] **Sweep the two things nobody has swept:** fumble chance across the
  `trained` and `grinder` multipliers now that a human confirms every serve,
  and the prestige floors — `max(0.30, 0.6 - 0.06*prestigeLevel)` and
  `max(0.45, 0.75 - 0.06*prestigeLevel)` — at levels 0 through 6 on day 30,
  reporting where a day becomes unservable.
- [ ] **Guard-rail verified by breaking it** (locked decision #34): halve
  `patienceFactor()`'s floor on purpose, confirm the band fails and names the
  drop, put it back.

*Leans on:* `js/sim.js`, `Projects/absalom-inheritance/test/balance.mjs`.
*Save:* none. *Model:* **Claude Fable 5.1** — a measurement harness is worth
exactly its correctness, and a subtly wrong autopilot produces numbers that
look plausible and are lies.

## Phase 3 — The Serve gate, decided

**Round two put a four-line check in front of every order in the game and
nobody has looked at it since round one.**

`cupMatchesEnough()` asks for a base and, sometimes, milk; `serveSlot()` scores
against the full requirement list. The gap between those two is worth $232 and
54 points of accuracy on a measured day. Devon's answer sets the shape; build it, and
measure it with Phase 2 rather than by feel.

- [ ] **If the answer is the cue (recommended):** the Serve button reads
  `Serve 3/5` when the cup is short and carries a `title`/`aria-label` naming
  what is missing, straight off `getOrderRequirements()`. Style it as a
  warning, not a disabled control.
- [ ] **If the answer is the hard gate:** `canServe` becomes
  `orderIsComplete(slot)`, and the tooltip says what is missing so a disabled
  control is never mute.
- [ ] **Either way, one predicate.** `STATION_TAB_DEFS`' `needsWork` and the
  ticket checklist read the same `getOrderRequirements()` call instead of
  re-deriving it.
- [ ] **Numbers in the notes:** patient and eager autopilots, before and after,
  on the same seeds.
- [ ] **A `drive-save.mjs` beat.** Build a deliberately short cup, assert the
  button's state and text against the DOM (locked decision #39), serve, assert
  the scored ratio.

*Leans on:* `getOrderRequirements()`, `test/balance.mjs`. *Save:* none.
*Model:* **Claude Opus 5** — a predicate, a label and a test, on a question
whose hard part is Devon's answer.

## Phase 4 — The page becomes a view

**Phase 1 takes the model out; what is left is roughly 1,200 lines of
string-building and `onclick` re-binding in a file the browser has to parse
before it can show a cup.**

Daredevil made this exact move in round 2: 6,888 lines became
`Projects/daredevil/index.html` plus four modules, with a 45-line redirect stub
at the old URL per locked decision #46. Do the same here, and only now, because
the safety net is Phase 1's `smoke-sim.mjs` plus Phase 2's band plus the 90
browser checks — which is what Daredevil had before its split and what this
project does not have yet.

- [ ] **`Projects/corner-and-kettle/index.html`,** carrying the markup, the
  stylesheet and one `<script type="module" src="./js/ui.js">`.
- [ ] **`js/ui.js`, `js/stations.js`, `js/chalkboard.js`.** Render and wiring
  only; each calls into `sim.js` and none owns a rule. `doUnlock()`'s 145 lines
  become a table of purchase kinds with `cost`, `canBuy` and `apply` — which
  kills the `toast('Unlocked!')` fall-through and puts affordability in one
  place instead of in the view and the handler both.
- [ ] **`Projects/coffee_shop_sim.html` becomes the stub:** `noindex`, `meta
  refresh`, `rel=canonical`, generated social block preserved verbatim, and a
  comment saying what used to be here — copy `Projects/daredevil_r4.html`.
- [ ] **Ask, do not edit, for the board.** `index.html`'s card and
  `games.mjs`'s `url` both point at the old path; write the exact one-line
  edits into the notes' Shared-file requests, applicable blind.
- [ ] **`js/README.md`,** the module map with its import graph, on the model of
  `Projects/daredevil/js/README.md` — including why any module that must stay a
  leaf is a leaf.
- [ ] **Throttle the save.** `renderAll()` stops calling `saveState()`; use
  `gvb-save.js`'s `autosave(getState, ms)`, and save unconditionally on serve,
  on purchase and on `endShift()`.
- [ ] **Both suites green at their existing counts,** with `drive-save.mjs`'s
  `PAGE` repointed and nothing else in it touched.

*Leans on:* Phases 1–2, the Daredevil precedent, `assets/js/gvb-save.js`.
*Save:* none — the key and schema untouched, which is the point.
*Model:* **Claude Opus 5** — the model is extracted and tested by now, so what
remains is moving surface code behind a suite that will say if it broke.

## Arc two — the shop as a business

Arc one hands over instruments; arc two spends them on what the game is short
of, which is a reason to still be playing on day 20. Today the only arc is a
chalkboard that empties, and the prestige button that resets it returns +5%
income and a harder day. The staff are two tiers and a boolean, the regulars
are a name and a standing order, and the reputation number gates one $5,000
purchase and is otherwise decoration. Each phase below turns one of those into
a system with a decision in it — and every one is a balance change, which is
why they come after `balance.mjs` and not before.

Same terms as arc one: **ranked by impact, and the order is the
recommendation**; most phases on **Claude Opus 5**, **Claude Fable 5.1** only
where a silent wrong answer is possible; a phase is finished when its PR has
merged with CI green and its closing report names the next phase and its model.
Every phase that touches the save appends to it — the key never changes (locked
decision #36), and `repairSave()` gets the new rails with their section-10
assertions (locked decision #34).

## Phase 5 — Staff who have a week

**You can give Pip the day off and still pay her.**

`endShift()` sums `BARISTA_TIERS[b.level].wage` over every barista with no
`working` filter, and so does the chalkboard's "wages due" line. That is the
smallest symptom of a bigger gap: three hires, two tiers, one boolean and a
bar/kitchen switch is not a staff system, it is a speed upgrade with names.

- [ ] **Fix the wage bug first,** with a `balance.mjs` case that fails without
  the fix and a chalkboard preview that agrees with what `endShift()` charges.
- [ ] **Per-station skill.** `trained: boolean` becomes `skill: {bar, kitchen,
  register}` levels that raise speed and cut mistakes on the matching
  `STATION_TAB_DEFS` group, so `spec` is a consequence of training rather than
  a separate switch.
- [ ] **Training that costs a shift, not $300.** A barista in training works at
  reduced output that day and comes out a level up; the bare `300` literal in
  `doUnlock` and the chalkboard becomes a `TRAINING` row in `content.js`.
- [ ] **Morale.** Fatigue is per shift; morale carries across days, falls on
  long shifts, rises with days off and raises, and multiplies
  `baristaFatigueFactor()` and mistake chance — so wages become a lever with a
  downside instead of a fixed subtraction.
- [ ] **A week view in the chalkboard:** who is on tomorrow, what each costs,
  what each is trained for.
- [ ] **`balance.mjs` bands for the staff economy:** one senior versus three
  juniors versus a trained specialist pair, at day 10 and day 20, and a stated
  band that a hire is worth more than its wage by day 3.

*Leans on:* `js/sim.js`'s barista tick, `content.js`'s `BARISTA_TIERS`.
*Save:* additive — `skill`, `morale` and a schedule per barista, repaired and
clamped, with a pre-change save still loading. *Model:* **Claude Opus 5** — a
content table, a wage arithmetic fix and chalkboard UI, all measured by an
existing harness.

## Phase 6 — Customers who remember

**Eight regulars have a favourite drink and no memory of ever having been
here.**

`state.regulars` maps a name to a standing order. It survives days, prestige
clears it, and it holds nothing else: no visit count, no record of the morning
you served them the wrong milk, no reason for the shop's reputation to change
who walks in. This phase makes the queue a consequence of how the shop has been
run.

- [ ] **A regular is a record, not a drink:** `{order, visits, lastDay,
  satisfaction, tolerance}`, satisfaction moved by the served ratio, tolerance
  setting their patience multiplier. Served badly three times, they stop
  coming; served well, they bring a friend.
- [ ] **Word of mouth.** Reputation and recent satisfaction feed
  `shopSpawnFactorMult()` and the regular-chance roll, so a good week fills the
  queue and a bad one empties it. This is the one number that must not run
  away: bound it, and pin both ends in the suite.
- [ ] **Order histories feed composition.** `generateOrderContent()`'s phase
  weights take a term from what the shop has actually been selling, so a shop
  that unlocked the iced menu starts seeing iced orders without a daily
  modifier having to say so.
- [ ] **Regulars survive prestige, their orders do not.** The comment at line
  2282 is right today and wrong once a regular has a history: keep the person,
  the visit count and the tolerance, re-roll the favourite off the day-one
  menu.
- [ ] **Say it in the UI:** visit count and mood on the queue card, who came
  back and who did not in the day-end modal.
- [ ] **`balance.mjs` bands,** and a guard-rail verified by breaking it (locked
  decision #34): a bad player's queue shrinks without hitting zero, a good
  player's grows without saturating `queueMax()`; remove the word-of-mouth
  bound, watch the spawn rate diverge, put it back.

*Leans on:* `js/sim.js`'s order generation, `js/save.js`'s `repairRegular`.
*Save:* additive per-regular fields, clamped in `repairSave` with section-10
assertions; an old save's bare regulars repair to a sane starting record.
*Model:* **Claude Fable 5.1** — a feedback loop between reputation, spawn
composition and customer memory is exactly where a wrong sign produces a game
that looks fine for ten days and then dies.

## Phase 7 — A reopening worth doing

**Prestige takes your whole shop and returns five percent.**

`doPrestige()` clears unlocks, staff, upgrades, loyalty, shields and regulars,
sets `money = 60 + prestigeLevel*20`, and grants +5% income plus a harder
floor. From day 6 it is available, and from day 6 it is unattractive.

- [ ] **A permanent unlock currency,** earned per reopening from days survived
  and reputation reached, spent on a small tree: a recipe that starts unlocked,
  a starting station slot, a starting barista, a cheaper chalkboard.
- [ ] **A menu that grows across runs.** Recipes past the current fifteen,
  gated on prestige level rather than money, so reopening adds to the game
  instead of subtracting from it.
- [ ] **Shop layouts:** a named starting configuration per prestige tier
  (station count, queue capacity, one free upgrade), chosen at reopening —
  content in `content.js`, no new mechanics.
- [ ] **Tell the player what they are trading.** The reopen confirmation lists
  what is kept, lost and earned, instead of a `window.confirm` with one
  sentence.
- [ ] **`balance.mjs` across the loop:** days-to-reopen and net at prestige 0
  through 5, spent well and spent badly, and a band saying a reopening is never
  strictly worse than not reopening.

*Leans on:* `doPrestige()`, `content.js`, Phase 2's per-prestige reporting.
*Save:* additive — a `meta` record for permanent unlocks and currency, outside
the per-run fields, repaired and clamped. *Model:* **Claude Opus 5** — content
tables and a purchase tree over a save append whose shape `repairSave` already
establishes.

## Phase 8 — Both hands on the keys

**Digits switch tabs and `S` serves; everything inside a tab still needs the
mouse.**

Deferred twice for the right reason each time — the contents change per tab, so
a fixed key map needs a legend or it is a secret — and round 3 added an
argument against doing it at all, since the eager-serve finding says the game
wants a player who slows down. It belongs after Phase 3 settles what serving
means, and it belongs at all because a rush is a keyboard game.

- [ ] **Per-tab key map,** built from the tab's rendered contents rather than
  hardcoded, so an unlock does not silently shift every binding.
- [ ] **A legend that is always visible** in the station panel, showing the
  current tab's keys and updating on unlock — because legend and binding come
  from the same array.
- [ ] **`aria-keyshortcuts` on every bound control,** matching the pattern
  already on the tabs and Serve.
- [ ] **Slot focus on the keys too:** `[` and `]` move `state.focusedSlot`
  across two to four stations, since `S` already depends on it.
- [ ] **A `drive-save.mjs` beat that builds and serves a full drink with the
  keyboard alone,** asserting against the DOM, extending section 12.

*Leans on:* `STATION_TAB_DEFS`, `stationBlockHtml()`. *Save:* none.
*Model:* **Claude Opus 5** — UI wiring and a test beat around an existing
pattern.

## Phase 9 — Join `npm run games`

**The registry entry already exists; nothing reads it.**

`Tools/board-check/games.mjs` line 211 already holds a `'corner-and-kettle'`
entry with viewport, save key and a working `open()` that clicks a customer,
opens the Base station, pulls a shot and waits on `__CK_DEBUG__`. What is
missing is a section in `play-games.mjs` — prompt 22's file, so this phase is
mostly a request written well enough to apply blind.

- [ ] **Write the section as a diff in the notes' Shared-file requests:** the
  beats to assert (a cup gets a shot, a served order moves `dayStats`, a reload
  resumes the shift), the exact `GAMES['corner-and-kettle'].open(p)` call, and
  the port to reserve.
- [ ] **Prove it locally first** by running the same beats from
  `drive-save.mjs`, so the request ships tested rather than plausible.
- [ ] **Repoint the registry `url`** in the same request if Phase 4 has moved
  the page, and note the scheduling constraint the prompt already carries:
  `npm run games` opens a real visible window and Chrome throttles one that
  loses focus, so only one suite at a time.

*Leans on:* `Tools/board-check/games.mjs`, `drive-save.mjs`. *Save:* none.
*Model:* **Claude Opus 5** — test wiring around an existing pattern, most of it
written as a request rather than a commit.

## What this leaves for a later arc

- **Touch.** The suite checks that 375×812 renders; nothing checks that a
  queue card and seven station tabs are actually thumb-sized at that width.
- **Sound and art.** Every sound is a `beep()`; the customer is a 10×14 sprite
  pattern and the cup is hand-built SVG. Both fine, both the cheapest visible
  upgrade left.
- **A second shop.** `franchise` costs $5,000, says "Second Location," and
  grants +10% income. There is no second location.
- **A tutorial.** The first shift explains nothing; the chalkboard is a wall of
  prices.
- **Difficulty presets** for players who want the Morning Rush without the
  reputation stakes, now that `spawnFactor()`/`patienceFactor()` are the only
  two dials that matter.
- **Accessibility past the keyboard** — colour-blind-safe cup rendering,
  reduced motion, and a non-colour cue for the "still needed" dot.
