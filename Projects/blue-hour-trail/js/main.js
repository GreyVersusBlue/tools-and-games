import * as THREE from 'three';
import { TRAIL, LAYOUT, creekInfo, trailInfo } from './field.js';
import { createGhost } from './ghost.js';
import { buildTerrain } from './terrain.js';
import { buildForest } from './forest.js';
import { buildProps } from './props.js';
import { buildCreek } from './creek.js';
import { buildAtmosphere } from './atmosphere.js';
import { buildWildlife } from './wildlife.js';
import { createDread } from './dread.js';
import { buildLogbook } from './logbook.js';
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
// The top of the mountain is not the way out.
//
// This used to be the payoff: above the fog line the trail broke out into thin
// bright air over a cloud sea, and every altitude term below leaned that way —
// fog thinning to almost nothing, light coming up, exposure opening. Read back,
// the whole gradient was a promise of relief in a piece whose actual subject is
// wanting to leave and not being able to. So it inverts. The climb does not
// deliver air; it delivers less of everything. The fog closes rather than
// parts, the light goes out of it, and the only thing up there worth seeing is
// the thing you would rather not have.
//
// The old bright value is kept in the history, not here. This one is colder and
// darker than THICK, on purpose: the summit is the worst weather on the
// mountain, not an escape from it.
const SUMMIT_FOG = new THREE.Color(0x46525c);
const SUMMIT = {
  density: 0.055,     // worse than THICK's 0.046 — visibility bottoms out at the top
  fill: 0.46,
  lightI: 0.26,
  ambientI: 0.62,     // the one term that rises: without it the near ground reads black
  exposure: 0.92,
};

// ---------- The headlamp ----------
//
// Found on the cabin step, one toggle, never required for anything. The cone
// is honest light — a real SpotLight, not a screen effect — and everything
// OUTSIDE it goes genuinely darker while it burns: the ambient and the sky
// fill drop by nearly half, so switching it on trades the whole grey world
// for one bright reach of trail. Turning it on must feel like a mistake you
// chose. The light exists from frame one at intensity zero so the shader
// programs are compiled before anyone finds the switch — a toggle that
// hitches is a jump scare, and this piece startles on purpose or not at all.
const lampLight = new THREE.SpotLight(0xe8dcb4, 0, 30, 0.42, 0.55);
// Linear falloff, not the physical inverse square. Session 5's seams pass
// aimed the burning lamp at the walker's own feet for the first time and got
// a featureless blown-white disc — with decay 2 the near ground catches
// sixteen times the light of the 12 m reach, and no intensity satisfies both
// ends. Decay 1 holds the reach while the feet keep their texture: a lamp,
// not a flashbang.
lampLight.decay = 1;
lampLight.target = new THREE.Object3D();
scene.add(lampLight, lampLight.target);
const lampState = { found: false, on: false, mix: 0 };

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
  // The fog and the sky are one colour object, so this darkens the whole
  // world past the cone when the headlamp is on — the horizon must not stay
  // bright while the fill drops, or the lamp reads as a filter, not a light.
  scene.fog.color.multiplyScalar(1 - lampState.mix * 0.35);
  scene.fog.density = mixN(mixN(CLEAR.density, THICK.density, Math.pow(fogT, 1.15)), SUMMIT.density, altT);

  skyFill.color.copy(CLEAR.skyTop).lerp(THICK.skyTop, fogT);
  skyFill.groundColor.copy(CLEAR.skyBottom).lerp(THICK.skyBottom, fogT);
  skyFill.intensity = mixN(mixN(CLEAR.fill, THICK.fill, fogT), SUMMIT.fill, altT);

  dayLight.color.copy(CLEAR.light).lerp(THICK.light, fogT);
  dayLight.intensity = mixN(mixN(CLEAR.lightI, THICK.lightI, fogT), SUMMIT.lightI, altT);

  bounce.color.copy(CLEAR.ambient).lerp(THICK.ambient, fogT);
  // Ambient is the exception that keeps this legible rather than merely dark.
  // Everything else above the fog line goes down; without this term the ground
  // three metres from your boots reads as black, which is not atmosphere, just
  // an unlit frame. Measured: the old summit sat at 6-14/255.
  bounce.intensity = mixN(mixN(CLEAR.ambientI, THICK.ambientI, fogT), SUMMIT.ambientI, altT);

  renderer.toneMappingExposure = mixN(mixN(CLEAR.exposure, THICK.exposure, fogT), SUMMIT.exposure, altT);

  // The headlamp's price: while it burns, the world outside the cone loses
  // nearly half its light. Not a vignette, not an effect — the actual fill
  // and ambient go down, so the darkness past the cone's edge is real and
  // the lamp is the only argument against it.
  const dim = 1 - lampState.mix * 0.45;
  skyFill.intensity *= dim;
  bounce.intensity *= dim;
  dayLight.intensity *= dim;
}

// ---------- World ----------
const terrain = buildTerrain(scene);
const forest = buildForest(scene);
const props = buildProps(scene);
const creek = buildCreek(scene);
const atmosphere = buildAtmosphere(scene);
const audio = new Soundscape();
const wildlife = buildWildlife(scene, audio);
const dread = createDread(scene, audio);
const controls = new WalkControls(camera, canvas);
const logbook = buildLogbook(scene, controls);

// The mountain remembers your last walk — grant 3, session 4. See ghost.js
// and the prompt file's amendment before touching this. Not a save.
const ghost = createGhost(window.localStorage);
// Clocked on weatherT — world seconds, not wall seconds — so the gait the
// ghost remembers is the gait the piece PLAYED, even when a slow tab runs
// the world under the dt clamp at a fraction of real time.
audio.onFootstep = () => {
  ghost.step(trailInfo(controls.pos.x, controls.pos.z).t, weatherT);
};
dread.ghostRhythm = t => (ghost.loaded ? ghost.rhythmNear(t) : null);
// Written when the walker leaves, not on a timer: the record is of a walk
// that ended, and pagehide is the only honest definition of ended a browser
// offers. visibilitychange covers the phone pocketing that pagehide misses.
addEventListener('pagehide', () => ghost.save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') ghost.save();
});

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

function checkCairns(dt) {
  for (let i = 0; i < LAYOUT.cairns.length; i++) {
    if (cairnsFound.has(i)) continue;
    const c = LAYOUT.cairns[i];
    if (Math.hypot(controls.pos.x - c.x, controls.pos.z - c.z) < c.foundRadius) {
      cairnsFound.add(i);
      audio.chime();
      // The chip reads the keeper's name off the cairn. Nothing anywhere says
      // who the keepers are or how many there should be; the logbook holds
      // eight names and this counter only ever reaches seven.
      cairnChip.textContent = cairnsFound.size === LAYOUT.cairns.length
        ? 'all seven cairns'
        : `${c.keeper}’s cairn — ${cairnsFound.size} of ${LAYOUT.cairns.length}`;
      cairnChip.classList.add('show');
      chipTimer = 4;
    }
  }
  if (chipTimer > 0) {
    // Real seconds, not frames — the session-5 seams pass caught this ticking
    // at 1/60 per FRAME, which held the chip up for minutes on a slow tab and
    // would have cut it to 2.4 s on a 144 Hz display.
    chipTimer -= dt;
    if (chipTimer <= 0) cairnChip.classList.remove('show');
  }
}

// ---------- Headlamp pickup and toggle ----------
const lampBtn = document.getElementById('lamp-btn');

function toggleLamp() {
  if (!lampState.found) return;
  lampState.on = !lampState.on;
  lampBtn.classList.toggle('lit', lampState.on);
}
lampBtn.addEventListener('click', e => { e.stopPropagation(); toggleLamp(); });
document.addEventListener('keydown', e => {
  if (e.code === 'KeyF' && !e.repeat) toggleLamp();
});

function updateHeadlamp(dt) {
  if (!lampState.found && controls.enabled) {
    const h = LAYOUT.headlamp;
    if (Math.hypot(controls.pos.x - h.x, controls.pos.z - h.z) < h.foundRadius) {
      lampState.found = true;
      props.takeHeadlamp();
      lampBtn.classList.add('show');
      cairnChip.textContent = 'a headlamp, still working — F';
      cairnChip.classList.add('show');
      chipTimer = 5;
    }
  }
  lampState.mix += ((lampState.on ? 1 : 0) - lampState.mix) * Math.min(1, dt * 5);
  // 4.5 at decay 1 lands a touch more light on the 12 m reach than the old
  // 34 did at decay 2 and a quarter of what it dumped on the near ground —
  // the pair was retuned together; change them together.
  lampLight.intensity = lampState.mix * 4.5;
  if (lampState.mix > 0.001) {
    lampLight.position.copy(camera.position);
    lampLight.position.y -= 0.08;
    camera.getWorldDirection(_lampDir);
    lampLight.target.position.copy(camera.position).addScaledVector(_lampDir, 12);
  }
  dread.headlampOn = lampState.on;
}
const _lampDir = new THREE.Vector3();

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
  terrain.update(dt);
  forest.update(dt);
  wildlife.update(dt, camera, controls, fogT);
  dread.update(dt, camera, controls, fogT);
  atmosphere.update(dt, camera, fogT, altT);
  props.update(dt, fogT);
  creek.update(dt);
  logbook.update(dt);
  checkCairns(dt);
  updateHeadlamp(dt);

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
    watched: dread.lookoutWatching,
    lamp: lampState.on,
  });

  renderer.render(scene, camera);
}
tick();

// ---------- Debug hook ----------
// Only with ?debug in the URL. Same bargain Golden Hour struck: the regression
// suite cannot walk 860 m in real time, cannot wait out a 337-second fog period
// to see the thick phase, and cannot stand in the woods for the ~70 s before
// dread's first beat and then hope the coin lands on the one it wanted. So the
// clock, the walker and the scheduler each get one door in — and nothing in the
// piece itself opens any of them.
if (new URLSearchParams(location.search).has('debug')) {
  window.__bh = {
    // The fog cycle is this piece's sun. Scrubbing it is how you see the thick
    // phase and the clear one in the same run.
    setWeatherT(t) {
      weatherT = Math.max(0, t);
      applyWeather(fogPhase(), smoothstep(46, 62, controls.pos.y));
    },
    getWeatherT: () => weatherT,
    fogT: () => fogPhase(),
    altT: () => smoothstep(46, 62, controls.pos.y),
    density: () => scene.fog.density,

    teleport(x, z) { controls.pos.x = x; controls.pos.z = z; },
    face(yaw, pitch = 0) { controls.yaw = yaw; controls.pitch = pitch; },
    pos: () => ({ x: controls.pos.x, y: controls.pos.y, z: controls.pos.z }),
    surface: () => controls.surface,

    cairns: () => ({ found: [...cairnsFound].sort((a, b) => a - b), total: LAYOUT.cairns.length }),
    layout: () => ({
      cairns: LAYOUT.cairns, markers: LAYOUT.markers, bench: LAYOUT.bench,
      pages: LAYOUT.pages, tower: LAYOUT.tower, cabin: LAYOUT.cabin,
      headlamp: LAYOUT.headlamp,
    }),
    logbook: () => logbook.debug(),

    // The centerline, so a test can point the walker up the mountain instead of
    // guessing a yaw. Guessing one costs you 5 m and a boundary clamp: the
    // trailhead sits at z 145 with BOUNDS.maxZ at 150, so "face down +z" walks
    // into the edge of the world almost immediately.
    trail: () => TRAIL.points.map(p => ({ x: p.x, z: p.z, dx: p.dx, dz: p.dz, t: p.t })),
    yawAlongTrail(i = 0) {
      const p = TRAIL.points[Math.max(0, Math.min(TRAIL.points.length - 1, i | 0))];
      return Math.atan2(-p.dx, -p.dz);
    },

    // Bypasses the cooldown and the fog/elevation gates. 'snap' | 'phantom' |
    // 'silence' | 'howl' | 'bear' | 'eyes' | 'radio' | 'transmission'.
    fireDread: beat => dread.force(beat, camera, controls),
    // The gate truth: which beats are drawable from here, at a given fogT.
    dreadCandidates: (fogT = 0.5) => dread.candidates(controls, fogT),
    dread,

    steam: () => atmosphere.steamInfo(),
    steamBurst: () => atmosphere.steamBurst(),
    // Doors for the two systems that went dark silently for three sessions —
    // the suite proves them with pixels now, same as the steam.
    mist: () => atmosphere.mistInfo(),
    mistShow: v => atmosphere.mistShow(v),
    mistReroot: (i, x, y, z, w, h) => atmosphere.mistReroot(i, x, y, z, w, h),
    breath: () => atmosphere.breathInfo(),
    breathShow: v => atmosphere.breathShow(v),
    breathBurst: () => atmosphere.breathBurst(camera),
    bootprints: () => ({ opacity: props.bootprintOpacity(), prints: LAYOUT.bootprints.length }),

    music: () => audio.musicState(),
    // The last phantom-steps and radio firings, so the suite can hold the
    // descent, the downhill lean and the echo without ears.
    lastPhantom: () => audio._lastPhantom,
    lastRadio: () => audio._lastRadio,
    // How many low stings the piece has played. The suite counts them to hold
    // the promise that nothing acknowledges the walker's leaving.
    stings: () => audio._stings || 0,

    // The ghost's doors: whether a previous walk loaded, how much of this one
    // has been recorded, and a way to force the save without a pagehide.
    ghost: () => ({ loaded: ghost.loaded, count: ghost.count, walked: ghost.walked() }),
    ghostSave: () => ghost.save(),

    headlamp: () => ({
      found: lampState.found, on: lampState.on, mix: lampState.mix,
      intensity: lampLight.intensity, ambient: bounce.intensity,
    }),

    info: () => renderer.info.render,
  };
}
