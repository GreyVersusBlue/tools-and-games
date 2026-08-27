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
// Since Phase 17 there *is* a height test, and it is the "plus" in that
// sentence rather than a second body: `overheadAt` is `supportAt` looking the
// other way. Both arcs skipped it and both were right to — a building of flat
// slabs has twelve feet of air over every point of it — but a stair hall has a
// run in it, and the underside of a run is somewhere a walker can currently
// stand with their head in the concrete. A campus adds outdoor stairs and
// soffits to that list. It is one function and one comparison, over the
// surfaces this module already knew how to find.
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

import { WALL_T, FLOOR_H, WALL_H } from './grid.js';
import { shapesOf, segEnds, isBuilt, isDoorOpening } from './shapes.js';
import { propsOnFloor } from './props.js';
import { footprintOf } from './propplace.js';
import {
  stairsOf, stairMetrics, stairSurfaceAt, floorCuts, inFloorCut, floorSolidAt,
  openingRails, elevatorsOn, elevatorWalls,
} from './stairs.js';
import { wallProbe } from './walls.js';
import { terrainField, emptyField, groundAt } from './terrain.js';
import {
  collectDoorLeaves, leafSegment, updateLeaves, updateLeavesFor, closeAll,
  LEAF_T,
} from './openings.js';

// Body radius. A person is about 1.5ft across the shoulders; 0.9 leaves a
// 3ft doorway 1.2ft of clear space to aim at once both jambs are inflated,
// which is forgiving without letting you slip through a wall corner.
export const WALKER_R = 0.9;      // ft
// Walls are drawn as boxes centred on their segment, so collision runs against
// the segment inflated by half that thickness. Since Phase 2 that thickness is
// per-boundary (walls.js works out which walls are exterior), so every segment
// carries its own `pad` and this is only the fallback for one that doesn't.
export const WALL_PAD = WALL_T / 2;
// Half a door leaf. A leaf is thin enough that the walker's own radius does
// nearly all the work, but a leaf with no thickness lets you stand *in* it.
export const LEAF_PAD = LEAF_T / 2;
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
// Datum. Until Phase 5 this *was* the site — one number, the ground everywhere
// outside the building. It survives as the elevation of a design with no
// terrain in it, which is what `groundAt(null, ...)` returns and what every
// caller that doesn't hand `supportAt` a site field still gets.
export const GROUND_Y = 0;        // ft
// The top of a walker's head, above their feet. A shade under six feet, which
// is a tall adult and about the sixtieth percentile of "will I duck".
export const HEAD_H = 5.9;        // ft
// How thick the underside of a stair run is. A slab has *no* thickness in this
// model — `floorBaseY` is the walking surface and `cutStart` sizes the hole a
// run opens against the bare storey height — so giving one here would quietly
// contradict `stairs.js`'s own `HEADROOM`, which is the rule that says a run
// clears the floor above by 6.8ft. A run is drawn as treads on air, and a foot
// of structure under them is the honest allowance.
export const SOFFIT_T = 1;        // ft

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

// Every segment on a storey that a body can't pass through, in world feet, each
// carrying the half-thickness it should be inflated by. Glass and railings are
// in here with drywall: a curtain wall is a wall you can see through, and a
// guardrail exists precisely to stop you.
//
// Two things are *not* solid, and only two. A **doorway** is a hole you walk
// through — on the lattice an edge value with the opening fixed at the middle
// of the cell, on a polygon an `{ seg, t, w }` opening anywhere along a run;
// both end up here as a segment with a hole in it. A **door leaf**, if the
// doorway hangs one, closes that hole again — but it swings, so it isn't baked
// in here at all (see `buildCollider` and openings.js).
//
// A **window** is not in either group. It is a hole in the *elevation*, not in
// the plan: the wall under it and over it is still there, and a body walking
// at chest height meets glass. So a window opening never becomes a cut, which
// is the single line that keeps you from strolling out of a second-storey
// classroom — and the reason windows are an opening variant rather than a new
// segment kind pays for itself right here, since every other reader of an
// opening (position along a run, width, plan symbol) needed no change at all.
//
// `probe` is walls.js's per-boundary thickness lookup; pass one in to share
// its cache with another consumer, or leave it out and one is made here.
export function wallSegments(floor, probe = null) {
  const out = [];
  if (!floor) return out;
  const thick = probe || wallProbe(floor);

  const run = (ax, az, bx, bz, cuts) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return;
    // Thickness is a property of the whole boundary, so it's resolved from the
    // uncut run — a jamb either side of a door is the same wall as the door.
    const t = thick(ax, az, bx, bz);
    const pad = t / 2;
    if (!cuts || !cuts.length) { out.push({ ax, az, bx, bz, t, pad }); return; }
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    // Trim each span back from the opening it abuts by the same half-thickness
    // it will be inflated by, so the gap a walker aims at is the gap the
    // geometry draws — now per wall rather than per building.
    for (const [s, e] of solidSpans(len, cuts, pad)) {
      out.push({ ax: ax + ux * s, az: az + uz * s, bx: ax + ux * e, bz: az + uz * e, t, pad });
    }
  };

  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        if (!isBuilt(ring.walls[i])) continue;
        const [a, b] = segEnds(ring, i);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const cuts = ring.openings
          .filter((o) => o.seg === i && isDoorOpening(o))
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
    // `id` and `light` are Phase 11's: an obstacle that can be shoved has to
    // be traceable back to the prop it came from (so the renderer can move the
    // right instance) and has to say how easily it goes. Everything else here
    // reads the obstacle as it always did, and a row with no `light` field is
    // exactly as immovable as it was.
    out.push({
      id: p.id, x: p.x, z: p.z, hw, hd, rotationY: p.rotationY || 0, type: p.type,
      light: entry.light,
      // Its own place in this array, so a shove can hand the index back to
      // `reindex` without scanning for it every frame.
      idx: out.length,
    });
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
      // A guardrail is a rail, not a wall: it gets the nominal pad rather than
      // walls.js's interior/exterior answer, which is about construction.
      out.push({ ax: side.a.x, az: side.a.z, bx: side.b.x, bz: side.b.z,
        t: WALL_T, pad: WALL_PAD });
    }
  }
  return out;
}

// The three shaft walls an elevator car stands inside, on either of the two
// storeys it serves. A stair's boundary is the rail around the hole it cut; an
// elevator cuts nothing, so the shaft is what keeps you in the car.
export function elevatorSegments(state, floorIndex) {
  const out = [];
  for (const link of elevatorsOn(state, floorIndex)) {
    for (const w of elevatorWalls(link)) {
      out.push({ ax: w.a.x, az: w.a.z, bx: w.b.x, bz: w.b.z, t: WALL_T, pad: WALL_PAD });
    }
  }
  return out;
}

// Everything on one storey that a walker can hit, built once when walkthrough
// mode starts. Structural editing can't happen while you're walking, so
// `segs` is a cache with exactly one invalidation point: entering the mode.
// `props` had the same lifetime for four arcs; since Phase 22 the walk's
// hands can place and remove furniture, so it gained a second one —
// `refreshProps` below.
//
// `doors` is the exception, and it is worth being precise about what kind of
// exception it is. It is not a hole in the cache — the leaves it lists were
// collected at the same moment as everything else and no leaf appears or
// disappears mid-walk. What changes is one number per leaf (`open`), and the
// segment that number implies is computed at the moment it's needed rather
// than stored. So the world is still built once; it simply has a few hinges
// in it now, and `resolvePoint` asks each hinge where it currently is.
export function buildCollider(state, floorIndex, catalogGet, opts = {}) {
  const floor = state.floors[floorIndex];
  const probe = floor ? wallProbe(floor) : null;
  const segs = wallSegments(floor, probe)
    .concat(openingRailSegments(state, floorIndex))
    .concat(elevatorSegments(state, floorIndex));
  const props = propObstacles(state, floorIndex, catalogGet);
  return {
    floor: floorIndex,
    // The graded ground, built once for the whole building and shared between
    // its storeys rather than recomputed eight times — `terrainField` is a
    // sweep over the site, and it doesn't change between levels. A caller with
    // one already (walkthrough.js makes one at walk-start) passes it in.
    site: opts.site || terrainField(state),
    segs,
    props,
    doors: closeAll(collectDoorLeaves(state, floorIndex)),
    // Phase 6: one walker could afford a linear scan; a hundred cannot. The
    // index is built beside the arrays it indexes and never replaces them —
    // every function here still works against a collider that has none, which
    // is what keeps a hand-built test collider a two-line object.
    index: opts.index === false ? null : buildIndex(segs, props),
    // Bodies are the other walkers, and unlike everything above they change
    // every frame. They are a slot rather than a build product: whoever is
    // stepping fills it, and an empty one is a building with one person in it.
    bodies: [],
    probe,
  };
}

export const emptyCollider = () => ({
  floor: -1, segs: [], props: [], doors: [], bodies: [], index: null, site: emptyField(),
});

// Phase 22: the invalidation clause. "The collider is built once at
// walk-start" held for four arcs because nothing could change mid-walk; hands
// can now place and remove furniture, so the *prop* half of the cache gets
// one more invalidation point. The walls stay built-once — nothing in walk
// mode edits structure — and the door leaves stay the very objects a walker
// (or an agent) may be holding open: only `props` is re-derived from the
// design, and the index rebuilt over the same wall segments.
//
// `skipId` leaves one prop out — the one in the walker's hands, which stops
// blocking the spot it was picked up from the moment it is carried.
export function refreshProps(state, collider, catalogGet, opts = {}) {
  let props = propObstacles(state, collider.floor, catalogGet);
  if (opts.skipId !== undefined) {
    props = props.filter((p) => p.id !== opts.skipId);
    props.forEach((p, i) => { p.idx = i; });
  }
  collider.props = props;
  if (collider.index) collider.index = buildIndex(collider.segs, collider.props);
  return collider;
}

// ---------- the spatial index ----------
//
// A uniform grid over segments and props — the fix the v1 retrospective
// records as "known if a design ever gets big enough to feel it". A crowd is
// that design: the walker asks "what is within a foot of me" once a frame, and
// a hundred of them asking it against every wall on the storey is the one
// place this codebase has ever been O(n·m).
//
// Everything is bucketed by the cells its *inflated* extent covers, so a query
// only has to look at the cells the body itself touches.

export const INDEX_CELL = 16;     // ft — four lattice cells

export function buildIndex(segs, props, cell = INDEX_CELL) {
  const buckets = new Map();
  const key = (cx, cz) => `${cx}|${cz}`;
  const spread = (list, x0, z0, x1, z1, i) => {
    const cx0 = Math.floor(x0 / cell), cx1 = Math.floor(x1 / cell);
    const cz0 = Math.floor(z0 / cell), cz1 = Math.floor(z1 / cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = key(cx, cz);
        let b = buckets.get(k);
        if (!b) { b = { segs: [], props: [] }; buckets.set(k, b); }
        b[list].push(i);
      }
    }
  };

  segs.forEach((s, i) => {
    const pad = s.pad ?? WALL_PAD;
    spread('segs', Math.min(s.ax, s.bx) - pad, Math.min(s.az, s.bz) - pad,
      Math.max(s.ax, s.bx) + pad, Math.max(s.az, s.bz) + pad, i);
  });
  props.forEach((p, i) => {
    // A rotated box's extent is its half-diagonal in both axes — cheaper than
    // rotating four corners, and never smaller than the truth, which is the
    // only direction a broad phase is allowed to be wrong in.
    const r = Math.hypot(p.hw, p.hd);
    spread('props', p.x - r, p.z - r, p.x + r, p.z + r, i);
  });

  // Marks, not sets: a query touches at most a handful of buckets and the same
  // wall is in several of them, so dedupe is a stamp compare rather than a
  // hash. The two output arrays are reused between queries — a caller consumes
  // them before asking again, which every caller in this file does.
  const segMark = new Int32Array(segs.length);
  const propMark = new Int32Array(props.length);
  const outSegs = [];
  const outProps = [];
  let stamp = 0;

  return {
    cell,
    buckets,
    counts: { segs: segs.length, props: props.length },
    // Everything whose bucket overlaps the box (x0,z0)-(x1,z1).
    near(x0, z0, x1, z1) {
      stamp++;
      outSegs.length = 0;
      outProps.length = 0;
      const cx0 = Math.floor(x0 / cell), cx1 = Math.floor(x1 / cell);
      const cz0 = Math.floor(z0 / cell), cz1 = Math.floor(z1 / cell);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const b = buckets.get(key(cx, cz));
          if (!b) continue;
          for (const i of b.segs) if (segMark[i] !== stamp) { segMark[i] = stamp; outSegs.push(i); }
          for (const i of b.props) if (propMark[i] !== stamp) { propMark[i] = stamp; outProps.push(i); }
        }
      }
      return { segs: outSegs, props: outProps };
    },
    // Phase 11: one prop has moved, so its buckets are wrong. Pull index `i`
    // out of the cells its old extent covered and drop it into the cells its
    // new one does. Called only when something is actually shoved, which is a
    // handful of props over a whole walk rather than every prop every frame —
    // so a splice out of a short array is the right cost, and rebuilding the
    // whole index for a chair would not be.
    reindex(i, from, to) {
      const drop = (x, z, r) => {
        const cx0 = Math.floor((x - r) / cell), cx1 = Math.floor((x + r) / cell);
        const cz0 = Math.floor((z - r) / cell), cz1 = Math.floor((z + r) / cell);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            const b = buckets.get(key(cx, cz));
            if (!b) continue;
            const at = b.props.indexOf(i);
            if (at >= 0) b.props.splice(at, 1);
          }
        }
      };
      drop(from.x, from.z, Math.hypot(from.hw, from.hd));
      const r = Math.hypot(to.hw, to.hd);
      spread('props', to.x - r, to.z - r, to.x + r, to.z + r, i);
    },
  };
}

// The candidates near a box, as the objects themselves. Without an index this
// is every wall and every prop on the storey — the pre-Phase-6 behaviour, and
// still what a two-line test collider gets.
export function candidates(collider, x0, z0, x1, z1) {
  if (!collider.index) return { segs: collider.segs, props: collider.props };
  const hit = collider.index.near(x0, z0, x1, z1);
  return {
    segs: hit.segs.map((i) => collider.segs[i]),
    props: hit.props.map((i) => collider.props[i]),
  };
}

// Swing this storey's leaves toward (or away from) a walker at (x, z), and
// report whether anything moved — walkthrough.js drives this once a frame and
// hands the result to the renderer.
export function updateDoors(collider, x, z, dt, opts = {}) {
  if (!collider || !collider.doors || !collider.doors.length) return false;
  return updateLeaves(collider.doors, x, z, dt, opts);
}

// The same, for a building with a crowd in it: every leaf answers to whoever
// is nearest to it, and holds for anyone it would close on. One call per
// frame for the whole storey rather than one per person, because leaves are
// shared and the last caller would otherwise win.
export function updateDoorsFor(collider, bodies, dt, opts = {}) {
  if (!collider || !collider.doors || !collider.doors.length) return false;
  return updateLeavesFor(collider.doors, bodies, dt, opts);
}

// ---------- resolution ----------

// Push a circle out of one rotated box, in the box's own frame (the prop
// rotation convention, shared with propplace.js and stairs.js).
export function pushOutOfBox(obj, x, z, r) {
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
// The leaves on this storey as segments, at whatever angle they're currently
// hanging. Recomputed rather than cached: it's a sin/cos per leaf, and a
// cached one would be wrong the frame after a door started moving.
export function doorSegments(collider) {
  const out = [];
  for (const leaf of collider.doors || []) {
    const s = leafSegment(leaf);
    s.t = LEAF_T;
    s.pad = LEAF_PAD;
    out.push(s);
  }
  return out;
}

export function pushOutOfSeg(s, px, pz, r) {
  const wallR = r + (s.pad ?? WALL_PAD);
  const c = closestOnSeg(s.ax, s.az, s.bx, s.bz, px, pz);
  if (c.d >= wallR) return null;
  if (c.d < 1e-9) {
    // Dead on the line: leave along its normal rather than dividing by zero.
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len = Math.hypot(dx, dz) || 1;
    return { x: c.x - (dz / len) * wallR, z: c.z + (dx / len) * wallR };
  }
  return {
    x: c.x + ((px - c.x) / c.d) * wallR,
    z: c.z + ((pz - c.z) / c.d) * wallR,
  };
}

// ---------- footprint overlap (Phase 22) ----------
//
// Everything above resolves a *circle* against the world, which is the right
// body for a walker. A prop being set down (carry.js) or shoved (shove.js) is
// not a circle: a bench is twelve times wider than it is deep, and a circle of
// its half-depth walks its ends through walls. These answer overlap for the
// rotated rectangle the footprint actually is — yes/no only, no push-out,
// because both callers refuse a placement rather than resolving one.

// Distance from a point to an axis-aligned box centred at the origin; zero
// inside it.
function ptBoxDist(x, z, hw, hd) {
  const dx = Math.max(Math.abs(x) - hw, 0);
  const dz = Math.max(Math.abs(z) - hd, 0);
  return Math.hypot(dx, dz);
}

// Distance from segment a->b to that same box, both in the box's own frame.
function segBoxDist(ax, az, bx, bz, hw, hd) {
  if ((Math.abs(ax) <= hw && Math.abs(az) <= hd)
    || (Math.abs(bx) <= hw && Math.abs(bz) <= hd)) return 0;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (let i = 0; i < 4; i++) {
    const [cx, cz] = corners[i];
    const [nx, nz] = corners[(i + 1) % 4];
    if (segsCross(ax, az, bx, bz, cx, cz, nx, nz)) return 0;
  }
  let best = Math.min(ptBoxDist(ax, az, hw, hd), ptBoxDist(bx, bz, hw, hd));
  for (const [cx, cz] of corners) {
    best = Math.min(best, closestOnSeg(ax, az, bx, bz, cx, cz).d);
  }
  return best;
}

// Does a rotated box { x, z, hw, hd, rotationY } overlap a wall segment,
// inflated by the segment's own half-thickness? Exactly touching is not
// overlapping — a prop wall-snapped flush against a face has to be legal.
export function boxOverlapsSeg(box, s) {
  const pad = s.pad ?? WALL_PAD;
  const c = Math.cos(box.rotationY || 0), si = Math.sin(box.rotationY || 0);
  const ax = s.ax - box.x, az = s.az - box.z;
  const bx = s.bx - box.x, bz = s.bz - box.z;
  return segBoxDist(
    ax * c - az * si, ax * si + az * c,
    bx * c - bz * si, bx * si + bz * c,
    box.hw, box.hd) < pad - 1e-9;
}

// Two rotated boxes, by separating axes — the four face normals are the only
// candidates in 2D. `eps` makes exactly-flush (a row-snapped desk against its
// neighbour) come out as separated rather than at the mercy of float noise.
export function boxesOverlap(a, b, eps = 1e-6) {
  const corners = (o) => {
    const c = Math.cos(o.rotationY || 0), s = Math.sin(o.rotationY || 0);
    return [[-o.hw, -o.hd], [o.hw, -o.hd], [o.hw, o.hd], [-o.hw, o.hd]]
      .map(([lx, lz]) => [o.x + lx * c + lz * s, o.z - lx * s + lz * c]);
  };
  // Local x and z axes in world, under the shared rotation convention.
  const axes = (o) => {
    const c = Math.cos(o.rotationY || 0), s = Math.sin(o.rotationY || 0);
    return [[c, -s], [s, c]];
  };
  const A = corners(a), B = corners(b);
  for (const o of [a, b]) {
    for (const [ux, uz] of axes(o)) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of A) { const p = x * ux + z * uz; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
      for (const [x, z] of B) { const p = x * ux + z * uz; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
      if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
    }
  }
  return true;
}

// Push a circle out of another circle — a body out of a body. Half the
// overlap each would be the physical answer, but a walker resolved against a
// list of neighbours is not a solver: each body moves itself fully clear and
// the neighbour does the same on its own step, which converges over a frame or
// two and never needs the two of them to agree.
// `b.push` is how hard this body shoves — 1 for a wall-like body (the camera:
// you are never standing inside somebody), less for a person. **A crowd that
// separates fully every frame cannot flow through a door**: two people who
// want the same three feet of doorway push each other apart exactly as hard as
// they push forward, and the jam is stable forever. Half the separation per
// frame is a shoulder brushing past a shoulder, which is what a corridor at a
// passing period actually looks like, and it still converges to clear as soon
// as there is room.
export function pushOutOfCircle(b, x, z, r) {
  const want = r + (b.r ?? WALKER_R);
  const dx = x - b.x, dz = z - b.z;
  const d = Math.hypot(dx, dz);
  if (d >= want) return null;
  const k = b.push ?? 1;
  if (d < 1e-6) {
    // Exactly on top of each other — two people spawned on the same cell, or a
    // crowd squeezed into a doorway. Leave in *some* direction; which one
    // doesn't matter as long as it is stable between frames, so it comes off
    // the other body's position rather than off a random number.
    const a = Math.atan2(b.z, b.x) + 1.2;
    return { x: b.x + Math.cos(a) * want * k, z: b.z + Math.sin(a) * want * k };
  }
  const tx = b.x + (dx / d) * want, tz = b.z + (dz / d) * want;
  return k >= 1 ? { x: tx, z: tz } : { x: x + (tx - x) * k, z: z + (tz - z) * k };
}

export function resolvePoint(collider, x, z, r = WALKER_R, passes = 3, opts = {}) {
  let px = x, pz = z;
  const doors = doorSegments(collider);
  const bodies = opts.bodies || collider.bodies || null;
  const skip = opts.skip;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    // The broad phase is re-queried each pass because the point moves: a
    // corner can push you a foot sideways, and the wall that stops you next is
    // one the first query never looked at.
    const near = candidates(collider, px - r, pz - r, px + r, pz + r);
    for (const s of near.segs) {
      const out = pushOutOfSeg(s, px, pz, r);
      if (out) { px = out.x; pz = out.z; moved = true; }
    }
    for (const s of doors) {
      const out = pushOutOfSeg(s, px, pz, r);
      if (out) { px = out.x; pz = out.z; moved = true; }
    }
    for (const p of near.props) {
      const out = pushOutOfBox(p, px, pz, r);
      if (out) { px = out.x; pz = out.z; moved = true; }
    }
    if (bodies) {
      for (const b of bodies) {
        if (b.id !== undefined && b.id === skip) continue;
        const out = pushOutOfCircle(b, px, pz, r);
        if (out) { px = out.x; pz = out.z; moved = true; }
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

// Did a step pass clean through a wall — or through a shut door? See
// `segsCross`.
export function crossesWall(collider, x0, z0, x1, z1) {
  const near = candidates(collider,
    Math.min(x0, x1) - WALL_T, Math.min(z0, z1) - WALL_T,
    Math.max(x0, x1) + WALL_T, Math.max(z0, z1) + WALL_T);
  for (const s of near.segs) {
    if (segsCross(x0, z0, x1, z1, s.ax, s.az, s.bx, s.bz)) return true;
  }
  for (const s of doorSegments(collider)) {
    if (segsCross(x0, z0, x1, z1, s.ax, s.az, s.bx, s.bz)) return true;
  }
  return false;
}

// ---------- what holds you up ----------

// Which storey a pair of feet is on. Floors stack at fixed intervals, so this
// is a division — and it deliberately floors rather than rounds, so climbing a
// run hands you to the level above only once you have actually arrived.
//
// `groundY` is Phase 5's one correction to it. Walk up a fifteen-foot berm
// outside and your feet are at fifteen feet, which used to mean "second
// storey" and handed you the wrong collider — the trees on the hill stopped
// being solid. Measuring from the ground under you instead costs one argument
// and is a no-op inside the building, where the pad holds the ground at datum.
export function storeyAt(state, feetY, groundY = 0) {
  const ht = state.floorHt || FLOOR_H;
  const n = state.floors.length;
  return clamp(Math.floor((feetY - groundY) / ht + 1e-6), 0, n - 1);
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
  //
  // This is the line the whole phase turns on. It used to read `GROUND_Y`, a
  // constant zero; it is now a lookup into the graded heightfield, and every
  // other behaviour the walker has out on the site — refusing a bank that is
  // too steep to step up, landing on a slope after a jump, being handed the
  // right storey's collider on a berm — falls out of it without another line
  // of physics.
  if (opts.ground !== false) consider(groundAt(opts.site || null, x, z), 'ground', -1);

  return best;
}

// The lowest thing over a walker's head at (x, z), given where their feet are:
// the ceiling of the storey they are standing in, the underside of any slab
// oversailing them, or the soffit of a stair run they are walking under. Null
// when there is nothing above them at all, which outdoors is the usual answer.
//
// The mirror of `supportAt`, and deliberately the same shape: a `consider`
// that keeps the *nearest* candidate rather than the highest, over the same
// three sources.
// `opts.structural` leaves the ceiling plane out of the answer, and that is
// what a *step* is tested against. The ceiling is drawn across the whole
// storey and cut only where the slab above is cut, so a stair run climbs
// through it: half way up a flight the tile grid is five feet over your head
// and the air above the treads is not. What actually stops a body is
// structure — a slab it would walk under, the underside of a run — and
// charging it for the ceiling instead strands the whole school on the fourth
// tread. (Which is how this was found. Second time a fire drill has found a
// bug in this file.)
export function overheadAt(state, x, z, feetY, opts = {}) {
  const ht = state.floorHt || FLOOR_H;
  let best = null;
  const consider = (y, kind, floor) => {
    if (y <= feetY + 1e-6) return;
    if (!best || y < best.y) best = { y, kind, floor };
  };

  // The ceiling of the storey you are standing in — the plane the renderer
  // draws at `WALL_H`, not the slab two feet above it, because the thing you
  // walk into is the ceiling.
  //
  // The hole in it is the one in the slab *above*, not the one in the slab you
  // are standing on — which is the same pair `render.js` hands `buildFloor` as
  // `cuts` and `ceilCuts`.
  const here = storeyAt(state, feetY, opts.groundY ?? 0);
  const floor = state.floors[here];
  if (!opts.structural && floor && floorSolidAt(floor, x, z)
      && !inFloorCut(floorCuts(state, here + 1), x, z)) {
    consider(here * ht + WALL_H, 'ceiling', here);
  }
  // ...and the underside of anything oversailing you, which is what you are
  // standing under when you are outside and there is a storey over your head.
  for (let i = here + 1; i < state.floors.length; i++) {
    if (!floorSolidAt(state.floors[i], x, z)) continue;
    if (inFloorCut(floorCuts(state, i), x, z)) continue;
    consider(i * ht, 'slab', i);
    break;
  }

  const metrics = stairMetrics(state);
  for (const link of stairsOf(state)) {
    const h = stairSurfaceAt(link, metrics, x, z);
    if (h === null) continue;
    consider(link.from * ht + h - SOFFIT_T, 'soffit', link.from);
  }
  return best;
}

// How much air there is over a walker's head, in feet. `Infinity` under the
// open sky, which is the honest answer and the one that makes every caller's
// comparison read the right way round.
export function headroomAt(state, x, z, feetY, opts = {}) {
  const over = overheadAt(state, x, z, feetY, opts);
  return over ? over.y - feetY : Infinity;
}

// ---------- moving ----------

// One horizontal step, fully resolved: null if it can't be taken at all.
// `pos.y` is the *feet*, not the eye — every height in this module is.
export function tryStep(state, collider, pos, dx, dz, opts = {}) {
  const r = opts.radius ?? WALKER_R;
  // The collider already carries the site it was built against, so a caller
  // never has to remember to hand the ground to a function about walking.
  const o = opts.site || !collider || !collider.site ? opts : { ...opts, site: collider.site };
  const p = resolvePoint(collider, pos.x + dx, pos.z + dz, r, opts.passes ?? 3,
    { bodies: opts.bodies, skip: opts.skip });
  if (crossesWall(collider, pos.x, pos.z, p.x, p.z)) return null;
  const support = supportAt(state, p.x, p.z, pos.y, o);
  if (!support) return null;
  // Grounded, a drop is an edge you stop at rather than fall off. Airborne
  // (a jump, or dropping out of ghost mode), there is nothing to stop at.
  if (opts.grounded !== false && support.y < pos.y - (opts.stepDown ?? STEP_DOWN)) return null;
  // ...and a step that puts your head inside a stair run is a step you don't
  // take. Measured from where your feet would *land*, not from where they are:
  // walking up a ramp toward a soffit, the question is how much air is left at
  // the top of the step.
  if (opts.headroom !== false) {
    const need = opts.headH ?? HEAD_H;
    if (headroomAt(state, p.x, p.z, support.y, { ...o, structural: true }) < need) return null;
  }
  return { x: p.x, z: p.z, support };
}

// A step, and if it can't be taken whole, the same step along one axis — which
// is what makes walking into a wall at an angle slide along it rather than
// stop dead. Returns where you ended up and what is under you there.
export function moveWalker(state, collider, pos, dx, dz, opts = {}) {
  const site = opts.site || (collider && collider.site) || null;
  const stay = (blocked) => ({
    x: pos.x, z: pos.z, blocked,
    support: supportAt(state, pos.x, pos.z, pos.y, site ? { ...opts, site } : opts),
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
