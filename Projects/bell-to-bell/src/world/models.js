import * as THREE from 'three';
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
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const targetDiag = Math.hypot(targetW, targetD);
  const sourceDiag = Math.hypot(size.x, size.z) || 1;
  object.scale.setScalar(targetDiag / sourceDiag);

  const resettled = new THREE.Box3().setFromObject(object);
  object.position.y -= resettled.min.y;
  return object;
}

// Scale a loaded character uniformly to a target standing height in meters.
export function fitHeight(object, targetHeight) {
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

// A plain image texture (a painting, not a PBR material set).
export function loadTexture(path, srgb = true) {
  const t = new THREE.TextureLoader().load(encodeURI(path));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
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

// Find the first node in a loaded rig matching any of the given names.
// Returns null if none are present — callers must fall back gracefully,
// since outfit packs are not guaranteed to share a rig template.
export function findBone(root, names) {
  const want = new Set(names);
  let found = null;
  root.traverse(node => { if (!found && want.has(node.name)) found = node; });
  return found;
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
}
