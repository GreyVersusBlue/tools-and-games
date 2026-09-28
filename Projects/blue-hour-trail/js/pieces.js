import * as THREE from 'three';
import { GLTFLoader } from '../libs/addons/loaders/GLTFLoader.js';

// The trail prop pack (assets/models/props/*.glb, made by tools/blender/props.py):
// 13 files, most of them a whole builder's worth of the old props.js (B5).
//
// Blue Hour's own copy of Golden Hour's js/pieces.js, not an import of it
// (#17), and simpler than it: every file was built in its builder's own frame,
// before that builder's last yaw and translate, and budget.json's `ref.origin`
// is where the builder's origin sits in the grounded file (#683). loadPieces()
// subtracts it, once, so each piece's origin is the builder's again and every
// place(), rotateY and translate in props.js stays as written (B6). Nothing the
// walker finds moves.
//
// A file can carry more than one material (the markers' blazes, the tower's
// panes, the cabin's window, the headlamp's lens are unlit, and arrive as
// MeshBasicMaterial), so a piece is a list of parts, one per material, each in
// the piece's frame.
//
// loadPieces() is awaited before buildProps() runs, and a file that is missing
// or will not parse rejects it, naming the piece. There is no fallback to the
// primitives: they are gone.

export const PIECES = [
  'marker-1', 'marker-2',
  'cairn-stone-1', 'cairn-stone-2', 'cairn-stone-3',
  'bridge', 'bench', 'tower', 'cabin', 'radio', 'headlamp',
  'mushroom', 'mushroom-glow',
];

// budget.json's `ref`, for the pieces a builder scales: the entry each was
// built at (#684).
export const REF = {
  'cairn-stone-1': { r: 0.34 },
  'cairn-stone-2': { r: 0.3328 },
  'cairn-stone-3': { r: 0.2586 },
  bridge: { len: 7, width: 2.4 },
};

// budget.json's `ref.origin`: where the builder's origin sits in each grounded
// file, in metres (#683). tools/blender/props.py stops the export if a file
// disagrees with this by a millimetre, and test/props.mjs checks the two lists
// are the same list.
export const ORIGIN = {
  'marker-1': [0.0004, 0.1, 0],
  'marker-2': [0.0126, 0.1, 0],
  'cairn-stone-1': [0, 0.187, 0],
  'cairn-stone-2': [-0.0164, 0.2003, 0.0154],
  'cairn-stone-3': [-0.0118, 0.1538, -0.0027],
  bridge: [0, 0.28, 0],
  bench: [0, 0, 0.0225],
  tower: [0, 0, -0.0082],
  cabin: [0, 0, 0.0512],
  radio: [1.6955, -0.855, -1.55],
  headlamp: [0.02, -0.0125, -0.0362],
  mushroom: [0, 0, 0],
  'mushroom-glow': [0, 0, 0],
};

/** A variant by an entry's seed: 0 to n - 1, negative seeds included. */
export const variant = (seed, n) => (((seed | 0) % n) + n) % n;

const BASE = new URL('../assets/models/props/', import.meta.url);

/**
 * name -> [{ node, geometry, material }], one part per material, each geometry
 * in the builder's frame. `node` is the glTF node the part hangs off (the
 * tower's `panes`, the cabin's `window`). Rejects on the first file that
 * fails, by name.
 */
export async function loadPieces(names = PIECES, base = BASE) {
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(names.map(async name => {
    const url = new URL(`${name}.glb`, base).href;
    const o = ORIGIN[name];
    if (!o) throw new Error(`Blue Hour: the ${name} piece has no origin in pieces.js`);
    let gltf;
    try { gltf = await loader.loadAsync(url); }
    catch (e) { throw new Error(`Blue Hour: the ${name} piece did not load (${url}): ${e && e.message || e}`); }
    const parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(m => {
      if (!m.isMesh) return;
      // A glTF mesh with two primitives comes in as a group of two meshes
      // named `cabin_1`, `cabin_2`, so the part is named for the glTF mesh
      // it came from, which props.py names for its node.
      const a = gltf.parser.associations.get(m);
      const node = a && a.meshes !== undefined ? gltf.parser.json.meshes[a.meshes].name : m.name;
      const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
      geometry.translate(-o[0], -o[1], -o[2]);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      geometry.name = `${name}/${m.material.name}`;
      parts.push({ node, geometry, material: m.material });
    });
    if (!parts.length) throw new Error(`Blue Hour: the ${name} piece has no mesh`);
    out[name] = parts;
  }));
  return out;
}

const partsOf = (pieces, name) => {
  const parts = pieces[name];
  if (!parts) throw new Error(`Blue Hour: no ${name} piece was loaded`);
  return parts;
};

/** One piece as a Group of Meshes, one per part, sharing geometry and material. */
export function pieceGroup(pieces, name) {
  const g = new THREE.Group();
  g.name = name;
  for (const p of partsOf(pieces, name)) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.name = p.node;
    g.add(mesh);
  }
  return g;
}

/**
 * Every placement of a piece, one InstancedMesh per part, each named for the
 * piece and its material. `place` is a list of { x, y, z, ry, s }, the
 * builder's own position and turn for what it built and its scale.
 */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function instances(pieces, name, place) {
  return partsOf(pieces, name).map(p => {
    const inst = new THREE.InstancedMesh(p.geometry, p.material, place.length);
    inst.name = `${name}/${p.material.name}`;
    place.forEach((t, i) => {
      _q.setFromAxisAngle(_up, t.ry || 0);
      _p.set(t.x, t.y, t.z);
      _s.setScalar(t.s ?? 1);
      inst.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingBox();
    inst.computeBoundingSphere();
    return inst;
  });
}

/** Group placements by variant (`v`) and instance every variant used. */
export function byVariant(pieces, names, entries) {
  const lists = names.map(() => []);
  for (const e of entries) lists[e.v].push(e);
  const out = [];
  names.forEach((name, i) => { if (lists[i].length) out.push(...instances(pieces, name, lists[i])); });
  return out;
}
