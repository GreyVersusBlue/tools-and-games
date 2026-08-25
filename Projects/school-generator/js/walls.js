// walls.js — how thick a wall is, and why.
//
// Phase 2 wants interior partitions and exterior walls to read differently:
// 0.4ft of stud wall between two classrooms, 0.8ft of assembly where the
// building meets the weather. The obvious way to do that is a field on every
// boundary — and it is the wrong way, for the same reason stair cuts and
// guardrails aren't fields either: the answer is already in the model. A wall
// with a room on both sides is a partition. A wall with a room on one side and
// nothing on the other is the outside of the building. Nobody has to say so,
// and nobody has to keep saying so as the plan changes: draw a new wing up
// against an exterior wall and it becomes an interior one on the next rebuild.
//
// So thickness is *probed*, not stored. That is the third time this codebase
// has taken that trade (see `floorCuts`, `openingRails`) and it buys the same
// thing every time: no migration, no stale field, no invalid state.
//
// The one cost is that this runs over every boundary on a storey during a
// rebuild, and each probe is a `floorSolidAt` — a cell lookup plus a
// point-in-polygon walk. `wallProbe()` hands back a memoized probe so a
// rebuild pays for each distinct boundary once rather than once per consumer.
//
// Pure module: no three.js. Exercised by test/walls.test.mjs.

import { CELL, WALL_T_INT, WALL_T_EXT } from './grid.js';
import { floorSolidAt } from './shapes.js';

export { WALL_T_INT, WALL_T_EXT };

// How far off a boundary to look for floor. Under half a cell, so the sample
// clears the wall itself and still lands inside the 4ft cell next door.
export const PROBE = 1.2;        // ft
// Where along the run to take those samples. A wall is one thing along its
// whole length here — openings have already split a run into spans by the time
// anything asks — so three points and a majority is steadier than the midpoint
// alone against a room that only backs part of it.
const SAMPLE_TS = [0.25, 0.5, 0.75];
const MAJORITY = 2;

// ---------- the probe ----------

// Is there a room on the given side of this segment? `side` is +1 for the
// left-hand normal (in (x, z), 90° counter-clockwise from the run) and -1 for
// the right.
export function solidBeside(floor, ax, az, bx, bz, side, probe = PROBE) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const nx = (-dz / len) * side * probe, nz = (dx / len) * side * probe;
  let hits = 0;
  for (const t of SAMPLE_TS) {
    if (floorSolidAt(floor, ax + dx * t + nx, az + dz * t + nz)) hits++;
    if (hits >= MAJORITY) return true;
  }
  return false;
}

// True when this boundary has open air on at least one side of it.
export function isExteriorSeg(floor, ax, az, bx, bz, probe = PROBE) {
  return !(solidBeside(floor, ax, az, bx, bz, 1, probe) &&
           solidBeside(floor, ax, az, bx, bz, -1, probe));
}

// The thickness a boundary is actually built at. A free-standing wall with
// nothing on either side reads as exterior: it is more likely a garden wall or
// the start of a wing than a partition between two rooms that don't exist.
export function segThickness(floor, ax, az, bx, bz, probe = PROBE) {
  return isExteriorSeg(floor, ax, az, bx, bz, probe) ? WALL_T_EXT : WALL_T_INT;
}

// A memoized `segThickness` for one storey. Keyed on the run's midpoint and
// direction rounded to a tenth of a foot: two consumers asking about the same
// wall ask about the same numbers, and two genuinely different walls never
// round together at building scale.
export function wallProbe(floor, probe = PROBE) {
  const cache = new Map();
  const fn = (ax, az, bx, bz) => {
    const key = `${Math.round((ax + bx) * 5)},${Math.round((az + bz) * 5)},` +
      `${Math.round((bx - ax) * 5)},${Math.round((bz - az) * 5)}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = segThickness(floor, ax, az, bx, bz, probe);
      cache.set(key, v);
    }
    return v;
  };
  fn.exterior = (ax, az, bx, bz) => fn(ax, az, bx, bz) === WALL_T_EXT;
  fn.cache = cache;
  return fn;
}

// A probe that always answers the same thing — for callers that want the old
// single-thickness behaviour, and for tests that care about one variable at a
// time.
export function fixedProbe(t) {
  const fn = () => t;
  fn.exterior = () => t === WALL_T_EXT;
  return fn;
}

// A grid edge, as the segment the probe wants. `horizontal` matches the
// lattice's own convention: edgesH run along +X between two rows.
export function gridEdgeSeg(x, y, horizontal, cell = CELL) {
  return horizontal
    ? { ax: x * cell, az: y * cell, bx: (x + 1) * cell, bz: y * cell }
    : { ax: x * cell, az: y * cell, bx: x * cell, bz: (y + 1) * cell };
}
