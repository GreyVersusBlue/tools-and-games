// carry.js — hands for the walkthrough: pick a prop up, carry it, set it down.
//
// Phase 22. All placement was edit-mode-only through propedit.js, but the pure
// half of placement — propplace.js's picking and three snap tiers — never knew
// what mode it was in. This module is the walk's own thin layer over the same
// math: where the view is pointing instead of where the mouse is, a carry slot
// instead of a selection, and one new question the editor never had to ask —
// *does it fit where you are trying to put it?* The editor's overhead view
// shows an overlap before the click; a first-person set-down cannot, so the
// answer has to be computed, and it is computed as overlap only. Consequence
// is deliberately not checked: barricading a corridor with lockers is a legal
// placement, the fire drill is the tool that tells you what it did, and
// step-up and shove are the ways back out.
//
// Pure module: no three.js, no DOM. The camera, the keys and the ghost overlay
// live in main.js, the same split propplace.js has with propedit.js. Exercised
// by test/carry.test.mjs.

import { footprintOf, pickPropAt, snapProp } from './propplace.js';
import { candidates, doorSegments, boxOverlapsSeg, boxesOverlap } from './collide.js';

// How far ahead a hand reaches, for picking up and for setting down. A shade
// over two lattice cells: enough to grab the far side of a desk, short enough
// that furnishing stays a thing done from *inside* the room.
export const REACH_FT = 8;
// Where a carried prop rides: this far ahead of the eye, standing at its
// snapped target rather than floating — you see exactly what you will get.
export const CARRY_FT = 4;
// The pick ray is sampled rather than solved — propplace's pickPropAt is a
// point test, and a footstep-sized stride cannot walk through the thinnest
// prop in the catalog (a wall panel is 0.3ft deep, padded to 0.6 of window).
export const PICK_STEP = 0.5;

// The walk palette: the short ring of favourites placeable from inside, one
// per digit key — the pieces a walk actually reaches for, all floor-standing
// so every one of them can land anywhere the ghost fits. Since Phase 36 the
// digits are the quick ring rather than the whole reach: `searchCatalog`
// below is the road to everything else. catalog.test.mjs-style guarantees
// live in test/carry.test.mjs: every type exists and every one is floor-mount.
export const WALK_PALETTE = [
  'student-chair', 'student-desk', 'table-round-4', 'bookshelf-low',
  'plant-floor', 'trash-can', 'sofa', 'floor-lamp',
];

// Find rows in the catalog by name — the pure half of the walk-mode picker
// (Phase 36 renegotiates Phase 22's "the full catalog stays an edit-mode
// affordance": the *palette UI* stays there, but what your hands may hold no
// longer does). Name-prefix beats name-substring beats a category or type hit,
// ties keep catalog order, and an empty query returns the head of the list so
// a picker opens populated instead of blank. The caller decides which rows to
// offer — usually PROP_CATALOG plus the design's registered model rows.
export function searchCatalog(rows, query, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows.slice(0, Math.max(0, limit));
  const ranked = [];
  rows.forEach((r, i) => {
    const name = String(r.name || '').toLowerCase();
    let rank;
    if (name.startsWith(q)) rank = 0;
    else if (name.includes(q)) rank = 1;
    else if (String(r.category || '').toLowerCase().includes(q) ||
             String(r.type || '').toLowerCase().includes(q)) rank = 2;
    else return;
    ranked.push({ r, rank, i });
  });
  ranked.sort((x, y) => x.rank - y.rank || x.i - y.i);
  return ranked.slice(0, Math.max(0, limit)).map((x) => x.r);
}

// The prop the view is pointing at, within reach — the first hit walking the
// flattened view ray out from the eye. `dir` need not be normalised (it is
// usually a camera's world direction with the y dropped), and a straight-down
// stare degenerates to "whatever you are standing on", which is the honest
// reading of it.
export function pickAhead(props, floorIndex, catalogGet, eye, dir, opts = {}) {
  const reach = opts.reach ?? REACH_FT;
  const step = opts.step ?? PICK_STEP;
  const mag = Math.hypot(dir.x, dir.z);
  const ux = mag > 1e-9 ? dir.x / mag : 0;
  const uz = mag > 1e-9 ? dir.z / mag : 0;
  for (let d = 0; d <= reach; d += step) {
    const hit = pickPropAt(props, floorIndex, catalogGet, eye.x + ux * d, eye.z + uz * d);
    if (hit) return hit;
  }
  return null;
}

// Where a carried prop wants to stand: CARRY_FT ahead of the eye, in plan.
export function carryPoint(eye, dir, dist = CARRY_FT) {
  const mag = Math.hypot(dir.x, dir.z);
  if (mag < 1e-9) return { x: eye.x, z: eye.z + dist };
  return { x: eye.x + (dir.x / mag) * dist, z: eye.z + (dir.z / mag) * dist };
}

// Can this footprint stand here without overlapping anything? Walls, door
// leaves at their live angle, and the other blocking props — the same three
// families the walker's own body resolves against, tested as the rotated box
// the footprint actually is (collide.js's Phase 22 helpers). The box is shrunk
// by a whisker so a snap that lands exactly flush — against a wall face, or
// against the neighbour a row-snap lined it up with — reads as fitting.
//
// Overlap only. Not reachability, not egress, not the corridor you just
// blocked: consequence belongs to the reports, not to the hand.
export function placementClear(collider, entry, prop, x, z, rotationY, opts = {}) {
  const { hw, hd } = footprintOf(entry, prop);
  const eps = opts.eps ?? 0.02;
  const box = {
    x, z, rotationY,
    hw: Math.max(0.01, hw - eps),
    hd: Math.max(0.01, hd - eps),
  };
  const r = Math.hypot(box.hw, box.hd);
  const near = candidates(collider, x - r, z - r, x + r, z + r);
  for (const s of near.segs) if (boxOverlapsSeg(box, s)) return false;
  for (const s of doorSegments(collider)) if (boxOverlapsSeg(box, s)) return false;
  for (const o of near.props) {
    if (opts.excludeId !== undefined && o.id === opts.excludeId) continue;
    if (boxesOverlap(box, o)) return false;
  }
  return true;
}

// The set-down, whole: snap exactly the way the editor does — wall, then a
// neighbouring prop, then the furniture lattice, then free — then refuse only
// overlap. Returns propplace's snap result with `clear` beside it; the caller
// commits it to the design only when `clear` is true.
//
// Mount decides what "fits" means. A floor prop is a footprint on the floor. A
// wall prop *is* its wall: no wall within snapping reach means nowhere to
// hang, so the snap kind is the clearance test. A ceiling prop hangs above
// every body in the building and is always clear.
export function setDown(floor, collider, props, floorIndex, entry, prop, x, z, rotationY, opts = {}) {
  const snapped = snapProp(floor, props, floorIndex, entry, prop, x, z, rotationY, opts);
  let clear = true;
  if (entry.mount === 'wall') clear = snapped.kind === 'wall';
  else if (entry.mount === 'floor') {
    clear = placementClear(collider, entry, prop,
      snapped.x, snapped.z, snapped.rotationY, opts);
  }
  return { ...snapped, clear };
}
