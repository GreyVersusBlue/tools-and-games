# Corner & Kettle tests

Four suites and an autopilot. All exit non-zero on any failure (locked
decision #13).

```
node Projects/corner-and-kettle/test/smoke-sim.mjs     318 assertions, no browser, seeded
node Projects/corner-and-kettle/test/smoke-save.mjs    230 assertions, no browser
node Projects/corner-and-kettle/test/balance.mjs       100 seeds × 30 days × 3 players, three bands, ~88 s
node Projects/corner-and-kettle/test/drive-save.mjs    135 checks, real browser
```

## `balance.mjs [runs] [--verbose] [--days N]`

Plays every seed from `0x5EED` up under the three players in `autopilot.mjs`
and prints, per prestige level and per day: offered, served, left in line,
drinks against food, gross, wages, net, accuracy, best streak, reputation
delta, and the share served before patience ran out. Then the table round 3
could not reproduce (day 10 / prestige 0, day 20 / prestige 1), the barista
fumble sweep across `trained` and `grinder`, the prestige floors at levels
0 to 6 on day 30, the staff economy, word of mouth, and the loop (Phase 7):
the same twelve seeds over 60 days, never reopening against reopening once and
spending the beans well or badly. Same seeds, same numbers, every machine.

`BAND` has three batches. Two are the **patient** player: the 30-day run
(served share, net per day, accuracy) and a stress day, day 30 at prestige 5,
where patience finally does something (served share, patience left at serve).
The third is `BAND.loop` on the **shopper**, and it holds the one question a
prestige system has to answer — a reopening is never strictly worse than not
reopening, whichever way the beans are spent, both edges floored at 1.0. It is
a guard-rail against "unplayable" and "free", not a target; the comment on it
states every measured value. `--days` shorter than 30 is a quick
look and the band still runs, but the band's stated numbers are the defaults'.

Four breaks on purpose, each caught by the rail meant for it: the patience
floor halved (`stress patienceAtServe 0.666 is below the floor 0.820` — it was
0.796 before the prestige menu made a level-5 ticket longer, so the gap got
wider, not narrower), `orderIsComplete()` returning true (`run accuracy
0.087`, and the stress day's patience rail at its "free" ceiling, because a
player who serves empty cups never makes anyone wait), prices tripled (`run
netPerDay $5,119 is above the ceiling $4,000`), and `spawnFactor()`'s prestige
floor pinned at 0.6 (`loop reopenEdge 0.984 is below the floor 1.000`, with no
payback day at all). That last one is the interesting break: removing the
+5%-per-level income instead leaves the rail at 1.051, **inside** the band. A
reopening is worth it because the door opens faster, not because the tips are
bigger.

What the loop sweep prints and does not band: spending the beans well comes to
1.069 against 1.066 for wasting them, and it says out loud that it cannot tell
those apart (locked decision #147). A shopper's income is the door, the door is
the level's spawn floor, and a Legacy unlock is worth a few hundred dollars
against a $176,000 run.

## `autopilot.mjs`

Three scripted players, one pair of hands each, a ticket line every
`HAND_MS` (800 ms, a stated assumption) on the station whose customer has the
least patience: **patient** serves on `orderIsComplete()`, **eager** the moment
the page's Serve button would enable, by calling the same
`sim.serveReadiness(slot).canServe` the page does (before Phase 3 that was
instantly for food, an empty plate at 40%), and **shopper** is patient hands plus a chalkboard spent by
`DEFAULT_PRIORITY` at every close. `spendBeans()` is the same walk over the
Legacy tree and `bestLayout()` picks the richest configuration the *next*
reopening allows — read before `prestige()`, while the level it is compared
against is still the old one. `purchase()` calls `sim.purchase()`, the
same purchase table the page's chalkboard uses (Phase 4; until then it was a
hand-kept mirror of the page's `doUnlock()`). `makeShop(seed,
mutate)` builds a shop and counts fumbles off the toasts; `playDay` and
`playRun` return rows, never print. `playRun`'s `reopen` option is how a run
plays the permanent layer: `layout(sim, state)` picks the configuration and
`spend(sim, state)` runs straight after `prestige()`, with the closing run's
beans on hand. Omit it and the reopening is exactly the one that existed before
layouts did, which is what keeps the older batches' numbers comparable.

Two things about the game it had to name: nobody walks (patience only stops
the tip, and only ticks while a customer is queued, never on a station), so
"walked" is reported as *in line at close*; and the queue cap of five throttles
the door, so "offered" is what the shop could take, not what came by.

## `smoke-sim.mjs`

Drives `../js/sim.js` with `makeRng(seed)` and `advance(dtMs)`, so a
136-second shift runs in milliseconds and runs the same way twice. Fifteen sections:
the rng; a fixed seed's fixed order sequence; every recipe built by the barista
against the ticket and the scorer; the scoring curve; `advance(136000)` once
against 8,160 frames; the timers that used to be separate; baristas on the
clock; a whole day played by a one-line autopilot; prestige; a source check
over `index.html` and the five view modules that the page has no dice or clock
of its own, decides neither the tab dots nor the Serve gate, owns no rule (no
money, cup, plate, unlock, upgrade, promotion or training written outside the
sim), never saves from `renderAll()`, and that `coffee_shop_sim.html` is a
redirect stub; and the Serve gate itself (Phase 3): every ticket line's
station and `apply()`, `serveReadiness()` line by line, the button's count
against the scorer's ratio, and the empty plate; and the two tables a click
goes through (Phase 4): every purchase type refused at $0 with a reason and no
change, bought once at exactly its quoted price, the rules the old `doUnlock()`
carried in its branches, and the station buttons, including a Frappe built by
hand in either order; staff skill, training and morale (Phase 5); regulars as a
record and word of mouth's bounds (Phase 6); and the reopening layer (Phase 7):
what a run is worth in beans, the Legacy tree refused with no beans and gated on
its parent, a bean menu unlock derived rather than stored so purchase, reopen
and reload agree, the prestige menu on and off, the board discount printed and
charged as one number, the layouts and their level gate, and the kept/lost/earned
ledger checked against what the reopening then actually does. Phase 2's
`balance.mjs` builds on the autopilot here.

Two assertions in section 15 exist because the first versions of them could not
fail (#34). `META_DISCOUNT_MAX` is checked against a second sim built on a
patched content object whose discount tiers sum to 90%, because the shipped
tree sums to 20% under a 50% cap and asserting *that* is under the cap proves
nothing. And the duplicate-requirement check names the five recipes that were
already another recipe's list — Cappuccino, Cold Brew, Nitro Cold Brew,
Affogato, Doppio (#365) — rather than asserting an empty list it could never
satisfy; reshaping one of the five fails the line and gets read.

## `smoke-save.mjs`

Drives `../js/save.js` directly under plain Node. No DOM, no dependencies.
Covers the schema: what `validate` refuses, what `migrate` reshapes, what
`repair` fills in and clamps, and the serialize/deserialize pair, plus the
permanent layer's own round trip through `toSaveData`/`applyToState` (Phase 7).

The `CATALOG` fixture at the top is a hand copy of the ids in `content.js`, and
eleven assertions check each list against the real table. Without them a new
recipe id left out of the fixture is silently dropped from every save this
suite reads, and the suite still says it passed.

Section 10 exists because of locked decision #34 — every guard-rail in `repair`
is asserted twice, once as "the repaired value is right" and once as "here is
the arithmetic that goes wrong without it". Disable a line in `repairSave` and
the failures name the bug rather than a number.

## `drive-save.mjs`

Real Chromium, real clicks, via `Tools/board-check/harness.mjs` (read-only —
same launch flags, so `requestAnimationFrame` keeps running in a window nobody
is looking at, v7 §6). Without those flags the Base and Milk progress bars never
fire their callbacks and the shift clock never advances, which reads exactly like
a broken game. It opens `/Projects/corner-and-kettle/` since Phase 4, and
section 2's offsite check reads `../index.html`, the page actually served; the
old URL is a stub.

Fourteen sections: the module script actually running, the seven vendored faces,
building and serving a drink (with the Serve cue: an
empty cup's label, S refused on it, "Serve 1/2" on a short cup, a short serve
scored at exactly 0.5, and a Frappe built by hand), the day loop through to the day-end modal, the
save round trip, export, a cleared browser restored from the file, four corrupt
files refused, a save written by the old hand-rolled writer, a hand-edited save
that used to freeze the game, New Game, the keyboard and screen-reader pass,
the reopen ledger and the Legacy board (Phase 7: the row's bean figure before
it is clicked, the ledger naming the till, day, upgrades, staff and reputation
it would take, cancelling changing nothing, picking a layout doing exactly what
the ledger said, a bean purchase leaving the till alone and reaching the save at
once, a reload holding both, and a digit over the ledger not reaching the
station tabs behind it), and 375×812.

The Node suite is blind to all of that. It would pass with a `<script>` tag that
never parsed.

### Two things that cost a run here

**The chalkboard slides in from off-screen.** New Game and the save bar sit
outside the viewport until `#chalkToggle` is clicked. Playwright still calls them
"visible" and then times out trying to click, which reads as a missing button.
Open the panel first.

**A Legacy button is ~3,100 px down a scroll panel.** A bare `page.click()` on
one lands on nothing and reports nothing, which is how section 14 first
"passed" a purchase that never happened. `clickInChalkboard()` scrolls the row
to the middle of the panel and then clicks it with the real mouse, so
hit-testing still applies. A panel translated off-screen *entirely* is a
different failure — "not clickable or not an Element" — and needs the toggle,
not a scroll.

**A modal the page owns must not be a `window.confirm`.** Section 14 installs a
`confirm` stub that records and refuses rather than leaving the real one in
place: with the real dialog a page that still reached for it hangs the click
until the CDP timeout, which is a five-minute protocol error instead of a named
assertion. Refusing also means such a page never opens the ledger, so both
checks say so plainly.

**Assertions on regulars cannot be exact key matches.** `init()` rebuilds the
queue with three random orders and each has a 1-in-8 chance of minting a new
named regular, so `Object.keys(regulars) === 'Nora'` is a coin flip in a
suit. Assert `includes`, and key a regular that must be *absent* on a name the
generator never rolls (locked decision #40).

### Artifacts

Exports and the deliberately-corrupt fixtures are written to
`<tmpdir>/corner-and-kettle-test/`, outside the repo on purpose: `npm run check`
parses every `.json` in the tree, and a corrupt fixture in here reads as a broken
unit and fails a clean repo.
