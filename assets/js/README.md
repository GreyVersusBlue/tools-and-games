# `gvb-save.js` — the shared save system

One save implementation for every sim on the site, generalized from the
Fourth Quarter's campaign save (namespaced key, schema version, defensive
load) with export/import added on top.

No dependencies. ES module. Run the tests with:

```
node assets/js/gvb-save.test.mjs            # stubs: every path, 150 assertions
node assets/js/gvb-save.browser.mjs         # real Chromium: the quota and IndexedDB, 47
```

The browser suite needs `npm ci --ignore-scripts` in `Tools/board-check` first and
runs from the repo root. Both are in `site-ci.yml`.

## Adopting it in a project

```js
import { createSaveSlot, mountSaveBar } from "/assets/js/gvb-save.js";

const slot = createSaveSlot({
  game: "closing-time",              // slug — also stamped into export files
  key: "ct-save",                    // storage key (defaults to gvb:<game>)
  version: 3,                        // bump whenever the state shape changes
  defaults: { day: 1, cash: 2500 },  // what fresh() hands back; may be a function
  validate: s => s && typeof s.day === "number",
  migrate: (s, from) => {            // only when a stored save is a version behind
    if (from < 2) s.brokerage ??= "bk_indep";
    if (from < 3) s.stats ??= { closed: 0 };
    return s;
  },
  repair: s => {                     // every accepted load, whatever the version
    s.listings ??= [];
    return s;
  }
});

let state = slot.load() ?? slot.fresh();
slot.save(state);
```

Import by **relative** path (`../../../assets/js/gvb-save.js`) from a module that
also runs under Node — a game's pure logic file with a smoke test, say. Node can't
resolve the leading slash; the relative form behaves identically in the browser.

### `migrate` vs `repair`

`migrate(state, from)` runs only when the stored version differs from the current
one: reshaping, renaming, anything version-specific. `repair(state)` runs on every
state the slot hands back, through every door — localStorage, an imported file, a
pasted blob — including a save written by the current build. Fill-in-the-gaps
belongs there. A save can be missing a field without the version ever moving (a
hand-edited localStorage, a write cut short by a quota error), and the pass that
used to live in each project's own `load()` has nowhere else to go.

`repair` is also where **content drift** goes, not just schema drift. A
data-driven game whose save holds one entry per content file will meet saves
written before half that content existed — Closing Time's `repairCareer`
backfills a market entry for every listing in the DB the save has never heard
of, which is not a version problem, it is a "content shipped after this save
did" problem, and it runs on every load for exactly that reason.

Both are caught: a `migrate` or `repair` that throws makes the load return `null`
rather than taking the game down with it.

`load()` returns `null` — never throws — for an empty key, corrupt JSON, a
save that fails `validate`, or a migration that blows up. Booting on a bad
save is the failure mode this exists to prevent.

## The save bar

Buttons wired to the slot, dropped into any container:

```js
mountSaveBar(document.getElementById("save-bar"), slot, {
  buttons: ["export", "import"],     // default is all three, reset last
  getState: () => state,
  setState: s => { state = s; redraw(); },
  onMessage: text => toast(text),    // optional; falls back to inline text
  filename: () => `${state.heroName}.save.json`,   // optional, export() only
  labels: { export: ["Save to file", "Download all sections as one .json file"] },
});
```

`buttons` picks which of `export` / `import` / `reset` get mounted. Leave `reset`
out when the page already has its own new-game control — two buttons that erase a
campaign, side by side, is a trap. Each button carries `data-gvb="export"` and so
on, so a driver script can click one without depending on order or label text.

`setState` gets a state the game has to actually take up: reloading the world,
redrawing, whatever a fresh start does. An imported save can be from any point in
a campaign, not just the one the page is currently showing. **`setState` runs
before the import reaches storage**, and can veto it by returning `false` — a
host that rejects an id from a content pack this browser hasn't loaded should
not have already overwritten what was on disk by the time it finds out.

`filename` overrides the export button's default `<game>-save-YYYY-MM-DD.json`
— a function (called at click time) or a plain string. Useful when a save is
named after something other than the game, like a hero.

`labels` overrides a button's default text and title without touching its
`data-gvb` attribute or click order — `{ export: [label, title] }`. Handy when
"Export save" / "Import save" / "Start over" don't fit the page's own
vocabulary (a class roster's "Save to file" / "Open file" / "Erase saved data",
say).

Restyle it from the host page — no need to touch the module:

```css
#save-bar {
  --gvb-btn-bg: #2a1d12;
  --gvb-btn-fg: #f1e6c8;
  --gvb-btn-border: #b08d3e;
  --gvb-btn-radius: 2px;
}
```

## Export file format

Exports are JSON wrapped in an envelope so a stray file can identify itself:

```json
{
  "format": "gvb-save",
  "game": "closing-time",
  "version": 3,
  "savedAt": "2026-07-26T14:02:11.000Z",
  "state": { "day": 41, "cash": 18250 }
}
```

Importing a file from a different `game` is refused. Importing an older
`version` runs the same `migrate` the localStorage path uses, so an export
taken months ago still loads.

## v2: how big, how many, and the tier above

Three things a save layer for a five-megabyte store did not need until Hearth
and Bell to Bell started writing saves that grow. **All additive.** A v1 slot
reads, writes and exports exactly what it did; the assertions from before v2
still pass unchanged on the v2 module, and so do all thirteen adopters' suites.

### Quota accounting

localStorage gives an origin 5 MiB, counted in UTF-16 code units (a character
is two bytes on disk), and says nothing until `setItem` throws. `slot.save()`
still returns `false` then, and now leaves the reason:

```js
slot.save(state);            // false
slot.lastError;              // { name: "QuotaExceededError", message, quota: true, chars: 5242901, at }
slot.usage();                // { tier, key, chars, bytes, present, share, quotaChars, origin: { keys: [{key, chars}], chars, bytes, counted } }
failureMessage(slot);        // "Could not save: this browser's storage is full (this save is 10.0 MB). Export it before you go on."
```

`usage().share` is the whole origin against `LOCAL_QUOTA_CHARS` (5 MiB, the
figure Chrome, Edge, Firefox and Safari all stop at; measured here at exactly
5,242,880 in headless Chromium). It is a rule of thumb: `probeHeadroom(store)`
writes a probe key in doubling steps and bisects to the real remainder, in
key-plus-value characters, and removes the probe. `measureStorage(store,
prefix)` is the per-key breakdown, largest first, and `isQuotaError(e)` knows
every browser's spelling of "full" and none of "blocked". A store that cannot
enumerate (a stub with neither `keys()` nor `key(i)`) reports `counted: false`
and nulls, never a made-up zero.

`slot.autosave(getState, ms, { onFail })` calls `onFail` when a flush did not
stick; a v1 caller that passes no handler hears nothing, as before. The save
bar's import button used to say "Save loaded." whether or not the write after
it stuck; it now says so when it did not.

### Namespaces

Every multi-key adopter spelled its own prefix scheme: Bell to Bell's
`belltobell.p5.chart`, the Name Picker's thirteen `np_` keys, Hearth's
`hearth.auto`. A namespace is that convention with the pieces each of them
rebuilt:

```js
const hall = createNamespace({ game: "closing-time", prefix: "closingTime.hall." });
const careers = hall.slot("careers", { version: 2, defaults: { list: [] }, validate: s => Array.isArray(s.list) });
careers.key;                 // "closingTime.hall.careers" — prefix + name, nothing else
hall.names();                // every member with something stored, registered or not
hall.usage();                // measureStorage() scoped to the prefix
hall.clearAll();             // removes every key under the prefix, returns the count
hall.snapshot();             // { name: state } for every registered member that loads
hall.serialize(states);      // one bundle file: { format: "gvb-save-bundle", game, version, savedAt, slots: { name: { version, state } } }
hall.deserialize(text);      // { states, skipped, refused } — or null for another game's bundle or junk
hall.importAll(text);        // deserialize, then write every accepted member; adds `stored`
```

The prefix is the whole key layout, so an existing scheme fits without a key
changing (#36): `createNamespace({ game: "bell-to-bell", prefix: "belltobell."
}).slot("p5.chart")` writes `belltobell.p5.chart`, byte for byte what the
hand-rolled code writes. The default prefix is `<game>.`. A member registers
once; a second `slot(name, opts)` with options throws, because two call sites
disagreeing about a member's shape is a bug and the later one silently winning
is how it would hide. Each member has its own `version`/`validate`/`migrate`/
`repair`, and a bundle carries each member's version so an import runs the
right migration per member. A bundle from a later build names the members this
build has not registered in `skipped`; a member whose state fails its own
`validate` lands in `refused`; neither is dropped silently. The namespace has
its own `version` and `migrate(slots, from)` for bundle-level drift.

A member's single-slot export carries `slot: name` in its envelope, and another
member refuses it on that alone. A v1 envelope with no `slot` still imports into
a member. `filename()` becomes `<game>-<name>-save-<date>.json`.

### The IndexedDB tier

```js
const slot = createAsyncSaveSlot({ game: "hearth", key: "hearth.auto", version: 3, validate, migrate, repair, defaults });
let state = (await slot.load()) ?? slot.fresh();
await slot.save(state);      // true, or false with lastError
slot.tier;                   // "idb" | "local" | "memory"
await slot.usage();          // on idb: navigator.storage.estimate()'s usage/quota for the origin, in bytes
```

Same options, same key, same bytes: an async slot writes exactly the string a
sync slot would, under exactly the same key, in an object store instead of
localStorage. Every storage call returns a promise. With no `storage` given it
takes IndexedDB (database `gvb-save`, object store `kv`); when the browser has
none it takes localStorage; when that is blocked, memory. An IndexedDB that
exists but refuses to open is found out on the first call and the slot drops to
localStorage once and stays there; a quota error is not that, and is reported
as one.

**A save moves up a tier without its key changing.** `load()` on an IndexedDB
slot that finds nothing under its key looks in localStorage under the same key
(`fallback`, which defaults to localStorage and takes `null` to never look).
When the save there is readable it moves the string up verbatim, not
re-encoded, so a version-0 save is still version 0 up there and still comes
through `migrate()`, and only then removes the copy. A put that fails leaves the
copy where it was for the next load. Junk below is neither loaded nor moved.
`slot.promoted` says whether this load did it. `clear()` removes a copy below
as well, so a reset cannot resurrect an old save. This is decision #59's shape
(Bell to Bell's read-time key migration): the price of a move is a migration
that runs once, on read, and leaves nobody mid-use behind.

Measured in headless Chromium: a 12 M-character save (over twice localStorage's
ceiling) writes in 61 ms and reads in 37 ms; `navigator.storage.estimate()`
reports a 162 GB quota on this machine. That is the case for the tier.

`idbStorage()` and `asyncify(store)` are the adapters, and `createNamespace({
async: true })` builds a namespace whose members are async slots on one shared
store; its `names`/`usage`/`clearAll`/`snapshot`/`importAll` return promises.
`mountSaveBar` awaits every call, so it takes either kind of slot.

### Who has taken v2

v2 shipped with no adopter moved onto it, against this file's own "none were
added speculatively", and that was written down here. **Closing Time is the
first namespace adopter** (2026-09-16, its hall of past careers): `createNamespace({
game: "closing-time", prefix: "closingTime." })` with `save.v1` as the career
member, so the career key is the string it always was, and `hall` as the second
member. What it exercised: two members under one prefix, a member's export
carrying `slot` so the other member refuses it, and a v1 export with no `slot`
still importing. It did not take the bundle export or the IndexedDB tier: a
hall row is about 300 characters. The other candidates are still somebody
else's call: Bell to Bell's `persist.js` is governed by its own `CLAUDE.md`,
and Hearth's save lives in the address bar. The next feature that needs more
than 5 MiB takes the tier rather than rolling a third prefix scheme.

## The rest of the surface

| Call | Does |
| --- | --- |
| `slot.fresh(...args)` | deep copy of `defaults`, or the result of calling it (with `args`) if it's a function |
| `slot.load()` | validated state, or `null` — never throws, including when the storage object itself throws on read |
| `slot.save(state)` | returns `false` on quota/private-mode failure |
| `slot.clear()` | erases the key without building a fresh state. Returns whether a key was there |
| `slot.reset(...args)` | `clear()` then `fresh(...args)` |
| `slot.autosave(getState, ms)` | `{ mark, flush, stop }` — coalesces writes, flushes on tab hide |
| `slot.exportToFile(state, name?)` | downloads `<game>-save-YYYY-MM-DD.json`, or `name` if given |
| `slot.promptImport()` | opens a file picker, resolves with state |
| `slot.serialize/deserialize` | the pure envelope pair (what the tests drive) |
| `slot.memoryOnly` | true when the browser blocks storage — warn the player |
| `slot.usage()` | this key's size and the origin's, in UTF-16 code units; `share` against the 5 MiB rule of thumb |
| `slot.lastError` | why the last write failed: `{name, message, quota, chars, at}`, or `null` |
| `slot.tier` | `"local"` or `"memory"`; an async slot adds `"idb"` |
| `createAsyncSaveSlot(opts)` | the same slot over IndexedDB, every call a promise; `fallback`, `promoted` |
| `createNamespace(opts)` | many members under one prefix, one bundle file |
| `idbStorage()`, `asyncify()`, `memoryStorage()` | the storage adapters |
| `measureStorage()`, `probeHeadroom()`, `isQuotaError()`, `failureMessage()` | the accounting helpers |

`fresh`/`reset` forwarding arguments matters when day one depends on a choice
the module doesn't know about yet — Closing Time's opening career depends on
which brokerage the player just picked, which a zero-argument factory can't
express. `clear()` exists for a "wipe" control that shouldn't have to build
(and immediately discard) a throwaway state just to get to `location.reload()`.

## Who uses it

One adopter for four sessions, then eleven in the space of one round, and four
more since. Every hook below exists because a real adopter needed it;
none were added speculatively.

| Project | Storage key | Notable in its adoption |
| --- | --- | --- |
| **The Fourth Quarter** | `fq3d-save` | The reference integration (session 7). `defaults` as a factory, `repair`, and `buttons` were all added for it. Save bar now mounted on three screens, not just the start overlay |
| **Aphelion** | `aphelion-save-v1` | Save bar in the logbook rather than a title screen, since the title card vanishes for good once you board |
| **Closing Time** | `closingTime.save.v1` and `closingTime.hall`, members of one namespace | `repair` catches **content drift**, not just schema drift — see `migrate` vs `repair` above. Prompted the `fresh(...args)`/`reset(...args)` and `clear()` additions. The first `createNamespace` adopter: the career key unchanged as member `save.v1`, the hall of past careers as the second member |
| **Torchbearer** | `torchbearer-save` | Names its export after the hero, not the game — prompted the `filename` option on `mountSaveBar` |
| **The Absalom Inheritance** | `absalom-inheritance-save-v1` | `repair` clamps a wild coordinate back to a place a body can actually stand, not just to a number |
| **Corner & Kettle** | (`corner-and-kettle/js/save.js`, then still inside `coffee_shop_sim.html`) | Found the `load()`/`getItem` and private-mode construction gaps this session's fixes close |
| **Daredevil** | `daredevil-save-v1` | Deliberately does not save the line index inside a scene, so rewriting prose can't strand a save mid-sentence |
| **Integer Foundry** | `integer-foundry-save-v1` | `slot.autosave()` replaced a hand-rolled 8-second `setInterval`; saves are under a second behind the screen now |
| **The Fracture Cycle** | `fracture-cycle-v1` | The smallest adoption on the list on purpose — one array, which endings have been seen, not a mid-story save |
| **Name Picker** | (thirteen `np_` keys) | Wraps every non-object key (arrays, bare strings) in `{value: …}` so the module's `{...state, __v}` spread can't silently corrupt it. See "a slot can't hold an array or a scalar" below |
| **Seating Chart Generator** | `seating-chart-v1` | Found the `typeof localStorage` construction-time throw this session's fixes close |
| **Faire Weekend** | `renn-faire-sim-save-v1` | Adopted at Stage 22, replacing hand-rolled `localStorage` calls. Kept the key it already had (#36), so an existing save carries no `__v`, reads as version 0, and comes through `repair` rather than `migrate` |
| **Golden Hour** | `gvb:golden-hour` | The only adopter that takes the default key rather than naming one, and the only one that saves a *subset* of its world on purpose: `journal.js` persists discoveries, and the sun's position and the player's are pointedly left out |
| **Signal City** | `signal_city_v1` | Saves stars and best points per level and the unlock list, nothing mid-run: a level is three minutes and replayable. `repair` clamps stars to 3, floors bad numbers at 0 and drops null level records (#539) |
| **Castle Conundrum** (moved out 2026-09-15, #491; vendored fork) | `castleConundrumSave_v1` | `repair` builds its id catalog from the game's own data files (`mystery.json`, `quest.json`) rather than a list kept beside them, so the ids a save may carry cannot drift from the ids the game renders (#413). The schema was written in full one phase before most of it is used, so no later phase adds a field |

Fourteen of those fifteen are still in this repo; Castle Conundrum left on
2026-09-15 with a vendored copy of the module (#491). Its row stays because
what it taught this module did not leave with it.

Common thread across all fourteen: nobody needed a hook that didn't already
exist by the time they went looking, except the five gaps found this round
(`load()`'s unguarded `getItem`, the `typeof localStorage` throw at
construction, `fresh`/`reset` forwarding, `clear()`, and `mountSaveBar`'s
`filename`/`labels`/import-ordering) — all fixed as of this session.

**A slot can't hold an array or a bare scalar.** `save()` writes
`JSON.stringify({...state, __v: version})`, and spreading an array produces an
object with numeric-string keys, not an array; spreading a string does
something similarly wrong. Every adopter above happens to store an object
except Name Picker, which works around it (`np-store.js`'s `boxed()`: box as
`{value: …}` for the module, unbox on write so the on-disk format is
untouched). Worth a `box: true` option on `createSaveSlot` if a second project
hits the same wall — one data point isn't enough to add it yet.
