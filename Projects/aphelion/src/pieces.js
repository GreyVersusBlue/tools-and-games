// pieces.js — the ship pack (models/ship/*.glb, made by tools/blender/ship.py):
// 12 files, each a thing ship.js used to build from boxes and cylinders
// (BACKLOG.md "Aphelion: Blender assets" B3, wired in by B4).
//
// Aphelion's own copy of the shape of The Fourth Quarter's js/pieces.js, not an
// import of it (#17). Every file was built in ship.js's own frame, origin at
// the centre of its base, so nothing here moves a vertex: ship.js sets each
// piece's position to budget.json's `at` and no rotation, except the system
// panel, which is built facing +Z and takes systems.json's rotY (#700).
//
// Every material in a file is a key of ship.js's M (#691). The file's own
// material is only a name: ship.js puts M[name] on in its place, and each
// system panel's `panel` part gets that system's clone, which tick() dims.
//
// loadPieces() is awaited at the top of ship.js, so every file has landed
// before buildWorld() runs, and a file that is missing or will not parse
// rejects it, naming the piece. There is no fallback to the primitives (#646):
// they are gone.

import * as THREE from 'three';
import { GLTFLoader } from '../libs/addons/loaders/GLTFLoader.js';

export const PIECES = [
  'console', 'seat', 'panel', 'pipes', 'workbench', 'bed', 'shelf', 'tray',
  'hatch-inner', 'hull', 'hatch-outer', 'satellite',
];

// Where each file's origin goes, in ship.js's frame with no rotation:
// budget.json's `at`. The tray's is in the tray group, hull and hatch-outer's in
// refs.exterior, the satellite's in its POI group, and the panel's is an offset
// from systems.json's panel.pos. test/ship.mjs checks this is budget.json's.
export const AT = {
  console: [0, 0.15, -12.825],
  seat: [0, 0.475, -11.5875],
  panel: [0, -0.55, 0],
  pipes: [0, 2.156, -6.8],
  workbench: [2.0, 0, -7.4],
  bed: [-1.9, 0.105, 4.8],
  shelf: [2.5, 1.67, 4.8],
  tray: [-0.005, 0, 0],
  'hatch-inner': [0, 0.1, 9.85],
  hull: [0, -0.53, -2],
  'hatch-outer': [0, 0.1, 10.9],
  satellite: [0, -0.4, 0],
};

const BASE = new URL('../models/ship/', import.meta.url);

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
      throw new Error(`Aphelion: the ${name} piece did not load (${url}): ${e && e.message || e}`);
    });
  }));
  const out = {};
  names.forEach((name, i) => {
    const s = settled[i];
    if (s.status === 'rejected') throw s.reason;
    const parts = [];
    s.value.scene.updateMatrixWorld(true);
    s.value.scene.traverse(m => {
      if (!m.isMesh) return;
      const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      geometry.name = `${name}/${m.material.name}`;
      parts.push({ geometry, material: m.material });
    });
    if (!parts.length) throw new Error(`Aphelion: the ${name} piece has no mesh`);
    out[name] = parts;
  });
  return out;
}

/**
 * One piece as a Group named for it, at its `at` (plus `offset`), one Mesh a
 * part named for its material, sharing the loaded geometry. `material(name)` is
 * asked for each part's material by its name and must hand one back.
 */
export function pieceGroup(pieces, name, material, offset = [0, 0, 0]) {
  const parts = pieces[name];
  if (!parts) throw new Error(`Aphelion: no ${name} piece was loaded`);
  const g = new THREE.Group();
  g.name = name;
  g.position.set(AT[name][0] + offset[0], AT[name][1] + offset[1], AT[name][2] + offset[2]);
  for (const p of parts) {
    const mat = material(p.material.name);
    if (!mat) throw new Error(`Aphelion: the ${name} piece's ${p.material.name} material is not a key of M`);
    const mesh = new THREE.Mesh(p.geometry, mat);
    mesh.name = p.material.name;
    g.add(mesh);
  }
  return g;
}

/** The part of a piece that wears the named material. */
export const part = (g, material) => g.children.find(m => m.name === material);
