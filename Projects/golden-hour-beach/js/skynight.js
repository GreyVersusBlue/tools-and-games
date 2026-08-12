import * as THREE from 'three';
import { mulberry32 } from './field.js';

// Everything celestial that only exists after sunset: stars, the Milky Way,
// the moon, and the occasional shooting star. All of it is seeded or canvas-
// drawn — zero asset bytes, same as everything this project has added since
// session 7.
//
// The whole group follows the camera's x/z each frame, so the sky keeps its
// angular position no matter how far down the coast the walker gets. Radii sit
// under 1000 because the Sky dome is a scale-2000 box: half-extent 1000, and
// anything past that renders behind it.

const STAR_COUNT = 3000;
const STAR_RADIUS = 900;

function makeStars() {
  // Seeded, so the sky is the same sky every visit — you can learn it the way
  // you learn the wrack line. Same argument field.js already makes.
  const rnd = mulberry32(0x57a125);
  const pos = new Float32Array(STAR_COUNT * 3);
  const col = new Float32Array(STAR_COUNT * 3);
  const c = new THREE.Color();
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform on the upper hemisphere, thinning near the horizon where haze
    // would hide real stars anyway.
    const az = rnd() * Math.PI * 2;
    const el = Math.asin(0.04 + rnd() * 0.96);
    pos[i * 3] = Math.cos(el) * Math.cos(az) * STAR_RADIUS;
    pos[i * 3 + 1] = Math.sin(el) * STAR_RADIUS;
    pos[i * 3 + 2] = Math.cos(el) * Math.sin(az) * STAR_RADIUS;
    // Magnitude and warmth vary per star: most faint and white-blue, a few
    // bright and warm.
    const mag = Math.pow(rnd(), 2.6);
    const warm = rnd();
    c.setRGB(
      0.55 + mag * 0.45,
      0.55 + mag * 0.40 + warm * 0.04,
      0.62 + mag * 0.38 - warm * 0.10,
    ).multiplyScalar(0.35 + mag * 0.65);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

function makeMilkyWay() {
  // One canvas band of blurred blotches — the detailTexture trick from
  // terrain.js pointed at the sky.
  const rnd = mulberry32(0x9a1a);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 128);
  g.filter = 'blur(7px)';
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 512;
    const y = 64 + (rnd() - 0.5) * 44 * Math.sin((x / 512) * Math.PI);
    const r = 4 + rnd() * 16;
    const a = 0.03 + rnd() * 0.10;
    g.fillStyle = `rgba(${190 + (rnd() * 40 | 0)},${190 + (rnd() * 30 | 0)},${210 + (rnd() * 40 | 0)},${a})`;
    g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill();
  }
  // A dark dust lane through the middle, which is what actually makes it read
  // as the Milky Way rather than a smear.
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 512;
    const y = 64 + (rnd() - 0.5) * 16;
    g.beginPath(); g.arc(x, y, 3 + rnd() * 9, 0, 6.29); g.fill();
  }
  g.filter = 'none';
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1700, 420), mat);
  // Arched across the sky from the south-east, leaning with the band of real
  // summer sky this sunset belongs to.
  mesh.position.set(-200, 620, -300);
  mesh.lookAt(0, 0, 0);
  mesh.rotateZ(0.6);
  return mesh;
}

function moonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0, 'rgba(235,238,248,1)');
  grad.addColorStop(0.75, 'rgba(210,216,235,0.95)');
  grad.addColorStop(0.92, 'rgba(180,190,215,0.55)');
  grad.addColorStop(1, 'rgba(160,170,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // Mare blotches, fixed by hand — the same face every night, like the real one.
  g.fillStyle = 'rgba(150,158,185,0.5)';
  const mare = [[52, 44, 13], [76, 56, 10], [60, 74, 15], [82, 80, 8], [44, 64, 8]];
  for (const [x, y, r] of mare) { g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill(); }
  return new THREE.CanvasTexture(c);
}

function streakTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(220,230,255,0.35)');
  grad.addColorStop(0.97, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 8);
  return new THREE.CanvasTexture(c);
}

export function buildSkyNight(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const stars = makeStars();
  group.add(stars);

  const milkyWay = makeMilkyWay();
  group.add(milkyWay);

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: moonTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false,
  }));
  moon.scale.set(52, 52, 1);
  group.add(moon);

  // Soft halo behind the moon, additive, wider and dimmer.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: moonTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, color: 0x8090c0,
  }));
  halo.scale.set(150, 150, 1);
  group.add(halo);

  // Shooting stars: a small pool of streak sprites.
  const streakTex = streakTexture();
  const meteors = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: streakTex, transparent: true, opacity: 0, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    s.visible = false;
    s.scale.set(40, 2.2, 1);
    group.add(s);
    meteors.push({ sprite: s, t: 0, dur: 0, from: new THREE.Vector3(), vel: new THREE.Vector3() });
  }
  const meteorRnd = mulberry32(0x3e7e02);

  const MOON_AZ = THREE.MathUtils.degToRad(140);
  const moonDir = new THREE.Vector3();

  const state = {
    moonDir,           // read by main.js to aim the night light and water glint
    moonUp: 0,         // 0..1, how risen the moon is — main.js mixes light by this
    meteorRate: 1,     // Phase 7's meteor shower multiplies this
    journal: null,     // main.js sets this; sightings feed it
    _moonAge: 0,
    _meteorTimer: 30,
  };
  const worldPos = new THREE.Vector3();

  state.update = (dt, nightT, camera) => {
    group.position.set(camera.position.x, 0, camera.position.z);

    // Star opacity comes from the palette keyframes via setNight below, so the
    // stars can never disagree with the fog. Here: the meteor clock and the
    // moon arc only.

    // Moon: starts rising once real dusk sets in, then keeps its own slow arc.
    // It never resets mid-visit; a fresh visit starts the night over anyway.
    if (nightT > 0.25) state._moonAge += dt;
    const elev = THREE.MathUtils.degToRad(Math.min(38, -6 + state._moonAge * (44 / 900)));
    state.moonUp = THREE.MathUtils.clamp((elev + 0.02) / 0.15, 0, 1) * THREE.MathUtils.clamp(nightT * 2, 0, 1);
    moonDir.set(
      Math.cos(elev) * Math.cos(MOON_AZ) * -1,
      Math.sin(elev),
      Math.cos(elev) * Math.sin(MOON_AZ) * -1,
    ).normalize();
    moon.position.copy(moonDir).multiplyScalar(940);
    halo.position.copy(moonDir).multiplyScalar(945);
    const moonA = state.moonUp * Math.min(1, nightT * 1.6);
    moon.material.opacity = moonA;
    halo.material.opacity = moonA * 0.22;

    // Shooting stars, deep night only.
    if (nightT > 0.85) {
      state._meteorTimer -= dt * state.meteorRate;
      if (state._meteorTimer <= 0) {
        state._meteorTimer = 40 + meteorRnd() * 50;
        const m = meteors.find(m => !m.sprite.visible);
        if (m) {
          const az = meteorRnd() * Math.PI * 2;
          const el = 0.5 + meteorRnd() * 0.8;
          m.from.set(
            Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az),
          ).multiplyScalar(880);
          m.vel.set(meteorRnd() - 0.5, -(0.3 + meteorRnd() * 0.4), meteorRnd() - 0.5)
            .normalize().multiplyScalar(320);
          m.t = 0;
          m.dur = 0.7 + meteorRnd() * 0.5;
          m.sprite.material.rotation = Math.atan2(-m.vel.y, m.vel.x);
          m.sprite.visible = true;
        }
      }
    }
    for (const m of meteors) {
      if (!m.sprite.visible) continue;
      m.t += dt;
      const p = m.t / m.dur;
      if (p >= 1) { m.sprite.visible = false; m.sprite.material.opacity = 0; continue; }
      m.sprite.position.copy(m.from).addScaledVector(m.vel, m.t);
      m.sprite.material.opacity = Math.sin(p * Math.PI) * 0.9;
      // Too brief to "watch" — one clean look counts.
      if (state.journal) {
        state.journal.glimpse('meteor', worldPos.copy(m.sprite.position).add(group.position), camera);
      }
    }

    if (state.journal && moonA > 0.35) {
      state.journal.focus('moon', worldPos.copy(moon.position).add(group.position), dt, camera);
    }
  };

  // Palette-driven visibility, one writer: main.js's setSunElevation calls this
  // with its keyframed starAlpha so the stars can never disagree with the fog.
  state.setNight = (starAlpha, nightT) => {
    stars.material.opacity = starAlpha;
    milkyWay.material.opacity = Math.max(0, (nightT - 0.72) / 0.28) * 0.32;
  };

  // The moon rises in real time, which a debug scrub skips right past — jump
  // the descent to night and the "moonlight" aims from under the horizon.
  // __gh.setSunT calls this with how long the moon would have been rising.
  state.syncMoon = (seconds) => { state._moonAge = seconds; };

  return state;
}
