import * as THREE from 'three';
import { groundHeight, LAYOUT } from './field.js';

// The woods, in two tiers. Trees within 22 m of the trail are real geometry —
// instanced conifers with wind sway, birch trunks with drawn bark, crossed
// foliage cards. Everything farther out is a flat silhouette card the fog has
// already half-eaten by the time it's visible: at 22 m the fog factor is
// pushing a third, and flatness is exactly what dense mist does to a tree
// anyway. Four draw calls for the whole forest, whichever way you look.
//
// Every position comes from LAYOUT.trees in field.js. This file places
// nothing itself — that's what lets the smoke test claim no tree blocks the
// trail without ever opening a browser.

/* ----------------------------------------------------------------- helpers */

// Same forty lines Golden Hour keeps in props.js, for the same reason: three
// ships BufferGeometryUtils, but vendoring an addon folder for one merge
// helper isn't worth it. Everything merged here comes out of the primitive
// constructors with the same three attributes.
function mergeGeometries(geos) {
  const names = ['position', 'normal', 'uv'];
  const nonIndexed = geos.map(g => (g.index ? g.toNonIndexed() : g));
  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    const size = nonIndexed[0].attributes[name].itemSize;
    let total = 0;
    for (const g of nonIndexed) total += g.attributes[name].count * size;
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of nonIndexed) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].count * size;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of nonIndexed) g.dispose();
  return merged;
}

/* ---------------------------------------------------------------- textures */

// Birch bark: paper-white with dark lenticel dashes.
function barkTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9ccc4';
  ctx.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(${26 + Math.random() * 30 | 0},${24 + Math.random() * 26 | 0},${22 + Math.random() * 22 | 0},${0.5 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 128, 5 + Math.random() * 14, 1 + Math.random() * 2.5);
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(150,150,142,${0.2 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 128, 2 + Math.random() * 6, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Birch canopy card: a loose blob of small leaves, cut out by alphaTest.
function birchLeafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 240; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * 54;
    const x = 64 + Math.cos(a) * r, y = 58 + Math.sin(a) * r * 0.85;
    ctx.fillStyle = `rgba(${96 + Math.random() * 44 | 0},${112 + Math.random() * 48 | 0},${72 + Math.random() * 28 | 0},0.95)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 2.5 + Math.random() * 3.5, 2 + Math.random() * 2.5, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Far-tier silhouettes, two cells: conifer spire (left), broadleaf (right).
function silhouetteTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = '#ffffff';        // colour comes from the material

  // conifer: stacked ragged triangles
  ctx.save();
  ctx.translate(64, 128);
  ctx.fillRect(-3, -34, 6, 34);
  for (let band = 0; band < 6; band++) {
    const y = -20 - band * 17;
    const w = 46 - band * 6.5;
    ctx.beginPath();
    ctx.moveTo(-w, y);
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      ctx.lineTo(-w + t * 2 * w, y - 4 + Math.sin(s * 2.7 + band) * 3);
    }
    ctx.lineTo(0, y - 26);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // broadleaf: trunk and a lumpy crown
  ctx.save();
  ctx.translate(192, 128);
  ctx.fillRect(-3.5, -52, 7, 52);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 30;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 1.1, -78 + Math.sin(a) * r * 0.8, 12 + Math.random() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/* --------------------------------------------------------------- near tier */

function coniferGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.34, 2.6, 5, 1);
  trunk.translate(0, 1.3, 0);
  parts.push(trunk);
  const bands = [
    [2.1, 4.6, 3.3], [1.55, 3.8, 5.9], [1.0, 3.0, 8.2],
  ];
  for (const [r, h, y] of bands) {
    const cone = new THREE.ConeGeometry(r, h, 7, 1, true);
    cone.translate(0, y, 0);
    parts.push(cone);
  }
  return mergeGeometries(parts);   // ~10.6 units tall before instance scale
}
const CONIFER_H = 10.6;

function buildConifers(trees) {
  const geo = coniferGeometry();
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  let windShader = null;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Wind: each tree sways on its own phase, more at the crown than the
        // root. Phase from the instance's world position, so no attribute.
        float windPh = dot(instanceMatrix[3].xz, vec2(0.31, 0.17));
        float windAmt = pow(max(position.y, 0.0) / ${CONIFER_H.toFixed(1)}, 2.0);
        transformed.x += sin(uTime * 0.9 + windPh) * windAmt * 0.32;
        transformed.z += sin(uTime * 0.7 + windPh * 1.3) * windAmt * 0.2;`);
    windShader = shader;
  };
  mat.customProgramCacheKey = () => 'blue-hour-conifer';

  const inst = new THREE.InstancedMesh(geo, mat, trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const col = new THREE.Color(), cA = new THREE.Color(0x33443a), cB = new THREE.Color(0x4e6248);
  trees.forEach((t, i) => {
    const s = t.h / CONIFER_H;
    e.set(0, (t.seed % 628) / 100, 0);
    q.setFromEuler(e);
    pos.set(t.x, groundHeight(t.x, t.z) - 0.25, t.z);
    scl.set(s * (0.9 + (t.seed % 97) / 400), s, s * (0.9 + (t.seed % 89) / 400));
    inst.setMatrixAt(i, m.compose(pos, q, scl));
    inst.setColorAt(i, col.lerpColors(cA, cB, (t.seed % 1000) / 1000));
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  return { inst, tick: dt => { if (windShader) windShader.uniforms.uTime.value += dt; } };
}

function buildBirches(trees) {
  // Trunks: one instanced tapered cylinder wearing the bark canvas.
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.15, 1, 6, 1);
  trunkGeo.translate(0, 0.5, 0);   // pivot at the base, scale y = height
  const trunkMat = new THREE.MeshLambertMaterial({ map: barkTexture() });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);

  // Canopies: two crossed cutout cards per tree, instanced together.
  const cardA = new THREE.PlaneGeometry(1, 1);
  const cardB = new THREE.PlaneGeometry(1, 1);
  cardB.rotateY(Math.PI / 2);
  const leafGeo = mergeGeometries([cardA, cardB]);
  const leafMat = new THREE.MeshLambertMaterial({
    map: birchLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, trees.length);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  trees.forEach((t, i) => {
    const y = groundHeight(t.x, t.z) - 0.15;
    const yaw = (t.seed % 628) / 100;
    e.set(0, yaw, (t.seed % 100) / 100 * 0.08 - 0.04);   // slight lean
    q.setFromEuler(e);
    pos.set(t.x, y, t.z);
    scl.set(1, t.h, 1);
    trunks.setMatrixAt(i, m.compose(pos, q, scl));

    e.set(0, yaw + 0.7, 0);
    q.setFromEuler(e);
    pos.set(t.x, y + t.h * 0.78, t.z);
    const w = t.h * 0.62;
    scl.set(w, t.h * 0.55, w);
    leaves.setMatrixAt(i, m.compose(pos, q, scl));
  });
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  return [trunks, leaves];
}

/* ---------------------------------------------------------------- far tier */

function buildFarTrees(trees) {
  const positions = [], uvs = [], indices = [];
  let vi = 0;
  const addQuad = (x, y, z, yaw, w, h, u0) => {
    const dx = Math.cos(yaw) * w / 2, dz = Math.sin(yaw) * w / 2;
    positions.push(
      x - dx, y, z - dz,   x + dx, y, z + dz,
      x - dx, y + h, z - dz,   x + dx, y + h, z + dz);
    uvs.push(u0, 0, u0 + 0.5, 0, u0, 1, u0 + 0.5, 1);
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  };

  for (const t of trees) {
    const y = groundHeight(t.x, t.z) - 0.3;
    const u0 = t.species === 'conifer' ? 0 : 0.5;
    const w = t.species === 'conifer' ? t.h * 0.55 : t.h * 0.8;
    const yaw = (t.seed % 314) / 100;
    // Crossed pair, not camera-facing: static geometry parallaxes honestly
    // as the walker moves, and the fog has flattened it long before the
    // flatness could read.
    addQuad(t.x, y, t.z, yaw, w, t.h, u0);
    addQuad(t.x, y, t.z, yaw + Math.PI / 2, w, t.h, u0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const mat = new THREE.MeshBasicMaterial({
    map: silhouetteTexture(),
    color: 0x37444c,             // just darker than the near fog, so depth stacks
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    fog: true,
  });
  return new THREE.Mesh(geo, mat);
}

/* -------------------------------------------------------------------- build */

export function buildForest(scene) {
  const near = LAYOUT.trees.filter(t => t.tier === 'near');
  const far = LAYOUT.trees.filter(t => t.tier === 'far');

  const conifers = buildConifers(near.filter(t => t.species === 'conifer'));
  scene.add(conifers.inst);
  for (const mesh of buildBirches(near.filter(t => t.species === 'birch'))) scene.add(mesh);
  scene.add(buildFarTrees(far));

  return {
    update(dt) { conifers.tick(dt); },
  };
}
