// sightline.js — is that door visible from here?
//
// Phase 21. Room labels are `depthTest:false` sprites, which is right for
// readability and wrong for honesty: in walk mode they named rooms through
// the walls that hide them. This module is the gate that makes a label
// something the walker earned — and it is the module Phase 24 has been
// promised, because a creature that prefers the corridor you are not looking
// down asks exactly this question with the arguments swapped.
//
// The question is answered in plan: 2D segment casts against one storey's
// occluders, storey-aware because the caller asks per storey. Sight has its
// own idea of what a wall is, and it is deliberately *not* collide.js's:
//
//   - **Glass and railings stop a body and not a look.** `wallSegments` puts
//     a curtain wall in the collider with drywall, which is right for walking
//     and would be a lie here — a room you can see into through its glazed
//     partition is a room you have seen.
//   - **A window is a hole in the elevation**, so whether sight passes
//     depends on where the eye is in it: a 3ft-sill classroom window lets a
//     5.5ft eye through, a clerestory does not. The body never fits either
//     way, which is why collide.js never cuts one.
//   - **A door leaf occludes at whatever angle it is hanging right now.** A
//     closed leaf spans its doorway and blocks it; an open one stands along
//     the jamb and blocks almost nothing — both fall out of casting against
//     `leafSegment` at the leaf's live `open`, so an agent holding a door
//     open is see-through-able *because* the crowd is holding it open. The
//     caller hands in the collider's own leaves, never a fresh collection:
//     the leaf's state is the walk's, not the plan's.
//
// Pure module: no three.js, no DOM. The segment-crossing primitive is
// collide.js's `segsCross` — one implementation of "do two segments cross"
// in the codebase, not two that disagree at the endpoints.
//
// `makeLabelGate` at the bottom is the session half: which rooms a walk has
// earned, refreshed a few casts per frame round-robin, because the walker
// moves at walking speed and nothing needs a fresh answer every 16ms. It is
// still pure state-machine over the geometry above — the tests drive it
// headless, the way every tool-shaped module here is driven.

import {
  shapesOf, segEnds, isBuilt, isDoorOpening, openingSpec, shapeAt,
  SEG_WALL,
} from './shapes.js';
import { EYE_H } from './grid.js';
import { solidSpans, segsCross, elevatorSegments } from './collide.js';
import { leafSegment, windowBand } from './openings.js';

// How far either side of a doorway to probe when asking which rooms it
// joins — clear of the thickest exterior wall, inside anything a door could
// reasonably open into. The same job navgraph.js's portal probe does.
export const DOOR_PROBE = 2;      // ft
// How far past a doorway's centreline the cast reaches. The target has to be
// on the *far* side of the wall or a shut leaf lying exactly on the line
// would never strictly cross the ray that ends on it.
export const DOOR_PAST = 0.6;     // ft

// ---------- what occludes ----------

// One storey's sight-blocking segments, from the same rings collide.js walks.
// Only solid walls block; door openings are holes (their leaves are cast
// separately, live); a window is a hole only where the eye height falls
// within its band. No trim on the spans — sight has no radius.
export function sightSegments(floor, opts = {}) {
  const eyeH = opts.eyeH ?? EYE_H;
  const out = [];
  if (!floor) return out;

  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        const kind = ring.walls[i];
        if (!isBuilt(kind)) continue;
        // Glass and railings pass sight whole — nothing of them to emit.
        if (kind !== SEG_WALL) continue;
        const [a, b] = segEnds(ring, i);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.01) continue;
        const cuts = [];
        for (const o of ring.openings) {
          if (o.seg !== i) continue;
          const spec = openingSpec(o);
          if (!isDoorOpening(o)) {
            // A window: see through it only if the eye is within the band.
            const band = windowBand(spec);
            if (eyeH < band.sill || eyeH > band.head) continue;
          }
          cuts.push({ a: spec.t * len - spec.w / 2, b: spec.t * len + spec.w / 2 });
        }
        if (!cuts.length) { out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z }); continue; }
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        for (const [s, e] of solidSpans(len, cuts, 0)) {
          out.push({ ax: a.x + ux * s, az: a.z + uz * s, bx: a.x + ux * e, bz: a.z + uz * e });
        }
      }
    }
  }
  return out;
}

// The storey's occluders with the lift shafts added — three sheet-metal walls
// a look does not pass through. This is the list a caller casts against.
export function sightBlockers(state, floorIndex, opts = {}) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  const out = sightSegments(floor, opts);
  for (const s of elevatorSegments(state, floorIndex)) {
    out.push({ ax: s.ax, az: s.az, bx: s.bx, bz: s.bz });
  }
  return out;
}

// ---------- the cast ----------

// Does an unobstructed line run from (x0, z0) to (x1, z1)? `leaves` is the
// collider's live list for the same storey — pass it or the doors don't
// exist, which is the pre-walk plan rather than the walk.
export function sightClear(segs, leaves, x0, z0, x1, z1) {
  for (const s of segs) {
    if (segsCross(x0, z0, x1, z1, s.ax, s.az, s.bx, s.bz)) return false;
  }
  if (leaves) {
    for (const leaf of leaves) {
      const s = leafSegment(leaf);
      if (segsCross(x0, z0, x1, z1, s.ax, s.az, s.bx, s.bz)) return false;
    }
  }
  return true;
}

// ---------- the doors ----------

// Every doorway on one storey: its centre, its wall's unit normal, and the
// rooms either side of it (by shape id; null for the outdoors). A door on a
// shared partition belongs to the sight of *both* rooms it joins, whichever
// ring happens to carry the record — the partition-ownership convention is
// about who builds the wall, not about who may be seen through the hole.
export function doorPoints(state, floorIndex) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  const out = [];
  if (!floor) return out;

  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (const o of ring.openings) {
        if (!isDoorOpening(o)) continue;
        if (!isBuilt(ring.walls[o.seg])) continue;
        const [a, b] = segEnds(ring, o.seg);
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const x = a.x + dx * o.t, z = a.z + dz * o.t;
        const nx = -dz / len, nz = dx / len;
        const ra = shapeAt(floor, x + nx * DOOR_PROBE, z + nz * DOOR_PROBE);
        const rb = shapeAt(floor, x - nx * DOOR_PROBE, z - nz * DOOR_PROBE);
        out.push({
          x, z, nx, nz, w: o.w,
          rooms: [ra ? ra.id : null, rb ? rb.id : null],
        });
      }
    }
  }
  return out;
}

// Is this door visible from the eye? The cast reaches just *past* the
// doorway's centreline, on the far side from the eye — through the hole the
// wall spans leave, through (or into) whatever leaf is hanging in it.
export function doorSeen(segs, leaves, eye, door, opts = {}) {
  const past = opts.past ?? DOOR_PAST;
  const side = Math.sign((eye.x - door.x) * door.nx + (eye.z - door.z) * door.nz) || 1;
  return sightClear(segs, leaves, eye.x, eye.z,
    door.x - door.nx * side * past, door.z - door.nz * side * past);
}

// ---------- the gate ----------

export const LABEL_MODES = ['earned', 'strict', 'all', 'none'];

// The walk's memory of what it has seen. One per walk — earned labels last
// exactly as long as the colliders do, and are forgotten with them.
//
//   update(eye, leaves, mode)      a few casts, round-robin; returns rooms
//                                  newly seen this call
//   visible(floor, roomId, mode)   should this room's label show?
//
// `eye` is `{ x, z, floor }`; `leaves` is the collider's live door list for
// that storey. Two modes do work: *earned* casts only for rooms not yet
// seen — a label learned is a label kept — and *strict* keeps refreshing
// every room on the storey, so a label lasts only as long as its door stays
// in sight. *all* and *none* cast nothing and answer flatly.
export function makeLabelGate(state, opts = {}) {
  const eyeH = opts.eyeH ?? EYE_H;
  // Casts per update. Walking speed is 12ft/s and a frame is 16ms — four
  // rooms a frame walks the whole round-robin faster than a doorway crosses
  // the view.
  const budget = opts.budget ?? 4;
  const floors = new Map();     // floorIndex -> { segs, rooms, doorsOf }
  const seen = new Set();       // `${floor}:${roomId}`, for the walk
  const lit = new Map();        // same key -> currently-in-sight, for strict
  let cursor = 0;

  const key = (floorIndex, roomId) => `${floorIndex}:${roomId}`;

  // Derived once per storey per walk — editing and walking are exclusive, so
  // nothing under this can change until the gate is thrown away.
  const floorData = (i) => {
    let fd = floors.get(i);
    if (fd) return fd;
    const floor = state.floors[i] || null;
    const doorsOf = new Map();
    for (const d of doorPoints(state, i)) {
      for (const id of d.rooms) {
        if (id === null || id === undefined) continue;
        let list = doorsOf.get(id);
        if (!list) { list = []; doorsOf.set(id, list); }
        list.push(d);
      }
    }
    fd = {
      floor,
      segs: sightBlockers(state, i, { eyeH }),
      rooms: floor ? shapesOf(floor).map((s) => s.id) : [],
      doorsOf,
    };
    floors.set(i, fd);
    return fd;
  };

  const roomSeen = (fd, eye, leaves, roomId) => {
    const doors = fd.doorsOf.get(roomId);
    if (!doors) return false;
    // Nearest first: the door you are looking at is almost always the one
    // that answers, and the first clear cast ends the question.
    const sorted = doors.length > 1
      ? [...doors].sort((p, q) =>
        Math.hypot(p.x - eye.x, p.z - eye.z) - Math.hypot(q.x - eye.x, q.z - eye.z))
      : doors;
    for (const d of sorted) {
      if (doorSeen(fd.segs, leaves, eye, d)) return true;
    }
    return false;
  };

  return {
    seen,
    update(eye, leaves, mode = 'earned') {
      if (mode !== 'earned' && mode !== 'strict') return [];
      const fd = floorData(eye.floor);
      if (!fd.floor) return [];
      const fresh = [];
      const mark = (roomId) => {
        const k = key(eye.floor, roomId);
        lit.set(k, true);
        if (!seen.has(k)) { seen.add(k); fresh.push(roomId); }
      };
      // The room underfoot is earned by standing in it — the spawn room, and
      // any room with no door at all that a ghost drifted into.
      const here = shapeAt(fd.floor, eye.x, eye.z);
      if (here) mark(here.id);
      // Round-robin over what still needs an answer: everything unseen
      // (earned), or everything (strict, which is re-earned every lap).
      const todo = mode === 'earned'
        ? fd.rooms.filter((id) => !seen.has(key(eye.floor, id)))
        : fd.rooms;
      if (!todo.length) return fresh;
      const n = Math.min(budget, todo.length);
      for (let c = 0; c < n; c++) {
        const roomId = todo[(cursor + c) % todo.length];
        if (here && roomId === here.id) continue;
        if (roomSeen(fd, eye, leaves, roomId)) mark(roomId);
        else lit.set(key(eye.floor, roomId), false);
      }
      cursor = (cursor + n) % Math.max(1, todo.length);
      return fresh;
    },
    visible(floorIndex, roomId, mode = 'earned') {
      if (mode === 'all') return true;
      if (mode === 'none') return false;
      if (mode === 'strict') return lit.get(key(floorIndex, roomId)) === true;
      return seen.has(key(floorIndex, roomId));
    },
  };
}
