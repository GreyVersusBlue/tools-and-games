# SkyWings 64 — wishlist

A Pilotwings 64-style flight game in three.js r160: hang glider, gyrocopter and rocket belt, six
scored missions and Free Flight over one island. `CONTRACT.md` has the module interfaces, URL
parameters and the `window.__qa` test hook. `node test/browser.mjs` is the suite (82 checks, about a
minute and a half, Tools/board-check's harness); its first 35 are `test/assets.mjs`, which reads
`assets/models/` in Node alone and can be run by itself, and its last 3 hold a frame's draw calls to
`test/draws.json` from the first three of `test/draws.mjs`'s nine views (`node test/draws.mjs` runs
all nine, about three minutes). `node test/browser.mjs --models` runs the model, herd and terrain
checks alone in half a minute.

Both items below are open. Item 1 was measured on a real GPU on 2026-10-03 and all three of its
cuts shipped on 2026-10-07, counted in draws and not yet timed, so what is open in it is Devon's
timing run and the smaller cuts it lists; nothing else here has
been seen on a real GPU, and that includes the carved heads, rebuilt on 2026-10-05 and judged from Blender
renders and SwiftShader captures (`screenshots/heads_near.jpg`, `heads_far.jpg`; `HISTORY.md` #895).
The glider's landing is not here any more: Devon flew it by hand on 2026-10-03, it works, and no
tuning was asked for.

## 1. Draw-call cuts (all three made; measured on a real GPU before, not after)

**Devon: re-run `node tools/gpu-profile.mjs` on the Windows GPU to see the milliseconds, and look at
whether the extra triangles matter on a weaker card.** The three cuts below took 182 to 460 draws
out of a frame, counted under software GL: a frame is 204 to 352 draws where it was 386 to 745. At
the 4.7 to 5.8 µs a draw this section measured, that would be 0.9 to 2.7 ms of a 4.3 to 6.2 ms
frame, but nothing here has timed it. Cut 1 also draws 0.05 to 1.42 M more triangles a frame, which
cost nothing on the 3070 Ti and have not been tried anywhere slower; cuts 2 and 3 move triangles by
under 7 thousand.

One frame from each of `test/draws.mjs`'s nine views, Rotor Rally at quality high, 960x540:

| View | Before any cut | After cut 1 | After cut 2 | After cut 3 | Saved in all |
| --- | --- | --- | --- | --- | --- |
| Pad | 527 | 337 | 316 | 264 | 263 |
| Castle | 449 | 291 | 260 | 216 | 233 |
| Heads | 386 | 246 | 240 | 204 | 182 |
| Lighthouse | 732 | 595 | 493 | 352 | 380 |
| Mountain | 419 | 303 | 272 | 222 | 197 |
| Windmills | 687 | 451 | 384 | 291 | 396 |
| Cabins | 734 | 467 | 403 | 299 | 435 |
| Runway | 745 | 464 | 381 | 285 | 460 |
| Bridge | 524 | 342 | 297 | 220 | 304 |

### Cut 1, shipped 2026-10-07: vegetation batched, only the near tier casts (`HISTORY.md` #930)

Its table's "after" column is the frame before cuts 2 and 3.

Each kind and tier of vegetation is one InstancedMesh across every 320 m cell that tier is on in: 20
batches (three trees in two tiers, bushes near and far, three rock shapes in three, the impostors,
grass, flowers), where there was a mesh per cell, kind and tier. A cell joining or leaving a tier is
packed onto the end of the batch or closed over on the existing 0.12 s tick. Only the near tier (and
the grass) casts shadows. One frame from each of `test/draws.mjs`'s nine views, Rotor Rally at
quality high, 960x540, before and after:

| View | Draws | Saved | Vegetation, scene | Vegetation, shadow | Triangles | Geometry MB |
| --- | --- | --- | --- | --- | --- | --- |
| Pad | 527 to 337 | 190 | 120 to 20 | 99 to 9 | 2.90 to 4.32 M | 20.7 to 21.1 |
| Castle | 449 to 291 | 158 | 98 to 20 | 89 to 9 | 1.97 to 2.96 M | 20.4 to 22.0 |
| Heads | 386 to 246 | 140 | 95 to 20 | 74 to 9 | 1.13 to 1.40 M | 19.1 to 21.1 |
| Lighthouse | 732 to 595 | 137 | 149 to 20 | 17 to 9 | 0.87 to 0.92 M | 18.9 to 21.3 |
| Mountain | 419 to 303 | 116 | 98 to 19 | 45 to 8 | 0.83 to 1.55 M | 19.5 to 21.9 |
| Windmills | 687 to 451 | 236 | 183 to 20 | 82 to 9 | 2.41 to 3.30 M | 21.6 to 22.1 |
| Cabins | 734 to 467 | 267 | 188 to 20 | 108 to 9 | 2.98 to 3.80 M | 22.3 to 22.1 |
| Runway | 745 to 464 | 281 | 206 to 20 | 104 to 9 | 3.04 to 4.19 M | 23.5 to 22.2 |
| Bridge | 524 to 342 | 182 | 131 to 20 | 80 to 9 | 1.27 to 1.98 M | 20.2 to 21.8 |

What it cost, and what it did not do:
- **Triangles went up, 0.05 to 1.42 M a frame.** A batch has no one bounding sphere, so it is not
  frustum-culled: every tree of a tier is drawn, where the per-cell meshes dropped the cells behind
  the camera. Scene-pass vegetation went from 0.11-1.32 M to 0.39-2.31 M. This section's own
  measurement says triangles cost nothing on the 3070 Ti; a phone or a mid-range GPU has not been
  asked. If it matters there, split each mid-tier batch into four or eight sectors around the camera
  so three's culling drops the ones behind it (about 10 more draws).
- **Shadow triangles did not fall.** This section used to promise 1.3 M fewer. The shadow pass's
  triangles were near-tier trees all along (0.09-1.44 M before, 0.10-1.61 M after): the far cells
  the 300 m box touched added draws, 17 to 108 of them, and almost no triangles. The draws are gone.
- **Geometry memory** is 21.1 to 22.2 MB where it was 18.9 to 23.5 MB. The old meshes were built as
  the camera first reached a cell, so the old figure climbs through the run; a batch grows in steps
  of half again, so the new one starts higher (by 2 to 13 % in the first five views) and ends lower.
  Texture memory is 127.1 MB before and after.
- **The picture.** Captures of all nine views before and after, from a page that never runs its own
  frame loop and has a seeded `Math.random`, so two runs of the same code are identical to the
  byte: three views (pad, heads, bridge) are still identical to the byte, and the worst is the
  mountain, 63 of 518,400 pixels changed and none by more than 9 of 255. At the threshold the check
  uses (a channel more than 8 of 255 away) the worst is the windmills, 2 pixels.
- **The shadows that did change.** Vegetation past the near tier (260 m; 160 m at quality low) casts
  none. `test/draws.mjs` counts the instances that stand inside the sun's shadow box and no longer
  cast: 0 in five views, 4, 4 and 6 in three, and 67 from above the mountain, where the box reaches
  far down the slope. Every one is at least 260 m from the camera. The replay camera on the results
  screen can sit that far from the aircraft; nobody has looked at a replay for it.

### Cut 2, shipped 2026-10-07: copies of a GLB are herds, flags one mesh a place (`HISTORY.md` #931)

This section used to call it "small static meshes merged per material". There was nothing to merge:
every GLB primitive has a material of its own (a sailing boat is six), and what is static was one
mesh per material already. What was costing draws was copies: seven sailing boats were 42 draws.
`src/world/herd.js` draws the copies of one GLB as one InstancedMesh per primitive: 7 sailing boats,
3 motor boats, 6 balloons, 4 windmills and the 11 cabins (instanced before, but drawn whole wherever
any cabin's sphere reached). The copies stay in the scene graph, hidden, and are still what the
boats' holders and the windmills' blade pivots move; before each render the herd packs their world
matrices. It culls per copy with three's own test, so nothing that was culled is drawn: a copy's
primitive is packed when its bounding sphere meets the camera's frustum or the sun's shadow box, and
the herd casts only while one is in the box. The 21 flags and windsocks are 7 meshes, one a place.

| View | Draws | Saved | Statics, scene | Statics, shadow | Triangles |
| --- | --- | --- | --- | --- | --- |
| Pad | 337 to 316 | 21 | 84 to 71 | 29 to 21 | -3,860 |
| Castle | 291 to 260 | 31 | 79 to 56 | 20 to 12 | -4,936 |
| Heads | 246 to 240 | 6 | 43 to 37 | 21 to 21 | -4,224 |
| Lighthouse | 595 to 493 | 102 | 258 to 156 | 6 to 6 | 0 |
| Mountain | 303 to 272 | 31 | 79 to 55 | 19 to 12 | -5,256 |
| Windmills | 451 to 384 | 67 | 155 to 95 | 34 to 27 | -1,280 |
| Cabins | 467 to 403 | 64 | 174 to 110 | 18 to 18 | -1,344 |
| Runway | 464 to 381 | 83 | 170 to 97 | 27 to 17 | -2,784 |
| Bridge | 342 to 297 | 45 | 97 to 59 | 12 to 5 | -5,256 |

- **Triangles fell**, by up to 5,256 a frame: the cabins are no longer drawn where none is in view.
- **Geometry memory** rose 0.02 MB (the instance matrices): 21.10-22.24 MB to 21.12-22.26 MB.
- **The picture.** Castle, mountain and bridge are identical to the byte. The worst is the windmills
  view: 759 of 518,400 pixels changed at all and 63 by more than 8 of 255 (most one channel moved, 56),
  every one of them on the two windmills, which is 11 pixels over the 0.01 % `--compare` allows by
  default. Zoomed crops show the same windmill: the changes are speckle in the masonry pattern and a
  row of pixels at a shadow's edge. The masonry shader works its brick joints out from the screen
  derivative of a world position near 500 m, so the last bit of a float moves a joint, and an
  instanced vertex reaches the screen by a different product of the same matrices. Pad 132 changed
  (6 over the threshold), heads 8 (3), lighthouse 69 (9), cabins 116 (22), runway 323 (41).
- **Not looked at by a person** on a real GPU, and not in motion: blades turning, boats under way.

### Cut 3, shipped 2026-10-07: far terrain is one mesh a square (`HISTORY.md` #932)

The terrain is 16x16 chunks at four levels of detail and was a mesh per chunk. The chunks of one
1 km square (4x4) that are at LOD 2 or 3 (280 or 90 triangles each) are one mesh now, rebuilt on the
update in which one of them changes tier; a chunk at LOD 0 or 1 is still its own mesh. A square
casts shadows only while the sun's shadow box reaches one of its merged chunks, tested per chunk.

| View | Draws | Saved | Terrain, scene | Terrain, shadow | Triangles | Geometry MB |
| --- | --- | --- | --- | --- | --- | --- |
| Pad | 316 to 264 | 52 | 80 to 28 | 10 to 10 | +5,010 | 21.15 to 22.31 |
| Castle | 260 to 216 | 44 | 71 to 27 | 10 to 10 | +5,010 | 21.99 to 23.21 |
| Heads | 240 to 204 | 36 | 60 to 24 | 11 to 11 | +2,680 | 21.12 to 22.20 |
| Lighthouse | 493 to 352 | 141 | 181 to 40 | 10 to 10 | +3,690 | 21.33 to 22.29 |
| Mountain | 272 to 222 | 50 | 82 to 32 | 14 to 14 | +4,460 | 21.93 to 23.18 |
| Windmills | 384 to 291 | 93 | 127 to 34 | 10 to 10 | +3,150 | 22.14 to 23.28 |
| Cabins | 403 to 299 | 104 | 142 to 38 | 11 to 11 | +5,400 | 22.08 to 23.15 |
| Runway | 381 to 285 | 96 | 132 to 36 | 10 to 10 | +6,150 | 22.26 to 23.41 |
| Bridge | 297 to 220 | 77 | 112 to 35 | 10 to 10 | +2,870 | 21.80 to 22.78 |

- **Triangles rose by 2,680 to 6,150 a frame** (0.1 to 0.4 % of a frame): a square is culled as one
  box, so the far chunks of a square half in view are all drawn. Against 36 to 141 draws.
- **Geometry memory rose 0.96 to 1.25 MB.** The figure counts the arrays the page holds: each far
  chunk's own geometry is kept as the source its square is copied from. On the GPU the merged copy
  stands where the chunk's own buffer did, since a hidden chunk's far geometry is never uploaded.
- **The picture.** Against cut 2's captures: pad and castle identical to the byte; the most pixels
  changed at all is 103 of 518,400 (lighthouse), none of them by more than 8 of 255; the most over
  that threshold is 4 (runway), 1 over the bridge, most one channel moved 16. The triangles are the
  same triangles: what moves is which of two coincident skirts wins where chunks meet.
- A square's 16 chunks are at most 2,640 vertices, so its index stays 16-bit.

### What is left

Nothing of the three. Smaller, from the lighthouse view's 156 static draws, none started:
- **Chimney smoke: 44 sprites, a material each, a draw each** wherever the cabins are in the frustum
  at any distance (45 of the lighthouse view's draws with the lamp's glow). One instanced quad per
  cabin cluster would be 4. It is transparent, so the order it is drawn in against the sea and the
  boats' wakes has to be kept: that wants a person's eye on the result, not a pixel count.
- **Wakes and burner flames, 18**: one geometry and one material each kind, transparent, same caution.
- **The seven cars on the bridge** (a geometry each, one material) and the 6 pad and landing decals.
- `lighthouse.glb` is 10 draws and `castle.glb` 7, one copy each: fewer means baking their materials
  into one, which is a change to the models and the masonry shader, not to the scene.
- If the triangles of cut 1 matter on a weaker card: sectors for the mid-tier vegetation batches.

**The measurement of 2026-10-03, before any cut.**

Measured on 2026-10-03 on Devon's Windows machine: an RTX 3070 Ti through Chrome's ANGLE on D3D11,
Rotor Rally at quality high, by `node tools/gpu-profile.mjs` (it reports the WebGL renderer string and
refuses to report if that string is software). Means over 8 s windows with the frame-rate limit off,
so the interval is a frame's real cost and not the monitor's refresh. Draws and triangles are one
displayed frame over every pass: shadow, scene and 18 post draws.

| View, 1280x720 | Interval mean / p99 | Draws | Triangles |
| --- | --- | --- | --- |
| Start, on the gyro pad | 4.7 / 6.4 ms | 542 | 2.92 M |
| Mid-flight, autopilot, first 16 s | 5.8-6.0 / 8.0-8.4 ms | 651-660 | 2.77-2.93 M |
| Over the runway (most triangles) | 6.0 / 8.0 ms | 748 | 3.04 M |
| Over the cabins | 6.0 / 7.9 ms | 743 | 2.99 M |
| Over the lighthouse | 5.7-6.2 / 7.4-9.8 ms | 743 | 0.87 M |
| Over the carved heads (fewest draws) | 4.3 / 5.7 ms | 413 | 1.13 M |

The castle, mountain, windmills and bridge sit in between; `HISTORY.md`'s log entry for this has all
nine views. With vsync on, every view holds 8.0 ms with a p99 of 8.1 ms. The one hitch is 48 to 120 ms
in the first frames after a mission starts.

**What the frame costs.** Fitted across the nine views in each of two runs, frame time = 2.1 to
2.2 ms + 4.7 to 5.8 µs per draw call. Triangles add nothing measurable: their coefficient came out
at +0.003 and at -0.15 ms per million. No residual is above 0.11 ms. The lighthouse view draws 0.87 M
triangles and costs what the runway's 3.04 M does, because both are about 745 draws. At 2560x1440
(four times the pixels) the runway costs 6.1 ms against 6.0, so fill does not matter here either.
CPU time inside `game.update` + `sw.render` (5.5 ms over the runway) is nearly the whole interval, and
the GPU timer query reads the same. On this machine the game is bound by draw-call submission. The
adaptive pixel ratio never moved off 1, because the frame never came near its 22 ms trigger.

**Where the draws go**, over the runway: shadow pass 168 draws and 1.50 M triangles, scene 583
draws and 1.53 M triangles, post 18.
- `landmarks/vegetation`: 206 scene draws and 104 shadow draws, and 1.42 M of the shadow pass's
  1.50 M triangles. The sun's shadow camera is a 300 m box, but trees are instanced per 320 m cell
  (`vegetation.js` `CELL`). Any cell the box touches draws every tree it holds into the 4096 map.
- `terrain`: 132 scene draws for 101 k triangles, about 770 a draw (181 draws over the lighthouse).
- Small static meshes: `landmarks/props` 89, `landmarks/Mesh` 24, `landmarks/Sprite` 16, the windmill
  GLB 20, and scene-level groups 47. That is about 200 draws for under 40 k triangles.

**The two cuts as this section proposed them after cut 1** (both made since, above; kept for what
they got wrong: cut 2 found nothing to merge per material). Counts are after cut 1.
2. **Small static meshes merged per material.** `statics` is 43 to 258 scene draws and 6 to 34
   shadow draws (258 over the lighthouse: `landmarks/props` 100, `Sprite` 45, the windmill GLB 40,
   loose `Mesh` 39, the lighthouse GLB 10). `vendor/addons/utils/BufferGeometryUtils.js` is already
   vendored. What it needs first is a list, object by object, of what never moves: `props.js` is
   mostly things that do (boats that rock and take a GLB swap, balloons, birds, wakes), and the
   swap hosts in `landmarks.js` hide their fallbacks by walking `host.children`, which `test/checks.js`
   reads for the heads (#895). Merge inside a host, never across one. The sprites are a separate
   job: one Points or one instanced quad.
3. **Fewer terrain draws.** `terrain` is 60 to 181 scene draws for 74 to 107 k triangles, one Mesh
   per chunk whatever its LOD (`terrain.js`). Merge the chunks at the farthest LOD into a few larger
   meshes, rebuilt when a chunk changes tier. Terrain's shadow draws are already 10 to 14.

Any further cut moves `test/draws.json`: record it again with `node test/draws.mjs --write` in the
same commit, and compare captures with `--shots` before and `--compare` after.

Not worth cutting on this evidence: triangles, render resolution, and texture size (127 MB, none over
2048 px).

**The old SwiftShader numbers.** "520 draws, 1.72 M triangles" came from `?perf=1`'s one log 6 s
after page load. Under the same profiler, SwiftShader gave 458 draws and 2.54 M triangles on the
pad, against the GPU's 542 and 2.92 M; `test/draws.mjs`, which steps game time instead of waiting
on frames, counted 527 and 2.90 M there before cut 1. A frame takes 1 to 80 s there, so vegetation and grass, which
stream in on game time, are still filling. Draws and triangles come from the scene, not the renderer;
the frame-time conclusions above are the GPU's alone. `perfReport` now finds 148 shader programs,
not 71, after a run that has visited every landmark (not traced further).

## 2. Touch and gamepad on real devices (needs a phone and a pad)

Both are covered by the suite through synthetic events (a mocked `navigator.getGamepads`, and
PointerEvents on the on-screen stick and buttons). Nobody has held a phone or a controller yet: stick
size, thumb reach and trigger feel are the open questions.
