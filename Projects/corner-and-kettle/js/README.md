# Corner & Kettle's `js/` — module map

Eight ES modules, no bundler, no build step. `../index.html` loads exactly one
of them (`<script type="module" src="./js/ui.js">`); the rest are imported.
`Projects/coffee_shop_sim.html`, where the whole game used to live, is a
redirect stub.

```
content.js <- nothing          sim.js <- nothing           sound.js <- nothing
    ^                            ^                             ^
    |                            |    stations.js <- nothing   |
draw.js <- content.js            |    chalkboard.js <- nothing |
    ^                            |          ^                  |
    |                            |          |                  |
ui.js <- content.js, sim.js, draw.js, sound.js, stations.js, chalkboard.js,
         save.js, ../../../assets/js/gvb-save.js
                  ^
save.js <- ../../../assets/js/gvb-save.js
```

**The split is model and view.** `content.js` and `sim.js` are the game: what
the shop sells and everything that happens to it, runnable in Node with a seed.
`ui.js`, `stations.js` and `chalkboard.js` are the page, and none of them owns
a rule. `test/smoke-sim.mjs` section 10 reads all five view modules and fails
if one writes `state.money`, a cup's fields, a plate, an unlock set, an
upgrade, a promotion or training, or calls a `doUnlock()` again.

- **`content.js`** — the tables: recipes, foods, milks, syrups, toppings,
  phases, staff tiers, every upgrade and its price, daily modifiers, random
  events, the starting unlocks, sprite palettes, and the reopening layer —
  the bean rates, `META_UPGRADES`, `SHOP_LAYOUTS` (Phase 7, #360). **It reads no `state`**, and
  section 10 checks that it never does; a tuning function that needs the shop
  belongs in `sim.js`. A new recipe is one row here, and joins the save catalog
  through `buildCatalog` in `ui.js`, not by hand.
- **`sim.js`** — `createSim({content, rng, state, notify})`: spawning,
  patience, order generation, the requirement list, the barista, scoring, the
  day, prestige, and three tables a click goes through.
  `getOrderRequirements(order)` returns the ticket's lines, each with `label`,
  `station`, `check(slot)` and `apply(slot)`, and the ticket, the tab dots
  (`stationsNeedingWork`), the Serve button (`serveReadiness`), the barista
  (`autoAssistStep`) and the scorer all read it. `cupAction(slot, action,
  value, cup)` and `cupActionMs(action)` are every station button;
  `canBuy(type, id, extra)` and `purchase(type, id, extra)` are every
  chalkboard button — `canBuy` reports the price `purchase` will take, discount
  and all, plus which currency it comes out of (#362, #363). The reopening
  layer is derived rather than stored (#361): `recipeAvailable(id)` is the one
  answer to "is this on the menu", `metaOwned`/`metaDiscount`/`boardCost` read
  the bean tree, `currentLayout`/`layoutsFor` the configuration, and
  `reopenPreview()` is the kept/earned/lost ledger the page's confirmation
  renders. **It imports nothing and touches no DOM, timer or wall
  clock**: the tables come in as an argument, time comes from `advance(dtMs)`
  and chance from the injected `rng`, which is what lets a 136-second shift run
  in milliseconds and run the same way twice. Anything the page must show
  leaves through `notify()`.
- **`save.js`** — the save schema over the shared `gvb-save.js`: `validate`,
  `migrate`, `repair`, `toSaveData`, `applyToState`, `buildCatalog`. Key
  `cornerKettleSave_v1`, which never changes (#36). `meta: {beans, unlocks}`
  and `layoutId` are the permanent layer, outside every field a reopening
  resets, both clamped in `repair` the way `loyaltyLevel` and `upgrades` are. Imported by `ui.js` and
  `test/smoke-save.mjs`, never by `sim.js`: the sim does not know it is saved.
- **`draw.js`** — string builders: the customer sprite, the cup SVG, the order
  bubble, the ticket, and the customer's accessible name. **A leaf over
  `content.js`**: no `state`, no sim, no DOM. It takes the order or cup it
  draws, and the ticket takes its requirement lines as an argument rather than
  asking the sim.
- **`sound.js`** — `createSound(isMuted)`, every sound as a WebAudio beep.
  **Imports nothing.** `isMuted` is a function, asked on each beep, so the mute
  button works mid-shift.
- **`stations.js`** — `createStations(ctx)`: the seven tabs, the buttons in
  each, the progress bars, the presets tab, and the panel's key map. **Imports
  nothing**: `ui.js` hands it `state`, `sim`, `toast`, `sound`, `renderAll` and
  `saveNow`. It needs `renderAll` and `ui.js` needs it, so an import either way
  would be a cycle; passing the functions in keeps it a leaf that `ui.js` sits
  on. A timed button captures the cup it was clicked on, so a bar that finishes
  after a Dump lands in the dumped cup, as it always has. **The key map is read
  off the panel after it renders** (#367): `bindKeys()` walks
  `#stationsAll .actionbtn:not([data-nokey])` in DOM order, hands out
  `KEY_ALPHABET` (`q` to `p`, ten letters), sets `aria-keyshortcuts` and the
  title, and returns the array `renderKeyLegend()` prints into `#keyLegend`.
  One pass over one list, so the legend cannot go stale. `pressKey(key)` finds
  the same button and **clicks it** — the bar, the sound and the `disabled`
  refusal are the click's, and re-checking `disabled` here would be a branch
  that can never run (#369).
- **`chalkboard.js`** — `createChalkboard({state, sim, buy})`: the Menu Board,
  including the Legacy section and the reopen row. **Imports nothing**, for the
  same reason. Every button's `disabled` is `sim.canBuy()`, **and so is every
  price it prints** (#363), and every click is `buy` — so the rule that enables
  a button, the number on its face and the rule that takes the money are one
  rule (#344).
- **`ui.js`** — the entry. Builds the state, the sim and the save slot; draws
  the topbar, queue and counter; owns `serveSlot()`, `buy()`, the frame loop,
  the day-end modal, the reopen ledger (`showReopenLedger()`, built from
  `sim.reopenPreview()`), the keyboard shortcuts (digits for the tabs, `[` and
  `]` across the stations with a wrap, `S` to serve, and everything else handed
  to `stations.pressKey()` last so a letter the panel claims can never shadow
  one of those), the save bar and boot; and assigns
  `window.__CK_DEBUG__` last, which is what `test/drive-save.mjs` waits on as
  proof the module ran. `renderAll()` marks the save dirty and a timer writes
  it at most every 4 s; a serve, a purchase, the end and start of a shift, a
  preset, mute, an import and New Game write at once (#346).

## Adding things

- **A recipe, food, syrup or topping:** a row in `content.js`. If it needs a
  new kind of ticket line, add the line to `getOrderRequirements()` with its
  `station` and `apply`; the dot, the button, the barista and the scorer pick it
  up, and `smoke-sim.mjs` section 11 fails on a line whose station is not a tab
  or whose `apply` does not satisfy its own `check`.
- **A chalkboard purchase:** a row in `sim.js`'s `PURCHASES` (`cost`, `refuse`,
  `apply`, and `currency` if it is not dollars), then a button in
  `chalkboard.js` that calls `buy(type, id)` and prints `price(type, id)`.
  Section 12 fails if a type in the table is never exercised.
- **A Legacy unlock or a shop layout:** a row in `META_UPGRADES` or
  `SHOP_LAYOUTS`, its id added to `buildCatalog`'s `metaUpgrades`/`layouts` in
  `ui.js` and to `smoke-save.mjs`'s fixture (which is checked against the real
  tables), and whatever reads it — `META_MENU`/`META_DISCOUNT` for an unlock
  with an effect of its own, `prestige()` for one that only a reopening can pay
  out. An unlock not named anywhere is dropped by `repairSave` on the next
  load.
- **A prestige-gated recipe:** `prestigeGated: n` on the row in `content.js`,
  and nothing else. `recipeAvailable()` derives it and the chalkboard draws a
  locked row for it; money will not buy it. Keep it buildable out of the
  day-one milks and syrups — a reopened shop has no button for anything else —
  and give it a requirement list the menu does not already have (#365).
- **A station button:** a row in `CUP_ACTIONS` (`ms`, `run`), then the button in
  `stations.js`; a timed one also goes in its `TIMED` map with its bar and
  sound. It picks up a key and a legend row on its own, because both are read
  off the rendered panel — unless it is a control that should not have one, in
  which case give it `data-nokey`.
