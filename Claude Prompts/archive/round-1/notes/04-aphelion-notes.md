# Aphelion — session notes

## What changed

**Vendored the two Google Fonts.** `index.html` asked for
`IBM+Plex+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,500;1,400` — exactly
five face/weight/style combinations, no more. Pulled the matching latin-subset
woff2 files straight from `Tools/board-check/node_modules/@fontsource/{ibm-plex-mono,lora}/files/`
(already on disk, npm-authoritative) into a new `Projects/aphelion/assets/fonts/`,
with a README naming source and licence (SIL OFL 1.1, IBM Corp. / The Lora
Project Authors). **Total: 95,400 bytes, 93.2 KB** for all five files. Replaced
the two `preconnect` links and the `fonts.googleapis.com` stylesheet link with
five local `@font-face` rules in `index.html`'s `<style>` block.

**Adopted `assets/js/gvb-save.js` in `src/state.js`.** Same shape as the
Fourth Quarter's `campaign.js`: `SAVE_KEY`/`SAVE_VERSION` exports, a
`validateState`/`repairState` pair, `aphelionSlot(storage)` cached per-storage
(mirrors `campaignSlot()`), and thin `save()`/`load()`/`resetSave()` wrappers
that keep the module's external API the same so `main.js` barely had to
change. **Key stayed `aphelion-save-v1`** — nothing about the storage location
moved. `validateState` only gates the three fields `tick()` dereferences
unconditionally every frame with no guard of its own (`day`, `plant`,
`systems`) — everything else (arrays, counters, `hour`) is a gap `repairState`
fills, per the migrate-vs-repair split (locked decision #37). `mode` (interior
vs. EVA) is stripped before every save and forced back to `'interior'` on
every load, same as the old hand-rolled version — it's the one field that was
never meant to persist.

**Mounted the save bar in the logbook, not behind a reload.** v7 §9 flagged
that the Fourth Quarter's bar only lives on its start screen, so exporting
mid-campaign needs a reload first. Aphelion doesn't have a persistent start
screen to hang a bar off of — the title card vanishes for good once you board
— so the logbook (`Tab`, reachable any time play is underway) gets a
`#savebar` div instead, styled with the module's CSS custom properties to
match the ship's amber panel theme. Buttons: `export`, `import`, `reset`, in
that order. `setState` (called after both import and reset) does the same
re-sync a fresh boot does: `initSystems()` to fill any missing system ids,
rebuild the plant mesh and curio shelf from the loaded state, re-render the
logbook, refresh the HUD, clear any in-progress repair/scan, and snap the
player back inside the ship if the import lands mid-EVA (position doesn't
persist at all — it never did, even before this session — so this just
matches what a normal reload already does).

**Wrote `Projects/aphelion/test/smoke-state.mjs`**, 23 checks, plain Node, no
DOM/THREE dependency (matches how `state.js` imports `gvb-save.js` — by
relative path, `../../../assets/js/gvb-save.js`, so Node can resolve it).
Covers: a fresh state passes its own validator, save/load round-trips, the
version stamp lands and gets stripped, corrupt JSON and saves missing the
three gated fields are refused, a save with a valid `day` but no `plant`
object at all is refused rather than patched (validate has to run before
repair gets a chance), an unversioned pre-adoption save still loads and gets
every field-added-since filled in by `repairState`, export/import envelope
round-trips and refuses another game's file, `reset()` wipes the key, and
`state.js`'s own `save()`/`load()`/`resetSave()` wrappers work with an
injected storage stub.

**Audit findings, and what got built from them:**

- **Fun.** The "no fail states, no timers, no enemies" design is deliberate
  (README says so up front) and the systems/hydroponics loop earns that —
  but the EVA/logbook side of the loop was thin to the point of being a single
  action: `data/poi.json` had exactly **one** point of interest, ever, and
  `data/logs.json` had five day-gated entries plus one discovery, meaning the
  day-progression content dead-ends on day 5 forever. The four data files
  really are the extension point the README claims — `ship.js`'s POI-building
  loop and `main.js`'s day-unlock loop are both generic over array length,
  zero code changes needed — so the fix was content, not a refactor. Added
  two more POIs (`data/poi.json`: a frozen cargo pod, an old escape pod) with
  matching discoveries, and three more log entries (`data/logs.json`, days
  6–8) continuing the established first-person, present-tense voice.
- **Performance.** Measured, not guessed (locked decision #42's spirit
  applies here too): hooked `gl.drawElements`/`gl.drawArrays` for one real
  second while stationary near the spawn point — **6,235 `drawElements` calls
  and 145 `drawArrays` calls per second**, which at 60 fps is roughly 104
  draw calls a frame from a scene with maybe three dozen unbatched meshes.
  That's nothing for any GPU built this decade. No instancing work is
  justified by these numbers, so none was done.
- **Audio.** `src/audio.js` builds real WebAudio nodes — oscillators, a gain
  stage, a lowpass filter — wired to `ctx.destination` and started from
  `initAudio()` on the title click, not stubs or dead code. Confirmed the
  wiring is real and `AudioContext` is available in the test browser;
  couldn't verify by ear in this environment (no speaker output from a headed
  Playwright session), so that part is "the code is real," not "I heard it."
- **Accessibility.** WASD movement itself doesn't require pointer lock — it
  reads `this.keys` unconditionally — but mouse-look does (`if (!this.locked
  || !this.enabled) return;` in the `mousemove` handler), so a browser or
  policy that blocks pointer lock left a player able to walk in a straight
  line and nothing else. Added arrow-key look in `controls.js`
  (`ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown`, 1.8 rad/s) writing to the
  same `yaw`/`pitch` fields the mouse handler owns, unconditional on lock
  state — composes with mouse input rather than fighting it, whichever moved
  last wins. Updated the title-card hint text and the README's controls table
  to mention it.

## What I verified

- `node test/smoke-state.mjs` → **23 passed, 0 failed**.
- Headed Chrome (Playwright, `channel: 'chrome'`, matching locked decision
  #25 — the in-app pane never composited a WebGL frame when I tried it,
  screenshots timed out exactly as documented):
  - Opened Aphelion via `games.mjs`'s `enter()`. Network log showed 200s from
    `assets/fonts/*.woff2` under the game's own origin and zero requests to
    `fonts.googleapis.com`/`fonts.gstatic.com`. `document.fonts.status` was
    `"loaded"`; computed `font-family` on `#title h1` and `#daybox` resolved
    to `Lora`/`IBM Plex Mono`, not a fallback.
  - `grep -rn "fonts.googleapis\|fonts.gstatic" Projects/aphelion/` — the only
    hits are in my own `assets/fonts/README.md`, describing the history. Zero
    in `index.html` itself.
  - Save bar: `#savebar` exists inside the logbook with three buttons,
    `data-gvb="export"`/`"import"`/`"reset"`, in that order. Clicked export
    (hooking `URL.createObjectURL` the same way `play-games.mjs` does for the
    Fourth Quarter) and got back a `gvb-save` envelope naming `game: "aphelion"`,
    `version: 1`.
  - Arrow-key look: held `ArrowLeft` for 500 ms with no mouse input and no
    pointer-lock assumption — camera `facing` went `0 → 0.912` rad.
  - The two new POIs: traversed `window.__scene` for groups at all three
    declared positions (`[14,4,-22]`, `[-11,1,20]`, `[24,-5,8]`) — **3 of 3
    found**, zero page errors. (Didn't attempt a full scripted EVA walk-and-
    scan: Aphelion rolls its own controls that overwrite `camera.rotation`
    from private yaw/pitch every frame, so direct rotation writes like
    `aimAt`/`setYaw` don't stick — v6 §6 already documents this and says to
    use `lookAt`/`turnBy` instead, but those turn through a synthetic
    `mousemove` and didn't converge reliably in my testing either. Scene-graph
    inspection is the reliable check for "did the data-only change wire up
    correctly," and it's what I'd reach for again.)
  - Draw-call measurement described above, via a `gl.drawElements`/`drawArrays`
    hook, one real second, player stationary.
- `cd Tools/board-check && npm run check` → **242 units checked, 0 broken**;
  collision check → **0 collisions, tightest vertical gap 7.1px** (that check
  is the board's card-corner layout, unrelated to anything in this session).
- `npm run social:check` → **23 notices · 23 already current · 0 out of date
  · 0 failed**. Confirms I didn't hand-edit inside `index.html`'s
  `gvb:social` markers.
- `npm run games` → Aphelion's own 9 checks passed clean on **all three**
  runs I made. The suite as a whole reported 1 failure on the first run
  (Golden Hour, "mouse look turns the camera") and a different 1 failure on
  the second run (The Fourth Quarter, a pointer-lock `pageerror`) — neither
  game is in my boundary, and Aphelion's checks were identical and green
  across all three attempts. Third run: **94 checks, 0 failed**. This matches
  v7 §6's documented pattern exactly (a headed run loses frames or throws
  when something steals window focus in this multi-session repo) rather than
  looking like a regression from anything here.
- `git status` on the paths I touched: `README.md`, `index.html`,
  `src/controls.js`, `src/main.js`, `src/state.js`, `data/logs.json`,
  `data/poi.json` modified; `assets/fonts/` and `test/` new. Nothing outside
  `Projects/aphelion/` came from me.

## Shared-file requests

**`Tools/board-check/play-games.mjs`, Aphelion's block** — the save bar has
no regression coverage yet, the way the Fourth Quarter's does. Add, after the
existing TAB-closes-the-logbook check and before it closes again:

```js
await p.keyboard.press('Tab'); // reopen the logbook
await wait(400);
const barButtons = await p.$$eval('#savebar button', els => els.map(b => b.dataset.gvb));
t.ok(barButtons.join(',') === 'export,import,reset',
  'the save bar mounted three buttons in the logbook', barButtons.join(', '));

const exported = await p.evaluate(() => new Promise(resolve => {
  const orig = URL.createObjectURL;
  URL.createObjectURL = blob => { blob.text().then(resolve); return orig(blob); };
  document.querySelector('[data-gvb="export"]').click();
}));
const env = JSON.parse(exported);
t.ok(env.format === 'gvb-save' && env.game === 'aphelion' && env.version === 1,
  'Export save produced a gvb-save envelope', `${env.game} v${env.version}`);
await p.keyboard.press('Tab');
```

Nothing else needed a shared-file change this session — `gvb-save.js` already
had every hook this adoption needed (`repair`, `defaults` as a factory,
`buttons` on `mountSaveBar`), all added when the Fourth Quarter adopted it.

## Deliberately not done

**No touch/gamepad controls.** Arrow-key look closes the specific gap the
audit found — pointer lock denied or unavailable leaves a player stuck facing
one direction forever — without taking on a second full input scheme. Mobile
support would be a real feature with its own on-screen control layer, not a
same-session addition to an accessibility pass.

**No instancing or geometry batching.** Measured first (104 draw calls/frame,
roughly): there's no performance problem here to fix. Doing instancing work
anyway would be solving a problem the numbers say doesn't exist.

**No new ship systems, second plant, or crafting loop.** The README's own
"Extending it" section flags these as "bigger swings," and the audit's actual
finding was that the EVA/logbook side was thin, not the core systems/
hydroponics loop — scoped the content build to what the audit found thin,
not to every extension the README mentions as possible.

**Didn't verify audio by ear.** No speaker output from a headed Playwright
session in this environment. Confirmed the WebAudio graph is real (oscillators,
gain, filter, all connected and started) rather than dead code, which is as
far as this setup lets me verify without a person listening.

## Next session

Ordered by value per effort:

1. **Add the save-bar regression coverage above to `play-games.mjs`** — cheap,
   and it's the one piece of this session with zero automated guard right now.
2. **A direction hint for the EVA points of interest**, now that there are
   three of them scattered 20+ units out with nothing pointing toward them —
   a faint compass tick or distance readout in the HUD during EVA. Didn't
   build it this session (scope discipline: the audit's finding was "too
   little content," not "the content that exists is hard to find," and I
   don't have evidence yet that finding them blind is actually a problem
   rather than part of the point of drifting).
3. **Touch/gamepad input**, if this ever needs to run somewhere pointer lock
   isn't an option at all (a tablet, say). Bigger lift, not attempted.
4. Nothing else stood out. Core loop, data-driven extension points, and
   performance are all fine as measured.
