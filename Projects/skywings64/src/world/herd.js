// SkyWings 64 - herds: the copies of one GLB drawn as one InstancedMesh per primitive (HISTORY.md #931).
// A GLB here is 4 to 9 primitives, each with a material of its own, so seven sailing boats were 42
// draws. The copies stay in the scene graph, hidden, and whoever owns them goes on moving them (a
// boat's holder, a windmill's blade pivot); before each render every primitive's instances are packed
// afresh from the copies' world matrices.
// Culling is three's own test, run here per copy: a copy's primitive is packed when its bounding
// sphere meets the camera's frustum or the sun's shadow box, and the herd casts only while one is in
// the box. So a herd draws a primitive once where three drew it once per copy in view, never where
// three drew nothing, and a copy the camera cannot see costs no triangles unless its shadow can.
import * as THREE from 'three';

const herds = [];
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sphere = new THREE.Sphere(), _mid = new THREE.Vector3();
let hooked = null, sun = null;

function pack(scene, camera) {
  _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  if (!sun || !sun.parent) sun = scene.children.find((o) => o.isDirectionalLight && o.name === 'sw-sun') || null;
  let box = null;
  if (sun && sun.castShadow) { sun.shadow.updateMatrices(sun); box = sun.shadow.getFrustum(); }   // what the shadow pass is about to cull with
  for (const h of herds) for (const p of h.parts) {
    const im = p.mesh, arr = im.instanceMatrix.array, bs = p.geometry.boundingSphere;
    let n = 0, cast = false;
    _mid.set(0, 0, 0);
    for (const src of p.src) {
      _sphere.copy(bs).applyMatrix4(src.matrixWorld);
      const shadowed = p.casts && box !== null && box.intersectsSphere(_sphere);
      if (!shadowed && !_frustum.intersectsSphere(_sphere)) continue;
      if (shadowed) cast = true;
      src.matrixWorld.toArray(arr, n * 16); _mid.add(_sphere.center); n++;
    }
    im.count = n; im.visible = n > 0; im.castShadow = cast;
    if (n) { im.instanceMatrix.needsUpdate = true; im.boundingSphere.center.copy(_mid).divideScalar(n); }   // the centre is what three sorts by
  }
}

// Finds the scene above `obj` and packs before each of its renders. False until `obj` is in a scene.
export function attachHerds(obj) {
  let s = obj; while (s.parent) s = s.parent;
  if (!s.isScene) return false;
  if (hooked === s) return true;
  const prev = s.onBeforeRender;
  s.onBeforeRender = function (renderer, scene, camera, target) { prev.call(this, renderer, scene, camera, target); if (herds.length) pack(scene, camera); };
  hooked = s;
  return true;
}

// roots: the copies, each already placed in the scene graph, all clones of one model.
// parent: where the InstancedMeshes go; its world matrix must be the identity (landmarks, props).
export function addHerd(roots, parent, name) {
  const parts = new Map();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.geometry.uuid + '|' + o.material.uuid;
      let p = parts.get(key);
      if (!p) parts.set(key, p = { geometry: o.geometry, material: o.material, name: o.name, casts: o.castShadow, receives: o.receiveShadow, src: [] });
      p.src.push(o);
    });
    root.visible = false;
  }
  const herd = { name, parts: [...parts.values()] };
  for (const p of herd.parts) {
    if (!p.geometry.boundingSphere) p.geometry.computeBoundingSphere();
    const im = new THREE.InstancedMesh(p.geometry, p.material, p.src.length);
    im.name = name + ':' + p.name;
    im.frustumCulled = false; im.count = 0; im.visible = false;
    im.castShadow = false; im.receiveShadow = p.receives; im.userData.noCast = true;   // pack() decides, not render/index.js's scan
    im.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p.mesh = im; parent.add(im);
  }
  herds.push(herd);
  attachHerds(parent);
  return herd;
}
