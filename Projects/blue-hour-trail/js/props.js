import * as THREE from 'three';
import { groundHeight, LAYOUT } from './field.js';
import { REF, pieceGroup, instances, byVariant } from './pieces.js';

// Everything built by hands — real or imagined — standing on the mountain:
// trail markers, the cairns, the footbridge, the summit bench, the fire
// lookout, the cabin, and the mushrooms underfoot. Where each one sits is in
// field.js; this file only turns those numbers into meshes.
//
// What it stands there is the trail prop pack (pieces.js, B6), each piece in
// its builder's own frame, so every placement below is the arithmetic the
// builders did for their primitives. The bootprints are the one thing still
// drawn here: they are a texture, not a model (B5).

const place = (obj, x, y, z, yaw = 0) => { obj.rotation.y = yaw; obj.position.set(x, y, z); return obj; };
const named = (name, ...objs) => { const g = new THREE.Group(); g.name = name; g.add(...objs); return g; };

// Golden Hour's local merge helper, kept for the bootprints' quads.
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

const placeGeo = (geo, x, y, z, yaw = 0) => { if (yaw) geo.rotateY(yaw); geo.translate(x, y, z); return geo; };

/* ------------------------------------------------------------------ markers */

// Posts with a pale blaze board, unlit on both faces — a marker that vanishes
// into the murk marks nothing. Two weatherings of the one post (#684), taken
// in turn up the trail, since a marker has no seed.
function buildMarkers(pieces) {
  const posts = LAYOUT.markers.map((mk, i) =>
    ({ x: mk.x, y: groundHeight(mk.x, mk.z), z: mk.z, ry: mk.yaw, v: i % 2 }));
  return named('markers', ...byVariant(pieces, ['marker-1', 'marker-2'], posts));
}

/* ------------------------------------------------------------------- cairns */

// Each stone is a variant by its place in its cairn, since the three variants
// are LAYOUT.cairns[0]'s first three stones (#684), scaled by its own r over
// the variant's. The stack's arithmetic is the builder's.
const STONES = ['cairn-stone-1', 'cairn-stone-2', 'cairn-stone-3'];
function buildCairns(pieces) {
  const stones = [];
  LAYOUT.cairns.forEach((c, ci) => {
    const g = groundHeight(c.x, c.z);
    let y = g - 0.05;
    for (let s = 0; s < c.stones; s++) {
      const t = s / c.stones;
      const r = 0.34 * (1 - t * 0.55) + 0.04 * Math.sin(ci * 3.1 + s * 7.7);
      const v = s % 3;
      y += r * 0.52;
      stones.push({
        x: c.x + Math.sin(s * 2.6 + ci) * 0.05, y, z: c.z + Math.cos(s * 1.9) * 0.05,
        s: r / REF[STONES[v]].r, v,
      });
      y += r * 0.42;
    }
  });
  return named('cairns', ...byVariant(pieces, STONES, stones));
}

/* ------------------------------------------------------------------- bridge */

// Built along local +Z (the walking direction), its origin mid-span on the
// deck, then turned by the bridge's yaw.
function buildBridge(pieces) {
  const b = LAYOUT.bridge;
  const g = place(pieceGroup(pieces, 'bridge'), b.x, b.deckY, b.z, b.yaw);
  g.scale.set(b.width / REF.bridge.width, 1, b.len / REF.bridge.len);
  return g;
}

/* ------------------------------------------------- summit bench and lookout */

function buildBench(pieces) {
  const be = LAYOUT.bench;
  return place(pieceGroup(pieces, 'bench'), be.x, groundHeight(be.x, be.z), be.z, be.yaw);
}

// The cab's window band (`panes`): a fire lookout is mostly glass. Dark
// panes, no light behind them. What the glass is FOR is the steam
// (atmosphere.js): a wisp rising at the pane on the bench side. The cab is
// warm and nobody says so.
function buildTower(pieces) {
  const tw = LAYOUT.tower;
  return place(pieceGroup(pieces, 'tower'), tw.x, groundHeight(tw.x, tw.z), tw.z, tw.yaw);
}

/* -------------------------------------------------------------------- cabin */

// The lit `window` is the one warm note in the piece. Brighter when the fog is
// thick — a lit window forty metres off in heavy murk is the oldest promise in
// the woods, and whether it's a comfort or a lure is left to the walker. Its
// material is the file's own, unlit, and update() lerps it.
function buildCabin(pieces) {
  const cb = LAYOUT.cabin;
  const group = place(pieceGroup(pieces, 'cabin'), cb.x, groundHeight(cb.x, cb.z), cb.z, cb.yaw);
  const win = group.children.find(m => m.name === 'window');
  if (!win) throw new Error('Blue Hour: the cabin piece has no window');
  return { group, winMat: win.material };
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
    placeGeo(quad, bp.x, groundHeight(bp.x, bp.z) + 0.02, bp.z, bp.yaw);
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
// nothing here can be switched on, which is not the same as it being off. Its
// piece is in the cabin's frame, so it stands where the cabin stands.
function buildRadio(pieces) {
  const cb = LAYOUT.cabin;
  return place(pieceGroup(pieces, 'radio'), cb.x, groundHeight(cb.x, cb.z), cb.z, cb.yaw);
}

/* ----------------------------------------------------------------- headlamp */

// A headlamp on the cabin step, lens dark, strap coiled — set down by a hand
// on its way in, still where it was left. The one findable thing on the
// mountain that does something. main.js hides this group when the walker picks
// it up; nothing else about the world changes, which is rather the point.
function buildHeadlamp(pieces) {
  const h = LAYOUT.headlamp;
  return place(pieceGroup(pieces, 'headlamp'), h.x, groundHeight(h.x, h.z), h.z);
}

/* ---------------------------------------------------------------- mushrooms */

// Still instanced, one InstancedMesh per material per file: the plain ones
// are `mushroom`, the glowing clusters `mushroom-glow`, whose cap carries the
// emissive (#684).
function buildMushrooms(pieces) {
  const plain = [], glows = [];
  for (const m of LAYOUT.mushrooms) {
    const rnd = (i => () => {                        // tiny local PRNG off the seed
      i = (i * 1103515245 + 12345) & 0x7fffffff;
      return i / 0x7fffffff;
    })(m.seed + 7);
    for (let i = 0; i < m.count; i++) {
      const x = m.x + (rnd() - 0.5) * 1.3;
      const z = m.z + (rnd() - 0.5) * 1.3;
      const s = 0.6 + rnd() * 1.3;
      (m.glow ? glows : plain).push({ x, y: groundHeight(x, z) - 0.01, z, s });
    }
  }
  const out = [];
  if (plain.length) out.push(...instances(pieces, 'mushroom', plain));
  if (glows.length) out.push(...instances(pieces, 'mushroom-glow', glows));
  return named('mushrooms', ...out);
}

/* -------------------------------------------------------------------- build */

// `pieces` is loadPieces()'s, awaited before this runs.
export function buildProps(scene, pieces) {
  const group = new THREE.Group();
  group.name = 'props';

  group.add(buildMarkers(pieces));
  group.add(buildCairns(pieces));
  group.add(buildBridge(pieces));
  group.add(buildBench(pieces));
  group.add(buildTower(pieces));
  const cabin = buildCabin(pieces);
  group.add(cabin.group);
  group.add(buildRadio(pieces));
  const lamp = buildHeadlamp(pieces);
  group.add(lamp);
  const prints = buildBootprints();
  prints.mesh.name = 'bootprints';
  group.add(prints.mesh);
  group.add(buildMushrooms(pieces));

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
