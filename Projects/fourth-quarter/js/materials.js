// materials.js — one registry for every surface in the bar, and the loader
// that fills it. The registry itself (MATS) lives in textures.js, which has no
// THREE in it so test/smoke-textures.mjs can read it under bare Node; it is
// re-exported here so nothing that imported MATS from this file has to move.
//
// Phase 4: every load goes through one THREE.LoadingManager, so the start
// overlay can say "Textures 12 / 27", and each file is fetched at the tier
// pickTier() chose for this device — 1k unless a Retina-class screen and GPU
// argue for the 2k originals, or `?tex=2k` / `?tex=1k` asks outright. The 404
// fallback is exactly what it was: a missing file keeps that slot's placeholder
// colour and the room goes on.

import * as THREE from "three";
import { MATS, TIERS, DEFAULT_TIER, pickTier, texturePath, textureFiles } from "./textures.js";

export { MATS, TIERS, pickTier, texturePath };

export const USE_TEXTURES = true; // textures/ is populated — placeholders only if a file 404s

const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const cache = {};

/** What the loader has done so far. `total` is the registry's count, not the
 *  manager's running one, so the line reads "0 / 27" before the first fetch
 *  rather than "0 / 0". `failed` counts 404s, which the manager still counts
 *  as finished so `done` is reached either way. */
const status = { tier: null, total: textureFiles().length, loaded: 0, failed: 0, done: false, ms: null };
let listeners = [];
let t0 = null;

manager.onProgress = (url, loaded) => { status.loaded = loaded; notify(); };
manager.onError = () => { status.failed++; notify(); };
manager.onLoad = () => {
  status.done = true;
  status.ms = t0 == null ? null : Math.round(performance.now() - t0);
  notify();
};
function notify() { for (const fn of listeners) fn(status); }

/**
 * Decide the tier before the first mat() call. main.js passes the renderer so
 * the choice can read its texture limit; `override` is the `?tex=` query. A
 * second call is ignored — the tier is per page load, and half a room at 2k
 * with the other half at 1k is the one outcome nobody wants.
 */
export function initTextures({ renderer, override, onProgress } = {}) {
  if (!status.tier) {
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    status.tier = pickTier({
      override,
      saveData: !!(nav.connection && nav.connection.saveData),
      dpr,
      maxTextureSize: renderer ? renderer.capabilities.maxTextureSize : 0,
      widthPx: typeof screen !== "undefined" ? screen.width * dpr : 0,
    });
  }
  // The tier is set before the first call, so the line never reads "at null".
  if (onProgress) { listeners.push(onProgress); onProgress(status); }
  return status.tier;
}

/** A read-only view for the HUD and tools/browser-check.mjs. */
export function textureStatus() { return { ...status }; }

export function mat(key) {
  if (cache[key]) return cache[key];
  const def = MATS[key];
  const m = new THREE.MeshStandardMaterial({
    color: def.color,
    roughness: def.rough ?? 0.8,
    metalness: def.metal ?? 0.0,
  });
  if (USE_TEXTURES && def.files) {
    // mat() before initTextures() means a caller that never chose — take the default.
    if (!status.tier) status.tier = DEFAULT_TIER;
    if (t0 == null) t0 = performance.now();
    const load = (file, cb) => loader.load(texturePath(key, file, status.tier), t => {
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
