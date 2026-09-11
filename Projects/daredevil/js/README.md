# Daredevil's `js/` — module map

Six ES modules, no bundler, no build step. `index.html` loads exactly one of
them directly (`<script type="module" src="./js/engine.js">`); the rest are
imported.

```
money.js    <- nothing        cast.js  <- nothing
   ^                             ^
   |                             |
   +-------- save.js -------------+
                ^
                |
             state.js   <- save.js (re-exports cast.js)
                ^
                |
             scenes.js --+     <- state.js, money.js
                |
             engine.js         <- scenes.js, state.js, save.js, money.js
```

- **`cast.js`** — the six characters as one table (Phase 3): id, display
  name, legal states in order, a label per state, which state means never met,
  and the start state. With it, the helpers everything else uses to read the
  table: `statesOf()`/`presentStates()` build a `_needs` list, `meetsNeeds()`
  tests one, `setRel()` is the one door for writes and throws on a character
  or state the table does not know, `routeByCast()` scans a route table, and
  `castName()`/`relLabel()` are what the two screens that print a relationship
  read, and `rosterFor()` is the whole of the ending screen's relationship
  list — who was in the run, in the table's order, with each state's label. A
  leaf below `state.js` because `save.js` needs it and `state.js` imports
  `save.js`; `state.js` re-exports all of it, so story and engine keep one
  import.
  **Adding a state to a character means writing something that sets it.**
  `smoke-save.mjs`'s reachability check fails on a legal state no scene and no
  engine call can write, because a state nothing writes is a state every gate,
  label and prose closure keyed to it is dead against and nothing throws. Three
  are still dead — `ruthie: 'strained'`, `ruthie: 'absent'`, `earl:
  'antagonist'` — and are frozen in a list there that can shrink and not grow.
- **`money.js`** — the hub economy as one table (Phase 6): how many evenings
  each hub hands out, what each evening card costs in dollars and Condition,
  what a stretch of shows pays on each branch, the twelve hundred for the cars
  and the nine hundred the school district wants for thirteen buses. With it,
  the functions that move `GS.flags.money`: `payHubTake()` credits a hub's take
  once, `spendEveningCost()` takes a card's price, `costTag()` is the string the
  card's tag slot prints, `canAffordBuses()` is the Milestone 4 gate, and
  `spend()` refuses what is not there rather than going negative.
  **It imports nothing, and it has to.** `save.js` seeds `money` and Free Roam
  1's budget in `freshState`, so a money module that reached for `GS` itself
  would close the loop `save.js -> money.js -> state.js -> save.js` and read
  `GS` out of the temporal dead zone — the same trap `state.js` exists to
  avoid, one level down. Every function here takes the state it works on as an
  argument, which also makes the whole economy testable under plain Node.
  **Adding a hub evening card means adding a price row.** `smoke-save.mjs`
  scrapes each renderer's own `eveCards` list and fails on a card with no price
  and on a price naming no card.
- **`save.js`** — the save format, on top of `assets/js/gvb-save.js`. Seeds
  the relationships from the cast and repairs a loaded one against it: an
  illegal state goes back to the character's start state, a key the cast does
  not know is dropped. The purse comes back through the same door: `money` and
  `monthlyOutgo` are coerced to whole non-negative numbers, because a string in
  either turns every later sum into `NaN` and a `NaN` purse compares false
  against every price with no error anywhere.
- **`state.js`** — `GS` (live game state), `STAT_LABELS`, and the line-builder
  helpers `N()`/`D()`/`C()`/`NF()`. This is its own module, not folded into
  `engine.js`, for one reason: `scenes.js`'s `SCENES` object calls `N()`/`D()`/
  `C()` and reads `GS.town`/`GS.name` **at module-evaluation time**, not inside
  functions. If those bindings lived in `engine.js`, and `engine.js` imported
  `SCENES` from `scenes.js`, the two modules would import each other — and in
  a circular import, whichever module's turn it is to evaluate second reads
  the first module's not-yet-initialized bindings out of the temporal dead
  zone. `state.js` is a leaf both `scenes.js` and `engine.js` depend on,
  depending on neither, so there is no cycle.
- **`scenes.js`** — the story, as data. `SCENES`, 4,260 lines, 208.3 KB, 62% of
  what was one 6,888-line file before this round. A full run reads 43% of it.
  See "Authoring a scene" below.
- **`engine.js`** — everything else: screen management, scene rendering, the
  four free-roam hubs, the three canvas minigames (the Stunt Run, the
  Recovery, and — newly wired this round — Work the Crowd), the epilogue, and
  the boot block. Imports `SCENES` and renders it; never mutates its own
  behavior based on which scenes exist beyond what `SCENES[id]` naturally
  provides.

## Authoring a scene

A minimal scene:

```js
my_scene_id: {
  art: 'fr2',                    // one of getArtBg()'s keys in engine.js — a background gradient, not an image
  artLabel: 'Free Roam 2 · Something',
  bgText: 'A WORD OR TWO',       // faint background overlay text; optional
  lines: [
    N(`Plain narration.`),
    D(`Duke's own line.`),
    C('EARL', `Anyone else's line — first arg is the speaker tag shown above it.`),
  ],
  choices: [                     // omit for a linear scene; engine renders a "— Continue —" button instead
    { label: 'A', text: 'What the player sees.', subtext: 'Smaller text under it.',
      effects: { stats: { nerve: 1 }, rels: { cal: 'loyal' }, flags: { someFlag: true } },
      goto: 'next_scene_id' },
  ],
  statUpdate: {                  // optional — shows the stat-update screen before `next`/the choice's goto
    title: 'A Title', reason: 'One line of why.',
    deltas: { showmanship: 1 }, rels: {}, flags: {},
  },
  next: 'next_scene_id',         // used when there are no `choices`
},
```

- **A plain template literal in `N()`/`D()`/`C()` is evaluated once, at
  import time** — with whatever `GS` holds at that moment (the fresh-state
  defaults, since a player hasn't set a name or town yet). This is why
  `cold_open_01`, `cold_open_02`, `cold_open_08` and `fr1_organizer` all
  reference `GS.town` directly and it still works: `engine.js`'s
  `patchDynamicScenes()` overwrites those specific lines by hand, once, right
  after the setup screen. **Any new scene that needs to react to `GS` — a
  relationship, a flag, a stat — must NOT rely on a patch list.** Pass a
  function instead: `N(()=> GS.rels.ruthie === 'solid' ? 'a' : 'b')`.
  `buildLines()` in `engine.js` calls it at render time, every time the scene
  is shown. `NF(fn)` does the same thing through a second, otherwise-unused
  code path (`_fn` on the line instead of `text`) that predates this round —
  new content should prefer the `N(fn)`/`C(fn)`/`D(fn)` form, since that is
  what the rest of the file already does.
- This is the exact bug fixed this round: `m5_retire_clean` and
  `fr4_night_ride` both used a plain template literal to reference Ruthie
  unconditionally, so both lines ran on runs where she was never established.
  The epilogue's own relationship roster correctly omits her when absent — the
  game was contradicting itself. Fixed by switching both to the function form.
- **`_needs: { id: [state, ...] }`** on a choice hides it entirely unless
  every named character is in one of the listed states. Build the list from
  the cast — `statesOf('earl', { not: ['absent'] })`, `presentStates('pete')`,
  or a literal like `['solid']` — and a typo throws at import. This is the
  form for any relationship gate: it is data a walker can read without running
  the game, and `smoke-save.mjs` fails on a `_requires` that tests `GS.rels`.
  Hub cards in `engine.js` carry the same field.
- **`_requires: () => bool`** on a choice hides it entirely (not disables —
  `showSceneEnd()` in `engine.js` skips it) when false. For anything genuinely
  computed that is not a relationship — one use in the file, the car-show
  answer at `fr2_eve_bar`, which is only there when Free Roam 1's bar night
  set `tommyAsked`. A relationship gate goes in `_needs`, and `smoke-save.mjs`
  fails on a `_requires` that reads `GS.rels`.
- **`_gateCheck: () => bool`** on a choice shows it disabled, with
  `_gateReason` as the lock note, when false.
- **Stat numbers go on the choice, not on the scene the choice names.** A
  scene reached by a `goto` and carrying a `statUpdate` fires it twice —
  `handleChoice()` before the scene and `afterScene()` at the end — and both
  calls apply `deltas`. Measured: `fr2_danny_01` option B takes showmanship
  from 0 to 3 for +1 on the choice and +1 on the scene. So put `stats` in the
  choice's `effects`, where `applyEffects()` runs them once, and keep `rels`
  and `flags` on the `statUpdate`, where the stat screen announces the
  relationship move and a second write changes nothing. `smoke-save.mjs`
  freezes the thirty-three scenes that already do it and fails on a
  thirty-fourth.
- **`_gateRoute: () => id | null`** on a scene redirects on entry when it
  returns a truthy id — see `fr3_eve_ruthie` for the pattern (splits on
  `GS.flags.ruthieAsked`).
- **Special `goto`/`next` targets starting with `_`** (`_chapter_m2`,
  `_hub_fr2`, `_minigame_stunt_m1`, `_minigame_crowd_m1`, …) are handled
  procedurally by `goToScene()` in `engine.js`, not looked up in `SCENES`.
  `smoke-page.mjs` checks every `goto`/`next` in the file against both
  `SCENES` and this list — see "every goto/next target is routable" there —
  so a new special id needs a matching `if(id === '_your_id')` block in
  `goToScene()`, and a new scene id just needs to exist in this file. Either
  way, run that check after adding one.
- **Dollars go on `effects`, never on a `statUpdate`.** `effects: { money: -300 }`
  is a signed delta (a flag write would set the integer, not add to it), and
  `effects: { owePerMonth: 108 }` adds to the monthly paper; either may be a
  function, resolved at apply time the way a line or a subtext is. Do NOT put
  them on a scene's `statUpdate`: a scene reached by a choice fires its update
  twice, which does nothing to a flag or a relationship write and doubles a
  running total. `triggerStatUpdate` no longer reads either key and
  `smoke-save.mjs` fails on a `statUpdate` that carries one.
- An evening card needs a row in `money.js`'s `EVENING_COST`, and the hub's
  budget in `HUB_EVENINGS` has to stay below the number of cards the renderer
  can build. `buildHubCard` prints the price into the tag slot off that row, so
  a card no longer carries a `tag:` of its own unless the tag is saying why the
  card is shut — "(Ruthie not established)", "(The cars first)".
- The four free-roam hubs build their own card lists in `engine.js`
  (`renderHubFR1`/`renderHubFR2`/`renderHubFR3`/`renderHubFR4`) rather than
  reading a list out of `SCENES` — a new hub card needs an entry in the
  relevant `renderHubFRn()` function, not just a new scene id here. A card
  that exists only for some state of a character says so with `_needs`, the
  same field a choice uses.
- **Who Duke talks to before the Milestone 3 and 4 stunts, and who asks him
  the question in Milestone 5**, are the three route tables at the top of this
  file (`M3_PRESTUNT_ROUTES` and its siblings): rows of `{ who, states,
  scene }` in priority order, plus a fallback scene for nobody. `goToScene()`
  scans them with `routeByCast()`. A row on a state the character cannot hold
  throws the first time it is scanned, and `smoke-save.mjs` checks every row
  names a real scene.

## Verifying a change

`Projects/daredevil/test/smoke-page.mjs` walks every `goto`/`next` target and
plays two full runs; `transcript.mjs clean`/`rough` writes down every line and
choice offered. Diff a fresh transcript against the one in `test/transcripts/`
after any content change — a lost branch gives no error, just a choice that
quietly stops being offered.
