// SkyWings 64 - terrain: noise utils, geometry builder, layout constants, heightfield mesh.
import * as THREE from 'three';
import { eachRender } from './herd.js';

export const HALF = 2000, CELL = 5, N = 800, NV = 801, SEA_DEPTH = 38;

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

const GRAD = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
export class Noise {
  constructor(seed) {
    const r = makeRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }
  n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255, p = this.p;
    const g00 = GRAD[p[p[X] + Y] & 7], g10 = GRAD[p[p[X + 1] + Y] & 7];
    const g01 = GRAD[p[p[X] + Y + 1] & 7], g11 = GRAD[p[p[X + 1] + Y + 1] & 7];
    const n00 = g00[0] * xf + g00[1] * yf;
    const n10 = g10[0] * (xf - 1) + g10[1] * yf;
    const n01 = g01[0] * xf + g01[1] * (yf - 1);
    const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.41;
  }
  fbm(x, y, oct = 4) {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += this.n2(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
    return s / norm;
  }
  ridged(x, y, oct = 4) {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(this.n2(x * f, y * f)); s += n * n * amp; norm += amp; amp *= 0.5; f *= 2.03; }
    return s / norm;
  }
}

// ---- merged-geometry builder (non-indexed, vertex coloured) ----
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
export class GeoBuilder {
  constructor() { this.pos = []; this.col = []; }
  geo(geo, color, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0, jitter = 0.06) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
    _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    const p = g.attributes.position.array;
    const isFn = typeof color === 'function';
    if (!isFn) _c.set(color);
    for (let i = 0; i < p.length; i += 9) {
      const k = jitter ? 1 + jitter * (Math.abs(Math.sin(i * 12.9898 + p[i] * 78.233 + p[i + 2] * 37.719) * 43758.5453 % 1) - 0.5) * 2 : 1;
      for (let v = 0; v < 3; v++) {
        const o = i + v * 3;
        this.pos.push(p[o], p[o + 1], p[o + 2]);
        if (isFn) { color(p[o], p[o + 1], p[o + 2], _c); this.col.push(_c.r * k, _c.g * k, _c.b * k); }
        else this.col.push(_c.r * k, _c.g * k, _c.b * k);
      }
    }
    g.dispose();
    return this;
  }
  box(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) { return this.geo(BOX, color, x, y, z, ry, sx, sy, sz, rx, rz); }
  cyl(x, y, z, rTop, rBot, h, seg, color, ry = 0) { return this.geo(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, x, y, z, ry); }
  cone(x, y, z, r, h, seg, color, ry = 0) { return this.geo(new THREE.ConeGeometry(r, h, seg), color, x, y, z, ry); }
  ico(x, y, z, r, detail, color, sx = 1, sy = 1, sz = 1) { return this.geo(new THREE.IcosahedronGeometry(r, detail), color, x, y, z, 0, sx, sy, sz); }
  prism(x, y, z, w, h, d, color, ry = 0) { return this.geo(prismGeo(w, h, d), color, x, y, z, ry); }
  beam(ax, ay, az, bx, by, bz, t, color) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    _v.set(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    return this.geo(BOX, color, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, e.y, t, t, len, e.x, e.z, 0);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
export function prismGeo(w, h, d) {
  const f = d / 2, b = -d / 2, a = w / 2;
  const A = [-a, 0, f], B = [a, 0, f], C = [0, h, f], A2 = [-a, 0, b], B2 = [a, 0, b], C2 = [0, h, b];
  const tris = [A, B, C, B2, A2, C2, A, C, C2, A, C2, A2, B, B2, C2, B, C2, C, A, A2, B2, A, B2, B];
  const arr = [];
  for (const v of tris) arr.push(v[0], v[1], v[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// ---- world layout (shared by all world modules) ----
export function canyonX(z) { return 700 + 80 * Math.sin(z * 0.006); }
export const LAYOUT = {
  wind: { x: 3.2, z: 1.4 },
  pads: {
    hangGlider: { x: -320, z: -260, r: 16 },
    gyrocopter: { x: 70, z: 470, r: 12 },
    rocketBelt: { x: -200, z: 640, r: 12 },
  },
  landing: {
    hangGlider: { x: 150, z: 250, r: 42 },
    gyrocopter: { x: 480, z: 180, r: 36 },
    rocketBelt: { x: -60, z: 740, r: 26 },
  },
  runway: { ax: 40, az: 470, bx: 270, bz: 470, width: 26 },
  mountain: { x: -300, z: -400 },
  castle: { x: 400, z: -500 },
  statue: { x: 1500, z: -300 },
  lighthouse: { x: 650, z: 1300 },
  windmills: [[380, 400], [470, 440], [-440, 240], [-520, 330]],
  cabins: [[-330, 600], [-360, 640], [-310, 640], [-345, 575], [-60, 60], [-30, 90], [1380, -60], [1410, -30], [1350, -90], [250, -700], [280, -690]],
  bridge: { z: 380 },
  thermals: [
    { x: -150, z: -100, radius: 130, strength: 4.5 },
    { x: -520, z: -380, radius: 120, strength: 5.0 },
    { x: -320, z: -600, radius: 110, strength: 5.5 },
    { x: 250, z: -250, radius: 130, strength: 4.0 },
    { x: 600, z: -50, radius: 100, strength: 4.0 },
    { x: 1480, z: -100, radius: 100, strength: 4.0 },
    { x: -1300, z: 900, radius: 120, strength: 4.0 },
  ],
};

const ISLANDS = [
  { x: 0, z: 0, r: 1250, meadow: true, warp: 0.32, base: 55, hill: 95, det: 16 },
  { x: 1500, z: -250, r: 430, warp: 0.25, base: 50, hill: 60, det: 12 },
  { x: -1300, z: 850, r: 520, warp: 0.3, base: 45, hill: 70, det: 14 },
  { x: 650, z: 1300, r: 170, warp: 0.15, base: 16, hill: 8, det: 3 },
  { x: -1250, z: -1250, r: 330, warp: 0.3, base: 35, hill: 50, det: 10 },
  { x: 900, z: -1400, r: 260, warp: 0.3, base: 38, hill: 55, det: 10 },
  { x: -300, z: 1650, r: 200, warp: 0.2, base: 25, hill: 30, det: 6 },
];
const PEAKS = [
  { x: -300, z: -400, s: 280, amp: 380 },
  { x: 400, z: -500, s: 150, amp: 110 },
  { x: -700, z: -500, s: 220, amp: 200 },
  { x: 200, z: -900, s: 200, amp: 160 },
  { x: 1500, z: -450, s: 120, amp: 170 },
  { x: -1350, z: 850, s: 180, amp: 150 },
  { x: 800, z: -1400, s: 120, amp: 110 },
  { x: -1250, z: -1250, s: 110, amp: 100 },
];

function segDist(x, z, f) {
  const dx = f.bx - f.ax, dz = f.bz - f.az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - f.ax) * dx + (z - f.az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = f.ax + dx * t - x, pz = f.az + dz * t - z;
  return Math.sqrt(px * px + pz * pz);
}

export function createTerrain(seed = 1337) {
  const nA = new Noise(seed), nB = new Noise(seed * 7 + 13), nC = new Noise(seed * 3 + 5);

  function islandH(I, x, z) {
    const dx = x - I.x, dz = z - I.z;
    const d0 = Math.sqrt(dx * dx + dz * dz) / I.r;
    if (d0 > 1.7) return -SEA_DEPTH;
    const w = nA.fbm(x * 0.0016 + 3.1 + I.x * 0.013, z * 0.0016 + 7.7 + I.z * 0.013, 3);
    const d = d0 * (1 + I.warp * 1.4 * w);
    const t = 0.85 - d;
    if (t <= 0) { const k = Math.min(1, -t / 0.3); return -SEA_DEPTH * k * k * (3 - 2 * k); }
    const s = smoothstep(0, 0.3, t);
    const hills = nA.fbm(x * 0.0028 + I.x, z * 0.0028 + I.z, 4) * I.hill;
    const det = nB.fbm(x * 0.011, z * 0.011, 3) * I.det;
    // gentle meadow in the middle of the main island (pads, runway, landing zones)
    const m = I.meadow ? 1 - 0.92 * Math.exp(-((x - 150) * (x - 150) + (z - 450) * (z - 450)) / (2 * 450 * 450)) : 1;
    let cliff = 0;
    if (I.base > 30) {
      const cm = smoothstep(0.15, 0.5, nC.fbm(x * 0.0035 + I.x * 0.7, z * 0.0035 + I.z * 0.3, 2));
      cliff = cm * 26 * smoothstep(0.035, 0.085, t) * (1 - smoothstep(0.2, 0.5, t)) * (I.meadow ? 1 - 0.85 * Math.exp(-((x - 150) * (x - 150) + (z - 450) * (z - 450)) / (2 * 520 * 520)) : 1);
    }
    return 3 * smoothstep(0, 0.05, t) + s * (I.base + (hills + det) * m) + cliff;
  }
  function rawHeight(x, z) {
    let h = -SEA_DEPTH;
    for (let i = 0; i < ISLANDS.length; i++) { const v = islandH(ISLANDS[i], x, z); if (v > h) h = v; }
    if (h > 0) {
      for (let i = 0; i < PEAKS.length; i++) {
        const P = PEAKS[i], dx = x - P.x, dz = z - P.z, r2 = dx * dx + dz * dz;
        if (r2 < 9 * P.s * P.s) {
          const g = Math.exp(-r2 / (2 * P.s * P.s));
          h += P.amp * g * (0.85 + 0.7 * nB.fbm(x * 0.006 + P.x, z * 0.006 + P.z, 4));
        }
      }
      // canyon
      if (z > 0 && z < 1150) {
        const dd = Math.abs(x - canyonX(z));
        if (dd < 130) {
          const wgt = (1 - smoothstep(30, 130, dd)) * smoothstep(0, 350, z) * (1 - smoothstep(1000, 1100, z));
          if (h > -9) h = h * (1 - wgt) - 9 * wgt;
        }
      }
    }
    // gentle beach profile: halve the slope over the first 10 m of elevation
    if (h > 0) h = h < 10 ? 0.4 * h : h - 6;
    return h;
  }

  // flattened areas: pads, landing zones, runway, landmarks
  const flats = [];
  function addFlat(ax, az, bx, bz, r, blend, h) {
    const f = { ax, az, bx, bz, r, blend, h: 0 };
    f.h = h !== undefined ? h : Math.max(3, rawHeight((ax + bx) / 2, (az + bz) / 2));
    flats.push(f);
    return f;
  }
  const L = LAYOUT;
  addFlat(L.pads.hangGlider.x, L.pads.hangGlider.z, L.pads.hangGlider.x, L.pads.hangGlider.z, 34, 70);
  addFlat(L.landing.hangGlider.x, L.landing.hangGlider.z, L.landing.hangGlider.x, L.landing.hangGlider.z, 50, 40);
  addFlat(L.runway.ax, L.runway.az, L.runway.bx, L.runway.bz, 22, 40);
  addFlat(L.landing.gyrocopter.x, L.landing.gyrocopter.z, L.landing.gyrocopter.x, L.landing.gyrocopter.z, 44, 40);
  addFlat(L.pads.rocketBelt.x, L.pads.rocketBelt.z, L.pads.rocketBelt.x, L.pads.rocketBelt.z, 22, 30);
  addFlat(L.landing.rocketBelt.x, L.landing.rocketBelt.z, L.landing.rocketBelt.x, L.landing.rocketBelt.z, 32, 30);
  addFlat(L.castle.x, L.castle.z, L.castle.x, L.castle.z, 85, 60);
  addFlat(L.statue.x, L.statue.z, L.statue.x, L.statue.z, 90, 70);
  addFlat(L.lighthouse.x, L.lighthouse.z, L.lighthouse.x, L.lighthouse.z, 28, 30);
  for (const w of L.windmills) addFlat(w[0], w[1], w[0], w[1], 12, 15);

  // erosion-like detail: domain-warped ridged noise, gullies, micro relief (land only, damped over the flight meadow)
  function heightFn(x, z) {
    let h = rawHeight(x, z);
    if (h > 1.2) {
      const land = smoothstep(1.2, 14, h), hi = smoothstep(12, 260, h);
      const mm = 1 - 0.8 * Math.exp(-((x - 150) * (x - 150) + (z - 450) * (z - 450)) / (2 * 420 * 420));
      const wx = nC.n2(x * 0.004 + 11, z * 0.004) * 45, wz = nC.n2(x * 0.004, z * 0.004 + 23) * 45;
      const rg = nB.ridged((x + wx) * 0.007, (z + wz) * 0.007, 4);
      const gu = nA.ridged((x + wz) * 0.022, (z + wx) * 0.022, 3);
      const mi = nC.fbm(x * 0.09, z * 0.09, 2);
      h += land * mm * ((rg - 0.4) * 30 * (0.2 + hi) + (gu - 0.4) * (2.5 + 7 * hi) + mi * (0.5 + 1.3 * hi));
    }
    for (let i = 0; i < flats.length; i++) {
      const f = flats[i];
      const d = segDist(x, z, f);
      if (d < f.r + f.blend) h += (f.h - h) * (1 - smoothstep(f.r, f.r + f.blend, d));
    }
    return h;
  }

  // ---- height grid ----
  const H = new Float32Array(NV * NV);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) H[j * NV + i] = heightFn(-HALF + i * CELL, -HALF + j * CELL);

  function heightAt(x, z) {
    const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -SEA_DEPTH;
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
    const o = j * NV + i;
    const h00 = H[o], h10 = H[o + 1], h01 = H[o + NV], h11 = H[o + NV + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  function slopeAt(x, z) {
    const e = CELL * 0.6;
    const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return Math.sqrt(gx * gx + gz * gz);
  }
  function surfaceAt(x, z) {
    const h = heightAt(x, z);
    if (h < 0.35) return 'water';
    for (const k in L.pads) { const p = L.pads[k]; if (Math.hypot(x - p.x, z - p.z) < p.r + 2) return 'pad'; }
    for (const k in L.landing) { const p = L.landing[k]; if (Math.hypot(x - p.x, z - p.z) < p.r) return 'pad'; }
    if (segDist(x, z, L.runway) < L.runway.width / 2) return 'pad';
    const s = slopeAt(x, z);
    if (h > 330 && s < 0.9) return 'snow';
    if (s > 0.55 || h > 250) return 'rock';
    if (h < 4.5) return 'sand';
    return 'grass';
  }
  // Is (x,z) inside a flattened area or landmark keep-out? margin in metres.
  function isBlocked(x, z, margin = 0) {
    for (let i = 0; i < flats.length; i++) { const f = flats[i]; if (segDist(x, z, f) < f.r + f.blend * 0.6 + margin) return true; }
    for (const c of L.cabins) if (Math.hypot(x - c[0], z - c[1]) < 14 + margin) return true;
    if (z > -50 && z < 1150 && Math.abs(x - canyonX(z)) < 150) return true;
    return false;
  }

  // ---- peak of main mountain ----
  let peak = { x: L.mountain.x, z: L.mountain.z, h: 0 };
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    if ((x - L.mountain.x) ** 2 + (z - L.mountain.z) ** 2 < 250 * 250 && H[j * NV + i] > peak.h) peak = { x, z, h: H[j * NV + i] };
  }

  // ---- mesh: LOD chunks with skirts, PBR splat material ----
  const cc = (h) => new THREE.Color(h);
  const COL = {
    seabed: cc(0x1b8a96), underSand: cc(0xd8c890), sand: cc(0xf0dca0), grassA: cc(0x5cbc3c), grassB: cc(0x9ccc3c),
    grassHi: cc(0x3a8a3c), dry: cc(0xe0b856), rockA: cc(0x8d7f6d), rockB: cc(0x6e6a68), snow: cc(0xf6f9ff), flower: cc(0xe8d84a),
  };
  const tmp = new THREE.Color();
  function colourAt(i, j, step, out) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, h = H[j * NV + i];
    const il = Math.max(i - step, 0), ir = Math.min(i + step, N), jl = Math.max(j - step, 0), jr = Math.min(j + step, N);
    const gx = (H[j * NV + ir] - H[j * NV + il]) / ((ir - il) * CELL), gz = (H[jr * NV + i] - H[jl * NV + i]) / ((jr - jl) * CELL);
    const slope = Math.sqrt(gx * gx + gz * gz);
    if (h < 0) { out.copy(COL.underSand).lerp(COL.seabed, smoothstep(0, -22, h)); return out; }
    const n1 = nC.fbm(x * 0.02, z * 0.02, 2), n2 = nC.fbm(x * 0.004 + 40, z * 0.004, 3);
    out.copy(COL.grassA).lerp(COL.grassB, clamp(0.5 + n2 * 1.3, 0, 1));
    if (n1 > 0.35) out.lerp(COL.flower, 0.25);
    out.lerp(COL.grassHi, smoothstep(50, 230, h));
    let dry = 0;
    for (const t of L.thermals) { const d = Math.hypot(x - t.x, z - t.z) / t.radius; if (d < 1) dry = Math.max(dry, (1 - d * d) * 0.6); }
    if (dry > 0) out.lerp(COL.dry, dry);
    out.lerp(COL.sand, 1 - smoothstep(1.8, 4.2, h + n1 * 1.6));
    const rock = Math.max(smoothstep(0.45, 0.85, slope), smoothstep(190, 290, h + n1 * 25));
    if (rock > 0) { tmp.copy(COL.rockA).lerp(COL.rockB, clamp(0.5 + n1 * 1.6, 0, 1)); out.lerp(tmp, rock); }
    const snow = smoothstep(315, 350, h + n1 * 18) * (1 - smoothstep(0.7, 1.4, slope) * 0.7);
    if (snow > 0) out.lerp(COL.snow, snow);
    return out;
  }
  const Hc = (i, j) => H[(j < 0 ? 0 : j > N ? N : j) * NV + (i < 0 ? 0 : i > N ? N : i)];
  const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
  function aoAt(i, j, h) {   // cavity / convexity from two neighbourhood radii (baked ambient occlusion)
    let a = 0, b = 0;
    for (const r of RING) {
      a += Hc(Math.round(i + r[0] * 4), Math.round(j + r[1] * 4));
      b += Hc(Math.round(i + r[0] * 16), Math.round(j + r[1] * 16));
    }
    const cav = clamp((a / 8 - h) / 5, -1, 1) * 0.6 + clamp((b / 8 - h) / 30, -1, 1) * 0.4;
    return clamp(cav > 0 ? 1 - 0.6 * cav : 1 - 0.12 * cav, 0.35, 1.08);
  }

  const CH = 16, CSZ = N / CH, CWORLD = CSZ * CELL;
  const LOD_STEPS = [1, 2, 5, 10];
  const Q = window.SW_QUALITY || 'high';
  const LOD_DIST = Q === 'low' ? [300, 650, 1300] : Q === 'medium' ? [400, 800, 1600] : [520, 1000, 1900];
  const col = new THREE.Color();
  function buildGeo(ci, cj, lod) {
    const step = LOD_STEPS[lod], n = CSZ / step, CV = n + 1, base = CV * CV, total = base + 4 * CV;
    const skirt = 3 + step * 3;
    const pos = new Float32Array(total * 3), tint = new Float32Array(total * 3), nor = new Float32Array(total * 3), ao = new Float32Array(total);
    for (let vj = 0; vj < CV; vj++) for (let vi = 0; vi < CV; vi++) {
      const gi = ci * CSZ + vi * step, gj = cj * CSZ + vj * step, k = vj * CV + vi, o = k * 3, h = H[gj * NV + gi];
      pos[o] = -HALF + gi * CELL; pos[o + 1] = h; pos[o + 2] = -HALF + gj * CELL;
      colourAt(gi, gj, step, col);
      tint[o] = col.r; tint[o + 1] = col.g; tint[o + 2] = col.b;
      const il = Math.max(gi - step, 0), ir = Math.min(gi + step, N), jl = Math.max(gj - step, 0), jr = Math.min(gj + step, N);
      const nx = -(H[gj * NV + ir] - H[gj * NV + il]) / ((ir - il) * CELL), nz = -(H[jr * NV + gi] - H[jl * NV + gi]) / ((jr - jl) * CELL);
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      nor[o] = nx * inv; nor[o + 1] = inv; nor[o + 2] = nz * inv;
      ao[k] = h < -1 ? 1 : aoAt(gi, gj, h);
    }
    const idx = [];
    for (let vj = 0; vj < n; vj++) for (let vi = 0; vi < n; vi++) {
      const a = vj * CV + vi, b = a + 1, c = a + CV, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirts: N (vj=0), S (vj=n), W (vi=0), E (vi=n)
    const edges = [
      [(t) => t, false], [(t) => n * CV + t, true], [(t) => t * CV, true], [(t) => t * CV + n, false],
    ];
    for (let e = 0; e < 4; e++) {
      const get = edges[e][0], flip = edges[e][1], sb = base + e * CV;
      for (let t = 0; t < CV; t++) {
        const src = get(t), d = (sb + t) * 3, s3 = src * 3;
        pos[d] = pos[s3]; pos[d + 1] = pos[s3 + 1] - skirt; pos[d + 2] = pos[s3 + 2];
        tint[d] = tint[s3]; tint[d + 1] = tint[s3 + 1]; tint[d + 2] = tint[s3 + 2];
        nor[d] = nor[s3]; nor[d + 1] = nor[s3 + 1]; nor[d + 2] = nor[s3 + 2];
        ao[sb + t] = ao[src];
      }
      for (let t = 0; t < n; t++) {
        const e0 = get(t), e1 = get(t + 1), s0 = sb + t, s1 = sb + t + 1;
        if (!flip) idx.push(e0, e1, s0, e1, s1, s0); else idx.push(e0, s0, e1, e1, s0, s1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    g.setAttribute('aoA', new THREE.BufferAttribute(ao, 1));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  const material = createTerrainMaterial(Q);
  const group = new THREE.Group();
  group.name = 'terrain';
  // Far tiers are merged (HISTORY.md #932). A chunk at LOD 2 or 3 is 280 or 90 triangles and was a
  // draw of its own, 60 to 181 of them a frame. The chunks of one square (SQ x SQ chunks, 1 km a
  // side) that are at a far tier are one mesh, rebuilt on the update in which one of them changes
  // tier; a chunk at LOD 0 or 1 is still its own mesh. A square is culled as one box.
  const SQ = 4, FAR = 2, SN = CH / SQ, EMPTY = new THREE.BufferGeometry();
  const squares = [];
  for (let k = 0; k < SN * SN; k++) {
    const q = { chunks: [], far: [], dirty: true, mesh: new THREE.Mesh(EMPTY, material) };
    q.mesh.name = 'far'; q.mesh.matrixAutoUpdate = false; q.mesh.receiveShadow = true; q.mesh.visible = false;
    // castShadow is ours to set (below), not render/index.js's scan's: true until the first render says otherwise
    q.mesh.castShadow = true; q.mesh.userData.noCast = true;
    group.add(q.mesh); squares.push(q);
  }
  const chunks = [];
  for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CH; ci++) {
    const c = { ci, cj, cx: -HALF + (ci + 0.5) * CWORLD, cz: -HALF + (cj + 0.5) * CWORLD, geos: [null, null, null, null], lod: 3 };
    c.geos[3] = buildGeo(ci, cj, 3);
    c.mesh = new THREE.Mesh(c.geos[3], material);
    c.mesh.matrixAutoUpdate = false;
    c.mesh.receiveShadow = true;
    c.mesh.visible = false;                  // every chunk starts at LOD 3, in its square's mesh
    c.square = squares[((cj / SQ) | 0) * SN + ((ci / SQ) | 0)]; c.square.chunks.push(c);
    group.add(c.mesh);
    chunks.push(c);
  }
  function setLod(c, lod) {
    if (c.lod >= FAR || lod >= FAR) c.square.dirty = true;
    c.lod = lod; c.mesh.geometry = c.geos[lod]; c.mesh.visible = lod < FAR;
  }
  function mergeSquare(q) {
    q.dirty = false;
    q.far = q.chunks.filter((c) => c.lod >= FAR);
    if (q.mesh.geometry !== EMPTY) q.mesh.geometry.dispose();
    q.mesh.geometry = EMPTY; q.mesh.visible = q.far.length > 0;
    if (!q.far.length) return;
    let nv = 0, ni = 0;
    for (const c of q.far) { const g = c.geos[c.lod]; nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), tint = new Float32Array(nv * 3), ao = new Float32Array(nv), idx = new Uint16Array(ni);
    let v = 0, i = 0;
    for (const c of q.far) {          // chunk vertices are in world space already, so this is a copy
      const g = c.geos[c.lod], a = g.attributes, src = g.index.array;
      pos.set(a.position.array, v * 3); nor.set(a.normal.array, v * 3); tint.set(a.tint.array, v * 3); ao.set(a.aoA.array, v);
      for (let k = 0; k < src.length; k++) idx[i + k] = src[k] + v;
      v += a.position.count; i += src.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    g.setAttribute('aoA', new THREE.BufferAttribute(ao, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    q.mesh.geometry = g;
  }
  for (const q of squares) mergeSquare(q);
  // A square casts while one of its far chunks would have: three's own test of that chunk's sphere
  // against the sun's shadow box. Tested on the square's own sphere it would cast from most of the island.
  eachRender((camera, box) => {
    for (const q of squares) if (q.far.length) q.mesh.castShadow = box !== null && q.far.some((c) => box.intersectsSphere(c.geos[c.lod].boundingSphere));
  });
  const lodOf = (d) => (d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : d < LOD_DIST[2] ? 2 : 3);
  let firstUpdate = true;
  function update(cam, budget = 2) {
    if (!cam) return;
    if (firstUpdate) { budget = 60; firstUpdate = false; }
    const cands = [];
    for (const c of chunks) {
      const dx = Math.max(Math.abs(cam.x - c.cx) - CWORLD / 2, 0), dz = Math.max(Math.abs(cam.z - c.cz) - CWORLD / 2, 0);
      const dy = 0.5 * Math.max(cam.y - 40, 0);
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
      const want = Math.min(Math.max(c.lod, lodOf(d * 0.92)), lodOf(d * 1.08));
      if (want === c.lod) continue;
      if (c.geos[want]) setLod(c, want); else cands.push([d, c, want]);
    }
    if (cands.length) {
      cands.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < cands.length && budget > 0; k++, budget--) {
        const [, c, want] = cands[k];
        c.geos[want] = buildGeo(c.ci, c.cj, want);
        setLod(c, want);
      }
    }
    for (const q of squares) if (q.dirty) mergeSquare(q);
  }

  return { group, heightAt, slopeAt, surfaceAt, isBlocked, H, flats, peak, noise: nA, update, material };
}

// ---------------------------------------------------------------------------------------------
// PBR splat material: MeshStandardMaterial patched with height/slope splatting, triplanar rock,
// anti-tiling, detail normals, baked AO and macro tint.
const TEX_DIR = new URL('../../assets/tex/', import.meta.url).href;
function createTerrainMaterial(Q) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const loader = new THREE.TextureLoader();
  const avg = [0, 1, 2, 3].map(() => new THREE.Vector3(0.4, 0.4, 0.4));
  const names = ['aerial_grass_rock', 'rocky_terrain_02', 'coast_sand_rocks_02', 'snow_field_aerial'];
  const load = (file, srgb, ai) => {
    const t = loader.load(TEX_DIR + file, (tx) => {
      if (ai === undefined) return;
      try {
        const cv = document.createElement('canvas'); cv.width = cv.height = 8;
        const cx = cv.getContext('2d'); cx.drawImage(tx.image, 0, 0, 8, 8);
        const d = cx.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const f = 1 / (64 * 255), c = new THREE.Color(r * f, g * f, b * f).convertSRGBToLinear();
        avg[ai].set(c.r, c.g, c.b);
      } catch (e) { /* keep default */ }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Q === 'low' ? 2 : 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const U = {
    tD: { value: names.map((n, i) => load(n + '_Diffuse.jpg', true, i)) },
    tN: { value: names.map((n) => load(n + '_nor_gl.jpg', false)) },
    uAvg: { value: avg },
  };
  const tri = Q === 'low' ? '' : '#define TRIPLANAR\n';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tD0 = { value: U.tD.value[0] }; sh.uniforms.tD1 = { value: U.tD.value[1] };
    sh.uniforms.tD2 = { value: U.tD.value[2] }; sh.uniforms.tD3 = { value: U.tD.value[3] };
    sh.uniforms.tN0 = { value: U.tN.value[0] }; sh.uniforms.tN1 = { value: U.tN.value[1] };
    sh.uniforms.tN2 = { value: U.tN.value[2] }; sh.uniforms.tN3 = { value: U.tN.value[3] };
    sh.uniforms.uAvg = U.uAvg;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'attribute vec3 tint; attribute float aoA; varying vec3 vTint; varying float vAo; varying vec3 vWPos; varying vec3 vWN;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = tint; vAo = aoA; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
    const pars = tri + `
uniform sampler2D tD0, tD1, tD2, tD3, tN0, tN1, tN2, tN3; uniform vec3 uAvg[4];
varying vec3 vTint; varying float vAo; varying vec3 vWPos; varying vec3 vWN;
float sh_hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sh_vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(sh_hash(i), sh_hash(i+vec2(1,0)), f.x), mix(sh_hash(i+vec2(0,1)), sh_hash(i+vec2(1,1)), f.x), f.y); }
float sh_fbm(vec2 p){ return sh_vn(p)*0.55 + sh_vn(p*2.13+7.0)*0.3 + sh_vn(p*4.7+3.0)*0.15; }
vec2 sh_rot(vec2 p){ return mat2(0.8, -0.6, 0.6, 0.8) * p; }
// anti-tiling: blend a second, rotated & larger-scale sample in by distance and a noise mask
vec4 sh_tex(sampler2D t, vec2 p, float tile, float far, float mask){
  vec4 a = texture2D(t, p * tile);
  vec4 b = texture2D(t, sh_rot(p) * tile * 0.137 + 0.31);
  return mix(a, b, clamp(far * 0.8 + mask * 0.55, 0.0, 0.92));
}
struct SplatOut { vec3 albedo; vec3 pert; float rough; float wRock; };
SplatOut sh_splat(vec3 wp, vec3 N, vec3 tint){
  SplatOut o;
  float dist = length(wp - cameraPosition);
  float far = smoothstep(50.0, 320.0, dist);
  float nfade = 1.0 - smoothstep(60.0, 420.0, dist);
  vec2 p = wp.xz;
  float mask = smoothstep(0.3, 0.7, sh_vn(p * 0.03 + sh_vn(p * 0.011) * 3.0));
  float nz = sh_fbm(p * 0.02) - 0.5;
  float h = wp.y;
  // weights
  float wSand = 1.0 - smoothstep(2.0, 4.6, h + nz * 3.0);
  float slopeT = 1.0 - smoothstep(0.66, 0.83, N.y + nz * 0.08);
  float wRock = max(slopeT, smoothstep(190.0, 290.0, h + nz * 50.0));
  float wSnow = smoothstep(315.0, 350.0, h + nz * 36.0) * (1.0 - 0.75 * slopeT);
  vec4 g = sh_tex(tD0, p, 0.17, far, mask);
  vec4 s = sh_tex(tD2, p, 0.2, far, mask);
  vec4 sn = sh_tex(tD3, p, 0.15, far, mask);
  // height-blend: let texture brightness sharpen transitions
  float gl = dot(g.rgb, vec3(0.333));
  wRock = clamp((wRock - 0.5) * 2.2 + 0.5 + (0.5 - gl) * 0.35 * step(0.001, wRock), 0.0, 1.0);
  // triplanar rock
  vec3 bw = pow(abs(N), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  float rt = 0.11;
  #ifdef TRIPLANAR
  vec4 rY = sh_tex(tD1, wp.xz, rt, far, mask);
  vec4 rX = sh_tex(tD1, vec2(wp.z, -wp.y), rt, far, mask);
  vec4 rZ = sh_tex(tD1, vec2(wp.x, -wp.y), rt, far, mask);
  vec4 r = rX * bw.x + rY * bw.y + rZ * bw.z;
  #else
  vec4 r = sh_tex(tD1, wp.xz, rt, far, mask);
  #endif
  // rock strata
  r.rgb *= 0.94 + 0.12 * sin(wp.y * 0.35 + nz * 14.0);
  float wS = clamp(wSand, 0.0, 1.0), wSn = clamp(wSnow, 0.0, 1.0);
  float wG = (1.0 - wS) * (1.0 - wRock);
  float wR = wRock * (1.0 - wS);
  float wSd = wS;
  // snow overrides
  float wSNW = wSn * (1.0 - wS);
  wG *= (1.0 - wSNW); wR *= (1.0 - wSNW);
  vec3 col = g.rgb * wG + r.rgb * wR + s.rgb * wSd + sn.rgb * wSNW;
  float wt = wG + wR + wSd + wSNW + 1e-4;
  col /= wt;
  vec3 avgC = (uAvg[0] * wG + uAvg[1] * wR + uAvg[2] * wSd + uAvg[3] * wSNW) / wt;
  vec3 shift = clamp(tint / max(avgC, vec3(0.02)), vec3(0.25), vec3(3.5));
  col *= mix(vec3(1.0), shift, 0.75 * (wG + wSd + wSNW) / wt + 0.35 * wR / wt);
  // wet sand near waterline
  float wet = (1.0 - smoothstep(0.2, 1.6, h + nz * 1.5)) * wSd;
  col *= 1.0 - 0.22 * wet;
  o.albedo = col;
  o.rough = (0.92 * wG + 0.86 * wR + mix(0.95, 0.42, wet) * wSd + 0.55 * wSNW) / wt;
  // detail normals (UDN-style perturbation in world space)
  vec2 nGr = texture2D(tN0, p * 0.22).xy * 2.0 - 1.0;
  vec2 nSd = texture2D(tN2, p * 0.2).xy * 2.0 - 1.0;
  vec2 nSn = texture2D(tN3, p * 0.15).xy * 2.0 - 1.0;
  vec2 nFar = texture2D(tN0, sh_rot(p) * 0.03 + 0.2).xy * 2.0 - 1.0;
  vec3 pTop = vec3(nGr.x, 0.0, nGr.y) * wG * 0.9 + vec3(nSd.x, 0.0, nSd.y) * wSd * 0.6 + vec3(nSn.x, 0.0, nSn.y) * wSNW * 0.5;
  pTop *= nfade;
  vec3 pFar = vec3(nFar.x, 0.0, nFar.y) * 0.35 * (wG + wSd + wSNW) * (0.3 + 0.7 * far);
  vec2 rnY = texture2D(tN1, wp.xz * rt).xy * 2.0 - 1.0;
  #ifdef TRIPLANAR
  vec2 rnX = texture2D(tN1, vec2(wp.z, -wp.y) * rt).xy * 2.0 - 1.0;
  vec2 rnZ = texture2D(tN1, vec2(wp.x, -wp.y) * rt).xy * 2.0 - 1.0;
  vec3 pRock = (vec3(rnY.x, 0.0, rnY.y) * bw.y + vec3(0.0, rnX.y, rnX.x) * bw.x + vec3(rnZ.x, rnZ.y, 0.0) * bw.z) * 1.3;
  #else
  vec3 pRock = vec3(rnY.x, 0.0, rnY.y) * 1.2;
  #endif
  pRock *= wR * (1.0 - 0.7 * far);
  o.pert = (pTop + pFar + pRock) / wt;
  o.wRock = wR;
  return o;
}
`;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', pars + '\nSplatOut gSp;\nvoid main() {')
      .replace('#include <map_fragment>', 'gSp = sh_splat(vWPos, normalize(vWN), vTint);\ndiffuseColor.rgb = gSp.albedo;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gSp.rough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(normalize(normalize(vWN) + gSp.pert), 0.0)).xyz);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAo; reflectedLight.directDiffuse *= mix(1.0, vAo, 0.45);');
  };
  mat.customProgramCacheKey = () => 'sw-terrain-' + Q;
  return mat;
}
