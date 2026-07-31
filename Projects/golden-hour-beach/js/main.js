import * as THREE from 'three';
import { Sky } from '../libs/Sky.js';
import { groundHeight } from './field.js';
import { buildTerrain } from './terrain.js';
import { buildProps } from './props.js';
import { buildOcean } from './ocean.js';
import { buildWildlife } from './wildlife.js';
import { WalkControls } from './controls.js';
import { Soundscape } from './audio.js';
import { buildFootprints } from './footprints.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
// meant a twenty-minute walk and a ten-second one looked the same. It now drifts
// from 5.6° down to 1.1° over eight minutes and then stops.
//
// It stops on purpose. A sun that goes all the way down turns this into a dark
// beach, which is a different and worse piece — the whole palette, the water
// colour and the exposure are built for low warm light. What this wants is the
// light *deepening* while you are out in it, not night falling. Eight minutes is
// long enough that nobody watches it happen and short enough that a real visit
// covers most of it.
//
// It is also deliberately not the thing that makes the preview capture's
// "did the frame change" assertion pass (locked decision #28). The water ripple,
// the swash and the gulls already move every frame, and #29 is explicit that
// animating something to satisfy that check is the wrong reason. Over the ~30 s
// a capture takes, the sun moves 0.3° and changes nothing you could see.
const SUN_FROM = 5.6, SUN_TO = 1.1, SUN_SECONDS = 480;

// Everything the sun touches, set in one place from one elevation. Split across
// call sites it would rot: the fog would stay the noon colour while the light
// went red, and nobody would notice until a screenshot looked wrong.
const HIGH = {
  light: new THREE.Color(0xffc98d), intensity: 2.9,
  skyTop: new THREE.Color(0xd8a5c0), skyBottom: new THREE.Color(0x7a5c40), fill: 0.62,
  ambient: new THREE.Color(0x8e6274), ambientI: 0.24,
  fog: new THREE.Color(0xf0c39c), water: new THREE.Color(0xffdcaa), exposure: 0.52,
};
const LOW = {
  light: new THREE.Color(0xff8f4a), intensity: 2.1,
  skyTop: new THREE.Color(0xc57ba4), skyBottom: new THREE.Color(0x5c4632), fill: 0.48,
  ambient: new THREE.Color(0x7a4460), ambientI: 0.27,
  fog: new THREE.Color(0xdb9a78), water: new THREE.Color(0xffb578), exposure: 0.60,
};
const mixC = (a, b, t, out) => out.copy(a).lerp(b, t);
const mixN = (a, b, t) => a + (b - a) * t;

const tmpFog = new THREE.Color(), tmpWater = new THREE.Color();

function setSunElevation(deg) {
  const t = THREE.MathUtils.clamp((SUN_FROM - deg) / (SUN_FROM - SUN_TO), 0, 1);

  const phi = THREE.MathUtils.degToRad(90 - deg);
  const theta = THREE.MathUtils.degToRad(sunAzimuthDeg);
  sun.setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms.sunPosition.value.copy(sun);

  sunLight.position.copy(sun).multiplyScalar(300);
  mixC(HIGH.light, LOW.light, t, sunLight.color);
  sunLight.intensity = mixN(HIGH.intensity, LOW.intensity, t);

  mixC(HIGH.skyTop, LOW.skyTop, t, skyFill.color);
  mixC(HIGH.skyBottom, LOW.skyBottom, t, skyFill.groundColor);
  skyFill.intensity = mixN(HIGH.fill, LOW.fill, t);

  mixC(HIGH.ambient, LOW.ambient, t, bounce.color);
  bounce.intensity = mixN(HIGH.ambientI, LOW.ambientI, t);

  scene.fog.color.copy(mixC(HIGH.fog, LOW.fog, t, tmpFog));
  renderer.toneMappingExposure = mixN(HIGH.exposure, LOW.exposure, t);

  mixC(HIGH.water, LOW.water, t, tmpWater);
  return { t, water: tmpWater };
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

// ---------- Loop ----------
const clock = new THREE.Clock();
let sunT = 0;   // seconds of walking, not seconds since the page loaded

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  // The hour only passes while someone is here for it. Clocking this off page
  // load would mean a tab left open on the title card burns the whole descent
  // before the visitor has taken a step.
  if (controls.enabled && sunT < SUN_SECONDS) {
    sunT = Math.min(SUN_SECONDS, sunT + dt);
    const { water } = setSunElevation(SUN_FROM + (SUN_TO - SUN_FROM) * (sunT / SUN_SECONDS));
    ocean.setSun(sun, water);
    placeGlint();
  }

  // Ocean first: controls needs this frame's water surface height to know how
  // far a walker can wade, and a one-frame-old value would be imperceptible
  // anyway against a 9.5 s swash period, but there's no reason to take the lag.
  ocean.update(dt);
  const moving = controls.update(dt, ocean.water.position.y);
  wildlife.update(dt, camera);
  audio.update(dt, ocean.swashLevel, moving && controls.enabled, controls.wadeT);
  footprints.update(dt);

  renderer.render(scene, camera);
}
tick();
