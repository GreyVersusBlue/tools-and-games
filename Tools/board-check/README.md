# board-check

Dev-only tooling. Nothing in here is linked from the board, and none of it runs
in a visitor's browser. It exists so a session can actually *render* the site
instead of reasoning about CSS and hoping.

```
npm install          # also vendors three.js 0.160.0 and 0.169.0
npm run check        # integrity sweep + collision guard, both exit non-zero on failure
npm run games        # regression suite for the games; opens real windows
npm run tools        # sweep of the Tools/ pages no game suite ever opens; headless
npm run shoot        # writes reviewable PNGs to ./shots/
npm run previews     # plays every quest, screenshots gameplay to ./candidates/
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

`play-games.mjs` and `capture-previews.mjs` are the exceptions, and deliberate
ones: they call `launch({ headed: true })`, because the Pointer Lock API and
real GPU rendering both need a browser that is genuinely compositing frames to a
screen. A hidden or headless browser doesn't fire `requestAnimationFrame` at all
in some hosts, which means a WebGL render loop never runs and every
frame-dependent assertion hangs instead of failing usefully. So those scripts
open a visible window and visibly play the games. Don't "fix" them back to
headless.

**On a Linux box with no display** (a cloud container), give them one:

```
xvfb-run -a -s "-screen 0 1600x1000x24" node play-games.mjs golden-hour
xvfb-run -a -s "-screen 0 1600x1000x24" node capture-previews.mjs blue-hour
```

That is the same SwiftShader rasterizer `launch()` forces on Linux headed or
not; Xvfb only supplies the screen `requestAnimationFrame` and pointer lock
want. What it means for a result (2026-09-24, measured at about 0.8 fps):

- A beat that scrubs a clock or moves the walker by hand and then reads what
  changed is trustworthy either way. Golden Hour's `?debug` beats are all this
  kind.
- A real-time movement beat (hold W, wait for the sun) is inconclusive either
  way (#53). Six to eight of Golden Hour's fail under Xvfb from one run to the
  next (the walk, mouse look, the arrow keys, the sun and fog, the re-aim, the
  wade settle, the footprints); do not "fix" them from here.
- Engaging pointer lock under Xvfb can deliver one mousemove the size of the
  cursor's offset from the window centre, which throws the camera about 1.45
  rad of yaw and 0.88 of pitch. It came and went between runs. Anything that
  depends on where the camera points after the lock engages should put the view
  back itself, as the Blue Hour recipe does.
- A capture is a draft for a person with a real GPU to look at, not a frame to
  trust. Say so wherever it is promoted.

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
you find out what the site actually depends on at runtime. **That inventory is
not the whole picture on its own**: a Google Fonts request is fulfilled from the
font shim above, not refused, so it never reaches `page.__blocked` — a hotlinking
page reports empty `__blocked` regardless. `page.__shimmed` records what the font
shim satisfied, for exactly this reason. Fifteen pages hotlinked fonts for a
period of the site's history while `play-games.mjs` (the only suite that ever
asserted `page.__blocked`, and only across the games it drives) reported the
site clean. `check-integrity.mjs`'s static source sweep is the check
that actually closes this: no browser, and it covers every `.html` in the repo,
not just the ones a suite happens to drive.

`prepPage()` still takes an `allow` list of host substrings to let through. It was
written for the hotlinked texture — blocking it left `terrain.js` on its
procedural fallback and captured a beach nobody saw — and nothing passes it now.

## The scripts

### `check-integrity.mjs`

Parses every `.js`/`.mjs`, every inline `<script>`, and every `.json` on the
site. Exits 1 on any failure.

This is here because a game's `src/npc.js` contained JSON instead of
JavaScript, which meant `main.js` could not `import { NPC }` and the game hung
on its loading screen. (That was Castle Conundrum, which is its own repository
now (#491); the reason it left behind is still the reason this check exists.) It went unnoticed because the previous check verified
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

### `tools.mjs`

Opens every page linked from the Town Services board — the six schoolhouse
tools — and asserts a non-empty title, no offsite requests, and no console
errors. Exists because `play-games.mjs` only ever opens the games: three
`cdnjs.cloudflare.com` hotlinks sat in
`Tools/final_grade_checker.html` for an unmeasured length of time for exactly
that reason. Headless, unlike the game suites — none of these pages need
pointer lock or WebGL, and running headless means it can run alongside a
headed suite without the two stealing each other's focus.

### `games.mjs`

One description per playable project: URL, frame size, the three.js specifier its
import map resolves, which overlays count as "intro", where it keeps its save, and
`open()` — the clicks that get from a blank page to the first frame of play.
`enter()` wraps that with "load it, wipe the save it left in this browser, play it
in". `capture-previews.mjs` and `play-games.mjs` both start here, so the way into a
game is written once. Add a game to the board, describe it here.

### `play-games.mjs`

The end-to-end regression suite for the games on the board:
build a real production line in Integer Foundry and watch the sink judge what
arrives, run a fortnight of Closing Time, build and open a Faire Weekend, walk
Golden Hour and Aphelion, put The Fourth Quarter's save through export, import,
a reload, a pre-versioning legacy blob and a real Real Estate lease, serve a
customer in Corner & Kettle and reload into the same shift, and Shelf-load
and import a committed save into Torchbearer to reach a real combat grid. Exits
non-zero on any missed beat, screenshots in `./shots/games/`. `npm run games` for
the current count — it grows with the board, so it isn't repeated here.

Four of these projects already have Node smoke suites, and this does not repeat
them. Those import the engine modules and drive them directly; they cannot see the
wiring. `day.rebuildStations` was the case in point — 122 campaign assertions
passing while "New Game" threw on the first click a player makes. Every beat here
is something that only breaks in a browser: a handler that was never attached, a
render that throws on empty state, a save that loads into a room nobody rebuilt.

### `drive.mjs`

Shared helpers for playing a first-person three.js game from a script: getting a
handle on the live scene and camera, aiming, and walking to a world coordinate.
Both driving scripts use it. Read its comments before writing a new driver — the
two non-obvious facts are that `renderer.render` is an own property so patching
`WebGLRenderer.prototype` captures nothing, and that every game here owns
`camera.rotation` and rewrites it every frame, so a driver needs
`turnBy`/`lookAt` rather than a direct write.

**Engine differences that aren't handled by `launch()`/`prepPage()` alone.**
Puppeteer and Playwright disagree on three call shapes this repo actually uses;
`page.__engine` (set by `prepPage`) is how the difference gets bridged. Use
these instead of the bare Playwright form, or a script that only ever ran on
Windows/macOS via Playwright will crash the instant it runs on Linux via
puppeteer-core (this happened: round 2 shipped with `waitForFunction(fn, null,
opts)` everywhere, worked fine wherever a real Chrome/Edge let Playwright
drive, and threw `Cannot read properties of null (reading 'polling')` on every
single Linux/puppeteer run until three independent threads had each rediscovered
it):

- `waitFor(page, fn, opts)` — in place of `page.waitForFunction(fn, null, opts)`.
- `textContent(page, selector)` — in place of `page.textContent(selector)`,
  which puppeteer-core doesn't have at all.
- `wait(ms)` — in place of `page.waitForTimeout(ms)`, which recent
  puppeteer-core versions dropped. This one needs no engine branch; a plain
  `setTimeout` promise works identically on both.
- `setFiles(page, file, trigger)` — answers the file chooser `trigger()` opens
  (`gvb-save.js`'s `promptImport()`), the two engines' event names differ.

All four are exported from here for that reason, even though `waitFor`/`wait`
have nothing to do with camera driving specifically — this file is the one
every headed script already imports, and a fifth near-identical helper file
was worse than a slightly misplaced export.

### `capture-previews.mjs`

Plays every project with a preview recipe into a real gameplay frame and screenshots it. Each
recipe drives its game with that game's own selectors and world coordinates, and
asserts it arrived: intro overlays gone, frame actually moving (for the games with
a clock), console clean. Exits non-zero on any miss.

Getting into each game lives in `games.mjs` now; what's left in each recipe is the
part that is about taking a *picture* — what to build, where to stand, which way
to look.

Runs headed, for the same reasons `play-games.mjs` does. Output goes to
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

## The ports

`serve()` binds a static server on a fixed port, and two suites on the same port
in the same shell is a silent cross-wire rather than an error. Several files say
"see `Tools/board-check/README.md` for the ports already in use" and this is the
list they meant; it did not exist until 2026-09-16. Grep for `const PORT` before
taking a new one.

| Port | Who |
| --- | --- |
| 8123 | `check-collisions.mjs`, `shoot-board.mjs` |
| 8125 | `capture-previews.mjs` |
| 8126 | `play-games.mjs` |
| 8127 | `tools.mjs`, `Projects/integer-foundry/test/browser.mjs` |
| 8129 | `Projects/integer-foundry/test/capture-legacy-save.mjs` |
| 8131 | `Projects/corner-and-kettle/test/drive-save.mjs` |
| 8137 | `Tools/schedule/test/publish.mjs` |
| 8138 | `Tools/schedule/test/smoke.mjs` |
| 8140 | `Pathfinder/tests/anathema.test.mjs` |
| 8146 | `Tools/seating-chart/test/drive-seating.mjs` |
| 8148 | `Tools/name-picker/test/browser.mjs` |
| 8151 | `Projects/daredevil/test/verify-touch-375.mjs` |
| 8153 | `assets/js/gvb-save.browser.mjs` |
| 8155 | `Projects/orbital/test/browser.mjs` |
| 8157 | `Projects/signal-city/test/browser.mjs` |
| 8161 | `Projects/golden-hour-beach/test/gltf-loader.mjs` |
| 8162 | `Projects/blue-hour-trail/test/gltf-loader.mjs` |
| 8163 | `Projects/fourth-quarter/test/gltf-loader.mjs` |

8127 is doubled and always has been: `tools.mjs` and Integer Foundry's suite are
never run in the same process, and neither is in the other's CI job. It is on the
list as a fact, not as a pattern to copy.

## Adding a check

Keep the pattern: measure something a person would otherwise have to eyeball,
print the number, and exit non-zero. A check that only prints is a check that
gets ignored.
