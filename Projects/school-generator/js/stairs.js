// stairs.js — stairs, floor openings, and the geometry both imply.
//
// A stair is not a prop. A prop sits *on* a floor and the building doesn't
// care; a stair connects two of them and takes a bite out of the one above,
// which is why it lives in `state.links[]` (the inter-floor table Phase 1
// defined and left empty) rather than in `state.props[]`.
//
//   { id, type: 'stair' | 'opening', from, to, x, z, rotationY, data }
//
// `from` is the storey the stair starts on and `to` the one it arrives at —
// always `from + 1`, because a run that skips a level isn't a stair, it's two.
// A plain `opening` is the same record without the treads: a hole in `to`
// looking down into `from`, which is what makes a mezzanine a mezzanine.
//
// Local frame, shared with props (see propplace.js's rotation note): a stair
// climbs toward its local +Z, centred on local x, with local (0, 0) at the
// bottom of the run — so `rotationY` is "the way you face walking up".
//
// Pure module: no three.js. The tool that places one is stairedit.js, the
// geometry that draws it is render.js, and both read everything from here so
// the footprint the cursor snaps to is the footprint that gets built.

import { FLOOR_H, RAIL_H, CELL, getCell } from './grid.js';
import { pointInRing, shapeAt } from './shapes.js';
import { addLink, MAX_LINKS } from './props.js';

// Tread and riser: 7in up, 11in forward is the standard school run, and at a
// 12ft floor-to-floor that lands on 21 risers over about 19ft of floor.
export const RISER_TARGET = 7 / 12;   // ft
export const TREAD = 11 / 12;         // ft
export const MIN_STEPS = 3;

export const STAIR_W = 4;             // ft, a two-person run
export const MIN_STAIR_W = 3;
export const MAX_STAIR_W = 12;

// How far past the top step the opening runs, so you arrive somewhere rather
// than onto the lip of the hole you just climbed through.
export const LANDING = 4;             // ft
// Clear height a tread needs under the floor above. Where the run gets closer
// to the ceiling than this, the floor above has to be open — which is what
// decides where the cut starts rather than a number someone picked.
export const HEADROOM = 6.8;          // ft
export const CUT_MARGIN = 0.25;       // ft of slack each side of the run

export const OPENING_W = 8;           // ft, default plain floor opening
export const OPENING_D = 8;
export const MIN_OPENING = 3;
export const MAX_OPENING = 120;

export const STAIR_TYPES = ['stair', 'opening'];
export { RAIL_H };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- run geometry ----------

// The one calculation everything else is downstream of: how many risers fit in
// a storey, and therefore how much floor the run eats.
export function stairRun(floorHt = FLOOR_H) {
  const h = floorHt > 0 ? floorHt : FLOOR_H;
  const steps = Math.max(MIN_STEPS, Math.round(h / RISER_TARGET));
  return { steps, riser: h / steps, tread: TREAD, run: steps * TREAD, rise: h };
}

export const stairMetrics = (state) => stairRun(state && state.floorHt);

export const stairWidth = (link) =>
  clamp(Number.isFinite(link && link.data && link.data.width) ? link.data.width : STAIR_W,
    MIN_STAIR_W, MAX_STAIR_W);

// A plain opening carries its own size; a stair's comes off the run.
export const openingSize = (link) => ({
  w: clamp(Number.isFinite(link && link.data && link.data.w) ? link.data.w : OPENING_W,
    MIN_OPENING, MAX_OPENING),
  d: clamp(Number.isFinite(link && link.data && link.data.d) ? link.data.d : OPENING_D,
    MIN_OPENING, MAX_OPENING),
});

// Where the run stops clearing the floor above. Below this the stair is under
// solid ceiling; above it, the floor has to be open or you'd walk into it.
export function cutStart(metrics) {
  const t = 1 - HEADROOM / metrics.rise;
  return clamp(t, 0, 0.95) * metrics.run;
}

// ---------- local <-> world ----------
//
// Same convention as props: local +Z rotated by `rotationY`. Kept here rather
// than imported from propplace.js so a stair doesn't depend on the prop layer.

export function localToWorld(link, lx, lz) {
  const c = Math.cos(link.rotationY || 0), s = Math.sin(link.rotationY || 0);
  return { x: link.x + lx * c + lz * s, z: link.z - lx * s + lz * c };
}

export function worldToLocal(link, x, z) {
  const c = Math.cos(link.rotationY || 0), s = Math.sin(link.rotationY || 0);
  const dx = x - link.x, dz = z - link.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

// The rect a stair (or opening) stands on, as a local-space box. World corners
// come from `rectCorners`; keeping the box local means the footprint, the cut
// and the railings are all one description rotated three times.
export function footprintBox(link, metrics) {
  if (link.type === 'opening') {
    const { w, d } = openingSize(link);
    return { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 };
  }
  const hw = stairWidth(link) / 2;
  return { x0: -hw, x1: hw, z0: 0, z1: metrics.run };
}

// The hole this link opens in the floor above.
export function cutBox(link, metrics) {
  if (link.type === 'opening') return footprintBox(link, metrics);
  const hw = stairWidth(link) / 2 + CUT_MARGIN;
  return { x0: -hw, x1: hw, z0: cutStart(metrics), z1: metrics.run + LANDING };
}

// Local box -> world polygon, wound the same way whichever way it's turned.
export function rectCorners(link, box) {
  const pts = [
    localToWorld(link, box.x0, box.z0),
    localToWorld(link, box.x1, box.z0),
    localToWorld(link, box.x1, box.z1),
    localToWorld(link, box.x0, box.z1),
  ];
  // Rotation is rigid, so winding is fixed by construction; normalize anyway so
  // callers that triangulate (the floor slab's hole) never get a flipped ring.
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  }
  return a > 0 ? pts : pts.reverse();
}

export const footprintPolygon = (link, metrics) => rectCorners(link, footprintBox(link, metrics));
export const cutPolygon = (link, metrics) => rectCorners(link, cutBox(link, metrics));

export const pointInPolygon = (pts, x, z) => pointInRing(pts, x, z);

// ---------- what a floor sees ----------

export const stairsOf = (state) =>
  (state.links || []).filter((l) => STAIR_TYPES.includes(l.type));

// Links that start on this storey — the ones drawn with it and pickable while
// editing it. A stair belongs to the floor it climbs *from*; the floor above
// only has its hole.
export const linksFrom = (state, floorIndex) =>
  stairsOf(state).filter((l) => l.from === floorIndex);

// The holes cut in this storey's slab, as world polygons. Both the floor slab
// and the ceiling below it use these, so a stair opens one continuous void
// rather than a hole in one plane and not the other.
export function floorCuts(state, floorIndex) {
  const metrics = stairMetrics(state);
  return stairsOf(state)
    .filter((l) => l.to === floorIndex)
    .map((l) => cutPolygon(l, metrics));
}

// Is (x, z) inside a hole in this storey's floor? Grid cells and polygon slabs
// both ask this before drawing themselves.
export function inFloorCut(cuts, x, z) {
  for (const c of cuts) if (pointInPolygon(c, x, z)) return true;
  return false;
}

// A cell is cut if any of it is missing — testing the centre alone leaves half
// a cell hanging over the void, which reads as a mistake from below.
export function cellCut(cuts, gx, gy, cell = CELL) {
  if (!cuts.length) return false;
  const x0 = gx * cell, z0 = gy * cell;
  const pad = cell * 0.28;
  for (const [x, z] of [
    [x0 + cell / 2, z0 + cell / 2],
    [x0 + pad, z0 + pad], [x0 + cell - pad, z0 + pad],
    [x0 + pad, z0 + cell - pad], [x0 + cell - pad, z0 + cell - pad],
  ]) {
    if (inFloorCut(cuts, x, z)) return true;
  }
  return false;
}

// ---------- guardrails around an opening ----------
//
// A hole in a floor needs a rail around it, minus the side you arrive from —
// which for a stair is the far end of the landing, where you step off onto the
// floor proper. Returned as world segments so render.js draws them with the
// same builder a hand-drawn SEG_RAIL uses.

// How far outside a rail to look for floor. Under one cell, so a rail sitting
// on the very edge of a slab still finds it.
const RAIL_PROBE = 1.5;   // ft

// Is there anything to stand on at (x, z) on this storey? Either half of the
// room model counts — a polygon room is as much floor as a grid cell is.
export function floorSolidAt(floor, x, z) {
  if (!floor) return false;
  if (getCell(floor, Math.floor(x / CELL), Math.floor(z / CELL))) return true;
  return !!shapeAt(floor, x, z);
}

// Pass the storey the hole is in and each side is kept only if someone could
// walk up to it: a rail along an edge with no floor behind it is a fence in
// mid-air, which is what an opening running off the side of a partial upper
// floor would otherwise leave you with. Omit `floor` for every side.
export function openingRails(link, metrics, floor = null) {
  const box = cutBox(link, metrics);
  const corner = (lx, lz) => localToWorld(link, lx, lz);
  const sides = [
    { a: corner(box.x0, box.z0), b: corner(box.x1, box.z0), side: 'near',
      at: [(box.x0 + box.x1) / 2, box.z0], out: [0, -1] },
    { a: corner(box.x1, box.z0), b: corner(box.x1, box.z1), side: 'right',
      at: [box.x1, (box.z0 + box.z1) / 2], out: [1, 0] },
    { a: corner(box.x0, box.z0), b: corner(box.x0, box.z1), side: 'left',
      at: [box.x0, (box.z0 + box.z1) / 2], out: [-1, 0] },
    { a: corner(box.x0, box.z1), b: corner(box.x1, box.z1), side: 'far',
      at: [(box.x0 + box.x1) / 2, box.z1], out: [0, 1] },
  ];
  // The far edge of a stair's cut is the landing you walk out onto; railing it
  // would fence the stair off from the floor it serves.
  const wanted = link.type === 'stair' ? sides.filter((s) => s.side !== 'far') : sides;
  if (!floor) return wanted;
  return wanted.filter((s) => {
    const p = localToWorld(link, s.at[0] + s.out[0] * RAIL_PROBE, s.at[1] + s.out[1] * RAIL_PROBE);
    return floorSolidAt(floor, p.x, p.z);
  });
}

// ---------- walking on one ----------

// Height of the stair surface above its *lower* floor's slab at (x, z), or
// null if the point isn't on the run. A continuous ramp rather than the
// discrete treads the geometry draws: a first-person camera stepping up in
// 7in jumps reads as a stutter, and nobody sees their own feet.
export function stairSurfaceAt(link, metrics, x, z) {
  if (link.type !== 'stair') return null;
  const { lx, lz } = worldToLocal(link, x, z);
  const hw = stairWidth(link) / 2;
  if (Math.abs(lx) > hw || lz < -CUT_MARGIN || lz > metrics.run + LANDING) return null;
  if (lz > metrics.run) return metrics.rise;   // the landing at the top
  return clamp(lz / metrics.run, 0, 1) * metrics.rise;
}

// The stair under a point, with the world Y of its surface — what walkthrough
// needs to ride one up. `atY` picks between two stairs stacked on the same
// footprint (a stairwell), by preferring the run nearest the camera.
export function stairUnder(state, x, z, atY = null) {
  const metrics = stairMetrics(state);
  const ht = state.floorHt || FLOOR_H;
  let best = null;
  for (const link of stairsOf(state)) {
    const h = stairSurfaceAt(link, metrics, x, z);
    if (h === null) continue;
    const y = link.from * ht + h;
    const d = atY === null ? 0 : Math.abs(atY - y);
    if (!best || d < best.d) best = { link, y, d, height: h };
  }
  return best;
}

// ---------- picking & mutation ----------

// The link under a point on the storey being edited. Later links win, the same
// rule shapes and props follow, so one dropped on top of another is the one
// you select.
export function linkAt(state, floorIndex, x, z, pad = 0) {
  const metrics = stairMetrics(state);
  const list = linksFrom(state, floorIndex);
  for (let i = list.length - 1; i >= 0; i--) {
    const box = footprintBox(list[i], metrics);
    const { lx, lz } = worldToLocal(list[i], x, z);
    if (lx >= box.x0 - pad && lx <= box.x1 + pad && lz >= box.z0 - pad && lz <= box.z1 + pad) {
      return list[i];
    }
  }
  return null;
}

export const linkById = (state, id) => (state.links || []).find((l) => l.id === id) || null;

// Place a stair or an opening rising out of `floorIndex`. Returns the new link,
// or null with a reason — the tool turns that into a status line rather than
// guessing why nothing appeared.
export function addStair(state, floorIndex, opts = {}) {
  const type = STAIR_TYPES.includes(opts.type) ? opts.type : 'stair';
  const from = Math.floor(floorIndex);
  const to = from + 1;
  if (!state.floors[from]) return { link: null, reason: 'No such floor.' };
  if (!state.floors[to]) {
    return { link: null, reason: type === 'stair'
      ? 'A stair has to arrive somewhere — add a level above first.'
      : 'A floor opening looks up into the next level — add one above first.' };
  }
  if ((state.links || []).length >= MAX_LINKS) {
    return { link: null, reason: 'This design is at its limit for stairs and openings.' };
  }
  const data = type === 'stair'
    ? { width: clamp(opts.width || STAIR_W, MIN_STAIR_W, MAX_STAIR_W) }
    : {
      w: clamp(opts.w || OPENING_W, MIN_OPENING, MAX_OPENING),
      d: clamp(opts.d || OPENING_D, MIN_OPENING, MAX_OPENING),
    };
  const link = addLink(state, type, {
    from, to, x: opts.x || 0, z: opts.z || 0, rotationY: opts.rotationY || 0, data,
  });
  return link ? { link, reason: null } : { link: null, reason: 'Could not place that.' };
}

// A stair's ends have to stay inside the building it connects — not enforced
// (a design mid-edit is allowed to be wrong), but reported, so the tool can say
// so instead of leaving someone wondering why the top is out in the car park.
export function stairFits(state, link) {
  const metrics = stairMetrics(state);
  const pts = footprintPolygon(link, metrics);
  const wFt = state.w * CELL, hFt = state.h * CELL;
  return pts.every((p) => p.x >= -wFt && p.x <= wFt * 2 && p.z >= -hFt && p.z <= hFt * 2);
}
