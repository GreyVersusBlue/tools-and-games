# Corner & Kettle — Feature Wishlist

**Status: arc one has shipped, Phases 1 to 4; arc two is open, Phases 5 and 6
have shipped together, and the next is Phase 7 — A reopening worth doing, on
Claude Opus 5.** The game lives at `Projects/corner-and-kettle/index.html`
now. The paragraph below is Phase 1's and is kept for the record.
The shop runs in Node now: `js/content.js` is the tables, `js/sim.js` is
everything that happens to them behind `createSim({content, rng, state,
notify})`, and `test/smoke-sim.mjs` (114/0) drives a seeded shift in
milliseconds. Three suites pass clean — `smoke-sim.mjs` 114/0, `smoke-save.mjs`
166/0, `drive-save.mjs` 90/0 and unchanged by Phase 1, which was the proof the
split changed nothing a player sees. The one open design item is still the
Serve gate, a question with numbers attached rather than a bug, and Phase 2 is
what makes those numbers reproducible. The project's history lives in the repo
root's `HISTORY.md`, under "Corner & Kettle, arc one" and the prompt rounds
before it.

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

**Phases 1 and 4 changed this; `js/README.md` is the map now.** After Phase 1
the tables were `js/content.js` (174 lines, verbatim),
the simulation is `js/sim.js` (843 lines: `makeRng`, `freshState`, `newCup`,
`createSim`), and the page's module script is 1,223 lines of rendering,
station buttons, chalkboard, `doUnlock()`, sound and save wiring. The page
builds one sim with `Math.random`, calls `sim.advance(dt)` from
`requestAnimationFrame`, and draws what `notify()` tells it to. The line numbers
below describe the file as it was when this plan was written and are kept for
the reasoning, not the addresses: what they say about *which* code was tangled
with what is still the map Phase 4 works from.

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
- **The URL moved in Phase 4.** The game is `Projects/corner-and-kettle/`, and
  `Projects/coffee_shop_sim.html` is a 49-line stub on the Daredevil precedent
  (`noindex`, `meta refresh`, `rel=canonical`, locked decision #46). The board
  card is `index.html`'s, edited in the same PR as the move now that the
  shared-file request queue is retired (#347).
- **Windows is the dev machine** (v7 §7): absolute `import()` paths go through
  `pathToFileURL`, as both suites already do. **The invocations that work,
  from the repo root:**
  `node Projects/corner-and-kettle/test/smoke-sim.mjs` → 175 passed, 0 failed;
  `node Projects/corner-and-kettle/test/smoke-save.mjs` → 166 passed, 0 failed;
  `node Projects/corner-and-kettle/test/balance.mjs` → BALANCE OK, about 22 s;
  `node Projects/corner-and-kettle/test/drive-save.mjs` → 99 checks, 0 failed;
  `node assets/js/gvb-save.test.mjs` → 50 passed, when you touch the save
  layer. `npm run games` does not cover this game.

## Questions for Devon

**Answered by the Phase 3 session, locked decision #341: the cue.** The
question and its reasoning are kept below as they were asked.

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
- ~~No seeded RNG in the page; `Math.random()` is called directly in eight places,
  so no two runs are comparable. Three uncoupled clocks.~~ Phase 1: one rng,
  one clock, `Math.random()` in the page zero times. `runProgress()` still runs
  a station's progress bar on `performance.now()`, which is a bar and not the
  game.
- ~~Round 1's `offered 41 · served 45 · net $2,353 · 99% accuracy` is
  unreproducible and internally inconsistent, and is still what every later
  round compares against. Round 3's day-10 and day-20 numbers exist only in its
  notes, from scripts that were not committed.~~ Phase 2: `test/balance.mjs`
  is the comparison now (#340).
- ~~Barista fumble chance (16% junior, 4% senior, ×0.7 trained, ×0.7 grinder) was
  judged fine analytically and never swept.~~ Phase 2 swept it: measured under
  promised everywhere, because a plain drip cannot be fumbled.

**The file**
- ~~1,978 lines in one `<script type="module">`; only the save schema is
  importable, so only the save schema has a Node test.~~ Phase 1: 1,223, and
  the sim has `smoke-sim.mjs`. Phase 4: no script left in the page; eight
  modules.
- ~~`STATION_TAB_DEFS`' `needsWork` (page) and `autoAssistStep()` (sim) re-derive
  what `getOrderRequirements()` knows — a new recipe field must be added in
  three places.~~ Phase 3: every ticket line carries its `station` and its
  `apply()`, and the dot, the button and the barista all read them (#342).
- ~~`doUnlock()` is 145 lines of `if (type === ...)`, and every branch that fails
  its affordability test falls through to `toast('Unlocked!')`: buying what you
  cannot afford says you bought it.~~ Phase 4: `PURCHASES` in `sim.js`, and a
  refusal says why (#344). ~~Training costs `300` as a bare literal in two
  places~~ (`BARISTA_TRAIN_COST` since Phase 1).
- ~~`renderAll()` writes the save synchronously on every call, barista steps
  included.~~ Phase 4: a 4 s dirty timer and immediate saves where it matters
  (#346).
- No `README.md`. ~~No `js/README.md`~~ (Phase 4). ~~`test/README.md` is
  stale~~ (current as of Phase 4).
- ~~Dead or half-wired: `state.spawnTimer` is never read;
  `spawnReplacementIfNeeded()` has an empty body; `cup._blendIce` is set by the
  blend station's "Add ice" button and read by nothing.~~ All three removed in
  Phase 1 (#331 for the button).

**Staff** — closed by Phase 5 (#348). The wage bug is fixed
(`sim.wagesDue()`), `skill: {bar, kitchen, register}` replaced `trained`/
`spec`, and morale gives fatigue a memory across days.

**Customers and prestige** — closed by Phase 6 (#349). Regulars are a record
now (`visits`, `satisfaction`, `tolerance`, `stopped`); `prestige()` keeps the
person and re-rolls the order, instead of clearing the whole list.

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

**Shipped 2026-09-13, PR #263, on Claude Fable 5.1.** The full record is
`HISTORY.md`, "Corner & Kettle, arc one", decisions #331 to #335.

- [x] **`js/content.js`.** The tables, moved verbatim, plus the sprite palette
  and `BARISTA_TRAIN_COST`. Nothing in it reads `state`, and `smoke-sim.mjs`
  checks that it never does.
- [x] **`js/sim.js`, pure, no DOM.** `createSim({content, rng, state, notify})`
  owns everything the row listed, and `scoreServe(slot)` returns `{base, tip,
  eventBonus, earned, ratio, happy, repDelta, comboBonus, regularBonus,
  shieldUsed, title}`. Also `acceptCustomer`, `releaseSlot`, `discardCup` and
  `prestige`, which were pure state and had no reason to stay.
- [x] **One clock, injected.** `sim.advance(dtMs)` pays out in `STEP_MS` steps
  with the patience tick and the served-cup clear folded in (#332, #334). The
  page calls it from rAF; the harness calls it with whatever it likes.
- [x] **One RNG, injected.** `makeRng(seed)`; the page passes `Math.random`.
  The eight direct calls are zero. Sprite colours come off the same rng (#335).
- [x] **The page becomes a caller.** `serveSlot()` keeps the toast and the
  sound; `spawnTimer` and `spawnReplacementIfNeeded()` are gone; the blend
  station's dead Add Ice button is removed (#331). The sim speaks through
  `notify()` and the page coalesces redraws to one per frame (#333).
- [x] **`test/smoke-sim.mjs`,** 114 assertions in ten sections, nine breaks on
  purpose. A one-line autopilot plays a whole day twice on one seed and gets
  the same shop; Phase 2 starts from it.
- [x] **`drive-save.mjs` unchanged and still 90/0.** Before and after, same
  environment.

*Left for later, on purpose:* `doUnlock()` and the chalkboard are still in the
page (Phase 4). `runProgress()` still times a station's progress bar on
`performance.now()`; it is a bar, not the game, and the sim does not wait on it.

## Phase 2 — `test/balance.mjs`

**Shipped 2026-09-13, on Claude Fable 5.1.** The full record is `HISTORY.md`,
"Corner & Kettle, arc one", Phase 2, decisions #336 to #340.

- [x] **`test/autopilot.mjs`.** *patient*, *eager* and *shopper* (a stated
  priority list, `DEFAULT_PRIORITY`), one pair of hands every `HAND_MS`,
  accepting in patience order. `purchase()` mirrors `doUnlock()` until Phase 4
  moves it into the sim (#339).
- [x] **`test/balance.mjs [runs]`.** 100 seeds × 30 days × three players by
  default, per day and per prestige level, `--verbose` for twelve-run detail,
  about 22 seconds. In `corner-kettle-ci.yml`.
- [x] **A declared band that fails the build.** `BAND` on two batches, the run
  and a stress day (#336), every measured value in its comment.
- [x] **Re-measured the table nobody can reproduce.** Day 10 / prestige 0:
  42.8 offered, 42.4 served, $2,126 net, 100%; day 20 / prestige 1: 46.0,
  45.9, $2,330, 100%. Round 3's counts (41/41, 46/46) are close and its dollars
  ($309, $452) are not a day's takings: 41 cups at the cheapest $30 drink is
  $1,230 before tips. Round 1's $2,353 assumed a fully-upgraded shop and is not
  this measurement either (#340).
- [x] **The two sweeps.** Fumbles measure under the promised rate at every
  setting (junior 13.4% against 16.0%, senior 3.3% against 4.0%) because a
  plain drip or americano has nothing to fumble and `baristaFumble()` returns
  false. The prestige floors never make a day unservable: level 5, the bottom
  of both, serves 96.2% of 79.9 offered on day 30, and levels 5 and 6 are the
  same day.
- [x] **Guard-rail verified by breaking it.** The patience floor halved trips
  the stress rail (0.796 against a floor of 0.82) and nothing else, which is
  the finding: on an ordinary day patience does nothing (#336). Two more
  breaks for the other rails.

*Found on the way:* nobody walks in this game, and patience ticks only in the
queue (#338); the queue cap throttles "offered" (#336).

## Phase 3 — The Serve gate, decided

**Shipped 2026-09-12, on Claude Opus 5, batched with Phase 4.** The full
record is `HISTORY.md`, "Corner & Kettle, arc one", Phase 3, decisions #341 to
#343. Q2 was answered by the session: **the cue** (#341).

- [x] **The cue.** A short cup reads `Serve 3/5`, dark amber with a gold inset,
  and its `aria-label`/`title` names every missing line off
  `getOrderRequirements()`. A cup with nothing in it is disabled and says what
  it needs first. `serveReadiness(slot)` in the sim is the one call.
- [x] **One predicate.** Every ticket line carries `station` and `apply()`; the
  tab dots are `stationsNeedingWork(slot)`, `autoAssistStep()` is the first
  unmet line's `apply()`, and the page's seven `needsWork` predicates are gone
  (#342).
- [x] **Numbers in the notes.** Patient $1,927 / 1.000 before and after (it is
  the hard gate's number); eager $1,281 / 0.590 → $1,457 / 0.719, the whole
  move being the food gate, since a script does not read a label.
- [x] **A `drive-save.mjs` beat,** plus two more: S on an empty cup, and a Frappe
  built by hand. 90 → 99.

*Found on the way:* the S key served past the disabled button; an empty plate
was servable for 40%; and a Frappe could never be completed by hand (#343), all
three fixed.

## Phase 4 — The page becomes a view

**Shipped 2026-09-12, on Claude Opus 5, in the same session as Phase 3.** A 2+
row that finished in one increment. The full record is `HISTORY.md`, "Corner &
Kettle, arc one", Phase 4, decisions #344 to #347.

- [x] **`Projects/corner-and-kettle/index.html`,** the markup and the
  stylesheet moved byte for byte (font URLs made relative), and one
  `<script type="module" src="./js/ui.js">`.
- [x] **`js/ui.js`, `js/stations.js`, `js/chalkboard.js`,** plus two leaves the
  split wanted, `js/draw.js` (sprite, cup, ticket, labels) and `js/sound.js`.
  None owns a rule, and `smoke-sim.mjs` section 10 fails if one writes money,
  a cup, a plate, an unlock, an upgrade, a promotion or training. `doUnlock()`
  is `PURCHASES` in `sim.js`, a row per kind with `cost`, `refuse` and `apply`;
  a refusal says why, and the chalkboard's `disabled` reads the same `canBuy()`
  (#344). The station buttons went the same way, `CUP_ACTIONS` (#345), which
  is how the Frappe fix got a Node test.
- [x] **`Projects/coffee_shop_sim.html` is the stub:** `noindex`, `meta
  refresh`, `rel=canonical`, the generated social block verbatim, and a comment
  saying what used to be here.
- [x] **The board, edited rather than asked** (#347). The request queue this
  line was written for is retired; `index.html`'s card, `landing.html`'s row
  and `games.mjs`'s `url` point at `Projects/corner-and-kettle/` in the same
  PR, and `social:check` reads the new page's block as current.
- [x] **`js/README.md`,** the module map, the import graph, and why
  `stations.js` and `chalkboard.js` import nothing.
- [x] **Throttle the save.** `renderAll()` marks it dirty; a 4 s timer writes it;
  serve, purchase, shift end and start, presets, mute, import and New Game write
  at once. Not `gvb-save.js`'s `autosave()`, whose flush on `pagehide` wrote a
  thrown-away shop back over a wipe and turned six browser checks red (#346).
  Measured in Chromium, three senior baristas and four busy stations for 15 s:
  13 writes before, 3 after.
- [x] **Both suites green at their existing counts.** `drive-save.mjs` 99/0
  with `PAGE` repointed and section 2 reading the new `index.html`, the one
  other line that named the old file. `balance.mjs` identical to the digit,
  with the autopilot's purchase mirror deleted (#339).

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

**Shipped 2026-09-13, on Claude Opus 5, batched with Phase 6 (Devon asked for
ranks 1 and 2 together). Decision #348.** You can no longer give Pip the day
off and still pay her.

`endShift()` used to sum `BARISTA_TIERS[b.level].wage` over every barista with
no `working` filter, and so did the chalkboard's "wages due" line. That was the
smallest symptom of a bigger gap: three hires, two tiers, one boolean and a
bar/kitchen switch was not a staff system, it was a speed upgrade with names.

- [x] **Fixed the wage bug first.** `sim.wagesDue()` is the one rule both
  `endShift()` and the chalkboard's preview read now, so they cannot drift
  apart; `smoke-sim.mjs` section 8 asserts a barista given the day off draws
  no wage, verified by reintroducing the unfiltered sum and watching it fail
  (#34).
- [x] **Per-station skill.** `skill: {bar, kitchen, register}` (0 or 1 today,
  kept as small integers so a level 2 has somewhere to go) raises speed
  (`SKILL_SPEED_MULT`) and cuts mistakes (`SKILL_MISTAKE_MULT`) on the matching
  group; `register` cuts across both. `effectiveSpec()` reads bar-only or
  kitchen-only training as a specialist, both or neither as a generalist, so
  the old `spec` switch is a consequence now, not a separate choice.
- [x] **Training costs a shift, not money.** `sim.purchase('train', id,
  group)` is free and sets `barista.training`; the whole shift runs at
  `TRAINING_SPEED_MULT`/`TRAINING_MISTAKE_MULT`, and `endShift()` resolves it
  into `skill[group] = 1` for whoever worked that day. `content.js`'s
  `TRAINING` table names each group; there is no bare literal.
- [x] **Morale.** Neutral at `MORALE_START` (70) — a fresh hire moves exactly
  like the old, morale-less barista did. It falls `MORALE_WORK_DROP` per day
  worked, rises `MORALE_OFF_GAIN` on a day off or `MORALE_RAISE_GAIN` on a
  raise (`raiseBarista`, priced by tier), and both `moraleSpeedMult()` and
  `moraleMistakeMult()` read it — wages are a lever with a downside now.
- [x] **A week view in the chalkboard:** a table per barista — tier, which
  groups are trained (and which is mid-training), morale, tomorrow's schedule
  (`working` holds until toggled, so it already answers "tomorrow"), and wage.
- [x] **`balance.mjs` bands for the staff economy:** `staffSweep()` plays one
  senior, three juniors and a trained specialist pair for 20 days straight (no
  reopen — `prestige()` clears every barista, which would erase the very thing
  being compared) and reports day 10 and day 20; `hireValueCheck()` bands "a
  hire is worth more than its wage by day 3" with hands parked (fumbleSweep's
  own convention), so the barista's own contribution is what's measured.

*What actually shipped, past the checklist:* `effectiveSpec()`, `skill`,
`morale` and `training` are exported off `createSim()` for testing.
`baristaIntervalMs(barista, group)` replaced the inline interval math in
`step()`'s barista loop — claiming a slot (`ensureBaristaClaim`) is now
separate from ticking it, so the clock can know which group's step is next
before deciding whether enough time has passed. `specBarista` is gone from
`PURCHASE_TYPES`; `train` and `raiseBarista` replaced it and `trainBarista`.
Save schema: `barista.spec`/`.trained` are replaced by `.skill`/`.morale`/
`.training`; `repairBarista()` migrates a legacy `trained: true` to both group
skills (the closest single mapping to what "trained" used to buy everywhere)
and does not migrate a legacy `spec` alone, since it carried no competence
bonus before — a specialisation preference is lost on an old save, not a
capability. `smoke-sim.mjs` 175 → 220, two new sections (13, 14 — the second
is Phase 6's); `smoke-save.mjs` 183/0; `drive-save.mjs` 90 → 100, two beats
fixed after the real-Chromium run caught what the Node suites could not (a
regular record's coin-flip visit count, and a legacy `food:true` regular
reading through the new `.order` wrapper). Also fixed on the way: a
Windows-CRLF-only bug in `smoke-sim.mjs` section 10's own source-scanning
regex, found because `git diff --stat` after an accidental `git checkout --`
mid-session showed it was pre-existing on `main`, not something this phase
broke.

## Phase 6 — Customers who remember

**Shipped 2026-09-13, on Claude Opus 5 (the wishlist named Claude Fable 5.1;
Devon's "ranks 1 and 2 together" folded it into the same Opus 5 session as
Phase 5). Decision #349.** Eight regulars used to have a favourite drink and
no memory of ever having been here.

`state.regulars` used to map a name straight to a standing order. It survived
days, prestige cleared it, and it held nothing else: no visit count, no record
of the morning you served them the wrong milk, no reason for the shop's
reputation to change who walks in. This phase made the queue a consequence of
how the shop has been run.

- [x] **A regular is a record, not a drink:** `{order, visits, lastDay,
  satisfaction, tolerance, stopped}`. Satisfaction moves
  `REGULAR_SATISFACTION_SERVE_GOOD`/`_BAD` off `happy` in `scoreServe()`;
  tolerance moves `REGULAR_TOLERANCE_STEP` the same way and multiplies their
  own `patienceMax`. Served badly `REGULAR_STOP_MIN_VISITS` times at or below
  `REGULAR_STOP_THRESHOLD`, they stop coming (`stopped: true`, excluded from
  `activeRegularNames()` but kept for the record); served well at or above
  `REGULAR_FRIEND_THRESHOLD`, a `REGULAR_FRIEND_CHANCE` roll mints a fresh
  regular off the day-one menu.
- [x] **Word of mouth.** `wordOfMouthSignal()` blends reputation and average
  regular satisfaction into one number in [-1, 1]; `wordOfMouthSpawnMult()`
  (the door) and `wordOfMouthRegularMult()` (the regular-chance roll) both
  read it, clamped to `[WORD_OF_MOUTH_MIN, WORD_OF_MOUTH_MAX]` — the one
  number that must not run away. `smoke-sim.mjs` section 14 pins a maximally
  good shop's regular multiplier at the ceiling and verifies the clamp by
  removing it and watching the number diverge to 1.5 (#34); `balance.mjs`'s
  `wordOfMouthSweep()` is the plain-language version, a good shop outdrawing a
  bad one.
- [x] **Order histories feed composition.** `state.salesHistory` (capped at
  `HISTORY_WINDOW`, written by `scoreServe()`) and `weightedPick()` nudge
  `generateOrderContent()`'s food and recipe picks toward whatever has
  recently sold, floor weight 1 so nothing unlocked is ever starved.
- [x] **Regulars survive prestige, their orders do not.** `prestige()` keeps
  every non-stopped regular's name, visit count and tolerance, re-rolls their
  order off the just-reset day-one menu, and resets satisfaction to the
  neutral start — the relationship itself is starting over.
- [x] **Said it in the UI:** the queue card shows a mood emoji
  (`regularMoodEmoji()` in `draw.js`) and visit count for a regular; the
  day-end modal lists new and lost regulars by name.
- [x] **`balance.mjs` bands,** and the guard-rail verified by breaking it
  (#34): see word of mouth above. A literal queue-occupancy sweep (sampling
  `state.queue.length`) turned out insensitive either way hands were parked —
  saturated almost immediately with hands off, near-empty with hands on — so
  the sweep measures `offered` per day instead, which is what
  `shopSpawnFactorMult()` actually moves.

*What actually shipped, past the checklist:* a save from before this phase
stored a regular's order content directly where `.order` is now, with no
wrapper — `repairRegularRecord()` reads `rec.order || rec`, so that old shape
still loads, wrapped with a fresh visit count. `activeRegularNames()` and
`wordOfMouthSignal()`/`wordOfMouthSpawnMult()`/`wordOfMouthRegularMult()` are
exported off `createSim()` for testing. Save schema: `regulars[name]` gained
`visits`, `lastDay`, `satisfaction`, `tolerance`, `stopped`, all clamped in
`repairRegularRecord()`.

*Leans on (both phases):* `js/sim.js`'s barista tick and order generation,
`js/save.js`'s barista and regular repair, `js/content.js`'s new tables and
constants, `js/chalkboard.js`'s Staff section, `js/draw.js`'s
`regularMoodEmoji()`, `js/ui.js`'s queue card and day-end modal.

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
- [x] **Repoint the registry `url`:** done in Phase 4 (#347). Still note the scheduling constraint the prompt already carries:
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
