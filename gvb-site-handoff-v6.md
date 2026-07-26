# gvb-site-handoff-v6.md

Handoff from **session 6** (site version 7) → whoever picks this up next.
Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v5.md` first if you have not. Everything in it still
holds unless contradicted below.

---

## 0. What changed in one paragraph

Session 6 cleared v5's whole suggested-next list. **All seven hover previews
exist**, captured by actually playing each game rather than screenshotting a
title screen — `capture-previews.mjs` is no longer "unfinished", it drives every
project with that project's own selectors and world coordinates and *asserts* it
reached gameplay. **Every page linked from the board now carries a favicon and
per-project Open Graph tags**, generated from the board's own notice copy so the
two can't drift, which also closes the phantom `/favicon.ico` 404 that has been in
every verification log since session 1. **`interaction.js` now tests line of
sight**, so the class of bug that hid the Guard inside a wall for three sessions
is fixed in the game rather than guarded in a test — and getting that right took
two wrong turns that are both worth reading (§4), because both of them *looked*
like they worked. Two real bugs turned up in passing: a missing method that
crashed The Fourth Quarter's "New Game" and every venue move (§5). The reusable
technique from v5 §4 is now a module, `drive.mjs` (§6).

---

## 1. The seven previews exist

`assets/previews/*.jpg` — all seven, 330×200, 6–15 KB each, ~75 KB for the folder.
`npm run shoot` reports `.unfurl elements attached: 7`.

**None of them is a title screen.** Each recipe in `capture-previews.mjs` plays
its game to a frame that shows the thing the notice is describing:

| Quest | What the frame shows | How it gets there |
| --- | --- | --- |
| Integer Foundry | two production lines with numbered packets moving, log filling | places 13 tiles via `[data-tool=…]` + `#grid .cell[data-x][data-y]`, waits ~10 s for packets |
| Closing Time | the MLS board, 23 listing cards with prices and a STALE stamp | picks a brokerage, ends a day, `[data-nav="mls"]` |
| Faire Weekend | the site plan with four built plots beside the Fair Floor desk | builds four kinds, commits, opens the tab, scrolls to top |
| Golden Hour | sunset shoreline, real Poly Haven sand, dune grass | clicks the overlay, walks to the water, turns 0.5 rad toward the sea |
| Aphelion | dim hab interior, amber HUD gauges, the opening CERES toast | clicks the title card, waits out the 2 s fade, walks in |
| Castle Conundrum | the gatehouse arch across the courtyard with the Guard in frame | backs 6.4 m up the courtyard, then turns round |
| The Fourth Quarter | the bar at 7 PM, taps and TVs lit, patrons in | dev menu for cash and stock, E at the door, opens the doors, waits for the room to fill |

Three things about that table are worth knowing before you change any of it.

**Castle Conundrum does not walk to the Guard — it walks away from him.**
`scene-config.json` spawns the player at z = 8 and the Guard stands at z = 9.2, so
the game *opens* 2.16 m from him, already inside `INTERACT_RANGE` with "Press E to
talk to the Guard" on screen. The first version of this recipe called
`walkTo(GUARD, dist < 4.6)` and got a chest-up crop behind a tooltip, because
there was never a walk to do. The recipe now backs up the courtyard and turns
round, and asserts `#interact-prompt` is hidden before accepting the frame.

**The Fourth Quarter's aim has to be the last thing that happens, and it has to
measure before it turns.** `player.js` spawns facing yaw = π, which is the door
the player just came in through — a blank wall — so aiming is mandatory. But its
mousemove handler returns early unless pointer lock is held, *and* every
Playwright click drags the real cursor across the page, which while locked feeds
`movementX`/`movementY` straight into yaw and pitch. This capture clicks through
the dev menu and the Tonight panel on the way in and arrives roughly **four whole
turns of yaw** from where it started with the pitch tipped at the floorboards.
Turning by a fixed −π from the assumed start produced a wall, then a floor. See
`lookAt()` in §6.

**Its patron positions are not deterministic**, so it takes three frames four
seconds apart and `candidates/chosen.json` picks one. Patrons walk in through the
door the camera stands next to; one roll puts a head in the lens and the next has
them all at the bar. The recipe now strafes out of the entrance lane first, which
helps but does not guarantee.

### The staleness check was measuring nothing

The old script's "nothing is animating" guard was:

```js
fs.statSync(f).size + ':' + fs.readFileSync(f).length
```

Both halves of that are the file's byte length. It was a file-size comparison
wearing a hash's clothes, and any two visually different frames of equal size
passed it. It is a real SHA-1 of the file contents now.

It is also **per-recipe** (`live: false`), because the check as a universal rule
is wrong: Closing Time and Faire Weekend are turn-based, and a still frame is
their correct playing state. Making them "move" would have meant faking motion to
satisfy a check. For those two the evidence is the positive DOM assertion inside
`play` instead — 23 listings on the board, 4 plots on the grounds.

### Golden Hour is allowed one offsite request, deliberately

`terrain.js` hotlinks its sand texture from `dl.polyhaven.org` and falls back to a
procedural canvas texture when that host is unreachable. Capturing it blocked
produces a beach **no visitor ever sees**. So `prepPage()` gained an `allow` list
and this one recipe uses it; the request is recorded in `page.__allowed` and
printed. Every other script leaves `allow` empty, which is what keeps
`page.__blocked` an honest inventory of the site's real external dependencies —
and that inventory is now exactly one entry long, since session 4 vendored
three.js everywhere. The README claimed Castle Conundrum also hit polyhaven; it
does not, and that line is corrected.

---

## 2. Two sizes from one frame

`npm run promote` reads `candidates/chosen.json` and writes **both**:

- `assets/previews/<name>.jpg` — 330×200, under 60 KB (the board renders it 165 px
  wide, so this is already 2×)
- `assets/og/<name>.jpg` — 1200×630, under 300 KB (what crawlers want; a 330 px
  image gets rejected or badly upscaled)

Same chosen moment, two crops, so a shared link previews the same thing hovering
the notice does. The captures are 33:20 and og wants 1.905:1, so the card is
cropped with its window slightly **above** centre — in all seven frames the bottom
of the shot is floor, flagstone or empty desk.

**No image library.** Crop, resize and JPEG encode all happen in a canvas in the
browser that is already running. `sharp` means a native build and `jimp` means
another dependency, in a folder whose entire premise is that `npm install` works
in a sandbox with no CDN reachable (v3 §3, v4 decision 20). The one thing to know
if you touch it: downscaling 2640 px to 330 px in a single `drawImage` aliases
badly, so it halves repeatedly and only does the final non-integer step at the
end.

Nothing in `candidates/` reaches `assets/` until it is named in `chosen.json`, and
`--dry` reports every size without writing.

**`candidates/chosen.json` is now tracked**, while everything else in that folder
stays ignored — it is the only record of which frame each shipped image came from.
That needed `candidates/*` rather than `candidates/` in `.gitignore`: git refuses
to re-include a file whose parent directory is excluded by a directory pattern, so
a `!candidates/chosen.json` negation under the old line was silently dead.

---

## 3. Favicons and OG tags, generated from the board

23 pages — everything linked from `index.html` — now carry a favicon and a full
Open Graph + Twitter block. `npm run social` writes them, `npm run social:check`
reports drift and exits non-zero. Idempotent: running it twice reports
`23 already current`.

**The copy is read out of `index.html`, not hand-written.** Every notice on the
board already has an `<h3>` and a `<p class="desc">` in the site's voice.
Hand-copying those into 23 heads means 23 places for them to go stale the next
time a notice gets reworded. `sync-social-tags.mjs` parses the board and rewrites
the block between `<!-- gvb:social:start -->` / `<!-- gvb:social:end -->` markers,
so a notice edit plus one command keeps board and share card identical by
construction.

Two decisions inside that:

- **The favicon is the same mark on every page, not a per-project one.** It is the
  site's seal, it is an inline SVG data-URI so it costs no request and no file, and
  a visitor moving from the board into a quest should see the tab icon stay put.
  This is also what closes the `/favicon.ico` 404 that has been in every
  verification log since session 1 — Chrome was falling back to the origin root on
  pages that declared no icon. Castle Conundrum's hand-written copy from v5 §3 was
  removed so the generated block owns it; the script refuses rather than
  duplicating if it finds hand-written icon or `og:` tags.
- **`og:image` is per-project where a capture exists, shared otherwise.** The seven
  games point at their own `assets/og/<name>.jpg`. The 16 pages with no capture
  (Pathfinder, Tools, the archived and not-yet-captured Projects) point at the
  board's existing `guild-board.png`. Giving those bespoke cards would have meant
  inventing artwork nobody asked for.

`index.html` and `404.html` keep their own hand-written blocks and are not touched.
`Projects/Castle Conundrum/assets/kenney_retro-fantasy-kit/Overview.html` is
vendored third-party content and is deliberately skipped.

---

## 4. Line of sight, and the two ways I got it wrong first

`interaction.js` now tests **proximity + facing + line of sight**. This closes
v5's item 4 and, more to the point, retires v5 decision 26 as a *test-side*
concern: the game itself refuses to offer a prompt for a body nobody can see.

The implementation is small — two rays per candidate NPC at 1.55 m and 1.15 m,
occlusion only counts if it blocks **both** — but two earlier versions passed
`npm run play` while doing nothing, and both were checked the only way that works:
by putting the Guard back at `[1.6, 0, 10.2]` and confirming the failure.

**Wrong turn 1: exempting the box the NPC is standing in.** The reasoning was that
an NPC embedded in furniture isn't *occluded* by it, so `box.containsPoint(target)
→ skip`. That exemption also excuses a body sealed inside a wall, which is the
entire bug. The two sample heights are what separate the cases without an
exemption: a table contains the low sample and not the high one, a wall contains
both.

**Wrong turn 2: raycasting against `castle.colliders`.** This looks obviously
cheaper than the mesh tree and it cannot work here. The gatehouse the Guard was
buried in is placed with **`"noCollide": true`** in `scene-config.json`, so the
player can walk through the archway — which means it is not in the collider list
at all, and a collider-based test reports a clear view straight through solid
stone. Rays go against the scene's top-level children (minus the NPC bodies,
cached until the child count changes).

**And a third thing that isn't a wrong turn so much as a trap: the standoff margin
has to stay small.** The ray stops `SIGHT_MARGIN` short of the body so a surface
flush against them doesn't count. At 0.35 m that margin is *larger than the
0.16 m the Guard was buried by*, so the ray hit its `far` before it reached the
wall and reported a clear view. It is 0.05 m, and the NPC's own mesh is excluded
from the occluder list rather than being handled by the margin.

Cost is fine: the check runs **last**, after range and facing have already
rejected everyone, so most frames raycast nothing at all.

**Verified in both directions.** With the Guard at the correct `[1.8, 0, 9.2]`, all
22 beats of `npm run play` pass — including the Scholar, who stands half inside a
hall table and was the thing most at risk from this change. With the Guard back
inside the wall, the run aborts at `walked to the Guard — never got in range`,
because no prompt is offered, alongside the existing assertion naming
`wall-fortified-gate_3`. `data/npcs.json` is back to its committed state; check it
if a future run behaves oddly.

---

## 5. Two bugs found in passing

**`day.rebuildStations is not a function` — The Fourth Quarter.** `main.js`'s
`rebuildVenue()` has always called it and `DayPhase` never had it, so **"New Game
(wipe save)" and every venue move** threw and abandoned the rest of
`rebuildVenue()` — which is why the camera never got reset to the spawn point on
those paths. Found because the capture recipe clicks `#wipeBtn` to avoid landing
mid-campaign on a stale save, and the recipe's "no console errors" assertion
caught it.

The method now re-seats the station rings and re-attaches the group if it ever
detaches. It reads as a no-op today and that is correct: `buildWorld()` ignores the
venue argument `main.js` passes it, so `ROOM`/`KITCHEN`/`DOOR` are the same metres
at every tier. The moment a tier gets its own floor plan, that is the hook that has
to know.

**An empty `{js,css,test,textures}` directory** under `Projects/fourth-quarter/` —
the fossil of a `mkdir -p {a,b,c}` run in a shell without brace expansion
(PowerShell). Empty and untracked, so git never showed it. Removed. Worth
remembering as a Windows-specific hazard: **brace expansion is a bash feature, and
the PowerShell tool in this environment will happily create a directory named
after the literal braces.**

---

## 6. `drive.mjs` — v5 §4, now a module

v5's §4 was the most reusable thing in that document and it lived as prose plus a
copy inside `play-castle.mjs`. It is now `Tools/board-check/drive.mjs`, used by
both `play-castle.mjs` and `capture-previews.mjs`. `play-castle.mjs` lost ~40 lines
and still passes all 22 beats.

What it exports, and the three non-obvious things in it:

- `attachSceneProbe(page, threeUrl)` / `waitForProbe(page)` — `window.__scene` and
  `window.__cam`. **Both handles now fall out of one hook**, `Object3D.prototype.
  updateMatrixWorld`, because `WebGLRenderer.render()` calls it on the scene every
  frame *and* on the camera every frame (`if (camera.parent === null)
  camera.updateMatrixWorld()`, and none of these games put their camera in the
  scene graph). My first version hooked `getWorldDirection` for the camera with a
  `PerspectiveCamera.updateProjectionMatrix` fallback, and **hung on Golden Hour
  and Aphelion**: neither calls `getWorldDirection`, and `updateProjectionMatrix`
  runs at construction, before the patch exists, and then only on resize.
  `threeUrl` must be the exact specifier the game's import map resolves, or you
  patch a second copy of three and nothing happens.
- `walkTo(page, target, arrived, opts)` — aim, hold W in bursts, strafe when the
  distance stops changing. `opts.nearAt` is where long strides become short ones;
  raise it above your target distance or the last 400 ms stride (≈2 m at Castle
  Conundrum's `WALK_SPEED` of 5.2) sails straight past.
- `aimAt` / `setYaw` — write `camera.rotation` directly. **These only work on
  Castle Conundrum.** It uses three's own `PointerLockControls`, which treats
  `camera.quaternion` as the source of truth and only adds to it, so a direct write
  survives. Aphelion, Golden Hour and The Fourth Quarter all roll their own
  controls holding private `yaw`/`pitch` fields and overwrite `camera.rotation`
  from them every frame; a write there is gone within ~16 ms.
- `turnBy` / `lookAt` — for those three. They dispatch a `mousemove` carrying an
  explicit `movementX`/`movementY` rather than using `page.mouse.move()`. Real
  synthesized moves *do* drive these handlers — `play-castle.mjs` asserts exactly
  that — but the browser derives `movementX` from the delta between successive
  absolute cursor positions, so **one sweep is capped at the viewport width and
  repeated sweeps in the same direction cancel out**. There is no way to compose a
  180° turn from them. These handlers are plain `document.addEventListener
  ('mousemove')` closures that read `e.movementX` and nothing else, so an
  untrusted event with the field set is equivalent for their purposes and exact
  besides. **Prefer `lookAt` (absolute) over `turnBy` (relative)**: it measures the
  current rotation first, which makes it immune to however much drift the clicks
  on the way in accumulated. See §1 on The Fourth Quarter for what that drift
  looks like.
- `camState(page)` returns `facing` (normalised) alongside `yaw` (raw). Judge
  direction by `facing`; the raw yaw drifts by whole turns and means nothing on its
  own.

`page.waitForSelector('#title.hidden')` is a related trap that cost a run:
Playwright's default state is `visible`, and an element that is hidden by
definition never becomes visible, so it waits out the full timeout. Pass
`{ state: 'attached' }`.

---

## 7. Backlog state

| Item | State |
| --- | --- |
| Fix `capture-previews.mjs`'s drive steps | **Done.** Real selectors and coordinates per game, plus assertions that it arrived. See §1 |
| Capture the seven preview screenshots | **Done.** All seven in `assets/previews/`, all looked at |
| Per-project OG tags | **Done.** Per-project images for the seven, shared board image for the other 16. See §3 |
| Per-project favicons | **Done.** All 23 pages; the `/favicon.ico` 404 is gone. See §3 |
| Interaction has no line-of-sight check | **Fixed in the game.** See §4 |
| `day.rebuildStations` missing | **New, fixed.** Crashed New Game and every venue move. See §5 |
| Scholar clips through a hall table; braziers look unsupported | **Still cosmetic, still not fixed.** The Scholar's table now has a *second* reason to care — it is the case the two-height sight test exists to tolerate (§4) |
| Adopt `gvb-save.js` in The Fourth Quarter | **Untouched.** Zero adopters still |
| Castle Conundrum wall textures read blurry | **New, not fixed.** See §8 |
| Golden Hour hotlinks its sand texture | **New, not fixed.** The site's last offsite dependency. See §8 |
| Vendor CDN dependencies | Fixed in v4; still zero offsite requests everywhere except Golden Hour's texture |
| `Tools/board-check` on Windows | Fixed in v4; `npm run check` passes here — 233 units, 0 broken, 0 collisions |
| NPC model mapping / rigged clones / held props | All fixed in v5, untouched and still passing |
| End-to-end smoke test for Castle Conundrum | v5's `npm run play`, still 22 assertions, all passing |

---

## 8. Two things I looked at and deliberately did not fix

**Castle Conundrum's walls are visibly blurry up close.** Obvious in
`shots/play/01-at-scholar.png` and any preview candidate taken within a couple of
metres of stone. The walls are Poly Haven kit models at 1k textures, scaled to
4 m tiles by `castle-builder.js`, and scaling a mesh stretches its UVs — so the
texture is magnified, which no amount of anisotropy fixes. A real fix means either
re-tiling UVs per wall piece or sourcing 2k textures, both of which are geometry
work with re-verification attached, and neither is on any previous session's list.
The previews are framed from 6+ m where it does not show, which is honest rather
than evasive — that is the distance the game is normally played at.

While looking at that I also thought the south wall pieces were mismatched in
height at the gate seam. Looking again at the wider frame, the top edges are
perspective-consistent and the vertical posts are the gate piece's own frame. **I
could not confirm a defect there**, so I am recording the suspicion rather than the
finding.

**Golden Hour's sand texture is the site's last hotlink.** Vendoring it means two
1k JPEGs in the repo (~1–2 MB), which is a bigger call than the three.js vendoring
in v4 and belongs to whoever decides how heavy this repo is allowed to get. Until
then `terrain.js`'s silent procedural fallback means the page never breaks, it just
looks different, and `capture-previews.mjs` allows the request so the preview shows
what a visitor gets (§1).

---

## 9. Locked decisions

Everything in v1 §3, v2 §8, v3 §6, v4 §5 and v5 §6 still stands, with one
amendment: **v5 decision 26 is now enforced by the game, not only by the test.**
Added:

28. **A preview is a frame from *play*, and the capture script has to prove it
    got there.** Every recipe asserts intro overlays are gone and makes a positive
    DOM claim about gameplay state; the ones with a clock also assert the frame
    changes. A screenshot script that only screenshots is how five sessions ended
    up with no previews.
29. **`live: false` on a turn-based recipe is correct, not a workaround.** Closing
    Time and Faire Weekend genuinely have still frames while being played. Don't
    "fix" them by animating something to satisfy a motion check.
30. **One chosen frame produces both the 330×200 hover preview and the 1200×630
    share card.** Same moment, two crops, so the two never disagree. Resize and
    encode happen in a canvas — do not add an image library to this folder.
31. **Page titles and descriptions live in `index.html`'s notices; every head is
    generated from them.** Reword the notice and run `npm run social`. Never
    hand-edit inside the `gvb:social` markers — it will be overwritten, and
    `npm run social:check` will call it drift.
32. **The favicon is one shared inline SVG data-URI on every page.** Per-project
    marks were considered and rejected: the icon is the site's identity, and it
    costs zero requests this way.
33. **Occlusion tests in Castle Conundrum go against the mesh tree, not
    `castle.colliders`.** Decorative geometry can be `noCollide` — the gate arch
    is — so the collider list is not a description of what you can see through.
34. **Verify a guard-rail by reintroducing the bug it guards.** Two versions of the
    line-of-sight check passed the full suite while doing nothing at all. The only
    thing that caught either was moving the Guard back into the wall. If you add a
    check, break the thing on purpose and watch it fail.
35. **Direct `camera.rotation` writes only work where `PointerLockControls` does.**
    Three of the four 3D projects own the camera's rotation and rewrite it every
    frame. Use `lookAt` for those, and prefer it over `turnBy` because Playwright
    clicks under pointer lock silently accumulate yaw and pitch drift.

---

## 10. Suggested next session

Roughly in order of value per effort:

1. **Adopt `gvb-save.js` in The Fourth Quarter** as the reference integration. It
    has been on this list since v3 with zero adopters, and it is now the only
    untouched item that predates this session.
2. **Extend `npm run previews` into a real regression suite for the other six
    games.** It already plays all seven and asserts they reached gameplay — that
    is most of the way to what `play-castle.mjs` does for one game. Closing Time,
    Faire Weekend and Integer Foundry in particular have engine logic that nothing
    currently exercises end to end. `day.rebuildStations` (§5) is the argument:
    driving a game found a crash on a path a player takes on their first click.
3. **Decide about Golden Hour's hotlinked sand texture** (§8) — vendor it or
    accept it, but write the decision down either way.
4. **Castle Conundrum's blurry walls** (§8), if you want the game to look as good
    up close as it does at 6 m. Budget a session; it is UV or texture-sourcing
    work, and `npm run play` plus the preview capture give you a before/after.
5. **Cosmetic, low priority:** the Scholar still stands half-inside a hall table
    and the interior candelabra still read as floating. Both visible in
    `shots/play/`. Neither affects play — and note the sight test in §4 is now
    written to tolerate the table, so fixing the clipping is safe but not urgent.

Remember to bump the version line to `version 8` and write
`gvb-site-handoff-v7.md` before signing off.
