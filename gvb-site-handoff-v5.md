# gvb-site-handoff-v5.md

Handoff from **session 5** (site version 6) → whoever picks this up next.
Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v4.md` first if you have not. Everything in it still
holds unless contradicted below.

---

## 0. What changed in one paragraph

Session 5 cleared the top two items on v4's list, both of which had been
sitting there for three sessions. **The Guard/Scholar/Wizard ↔ Adventurer/
Farmer/King mapping is decided, implemented, and looked at** — with real
character models, real idle/walk/greet animations, and the Guard's mace
actually in his fist rather than floating beside him. **Castle Conundrum has
also been played through to victory on a real machine** — real pointer lock,
real WASD, real E presses, real typing into the riddle box — which turned up
and fixed a genuine placement bug nobody could see before: the Guard was
standing *inside* the gatehouse wall, invisible from every approach even
though the "Press E" prompt appeared. That playthrough is now a permanent
regression guard — **`npm run play` in `Tools/board-check/`**, 22 assertions,
all passing. The technique that unlocked all of it is in §4 and is the most
reusable thing in this document.

---

## 1. The NPC model mapping, decided

**Locked: Guard → `King.gltf`, Scholar → `Adventurer.gltf`, Wizard →
`Farmer.gltf`.** Set via `modelPath` in `data/npcs.json`, exactly as v3's
locked decision 15 anticipated.

The three files are the **Quaternius Ultimate Animated Character** pack
(`CharacterArmature` root, 24 shared clips, one skin each, embedded buffers,
authored at 1.86–1.90 m with feet at y=0 and facing **+Z** — which is what the
existing `facing` / `facePlayer` / patrol code already assumed, now confirmed
by render rather than by hope).

**This mapping was arrived at by rendering them, not by reading their names,
and the names are misleading.** Reasoning from filenames gives a different and
worse answer, so don't "correct" this later without looking first:

- `King.gltf` is not a throne-room king. He is an **old armoured veteran** —
  white hair *and* beard, pauldrons, mail torso, greaves, metal boots. The only
  regal thing on him is a gold crown, and that is the entire contents of the
  `Gold` material. He is by far the best Guard in the set.
- `Adventurer.gltf` is a **bearded man in a plain green tunic** once you drop
  his backpack. That reads as a scholar far better than the alternative does.
- `Farmer.gltf` is unmistakably a farmer: straw hat with a red band, overalls,
  young, clean-shaven. Nothing can be hidden to change that — the hat is a
  primitive of `Farmer_Head`, not a separate node, and its `Beige` material is
  shared with the body. So the Farmer had to land on whichever role tolerated
  him, and the Wizard's dialogue ("Oh, don't mind me. I'm counting the stones.
  There are more every time.") turns out to *land better* on a dotty rustic
  than on a robed mage. The joke works.

Two cosmetic subtractions make it hold together, both data-driven:

```json
{ "id": "guard",   "modelPath": "assets/NPCs/King.gltf",       "hideMaterials": ["Gold"] }
{ "id": "scholar", "modelPath": "assets/NPCs/Adventurer.gltf", "hideNodes": ["Backpack"] }
```

`hideMaterials` drops individual glTF primitives by material name (three splits
a multi-material mesh into one `Mesh` per material, so this is precise);
`hideNodes` drops a whole named node. **`Gold` appears only on `King_Head`**, so
hiding it removes the crown and nothing else — verified in the render, no hole
left in the scalp. Neither field consults an npc id, so v3's decision 15 still
holds: casting is a data change.

### What `npc.js` gained to support this

- `_buildModelBody()` — height-normalises any model to `modelHeight` (default
  1.8 m) from its own bounding box, applies the hide lists, and wires an
  `AnimationMixer`.
- Clip selection by **preference list, not by exact name**: `idle` tries
  `Idle, Idle_Neutral, Idle_Sword, Breathing, Stand`; `walk` tries
  `Walk, Walking, Run`; `greet` tries `Wave, Interact, Talk, …`. Case
  insensitive. A model with a different animation set still finds something
  instead of standing frozen.
- Idle by default, cross-fade to `walk` while patrolling, one-shot `greet`
  (a wave) the moment `talking` flips true, back to idle when the clip
  finishes via the mixer's `finished` event. **The mixer keeps ticking while
  `talking` is true** — only walking stops. A frozen body mid-conversation
  looks dead.
- Yaw now **eases** toward `_targetYaw` at 4 rad/s instead of snapping, and
  `_turnToward()` runs *before* the `talking` early-return, because
  `facePlayer()` sets the target and the actual turn has to happen during the
  conversation it started.

### `assets.js`: `loadGLTF()`, and why the clone had to change

`loadModel()` used to `return scene.clone(true)`. **That silently breaks rigged
models.** `Object3D.clone()` copies a `SkinnedMesh`'s `skeleton` by reference,
so the clone renders bound to the *loader's original* bones — which are not in
the scene and are never animated. The mixer would run, the clip would advance,
and the body would not move.

So: `libs/addons/utils/SkeletonUtils.js` is now vendored (copied from
`Tools/board-check/three-0.169.0/node_modules/three/examples/jsm/utils/`, per
v4's decision 19; it imports only from `three`, no relative imports, so it
needed no patching), and `assets.js` clones through `SkeletonUtils.clone()`
instead. That function is `source.clone()` plus bone rebinding, so it is a safe
drop-in for the 140-odd non-rigged scenery models too.

New `loadGLTF(path)` returns `{ scene, animations }` — the old `loadModel()`
is now a one-line wrapper returning just `.scene`, so no scenery call site
changed. The cache holds the raw gltf and hands out a fresh clone per call.

**Verified**: 3 mixers live, all 3 skeletons rebound into the scene tree (checked
by walking each `SkinnedMesh`'s `skeleton.bones[0]` up to its root and asserting
it is the game scene), all 3 `WristR` bones moving between samples.

### The held prop: `heldProp` moved, and is now actually held

`heldProp` moved from `placeholder.heldProp` to the **top level** of the npc
def, because it is no longer placeholder-only — the Guard has a real model *and*
a mace. `_attachHeldProp()` now derives everything from geometry:

1. Longest bbox axis = the shaft; re-origin the prop onto its **grip point**
   (`GRIP_FRACTION` = 0.14 up the shaft), centred on the two short axes.
2. Wrap it in a holder group so orientation and scale can't disturb that offset.
3. Find a hand bone by regex (`WristR`, `HandR`, `RightHand`,
   `mixamorigRightHand` — note three strips the dots, so the Quaternius
   `Wrist.R` arrives as `WristR`).
4. Aim the shaft along the **mean direction of the hand bone's child bones**.
   Those offsets are already in the hand bone's own space, so their mean points
   out towards the fingertips, which with an arm at rest is roughly straight
   down. **Send the heavy end that way.** Pointing it the other way — my first
   attempt, which seemed more natural — buries the whole mace inside the
   forearm and shoulder and it vanishes completely.
5. Scale to `PROP_LENGTH` (0.6 m), dividing out the parent's world scale since
   the holder inherits the rig's.

The Poly Haven mace happens to be authored upright along +Y at 0.63 m with the
head at the top, so the result is near-native size. Confirmed by probing its
accessor bounds and comparing mean vertex radius per half — the fat half is
+Y — rather than by assuming.

---

## 2. Played through to victory, and the bug that found

v3, v4 and v2 all failed at this because the sandboxed browser can't pointer-
lock. **Headed Chrome driven by Playwright can.** Full chain exercised with
real input:

pointer lock engages on the `#start-button` click (`pointerLockElement` is the
canvas) → mouse movement drives the look (yaw changes) → WASD walks with
collision → E opens the Scholar's dialogue → three E presses walk the lines →
riddle overlay opens and pointer lock releases for typing → two wrong answers
produce the right escalating responses *and* the hint on the second → typing
`Keyboard` grants the Keystone, closes the overlay, re-locks the pointer and
updates the objective → walk to the Guard → E → his `hasKeystone` lines →
gate opens, objective updates → victory screen after the 2.6 s delay.

So `quest-manager.js` is now genuinely exercised end to end, not just reasoned
about. Zero console errors, zero offsite requests (v4's vendoring holds).

### The Guard was standing inside a wall

`data/npcs.json` had the Guard at `[1.6, 0, 10.2]`. The gate is at tile
`[0, 3]` → world z = 12, and the `wall-fortified-gate` mesh is thick: its inner
face sits at **z ≈ 10.04**. The Guard was 0.16 m behind it.

The nasty part is that the game looked fine. Interaction is proximity + facing
only, no line-of-sight check, so **"Press E to talk to the Guard" appeared on
an empty wall** and the whole quest completed normally. Three sessions of
capsule placeholders never showed it.

Fixed to `[1.8, 0, 9.2]`, and `facing` changed `0` → `180` so he faces the
courtyard the player arrives from instead of standing with his back turned.
Chosen by scoring six candidate spots on (a) torso box vs. world geometry and
(b) raycast sightlines from three courtyard approach points; `[1.8, 9.2]` is
clear and visible from all three, the old spot from none.

**The Scholar was checked the same way and is fine** — 2 of 3 sightlines, the
blocked one being the hall doorway wall from an oblique angle, which is
correct. Left alone.

---

## 3. Also: the phantom 404

Every verification run of every project has been logging one
`404 (Not Found)`. It is `/favicon.ico`. The hub `index.html` and `404.html`
carry an inline SVG data-URI icon; **no project page does**, so Chrome falls
back to the origin root and misses.

Added that same `<link rel="icon">` to Castle Conundrum's `index.html` only —
the project this session was in, and the one whose console the noise was
polluting. **~25 other pages still lack it** (`git ls-files '*.html'`, all of
`Projects/`, `Tools/`, `Pathfinder/`). Deliberately not swept: it pairs
naturally with the per-project OG-tags item already in the backlog, and doing
both at once with one decision about per-project vs. shared marks is better
than doing this half now. See §6.

---

## 4. How to drive these games from a script (the reusable bit)

This is the part worth keeping. The in-app browser pane **cannot composite
WebGL** when it isn't displayed — `requestAnimationFrame` never fires, so the
render loop never runs, screenshots time out, and any hook waiting on a frame
waits forever. That is what blocked visual verification in v2–v4, not the
games.

`Tools/board-check/node_modules/playwright-core` (added in v4) plus the
machine's real Chrome solves it. Import it by absolute `file:///` URL if your
script lives outside `Tools/board-check`, since module resolution follows the
script, not the cwd:

```js
const { chromium } = await import(
  'file:///C:/Users/devon/OneDrive/Documents/GitHub/tools-and-games/Tools/board-check/node_modules/playwright-core/index.mjs'
);
const browser = await chromium.launch({ channel: 'chrome', headless: false });
```

`headless: false` matters — it is what makes pointer lock and GPU rendering
real. Serve the repo with `.claude/launch.json`'s config first (trailing slash
on directory URLs, v3 §3's trap still applies).

**Getting a handle on the live scene.** None of these games expose their scene
globally, and `renderer.render` is an **own property** on the instance in three
r169 (`this.render = function (scene, camera)`), so patching
`WebGLRenderer.prototype.render` captures nothing. What works is patching
`Object3D.prototype` methods the render path calls every frame:

```js
const THREE = await import('/Projects/Castle%20Conundrum/libs/three.module.js'); // same
const O = THREE.Object3D.prototype;                     // module instance, import map
const umw = O.updateMatrixWorld;                         // resolves to the same URL
O.updateMatrixWorld = function (f) {
  if (this.isScene && !window.__scene) window.__scene = this;
  return umw.call(this, f);
};
const gwd = O.getWorldDirection;                         // interaction.update() calls
O.getWorldDirection = function (t) {                     // this on the camera each frame
  if (this.isCamera && !window.__cam) window.__cam = this;
  return gwd.call(this, t);
};
```

`AnimationMixer.prototype.update` is a real prototype method and works the same
way for collecting mixers.

**Aiming.** Playwright's synthesized mouse moves *do* drive
`PointerLockControls`, but they are awkward to aim with. Writing
`camera.rotation.y` directly is fine and composes: the controls re-read
`camera.quaternion` on every mousemove, so a direct write isn't fought.
Camera yaw for looking at `(tx, tz)` is `atan2(tx - x, tz - z) + Math.PI` (the
camera's forward is local −Z).

**Judging a model.** Don't fight the game's lighting and walls. Re-parent the
npc groups into a scratch `THREE.Scene` with a hemisphere + two directional
lights, render it with a *second* `WebGLRenderer` on its own canvas pinned over
the page, and screenshot that. Hold each group's position/rotation in your own
rAF loop, because `npc.update()` is still running and will ease the yaw back
and walk the patroller away.

Freezing a yaw the game keeps writing: set `rotation.y` once (that fires the
Euler's onChange and updates the quaternion), then
`Object.defineProperty(group.rotation, 'y', { get: () => v, set: () => {} })`.
Writes are swallowed and the quaternion keeps your value.

**The playthrough is now permanent: `Tools/board-check/play-castle.mjs`,
`npm run play`.** It asserts 22 beats and exits non-zero on any miss, so every
future change to `npc.js` / `quest-manager.js` / `interaction.js` is verifiable
in one command. `harness.mjs`'s `launch()` gained an opt-in `{ headed: true }`
for it (defaults to headless, so nothing else changed — v4's decision 20 about
platform-based engine choice is untouched). Its `shots/play/` output is already
covered by the existing `.gitignore`.

Two of its assertions were checked by deliberately reintroducing the bugs they
guard: with the Guard back at `[1.6, 0, 10.2]`, `npm run play` reports
`FAIL the Guard is actually visible from interact range — blocked by
wall-fortified-gate_3` while `ok E opened the Guard dialogue` still passes on
the very next line. That contrast is the whole point of the check.

The other three scripts this session used stayed in the scratchpad, since
they're one-off investigation tools rather than regression guards: a lineup
renderer, a placement scorer, and a prop-geometry probe. §4 above is enough to
rebuild any of them.

---

## 5. Backlog state

| Item | State |
| --- | --- |
| Decide Guard/Scholar/Wizard ↔ Adventurer/Farmer/King mapping | **Decided, implemented, rendered and inspected.** See §1 |
| Play Castle Conundrum through to victory on a real machine | **Done.** Full chain, real input. See §2 |
| Guard standing inside the gatehouse wall | **Fixed.** Found by playing it. See §2 |
| Rigged models cloned without skeleton rebinding | **Fixed** — `SkeletonUtils.clone()` in `assets.js`. See §1 |
| Placeholder NPC body geometry | **Closed as an open question.** Real models are in; the capsule fallback stays for any npc with `modelPath: null` |
| Vendor CDN dependencies | Fixed in v4; re-confirmed zero offsite requests this session |
| `Tools/board-check` on Windows | Fixed in v4; `npm run check` passes here — 227 units, 0 broken, 0 collisions |
| End-to-end smoke test for Castle Conundrum | **New, done.** `npm run play`, 22 assertions, all passing. See §4 |
| Fix `capture-previews.mjs`'s drive steps | **Not done.** But `play-castle.mjs` is a worked example of exactly what it needs |
| Capture the seven preview screenshots | **Not done**, and the GPU blocker is now gone (headed Chrome renders fine). Still wants a human choosing shots |
| Per-project OG tags | **Untouched**, still waiting on screenshots |
| Per-project favicons | **New.** Castle Conundrum done, ~25 pages to go. See §3 |
| Adopt `gvb-save.js` in The Fourth Quarter | **Untouched.** Zero adopters still |
| Interaction has no line-of-sight check | **New, not fixed.** See §6 |
| Scholar clips through a hall table; braziers look unsupported | **New, cosmetic, not fixed.** See §6 |

---

## 6. Locked decisions

Everything in v1 §3, v2 §8, v3 §6 and v4 §5 still stands. Added:

21. **The npc↔model casting is `King`→Guard, `Adventurer`→Scholar,
    `Farmer`→Wizard, and the filenames are actively misleading about why.**
    §1 has the visual reasoning. If you want to revisit it, render the three
    models first; reasoning from names alone produces a worse answer.
22. **`hideMaterials` / `hideNodes` on an npc def are the sanctioned way to
    subtract from a cast model.** Generic, data-driven, no npc id consulted.
    Use them rather than editing a vendored `.gltf` or special-casing in code.
23. **Anything that loads a rigged model goes through `loadGLTF()` and clones
    via `SkeletonUtils`.** Never `Object3D.clone()` a `SkinnedMesh` — it keeps
    the original's skeleton and the copy silently refuses to animate. This is
    the single most confusing failure mode in the project so far: the mixer
    runs, the clip advances, and nothing moves.
24. **Held props are aimed from rig geometry, tip following the fingers.** The
    mean of the hand bone's child bone offsets points out through the fingers;
    the prop's heavy end goes *that* way. The opposite direction — which reads
    as more natural — puts the whole prop inside the arm.
25. **Verify anything visual in headed Chrome via `playwright-core`, not the
    in-app browser pane.** The pane doesn't composite WebGL when hidden, so
    rAF never fires and every frame-dependent check hangs rather than failing
    loudly. §4 has the recipe.
26. **NPC positions get checked against geometry, not just against the
    interact prompt.** Interaction is proximity + facing with no line-of-sight
    test, so the prompt appears happily for a body sealed inside a wall.
    `npm run play` now enforces this for the Guard.
27. **`play-castle.mjs` runs headed on purpose; `launch({ headed: true })` is
    opt-in and every other script stays headless.** Don't "optimise" it back to
    headless — pointer lock and GPU rendering both need real compositing, and
    the failure mode is a hang, not an error. Noted in the README too.

---

## 7. Suggested next session

Roughly in order of value per effort:

1. **Fix `capture-previews.mjs`'s drive steps**, reusing §4 and
   `play-castle.mjs` as the worked example. Both blockers v4 listed (Windows
   Chromium, GPU access) are gone; what's left is real selectors and real play
   per game — which `play-castle.mjs` now demonstrates for one of the seven.
   The `walkTo()` / `state()` shape in it generalises.
2. **Capture the seven previews** and look at `./candidates/` before promoting
   anything.
3. **Per-project OG tags and favicons together**, reusing those screenshots —
   one decision about shared vs. per-project marks, then a ~25-file sweep
   (§3).
4. **Add a line-of-sight check to `interaction.js`.** One raycast from the
   camera to the npc's chest before offering the prompt. The Guard bug is
   fixed and `npm run play` guards that one spot, but the class of bug is still
   live for anything placed later — a real fix belongs in the game, not the
   test.
5. **Adopt `gvb-save.js` in The Fourth Quarter** as the reference integration.
6. **Cosmetic, low priority:** the Scholar stands half-inside a hall table, and
   the interior candelabra read as floating. Both visible in `shots/play/`
   after a run. Neither affects play.

Remember to bump the version line to `version 7` and write
`gvb-site-handoff-v6.md` before signing off.
