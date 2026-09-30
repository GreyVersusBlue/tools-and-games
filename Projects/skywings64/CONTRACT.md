# SkyWings 64 — architecture contract (Pilotwings 64 style flight game, Three.js r160)

No build step. Plain ES modules. `import * as THREE from 'three'` (import map -> vendor/three.module.js).
Lives in tools-and-games at `Projects/skywings64/` (the repo root is served whole; open `/Projects/skywings64/`).
`three/addons/` maps to vendor/addons/, which holds ONLY the files the game imports (HISTORY.md #721): a new
addon import means copying that one file from three.js r160. Zero offsite requests: textures, HDRs, fonts and
GLBs are all under assets/. Suite: `node test/browser.mjs` from this folder (needs `npm install` in Tools/board-check).
Open work: WISHLIST.md. The file-ownership lists below are from the original multi-agent build and are historical.
Style: N64-era chunky low-poly + vertex-colour/flat shading, bright saturated colours, fog, big readable HUD.
World units = metres. Y is up. Island world roughly 4000x4000 centred at origin.

## File ownership (only edit your own files)
- A World:    src/world/terrain.js, src/world/sky.js, src/world/water.js, src/world/landmarks.js, src/world/index.js
- B Vehicles: src/vehicles/*.js  (hangGlider.js, gyrocopter.js, rocketBelt.js, index.js)
- C Core:     src/core/input.js, src/core/camera.js, src/core/hud.js, src/core/loop.js
- D Game:     src/main.js, index.html, src/game/*.js (missions, scoring, menus, state machine), styles in index.html
- E FX/Audio: src/fx/audio.js, src/fx/particles.js, src/fx/effects.js

## Interfaces (exact names/signatures)

### A: src/world/index.js
```js
export function createWorld(scene) -> world
world.update(dt, elapsed, cameraPosition)   // animate water/clouds/sky follow camera
world.heightAt(x, z) -> number              // terrain height (metres, water level = 0)
world.surfaceAt(x, z) -> 'water'|'sand'|'grass'|'rock'|'snow'|'pad'
world.liftAt(x, y, z) -> number             // thermal/updraft m/s (>0 rises) for hang glider; strong over sunbaked ground/marked thermal spots
world.windAt(x, y, z) -> THREE.Vector3      // gentle wind (may return shared vector)
world.pads = { hangGlider:{position:Vector3,heading:rad}, gyrocopter:{...}, rocketBelt:{...} }  // launch spots (position on ground)
world.landingZones = { hangGlider:{position,radius}, gyrocopter:{...}, rocketBelt:{...} }
world.thermals = [{position:Vector3 (ground xz), radius, strength}]
world.setTimeOfDay?(t01)  // optional
```
Landmarks: lighthouse, windmills, a castle/mountain peak, a big statue (Mt-Rushmore-like heads), cabins, bridges, canyon, ring-friendly open valleys.
Terrain: chunked heightfield mesh (e.g. 160x160 segments, vertex colours by height/slope), sea plane, sky dome gradient + sun, drifting clouds, fog.

### B: src/vehicles/index.js
```js
export const VEHICLES = { hangGlider: VehicleClass, gyrocopter: VehicleClass, rocketBelt: VehicleClass }
```
Every vehicle class:
```js
new Vehicle(world)            // builds this.mesh (THREE.Group, +Z forward? NO: forward is -Z, up +Y)
v.mesh                        // add to scene by caller
v.position (Vector3), v.velocity (Vector3), v.quaternion via mesh.quaternion
v.reset(position:Vector3, heading:number)   // place at pad; state 'grounded' or 'flying' (hangGlider launches by running/falling off; gyro takes off with throttle; belt with thrust)
v.update(dt, input, world)    // input = C's InputState (below). Physics: lift/drag/gravity/thermals for glider, rotor thrust/pitch/roll for gyro, fuel-limited thrusters for belt
v.state                       // 'grounded'|'flying'|'landed'|'crashed'|'splashed'
v.speed (m/s), v.altitude (m above terrain), v.agl, v.heading (rad)
v.fuel (0..1, belt only, else 1)
v.throttle (0..1)
v.getCameraRig() -> { target:Vector3, chaseDistance, height, fov }  // for camera to follow
v.getMuzzles?() -> [Vector3]  // gyro only, optional (for gyro missile/ball drop)
v.events                      // array of strings consumed & cleared by game each frame: 'liftoff','touchdown','crash','splash','stall','thermal','boost'
v.landingQuality             // set at touchdown: {speed, verticalSpeed, tiltDeg, ok:boolean}
```
Animate parts (glider sails flex, rotor spins, belt flames + kicked legs of a pilot figure). Pilot figure with helmet.

### C: src/core/*
```js
// input.js
export class InputState {  // keyboard + gamepad + (touch optional)
  pitch,roll,yaw  // -1..1  (pitch + = nose down / stick forward)
  throttle        // 0..1 accumulating (Shift/Ctrl or W/S for gyro & belt), boost bool
  brake, action(bool, e.g. Space/A: launch / bomb drop), action2(bool), camToggle(bool edge), pause(bool edge)
  update(dt)      // call once per frame; clears edges after read via .consumeEdges()
}
export function createInput(domElement) -> InputState
// camera.js
export class ChaseCamera { constructor(camera); setRig(rig); update(dt, vehicle, world); snap(); toggleMode() }  // chase/cockpit-ish/far; collides with terrain via world.heightAt
// hud.js  (DOM overlay, no canvas dependency on others)
export class HUD { constructor(rootEl); show(bool); update({speed, altitude, heading, fuel, throttle, vspeed, state, timer, score, objective, message, ringsHit, ringsTotal}); flash(text, ms); showResults(data); minimap? (createMinimap(world)) }
// loop.js
export class GameLoop { constructor(updateFn(dt,elapsed), renderFn()) ; start(); stop() }  // fixed-step clamp dt<=1/20
```
HUD: altimeter, airspeed, heading compass strip, vertical-speed, fuel bar, throttle, target arrow pointing at next objective (`hud.setTargetBearing(rad, distance)`), N64-esque bold font, drop shadows.

### D: src/main.js, src/game/*
```js
// game/missions.js
export const MISSIONS = [ {id, name, vehicle:'hangGlider', description, timeLimit, build(world, scene) -> {rings:[Vector3+radius+normal], targets:[], update(dt,vehicle)->events}, ...}, ... ]
// game/scoring.js  -> medals Bronze/Silver/Gold + points; letter grade; landing bonus; time bonus; ring bonus
// game/game.js     -> state machine: TITLE -> MISSION_SELECT (vehicle/mission cards) -> BRIEFING -> FLIGHT -> RESULTS ; pause; retry; bonus level "birdman"/ "cannon" optional
```
Required missions (>= 6): Hang glider I (rings + landing zone), Hang glider II (thermal climb to peak, land), Gyrocopter I (fly through rings, land on pad), Gyrocopter II (destroy/hit ground targets with bombs/missiles w/ action), Rocket belt I (hop through hovering rings, land on platforms with limited fuel), Rocket belt II (lighthouse/tower course), plus free-flight sandbox "Holiday Island" with no timer. Persist best scores in localStorage.

### E: src/fx/*
```js
// audio.js
export class AudioManager { constructor(); resume() /*on user gesture*/; startEngine(kind:'wind'|'rotor'|'rocket'); setEngine({speed, throttle, kind}); playSfx(name:'ring'|'crash'|'splash'|'touchdown'|'boost'|'menu'|'select'|'countdown'|'go'|'medal'|'bomb'|'explosion'|'stall'|'thermal'); startMusic(name:'title'|'flight'|'results'); stopMusic() }  // 100% WebAudio synthesis, a catchy procedural chiptune-ish/orchestral-lite melody loop
// particles.js
export class ParticleSystem { constructor(scene); emit(type:'smoke'|'fire'|'splash'|'dust'|'spark'|'confetti'|'debris', position, opts); update(dt) }  // pooled Points/Sprite-based
// effects.js
export class Effects { constructor(scene, particles); explosion(pos); splash(pos); dustPuff(pos); ringPass(pos); windStreaks(vehicle, camera); update(dt); confetti(pos) } 
export function createRing(radius, colorHex) -> THREE.Group  // glowing torus with animated pulse: group.userData.update(dt), .userData.setActive(bool), .userData.collect()
export function createTargetMarker / createLandingPadMesh(radius) -> Group
```

## Integration rules
- main.js wires everything: creates renderer (antialias, pixel ratio cap 2, sRGB output, shadow map optional), scene, world, input, camera, HUD, audio, particles, effects, game.
- Each module must be robust to missing optional pieces (`?.`), never throw during frame update.
- Each agent: after writing, self-test syntax with `python3` is impossible for JS, so re-read carefully; verify imports exist and export names match this contract exactly. Keep files < ~900 lines each; split if bigger.

## Wave 3 additions (QA / hero assets / polish)
### URL parameters (all optional, none persisted)
- `?mission=<id|index>` open that mission's briefing; add `&autostart=1` to skip menus + countdown straight into FLIGHT;
  `&vehicle=hangGlider|gyrocopter|rocketBelt` picks the Free Flight aircraft.
- `?quality=low|medium|high` overrides the saved quality tier for this load. `?models=0` forces procedural fallbacks.
- `?unlock=1` unlocks every mission. `?touch=1|0` forces on-screen touch controls on/off. `?perf=1` logs a `PERF {...}` report.
### Test hook: `window.__qa` (src/game/game.js) — note `window.__sw` belongs to the render system
- `start(id, vehicle?)` -> enters FLIGHT immediately; `sim(seconds, ctrl(input, game, dt), {dt, until})` steps the whole game
  synchronously without rendering (ctrl writes pitch/roll/yaw/throttle/action after keyboard/gamepad polling); `info()` summary.
### Modules
- `src/core/models.js`: `loadModel(name)` (clone or null, never throws), `swapIn(host, name, {fitHeight|fitSize, keep, onLoad})`,
  `fitModel`, `preloadModels`, `onModelProgress(cb)`, `allModelsSettled()`. GLBs live in assets/models/, built by tools/blender/*.py
  (baked AO -> occlusionTexture). The loader converts material colours sRGB->linear (the scripts author sRGB values).
- `src/game/progress.js`: medal unlocks (`REQUIRES = {hg2:'hg1', gc2:'gc1', rb2:'rb1'}`), `isUnlocked`, `lockedSet`, `newlyUnlocked`.
- `src/game/hints.js`: `FlightHints` first-flight tutorial (per vehicle, localStorage `skywings64.tutorial.v1`) + contextual hints.
- `src/game/replay.js`: `FlightRecorder` (20 Hz, last 40 s) + `ReplayDirector` cinematic camera used on the RESULTS screen.
- `src/core/touch.js`: `TouchControls(input)` virtual stick + buttons -> `input.setTouch()`; shown only in FLIGHT.
- `src/render/perf.js`: `perfReport(renderer, scene)` draw calls / tris / programs / texture MB / instancing candidates.
### Mission fields
- `fuelBurn` (rocket belt fuel multiplier, applied to `vehicle.fuelBurnScale` after reset).
- Powered craft may land off-pad and relaunch while they have fuel; the glider's first landing ends the run.
