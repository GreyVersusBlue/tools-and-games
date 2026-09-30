# SkyWings 64 — wishlist

A Pilotwings 64-style flight game in three.js r160: hang glider, gyrocopter and rocket belt, six
scored missions and Free Flight over one island. `CONTRACT.md` has the module interfaces, URL
parameters and the `window.__qa` test hook. `node test/browser.mjs` is the suite (37 checks, about a
minute, Tools/board-check's harness).

Everything below is open. Nothing here has been seen on a real GPU.

## 1. The glider floats on landing (needs a person)

The suite's autopilot lands the belt and gyrocopter within 3 m of the pad centre. The glider landed
22 m out in early builds and 50 to 95 m out after the air brake and GLB swap, against a 42 m pad.
The final-approach log shows why: with the brake held it still sinks only 3 to 4 m/s at 16 m/s, and
ridge lift below 10 m carries it on (one run climbed from 4.3 m to 7.1 m with no input). Whether a
person finds Sunrise Glide's pad too hard is the question; a hand playtest decides it before any
tuning. Levers if it is: `CDx` and the lift dump in `hangGlider.js` (the air brake), the ridge-lift
band in `world/index.js` `liftAt`, or the pad radius in `terrain.js` `LAYOUT.landing`.

## 2. Real-GPU profiling (needs a GPU)

`?perf=1` logs a whole-frame report. Under SwiftShader in Rotor Rally at 1280x720, high quality:
520 draw calls, 1.72 M triangles (shadow and depth passes included), 71 shader programs over 241
materials, about 127 MB of textures, none over 2048 px. Terrain chunks have 4 LODs and vegetation 3
tiers of instancing already; the landing pad's 65 rim lights became two InstancedMeshes. The
triangle count is the number to watch on a mid-range GPU; the adaptive pixel ratio in
`render/index.js` is the first thing to see working.

## 3. The carved heads model

`assets/models/heads.glb` is a pale slab with four small faces; the procedural fallback
(`?models=0`) reads better. Rebuild `tools/blender/world_heads.py` with the faces filling the cliff,
or drop the swap in `landmarks.js` and keep the procedural one.

## 4. Touch and gamepad on real devices (needs a phone and a pad)

Both are covered by the suite through synthetic events (a mocked `navigator.getGamepads`, and
PointerEvents on the on-screen stick and buttons). Nobody has held a phone or a controller yet: stick
size, thumb reach and trigger feel are the open questions.
