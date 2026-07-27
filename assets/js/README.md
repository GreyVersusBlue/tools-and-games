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
  onMessage: text => toast(text)     // optional; falls back to inline text
});
```

`buttons` picks which of `export` / `import` / `reset` get mounted. Leave `reset`
out when the page already has its own new-game control — two buttons that erase a
campaign, side by side, is a trap. Each button carries `data-gvb="export"` and so
on, so a driver script can click one without depending on order or label text.

`setState` gets a state the game has to actually take up: reloading the world,
redrawing, whatever a fresh start does. An imported save can be from any point in
a campaign, not just the one the page is currently showing.

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
| `slot.fresh()` | deep copy of `defaults`, or the result of calling it if it's a function |
| `slot.load()` | validated state, or `null` |
| `slot.save(state)` | returns `false` on quota/private-mode failure |
| `slot.reset()` | clears the key, returns a fresh state |
| `slot.autosave(getState, ms)` | `{ mark, flush, stop }` — coalesces writes, flushes on tab hide |
| `slot.exportToFile(state)` | downloads `<game>-save-YYYY-MM-DD.json` |
| `slot.promptImport()` | opens a file picker, resolves with state |
| `slot.serialize/deserialize` | the pure envelope pair (what the tests drive) |
| `slot.memoryOnly` | true when the browser blocks storage — warn the player |

## Who uses it

**The Fourth Quarter** (`Projects/fourth-quarter/js/campaign.js`), since session 7.
It is the worked example, and the three things it needed are the three things that
got added when it landed:

- `defaults` may be a **factory**. `newCampaign()` rolls three random job
  applicants, so day one could not be a literal, and without this `reset()` was
  useless to it.
- `repair`, above. The old `loadCampaign()` ran its fill-ins on every load; there
  was no hook with that shape.
- `buttons`, above. The start screen has shipped a "New Game (wipe save)" button
  since long before this module existed.

The storage key stayed `fq3d-save`, so campaigns saved by older builds still load:
they carry no version stamp, `normalize()` reads that as version 0, and `repair`
fills in every field added since. **Keep the old key** when you adopt this
somewhere else — changing it silently abandons everyone mid-campaign.

What the game got for it: export a campaign to a file and load it back (it
survives a cleared browser now), a memory-backed fallback when the browser blocks
storage, and one implementation of "refuse to load garbage" instead of one per
project. `Tools/board-check/play-games.mjs` drives all of that in a real browser —
export, import through the file picker, reload, and a pre-versioning save.
