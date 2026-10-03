# SkyWings 64 — wishlist

A Pilotwings 64-style flight game in three.js r160: hang glider, gyrocopter and rocket belt, six
scored missions and Free Flight over one island. `CONTRACT.md` has the module interfaces, URL
parameters and the `window.__qa` test hook. `node test/browser.mjs` is the suite (37 checks, about a
minute, Tools/board-check's harness).

Everything below is open. Item 2 was measured on a real GPU on 2026-10-03; the rest has not been seen on one.

## 1. The glider floats on landing (needs a person)

The suite's autopilot lands the belt and gyrocopter within 3 m of the pad centre. The glider landed
22 m out in early builds and 50 to 95 m out after the air brake and GLB swap, against a 42 m pad.
The final-approach log shows why: with the brake held it still sinks only 3 to 4 m/s at 16 m/s, and
ridge lift below 10 m carries it on (one run climbed from 4.3 m to 7.1 m with no input). Whether a
person finds Sunrise Glide's pad too hard is the question; a hand playtest decides it before any
tuning. Levers if it is: `CDx` and the lift dump in `hangGlider.js` (the air brake), the ridge-lift
band in `world/index.js` `liftAt`, or the pad radius in `terrain.js` `LAYOUT.landing`.

## 2. Draw-call cuts (measured on a real GPU, not yet tuned)

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

**The three cuts, in order**, each priced at 4.7 to 5.8 µs a draw. None has been tried.
1. **Vegetation batching and shadows**, about 1.0 to 1.8 ms. Draw each type and tier as one
   InstancedMesh across all visible cells, rebuilt on the existing 0.12 s LOD tick, instead of one per
   cell. Let only the near tier cast shadows. That removes most of 220 to 315 draws and about 1.3 M
   shadow triangles, which is free here but is the number the old SwiftShader note said to watch on a
   mid-range GPU.
2. **Small static meshes merged per material**, about 0.7 to 1.2 ms. Merge the props, loose landmark
   meshes and windmill parts that never move with
   `BufferGeometryUtils.mergeGeometries` (one more r160 addon file to vendor, #724). Anything that
   animates, such as the windmill sails, stays separate.
3. **Fewer terrain draws**, about 0.4 to 1.0 ms. That is 80 to 181 scene draws for about 100 k
   triangles. Merge the far LOD rings into larger chunks. Terrain's shadow draws are already only 10.

Not worth cutting on this evidence: triangles, render resolution, and texture size (127 MB, none over
2048 px).

**The old SwiftShader numbers.** "520 draws, 1.72 M triangles" came from `?perf=1`'s one log 6 s
after page load. Under the same profiler, SwiftShader gives 458 draws and 2.54 M triangles on the
pad, against the GPU's 542 and 2.92 M. A frame takes 1 to 80 s there, so vegetation and grass, which
stream in on game time, are still filling. Draws and triangles come from the scene, not the renderer;
the frame-time conclusions above are the GPU's alone. `perfReport` now finds 148 shader programs,
not 71, after a run that has visited every landmark (not traced further).

## 3. The carved heads model

`assets/models/heads.glb` is a pale slab with four small faces; the procedural fallback
(`?models=0`) reads better. Rebuild `tools/blender/world_heads.py` with the faces filling the cliff,
or drop the swap in `landmarks.js` and keep the procedural one.

## 4. Touch and gamepad on real devices (needs a phone and a pad)

Both are covered by the suite through synthetic events (a mocked `navigator.getGamepads`, and
PointerEvents on the on-screen stick and buttons). Nobody has held a phone or a controller yet: stick
size, thumb reach and trigger feel are the open questions.
