import * as THREE from 'three';
import { Sky } from '../libs/Sky.js';
import { groundHeight, regionWeights, onPier, CAVE } from './field.js';
import { buildTerrain } from './terrain.js';
import { buildProps } from './props.js';
import { buildOcean } from './ocean.js';
import { buildWildlife } from './wildlife.js';
import { WalkControls } from './controls.js';
import { Soundscape } from './audio.js';
import { buildFootprints } from './footprints.js';
import { buildSkyNight } from './skynight.js';
import { buildCampfire, CAMP } from './campfire.js';
import { buildInteract } from './interact.js';
import { buildStones } from './stones.js';
import { buildShells } from './shells.js';
import { buildJournal } from './journal.js';
import { buildLighthouse } from './lighthouse.js';
import { buildRegions } from './regions.js';
import { buildPier } from './pier.js';
import { buildEvents } from './events.js';
import { buildSandcastles } from './sandcastle.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Phones get a 1.5 pixel-ratio cap: on a 3x screen that is 2.25x fewer
// fragments for a difference no one sees on a moving sunset, and the water
// shader is fragment-bound (round 1's measurement, reconfirmed in software
// this round).
const coarse = window.matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe8b28a, 0.0022);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2500);

// ---------- Sunset sky ----------
const sky = new Sky();
sky.scale.setScalar(2000);
scene.add(sky);

{
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 2.6;
  u.mieCoefficient.value = 0.012;
  u.mieDirectionalG.value = 0.92;
}

const sunAzimuthDeg = 195;       // roughly out over the water, slightly west
const sun = new THREE.Vector3();

// ---------- Lighting ----------
const sunLight = new THREE.DirectionalLight(0xffb26b, 2.4);
scene.add(sunLight);

const skyFill = new THREE.HemisphereLight(0xcf8ab0, 0x6b5138, 0.55);
scene.add(skyFill);

const bounce = new THREE.AmbientLight(0x86506a, 0.25);
scene.add(bounce);

// ---------- The hour actually passing ----------
//
// The piece is called Golden Hour and the sun used to sit at a fixed 3.2°, which
// meant a twenty-minute walk and a ten-second one looked the same. Then it
// drifted from 5.6° down to 1.1° over eight minutes and stopped — full night
// would have broken a palette built for low warm light.
//
// Now the palette is built for the whole descent, so the sun goes all the way
// down. The eight-minute opening act is untouched; past 1.1° the light keeps
// falling through sunset, blue hour and deep dusk into a held night — about 26
// minutes of walking time end to end, or a lot less sitting at the fire, where
// time runs six times faster. Night holds: the moon keeps its own slow arc and
// the elevation stays put. A fresh visit still opens at 5.6° — the strong
// opening frame is the one thing the old decision got permanently right.
//
// None of this is the thing that makes the preview capture's "did the frame
// change" assertion pass (locked decision #28). The water ripple, the swash and
// the gulls already move every frame, and #29 is explicit that animating
// something to satisfy that check is the wrong reason.
const SUN_FROM = 5.6;

// The descent as (walking-seconds, elevation) stops. The first leg is the
// original eight minutes exactly.
const SUN_TRACK = [
  { at: 0,    elev: 5.6 },
  { at: 480,  elev: 1.1 },   // end of the old piece
  { at: 600,  elev: 0.0 },   // sunset touch
  { at: 840,  elev: -3.0 },  // blue hour
  { at: 1140, elev: -7.0 },  // deep dusk, first real stars
  { at: 1560, elev: -12.0 }, // night, held
];
const SUN_TOTAL = SUN_TRACK[SUN_TRACK.length - 1].at;

function elevAtTime(s) {
  for (let i = 1; i < SUN_TRACK.length; i++) {
    if (s <= SUN_TRACK[i].at) {
      const a = SUN_TRACK[i - 1], b = SUN_TRACK[i];
      return a.elev + (b.elev - a.elev) * ((s - a.at) / (b.at - a.at));
    }
  }
  return SUN_TRACK[SUN_TRACK.length - 1].elev;
}

// Everything the sun touches, set in one place from one elevation. Split across
// call sites it would rot: the fog would stay the noon colour while the light
// went red, and nobody would notice until a screenshot looked wrong. The two
// original keyframes grew into six; the rule is the same — one writer.
//
// star = star opacity, bio = bioluminescence (foam + footprints), moonMix = how
// far the one directional light has handed over from sun to moon (one light,
// two jobs — a second realtime light would cost real frame time for a sky that
// only ever shows one of them), glintA = the sun-glint sprite's presence.
const KEY = (elev, light, intensity, skyTop, skyBottom, fill, ambient, ambientI, fog, water, exposure, star, bio, moonMix, glintA) => ({
  elev, intensity, fill, ambientI, exposure, star, bio, moonMix, glintA,
  light: new THREE.Color(light), skyTop: new THREE.Color(skyTop),
  skyBottom: new THREE.Color(skyBottom), ambient: new THREE.Color(ambient),
  fog: new THREE.Color(fog), water: new THREE.Color(water),
});
const PALETTE = [
  //   elev   light    inten  skyTop   skyBot   fill  ambient  ambI  fog      water    expo  star  bio  moon  glint
  KEY( 5.6,  0xffc98d, 2.90, 0xd8a5c0, 0x7a5c40, 0.62, 0x8e6274, 0.24, 0xf0c39c, 0xffdcaa, 0.52, 0,    0,   0,    1),
  KEY( 1.1,  0xff8f4a, 2.10, 0xc57ba4, 0x5c4632, 0.48, 0x7a4460, 0.27, 0xdb9a78, 0xffb578, 0.60, 0,    0,   0,    1),
  KEY( 0.0,  0xff6a33, 1.60, 0xb06694, 0x4a3828, 0.40, 0x6a3a55, 0.28, 0xc98268, 0xff9a55, 0.66, 0,    0,   0,    0.85),
  KEY(-3.0,  0x8890c0, 0.70, 0x525c88, 0x38344a, 0.40, 0x44426a, 0.36, 0x555a78, 0x3a5878, 0.72, 0.25, 0.1, 0,    0),
  KEY(-7.0,  0x6a7aac, 0.50, 0x2c3454, 0x201e2c, 0.32, 0x323458, 0.42, 0x2a3048, 0x1c3854, 0.80, 0.80, 0.6, 0.6,  0),
  KEY(-12.0, 0x9fb2d8, 0.68, 0x18223c, 0x12101c, 0.28, 0x242a48, 0.46, 0x141a2c, 0x102c44, 0.88, 1,    1,   1,    0),
];
const mixC = (a, b, t, out) => out.copy(a).lerp(b, t);
const mixN = (a, b, t) => a + (b - a) * t;

const tmpFog = new THREE.Color(), tmpWater = new THREE.Color();
const lightDir = new THREE.Vector3();

// Where the directional light's night half aims from. skynight owns the moon's
// arc and pushes its direction in here every frame; before it exists (the very
// first setSunElevation call at load) a plausible dummy is fine — moonMix is 0
// until deep dusk.
const moonDir = new THREE.Vector3(0.4, 0.3, -0.85).normalize();

function setSunElevation(deg) {
  // Bracketing keyframes, then one local lerp. PALETTE runs high to low.
  let a = PALETTE[0], b = PALETTE[1];
  for (let i = 1; i < PALETTE.length; i++) {
    a = PALETTE[i - 1]; b = PALETTE[i];
    if (deg >= b.elev) break;
  }
  const t = THREE.MathUtils.clamp((a.elev - deg) / (a.elev - b.elev), 0, 1);

  // The Sky shader's brightness collapses to black almost the moment its sun
  // goes below the horizon — no twilight, just off. Real dusk keeps a glow in
  // the west for an hour. So the *shader* sun descends on a slowed, curved
  // track below zero (-3° true reads as -0.55°, a strong afterglow; -12° true
  // reads as -3.6°, a whisper on the horizon), while the lighting math uses the
  // true elevation. Screenshot-verified both ways: linear ×0.125 left night
  // looking like a sunset that never ends, and no remap at all rendered blue
  // hour as a black frame with a foam line in it.
  const shaderDeg = deg >= 0 ? deg : -Math.pow(-deg, 1.35) * 0.125;
  const phi = THREE.MathUtils.degToRad(90 - shaderDeg);
  const theta = THREE.MathUtils.degToRad(sunAzimuthDeg);
  sun.setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms.sunPosition.value.copy(sun);

  const moonMix = mixN(a.moonMix, b.moonMix, t);
  lightDir.copy(sun).lerp(moonDir, moonMix).normalize();
  sunLight.position.copy(lightDir).multiplyScalar(300);
  mixC(a.light, b.light, t, sunLight.color);
  sunLight.intensity = mixN(a.intensity, b.intensity, t);

  mixC(a.skyTop, b.skyTop, t, skyFill.color);
  mixC(a.skyBottom, b.skyBottom, t, skyFill.groundColor);
  skyFill.intensity = mixN(a.fill, b.fill, t);

  mixC(a.ambient, b.ambient, t, bounce.color);
  bounce.intensity = mixN(a.ambientI, b.ambientI, t);

  scene.fog.color.copy(mixC(a.fog, b.fog, t, tmpFog));
  renderer.toneMappingExposure = mixN(a.exposure, b.exposure, t);

  mixC(a.water, b.water, t, tmpWater);
  return {
    water: tmpWater,
    nightT: THREE.MathUtils.clamp(-deg / 12, 0, 1),
    star: mixN(a.star, b.star, t),
    bio: mixN(a.bio, b.bio, t),
    moonMix,
    glintA: mixN(a.glintA, b.glintA, t),
  };
}

// ---------- World ----------
// Before anything reads `sun`: buildOcean clones the direction it is handed.
setSunElevation(SUN_FROM);

buildTerrain(scene);
buildProps(scene);
const ocean = buildOcean(scene, sun);
const audio = new Soundscape();
const wildlife = buildWildlife(scene, audio);
const controls = new WalkControls(camera, canvas, groundHeight);
controls.pos.set(0, 0, 14);   // start on dry sand, sea ahead
const footprints = buildFootprints(scene);
audio.onFootstep = () => footprints.step(controls.pos.x, controls.pos.z, controls.yaw);
const skynight = buildSkyNight(scene);
const campfire = buildCampfire(scene);

// ---------- Sun glint sprite ----------
const glintTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,230,180,0.9)');
  grad.addColorStop(0.3, 'rgba(255,190,120,0.35)');
  grad.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
// Additive, not normal alpha. The sky at the sun is far brighter than this
// sprite's colour, so compositing it over the top *subtracted* light: it rendered
// as a brown thumbprint sitting on the brightest part of the frame, visible in
// every screenshot the site has ever taken of this game. Additive is what a glow
// wants anyway.
const glint = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
glint.scale.set(260, 260, 1);
scene.add(glint);

function placeGlint() {
  glint.position.copy(sun).multiplyScalar(1400);
  glint.position.y = Math.max(glint.position.y, 40);
}
placeGlint();

// ---------- The lighthouse ----------
// Phase 1 promised it as a nameless flash on the horizon; the headland is
// walkable now, so the promise is kept — a real tower whose beam sweeps from
// its true position all night.
const lighthouse = buildLighthouse(scene);
buildPier(scene);

// The pool inside the sea cave glows faintly at night — the same
// bioluminescence the foam carries, pooled and still. Driven by the palette's
// bio value in applySun.
const cavePool = new THREE.Mesh(
  new THREE.CircleGeometry(2.4, 20).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({
    color: 0x48e0f2, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
cavePool.position.set(CAVE.x, groundHeight(CAVE.x, CAVE.z) + 0.05, CAVE.z);
scene.add(cavePool);

// ---------- Overlay / input bootstrap ----------
const overlay = document.getElementById('overlay');
const isTouch = window.matchMedia('(pointer: coarse)').matches;

// requestPointerLock returns a promise in current Chrome and rejects when the
// browser won't grant the lock — most commonly during the short cooldown right
// after Esc, which is exactly when a player clicks to get back in. Unhandled,
// that reaches window.onerror as "The root document of this element is not valid
// for pointer lock", and the regression suite's "no page or console errors" beat
// is one unlucky click away from failing on it. Thirteen of them turned up in one
// driven session here. Nothing to do about a refusal except carry on without the
// lock — the arrow keys still work — so swallow it.
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

// Say so when the mouse is no longer looking.
//
// Pointer lock ends on Esc, on alt-tab, and on anything else that takes focus off
// the page, and until now the piece gave no sign: you kept walking with WASD
// while the mouse quietly did nothing, and the only way back was guessing that
// clicking would help. Measured it happening in a driven session — twenty seconds
// after the last input `document.pointerLockElement` was null, and every
// subsequent look was dropped on the floor with no error and nothing on screen.
//
// The arrow keys turn the camera now (see controls.js), so this is a hint rather
// than a wall: the whole beach is walkable and lookable without ever locking the
// mouse. That is also the accessibility answer — there is nothing here to aim at,
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

// ---------- Hands ----------
// The interact system (interact.js) owns the hint pill and the E key; every
// verb registers with it. Sitting at the fire and scattering crumbs live here
// because they belong to the camp; stones and shells register themselves.
const interact = buildInteract(camera, controls);

interact.register({
  x: CAMP.x, z: CAMP.z, y: groundHeight(CAMP.x, CAMP.z) + 0.8, radius: 3.5,
  label: () => controls.seated
    ? (interact.isTouch ? 'sitting — tap to stand' : 'sitting — W to stand')
    : (interact.isTouch ? 'tap here to sit by the fire' : 'sit by the fire · E'),
  use: () => { controls.seated = !controls.seated; },
});

// The crumb tin by the log seat. Scatters onto open sand a few strides from
// the flames — gulls will not land in a fire, and neither would crumbs.
interact.register({
  x: CAMP.x - 1.8, z: CAMP.z + 1.4, y: groundHeight(CAMP.x - 1.8, CAMP.z + 1.4) + 0.4, radius: 2.6,
  available: () => !wildlife.feedActive(),
  label: () => 'scatter crumbs for the gulls · E',
  use: () => wildlife.feedAt(CAMP.x - 6, CAMP.z - 6),
});

const stones = buildStones(scene, interact, controls, camera, audio, ocean);
const shells = buildShells(scene, interact, controls, camera, audio);

// ---------- The journal ----------
// Discoveries persist (gvb-save); the sun does not. Species sight themselves
// under honest attention, shells record on examine, places on arrival.
const journal = buildJournal(controls);
wildlife.journal = journal;
skynight.journal = journal;
shells.onExamine = shell => journal.foundShell(shell.name);
const regions = buildRegions(controls, journal);
const events = buildEvents(scene, audio, skynight, journal);
const sandcastles = buildSandcastles(scene, interact, controls, camera, audio, ocean);

// Photo mode: H hides every piece of chrome. The journal frames what you saw;
// this frames what you see.
document.addEventListener('keydown', e => {
  if (e.code === 'KeyH' && controls.enabled) document.body.classList.toggle('photo');
});

function updateFireAudio() {
  const d = Math.hypot(controls.pos.x - CAMP.x, controls.pos.z - CAMP.z);
  audio.setFire(THREE.MathUtils.clamp(1 - (d - 2) / 12, 0, 1));
  if (d < 6) journal.visitPlace('camp');
}

// ---------- Loop ----------
const clock = new THREE.Clock();
let sunT = 0;      // seconds of walking, not seconds since the page loaded
let nightT = 0;    // 0 above the horizon, 1 at held night

function applySun() {
  // skynight owns the moon's arc; pull its current direction in before the
  // palette write so the directional light and the water agree on where the
  // brightest thing in the sky is.
  moonDir.copy(skynight.moonDir);
  const pal = setSunElevation(elevAtTime(sunT));
  nightT = pal.nightT;
  ocean.setSun(pal.moonMix > 0.5 ? lightDir : sun, pal.water);
  ocean.setNight(pal.bio);
  footprints.setNight(pal.bio);
  skynight.setNight(pal.star, nightT);
  audio.setNight(nightT);
  glint.material.opacity = pal.glintA;
  cavePool.material.opacity = pal.bio * 0.4;
  placeGlint();
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  // The hour only passes while someone is here for it. Clocking this off page
  // load would mean a tab left open on the title card burns the whole descent
  // before the visitor has taken a step. Sitting at the fire runs it at six
  // times — the fire is the fast-forward, deliberately diegetic.
  const timeScale = controls.seated ? 6 : 1;
  if (controls.enabled && sunT < SUN_TOTAL) {
    sunT = Math.min(SUN_TOTAL, sunT + dt * timeScale);
    applySun();
  }

  // Ocean first: controls needs this frame's water surface height to know how
  // far a walker can wade, and a one-frame-old value would be imperceptible
  // anyway against a 9.5 s swash period, but there's no reason to take the lag.
  ocean.update(dt, camera);
  const moving = controls.update(dt, ocean.water.position.y);
  wildlife.update(dt, camera, ocean.swashLevel, ocean.water.position.y, nightT);
  const rw = regionWeights(controls.pos.x);
  audio.setRegionMix(rw.headland, rw.estuary);
  audio.setSurface(onPier(controls.pos.x, controls.pos.z) ? 'wood' : 'sand');
  const caveD = Math.hypot(controls.pos.x - CAVE.x, controls.pos.z - CAVE.z);
  audio.setCave(THREE.MathUtils.clamp(1 - caveD / CAVE.r, 0, 1));
  audio.update(dt, ocean.swashLevel, moving && controls.enabled, controls.wadeT);
  footprints.update(dt);
  skynight.update(dt * timeScale, nightT, camera);
  campfire.update(dt);
  interact.update();
  stones.update(dt);
  shells.update(dt);
  journal.update(dt);
  regions.update(dt);
  lighthouse.update(dt, nightT, camera);
  events.update(dt, camera, ocean.water.position.y, nightT);
  sandcastles.update(dt);
  updateFireAudio();

  renderer.render(scene, camera);
}
tick();

// ---------- Debug hook ----------
// Only with ?debug in the URL. The regression suite (and anyone tuning the
// palette) cannot wait 26 real minutes for night: setSunT scrubs the descent,
// teleport moves the walker, info reads the renderer's draw counts.
if (new URLSearchParams(location.search).has('debug')) {
  window.__gh = {
    setSunT(s) {
      sunT = THREE.MathUtils.clamp(s, 0, SUN_TOTAL);
      // The moon crosses nightT 0.25 around t=840 in real play; give the scrub
      // the same moon a patient walker would have.
      skynight.syncMoon(Math.max(0, sunT - 840));
      skynight.update(0, THREE.MathUtils.clamp(-elevAtTime(sunT) / 12, 0, 1), camera);
      applySun();
    },
    getSunT() { return sunT; },
    teleport(x, z) { controls.pos.x = x; controls.pos.z = z; },
    face(yaw, pitch = 0) { controls.yaw = yaw; controls.pitch = pitch; },
    pos: () => ({ x: controls.pos.x, z: controls.pos.z }),
    journal: () => JSON.parse(JSON.stringify(journal.state)),
    events,
    info: () => renderer.info.render,
  };
}
