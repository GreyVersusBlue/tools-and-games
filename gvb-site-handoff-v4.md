# gvb-site-handoff-v4.md

Handoff from **session 4** (site version 5) → whoever picks this up next.
Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v3.md` first if you have not. Everything in it still
holds unless contradicted below.

---

## 0. What changed in one paragraph

Session 4 knocked out the top two items on v3's suggested-next-session list.
**Aphelion, Castle Conundrum, and The Fourth Quarter no longer depend on
`cdn.jsdelivr.net`** — three.js is vendored locally in each project's own
`libs/`, following Golden Hour's existing pattern, at each project's
already-pinned version (no version bumps). Separately, **`Tools/board-check`
now runs its full check suite on Windows**, including the collision guard and
screenshot script that v3 found completely broken there — `harness.mjs` picks
`@sparticuz/chromium` on Linux and falls back to Playwright driving the
machine's installed Chrome/Edge everywhere else. Both changes were verified
live (browser network/console checks for the vendoring, actual script runs
for board-check), not just by reading the diff.

---

## 1. Three.js vendored: Aphelion, Castle Conundrum, The Fourth Quarter

Each project got its own `libs/` folder, mirroring Golden Hour's existing
convention (v3 §1 background reference; the pattern itself predates v3).

- **Aphelion** — `Projects/aphelion/libs/three.module.js`, three@0.160.0.
  Import map's `three/addons/` key was **removed**, not vendored — nothing in
  Aphelion imports through it (confirmed in v3's own vendoring research: the
  key was declared in the CDN import map but unused). A dangling map entry
  pointing at a `libs/addons/` folder that doesn't exist would be a landmine
  for whoever adds an addon later; deleting it costs one line, and re-adding
  it when an addon is actually needed is equally cheap.
- **The Fourth Quarter** — `Projects/fourth-quarter/libs/three.module.js`,
  three@0.160.0. No addons key existed here to begin with.
- **Castle Conundrum** — `Projects/Castle Conundrum/libs/three.module.js`,
  three@0.169.0, **plus** `libs/addons/loaders/GLTFLoader.js`,
  `libs/addons/controls/PointerLockControls.js`, and
  `libs/addons/utils/BufferGeometryUtils.js` (`GLTFLoader` imports
  `toTrianglesDrawMode` from the latter).

**Different approach than Golden Hour's for the addon files, on purpose.**
Golden Hour flattens `Sky.js`/`Water.js` straight into `libs/` and imports
them by relative path (`../libs/Sky.js`), bypassing the import map for
addons entirely. Castle Conundrum's `GLTFLoader.js` has its own internal
relative import (`../utils/BufferGeometryUtils.js`), so flattening would have
required rewriting that import inside a vendored third-party file — a patch
that silently goes stale the next time anyone re-vendors from a newer three.js
release. Instead, `libs/addons/` **mirrors the `examples/jsm/` folder
structure** for exactly the files needed, and the import map keeps a
`three/addons/` key pointing at `./libs/addons/`. Consequence: **no changes
were needed to `assets.js` or `player-controller.js` at all** — they still say
`import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`, and the map
resolves it locally instead of to jsdelivr. If Castle Conundrum ever needs
another addon, vendoring it is: copy the file into the matching subfolder
under `libs/addons/`, done — no import-map or source edits elsewhere.

**Where the vendored files came from:** not a fresh download. `Tools/
board-check`'s own `npm install` already vendors three@0.160.0 and
three@0.169.0 into `three-0.160.0/node_modules/three/` and `three-0.169.0/
node_modules/three/` (postinstall script, unrelated purpose — it's there so
board-check's puppeteer/playwright harness can rewrite CDN URLs during
offline rendering, see v3 §3). Those on-disk copies are the authoritative
npm-published three.js source, so this session copied straight from there
instead of hitting a CDN. Convenient, but also means: if `Tools/board-check`'s
`node_modules` is ever pruned before someone re-vendors a new version for
these projects, that shortcut disappears and a real `npm pack three@<ver>`
(or equivalent) would be needed instead.

**Version choice:** kept each project's already-pinned version rather than
bumping everyone to Golden Hour's r185. This was a deliberate, asked-and-
answered call, not an oversight — bumping three across a version range this
wide (160/169 → 185) risks API breaks (examples/jsm import path churn,
lighting/color-management default changes) that would need per-project
re-verification. Revisit only if there's an actual reason to move a project's
three.js version forward; don't casually align it "for consistency."

**Verified live**, not just read: served the repo (`npx serve`, same
`.claude/launch.json` from v3), loaded all three projects in a real browser,
and confirmed via the network log that every request resolved to a local
`libs/...` path with **zero requests to jsdelivr and zero console errors** —
including Castle Conundrum's `GLTFLoader` → `BufferGeometryUtils` relative
import, which is the part most likely to break from a flattening mistake.
`Tools/board-check/check-integrity.mjs` also still passes clean (226 units
checked, was 220 before the new files existed, 0 broken either way).

---

## 2. `Tools/board-check` runs on Windows now, fully

v3 §3/§4 flagged that `@sparticuz/chromium` has no Windows (or macOS)
executable at all, so `npm run check`'s collision half and `npm run shoot`
failed with `spawn ...\Temp\chromium ENOENT`. Fixed in `harness.mjs`:

- **`launch()`** now branches on `process.platform`. On Linux, behavior is
  unchanged: `@sparticuz/chromium` + `puppeteer-core`. Everywhere else, it
  imports `playwright-core` and tries `chromium.launch({ channel })` with
  `'chrome'`, then `'msedge'`, then no channel at all (letting Playwright fall
  back to a bundled Chromium if one happens to be installed), throwing a
  message pointing at `npx playwright install chromium` only if none of those
  work. **No browser download happens for the common case** — `channel:
  'chrome'`/`'msedge'` just drives whatever's already installed on the
  machine, so this doesn't reintroduce the CDN-unreachable-sandbox problem
  `@sparticuz/chromium` was chosen to avoid (see README's "why this is (mostly)
  not Playwright" section, updated this session).
- **`prepPage()`** now has an engine-aware branch for everything that
  differs between Puppeteer and Playwright's APIs: viewport/deviceScaleFactor/
  mobile flags are context-creation options in Playwright but page-mutation
  calls in Puppeteer; request interception is `page.route()` +
  `route.fulfill()/continue()/abort()` in Playwright vs.
  `setRequestInterception(true)` + `page.on('request', ...)` +
  `r.respond()/continue()/abort()` in Puppeteer. Both branches produce a page
  with the same `page.__errs` / `page.__blocked` shape the three calling
  scripts already expect, so **none of `check-collisions.mjs`,
  `shoot-board.mjs`, or `capture-previews.mjs` needed to change** for the
  engine swap itself.
- One real call-site change was needed: `shoot-board.mjs`'s no-JS shot used
  to call `page.setJavaScriptEnabled(false)` after the page existed — that
  method doesn't exist on a Playwright page (JS-disable is a context-creation
  option there, can't be toggled after the fact). `prepPage()` gained a
  `jsEnabled` option instead; `shoot-board.mjs` now passes `{ jsEnabled: false
  }` up front. This is the only script edit the whole fallback required.
- Added `playwright-core` (not the full `playwright` package) as a normal
  dependency — it has no postinstall browser download of its own, so adding
  it doesn't change `npm install`'s behavior for anyone on Linux.

**Verified by actually running it**, on this machine, on Windows:
`npm run check` (integrity + collisions) and `npm run shoot` both completed
cleanly end to end — the exact two things v3 documented as broken. Collision
guard: 0 collisions across all 9 widths, same numbers as v3 saw over the
integrity half alone. Shoot: all 10 expected files written, including
`nojs.png` (confirming the `jsEnabled: false` swap actually disables JS, not
just that it doesn't crash).

**Not touched:** `capture-previews.mjs` itself — still exactly as unfinished
as v3 left it (idle-frame problem, software-WebGL slowness, guessed `drive`
steps). It now *would* run without the ENOENT crash if invoked, but nobody
ran it this session, and its own header comment's caveats are unaffected by
this fix.

---

## 3. Version line

Bumped to `version 5` (`index.html` line ~481). Keep bumping it.

---

## 4. Backlog state

| Item | State |
| --- | --- |
| Vendor CDN dependencies (Aphelion, Castle Conundrum, The Fourth Quarter) | **Fixed and verified live.** See §1 |
| `Tools/board-check` collision-check + shoot on Windows | **Fixed and verified live.** See §2 |
| Castle Conundrum `npc.js` | Fixed last session (v3 §1), untouched this session |
| Play Castle Conundrum through to victory on a real machine | **Still not done.** Same pointer-lock blocker v3 hit in the sandboxed browser |
| Decide Guard/Scholar/Wizard ↔ Adventurer/Farmer/King mapping | **Still undecided.** Three sessions running now |
| Capture the seven preview screenshots | **Not done.** `board-check`'s Chromium/Windows blocker from v3 is now gone, but still needs a real GPU and a human looking at output, plus `capture-previews.mjs`'s drive-step guesses are still unfixed (§2) |
| Per-project OG tags | **Untouched**, still blocked on screenshots |
| Adopt `gvb-save.js` in The Fourth Quarter | **Untouched.** Zero adopters still |
| Placeholder NPC body geometry | Unchanged from v3 — still an open visual decision |

---

## 5. Locked decisions

Everything in v1 §3, v2 §8, and v3 §6 still stands. Added:

17. **Each project vendors its own `libs/`; nothing is shared across
    projects.** Aphelion and The Fourth Quarter both happen to be on
    three@0.160.0 right now, but their `libs/three.module.js` are separate
    copies, not a shared file. This matches how every other asset in the repo
    already works (each project is self-contained) and means bumping one
    project's three.js version later can't silently affect another.
18. **Castle Conundrum's `libs/addons/` mirrors three.js's own
    `examples/jsm/` folder layout** (`loaders/`, `controls/`, `utils/`),
    rather than flattening addon files into `libs/` the way Golden Hour does
    for `Sky.js`/`Water.js`. Do this again for any future addon needed by any
    project once that addon (or its transitive dependencies) has its own
    internal relative imports — flattening those would mean hand-patching a
    vendored third-party file's import paths, which silently rots.
19. **`Tools/board-check` vendors three.js from npm for its own reasons
    (offline-rendering shim, see v3 §3), completely unrelated to the
    site-serving vendoring in §1 above.** Don't conflate the two — but do
    remember `three-0.160.0/` and `three-0.169.0/` under `Tools/board-check/`
    are handy, already-on-disk, npm-authoritative copies of those exact
    versions if a project's vendored copy ever needs re-copying.
20. **`launch()` in `harness.mjs` picks its engine by `process.platform`, not
    by probing.** Linux always tries `@sparticuz/chromium` first; anything
    else goes straight to Playwright's channel list. Don't add a "try
    puppeteer, fall back to playwright" probe on Linux — the whole reason
    `@sparticuz/chromium` was chosen originally was CDN-unreachable sandboxes,
    and a probe would add a slow, failing first attempt in exactly that
    environment.

---

## 6. Suggested next session

Roughly in order of value per effort:

1. **Play Castle Conundrum through to victory on a real machine.** Nobody has
   pressed E on the Scholar and typed a riddle answer since `npc.js` was
   rebuilt in v3, and pointer lock still doesn't work in the sandboxed
   browser used for verification here.
2. **Decide the Guard/Scholar/Wizard ↔ Adventurer/Farmer/King mapping**, or
   consciously decide to keep the primitive placeholder bodies. Three
   sessions running now — resolve it either way.
3. **Fix `capture-previews.mjs`'s drive steps** now that the Windows
   Chromium blocker is gone — real selectors, real play, per game, then
   actually look at `./candidates/` before promoting anything.
4. **Capture the seven previews**, on a machine with GPU access — the
   software-WebGL slowness noted in v3 (and still true in
   `capture-previews.mjs`'s header comment) is a separate blocker from the
   Windows/Chromium one this session fixed.
5. **Per-project OG tags**, reusing those screenshots.
6. **Adopt `gvb-save.js` in The Fourth Quarter** as the reference integration.

Remember to bump the version line to `version 6` and write
`gvb-site-handoff-v5.md` before signing off.
