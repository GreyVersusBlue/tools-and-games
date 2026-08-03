# Orbital — session notes

## What changed

- **`Projects/orbital/test/physics.mjs`** (new). A DOM-free Node test suite
  against `OrbitalPhysics` directly — no browser, no `Tools/board-check`
  dependency. Five sections:
  1. Every level has a winning launch vector. Brute-force search over launch
     angle (240 steps) × power (20 steps), falling back to a shrinking local
     search around the closest miss for levels the grid alone doesn't crack.
     All 22 levels pass. Takes ~2s.
  2. Wormhole pairing / `exitTurn` — see "What I verified" below, this is
     where a real finding turned up.
  3. Booster kick direction — kick applies fully along `dir`, doesn't perturb
     the perpendicular velocity component, sets the re-trigger lock.
  4. Body solidity — `isSolid()` unit-checked for all seven types, plus a
     `substep()`-level CRASH check for each solid type and a non-CRASH check
     for `repulse` (a gravity body that isn't solid).
  5. `orbital_progress_v1` → `v2` save migration, round-tripped against a
     hand-built v1 fixture, plus confirms a v2 key takes precedence once
     present and that `SAVE_KEY` itself hasn't drifted (locked decision #36).
     This section extracts `game.js`'s persistence block by its own marker
     comments and evaluates it in isolation with a fake `localStorage`,
     rather than reimplementing `loadSave()`/`writeSave()` in the test —
     see "Deliberately not done" for why, and what happens if those markers
     ever move.
  Exits non-zero on any failure (`process.exit(1)`).

- **`Projects/orbital/js/game.js`** — `btnWipe`'s click handler now gates on
  `confirm("Erase all saved progress? Every sector's stars will be reset.
  This can't be undone.")` before wiping. One-line change, matches the
  `confirm()` pattern already used for the same kind of action in Closing
  Time (`js/main.js:76`), Ren-Faire-Claude, Torchbearer, and three other
  projects in this repo — not a new pattern.

## What I verified

- **`node Projects/orbital/test/physics.mjs --verbose`** → all 22 levels win,
  all wormhole/booster/solidity/migration checks pass, search took ~2s:
  ```
  Orbital physics test — 22 levels

  1. Every level has a winning launch vector
    ok    basics#0         "First Light"
    ok    basics#1         "The Curve"
    ok    basics#2         "Slingshot"
    ok    basics#3         "Corridor"
    ok    basics#4         "Binary"
    ok    basics#5         "Sunfall"
    ok    basics#6         "Blockade"
    ok    basics#7         "Clockwork"
    ok    basics#8         "Repulse"
    ok    basics#9         "The Gauntlet"
    ok    deepspace#0      "Event Horizon"
    ok    deepspace#1      "Dark Slingshot"
    ok    deepspace#2      "First Portal"
    ok    deepspace#3      "Portal Sling"
    ok    deepspace#4      "Kick"
    ok    deepspace#5      "Redirect"
    ok    deepspace#6      "Twin Holes"
    ok    deepspace#7      "The Long Way"
    ok    deepspace#8      "Gravity Assist"
    ok    deepspace#9      "Portal Maze"
    ok    deepspace#10     "Singularity Run"
    ok    deepspace#11     "Deep Field"

  2. Wormhole pairing / exitTurn — 5/5 ok
  3. Booster kick direction — 4/4 ok
  4. Body solidity — 12/12 ok
  5. Save migration v1 -> v2 — 4/4 ok

  ALL PASSED (22 levels, 0 total checks failing)
  ```
- **Guard-rail check, per locked decision #34** — broke three things on
  purpose, confirmed the test caught each, reverted, confirmed `git diff`
  was clean afterward:
  - Removed `blackhole` from physics.js's `SOLID` map → both the direct
    `isSolid` check and the CRASH check failed with a clear message.
  - Buried "First Light"'s goal inside an unavoidable blackhole → the
    winnability search correctly reported no vector found (rather than
    hanging or false-passing).
  - Changed `SAVE_KEY` to `"orbital_progress_v3"` → the locked-decision-#36
    check failed by name.
  All three reverted; `git diff` on `js/physics.js`, `js/levels/pack-01-basics.js`
  and `js/game.js` was empty before moving on.
- **A real finding, not a bug**: my first draft of the wormhole test assumed
  `exitTurn` lives on the *exit* mouth. It doesn't — `substep()` reads
  `b.exitTurn` off `b`, the mouth the probe is *entering*, before it ever
  looks up `partner`. So a linked pair can be asymmetric: which mouth you
  enter decides whether the exit turns you. This matches "Portal Maze"'s own
  authoring (`exitTurn: -0.6` set on only one of its two wormholes) — it's
  intentional, just non-obvious from the level data alone, and worth knowing
  before anyone "simplifies" the wormhole branch to look up `exitTurn` from
  the partner instead. My test now asserts the real semantics, not my first
  wrong guess.
- **The level count in this prompt's own "What is actually here" section is
  stale.** It says 21 levels, `pack-02-deepspace.js` at "11 levels." The
  actual file has **12** ("Deep Field" is the 12th), so the real total is
  **22 levels**, confirmed both by `LEVELS.length` in the test output and by
  a direct recount of the pack file. Worth fixing in the next prompt-23
  refresh; I didn't touch the prompt file since `Claude Prompts/**` isn't
  mine to edit.
- **`Reset progress` confirmation**, live in a real page (not just read) —
  loaded `Projects/orbital/` via the repo's static server, dismissed the
  intro, opened the sector map, seeded `orbital_progress_v2` with a fake
  star, then clicked `#btnWipe` with `window.confirm` swapped for a stub
  returning `false`: storage was untouched. Swapped it for a stub returning
  `true`, clicked again: storage became `{}`. Both branches proven, not just
  read off the diff.
- **Mobile — what I could verify without real touch hardware**:
  - Resized the browser viewport to 375×812 and reloaded. `matchMedia
    ("(pointer:coarse)").matches` reports **false** even at that width —
    this environment emulates viewport size, not actual touch/coarse-pointer
    capability, so the portrait rotate-gate (correctly keyed off pointer
    type, not viewport width alone) never triggers here. That's the code
    doing the right thing, not a bug, but it means the rotate-gate itself
    is **not verified for real** in this session — needs an actual mobile
    device or a real touch-emulation environment.
  - The 4-column mobile grid (`@media (max-width:540px)`) does apply at
    375px: measured cells at 69×69px, comfortably clear of the 44px WCAG /
    48px Apple minimum touch target.
  - Drag-to-aim is genuinely delta-based, confirmed by dispatching real
    `PointerEvent`s (`pointerType:'touch'`) starting at a screen point that
    has nothing to do with the probe's position, dragging 80px right / 30px
    up on screen, and checking `aim` against `view.s` (0.375 at this size):
    world delta came out to (213, -80), i.e. exactly `(80, -30) / 0.375` —
    the math is right, and it proves a finger starting anywhere on the
    canvas drives the same aim vector, not just a finger starting on the
    probe.
  - `touch-action: none` is set on `html`/`body` (not the canvas itself,
    which computes `auto` — touch-action is an ancestor-chain intersection,
    not something a descendant needs to restate), so page pan/zoom is
    structurally blocked during a drag regardless of any JS. Confirmed via
    `getComputedStyle`, not just read off the CSS.
  - Full launch flow works end-to-end via synthetic touch pointer events:
    `pointerdown` → `pointermove` → `pointerup(fire=true)` took the game
    from `aim` to `fly` mode with `planPow` ≈ 0.88.
- **`cd Tools/board-check && npm run check`** → **354 units checked, 0
  broken; 0 collisions, tightest gap 9.1px.** (Higher than v9's 336 — other
  project threads have added units since; not this thread's concern, just
  reporting the number actually seen.)
- **`npm run social:check`** → **18 notices · 12 current · 1 had no block ·
  5 out of date · 0 failed.** The "had no block" page is
  `Projects/orbital/index.html` — exactly what this prompt's own
  Verification section says to expect (no generated head block yet, not a
  bug, not mine to fix). The other five out-of-date pages
  (`daredevil`, `torchbearer.html`, `fourth-quarter`, `Ren-Faire-Claude`,
  `newindex.html`) aren't Orbital's — other threads' in-flight work, left
  untouched.
- **Zero offsite requests**: covered by `check-integrity.mjs`'s static
  source sweep above (part of `npm run check`), not a separate hand-grep.

## Shared-file requests

- **Preview + OG card, prompt 22's `capture-previews.mjs` / `games.mjs`.**
  Candidate level: `deepspace#11`, "Deep Field" ("everything the void has")
  — the last level in Deep Space, and the only one using all three of this
  pack's new mechanics (blackhole, wormhole, booster) alongside a planet.
  Tested directly in a live session: an aim drag of world-space vector
  `(dx: 200, dy: -350)` from this level's `start` (120, 540) produces a
  `plan.outcome === "WIN"` flight path (drawn green) that grazes the
  blackhole at ~75px and the first wormhole at ~42px before reaching the
  goal — a real, dramatic curve, not a straight line, and it resolves as a
  winning shot so the preview reads as "this game rewards reading the
  curve," not "here's a random screenshot." Suggested recipe shape (to sit
  in `games.mjs`, matching the existing per-project pattern): click
  `#btnStart` to dismiss the intro, click `#btnLevels`, click the sector
  grid cell at index 21 (0-based; ten `basics` cells then `deepspace#11` is
  the 12th of that pack) to load Deep Field, then drive a canvas
  `pointerdown` at the level's `start` world-position, a `pointermove` to
  `start + (200, -350)` in world space (scale by the capture frame's
  `view.s` for actual screen deltas), and screenshot **before** `pointerup`
  so the dotted flight plan is visible in `aim` mode rather than launching.
  No `pointerup` needed for the shot at all.
- **`npm run social`** needs to run against `Projects/orbital/index.html`
  once the above lands, to generate its head block. Already called out as
  expected/not-mine-to-fix in this prompt's own text; repeating it here only
  so it's in one place next to the preview request it's paired with.

## Deliberately not done

- **`gvb-save.js` adoption.** Looked at it seriously, decided against it
  this round. The current hand-rolled save (`orbital_progress_v2`, one key,
  already migrates its own `v1` predecessor) doesn't have a bug
  `gvb-save.js`'s `repair` would fix — I just proved the migration round-trips
  clean. Adopting it would mainly buy the shared save-bar UI and
  export/import-to-file, which is a real but different kind of value (UI
  consistency with the other eleven adopters), not a fix for anything
  currently broken. Leaving it for a session where Devon specifically wants
  that UI consistency, rather than doing it because eleven other projects
  did.
- **A browser-driven test layer** (level grid renders/unlocks correctly,
  save/reset/wipe buttons work end-to-end, star display updates) — the
  prompt calls this out as something that "can follow once the physics
  layer is solid," and it is now solid, but I didn't commit an automated
  version this session. What I did instead: manually drove the actual page
  through a live browser session (see "What I verified") and got real
  answers for the reset-confirmation and the mobile aim math, which covers
  the two things I'd have most wanted a browser test to prove. What's still
  missing is a *committed, repeatable* version of that — next session's
  highest-value item, and `Tools/board-check/harness.mjs`/`drive.mjs`'s
  `waitFor`/`textContent` helpers should be used instead of bare
  `page.waitForFunction(fn, null, opts)`, or it becomes a seventh instance
  of the bug described in this prompt's required reading.
- **The portrait rotate-gate, unverified for real.** See "What I verified" —
  this environment's browser reports a fine (mouse) pointer even at a
  375×812 viewport, so `matchMedia("(pointer:coarse)")` never flips true
  here regardless of window size. The code's logic reads correctly (gate is
  keyed to pointer type, not viewport width, which is the right call), but
  I can't prove the gate actually shows on a real phone from this
  environment. Needs a real device or a real touch-emulation environment.
- **The `Pathfinder/data/` question, Devon's decisions on other projects,
  etc.** — not this project's territory; not touched.

## Next session

1. **A committed browser-driven test** (grid render/unlock, save/reset/wipe
   buttons, star display), now that the physics layer underneath it is
   proven solid. Use `harness.mjs`, run-only, and `drive.mjs`'s engine-aware
   helpers.
2. **Verify the rotate-to-play gate on a real device or real touch
   emulation** — this session could only prove the surrounding logic is
   sound, not that the gate itself fires.
3. **Revisit `gvb-save.js` adoption** if Devon wants save-bar UI consistency
   with the other eleven projects — not needed for correctness.
4. **Flag the level-count/pack-content drift** (21 vs. actual 22, pack-02's
   "11 levels" vs. actual 12) to whoever runs prompt 23 next — this prompt's
   own "What is actually here" section needs the correction, and it's not
   this project's file to edit.
5. If a fresh preview/OG pass happens and the "Deep Field" candidate above
   doesn't look right in practice, `js/game.js`'s `computePlan()` and the
   `aim`/`plan` globals are the fastest way to try another vector
   interactively from the console before committing a `games.mjs` recipe.
