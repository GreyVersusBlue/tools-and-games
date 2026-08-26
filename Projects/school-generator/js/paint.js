// paint.js — the 4ft brush, over rooms that own their own outlines.
//
// The lattice is gone as a *representation* (see lattice.js) and kept as a
// *gesture*. Dragging a 4ft brush across a plan is the fastest way anybody has
// found to draw a rectangular school, and nothing about Phase 12 proposed to
// lose it. What changed is what it paints: a cell is no longer a thing in the
// file, it is one step of an edit to a polygon room's ring.
//
// The round trip is the whole module:
//
//   rasterize   every lattice-aligned room on the storey, back onto a scratch
//               lattice — its cells, and the walls it built on its boundary
//   edit        set or clear the cells the stroke touched
//   bake        trace each region back out to a ring, keeping the room record
//               (and therefore the id) the cells belonged to
//   reapply     put the openings back by *where they are*, not by which
//               segment index they used to be on
//
// Four things are worth saying about it, because each one is a decision that
// could have gone the other way.
//
// **A room that is not on the lattice is not painted.** A free-drawn room —
// angled, curved, dragged off the grid — cannot be rasterized without being
// straightened, so it is frozen: the brush refuses a cell inside one and says
// so, and the vertex tool remains how such a room is edited. `latticeAligned`
// is the exact test, and it is exact on purpose: every vertex on a 4ft
// multiple, every segment axis-aligned. Anything else round-trips to a
// different building.
//
// **Painted cells join the room next door; they never merge two rooms.** A new
// cell takes its owner from whichever neighbour it can walk to, spreading
// outward from the rooms that already exist. Two rooms that happen to sit
// against each other with no wall between them stay two rooms, because they
// have ids now and merging one into the other would silently delete a record
// somebody else's timetable, cost table or session might be pointing at. The
// lattice could not have said that; this is the first thing identity buys.
//
// **Doors are put back by position.** A ring's segments are renumbered by any
// edit that changes its shape, so an opening's `seg` is worthless across a
// repaint. Its *point in the world* is not: an opening lands on whichever new
// segment runs through it, with its width, its kind and its hand intact — and
// its hand flipped if that segment happens to run the other way, which is the
// same correction `bake` makes for the same reason.
//
// **A wall that stops bounding a room stops existing.** Erase the last cell
// under a wall and the wall goes with it, exactly as it does in a bake: a
// boundary is a room's edge here, and there is nothing else for it to be.
//
// Pure module: no three.js. Exercised by test/paint.test.mjs.

import { CELL } from './grid.js';
import {
  createLattice, setTile, cellIdx, edgeHIdx, edgeVIdx, inGrid,
  traceRegion, EDGE_NONE, EDGE_WALL, EDGE_GLASS, EDGE_RAIL,
} from './lattice.js';
import {
  shapesOf, shapeBBox, pointInShape, segEnds, segLength, isBuilt, projectOnSeg,
  orientRing, takeId, writeOpening, openingSpec, isDoorOpening,
  SEG_WALL, SEG_GLASS, SEG_RAIL, MAX_SHAPES, MAX_RING_PTS, LEAF_NONE,
} from './shapes.js';

const EPS = 1e-6;

// How far off a new wall an old doorway may be and still be the same doorway.
// Half a wall thickness plus a hair: a repaint moves a boundary by nothing at
// all, so this only has to absorb the difference between a segment's own line
// and the one it replaced.
export const OPENING_SNAP = 0.6;   // ft

// ---------- which rooms the brush may touch ----------

const onLattice = (v) => Math.abs(v / CELL - Math.round(v / CELL)) < EPS;

// A room the 4ft brush can rasterize without changing it: every vertex on the
// lattice, every segment along one of its axes.
export function latticeAligned(shape) {
  if (!shape || !Array.isArray(shape.rings) || !shape.rings.length) return false;
  for (const ring of shape.rings) {
    for (let i = 0; i < ring.pts.length; i++) {
      const p = ring.pts[i];
      if (!onLattice(p.x) || !onLattice(p.z)) return false;
      const [a, b] = segEnds(ring, i);
      const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
      if (dx > EPS && dz > EPS) return false;
    }
  }
  return true;
}

// What the lattice writes for a segment built this way. Openings are left out
// on purpose — they go back on by position afterwards, which is the only way
// to keep a door that isn't in the middle of its cell.
const edgeForSeg = (v) => (v === SEG_GLASS ? EDGE_GLASS : v === SEG_RAIL ? EDGE_RAIL : EDGE_WALL);

// ---------- rasterizing ----------

// The storey, back on a lattice: which cells each aligned room covers, and
// which edges it built. `owner[i]` indexes `rooms`; -1 is bare lattice.
export function rasterize(state, floorIndex) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  if (!floor) return null;
  const lat = createLattice(floor.w, floor.h);
  const owner = new Int32Array(floor.w * floor.h).fill(-1);
  const frozenCell = new Uint8Array(floor.w * floor.h);
  const rooms = [], frozen = [];
  for (const shape of shapesOf(floor)) (latticeAligned(shape) ? rooms : frozen).push(shape);

  const eachCell = (shape, fn) => {
    const bb = shapeBBox(shape);
    const x0 = Math.max(0, Math.floor(bb.x0 / CELL));
    const x1 = Math.min(floor.w - 1, Math.ceil(bb.x1 / CELL));
    const y0 = Math.max(0, Math.floor(bb.z0 / CELL));
    const y1 = Math.min(floor.h - 1, Math.ceil(bb.z1 / CELL));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (pointInShape(shape, (x + 0.5) * CELL, (y + 0.5) * CELL)) fn(x, y);
      }
    }
  };

  // Later rooms win the cells they overlap, exactly as `shapeAt` says they do.
  rooms.forEach((shape, ri) => eachCell(shape, (x, y) => {
    const i = cellIdx(lat, x, y);
    setTile(lat, x, y, true);
    owner[i] = ri;
    lat.cells[i].room = shape.name;
    lat.cells[i].color = shape.color;
    lat.cells[i].fin = shape.fin || null;
    lat.cells[i].paint = shape.paint || null;
  }));
  for (const shape of frozen) eachCell(shape, (x, y) => { frozenCell[cellIdx(lat, x, y)] = 1; });

  for (const shape of rooms) {
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        if (!isBuilt(ring.walls[i])) continue;
        const [a, b] = segEnds(ring, i);
        const val = edgeForSeg(ring.walls[i]);
        if (Math.abs(a.z - b.z) < EPS) {
          const y = Math.round(a.z / CELL);
          const lo = Math.round(Math.min(a.x, b.x) / CELL);
          const hi = Math.round(Math.max(a.x, b.x) / CELL);
          if (y < 0 || y > floor.h) continue;
          for (let x = lo; x < hi; x++) {
            if (x >= 0 && x < floor.w) lat.edgesH[edgeHIdx(lat, x, y)] = val;
          }
        } else {
          const x = Math.round(a.x / CELL);
          const lo = Math.round(Math.min(a.z, b.z) / CELL);
          const hi = Math.round(Math.max(a.z, b.z) / CELL);
          if (x < 0 || x > floor.w) continue;
          for (let y = lo; y < hi; y++) {
            if (y >= 0 && y < floor.h) lat.edgesV[edgeVIdx(lat, x, y)] = val;
          }
        }
      }
    }
  }
  return { floor, lat, owner, rooms, frozen, frozenCell };
}

// ---------- regions, by owner ----------

const NEIGH = [
  { dx: 0, dy: -1, edge: (lat, x, y) => ({ arr: lat.edgesH, i: edgeHIdx(lat, x, y) }) },
  { dx: -1, dy: 0, edge: (lat, x, y) => ({ arr: lat.edgesV, i: edgeVIdx(lat, x, y) }) },
  { dx: 0, dy: 1, edge: (lat, x, y) => ({ arr: lat.edgesH, i: edgeHIdx(lat, x, y + 1) }) },
  { dx: 1, dy: 0, edge: (lat, x, y) => ({ arr: lat.edgesV, i: edgeVIdx(lat, x + 1, y) }) },
];

const openBetween = (lat, x, y, d) => {
  const e = d.edge(lat, x, y);
  return e.arr[e.i] === EDGE_NONE;
};

// Every connected patch of cells that share an owner, bounded by anything on
// an edge. Ordered by lowest cell, which is what makes a repaint repeatable
// and what decides who claims a shared wall.
export function ownedRegions(lat, owner) {
  const seen = new Uint8Array(lat.w * lat.h);
  const out = [];
  for (let y = 0; y < lat.h; y++) {
    for (let x = 0; x < lat.w; x++) {
      const i = cellIdx(lat, x, y);
      if (seen[i] || !lat.cells[i]) continue;
      const who = owner[i];
      const cells = [];
      const stack = [{ x, y }];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        for (const d of NEIGH) {
          const nx = c.x + d.dx, ny = c.y + d.dy;
          if (!inGrid(lat, nx, ny)) continue;
          const ni = cellIdx(lat, nx, ny);
          if (seen[ni] || !lat.cells[ni] || owner[ni] !== who) continue;
          if (!openBetween(lat, c.x, c.y, d)) continue;
          seen[ni] = 1;
          stack.push({ x: nx, y: ny });
        }
      }
      out.push({ owner: who, cells });
    }
  }
  return out;
}

// ---------- putting the doors back ----------

// Every opening a room had, as a point in the world plus what it was.
function openingPoints(shape) {
  const out = [];
  for (const ring of shape.rings) {
    for (const o of ring.openings) {
      if (!isBuilt(ring.walls[o.seg])) continue;
      const [a, b] = segEnds(ring, o.seg);
      const len = segLength(a, b);
      if (len < EPS) continue;
      out.push({
        x: a.x + (b.x - a.x) * o.t,
        z: a.z + (b.z - a.z) * o.t,
        ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
        w: o.w, opts: { ...o },
      });
    }
  }
  return out;
}

// Put them back on whichever built segment now runs through them. An opening
// whose wall was erased has nowhere to go and is dropped — the same call
// `setSegWall` and `deleteVertex` already make.
export function reapplyOpenings(shape, points, snap = OPENING_SNAP) {
  let placed = 0, lost = 0;
  for (const p of points) {
    let best = null;
    shape.rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.pts.length; i++) {
        if (!isBuilt(ring.walls[i])) continue;
        const [a, b] = segEnds(ring, i);
        const len = segLength(a, b);
        if (len < p.w + 0.5) continue;
        const vx = (b.x - a.x) / len, vz = (b.z - a.z) / len;
        // Same line, either direction: an opening is a hole in a wall, and a
        // wall does not care which way its run was written down.
        const along = Math.abs(vx * p.ux + vz * p.uz);
        if (along < 1 - 1e-3) continue;
        const hit = projectOnSeg(a, b, p.x, p.z);
        if (hit.dist > snap) continue;
        if (!best || hit.dist < best.dist) {
          best = { ring: ri, seg: i, t: hit.t, dist: hit.dist, flip: along > 0 && (vx * p.ux + vz * p.uz) < 0 };
        }
      }
    });
    if (!best) { lost++; continue; }
    const opts = { ...p.opts };
    const spec = openingSpec(p.opts);
    if (best.flip && !spec.window && spec.leaf !== LEAF_NONE) {
      opts.hand = spec.hand === 1 ? -1 : 1;
      opts.sw = spec.sw === 1 ? -1 : 1;
    }
    // Keep it off the ends of its run, the way `addOpening` would.
    const ring = shape.rings[best.ring];
    const [a, b] = segEnds(ring, best.seg);
    const len = segLength(a, b);
    const half = (p.w / 2 + 0.25) / len;
    const t = Math.min(1 - half, Math.max(half, best.t));
    ring.openings.push(writeOpening(best.seg, t, p.w, opts));
    placed++;
  }
  return { placed, lost };
}

// ---------- the brush ----------

// A fresh record for a region the brush created out of nothing.
const newRoom = (state, opts) => ({
  id: takeId(state),
  name: opts.name || null,
  color: opts.color || null,
  fin: opts.fin || null,
  paint: opts.paint || null,
  rings: [],
});

// Give every cell the stroke drew an owner, by spreading outward from the
// rooms that already exist. A cell that can reach a room joins it; a cell that
// can reach nothing starts one.
function assignOwners(lat, owner, pending, rooms, state, opts, made) {
  const queue = [];
  for (let y = 0; y < lat.h; y++) {
    for (let x = 0; x < lat.w; x++) {
      const i = cellIdx(lat, x, y);
      if (lat.cells[i] && owner[i] >= 0) queue.push({ x, y });
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const who = owner[cellIdx(lat, c.x, c.y)];
    for (const d of NEIGH) {
      const nx = c.x + d.dx, ny = c.y + d.dy;
      if (!inGrid(lat, nx, ny)) continue;
      const ni = cellIdx(lat, nx, ny);
      if (!lat.cells[ni] || owner[ni] >= 0 || !pending.has(ni)) continue;
      if (!openBetween(lat, c.x, c.y, d)) continue;
      owner[ni] = who;
      queue.push({ x: nx, y: ny });
    }
  }
  // Whatever is left reached no room at all: each connected patch of it is a
  // new one.
  for (const i of pending) {
    if (owner[i] >= 0 || !lat.cells[i]) continue;
    if (rooms.length >= MAX_SHAPES) break;
    const who = rooms.length;
    rooms.push(newRoom(state, opts));
    made.add(who);
    const stack = [{ x: i % lat.w, y: Math.floor(i / lat.w) }];
    owner[i] = who;
    while (stack.length) {
      const c = stack.pop();
      for (const d of NEIGH) {
        const nx = c.x + d.dx, ny = c.y + d.dy;
        if (!inGrid(lat, nx, ny)) continue;
        const ni = cellIdx(lat, nx, ny);
        if (!lat.cells[ni] || owner[ni] >= 0 || !pending.has(ni)) continue;
        if (!openBetween(lat, c.x, c.y, d)) continue;
        owner[ni] = who;
        stack.push({ x: nx, y: ny });
      }
    }
  }
}

// Draw or erase a list of 4ft cells on one storey.
//
// Returns `{ changed, refused, rooms, added, removed }` — how many cells the
// stroke actually moved, how many it declined (off the lattice, or inside a
// free-drawn room), and what the storey's room list did.
export function paintCells(state, floorIndex, cells, on = true, opts = {}) {
  const out = { changed: 0, refused: 0, rooms: 0, added: 0, removed: 0 };
  const R = rasterize(state, floorIndex);
  if (!R) return out;
  const { floor, lat, owner, rooms, frozen, frozenCell } = R;

  const pending = new Set();
  for (const c of cells || []) {
    const x = Math.floor(c.x), y = Math.floor(c.y);
    if (!inGrid(lat, x, y)) { out.refused++; continue; }
    const i = cellIdx(lat, x, y);
    // A free-drawn room is the vertex tool's business, not the brush's.
    if (frozenCell[i]) { out.refused++; continue; }
    if (on) {
      if (lat.cells[i]) continue;
      setTile(lat, x, y, true);
      pending.add(i);
      out.changed++;
    } else {
      if (!lat.cells[i]) continue;
      setTile(lat, x, y, false);
      owner[i] = -1;
      out.changed++;
    }
  }
  if (!out.changed) return out;

  const made = new Set();
  assignOwners(lat, owner, pending, rooms, state, opts, made);

  // A wall the stroke stranded — nothing on either side of it now — goes with
  // the floor it was bounding, because `traceRegion` only ever writes a wall
  // onto a boundary some room actually has.
  const regions = ownedRegions(lat, owner);
  const claimed = new Set();
  const built = new Map();     // owner index -> [shape, ...]
  for (const region of regions) {
    const loops = traceRegion(lat, region.cells, claimed);
    if (!loops.length) continue;
    const record = rooms[region.owner];
    if (!record) continue;
    const list = built.get(region.owner) || [];
    // The first region of a room keeps its record; a room the stroke cut in
    // two hands the second half a fresh id and everything else about itself.
    const shape = list.length
      ? { ...record, id: takeId(state), rings: [] }
      : { ...record, rings: [] };
    loops.forEach((loop, li) => {
      const ring = { pts: loop.pts, walls: loop.segs.map((sg) => sg.kind), openings: [] };
      if (ring.pts.length > MAX_RING_PTS) return;
      orientRing(ring, li === 0);
      shape.rings.push(ring);
    });
    if (!shape.rings.length) continue;
    list.push(shape);
    built.set(region.owner, list);
  }

  // The doorways, put back where they are rather than where their index was.
  rooms.forEach((record, ri) => {
    if (made.has(ri) || !built.has(ri)) return;
    const points = openingPoints(record);
    if (!points.length) return;
    for (const shape of built.get(ri)) reapplyOpenings(shape, points);
  });

  // Rebuild the storey's room list in the order it was in, so a room drawn on
  // top of another is still on top of it.
  const replaced = new Map();
  rooms.forEach((record, ri) => { if (record.id) replaced.set(record.id, built.get(ri) || []); });
  const next = [];
  for (const shape of floor.shapes) {
    if (frozen.includes(shape)) { next.push(shape); continue; }
    const repl = replaced.get(shape.id);
    if (repl && repl.length) next.push(...repl);
    else out.removed++;
  }
  for (const ri of made) {
    const list = built.get(ri);
    if (list && list.length) { next.push(...list); out.added += list.length; }
  }
  floor.shapes = next.slice(0, MAX_SHAPES);
  out.rooms = floor.shapes.length;
  return out;
}

// The one-cell case, which is what a pointer actually produces.
export const paintCell = (state, floorIndex, x, y, on = true, opts = {}) =>
  paintCells(state, floorIndex, [{ x, y }], on, opts);

// Is there a room the brush would refuse to touch under this cell? The editor
// asks so it can say why nothing happened.
export function frozenAt(state, floorIndex, x, y) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  if (!floor) return null;
  const cx = (Math.floor(x) + 0.5) * CELL, cz = (Math.floor(y) + 0.5) * CELL;
  for (const shape of shapesOf(floor)) {
    if (latticeAligned(shape)) continue;
    if (pointInShape(shape, cx, cz)) return shape;
  }
  return null;
}
