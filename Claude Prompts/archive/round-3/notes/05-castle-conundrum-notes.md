# Castle Conundrum — session notes

## What changed

### Task one: the hall table and gothic statue were embedded in the back wall — and so were two more things nobody had measured

Round 2 found (but didn't fix) the hall table and the gothic statue sitting inside the north wall, and named the fix as a furniture re-tuning session: table, chair, statue, candleholders, lantern tile coordinates, the Scholar's own position, and `SCHOLAR` in `play-castle.mjs`. Wrote a disposable probe (`attachSceneProbe` + a dump of every top-level scene child's world-space bounding box, kept in scratch, not committed) to measure the room's actual geometry before touching anything, rather than hand-deriving it from `scene-config.json`'s tile math a third time.

**The room, measured directly:** north wall inner face at world `z = -10`, the doorway partition's inner face at `z = -6`, hall west wall inner face at `x = -6`, hall east wall inner face at `x = 6`. A 12 m × 4 m interior.

**Four objects were sealed inside stone, not two:**

| object | old tile | old world box | problem |
| --- | --- | --- | --- |
| `gothic_statue` | `[0, -2.85]` | z `-11.774..-10.211` | entirely inside the north wall — confirmed rendering nowhere (round 2's finding) |
| `WoodenTable_01` | `[0, -2.5]` | z `-10.329..-9.671` | north edge 0.33 m past the wall (round 2's finding) |
| `GothicCabinet_01` | `[-2.2, -2.7]` | x `-9.257..-8.129`, z `-11.66..-9.94` | **entirely inside the corner where the north wall and the hall's own west wall meet — found this session, same bug, nobody had measured this corner** |
| `GothicCommode_01` | `[2.2, -2.7]` | x `8.508..9.089`, z `-11.402..-10.2` | **entirely inside the north wall, mirrored on the east side — found this session** |

Also found: `wooden_lantern_01` clipped 0.03 m into the wall even while resting on the table (because the table's own north edge already did), `brass_candleholders` clipped 0.25 m the same way, and the **Scholar's own body** clipped 0.29 m into the wall at his old position (`[1.5, 0, -10.0]`) — nothing had ever checked an NPC's own body against the wall behind it, only against the table.

**Fix: one rigid shift for the whole cluster, plus two side-shifts.** Table, chair, stool, statue, lantern, candleholders (`data/scene-config.json`) and the Scholar (`data/npcs.json`) all moved +2.0 m south (+0.5 tile) as one translation, so every relative distance inside the cluster — the Scholar's 0.286 m clearance from the table, the candleholders sitting on the table, the chair's spacing — is unchanged; only their position relative to the walls changed. +2.0 m was picked as the smallest round number that clears the statue's north edge (0.23 m margin) without pushing the chair's south edge past the doorway partition (0.76 m margin) — the valid range was roughly +1.9 to +2.6 m.

`GothicCabinet_01` and `GothicCommode_01` needed a second shift, off their own side walls, because a south-only shift alone would have walked them straight from the north wall's territory into the hall's west/east wall territory instead (the two wall bands are adjacent, not overlapping — clearing one only to land in the other). Shifted `GothicCabinet_01` east 4.4 m and `GothicCommode_01` west 4.4 m (mirrored), sized to clear both the side wall and the hall's own support columns (world `x -6..-5.2` west, `x 5.2..6` east, `z -10..-9.2`), which sit directly in the naive straight-line path off the wall.

Verified empirically at every step — measured the actual bounding boxes after each edit with the same probe, not hand-derived from tile arithmetic, since two of these objects (`gothic_statue`, `GothicCabinet_01`) have a rotation-dependent offset between their tile position and their bounding-box center of 0.1–0.4 m that isn't obvious from the config alone.

**Screenshots:** `Claude Prompts/notes/05-castle-conundrum/hall-wall-fix/overhead-after.png` (a disposable top-down probe shot — statue, table, both cabinets, the Scholar and both light sources all visible together, comfortable margins from every wall) and `in-play-table-and-commode-visible.png` (an actual frame from `npm run play`'s Keystone beat — the real game camera, not a probe, showing the table, candelabra and the commode against the wall, all rendering).

### Task one also added a guard-rail: nothing had ever checked furniture against the wall behind it

Added a beat to `play-castle.mjs`: every one of the four fixed objects (table, statue, cabinet, commode) checked for 3D overlap against every wall/tower/column piece in the scene, identified by top-level group name (`wall`, `wall-half`, `tower`, `column` — the exact names `castle-builder.js` gives them). **Not** the existing brazier check's height-based "stoneBoxes" heuristic (anything >1.5 m tall, not skinned) — tried that first, and it reported the statue (1.74 m) and the cabinet (2.36 m) both "embedded," because each one is itself taller than 1.5 m and the heuristic counted each as its own wall, checking it against itself. Caught by running the beat once and seeing every furniture item fail simultaneously, including the one (commode, 1.21 m tall) that happened to fall under the height threshold and so didn't self-match — a beat that fails different objects for different, wrong reasons is a beat with a bug in it, not a real finding. Switched to name-matching and re-verified.

Verified per locked decision #34, twice over: reverted `data/scene-config.json` and `data/npcs.json` to their committed (pre-fix) state and confirmed the beat reports `{"table":"EMBEDDED","statue":"EMBEDDED","cabinet":"EMBEDDED","commode":"EMBEDDED"}`; restored the fix and confirmed `{"table":"clear","statue":"clear","cabinet":"clear","commode":"clear"}`.

### Task two: previews reviewed and promoted

Looked at the candidates already sitting in `Tools/board-check/candidates/` (`castle-conundrum-00-gatehouse.png` plus two motion frames) and `report.json`'s entry for this project: `introGone: true`, `moving: true`, `noErrors: true`, `"reached": "6.48m off the gatehouse at 0, 2.98"`. The chosen frame (Guard standing post, both gate braziers lit, crisp wall texture, quest text readable) reads well — kept the existing `chosen.json` pick rather than re-shooting. Ran `npm run promote`. Only `assets/previews/castle-conundrum.jpg` and `assets/og/castle-conundrum.jpg` actually changed on disk (`git status` after the run) — every other project's candidate re-encoded byte-identical, so this didn't disturb any other thread's work in progress. One unrelated failure in the same run, `FAIL torchbearer no such candidate: torchbearer-00-vanguards-watch.png` — `chosen.json` names a file that isn't in `candidates/`, not this project's file or this project's job to fix.

### Task three: `play-castle.mjs`'s own copy of the engine-mismatch bug

Mechanical swap, exactly as prescribed: `page.waitForFunction(fn, null, opts)` → `waitFor(page, fn, opts)` (1 call, the victory-screen wait), `page.waitForTimeout(ms)` → `await wait(ms)` (11 calls, not the 12 the prompt estimated — recounted directly with `grep -c`, only 11 exist in this file), `page.textContent(sel)` → `await textContent(page, sel)` (3 calls). Added `waitFor, wait, textContent` to the existing `drive.mjs` import line. No behavior change on this machine (Windows/Playwright was never affected by the bug — it's Linux/`puppeteer-core`-only), so this couldn't be broken-on-purpose-and-watched-fail the way locked decision #34 asks; verified instead by running the full 34-beat suite clean before and after, and by checking the diff mechanically matches `drive.mjs`'s documented replacement shapes.

### Task four: the gate door's hinge/pivot placement

Round 2 found the closed door leaf's world position (`x` roughly `[-5.4, -1.8]`) never crossing the courtyard's centered archway (`x [-2, 2]`), untraced. Traced it: `castle-builder.js`'s pivot-position formula, `pivot.position.set(gatePos.x - size.x / 2, 0, gatePos.z)`, derives where the hinge sits by assuming the door swings from world x-offset `[0, size.x]` — true only when `rotationY = 0`. This gate's config uses `rotationY: 180` (matching every `wallRun` flanking the archway, all rotated 180 too, so their faces point into it) and a 180° rotation flips that offset range to `[-size.x, 0]` in world space — the un-rotated formula put the whole leaf's midpoint `size.x` away from where it needed to be, on the wrong side of world x 0 entirely. Solved for the pivot position that keeps the door's world-space midpoint at the archway center for the actual `rotationY` (`gatePos.x - (size.x/2)*cos(rotY)`, with a matching `sin(rotY)` term on `z` for any future non-0/180 gate) instead of hardcoding the `rotY = 0` case.

Confirmed with the same probe: door box was `x[-5.4, -1.8]`, now `x[-1.8, 1.8]` — centered on the archway, matching `size.x = 3.6` exactly. Screenshots: `Claude Prompts/notes/05-castle-conundrum/gate-door-fix/closed-after.png` (viewed from the courtyard — the door now visibly fills the arch, dark wood against the stone) and `opening-in-play.png` (an actual `npm run play` frame — the door swung clear, archway open, "The gate is open" objective text visible).

Added a beat: the closed door's world x-range must cover at least `[-1, 1]` (most of the archway's center), identified by finding the scene child near the gate's world z (`~12`) that isn't a wall/tower/column and is 1–5 m wide. Verified per locked decision #34: reverted the pivot formula to the old `gatePos.x - size.x/2` (no rotation term) and confirmed the beat fails (`x[-5.40, -1.80]`); restored the fix and confirmed it passes (`x[-1.80, 1.80]`). `grep -rn "REINTRODUCED"` over `Projects/Castle Conundrum` and `play-castle.mjs` returns nothing.

Did not change which way the door swings open, or its swing angle (105°, unchanged) — only where the closed leaf sits. Not investigated: whether the model's own authored geometry is off-center within its own bounding box in a way that would still look slightly asymmetric close up; the fix targets the sign/rotation error that put the entire leaf off-frame, which was the actual, confirmed bug.

## What I verified

`cd Tools/board-check && npm run play` → **34 beats, all passing**, headed, real Chrome via Playwright (this machine is Windows, so `harness.mjs`'s non-Linux branch applies — see locked decision #53, not a concern here):

```
  ok    reached the start screen  Summoning stonework… 144/144
  ok    three rigged NPC bodies in the scene  found 3
  ok    every skeleton rebound into the scene tree (SkeletonUtils clone)
  ok    rigs are animating  3 hand bones tracked
  ok    every pixel-art texture magnifies NEAREST  25 textures at <=128px
  ok    the 1k Poly Haven maps still magnify LINEAR  52 textures over 128px
  ok    every texture is at the GPU anisotropy ceiling  cap 16, worst 16, 77 textures
  ok    interior hall walls are the same height as the outer walls  outer 4m, hall 4m
  ok    hall columns reach the same height as the walls, not a 1m stub  4m across 4 submeshes
  ok    every tabletop item rests on the table, not above it  2 items, gaps -0.001/-0.001
  ok    no tabletop item overhangs the table  worst overhang 0m
  ok    the Scholar is standing clear of the hall table  0.286m clear
  ok    every brazier has a stand that reaches the floor  coal@0.9 base@-0.001 6parts (x3)
  ok    no brazier is sealed inside the stonework  [-3.2,9.4] [3.2,9.4] [3.4,-6.4]
  ok    the closed gate door crosses the archway it is meant to fill  x[-1.80, 1.80]
  ok    the hall table, statue, cabinet and commode all clear the wall behind them
        {"table":"clear","statue":"clear","cabinet":"clear","commode":"clear"}
  ok    pointer lock engaged
  ok    the hall brazier collider stops the player walking into it  blocked as expected
  ok    mouse look turns the camera  0.0303 -> 0.2303
  ok    walked to the Scholar  3.1m after 0 bursts
  ok    E opened the Scholar dialogue  Scholar
  ...the remaining pre-existing quest beats, unchanged...
  ok    victory screen appeared
  ok    no page/console errors
  ok    no offsite requests

all beats passed
```

`SCHOLAR` walking to 0 bursts (vs. 4 last round) is expected, not a regression: the Scholar is now 2 m closer to the hall doorway the player enters through, so he's already in interact range as soon as the camera turns to face him.

### Every new/changed beat verified per locked decision #34

| What I broke | What failed | What I restored |
| --- | --- | --- |
| reverted `data/scene-config.json` + `data/npcs.json` to committed state | `the hall table, statue, cabinet and commode all clear the wall behind them` → `{"table":"EMBEDDED","statue":"EMBEDDED","cabinet":"EMBEDDED","commode":"EMBEDDED"}` | the fixed tile/position values |
| reverted the gate pivot formula to `gatePos.x - size.x/2` (no rotation term) | `the closed gate door crosses the archway it is meant to fill` → `x[-5.40, -1.80]` | `gatePos.x - (size.x/2)*cos(rotY)` |
| (in the middle of writing the wall-clearance check) height>1.5m "stoneBoxes" heuristic instead of name-matching | every furniture item reported `EMBEDDED` against itself | name-matching on `wall`/`tower`/`column` |

`grep -rn "REINTRODUCED" "Projects/Castle Conundrum" Tools/board-check/play-castle.mjs` returns nothing after all three.

`npm run check` → **358 units checked, 0 broken; 0 collisions across nine widths, tightest vertical gap 9.1px.** Unaffected by anything this session touched, as expected.

`npm run social:check` → 18 notices, 12 current, 6 drifted (`daredevil`, `torchbearer`, `fourth-quarter`, `Ren-Faire-Claude`, `orbital`, `newindex.html`) — none of these are Castle Conundrum, consistent with other threads mid-edit in this same repo right now. Not touched, not mine.

Verified in headed Chrome via `playwright-core`, not the in-app browser pane, for everything above and every disposable probe this session used (per locked decision #25 — the pane doesn't composite WebGL when hidden).

## Shared-file requests

None. `games.mjs`'s `castle-conundrum` recipe (URL, frame size, three.js specifier, intro overlays, `open()` steps) isn't affected by anything this session touched.

## Deliberately not done

**The gate door's own authored asymmetry, if any.** Fixed the sign/rotation error that put the whole leaf off-frame; didn't separately verify whether the Poly Haven model's mesh is perfectly centered within its own bounding box. Worth a look only if someone gets close enough in-game to notice the door looking slightly off-center within the arch — not visible at normal play distance.

**Cabinet/commode clearance margins are generous (1.1–1.3 m from their side walls), not flush against them.** The column positions (world `x -6..-5.2` and `5.2..6`, right where a tighter shift would have put them) forced the choice between "flush against the wall" and "clear of the column," and clear-of-the-column was the one that couldn't be skipped. A future session could re-tune these two to sit closer to their walls if the room reads as too open — not attempted here, since it's a cosmetic call and the structural bug (invisible furniture) is what this round's task asked for.

**The two site-wide `social:check` drifts and the `newindex.html` one are not this project's.** Listed under "What I verified" for completeness; not investigated further, not this project's ownership.

**Re-materialling the walls with Poly Haven stone. Still decided, not open work** — unchanged from round 1's call. See `Claude Prompts/notes/05-castle-conundrum/` (round 1's before/after pairs) if this needs re-litigating.

**No save.** Unchanged from round 2's note — the quest is two booleans and about fifteen minutes long. `gvb-site-handoff-v9.md` documents `gvb-save.js`'s current capabilities if that calculus ever changes.

## Next session

Nothing on this round's task list is left open. In order of value per effort, for whoever picks this project up next:

1. **Cosmetic: tune the cabinet/commode clearance margins tighter against their walls** (Deliberately-not-done, above), if the hall reads as too open with them pulled this far in. Low value, low effort.
2. **Confirm the gate door's own mesh symmetry** (Deliberately-not-done, above) if anyone notices it up close. Speculative — no evidence it's actually off.
3. Round 1's original backlog items not re-litigated by round 2 or this round (walls stylised, no save) still stand; see round 1's own notes under `Claude Prompts/archive/round-1/notes/05-castle-conundrum-notes.md`.

**As of this session, Castle Conundrum has no known open bugs.** Every item on rounds 1 and 2's task lists is closed, this round's four tasks are all done and verified, and `npm run play` is a clean 34-beat run with real movement, real GPU compositing, and guard-rails (per locked decision #34) for every fix made across all three rounds. The project is in a stable, shippable state; nothing here needs a follow-up session unless new work surfaces.
