# Closing Time — session notes

## What changed

**`Projects/Closing Time/js/state.js` — the save is now `assets/js/gvb-save.js`.**
The key is unchanged: `closingTime.save.v1`. What it replaced, verbatim from the old
file:

```js
export function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
export function loadSave() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { S = JSON.parse(raw); return true; } } catch (e) {}
  return false;
}
```

Three exports are new and one is split:

- `makeCareer(brokerageId)` is the old body of `newGame()` with the mutation taken
  out. It builds a career and returns it, touching neither `S` nor storage, so the
  slot can call it as a `defaults` factory. `newGame()` is now three lines around it.
- `validCareer(s)` — the gate. Requires a finite numeric `day` and `cash`, a string
  `brokerageId`, and an array `clients`. Those are the four the render path reads
  before anything else can go wrong.
- `repairCareer(s)` — the fill-in pass, handed to the slot as `repair` so it runs on
  every accepted load through every door (locked decision #37).
- `careerSlot(storage)` mirrors The Fourth Quarter's `campaignSlot`: cached per
  storage in a `WeakMap`, undefined in the browser so gvb-save probes for itself.
  `save()` / `loadSave()` / `wipeSave()` stayed as thin wrappers because `ui.js`,
  `calendar.js` and the smoke test all read better in the game's vocabulary.
- `adoptState(next)` installs a state the game did not build. That is the import path.

Nothing in the project reads `localStorage` any more.

**Two bugs `repairCareer` fixes that were already live, not hypothetical.** The prompt
said to enumerate the fields added since ship that get used in arithmetic. The
interesting ones here are not fields, they are content:

1. **A listing added to `data/` after a career started threw on the MLS board.**
   `renderMLS` runs
   `Object.values(DB.listings).filter(l => S.listingsState[l.id].status === "onMarket")`
   over everything in the DB, and a save written before that JSON file existed has no
   entry for it. `Cannot read properties of undefined (reading 'status')` — the screen
   does not render at all. "Adding content never requires touching engine code" is the
   documented contract in the project README, and until today it quietly meant
   "…as long as nobody has a save."
2. **A neighborhood added after a career started stopped the weekly market drift.**
   `weeklyMarketTick` does `S.market.nb[id] = Math.max(0.7, S.market.nb[id] * (1 + change))`.
   Undefined times a number is NaN, `Math.max(0.7, NaN)` is NaN, and it stays NaN
   forever. `trueValue` reads it as `S.market.nb[...] || 1`, and NaN is falsy, so the
   symptom is not a crash — the new neighborhood's prices simply never move again and
   nothing anywhere says so.

The field-level ones, in descending order of how badly they break:

- **`S.seed`.** `rand()` is `S.seed = (S.seed * 1664525 + 1013904223) % 4294967296`. An
  undefined or NaN seed makes `rand()` return NaN forever: every `rand() < chance` is
  false so no event ever fires again, and the first `pick(arr)` returns `arr[NaN]`,
  which is `undefined`, which throws as soon as anything reads `.negotiationStyle` off
  it. This is the same shape as v7's NaN walking speed and worse in reach.
- **`S.nextId`.** `uid()` is `p + "_" + (S.nextId++)`. Undefined gives every record the
  id `cr_NaN`, and `getClientRec()` then matches the first one every time. Repair
  scans the existing `recId` / deal id / listing id / offer id suffixes and starts past
  the highest, rather than resetting to 1 and colliding with what is already there.
- **`pl.dom`, `pl.interest`, `pl.openHouseBoost`, `pl.marketingTier`, `pl.staged`** all
  get added together in `dailySellerTick` every day a listing is live. One undefined
  makes `pl.interest` NaN and it never recovers, so the listing stops attracting
  offers and the seller sits there.
- **`rec.schmoozeCount`.** `rec.schmoozeCount++` on undefined is NaN, and every
  schmooze-triggered reveal after that compares `NaN >= n` and never fires. Silent.
- **`S.firedEvents`** is read in `eligibleEvents` and written in `fireEvent`, and was
  never in `newGame()` at all — both sites guard it (`S.firedEvents && …`,
  `S.firedEvents = S.firedEvents || {}`), so this one was already handled. It is in
  `makeCareer` and `repairCareer` now because relying on every future reader to
  remember the guard is not a plan.
- `brokerageId` is clamped to a brokerage that exists. `renderTopbar` reads
  `DB.brokerages[S.brokerageId].name` on the first paint, so a stale id from a deleted
  brokerage file is a dead page, not a wrong name.

**`js/main.js`** mounts the save bar and takes the import path. It also disables the
Export button until a career exists, by reaching for `#save-bar [data-gvb="export"]`.

**`index.html`** — the save bar lives in the footer, inside a new `.foot-actions`
wrapper next to "New career". The footer is on screen behind all six desk screens, so
there is no equivalent here of v7 §9's complaint about The Fourth Quarter (export
mid-campaign, reload the page to get the overlay back). Nothing was touched inside the
`gvb:social` markers.

**`index.html`, `css/style.css`, `assets/fonts/`** — the three Google Fonts hotlinks
are gone, replaced by seven local woff2 faces. See "Fonts" below.

**`css/style.css`** — save-bar styling via the module's four custom properties, plus a
`max-width: 620px` rule that hides the footer tagline. Numbers in "What I verified".

**`tools/smoke.mjs`** — rewritten around an assertion harness. It printed before and
exited 0 no matter what (locked decision #13). 76 assertions now, non-zero exit on any
miss, and the narrative output kept because it is genuinely useful to read.

**`README.md`** — persistence section, architecture tree, and a design note saying that
anything added to `S` or to `data/` belongs in `repairCareer()` the same day.

## What I verified

Commands and their actual output.

- `node tools/smoke.mjs` from `Projects/Closing Time` → **`SMOKE OK: 76 passed`**
  (was `SMOKE OK`, an unconditional print, with no assertions at all). New coverage:
  six shapes of corrupt save refused, a legacy save with nine things missing repaired,
  the export envelope, a re-import, a version-0 export re-imported, `__v` written,
  `fresh()`, `wipeSave()`, and that `makeCareer` does not touch the live career.
- **Locked decision #34, five guard-rails, each broken on purpose and watched to fail
  before being trusted:**

  | What I broke | Misses |
  | --- | --- |
  | `repairCareer` returns immediately | 15 of 76, including `rand()` returning `NaN NaN NaN` and the MLS filter throwing |
  | only the `s.seed` line removed | 3 — the seed, `rand()`, and the version-0 import |
  | only the `listingsState` backfill removed | 2 — `ls_0004` missing, MLS filter throws |
  | `validCareer` returns `true` | 5 corrupt blobs accepted |
  | `nextId` reset to 1 instead of scanning | 1 — `nextId 1, highest issued 10` |

  Then restored, back to 76 passed. Two of the corrupt-blob cases (unparseable JSON, a
  bare `null`) still pass with `validate` neutered, correctly: `normalize()` rejects
  those before `validate` is ever reached.
- `cd Tools/board-check && node play-games.mjs closing-time` → **18 checks, 0 failed**,
  including "no page or console errors" and "no offsite requests". Every pre-existing
  beat still passes untouched, which matters: `savedState()` reads the raw key and
  `JSON.parse`s it, and `slot.save()` writes `{...state, __v: 1}`, so the flat shape
  those beats read is unchanged.
- `npm run check` → **247 units checked, 0 broken; 0 collisions, tightest vertical gap
  7.1px.** Not 235, and not a stable number: it read 247, then 246, then 247 again
  across three runs an hour apart. Other sessions are adding and removing files in this
  tree while we all work. I added no `.js`, `.mjs`, `.json` or `.html` file, so none of
  the drift is mine — and "235 units" is not a figure the next handoff should quote as
  a baseline.
- `npm run social:check` → **23 notices, 23 already current, 0 out of date.**
- `grep -c "fonts.googleapis.com\|fonts.gstatic.com" "Projects/Closing Time/index.html"`
  → **0**.
- In a real browser at `http://localhost:47681/Projects/Closing Time/`:
  - `document.fonts` after `ready` → all seven faces `loaded`, and `.lh-name` computes
    to `"Zilla Slab", Rockwell, serif` at weight 700. The families resolve locally.
  - Started a career, ended three days, clicked **Export save** with
    `URL.createObjectURL` hooked and the anchor click neutered — the blob it would have
    written is 4,200 bytes, filename `closing-time-save-2026-07-27.json`, envelope
    `{format: "gvb-save", game: "closing-time", version: 1, savedAt: …}`, `state.day` 4.
  - Ended five more days to day 9, then clicked **Import save** with the file chooser
    answered before the click (same trick `play-games.mjs` uses). Career came back to
    day 4, the desk re-rendered to "Thursday, Wk 1 Winter", localStorage rewritten with
    `__v: 1`, no modal left open.
  - Wrote `{"day":"tuesday","cash":"lots","clients":"none"}` into the key and reloaded:
    **the brokerage-choice screen, no console errors, Import still available.** The old
    loader took that blob (`S = JSON.parse(raw); return true`), and `renderTopbar`'s
    first statement is `DB.brokerages[S.brokerageId].name` with `S.brokerageId`
    undefined — a `TypeError` on the first paint and a page with no nav, no start
    screen and an empty `#main`.
  - Export is disabled on the start screen and enabled once a career exists.
- Mobile, measured at 375×812 rather than eyeballed:
  - footer **67px** before this session with no save bar → **128px** with the bar,
    because it wraps onto its own line. That is 7.5% of an iPhone viewport spent on two
    buttons nobody presses often, and I caused it.
  - Hiding the tagline below 620px: footer **55px**, save bar on the same row as "New
    career", no horizontal page scroll. Net 12px *shorter* than before the session,
    with export/import added.
  - Desktop at 1280×800 after the same change: footer 55px, tagline visible, no
    horizontal scroll.

## Shared-file requests

Written so they can be applied without this session's context.

### gvb-save.js — three gaps, one of them real

**1. `fresh()` cannot pass arguments to a `defaults` factory.** This is the one that
actually cost me something.

Current: `function fresh() { if (typeof defaults === "function") return defaults(); … }`

Requested:

```js
/** A brand-new state. Extra arguments are forwarded to a `defaults` factory. */
function fresh(...args) {
  if (typeof defaults === "function") return defaults(...args);
  return defaults ? JSON.parse(JSON.stringify(defaults)) : null;
}
function reset(...args) {
  if (store) { try { store.removeItem(key); } catch (e) {} }
  return fresh(...args);
}
```

Why the existing hooks don't cover it: `defaults` as a factory (v7 §1) solved
"day one isn't a constant". It does not solve "day one depends on a choice the player
has just made". Closing Time's day one is `makeCareer(brokerageId)` and the brokerage
is picked on the start screen — Hearthstone Realty or independent, different
commission split, different Monday perks. `slot.fresh()` has no way to say which, so
the slot's `defaults` here is `() => makeCareer(DEFAULT_BROKERAGE)`, a career at a
brokerage the player did not choose. Nothing in the game calls it, `newGame(id)` goes
straight to `makeCareer`, and the smoke test asserts the default is what comes back —
but a real hook is four characters of spread and removes a wrong-by-construction
default from the second adopter's code. Backward compatible: every existing
`fresh()` / `reset()` call site keeps working unchanged.

**2. `reset()` cannot just erase.** `reset()` always calls `fresh()`, so `wipeSave()`
here builds a whole throwaway career (iterating 24 listings and 6 neighborhoods,
shuffling 16 clients) one line before `location.reload()` discards it. Harmless,
slightly absurd, and it means erasing a save requires `defaults` to be capable of
producing one. Requested:

```js
/** Erase the stored save. Returns true if a key was there to remove. */
function clear() {
  if (!store) return false;
  const had = store.getItem(key) !== null;
  try { store.removeItem(key); } catch (e) { return false; }
  return had;
}
```

and `reset()` becomes `clear(); return fresh(...args);`. Export `clear` alongside the
rest. Low priority — the workaround costs nothing at runtime.

**3. `mountSaveBar` has no way to express "this button isn't usable yet".** On the
start screen there is no career, so Export would serialize `null` into a file that
`deserialize` then refuses. I disable it from the host page via
`#save-bar [data-gvb="export"]`, which is exactly what the `data-gvb` attribute is
documented for, so this is a nice-to-have rather than a gap: a `canExport: () => bool`
handler polled on click, or a returned `{ buttons }` map, would be tidier. I would not
change the module for it alone.

**Everything else held.** `repair` is the right shape and did all the work here without
a single awkward case — including the two content-drift bugs, which are not what it was
written for and which it handles because it runs on every load rather than on version
drift. The envelope, the `game` check, the memory fallback, the relative import and the
`buttons` option all fit a second adopter with no argument. See "the actual question"
at the bottom.

### `assets/js/README.md`

Add Closing Time to "Who uses it", and one line to `migrate` vs `repair` that is worth
having in the shared doc because it generalises past this game:

> `repair` is also where **content drift** goes, not just schema drift. A data-driven
> game whose save holds one entry per content file will meet saves written before half
> that content existed. Closing Time's `repairCareer` backfills a market state for
> every listing in the DB the save has never heard of; without it, adding one JSON file
> threw on the MLS board for every existing player.

### `Tools/board-check/play-games.mjs` — new beats for `closing-time`

The suite already reloads mid-career, so it has the shape for these. Model them on the
`fourth-quarter` save beats; the game key is `closing-time` and the storage key is
`closingTime.save.v1`. Insert after the existing "and resumes on the same day" check.

1. **The version stamp reached the save.**
   `t.ok((await savedState(p, 'closing-time')).__v === 1, 'the save carries a version stamp')`

2. **The save bar is in the footer and both buttons are there.**
   ```js
   const kinds = await p.$$eval('#save-bar [data-gvb]', els => els.map(e => e.dataset.gvb));
   t.ok(kinds.join(' ') === 'export import', 'export and import are in the footer', kinds.join(' '));
   ```
   The point of this one is the *footer*, not the buttons — it is the assertion that
   stops someone moving the bar back onto a start overlay.

3. **Export writes a real career.** Hook `URL.createObjectURL` and neuter the anchor
   click, same as the fourth-quarter beat does:
   ```js
   await p.evaluate(() => {
     window.__cap = null;
     const real = URL.createObjectURL;
     URL.createObjectURL = b => { b.text().then(t => window.__cap = t); return real(new Blob()); };
     HTMLAnchorElement.prototype.click = function () {};
   });
   await p.click('#save-bar [data-gvb="export"]');
   const env = JSON.parse(await p.evaluate(() => window.__cap));
   t.ok(env.format === 'gvb-save' && env.game === 'closing-time', 'export wrote a gvb-save envelope');
   t.ok(env.state.day === after.day, 'holding the career it was taken from', `day ${env.state.day}`);
   ```

4. **Import takes the career back.** End four more days first so the import has
   something to undo, then answer the file chooser before opening it — `prepPage()`
   sets `page.__engine`, so branch on it exactly the way the fourth-quarter beat does.
   Assert the day goes *back* to the exported one, and assert it against the **DOM**
   (`.stat-val` in the topbar), not the save: locked decision #39, and this game saves
   on render so the save agrees anyway. Asserting the DOM is what catches an import
   that lands in state without redrawing.

5. **A corrupt save does not boot the game.** The highest-value one, and the reason
   this task existed:
   ```js
   await p.evaluate(() => localStorage.setItem('closingTime.save.v1',
     JSON.stringify({ day: 'tuesday', cash: 'lots', clients: 'none' })));
   await p.reload({ waitUntil: 'load' });
   await p.waitForSelector('.start-screen, #nav [data-nav]');
   t.ok(!!(await p.$('.start-screen')), 'a corrupt save drops you at the start screen, not into it');
   t.ok(!(await p.$('#save-bar [data-gvb="import"]'))?.disabled ?? true, 'with import still offered');
   ```
   Note the wait selector: `boot()` awaits `loadAll()` before rendering anything, so
   waiting for `.start-screen` alone times out (v7 §4).

6. **A legacy save loads.** Write a save with no `__v` and no `seed`, reload, assert the
   nav comes up and that ending a day still moves the counter — a NaN seed passes a
   "does it render" check and fails the first time anything random happens.

### The board — `index.html`, prompt 21

**v7 §5 is still wrong, and by more than one page.** It says the site makes zero offsite
requests site-wide. Closing Time's three font hotlinks are gone as of this session, but
`grep -rln "fonts.googleapis.com" --include=*.html --include=*.css` over the repo, minus
`node_modules`, still returns **eleven files**:

```
404.html
index.html                                   <- the board itself
Projects/coffee_shop_sim.html
Projects/daredevil_r4.html
Projects/integer-foundry.html
Projects/Ren-Faire-Claude/index.html
Projects/the-fracture-cycle.html
Tools/Name Picker.html
Tools/Schedule Browser as of 260715.html
Tools/Schedule Visualizer and Browser Generator v60.html
Tools/Seating Chart Generator.html
```

The board's own front page is one of them. **This is invisible to every check we have**,
for the reason the prompt gave me: `prepPage()` in `harness.mjs` fulfills Google Fonts
requests locally from the bundled `@fontsource` packages before the blocked-list check
runs, so they never reach `page.__blocked`, and both `play-games.mjs` and
`play-castle.mjs` assert on `page.__blocked`. The suites will keep saying "no offsite
requests" for as long as this is true.

Two things worth doing, both outside my boundary:

- **A grep check, not a browser check.** Add to `check-integrity.mjs`: scan every
  `.html` and `.css` for `fonts.googleapis.com`, `fonts.gstatic.com`, and `//` URLs in
  `src=` / `href=` that are not same-origin, and fail on a hit. It is a dozen lines,
  it runs in `npm run check` where it costs nothing, and it would have caught this
  three sessions ago. `page.__blocked` cannot be the check while `prepPage` fulfills.
- **Then vendor the rest.** 124 KB bought three families here. The eleven remaining
  files share most of the same families; a single shared `assets/fonts/` would cost
  less than eleven copies and is the one case besides `gvb-save.js` where sharing
  probably beats locked decision #17 — though I would not make that call for someone
  else's file. Per-project copies at ~120 KB each are also fine.

## Deliberately not done

- **A `migrate` hook.** There is one version of this save shape and version 0 needs
  nothing that `repair` does not already do on every load. Adding an identity `migrate`
  to look complete would blur locked decision #37, which is specifically about not
  putting fill-ins in the version-drift hook. When the shape actually changes, `migrate`
  goes in and `SAVE_VERSION` goes to 2.
- **Rewriting `shuffle()` to use the seeded RNG.** It uses `Math.random()` while
  everything else in the file uses `rand()`, so the intake queue is not reproducible
  from the seed even though the comment on the seed implies "determinism-lite". It only
  runs once per career, before any save exists, so it changes nothing about loading —
  and fixing it changes what every new career looks like for no player-visible gain.
  Worth a line in the file if anyone tries to make this game replay a seed.
- **The `pendingLowball` field.** It is set by an event handler and consumed by the open
  house flow in the same session, and `flowOpenHouse` clears it on entry, so a save
  written mid-open-house cannot resurrect a stale one. `repairCareer` leaves it alone
  on purpose. `makeCareer` declares it as `null` only so the shape is documented.
- **Moving the seven vendored faces to a shared `assets/fonts/`.** Locked decision #17
  says each project vendors its own copy. Eleven other files still hotlink the same
  families and a shared folder would obviously be cheaper, but that is a board-level
  decision on a shared path, and taking it unilaterally from inside one project is how
  a merge fight starts. It is in the Shared-file requests instead.
- **Reducing the topbar on mobile.** At 375×812 the topbar is 257px and the footer 55px,
  so 38% of the viewport is chrome before any content. The six-cell stat grid wrapping
  to four rows is the cause. It is a real problem and it is a layout redesign, not a
  media query — see "Next session".

## Next session

Ordered by value per effort.

1. **The offsite-request grep check in `check-integrity.mjs`, then the other eleven
   files.** Detailed above. The check is a dozen lines and closes a hole that has been
   silently open since v5; the vendoring after it is mechanical. Highest value on the
   list because we are currently *asserting* something that is false.
2. **`fresh(...args)` in `gvb-save.js`** — four characters, backward compatible, removes
   a wrong-by-construction default from this project. Do it with the third adopter, so
   two games' worth of evidence lands at once.
3. **The six `play-games.mjs` beats above.** The save path is covered by 76 Node
   assertions and verified by hand in a browser, but nothing automated drives the
   export or import buttons in a real page. That is the exact gap `npm run games` was
   built to close, and `day.rebuildStations` is the standing argument for closing it.
4. **The topbar at 375 wide.** 257px of the viewport, six stats in a grid that wraps to
   four rows. Date / Slots / Cash on one line and Rep / XP / Rate behind a tap would
   halve it. This is the single biggest thing between the game and being playable on a
   phone, and the rest of the layout already behaves.
5. **Fourteen days is not a career length, and the game does not have one.** The prompt
   asked for an opinion. There is no end condition at all — `endDay()` runs forever, the
   ladder tops out at Managing Broker (1,300 XP), and after that the loop is the same
   loop with bigger numbers. The seasons function suggests an intent nobody built:
   `seasonOf` wraps at 336 days, which is four 84-day seasons, so **a one-year career is
   already encoded in the date math**. Ending at day 336 with a year-end scorecard —
   volume, closings, referrals, final rep, the ladder rung you reached — would give the
   XP curve something to be a curve toward. Cheap to build, and it is the difference
   between a sim and a toy.
6. **The six desk screens earn their space, with one exception.** Desk, Clients, MLS,
   My Listings, Office and Ledger are all doing distinct work, and the nav badges make
   the two that need attention obvious. **Ledger is the weak one:** it is `logPanel(80)`
   where the Desk already shows `logPanel(8)`, so it is the same list, longer. It would
   earn its tab with a filter — money only, reputation only, this client only — or it
   should fold into the Desk as a "show more" and free the slot for something with
   state in it.
7. **`data/` extensibility is real now, and worth one more pass.** Backfilling
   `listingsState` fixed the crash, but the reverse case is untested: a listing
   *removed* from `data/` while a save references it. `S.listingsState` keeps the orphan
   entry, `calendar.js` iterates the save's keys and ages a listing that no longer
   exists, and `DB.listings[id].address` in the price-cut log line throws. Same family,
   opposite direction, cheap to fix in the same function.

## Did the module's shape hold up for a second adopter?

Mostly yes, and the one place it did not is small and named above.

The thing worth writing down is *why* it held up, because it is not the part that was
designed for it. `repair` was added in v7 for "fields added to the campaign since the
first release" — a schema problem. Closing Time's two worst load bugs are not schema
problems. They are **content drift**: the game's whole extension model is "add a JSON
file, list it in the manifest, reload", and a save holds one `listingsState` entry per
listing and one `market.nb` entry per neighborhood. Every content file added after a
career starts is a hole in that career's save. `repair` handles it exactly, without
being bent, because it runs on every accepted load rather than on version drift — a
distinction that was made for a different reason and turned out to be the load-bearing
one. That is a hook being right rather than a hook being lucky.

Where it is still shaped like The Fourth Quarter: `fresh()` and `reset()`. Both assume a
new game is a thing the module can produce on its own, which is true when the start
screen is one button and false when it is a choice that changes the game's economics.
The Fourth Quarter did not notice because its "New Game (wipe save)" button predates the
module and it mounts `["export", "import"]` for unrelated reasons. Closing Time mounts
`["export", "import"]` too, for the same-looking reason and a different actual one: not
"there is already a wipe button" but "this game cannot start over without asking a
question first, and the module has no way to ask it". Two adopters, both avoiding
`reset`, for two different reasons, is the signal. The third adopter should be checked
against this specifically.

The relative import, the memory fallback, the envelope, the `game` check and `validate`
all worked first time with nothing to report.
