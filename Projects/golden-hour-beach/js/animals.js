import * as THREE from 'three';
import { GLTFLoader } from '../libs/addons/loaders/GLTFLoader.js';

// The animal pack (assets/models/animals/*.glb, made by tools/blender/animals.py)
// and the two numbers that seat each model where its old builder's mesh stood.
//
// Every model faces -Z, x across, with its origin at the centre of its base
// (#656). The creature code still moves and turns the group its builder made,
// in the builder's own frame, so each model goes inside that group under one
// more group that turns it (TURN) and drops it by LIFT, the height the
// builder's origin stood above the base. Nothing that moves an animal changes.
//
// loadAnimals() is awaited before buildWildlife() runs, and a file that is
// missing or will not parse rejects it, naming the file. There is no fallback
// to the old shapes: they are gone (B4).

export const ANIMALS = [
  'gull', 'dolphin', 'crab', 'heron', 'cormorant',
  'owl', 'bat', 'pelican', 'sanderling', 'seal',
];

const Q = Math.PI / 2;
export const TURN = {
  dolphin: -Q, heron: -Q, cormorant: -Q, owl: -Q, pelican: -Q, seal: -Q, sanderling: -Q,
  crab: Math.PI,
  gull: 0, bat: 0,
};
export const LIFT = {
  dolphin: 0.90, seal: 0.41, pelican: 0.375, owl: 0.24, gull: 0.176,
  sanderling: 0.097, crab: 0.05, heron: 0, cormorant: 0, bat: 0,
};

const BASE = new URL('../assets/models/animals/', import.meta.url);

/** name -> { scene, clips }. Rejects on the first file that fails, by name. */
export async function loadAnimals(names = ANIMALS, base = BASE) {
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(names.map(async name => {
    const url = new URL(`${name}.glb`, base).href;
    let gltf;
    try { gltf = await loader.loadAsync(url); }
    catch (e) { throw new Error(`Golden Hour: the ${name} model did not load (${url}): ${e && e.message || e}`); }
    out[name] = { scene: gltf.scene, clips: gltf.animations };
  }));
  return out;
}

/**
 * One animal, ready to add to its builder's group: `seat` is the turn-and-drop
 * group, `model` the cloned file root, `nodes` its named parts, and `mixer`
 * and `actions` when the file carries clips (null and {} when it does not).
 * Geometry and materials are shared between clones, as the builders shared
 * theirs.
 */
export function makeAnimal(animals, name) {
  const a = animals[name];
  if (!a) throw new Error(`Golden Hour: no ${name} model was loaded`);
  const model = a.scene.clone(true);
  const seat = new THREE.Group();
  seat.name = `${name}-seat`;
  seat.rotation.y = TURN[name];
  seat.position.y = -LIFT[name];
  seat.add(model);
  const nodes = {};
  model.traverse(o => { if (o.name) nodes[o.name] = o; });
  let mixer = null;
  const actions = {};
  if (a.clips.length) {
    mixer = new THREE.AnimationMixer(model);
    for (const clip of a.clips) actions[clip.name] = mixer.clipAction(clip);
  }
  return { seat, model, nodes, mixer, actions };
}

/**
 * A flock item as one geometry and one material for an InstancedMesh (#659),
 * with the turn and drop baked in so the flock's per-bird matrices, written
 * in the builder's frame, stay as they are.
 */
export function flockGeometry(animals, name) {
  let mesh = null;
  animals[name].scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) throw new Error(`Golden Hour: the ${name} model has no mesh`);
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geo.rotateY(TURN[name]);
  geo.translate(0, -LIFT[name], 0);
  return { geometry: geo, material: mesh.material };
}
