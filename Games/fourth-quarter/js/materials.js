// materials.js — one registry for every surface in the bar.
// Each entry names its Poly Haven asset. Drop the downloaded maps into
// textures/<key>/ (diffuse.jpg, normal.jpg, rough.jpg), flip USE_TEXTURES
// to true, and everything re-skins itself. Until then: tuned placeholders.

import * as THREE from "three";

export const USE_TEXTURES = false; // ← set true once textures/ is populated

// key → { polyhaven: asset slug, url, repeat, placeholder material params }
export const MATS = {
  floorWood:   { polyhaven: "wood_floor_deck",        repeat: [6, 4],  color: 0x6b4a2e, rough: 0.8 },
  wallPlaster: { polyhaven: "painted_plaster_wall",   repeat: [4, 2],  color: 0x3a2c20, rough: 0.95 },
  wallBrick:   { polyhaven: "red_brick_plaster_patch_02", repeat: [5, 2], color: 0x59352a, rough: 0.9 },
  barTop:      { polyhaven: "dark_wooden_planks",     repeat: [4, 1],  color: 0x2e1d10, rough: 0.35 },
  tableTop:    { polyhaven: "wood_table_001",         repeat: [1, 1],  color: 0x50361f, rough: 0.5 },
  ceiling:     { polyhaven: "concrete_wall_008",      repeat: [6, 4],  color: 0x191411, rough: 1.0 },
  kitchenTile: { polyhaven: "kitchen_wood",           repeat: [3, 2],  color: 0x8c8478, rough: 0.6 },
  leather:     { polyhaven: "brown_leather",          repeat: [1, 1],  color: 0x4a2f1d, rough: 0.65 },
  metal:       { polyhaven: "brushed_concrete",       repeat: [1, 1],  color: 0x7a7f85, rough: 0.4, metal: 0.7 },
};

const loader = new THREE.TextureLoader();
const cache = {};

export function mat(key) {
  if (cache[key]) return cache[key];
  const def = MATS[key];
  const m = new THREE.MeshStandardMaterial({
    color: def.color,
    roughness: def.rough ?? 0.8,
    metalness: def.metal ?? 0.0,
  });
  if (USE_TEXTURES) {
    const base = `textures/${key}/`;
    const load = (file, cb) => loader.load(base + file, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(def.repeat[0], def.repeat[1]);
      cb(t); m.needsUpdate = true;
    }, undefined, () => {});
    load("diffuse.jpg", t => { t.colorSpace = THREE.SRGBColorSpace; m.map = t; m.color.set(0xffffff); });
    load("normal.jpg",  t => { m.normalMap = t; });
    load("rough.jpg",   t => { m.roughnessMap = t; });
  }
  cache[key] = m;
  return m;
}

// Simple colored materials for props/agents (not texture-driven)
export function flat(color, rough = 0.85, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}
export function glow(color, intensity = 1.4) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity });
}
