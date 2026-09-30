import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { M, mat } from './materials.js';
import { part } from './props.js';

// ------------------------------------------------------------------ baked GLB stonework (tools/blender/structures)
// public/assets/structures/<name>.glb holds: 'body' (baked albedo x AO + RGB region mask in the emissive slot:
// R = stone, G = metal trim, B = cloth/roof, tinted per team in the shader), 'glow' (team emissive colour) and optional
// 'extra_sunward' / 'extra_duskward' silhouette pieces. Loading starts at import time; builders fall back to the
// procedural primitives below whenever a GLB is not (yet) available, so nothing ever blocks or throws.
const GLB_NAMES = ['tower', 'barracks_melee', 'barracks_ranged', 'fountain', 'shop', 'throneshard_sunward', 'throneshard_duskward'];
const GLB = {};
let _glbPromise = null;

/** Preload the structure GLBs (idempotent). Await before building structure templates to get the baked models. */
export function initStructures() {
  if (_glbPromise) return _glbPromise;
  const base = '';
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  _glbPromise = Promise.all(GLB_NAMES.map((n) => loader.loadAsync(base + 'assets/structures/' + n + '.glb')
    .then((g) => { GLB[n] = g.scene; })
    .catch(() => { GLB[n] = null; }))).then(() => GLB);
  return _glbPromise;
}
export function structuresReady() { return GLB_NAMES.every((n) => n in GLB); }
if (typeof window !== 'undefined') initStructures();

// Team tints are linear-space multipliers of the (light, neutral) baked albedo inside each mask region.
const TEAM_LOOK = {
  sunward: { stone: [1.0, 0.86, 0.64], metal: [1.0, 0.6, 0.17], cloth: [0.05, 0.15, 0.07], metalness: 0.85, glow: 0x4dff7a, extra: () => M.metal(0xc9a24a, 0.35) },
  duskward: { stone: [0.075, 0.068, 0.088], metal: [0.14, 0.07, 0.06], cloth: [0.13, 0.025, 0.02], metalness: 0.6, glow: 0xff3322, extra: () => M.flat(0x2e2226, 0.5) },
  neutral: { stone: [0.85, 0.76, 0.6], metal: [1.0, 0.6, 0.17], cloth: [0.42, 0.14, 0.04], metalness: 0.85, glow: 0xffcc55, extra: () => M.metal(0xc9a24a, 0.35) },
  secret: { stone: [0.35, 0.35, 0.55], metal: [0.6, 0.6, 0.75], cloth: [0.16, 0.08, 0.5], metalness: 0.7, glow: 0xa070ff, extra: () => M.flat(0x3a2a6a, 0.5) },
};
const _bodyMats = new Map();
function bodyMaterial(key, src, team) {
  const k = key + ':' + team;
  if (_bodyMats.has(k)) return _bodyMats.get(k);
  const look = TEAM_LOOK[team] ?? TEAM_LOOK.neutral;
  const mask = src.emissiveMap;
  if (mask) { mask.colorSpace = THREE.NoColorSpace; mask.needsUpdate = true; }
  const m = new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.82, metalness: 0 });
  const u = { uMask: { value: mask }, uStone: { value: new THREE.Vector3(...look.stone) }, uMetal: { value: new THREE.Vector3(...look.metal) }, uCloth: { value: new THREE.Vector3(...look.cloth) }, uMetalness: { value: look.metalness } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = 'uniform sampler2D uMask; uniform vec3 uStone; uniform vec3 uMetal; uniform vec3 uCloth; uniform float uMetalness;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 sMask = texture2D(uMask, vMapUv).rgb;
        diffuseColor.rgb *= vec3(1.0) + sMask.r * (uStone - 1.0) + sMask.g * (uMetal - 1.0) + sMask.b * (uCloth - 1.0);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.38, sMask.g);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = sMask.g * uMetalness;');
  };
  m.customProgramCacheKey = () => 'struct-body';
  _bodyMats.set(k, m);
  return m;
}

// Clone the baked meshes of a GLB for a team (geometry & textures shared). Returns null if not loaded.
function glbGroup(key, team) {
  const scene = GLB[key];
  if (!scene) return null;
  const look = TEAM_LOOK[team] ?? TEAM_LOOK.neutral;
  const g = new THREE.Group();
  g.name = 'glb:' + key;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name || '';
    let material;
    if (n.startsWith('body')) material = bodyMaterial(key, o.material, team);
    else if (n.startsWith('glow')) material = M.glow(look.glow, key.startsWith('throneshard_duskward') ? 2.2 : 1.8);
    else if (n.startsWith('extra_')) {
      const which = n.slice(6);
      if (which !== (team === 'duskward' ? 'duskward' : 'sunward')) return;
      material = look.extra();
    } else material = o.material;
    const m = new THREE.Mesh(o.geometry, material);
    m.name = n;
    m.matrixAutoUpdate = true;
    o.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  });
  return g;
}

// Procedural high-detail structures. Each builder returns a Group (origin at ground centre, facing +Z).
// Named nodes are animated by StructureModel: 'spin' (rotate Y), 'spinX', 'bob' (float), 'pulse' (scale pulse),
// 'orbit' (slow rotate), 'wheel' (spin while moving), 'arm' (siege arm), 'crystal' (flash on attack), 'eye'.

const G = {};
const geo = (key, make) => (G[key] ??= make());
const cyl = (rt, rb, h, seg = 8, open = false) => geo(`c${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
const box = (x, y, z) => geo(`b${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z));
const cone = (r, h, seg = 8) => geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const oct = (r, d = 0) => geo(`o${r},${d}`, () => new THREE.OctahedronGeometry(r, d));
const ico = (r, d = 0) => geo(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d));
const dode = (r, d = 0) => geo(`d${r},${d}`, () => new THREE.DodecahedronGeometry(r, d));
const torus = (r, t, rs = 6, ts = 24) => geo(`t${r},${t},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));
const sph = (r, w = 16, h = 12) => geo(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));

const TEAM_GLOW = { sunward: 0x4dff7a, duskward: 0xff3322, neutral: 0xffcc55 };
const glowOf = (team) => TEAM_GLOW[team] ?? TEAM_GLOW.neutral;

function sprite(color, size, opacity = 0.9, y = 0) {
  const s = new THREE.Sprite(M.sprite(color, opacity));
  s.scale.setScalar(size);
  s.position.y = y;
  return s;
}
function named(obj, name) { obj.name = name; return obj; }
function ring(n, fn) { const g = new THREE.Group(); for (let i = 0; i < n; i++) g.add(fn((i / n) * Math.PI * 2, i)); return g; }

// ------------------------------------------------------------------ TOWER (~9 tall)
function towerCrystal(team) {
  const glow = glowOf(team);
  const cr = named(new THREE.Group(), 'crystal');
  cr.position.y = 7.9;
  const core = named(part(oct(0.6, 0), M.glow(glow, 2.8), [0, 0, 0], [0, 0, 0], [1, 1.7, 1]), 'spin');
  core.castShadow = false;
  cr.add(core);
  cr.add(sprite(glow, 3.2, 0.55));
  const shards = named(ring(3, (a) => part(oct(0.18, 0), M.glow(glow, 2), [Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0], [0, 0, 0], [1, 2, 1])), 'orbit');
  cr.add(shards);
  cr.userData.bob = 0.15;
  return cr;
}

export function buildTower(team) {
  const baked = glbGroup('tower', team);
  if (baked) { baked.add(towerCrystal(team)); return baked; }
  const duskward = team === 'duskward';
  const g = new THREE.Group();
  const glow = glowOf(team);
  const stoneA = duskward ? M.stone(0x9a8a98) : M.stone(0xd8ccb0);
  const stoneB = duskward ? M.stone(0x6e5e6c) : M.stone(0xb8ab90);
  const trim = duskward ? M.metal(0x4a3030, 0.5) : M.metal(0xc9a24a, 0.35);
  const band = duskward ? M.lavaStone(0x3a3035, glow) : M.runeStone(0xc8bca0, glow);

  // stepped octagonal base
  g.add(part(cyl(2.3, 2.5, 0.6, 8), stoneB, [0, 0.3, 0]));
  g.add(part(cyl(2.0, 2.2, 0.5, 8), stoneA, [0, 0.85, 0]));
  g.add(part(cyl(1.85, 1.95, 0.35, 8), band, [0, 1.25, 0]));
  // buttresses
  g.add(ring(4, (a) => part(box(0.6, 2.4, 1.3), stoneB, [Math.cos(a + Math.PI / 4) * 1.6, 1.5, Math.sin(a + Math.PI / 4) * 1.6], [0, -a - Math.PI / 4, duskward ? 0.12 : 0.08])));
  // shaft
  g.add(part(cyl(1.15, 1.45, 4.4, 8), stoneA, [0, 3.6, 0]));
  g.add(part(torus(1.42, 0.12, 5, 8), trim, [0, 1.55, 0], [Math.PI / 2, 0, Math.PI / 8]));
  g.add(part(cyl(1.32, 1.36, 0.45, 8), band, [0, 3.4, 0]));
  g.add(part(torus(1.2, 0.1, 5, 8), trim, [0, 5.75, 0], [Math.PI / 2, 0, Math.PI / 8]));
  // windows / arrow slits
  g.add(ring(4, (a) => part(box(0.25, 0.8, 0.2), M.glow(glow, 1.2), [Math.cos(a) * 1.28, 4.6, Math.sin(a) * 1.28], [0, -a + Math.PI / 2, 0])));
  // top platform
  g.add(part(cyl(1.8, 1.25, 0.5, 8), stoneB, [0, 6.1, 0]));
  g.add(part(cyl(1.85, 1.85, 0.18, 8), trim, [0, 6.42, 0]));
  if (duskward) {
    // outward curving spikes + base spikes
    g.add(ring(6, (a) => part(cone(0.22, 1.9, 5), M.flat(0x3a2a30, 0.5), [Math.cos(a) * 1.6, 7.2, Math.sin(a) * 1.6], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5])));
    g.add(ring(8, (a) => part(cone(0.25, 1.4, 5), M.flat(0x3a2a30, 0.5), [Math.cos(a) * 2.35, 0.9, Math.sin(a) * 2.35], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9])));
    g.add(ring(4, (a) => part(cone(0.18, 1.1, 5), M.glow(glow, 1.5), [Math.cos(a + 0.4) * 1.5, 4.4, Math.sin(a + 0.4) * 1.5], [Math.sin(a + 0.4) * 1.2, 0, -Math.cos(a + 0.4) * 1.2])));
  } else {
    // graceful pillars holding the crystal, capped with gold leaves
    g.add(ring(4, (a) => {
      const p = new THREE.Group();
      p.add(part(cyl(0.14, 0.2, 1.8, 6), stoneA, [0, 0.9, 0]));
      p.add(part(cone(0.22, 0.6, 6), trim, [0, 2.0, 0]));
      p.position.set(Math.cos(a + Math.PI / 4) * 1.45, 6.5, Math.sin(a + Math.PI / 4) * 1.45);
      p.rotation.set(Math.sin(a + Math.PI / 4) * 0.2, 0, -Math.cos(a + Math.PI / 4) * 0.2);
      return p;
    }));
    g.add(ring(8, (a) => part(box(0.35, 0.35, 0.35), stoneA, [Math.cos(a) * 1.7, 6.65, Math.sin(a) * 1.7], [0, -a, 0])));
  }
  // crystal
  const cr = named(new THREE.Group(), 'crystal');
  cr.position.y = 7.9;
  const core = named(part(oct(0.6, 0), M.glow(glow, 2.8), [0, 0, 0], [0, 0, 0], [1, 1.7, 1]), 'spin');
  core.castShadow = false;
  cr.add(core);
  cr.add(sprite(glow, 3.2, 0.55));
  const shards = named(ring(3, (a) => part(oct(0.18, 0), M.glow(glow, 2), [Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0], [0, 0, 0], [1, 2, 1])), 'orbit');
  cr.add(shards);
  g.add(named(cr, 'crystal'));
  cr.userData.bob = 0.15;
  return g;
}

// ------------------------------------------------------------------ BARRACKS (~6 tall)
export function buildBarracks(team, ranged) {
  const baked = glbGroup(ranged ? 'barracks_ranged' : 'barracks_melee', team);
  if (baked) {
    const glow = glowOf(team);
    if (ranged) baked.add(named(part(ico(0.35, 1), M.glow(glow, 2.5), [0, 6.55, 0]), 'pulse'), sprite(glow, 1.8, 0.6, 6.55));
    else baked.add(named(sprite(glow, 1.6, 0.5, 6.2), 'pulse'));
    return baked;
  }
  const duskward = team === 'duskward';
  const g = new THREE.Group();
  const glow = glowOf(team);
  const stoneA = duskward ? M.stone(0x9a8a98) : M.stone(0xd6c9ab);
  const stoneB = duskward ? M.stone(0x6e5e6c) : M.stone(0xa89a80);
  const trim = duskward ? M.metal(0x4a3030, 0.5) : M.metal(0xc9a24a, 0.35);
  const roofM = duskward ? M.flat(0x4a2a30, 0.6) : M.flat(0x3f7a4a, 0.6);
  const banner = M.cloth(duskward ? 0x8a1a14 : 0x2f7a3a);

  g.add(part(box(6.4, 0.5, 6.4), stoneB, [0, 0.25, 0]));
  g.add(part(box(5.8, 0.4, 5.8), stoneA, [0, 0.7, 0]));
  // steps at front
  g.add(part(box(2.2, 0.25, 0.8), stoneA, [0, 0.12, 3.5]));
  if (!ranged) {
    g.add(part(box(4.4, 2.8, 4.4), stoneA, [0, 2.3, 0]));
    g.add(part(box(4.6, 0.3, 4.6), trim, [0, 3.8, 0]));
    // pyramid roof
    g.add(part(cone(3.6, 2.2, 4), roofM, [0, 5.0, 0], [0, Math.PI / 4, 0]));
    g.add(part(sph(0.3), M.glow(glow, 2.5), [0, 6.2, 0]));
  } else {
    g.add(part(cyl(2.3, 2.5, 2.8, 10), stoneA, [0, 2.3, 0]));
    g.add(part(cyl(2.55, 2.55, 0.3, 10), trim, [0, 3.8, 0]));
    g.add(part(cone(2.8, 1.4, 10), roofM, [0, 4.6, 0]));
    // slim spire with orb
    g.add(part(cyl(0.25, 0.35, 1.2, 6), stoneB, [0, 5.6, 0]));
    const orb = named(part(ico(0.35, 1), M.glow(glow, 2.5), [0, 6.5, 0]), 'pulse');
    g.add(orb, sprite(glow, 1.8, 0.6, 6.5));
  }
  // corner pillars
  g.add(ring(4, (a) => {
    const p = new THREE.Group();
    p.add(part(cyl(0.35, 0.4, 3.6, 8), stoneB, [0, 1.8, 0]));
    p.add(part(box(0.9, 0.3, 0.9), trim, [0, 3.7, 0]));
    p.add(duskward ? part(cone(0.3, 1.4, 5), M.flat(0x3a2a30, 0.5), [0, 4.5, 0]) : part(cone(0.35, 0.7, 8), trim, [0, 4.2, 0]));
    p.position.set(Math.cos(a + Math.PI / 4) * 3.1, 0.9, Math.sin(a + Math.PI / 4) * 3.1);
    return p;
  }));
  // door + emblem
  g.add(part(box(1.3, 1.9, 0.2), M.wood(0x5a3a22), [0, 1.85, ranged ? 2.35 : 2.25]));
  const emb = new THREE.Group();
  emb.position.set(0, 3.2, ranged ? 2.45 : 2.3);
  if (!ranged) {
    emb.add(part(box(0.12, 1.2, 0.06), M.glow(glow, 2), [0, 0, 0.05], [0, 0, 0.6]));
    emb.add(part(box(0.12, 1.2, 0.06), M.glow(glow, 2), [0, 0, 0.05], [0, 0, -0.6]));
  } else {
    emb.add(part(torus(0.45, 0.05, 4, 16), M.glow(glow, 2), [0, 0, 0.05], [0, 0, 0]));
    emb.add(part(box(0.08, 1.0, 0.06), M.glow(glow, 2), [0, 0, 0.08], [0, 0, Math.PI / 2]));
  }
  g.add(emb);
  // side banners
  for (const s of [-1, 1]) {
    g.add(part(geo('bannerPlane', () => new THREE.PlaneGeometry(0.9, 2.0)), banner, [s * (ranged ? 2.52 : 2.22), 2.4, 0], [0, s * Math.PI / 2, 0]));
  }
  return g;
}

// ------------------------------------------------------------------ THRONESHARD (~12 tall)
export function buildThroneshard(team) {
  const baked = glbGroup(team === 'duskward' ? 'throneshard_duskward' : 'throneshard_sunward', team);
  if (baked) {
    if (team === 'duskward') {
      const glow = 0xff3a1a;
      const core = named(new THREE.Group(), 'pulse');
      core.position.set(0, 5.2, 1.7);
      core.add(part(ico(0.9, 1), M.glow(glow, 3.2)));
      core.add(sprite(glow, 5.5, 0.6));
      baked.add(core);
      baked.add(named(ring(7, (a, i) => part(dode(0.35 + (i % 3) * 0.15, 0), M.lavaStone(0x3a2a2e, glow), [Math.cos(a) * 4.6, 4 + (i % 3) * 1.4, Math.sin(a) * 4.6], [i, i * 0.7, 0])), 'orbit'));
      baked.add(sprite(0xff4010, 9, 0.25, 3));
    } else {
      const glow = 0x6dffb0;
      const core = named(new THREE.Group(), 'pulse');
      core.position.set(0, 3.4, 2.1);
      core.add(named(part(oct(0.8, 0), M.glow(glow, 3), [0, 0, 0], [0, 0, 0], [1, 1.8, 1]), 'spin'));
      core.add(sprite(glow, 6, 0.55));
      baked.add(core);
      baked.add(named(ring(6, (a) => part(box(0.5, 1.1, 0.25), M.runeStone(0xd8ccb0, glow), [Math.cos(a) * 4.9, 3.2 + Math.sin(a * 3) * 0.3, Math.sin(a) * 4.9], [0, -a, 0])), 'orbit'));
    }
    return baked;
  }
  return team === 'duskward' ? buildDuskwardThroneshard() : buildSunwardThroneshard();
}

function buildSunwardThroneshard() {
  const g = new THREE.Group();
  const glow = 0x6dffb0;
  const stone = M.stone(0xd8ccb0);
  // tiered platform
  g.add(part(cyl(5.6, 6.0, 0.6, 12), M.stone(0xa89a80), [0, 0.3, 0]));
  g.add(part(cyl(4.8, 5.2, 0.6, 12), stone, [0, 0.9, 0]));
  g.add(part(cyl(4.2, 4.3, 0.25, 12), M.runeStone(0xc8bca0, glow), [0, 1.32, 0]));
  // roots
  g.add(ring(7, (a, i) => part(cyl(0.18, 0.5, 3.6, 6), M.bark(0xf0d0b0), [Math.cos(a) * 2.6, 2.2, Math.sin(a) * 2.6], [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7])));
  // central trunk + twisted strands
  g.add(part(cyl(0.9, 1.5, 7.5, 9), M.bark(0xffe8d0), [0, 4.6, 0]));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const strand = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      const r = 1.2 - t * 0.5;
      const aa = a + t * 1.6;
      strand.add(part(cyl(0.4 - t * 0.06, 0.48 - t * 0.06, 2.6, 7), M.bark(0xffe0c0), [Math.cos(aa) * r, 2.3 + k * 1.8, Math.sin(aa) * r], [Math.sin(aa) * 0.25, 0, -Math.cos(aa) * 0.25]));
    }
    g.add(strand);
  }
  // canopy
  const canopy = named(new THREE.Group(), 'sway');
  const leafA = mat('throneLeafA', { color: 0x3fa84a, roughness: 0.8, emissive: 0x0a3a10, emissiveIntensity: 0.6, flatShading: true });
  const leafB = mat('throneLeafB', { color: 0x7ad65a, roughness: 0.8, emissive: 0x145a1a, emissiveIntensity: 0.6, flatShading: true });
  const blobs = [[0, 10.2, 0, 2.6], [1.9, 9.3, 0.6, 1.9], [-1.8, 9.4, -0.4, 2.0], [0.5, 9.2, -1.9, 1.8], [-0.6, 9.0, 1.9, 1.8], [0.2, 11.4, 0.3, 1.5], [2.4, 8.4, -1.2, 1.2], [-2.3, 8.3, 1.3, 1.3]];
  blobs.forEach(([x, y, z, r], i) => canopy.add(part(ico(r, 1), i % 2 ? leafB : leafA, [x, y, z], [i, i * 2, 0])));
  // glowing blossoms
  canopy.add(ring(10, (a, i) => part(oct(0.22), M.glow(0xcaffd8, 2.4), [Math.cos(a) * (2 + (i % 3) * 0.4), 8.4 + (i % 4) * 0.8, Math.sin(a) * (2 + (i % 3) * 0.4)])));
  g.add(canopy);
  // core crystal between roots
  const core = named(new THREE.Group(), 'pulse');
  core.position.set(0, 3.4, 2.1);
  core.add(named(part(oct(0.8, 0), M.glow(glow, 3), [0, 0, 0], [0, 0, 0], [1, 1.8, 1]), 'spin'));
  core.add(sprite(glow, 6, 0.55));
  g.add(core);
  // floating runestones
  const orbit = named(ring(6, (a) => part(box(0.5, 1.1, 0.25), M.runeStone(0xd8ccb0, glow), [Math.cos(a) * 4.4, 3.2 + Math.sin(a * 3) * 0.3, Math.sin(a) * 4.4], [0, -a, 0])), 'orbit');
  g.add(orbit);
  return g;
}

function buildDuskwardThroneshard() {
  const g = new THREE.Group();
  const glow = 0xff3a1a;
  const lava = M.lavaStone(0x6a5558, glow);
  const dark = M.rock(0x6a5a60);
  g.add(part(cyl(5.6, 6.2, 0.7, 9), dark, [0, 0.35, 0]));
  g.add(part(cyl(4.6, 5.3, 0.6, 9), lava, [0, 1.0, 0]));
  // lava pool
  g.add(part(geo('lavaPool', () => new THREE.CircleGeometry(4.3, 24).rotateX(-Math.PI / 2)), M.glow(0xff5010, 1.8), [0, 1.32, 0]));
  // jagged spires
  const spires = [[0, 0, 1.9, 11.5, 0, 0], [1.6, 0.6, 1.2, 7.5, 0.25, 0.1], [-1.4, 0.9, 1.1, 8.2, -0.2, 0.2], [0.4, -1.7, 1.0, 6.8, -0.1, -0.3], [-1.0, -1.2, 0.9, 5.5, -0.35, -0.2], [2.1, -1.2, 0.8, 5.0, 0.3, -0.25], [-2.3, 0.0, 0.8, 4.5, -0.4, 0]];
  spires.forEach(([x, z, r, h, rz, rx], i) => g.add(part(cone(r, h, 6), i % 2 ? lava : dark, [x, 1.2 + h / 2, z], [rx, i, rz])));
  // core caged orb
  const core = named(new THREE.Group(), 'pulse');
  core.position.set(0, 5.2, 1.7);
  core.add(part(ico(0.9, 1), M.glow(glow, 3.2)));
  core.add(sprite(glow, 5.5, 0.6));
  g.add(core);
  g.add(ring(5, (a) => part(cone(0.12, 2.4, 4), M.flat(0x160c10, 0.5), [Math.cos(a) * 1.2, 5.2, 1.7 + Math.sin(a) * 1.2], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4])));
  // floating volcanic rocks
  const orbit = named(ring(7, (a, i) => part(dode(0.35 + (i % 3) * 0.15, 0), i % 2 ? lava : dark, [Math.cos(a) * 4.6, 4 + (i % 3) * 1.4, Math.sin(a) * 4.6], [i, i * 0.7, 0])), 'orbit');
  g.add(orbit);
  g.add(sprite(0xff4010, 9, 0.25, 3));
  return g;
}

// ------------------------------------------------------------------ FOUNTAIN (~6 tall)
export function buildFountain(team) {
  const baked = glbGroup('fountain', team);
  if (baked) {
    const glow = glowOf(team);
    baked.add(named(part(geo('fwater', () => new THREE.CircleGeometry(3.95, 32).rotateX(-Math.PI / 2)), team === 'duskward' ? M.glow(0xaa1a1a, 0.9) : M.water(), [0, 0.8, 0]), 'water'));
    const cr = named(new THREE.Group(), 'crystal');
    cr.position.y = 5.3;
    cr.add(named(part(oct(0.55), M.glow(glow, 3), [0, 0, 0], [0, 0, 0], [1, 1.6, 1]), 'spin'));
    cr.add(sprite(glow, 3.5, 0.6));
    cr.userData.bob = 0.2;
    baked.add(cr);
    baked.add(named(ring(8, (a, i) => { const sp = sprite(glow, 0.5, 0.8); sp.position.set(Math.cos(a) * 2.5, 1 + (i % 4) * 0.8, Math.sin(a) * 2.5); return sp; }), 'orbit'));
    return baked;
  }
  const duskward = team === 'duskward';
  const g = new THREE.Group();
  const glow = glowOf(team);
  const stone = duskward ? M.stone(0x8a7a88) : M.stone(0xd8ccb0);
  const stoneB = duskward ? M.stone(0x5e4e5c) : M.stone(0xa89a80);
  g.add(part(cyl(4.6, 5.0, 0.4, 16), stoneB, [0, 0.2, 0]));
  g.add(part(torus(4.1, 0.35, 6, 32), stone, [0, 0.75, 0], [Math.PI / 2, 0, 0]));
  g.add(part(cyl(4.0, 4.0, 0.3, 32), stoneB, [0, 0.5, 0]));
  g.add(named(part(geo('fwater', () => new THREE.CircleGeometry(3.95, 32).rotateX(-Math.PI / 2)), duskward ? M.glow(0xaa1a1a, 0.9) : M.water(), [0, 0.8, 0]), 'water'));
  // central pillar
  g.add(part(cyl(0.6, 0.9, 3.4, 8), stone, [0, 2.2, 0]));
  g.add(part(cyl(1.3, 0.6, 0.5, 8), M.runeStone(duskward ? 0x4a3a44 : 0xc8bca0, glow), [0, 4.0, 0]));
  const cr = named(new THREE.Group(), 'crystal');
  cr.position.y = 5.3;
  cr.add(named(part(oct(0.55), M.glow(glow, 3), [0, 0, 0], [0, 0, 0], [1, 1.6, 1]), 'spin'));
  cr.add(sprite(glow, 3.5, 0.6));
  cr.userData.bob = 0.2;
  g.add(cr);
  // four obelisks
  g.add(ring(4, (a) => {
    const o = new THREE.Group();
    o.add(part(box(0.5, 2.4, 0.5), stone, [0, 1.2, 0]));
    o.add(part(cone(0.4, 0.6, 4), M.glow(glow, 2), [0, 2.7, 0], [0, Math.PI / 4, 0]));
    o.position.set(Math.cos(a + Math.PI / 4) * 4.6, 0.3, Math.sin(a + Math.PI / 4) * 4.6);
    return o;
  }));
  // rising healing motes
  g.add(named(ring(8, (a, i) => { const s = sprite(glow, 0.5, 0.8); s.position.set(Math.cos(a) * 2.5, 1 + (i % 4) * 0.8, Math.sin(a) * 2.5); return s; }), 'orbit'));
  return g;
}

// ------------------------------------------------------------------ SHOP (~3.5)
export function buildShop(team) {
  const baked = glbGroup('shop', team === 'secret' ? 'secret' : 'neutral');
  if (baked) {
    const lantern = named(new THREE.Group(), 'bob');
    lantern.position.set(1.6, 2.2, 1.9);
    lantern.add(part(box(0.25, 0.35, 0.25), M.glow(0xffb040, 2)));
    lantern.add(sprite(0xffa030, 1.5, 0.7));
    baked.add(lantern);
    return baked;
  }
  const g = new THREE.Group();
  const secret = team === 'secret';
  g.add(part(box(4, 0.3, 3.2), M.wood(0x9a7a5a), [0, 0.15, 0]));
  g.add(part(box(3.4, 2.0, 2.4), M.stone(secret ? 0x6a6a8a : 0xb8a888), [0, 1.3, -0.3]));
  g.add(part(cone(2.8, 1.6, 4), M.flat(secret ? 0x3a2a6a : 0x8a3a1a, 0.9), [0, 3.1, -0.3], [0, Math.PI / 4, 0], [1, 1, 0.8]));
  // awning
  g.add(part(box(3.6, 0.08, 1.2), M.cloth(secret ? 0x6a4aaa : 0xd8a040), [0, 2.1, 1.3], [0.35, 0, 0]));
  g.add(ring(2, (a, i) => part(cyl(0.06, 0.06, 2.1, 6), M.wood(0x5a3a22), [i ? 1.7 : -1.7, 1.05, 1.8])));
  // counter & goods
  g.add(part(box(3.2, 0.9, 0.5), M.wood(0x7a5a3a), [0, 0.75, 1.1]));
  g.add(part(box(0.6, 0.6, 0.6), M.wood(0xb08050), [-1.9, 0.6, 1.3], [0, 0.4, 0]));
  g.add(part(cyl(0.35, 0.35, 0.8, 10), M.wood(0x8a5a30), [2.0, 0.7, 1.2]));
  g.add(part(sph(0.15), M.glow(0xffd070, 2), [0.8, 1.35, 1.1]));
  g.add(part(oct(0.15), M.glow(0x70d0ff, 2), [-0.6, 1.35, 1.1]));
  g.add(part(sph(0.15), M.glow(0xff5070, 2), [0.1, 1.35, 1.1]));
  const lantern = named(new THREE.Group(), 'bob');
  lantern.position.set(1.6, 2.2, 1.9);
  lantern.add(part(box(0.25, 0.35, 0.25), M.glow(0xffb040, 2)));
  lantern.add(sprite(0xffa030, 1.5, 0.7));
  g.add(lantern);
  // sign with coin
  g.add(part(cyl(0.4, 0.4, 0.08, 16), M.metal(0xffc040, 0.3), [0, 2.6, 1.0], [Math.PI / 2, 0, 0]));
  return g;
}

// ------------------------------------------------------------------ WARD (~1.6)
export function buildWard(team) {
  const g = new THREE.Group();
  const glow = glowOf(team);
  g.add(part(cyl(0.05, 0.07, 1.1, 6), M.bark(0x6a4a2a), [0, 0.55, 0]));
  g.add(ring(3, (a) => part(cone(0.04, 0.4, 4), M.bark(0x5a3a1a), [Math.cos(a) * 0.1, 1.15, Math.sin(a) * 0.1], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6])));
  const eye = named(new THREE.Group(), 'bob');
  eye.position.y = 1.35;
  eye.userData.bob = 0.06;
  eye.add(part(sph(0.18), M.flat(0xf2f0e0, 0.3)));
  eye.add(part(sph(0.09), M.glow(0xffd040, 2.5), [0, 0, 0.12]));
  eye.add(part(sph(0.045), M.flat(0x000000), [0, 0, 0.19]));
  eye.add(sprite(glow, 1.0, 0.6));
  g.add(eye);
  g.add(part(torus(0.35, 0.03, 4, 20), M.glow(glow, 1.5), [0, 0.03, 0], [Math.PI / 2, 0, 0]));
  return g;
}

// ------------------------------------------------------------------ SIEGE CREEP (catapult ~1.8)
export function buildCatapult(team) {
  const duskward = team === 'duskward';
  const g = new THREE.Group();
  const wood = M.wood(duskward ? 0x9a6a5a : 0xc0a080);
  const metal = M.metal(duskward ? 0x3a2a2a : 0x7a7a70, 0.5);
  const body = named(new THREE.Group(), 'body');
  body.add(part(box(1.3, 0.25, 2.2), wood, [0, 0.55, 0]));
  body.add(part(box(0.15, 0.9, 0.15), wood, [0.5, 1.0, -0.2], [0, 0, -0.15]));
  body.add(part(box(0.15, 0.9, 0.15), wood, [-0.5, 1.0, -0.2], [0, 0, 0.15]));
  body.add(part(box(1.2, 0.12, 0.15), metal, [0, 1.4, -0.2]));
  body.add(part(box(1.35, 0.1, 0.1), metal, [0, 0.7, 1.05]));
  if (duskward) body.add(ring(4, (a, i) => part(cone(0.08, 0.4, 4), M.flat(0x1a1010), [i % 2 ? 0.6 : -0.6, 0.6, i < 2 ? 1.1 : -1.1], [i < 2 ? 1.2 : -1.2, 0, 0])));
  // banner
  body.add(part(box(0.04, 1.1, 0.04), wood, [-0.55, 1.2, -1.0]));
  body.add(part(geo('siegeFlag', () => new THREE.PlaneGeometry(0.5, 0.35)), M.cloth(duskward ? 0xa01a14 : 0x2f8a3a), [-0.3, 1.6, -1.0], [0, 0, 0]));
  // arm
  const arm = named(new THREE.Group(), 'arm');
  arm.position.set(0, 0.75, -0.2);
  arm.add(part(box(0.12, 0.12, 1.8), wood, [0, 0, 0.7]));
  arm.add(part(cyl(0.22, 0.14, 0.2, 8, false), metal, [0, 0.1, 1.55]));
  arm.add(part(ico(0.16, 0), M.lavaStone(0x5a5050, duskward ? 0xff3a10 : 0x8aff5a), [0, 0.25, 1.55]));
  arm.userData.rest = -0.35;
  arm.rotation.x = -0.35;
  body.add(arm);
  g.add(body);
  // wheels
  for (const [x, z] of [[0.72, 0.75], [-0.72, 0.75], [0.72, -0.75], [-0.72, -0.75]]) {
    const w = named(new THREE.Group(), 'wheel');
    w.position.set(x, 0.38, z);
    w.add(part(cyl(0.38, 0.38, 0.14, 12), wood, [0, 0, 0], [0, 0, Math.PI / 2]));
    w.add(part(torus(0.38, 0.04, 4, 14), metal, [0, 0, 0], [0, Math.PI / 2, 0]));
    w.add(part(box(0.16, 0.7, 0.08), metal, [0, 0, 0]));
    g.add(w);
  }
  return g;
}
