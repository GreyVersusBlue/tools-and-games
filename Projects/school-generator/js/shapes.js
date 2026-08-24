// shapes.js — polygon rooms: the non-rectilinear half of the room model.
//
// The grid (grid.js) stays exactly as it was: it is the fast rectangular mode,
// and it is what most of a school is. This file adds the other representation —
// a room that owns its own outline, so breakout rooms, alcoves and angled
// corners stop being something the 4ft grid has to approximate.
//
// A shape lives on one floor, in world feet, and is a list of *rings*:
//
//   rings[0]        the outer boundary
//   rings[1..]      holes — carved alcoves, courtyards, a room within a room
//
//   ring = {
//     pts:      [{x, z}, ...]        n vertices, implicitly closed
//     walls:    [0|1, ...]           n entries; walls[i] covers pts[i] -> pts[i+1]
//     openings: [{ seg, t, w }, ...] doorways: segment index, centre at 0..1, width ft
//   }
//
// Walls being a per-segment array on the boundary itself is the schema change
// the grid's `edgesH`/`edgesV` couldn't absorb: an edge array indexes a fixed
// lattice, and there is no lattice here. A door is an *opening at a point along
// a wall* rather than an edge value, because a polygon segment can be 30ft long
// and a door is 3ft of it.
//
// Winding is normalized: the outer ring is CCW in (x, z), holes are CW.
// Every mutation below keeps `walls` and `openings` aligned with `pts` — that
// bookkeeping is the whole reason vertex editing lives here and not in the
// tool that calls it.
//
// Pure module: no three.js. Everything here is exercised by test/model.test.mjs.

import {
  CELL, DOOR_W,
  cellIdx, edgeHIdx, edgeVIdx, inGrid, getCell, floodRegion,
} from './grid.js';

export const MAX_SHAPES = 128;      // per floor
export const MAX_RING_PTS = 400;
export const MAX_HOLES = 24;
export const MIN_SEG = 0.25;        // ft — closer than this and it's the same point
export const MIN_AREA = 1;          // ft² — anything smaller is a mis-click, not a room
export const MIN_DOOR_W = 2;
export const MAX_DOOR_W = 16;

// Per-segment wall state. Same vocabulary as the grid's edge arrays minus the
// door, which is an opening rather than a segment kind. Phase 4's glass wall
// slots in here as 2 without moving anything else.
export const SEG_NONE = 0;
export const SEG_WALL = 1;

// ---------- small vector helpers ----------

const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

export const segLength = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

// Closest point on segment a->b to (x, z), as {t, x, z, dist}.
export function projectOnSeg(a, b, x, z) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
  const px = a.x + dx * t, pz = a.z + dz * t;
  return { t, x: px, z: pz, dist: Math.hypot(x - px, z - pz) };
}

// ---------- rings ----------

export const ringLen = (ring) => ring.pts.length;

export const segEnds = (ring, i) => [ring.pts[i], ring.pts[(i + 1) % ring.pts.length]];

export function ringSignedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  }
  return a / 2;
}

export const ringIsCCW = (pts) => ringSignedArea(pts) > 0;

// Reversing a ring renumbers its segments: new segment j is old segment
// (n-2-j) walked backwards, so wall states and door positions move with it.
function reverseRing(ring) {
  const n = ring.pts.length;
  ring.pts.reverse();
  const w = ring.walls.slice();
  for (let j = 0; j < n; j++) ring.walls[j] = w[(n - 2 - j + n) % n];
  for (const o of ring.openings) {
    o.seg = (n - 2 - o.seg + n) % n;
    o.t = 1 - o.t;
  }
  return ring;
}

export function orientRing(ring, ccw) {
  if (ringIsCCW(ring.pts) !== ccw) reverseRing(ring);
  return ring;
}

export function orientShape(shape) {
  shape.rings.forEach((r, i) => orientRing(r, i === 0));
  return shape;
}

// Drop repeats and near-repeats, including a duplicated closing point.
// Returns null if what's left isn't a polygon.
export function cleanRing(pts) {
  const out = [];
  for (const p of pts || []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const prev = out[out.length - 1];
    if (prev && dist2(prev.x, prev.z, p.x, p.z) < MIN_SEG * MIN_SEG) continue;
    out.push({ x: p.x, z: p.z });
  }
  while (out.length > 1 &&
         dist2(out[0].x, out[0].z, out[out.length - 1].x, out[out.length - 1].z) < MIN_SEG * MIN_SEG) {
    out.pop();
  }
  if (out.length < 3) return null;
  if (Math.abs(ringSignedArea(out)) < MIN_AREA) return null;
  return out;
}

export function makeRing(pts, wall = SEG_WALL) {
  const clean = cleanRing(pts);
  if (!clean) return null;
  return { pts: clean, walls: new Array(clean.length).fill(wall), openings: [] };
}

// ---------- shapes ----------

export const shapesOf = (floor) => (floor && Array.isArray(floor.shapes) ? floor.shapes : []);

export function pointInRing(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) &&
        x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInShape(shape, x, z) {
  if (!pointInRing(shape.rings[0].pts, x, z)) return false;
  for (let i = 1; i < shape.rings.length; i++) {
    if (pointInRing(shape.rings[i].pts, x, z)) return false;
  }
  return true;
}

// Usable floor area in ft²: outer ring minus its holes.
export function shapeArea(shape) {
  let a = Math.abs(ringSignedArea(shape.rings[0].pts));
  for (let i = 1; i < shape.rings.length; i++) a -= Math.abs(ringSignedArea(shape.rings[i].pts));
  return Math.max(0, a);
}

export function shapeBBox(shape) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of shape.rings[0].pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  return { x0, z0, x1, z1 };
}

export function ringCentroid(pts) {
  const a = ringSignedArea(pts);
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of pts) { sx += p.x; sz += p.z; }
    return { x: sx / pts.length, z: sz / pts.length };
  }
  let cx = 0, cz = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    cx += (pts[j].x + pts[i].x) * f;
    cz += (pts[j].z + pts[i].z) * f;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

export function distToBoundary(shape, x, z) {
  let best = Infinity;
  for (const ring of shape.rings) {
    for (let i = 0; i < ring.pts.length; i++) {
      const [a, b] = segEnds(ring, i);
      best = Math.min(best, projectOnSeg(a, b, x, z).dist);
    }
  }
  return best;
}

// A point comfortably inside the room — the centroid of an L-shaped or
// horseshoe room can sit in a wall or outside it entirely, so this takes the
// sampled point deepest inside instead. Used for labels and walkthrough spawns.
export function interiorPoint(shape, samples = 12) {
  let best = null, bestD = -1;
  const c = ringCentroid(shape.rings[0].pts);
  if (pointInShape(shape, c.x, c.z)) { best = c; bestD = distToBoundary(shape, c.x, c.z); }
  const bb = shapeBBox(shape);
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = bb.x0 + ((i + 0.5) / samples) * (bb.x1 - bb.x0);
      const z = bb.z0 + ((j + 0.5) / samples) * (bb.z1 - bb.z0);
      if (!pointInShape(shape, x, z)) continue;
      const d = distToBoundary(shape, x, z);
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
  }
  return best || c;
}

// Topmost shape under a point — later shapes win, so a room drawn on top of
// another is the one you select.
export function shapeAt(floor, x, z) {
  const list = shapesOf(floor);
  for (let i = list.length - 1; i >= 0; i--) {
    if (pointInShape(list[i], x, z)) return list[i];
  }
  return null;
}

export const shapeById = (floor, id) => shapesOf(floor).find((s) => s.id === id) || null;

// {shape, ring, seg, t, x, z, dist} for the closest boundary segment on the floor.
export function nearestSegment(floor, x, z, maxDist = Infinity) {
  let best = null;
  for (const shape of shapesOf(floor)) {
    shape.rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.pts.length; i++) {
        const [a, b] = segEnds(ring, i);
        const p = projectOnSeg(a, b, x, z);
        if (p.dist <= maxDist && (!best || p.dist < best.dist)) {
          best = { shape, ring: ri, seg: i, t: p.t, x: p.x, z: p.z, dist: p.dist };
        }
      }
    });
  }
  return best;
}

// {shape, ring, idx, x, z, dist} for the closest vertex on the floor.
export function nearestVertex(floor, x, z, maxDist = Infinity) {
  let best = null;
  for (const shape of shapesOf(floor)) {
    shape.rings.forEach((ring, ri) => {
      ring.pts.forEach((p, i) => {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= maxDist && (!best || d < best.dist)) {
          best = { shape, ring: ri, idx: i, x: p.x, z: p.z, dist: d };
        }
      });
    });
  }
  return best;
}

// ---------- construction ----------

// Ids come off the same monotonic counter props and links use, so a shape, a
// prop and a stair can never collide in a save file.
function takeId(state) {
  const id = Math.max(1, Math.floor(state.nextId || 1));
  state.nextId = id + 1;
  return id;
}

export function makeShape(pts, opts = {}) {
  const ring = makeRing(pts, opts.wall ?? SEG_WALL);
  if (!ring) return null;
  orientRing(ring, true);
  return {
    id: 0,
    name: opts.name || null,
    color: opts.color || null,
    rings: [ring],
  };
}

export function addShape(state, floorIndex, pts, opts = {}) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  if (!Array.isArray(floor.shapes)) floor.shapes = [];
  if (floor.shapes.length >= MAX_SHAPES) return null;
  const shape = makeShape(pts, opts);
  if (!shape) return null;
  shape.id = takeId(state);
  floor.shapes.push(shape);
  return shape;
}

export function removeShape(floor, id) {
  const list = shapesOf(floor);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

// Carve a hole out of `shape`. The caller decides which shape is being cut —
// see `enclosingShape` for picking it from a drawn ring.
export function addHole(shape, pts) {
  if (shape.rings.length - 1 >= MAX_HOLES) return null;
  const ring = makeRing(pts);
  if (!ring) return null;
  orientRing(ring, false);
  shape.rings.push(ring);
  return ring;
}

// The smallest shape on the floor that fully contains `pts` — the one a
// freshly drawn ring should be carved out of.
export function enclosingShape(floor, pts) {
  let best = null, bestArea = Infinity;
  for (const shape of shapesOf(floor)) {
    if (!pts.every((p) => pointInShape(shape, p.x, p.z))) continue;
    const a = shapeArea(shape);
    if (a < bestArea) { bestArea = a; best = shape; }
  }
  return best;
}

// ---------- vertex editing ----------

export function moveVertex(shape, ringIdx, idx, x, z) {
  const ring = shape.rings[ringIdx];
  if (!ring || !ring.pts[idx]) return false;
  ring.pts[idx].x = x;
  ring.pts[idx].z = z;
  return true;
}

// Split segment `seg` at the given point. The two halves inherit the segment's
// wall state; a doorway on the split segment follows whichever half it fell in.
export function insertVertex(shape, ringIdx, seg, x, z) {
  const ring = shape.rings[ringIdx];
  if (!ring || ring.pts.length >= MAX_RING_PTS) return -1;
  const n = ring.pts.length;
  if (seg < 0 || seg >= n) return -1;
  const [a, b] = segEnds(ring, seg);
  const cut = projectOnSeg(a, b, x, z).t;
  if (cut <= 0.001 || cut >= 0.999) return -1;

  const at = seg + 1;
  ring.pts.splice(at, 0, { x, z });
  ring.walls.splice(at, 0, ring.walls[seg]);
  for (const o of ring.openings) {
    if (o.seg > seg) { o.seg += 1; continue; }
    if (o.seg < seg) continue;
    if (o.t <= cut) o.t = o.t / cut;
    else { o.seg = seg + 1; o.t = (o.t - cut) / (1 - cut); }
  }
  return at;
}

// Remove a vertex, merging the two segments that met there. The merged segment
// keeps the incoming wall state; doorways that sat on either half go with it,
// since their position along a segment that no longer exists is meaningless.
export function deleteVertex(shape, ringIdx, idx) {
  const ring = shape.rings[ringIdx];
  if (!ring || ring.pts.length <= 3 || !ring.pts[idx]) return false;
  const n = ring.pts.length;
  const prev = (idx - 1 + n) % n;
  ring.pts.splice(idx, 1);
  const keep = ring.walls[prev];
  ring.walls.splice(idx, 1);
  ring.walls[Math.min(prev, ring.walls.length - 1)] = keep;
  ring.openings = ring.openings
    .filter((o) => o.seg !== idx && o.seg !== prev)
    .map((o) => (o.seg > idx ? { ...o, seg: o.seg - 1 } : o));
  return true;
}

// ---------- walls & doorways ----------

export function setSegWall(shape, ringIdx, seg, val) {
  const ring = shape.rings[ringIdx];
  if (!ring || seg < 0 || seg >= ring.walls.length) return false;
  const v = val === SEG_WALL ? SEG_WALL : SEG_NONE;
  if (ring.walls[seg] === v) return false;
  ring.walls[seg] = v;
  if (v === SEG_NONE) ring.openings = ring.openings.filter((o) => o.seg !== seg);
  return true;
}

export const openingsOnSeg = (ring, seg) => ring.openings.filter((o) => o.seg === seg);

// Doorways can't run off the ends of their wall, and a segment shorter than a
// door plus its jambs can't hold one at all.
export function addOpening(shape, ringIdx, seg, t, w = DOOR_W) {
  const ring = shape.rings[ringIdx];
  if (!ring || seg < 0 || seg >= ring.walls.length) return null;
  if (ring.walls[seg] !== SEG_WALL) return null;
  const [a, b] = segEnds(ring, seg);
  const len = segLength(a, b);
  const width = Math.min(MAX_DOOR_W, Math.max(MIN_DOOR_W, w));
  if (len < width + 0.5) return null;
  const half = (width / 2 + 0.25) / len;
  const opening = { seg, t: Math.min(1 - half, Math.max(half, t)), w: width };
  if (openingsOnSeg(ring, seg).some((o) => Math.abs(o.t - opening.t) * len < width)) return null;
  ring.openings.push(opening);
  return opening;
}

// Toggle a doorway under the cursor: remove the one you clicked, or cut a new
// one where you clicked.
export function toggleOpening(shape, ringIdx, seg, t, w = DOOR_W) {
  const ring = shape.rings[ringIdx];
  if (!ring) return null;
  const [a, b] = segEnds(ring, seg);
  const len = segLength(a, b);
  const hit = openingsOnSeg(ring, seg)
    .find((o) => Math.abs(o.t - t) * len <= o.w / 2 + 0.5);
  if (hit) {
    ring.openings.splice(ring.openings.indexOf(hit), 1);
    return null;
  }
  if (ring.walls[seg] !== SEG_WALL) ring.walls[seg] = SEG_WALL;
  return addOpening(shape, ringIdx, seg, t, w);
}

// ---------- snapping ----------
//
// Polygon rooms have to butt cleanly against grid-built ones, so the grid
// lattice is a snap target even though polygons don't live on it. Order of
// preference: an existing vertex, a grid corner, a point on an existing wall,
// then a single grid axis.

export function snapPoint(floor, x, z, tol = 1.5, opts = {}) {
  const skip = opts.skip || null;
  const skips = (shape, ring, idx) =>
    skip && skip.shape === shape.id && skip.ring === ring && skip.idx === idx;

  if (opts.vertices !== false) {
    let best = null;
    for (const shape of shapesOf(floor)) {
      shape.rings.forEach((ring, ri) => {
        ring.pts.forEach((p, i) => {
          if (skips(shape, ri, i)) return;
          const d = Math.hypot(p.x - x, p.z - z);
          if (d <= tol && (!best || d < best.d)) best = { x: p.x, z: p.z, d, kind: 'vertex' };
        });
      });
    }
    if (best) return best;
  }

  const gx = Math.round(x / CELL) * CELL, gz = Math.round(z / CELL) * CELL;
  const onX = Math.abs(gx - x) <= tol, onZ = Math.abs(gz - z) <= tol;
  if (opts.grid !== false && onX && onZ) {
    return { x: gx, z: gz, d: Math.hypot(gx - x, gz - z), kind: 'corner' };
  }

  if (opts.edges !== false) {
    const seg = nearestSegment(floor, x, z, tol);
    if (seg) return { x: seg.x, z: seg.z, d: seg.dist, kind: 'edge' };
  }

  if (opts.grid !== false && (onX || onZ)) {
    return { x: onX ? gx : x, z: onZ ? gz : z, d: 0, kind: 'grid' };
  }
  return { x, z, d: Infinity, kind: 'free' };
}

// Constrain b to lie on a ray from a at a multiple of `stepDeg` — the
// straight-and-45s constraint every drawing tool has, so an angled wall is
// deliberate rather than a shaky hand.
export function constrainAngle(a, b, stepDeg = 15) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < MIN_SEG) return { x: b.x, z: b.z };
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dz, dx) / step) * step;
  return { x: a.x + Math.cos(ang) * len, z: a.z + Math.sin(ang) * len };
}

// ---------- grid -> polygon ----------
//
// The migration path. Rather than run two room systems forever, any grid region
// can be promoted to a polygon in place: trace its outline, carry the walls and
// doors it already had, and hand the cells back. Walls shared with a
// *neighbouring* grid room stay on the grid — that partition still belongs to
// the room on the other side — and the polygon leaves that segment open so the
// two never draw the same wall twice.

// Walk the boundary of a set of cells and return one loop per outline.
// Each loop is { pts: [{x,z}] in feet, segs: [{ val, shared, edges: [...] }] }.
export function regionToPolygon(floor, cells) {
  if (!cells || !cells.length) return [];
  const region = new Set(cells.map((c) => c.y * floor.w + c.x));
  const edges = [];

  for (const c of cells) {
    const { x, y } = c;
    // Clockwise around the cell in (x, y): the region stays on our right.
    const sides = [
      { nx: x, ny: y - 1, a: [x, y], b: [x + 1, y], h: true, idx: edgeHIdx(floor, x, y) },
      { nx: x + 1, ny: y, a: [x + 1, y], b: [x + 1, y + 1], h: false, idx: edgeVIdx(floor, x + 1, y) },
      { nx: x, ny: y + 1, a: [x + 1, y + 1], b: [x, y + 1], h: true, idx: edgeHIdx(floor, x, y + 1) },
      { nx: x - 1, ny: y, a: [x, y + 1], b: [x, y], h: false, idx: edgeVIdx(floor, x, y) },
    ];
    for (const s of sides) {
      if (inGrid(floor, s.nx, s.ny) && region.has(s.ny * floor.w + s.nx)) continue;
      edges.push({
        a: s.a, b: s.b,
        val: (s.h ? floor.edgesH : floor.edgesV)[s.idx],
        shared: !!getCell(floor, s.nx, s.ny),
        edge: { h: s.h, idx: s.idx },
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

  // Merge collinear runs that agree on wall state. A doorway keeps its own 4ft
  // segment so its opening lands in the middle of the doorway, not the wall.
  const out = loops.map((chain) => {
    const pts = [], segs = [];
    for (const e of chain) {
      const last = segs[segs.length - 1];
      const dir = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
      const mergeable = last && last.val === e.val && last.shared === e.shared &&
        e.val !== 2 && last.dir[0] === dir[0] && last.dir[1] === dir[1];
      if (mergeable) {
        last.edges.push(e.edge);
        last.end = e.b;
        continue;
      }
      segs.push({ val: e.val, shared: e.shared, edges: [e.edge], dir, start: e.a, end: e.b });
    }
    // The run that wraps the loop's start point is one run, not two.
    if (segs.length > 2) {
      const first = segs[0], last = segs[segs.length - 1];
      if (first.val === last.val && first.shared === last.shared && first.val !== 2 &&
          first.dir[0] === last.dir[0] && first.dir[1] === last.dir[1]) {
        last.end = first.end;
        last.edges.push(...first.edges);
        segs.shift();
        segs.unshift(segs.pop());
      }
    }
    for (const s of segs) pts.push({ x: s.start[0] * CELL, z: s.start[1] * CELL });
    return {
      pts,
      segs: segs.map((s) => ({ val: s.val, shared: s.shared, edges: s.edges })),
    };
  }).filter((l) => l.pts.length >= 3);

  out.sort((a, b) => Math.abs(ringSignedArea(b.pts)) - Math.abs(ringSignedArea(a.pts)));
  return out;
}

// Promote the grid region containing (gx, gy) into a polygon room on the same
// floor, and hand back the cells it was using. Returns the new shape, or null.
export function convertRegion(state, floorIndex, gx, gy) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  const region = floodRegion(floor, gx, gy);
  if (!region.length) return null;
  if (!Array.isArray(floor.shapes)) floor.shapes = [];
  if (floor.shapes.length >= MAX_SHAPES) return null;

  const loops = regionToPolygon(floor, region);
  if (!loops.length) return null;

  let name = null, color = null;
  for (const c of region) {
    const cell = floor.cells[cellIdx(floor, c.x, c.y)];
    if (cell && cell.room) { name = cell.room; color = cell.color; break; }
  }

  const shape = { id: takeId(state), name, color, rings: [] };
  loops.forEach((loop, li) => {
    const ring = { pts: loop.pts, walls: [], openings: [] };
    loop.segs.forEach((sg, i) => {
      // A partition shared with the room next door stays a grid wall; drawing
      // it here too would put two walls in the same place.
      if (sg.shared) { ring.walls.push(SEG_NONE); return; }
      ring.walls.push(sg.val ? SEG_WALL : SEG_NONE);
      if (sg.val === 2) ring.openings.push({ seg: i, t: 0.5, w: DOOR_W });
    });
    orientRing(ring, li === 0);
    shape.rings.push(ring);
  });

  for (const c of region) floor.cells[cellIdx(floor, c.x, c.y)] = null;
  for (const loop of loops) {
    for (const sg of loop.segs) {
      if (sg.shared) continue;
      for (const e of sg.edges) (e.h ? floor.edgesH : floor.edgesV)[e.idx] = 0;
    }
  }
  floor.shapes.push(shape);
  return shape;
}

// ---------- load-time validation ----------

const num = (v, dflt, lo, hi) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
};

function readRing(raw, extent, outer) {
  if (!raw || typeof raw !== 'object') return null;
  const src = Array.isArray(raw.pts) ? raw.pts.slice(0, MAX_RING_PTS) : [];
  const ring = makeRing(src.map((p) => ({
    x: num(p && p.x, NaN, -extent, extent),
    z: num(p && p.z, NaN, -extent, extent),
  })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
  if (!ring) return null;

  const n = ring.pts.length;
  if (Array.isArray(raw.walls)) {
    for (let i = 0; i < n; i++) ring.walls[i] = raw.walls[i] === SEG_NONE ? SEG_NONE : SEG_WALL;
  }
  if (Array.isArray(raw.openings)) {
    for (const o of raw.openings.slice(0, MAX_RING_PTS)) {
      if (!o || typeof o !== 'object') continue;
      // A doorway that names a segment the ring doesn't have is dropped, not
      // clamped: sliding it onto a different wall would invent a hole in one.
      const seg = Number.isInteger(o.seg) ? o.seg : -1;
      if (seg < 0 || seg >= n || ring.walls[seg] !== SEG_WALL) continue;
      ring.openings.push({
        seg,
        t: num(o.t, 0.5, 0, 1),
        w: num(o.w, DOOR_W, MIN_DOOR_W, MAX_DOOR_W),
      });
    }
  }
  orientRing(ring, outer);
  return ring;
}

// Normalize one shape out of whatever a save file offered. Returns null if
// there isn't a usable outer ring in there.
export function normalizeShape(raw, extent = 4000) {
  if (!raw || typeof raw !== 'object') return null;
  const rings = Array.isArray(raw.rings) ? raw.rings : [];
  const outer = readRing(rings[0], extent, true);
  if (!outer) return null;
  const shape = {
    id: Math.round(num(raw.id, 0, 0, Number.MAX_SAFE_INTEGER)),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : null,
    color: typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : null,
    rings: [outer],
  };
  for (const r of rings.slice(1, MAX_HOLES + 1)) {
    const hole = readRing(r, extent, false);
    // A "hole" that isn't inside the room is a corrupt file, not a courtyard.
    if (hole && hole.pts.every((p) => pointInRing(outer.pts, p.x, p.z))) shape.rings.push(hole);
  }
  return shape;
}

export function cloneShape(shape) {
  return {
    id: shape.id,
    name: shape.name,
    color: shape.color,
    rings: shape.rings.map((r) => ({
      pts: r.pts.map((p) => ({ x: p.x, z: p.z })),
      walls: r.walls.slice(),
      openings: r.openings.map((o) => ({ seg: o.seg, t: o.t, w: o.w })),
    })),
  };
}
