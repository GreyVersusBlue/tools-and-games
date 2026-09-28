import * as THREE from 'three';
import { GLTFLoader } from '../libs/addons/loaders/GLTFLoader.js';

// The prop pack (assets/models/props/*.glb, made by tools/blender/props.py):
// 45 pieces, not assemblies (#665). Every prop builder still loops over
// field.js's LAYOUT and still stands each entry on its own ground or on
// pierDeckY; what it stands there is now a piece, not a primitive (B6).
//
// Each piece was built at a reference entry (`ref` in budget.json) with its
// origin at the centre of its base (#665). The builders placed each primitive
// by its own origin, which for a cylinder, a sphere or a box is the middle. So
// piece() hands back the file's geometry moved down so the builder's origin is
// at 0 again (half its own height, or ORIGIN_UP where the primitive's origin
// was not its middle), and a builder places it exactly where it placed the
// primitive, turned the same way, scaled by its entry over `ref`. Nothing that
// is walked on, picked up or thrown moves (#664).
//
// loadPieces() is awaited before the builders run, and a file that is missing
// or will not parse rejects it, naming the piece. There is no fallback to the
// primitives: they are gone.

export const PIECES = [
  'driftwood-1', 'driftwood-2', 'driftwood-3', 'driftwood-4',
  'groyne-post-1', 'groyne-post-2', 'groyne-post-3',
  'boulder-1', 'boulder-2', 'boulder-3',
  'wrack-shell', 'wrack-pebble', 'wrack-weed',
  'fence-post-1', 'fence-post-2', 'fence-post-3',
  'pool-stone-1', 'pool-stone-2', 'pool-stone-3',
  'cave-block-1', 'cave-block-2', 'cave-rubble-1', 'cave-rubble-2',
  'pier-pile-1', 'pier-pile-2', 'pier-stump-1', 'pier-stump-2',
  'pier-plank-1', 'pier-plank-2', 'pier-plank-3', 'pier-stringer',
  'cockle-1', 'cockle-2', 'cockle-3', 'whelk-1', 'whelk-2', 'whelk-3',
  'sand-dollar', 'sea-glass-1', 'sea-glass-2', 'sea-glass-3',
  'skimming-stone-1', 'skimming-stone-2', 'skimming-stone-3',
  'sandcastle',
];

// The entry each piece was built at, from budget.json's `ref` (#665). A
// builder scales by its entry's numbers over these.
export const REF = {
  groyne: { r: 0.2, len: 3.9 },
  boulder: { r: 1.5 },
  wrack: { s: 0.195 },
  fence: { h: 0.975 },
  poolStone: { r: 0.22 },
  caveBlock: { r: 1.375 },
  caveRubble: { r: 0.27 },
  pile: { len: 3.0 },
  stump: { len: 4.1 },
  plank: { w: 4.1 },
  stringer: { len: 27.6 },
  shell: { s: 0.175 },
  stone: { s: 0.065 },
};

// How far above its own base the builder's primitive had its origin, in
// metres at `ref`, where that was not the middle of the piece.
//   wrack-shell  a sphere cut at 0.55 pi and squashed 0.5: its centre is
//                cos(0.55 pi) x 0.5 = 0.078 over the rim, at s 0.195
//   cockle       y clamped at -0.06 below the centre, at s 0.175
//   whelk        the spiral's last ring, 0.35 + 0.331 below its origin, at s 0.175
//   driftwood, sandcastle  the builders stood them on the ground: 0
export const ORIGIN_UP = {
  'wrack-shell': 0.078 * 0.195,
  'cockle-1': 0.06 * 0.175, 'cockle-2': 0.06 * 0.175, 'cockle-3': 0.06 * 0.175,
  'whelk-1': 0.681 * 0.175, 'whelk-2': 0.681 * 0.175, 'whelk-3': 0.681 * 0.175,
  'driftwood-1': 0, 'driftwood-2': 0, 'driftwood-3': 0, 'driftwood-4': 0,
  sandcastle: 0,
};

/** A variant by an entry's seed: 0 to n - 1, negative seeds included. */
export const variant = (seed, n) => (((seed | 0) % n) + n) % n;

const BASE = new URL('../assets/models/props/', import.meta.url);

/**
 * name -> { geometry, material }, each geometry in the builder's frame (its
 * origin where the builder's primitive had its origin). Rejects on the first
 * file that fails, by name.
 */
export async function loadPieces(names = PIECES, base = BASE) {
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(names.map(async name => {
    const url = new URL(`${name}.glb`, base).href;
    let gltf;
    try { gltf = await loader.loadAsync(url); }
    catch (e) { throw new Error(`Golden Hour: the ${name} piece did not load (${url}): ${e && e.message || e}`); }
    let mesh = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) throw new Error(`Golden Hour: the ${name} piece has no mesh`);
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const up = name in ORIGIN_UP ? ORIGIN_UP[name] : (bb.max.y - bb.min.y) / 2;
    geometry.translate(0, -bb.min.y - up, 0);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.name = name;
    out[name] = { geometry, material: mesh.material };
  }));
  return out;
}

/**
 * Every placement of a piece as one InstancedMesh named for it: one draw call
 * per variant, where the builders merged one per builder. `place` is a list
 * of { x, y, z, rx, ry, rz, sx, sy, sz }, each the builder's own position and
 * turn for its primitive and its entry over `ref`. Every builder turned its
 * primitive about one axis except the wrack, whose Euler was XYZ, the default.
 */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function instances(pieces, name, place, order = 'XYZ') {
  const piece = pieces[name];
  if (!piece) throw new Error(`Golden Hour: no ${name} piece was loaded`);
  const inst = new THREE.InstancedMesh(piece.geometry, piece.material, place.length);
  inst.name = name;
  place.forEach((t, i) => {
    _e.set(t.rx || 0, t.ry || 0, t.rz || 0, order);
    _q.setFromEuler(_e);
    _p.set(t.x, t.y, t.z);
    _s.set(t.sx ?? 1, t.sy ?? t.sx ?? 1, t.sz ?? t.sx ?? 1);
    inst.setMatrixAt(i, _m.compose(_p, _q, _s));
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingBox();
  inst.computeBoundingSphere();
  return inst;
}

/** Group placements by variant and make one InstancedMesh per variant used. */
export function byVariant(pieces, names, entries, order) {
  const lists = names.map(() => []);
  for (const e of entries) lists[e.v].push(e);
  const out = [];
  names.forEach((name, i) => { if (lists[i].length) out.push(instances(pieces, name, lists[i], order)); });
  return out;
}

/** One piece as a Mesh of its own, sharing its geometry and material. */
export function pieceMesh(pieces, name) {
  const piece = pieces[name];
  if (!piece) throw new Error(`Golden Hour: no ${name} piece was loaded`);
  const mesh = new THREE.Mesh(piece.geometry, piece.material);
  mesh.name = name;
  return mesh;
}
