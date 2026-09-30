// Shared GLB model loader with caching, progress tracking and procedural fallbacks.
// Usage:
//   import { loadModel, swapIn } from '../core/models.js';
//   const g = await loadModel('lighthouse');           // clone of assets/models/lighthouse.glb, or null on failure
//   swapIn(proceduralGroup, 'lighthouse', { fitHeight: 42 }); // hides procedural children once the GLB arrives
// Never throws; a failed load leaves the procedural mesh visible.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = new URL('../../assets/models/', import.meta.url).href;
const cache = new Map();      // name -> Promise<gltf|null>
const listeners = new Set();
const stats = { requested: 0, done: 0, failed: 0 };
let loader = null;

function notify() { for (const fn of listeners) { try { fn({ ...stats }); } catch (e) { /* ignore */ } } }
export function onModelProgress(fn) { listeners.add(fn); fn({ ...stats }); return () => listeners.delete(fn); }
export function modelStats() { return { ...stats }; }
export function allModelsSettled() { return Promise.all([...cache.values()]).then(() => ({ ...stats })); }

const disabled = () => {
  try { return new URLSearchParams(location.search).get('models') === '0'; } catch (e) { return false; }
};

function fetchGLTF(name) {
  if (cache.has(name)) return cache.get(name);
  stats.requested++; notify();
  const p = disabled() ? Promise.resolve(null) : new Promise((resolve) => {
    loader = loader || new GLTFLoader();
    loader.load(BASE + name + '.glb', (gltf) => resolve(gltf), undefined, (err) => {
      console.warn('[models] ' + name + '.glb unavailable, using procedural fallback', err && err.message ? err.message : '');
      resolve(null);
    });
  }).then((g) => {
    if (g) {
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            if (!m || m.userData.swFixed) continue;
            m.userData.swFixed = true;
            // tools/blender/*.py write sRGB colour picks straight into Principled "Base Color" (a linear
            // slot), so the exported factors are really sRGB: convert once here or everything looks washed out.
            if (m.color) m.color.convertSRGBToLinear();
            if (m.emissive) m.emissive.convertSRGBToLinear();
            // Baked AO arrives as occlusionTexture; GLTFLoader wires it to aoMap.
            if (m.map) m.map.anisotropy = 4;
          }
        }
      });
      stats.done++;
    } else { stats.failed++; stats.done++; }
    notify();
    return g;
  }).catch(() => { stats.failed++; stats.done++; notify(); return null; });
  cache.set(name, p);
  return p;
}

// Resolves to a fresh clone (shares geometry/materials) of the GLB scene, or null.
export async function loadModel(name) {
  const g = await fetchGLTF(name);
  return g ? g.scene.clone(true) : null;
}

// Warm the cache without waiting (e.g. during boot so the loading bar can track it).
export function preloadModels(names) { return Promise.all(names.map(fetchGLTF)); }

// Scale a loaded model so its bounding-box height (or max extent) equals the target, base sitting at y=0.
export function fitModel(obj, { fitHeight, fitSize, ground = true } = {}) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return obj;
  const size = box.getSize(new THREE.Vector3());
  let s = 1;
  if (fitHeight) s = fitHeight / Math.max(1e-3, size.y);
  else if (fitSize) s = fitSize / Math.max(1e-3, size.x, size.y, size.z);
  obj.scale.multiplyScalar(s);
  if (ground) {
    obj.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(obj);
    obj.position.y -= b2.min.y;
  }
  return obj;
}

// Replace the visible contents of `host` with the GLB once loaded. The procedural children are
// hidden (not removed) so a later failure path or ?models=0 still shows them.
// opts: fitHeight/fitSize (see fitModel), keep: [child names/objects to keep visible], onLoad(model)
export function swapIn(host, name, opts = {}) {
  return loadModel(name).then((model) => {
    if (!model || !host) return null;
    try {
      if (opts.fitHeight || opts.fitSize) fitModel(model, opts);
      const keep = new Set(opts.keep || []);
      for (const c of host.children) {
        if (keep.has(c) || keep.has(c.name)) continue;
        c.visible = false;
        c.userData.swProcedural = true;
      }
      model.name = 'glb:' + name;
      host.add(model);
      if (opts.onLoad) opts.onLoad(model);
      return model;
    } catch (e) { console.warn('[models] swap failed for ' + name, e); return null; }
  });
}
