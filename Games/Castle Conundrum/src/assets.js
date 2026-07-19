// assets.js — centralized asset loading.
// Every model load goes through loadModel(): on failure it logs loudly and
// returns a clearly-labeled placeholder box so a bad path never fails silently.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const loadingManager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(loadingManager);
const textureLoader = new THREE.TextureLoader(loadingManager);

const modelCache = new Map();

/**
 * Load a GLTF/GLB. Returns a THREE.Group (a clone if cached).
 * On failure: console.error + red placeholder box labeled with the path.
 */
export async function loadModel(path) {
  if (modelCache.has(path)) {
    const cached = await modelCache.get(path);
    return cached.clone(true);
  }
  const promise = new Promise((resolve) => {
    gltfLoader.load(
      path,
      (gltf) => {
        gltf.scene.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        console.error(`[Castle Conundrum] MISSING/BROKEN ASSET: "${path}"`, err);
        resolve(makePlaceholder(path));
      }
    );
  });
  modelCache.set(path, promise);
  const scene = await promise;
  return scene.clone(true);
}

function makePlaceholder(path) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff00ff, wireframe: false, roughness: 1 })
  );
  box.position.y = 0.5;
  box.castShadow = true;
  group.add(box);
  group.userData.isPlaceholder = true;
  group.userData.missingPath = path;
  return group;
}

/**
 * Load a diffuse/normal/arm texture set into a MeshStandardMaterial.
 * Any texture that 404s logs an error; the material falls back to fallbackColor.
 */
export function loadPBRMaterial({ diffuse, normal, arm }, repeat = 1, fallbackColor = '#888888') {
  const mat = new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 1 });

  const tryTex = (url, onOk) => {
    if (!url) return;
    textureLoader.load(
      url,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
        onOk(tex);
        mat.needsUpdate = true;
      },
      undefined,
      () => console.error(`[Castle Conundrum] MISSING TEXTURE: "${url}" — using fallback color`)
    );
  };

  tryTex(diffuse, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    mat.map = t;
    mat.color.set('#ffffff');
  });
  tryTex(normal, (t) => { mat.normalMap = t; });
  tryTex(arm, (t) => {
    // Poly Haven ARM = AO (r), Roughness (g), Metalness (b)
    mat.aoMap = t;
    mat.roughnessMap = t;
    mat.metalnessMap = t;
    mat.metalness = 1; // let the map drive it
  });

  return mat;
}

/** Fetch a JSON data file, failing loudly. */
export async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) {
    console.error(`[Castle Conundrum] FAILED TO LOAD DATA FILE: "${path}" (${res.status})`);
    throw new Error(`Missing data file: ${path}`);
  }
  return res.json();
}
