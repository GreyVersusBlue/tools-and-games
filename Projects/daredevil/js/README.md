# Daredevil's `js/` — module map

Four ES modules, no bundler, no build step. `index.html` loads exactly one of
them directly (`<script type="module" src="./js/engine.js">`); the rest are
imported.

```
state.js    <- save.js
   ^
   |
scenes.js --+
   |
engine.js  <- scenes.js, state.js, save.js
```

- **`save.js`** — the save format, on top of `assets/js/gvb-save.js`. Unchanged
  by the round-2 restructure; see its own header.
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
- **`_requires: () => bool`** on a choice hides it entirely (not disables —
  `showSceneEnd()` in `engine.js` skips it) when false.
- **`_gateCheck: () => bool`** on a choice shows it disabled, with
  `_gateReason` as the lock note, when false.
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
- The four free-roam hubs build their own card lists in `engine.js`
  (`renderHubFR1`/`renderHubFR2`/`renderHubFR3`/`renderHubFR4`) rather than
  reading a list out of `SCENES` — a new hub card needs an entry in the
  relevant `renderHubFRn()` function, not just a new scene id here.

## Verifying a change

`Projects/daredevil/test/smoke-page.mjs` walks every `goto`/`next` target and
plays two full runs; `transcript.mjs clean`/`rough` writes down every line and
choice offered. Diff a fresh transcript against the one in `test/transcripts/`
after any content change — a lost branch gives no error, just a choice that
quietly stops being offered.
