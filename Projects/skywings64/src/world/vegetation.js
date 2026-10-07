// SkyWings 64 - vegetation: thousands of instanced trees (pine / broadleaf / palm), bushes, rocks, grass + flower tufts.
// * 320 m cells with 3-tier LOD (full mesh -> low mesh -> crossed-quad impostor), distance culled; each kind and tier is ONE
//   InstancedMesh across all the cells it is on in (test/draws.mjs pins the draw count)
// * vertex-shader wind sway (shared uniforms, driven by atmosphere.shared.wind), PBR (MeshStandardMaterial)
// * grass/flowers are generated lazily in small cells around the camera so ground level is dense but cheap.
// Owner: agent S.  API: createVegetation(terrain, { seed, blockers:[{x,z,r}] }) -> { group, update(dt, elapsed, camPos), info }
import * as THREE from 'three';
import { GeoBuilder, makeRng, LAYOUT, clamp } from './terrain.js';
import { shared, quality } from './atmosphere.js';

const U = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(3.2, 1.4) }, uStr: { value: 1 } };

// ---------------------------------------------------------------- materials
function windMat(o) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: !o.map, map: o.map || null, roughness: o.rough ?? 0.86, metalness: 0,
    side: o.double ? THREE.DoubleSide : THREE.FrontSide, alphaTest: o.alphaTest || 0, alphaToCoverage: !!o.a2c,
  });
  const sway = new THREE.Vector4(o.h || 10, o.amp || 0.4, o.freq || 1.4, o.flutter || 0.04);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind; sh.uniforms.uStr = U.uStr;
    sh.uniforms.uSway = { value: sway };
    sh.vertexShader = (o.atlas ? 'attribute float aType;\n' : '') + 'uniform float uTime; uniform vec2 uWind; uniform float uStr; uniform vec4 uSway;\n' + sh.vertexShader;
    if (o.atlas) sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + aType) * 0.25;\n#endif');
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 iw = vec3(0.0); vec3 ax = vec3(1.0,0.0,0.0); vec3 az = vec3(0.0,0.0,1.0);
  #ifdef USE_INSTANCING
  iw = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
  ax = normalize(instanceMatrix[0].xyz); az = normalize(instanceMatrix[2].xyz);
  #endif
  float hf = clamp(position.y / uSway.x, 0.0, 1.0); hf *= hf;
  float ph = uTime * uSway.z + iw.x * 0.043 + iw.z * 0.051;
  float g = sin(ph) * 0.6 + sin(ph * 2.37 + 1.7) * 0.25 + 0.75;
  float gust = 0.65 + 0.35 * sin(uTime * 0.31 + iw.x * 0.0041 + iw.z * 0.0033);
  vec3 bw = vec3(uWind.x, 0.0, uWind.y) * (0.14 + 0.18 * uStr) * g * gust * uSway.y * hf;
  float fl = sin(uTime * 4.7 + position.x * 3.1 + position.z * 2.3 + iw.x) * uSway.w * hf;
  transformed.x += dot(bw, ax) + fl; transformed.z += dot(bw, az) + fl * 0.7;
  transformed.y -= length(bw) * 0.12;
}`);
  };
  m.customProgramCacheKey = () => 'swveg' + (o.atlas ? 'A' : '') + (o.map ? 'M' : '') + o.h + '_' + o.amp;
  return m;
}

// ---------------------------------------------------------------- geometry
const col = (a, b) => { const A = new THREE.Color(a), B = new THREE.Color(b); return (t, out) => out.copy(A).lerp(B, clamp(t, 0, 1)); };
function trunk(gb, x, y0, z, h, r0, r1, seg = 6) { gb.cyl(x, y0 + h / 2, z, r1, r0, h, seg, (px, py, pz, out) => out.setHex(0x6b4626).lerp(_dk, 0.25 * (1 - (py - y0) / h))); }
const _dk = new THREE.Color(0x2a180c);

function pineGeo(level) {
  const gb = new GeoBuilder();
  trunk(gb, 0, 0, 0, 3, 0.7, 0.45, level ? 4 : 6);
  const tiers = level ? 3 : 6;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1), y0 = 2.2 + f * 8.4 * (level ? 1 : 1), r = (4.4 - f * 3.2) * (level ? 1.05 : 1), h = level ? 5.4 : 4.4;
    const dark = new THREE.Color(0x1b5228).lerp(new THREE.Color(0x2c7a38), f), lite = new THREE.Color(0x2f8a3c).lerp(new THREE.Color(0x4dae55), f);
    gb.cone(0, y0 + h / 2, 0, r, h, level ? 6 : 9, (px, py, pz, out) => out.copy(dark).lerp(lite, clamp((py - y0) / h, 0, 1)));
  }
  return gb.build();
}
function broadGeo(level) {
  const gb = new GeoBuilder();
  trunk(gb, 0, 0, 0, 4.4, 0.85, 0.5, level ? 5 : 7);
  if (!level) { gb.beam(0, 3.6, 0, 1.5, 6.2, 0.6, 0.38, 0x6e4526); gb.beam(0, 3.8, 0, -1.3, 6.0, -0.9, 0.34, 0x6e4526); }
  const blobs = level ? [[0, 6.6, 0, 3.9], [1.9, 5.6, 0.9, 2.5], [-1.7, 6.0, -1.2, 2.5]]
    : [[0, 7.0, 0, 3.7], [2.1, 5.9, 0.8, 2.7], [-1.9, 6.2, -1.1, 2.7], [0.6, 8.6, -0.6, 2.5], [-0.7, 5.4, 2.0, 2.3], [1.0, 5.6, -2.0, 2.4], [-2.4, 7.4, 0.9, 2.1]];
  const hues = [0x3f9a3a, 0x55b447, 0x479f3c, 0x62bf4f];
  blobs.forEach((b, i) => {
    const base = new THREE.Color(hues[i % 4]), low = base.clone().multiplyScalar(0.55);
    gb.ico(b[0], b[1], b[2], b[3], level ? 0 : 1, (px, py, pz, out) => out.copy(low).lerp(base, clamp((py - (b[1] - b[3])) / (b[3] * 1.7), 0, 1)), 1, 0.85, 1);
  });
  return gb.build();
}
function frondGeo(L, droop, w) {
  const seg = 6, pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, x = t * L, y = Math.sin(t * 2.3) * L * 0.22 - t * t * t * droop, hw = w * Math.pow(Math.sin(Math.PI * Math.min(0.999, t * 0.92 + 0.04)), 0.7) + 0.03;
    pos.push(x, y, -hw, x, y, hw);
    if (i < seg) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}
function palmGeo(level) {
  const gb = new GeoBuilder();
  const H = 9, lean = 1.8, segs = level ? 4 : 8;
  let px = 0, py = 0;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs, nx = lean * t * t, ny = t * H;
    gb.beam(px, py, 0, nx, ny, 0, 0.72 - 0.34 * t, i % 2 ? 0x9b7a4c : 0x86653b);
    px = nx; py = ny;
  }
  const fronds = level ? 6 : 10, fg = frondGeo(4.6, 1.9, 0.6);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.2;
    const c = new THREE.Color().setHSL(0.28 + (i % 3) * 0.015, 0.6, 0.30 + (i % 2) * 0.06);
    gb.geo(fg, (x, y, z, out) => out.copy(c).multiplyScalar(0.75 + 0.35 * clamp((y - py + 1.5) / 3, 0, 1)), px, py + 0.1, 0, -a, 1, 1, 1, 0, (i % 2) * 0.18, 0.04);
  }
  if (!level) for (let i = 0; i < 3; i++) gb.ico(px + Math.cos(i * 2.1) * 0.5, py - 0.5, Math.sin(i * 2.1) * 0.5, 0.36, 0, 0x5a3a1a);
  return gb.build();
}
function bushGeo() {
  const gb = new GeoBuilder();
  const blobs = [[0, 0.9, 0, 1.3], [1.1, 0.7, 0.4, 0.95], [-1.0, 0.7, -0.3, 1.0], [0.2, 0.7, -1.0, 0.9]];
  blobs.forEach((b, i) => {
    const base = new THREE.Color([0x3b8f3a, 0x4ea645, 0x2f7a35, 0x5ab04c][i]);
    gb.ico(b[0], b[1], b[2], b[3], 1, (px, py, pz, out) => out.copy(base).multiplyScalar(0.55 + 0.6 * clamp((py) / 2, 0, 1)));
  });
  return gb.build();
}
const _rn = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
function rockGeo(detail, seed) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.72 + 0.4 * (_rn(Math.round(x * 20 + seed), Math.round(y * 20), Math.round(z * 20)) * 0.4 + Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7) * 0.3 + Math.sin(y * 4.3 + z * 1.9) * 0.3);
    p.setXYZ(i, x * n, y * n * 0.75, z * n);
  }
  const gb = new GeoBuilder();
  const grey = new THREE.Color(0x8a867f), warm = new THREE.Color(0xa08e78), moss = new THREE.Color(0x5f7d43);
  gb.geo(g, (x, y, z, out) => {
    out.copy(grey).lerp(warm, _rn(seed, Math.round(x * 3), Math.round(z * 3)) * 0.6).multiplyScalar(0.72 + 0.4 * clamp(y + 0.4, 0, 1));
    if (y > 0.35) out.lerp(moss, 0.4 * clamp((y - 0.35) * 2, 0, 1));
  }, 0, 0.3, 0, 0, 1, 1, 1, 0, 0, 0.09);
  return gb.build();
}
function crossQuads(w, h, planes = 3) {
  const pos = [], uv = [], nor = [], idx = [];
  for (let k = 0; k < planes; k++) {
    const a = (k / planes) * Math.PI, c = Math.cos(a) * w / 2, s = Math.sin(a) * w / 2;
    for (let side = 0; side < 2; side++) {   // duplicate reversed winding so FrontSide material lights both faces like up-facing
      const b = pos.length / 3;
      pos.push(-c, 0, -s, c, 0, s, c, h, s, -c, h, -s);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
      if (side === 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- textures (canvas)
function tex(c, aniso = 4) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; }
function impostorAtlas() {
  const cw = 128, chh = 256, c = document.createElement('canvas'); c.width = cw * 4; c.height = chh;
  const g = c.getContext('2d');
  const shadeGrad = (x0, x1, a, b) => { const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  // 0: pine
  g.save(); g.translate(0, 0);
  g.fillStyle = '#5a3a1e'; g.fillRect(58, 205, 12, 51);
  for (let i = 0; i < 6; i++) {
    const f = i / 5, yb = 214 - i * 34, yt = yb - 68, w = 62 - f * 44;
    g.beginPath(); g.moveTo(64 - w, yb); g.lineTo(64 + w, yb); g.lineTo(64, yt); g.closePath();
    g.fillStyle = shadeGrad(64 - w, 64 + w, `hsl(130,45%,${18 + f * 6}%)`, `hsl(122,50%,${34 + f * 10}%)`); g.fill();
  }
  g.restore();
  // 1: broadleaf
  g.save(); g.translate(cw, 0);
  g.fillStyle = '#6b4626'; g.fillRect(57, 150, 14, 106);
  const blobs = [[64, 100, 56], [34, 125, 36], [96, 122, 38], [64, 60, 40], [40, 75, 32], [90, 78, 32]];
  for (const [x, y, r] of blobs) {
    const rg = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
    rg.addColorStop(0, '#7fd35f'); rg.addColorStop(0.6, '#48a03c'); rg.addColorStop(1, '#2a6a2a');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.restore();
  // 2: palm
  g.save(); g.translate(cw * 2, 0);
  g.strokeStyle = '#8f6d40'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(58, 256); g.quadraticCurveTo(70, 170, 92, 96); g.stroke();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a) * 0.5;
    g.strokeStyle = i % 2 ? '#3f9a3a' : '#2f7d32'; g.lineWidth = 7; g.beginPath();
    g.moveTo(92, 96); g.quadraticCurveTo(92 + dx * 30, 76 + dy * 20 - 10, 92 + dx * 60, 100 + dy * 20 + 30); g.stroke();
  }
  g.restore();
  // 3: bush (fills cell)
  g.save(); g.translate(cw * 3, 0);
  for (const [x, y, r] of [[64, 170, 60], [30, 200, 40], [100, 205, 42], [64, 215, 46]]) {
    const rg = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 4, x, y, r);
    rg.addColorStop(0, '#6cc251'); rg.addColorStop(0.7, '#3f9438'); rg.addColorStop(1, '#25602a');
    g.fillStyle = rg; g.beginPath(); g.ellipse(x, y, r, r * 0.8, 0, 0, 7); g.fill();
  }
  g.restore();
  return tex(c, 8);
}
function grassTexture(flowers) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const r = makeRng(flowers ? 77 : 33);
  for (let i = 0; i < (flowers ? 14 : 34); i++) {
    const x = 8 + r() * 112, h = (flowers ? 45 : 50) + r() * 70, bend = (r() - 0.5) * 40, w = 2.5 + r() * 3;
    const gr = g.createLinearGradient(0, 128, 0, 128 - h);
    gr.addColorStop(0, '#2e6b26'); gr.addColorStop(1, `hsl(${85 + r() * 25},60%,${42 + r() * 18}%)`);
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - w, 128); g.quadraticCurveTo(x, 128 - h * 0.6, x + bend, 128 - h); g.quadraticCurveTo(x + w * 0.4, 128 - h * 0.6, x + w, 128); g.fill();
    if (flowers) {
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + bend, 128 - h, 6 + r() * 3, 0, 7); g.fill();
      g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(x + bend, 128 - h, 2.5, 0, 7); g.fill();
    }
  }
  return tex(c, 4);
}

// ---------------------------------------------------------------- main
export function createVegetation(terrain, opts = {}) {
  const seed = opts.seed ?? 1337;
  const Q = quality();
  const H = terrain.heightAt;
  const rng = makeRng(seed * 17 + 99);
  const group = new THREE.Group(); group.name = 'vegetation';
  shared.heightAt = shared.heightAt || H;
  const blockers = opts.blockers || [];
  const isFree = (x, z, m) => {
    if (terrain.isBlocked && terrain.isBlocked(x, z, m)) return false;
    for (let i = 0; i < blockers.length; i++) { const b = blockers[i]; const dx = x - b.x, dz = z - b.z, r = b.r + m; if (dx * dx + dz * dz < r * r) return false; }
    return true;
  };

  const atlas = impostorAtlas();
  const N = { tree: Q === 'low' ? 3200 : Q === 'medium' ? 6500 : 10000, bush: Q === 'low' ? 1200 : Q === 'medium' ? 2800 : 4600, rock: Q === 'low' ? 500 : 1500 };
  const D = { near: Q === 'low' ? 160 : 260, mid: Q === 'low' ? 700 : 1100, imp: Q === 'low' ? 2200 : 3800, grass: Q === 'low' ? 0 : Q === 'medium' ? 170 : 240, rock: 1500 };

  // type table: geometry per LOD + material
  const T = {
    pine: { geo: [pineGeo(0), pineGeo(1)], mat: windMat({ h: 14, amp: 0.55, freq: 1.3, flutter: 0.05 }), atlas: 0, w: 8.4, hh: 14.5 },
    broad: { geo: [broadGeo(0), broadGeo(1)], mat: windMat({ h: 10, amp: 0.7, freq: 1.5, flutter: 0.06 }), atlas: 1, w: 8.4, hh: 11.2 },
    palm: { geo: [palmGeo(0), palmGeo(1)], mat: windMat({ h: 10, amp: 1.5, freq: 1.7, flutter: 0.09, double: true }), atlas: 2, w: 9.5, hh: 11.5 },
    bush: { geo: [bushGeo()], mat: windMat({ h: 2, amp: 0.15, freq: 2, flutter: 0.02 }), atlas: 3, w: 3.2, hh: 2.6 },
  };
  const rockMat = windMat({ h: 100, amp: 0, freq: 1 });
  const rockGeos = [[rockGeo(2, 1), rockGeo(0, 1)], [rockGeo(2, 5), rockGeo(0, 5)], [rockGeo(2, 9), rockGeo(0, 9)]];
  const impMat = windMat({ map: atlas, alphaTest: 0.45, a2c: true, atlas: true, h: 1, amp: 1.2, freq: 1.5, flutter: 0.01, rough: 0.9 });
  const impGeo = crossQuads(1, 1, 2);
  const grassMat = windMat({ map: grassTexture(false), alphaTest: 0.5, a2c: true, h: 1.1, amp: 0.55, freq: 2.4, flutter: 0.03, rough: 0.95 });
  const flowerMat = windMat({ map: grassTexture(true), alphaTest: 0.5, a2c: true, h: 1.3, amp: 0.55, freq: 2.2, flutter: 0.03, rough: 0.95 });
  const grassGeo = crossQuads(1.7, 1.15, 3);

  // ----- placement into cells
  const CELL = 320, GR = 2000, CN = Math.ceil((GR * 2) / CELL);
  const cells = new Map();
  const cellOf = (x, z) => { const i = Math.floor((x + GR) / CELL), j = Math.floor((z + GR) / CELL), key = i * 64 + j; let c = cells.get(key); if (!c) { c = { key, cx: -GR + (i + 0.5) * CELL, cz: -GR + (j + 0.5) * CELL, ground: 0, n: 0, lists: { pine: [], broad: [], palm: [], bush: [], rock: [] }, meshes: {}, imp: null, hgt: 0 }; cells.set(key, c); } return c; };
  const nz = terrain.noise;
  const info = { pine: 0, broad: 0, palm: 0, bush: 0, rock: 0 };
  const add = (c, type, x, y, z, rot, s, sy, tint) => { c.lists[type].push(x, y, z, rot, s, sy, tint); info[type]++; };
  let placed = 0;
  for (let a = 0; a < N.tree * 9 && placed < N.tree; a++) {
    const x = (rng() - 0.5) * 3900, z = (rng() - 0.5) * 3900, h = H(x, z);
    if (h < 2.0 || h > 230) continue;
    const f = nz.fbm(x * 0.005 + 9, z * 0.005 - 4, 3);
    const clear = nz.fbm(x * 0.012 - 3, z * 0.012 + 7, 2);
    if (f < -0.02 && rng() > 0.06) continue;
    if (clear > 0.32 && rng() > 0.1) continue;
    if (h < 5 && rng() > 0.3) continue;
    if (terrain.slopeAt(x, z) > 0.55 || !isFree(x, z, 9)) continue;
    const type = h < 6.5 ? 'palm' : (h > 95 || f > 0.2) ? 'pine' : 'broad';
    const s = 0.75 + rng() * 0.8;
    add(cellOf(x, z), type, x, h - 0.4, z, rng() * 6.283, s, s * (0.88 + rng() * 0.25), 0.85 + rng() * 0.3);
    placed++;
  }
  // understory bushes: cluster near trees / coastline
  placed = 0;
  for (let a = 0; a < N.bush * 12 && placed < N.bush; a++) {
    const x = (rng() - 0.5) * 3900, z = (rng() - 0.5) * 3900, h = H(x, z);
    if (h < 1.5 || h > 150) continue;
    const f = nz.fbm(x * 0.006 + 2, z * 0.006 + 5, 3);
    if (f < 0.05 && rng() > 0.15) continue;
    if (terrain.slopeAt(x, z) > 0.6 || !isFree(x, z, 5)) continue;
    const s = 0.7 + rng() * 1.0;
    add(cellOf(x, z), 'bush', x, h - 0.15, z, rng() * 6.283, s, s * (0.7 + rng() * 0.4), 0.8 + rng() * 0.4);
    placed++;
  }
  placed = 0;
  for (let a = 0; a < N.rock * 25 && placed < N.rock; a++) {
    const x = (rng() - 0.5) * 3900, z = (rng() - 0.5) * 3900, h = H(x, z);
    if (h < -0.5 || h > 400) continue;
    const sl = terrain.slopeAt(x, z);
    const coast = h < 8 ? 2.5 : 1;
    if (rng() > (0.08 + sl * 1.3) * coast) continue;
    if (!isFree(x, z, 6)) continue;
    const big = rng() < 0.08 ? 3 + rng() * 5 : 0.5 + rng() * rng() * 3;
    add(cellOf(x, z), 'rock', x, h - big * 0.15, z, rng() * 6.283, big, big * (0.6 + rng() * 0.6), Math.floor(rng() * 3));
    placed++;
  }
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  for (const c of cells.values()) {
    let gy = 0, n = 0;
    for (const k in c.lists) { const L = c.lists[k]; for (let i = 0; i < L.length; i += 7) { gy += L[i + 1]; n++; } }
    c.ground = n ? gy / n : 0; c.n = n;
  }

  // ----- batches: one InstancedMesh per kind and tier across every cell that tier is on in (#930).
  // A frame once drew one mesh per cell, kind and tier, 95 to 206 of them, and as many again into the
  // shadow map. A batch holds its member cells' instances end to end; a cell that leaves is closed
  // over and one that arrives is packed onto the end, on the LOD tick, so nothing is repacked whole.
  // Only the near tier casts shadows: the sun's shadow box is 300 m and a cell leaves the near tier
  // with every tree in it at least D.near from the camera.
  const batches = [], B = {};
  const stats = { batches: 0, instances: 0, bytes: 0, repacks: 0 };
  group.userData.stats = stats; group.userData.batches = batches;
  // writes one placement (7 floats at list[o]) as instance k of the arrays; scaleFn as makeMesh once took it
  function put(b, k, list, o, sx, sy, sz, r, g, bl) {
    dummy.position.set(list[o], list[o + 1], list[o + 2]); dummy.rotation.set(0, list[o + 3], 0);
    dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); dummy.matrix.toArray(b.mesh.instanceMatrix.array, k * 16);
    if (b.tint) tint.setRGB(r, g, bl).toArray(b.mesh.instanceColor.array, k * 3);
  }
  // the plain kind: uniform x/z scale, the tint every tree, bush and grass tuft takes from its placement
  const plain = (listOf, tinted) => ({
    count: (s) => listOf(s).length / 7,
    write(b, s, k) {
      const L = listOf(s);
      for (let o = 0; o < L.length; o += 7, k++) { const t = L[o + 6], f = L[o + 3] % 1; put(b, k, L, o, L[o + 4], L[o + 5], L[o + 4], t, 0.9 + 0.2 * f, t * (0.85 + 0.3 * f)); }
    },
    tint: tinted,
  });
  function batch(name, geo, mat, cast, kind, typed) {
    const b = { name, geo, mat, cast, kind, typed: !!typed, tint: kind.tint, mesh: null, cap: 0, n: 0, members: [], has: new Set() };
    batches.push(b); B[name] = b; stats.batches++;
    return b;
  }
  function grow(b, need) {
    const cap = Math.max(64, Math.ceil(need * 1.5)), old = b.mesh;
    const g = b.typed ? b.geo.clone() : b.geo;
    const im = new THREE.InstancedMesh(g, b.mat, cap);
    im.name = 'veg:' + b.name;
    if (b.tint) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    if (b.typed) g.setAttribute('aType', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    if (old) {
      im.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, b.n * 16));
      if (b.tint) im.instanceColor.array.set(old.instanceColor.array.subarray(0, b.n * 3));
      if (b.typed) g.attributes.aType.array.set(old.geometry.attributes.aType.array.subarray(0, b.n));
      group.remove(old); old.dispose(); if (b.typed) old.geometry.dispose();
    }
    // the members lie all round the camera, so there is no one sphere to cull by
    im.frustumCulled = false; im.matrixAutoUpdate = false;
    // render/index.js's scan turns castShadow on for every mesh it has not been told to leave alone
    im.castShadow = b.cast; im.receiveShadow = true; im.userData.noCast = !b.cast;
    stats.bytes += (cap - b.cap) * (64 + (b.tint ? 12 : 0) + (b.typed ? 4 : 0));
    b.cap = cap; b.mesh = im; im.count = b.n; im.visible = b.n > 0;
    group.add(im);
  }
  // make the batch hold exactly `want` (cells, or grass tiles); returns true if it changed
  function sync(b, want) {
    const ws = new Set(want);
    let gone = false, came = false;
    for (const m of b.members) if (!ws.has(m.src)) { gone = true; break; }
    for (const s of want) if (!b.has.has(s)) { came = true; break; }
    if (!gone && !came) return false;
    const im0 = b.mesh;
    if (gone) {
      const mA = im0.instanceMatrix.array, cA = b.tint && im0.instanceColor.array, tA = b.typed && im0.geometry.attributes.aType.array;
      let w = 0, o = 0; const keep = [];
      for (const m of b.members) {
        if (ws.has(m.src)) {
          if (w !== o) { mA.copyWithin(w * 16, o * 16, (o + m.n) * 16); if (cA) cA.copyWithin(w * 3, o * 3, (o + m.n) * 3); if (tA) tA.copyWithin(w, o, o + m.n); }
          w += m.n; keep.push(m);
        } else b.has.delete(m.src);
        o += m.n;
      }
      b.members = keep; b.n = w;
    }
    for (const s of want) {
      if (b.has.has(s)) continue;
      const n = b.kind.count(s);
      if (b.n + n > b.cap) grow(b, b.n + n);
      if (n) b.kind.write(b, s, b.n);
      b.members.push({ src: s, n }); b.has.add(s); b.n += n;
    }
    const im = b.mesh;
    if (!im) return true;
    stats.instances += b.n - im.count; stats.repacks++;
    im.count = b.n; im.visible = b.n > 0;
    const up = (a, size) => { a.clearUpdateRanges(); a.addUpdateRange(0, b.n * size); a.needsUpdate = true; };
    up(im.instanceMatrix, 16); if (b.tint) up(im.instanceColor, 3); if (b.typed) up(im.geometry.attributes.aType, 1);
    return true;
  }

  for (const type of ['pine', 'broad', 'palm']) {
    const kind = plain((c) => c.lists[type], true);
    batch(type + '0', T[type].geo[0], T[type].mat, true, kind);
    batch(type + '1', T[type].geo[1], T[type].mat, false, kind);
  }
  { const kind = plain((c) => c.lists.bush, true); batch('bush0', T.bush.geo[0], T.bush.mat, true, kind); batch('bush0far', T.bush.geo[0], T.bush.mat, false, kind); }
  // rocks come in three shapes (the placement's seventh float), untinted, each its own batch
  for (const c of cells.values()) { c.rocks = [0, 0, 0]; const L = c.lists.rock; for (let i = 0; i < L.length; i += 7) c.rocks[L[i + 6]]++; }
  for (let v = 0; v < 3; v++) {
    const kind = {
      count: (c) => c.rocks[v], tint: false,
      write(b, c, k) { const L = c.lists.rock; for (let o = 0; o < L.length; o += 7) if (L[o + 6] === v) put(b, k++, L, o, L[o + 4], L[o + 5], L[o + 4]); },
    };
    batch('rock' + v + '_0', rockGeos[v][0], rockMat, true, kind);
    batch('rock' + v + '_0far', rockGeos[v][0], rockMat, false, kind);
    batch('rock' + v + '_1', rockGeos[v][1], rockMat, false, kind);
  }
  // the far tier: every tree and bush of a cell as a crossed quad, its atlas column in aType
  const IMP = ['pine', 'broad', 'palm', 'bush'];
  batch('imp', impGeo, impMat, false, {
    count: (c) => (c.lists.pine.length + c.lists.broad.length + c.lists.palm.length + c.lists.bush.length) / 7, tint: true,
    write(b, c, k) {
      const types = b.mesh.geometry.attributes.aType.array;
      for (const name of IMP) {
        const L = c.lists[name], t = T[name];
        for (let o = 0; o < L.length; o += 7, k++) { put(b, k, L, o, L[o + 4] * t.w, L[o + 5] * t.hh, L[o + 4] * t.w, L[o + 6], 0.95 + 0.1 * (L[o + 3] % 1), L[o + 6]); types[k] = t.atlas; }
      }
    },
  }, true);
  batch('grass', grassGeo, grassMat, true, plain((e) => e.gl, true));
  batch('flower', grassGeo, flowerMat, true, {
    count: (e) => e.fl.length / 7, tint: true,
    write(b, e, k) {
      const L = e.fl, col = b.mesh.instanceColor.array;
      for (let o = 0; o < L.length; o += 7, k++) { put(b, k, L, o, L[o + 4], L[o + 5], L[o + 4], 0, 0, 0); const v = L[o + 6]; tint.setHSL(v < 0.33 ? 0.98 : v < 0.66 ? 0.12 : 0.75, 0.9, 0.75).toArray(col, k * 3); }
    },
  });

  // ----- grass/flower tiles (lazy, around camera): placements only, drawn by the two batches above
  const GC = 80, grass = new Map();
  function buildGrass(gx, gz) {
    const r = makeRng((gx * 73856093) ^ (gz * 19349663) ^ seed);
    const gl = [], fl = [];
    const x0 = gx * GC, z0 = gz * GC, dens = Q === 'high' ? 1100 : 600;
    for (let i = 0; i < dens; i++) {
      const x = x0 + r() * GC, z = z0 + r() * GC, h = H(x, z);
      if (h < 1.6 || h > 120) continue;
      if (terrain.slopeAt(x, z) > 0.5) continue;
      if (terrain.surfaceAt) { const sf = terrain.surfaceAt(x, z); if (sf !== 'grass') continue; }
      if (!isFree(x, z, 2)) continue;
      const cl = nz.fbm(x * 0.03, z * 0.03, 2);
      if (cl < -0.25 && r() > 0.3) continue;
      const s = 0.7 + r() * 0.8;
      if (r() < 0.12 && cl > -0.05) fl.push(x, h - 0.05, z, r() * 6.28, s, s, r());
      else gl.push(x, h - 0.05, z, r() * 6.28, s, s * (0.8 + r() * 0.6), 0.75 + r() * 0.3);
    }
    return { gl, fl, x: x0 + GC / 2, z: z0 + GC / 2, y: H(x0 + GC / 2, z0 + GC / 2) };
  }

  // ----- update / LOD selection
  let acc = 1, frame = 0;
  const R = CELL * 0.72;
  const want = {}; for (const b of batches) want[b.name] = [];
  function update(dt, elapsed, camPos) {
    U.uTime.value = elapsed;
    U.uWind.value.set(shared.wind.x, shared.wind.z);
    U.uStr.value = 0.8 + 0.4 * Math.sin(elapsed * 0.13);
    acc += dt;
    if (acc < 0.12) return;
    acc = 0; frame++;
    const cp = camPos || shared.camPos;
    for (const k in want) want[k].length = 0;
    for (const c of cells.values()) {
      const dx = c.cx - cp.x, dz = c.cz - cp.z, dy = c.ground - cp.y;
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy) - R;
      const nearOn = d < D.near, midOn = d >= D.near && d < D.mid, impOn = d >= D.mid && d < D.imp;
      for (const type of ['pine', 'broad', 'palm']) {
        if (!c.lists[type].length) continue;
        if (nearOn) want[type + '0'].push(c); else if (midOn) want[type + '1'].push(c);
      }
      // bushes beyond 0.45*mid disappear (too small)
      if (c.lists.bush.length && d < D.mid * 0.45) want[nearOn ? 'bush0' : 'bush0far'].push(c);
      if (impOn && c.n > c.lists.rock.length / 7) want.imp.push(c);
      if (c.lists.rock.length) {
        const tier = d < 420 ? (nearOn ? '_0' : '_0far') : d < D.rock ? '_1' : null;
        if (tier) for (let v = 0; v < 3; v++) if (c.rocks[v]) want['rock' + v + tier].push(c);
      }
    }
    // grass streaming around the camera (only when low enough)
    if (D.grass > 0) {
      const gi = Math.floor(cp.x / GC), gj = Math.floor(cp.z / GC), rad = Math.ceil(D.grass / GC) + 1;
      const low = cp.y - H(cp.x, cp.z) < 260;
      let built = 0;
      if (low) for (let i = gi - rad; i <= gi + rad; i++) for (let j = gj - rad; j <= gj + rad; j++) {
        const k = i * 4096 + j;
        const ex = (i + 0.5) * GC - cp.x, ez = (j + 0.5) * GC - cp.z;
        if (Math.sqrt(ex * ex + ez * ez) > D.grass + GC * 0.7) continue;
        let e = grass.get(k);
        if (!e && built < 2) { e = buildGrass(i, j); grass.set(k, e); built++; }
        if (e) { e.seen = frame; if (e.gl.length) want.grass.push(e); if (e.fl.length) want.flower.push(e); }
      }
      for (const [k, e] of grass) {
        if (e.seen !== frame) {
          const ex = e.x - cp.x, ez = e.z - cp.z, far = Math.sqrt(ex * ex + ez * ez);
          if (far > D.grass * 2.2 || !low) grass.delete(k);
        }
      }
    }
    for (const b of batches) sync(b, want[b.name]);
  }
  update(1, 0, shared.camPos);
  info.total = info.pine + info.broad + info.palm + info.bush + info.rock;
  info.treeCount = info.pine + info.broad + info.palm;
  return { group, update, info, cells };
}
