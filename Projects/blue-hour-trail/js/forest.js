import * as THREE from 'three';
import { groundHeight, LAYOUT } from './field.js';

// The woods, in two tiers. Trees within 22 m of the trail are real geometry —
// instanced conifers with wind sway, birch trunks with drawn bark, crossed
// foliage cards. Everything farther out is a flat silhouette card the fog has
// already half-eaten by the time it's visible: at 22 m the fog factor is
// pushing a third, and flatness is exactly what dense mist does to a tree
// anyway. Six draw calls for the whole forest, whichever way you look —
// three conifer variants, birch trunks and canopies, one far-tier card mesh.
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

// Far-tier silhouettes, four cells: the broad conifer, a slender one, a dead
// spire, and the broadleaf. Two shapes for a whole horizon read as wallpaper
// the moment the fog thins; four is enough that no two neighbours rhyme.
function silhouetteTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffffff';        // colour comes from the material

  // broad conifer: stacked ragged triangles
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

  // slender conifer: more bands, tighter, a spire more than a tree
  ctx.save();
  ctx.translate(192, 128);
  ctx.fillRect(-2.5, -30, 5, 30);
  for (let band = 0; band < 8; band++) {
    const y = -18 - band * 13;
    const w = 30 - band * 3.1;
    ctx.beginPath();
    ctx.moveTo(-w, y);
    for (let s = 0; s <= 6; s++) {
      const t = s / 6;
      ctx.lineTo(-w + t * 2 * w, y - 3 + Math.sin(s * 3.1 + band * 1.7) * 2.4);
    }
    ctx.lineTo(0, y - 19);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // dead spire: a trunk and the jagged stubs of what the crown used to be
  ctx.save();
  ctx.translate(320, 128);
  ctx.beginPath();
  ctx.moveTo(-4.5, 0); ctx.lineTo(-1.2, -118); ctx.lineTo(1.2, -118); ctx.lineTo(4.5, 0);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const y = -26 - i * 10.5;
    const s = i % 2 === 0 ? 1 : -1;
    const len = 22 - i * 2;
    ctx.save();
    ctx.translate(0, y);
    ctx.rotate(s * (0.45 + (i % 3) * 0.12));
    ctx.fillRect(0, -1.6, s * len, 3.2);
    ctx.restore();
  }
  ctx.restore();

  // broadleaf: trunk and a lumpy crown
  ctx.save();
  ctx.translate(448, 128);
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

// Three silhouettes so the stand stops being one tree repeated 2,700 times:
// the full spruce everyone gets, a slender four-band fir, and the odd dead
// spire — bare trunk, stub branches, no crown. Heights before instance scale.
const CONIFER_H = [10.6, 10.1, 10.5];

function coniferGeometry(variant) {
  const parts = [];
  if (variant === 2) {
    // Dead spire: what's left when a tree loses the argument with winter.
    const trunk = new THREE.CylinderGeometry(0.06, 0.3, 10.5, 5, 1);
    trunk.translate(0, 5.25, 0);
    parts.push(trunk);
    for (let i = 0; i < 6; i++) {
      const y = 2.6 + i * 1.35;
      const len = 1.5 - i * 0.18;
      const stub = new THREE.CylinderGeometry(0.025, 0.06, len, 4, 1);
      stub.translate(0, len / 2, 0);
      stub.rotateZ(Math.PI / 2 - 0.5 - (i % 3) * 0.22);   // drooping, not reaching
      stub.rotateY(i * 2.4);
      stub.translate(0, y, 0);
      parts.push(stub);
    }
    return mergeGeometries(parts);
  }
  const slender = variant === 1;
  const trunk = slender
    ? new THREE.CylinderGeometry(0.1, 0.24, 2.8, 5, 1)
    : new THREE.CylinderGeometry(0.14, 0.34, 2.6, 5, 1);
  trunk.translate(0, slender ? 1.4 : 1.3, 0);
  parts.push(trunk);
  const bands = slender
    ? [[1.6, 3.6, 3.0], [1.3, 3.2, 5.2], [1.0, 2.8, 7.2], [0.65, 2.2, 9.0]]
    : [[2.1, 4.6, 3.3], [1.55, 3.8, 5.9], [1.0, 3.0, 8.2]];
  for (const [r, h, y] of bands) {
    const cone = new THREE.ConeGeometry(r, h, 7, 1, true);
    cone.translate(0, y, 0);
    parts.push(cone);
  }
  return mergeGeometries(parts);
}

// One material recipe, two stiffnesses: live trees answer the wind, dead
// wood barely moves. Phase comes from the instance's world position, more
// sway at the crown than the root, normalized by a fixed height so all the
// variants share the same weather.
function coniferMaterial(amp, key) {
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const holder = { shader: null };
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float windPh = dot(instanceMatrix[3].xz, vec2(0.31, 0.17));
        float windAmt = pow(max(position.y, 0.0) / 11.0, 2.0);
        transformed.x += sin(uTime * 0.9 + windPh) * windAmt * ${(amp).toFixed(2)};
        transformed.z += sin(uTime * 0.7 + windPh * 1.3) * windAmt * ${(amp * 0.625).toFixed(2)};`);
    holder.shader = shader;
  };
  mat.customProgramCacheKey = () => key;
  return { mat, holder };
}

function buildConifers(trees) {
  // seed % 10: six of ten get the full spruce, three the slender fir, one
  // in ten died standing. Deterministic, so the woods are the same woods
  // every load.
  const groups = [[], [], []];
  for (const t of trees) groups[t.seed % 10 < 6 ? 0 : t.seed % 10 < 9 ? 1 : 2].push(t);

  const live = coniferMaterial(0.32, 'blue-hour-conifer');
  const dead = coniferMaterial(0.13, 'blue-hour-conifer-dead');

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const col = new THREE.Color();
  const ramps = [
    [new THREE.Color(0x33443a), new THREE.Color(0x4e6248)],
    [new THREE.Color(0x33443a), new THREE.Color(0x4e6248)],
    [new THREE.Color(0x2a3230), new THREE.Color(0x3a4038)],   // weathered grey
  ];

  const meshes = groups.map((group, v) => {
    const inst = new THREE.InstancedMesh(
      coniferGeometry(v), v === 2 ? dead.mat : live.mat, group.length);
    group.forEach((t, i) => {
      const s = t.h / CONIFER_H[v];
      e.set(0, (t.seed % 628) / 100, 0);
      q.setFromEuler(e);
      pos.set(t.x, groundHeight(t.x, t.z) - 0.25, t.z);
      scl.set(s * (0.9 + (t.seed % 97) / 400), s, s * (0.9 + (t.seed % 89) / 400));
      inst.setMatrixAt(i, m.compose(pos, q, scl));
      inst.setColorAt(i, col.lerpColors(ramps[v][0], ramps[v][1], (t.seed % 1000) / 1000));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    return inst;
  });

  return {
    meshes,
    tick: dt => {
      if (live.holder.shader) live.holder.shader.uniforms.uTime.value += dt;
      if (dead.holder.shader) dead.holder.shader.uniforms.uTime.value += dt;
    },
  };
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
  // The canopies answer the same wind as the conifers, gentler — the cards
  // are ~4 m across after instance scale, so the local amplitude stays small.
  // (position.y + 0.5) puts zero sway at the canopy's underside, most at the
  // crown, since the unit plane is centered.
  let leafShader = null;
  leafMat.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float windPh = dot(instanceMatrix[3].xz, vec2(0.31, 0.17));
        float windAmt = position.y + 0.5;
        transformed.x += sin(uTime * 1.1 + windPh) * windAmt * 0.05;
        transformed.z += sin(uTime * 0.8 + windPh * 1.3) * windAmt * 0.035;`);
    leafShader = shader;
  };
  leafMat.customProgramCacheKey = () => 'blue-hour-birch-leaves';
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
  return {
    meshes: [trunks, leaves],
    tick: dt => { if (leafShader) leafShader.uniforms.uTime.value += dt; },
  };
}

/* ---------------------------------------------------------------- far tier */

function buildFarTrees(trees) {
  const positions = [], uvs = [], colors = [], indices = [];
  let vi = 0;
  const tint = new THREE.Color();
  const addQuad = (x, y, z, yaw, w, h, u0) => {
    const dx = Math.cos(yaw) * w / 2, dz = Math.sin(yaw) * w / 2;
    positions.push(
      x - dx, y, z - dz,   x + dx, y, z + dz,
      x - dx, y + h, z - dz,   x + dx, y + h, z + dz);
    uvs.push(u0, 0, u0 + 0.25, 0, u0, 1, u0 + 0.25, 1);
    for (let i = 0; i < 4; i++) colors.push(tint.r, tint.g, tint.b);
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  };

  for (const t of trees) {
    const y = groundHeight(t.x, t.z) - 0.3;
    // Same census as the near tier: mostly broad, some slender, one in ten
    // dead. Baked per-tree tint jitter keeps the merged wall from reading as
    // one flat cutout when the fog thins — all of it from the seed, so the
    // horizon is the same horizon every load.
    const cell = t.species !== 'conifer' ? 3
      : t.seed % 10 < 6 ? 0 : t.seed % 10 < 9 ? 1 : 2;
    const u0 = cell * 0.25;
    const w = t.species === 'conifer' ? t.h * (cell === 1 ? 0.42 : cell === 2 ? 0.3 : 0.55) : t.h * 0.8;
    const yaw = (t.seed % 314) / 100;
    tint.setHSL(
      0.56 + ((t.seed % 101) / 100 - 0.5) * 0.03,
      0.16 + ((t.seed % 71) / 70 - 0.5) * 0.04,
      0.26 + ((t.seed % 89) / 88 - 0.5) * 0.09);
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
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const mat = new THREE.MeshBasicMaterial({
    map: silhouetteTexture(),
    vertexColors: true,          // the tint bakes in the old 0x37444c, jittered
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
  for (const mesh of conifers.meshes) scene.add(mesh);
  const birches = buildBirches(near.filter(t => t.species === 'birch'));
  for (const mesh of birches.meshes) scene.add(mesh);
  scene.add(buildFarTrees(far));

  return {
    update(dt) { conifers.tick(dt); birches.tick(dt); },
  };
}
