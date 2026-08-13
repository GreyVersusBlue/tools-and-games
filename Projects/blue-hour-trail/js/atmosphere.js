import * as THREE from 'three';
import { groundHeight, trailPoint, LAYOUT } from './field.js';

// The air itself: drifting mist banks, light shafts that only exist while the
// fog thins, fireflies that only exist while it thickens, dust motes falling
// through a box that follows the walker, and the walker's own breath once the
// summit air bites. Everything here is a handful of merged meshes; nothing is
// a per-sprite draw call.

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

// A bank, not a disc. The first-light pass (session 5) found the one mist
// quad that ever read on screen read as a perfect radial-gradient circle —
// a sprite, in exactly the way the task file feared. A bank of mist has a
// long soft core and ragged ends, so the texture is a horizontal band of
// overlapping lobes: nothing on screen can resolve into one circle.
function mistTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = 56 + Math.random() * 144;
    const y = 50 + Math.random() * 28;
    const r = 28 + Math.random() * 28;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.45)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.19)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
  }
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
 * 30 billboarded quads on the dune-grass shader, with a slow per-quad drift
 * added in the vertex stage — the banks wander a few metres over half a
 * minute, which is all real mist does. One draw call, zero per-frame JS
 * beyond a time uniform. Deliberately not THREE.Sprite, which is a draw call
 * apiece.
 *
 * Placement is from the first-light pass (session 5), the first time anyone
 * had ever SEEN these: the original 26 banks sat 8-38 m off-trail and were
 * swallowed whole by the trees and the fog — measured, they touched under
 * 1% of the frame from the trail. Mist the walker never crosses is mist
 * that isn't there. So most banks now hug the trail corridor low enough to
 * walk through, a few stand deep in the trees for layers, and the rest pool
 * where real mist pools: over the creek at the waterfall, and in the cabin
 * hollow.
 */
function buildMist() {
  const positions = [], roots = [], corners = [], uvs = [], phases = [], indices = [];
  let vi = 0;
  const banks = [];
  // 18 trail-huggers: on or beside the corridor, low, walk-through height.
  for (let i = 0; i < 18; i++) {
    const p = trailPoint(0.02 + Math.random() * 0.96);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = Math.random() * 14;
    banks.push({
      x: p.x + -p.dz * off * side, z: p.z + p.dx * off * side,
      w: 22 + Math.random() * 18, h: 3.5 + Math.random() * 3.5,
      lift: 0.4 + Math.random() * 0.8,
    });
  }
  // 6 deep banks: the old off-trail placement, kept for depth between trees.
  for (let i = 0; i < 6; i++) {
    const p = trailPoint(0.05 + Math.random() * 0.9);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = 16 + Math.random() * 22;
    banks.push({
      x: p.x + -p.dz * off * side, z: p.z + p.dx * off * side,
      w: 30 + Math.random() * 25, h: 8 + Math.random() * 6,
      lift: 1 + Math.random() * 2,
    });
  }
  // 3 over the creek at the waterfall, 3 in the cabin hollow — the two
  // places on this mountain where mist would genuinely collect.
  const wf = LAYOUT.waterfall, cb = LAYOUT.cabin;
  for (let i = 0; i < 6; i++) {
    const a = i < 3 ? { x: wf.x, z: wf.z + 10 } : { x: cb.x, z: cb.z };
    banks.push({
      x: a.x + (Math.random() - 0.5) * 14, z: a.z + (Math.random() - 0.5) * 14,
      w: 18 + Math.random() * 14, h: 3 + Math.random() * 2.5,
      lift: 0.3 + Math.random() * 0.6,
    });
  }
  for (const b of banks) {
    const { x, z, w, h } = b;
    const y = groundHeight(x, z) + b.lift;
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
    map: mistTexture(),
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    fog: true,
    // Load-bearing, discovered session 4: the bladeRight billboard basis
    // below winds these quads CLOCKWISE as seen from the camera — the
    // triangle normal (bladeRight × up) points away from the viewer — so
    // under the default FrontSide the entire mesh is backface-culled and the
    // mist has never once rendered. The undergrowth shares the basis and was
    // only ever visible because it sets DoubleSide. Zero page errors, zero
    // warnings: a culled mesh fails silently, which is why the suite now
    // checks pixels for this family of materials instead of trusting the
    // error canary.
    side: THREE.DoubleSide,
  });
  let shaderRef = null;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute vec3 aRoot;\nattribute vec2 aCorner;\nattribute float aPhase;\nuniform float uTime;\nvarying float vNear;')
      .replace('#include <begin_vertex>', `
        vec3 root = aRoot;
        root.x += sin(uTime * 0.05 + aPhase) * 7.0;
        root.z += cos(uTime * 0.04 + aPhase * 1.7) * 5.0;
        vec3 toCam = cameraPosition - root;
        toCam.y = 0.0;
        float toCamLen = length(toCam);
        // Banks the walker is inside melt away instead of washing the frame
        // white — and instead of popping the instant the camera crosses the
        // billboard plane. Mist you are in is just fog; the banks are the
        // mist you can still see across the air.
        vNear = smoothstep(2.0, 7.0, toCamLen);
        vec3 camDir = toCamLen > 0.0001 ? toCam / toCamLen : vec3(0.0, 0.0, 1.0);
        vec3 bladeRight = vec3(-camDir.z, 0.0, camDir.x);
        vec3 transformed = root + bladeRight * aCorner.x + vec3(0.0, aCorner.y, 0.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vNear;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.a *= vNear;`);
    shaderRef = shader;
  };
  mat.customProgramCacheKey = () => 'blue-hour-mist';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;    // roots drift out of the static bounds
  return {
    mesh, mat,
    tick: dt => { if (shaderRef) shaderRef.uniforms.uTime.value += dt; },
    // One root per bank (the four corners share it) — where the banks stand,
    // for the suite and for anyone aiming a camera at one. The shader adds a
    // ±7 m drift on top of these.
    banks: () => {
      const r = geo.attributes.aRoot, out = [];
      for (let i = 0; i < r.count; i += 4) out.push({ x: r.getX(i), y: r.getY(i), z: r.getZ(i) });
      return out;
    },
    // Move one bank to a known spot with a known size — the deterministic
    // staging the pixel check needs. Bank placement is random per load and
    // the shader drifts every root by up to ±7 m, so a test that hopes a
    // bank is in frame is a test that flakes; a test that puts a wide one
    // right in front of the camera isn't.
    reroot: (i, x, y, z, w = 24, h = 8) => {
      const r = geo.attributes.aRoot, ph = geo.attributes.aPhase;
      const pos = geo.attributes.position, cor = geo.attributes.aCorner;
      for (let c = 0; c < 4; c++) {
        r.setXYZ(i * 4 + c, x, y, z);
        pos.setXYZ(i * 4 + c, x, y + (c >= 2 ? h : 0), z);
        ph.setX(i * 4 + c, 0);
      }
      cor.setXY(i * 4, -w / 2, 0); cor.setXY(i * 4 + 1, w / 2, 0);
      cor.setXY(i * 4 + 2, -w / 2, h); cor.setXY(i * 4 + 3, w / 2, h);
      r.needsUpdate = true;
      ph.needsUpdate = true;
      pos.needsUpdate = true;
      cor.needsUpdate = true;
    },
  };
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

/* -------------------------------------------------------------------- motes */

/**
 * Dust and seed-drift in a box that follows the camera: each point falls and
 * sways, and any coordinate that leaves the box wraps to the far side, so the
 * air is never empty and never catches up with the walker. They read best in
 * the clear phases — murk swallows anything this small — so opacity leans on
 * (1 - fogT) and the mesh itself never toggles.
 */
function buildMotes() {
  const COUNT = 140;
  const arr = new Float32Array(COUNT * 3);
  const sway = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 14;
    arr[i * 3 + 1] = (Math.random() - 0.5) * 8;
    arr[i * 3 + 2] = (Math.random() - 0.5) * 14;
    sway[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.PointsMaterial({
    map: softTexture(0.8),
    color: 0xbcc8d0,
    size: 0.045,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;      // the box straddles the camera
  return { points, mat, sway };
}

/* ------------------------------------------------------------------- breath */

/**
 * The walker's breath, once the air is cold enough to show it: six billboard
 * quads recycled round-robin, each one born at the camera's mouth and gone
 * within a second and a half. Age does everything in the shader — rise, grow,
 * fade — so the CPU only writes a root and a birth time every few seconds.
 * The mesh never toggles visible; a quad older than its fade is simply not
 * there.
 */
function buildBreath() {
  const N = 6;
  const uvs = [], indices = [];
  const corners = new Float32Array(N * 8);
  for (let i = 0; i < N; i++) {
    const vi = i * 4;
    // Sized in the session-5 first-light pass, the first time the breath was
    // ever seen: the original 0.28 m quad at 0.35 m from the eye covered two
    // thirds of the screen and read as a bloom artifact, not as vapour. A
    // hand-span puff at arm's length reads as breath.
    corners.set([-0.09, 0, 0.09, 0, -0.09, 0.19, 0.09, 0.19], i * 8);
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 12), 3));
  geo.setAttribute('aRoot', new THREE.BufferAttribute(new Float32Array(N * 12), 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(new Float32Array(N * 4).fill(-10), 1));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const mat = new THREE.MeshBasicMaterial({
    map: softTexture(0.5),
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    fog: true,
    // Same silently-culled winding as the mist — see the note there. The
    // breath shipped a whole session without a single frame of it existing.
    side: THREE.DoubleSide,
  });
  let shaderRef = null;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute vec3 aRoot;\nattribute vec2 aCorner;\nattribute float aBirth;\nuniform float uTime;\nvarying float vPuff;')
      .replace('#include <begin_vertex>', `
        float age = uTime - aBirth;
        vPuff = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.4, 1.3, age));
        vec3 root = aRoot + vec3(0.0, age * 0.22, 0.0);
        vec3 toCam = cameraPosition - root;
        toCam.y = 0.0;
        float toCamLen = length(toCam);
        vec3 camDir = toCamLen > 0.0001 ? toCam / toCamLen : vec3(0.0, 0.0, 1.0);
        vec3 bladeRight = vec3(-camDir.z, 0.0, camDir.x);
        float grow = 1.0 + age * 1.1;
        vec3 transformed = root + bladeRight * aCorner.x * grow + vec3(0.0, aCorner.y * grow, 0.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPuff;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.a *= vPuff;`);
    shaderRef = shader;
  };
  mat.customProgramCacheKey = () => 'blue-hour-breath';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;        // six quads glued to the camera
  return {
    mesh,
    tick: dt => { if (shaderRef) shaderRef.uniforms.uTime.value += dt; },
    time: () => (shaderRef ? shaderRef.uniforms.uTime.value : 0),
    puff(camera, dir, slot, agoSec = 0) {
      const roots = geo.attributes.aRoot, births = geo.attributes.aBirth;
      // Born at the mouth but half a metre out — close enough to be yours,
      // far enough that the quad is a puff in the frame, not a screen wash.
      const x = camera.position.x + dir.x * 0.55;
      const y = camera.position.y - 0.14 + dir.y * 0.55;
      const z = camera.position.z + dir.z * 0.55;
      for (let c = 0; c < 4; c++) {
        roots.setXYZ(slot * 4 + c, x, y, z);
        births.setX(slot * 4 + c, this.time() - agoSec);
      }
      roots.needsUpdate = true;
      births.needsUpdate = true;
    },
  };
}

/* -------------------------------------------------------------------- steam */

/**
 * Tea steam at the cab glass. Six quads recycled round-robin at one fixed
 * point — the pane of the lookout cab that faces the bench — rising half a
 * metre and gone. It runs whether or not anyone has climbed high enough to
 * see it, because it is not a beat and not a reward: the cab is warm, has
 * been warm the whole time, and nobody says so. The quads sit a hand's width
 * outside the glass (the cab is a solid box; a wisp truly inside it would be
 * depth-tested away), which from the bench ten metres off in summit fog is
 * indistinguishable from steam behind the pane.
 *
 * Billboarded on the CPU, not in a vertex shader: six quads at one fixed
 * point are cheap enough to place by hand every frame, and hunting this
 * feature's invisibility is how the mist/breath backface-culling bug above
 * was found in the first place. The right vector here is (tz, -tx) — the
 * OPPOSITE of the shader family's bladeRight — so the winding is
 * counter-clockwise toward the camera and FrontSide is enough.
 */
function buildSteam() {
  const tw = LAYOUT.tower, be = LAYOUT.bench;
  const g = groundHeight(tw.x, tw.z);
  const d = { x: be.x - tw.x, z: be.z - tw.z };
  const len = Math.hypot(d.x, d.z) || 1;
  d.x /= len; d.z /= len;
  const root = {
    x: tw.x + d.x * 1.36,
    y: g + 9.86,                     // the sill of the window band
    z: tw.z + d.z * 1.36,
  };

  const N = 6, LIFE = 2.6;
  const uvs = [], indices = [];
  for (let i = 0; i < N; i++) {
    const vi = i * 4;
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 12), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 16), 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const mat = new THREE.MeshBasicMaterial({
    map: softTexture(0.55),
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    fog: true,
    vertexColors: true,     // RGBA — the alpha channel carries each puff's age
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const births = new Float32Array(N).fill(-10);
  let now = 0;
  const sstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  return {
    mesh, root,
    time: () => now,
    puff(slot) { births[slot] = now; },
    update(dt, camera) {
      now += dt;
      const pos = geo.attributes.position, col = geo.attributes.color;
      const tx = camera.position.x - root.x, tz = camera.position.z - root.z;
      const tlen = Math.hypot(tx, tz) || 1;
      const rx = tz / tlen, rz = -tx / tlen;        // billboard right, CCW winding
      for (let i = 0; i < N; i++) {
        const age = now - births[i];
        const alive = age >= 0 && age < LIFE;
        const fade = alive ? sstep(0, 0.3, age) * (1 - sstep(1.2, LIFE, age)) : 0;
        const grow = 1 + age * 0.9;
        const cx = root.x + Math.sin(age * 1.7) * 0.04;
        const cy = root.y + age * 0.28;
        const cz = root.z;
        const hw = 0.12 * grow, hh = 0.26 * grow;
        pos.setXYZ(i * 4, cx - rx * hw, cy, cz - rz * hw);
        pos.setXYZ(i * 4 + 1, cx + rx * hw, cy, cz + rz * hw);
        pos.setXYZ(i * 4 + 2, cx - rx * hw, cy + hh, cz - rz * hw);
        pos.setXYZ(i * 4 + 3, cx + rx * hw, cy + hh, cz + rz * hw);
        for (let c = 0; c < 4; c++) col.setXYZW(i * 4 + c, 1, 1, 1, fade);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    },
  };
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

  const motes = buildMotes();
  scene.add(motes.points);

  const breath = buildBreath();
  scene.add(breath.mesh);

  const steam = buildSteam();
  scene.add(steam.mesh);

  const positions = flies.points.geometry.attributes.position;
  const motePos = motes.points.geometry.attributes.position;
  const wrap = (v, c, s) => c + ((v - c + s / 2) % s + s) % s - s / 2;
  const camDir = new THREE.Vector3();
  let breathTimer = 2, breathSlot = 0;
  let steamTimer = 1, steamSlot = 0;
  let t = 0;

  return {
    update(dt, camera, fogT, altT) {
      t += dt;
      mist.tick(dt);
      // More mist when the weather is thick, and MORE of it again at altitude.
      // This term used to be multiplied by (1 - altT) — the mist thinned out as
      // you climbed, because the summit was where the piece let you go. It
      // doesn't any more.
      //
      // Raised from 0.07/0.09/0.07 in the session-5 first-light pass: those
      // numbers were authored blind (the mist had never rendered — see the
      // material note) and measured under 1% of the frame from the trail.
      // The banked texture and the near-camera fade carry the extra opacity
      // without letting any one quad read as a shape.
      mist.mat.opacity = 0.14 + fogT * 0.12 + altT * 0.09;

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

      // Motes: falling, swaying, wrapping through the camera's box.
      motes.mat.opacity = 0.06 + (1 - fogT) * 0.08;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < motes.sway.length; i++) {
        const ph = motes.sway[i];
        motePos.setXYZ(i,
          wrap(motePos.getX(i) + Math.sin(t * 0.4 + ph) * dt * 0.12, cx, 14),
          wrap(motePos.getY(i) - dt * 0.06, cy, 8),
          wrap(motePos.getZ(i) + Math.cos(t * 0.3 + ph * 1.3) * dt * 0.1, cz, 14));
      }
      motePos.needsUpdate = true;

      // Breath, once the summit air bites. Spawns gate on altitude; the mesh
      // itself stays in the draw list with all its quads faded out.
      breath.tick(dt);
      breathTimer -= dt;
      if (breathTimer <= 0 && altT > 0.6) {
        breathTimer = 3.8 + Math.random() * 1.2;
        camera.getWorldDirection(camDir);
        breath.puff(camera, camDir, breathSlot);
        breathSlot = (breathSlot + 1) % 6;
      }

      // The kettle, tirelessly. No gate on altitude or attention: the steam
      // does not know whether anyone can see it, which is what makes it true.
      steam.update(dt, camera);
      steamTimer -= dt;
      if (steamTimer <= 0) {
        steamTimer = 1.2 + Math.random() * 0.6;
        steam.puff(steamSlot);
        steamSlot = (steamSlot + 1) % 6;
      }
    },
    // Where the kettle is, and the alpha the first quad is currently drawn
    // at — geometry truth for the suite; the pixel check covers the rest.
    steamInfo: () => ({
      ...steam.root,
      alpha0: steam.mesh.geometry.attributes.color.getW(0),
    }),
    // For the suite and for tuning: stage every steam quad at once so a
    // screenshot doesn't have to wait out the kettle's own timing at
    // software-GL frame rates.
    steamBurst: () => { for (let i = 0; i < 6; i++) { steam.puff(i); } },

    // The same doors for the two systems that went dark silently for three
    // sessions (the billboard-winding trap — see the mist material). The
    // suite proves these with PIXELS now, and pixels need a way to stage a
    // frame and a way to take the mesh out of it for a baseline.
    mistInfo: () => ({ opacity: mist.mat.opacity, banks: mist.banks() }),
    mistShow: v => { mist.mesh.visible = !!v; },
    mistReroot: (i, x, y, z, w, h) => mist.reroot(i, x, y, z, w, h),
    breathInfo: () => ({ opacity: breath.mesh.material.opacity }),
    breathShow: v => { breath.mesh.visible = !!v; },
    // Stage all six breath quads at the camera's mouth at once, staggered in
    // age so they read as a plume rather than one stacked quad.
    breathBurst: camera => {
      camera.getWorldDirection(camDir);
      for (let i = 0; i < 6; i++) breath.puff(camera, camDir, i, i * 0.18);
    },
  };
}
