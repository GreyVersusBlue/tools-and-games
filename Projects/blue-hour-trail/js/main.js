import * as THREE from 'three';
import { TRAIL, LAYOUT, creekInfo } from './field.js';
import { buildTerrain } from './terrain.js';
import { buildForest } from './forest.js';
import { buildProps } from './props.js';
import { buildCreek } from './creek.js';
import { buildAtmosphere } from './atmosphere.js';
import { buildWildlife } from './wildlife.js';
import { createDread } from './dread.js';
import { WalkControls } from './controls.js';
import { Soundscape } from './audio.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x8da0aa, 0.026);
// No sky at all: the fog IS the sky here. One colour object shared between
// background and fog keeps them locked — a horizon seam between "fog colour"
// and "sky colour" is the single fastest way to break a fog piece.
scene.background = scene.fog.color;

// far = 220, not the 2500 the beach used: at this fog density nothing past
// ~120 m survives anyway, and every metre of far plane not spent is depth
// precision kept.
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 220);

// ---------- Lighting ----------
const dayLight = new THREE.DirectionalLight(0xb8c8d0, 0.55);
dayLight.position.set(-120, 180, 60);
scene.add(dayLight);

const skyFill = new THREE.HemisphereLight(0xa8bcc4, 0x2c3428, 0.75);
scene.add(skyFill);

const bounce = new THREE.AmbientLight(0x46525a, 0.30);
scene.add(bounce);

// ---------- The weather breathing ----------
//
// Golden Hour's arc is the sun going down; this piece has no sun to lose.
// Its clock is the fog itself: two slow sine periods that never quite line
// up, so visibility ebbs from ~100 m down to ~45 m and back on a cycle that
// doesn't feel metronomic. Everything the fog touches — density, palette,
// light level, exposure, the light shafts, how far the birds sound — reads
// from this one number, set in one place, for the same reason Golden Hour
// set everything solar from one elevation: split across call sites it rots.
const CLEAR = {
  fog: new THREE.Color(0x9fb2ba), density: 0.019,
  skyTop: new THREE.Color(0xb4c6ce), skyBottom: new THREE.Color(0x3c4636), fill: 1.0,
  light: new THREE.Color(0xc2d0d8), lightI: 0.7,
  ambient: new THREE.Color(0x4e5a64), ambientI: 0.42,
  exposure: 0.74,
};
const THICK = {
  fog: new THREE.Color(0x5d6b74), density: 0.046,
  skyTop: new THREE.Color(0x6b7d8c), skyBottom: new THREE.Color(0x242c26), fill: 0.68,
  light: new THREE.Color(0x8698ac), lightI: 0.42,
  ambient: new THREE.Color(0x364656), ambientI: 0.48,
  exposure: 0.8,
};
// Above the fog line the summit breaks out into thin, cold, bright air —
// the payoff for the climb, whatever the weather is doing below.
const SUMMIT_FOG = new THREE.Color(0xc4d2de);

const mixN = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let weatherT = 0;    // seconds of walking, not seconds since the page loaded

function fogPhase() {
  const s = 0.6 * Math.sin((Math.PI * 2 * weatherT) / 211 + 1.7)
          + 0.4 * Math.sin((Math.PI * 2 * weatherT) / 337 + 4.2);
  return 0.5 + 0.5 * Math.max(-1, Math.min(1, s));
}

function applyWeather(fogT, altT) {
  scene.fog.color.copy(CLEAR.fog).lerp(THICK.fog, fogT).lerp(SUMMIT_FOG, altT);
  scene.fog.density = mixN(mixN(CLEAR.density, THICK.density, Math.pow(fogT, 1.15)), 0.006, altT);

  skyFill.color.copy(CLEAR.skyTop).lerp(THICK.skyTop, fogT);
  skyFill.groundColor.copy(CLEAR.skyBottom).lerp(THICK.skyBottom, fogT);
  skyFill.intensity = mixN(mixN(CLEAR.fill, THICK.fill, fogT), 1.0, altT);

  dayLight.color.copy(CLEAR.light).lerp(THICK.light, fogT);
  dayLight.intensity = mixN(mixN(CLEAR.lightI, THICK.lightI, fogT), 0.9, altT);

  bounce.color.copy(CLEAR.ambient).lerp(THICK.ambient, fogT);
  bounce.intensity = mixN(CLEAR.ambientI, THICK.ambientI, fogT);

  renderer.toneMappingExposure = mixN(mixN(CLEAR.exposure, THICK.exposure, fogT), 0.8, altT);
}

// ---------- World ----------
buildTerrain(scene);
const forest = buildForest(scene);
const props = buildProps(scene);
const creek = buildCreek(scene);
const atmosphere = buildAtmosphere(scene);
const audio = new Soundscape();
const wildlife = buildWildlife(scene, audio);
const dread = createDread(scene, audio);
const controls = new WalkControls(camera, canvas);

// Start at the trailhead, facing up the first leg into the fog.
{
  const p0 = TRAIL.points[0];
  controls.pos.set(p0.x, 0, p0.z + 2);
  controls.yaw = Math.atan2(-p0.dx, -p0.dz);
}
applyWeather(fogPhase(), 0);

// ---------- Cairns ----------
const cairnChip = document.getElementById('cairn-chip');
const cairnsFound = new Set();
let chipTimer = 0;

function checkCairns() {
  for (let i = 0; i < LAYOUT.cairns.length; i++) {
    if (cairnsFound.has(i)) continue;
    const c = LAYOUT.cairns[i];
    if (Math.hypot(controls.pos.x - c.x, controls.pos.z - c.z) < c.foundRadius) {
      cairnsFound.add(i);
      audio.chime();
      cairnChip.textContent = cairnsFound.size === LAYOUT.cairns.length
        ? 'all seven cairns'
        : `cairn found — ${cairnsFound.size} of ${LAYOUT.cairns.length}`;
      cairnChip.classList.add('show');
      chipTimer = 4;
    }
  }
  if (chipTimer > 0) {
    chipTimer -= 1 / 60;
    if (chipTimer <= 0) cairnChip.classList.remove('show');
  }
}

// ---------- Overlay / input bootstrap ----------
const overlay = document.getElementById('overlay');
const isTouch = window.matchMedia('(pointer: coarse)').matches;

// requestPointerLock returns a promise in current Chrome and rejects when the
// browser won't grant the lock — most commonly during the short cooldown right
// after Esc, which is exactly when a player clicks to get back in. Unhandled,
// that reaches window.onerror. Nothing to do about a refusal except carry on
// without the lock — the arrow keys still work — so swallow it.
function requestLock() {
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch (e) { /* older API throws */ }
}

function begin() {
  audio.init();
  audio.resume();
  controls.enabled = true;
  overlay.classList.add('hidden');
  if (!isTouch) requestLock();
}
overlay.addEventListener('click', begin);
canvas.addEventListener('click', () => {
  if (controls.enabled && !isTouch && document.pointerLockElement !== canvas) {
    requestLock();
  }
});

// Say so when the mouse is no longer looking. The arrow keys still turn the
// camera, so this is a hint rather than a wall — nothing here needs aiming,
// so nothing here should require pointer lock.
const lockHint = document.getElementById('lock-hint');
document.addEventListener('pointerlockchange', () => {
  const lost = controls.enabled && !isTouch && document.pointerLockElement !== canvas;
  lockHint.classList.toggle('show', lost);
});

const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', e => {
  e.stopPropagation();
  audio.setMuted(!audio.muted);
  muteBtn.innerHTML = audio.muted ? '&#128263;' : '&#128266;';
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Loop ----------
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  // The weather only breathes while someone is out in it — a tab left open on
  // the title card shouldn't burn through the cycle before the first step.
  if (controls.enabled) weatherT += dt;
  const fogT = fogPhase();
  const altT = smoothstep(46, 62, controls.pos.y);
  applyWeather(fogT, altT);

  const moving = controls.update(dt);
  forest.update(dt);
  wildlife.update(dt, camera, controls, fogT);
  dread.update(dt, camera, controls, fogT);
  atmosphere.update(dt, camera, fogT, altT);
  props.update(dt, fogT);
  creek.update(dt);
  checkCairns();

  const ck = creekInfo(controls.pos.x, controls.pos.z);
  const wf = LAYOUT.waterfall;
  audio.update(dt, {
    moving: moving && controls.enabled,
    surface: controls.surface,
    fogT,
    altT,
    creekDist: ck.dist,
    waterfallDist: Math.hypot(controls.pos.x - wf.x, controls.pos.z - wf.z),
    birdsSilent: dread.birdsSilent,
  });

  renderer.render(scene, camera);
}
tick();
