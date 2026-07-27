# board-check

Dev-only tooling. Nothing in here is linked from the board, and none of it runs
in a visitor's browser. It exists so a session can actually *render* the site
instead of reasoning about CSS and hoping.

```
npm install          # also vendors three.js 0.160.0 and 0.169.0
npm run check        # integrity sweep + collision guard, both exit non-zero on failure
npm run play         # plays Castle Conundrum to victory; opens a real window
npm run games        # regression suite for the other six games; opens real windows
npm run shoot        # writes reviewable PNGs to ./shots/
npm run previews     # plays all seven quests, screenshots gameplay to ./candidates/
npm run promote      # candidates/chosen.json -> assets/previews/ + assets/og/
npm run social       # regenerate every page's favicon + og tags from the board
npm run social:check # ...or just report which pages have drifted
```

## Why this is (mostly) not Playwright

Playwright and Puppeteer both normally download their browser from a CDN at
install time, and those CDNs are unreachable from some sandboxes.
`@sparticuz/chromium` ships the Chromium binary *inside the npm tarball*, so
`npm install` is sufficient, and `puppeteer-core` drives it. That binary is
built for AWS Lambda's Linux runtime, though — there's no Windows or macOS
executable in the package at all.

So `harness.mjs`'s `launch()` picks per platform: Linux uses
`@sparticuz/chromium` + `puppeteer-core` as above; anywhere else it uses
`playwright-core` against whatever Chrome or Edge (`channel: 'chrome'` /
`'msedge'`) is already installed on the machine, so there's still no browser
download required. If neither channel is found, install Google Chrome or
Microsoft Edge, or run `npx playwright install chromium` inside
`Tools/board-check`. Every script (`check-collisions.mjs`, `shoot-board.mjs`,
`capture-previews.mjs`) is written against `launch()`/`prepPage()` and doesn't
care which engine is actually driving the page.

`play-castle.mjs` is the one exception, and it's a deliberate one: it calls
`launch({ headed: true })`, because the Pointer Lock API and real GPU rendering
both need a browser that is genuinely compositing frames to a screen. A hidden
or headless browser doesn't fire `requestAnimationFrame` at all in some hosts,
which means a WebGL render loop never runs and every frame-dependent assertion
hangs instead of failing usefully. So that script opens a visible window and
visibly plays the game. Don't "fix" it back to headless.

## The two shims

`harness.mjs` intercepts requests so a render is the real thing and not a
degraded approximation:

- **`fonts.googleapis.com/css2?...`** is answered with an `@font-face` sheet
  built from local `@fontsource` packages. Without this, every heading falls
  back to a system serif and any measurement of text width is fiction. The
  resolver maps a family name to its package (`Zilla Slab` to `zilla-slab`) and
  picks the nearest available weight, so adding a font to a project page usually
  just means `npm i @fontsource/<name>`.
- **`cdn.jsdelivr.net/npm/three@<ver>/...`** is rewritten to a vendored copy.

Anything else offsite is refused and recorded in `page.__blocked`, which is how
you find out what the site actually depends on at runtime. That inventory is now
**empty**: session 4 vendored three.js into every project, and session 7 vendored
Golden Hour's sand texture, which had been the last hotlink on the site. Nothing
on greyversusblue.com reaches another host while a visitor is on it, and both
`play-games.mjs` and `play-castle.mjs` assert exactly that.

`prepPage()` still takes an `allow` list of host substrings to let through. It was
written for the hotlinked texture — blocking it left `terrain.js` on its
procedural fallback and captured a beach nobody saw — and nothing passes it now.

## The scripts

### `check-integrity.mjs`

Parses every `.js`/`.mjs`, every inline `<script>`, and every `.json` on the
site. Exits 1 on any failure.

This is here because `Castle Conundrum/src/npc.js` contained JSON instead of
JavaScript, which meant `main.js` could not `import { NPC }` and the game hung
on its loading screen. It went unnoticed because the previous check verified
that files *resolved*, not that they *parsed*. Resolving is not enough.

### `check-collisions.mjs`

The pin, the genre ribbon and the NEW POSTING flag all occupy the top ~22px of a
quest card, and the eyebrow is centred text that grows toward both corners as
the string lengthens. Version 2 had 10 real overlaps across nine viewport
widths. Version 3 reserves a band with `#quest-board .notice { padding-top:
2.15rem }`.

The measurement is **true 2D rectangle intersection** against the eyebrow's
actual glyph run, obtained with a `Range` rather than the block box. Horizontal
proximity is not a collision. Measuring only the horizontal axis produced a
much scarier and entirely wrong number once already, so do not simplify it back.

### `shoot-board.mjs`

Renders the states that are impossible to check by reading source: each
breakpoint, the four `data-new` cards together, the ledger filter active, the
suite cross-link lit, Town Services, JS disabled, and the 404 as served from a
subpath. Output lands in `./shots/`.

It also reports whether any `.unfurl` elements attached. Zero means no preview
JPEGs exist yet, which is currently expected.

### `play-castle.mjs`

Plays Castle Conundrum start to victory with real input — pointer lock, WASD, E
presses, typing the riddle answer — and asserts 22 beats along the way: three
rigged bodies present, every skeleton rebound to its own bones, rigs animating,
pointer lock acquired and released and re-acquired at the right moments, both
dialogues, escalating wrong-answer responses, the hint, the Keystone, the gate,
the victory screen, no console errors, no offsite requests. Exits non-zero on
any miss. Screenshots land in `./shots/play/`.

Two of these assertions exist because of specific bugs that every other check in
this folder was blind to:

- **The Guard was standing sealed inside the gatehouse wall.** `interaction.js`
  used to test proximity and facing but never line of sight, so "Press E to talk
  to the Guard" appeared on blank stone and the quest completed normally. The
  script raycasts from the player to the Guard's chest and fails if anything is in
  the way. Verified to fail at the old position and pass at the current one.

  As of session 6 the game enforces this itself, so putting the Guard back inside
  the wall now fails *twice*: this assertion names the blocking mesh
  (`blocked by wall-fortified-gate_3`), and the run then aborts at
  `walked to the Guard — never got in range`, because no prompt is offered for a
  body nobody can see. Both are worth keeping — the second proves the game is
  right, the first says which piece of stone is in the way.
- **`Object3D.clone()` on a `SkinnedMesh` keeps the original's skeleton**, so a
  cloned rig stands frozen while its `AnimationMixer` runs happily. `assets.js`
  clones via `SkeletonUtils` instead; the script walks each skeleton's first
  bone up to its root and fails if that root isn't the live scene.

If NPC positions change in `data/npcs.json`, update the `SCHOLAR` / `GUARD`
constants at the top to match.

### `games.mjs`

One description per playable project: URL, frame size, the three.js specifier its
import map resolves, which overlays count as "intro", where it keeps its save, and
`open()` — the clicks that get from a blank page to the first frame of play.
`enter()` wraps that with "load it, wipe the save it left in this browser, play it
in". `capture-previews.mjs` and `play-games.mjs` both start here, so the way into a
game is written once. Add a game to the board, describe it here.

### `play-games.mjs`

The end-to-end regression suite for the six games that aren't Castle Conundrum:
build a real production line in Integer Foundry and watch the sink judge what
arrives, run a fortnight of Closing Time, build and open a Faire Weekend, walk
Golden Hour and Aphelion, and put The Fourth Quarter's save through export, import,
a reload and a pre-versioning legacy blob. 92 assertions, exits non-zero on any of
them, screenshots in `./shots/games/`.

Four of these projects already have Node smoke suites, and this does not repeat
them. Those import the engine modules and drive them directly; they cannot see the
wiring. `day.rebuildStations` was the case in point — 122 campaign assertions
passing while "New Game" threw on the first click a player makes. Every beat here
is something that only breaks in a browser: a handler that was never attached, a
render that throws on empty state, a save that loads into a room nobody rebuilt.

### `drive.mjs`

Shared helpers for playing a first-person three.js game from a script: getting a
handle on the live scene and camera, aiming, and walking to a world coordinate.
All three driving scripts use it. Read its comments before
writing a new driver — the two non-obvious facts are that `renderer.render` is an
own property so patching `WebGLRenderer.prototype` captures nothing, and that only
Castle Conundrum tolerates a direct write to `camera.rotation` (the other three
games own it and rewrite it every frame, so those need `turnBy`/`lookAt`).

### `capture-previews.mjs`

Plays all seven projects into a real gameplay frame and screenshots it. Each
recipe drives its game with that game's own selectors and world coordinates, and
asserts it arrived: intro overlays gone, frame actually moving (for the games with
a clock), console clean. Exits non-zero on any miss.

Getting into each game lives in `games.mjs` now; what's left in each recipe is the
part that is about taking a *picture* — what to build, where to stand, which way
to look.

Runs headed, for the same reasons `play-castle.mjs` does. Output goes to
`./candidates/`, and nothing there reaches `assets/` until it's named in
`candidates/chosen.json`.

### `promote-previews.mjs`

`candidates/chosen.json` → `assets/previews/<name>.jpg` (330x200, the board's
hover unfurl) and `assets/og/<name>.jpg` (1200x630, the share card). Crop, resize
and JPEG encode all happen in a canvas so this needs no image library. `--dry`
reports the sizes without writing.

### `sync-social-tags.mjs`

Regenerates the favicon + Open Graph block on every page linked from the board,
taking each page's title and description from its own `<a class="notice">` in
`index.html`. Reword a notice, re-run this, and the share card matches. Bounded by
`<!-- gvb:social:start -->` / `<!-- gvb:social:end -->` markers, so it's
idempotent. `npm run social:check` reports drift and exits non-zero without
writing.

## Adding a check

Keep the pattern: measure something a person would otherwise have to eyeball,
print the number, and exit non-zero. A check that only prints is a check that
gets ignored.
