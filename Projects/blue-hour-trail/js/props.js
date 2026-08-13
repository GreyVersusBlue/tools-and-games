import * as THREE from 'three';
import { groundHeight, LAYOUT } from './field.js';

// Everything built by hands — real or imagined — standing on the mountain:
// trail markers, the cairns, the footbridge, the summit bench, the fire
// lookout, the cabin, and the mushrooms underfoot. Where each one sits is in
// field.js; this file only turns those numbers into meshes.

/**
 * Weathering displacement — a smooth function of position, not per-vertex
 * random, for the reason Golden Hour's props.js documents at length: a
 * sphere's pole is a fan of coincident vertices, and independent jitter pulls
 * them apart into a crown of spikes. Same-point-same-displacement keeps
 * seams and poles shut.
 */
const _v = new THREE.Vector3();
function roughen(geo, amount, seed) {
  const s = (seed >>> 0) % 1000 * 0.017;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const n = Math.sin(_v.x * 1.7 + s)
            * Math.sin(_v.y * 2.3 - s * 1.6)
            * Math.sin(_v.z * 1.9 + s * 2.4);
    _v.multiplyScalar(1 + n * amount);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Golden Hour's local merge helper — see the note there about why this stays
// forty lines here instead of a vendored addon.
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

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const place = (geo, x, y, z, yaw = 0) => { if (yaw) geo.rotateY(yaw); geo.translate(x, y, z); return geo; };

/* ------------------------------------------------------------------ markers */

// Posts with a pale blaze board. The blazes are their own merged mesh so they
// can be near-unlit — a marker that vanishes into the murk marks nothing.
function buildMarkers(woodMat) {
  const posts = [], blazes = [];
  for (const mk of LAYOUT.markers) {
    const g = groundHeight(mk.x, mk.z);
    posts.push(place(box(0.13, 1.5, 0.13), mk.x, g + 0.65, mk.z, mk.yaw));
    const top = place(box(0.3, 0.22, 0.05), mk.x, g + 1.28, mk.z, mk.yaw);
    posts.push(top);
    blazes.push(place(box(0.16, 0.24, 0.06), mk.x, g + 0.95, mk.z, mk.yaw));
  }
  return [
    new THREE.Mesh(mergeGeometries(posts), woodMat),
    new THREE.Mesh(mergeGeometries(blazes),
      new THREE.MeshBasicMaterial({ color: 0xc8d0d8, fog: true })),
  ];
}

/* ------------------------------------------------------------------- cairns */

function buildCairns(stoneMat) {
  const parts = [];
  LAYOUT.cairns.forEach((c, ci) => {
    const g = groundHeight(c.x, c.z);
    let y = g - 0.05;
    for (let s = 0; s < c.stones; s++) {
      const t = s / c.stones;
      const r = 0.34 * (1 - t * 0.55) + 0.04 * Math.sin(ci * 3.1 + s * 7.7);
      const stone = new THREE.SphereGeometry(r, 9, 7);
      roughen(stone, 0.18, ci * 131 + s * 977);
      stone.scale(1, 0.55, 1);
      y += r * 0.52;
      place(stone, c.x + Math.sin(s * 2.6 + ci) * 0.05, y, c.z + Math.cos(s * 1.9) * 0.05);
      y += r * 0.42;
      parts.push(stone);
    }
  });
  return new THREE.Mesh(mergeGeometries(parts), stoneMat);
}

/* ------------------------------------------------------------------- bridge */

function buildBridge(woodMat) {
  const b = LAYOUT.bridge;
  const parts = [];
  // Deck planks across the walking direction; built along local +Z (the
  // walking direction), then rotated by the bridge's yaw.
  const plankN = 9;
  for (let i = 0; i < plankN; i++) {
    const along = -b.len / 2 + (i + 0.5) * (b.len / plankN);
    parts.push(place(box(b.width, 0.07, b.len / plankN - 0.05), 0, -0.045, along));
  }
  // stringers under the deck
  for (const side of [-1, 1]) {
    parts.push(place(box(0.14, 0.2, b.len), side * (b.width / 2 - 0.15), -0.18, 0));
  }
  // posts and handrails
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      parts.push(place(box(0.1, 1.0, 0.1), side * b.width / 2, 0.42, end * (b.len / 2 - 0.2)));
    }
    parts.push(place(box(0.08, 0.08, b.len), side * b.width / 2, 0.9, 0));
  }
  const geo = mergeGeometries(parts);
  geo.rotateY(b.yaw);
  geo.translate(b.x, b.deckY, b.z);
  return new THREE.Mesh(geo, woodMat);
}

/* ------------------------------------------------- summit bench and lookout */

function buildBench(woodMat) {
  const be = LAYOUT.bench;
  const g = groundHeight(be.x, be.z);
  const parts = [
    place(box(1.6, 0.07, 0.45), 0, 0.46, 0),
    place(box(1.6, 0.4, 0.06), 0, 0.75, -0.24),
    place(box(0.08, 0.46, 0.4), -0.68, 0.23, 0),
    place(box(0.08, 0.46, 0.4), 0.68, 0.23, 0),
  ];
  const geo = mergeGeometries(parts);
  geo.rotateY(be.yaw);
  geo.translate(be.x, g, be.z);
  return new THREE.Mesh(geo, woodMat);
}

function buildTower(woodMat) {
  const tw = LAYOUT.tower;
  const g = groundHeight(tw.x, tw.z);
  const parts = [];
  const H = 9;                       // legs
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.CylinderGeometry(0.09, 0.13, H, 5);
    // splayed: base 2.4 out, head 1.3 out
    const dx = sx * 1.85, dz = sz * 1.85;
    leg.rotateZ(-sx * 0.12);
    leg.rotateX(sz * 0.12);
    place(leg, dx * 0.75, H / 2, dz * 0.75);
    parts.push(leg);
  }
  for (let lvl = 1; lvl <= 3; lvl++) {           // cross braces
    const y = lvl * 2.4;
    const spread = 1.85 * (1 - (y / H) * 0.45) * 1.5;
    parts.push(place(box(spread * 2, 0.09, 0.09), 0, y, -spread * 0.62));
    parts.push(place(box(spread * 2, 0.09, 0.09), 0, y, spread * 0.62));
    parts.push(place(box(0.09, 0.09, spread * 1.24), -spread * 0.95, y, 0));
    parts.push(place(box(0.09, 0.09, spread * 1.24), spread * 0.95, y, 0));
  }
  parts.push(place(box(3.4, 0.16, 3.4), 0, H, 0));            // platform
  parts.push(place(box(2.6, 1.7, 2.6), 0, H + 0.95, 0));      // cab
  const roof = new THREE.ConeGeometry(2.25, 1.1, 4);
  roof.rotateY(Math.PI / 4);
  parts.push(place(roof, 0, H + 2.35, 0));
  for (const side of [-1, 1]) {                                // platform rail
    parts.push(place(box(3.4, 0.06, 0.06), 0, H + 0.6, side * 1.7));
    parts.push(place(box(0.06, 0.06, 3.4), side * 1.7, H + 0.6, 0));
  }
  const geo = mergeGeometries(parts);
  geo.rotateY(tw.yaw);
  geo.translate(tw.x, g, tw.z);
  const body = new THREE.Mesh(geo, woodMat);

  // The cab's window band — a fire lookout is mostly glass, and this one has
  // been a black box for four sessions. Dark panes, no light behind them.
  // What the glass is FOR is the steam (atmosphere.js): a wisp rising at the
  // pane on the bench side. The cab is warm and nobody says so.
  const winParts = [];
  for (let s = 0; s < 4; s++) {
    const pane = new THREE.PlaneGeometry(2.2, 0.62);
    pane.rotateY(s * Math.PI / 2);
    const off = 1.301;
    pane.translate(
      s === 1 ? off : s === 3 ? -off : 0,
      H + 1.12,
      s === 0 ? off : s === 2 ? -off : 0);
    winParts.push(pane);
  }
  const winGeo = mergeGeometries(winParts);
  winGeo.rotateY(tw.yaw);
  winGeo.translate(tw.x, g, tw.z);
  const win = new THREE.Mesh(winGeo, new THREE.MeshBasicMaterial({
    color: 0x11181f, fog: true,
  }));
  return { body, win };
}

/* -------------------------------------------------------------------- cabin */

function buildCabin(woodMat) {
  const cb = LAYOUT.cabin;
  const g = groundHeight(cb.x, cb.z);
  const parts = [
    place(box(4.2, 2.4, 3.2), 0, 1.2, 0),
    place(box(0.9, 1.8, 0.12), 1.1, 0.9, 1.62),      // door on the trail side
  ];
  const gable = new THREE.CylinderGeometry(1.9, 1.9, 4.6, 3, 1);
  gable.rotateZ(Math.PI / 2);
  gable.rotateX(Math.PI);
  place(gable, 0, 2.75, 0);
  parts.push(gable);
  const geo = mergeGeometries(parts);
  geo.rotateY(cb.yaw);
  geo.translate(cb.x, g, cb.z);
  const body = new THREE.Mesh(geo, woodMat);

  // The one warm note in the piece. Brighter when the fog is thick — a lit
  // window forty metres off in heavy murk is the oldest promise in the woods,
  // and whether it's a comfort or a lure is left to the walker.
  const winMat = new THREE.MeshBasicMaterial({ color: 0x8a6a30, fog: true });
  const winGeo = new THREE.PlaneGeometry(0.7, 0.6);
  winGeo.translate(-0.9, 1.35, 1.61);   // front face, other side from the door
  winGeo.rotateY(cb.yaw);
  winGeo.translate(cb.x, g, cb.z);
  const win = new THREE.Mesh(winGeo, winMat);
  return { body, win, winMat };
}

/* --------------------------------------------------------------- bootprints */

function bootprintTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 64);
  ctx.fillStyle = '#000';
  // sole: heel pad, waist, forefoot — toe toward +v (the quad's +z end)
  ctx.beginPath(); ctx.ellipse(16, 50, 8, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(16, 22, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(8, 30, 16, 14);
  // tread bars, the way a print actually reads in dirt
  ctx.globalCompositeOperation = 'destination-out';
  for (let y = 10; y < 60; y += 7) ctx.fillRect(6, y, 20, 2.6);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function buildBootprints() {
  const parts = [];
  for (const bp of LAYOUT.bootprints) {
    const quad = new THREE.PlaneGeometry(0.11, 0.3);
    quad.rotateX(-Math.PI / 2);
    // texture toe is at +z before this yaw, so the prints point uphill
    place(quad, bp.x, groundHeight(bp.x, bp.z) + 0.02, bp.z, bp.yaw);
    parts.push(quad);
  }
  const mat = new THREE.MeshBasicMaterial({
    map: bootprintTexture(), color: 0x131a1e,
    transparent: true, opacity: 0, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  return { mesh: new THREE.Mesh(mergeGeometries(parts), mat), mat };
}

/* --------------------------------------------------------------- dead radio */

// A field set on the cabin porch rail, aerial up, dial dark. It implies the
// unanswered half of every radio check in the logbook without adding a verb —
// nothing here can be switched on, which is not the same as it being off.
function buildRadio() {
  const cb = LAYOUT.cabin;
  const g = groundHeight(cb.x, cb.z);
  const parts = [
    place(box(0.34, 0.22, 0.14), -1.7, 1.02, 1.55),   // the set, by the window
    place(box(0.36, 0.05, 0.18), -1.7, 0.88, 1.55),   // its shelf
    place(box(0.012, 0.85, 0.012), -1.83, 1.5, 1.5),  // whip antenna
  ];
  const geo = mergeGeometries(parts);
  geo.rotateY(cb.yaw);
  geo.translate(cb.x, g, cb.z);
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x3c443e }));
}

/* ----------------------------------------------------------------- headlamp */

// A headlamp on the cabin step, lens dark, strap coiled — set down by a hand
// on its way in, still where it was left. The one findable thing on the
// mountain that does something. main.js hides this mesh when the walker picks
// it up; nothing else about the world changes, which is rather the point.
function buildHeadlamp() {
  const h = LAYOUT.headlamp;
  const g = groundHeight(h.x, h.z);
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    place(box(0.09, 0.06, 0.06), h.x, g + 0.05, h.z, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x3a4046 }));
  const strap = new THREE.Mesh(
    place(box(0.16, 0.015, 0.1), h.x - 0.02, g + 0.02, h.z + 0.06, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x55504a }));
  // The lens, unlit but pale enough to catch the eye from the trail side.
  const lensGeo = new THREE.CircleGeometry(0.026, 10);
  lensGeo.rotateY(0.7 + Math.PI / 2);
  lensGeo.translate(h.x + 0.036, g + 0.05, h.z - 0.032);
  const lens = new THREE.Mesh(lensGeo,
    new THREE.MeshBasicMaterial({ color: 0xcfc9ae, fog: true }));

  group.add(body, strap, lens);
  return group;
}

/* ---------------------------------------------------------------- mushrooms */

function buildMushrooms() {
  const stems = [], caps = [], glows = [];
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.035, 0.12, 5);
  stemGeo.translate(0, 0.06, 0);
  const capGeo = new THREE.SphereGeometry(0.06, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
  capGeo.translate(0, 0.1, 0);

  for (const m of LAYOUT.mushrooms) {
    const rnd = (i => () => {                        // tiny local PRNG off the seed
      i = (i * 1103515245 + 12345) & 0x7fffffff;
      return i / 0x7fffffff;
    })(m.seed + 7);
    for (let i = 0; i < m.count; i++) {
      const x = m.x + (rnd() - 0.5) * 1.3;
      const z = m.z + (rnd() - 0.5) * 1.3;
      const s = 0.6 + rnd() * 1.3;
      const entry = { x, y: groundHeight(x, z) - 0.01, z, s };
      stems.push(entry);
      (m.glow ? glows : caps).push(entry);
    }
  }

  const mk = (list, geo, mat) => {
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    list.forEach((e, i) => {
      pos.set(e.x, e.y, e.z);
      scl.setScalar(e.s);
      inst.setMatrixAt(i, m4.compose(pos, q, scl));
    });
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  };

  const out = [
    mk(stems, stemGeo, new THREE.MeshLambertMaterial({ color: 0xb0a894 })),
  ];
  if (caps.length) out.push(mk(caps, capGeo.clone(),
    new THREE.MeshLambertMaterial({ color: 0x6e4a38 })));
  if (glows.length) out.push(mk(glows, capGeo.clone(),
    new THREE.MeshLambertMaterial({ color: 0x9aa88a, emissive: 0x2a3a26 })));
  return out;
}

/* -------------------------------------------------------------------- build */

export function buildProps(scene) {
  const group = new THREE.Group();

  const wood = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
  const darkWood = new THREE.MeshLambertMaterial({ color: 0x3a332c });
  const stone = new THREE.MeshLambertMaterial({ color: 0x565a5e });

  for (const mesh of buildMarkers(wood)) group.add(mesh);
  group.add(buildCairns(stone));
  group.add(buildBridge(wood));
  group.add(buildBench(wood));
  const tower = buildTower(darkWood);
  group.add(tower.body, tower.win);
  const cabin = buildCabin(darkWood);
  group.add(cabin.body, cabin.win);
  group.add(buildRadio());
  const lamp = buildHeadlamp();
  group.add(lamp);
  const prints = buildBootprints();
  group.add(prints.mesh);
  for (const inst of buildMushrooms()) group.add(inst);

  scene.add(group);

  const warm = new THREE.Color(0x8a6a30), bright = new THREE.Color(0xd9a545);
  return {
    update(dt, fogT) {
      cabin.winMat.color.copy(warm).lerp(bright, fogT);
      // The prints only surface once the fog is thick enough to half-take
      // them back — same bargain every visual dread beat strikes. In clear
      // air the last switchback is just dirt; whether it was just dirt ten
      // minutes ago is not a question the mountain answers.
      prints.mat.opacity = Math.min(1, Math.max(0, (fogT - 0.35) / 0.3)) * 0.55;
    },
    bootprintOpacity: () => prints.mat.opacity,
    // main.js calls this once, when the walker picks the lamp up off the step.
    takeHeadlamp: () => { lamp.visible = false; },
  };
}
