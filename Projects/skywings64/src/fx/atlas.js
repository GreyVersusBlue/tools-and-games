// SkyWings 64 - atlas.js : procedural canvas flipbook atlas (smoke / fire / explosion / spark / splash / dust / misc)
// Layout: 8 columns x 8 rows of 128px cells (1024x1024). Row index -> ROWS below.
// Channels: RGB = shading / heat (grey), A = density.  Shaders tint with per-particle colour.
import * as THREE from 'three';

export const ROWS = { smoke: 0, fire: 1, explosion: 2, spark: 3, splash: 4, dust: 5, misc: 6, ember: 7 };
export const GRID = 8;
const CELL = 128;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// tileable value noise lattice
const N = 32;
let LAT = null;
function lattice() {
  if (LAT) return LAT;
  const r = rng(1337);
  LAT = new Float32Array(N * N);
  for (let i = 0; i < LAT.length; i++) LAT[i] = r();
  return LAT;
}
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y) {
  const L = lattice();
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = sm(x - xi), fy = sm(y - yi);
  const x0 = ((xi % N) + N) % N, y0 = ((yi % N) + N) % N;
  const x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
  const a = L[y0 * N + x0], b = L[y0 * N + x1], c = L[y1 * N + x0], d = L[y1 * N + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// density functions: (u,v in -1..1, frame 0..7 -> f01, seed) -> 0..1
function puffDensity(u, v, f, seed, erode, scale) {
  const r = Math.sqrt(u * u + v * v);
  const ox = seed * 7.3 + f * 0.9, oy = seed * 3.1 - f * 0.6;
  const wx = fbm(u * 1.6 + ox, v * 1.6 + oy, 2) - 0.5;
  const wy = fbm(u * 1.6 - oy, v * 1.6 + ox, 2) - 0.5;
  const n = fbm((u + wx * 0.9) * scale + ox, (v + wy * 0.9) * scale + oy, 4);
  const edge = 1 - sstep(0.25, 0.98, r + (n - 0.5) * 0.55);
  return Math.max(0, Math.min(1, (n * 1.25 - erode) * 1.9 * edge + edge * 0.25 - erode * 0.15));
}

function fillCell(img, col, row, fn) {
  const W = GRID * CELL;
  const data = img.data;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const u = (x + 0.5) / CELL * 2 - 1, v = (y + 0.5) / CELL * 2 - 1;
      const o = ((row * CELL + y) * W + (col * CELL + x)) * 4;
      const p = fn(u, v);
      const lum = Math.max(0, Math.min(1, p[0])) * 255;
      data[o] = lum; data[o + 1] = lum; data[o + 2] = lum;
      data[o + 3] = Math.max(0, Math.min(1, p[1])) * 255;
    }
  }
}

let _atlas = null;
export function getAtlas() {
  if (_atlas) return _atlas;
  const W = GRID * CELL;
  const cv = document.createElement('canvas');
  cv.width = cv.height = W;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, W);
  const light = 0.11;

  for (let f = 0; f < 8; f++) {
    const f01 = f / 7;
    // --- smoke : lit puff, dissipating over the flipbook
    for (const [row, seed, scale, er0] of [[ROWS.smoke, 1.7, 2.0, 0.22], [ROWS.dust, 5.2, 2.6, 0.30]]) {
      fillCell(img, f, row, (u, v) => {
        const erode = er0 + f01 * 0.30;
        const d = puffDensity(u, v, f, seed, erode, scale);
        const d2 = puffDensity(u - light * 2, v - light * 2, f, seed, erode, scale);
        const shade = 0.62 + (d2 - d) * 2.4 + (1 - d) * 0.05 - (v * 0.12);
        return [shade, d * (1 - f01 * 0.35)];
      });
    }
    // --- fire : hot core, licks of flame, shrinking
    fillCell(img, f, ROWS.fire, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      const rr = r / (1.0 - f01 * 0.35);
      const n = fbm(u * 3 + f * 0.7, v * 3 - f * 1.3, 4);
      const heat = Math.max(0, 1 - rr * 1.15 + (n - 0.5) * 0.9) * (1 - f01 * 0.5);
      return [Math.min(1, heat * 1.3), Math.min(1, heat * 1.5)];
    });
    // --- explosion fireball: bulbous lumps, hot centre, cooling smoky rim in later frames
    fillCell(img, f, ROWS.explosion, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      const n = fbm(u * 2.4 + f * 0.35, v * 2.4 + f * 0.2, 4);
      const body = 1 - sstep(0.2, 1.0, r + (n - 0.5) * 0.7);
      const core = Math.max(0, 1 - r * (1.2 + f01 * 1.0) + (n - 0.5) * 0.6) * (1 - f01 * 0.7);
      const a = body * (0.95 - f01 * 0.25);
      return [Math.min(1, 0.25 + core * 1.2) * (1 - f01 * 0.4), a];
    });
    // --- embers (soft) row: varied glows
    fillCell(img, f, ROWS.ember, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      const k = 1 + (f % 4) * 0.4;
      const a = Math.pow(Math.max(0, 1 - r), 1.6 * k);
      return [a, a];
    });
  }
  // --- sparks (cols 0..3 glow variants, 4..7 streaks ( long axis = x ))
  for (let c = 0; c < 8; c++) {
    fillCell(img, c, ROWS.spark, (u, v) => {
      if (c < 4) {
        const r = Math.sqrt(u * u + v * v);
        const a = Math.pow(Math.max(0, 1 - r), 1.5 + c * 0.6);
        const core = Math.pow(Math.max(0, 1 - r * 2.2), 2);
        return [Math.min(1, a + core), Math.min(1, a * 1.2)];
      }
      const ax = Math.abs(u), ay = Math.abs(v) * (4 + (c - 4) * 2);
      const a = Math.pow(Math.max(0, 1 - ax), 1.5) * Math.pow(Math.max(0, 1 - ay), 2.2);
      return [Math.min(1, a * 1.4), a];
    });
  }
  // --- splash row: 0..3 droplets (round with highlight), 4..7 foam blobs
  for (let c = 0; c < 8; c++) {
    fillCell(img, c, ROWS.splash, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      if (c < 4) {
        const body = 1 - sstep(0.55, 0.75, r);
        const hl = Math.pow(Math.max(0, 1 - Math.hypot(u + 0.22, v + 0.22) * 2.6), 2);
        return [0.72 + hl * 0.5 + (v * 0.1), body * 0.92];
      }
      const n = fbm(u * 3.2 + c * 3.1, v * 3.2 - c, 4);
      const body = 1 - sstep(0.35, 0.95, r + (n - 0.5) * 0.9);
      const sh = 0.8 + (n - 0.5) * 0.5 - v * 0.1;
      return [sh, body * (0.9 + (n - 0.5))];
    });
  }
  // --- misc row: 0 soft glow, 1 square confetti, 2 leaf/grass, 3 thin ring, 4 chunk, 5 wisp, 6 dot, 7 diamond
  for (let c = 0; c < 8; c++) {
    fillCell(img, c, ROWS.misc, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      switch (c) {
        case 0: { const a = Math.pow(Math.max(0, 1 - r), 1.6); return [a, a]; }
        case 1: return [1, (Math.abs(u) < 0.72 && Math.abs(v) < 0.5) ? 1 : 0];
        case 2: { // blade / leaf
          const t = (v + 1) / 2, w = 0.28 * Math.sin(Math.PI * t) * (1 - t * 0.2);
          return [0.75 + u * 0.2, Math.abs(u - (t - 0.5) * 0.3) < w ? 1 : 0];
        }
        case 3: { const a = Math.max(0, 1 - Math.abs(r - 0.82) * 9); return [a, a]; }
        case 4: { // angular chunk
          const a = (Math.abs(u) + Math.abs(v) * 1.15 + fbm(u * 3 + 9, v * 3, 2) * 0.35) < 0.95 ? 1 : 0;
          return [0.55 + (u - v) * 0.25, a];
        }
        case 5: { const n = fbm(u * 2 + 4, v * 6, 3); const a = Math.max(0, 1 - Math.abs(v) * 1.2) * Math.max(0, 1 - Math.abs(u)) * n * 1.6; return [1, a]; }
        case 6: { const a = 1 - sstep(0.6, 0.72, r); return [1, a]; }
        default: { const a = (Math.abs(u) + Math.abs(v)) < 0.8 ? 1 : 0; return [1, a]; }
      }
    });
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  _atlas = { texture: tex, canvas: cv };
  return _atlas;
}

export function disposeAtlas() { if (_atlas) { _atlas.texture.dispose(); _atlas = null; } }
