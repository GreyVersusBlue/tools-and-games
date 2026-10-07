# SkyWings 64 — wishlist

A Pilotwings 64-style flight game in three.js r160: hang glider, gyrocopter and rocket belt, six
scored missions and Free Flight over one island. `CONTRACT.md` has the module interfaces, URL
parameters and the `window.__qa` test hook. `node test/browser.mjs` is the suite (77 checks, about a
minute and a half, Tools/board-check's harness); its first 35 are `test/assets.mjs`, which reads
`assets/models/` in Node alone and can be run by itself, and its last 3 hold a frame's draw calls to
`test/draws.json` from the first three of `test/draws.mjs`'s nine views (`node test/draws.mjs` runs
all nine, about three minutes).

Both items below are open. Item 1 was measured on a real GPU on 2026-10-03 and the first of its three
cuts shipped on 2026-10-07, counted in draws and not yet timed; nothing else here has
been seen on a real GPU, and that includes the carved heads, rebuilt on 2026-10-05 and judged from Blender
renders and SwiftShader captures (`screenshots/heads_near.jpg`, `heads_far.jpg`; `HISTORY.md` #895).
The glider's landing is not here any more: Devon flew it by hand on 2026-10-03, it works, and no
tuning was asked for.

## 1. Draw-call cuts (one of three made; measured on a real GPU before, not after)

**Devon: re-run `tools/gpu-profile.mjs` on the Windows GPU to see the milliseconds.** Cut 1 below
took 116 to 281 draws out of a frame, counted under software GL. At the 4.7 to 5.8 µs a draw this
section measured, that would be 0.5 to 1.6 ms, but nothing here has timed it, and the cut also draws
more triangles (below), which cost nothing on the 3070 Ti and have not been tried anywhere slower.

### Cut 1, shipped 2026-10-07: vegetation batched, only the near tier casts (`HISTORY.md` #930)

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

### Cuts 2 and 3, not made

Neither was started: cut 2 could not be made whole in the session that made cut 1.

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

**The two cuts left, in order**, each priced at 4.7 to 5.8 µs a draw. Counts are after cut 1, from
`test/draws.json`; `node test/draws.mjs` prints the owners behind each bucket.
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

Both would move `test/draws.json`: record it again with `node test/draws.mjs --write` in the same
commit, and compare captures with `--shots` before and `--compare` after.

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
