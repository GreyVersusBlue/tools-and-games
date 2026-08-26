// stairs.js — stairs, floor openings, and the geometry both imply.
//
// A stair is not a prop. A prop sits *on* a floor and the building doesn't
// care; a stair connects two of them and takes a bite out of the one above,
// which is why it lives in `state.links[]` (the inter-floor table Phase 1
// defined and left empty) rather than in `state.props[]`.
//
//   { id, type, from, to, x, z, rotationY, data }
//
// `from` is the storey the stair starts on and `to` the one it arrives at —
// always `from + 1`, because a run that skips a level isn't a stair, it's two.
// A plain `opening` is the same record without the treads: a hole in `to`
// looking down into `from`, which is what makes a mezzanine a mezzanine.
//
// Phase 2 adds the two links an accessible route is made of, and they slot in
// beside the first two rather than beneath them:
//
//   ramp      a stair with no risers. Everything about it is the stair's own
//             machinery at a different pitch — a run, a headroom-derived cut,
//             guardrails, a linear walkable surface — so it shares all of it
//             and differs only in how long the run is: `slope` feet of run per
//             foot of rise, 12 for the ADA maximum of 1:12.
//   elevator  the one link whose walkable answer isn't a surface at all. The
//             car is a small room standing on both storeys, the shaft walls
//             bound it on three sides, and arriving is a teleport rather than
//             a climb. It is also the only link that cuts *nothing*: the slab
//             above stays whole, because you arrive on top of it rather than
//             through it.
//
// Local frame, shared with props (see propplace.js's rotation note): a stair
// climbs toward its local +Z, centred on local x, with local (0, 0) at the
// bottom of the run — so `rotationY` is "the way you face walking up".
//
// Pure module: no three.js. The tool that places one is stairedit.js, the
// geometry that draws it is render.js, and both read everything from here so
// the footprint the cursor snaps to is the footprint that gets built.

import { FLOOR_H, RAIL_H, CELL } from './grid.js';
import { pointInRing, floorSolidAt } from './shapes.js';
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

// Ramps. 1:12 is the ADA maximum and the default; the shallower options exist
// because a floor-to-floor ramp at 1:12 is 144ft of run, which is a real
// number a real building has to find room for and this tool should say out
// loud rather than quietly steepen.
export const RAMP_SLOPE = 12;              // ft of run per ft of rise
export const RAMP_SLOPES = [12, 10, 8, 6];
export const MIN_RAMP_SLOPE = 4;
export const MAX_RAMP_SLOPE = 20;
export const RAMP_W = 4;                   // ft — 3ft clear plus the rails
export const MIN_RAMP_W = 3;
export const MAX_RAMP_W = 12;

// Elevator car: a 3500lb school passenger car is about 6'8" x 5'5" clear.
// The shaft is the car plus its walls, which is what the footprint describes.
export const ELEV_W = 7;
export const ELEV_D = 5.5;
export const MIN_ELEV = 4;
export const MAX_ELEV = 20;
export const ELEV_DOOR_W = 3.5;            // ft — the clear opening you walk through
export const ELEV_WALL_T = 0.5;

export const LINK_KINDS = ['stair', 'opening', 'ramp', 'elevator'];
// The name the rest of the codebase learned this list by. Same array, and it
// still means "every kind of link", which is what every caller wanted.
export const STAIR_TYPES = LINK_KINDS;
// The links you climb: a run with a walkable surface between two storeys.
export const RUN_TYPES = ['stair', 'ramp'];
export const isRun = (l) => !!l && RUN_TYPES.includes(l.type);
export const isElevator = (l) => !!l && l.type === 'elevator';
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

// A run's width. Stairs and ramps carry it the same way (`data.width`) and
// only their limits differ, so one accessor serves both.
export const stairWidth = (link) => {
  const ramp = link && link.type === 'ramp';
  const dflt = ramp ? RAMP_W : STAIR_W;
  const lo = ramp ? MIN_RAMP_W : MIN_STAIR_W;
  const hi = ramp ? MAX_RAMP_W : MAX_STAIR_W;
  return clamp(Number.isFinite(link && link.data && link.data.width) ? link.data.width : dflt, lo, hi);
};

export const rampSlope = (link) =>
  clamp(Number.isFinite(link && link.data && link.data.slope) ? link.data.slope : RAMP_SLOPE,
    MIN_RAMP_SLOPE, MAX_RAMP_SLOPE);

// The car's clear size, the way `openingSize` reads a plain opening's.
export const elevatorSize = (link) => ({
  w: clamp(Number.isFinite(link && link.data && link.data.w) ? link.data.w : ELEV_W,
    MIN_ELEV, MAX_ELEV),
  d: clamp(Number.isFinite(link && link.data && link.data.d) ? link.data.d : ELEV_D,
    MIN_ELEV, MAX_ELEV),
});

// How much floor a link eats climbing one storey. A stair's run comes off the
// riser count; a ramp's comes off its slope; nothing else has one.
export function runLength(link, metrics) {
  if (!link) return 0;
  if (link.type === 'ramp') return metrics.rise * rampSlope(link);
  if (link.type === 'stair') return metrics.run;
  return 0;
}

// The per-link version of `stairMetrics`, which only knows about the building.
// Everything that draws or walks a run reads this rather than reaching for
// `metrics.run` directly, so a ramp is never accidentally 19ft long.
export function runMetrics(link, metrics) {
  const run = runLength(link, metrics);
  const ramp = link && link.type === 'ramp';
  return {
    rise: metrics.rise,
    run,
    steps: ramp ? 0 : metrics.steps,
    riser: ramp ? 0 : metrics.riser,
    tread: ramp ? 0 : metrics.tread,
    slope: ramp ? rampSlope(link) : metrics.run / metrics.rise,
    pitch: run > 0 ? Math.atan2(metrics.rise, run) : 0,
  };
}

// A plain opening carries its own size; a stair's comes off the run.
export const openingSize = (link) => ({
  w: clamp(Number.isFinite(link && link.data && link.data.w) ? link.data.w : OPENING_W,
    MIN_OPENING, MAX_OPENING),
  d: clamp(Number.isFinite(link && link.data && link.data.d) ? link.data.d : OPENING_D,
    MIN_OPENING, MAX_OPENING),
});

// Where the run stops clearing the floor above. Below this the stair is under
// solid ceiling; above it, the floor has to be open or you'd walk into it.
export function cutStart(metrics, run = metrics.run) {
  const t = 1 - HEADROOM / metrics.rise;
  return clamp(t, 0, 0.95) * run;
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
  if (link.type === 'elevator') {
    // The car is centred on the placement point and you enter from local -Z,
    // which makes `rotationY` mean the same thing it does for a stair: the way
    // you are facing as you step in.
    const { w, d } = elevatorSize(link);
    return { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 };
  }
  const hw = stairWidth(link) / 2;
  return { x0: -hw, x1: hw, z0: 0, z1: runLength(link, metrics) };
}

// The hole this link opens in the floor above, or null for one that opens
// none. An elevator is the only link with nothing to cut: its car stands on
// the slab at each end rather than passing through it, so the floor above is
// whole and you arrive standing on it.
export function cutBox(link, metrics) {
  if (link.type === 'elevator') return null;
  if (link.type === 'opening') return footprintBox(link, metrics);
  const hw = stairWidth(link) / 2 + CUT_MARGIN;
  const run = runLength(link, metrics);
  return { x0: -hw, x1: hw, z0: cutStart(metrics, run), z1: run + LANDING };
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
export const cutPolygon = (link, metrics) => {
  const box = cutBox(link, metrics);
  return box ? rectCorners(link, box) : null;
};

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
    .map((l) => cutPolygon(l, metrics))
    .filter(Boolean);
}

// Is (x, z) inside a hole in this storey's floor? Every room's slab asks this
// before drawing itself.
export function inFloorCut(cuts, x, z) {
  for (const c of cuts) if (pointInPolygon(c, x, z)) return true;
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

// `floorSolidAt` moved to shapes.js — the wall-thickness probe asks the same
// question — and is re-exported here so every caller that learned it from this
// module keeps working.
export { floorSolidAt };

// Pass the storey the hole is in and each side is kept only if someone could
// walk up to it: a rail along an edge with no floor behind it is a fence in
// mid-air, which is what an opening running off the side of a partial upper
// floor would otherwise leave you with. Omit `floor` for every side.
export function openingRails(link, metrics, floor = null) {
  const box = cutBox(link, metrics);
  if (!box) return [];   // an elevator opens no hole, so it needs no rail
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
  // The far edge of a run's cut is the landing you walk out onto; railing it
  // would fence the stair (or ramp) off from the floor it serves.
  const wanted = isRun(link) ? sides.filter((s) => s.side !== 'far') : sides;
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
  if (!isRun(link)) return null;
  const run = runLength(link, metrics);
  if (run <= 0) return null;
  const { lx, lz } = worldToLocal(link, x, z);
  const hw = stairWidth(link) / 2;
  if (Math.abs(lx) > hw || lz < -CUT_MARGIN || lz > run + LANDING) return null;
  if (lz > run) return metrics.rise;   // the landing at the top
  return clamp(lz / run, 0, 1) * metrics.rise;
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

// ---------- elevators ----------
//
// An elevator is the only link that puts walls up. A stair's boundaries are
// the guardrails around the hole it cut; an elevator cuts nothing, so the
// thing that stops you walking out of the car sideways has to be the shaft
// itself. These come back as world segments — the same shape `openingRails`
// hands back — so collide.js and render.js consume them the same way.

// The clear opening you step through, on the car's local -Z face.
export const elevatorDoorWidth = (link) =>
  Math.min(ELEV_DOOR_W, elevatorSize(link).w - 1);

// Three solid sides plus the two jambs either side of the door. Every segment
// is world-space {a, b}, wound so nothing depends on which way you read it.
export function elevatorWalls(link) {
  const { w, d } = elevatorSize(link);
  const hw = w / 2, hd = d / 2;
  const door = elevatorDoorWidth(link) / 2;
  const at = (lx, lz) => localToWorld(link, lx, lz);
  return [
    { a: at(-hw, -hd), b: at(-hw, hd), side: 'left' },
    { a: at(hw, -hd), b: at(hw, hd), side: 'right' },
    { a: at(-hw, hd), b: at(hw, hd), side: 'back' },
    { a: at(-hw, -hd), b: at(-door, -hd), side: 'jamb' },
    { a: at(door, -hd), b: at(hw, -hd), side: 'jamb' },
  ];
}

// The elevators standing on a storey — an elevator belongs to *both* its
// levels, unlike a stair, because the car is a room on each of them.
export const elevatorsOn = (state, floorIndex) =>
  (state.links || []).filter((l) => l.type === 'elevator' &&
    (l.from === floorIndex || l.to === floorIndex));

// Are you inside a car, and if so where does it go? `inset` keeps the answer
// to someone actually standing in it rather than leaning on the outside of
// the shaft wall.
export function elevatorAt(state, x, z, floorIndex, inset = 0.4) {
  const ht = state.floorHt || FLOOR_H;
  for (const link of elevatorsOn(state, floorIndex)) {
    const { w, d } = elevatorSize(link);
    const { lx, lz } = worldToLocal(link, x, z);
    if (Math.abs(lx) > w / 2 - inset || Math.abs(lz) > d / 2 - inset) continue;
    const to = link.from === floorIndex ? link.to : link.from;
    return { link, from: floorIndex, to, y: to * ht };
  }
  return null;
}

// ---------- picking & mutation ----------

// The link under a point on the storey being edited. Later links win, the same
// rule shapes and props follow, so one dropped on top of another is the one
// you select.
export function linkAt(state, floorIndex, x, z, pad = 0) {
  const metrics = stairMetrics(state);
  // An elevator stands on both of its levels, so it can be picked from either;
  // everything else belongs to the storey it rises out of.
  const list = stairsOf(state).filter((l) =>
    l.from === floorIndex || (l.type === 'elevator' && l.to === floorIndex));
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
const NEEDS_LEVEL = {
  stair: 'A stair has to arrive somewhere — add a level above first.',
  ramp: 'A ramp has to arrive somewhere — add a level above first.',
  elevator: 'An elevator has to serve two levels — add one above first.',
  opening: 'A floor opening looks up into the next level — add one above first.',
};

function linkData(type, opts) {
  if (type === 'stair') {
    return { width: clamp(opts.width || STAIR_W, MIN_STAIR_W, MAX_STAIR_W) };
  }
  if (type === 'ramp') {
    return {
      width: clamp(opts.width || RAMP_W, MIN_RAMP_W, MAX_RAMP_W),
      slope: clamp(opts.slope || RAMP_SLOPE, MIN_RAMP_SLOPE, MAX_RAMP_SLOPE),
    };
  }
  if (type === 'elevator') {
    return {
      w: clamp(opts.w || ELEV_W, MIN_ELEV, MAX_ELEV),
      d: clamp(opts.d || ELEV_D, MIN_ELEV, MAX_ELEV),
    };
  }
  return {
    w: clamp(opts.w || OPENING_W, MIN_OPENING, MAX_OPENING),
    d: clamp(opts.d || OPENING_D, MIN_OPENING, MAX_OPENING),
  };
}

export function addStair(state, floorIndex, opts = {}) {
  const type = LINK_KINDS.includes(opts.type) ? opts.type : 'stair';
  const from = Math.floor(floorIndex);
  const to = from + 1;
  if (!state.floors[from]) return { link: null, reason: 'No such floor.' };
  if (!state.floors[to]) return { link: null, reason: NEEDS_LEVEL[type] };
  if ((state.links || []).length >= MAX_LINKS) {
    return { link: null, reason: 'This design is at its limit for stairs, ramps and openings.' };
  }
  const data = linkData(type, opts);
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
