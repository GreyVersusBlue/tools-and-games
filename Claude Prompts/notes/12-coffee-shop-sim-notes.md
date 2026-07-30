# Corner & Kettle — session notes

First session this game has ever had. Both concrete tasks are done: the three
Google Fonts hotlinks are gone, and persistence runs through `assets/js/gvb-save.js`.
Adopting the module found seven ways a save could break the game. Four of them are
the same shape as the Fourth Quarter's walking-speed bug but one level further
down, inside `presets[].cup` and `regulars[name]`, which the old loader copied out
of the blob without looking at.

## What changed

**`Projects/coffee_shop_sim.html`**, 2,418 to 2,509 lines, 95 KB to 96.6 KB. Still
one file, still at the same URL. Four things:

The two `<link>` tags at lines 24 and 25 are gone, replaced by seven `@font-face`
rules pointing at `corner-and-kettle/fonts/`. Grep for `fonts.googleapis.com` now
returns 0.

The inline `<script>` is now `<script type="module">`. Nothing in the HTML depended
on the script's names being global (no inline `onclick` anywhere, every handler is
assigned in JS), so this was a one-word change. It buys the two relative imports.

`saveState()`, `loadState()` and `clearSave()`, 72 lines of hand-rolled
`localStorage` with a bare `try{}catch(e){}` around each call, are replaced by four
lines that call the slot. The page makes **zero direct `localStorage` calls** now.
That matters more than it sounds. The old code's comment said
`/* localStorage unavailable — ignore */`, which was the right intent, but in a
browser configured to block storage it is *reading the property* that throws, and
the old `try` started after that. It would never have fallen back to anything.
gvb-save probes instead of guessing.

Three small things while I was in there. `STARTING_UNLOCKS` is defined once instead
of the same four array literals appearing in both the state initializer and
`doPrestige()`. `freshDayStats()` replaces three copies of an eleven-field literal.
And `doPrestige()` now clears `state.regulars`, for the reason below.

**`Projects/corner-and-kettle/js/save.js`**, new, 360 lines. The save schema only:
key, version, `validate`, `migrate`, `repair`, and the `toSaveData` / `applyToState`
pair. Imports `../../../assets/js/gvb-save.js` relatively so the Node test resolves
it.

This is the answer to "should the 2,418-line file be split", and it is a smaller
answer than the prompt expected. See Deliberately not done. The save schema is the
part with rules worth asserting, so it is the part that had to become importable.
Nothing else moved, so `/Projects/coffee_shop_sim.html` still resolves and there is
no board request.

**`Projects/corner-and-kettle/fonts/`**, new. Seven woff2 faces, **121.6 KB
(124,488 bytes) for the set**, plus a README naming source and licence the way
`golden-hour-beach/assets/textures/` does. Latin subsets from
`@fontsource/kalam@5.3.0`, `@fontsource/quicksand@5.3.0` and
`@fontsource/space-mono@5.3.0`, copied byte-for-byte out of the npm tarballs. All
three families are OFL 1.1.

Reading the CSS to pick weights turned up that **the hotlink was wrong in both
directions on Quicksand.** It asked for `wght@500;600;700`. Nothing in the page sets
`font-weight:500`, and 400 was never requested, despite being the weight of `body`,
`.draghint`, the day-summary rows and every unstyled run of text on the page. Chrome
was rendering the body copy from the 500 face. The vendored set is 400/600/700, so
the body text is now the weight the CSS actually asks for. Kalam and Space Mono are
400/700, both used.

**`Projects/corner-and-kettle/test/`**, new. Two suites, both non-zero on failure,
plus a README. 162 and 90 assertions. Details under What I verified.

### The bugs adopting it found

The prompt said to go looking for this game's version of the walking-speed bug and
that it is the part people skip. It is here, and it is not at the top level.

Every top-level scalar the old `loadState()` read was already guarded. `day`,
`money`, `reputation`, `prestigeLevel` and the rest all had a `typeof` check or an
explicit default. **The two nested objects had none.** `presets` and `regulars` were
assigned straight out of the parsed blob after nothing more than an `Array.isArray`
or `typeof === 'object'` check, and both feed arithmetic and spreads:

1. **`presets[].cup.shots` missing gives a drink that can never be finished.**
   `applyPreset` copies the saved cup field by field onto the live cup, so `shots`
   lands as `undefined`. The Base station then does `cup.shots++`, which is `NaN`,
   and the requirement check is `cup.shots >= r.shots`. `NaN >= 1` is false forever.
   The ticket's base line can never be ticked off no matter how many shots you pull.
   No error, no crash. Exactly v7 §2's floor NPC that never arrives anywhere.
2. **`presets[].cup.toppings` missing makes the preset silently do nothing.**
   `applyPreset` does `[...src.toppings]`, which throws. Thrown inside a click
   handler, so it never reaches the caller. It surfaces as an uncaught window error
   and the button just appears dead.
3. **`regulars[name].custom` missing kills the game loop.** `cloneOrderContent` does
   `[...content.custom.toppings]`, and it runs inside `generateOrder()` inside
   `spawnCustomer()` inside the `requestAnimationFrame` loop. One malformed regular
   takes the whole loop down on their next visit: clock stopped, no spawns, nothing
   on screen to say why.
4. **`regulars[name].recipeId` pointing at a recipe that no longer exists.**
   `RECIPES.find()` returns `undefined` and `.base` throws, same loop, same result.
   Repair drops that regular instead, so it costs a lost favourite rather than a
   lost shop.
5. **`loyaltyLevel` was never clamped.** `LOYALTY_UPGRADES[loyaltyLevel-1]` is
   indexed on every serve *and* every spawn against a two-entry table. Level 3
   throws in the rAF loop.
6. **`stationCount` was checked for `>= 2` but not for being an integer.**
   `new Array(2.5)` throws a RangeError, which the old loader's outer `try` swallowed
   by returning false, so a fractional station count silently threw the entire save
   away and started you at day 1.
7. **An emptied unlock array.** `generateOrderContent` picks with
   `rand(simplePool.length ? simplePool : pool)`, and `rand([])` is `undefined`.
   `repair` unions every unlock list back against `STARTING_UNLOCKS`.

The older `food: true` order flag is also handled. The state comment at what was
line 799 documents an order shape using `food` where the current code uses `isFood`,
and a regular saved under the old name would have fallen into the drink branch and
hit bug 3.

**One bug that is not about loading at all.** `doPrestige()` reset `unlockedSyrups`
and `unlockedToppings` to the day-one menu but kept `state.regulars`. So after
reopening, Nora could still walk in wanting peppermint syrup and sprinkles, her
ticket would list both, and the player had no button for either, because the syrup
and topping stations only render unlocked ids. A permanently unservable-at-100%
regular. Regulars are cleared on prestige now and re-roll a favourite off the
current menu.

### Where the save bar went

The chalkboard, under New Game, with `buttons: ["export", "import"]`. The game has
shipped its own "🗑️ New Game" since long before this module existed, and mounting
"Start over" beside it is the exact thing the `buttons` option exists to prevent.

v7 §9 left an item open because the Fourth Quarter's bar is only on its start
screen. The chalkboard is one click from anywhere in a shift, which beats the
day-end modal: the modal only exists for a few seconds a day, and its body is
rebuilt with `innerHTML` every night, so a bar mounted there would need re-mounting.
So v7 §9's second open item is answered for this game rather than carried.

### Two accessibility gaps, both one-liners

**Every piece of feedback this game gives is a toast**: what was served, what it
paid, the combo bonus, an event firing. `#toastWrap` had no live region, so a screen
reader announced none of it. It is `role="status" aria-live="polite"` now. The only
`aria-live` on the page before this was the one gvb-save mounts for itself.

**Taking an order is the core verb and it was not keyboard-reachable.** Queue
customers were bare `<div>`s with an `onclick`, no role and no tab stop. They are
`<button>`s now with the default chrome reset in CSS, a `:focus-visible` ring, and an
`aria-label` that reads the actual order: *"Customer waiting for Americano, Caramel
syrup. 100% patience left. Take this order."* Five identical "customer"s is not a
queue anyone can act on.

Also gave `#chalkToggle` and `#muteToggle` real `aria-label`s. They were emoji-only
with `title` as their only name.

## What I verified

```
node Projects/corner-and-kettle/test/smoke-save.mjs   162 passed, 0 failed
node Projects/corner-and-kettle/test/drive-save.mjs    90 checks, 0 failed
node assets/js/gvb-save.test.mjs                       39 passed, 0 failed  (unchanged)
cd Tools/board-check && npm run check                 278 units checked, 0 broken
                                                        0 collisions, tightest vertical gap 7.1px
cd Tools/board-check && npm run social:check           23 notices, 23 already current
grep -c fonts.googleapis.com Projects/coffee_shop_sim.html    0
```

`npm run check` says 278 units, not v7's 235. None of the difference is a break. The
count is up because several other prompts have new folders in the tree right now
(`absalom-inheritance/`, `integer-foundry/`, `the-fracture-cycle/`, `daredevil/js/`)
plus my eleven files. 0 broken is the number that matters.

**The save round trip, by hand and then in the suite.** Played, reloaded, confirmed
day, money, stations, staff, presets and regular all identical. Exported to a file
(1,748 bytes, `corner-and-kettle-save-YYYY-MM-DD.json`, a `gvb-save` envelope
stamped `corner-and-kettle` v1). Cleared storage, confirmed the shop was back at day
1, imported the file through the real file picker, got day 9 and $4,210 back
including the third station, Juno's Senior and bar-specialist status, and the preset.

**The corrupt-file test, four ways.** Truncated JSON, a well-formed envelope with
`day: "banana"`, a valid Closing Time export, and `{"hello":"world"}`. All four
refused, the shop untouched at day 9 and $4,210 each time, the player told "That is
not a valid corner-and-kettle save", and no uncaught error. Before this session
every one of those would have been `JSON.parse`d into game state and booted on.

**The old-save test.** I could not save one from the pre-change build after the
fact, so the suite seeds the exact blob the old `saveState()` wrote: the same twenty
fields, no `__v`, plus `baristaLevel: 2` from the build before staff were a list, a
regular using the old `food` flag, and a preset whose cup has no `shots` and no
`toppings`. It boots to day 14 and $6,100 with the mute setting and three stations
intact, `baristaLevel` migrates to one named Senior, every field added since fills
in, and the event time is *rolled* rather than left `undefined`. Then it applies that
legacy preset and pulls a shot: 0 to 1, not NaN, and the base requirement is
satisfiable.

**Every guard-rail broken on purpose (locked decision #34).** Replacing
`repair: s => repairSave(...)` with `repair: s => s`:

- Node suite: exit 1, 6 failures naming the shots field and the two doors repair
  runs through.
- Browser suite: exit 1, 7 failures, and section 10's hand-edited save **never boots
  at all**. `window.__CK_DEBUG__` never appears inside 10 s. That is the frozen-shop
  failure mode, live, rather than argued.

Reintroducing `shots: c.shots` alone: exit 1, 6 failures.

That exercise also **caught a bad test of my own.** The beat asserting "pulling a
shot gives 1, not NaN" passed with repair disabled, because a thrown `applyPreset`
leaves the untouched `newCup()` behind and that already has `shots: 0`. It asserts
the preset *landed on the cup* first now, and watches the page's error stream,
because an exception inside a click handler never reaches the `.click()` call site.

**Two assertions were testing luck, and the suite said so out loud.** `init()`
rebuilds the queue with three random orders and each has a 1-in-8 chance of minting
a new named regular, so `Object.keys(regulars) === 'Nora'` is a coin flip. One run
printed `Nora,Marisol,Desmond,Talia`. They use `includes` now, and the regular that
has to be *absent* is keyed on "Nonesuch", a name `REGULAR_NAMES` never rolls
(locked decision #40).

**Fonts, in a real browser.** All seven faces report `loaded`, seven `.woff2`
requests all from `corner-and-kettle/fonts/`, `page.__blocked` empty. Worth
repeating from the prompt: `page.__blocked` is *not* the check here, because
`prepPage()` fulfills Google Fonts requests locally before the blocked list is
written, so a hotlink would have passed it. Grepping the file is the check.

**Accessibility and mobile.** Heading order is clean (h1, h2, h3, no skips). Every
waiting customer is a real button with an order-specific label, focusable, and Enter
on one puts the order into a station. 375×812 has 0 px of horizontal overflow with
both stations and all seven tabs rendering. All asserted in the suite so they stay
that way.

**Playing it.** Built a latte with real clicks (Base, Pull Espresso Shot, Milk, Oat,
Steam) and served it for a real payment and a streak. Ran the clock through a phase
change and out to the day-end modal. Clicked Start Next Shift into day 2. Then a
full unattended day at day 10 for the numbers under Next session.

One thing that cost me an hour and is worth writing down. **The in-app Browser pane
does not composite when it is hidden, so `requestAnimationFrame` never runs.** Every
station button goes through `runProgress()`, which is rAF-driven, so
`Brew Drip Coffee` appeared to do nothing and the shift clock sat still. Same family
as v7 §6, one step worse: not a throttle, a full stop. The fix is the one the repo
already has, which is to drive the page from `Tools/board-check/harness.mjs`, whose
`launch()` sets `--disable-renderer-backgrounding` and friends. `drive-save.mjs`
imports it read-only.

## Shared-file requests

**1. `assets/js/gvb-save.js`, `load()` does not catch a throwing `getItem`.**

`load()` is documented as "returns `null`, never throws", and the README repeats it.
It doesn't, if the store's getter throws:

```js
  function load() {
    if (!store) return null;
    const raw = store.getItem(key);      // <- unguarded
```

Exact edit:

```js
  function load() {
    if (!store) return null;
    let raw;
    try { raw = store.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
```

`save()` already has this shape. Low urgency in practice, because
`defaultStorage()` probes with `setItem`, so a store that survives the probe almost
certainly reads fine. But the docs promise it, and my suite currently asserts the
*current* behaviour so that the day it is fixed, the test says so.

**2. `assets/js/gvb-save.js` line 66, the storage probe can throw before the probe.**

```js
  const store = storage || (typeof localStorage !== "undefined" ? defaultStorage() : null);
```

`defaultStorage()` correctly puts the property read inside a `try`, and its own
comment says a blocked browser throws on the property access. But this line reads
`localStorage` outside any `try` to decide whether to call it. `typeof` is only safe
on an *undeclared* identifier. `localStorage` is a declared accessor on `window`, so
`typeof localStorage` invokes the getter and throws with it. In a browser that blocks
storage, `createSaveSlot` throws at construction and the memory fallback is never
reached, which is the one case it exists for.

Exact edit:

```js
  const probe = () => { try { return typeof localStorage !== "undefined"; } catch (e) { return false; } };
  const store = storage || (probe() ? defaultStorage() : null);
```

**3. A preview and OG card for Corner & Kettle** (`Tools/board-check/games.mjs` plus
`npm run previews`). It is one of the few board entries with neither, and it
photographs well: the queue of pixel customers along a sunrise sky strip with two
station cards below is the most legible frame on the board.

The recipe needs three clicks to reach a frame that proves it got to play, per locked
decision #28. Wipe `cornerKettleSave_v1` and reload, click the first `.customer`,
then `.stationTab[data-tab="base"]`, then `#btnEspresso`, then wait for
`window.__CK_DEBUG__.state.slots[0].cup.shots >= 1`. That gives a filled cup in a
station with a live ticket beside it rather than an empty counter. `#dayNum` reading
1 and one `.slot:not(.empty)` are the two things to assert.

`live: false`. It is a real-time sim, but the only motion in a still frame's worth of
time is a CSS keyframe on the barista chip, and there is no barista at day 1. Locked
decision #29 covers this, so please don't animate something to satisfy a motion
check.

**No board `href` change is needed.** The page did not move.

## Deliberately not done

**The full restructure into `Projects/corner-and-kettle/index.html` plus `js/` and
`css/`.** The prompt makes the case and I agree with the general shape of it, but the
concrete gain this session needed was *testability*, and that only required the save
schema to be importable: 360 lines, not 2,509. Against moving the rest, it breaks
`/Projects/coffee_shop_sim.html` for anyone who has bookmarked or linked it, and it
turns a self-contained change into a coordinated one with prompt 21 for the board
`href`. Splitting engine from UI is worth doing on the day someone wants to test the
*engine*, meaning the economy, the barista scheduler, the order generator. That day
should also be the day the URL breaks, once, for a reason. Doing it now for a save
adoption would spend the URL break on nothing. The underscores in the filename are
the same trade and the same answer.

**Uncapping the difficulty curve.** Measured rather than changed, because it is a
balance decision and the numbers should be in front of you first. They are below.

**The mid-shift reload exploit.** `shiftElapsed` is not saved, so reloading at any
point restarts the shift at Dawn while keeping the day and the money. Wages are only
deducted in `endShift()`. Measured: day 5, $1,000, 132.6 s into a 136 s shift, then
after reload, day 5, $1,000, 0.06 s, running. So you can farm unlimited shifts on one
calendar day and never pay a wage. This predates my change, since the old loader
didn't save the clock either, and "fix" means choosing a policy (persist the clock,
or bank the day on reload) rather than moving a line. Same shape as v7 §9's Faire
Weekend report-phase item, and it should be decided the same way.

**Full keyboard play.** I fixed the two things that were cheap and load-bearing, but
the station buttons still have no shortcuts, and building a drink is a lot of tabbing.

## Next session

### The audit first, because it sets the order

**There is a difficulty curve, it lasts eight days, and then it is flat forever.**
Both knobs are `Math.max`-floored:

```js
spawnFactor()    Math.max(0.6,  1 - (day-1)*0.05)   // floors on day 9
patienceFactor() Math.max(0.75, 1 - (day-1)*0.03)   // floors on day 10
```

| | day 1 | day 3 | day 5 | day 9 | day 30 |
| --- | --- | --- | --- | --- | --- |
| spawn factor | 1.00 | 0.90 | 0.80 | 0.60 | 0.60 |
| patience factor | 1.00 | 0.94 | 0.88 | 0.76 | 0.75 |
| customers offered per shift | 26 | 29 | 32 | 43 | 43 |
| seconds a drink customer waits | 90 | 85 | 79 | 68 | 68 |
| average gap between arrivals | 5.4 s | 4.9 s | 4.3 s | 3.3 s | 3.3 s |

So day 30 does not play like day 3. It plays exactly like day 9. Demand rises 65%
and patience falls 24% across eight days, and then nothing about the shop floor ever
changes again.

**The bigger problem is that staff outgrow the ceiling.** A shift is
4 × 34 s = 136 s. A Senior steps every 1.8 s, about 1.175× that after fatigue, and
an average ticket is roughly 2.6 steps, so one Senior clears about 49 orders a shift
against a demand that caps at 43. Three Seniors on three stations: about 74.

I played one full real day at day 10 with three trained Seniors and everything a
player would plausibly own by then, with the only human input being "take the next
order off the queue":

```
offered 41 · served 45 (35 drinks, 10 food) · gross $2,563 · wages $210
net $2,353 · average accuracy 99% · best streak 25 · reputation 50 to 67 in one day
```

99% accuracy, hands off. Wages are 8% of gross, which is not a decision. And
everything purchasable in the game (both station slots, three hires, three
promotions, three trainings, both loyalty tiers, all six equipment upgrades, all four
ambiance upgrades, and the $5,000 Second Location) totals **$14,150**. At $2,350 a
day that is six more days. The prestige goal needs $5,000 and 80 reputation, and
reputation moved 17 points in a single day, so the whole game is over somewhere
around day 12 or 13. At 136 s a shift that is **under half an hour of wall clock**,
most of it watching.

**The cheapest change that makes the second playthrough different from the first** is
to make prestige move the floors instead of the income. It currently grants +5% tips
per level, which is invisible. The two functions already exist, already read
`state.day`, and already read `state.prestigeLevel` elsewhere:

```js
function spawnFactor(){
  const floor = Math.max(0.30, 0.6 - 0.06*state.prestigeLevel);
  return Math.max(0.25, Math.max(floor, 1 - (state.day-1)*0.05) * shopSpawnFactorMult());
}
```

Two lines, no new content, no new UI, and it uses state that is already saved and
already survives a reload. Run two is a measurably busier shop rather than a 5%
richer one, and "Reopen" stops being a button with no felt consequence.

Second cheapest, and it is the one that makes the *player* matter again: stop
baristas auto-serving. `runBaristaTick()` calls `serveSlot(idx)` itself once
`orderIsComplete()`. If they prepped and left the cup for a human to hand over, three
Seniors would be a throughput multiplier instead of a replacement, and that 99%
accuracy number would go back to being the player's problem.

### The plan, ordered by value per effort

1. **Make prestige move the difficulty floors** (two lines, above). The single
   biggest change to how the game feels, for the least code, using state that is
   already persisted. Everything else on this list is smaller than it.
2. **Decide the mid-shift reload policy.** It is currently unlimited free money and
   free labour, in two clicks. Either persist `shiftElapsed` or bank the day on
   reload, but pick one, don't leave it.
3. **Stop baristas auto-serving.** One line moved. Turns the late game from a
   spectator sport back into a game. Worth doing after 1, so the numbers are measured
   against the new curve.
4. **Ask for the preview and OG card** (Shared-file request 3). The recipe is written
   out and ready to paste, it just needs prompt 21 to run it.
5. **The two `gvb-save.js` hardening edits** (Shared-file requests 1 and 2). Small,
   and request 2 is the difference between a memory fallback that works and one that
   throws on the way to itself. Six projects read that file.
6. **Keyboard shortcuts for the stations.** Building a drink is now reachable but
   tedious. Digits for the station tabs and a key for Serve would finish what this
   session started.
7. **`npm run games` does not cover this game.** `drive-save.mjs` duplicates a little
   of what `games.mjs`'s `enter()` does, deliberately, because adding a seventh entry
   to `games.mjs` is prompt 21's file. If Corner & Kettle joins that suite, the two
   openings should collapse into one (locked decision #38) and the save beats can move
   across wholesale.
