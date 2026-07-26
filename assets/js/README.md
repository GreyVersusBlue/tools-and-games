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
  defaults: { day: 1, cash: 2500 },  // what fresh() hands back
  validate: s => s && typeof s.day === "number",
  migrate: (s, from) => {            // called when a stored save is behind
    if (from < 2) s.brokerage ??= "bk_indep";
    if (from < 3) s.stats ??= { closed: 0 };
    return s;
  }
});

let state = slot.load() ?? slot.fresh();
slot.save(state);
```

`load()` returns `null` — never throws — for an empty key, corrupt JSON, a
save that fails `validate`, or a migration that blows up. Booting on a bad
save is the failure mode this exists to prevent.

## The save bar

Three buttons wired to the slot, dropped into any container:

```js
mountSaveBar(document.getElementById("save-bar"), slot, {
  getState: () => state,
  setState: s => { state = s; redraw(); },
  onMessage: text => toast(text)     // optional; falls back to inline text
});
```

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
| `slot.fresh()` | deep copy of `defaults` |
| `slot.load()` | validated state, or `null` |
| `slot.save(state)` | returns `false` on quota/private-mode failure |
| `slot.reset()` | clears the key, returns a fresh state |
| `slot.autosave(getState, ms)` | `{ mark, flush, stop }` — coalesces writes, flushes on tab hide |
| `slot.exportToFile(state)` | downloads `<game>-save-YYYY-MM-DD.json` |
| `slot.promptImport()` | opens a file picker, resolves with state |
| `slot.serialize/deserialize` | the pure envelope pair (what the tests drive) |
| `slot.memoryOnly` | true when the browser blocks storage — warn the player |

## Not adopted anywhere yet

The module and its tests ship standalone. Wiring it into an existing sim
means replacing that project's own save functions, which changes save-key
behaviour for anyone mid-campaign — do it per project, deliberately, and
keep the old key readable through `migrate` for one version.
