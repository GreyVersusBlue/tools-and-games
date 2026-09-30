import * as THREE from 'three';
import { fbm, mulberry32 } from './noise.js';

const BASE = 'assets/world/';
export const assetUrl = (p) => BASE + p;

// Terrain layer order (index in texture arrays)
export const LAYERS = [
  { name: 'grass', file: 'Grass004', fallback: [74, 110, 40] },
  { name: 'dirt', file: 'Ground023', fallback: [110, 88, 60] },
  { name: 'stone', file: 'PavingStones070', fallback: [140, 136, 128] },
  { name: 'rock', file: 'Rock030', fallback: [100, 96, 90] },
  { name: 'duskward', file: 'Ground048', fallback: [70, 45, 35] },
  { name: 'gravel', file: 'Gravel022', fallback: [120, 112, 100] },
];

async function loadImageData(url, size) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch ' + url);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close?.();
  return ctx.getImageData(0, 0, size, size).data;
}

function fallbackData(size, rgb, isNormal, seed) {
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (isNormal) { d[i] = 128; d[i + 1] = 128; d[i + 2] = 255; d[i + 3] = 255; continue; }
    const n = fbm((x / size) * 16, (y / size) * 16, 4, seed) * 0.5 + 0.5;
    d[i] = rgb[0] * (0.7 + n * 0.6); d[i + 1] = rgb[1] * (0.7 + n * 0.6); d[i + 2] = rgb[2] * (0.7 + n * 0.6); d[i + 3] = 255;
  }
  return d;
}

// Loads all terrain layers into two DataArrayTextures (albedo sRGB, normal linear).
export async function loadTerrainLayers(size = 1024, onProgress = () => {}) {
  const n = LAYERS.length;
  const alb = new Uint8Array(size * size * 4 * n);
  const nrm = new Uint8Array(size * size * 4 * n);
  const avg = [];
  let done = 0;
  await Promise.all(LAYERS.map(async (L, li) => {
    let a, b;
    try { a = await loadImageData(assetUrl(`tex/${L.file}_c.jpg`), size); } catch (e) { a = fallbackData(size, L.fallback, false, li); }
    try { b = await loadImageData(assetUrl(`tex/${L.file}_n.jpg`), size); } catch (e) { b = fallbackData(size, L.fallback, true, li); }
    alb.set(a, li * size * size * 4);
    nrm.set(b, li * size * size * 4);
    let r = 0, g = 0, bl = 0, cnt = 0;
    for (let i = 0; i < a.length; i += 4 * 97) { r += a[i]; g += a[i + 1]; bl += a[i + 2]; cnt++; }
    avg[li] = [r / cnt, g / cnt, bl / cnt];
    onProgress(++done / n);
  }));
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, size, size, n);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(alb, true), normal: mk(nrm, false), avg };
}

// Tileable RGBA noise texture (4 independent fbm channels), used for macro variation / foam / wind.
export function makeNoiseTexture(size = 256) {
  const d = new Uint8Array(size * size * 4);
  const P = 8; // periodic via sampling on a torus
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const ax = (x / size) * Math.PI * 2, ay = (y / size) * Math.PI * 2;
    const cx = Math.cos(ax) * P / (2 * Math.PI), sx = Math.sin(ax) * P / (2 * Math.PI);
    const cy = Math.cos(ay) * P / (2 * Math.PI), sy = Math.sin(ay) * P / (2 * Math.PI);
    for (let c = 0; c < 4; c++) {
      // 4D-ish: combine two 2D fbms of the torus coordinates
      const v = fbm(cx * 3 + sy * 1.7 + c * 13, sx * 3 + cy * 2.3, 5, c * 7 + 1) * 0.5
        + fbm(cy * 3 + sx * 1.1, sy * 3 + cx * 0.9 + c * 5, 5, c * 11 + 3) * 0.5;
      d[i + c] = Math.max(0, Math.min(255, (v * 1.4 + 0.5) * 255));
    }
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function loadTexture(path, { srgb = true, repeat = true } = {}) {
  const t = new THREE.TextureLoader().load(assetUrl(path), undefined, undefined, () => {});
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Procedural grass-blade sprite (alpha) for grass tufts
export function makeGrassSprite() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const rnd = mulberry32(99);
  for (let i = 0; i < 26; i++) {
    const x0 = 20 + rnd() * 88, lean = (rnd() - 0.5) * 50, h = 60 + rnd() * 64, w = 3 + rnd() * 4;
    const grad = g.createLinearGradient(0, 128, 0, 128 - h);
    const l = 0.55 + rnd() * 0.45;
    grad.addColorStop(0, `rgba(${40 * l | 0},${70 * l | 0},${25 * l | 0},1)`);
    grad.addColorStop(1, `rgba(${200 * l | 0},${230 * l | 0},${140 * l | 0},1)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - w, 128);
    g.quadraticCurveTo(x0 + lean * 0.3, 128 - h * 0.5, x0 + lean, 128 - h);
    g.quadraticCurveTo(x0 + lean * 0.3 + w * 0.5, 128 - h * 0.5, x0 + w, 128);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeFlowerSprite() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const rnd = mulberry32(7);
  g.strokeStyle = 'rgb(50,90,30)'; g.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const x = 20 + rnd() * 88, y = 30 + rnd() * 50;
    g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + (rnd() - 0.5) * 20, (y + 128) / 2, x, y); g.stroke();
    g.fillStyle = 'white';
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      g.beginPath(); g.arc(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgb(255,210,60)'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft radial glow sprite (flames, embers, fireflies)
export function makeGlowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}
