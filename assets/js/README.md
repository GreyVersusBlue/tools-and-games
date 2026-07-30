# `gvb-save.js` — the shared save system

One save implementation for every sim on the site, generalized from the
Fourth Quarter's campaign save (namespaced key, schema version, defensive
load) with export/import added on top.

No dependencies. ES module. Run the tests with:

```
node assets/js/gvb-save.test.mjs
```

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

`fresh`/`reset` forwarding arguments matters when day one depends on a choice
the module doesn't know about yet — Closing Time's opening career depends on
which brokerage the player just picked, which a zero-argument factory can't
express. `clear()` exists for a "wipe" control that shouldn't have to build
(and immediately discard) a throwaway state just to get to `location.reload()`.

## Who uses it

One adopter for four sessions, then eleven in the space of one round. Every hook
below exists because a real adopter needed it; none were added speculatively.

| Project | Storage key | Notable in its adoption |
| --- | --- | --- |
| **The Fourth Quarter** | `fq3d-save` | The reference integration (session 7). `defaults` as a factory, `repair`, and `buttons` were all added for it. Save bar now mounted on three screens, not just the start overlay |
| **Aphelion** | `aphelion-save-v1` | Save bar in the logbook rather than a title screen, since the title card vanishes for good once you board |
| **Closing Time** | `closingTime.save.v1` | `repair` catches **content drift**, not just schema drift — see `migrate` vs `repair` above. Prompted the `fresh(...args)`/`reset(...args)` and `clear()` additions |
| **Torchbearer** | `torchbearer-save` | Names its export after the hero, not the game — prompted the `filename` option on `mountSaveBar` |
| **The Absalom Inheritance** | `absalom-inheritance-save-v1` | `repair` clamps a wild coordinate back to a place a body can actually stand, not just to a number |
| **Corner & Kettle** | (`coffee_shop_sim.html`'s save) | Found the `load()`/`getItem` and private-mode construction gaps this session's fixes close |
| **Daredevil** | `daredevil-save-v1` | Deliberately does not save the line index inside a scene, so rewriting prose can't strand a save mid-sentence |
| **Integer Foundry** | `integer-foundry-save-v1` | `slot.autosave()` replaced a hand-rolled 8-second `setInterval`; saves are under a second behind the screen now |
| **The Fracture Cycle** | `fracture-cycle-v1` | The smallest adoption on the list on purpose — one array, which endings have been seen, not a mid-story save |
| **Name Picker** | (thirteen `np_` keys) | Wraps every non-object key (arrays, bare strings) in `{value: …}` so the module's `{...state, __v}` spread can't silently corrupt it. See "a slot can't hold an array or a scalar" below |
| **Seating Chart Generator** | `seating-chart-v1` | Found the `typeof localStorage` construction-time throw this session's fixes close |

Common thread across all eleven: nobody needed a hook that didn't already
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
