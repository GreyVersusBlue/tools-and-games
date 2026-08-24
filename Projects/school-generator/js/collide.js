// collide.js — the walkthrough's physics: what stops you, and what holds you up.
//
// Everything before this phase let the camera fly through the building. The
// model now describes enough to stop it: a polygon wall is a line segment, a
// grid edge is a one-cell segment, a prop has a rotated footprint, a railing
// marks the edge of a floor, and `floorCuts()` says where a slab isn't. This
// file turns all of that into two questions, asked once per frame:
//
//   "can I stand here?"   -> supportAt()   — the surface under a point
//   "can I get there?"    -> moveWalker()  — a horizontal step, resolved
//
// The walker is a circle, not a capsule: a school is a building of vertical
// walls and floor-standing furniture, so the only thing a capsule would buy
// over a circle-plus-a-height-test is ducking under a table, which nobody
// wants to do in a floor-plan tool.
//
// Pure module: no three.js. walkthrough.js owns the camera, the keys and the
// timestep; everything geometric is here so it can be unit-tested headless,
// the same split shapes.js/polyedit.js and propplace.js/propedit.js use.
//
// Two decisions worth knowing before reading on:
//
// * **Edges block, they don't drop you.** Walking at the lip of a mezzanine
//   stops you rather than starting a fall. This is the wishlist's simpler
//   option and it is the right one for a design tool: a fall costs you the
//   viewpoint you were inspecting and, off the outside of a building, leaves
//   you in the car park looking for a door. Gravity still exists — it is what
//   lands you after a jump, or after switching out of ghost mode in mid-air —
//   but you only leave the ground deliberately.
// * **You collide with the storey you're standing on.** Not with all eight.
//   Which storey that is comes off the height of your feet (`storeyAt`), so a
//   run of stairs hands you over to the level above exactly when you arrive.

import {
  CELL, WALL_T, DOOR_W, FLOOR_H,
  EDGE_DOOR,
} from './grid.js';
import { shapesOf, segEnds, isBuilt } from './shapes.js';
import { propsOnFloor } from './props.js';
import { footprintOf } from './propplace.js';
import {
  stairsOf, stairMetrics, stairSurfaceAt, floorCuts, inFloorCut, floorSolidAt,
  openingRails,
} from './stairs.js';

// Body radius. A person is about 1.5ft across the shoulders; 0.9 leaves a
// 3ft doorway 1.2ft of clear space to aim at once both jambs are inflated,
// which is forgiving without letting you slip through a wall corner.
export const WALKER_R = 0.9;      // ft
// Walls are drawn as boxes centred on their segment, so collision runs
// against the segment inflated by half that thickness.
export const WALL_PAD = WALL_T / 2;
// The step you can take up without a stair — a threshold or a curb, not a
// storey. Anything taller has to be a run.
export const STEP_UP = 1.5;       // ft
// ...and down. Past this the destination is a drop rather than a step, and a
// grounded walker is refused it (see the edge note above).
export const STEP_DOWN = 1.5;     // ft
export const GRAVITY = 32;        // ft/s²
export const TERMINAL_V = 60;     // ft/s
export const JUMP_V = 9;          // ft/s — about a 1.2ft hop
// Props shorter than this are things you walk over, not into: a rug is not an
// obstacle, and a design tool that treats one as a wall feels broken.
export const MIN_OBSTACLE_H = 0.75; // ft
export const GROUND_Y = 0;        // ft — the site outside the building

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- segments ----------

// Closest point on segment a->b to (x, z). Same math as shapes.js's
// `projectOnSeg`, in scalars rather than objects: this runs over every wall on
// a storey several times a frame, and the garbage adds up.
function closestOnSeg(ax, az, bx, bz, x, z) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
  const px = ax + dx * t, pz = az + dz * t;
  return { x: px, z: pz, d: Math.hypot(x - px, z - pz) };
}

// Do segments p0->p1 and q0->q1 cross? Used to catch a step long enough to
// jump a wall outright — at 24 ft/s and a stalled frame, a single step can be
// wider than the wall is thick, and pushing a point out of a wall it has
// already passed through would put you on the wrong side of it.
export function segsCross(p0x, p0z, p1x, p1z, q0x, q0z, q1x, q1z) {
  const d = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = d(q0x, q0z, q1x, q1z, p0x, p0z);
  const d2 = d(q0x, q0z, q1x, q1z, p1x, p1z);
  const d3 = d(p0x, p0z, p1x, p1z, q0x, q0z);
  const d4 = d(p0x, p0z, p1x, p1z, q1x, q1z);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// A boundary run with its doorways taken out of it, as [start, end] distances
// along the run. Ends that abut an opening are pulled back by `trim` so the
// gap a walker aims at is the gap the geometry draws: collision inflates every
// segment by half a wall thickness, and without this the inflation would close
// over the doorway from both sides.
export function solidSpans(len, cuts, trim = 0) {
  const sorted = cuts
    .map((c) => ({ a: Math.max(0, Math.min(c.a, c.b)), b: Math.min(len, Math.max(c.a, c.b)) }))
    .filter((c) => c.b > c.a)
    .sort((p, q) => p.a - q.a);
  const spans = [];
  let cursor = 0, openStart = false;
  for (const c of sorted) {
    if (c.a > cursor) spans.push({ s: cursor, e: c.a, openS: openStart, openE: true });
    if (c.b > cursor) { cursor = c.b; openStart = true; }
  }
  if (cursor < len) spans.push({ s: cursor, e: len, openS: openStart, openE: false });
  const out = [];
  for (const sp of spans) {
    const s = sp.s + (sp.openS ? trim : 0);
    const e = sp.e - (sp.openE ? trim : 0);
    if (e - s > 0.05) out.push([s, e]);
  }
  return out;
}

// Every segment on a storey that a body can't pass through, in world feet.
// Glass and railings are in here with drywall: a curtain wall is a wall you
// can see through, and a guardrail exists precisely to stop you.
//
// Doors are the one thing that isn't solid. On the lattice a door is an edge
// value with the opening fixed at the middle of the cell; on a polygon it's an
// `{ seg, t, w }` opening anywhere along a run. Both end up as the same thing
// here — a segment with a hole in it.
export function wallSegments(floor, trim = WALL_PAD) {
  const out = [];
  if (!floor) return out;

  const push = (ax, az, bx, bz) => { out.push({ ax, az, bx, bz }); };

  const run = (ax, az, bx, bz, cuts) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return;
    if (!cuts || !cuts.length) { push(ax, az, bx, bz); return; }
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    for (const [s, e] of solidSpans(len, cuts, trim)) {
      push(ax + ux * s, az + uz * s, ax + ux * e, az + uz * e);
    }
  };

  const edge = (val, ax, az, bx, bz) => {
    if (val === EDGE_DOOR) {
      run(ax, az, bx, bz, [{ a: (CELL - DOOR_W) / 2, b: (CELL + DOOR_W) / 2 }]);
    } else {
      run(ax, az, bx, bz, null);
    }
  };

  for (let y = 0; y <= floor.h; y++) {
    for (let x = 0; x < floor.w; x++) {
      const v = floor.edgesH[y * floor.w + x];
      if (v) edge(v, x * CELL, y * CELL, (x + 1) * CELL, y * CELL);
    }
  }
  for (let y = 0; y < floor.h; y++) {
    for (let x = 0; x <= floor.w; x++) {
      const v = floor.edgesV[y * (floor.w + 1) + x];
      if (v) edge(v, x * CELL, y * CELL, x * CELL, (y + 1) * CELL);
    }
  }

  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        if (!isBuilt(ring.walls[i])) continue;
        const [a, b] = segEnds(ring, i);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const cuts = ring.openings
          .filter((o) => o.seg === i)
          .map((o) => ({ a: o.t * len - o.w / 2, b: o.t * len + o.w / 2 }));
        run(a.x, a.z, b.x, b.z, cuts);
      }
    }
  }

  return out;
}

// ---------- props ----------

// The props on a storey you can walk into, as rotated boxes. Only
// floor-standing ones, and only those tall enough to be in the way — a
// wall-mounted TV hangs on a wall that already stops you, and a rug is
// something you walk over.
export function propObstacles(state, floorIndex, catalogGet) {
  const out = [];
  if (!catalogGet) return out;
  for (const p of propsOnFloor(state, floorIndex)) {
    const entry = catalogGet(p.type);
    if (!entry || entry.mount !== 'floor') continue;
    const scale = (typeof p.scale === 'number' && p.scale > 0) ? p.scale : 1;
    if ((entry.h || 0) * scale < MIN_OBSTACLE_H) continue;
    const { hw, hd } = footprintOf(entry, p);
    out.push({ x: p.x, z: p.z, hw, hd, rotationY: p.rotationY || 0, type: p.type });
  }
  return out;
}

// The guardrails a floor opening puts up on the storey it opens. These are the
// one boundary that isn't in the floor's own data: `openingRails()` derives
// them per link, and render.js draws them the same way. A walker has to be
// stopped by the rail they can see, not merely by the edge behind it — the two
// are within a foot of each other, which is exactly the distance at which
// clipping through a handrail is obvious.
export function openingRailSegments(state, floorIndex) {
  const floor = state.floors[floorIndex];
  if (!floor) return [];
  const metrics = stairMetrics(state);
  const out = [];
  for (const link of stairsOf(state)) {
    if (link.to !== floorIndex) continue;
    for (const side of openingRails(link, metrics, floor)) {
      out.push({ ax: side.a.x, az: side.a.z, bx: side.b.x, bz: side.b.z });
    }
  }
  return out;
}

// Everything on one storey that a walker can hit, built once when walkthrough
// mode starts. Editing can't happen while you're walking, so this is a cache
// with exactly one invalidation point: entering the mode.
export function buildCollider(state, floorIndex, catalogGet) {
  return {
    floor: floorIndex,
    segs: wallSegments(state.floors[floorIndex]).concat(openingRailSegments(state, floorIndex)),
    props: propObstacles(state, floorIndex, catalogGet),
  };
}

export const emptyCollider = () => ({ floor: -1, segs: [], props: [] });

// ---------- resolution ----------

// Push a circle out of one rotated box, in the box's own frame (the prop
// rotation convention, shared with propplace.js and stairs.js).
function pushOutOfBox(obj, x, z, r) {
  const c = Math.cos(obj.rotationY || 0), s = Math.sin(obj.rotationY || 0);
  const wx = x - obj.x, wz = z - obj.z;
  const lx = wx * c - wz * s, lz = wx * s + wz * c;
  const hw = obj.hw, hd = obj.hd;
  let nx, nz;
  if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
    // Already inside it — a prop dropped on top of you, or a step that
    // skipped the boundary. Leave by the nearest face.
    const ox = hw - Math.abs(lx), oz = hd - Math.abs(lz);
    if (ox <= oz) { nx = (lx < 0 ? -1 : 1) * (hw + r); nz = lz; }
    else { nx = lx; nz = (lz < 0 ? -1 : 1) * (hd + r); }
  } else {
    const cx = clamp(lx, -hw, hw), cz = clamp(lz, -hd, hd);
    const dx = lx - cx, dz = lz - cz;
    const d = Math.hypot(dx, dz);
    if (d >= r) return null;
    if (d < 1e-9) { nx = cx; nz = cz + r; }
    else { nx = cx + (dx / d) * r; nz = cz + (dz / d) * r; }
  }
  return { x: obj.x + nx * c + nz * s, z: obj.z - nx * s + nz * c };
}

// Move a point out of everything it overlaps. Several passes, because pushing
// out of one wall can push you into the next one — an inside corner needs two
// and a doorway reveal can need three.
export function resolvePoint(collider, x, z, r = WALKER_R, passes = 3) {
  let px = x, pz = z;
  const wallR = r + WALL_PAD;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const s of collider.segs) {
      const c = closestOnSeg(s.ax, s.az, s.bx, s.bz, px, pz);
      if (c.d >= wallR) continue;
      if (c.d < 1e-9) {
        // Dead on the line: leave along its normal rather than dividing by zero.
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const len = Math.hypot(dx, dz) || 1;
        px = c.x - (dz / len) * wallR; pz = c.z + (dx / len) * wallR;
      } else {
        px = c.x + ((px - c.x) / c.d) * wallR;
        pz = c.z + ((pz - c.z) / c.d) * wallR;
      }
      moved = true;
    }
    for (const p of collider.props) {
      const out = pushOutOfBox(p, px, pz, r);
      if (out) { px = out.x; pz = out.z; moved = true; }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

// Did a step pass clean through a wall? See `segsCross`.
export function crossesWall(collider, x0, z0, x1, z1) {
  for (const s of collider.segs) {
    if (segsCross(x0, z0, x1, z1, s.ax, s.az, s.bx, s.bz)) return true;
  }
  return false;
}

// ---------- what holds you up ----------

// Which storey a pair of feet is on. Floors stack at fixed intervals, so this
// is a division — and it deliberately floors rather than rounds, so climbing a
// run hands you to the level above only once you have actually arrived.
export function storeyAt(state, feetY) {
  const ht = state.floorHt || FLOOR_H;
  const n = state.floors.length;
  return clamp(Math.floor(feetY / ht + 1e-6), 0, n - 1);
}

// The highest walkable surface under (x, z) that a walker with their feet at
// `feetY` could be standing on — a stair tread, a floor slab, or the ground
// outside. Null only if `ground: false` and there is nothing built here.
//
// A slab with a hole cut in it isn't floor: `floorCuts()` already knows where
// a stair or a mezzanine void opens one up, and the point of asking here is
// that walking at a hole should feel like walking at the edge of the building.
export function supportAt(state, x, z, feetY, opts = {}) {
  const ht = state.floorHt || FLOOR_H;
  const reach = feetY + (opts.stepUp ?? STEP_UP) + 1e-6;
  let best = null;
  const consider = (y, kind, floor) => {
    if (y > reach) return;
    if (!best || y > best.y) best = { y, kind, floor };
  };

  for (let i = 0; i < state.floors.length; i++) {
    const base = i * ht;
    if (base > reach) break;
    if (!floorSolidAt(state.floors[i], x, z)) continue;
    if (inFloorCut(floorCuts(state, i), x, z)) continue;
    consider(base, 'floor', i);
  }

  const metrics = stairMetrics(state);
  for (const link of stairsOf(state)) {
    const h = stairSurfaceAt(link, metrics, x, z);
    if (h === null) continue;
    consider(link.from * ht + h, 'stair', link.from);
  }

  // The site itself, considered last so that a slab laid on it wins the tie —
  // standing on the ground floor is standing on a floor, and a caller that
  // asks what kind of surface it is should hear so.
  if (opts.ground !== false) consider(GROUND_Y, 'ground', -1);

  return best;
}

// ---------- moving ----------

// One horizontal step, fully resolved: null if it can't be taken at all.
// `pos.y` is the *feet*, not the eye — every height in this module is.
export function tryStep(state, collider, pos, dx, dz, opts = {}) {
  const r = opts.radius ?? WALKER_R;
  const p = resolvePoint(collider, pos.x + dx, pos.z + dz, r);
  if (crossesWall(collider, pos.x, pos.z, p.x, p.z)) return null;
  const support = supportAt(state, p.x, p.z, pos.y, opts);
  if (!support) return null;
  // Grounded, a drop is an edge you stop at rather than fall off. Airborne
  // (a jump, or dropping out of ghost mode), there is nothing to stop at.
  if (opts.grounded !== false && support.y < pos.y - (opts.stepDown ?? STEP_DOWN)) return null;
  return { x: p.x, z: p.z, support };
}

// A step, and if it can't be taken whole, the same step along one axis — which
// is what makes walking into a wall at an angle slide along it rather than
// stop dead. Returns where you ended up and what is under you there.
export function moveWalker(state, collider, pos, dx, dz, opts = {}) {
  const stay = (blocked) => ({
    x: pos.x, z: pos.z, blocked,
    support: supportAt(state, pos.x, pos.z, pos.y, opts),
    slid: false,
  });
  if (!dx && !dz) return stay(false);

  const whole = tryStep(state, collider, pos, dx, dz, opts);
  if (whole) return { ...whole, blocked: false, slid: false };

  if (dx) {
    const alongX = tryStep(state, collider, pos, dx, 0, opts);
    if (alongX) return { ...alongX, blocked: false, slid: true };
  }
  if (dz) {
    const alongZ = tryStep(state, collider, pos, 0, dz, opts);
    if (alongZ) return { ...alongZ, blocked: false, slid: true };
  }
  return stay(true);
}
