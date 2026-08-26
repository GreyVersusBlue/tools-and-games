// lattice.js — the 4ft drawing surface, and the one place it becomes rooms.
//
// For nineteen phases a floor carried two room representations side by side:
// a cell lattice with walls on its edges, and `shapes[]` — polygon rooms that
// own their own outlines. Every shared tool handled both, forever, and the
// wishlist's standing tax was paid on each new feature rather than once.
//
// Phase 12 stops paying it. **The polygon is the only representation of a
// room.** What is left of the lattice is the part that was always worth
// having: it is a good way to *draw* a rectangular building. Painting floor
// with a 4ft brush, laying a generated school out on a grid of cells, reading
// a save file written before this phase — all three want a cell raster with
// walls on its edges, and all three want the same thing at the end of it,
// which is rooms.
//
// So the raster lives here, as a scratch surface nothing stores, and `bake()`
// is the only door out of it. A floor record no longer has cells or edges on
// it; it has shapes, and every one of them has an id.
//
// ## What a bake does
//
// One flood region becomes one room. The region's outline is traced (the
// tracer is the one `convertRegion` has used since arc one, generalised),
// collinear runs of the same kind are merged into single segments, and every
// opening kind on the lattice — door, double door, cased opening, window —
// becomes an opening *at a point along* the run it fell in, which is what a
// polygon wall says instead of an edge value.
//
// **A partition belongs to exactly one of the two rooms it divides.** The
// lattice put a wall on the edge *between* two cells, so both rooms could
// point at it; two polygons that each built their own copy would draw two
// walls in the same place, stop a walker twice and count double in the
// takeoff. Regions are baked in reading order and the first one to reach an
// edge claims it; the room on the other side leaves that segment open. This
// is the same rule `convertRegion` has always applied to a promoted room's
// shared walls — it just no longer has a lattice to leave the wall on.
//
// **A boundary with no room on either side cannot survive.** A free-standing
// lattice wall — one drawn across empty cells, with nothing to bound — is the
// one thing the polygon model has no way to say: a wall is a room's boundary
// here, and inventing a room to hold it would put floor, ceiling and
// occupancy where the design has none. `bake()` counts them and hands the
// count back rather than dropping them silently, and since the wall tool now
// writes to a room's own ring, no new one can be made.
//
// Pure module: no three.js. Exercised by test/lattice.test.mjs.

import {
  CELL, DOOR_W,
  EDGE_NONE, EDGE_DOOR, EDGE_GLASS, EDGE_RAIL,
  EDGE_WINDOW, EDGE_DOOR2, EDGE_OPENING,
} from './grid.js';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL,
  MAX_SHAPES, MAX_RING_PTS,
  ringSignedArea, orientRing, writeOpening, takeId, segEnds,
  openingSpec, isDoorOpening,
  OP_WINDOW, LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE,
  WINDOW_SILL, WINDOW_H,
} from './shapes.js';

// The width the lattice gives each of its opening kinds. A double door fills
// its cell — that is what the kind exists for — and a window keeps a jamb
// either side, which reads as a mullion where two of them meet.
export const GRID_DOOR2_W = CELL;           // ft
export const GRID_WINDOW_W = CELL - 0.5;    // ft

export function gridOpeningWidth(val) {
  if (val === EDGE_DOOR2) return GRID_DOOR2_W;
  if (val === EDGE_WINDOW) return GRID_WINDOW_W;
  if (val === EDGE_DOOR || val === EDGE_OPENING) return DOOR_W;
  return 0;
}

// The four edge kinds that are a hole in a wall rather than a kind of wall.
// Each of them becomes `SEG_WALL` plus an opening record when it is baked.
const OPENING_EDGES = [EDGE_DOOR, EDGE_DOOR2, EDGE_OPENING, EDGE_WINDOW];
export const isOpeningEdge = (v) => OPENING_EDGES.includes(v);

// What a boundary of this kind is *built* as, once the opening in it has been
// lifted out into a record of its own.
export function edgeSegKind(val) {
  if (val === EDGE_NONE) return SEG_NONE;
  if (val === EDGE_GLASS) return SEG_GLASS;
  if (val === EDGE_RAIL) return SEG_RAIL;
  return SEG_WALL;
}

// The options a lattice opening carries, as a polygon opening would record
// them. These are exactly the answers `gridDoorSpec` gave in openings.js —
// the two had to agree, because a design baked by this file has to hang the
// same leaves the lattice used to hang.
export function edgeOpeningOpts(val) {
  if (val === EDGE_DOOR2) return { leaf: LEAF_DOUBLE, lite: true, bar: true };
  if (val === EDGE_OPENING) return { leaf: LEAF_NONE };
  if (val === EDGE_WINDOW) return { k: OP_WINDOW, sill: WINDOW_SILL, h: WINDOW_H };
  return { leaf: LEAF_SINGLE };
}

// ---------- the raster ----------

export function createLattice(w, h) {
  return {
    w, h,
    // cells[i] = null (nothing drawn), or the label a room tool wrote across
    // the region: { room, color, fin, paint }. It is a *scratch* record — the
    // moment this is baked, those four fields live on a shape instead.
    cells: new Array(w * h).fill(null),
    edgesH: new Array(w * (h + 1)).fill(0),
    edgesV: new Array((w + 1) * h).fill(0),
  };
}

export const cellIdx  = (f, x, y) => y * f.w + x;
export const edgeHIdx = (f, x, y) => y * f.w + x;         // x in 0..w-1, y in 0..h
export const edgeVIdx = (f, x, y) => y * (f.w + 1) + x;   // x in 0..w,   y in 0..h-1

export const inGrid = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h;

export function getCell(f, x, y) {
  return inGrid(f, x, y) ? f.cells[cellIdx(f, x, y)] : null;
}

export function setTile(f, x, y, on) {
  if (!inGrid(f, x, y)) return false;
  const i = cellIdx(f, x, y);
  if (on && !f.cells[i]) {
    f.cells[i] = { room: null, color: null, fin: null, paint: null };
    return true;
  }
  if (!on && f.cells[i]) { f.cells[i] = null; return true; }
  return false;
}

const DIRS = [
  { dx: 1, dy: 0 },  // east  -> edgesV(x+1, y)
  { dx: -1, dy: 0 }, // west  -> edgesV(x, y)
  { dx: 0, dy: 1 },  // south -> edgesH(x, y+1)
  { dx: 0, dy: -1 }, // north -> edgesH(x, y)
];

export function edgeBetween(f, x, y, dx, dy) {
  if (dx === 1)  return { arr: f.edgesV, i: edgeVIdx(f, x + 1, y) };
  if (dx === -1) return { arr: f.edgesV, i: edgeVIdx(f, x, y) };
  if (dy === 1)  return { arr: f.edgesH, i: edgeHIdx(f, x, y + 1) };
  return { arr: f.edgesH, i: edgeHIdx(f, x, y) };
}

// Flood fill from (x, y) across drawn cells, bounded by any edge kind — a
// glass partition divides two rooms as surely as a plastered one, and a
// railing is the edge of the floor.
export function floodRegion(f, x, y) {
  if (!getCell(f, x, y)) return [];
  const seen = new Set([cellIdx(f, x, y)]);
  const out = [];
  const stack = [{ x, y }];
  while (stack.length) {
    const c = stack.pop();
    out.push(c);
    for (const d of DIRS) {
      const nx = c.x + d.dx, ny = c.y + d.dy;
      if (!inGrid(f, nx, ny)) continue;
      const ni = cellIdx(f, nx, ny);
      if (seen.has(ni) || !f.cells[ni]) continue;
      const e = edgeBetween(f, c.x, c.y, d.dx, d.dy);
      if (e.arr[e.i] !== EDGE_NONE) continue;
      seen.add(ni);
      stack.push({ x: nx, y: ny });
    }
  }
  return out;
}

// Every region on the raster, in reading order — which is what makes a bake
// deterministic, and therefore what makes "the first room to reach a wall
// claims it" a rule rather than a coin toss.
export function allRegions(lat) {
  const seen = new Uint8Array(lat.w * lat.h);
  const out = [];
  for (let y = 0; y < lat.h; y++) {
    for (let x = 0; x < lat.w; x++) {
      const i = cellIdx(lat, x, y);
      if (seen[i] || !lat.cells[i]) continue;
      const region = floodRegion(lat, x, y);
      for (const c of region) seen[cellIdx(lat, c.x, c.y)] = 1;
      if (region.length) out.push(region);
    }
  }
  return out;
}

export function latticeCellCount(lat) {
  let n = 0;
  for (let i = 0; i < lat.cells.length; i++) if (lat.cells[i]) n++;
  return n;
}

// ---------- tracing ----------
//
// Walk the boundary of a set of cells and return one loop per outline. Each
// loop is `{ pts: [{x, z}] in feet, segs: [...] }`, one segment per point.
//
// `claimed` is the set of lattice edges an earlier region has already built.
// It is read *and written* here: a run this region builds is claimed as it is
// traced, so the room on the other side of a partition finds it taken.

const edgeKey = (h, idx) => (h ? 'H' : 'V') + idx;

export function traceRegion(lat, cells, claimed = new Set()) {
  if (!cells || !cells.length) return [];
  const region = new Set(cells.map((c) => c.y * lat.w + c.x));
  const edges = [];

  for (const c of cells) {
    const { x, y } = c;
    // Clockwise around the cell in (x, y): the region stays on our right.
    const sides = [
      { nx: x, ny: y - 1, a: [x, y], b: [x + 1, y], h: true, idx: edgeHIdx(lat, x, y) },
      { nx: x + 1, ny: y, a: [x + 1, y], b: [x + 1, y + 1], h: false, idx: edgeVIdx(lat, x + 1, y) },
      { nx: x, ny: y + 1, a: [x + 1, y + 1], b: [x, y + 1], h: true, idx: edgeHIdx(lat, x, y + 1) },
      { nx: x - 1, ny: y, a: [x, y + 1], b: [x, y], h: false, idx: edgeVIdx(lat, x, y) },
    ];
    for (const s of sides) {
      if (inGrid(lat, s.nx, s.ny) && region.has(s.ny * lat.w + s.nx)) continue;
      edges.push({
        a: s.a, b: s.b,
        val: (s.h ? lat.edgesH : lat.edgesV)[s.idx],
        key: edgeKey(s.h, s.idx),
      });
    }
  }

  const key = (p) => `${p[0]},${p[1]}`;
  const starts = new Map();
  edges.forEach((e, i) => {
    const k = key(e.a);
    if (!starts.has(k)) starts.set(k, []);
    starts.get(k).push(i);
  });

  const used = new Array(edges.length).fill(false);
  const loops = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const chain = [];
    let cur = i;
    while (cur >= 0 && !used[cur]) {
      used[cur] = true;
      chain.push(edges[cur]);
      const e = edges[cur];
      const cands = (starts.get(key(e.b)) || []).filter((j) => !used[j]);
      if (!cands.length) break;
      // Where four cells meet at a corner the outline passes through the same
      // point twice; hugging the interior (sharpest right turn) keeps the two
      // passes on the loops they belong to.
      const d = { x: e.b[0] - e.a[0], y: e.b[1] - e.a[1] };
      cands.sort((ja, jb) => {
        const score = (j) => {
          const c = edges[j];
          const v = { x: c.b[0] - c.a[0], y: c.b[1] - c.a[1] };
          return [d.x * v.y - d.y * v.x, d.x * v.x + d.y * v.y];
        };
        const sa = score(ja), sb = score(jb);
        return sb[0] - sa[0] || sb[1] - sa[1];
      });
      cur = cands[0];
    }
    if (chain.length >= 4) loops.push(chain);
  }

  // Merge collinear runs that agree on what they are built as and on who
  // builds them. An opening is *not* a reason to break a run any more — a
  // door is a point along a wall here, so a 20ft partition with two doors in
  // it is one segment carrying two openings rather than five segments.
  const out = loops.map((chain) => {
    const runs = [];
    for (const e of chain) {
      const kind = edgeSegKind(e.val);
      const mine = kind !== SEG_NONE && !claimed.has(e.key);
      const dir = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
      const last = runs[runs.length - 1];
      if (last && last.kind === kind && last.mine === mine &&
          last.dir[0] === dir[0] && last.dir[1] === dir[1]) {
        last.end = e.b;
        last.edges.push(e);
        continue;
      }
      runs.push({ kind, mine, dir, start: e.a, end: e.b, edges: [e] });
    }
    // The run that wraps the loop's start point is one run, not two.
    if (runs.length > 2) {
      const first = runs[0], last = runs[runs.length - 1];
      if (first.kind === last.kind && first.mine === last.mine &&
          first.dir[0] === last.dir[0] && first.dir[1] === last.dir[1]) {
        last.end = first.end;
        last.edges.push(...first.edges);
        runs.shift();
        runs.unshift(runs.pop());
      }
    }
    const pts = runs.map((r) => ({ x: r.start[0] * CELL, z: r.start[1] * CELL }));
    const segs = runs.map((r) => {
      const len = r.edges.length * CELL;
      const openings = [];
      if (r.mine) {
        r.edges.forEach((e, i) => {
          if (!isOpeningEdge(e.val)) return;
          openings.push({
            // Where along the merged run this cell's edge sat, as the
            // fraction `t` a polygon opening records.
            t: (i + 0.5) / r.edges.length,
            // A 4ft pair in a 4ft run would leave no jamb at all, so an
            // opening never takes more than the run it is cut into.
            w: Math.min(gridOpeningWidth(e.val), len - 0.5),
            opts: edgeOpeningOpts(e.val),
          });
        });
      }
      return { kind: r.mine ? r.kind : SEG_NONE, mine: r.mine, openings, edges: r.edges };
    });
    return { pts, segs };
  }).filter((l) => l.pts.length >= 3 && l.pts.length <= MAX_RING_PTS);

  // The outer boundary is the biggest loop; the rest are holes.
  out.sort((a, b) => Math.abs(ringSignedArea(b.pts)) - Math.abs(ringSignedArea(a.pts)));
  for (const loop of out) {
    for (const sg of loop.segs) {
      if (!sg.mine) continue;
      for (const e of sg.edges) claimed.add(e.key);
    }
  }
  return out;
}

// ---------- the bake ----------

// One region, as the room it describes. `id` comes off the state's own
// counter, so a baked room, a prop and a stair can never collide.
export function regionToShape(state, lat, cells, claimed = new Set()) {
  const loops = traceRegion(lat, cells, claimed);
  if (!loops.length) return null;

  // The room keeps whatever the cells carried — baking a room shouldn't
  // rename or repaint it.
  let name = null, color = null, fin = null, paint = null;
  for (const c of cells) {
    const cell = lat.cells[cellIdx(lat, c.x, c.y)];
    if (!cell) continue;
    if (!fin && cell.fin) fin = cell.fin;
    if (!paint && cell.paint) paint = cell.paint;
    if (!name && cell.room) { name = cell.room; color = cell.color; }
  }

  const shape = { id: takeId(state), name, color, fin, paint, rings: [] };
  loops.forEach((loop, li) => {
    const ring = { pts: loop.pts, walls: [], openings: [] };
    loop.segs.forEach((sg, i) => {
      ring.walls.push(sg.kind);
      for (const o of sg.openings) ring.openings.push(writeOpening(i, o.t, o.w, o.opts));
    });
    orientRing(ring, li === 0);
    rehangLeaves(ring);
    shape.rings.push(ring);
  });
  return shape;
}

// **A baked door hangs on the jamb the lattice hung it on.**
//
// The lattice had no direction to speak of: a horizontal edge ran +X and a
// vertical one ran +Z, always, so `hand: +1` (hinge on the start of the run)
// and `sw: +1` (swing toward the run's left-hand normal) meant one fixed thing
// per edge. A ring has a winding, and half of its segments run the *other*
// way — the south wall of a room wound counter-clockwise runs −X — so the same
// two fields on the same door would put the hinge on the far jamb and swing
// the leaf into the room instead of out of it.
//
// Flipping both keeps `turn` (= hand × sw) exactly what it was and moves the
// hinge back to the jamb it was on. It is done from the *finished* ring rather
// than from the trace, because `orientRing` may have reversed the loop under
// us, and asking the geometry which way a segment ends up running cannot be
// wrong about it.
//
// It is not cosmetic. A leaf hung on the wrong jamb sweeps the other half of
// its doorway, which is the half a walker approaching off-centre is standing
// in — a fire drill on the sample school lost a third of the building to it.
function rehangLeaves(ring) {
  for (const o of ring.openings) {
    if (!isDoorOpening(o) || openingSpec(o).leaf === LEAF_NONE) continue;
    const [a, b] = segEnds(ring, o.seg);
    if (b.x - a.x < -1e-9 || b.z - a.z < -1e-9) { o.hand = -1; o.sw = -1; }
  }
}

// Every region on the raster, as rooms on `state.floors[floorIndex]`.
//
// Returns `{ shapes, orphans, dropped }` — what was built, how many built
// boundaries had no room on either side to belong to, and how many rooms the
// per-floor cap refused.
export function bake(state, floorIndex, lat) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  const out = { shapes: [], orphans: 0, dropped: 0 };
  if (!floor || !lat) return out;
  if (!Array.isArray(floor.shapes)) floor.shapes = [];

  const claimed = new Set();
  for (const region of allRegions(lat)) {
    if (floor.shapes.length >= MAX_SHAPES) { out.dropped++; continue; }
    const shape = regionToShape(state, lat, region, claimed);
    if (!shape) continue;
    floor.shapes.push(shape);
    out.shapes.push(shape);
  }

  // Anything still built and still unclaimed bounded no room. Walk both edge
  // arrays once and say how many rather than losing them quietly.
  for (let i = 0; i < lat.edgesH.length; i++) {
    if (lat.edgesH[i] && !claimed.has('H' + i)) out.orphans++;
  }
  for (let i = 0; i < lat.edgesV.length; i++) {
    if (lat.edgesV[i] && !claimed.has('V' + i)) out.orphans++;
  }
  return out;
}
