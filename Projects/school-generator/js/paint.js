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
import { PITCHES, MIN_PITCH } from './snapgrid.js';
import { gridOrigin } from './gridref.js';
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

// ---------- the raster a storey is painted on ----------
//
// The brush used to draw on one raster forever: 4ft cells starting at the
// corner of the sheet. Phase 35 gives it two degrees of freedom, and both of
// them come from the *drawing grid* rather than from here.
//
// **Pitch.** The grid subdivides as you zoom in (snapgrid.js), and a floor
// tile is now one of those squares rather than always a 4ft one. Everything on
// the ladder from 4ft up is a whole number of 4ft cells, so those need nothing
// from the raster; 2ft does, and `state.cellFt` is where the design records
// that it has been drawn at that scale. It only ever gets finer, and only ever
// by whole subdivisions, so a room drawn on the 4ft module is still exactly on
// the raster after a refinement — which is the property that makes this safe
// to do to a plan that already exists.
//
// **Origin.** `gridref.js` lets somebody index the grid off a point on a
// traced photograph. The raster starts where the grid does, which is what
// keeps a painted tile and a drawn wall meeting on the same line. Moving it is
// refused once anything is drawn, for the reason gridref.js gives at length.
//
// The raster always covers the whole sheet — [0, w·CELL] x [0, h·CELL] — and,
// when the origin is not a whole number of pitches from the corner, up to one
// tile past each edge of it. That overhang is the honest answer: the tile the
// grid draws over the sheet's corner is a tile, and refusing to paint it would
// make the corner of a traced plan unreachable.

// What one raster cell is worth in feet. `cellFt` has been on the state since
// v1 and meant nothing until now; an old file says 4 and reads as 4.
export function rasterPitch(state) {
  const v = state && Number(state.cellFt);
  if (!Number.isFinite(v) || !PITCHES.includes(v)) return CELL;
  return Math.min(v, CELL);
}

// The raster for one storey: pitch, where cell (0, 0)'s low corner sits, and
// how many cells it takes to cover the sheet from there.
export function rasterOf(state, floorIndex) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  const pitch = rasterPitch(state);
  const o = gridOrigin(state);
  const W = (floor ? floor.w : 0) * CELL, H = (floor ? floor.h : 0) * CELL;
  const i0 = Math.floor((0 - o.x) / pitch + EPS);
  const j0 = Math.floor((0 - o.z) / pitch + EPS);
  const i1 = Math.ceil((W - o.x) / pitch - EPS);
  const j1 = Math.ceil((H - o.z) / pitch - EPS);
  return {
    pitch,
    x0: o.x + i0 * pitch,
    z0: o.z + j0 * pitch,
    w: Math.max(0, i1 - i0),
    h: Math.max(0, j1 - j0),
  };
}

// The raster every caller that has no state gets: the 4ft module at the
// corner, which is what this file drew on for thirty-four phases.
const DEFAULT_RASTER = Object.freeze({ pitch: CELL, x0: 0, z0: 0 });
const asRaster = (r) => (r && r.pitch > 0 ? r : DEFAULT_RASTER);

// A raster cell's centre, in world feet — what "is this cell inside that room"
// is actually asked about.
export const cellCentre = (r, x, y) => ({
  x: r.x0 + (x + 0.5) * r.pitch,
  z: r.z0 + (y + 0.5) * r.pitch,
});

// Refine the design's raster so a tile this big can be drawn on it. One way
// only: a raster never coarsens, because coarsening would strand every room
// already drawn on the finer one. Returns true if the design changed.
export function refineRaster(state, tileFt) {
  if (!state || !(tileFt > 0)) return false;
  const want = Math.max(MIN_PITCH, Math.min(CELL, tileFt));
  if (!PITCHES.includes(want)) return false;
  if (rasterPitch(state) <= want) return false;
  state.cellFt = want;
  return true;
}

// ---------- which rooms the brush may touch ----------

const onLattice = (v, origin, pitch) =>
  Math.abs((v - origin) / pitch - Math.round((v - origin) / pitch)) < EPS;

// A room the brush can rasterize without changing it: every vertex on the
// raster, every segment along one of its axes.
//
// `raster` defaults to the 4ft module at the corner, so a caller with no
// design in hand asks exactly the question this used to ask. A *finer* raster
// only ever accepts more rooms — 4ft points are 2ft points — which is why
// refining one is safe; a *re-phased* one accepts fewer, which is why moving
// the origin is refused the moment anything is drawn (see gridref.js).
export function latticeAligned(shape, raster) {
  const r = asRaster(raster);
  if (!shape || !Array.isArray(shape.rings) || !shape.rings.length) return false;
  for (const ring of shape.rings) {
    for (let i = 0; i < ring.pts.length; i++) {
      const p = ring.pts[i];
      if (!onLattice(p.x, r.x0, r.pitch) || !onLattice(p.z, r.z0, r.pitch)) return false;
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
  const R = rasterOf(state, floorIndex);
  const lat = createLattice(R.w, R.h, R.pitch, R.x0, R.z0);
  const owner = new Int32Array(R.w * R.h).fill(-1);
  const frozenCell = new Uint8Array(R.w * R.h);
  const rooms = [], frozen = [];
  for (const shape of shapesOf(floor)) (latticeAligned(shape, R) ? rooms : frozen).push(shape);

  const eachCell = (shape, fn) => {
    const bb = shapeBBox(shape);
    const x0 = Math.max(0, Math.floor((bb.x0 - R.x0) / R.pitch));
    const x1 = Math.min(R.w - 1, Math.ceil((bb.x1 - R.x0) / R.pitch));
    const y0 = Math.max(0, Math.floor((bb.z0 - R.z0) / R.pitch));
    const y1 = Math.min(R.h - 1, Math.ceil((bb.z1 - R.z0) / R.pitch));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = cellCentre(R, x, y);
        if (pointInShape(shape, c.x, c.z)) fn(x, y);
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
          const y = Math.round((a.z - R.z0) / R.pitch);
          const lo = Math.round((Math.min(a.x, b.x) - R.x0) / R.pitch);
          const hi = Math.round((Math.max(a.x, b.x) - R.x0) / R.pitch);
          if (y < 0 || y > R.h) continue;
          for (let x = lo; x < hi; x++) {
            if (x >= 0 && x < R.w) lat.edgesH[edgeHIdx(lat, x, y)] = val;
          }
        } else {
          const x = Math.round((a.x - R.x0) / R.pitch);
          const lo = Math.round((Math.min(a.z, b.z) - R.z0) / R.pitch);
          const hi = Math.round((Math.max(a.z, b.z) - R.z0) / R.pitch);
          if (x < 0 || x > R.w) continue;
          for (let y = lo; y < hi; y++) {
            if (y >= 0 && y < R.h) lat.edgesV[edgeVIdx(lat, x, y)] = val;
          }
        }
      }
    }
  }
  return { floor, lat, owner, rooms, frozen, frozenCell, raster: R };
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
        const dot = vx * p.ux + vz * p.uz;
        if (Math.abs(dot) < 1 - 1e-3) continue;
        const hit = projectOnSeg(a, b, p.x, p.z);
        if (hit.dist > snap) continue;
        if (!best || hit.dist < best.dist) {
          // `flip` when the new run goes the other way down the same line:
          // the hinge and the swing side both have to turn round with it, for
          // the reason `bake` gives about `hand` and `sw`.
          best = { ring: ri, seg: i, t: hit.t, dist: hit.dist, flip: dot < 0 };
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
  group: opts.group || null,
  load: null,
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

// Draw or erase a list of raster cells on one storey.
//
// Returns `{ changed, refused, frozen, offSheet, rooms, added, removed }` —
// how many cells the stroke actually moved, how many it declined and for which
// of the two reasons, and what the storey's room list did.
//
// The two reasons are counted apart because they are two different sentences:
// "a free-drawn room is there, use the vertex tool" and "the drawing surface
// ends there, make the plan bigger". `refused` is still their sum, which is
// what every caller before Phase 35 read.
export function paintCells(state, floorIndex, cells, on = true, opts = {}) {
  const out = { changed: 0, refused: 0, frozen: 0, offSheet: 0, rooms: 0, added: 0, removed: 0 };
  const R = rasterize(state, floorIndex);
  if (!R) return out;
  const { floor, lat, owner, rooms, frozen, frozenCell } = R;

  const pending = new Set();
  for (const c of cells || []) {
    const x = Math.floor(c.x), y = Math.floor(c.y);
    if (!inGrid(lat, x, y)) { out.refused++; out.offSheet++; continue; }
    const i = cellIdx(lat, x, y);
    // A free-drawn room is the vertex tool's business, not the brush's.
    if (frozenCell[i]) { out.refused++; out.frozen++; continue; }
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
    let tooBig = false;
    loops.forEach((loop, li) => {
      const ring = { pts: loop.pts, walls: loop.segs.map((sg) => sg.kind), openings: [] };
      // A ring past the cap is dropped — and if it is the *outer* one, the
      // whole room goes with it rather than becoming a room that is only its
      // own courtyard.
      if (ring.pts.length > MAX_RING_PTS) { if (li === 0) tooBig = true; return; }
      orientRing(ring, li === 0);
      shape.rings.push(ring);
    });
    if (tooBig || !shape.rings.length) continue;
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

// The one-cell case, which is what a pointer used to produce.
export const paintCell = (state, floorIndex, x, y, on = true, opts = {}) =>
  paintCells(state, floorIndex, [{ x, y }], on, opts);

// ---------- the brush, in world feet ----------
//
// What the *tools* call, and the reason the raster above is nobody else's
// business. A tool has a grid tile — a square of the drawing grid, at whatever
// pitch the zoom is showing — and hands over its corners in feet; how many
// raster cells that turns out to be, and whether the design has to be refined
// to hold it, are answered here.
//
// Rectangles rather than cells is not a convenience. A drag used to call
// `paintCell` once per 4ft square it crossed, and every one of those calls
// rasterized the whole storey and traced every region on it — so a 20 x 20
// rectangle was four hundred full repaints. One call is one repaint.

// The tiles, as raster cells. A tile is a whole number of raster cells and
// starts on one, so the rounding here is exact rather than tolerant.
function tileCells(R, tiles) {
  const out = [];
  const seen = new Set();
  for (const t of tiles || []) {
    if (!t) continue;
    const i0 = Math.round((Math.min(t.x0, t.x1) - R.x0) / R.pitch);
    const i1 = Math.round((Math.max(t.x0, t.x1) - R.x0) / R.pitch);
    const j0 = Math.round((Math.min(t.z0, t.z1) - R.z0) / R.pitch);
    const j1 = Math.round((Math.max(t.z0, t.z1) - R.z0) / R.pitch);
    for (let y = j0; y < Math.max(j1, j0 + 1); y++) {
      for (let x = i0; x < Math.max(i1, i0 + 1); x++) {
        const k = `${x},${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x, y });
      }
    }
  }
  return out;
}

// The smallest side any of these tiles has, which is what the raster has to be
// fine enough to hold.
function finestTile(tiles) {
  let min = Infinity;
  for (const t of tiles || []) {
    if (!t) continue;
    min = Math.min(min, Math.abs(t.x1 - t.x0), Math.abs(t.z1 - t.z0));
  }
  return Number.isFinite(min) ? min : CELL;
}

// Draw or erase a list of world-feet squares on one storey. `tiles` are
// `{ x0, z0, x1, z1 }` — grid tiles, from `tileBounds`/`spanBounds` in
// snapgrid.js — and the design's raster is refined first if one of them is
// finer than the raster currently is.
export function paintTiles(state, floorIndex, tiles, on = true, opts = {}) {
  const list = (tiles || []).filter(Boolean);
  if (!list.length) {
    return {
      changed: 0, refused: 0, frozen: 0, offSheet: 0,
      frozenTiles: 0, offSheetTiles: 0, rooms: 0, added: 0, removed: 0,
    };
  }
  const side = finestTile(list);
  refineRaster(state, side);
  const R = rasterOf(state, floorIndex);
  const out = paintCells(state, floorIndex, tileCells(R, list), on, opts);
  // The refusals count raster cells, and a caller that handed over tiles wants
  // to hear about tiles. Every tile in one gesture is the same size — it is
  // one zoom's worth of grid — so this is a division rather than a tally.
  //
  // The two round differently on purpose. A tile a free-drawn room sits in is
  // refused whole, so `frozen` is always a multiple of `per` and rounding is
  // exact. A tile is *clipped* rather than refused when it straddles the edge
  // of the sheet — which is what a coarse tile at the border does, and what
  // any tile at the border does on a grid phased onto a photograph — so a part
  // count floors to nothing and only a tile wholly off the plan is reported.
  const per = Math.max(1, Math.round((side / R.pitch) ** 2));
  out.frozenTiles = Math.round(out.frozen / per);
  out.offSheetTiles = Math.floor(out.offSheet / per);
  return out;
}

// Is there a room the brush would refuse to touch at this point? The editor
// asks so it can say why nothing happened.
export function frozenAtPoint(state, floorIndex, wx, wz) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  if (!floor) return null;
  const R = rasterOf(state, floorIndex);
  for (const shape of shapesOf(floor)) {
    if (latticeAligned(shape, R)) continue;
    if (pointInShape(shape, wx, wz)) return shape;
  }
  return null;
}

// The same question about a raster cell, which is how it was always asked.
export function frozenAt(state, floorIndex, x, y) {
  const R = rasterOf(state, floorIndex);
  const c = cellCentre(R, Math.floor(x), Math.floor(y));
  return frozenAtPoint(state, floorIndex, c.x, c.z);
}
