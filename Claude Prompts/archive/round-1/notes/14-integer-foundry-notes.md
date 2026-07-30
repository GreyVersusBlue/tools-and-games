# Integer Foundry, session notes

## What changed

### The finding, before the fix

**The reachable range on the opening board is 2 to 47, and a real player could be
handed an order above it from the twelfth order onwards.**

Working it out properly. A packet leaves a source as a 1 and is transformed once
per operator tile it crosses, so "what can this board make" is: what values can a
chain of unlocked operators, no longer than the cells the board can spare, take 1
to. On the opening 8x6 floor that is 48 cells, less one source and one sink, so 46
operator cells. A boustrophedon snake uses every cell, so the bound is tight rather
than optimistic. With only `+1` unlocked (the only operator that is not shop-gated)
the answer is 1 + 46 = **47**, and every integer from 2 to 47 is reachable.

The old generator was `Math.max(2, Math.floor(Math.random()*ceil)+1)` with
`ceil = Math.min(300, 5 + ordersFilled*3 + Math.floor(Math.random()*8))`. It never
looked at the board. Its largest possible roll after k orders is 12 + 3k, so:

- At 11 orders filled the worst roll is 45, still inside 47.
- **At 12 orders filled the worst roll is 48, and the floor stops at 47.**
- At 30 orders filled the ceiling is 102 and **51% of rolls are unfillable**
  (2698 out of 5000, measured).

So this is not a suite-only artifact. It needs a player who has filled twelve
orders without buying `x2`, which costs 80 ingots. Twelve orders pays roughly 300
ingots, so most players will have bought it, and buying it lifts the ceiling
straight to the 300 hard cap. But nothing forces the purchase, and I checked the
rest of the shop: `-1`, `÷2`, `Split` and `Merge +` all leave the ceiling at 47.
`Merge +` is actually slightly worse than a single chain (two lines summing over 44
shared cells gives 46, not 47). **`x2` is the only cheap escape, and skipping it
walks into unfillable orders.**

The v7 note said the problem was that "a straight 8-cell row only holds six `+1`s".
That is true and it is what the suite hit, but it understates it: a single row of 8
tops out at **7**, against a turn-one target of up to 12. A player is not limited
to one row, and that is the difference between the two bugs. The suite was building
the minimal line. The player's version of the bug is the twelfth order.

There is a second, softer version that players feel from the very first order:
nothing on screen ever said how much line an order needed. An order of 11 is eleven
`+1` tiles, and a beginner with a four-tile line just watches the sink reject
everything.

### The fix

`Projects/integer-foundry/js/targets.js`, new. The reachable set is a BFS over the
integers from 1, one step per operator tile, bounded by the board's spare cells and
by the existing 300 cap. It hands back the cheapest tile count for every value and
the chain that gets there. `rollTarget(state)` keeps the old difficulty ramp
untouched, then clamps the ceiling to what the board can build and draws from the
reachable set instead of from a bare integer range. Early play rolls what it always
did (with only `+1`, every integer up to 47 is reachable, so the clamp does not
bite); the average order is 3.5% off the old generator's, and the difference is
that the old one folded its 1 into 2 so twos came up twice as often as anything
else.

Mergers and splitters are left out of the model on purpose. They only ever add
reachable values, so an order the model admits is still buildable on a board that
has them. That direction is safe. It does mean a player who buys `Merge x` (420)
without `x2` (80) keeps getting orders capped at 47 on a floor that could reach
about 529, so orders stay easier than they need to be. That is the right way round
to be wrong.

Two knock-ons worth naming. `opBudget` divides the floor by the number of sinks
actually placed, so three sinks are not each promised the whole board. And the
sink's `title` now says what the order would take, for example "Order 47: 46
fabricators between a source and this sink. Cheapest line: 46x +1." The "Order
filled" log line names the next order too.

### Autosave

`setInterval(save, 8000)` plus a `beforeunload` is gone. `slot.autosave(getState,
700)` from `gvb-save.js` replaces it: mark dirty on every change, one write every
700 ms at most, flush on `visibilitychange` and `pagehide`. Discrete actions
(placing, rotating, erasing, buying, meltdown) mark and flush immediately. Ticks
only mark, so packets in flight are in the save without a write per tick.

The save is now under a second behind the screen instead of up to eight. **Locked
decision #39 cited this game first, and its example is no longer true of this
game.** The rule itself still stands for Closing Time and Faire Weekend, and the
Faire Weekend half of it is the sharper case anyway (a report is never on disk
while it is on screen, which no interval change fixes). See the shared-file
requests: what did *not* go away is the need to disarm the page's autosave before
writing to its key from outside, and that got harder, not easier.

Rotation now persists. Clicking a placed tile to turn it re-rendered and returned
without saving, so which way a tile pointed only reached disk when the next
interval happened to fire. Half the puzzle is directions.

### Adopting gvb-save.js

`Projects/integer-foundry/js/state.js`, new: the state shape, `validState`,
`repairState`, and the slot. Key unchanged at `integer-foundry-save-v1` (locked
decision #36). Version stays 1, because no field was renamed or reshaped; old saves
carry no stamp, `normalize()` reads that as 0, and `repair` does the work (locked
decision #37). `defaults` is the `freshState` factory, because a new game rolls an
order and a literal cannot describe that.

Three hand-rolled `localStorage` calls are gone. Nothing in the project touches
`localStorage` directly now.

**The repair-class bug I went looking for is the grid.** `cols`/`rows` and the
shape of `grid` are two records of the same fact and the old loader checked only
that `grid` was non-empty. A save whose `grid` is narrower than `cols` makes
`renderGrid` read `.type` off `undefined` and **the page dies before it draws a
single frame**. A save whose `grid` is wider silently drops the right-hand columns
of the player's factory. `repair` grows to whichever is larger and pads, which
loses nothing in either direction and matches the only shape change the game makes
on its own. Both directions are asserted.

Four more, all real:

- `unlocked` is nested, so the old shallow `Object.assign(freshState(), loaded)`
  never reached inside it. A save from before an upgrade existed came back with
  that key `undefined`. Every key is filled now.
- Two sink tiles could hold the same `sinkIndex`, sharing one order between them,
  and a sink tile could point at an index with no entry, which shows "NEEDS -" and
  makes the sink swallow packets in silence (`if(!sink) return`).
- Stored targets are clamped into the reachable set on load. Without this, a save
  already carrying an impossible order stays stuck forever, and the fix only helps
  new games.
- `prestigeMult: null` used to become `0`, not `1`, because `Number(null)` is `0`
  and passes `Number.isFinite`. A zero multiplier means every order pays nothing,
  permanently. My own test caught that one, in the code I had just written.

The save bar is mounted in the sidebar, reachable during play, not on a title
screen (v7 §9 has an open item against The Fourth Quarter for exactly that). It
mounts all three buttons, and the footer's hand-rolled "wipe save" link is gone, so
there is exactly one control on the page that erases a factory. Asserted.

One more small thing: nothing called `renderLog()` on load, so a resumed save had a
full log in storage and an empty Foundry Log panel until something new happened.

### Fonts

Three Google Fonts families vendored to `Projects/integer-foundry/fonts/`. Six
woff2, latin subset, normal style only: Inter 400/700, JetBrains Mono 400/700,
Oswald 600/700. **116,508 bytes, 114 KB for the six** (locked decision #42, and
measured, not estimated). Source and OFL 1.1 licences named in the README there.
Copied out of the `@fontsource` packages already sitting in
`Tools/board-check/node_modules`, which are the same files `harness.mjs` serves
when it shims a Google Fonts request, so an offline render and a real visitor now
get identical bytes. Nothing at runtime points at `node_modules`.

The old `@import` asked for nine weights. Three of them were never used by any
selector. One weight the CSS *does* use, Inter 700 on the three numbers in the top
bar, was never requested at all, so the browser was synthesising a fake bold from
Inter 600. That weight is real now. It is the only intentional visual difference.

**`page.__blocked` is not the check for this.** `prepPage()` fulfils Google Fonts
requests locally before the blocked list is written, so a hotlink never reaches it.
That is why v7 §5's "zero offsite requests site-wide" was wrong for fifteen pages
and the suite could not see it. My suite greps the source instead.

### Mobile

`cellPx` was `max(30, min(58, floor(560/maxDim)))`, which is 58 for every board
this game can produce: 485 px of grid for 8 columns, 696 px once both floor
expansions are bought. `body` sets `overflow-x:hidden`, so on a 375 px phone the
right-hand columns were **clipped off the screen with no way to scroll or tap
them**, and the sink is the rightmost thing most players place. It is measured from
the frame now, clamped to 18 to 58, recomputed on load, on resize and when the
floor grows, not per render. At 375x812 that is 36 px cells, all eight columns
inside the viewport, no horizontal scroll.

The sink's "NEEDS 12" label is about 44 px at 9 px mono, so at 36 px the word
crowded the number out. Below 48 px cells it shows the number alone.

The prompt called this a drag-and-place puzzle. It is click-to-place, which is why
the fix is a sizing change and not an input change.

### Files

| Path | What |
| --- | --- |
| `Projects/integer-foundry.html` | 935 to 1023 lines. Module script, vendored fonts, save panel, responsive grid |
| `Projects/integer-foundry/js/targets.js` | 199 lines. Reachable-range BFS, order generator, recipe text |
| `Projects/integer-foundry/js/state.js` | 226 lines. State shape, validate, repair, the slot |
| `Projects/integer-foundry/test/smoke-targets.mjs` | 354 lines, 90 checks, plain Node |
| `Projects/integer-foundry/test/browser.mjs` | 457 lines, 56 checks, real page |
| `Projects/integer-foundry/test/capture-legacy-save.mjs` | Wrote the fixture off the old build |
| `Projects/integer-foundry/test/fixtures/legacy-save-v0.json` | 8,620 bytes, no `__v`. Tracked, never regenerate |
| `Projects/integer-foundry/fonts/` | 6 woff2, 3 licences, README |
| `Projects/integer-foundry/README.md` | Why the split exists, how to run the suites |

The page is still at `Projects/integer-foundry.html`. The URL did not change and
the board needs no edit.

The `op` functions in the page's `TILE_DEFS` are imported from `targets.js` rather
than written out twice. The solver that promises an order is fillable and the
simulator that carries the packet have to agree, and one definition is the only way
to be sure they never drift.

## What I verified

Everything below was run after the last edit.

- `node Projects/integer-foundry/test/smoke-targets.mjs` **90 checks, 0 failed**
- `node Projects/integer-foundry/test/browser.mjs` **56 checks, 0 failed**, three
  consecutive clean runs
- `node assets/js/gvb-save.test.mjs` **39 passed, 0 failed** (unchanged, no module
  edits needed)
- `cd Tools/board-check && npm run games` **94 checks, 0 failed**, all six games
- `npm run check` **278 units, 0 broken; 0 collisions**, tightest vertical gap
  7.1 px
- `npm run social:check` **23 notices, 23 already current**

**Which `npm run games` beats broke: none.** I expected the two seeding beats to
need updating and they did not. The suite writes `sinks[0].target = 3` and neuters
`localStorage.setItem`, and both still work through `gvb-save`, because
`defaultStorage()` returns the real `localStorage` object and `store.setItem` is
resolved at call time, so it picks up the neutered function. The seeding is now
unnecessary rather than broken. That is the shared-file request below.

One caveat on `npm run check`: it reported 278 units here, 275 and 280 on earlier
runs, and one run showed 5 broken units, all of them
`Projects/corner-and-kettle/test/out/*.json`. That is another session writing and
cleaning up test output in the same repo while I ran it. Nothing of mine was
involved and the count moves for the same reason.

Locked decision #34, reintroducing the bug on purpose, twice:

- In Node, the old `randomTarget` verbatim against the new solver: **2698 of 5000
  rolls unfillable at 30 orders filled**, new generator 0 of 5000. Plus the exact
  threshold, that the twelfth order is the first that could be unfillable and the
  eleventh never could.
- In the browser, target 260 and `ordersFilled: 85` written into the save, then a
  reload: the sink comes back reading `NEEDS 47` and its tooltip says "46
  fabricators". Then 2000 rolls at 400 orders filled through the same module the
  page runs, loaded by the same browser: 0 unfillable, max 47.

Save round trip by hand, all inside `browser.mjs`:

- Play, reload, same floor, same order, log on screen.
- Export, read the bytes a download would have written, wipe through "Start over",
  import through the real file picker, factory back.
- A file with a valid envelope and a nonsense state is refused with "That is not a
  valid integer-foundry save." and the factory on screen is untouched.
- The pre-`gvb-save` fixture: nine tiles back where they were, `__v` stamped once
  the game next writes, every unlock key present.

Autosave latency asserted directly: five tiles are on disk 1.5 seconds after the
last click, and a sixth reaches the save inside 1.5 seconds too. That was up to 8
seconds.

Fonts: zero `fonts.googleapis.com` hits in the source, six faces registered and
none in `error` status, every weight the first paint needs loaded, JetBrains Mono
700 loaded once packets appear (it is `.packet` only, and `font-display:swap`
fetches lazily). One trap worth writing down: `"unloaded".endsWith("loaded")` is
`true`, and my first version of that assertion passed on a face that had not
loaded.

Mobile at 375x812: column 7 ends at 344 of 375, no horizontal scroll, 36 px cells,
and a tap on the far column places a sink.

Not verified: the `merge_mul` ceiling of about 529 is arithmetic I did not build on
the board. It does not matter for correctness, because the model being pessimistic
there can only make orders easier.

## Shared-file requests

### 1. `Tools/board-check/play-games.mjs`, the Integer Foundry suite

This is the one that matters. **Lines 94 to 107 come out**, the whole
`await p.evaluate(...)` block that writes `sinks[0].target = 3` and neuters
`localStorage.setItem`, and its five-line comment above it.

Do **not** delete lines 108 and 109 (`p.reload` and `GAMES[...].open(p)`) or the
`back === 8` assertion at 110 and 111. The reload test is still worth having and it
still covers the offline-progress branch.

Replace the payout beat at lines 113 to 124 with the block below. It reads what the
sink is asking for and builds a line that delivers exactly that, so nothing is
seeded and nothing depends on luck. Locked decision #40 says a guard-rail
satisfiable by luck gets seeded rather than retried; this takes the luck out
instead, which is the better outcome the decision points at.

**I ran this exact logic against the real page 3 times, including one run where the
order was 11, which is the case that needs the second row and the rotations.** It is
the "Filling whatever the sink asks for" group in
`Projects/integer-foundry/test/browser.mjs` if you want to see it in context.

```js
    // Fill the order the game actually asked for. Every order is now guaranteed
    // buildable on the floor the player has (Projects/integer-foundry/js/targets.js),
    // so the target does not need seeding and the outgoing page's autosave does not
    // need disarming: read the number and build a line that delivers it.
    //
    // A sink has to be on the floor before its order is on screen, so park one,
    // read it, clear it. state.sinks[0] survives the erase, so the number holds.
    await place('sink', 0, 0);
    await p.waitForSelector('#grid .cell[data-x="0"][data-y="0"].sink .sink-target');
    const want = Number((await p.$eval('.sink-target', el => el.textContent)).replace(/\D/g, ''));
    t.ok(Number.isInteger(want) && want >= 2 && want <= 12,
      'the opening order is between 2 and 12', `wants ${want}`);
    await p.click('[data-tool="erase"]');
    await p.click('#grid .cell[data-x="0"][data-y="0"]');
    await p.waitForFunction(
      () => document.querySelectorAll('#grid .cell:not(.empty)').length === 0,
      null, { timeout: 10000 });

    // A source emits 1 and every +1 adds one, so `want` needs want-1 of them. Row
    // 2 west to east, turn down at column 7, row 3 east to west: 14 operator cells
    // available, and the opening ramp never asks for more than 12.
    const chain = [];
    for (let x = 1; x <= 7 && chain.length < want - 1; x++) chain.push({ x, y: 2, dir: 'E' });
    if (chain.length < want - 1) {
      chain[chain.length - 1].dir = 'S';
      for (let x = 7; x >= 1 && chain.length < want - 1; x--) chain.push({ x, y: 3, dir: 'W' });
    }
    const last = chain[chain.length - 1];
    const sinkAt = !last ? { x: 1, y: 2 }
      : last.dir === 'E' ? { x: last.x + 1, y: last.y }
      : last.dir === 'S' ? { x: last.x, y: last.y + 1 }
      : { x: last.x - 1, y: last.y };

    await place('source', 0, 2);
    await p.click('[data-tool="add1"]');
    for (const c of chain) await p.click(`#grid .cell[data-x="${c.x}"][data-y="${c.y}"]`);
    // Clicking a placed tile with the same tool selected steps its output E>S>W>N.
    for (const c of chain) {
      const turns = c.dir === 'E' ? 0 : c.dir === 'S' ? 1 : 2;
      for (let i = 0; i < turns; i++) await p.click(`#grid .cell[data-x="${c.x}"][data-y="${c.y}"]`);
    }
    await place('sink', sinkAt.x, sinkAt.y);
    t.ok((await p.$$eval('#grid .cell:not(.empty)', els => els.length)) === want + 1,
      'built a line of exactly the right length', `for an order of ${want}`);

    const filled = await p.waitForFunction(
      () => /[1-9]/.test(document.getElementById('stat-orders').textContent),
      null, { timeout: 30000 }).then(() => true, () => false);
    await t.shot('order-filled');
    const live = await p.evaluate(() => ({
      orders: document.getElementById('stat-orders').textContent.trim(),
      ingots: document.getElementById('stat-ingots').textContent.trim(),
      log: [...document.querySelectorAll('#log div')].map(e => e.textContent.trim()),
    }));
    t.ok(filled, 'a matching packet filled the order',
      live.log.find(l => /order filled/i.test(l)) || live.log[0] || '');
    t.ok(new RegExp(`Order filled: ${want} `).test(live.log.join(' | ')),
      `the sink took a ${want}`, live.log.find(l => /order filled/i.test(l)) || '');
    t.ok(/[1-9]/.test(live.ingots), 'and the sink paid out in ingots', `${live.ingots} ingots`);
```

If you take that block, note it rebuilds the floor, so the `back === 8` reload
assertion at line 110 has to come **before** it. It already does.

Then three smaller edits in the same suite:

**Lines 126 to 129.** The nine-second wait can go, and the comment above it is now
wrong about this game. Replace with:

```js
    // The save is a debounced 700 ms behind the screen now, not an 8-second
    // interval. Still assert the save separately from the DOM (locked decision
    // #39), just without the long wait.
    await wait(1500);
```

**Line 134.** `s2.sinks[0].target !== 3` was checking against the seeded 3.
Replace with:

```js
    t.ok(s2.sinks[0].target !== want || s2.ordersFilled > 1,
      'the sink rolled a new order after filling one', `now wants ${s2.sinks[0].target}`);
```

**Lines 80 and 81.** The comment says `save()` runs on an 8-second interval. It does
not any more. The advice to read the DOM rather than the save is still right, so
just correct the reason:

```js
    // The log on screen, not the one in the save. The save is debounced rather
    // than on a timer now, so it is under a second behind rather than up to eight,
    // but locked decision #39 still holds: assert the DOM for what just happened.
```

**One thing that did NOT stop being necessary.** Any script that writes to
`integer-foundry-save-v1` from outside the page still has to disarm the page's own
autosave first, and the faster autosave made that **more** important, not less: the
race window shrank from 8 seconds to 700 ms. If a future beat seeds this save for
some other reason, the pattern is:

```js
    await p.evaluate(k => {
      const set = localStorage.setItem.bind(localStorage);   // keep the real one
      const raw = JSON.parse(localStorage.getItem(k));
      raw.whatever = 1;
      localStorage.setItem = () => {};                       // disarm, then write
      set(k, JSON.stringify(raw));
    }, 'integer-foundry-save-v1');
```

I hit this: my first version of the impossible-order beat wrote the target without
disarming and the page put the old one back before the reload.

### 2. `Tools/board-check/games.mjs`

No change needed. `open()` still only waits for `#grid .cell` and
`#tools .tool-btn`, both of which still exist and still arrive. The page is a
module script now, so it is deferred, but `waitForSelector` covers that.

### 3. `assets/js/gvb-save.js`

**No gaps found. No request.** `defaults` as a factory, `repair`, and `buttons`
were the three things The Fourth Quarter added, and this adoption needed exactly
those three and nothing more. That is a good sign for the module: the second
adopter cost it nothing.

`slot.autosave` in particular did the whole job of task two on its own, which is
the point v7 §1 was making.

### 4. `index.html`

No change needed. Same URL, same title, same description. `data-new` is the board's
call, not mine.

### 5. `assets/js/README.md`

Optional, and it is a shared file so I have not touched it. Its "Who uses it"
section names only The Fourth Quarter. Integer Foundry is the second adopter now:
key `integer-foundry-save-v1`, version 1, `defaults: freshState` as a factory,
`repair: repairState`, all three buttons, and `slot.autosave` at 700 ms.

## Deliberately not done

**Splitting the page into a folder.** Task five asked whether 935 lines should stay
one file. The arithmetic and the loader came out, because those are the parts worth
testing without a browser, and that took the page to 1023 lines (it grew, because
the fonts and the save panel are new). The simulator and the UI stayed. Moving the
page itself to `Projects/integer-foundry/index.html` would break
`/Projects/integer-foundry.html` for anyone who has it bookmarked and would need a
board `href` change, and I do not think the remaining file earns that. It is one
tick function and one renderer, and they are genuinely coupled.

**The difficulty curve.** I kept the old ramp deliberately, and only clamped it. It
is worth an opinion and I have one: the curve is linear in orders filled and the
shop is not, so there is a stretch around 15 to 30 orders where targets climb by 3
each time while `x2` has already flattened the difficulty to nothing. Changing the
ramp and clamping it in the same session would have made the clamp impossible to
attribute if the game started feeling wrong. The clamp is the bug fix. The curve is
a design change and belongs on its own.

**The splitter.** `_splitPending` picks the first neighbour in `DIRS` order that is
a non-merger fabricator with no packet, which means a splitter's second output
direction is not something the player chooses, it is whatever N/E/S/W happens to
find first. It is also stored on the cell as `_splitPending` and therefore
serialised into the save. I understood it and left it: making split directional is a
mechanic change with UI attached (it needs a second arrow), and it is not a
correctness bug, just an unpredictable one. `repair` drops `_splitPending` on load
because it is not in the cell shape, which is harmless (it is a one-tick flag).

**`applyOfflineProgress` rounding.** It credits `recentIngotsPerSec * elapsed *
0.5` with no cap relative to what the factory could actually have produced, so a
player who tears their line down before closing the tab still gets paid for four
hours of it. Left alone: it is generous rather than broken, and picking a policy is
a design call.

**A second sink on the reachability model.** `opBudget` divides the floor by placed
sinks, which is conservative but crude. Real lines share a prefix through a
splitter, so two sinks do not really halve the board. It only matters for a player
running two or three sinks with `+1` alone, where it makes orders easier than they
need to be. Wrong in the safe direction.

## Next session

Ordered by value per effort.

1. **Apply the `play-games.mjs` changes above.** Twenty minutes, and it removes the
   last save-seeding from the suite. The code is written and has been run.
2. **Adopt `gvb-save.js` in Closing Time.** Still v7's number one and still the
   right call. It is `closingTime.save.v1`, hand-rolled, no version stamp, no
   validation, and there are now two worked examples instead of one. The grid
   reconciliation bug I found here is the same shape as anything in Closing Time
   where two fields record one fact, so go looking for that specifically rather
   than only for missing fields.
3. **Move The Fourth Quarter's save bar off the start screen** (v7 §9, item 2). This
   session put Integer Foundry's in the sidebar and it took about ten lines. The box
   score next to Tomorrow's Ledger is the right home, as v7 said.
4. **Vendor the fonts on the other fourteen pages.** `aphelion`,
   `Closing Time`, `coffee_shop_sim.html`, `daredevil_r4.html`,
   `Ren-Faire-Claude`, `the-fracture-cycle.html`, `index.html` and `404.html` all
   still hotlink `fonts.googleapis.com`. 114 KB per page at the outside, less where
   families are shared, and the pattern is now written down in
   `Projects/integer-foundry/fonts/README.md`. **Correct v7 §5 while you are there:
   "zero offsite requests site-wide" was wrong, and `page.__blocked` cannot see it
   because `prepPage()` fulfils font requests locally.** A site-wide grep belongs in
   `check-integrity.mjs` so this cannot come back.
5. **The difficulty curve** (above). Now that orders are guaranteed fillable, the
   question "is this a good curve" can be asked on its own.
6. **Castle Conundrum's blurry walls** (v6 §8, v7 §11 item 3). Untouched, still the
   biggest visual win available, still needs a session.
