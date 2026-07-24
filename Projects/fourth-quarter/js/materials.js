// materials.js — one registry for every surface in the bar.
// References the exact Poly Haven 2K filenames as downloaded (no renaming).
// Two map layouts exist in the set:
//   • diff/rough sets:  <slug>_diff_2k.jpg (+ _nor_gl_2k, _rough_2k)
//   • ARM sets:         <slug>_arm_2k.jpg packs AO (R), roughness (G),
//     metalness (B) into one texture — wired to all three material slots.
// brown_leather ships "albedo" instead of "diff"; the registry just lists
// each file explicitly so naming quirks don't matter.

import * as THREE from "three";

export const USE_TEXTURES = true; // textures/ is populated — placeholders only if a file 404s

// key → { polyhaven slug, repeat, files{diff,normal,rough|arm}, placeholder params }
export const MATS = {
  floorWood: {
    polyhaven: "wood_floor_deck", repeat: [6, 4], color: 0x6b4a2e, rough: 0.8,
    files: { diff: "wood_floor_deck_diff_2k.jpg", normal: "wood_floor_deck_nor_gl_2k.jpg", arm: "wood_floor_deck_arm_2k.jpg" },
  },
  wallPlaster: {
    polyhaven: "painted_plaster_wall", repeat: [4, 2], color: 0x3a2c20, rough: 0.95,
    files: { diff: "painted_plaster_wall_diff_2k.jpg", normal: "painted_plaster_wall_nor_gl_2k.jpg", arm: "painted_plaster_wall_arm_2k.jpg" },
  },
  wallBrick: {
    polyhaven: "red_brick_plaster_patch_02", repeat: [5, 2], color: 0x59352a, rough: 0.9,
    files: { diff: "red_brick_plaster_patch_02_diff_2k.jpg", normal: "red_brick_plaster_patch_02_nor_gl_2k.jpg", rough: "red_brick_plaster_patch_02_rough_2k.jpg" },
  },
  barTop: {
    polyhaven: "dark_wooden_planks", repeat: [4, 1], color: 0x2e1d10, rough: 0.35,
    files: { diff: "dark_wooden_planks_diff_2k.jpg", normal: "dark_wooden_planks_nor_gl_2k.jpg", arm: "dark_wooden_planks_arm_2k.jpg" },
  },
  tableTop: {
    polyhaven: "wood_table_001", repeat: [1, 1], color: 0x50361f, rough: 0.5,
    files: { diff: "wood_table_001_diff_2k.jpg", normal: "wood_table_001_nor_gl_2k.jpg", rough: "wood_table_001_rough_2k.jpg" },
  },
  ceiling: {
    polyhaven: "concrete_wall_008", repeat: [6, 4], color: 0x191411, rough: 1.0,
    files: { diff: "concrete_wall_008_diff_2k.jpg", normal: "concrete_wall_008_nor_gl_2k.jpg", arm: "concrete_wall_008_arm_2k.jpg" },
  },
  kitchenTile: {
    polyhaven: "wood_planks", repeat: [3, 2], color: 0x8c8478, rough: 0.6,
    files: { diff: "wood_planks_diff_2k.jpg", normal: "wood_planks_nor_gl_2k.jpg", arm: "wood_planks_arm_2k.jpg" },
  },
  leather: {
    polyhaven: "brown_leather", repeat: [1, 1], color: 0x4a2f1d, rough: 0.65,
    files: { diff: "brown_leather_albedo_2k.jpg", normal: "brown_leather_nor_gl_2k.jpg", rough: "brown_leather_rough_2k.jpg" },
  },
  metal: {
    polyhaven: "brushed_concrete", repeat: [1, 1], color: 0x7a7f85, rough: 0.4, metal: 0.7,
    files: { diff: "brushed_concrete_diff_2k.jpg", normal: "brushed_concrete_nor_gl_2k.jpg", rough: "brushed_concrete_rough_2k.jpg" },
  },
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
  if (USE_TEXTURES && def.files) {
    const base = `textures/${key}/`;
    const load = (file, cb) => loader.load(base + file, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(def.repeat[0], def.repeat[1]);
      cb(t); m.needsUpdate = true;
    }, undefined, () => {}); // 404 → keep the placeholder look for that slot
    load(def.files.diff, t => { t.colorSpace = THREE.SRGBColorSpace; m.map = t; m.color.set(0xffffff); });
    if (def.files.normal) load(def.files.normal, t => { m.normalMap = t; });
    if (def.files.arm) {
      // ARM: AO in R, roughness in G, metalness in B — one texture, three slots
      load(def.files.arm, t => {
        t.channel = 0;
        m.aoMap = t; m.roughnessMap = t; m.metalnessMap = t;
        m.roughness = 1; m.metalness = 1; // maps multiply against these
      });
    } else if (def.files.rough) {
      load(def.files.rough, t => { m.roughnessMap = t; m.roughness = 1; });
    }
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
