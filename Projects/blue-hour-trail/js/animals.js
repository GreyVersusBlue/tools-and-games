import * as THREE from 'three';
import { GLTFLoader } from '../libs/addons/loaders/GLTFLoader.js';

// The animal pack (assets/models/animals/*.glb, made by tools/blender/animals.py)
// and the two numbers that seat each model where its old builder's mesh stood.
//
// Every model faces -Z, x across, with its origin at the centre of its base,
// and every builder in wildlife.js led with +Z (#675). The creature code still
// moves and turns the group its builder made, in the builder's own frame, so
// each model goes inside that group under one more group that turns it a half
// turn (TURN) and drops it by LIFT, the height the builder's origin stood above
// the base. Nothing that moves an animal changes (#664).
//
// loadAnimals() is awaited before buildWildlife() runs, and a file that is
// missing or will not parse rejects it, naming the file. There is no fallback
// to the old shapes: they are gone (B4).

export const ANIMALS = ['crow', 'deer', 'fox', 'owl', 'small-bird', 'squirrel'];

export const TURN = Math.PI;
// The squirrel's builder floated its body 2.4 cm over its origin; the model
// stands on its feet instead (#676).
export const LIFT = {
  crow: 0.178, 'small-bird': 0.081, owl: 0.010, deer: 0, fox: 0, squirrel: 0,
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
    catch (e) { throw new Error(`Blue Hour: the ${name} model did not load (${url}): ${e && e.message || e}`); }
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
  if (!a) throw new Error(`Blue Hour: no ${name} model was loaded`);
  const model = a.scene.clone(true);
  const seat = new THREE.Group();
  seat.name = `${name}-seat`;
  seat.rotation.y = TURN;
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
