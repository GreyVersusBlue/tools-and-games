// Procedural instanced vegetation: trees (chunked, cuttable), bushes, grass tufts, flowers, rocks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, fbm, noise2, smoothstep } from './noise.js';
import { EXT, riverDist, HG } from './layout.js';
import { N, RES } from './Terrain.js';
import { injectFow, injectWind, patchMaterial } from './shaderUtils.js';
import { makeGrassSprite, makeFlowerSprite, loadTexture } from './Textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();

// ---------- geometry helpers ----------
function prep(geo, color, { jitter = 0, seed = 1, radialFrom = null, radialMix = 0, shade = null } = {}) {
  let g = geo.index ? geo : geo;
  const pos = g.attributes.position;
  if (jitter) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // position-hashed jitter keeps seams welded
      const k = Math.round(x * 97) * 7 + Math.round(y * 97) * 13 + Math.round(z * 97) * 31 + seed * 101;
      const r = mulberry32(k);
      pos.setXYZ(i, x + (r() - 0.5) * jitter, y + (r() - 0.5) * jitter * 0.8, z + (r() - 0.5) * jitter);
    }
  }
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  if (radialFrom) {
    for (let i = 0; i < p.count; i++) {
      _p.set(p.getX(i) - radialFrom.x, (p.getY(i) - radialFrom.y) * 0.8, p.getZ(i) - radialFrom.z).normalize();
      _s.set(n.getX(i), n.getY(i), n.getZ(i)).lerp(_p, radialMix).normalize();
      n.setXYZ(i, _s.x, _s.y, _s.z);
    }
  }
  const cols = new Float32Array(p.count * 3);
  const base = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    _c.copy(base);
    if (shade) shade(_c, p.getX(i), p.getY(i), p.getZ(i));
    cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

function trunk(h, r0, r1, color, seg = 7, bend = 0, seed = 1) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 3, true);
  g.translate(0, h / 2, 0);
  if (bend) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setX(i, pos.getX(i) + Math.sin((y / h) * 2.1 + seed) * bend * (y / h));
    }
  }
  return prep(g, color, { shade: (c, x, y) => c.multiplyScalar(0.55 + 0.45 * Math.min(1, y / h)) });
}

function branch(from, dir, len, r, color, seg = 5) {
  const g = new THREE.CylinderGeometry(r * 0.35, r, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(_q);
  g.translate(from.x, from.y, from.z);
  return prep(g, color, { shade: (c) => c.multiplyScalar(0.8) });
}

// lod 0 = full detail, 1 = reduced (fewer segments, same silhouette & colours; same rnd stream so shapes match)
function pineTree(seed, pal, lod = 0) {
  const rnd = mulberry32(seed);
  const parts = [trunk(2.4, 0.34, 0.2, pal.bark, lod ? 5 : 7, 0, seed)];
  const layers = 4 + (rnd() < 0.5 ? 1 : 0);
  let y = 1.3;
  for (let L = 0; L < layers; L++) {
    const f = L / layers;
    const r = (2.3 - f * 1.7) * (0.9 + rnd() * 0.2);
    const h = 2.4 - f * 0.7;
    const cone = lod ? new THREE.ConeGeometry(r, h, 7, 1, true) : new THREE.ConeGeometry(r, h, 10, 2, true);
    cone.translate(0, y + h / 2, 0);
    const y0 = y, top = y + h;
    parts.push(prep(cone, pal.leaf, {
      jitter: lod ? 0.22 : 0.32, seed: seed * 7 + L, radialFrom: new THREE.Vector3(0, y0 + h * 0.3, 0), radialMix: 0.45,
      shade: (c, px, py, pz) => {
        const t = (py - y0) / (top - y0);
        c.multiplyScalar(0.38 + 0.5 * t + 0.2 * f);
        if (t < 0.15) c.multiplyScalar(0.8);
        c.lerp(pal.tip, 0.35 * t * t);
      },
    }));
    y += h * 0.55;
  }
  return mergeGeometries(parts);
}

function broadTree(seed, pal, lod = 0) {
  const rnd = mulberry32(seed);
  const h = 2.8 + rnd() * 0.8;
  const parts = [trunk(h + 0.8, 0.38, 0.22, pal.bark, lod ? 5 : 7, 0.25, seed)];
  const blobs = 5 + Math.floor(rnd() * 3);
  const center = new THREE.Vector3(0, h + 1.5, 0);
  for (let b = 0; b < blobs; b++) {
    const a = rnd() * Math.PI * 2, d = b === 0 ? 0 : 0.9 + rnd() * 0.8;
    const r = b === 0 ? 1.7 : 1.0 + rnd() * 0.55;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = h + 1.2 + (b === 0 ? 0.6 : rnd() * 1.6);
    const s = new THREE.IcosahedronGeometry(lod ? r * 1.05 : r, lod ? 0 : 1);
    s.scale(1, 0.85, 1);
    s.translate(cx, cy, cz);
    const bc = new THREE.Vector3(cx, cy, cz);
    parts.push(prep(s, pal.leaf, {
      jitter: 0.35, seed: seed * 13 + b, radialFrom: center.clone().lerp(bc, 0.5), radialMix: 0.7,
      shade: (c, px, py) => {
        const t = THREE.MathUtils.clamp((py - (h + 0.2)) / 3.4, 0, 1);
        c.multiplyScalar(0.4 + 0.5 * t);
        c.lerp(pal.tip, 0.22 * t * t);
      },
    }));
  }
  return mergeGeometries(parts);
}

function deadTree(seed, pal, withLeaves, lod = 0) {
  const rnd = mulberry32(seed);
  const h = 4.2 + rnd() * 1.5;
  const parts = [trunk(h, 0.42, 0.12, pal.bark, lod ? 5 : 6, 0.6, seed)];
  const nb = 5 + Math.floor(rnd() * 3);
  for (let b = 0; b < nb; b++) {
    const y = h * (0.4 + rnd() * 0.55);
    const a = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0.5 + rnd() * 0.9, Math.sin(a));
    const len = 1.2 + rnd() * 1.6;
    const from = new THREE.Vector3(Math.sin((y / h) * 2.1 + seed) * 0.6 * (y / h), y, 0);
    parts.push(branch(from, dir, len, 0.14, pal.bark, lod ? 4 : 5));
    // twig
    const end = from.clone().add(dir.clone().normalize().multiplyScalar(len * 0.8));
    const d2 = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rnd() - 0.5) * 2).setY(0.9);
    if (!lod) parts.push(branch(end, d2, len * 0.6, 0.07, pal.bark));
    else parts.push(branch(end, d2, len * 0.6, 0.07, pal.bark, 3));
    if (withLeaves && rnd() < 0.8) {
      const s = new THREE.IcosahedronGeometry(0.7 + rnd() * 0.5, 0);
      const e2 = end.clone().add(d2.clone().normalize().multiplyScalar(len * 0.4));
      s.translate(e2.x, e2.y, e2.z);
      parts.push(prep(s, pal.leaf, { jitter: 0.25, seed: seed + b, radialFrom: e2, radialMix: 0.6, shade: (c, px, py) => c.multiplyScalar(0.7 + 0.3 * rnd()) }));
    }
  }
  return mergeGeometries(parts);
}

function bushGeo(seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let b = 0; b < 4; b++) {
    const r = 0.5 + rnd() * 0.45;
    const s = new THREE.IcosahedronGeometry(r, 1);
    const cx = (rnd() - 0.5) * 1.2, cz = (rnd() - 0.5) * 1.2, cy = r * 0.6;
    s.translate(cx, cy, cz);
    parts.push(prep(s, 0xffffff, {
      jitter: 0.2, seed: seed + b, radialFrom: new THREE.Vector3(0, 0, 0), radialMix: 0.6,
      shade: (c, px, py) => c.multiplyScalar(0.55 + 0.5 * Math.min(1, py / 1.1)),
    }));
  }
  return mergeGeometries(parts);
}

export function rockGeo(seed, detail = 1) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const sx = 0.8 + rnd() * 0.6, sy = 0.5 + rnd() * 0.4, sz = 0.8 + rnd() * 0.6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 1 + fbm(x * 1.1 + seed, z * 1.1 + y * 1.3, 3, seed) * 0.8;
    pos.setXYZ(i, x * n * sx, Math.max(y * n * sy, -0.15), z * n * sz);
  }
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  // box-projected uvs
  const p = ng.attributes.position, nrm = ng.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * 0.35; uv[i * 2 + 1] = v * 0.35;
  }
  ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return ng;
}

function tuftGeo(w, h, quads = 3) {
  const parts = [];
  for (let q = 0; q < quads; q++) {
    const g = new THREE.PlaneGeometry(w, h, 1, 1);
    g.translate(0, h / 2, 0);
    g.rotateX(-0.45); // lean outwards so tufts read as blade fans from the top-down camera
    g.translate(0, 0, 0.12);
    g.rotateY((q / quads) * Math.PI * 2 + 0.3);
    parts.push(g);
  }
  const m = mergeGeometries(parts);
  const n = m.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return m;
}

// ---------- palettes ----------
const col = (h) => new THREE.Color(h);
const PAL = {
  radPine: { bark: col(0x4a3222), leaf: col(0x234a22), tip: col(0x6f9a48) },
  radPine2: { bark: col(0x55392a), leaf: col(0x2a5626), tip: col(0x86a552) },
  radBroad: { bark: col(0x5a3d28), leaf: col(0x3a6a26), tip: col(0x9ab04e) },
  radBroad2: { bark: col(0x4d3522), leaf: col(0x2f5e2c), tip: col(0x7fa850) },
  duskwardPine: { bark: col(0x2a1f1c), leaf: col(0x2a2b2c), tip: col(0x6a4a52) },
  duskwardPine2: { bark: col(0x2e2220), leaf: col(0x313028), tip: col(0x7a5a3a) },
  dead: { bark: col(0x3a302c), leaf: col(0x3a1c18), tip: col(0x4a2418) },
  deadRed: { bark: col(0x2c2220), leaf: col(0x5e2012), tip: col(0x8a3a16) },
};

// ---------- view-dependent instancing ----------
// Everything static that is scattered in the thousands (trees, bushes, rocks, grass) is kept in CPU-side arrays
// and only the instances inside the camera's ground footprint (+ margins for tall trees and SW-falling shadows)
// are copied into small InstancedMeshes. The copy happens only when the camera moved meaningfully (> 2.5 units),
// the viewport changed, or a tree was cut / regrew - not every frame.
const LOD0_DIST = 52; // camera distance: full-detail trees (cast shadows)
const LOD1_DIST = 72; // reduced-detail trees (cast shadows); beyond this: baked billboard impostors (no shadows)
const GRASS_FULL = 40, GRASS_FAR = 62; // grass thins out between these camera distances
const CELL = 8, GOFF = 20, GW = 40; // scatter grid
const IMP_GRID = 3, IMP_RES = 256; // impostor atlas: 3x3 cells of 256px
const VIEW_PITCH = THREE.MathUtils.degToRad(57); // CameraController pitch (fixed yaw, looks north)
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

class ViewInstances {
  constructor(geo, mat, cap, { castShadow = false, receiveShadow = true, name = 'instances', extra = null } = {}) {
    cap = Math.max(1, cap);
    this.cap = cap;
    const mesh = (this.mesh = new THREE.InstancedMesh(geo, mat, cap));
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.frustumCulled = false; // culled on the CPU by the view region
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (extra) {
      this.extra = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      this.extra.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(extra, this.extra);
    }
    mesh.count = 0;
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(mats, mo, cols, co, extra = 0) {
    const n = this.n;
    if (n >= this.cap) return;
    const M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array;
    for (let k = 0; k < 16; k++) M[n * 16 + k] = mats[mo + k];
    C[n * 3] = cols[co]; C[n * 3 + 1] = cols[co + 1]; C[n * 3 + 2] = cols[co + 2];
    if (this.extra) this.extra.array[n] = extra;
    this.n = n + 1;
  }
  end() {
    const m = this.mesh, n = this.n;
    m.count = n;
    m.visible = n > 0;
    for (const [a, size] of [[m.instanceMatrix, 16], [m.instanceColor, 3], [this.extra, 1]]) {
      if (!a || !n) continue;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * size);
      a.needsUpdate = true;
    }
  }
}

// Flat SoA storage of static instances + a coarse grid for region queries.
class ScatterField {
  constructor(cap) {
    this.n = 0;
    this.mats = new Float32Array(cap * 16);
    this.cols = new Float32Array(cap * 3);
    this.pos = new Float32Array(cap * 2);
    this.kind = new Uint8Array(cap);
    this.aux = new Float32Array(cap);
  }
  add(matrix, color, kind = 0, aux = 0) {
    const i = this.n++;
    this.mats.set(matrix.elements, i * 16);
    this.cols[i * 3] = color.r; this.cols[i * 3 + 1] = color.g; this.cols[i * 3 + 2] = color.b;
    this.pos[i * 2] = matrix.elements[12]; this.pos[i * 2 + 1] = matrix.elements[14];
    this.kind[i] = kind;
    this.aux[i] = aux;
    return i;
  }
  index() {
    const lists = new Map();
    for (let i = 0; i < this.n; i++) {
      const k = cellKey(this.pos[i * 2], this.pos[i * 2 + 1]);
      if (!lists.has(k)) lists.set(k, []);
      lists.get(k).push(i);
    }
    this.cells = new Map([...lists].map(([k, l]) => [k, Int32Array.from(l)]));
  }
  forEachIn(r, fn) {
    const cx0 = Math.floor(r.x0 / CELL), cx1 = Math.floor(r.x1 / CELL), cz0 = Math.floor(r.z0 / CELL), cz1 = Math.floor(r.z1 / CELL);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const l = this.cells.get((cx + GOFF) * GW * 2 + (cz + GOFF));
      if (!l) continue;
      for (let q = 0; q < l.length; q++) {
        const i = l[q], x = this.pos[i * 2], z = this.pos[i * 2 + 1];
        if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) fn(i, x, z);
      }
    }
  }
}
function cellKey(x, z) { return (Math.floor(x / CELL) + GOFF) * GW * 2 + (Math.floor(z / CELL) + GOFF); }

// Render every tree type once from the gameplay camera direction into albedo + view-normal atlases.
function bakeImpostors(renderer, types) {
  const S = IMP_GRID * IMP_RES;
  const albRT = new THREE.WebGLRenderTarget(S, S, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const nrmRT = new THREE.WebGLRenderTarget(S, S, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const dir = new THREE.Vector3(0, Math.sin(VIEW_PITCH), Math.cos(VIEW_PITCH));
  const albMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const nrmMat = new THREE.MeshNormalMaterial();
  const mesh = new THREE.Mesh(types[0].geo, albMat);
  scene.add(mesh);
  const prev = { rt: renderer.getRenderTarget(), auto: renderer.autoClear, col: renderer.getClearColor(new THREE.Color()), a: renderer.getClearAlpha(), sm: renderer.shadowMap.enabled };
  renderer.shadowMap.enabled = false;
  for (const [rt, clear] of [[albRT, [0x000000, 0]], [nrmRT, [0x8080ff, 0]]]) {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(clear[0], clear[1]);
    renderer.clear();
  }
  renderer.autoClear = false;
  types.forEach((t, i) => {
    const geo = t.geo;
    geo.computeBoundingSphere();
    const bs = geo.boundingSphere;
    const R = bs.radius * 1.02;
    t.imp = { cell: i, center: bs.center.clone(), radius: R };
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.position.copy(bs.center).addScaledVector(dir, 80);
    cam.up.set(0, 1, 0);
    cam.lookAt(bs.center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    mesh.geometry = geo;
    const col = i % IMP_GRID, row = Math.floor(i / IMP_GRID);
    for (const [rt, m] of [[albRT, albMat], [nrmRT, nrmMat]]) {
      mesh.material = m;
      rt.viewport.set(col * IMP_RES, row * IMP_RES, IMP_RES, IMP_RES);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    }
  });
  albRT.viewport.set(0, 0, S, S); nrmRT.viewport.set(0, 0, S, S);
  renderer.setRenderTarget(prev.rt);
  renderer.autoClear = prev.auto;
  renderer.setClearColor(prev.col, prev.a);
  renderer.shadowMap.enabled = prev.sm;
  albMat.dispose(); nrmMat.dispose();
  return { albedo: albRT.texture, normal: nrmRT.texture, rts: [albRT, nrmRT] };
}

export class Foliage {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'foliage';
    this.trees = [];
    this.bucket = new Map(); // spatial hash (4u) -> tree indices
    this.treeMeshes = [];
    this.grassMeshes = [];
    this.regrowQueue = [];
    this.grassDensity = 1;
    this._treesDirty = true;
    this._viewDirty = true;
    this._lastCam = new THREE.Vector3(1e9, 0, 0);
    this._lastAspect = 0;
    this.region = { x0: 0, x1: 0, z0: 0, z1: 0 };
    this.stats = { refreshes: 0, lod0: 0, lod1: 0, imp: 0, grass: 0 };
  }

  sampleField(arr, x, z) { return this.world.td.sample(arr, x, z); }

  build(hq = true) {
    const w = this.world, td = w.td;
    const rnd = mulberry32(1337);
    // --- tree types (LOD0 full, LOD1 reduced) ---
    const defs = [
      ['radPine', (l) => pineTree(11, PAL.radPine, l), 0], ['radPine2', (l) => pineTree(23, PAL.radPine2, l), 0],
      ['radBroad', (l) => broadTree(31, PAL.radBroad, l), 0], ['radBroad2', (l) => broadTree(47, PAL.radBroad2, l), 0],
      ['duskwardPine', (l) => pineTree(53, PAL.duskwardPine, l), 1], ['duskwardPine2', (l) => pineTree(61, PAL.duskwardPine2, l), 1],
      ['dead', (l) => deadTree(71, PAL.dead, true, l), 1], ['deadRed', (l) => deadTree(83, PAL.deadRed, true, l), 1],
      ['deadBare', (l) => deadTree(97, PAL.dead, false, l), 1],
    ];
    const types = defs.map(([name, make, side]) => ({ name, geo: make(0), geo1: make(1), side }));
    this.types = types;
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, color: 0xa8a8a8, envMapIntensity: 0.5 });
    patchMaterial(treeMat, 'tree-wind', (sh) => { injectWind(sh, { base: 1.5, amount: 0.006, freq: 1.1 }); injectFow(sh); });
    this.treeMat = treeMat;

    // --- placement ---
    const S = 2.05;
    const placed = [];
    for (let z = -116; z <= 116; z += S) {
      for (let x = -116; x <= 116; x += S) {
        const px = x + (rnd() - 0.5) * S * 0.85, pz = z + (rnd() - 0.5) * S * 0.85;
        const edge = Math.max(Math.abs(px), Math.abs(pz));
        const inMap = edge < 99;
        let p;
        const slope = this.sampleField(td.slope, px, pz);
        if (inMap) {
          const lane = this.sampleField(td.lane, px, pz);
          const resD = this.sampleField(td.res, px, pz);
          const path = this.sampleField(td.path, px, pz);
          const plat = this.sampleField(td.plat, px, pz);
          const n = noise2(px * 0.4, pz * 0.4, 9) * 1.2;
          const clear = Math.min(lane - 6.2, riverDist(px, pz) - 10, resD, path - 2.4) + n;
          if (clear < 0) continue;
          if (slope > 0.45) continue;
          if (plat > 0.08 && plat < 0.92) continue;
          const d = fbm(px * 0.04, pz * 0.04, 4, 5);
          p = smoothstep(-0.28, 0.1, d) * smoothstep(0, 2.5, clear);
          if (edge > 90) p = Math.max(p, smoothstep(90, 95, edge));
          if (plat >= 0.92 && edge < 90) p *= 0.12; // sparse inside bases
        } else {
          if (slope > 1.2) continue;
          p = 0.85;
        }
        if (rnd() > p) continue;
        placed.push([px, pz]);
      }
    }

    // --- assign types & per-tree matrices (same random stream as before: identical forest) ---
    const C = 6, span = (EXT * 2) / C;
    const buckets = new Map();
    for (const [x, z] of placed) {
      const corr = this.sampleField(td.corr, x, z);
      const r = rnd();
      let ti;
      if (rnd() < corr) ti = r < 0.32 ? 4 : r < 0.55 ? 5 : r < 0.75 ? 6 : r < 0.88 ? 7 : 8;
      else ti = r < 0.35 ? 0 : r < 0.6 ? 1 : r < 0.82 ? 2 : 3;
      const cx = Math.min(C - 1, Math.floor((x + EXT) / span)), cz = Math.min(C - 1, Math.floor((z + EXT) / span));
      const key = ti * 1000 + cz * C + cx;
      if (!buckets.has(key)) buckets.set(key, []);
      const scale = 0.85 + rnd() * 0.45;
      buckets.get(key).push({ x, z, y: w.getHeight(x, z), type: ti, scale, yaw: rnd() * Math.PI * 2, alive: true, r: 0.85 * Math.min(scale, 1.15), tint: 0.85 + rnd() * 0.3, hue: (rnd() - 0.5) * 0.04 });
    }
    const counts = new Array(types.length).fill(0);
    for (const [key, list] of buckets) {
      for (const t of list) {
        _e.set((rnd() - 0.5) * 0.08, t.yaw, (rnd() - 0.5) * 0.08);
        _q.setFromEuler(_e);
        _m.compose(_p.set(t.x, t.y - 0.1, t.z), _q, _s.setScalar(t.scale));
        t.matrix = _m.clone();
        t.m = Float32Array.from(_m.elements);
        _c.setRGB(t.tint, t.tint, t.tint).offsetHSL(t.hue, 0, 0);
        t.c = new Float32Array([_c.r, _c.g, _c.b]);
        counts[t.type]++;
        this.addTreeRecord(t);
      }
      void key;
    }

    // --- impostors ---
    const renderer = w.game?.renderer;
    let imp = null;
    try { if (renderer) imp = bakeImpostors(renderer, types); } catch (e) { console.warn('[world] impostor bake failed', e); imp = null; }
    this.impostors = imp;
    if (imp) {
      const dir = new THREE.Vector3(0, Math.sin(VIEW_PITCH), Math.cos(VIEW_PITCH));
      for (const t of this.trees) {
        const ti = types[t.type].imp, s = t.scale;
        _m.compose(_p.set(t.x + ti.center.x * s, t.y - 0.1 + ti.center.y * s, t.z + ti.center.z * s), _q.identity(), _s.setScalar(ti.radius * s));
        t.im = Float32Array.from(_m.elements);
      }
      void dir;
    }

    // --- per-type LOD meshes + one impostor mesh ---
    this.lodMeshes = types.map((ty, i) => [
      new ViewInstances(ty.geo, treeMat, counts[i], { castShadow: true, name: 'trees-lod0-' + ty.name }),
      new ViewInstances(ty.geo1, treeMat, counts[i], { castShadow: true, name: 'trees-lod1-' + ty.name }),
    ]);
    for (const pair of this.lodMeshes) for (const vi of pair) { this.group.add(vi.mesh); this.treeMeshes.push(vi.mesh); }
    if (imp) {
      const quad = new THREE.PlaneGeometry(2, 2);
      quad.rotateX(-VIEW_PITCH);
      const impMat = new THREE.MeshStandardMaterial({ map: imp.albedo, alphaTest: 0.5, roughness: 0.85, metalness: 0, color: 0xa8a8a8, envMapIntensity: 0.5 });
      const G = IMP_GRID.toFixed(1);
      patchMaterial(impMat, 'tree-impostor', (sh) => {
        sh.uniforms.uImpN = { value: imp.normal };
        sh.vertexShader = 'attribute float aCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
          vMapUv = (uv + vec2(mod(aCell, ${G}), floor(aCell / ${G}))) / ${G};`);
        sh.fragmentShader = 'uniform sampler2D uImpN;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>',
          'normal = normalize(texture2D(uImpN, vMapUv).xyz * 2.0 - 1.0);');
        injectFow(sh);
      });
      this.impMesh = new ViewInstances(quad, impMat, this.trees.length, { castShadow: false, receiveShadow: false, name: 'trees-impostor', extra: 'aCell' });
      this.group.add(this.impMesh.mesh);
      this.treeMeshes.push(this.impMesh.mesh);
    }

    this.buildBushes(rnd);
    this.buildRocks(rnd);
    this.buildGrass(rnd, hq);
  }

  addTreeRecord(t) {
    const id = this.trees.length;
    t.id = id;
    this.trees.push(t);
    const key = Math.floor((t.x + 128) / 4) * 1000 + Math.floor((t.z + 128) / 4);
    if (!this.bucket.has(key)) this.bucket.set(key, []);
    this.bucket.get(key).push(id);
    this.world.nav.addTree(t.x, t.z, t.r);
    this.world.fog.setTree(t.x, t.z, 0.6, 1);
  }

  treesInRadius(x, z, r, aliveOnly = true) {
    const out = [];
    const b0x = Math.floor((x - r + 128) / 4), b1x = Math.floor((x + r + 128) / 4);
    const b0z = Math.floor((z - r + 128) / 4), b1z = Math.floor((z + r + 128) / 4);
    for (let bx = b0x; bx <= b1x; bx++) for (let bz = b0z; bz <= b1z; bz++) {
      const list = this.bucket.get(bx * 1000 + bz);
      if (!list) continue;
      for (const id of list) {
        const t = this.trees[id];
        if (aliveOnly && !t.alive) continue;
        if ((t.x - x) ** 2 + (t.z - z) ** 2 <= r * r) out.push(t);
      }
    }
    return out;
  }

  cutTree(t, regrowAt) {
    if (!t.alive) return false;
    t.alive = false;
    this._treesDirty = true;
    this.world.nav.removeTree(t.x, t.z, t.r);
    this.world.fog.setTree(t.x, t.z, 0.6, -1);
    if (regrowAt != null) this.regrowQueue.push({ t, at: regrowAt });
    return true;
  }

  regrowTree(t) {
    if (t.alive) return;
    t.alive = true;
    this._treesDirty = true;
    this.world.nav.addTree(t.x, t.z, t.r);
    this.world.fog.setTree(t.x, t.z, 0.6, 1);
  }

  update(time, units) {
    if (!this.regrowQueue.length) return;
    for (let i = this.regrowQueue.length - 1; i >= 0; i--) {
      const q = this.regrowQueue[i];
      if (time < q.at) continue;
      const blocked = units?.some((u) => u.alive && (u.position.x - q.t.x) ** 2 + (u.position.z - q.t.z) ** 2 < 2.5);
      if (blocked) { q.at = time + 3; continue; }
      this.regrowTree(q.t);
      this.regrowQueue.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- view refresh
  // Ground footprint of the view frustum (between y=-1 and y=11 so tall trees poking in from outside count),
  // padded for canopies, SW-cast shadows (sun from -X,+Z) and camera motion until the next refresh.
  computeRegion(camera) {
    const cp = camera.position;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      _d.set(nx, ny, 0.5).unproject(camera).sub(cp).normalize();
      for (const py of [-1, 11]) {
        let t = _d.y < -1e-3 ? (py - cp.y) / _d.y : 250;
        if (!(t > 0)) t = 0;
        t = Math.min(t, 250);
        const x = cp.x + _d.x * t, z = cp.z + _d.z * t;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
    }
    const m = 4 + 3; // canopy + motion slack
    const r = this.region;
    r.x0 = x0 - m - 6; r.x1 = x1 + m; r.z0 = z0 - m; r.z1 = z1 + m + 6;
    return r;
  }

  updateView(camera) {
    if (!camera) return;
    const moved = camera.position.distanceToSquared(this._lastCam) > 2.5 * 2.5 || camera.aspect !== this._lastAspect;
    if (!moved && !this._treesDirty && !this._viewDirty) return;
    if (moved || this._viewDirty) {
      this._lastCam.copy(camera.position);
      this._lastAspect = camera.aspect;
      camera.updateMatrixWorld();
      this.computeRegion(camera);
      this.refreshScatter(camera.position);
    }
    this.refreshTrees(camera.position);
    this._treesDirty = false;
    this._viewDirty = false;
    this.stats.refreshes++;
  }

  refreshTrees(cp) {
    const r = this.region, L0 = LOD0_DIST * LOD0_DIST, L1 = LOD1_DIST * LOD1_DIST;
    for (const pair of this.lodMeshes) { pair[0].begin(); pair[1].begin(); }
    this.impMesh?.begin();
    const b0x = Math.floor((r.x0 + 128) / 4), b1x = Math.floor((r.x1 + 128) / 4);
    const b0z = Math.floor((r.z0 + 128) / 4), b1z = Math.floor((r.z1 + 128) / 4);
    let n0 = 0, n1 = 0, ni = 0;
    for (let bx = b0x; bx <= b1x; bx++) for (let bz = b0z; bz <= b1z; bz++) {
      const list = this.bucket.get(bx * 1000 + bz);
      if (!list) continue;
      for (const id of list) {
        const t = this.trees[id];
        if (!t.alive || t.x < r.x0 || t.x > r.x1 || t.z < r.z0 || t.z > r.z1) continue;
        const d2 = (t.x - cp.x) ** 2 + (t.y + 3 - cp.y) ** 2 + (t.z - cp.z) ** 2;
        if (d2 < L0) { this.lodMeshes[t.type][0].push(t.m, 0, t.c, 0); n0++; }
        else if (d2 < L1 || !this.impMesh) { this.lodMeshes[t.type][1].push(t.m, 0, t.c, 0); n1++; }
        else { this.impMesh.push(t.im, 0, t.c, 0, t.type); ni++; }
      }
    }
    for (const pair of this.lodMeshes) { pair[0].end(); pair[1].end(); }
    this.impMesh?.end();
    Object.assign(this.stats, { lod0: n0, lod1: n1, imp: ni });
  }

  refreshScatter(cp) {
    const r = this.region;
    for (const [field, meshes, thin] of this.scatter ?? []) {
      for (const vi of meshes) vi.begin();
      const F = GRASS_FULL * GRASS_FULL, dens = this.grassDensity;
      field.forEachIn(r, (i, x, z) => {
        if (thin) {
          const d2 = (x - cp.x) ** 2 + (cp.y) ** 2 + (z - cp.z) ** 2;
          let keep = dens;
          if (d2 > F) keep *= 1 - 0.65 * smoothstep(GRASS_FULL, GRASS_FAR, Math.sqrt(d2));
          if (field.aux[i] > keep) return;
        }
        meshes[field.kind[i]].push(field.mats, i * 16, field.cols, i * 3);
      });
      for (const vi of meshes) vi.end();
    }
    this.stats.grass = this.grassMeshes.reduce((a, m) => a + m.count, 0);
  }

  addScatter(field, meshes, thin = false) {
    field.index();
    (this.scatter ??= []).push([field, meshes, thin]);
    for (const vi of meshes) this.group.add(vi.mesh);
  }

  buildBushes(rnd) {
    const td = this.world.td;
    const geos = [bushGeo(5), bushGeo(9)];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    patchMaterial(mat, 'bush-wind', (sh) => { injectWind(sh, { base: 0.2, amount: 0.05, freq: 1.7 }); injectFow(sh); });
    const pts = [[], []];
    for (let i = 0; i < 2600; i++) {
      const x = (rnd() - 0.5) * 198, z = (rnd() - 0.5) * 198;
      const lane = this.sampleField(td.lane, x, z), resD = this.sampleField(td.res, x, z), path = this.sampleField(td.path, x, z);
      const clear = Math.min(lane - 4.2, riverDist(x, z) - 7.5, resD + 1, path - 1.3);
      if (clear < 0 || clear > 6) continue;
      if (this.sampleField(td.slope, x, z) > 0.4) continue;
      const p = this.sampleField(td.plat, x, z);
      if (p > 0.05 && p < 0.95) continue;
      pts[rnd() < 0.5 ? 0 : 1].push([x, z]);
    }
    const field = new ScatterField(pts[0].length + pts[1].length);
    for (let g = 0; g < 2; g++) {
      pts[g].forEach(([x, z]) => {
        const corr = this.sampleField(td.corr, x, z);
        const s = 0.7 + rnd() * 0.7;
        _q.setFromEuler(_e.set(0, rnd() * 6.28, 0));
        _m.compose(_p.set(x, this.world.getHeight(x, z) - 0.1, z), _q, _s.set(s, s * (0.8 + rnd() * 0.4), s));
        const rad = _c.setHSL(0.24 + rnd() * 0.08, 0.45, 0.2 + rnd() * 0.07, THREE.SRGBColorSpace);
        const duskward = new THREE.Color().setHSL(0.03 + rnd() * 0.06, 0.3, 0.12 + rnd() * 0.05, THREE.SRGBColorSpace);
        field.add(_m, rad.clone().lerp(duskward, corr), g);
      });
    }
    this.addScatter(field, geos.map((geo, g) => new ViewInstances(geo, mat, pts[g].length, { castShadow: true, name: 'bushes' })));
  }

  buildRocks(rnd) {
    const td = this.world.td;
    const tex = loadTexture('tex/Rock030_c.jpg');
    const ntex = loadTexture('tex/Rock030_n.jpg', { srgb: false });
    const mat = new THREE.MeshStandardMaterial({ map: tex, normalMap: ntex, roughness: 0.9, color: 0x5e5852, flatShading: true });
    patchMaterial(mat, 'rock-fow', (sh) => injectFow(sh));
    this.rockMat = mat;
    const geos = [rockGeo(3), rockGeo(8), rockGeo(15)];
    const pts = [[], [], []];
    const tryAdd = (x, z, s, blocking) => {
      pts[Math.floor(rnd() * 3)].push({ x, z, s, blocking });
    };
    // scattered jungle / riverbank rocks
    for (let i = 0; i < 1400; i++) {
      const x = (rnd() - 0.5) * 196, z = (rnd() - 0.5) * 196;
      const lane = this.sampleField(td.lane, x, z), resD = this.sampleField(td.res, x, z), path = this.sampleField(td.path, x, z);
      const rd = riverDist(x, z);
      const bank = rd > 6.5 && rd < 10;
      const clear = Math.min(lane - 5, resD, path - 2);
      if (clear < 0) continue;
      if (!bank && rnd() < 0.6) continue;
      const s = bank ? 0.4 + rnd() * 0.7 : 0.3 + rnd() * rnd() * 1.6;
      tryAdd(x, z, s, s > 0.9 && clear > 1.5);
    }
    // cliff rocks along the plateau edges
    for (let i = 0; i < 9000; i++) {
      const x = (rnd() - 0.5) * 200, z = (rnd() - 0.5) * 200;
      const slope = this.sampleField(td.slope, x, z);
      if (slope < 1.0) continue;
      const lane = this.sampleField(td.lane, x, z);
      if (lane < 6 || this.sampleField(td.res, x, z) < 0) continue;
      tryAdd(x, z, 0.9 + rnd() * 1.1, false);
    }
    const field = new ScatterField(pts[0].length + pts[1].length + pts[2].length);
    for (let g = 0; g < 3; g++) {
      pts[g].forEach((r) => {
        _q.setFromEuler(_e.set((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4));
        const y = this.world.getHeight(r.x, r.z);
        _m.compose(_p.set(r.x, y - r.s * 0.15, r.z), _q, _s.set(r.s, r.s * (0.8 + rnd() * 0.5), r.s));
        const corr = this.sampleField(td.corr, r.x, r.z);
        _c.setRGB(1, 1, 1).lerp(new THREE.Color(0.55, 0.45, 0.42), corr);
        field.add(_m, _c.multiplyScalar(0.85 + rnd() * 0.3), g);
        if (r.blocking) this.world.nav.staticCircle(r.x, r.z, r.s * 0.8);
      });
    }
    this.addScatter(field, geos.map((geo, g) => new ViewInstances(geo, mat, pts[g].length, { castShadow: true, name: 'rocks' })));
  }

  buildGrass(rnd, hq) {
    const w = this.world, td = w.td, sp = w.splat;
    const grassTex = makeGrassSprite();
    const flowerTex = makeFlowerSprite();
    const mkMat = (map, key) => {
      const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: 0xffffff });
      patchMaterial(m, key, (sh) => {
        injectWind(sh, { base: 0.0, amount: 0.22, freq: 2.1 });
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
        injectFow(sh);
      });
      return m;
    };
    const grassMat = mkMat(grassTex, 'grass-tuft');
    const flowerMat = mkMat(flowerTex, 'flower-tuft');
    const tuft = tuftGeo(0.8, 0.7, 5);
    const ftuft = tuftGeo(0.6, 0.45, 3);
    const splatW = (x, z) => {
      const i = Math.round((x + EXT) / RES), j = Math.round((z + EXT) / RES);
      const k = (j * N + i) * 4;
      return { grass: sp.A[k] / 255, dirt: sp.A[k + 1] / 255, stone: sp.A[k + 2] / 255, rock: sp.A[k + 3] / 255, duskward: sp.B[k] / 255 };
    };
    const total = 70000;
    const list = [];
    for (let i = 0; i < total; i++) {
      const x = (rnd() - 0.5) * 199, z = (rnd() - 0.5) * 199;
      const s = splatW(x, z);
      const g = s.grass + s.duskward * 0.7 + s.dirt * 0.25;
      const dens = smoothstep(0.35, 0.9, g) * (0.35 + 0.65 * smoothstep(-0.2, 0.3, fbm(x * 0.06, z * 0.06, 3, 91)));
      if (rnd() > dens) continue;
      if (riverDist(x, z) < 6) continue;
      const corr = this.sampleField(td.corr, x, z);
      const flower = corr < 0.3 && rnd() < 0.07;
      list.push([x, z, corr, flower]);
    }
    const field = new ScatterField(list.length);
    const counts = [0, 0];
    const palette = [0xffffff, 0xffe066, 0xff9ec7, 0xb9a6ff, 0xff7b5c];
    const dead = new THREE.Color();
    for (const [x, z, corr, flower] of list) {
      const sc = 0.7 + rnd() * 0.7;
      _q.setFromEuler(_e.set(0, rnd() * 6.28, 0));
      _m.compose(_p.set(x, w.getHeight(x, z) - 0.03, z), _q, _s.set(sc, sc * (0.7 + rnd() * 0.6), sc));
      if (flower) _c.set(palette[Math.floor(rnd() * palette.length)]);
      else {
        _c.setRGB(0.62 + rnd() * 0.25, 0.72 + rnd() * 0.2, 0.42 + rnd() * 0.12);
        dead.setRGB(0.55 + rnd() * 0.15, 0.36 + rnd() * 0.1, 0.22);
        _c.lerp(dead, corr);
      }
      field.add(_m, _c, flower ? 1 : 0, rnd());
      counts[flower ? 1 : 0]++;
    }
    const meshes = [
      new ViewInstances(tuft, grassMat, counts[0], { name: 'grass' }),
      new ViewInstances(ftuft, flowerMat, counts[1], { name: 'flowers' }),
    ];
    for (const vi of meshes) this.grassMeshes.push(vi.mesh);
    this.addScatter(field, meshes, true);
    this.setGrassDensity(hq ? 1 : 0.35);
  }

  setGrassDensity(f) {
    if (f === this.grassDensity) return;
    this.grassDensity = f;
    this._viewDirty = true;
  }
}
