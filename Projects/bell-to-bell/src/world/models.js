import * as THREE from '../three.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// This module has no export actually named `SkeletonUtils` — it exports
// `clone`/`retarget`/`retargetClip` directly, so the namespace import is what
// gets `SkeletonUtils.clone(...)` to resolve to something real.
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// One GLTFLoader, one fetch per unique path no matter how many instances ask
// for it — a dozen student desks and a handful of outfits all share the same
// network request, cached by URL.
export function createModelLoader() {
  const loader = new GLTFLoader();
  const pending = new Map();

  function fetchGltf(path) {
    const url = encodeURI(path);
    if (!pending.has(url)) pending.set(url, loader.loadAsync(url));
    return pending.get(url);
  }

  // A static prop — furniture, no skeleton. Object3D.clone(true) is correct
  // (and cheap) for these.
  async function loadStatic(path) {
    const gltf = await fetchGltf(path);
    return gltf.scene.clone(true);
  }

  // A skinned character. Object3D.clone() does not correctly duplicate a
  // SkinnedMesh's bone bindings — SkeletonUtils.clone does.
  async function loadRigged(path) {
    const gltf = await fetchGltf(path);
    return { root: SkeletonUtils.clone(gltf.scene), animations: gltf.animations || [] };
  }

  return { loadStatic, loadRigged };
}

// Scale a loaded object uniformly so its footprint (x/z diagonal) matches a
// target [w, d] in meters, then drop it so its lowest point sits at y=0.
// Furniture kits are never authored at this room's scale.
export function fitFootprint(object, targetW, targetD) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const targetDiag = Math.hypot(targetW, targetD);
  const sourceDiag = Math.hypot(size.x, size.z) || 1;
  object.scale.setScalar(targetDiag / sourceDiag);

  object.updateWorldMatrix(true, true);
  const resettled = new THREE.Box3().setFromObject(object);
  object.position.y -= resettled.min.y;
  return object;
}

// Scale a loaded character uniformly to a target standing height in meters.
// updateWorldMatrix is not optional here: a posed skeleton's bones only get
// new LOCAL transforms from an AnimationMixer, and nothing propagates those
// into matrixWorld until something asks for it. Measuring without this first
// reads stale, pre-pose matrices — on this rig that's a curled-up ~0.5m
// bounding box instead of a standing ~1.8m one, which scaled every character
// to several times its intended height.
export function fitHeight(object, targetHeight) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const height = box.max.y - box.min.y || 1;
  object.scale.setScalar(targetHeight / height);
  return object;
}

// Scale a loaded object uniformly so its own width/height diagonal matches a
// target [w, h] in meters, then recenter it on its own local origin — for
// wall-mounted flats (picture frames) rather than floor-standing furniture,
// where width/depth is the wrong plane and "rest on the floor" is wrong too.
export function fitPlane(object, targetW, targetH) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const targetDiag = Math.hypot(targetW, targetH);
  const sourceDiag = Math.hypot(size.x, size.y) || 1;
  object.scale.setScalar(targetDiag / sourceDiag);

  const centered = new THREE.Box3().setFromObject(object);
  const center = centered.getCenter(new THREE.Vector3());
  object.position.sub(center);
  return object;
}

// A plain image texture (a painting, not a PBR material set). glTF's own UV
// convention expects flipY=false (GLTFLoader sets this on every texture it
// loads itself); a plain TextureLoader call defaults to flipY=true, so
// dropping one of these onto a glTF mesh's existing UVs — the picture
// frame's canvas submesh — needs flipY explicitly turned off or the image
// renders upside down.
export function loadTexture(path, srgb = true, flipY = true) {
  const t = new THREE.TextureLoader().load(encodeURI(path));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = flipY;
  return t;
}

// Every mesh in a loaded model needs the same thermal-swap contract the
// hand-built PALETTE materials carry (CLAUDE.md: anything in the scene must
// be registered). A loaded PBR material has no hand-authored thermal twin,
// so every submesh gets the same flat "body heat" swap instead of one each —
// which, for a person-shaped model under a thermal camera, is the more
// honest read anyway: a thermal camera sees a heat blob, not a shirt color.
export function registerModel(root, registry, thermalHex) {
  const thermal = new THREE.MeshBasicMaterial({ color: thermalHex });
  root.traverse(node => {
    if (node.isMesh) {
      if (Array.isArray(node.material)) {
        for (const m of node.material) m.userData.thermal = thermal;
      } else {
        node.material.userData.thermal = thermal;
      }
      registry.add(node);
    }
  });
}

// Find a node in a loaded rig by name, trying each candidate in priority
// order — NOT tree order. `names` is a preference list (callers pass e.g.
// ['Chest', 'Spine1', 'Spine', 'Hips'] wanting Chest if it exists), and
// tree order would silently defeat that: Hips is the skeleton's root joint,
// an ancestor of Chest, so a single traversal collecting "any name in this
// set" hits Hips first regardless of which name was actually preferred.
// Returns null if none of the candidates are present — callers must fall
// back gracefully, since outfit packs are not guaranteed to share a rig.
export function findBone(root, names) {
  for (const name of names) {
    let found = null;
    root.traverse(node => { if (!found && node.name === name) found = node; });
    if (found) return found;
  }
  return null;
}

// Sample one frame of an idle animation into the skeleton's live pose, then
// stop — no continuous ticking, no fighting with the per-frame head/torso
// overrides reactions.js applies afterward. This just replaces "loaded in a
// bind-pose T-stance" with "loaded standing naturally."
export function poseIdle(root, animations, seconds = 1.2) {
  if (!animations || !animations.length) return;
  const clip = animations.find(a => /idle/i.test(a.name)) || animations[0];
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  mixer.update(seconds);
  mixer.stopAllAction();
  // mixer.update() only sets each bone's LOCAL transform — nothing walks
  // those up into matrixWorld until something asks for it. Any bounding-box
  // measurement taken right after this (fitHeight, the floor-settle in
  // buildCharacterBody) would otherwise read stale, pre-pose matrices and
  // measure something close to the raw bind pose instead of the idle stance
  // — which for this rig is a tiny, curled-up bounding box, not a standing
  // one. That's what was scaling characters to several times their intended
  // height. Forcing the update here is what makes this function's promise
  // ("comes back standing naturally") actually true for anything measuring
  // the result afterward.
  root.updateWorldMatrix(true, true);
}
