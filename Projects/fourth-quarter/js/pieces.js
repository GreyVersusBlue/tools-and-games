// pieces.js — the bar pack (models/bar/*.glb, made by tools/blender/bar.py):
// 22 files, each the fixture or furniture world.js used to build from boxes
// and cylinders (WISHLIST.md "Blender assets" B3, wired in by B4).
//
// The Fourth Quarter's own copy of the shape of Blue Hour's js/pieces.js, not
// an import of it (#17), and simpler again: every file was built in world.js's
// own frame, origin at the centre of its base, front to +Z, at the box
// world.js gave what it replaces (#686), so nothing here moves a vertex. A
// piece world.js centred on y goes in at y - h / 2, and a fit-out block takes
// its `rotY` as it is.
//
// A file carries one or two materials. A `flat-` one is what flat() makes,
// its colour in the vertices, and is used as it came. Any other is a key of
// MATS, and world.js puts the game's own mat(key) on in its place at build
// time, not here: mat() has to wait for main.js's initTextures() so that
// pickTier() still chooses the textures.
//
// loadPieces() is awaited at the top of world.js, so every file has landed
// before buildWorld() runs, and a file that is missing or will not parse
// rejects it, naming the piece. There is no fallback to the primitives: they
// are gone.

import * as THREE from "three";
import { GLTFLoader } from "../libs/addons/loaders/GLTFLoader.js";

export const PIECES = [
  "crate-wood", "stove", "prep", "crate",
  "counter-mid", "counter-end", "kick", "shelf-back", "shelf-kitchen", "sill",
  "bottle-green", "bottle-amber", "bottle-violet", "bottle-blue", "bottle-gold",
  "tap", "can", "corkboard", "tv-frame", "door-frame", "stool", "table",
];

// The box each file was built at, in metres, x by y by z: budget.json's
// `box`, the one world.js gave what the piece replaces at the Corner Tap.
// A fit-out block is scaled by its own w, h, d over this, which is 1 in every
// room there is; a unit piece is one metre along x and is stretched to its run.
// test/bar.mjs checks this is budget.json's list.
export const BOX = {
  "crate-wood": [0.55, 0.5, 0.55],
  stove: [1.7, 0.95, 0.85],
  prep: [2.4, 0.95, 0.9],
  crate: [0.7, 0.6, 0.6],
  "counter-mid": [1, 1.1, 0.75],
  "counter-end": [0.5, 1.1, 0.75],
  kick: [1, 0.12, 0.8],
  "shelf-back": [1, 0.08, 0.35],
  "shelf-kitchen": [1, 0.06, 0.35],
  sill: [1.9, 0.08, 0.7],
  "bottle-green": [0.1, 0.32, 0.1],
  "bottle-amber": [0.1, 0.32, 0.1],
  "bottle-violet": [0.1, 0.32, 0.1],
  "bottle-blue": [0.1, 0.32, 0.1],
  "bottle-gold": [0.1, 0.32, 0.1],
  tap: [0.06, 0.35, 0.06],
  can: [0.16, 0.2, 0.16],
  corkboard: [1.62, 1.12, 0.065],
  "tv-frame": [1.95, 1.15, 0.08],
  "door-frame": [1.4, 2.3, 0.12],
  stool: [0.44, 0.745, 0.44],
  table: [1.24, 0.95, 1.24],
};

/** A material the game fills by name (a MATS key), rather than one the file carries. */
export const keyed = material => !material.name.startsWith("flat-");

const BASE = new URL("../models/bar/", import.meta.url);

/**
 * name -> [{ geometry, material }], one part per material, each geometry in
 * the file's frame with any node transform baked in. Every file is fetched
 * before anything is decided, so a failed round leaves nothing in flight;
 * then the first that failed, in PIECES order, rejects the load by name.
 */
export async function loadPieces(names = PIECES, base = BASE) {
  const loader = new GLTFLoader();
  const settled = await Promise.allSettled(names.map(name => {
    const url = new URL(`${name}.glb`, base).href;
    return loader.loadAsync(url).catch(e => {
      throw new Error(`The Fourth Quarter: the ${name} piece did not load (${url}): ${e && e.message || e}`);
    });
  }));
  const out = {};
  names.forEach((name, i) => {
    const s = settled[i];
    if (s.status === "rejected") throw s.reason;
    const gltf = s.value, parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(m => {
      if (!m.isMesh) return;
      const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      geometry.name = `${name}/${m.material.name}`;
      parts.push({ geometry, material: m.material });
    });
    if (!parts.length) throw new Error(`The Fourth Quarter: the ${name} piece has no mesh`);
    out[name] = parts;
  });
  return out;
}

/**
 * One piece as a Group named for it, one Mesh a part, sharing the loaded
 * geometry. `material(m)` is asked for each part's material and may hand back
 * another (world.js's mat() for a keyed one).
 */
export function pieceGroup(pieces, name, material = m => m) {
  const parts = pieces[name];
  if (!parts) throw new Error(`The Fourth Quarter: no ${name} piece was loaded`);
  const g = new THREE.Group();
  g.name = name;
  for (const p of parts) {
    const mesh = new THREE.Mesh(p.geometry, material(p.material));
    mesh.name = p.geometry.name;
    g.add(mesh);
  }
  return g;
}
