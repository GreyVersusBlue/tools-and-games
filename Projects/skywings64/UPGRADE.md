# SkyWings 64 — AAA fidelity upgrade brief (wave 2)

> Historical: the brief the second build wave worked from, before the game moved into tools-and-games.
> Ports, agent names and ownership below are from that build. Current state: CONTRACT.md and WISHLIST.md.

Read CONTRACT.md first (interfaces still hold; you may ADD members but not break existing ones).
Goal: take the working low-poly prototype to a stunning, modern, high-fidelity look and feel — think a polished
PBR game, still with Pilotwings' cheerful arcade spirit. Performance target: smooth 60fps on a mid-range GPU
(use instancing, merged geometry, LOD, texture atlases; provide quality tiers via `window.SW_QUALITY` = 'low'|'medium'|'high',
default 'high'; read it, never write it).

## Available local assets (no internet needed at runtime; vendored)
- Three.js r160 + ALL addons: `import { X } from 'three/addons/<path>.js'` (maps to vendor/addons/, e.g. postprocessing/EffectComposer.js,
  UnrealBloomPass, SMAAPass, OutputPass, ShaderPass, objects/Sky.js, objects/Water.js, loaders/GLTFLoader.js, RGBELoader.js,
  utils/BufferGeometryUtils.js, math/ImprovedNoise.js, geometries/, lights/, etc.)
- assets/tex/: Poly Haven CC0 1k PBR (Diffuse + nor_gl normal maps): aerial_grass_rock, rocky_terrain_02, aerial_beach_01,
  snow_field_aerial, coast_sand_rocks_02, forest_leaves_02.
- assets/hdr/: kloofendal_48d_partly_cloudy_puresky_1k.hdr, qwantani_moonrise_puresky_1k.hdr, kiara_1_dawn_1k.hdr (RGBELoader).
- assets/models/ (empty; you may download more CC0 assets from the web with curl/python — Poly Haven API
  https://api.polyhaven.com/files/<id>, Khronos glTF sample assets on raw.githubusercontent.com, Kenney.nl, quaternius etc.
  Save into assets/ and note the license in assets/LICENSES.md (append a line; do not overwrite others' lines).
- Network works from the shell. No Node/npm. Python3 available. Google Chrome exists.

## Testing recipe (REQUIRED — actually run the game and LOOK at screenshots; iterate until it looks great)
Use your OWN port to avoid clashing with other agents (pick one: terrain 8201, sky 8202, render 8203, vehicles 8204, ui 8205, fx 8206):
```
cd /home/devon/projects/tools-and-games/Projects/skywings64 && (python3 -m http.server PORT >/dev/null 2>&1 &)
google-chrome --headless=new --no-sandbox --disable-gpu --use-gl=swiftshader --enable-unsafe-swiftshader \
  --enable-logging=stderr --v=0 --virtual-time-budget=9000 --window-size=1280,720 \
  --screenshot=/tmp/YOURNAME.png http://localhost:PORT/YOURPAGE.html 2>&1 | grep -E "PAGEERR|Uncaught|TypeError|SyntaxError|Failed"
```
then Read the PNG. Software GL is SLOW (a few fps), so keep the virtual-time budget modest (9000–16000) and use window sizes <=1280x720.
Create private test pages named `test_<yourname>.html` (copy index.html, append a script; delete them when done). You can dispatch
synthetic KeyboardEvents on `window` to click through menus (Enter ×4 reaches flight; Space launches — hold keydown with a delay before keyup,
because input polls per frame). Add a URL-param hook if useful, e.g. `?mission=2&vehicle=gyro&autostart=1` handled in your own files only if you own main.js/game.js; otherwise ask via your report.
Also load-time errors: check for `PAGEERR`/uncaught errors in the log by adding a window 'error' listener that console.log's "PAGEERR ...".
A broken build is the worst outcome: before finishing, run the plain index.html once and confirm zero errors and the title screen still renders.

## Ownership (wave 2). Edit ONLY your files. If you need a change elsewhere, do the minimum via a documented hook and say so in your report.
- T Terrain:    src/world/terrain.js, src/world/water.js, src/world/index.js (owner of index.js; keep the world API + all landmark/pad positions stable)
- S Sky/Atmos:  src/world/sky.js, src/world/landmarks.js, NEW src/world/vegetation.js, NEW src/world/atmosphere.js
- R Render:     NEW src/render/*, and the renderer/composer/lighting/shadow/tonemapping parts of src/main.js (touch nothing else in main.js)
- V Vehicles:   src/vehicles/*
- U UI/Camera:  src/core/*, src/game/ui.js, index.html (CSS/markup only), src/game/scoring.js. Fonts: download a free display font (e.g. Google Fonts woff2 via css2 API with a browser UA) into assets/fonts and @font-face it.
- F FX/Audio:   src/fx/*
Nobody edits src/game/game.js or src/game/missions.js in this wave (QA agent does later).

Lighting/handshake conventions (R owns them): world adds NOTHING global except through R's hooks: `renderer.__sw = { sun, setSun(dir), envMap, composer }`
is set by R. T/S should keep using the lights/fog/background the current createWorld sets *unless* R exposes replacement hooks — in that case
S/T check `scene.userData.swRender` (may be undefined) and cooperate: if `scene.userData.swRender?.handlesLighting` is true, S skips creating its own sun/hemi lights and fog and instead reads `scene.userData.swRender.sunDirection`.
R sets `scene.userData.swRender = { handlesLighting:true, sunDirection:Vector3, sun:DirectionalLight, ... }` BEFORE createWorld is called.
Finish with a report under 150 words: what changed, new APIs, perf notes, known issues.
