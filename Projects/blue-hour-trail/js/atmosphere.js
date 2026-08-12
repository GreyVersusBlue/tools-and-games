import * as THREE from 'three';
import { groundHeight, trailPoint, LAYOUT } from './field.js';

// The air itself: drifting mist banks, light shafts that only exist while the
// fog thins, fireflies that only exist while it thickens, and — above the fog
// line — the cloud sea the whole climb is for. Everything here is a handful
// of merged meshes; nothing is a per-sprite draw call.

function softTexture(inner = 0.5) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(255,255,255,${inner})`);
  grad.addColorStop(0.55, `rgba(255,255,255,${inner * 0.4})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.7)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  // soften the sides
  const side = ctx.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.25, 'rgba(0,0,0,0)');
  side.addColorStop(0.75, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

/* --------------------------------------------------------------------- mist */

/**
 * 26 huge billboarded quads on the dune-grass shader, with a slow per-quad
 * drift added in the vertex stage — the banks wander a few metres over half a
 * minute, which is all real mist does. One draw call, zero per-frame JS
 * beyond a time uniform. Deliberately not THREE.Sprite, which is a draw call
 * apiece.
 */
function buildMist() {
  const positions = [], roots = [], corners = [], uvs = [], phases = [], indices = [];
  let vi = 0;
  for (let i = 0; i < 26; i++) {
    const p = trailPoint(0.02 + Math.random() * 0.96);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = 8 + Math.random() * 30;
    const x = p.x + -p.dz * off * side, z = p.z + p.dx * off * side;
    const w = 25 + Math.random() * 25, h = 8 + Math.random() * 8;
    const y = groundHeight(x, z) + 1 + Math.random() * 3;
    const ph = Math.random() * Math.PI * 2;
    for (let cnr = 0; cnr < 4; cnr++) {
      roots.push(x, y, z);
      positions.push(x, y + (cnr >= 2 ? h : 0), z);
      phases.push(ph);
    }
    corners.push(-w / 2, 0, w / 2, 0, -w / 2, h, w / 2, h);
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aRoot', new THREE.Float32BufferAttribute(roots, 3));
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const mat = new THREE.MeshBasicMaterial({
    map: softTexture(0.4),
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    fog: true,
  });
  let shaderRef = null;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute vec3 aRoot;\nattribute vec2 aCorner;\nattribute float aPhase;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `
        vec3 root = aRoot;
        root.x += sin(uTime * 0.05 + aPhase) * 7.0;
        root.z += cos(uTime * 0.04 + aPhase * 1.7) * 5.0;
        vec3 toCam = cameraPosition - root;
        toCam.y = 0.0;
        float toCamLen = length(toCam);
        vec3 camDir = toCamLen > 0.0001 ? toCam / toCamLen : vec3(0.0, 0.0, 1.0);
        vec3 bladeRight = vec3(-camDir.z, 0.0, camDir.x);
        vec3 transformed = root + bladeRight * aCorner.x + vec3(0.0, aCorner.y, 0.0);`);
    shaderRef = shader;
  };
  mat.customProgramCacheKey = () => 'blue-hour-mist';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;    // roots drift out of the static bounds
  return { mesh, mat, tick: dt => { if (shaderRef) shaderRef.uniforms.uTime.value += dt; } };
}

/* ------------------------------------------------------------- light shafts */

function buildShafts() {
  const parts = [];
  for (const s of LAYOUT.shafts) {
    const g = groundHeight(s.x, s.z);
    const plane = new THREE.PlaneGeometry(2.2 + Math.random() * 1.6, 19);
    plane.rotateZ(s.tilt);                        // leaning with the light
    plane.rotateY(Math.random() * Math.PI);
    plane.translate(s.x, g + 8.5, s.z);
    parts.push(plane);
  }
  // merge by hand — same layout, only position/uv matter
  const positions = [], uvs = [], indices = [];
  let vi = 0;
  for (const p of parts) {
    const pos = p.attributes.position, uv = p.attributes.uv, idx = p.index;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vi);
    vi += pos.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const mat = new THREE.MeshBasicMaterial({
    map: shaftTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  return { mesh: new THREE.Mesh(geo, mat), mat };
}

/* ---------------------------------------------------------------- fireflies */

function buildFireflies() {
  const COUNT = 60;
  const base = [], phase = [];
  const wf = LAYOUT.waterfall, cb = LAYOUT.cabin;
  for (let i = 0; i < COUNT; i++) {
    // clustered near the creek mouth, the cabin, and dark trail hollows
    const anchor = i < 20 ? { x: wf.x, z: wf.z + 12 }
      : i < 40 ? { x: cb.x, z: cb.z }
      : (() => { const p = trailPoint(0.15 + Math.random() * 0.7); return { x: p.x, z: p.z }; })();
    const x = anchor.x + (Math.random() - 0.5) * 16;
    const z = anchor.z + (Math.random() - 0.5) * 16;
    base.push(new THREE.Vector3(x, groundHeight(x, z) + 0.5 + Math.random() * 1.6, z));
    phase.push(Math.random() * Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(COUNT * 3);
  base.forEach((b, i) => arr.set([b.x, b.y, b.z], i * 3));
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.PointsMaterial({
    map: softTexture(0.9),
    color: 0xcfe8a0,
    size: 0.16,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, mat, base, phase };
}

/* ---------------------------------------------------- above the fog line --- */

// There used to be a summit payoff built here: a cloud sea ring at y = 46 and
// three distant peaks breaking it, both fading in on altT. Two things were
// wrong with it. Geometrically it never worked — the mountain has no peak, it
// is a ramp in z, so the plane sat inside the hillside and was reachable by
// 2 of 30 test rays. And thematically it was the wrong promise: a scenic reward
// at the top of a climb that is supposed to feel like a place you want to leave.
// Both are gone. The walk ends in the fog now, which is the honest version of
// what this piece was always doing.

/* -------------------------------------------------------------------- build */

export function buildAtmosphere(scene) {
  const mist = buildMist();
  scene.add(mist.mesh);

  const shafts = buildShafts();
  scene.add(shafts.mesh);

  const flies = buildFireflies();
  scene.add(flies.points);

  const positions = flies.points.geometry.attributes.position;
  let t = 0;

  return {
    update(dt, camera, fogT, altT) {
      t += dt;
      mist.tick(dt);
      // More mist when the weather is thick, and MORE of it again at altitude.
      // This term used to be multiplied by (1 - altT) — the mist thinned out as
      // you climbed, because the summit was where the piece let you go. It
      // doesn't any more.
      mist.mat.opacity = 0.07 + fogT * 0.09 + altT * 0.07;

      // Shafts belong to the clear phases: light gets through while the fog
      // breathes out, and the woods go blind while it breathes in.
      const clear = Math.pow(1 - fogT, 1.6);
      shafts.mat.opacity = clear * (0.22 + Math.sin(t * 0.3) * 0.06) * (1 - altT);

      // Fireflies belong to the thick phases — the woods darken enough for
      // them to read, and something has to glow out there.
      flies.mat.opacity = Math.max(0, (fogT - 0.55) / 0.45) * 0.85 * (1 - altT);
      if (flies.mat.opacity > 0.01) {
        for (let i = 0; i < flies.base.length; i++) {
          const b = flies.base[i], ph = flies.phase[i];
          positions.setXYZ(i,
            b.x + Math.sin(t * 0.7 + ph) * 1.2,
            b.y + Math.sin(t * 1.1 + ph * 2.1) * 0.5,
            b.z + Math.cos(t * 0.5 + ph) * 1.2);
        }
        positions.needsUpdate = true;
      }

      // Shafts and fireflies still fade out with altitude, and they should:
      // no light gets through up there to make a shaft of, and fireflies are a
      // thing the woods have. Losing them is part of arriving.
    },
  };
}
