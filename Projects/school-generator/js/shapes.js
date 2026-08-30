// shapes.js — rooms. Since Phase 12 there is one kind, and this is it.
//
// For nineteen phases this was the *other* representation: the 4ft lattice was
// what most of a school was, and a shape was what the lattice couldn't say —
// breakout rooms, alcoves, angled corners. Phase 12 promoted every room to a
// polygon on load and deleted the lattice branch from every reader, so a shape
// is now simply a room: an object, with an id, that owns its own outline.
//
// A room lives on one floor, in world feet, and is a list of *rings*:
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
// the lattice's `edgesH`/`edgesV` couldn't absorb: an edge array indexes a
// fixed grid, and there is no grid here. A door is an *opening at a point
// along a wall* rather than an edge value, because a segment can be 30ft long
// and a door is 3ft of it.
//
// Winding is normalized: the outer ring is CCW in (x, z), holes are CW.
// Every mutation below keeps `walls` and `openings` aligned with `pts` — that
// bookkeeping is the whole reason vertex editing lives here and not in the
// tool that calls it.
//
// Pure module: no three.js. Everything here is exercised by test/model.test.mjs.

import { CELL, DOOR_W, DOOR_H, DOUBLE_DOOR_W, WALL_H } from './grid.js';

// Per floor. Raised from 128 in Phase 12: the polygon is now the only
// representation of a room, so this is the cap on *every* room on a storey
// rather than on the handful the lattice couldn't say. A generated
// three-storey high school bakes to about sixty a floor.
export const MAX_SHAPES = 512;
export const MAX_RING_PTS = 400;
export const MAX_HOLES = 24;
export const MIN_SEG = 0.25;        // ft — closer than this and it's the same point
export const MIN_AREA = 1;          // ft² — anything smaller is a mis-click, not a room
export const MIN_DOOR_W = 2;
export const MAX_DOOR_W = 16;

// ---------- what an opening is ----------
//
// v1's opening was a hole: `{ seg, t, w }`, a stretch of wall that isn't
// there. Phase 2 keeps that record and lets it say more about itself, because
// every richer thing this phase wants — a door with leaves that swing, a
// window with a sill — is still "a stretch of wall that is different here",
// positioned exactly the way an opening already was.
//
//   k     kind: OP_DOOR (a hole you walk through) or OP_WINDOW (a glazed band)
//   h     clear height, ft — head height for a door, pane height for a window
//   sill  ft above the floor the opening starts at — 0 for a door
//   leaf  LEAF_NONE (a cased opening), LEAF_SINGLE, LEAF_DOUBLE
//   lite  vision panel in the leaf
//   bar   push bar across the leaf — a corridor or egress door
//   hand  which jamb the leaf hinges on: +1 the start of the run, -1 the end
//   sw    which side of the wall it swings toward: +1 left of the run, -1 right
//
// Every one of those is optional and every default is v1's behaviour, so a v3
// or v4 opening loads as exactly the cased hole it has always been — and
// writes back out as the same three fields, since `writeOpening` only records
// what differs from the default.
export const OP_DOOR = 0;
export const OP_WINDOW = 1;
export const OP_KINDS = [OP_DOOR, OP_WINDOW];

export const LEAF_NONE = 0;
export const LEAF_SINGLE = 1;
export const LEAF_DOUBLE = 2;
export const LEAF_KINDS = [LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE];

// Window defaults: a 3ft sill is desk height, which is what a classroom window
// sits at, and 4ft of glass over it stops a foot short of a 10ft ceiling.
export const WINDOW_SILL = 3;
export const WINDOW_H = 4;
export const WINDOW_W = 6;
export const MIN_SILL = 0;
export const MAX_SILL = WALL_H - 1;
export const MIN_OPEN_H = 0.75;

const isBool = (v) => v === true || v === false;
const sign = (v) => (v === -1 ? -1 : 1);

// The full description of an opening, defaults filled in. Everything
// downstream — leaves, glazing, collision, the plan symbol — reads this rather
// than poking at the record, so "absent means the v1 default" is stated once.
export function openingSpec(o) {
  const kind = o && o.k === OP_WINDOW ? OP_WINDOW : OP_DOOR;
  const window = kind === OP_WINDOW;
  const sill = window
    ? Math.min(MAX_SILL, Math.max(MIN_SILL, Number.isFinite(o && o.sill) ? o.sill : WINDOW_SILL))
    : 0;
  const dflt = window ? WINDOW_H : DOOR_H;
  const h = Math.min(WALL_H - sill,
    Math.max(MIN_OPEN_H, Number.isFinite(o && o.h) ? o.h : dflt));
  const leaf = window ? LEAF_NONE
    : (LEAF_KINDS.includes(o && o.leaf) ? o.leaf : LEAF_NONE);
  return {
    kind, window, sill, h, head: sill + h, leaf,
    lite: !window && o ? o.lite === true : false,
    bar: !window && o ? o.bar === true : false,
    hand: sign(o && o.hand),
    sw: sign(o && o.sw),
    w: Number.isFinite(o && o.w) ? o.w : DOOR_W,
    t: Number.isFinite(o && o.t) ? o.t : 0.5,
    seg: Number.isInteger(o && o.seg) ? o.seg : 0,
  };
}

// A window is glazed, not open: it never becomes a gap in a wall a body could
// pass through, which is the one question collision and the blueprint's
// wall-run splitting actually ask.
export const isWindowOpening = (o) => !!o && o.k === OP_WINDOW;
export const isDoorOpening = (o) => !isWindowOpening(o);

// The canonical record for a set of options — only what differs from the
// default is written, so a plain doorway stays `{ seg, t, w }` on disk exactly
// as it was in v3.
export function writeOpening(seg, t, w, opts = {}) {
  const o = { seg, t, w };
  const spec = openingSpec({ ...opts, seg, t, w });
  if (spec.kind !== OP_DOOR) o.k = spec.kind;
  if (spec.window) {
    if (spec.sill !== WINDOW_SILL) o.sill = spec.sill;
    if (spec.h !== WINDOW_H) o.h = spec.h;
  } else {
    if (spec.h !== DOOR_H) o.h = spec.h;
    if (spec.leaf !== LEAF_NONE) o.leaf = spec.leaf;
    if (spec.lite) o.lite = true;
    if (spec.bar) o.bar = true;
  }
  if (spec.hand === -1) o.hand = -1;
  if (spec.sw === -1) o.sw = -1;
  return o;
}

// The width an opening of this kind wants when the tool doesn't say.
export function defaultOpeningWidth(opts = {}) {
  if (opts.k === OP_WINDOW) return WINDOW_W;
  return opts.leaf === LEAF_DOUBLE ? DOUBLE_DOOR_W : DOOR_W;
}

// Per-segment wall state. Same vocabulary as the grid's edge arrays minus the
// door, which is an opening rather than a segment kind. Glass took the 2 that
// Phase 2 reserved for it; railing follows as 3.
//
// A railing is the one that isn't a wall in the ordinary sense: waist-high, no
// enclosure, and it exists to stop you falling off an open floor edge rather
// than to divide two rooms. It shares this enum anyway because everything that
// walks a boundary — the renderer, the doorway bookkeeping, the walkthrough —
// wants to ask one question per segment, not three.
export const SEG_NONE = 0;
export const SEG_WALL = 1;
export const SEG_GLASS = 2;
export const SEG_RAIL = 3;
export const SEG_KINDS = [SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL];

// Anything that isn't SEG_NONE is *something* built on that segment, which is
// what most callers actually mean when they check for a wall.
export const isBuilt = (v) => v === SEG_WALL || v === SEG_GLASS || v === SEG_RAIL;
// ...and these are the kinds a doorway can be cut through. A gap in a railing
// is a real thing (it's where the stair lands), so it counts too.
export const canOpen = (v) => isBuilt(v);

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

// The direction a run points, as a unit vector, or null if its two ends are
// the same point. A ring is *wound*, so the sense of this is the ring's rather
// than the wall's — which is why `parallelDirs` below compares the two lines
// and not the two arrows. (The same distinction `hand` and `sw` turn on; see
// the note about winding at the top of this file.)
export function unitDir(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  return len > MIN_SEG / 8 ? { x: dx / len, z: dz / len } : null;
}

// How far off parallel two runs may be and still count as the same line.
//
// The number is pinned from both sides, and the test in shapes.test.mjs holds
// it there. Below it: the sharpest step the arc tessellator can produce, which
// is 28° between two chords of a wall curved to `MAX_BULGE` — a drag that
// follows a curved wall has to clear that or it stops halfway round the arc.
// Above it: 45°, the shallowest turn anybody draws *as a corner* (a chamfer),
// which must never read as the same wall. 36° sits between the two with room
// on both sides.
export const PARALLEL_TOL = Math.PI / 5;   // 36°

// Do these two directions lie along the same line, either way round? The
// absolute cross and dot products make it a question about lines rather than
// arrows: a ring's top and bottom walls run opposite ways and are parallel.
export function parallelDirs(a, b, tol = PARALLEL_TOL) {
  if (!a || !b) return true;
  const cross = Math.abs(a.x * b.z - a.z * b.x);
  const dot = Math.abs(a.x * b.x + a.z * b.z);
  return Math.atan2(cross, dot) <= tol;
}

// ---------- rings ----------

export const ringLen = (ring) => ring.pts.length;

export const segEnds = (ring, i) => [ring.pts[i], ring.pts[(i + 1) % ring.pts.length]];

// The direction of one of a ring's runs.
export const segDir = (ring, i) => unitDir(...segEnds(ring, i));

export function ringSignedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  }
  return a / 2;
}

export const ringIsCCW = (pts) => ringSignedArea(pts) > 0;

// Flip one of an opening's run-relative signs, keeping the record canonical:
// -1 is written, +1 is the absent default (see writeOpening).
const flipRunSign = (o, key) => {
  if (sign(o[key]) === -1) delete o[key]; else o[key] = -1;
};

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
    // `hand` and `sw` are relative to the run, and the run now points the
    // other way — both flip, so the leaf keeps hanging on the same physical
    // jamb and swinging toward the same physical side. Re-winding a ring is a
    // re-parameterization, never a change to the building (Phase 32; a mirror
    // used to hang every door on the wrong jamb through this line).
    flipRunSign(o, 'hand');
    flipRunSign(o, 'sw');
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

// Is there anything to stand on at (x, z) on this storey? It lives here rather
// than in stairs.js (where it started life) because it is the same question
// the wall-thickness probe asks: "is there a room on this side?" — see
// walls.js.
export function floorSolidAt(floor, x, z) {
  if (!floor) return false;
  return !!shapeAt(floor, x, z);
}

// {shape, ring, seg, t, x, z, dist, dir} for the closest boundary segment on
// the floor.
//
// `opts.parallelTo` is Phase 13's addition and the whole of the wall tool's
// drag: given a direction, only runs along that same line are candidates. It
// is a *filter on the search* rather than a test on the answer, and the
// difference is the bug it fixes — drag along a wall, drift a foot past the
// corner, and the nearest segment is the one at right angles to it, so a test
// on the answer would refuse the stroke where the filter finds the parallel
// wall that is still perfectly well within reach.
export function nearestSegment(floor, x, z, maxDist = Infinity, opts = {}) {
  const want = opts.parallelTo || null;
  const tol = opts.tol === undefined ? PARALLEL_TOL : opts.tol;
  let best = null;
  for (const shape of shapesOf(floor)) {
    shape.rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.pts.length; i++) {
        const [a, b] = segEnds(ring, i);
        const p = projectOnSeg(a, b, x, z);
        if (p.dist > maxDist || (best && p.dist >= best.dist)) continue;
        const dir = unitDir(a, b);
        if (want && !parallelDirs(want, dir, tol)) continue;
        best = { shape, ring: ri, seg: i, t: p.t, x: p.x, z: p.z, dist: p.dist, dir };
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

// ---------- naming ----------
//
// A room's *number*, read off the end of its name: "Room 101" is 101, "Lab
// 204b" is 204. Deliberately the same reading `bindRoom` does in
// timetable.js, because the two questions are one question — what number is
// this room, for the purpose of telling it apart from the others.
const ROOM_NUM = /(\d{1,4})[a-z]?\s*$/i;
const roomNumberOf = (name) => {
  const m = ROOM_NUM.exec(String(name ?? '').trim());
  return m ? Number(m[1]) : null;
};

// The storey's hundred-block: 101 on the ground, 201 above it, and so on —
// the convention `nameFor` in generate.js already numbers a generated school
// by. Anything past the eighth storey keeps counting rather than wrapping.
export const storeyBase = (floorIndex) => (Math.max(0, floorIndex | 0) + 1) * 100;

// The next room name nobody has used yet, for a room about to be drawn on
// this storey.
//
// This exists because the room-name field used to be seeded with the literal
// string 'Room 101' and never advanced, so every room anyone drew by hand was
// called Room 101 — three rectangles, three rooms, one name. That is worse
// than untidy: `bindRoom` resolves an imported timetable's room token by
// exact name, and a duplicate makes that answer a coin toss.
//
// Numbers are taken as used across the *whole building*, not just this
// storey, for exactly that reason — a name has to identify a room among all
// of them, and a stray "Room 201" typed on the ground floor should still push
// the first floor's suggestion past it.
export function nextRoomName(state, floorIndex = null) {
  const floors = (state && Array.isArray(state.floors)) ? state.floors : [];
  const i = floorIndex == null
    ? Math.max(0, Math.min(floors.length - 1, state?.currentFloor | 0))
    : floorIndex;
  const used = new Set();
  for (const floor of floors) {
    for (const shape of shapesOf(floor)) {
      const n = roomNumberOf(shape.name);
      if (n != null) used.add(n);
    }
  }
  const base = storeyBase(i);
  let n = base + 1;
  while (used.has(n)) n += 1;
  return `Room ${n}`;
}

// ---------- construction ----------

// Ids come off the same monotonic counter props and links use, so a shape, a
// prop and a stair can never collide in a save file. Exported since Phase 12,
// because lattice.js bakes rooms too and they take their ids from here.
export function takeId(state) {
  const id = Math.max(1, Math.floor(state.nextId || 1));
  state.nextId = id + 1;
  return id;
}

// The room record. `id` is what Phase 12 exists for — every other module can
// now refer to a room from outside the file. `group` and `load` are the two
// fields Phase 7 said would open a save bump: which occupancy group a room is
// read as, and a design occupant load somebody typed in place of the one the
// area implies. Both default to null, which means "work it out from the name
// and the area", which is what every earlier version did.
export function makeShape(pts, opts = {}) {
  const ring = makeRing(pts, opts.wall ?? SEG_WALL);
  if (!ring) return null;
  orientRing(ring, true);
  return {
    id: 0,
    name: opts.name || null,
    color: opts.color || null,
    // Present-and-null rather than absent, so a room built here and a room
    // read out of a save file are the same record — which is what lets the
    // round-trip test compare them field for field.
    fin: opts.fin || null,
    paint: opts.paint || null,
    group: opts.group || null,
    load: Number.isFinite(opts.load) && opts.load > 0 ? Math.round(opts.load) : null,
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
  const v = SEG_KINDS.includes(val) ? val : SEG_NONE;
  if (ring.walls[seg] === v) return false;
  ring.walls[seg] = v;
  // Changing *kind* keeps the doorways — a door in a wall that becomes a glass
  // partition is a door in a glass partition. Clearing the segment takes them,
  // since there's nothing left for them to be an opening in.
  if (v === SEG_NONE) ring.openings = ring.openings.filter((o) => o.seg !== seg);
  return true;
}

export const openingsOnSeg = (ring, seg) => ring.openings.filter((o) => o.seg === seg);

// A field-complete copy. Openings grew optional fields in Phase 2 and every
// clone path (duplicate floor, copy room, undo snapshots that go through
// `cloneShape`) has to carry them, so there is one copier rather than four
// destructurings that each forgot a different field.
export const copyOpening = (o) => ({ ...o });

// Doorways can't run off the ends of their wall, and a segment shorter than a
// door plus its jambs can't hold one at all. `opts` carries the Phase 2 fields
// (kind, leaf, sill, and the rest — see `openingSpec`); omit it and you get the
// plain cased hole every earlier version placed.
export function addOpening(shape, ringIdx, seg, t, w = null, opts = {}) {
  const ring = shape.rings[ringIdx];
  if (!ring || seg < 0 || seg >= ring.walls.length) return null;
  if (!canOpen(ring.walls[seg])) return null;
  const [a, b] = segEnds(ring, seg);
  const len = segLength(a, b);
  const want = Number.isFinite(w) ? w : defaultOpeningWidth(opts);
  const width = Math.min(MAX_DOOR_W, Math.max(MIN_DOOR_W, want));
  if (len < width + 0.5) return null;
  const half = (width / 2 + 0.25) / len;
  const at = Math.min(1 - half, Math.max(half, t));
  if (openingsOnSeg(ring, seg).some((o) => Math.abs(o.t - at) * len < (width + o.w) / 2)) return null;
  const opening = writeOpening(seg, at, width, opts);
  ring.openings.push(opening);
  return opening;
}

// Toggle a doorway under the cursor: remove the one you clicked, or cut a new
// one where you clicked. Clicking one that is already there but of a *different*
// kind re-cuts it rather than removing it — switching a door to a window is one
// click with the window option picked, not a delete and a replace.
export function toggleOpening(shape, ringIdx, seg, t, w = null, opts = {}) {
  const ring = shape.rings[ringIdx];
  if (!ring) return null;
  const [a, b] = segEnds(ring, seg);
  const len = segLength(a, b);
  const hit = openingsOnSeg(ring, seg)
    .find((o) => Math.abs(o.t - t) * len <= o.w / 2 + 0.5);
  if (hit) {
    const want = writeOpening(hit.seg, hit.t, hit.w, opts);
    const same = openingSpec(hit), next = openingSpec(want);
    ring.openings.splice(ring.openings.indexOf(hit), 1);
    if (same.kind === next.kind && same.leaf === next.leaf &&
        same.lite === next.lite && same.bar === next.bar &&
        same.hand === next.hand && same.sw === next.sw) {
      return null;   // same thing clicked twice — that's a removal
    }
    return addOpening(shape, ringIdx, seg, hit.t, hit.w, opts);
  }
  if (!canOpen(ring.walls[seg])) ring.walls[seg] = SEG_WALL;
  return addOpening(shape, ringIdx, seg, t, w, opts);
}

// Flip a door's hinge jamb, or the side it swings toward. Both are one field
// each and neither can be wrong, so they toggle rather than validate.
export function flipOpening(opening, what = 'hand') {
  if (!opening) return false;
  const spec = openingSpec(opening);
  if (spec.window || spec.leaf === LEAF_NONE) return false;
  const key = what === 'swing' ? 'sw' : 'hand';
  const next = (key === 'swing' ? spec.sw : spec[key]) === 1 ? -1 : 1;
  if (next === 1) delete opening[key]; else opening[key] = -1;
  return true;
}

// ---------- curved walls ----------
//
// The wishlist's biggest schema ask, answered without a schema change.
//
// Everything downstream of a ring — collision, the blueprint, the renderer,
// the flood fill, `solidSpans` — assumes a boundary is a sequence of straight
// segments. Storing an arc as a per-segment `bulge` would mean teaching all
// five of them about a second kind of segment, and re-deriving the chords
// every time any of them looked. The wishlist's own instruction is the way
// out: "arcs should tessellate into segments at the model boundary". So they
// do, and the model boundary is the *authoring* moment. Curving a wall inserts
// real vertices into the ring; from that point on it is an ordinary polygon
// with a lot of short segments, and every reader is already correct about it.
//
// The trade is that curvature isn't a live parameter — a curved wall doesn't
// remember it was curved. `straightenRun` is what makes that survivable: the
// tool keeps its own memo of the arc it just laid down and can flatten it back
// to the chord before re-curving at a new radius, so adjusting a curve is one
// straighten and one curve rather than an accumulating pile of arcs. The memo
// is tool state, never saved state, which is the same rule selections follow.

// Sagitta as a fraction of the chord. 0.5 is a semicircle; past that the arc
// is more than half a circle and the ends start to close on each other.
export const MAX_BULGE = 0.9;
export const MIN_ARC_CHORD = 1.5;   // ft — shorter than this and there's no room to curve
export const MAX_ARC_STEPS = 32;
export const ARC_CHORD_FT = 2;      // aim for a chord about this long

const TAU = Math.PI * 2;
const wrapPi = (a) => {
  let v = a % TAU;
  if (v > Math.PI) v -= TAU;
  if (v <= -Math.PI) v += TAU;
  return v;
};

// The circle through a and b whose apex sits `bulge * |ab|` off the chord,
// toward the chord's left-hand normal for a positive bulge.
export function arcGeometry(a, b, bulge) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  const h = bulge * L;
  if (L < 1e-6 || Math.abs(h) < 1e-6) return null;
  const R = (L * L / 4 + h * h) / (2 * Math.abs(h));
  const ux = dx / L, uz = dz / L;
  const nx = -uz, nz = ux;                       // left of the run
  const mx = a.x + dx / 2, mz = a.z + dz / 2;
  const sgn = Math.sign(h);
  const off = R - Math.abs(h);                   // centre-to-chord distance
  return {
    R, L, h,
    cx: mx - nx * sgn * off,
    cz: mz - nz * sgn * off,
    apex: { x: mx + nx * h, z: mz + nz * h },
  };
}

// `steps` chords from a to b along that arc, as `steps + 1` points (the two
// endpoints included). Pass steps = 0 to let the chord length pick.
export function arcPoints(a, b, bulge, steps = 0) {
  const g = arcGeometry(a, b, bulge);
  if (!g) return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  const t0 = Math.atan2(a.z - g.cz, a.x - g.cx);
  const t1 = Math.atan2(b.z - g.cz, b.x - g.cx);
  const tap = Math.atan2(g.apex.z - g.cz, g.apex.x - g.cx);
  // Two ways round the circle from a to b; the arc we want is the one the
  // apex is on. Testing for it beats a minor/major-arc case split, which gets
  // the sign wrong exactly at the semicircle.
  let sweep = wrapPi(t1 - t0);
  const onArc = (s) => {
    const d = wrapPi(tap - t0);
    return s >= 0 ? (d >= -1e-9 && d <= s + 1e-9) : (d <= 1e-9 && d >= s - 1e-9);
  };
  if (!onArc(sweep)) sweep += sweep >= 0 ? -TAU : TAU;

  const arcLen = Math.abs(sweep) * g.R;
  const n = steps > 0
    ? Math.min(MAX_ARC_STEPS, Math.max(2, Math.round(steps)))
    : Math.min(MAX_ARC_STEPS, Math.max(3, Math.round(arcLen / ARC_CHORD_FT)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const th = t0 + (sweep * i) / n;
    out.push({ x: g.cx + Math.cos(th) * g.R, z: g.cz + Math.sin(th) * g.R });
  }
  // Land exactly on the endpoints rather than within a rounding error of them:
  // a ring's corners have to still meet its neighbours' after this.
  out[0] = { x: a.x, z: a.z };
  out[n] = { x: b.x, z: b.z };
  return out;
}

// Replace segment `seg` with a tessellated arc. Returns the number of segments
// it became (1 means nothing happened).
//
// Openings on the curved segment are dropped. A run of 2ft chords has nowhere
// to put a 3ft door, and the alternative — sliding it onto whichever chord it
// nearly fits — would put a doorway somewhere nobody asked for. This is the
// same call `deleteVertex` makes about openings on a segment that stops
// existing; the tool says so in the status line rather than losing one quietly.
export function curveSegment(shape, ringIdx, seg, bulge, steps = 0) {
  const ring = shape && shape.rings[ringIdx];
  if (!ring || seg < 0 || seg >= ring.pts.length) return 1;
  const b = Math.min(MAX_BULGE, Math.max(-MAX_BULGE, bulge));
  if (Math.abs(b) < 0.01) return 1;
  const [p0, p1] = segEnds(ring, seg);
  if (segLength(p0, p1) < MIN_ARC_CHORD) return 1;

  const pts = arcPoints(p0, p1, b, steps);
  const mid = pts.slice(1, pts.length - 1);
  if (!mid.length) return 1;
  if (ring.pts.length + mid.length > MAX_RING_PTS) return 1;

  const at = seg + 1;
  ring.pts.splice(at, 0, ...mid);
  ring.walls.splice(at, 0, ...new Array(mid.length).fill(ring.walls[seg]));
  ring.openings = ring.openings
    .filter((o) => o.seg !== seg)
    .map((o) => (o.seg > seg ? { ...o, seg: o.seg + mid.length } : o));
  return mid.length + 1;
}

// Merge `count` consecutive segments starting at `seg` back into one straight
// chord — the inverse of `curveSegment`, and the reason re-curving a wall
// doesn't stack arcs on arcs. Returns true if anything was removed.
export function straightenRun(shape, ringIdx, seg, count) {
  const ring = shape && shape.rings[ringIdx];
  if (!ring || count <= 1 || seg < 0 || seg >= ring.pts.length) return false;
  const drop = Math.min(count - 1, ring.pts.length - 3);
  if (drop <= 0) return false;
  const kind = ring.walls[seg];
  // The vertices to remove are the ones *between* the run's ends, which for a
  // run that wraps the ring's start point are not one contiguous slice — so
  // they're collected by index and removed high-to-low.
  const n = ring.pts.length;
  const idx = [];
  for (let i = 1; i <= drop; i++) idx.push((seg + i) % n);
  const gone = new Set(idx);
  idx.sort((a, b) => b - a);
  for (const i of idx) { ring.pts.splice(i, 1); ring.walls.splice(i, 1); }
  ring.openings = ring.openings
    .filter((o) => !gone.has(o.seg))
    .map((o) => {
      let shift = 0;
      for (const i of idx) if (o.seg > i) shift++;
      return shift ? { ...o, seg: o.seg - shift } : o;
    });
  const keep = seg > n - 1 - drop ? seg - drop : seg;
  ring.walls[Math.min(keep, ring.walls.length - 1)] = kind;
  return true;
}

// ---------- snapping ----------
//
// Rooms drawn by hand have to butt cleanly against ones painted with the 4ft
// brush, so the lattice is a snap target even though a room doesn't live on
// it. Order of preference: an existing vertex, a lattice corner, a point on an
// existing wall, then a single lattice axis.
//
// Phase 35: the lattice has a phase. `opts.origin` is where the drawing grid
// starts (gridref.js) and defaults to the corner of the sheet, which is where
// it started for every version before it — so the reason this snap exists
// survives a design whose grid was indexed off a traced photograph, and a
// hand-drawn room still butts cleanly against a painted one. The *pitch* is
// deliberately still the 4ft cell rather than the zoom's: a free-drawing tool
// that snapped to 32ft corners when you pulled back would be unusable.

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

  const ox = opts.origin && Number.isFinite(opts.origin.x) ? opts.origin.x : 0;
  const oz = opts.origin && Number.isFinite(opts.origin.z) ? opts.origin.z : 0;
  const gx = ox + Math.round((x - ox) / CELL) * CELL;
  const gz = oz + Math.round((z - oz) / CELL) * CELL;
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
    // An unrecognized kind from a newer file falls back to a plain wall rather
    // than to nothing: a wall you can't render the fancy way is still a wall,
    // and dropping it would open a room up.
    for (let i = 0; i < n; i++) {
      ring.walls[i] = SEG_KINDS.includes(raw.walls[i])
        ? raw.walls[i]
        : (raw.walls[i] === undefined ? ring.walls[i] : SEG_WALL);
    }
  }
  if (Array.isArray(raw.openings)) {
    for (const o of raw.openings.slice(0, MAX_RING_PTS)) {
      if (!o || typeof o !== 'object') continue;
      // A doorway that names a segment the ring doesn't have is dropped, not
      // clamped: sliding it onto a different wall would invent a hole in one.
      const seg = Number.isInteger(o.seg) ? o.seg : -1;
      if (seg < 0 || seg >= n || !canOpen(ring.walls[seg])) continue;
      // Everything past `{seg, t, w}` runs through `openingSpec`, which clamps
      // each field and answers the v1 default for anything missing or strange —
      // so an opening from a newer file arrives as the nearest thing this build
      // can build, never as an invalid one.
      ring.openings.push(writeOpening(
        seg,
        num(o.t, 0.5, 0, 1),
        num(o.w, DOOR_W, MIN_DOOR_W, MAX_DOOR_W),
        o,
      ));
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
    // Phase 2 finishes. Validated by shape rather than by finish.js so this
    // module keeps its no-imports-but-grid property; an unknown key is null,
    // which every reader turns into the default material.
    fin: typeof raw.fin === 'string' && raw.fin.length <= 20 ? raw.fin : null,
    paint: typeof raw.paint === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.paint)
      ? raw.paint.toLowerCase() : null,
    // v11's two. Validated by shape rather than by occupancy.js so this module
    // keeps its imports-only-grid property; an unknown group is null, which
    // every reader turns back into "read it off the name".
    group: typeof raw.group === 'string' && raw.group.length <= 12 ? raw.group : null,
    load: Number.isFinite(raw.load) && raw.load > 0
      ? Math.min(100000, Math.round(raw.load)) : null,
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
    fin: shape.fin || null,
    paint: shape.paint || null,
    group: shape.group || null,
    load: Number.isFinite(shape.load) ? shape.load : null,
    rings: shape.rings.map((r) => ({
      pts: r.pts.map((p) => ({ x: p.x, z: p.z })),
      walls: r.walls.slice(),
      openings: r.openings.map(copyOpening),
    })),
  };
}

// ---------- whole-room transforms ----------
//
// Phase 6: the vertex tool can move, rotate and mirror a *selection* of rooms
// as a unit (see polyedit.js), not just drag one corner at a time. These are
// the pure geometry primitives that make that safe: they only ever move
// points and re-derive winding, so `walls[]`/`openings[]` stay aligned with
// `pts` the same way every other mutation in this file keeps them aligned.
// A prop caught inside the room gets the identical point transform applied to
// its (x, z) by the caller — this file only knows about rooms.

// Rebuild every ring's points through `fn`, then re-settle winding (outer CCW,
// holes CW). A pure translation never needs the re-orientation (it can't flip
// a ring inside-out), but a reflection always does, and re-deriving it from
// the signed area is simpler and safer than each transform tracking its own
// parity — `orientRing` already reverses `walls[]`/`openings[]` correctly
// when it has to (see `reverseRing` above), which is the bookkeeping this
// would otherwise have to duplicate.
function transformShapePoints(shape, fn) {
  shape.rings.forEach((ring, ri) => {
    ring.pts = ring.pts.map(fn);
    orientRing(ring, ri === 0);
  });
  return shape;
}

export function translateShape(shape, dx, dz) {
  if (!dx && !dz) return shape;
  return transformShapePoints(shape, (p) => ({ x: p.x + dx, z: p.z + dz }));
}

// Rotate every point 90° around (cx, cz); `ccw` picks the direction. A
// quarter turn keeps segments axis-swapped rather than off-angle, so a
// rectangular room rotated this way stays snapped to the lattice.
export function rotatePoint90(p, cx, cz, ccw = true) {
  const lx = p.x - cx, lz = p.z - cz;
  return ccw ? { x: cx - lz, z: cz + lx } : { x: cx + lz, z: cz - lx };
}

export function rotateShape90(shape, cx, cz, ccw = true) {
  return transformShapePoints(shape, (p) => rotatePoint90(p, cx, cz, ccw));
}

// Reflect every point across the vertical line x = cx.
export function mirrorPointX(p, cx) {
  return { x: 2 * cx - p.x, z: p.z };
}

export function mirrorShapeX(shape, cx) {
  transformShapePoints(shape, (p) => mirrorPointX(p, cx));
  // A reflection reverses handedness: the side of the wall that was left of a
  // run is right of its image. The re-orientation above already flipped both
  // `hand` and `sw` when it re-wound each ring (a physical no-op — see
  // reverseRing); the mirror owes one more `sw` flip on top of that, so the
  // net effect is the mirrored door: hinged on the mirrored jamb, swinging
  // toward the mirrored side.
  for (const ring of shape.rings) {
    for (const o of ring.openings) flipRunSign(o, 'sw');
  }
  return shape;
}

// Usable floor area across every room on a storey — most of the math a
// building-wide footage readout needs, since each room's own area is already
// tracked (`shapeArea`).
export function totalShapeArea(floor) {
  let a = 0;
  for (const shape of shapesOf(floor)) a += shapeArea(shape);
  return a;
}

// A free-standing copy of `shape`, offset by (dx, dz) and given a fresh id —
// what Ctrl+C/V and Ctrl+D need to clone a room (or several) onto the same
// floor without colliding with the original's id. Caps at MAX_SHAPES like
// `addShape`.
export function addShapeCopy(state, floorIndex, shape, dx = 0, dz = 0) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  if (!Array.isArray(floor.shapes)) floor.shapes = [];
  if (floor.shapes.length >= MAX_SHAPES) return null;
  const clone = cloneShape(shape);
  clone.id = takeId(state);
  if (dx || dz) translateShape(clone, dx, dz);
  floor.shapes.push(clone);
  return clone;
}
