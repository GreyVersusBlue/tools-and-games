// wallrun.js — a wall drawn from one point to another.
//
// Until this module the wall tool had no way to say how long a wall was. You
// pointed at a room's boundary and the *whole* of whichever run was nearest
// became a wall — so the length was whatever the polygon happened to have
// between two of its corners, and a 30ft classroom side could not be walled
// for eight feet of its length without first going and inserting two vertices
// by hand with a different tool. The tool guessed, and the guess was the
// polygon's, not yours.
//
// A wall is now drawn the way the overlay's measurement is taken: click one
// end, click the other. Which leaves this module one question to answer —
// **what does a run from A to B actually build?** — and the answer is in two
// parts, because a school has two kinds of wall in it:
//
//   along a room's boundary   the run splits the ring at both ends and sets
//                             the covered piece. That keeps every derived
//                             thing right: the room is still bounded there,
//                             the thickness probe still sees a room on each
//                             side, a door still cuts into a ring segment.
//
//   anywhere else             a **wall line**: a free-standing run in world
//                             feet, kept on the floor as `walls[]`. A garden
//                             wall, a corridor screen, the start of a wing —
//                             things a school has that are not the side of a
//                             room and never were.
//
// One drawn run can be both: draw across a courtyard from one wing to the
// other and the two ends land on ring boundaries while the middle does not.
// `drawWallRun` works out which is which and returns what it did.
//
// The record, on `floor.walls`:
//
//   { id, ax, az, bx, bz, kind, openings?: [{ seg: 0, t, w, ... }] }
//
// `openings` is deliberately the same record `shapes.js` puts on a ring, with
// `seg` pinned to 0 — a wall line is one segment, so every consumer that
// already filters a ring's openings by segment index reads a wall line's with
// no new branch at all.
//
// The floor grows no `walls` key until one is drawn (see save-load.js), which
// is the same promise every optional record in this codebase keeps: a design
// with no wall lines round-trips as the bytes it went in as.
//
// Pure module: no three.js. Exercised by test/wallrun.test.mjs.

import {
  MIN_SEG, SEG_WALL, SEG_KINDS, isBuilt, canOpen,
  MIN_DOOR_W, MAX_DOOR_W, defaultOpeningWidth, writeOpening, openingSpec,
  shapesOf, segEnds, unitDir, parallelDirs, projectOnSeg,
  insertVertex, setSegWall, takeId,
} from './shapes.js';

// Per floor. The same order of magnitude as MAX_SHAPES: a wall line is a
// cheaper record than a room, and a plan that wants five hundred of them is
// drawing a fence, which is a fair thing to want.
export const MAX_WALL_LINES = 512;

// How far off an existing boundary a drawn run may be and still count as being
// *on* it. Under half the 4ft cell, so a run snapped one grid step away from a
// wall is a second wall rather than a re-statement of the first.
export const ON_LINE_TOL = 0.9;          // ft
// ...and how far off parallel. Tighter than shapes.js's PARALLEL_TOL (36°),
// which exists to let a drag follow a tessellated curve: a run either lies
// along a boundary or it crosses it, and 6° is generous for the first.
export const ON_LINE_ANGLE = Math.PI / 30;   // 6°

// A drawn run shorter than this is a mis-click, not a wall.
export const MIN_RUN = Math.max(MIN_SEG * 2, 0.5);   // ft

export const wallLinesOf = (floor) => (floor && Array.isArray(floor.walls) ? floor.walls : []);

export const lineEnds = (line) => [{ x: line.ax, z: line.az }, { x: line.bx, z: line.bz }];
export const lineLength = (line) => Math.hypot(line.bx - line.ax, line.bz - line.az);
export const lineKind = (line) => (SEG_KINDS.includes(line && line.kind) && isBuilt(line.kind)
  ? line.kind : SEG_WALL);
export const lineOpenings = (line) =>
  (line && Array.isArray(line.openings) ? line.openings : []);

// ---------- the records ----------

export function makeWallLine(id, a, b, kind = SEG_WALL) {
  return {
    id,
    ax: a.x, az: a.z, bx: b.x, bz: b.z,
    kind: SEG_KINDS.includes(kind) && isBuilt(kind) ? kind : SEG_WALL,
  };
}

export function addWallLine(state, floorIndex, a, b, kind = SEG_WALL) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  if (!floor) return null;
  if (Math.hypot(b.x - a.x, b.z - a.z) < MIN_RUN) return null;
  if (!Array.isArray(floor.walls)) floor.walls = [];
  if (floor.walls.length >= MAX_WALL_LINES) return null;
  const line = makeWallLine(takeId(state), a, b, kind);
  floor.walls.push(line);
  return line;
}

export function removeWallLine(floor, id) {
  const list = wallLinesOf(floor);
  const i = list.findIndex((l) => l.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  // A floor with no wall lines left carries no key, so it writes none.
  if (!list.length && floor.walls) delete floor.walls;
  return true;
}

// The wall line nearest a world point, as { line, t, x, z, dist }.
export function wallLineAt(floor, x, z, maxDist = ON_LINE_TOL) {
  let best = null;
  for (const line of wallLinesOf(floor)) {
    const [a, b] = lineEnds(line);
    const p = projectOnSeg(a, b, x, z);
    if (p.dist > maxDist || (best && p.dist >= best.dist)) continue;
    best = { line, t: p.t, x: p.x, z: p.z, dist: p.dist };
  }
  return best;
}

// ---------- doorways in a wall line ----------
//
// Mirrors shapes.js's `addOpening`/`toggleOpening` against a record that has
// one segment instead of a ring of them. Kept here rather than generalized
// over there because a ring's openings are bookkeeping — they move when a
// vertex is inserted, they are dropped when a segment is cleared — and a wall
// line has none of that to keep.

export function addLineOpening(line, t, w = null, opts = {}) {
  if (!line || !canOpen(lineKind(line))) return null;
  const len = lineLength(line);
  const want = Number.isFinite(w) ? w : defaultOpeningWidth(opts);
  const width = Math.min(MAX_DOOR_W, Math.max(MIN_DOOR_W, want));
  if (len < width + 0.5) return null;
  const half = (width / 2 + 0.25) / len;
  const at = Math.min(1 - half, Math.max(half, t));
  const list = lineOpenings(line);
  if (list.some((o) => Math.abs(o.t - at) * len < (width + o.w) / 2)) return null;
  const opening = writeOpening(0, at, width, opts);
  if (!Array.isArray(line.openings)) line.openings = [];
  line.openings.push(opening);
  return opening;
}

export function toggleLineOpening(line, t, w = null, opts = {}) {
  if (!line) return null;
  const len = lineLength(line);
  const list = lineOpenings(line);
  const hit = list.find((o) => Math.abs(o.t - t) * len <= o.w / 2 + 0.5);
  if (hit) {
    const same = openingSpec(hit), next = openingSpec(writeOpening(0, hit.t, hit.w, opts));
    line.openings.splice(line.openings.indexOf(hit), 1);
    if (!line.openings.length) delete line.openings;
    if (same.kind === next.kind && same.leaf === next.leaf &&
        same.lite === next.lite && same.bar === next.bar &&
        same.hand === next.hand && same.sw === next.sw) {
      return null;    // the same thing clicked twice is a removal
    }
    return addLineOpening(line, hit.t, hit.w, opts);
  }
  return addLineOpening(line, t, w, opts);
}

// The one-segment twin of shapes.js's `moveOpening`: slide an opening along
// its wall line, clamped to the jambs and refused on neighbour overlap, t
// mutated in place. Returns the clamped t or null (t unchanged).
export function moveLineOpening(line, opening, t) {
  if (!line) return null;
  const list = lineOpenings(line);
  if (!list.includes(opening)) return null;
  const len = lineLength(line);
  const half = (opening.w / 2 + 0.25) / len;
  const at = Math.min(1 - half, Math.max(half, t));
  const blocked = list
    .some((o) => o !== opening && Math.abs(o.t - at) * len < (opening.w + o.w) / 2);
  if (blocked) return null;
  opening.t = at;
  return at;
}

// ---------- what a run lies along ----------

const dot = (ux, uz, px, pz) => ux * px + uz * pz;
const cross = (ux, uz, px, pz) => ux * pz - uz * px;

// Where p->q sits on the *line* the run a->(a + u * len) lies on, or null if
// it is not on that line at all. `overlap` is how much of the run it actually
// shares — negative when the two are collinear but apart, which is the
// difference between a wall drawn end to end with this one and a wall drawn
// somewhere else along the same street.
export function alongRun(a, u, len, p, q, tol = ON_LINE_TOL, angleTol = ON_LINE_ANGLE) {
  const v = unitDir(p, q);
  if (!v || !parallelDirs(u, v, angleTol)) return null;
  const pdx = p.x - a.x, pdz = p.z - a.z;
  const qdx = q.x - a.x, qdz = q.z - a.z;
  if (Math.abs(cross(u.x, u.z, pdx, pdz)) > tol) return null;
  if (Math.abs(cross(u.x, u.z, qdx, qdz)) > tol) return null;
  const sp = dot(u.x, u.z, pdx, pdz), sq = dot(u.x, u.z, qdx, qdz);
  const s0 = Math.min(sp, sq), s1 = Math.max(sp, sq);
  return { s0, s1, overlap: Math.min(len, s1) - Math.max(0, s0) };
}

// The stretch of the run p->q actually covers, as a pair of distances from
// `a`, or null if it does not cover a usable length of it.
export function coverOf(a, u, len, p, q, tol = ON_LINE_TOL, angleTol = ON_LINE_ANGLE) {
  const on = alongRun(a, u, len, p, q, tol, angleTol);
  if (!on || on.overlap < MIN_RUN) return null;
  return { c0: Math.max(0, on.s0), c1: Math.min(len, on.s1) };
}

// Every ring segment the run lies along, as { shape, ring, seg, c0, c1 }.
export function ringCovers(floor, a, b, tol = ON_LINE_TOL) {
  const u = unitDir(a, b);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const out = [];
  if (!u) return out;
  for (const shape of shapesOf(floor)) {
    shape.rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.pts.length; i++) {
        const [p, q] = segEnds(ring, i);
        const c = coverOf(a, u, len, p, q, tol);
        if (c) out.push({ shape, ring: ri, seg: i, c0: c.c0, c1: c.c1 });
      }
    });
  }
  return out;
}

// The stretches of [0, len] that nothing covers. `spans` and the answer are
// both [start, end] pairs measured from the start of the run.
export function gapsOf(spans, len, min = MIN_RUN) {
  const sorted = [...spans].sort((x, y) => x[0] - y[0]);
  const gaps = [];
  let at = 0;
  for (const [s, e] of sorted) {
    if (s - at >= min) gaps.push([at, s]);
    at = Math.max(at, e);
  }
  if (len - at >= min) gaps.push([at, len]);
  return gaps;
}

// ---------- writing the run onto a ring ----------

// Split ring segment `seg` so that the stretch the run covers is a segment of
// its own, and set it. Returns { seg, changed }, or null if the ring would not
// take the split (it is already at MAX_RING_PTS, or the cut lands on a corner).
function setCoveredPiece(shape, ringIdx, seg, a, u, c0, c1, kind) {
  const ring = shape.rings[ringIdx];
  if (!ring) return null;
  const [p, q] = segEnds(ring, seg);
  const C0 = { x: a.x + u.x * c0, z: a.z + u.z * c0 };
  const C1 = { x: a.x + u.x * c1, z: a.z + u.z * c1 };
  const t0 = projectOnSeg(p, q, C0.x, C0.z).t;
  const t1 = projectOnSeg(p, q, C1.x, C1.z).t;
  // The run and the ring segment may point opposite ways — the ring is wound,
  // the run is drawn — so order by the *segment's* parameter, not the run's.
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  const loPt = lo === t0 ? C0 : C1;
  const hiPt = hi === t0 ? C0 : C1;

  let target = seg;
  let hiT = hi;
  if (lo > 0.001) {
    const at = insertVertex(shape, ringIdx, seg, loPt.x, loPt.z);
    // A cut that lands on a corner is not a cut: the whole segment is the
    // covered piece already, which is exactly the behaviour every version before this one had and
    // is right here rather than a failure.
    if (at >= 0) { target = at; hiT = (hi - lo) / (1 - lo); }
  }
  if (hiT < 0.999) insertVertex(shape, ringIdx, target, hiPt.x, hiPt.z);
  const changed = setSegWall(shape, ringIdx, target, kind);
  return { seg: target, changed };
}

// ---------- writing the run as free-standing line ----------

// Cut `span` out of an existing line, returning what is left of it (0, 1 or 2
// pieces) as pairs of world points. Used when a run of a different kind is
// drawn over part of one.
function remainderOf(line, a, u, c0, c1) {
  const [p, q] = lineEnds(line);
  const sp = dot(u.x, u.z, p.x - a.x, p.z - a.z);
  const sq = dot(u.x, u.z, q.x - a.x, q.z - a.z);
  const lo = Math.min(sp, sq), hi = Math.max(sp, sq);
  const at = (s) => ({ x: a.x + u.x * s, z: a.z + u.z * s });
  const out = [];
  if (c0 - lo >= MIN_RUN) out.push([at(lo), at(c0)]);
  if (hi - c1 >= MIN_RUN) out.push([at(c1), at(hi)]);
  return out;
}

// ---------- the whole gesture ----------

// Draw a wall from `a` to `b` on one storey. Returns what it did:
//
//   { ok, reason?, length, onRings, lines, replaced }
//
// `onRings` counts room boundaries that were split and set; `lines` is the
// free-standing runs added. Nothing is drawn twice: a stretch already covered
// by a boundary or by an existing line of the same kind is left alone rather
// than doubled, which matters because two coincident walls read as one wall of
// twice the thickness in every derived thing downstream.
export function drawWallRun(state, floorIndex, a, b, kind = SEG_WALL, opts = {}) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  if (!floor) return { ok: false, reason: 'no floor', length: 0, onRings: 0, lines: [], replaced: 0 };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const u = unitDir(a, b);
  if (!u || len < MIN_RUN) {
    return {
      ok: false,
      reason: `A wall needs two different points — that one is ${len.toFixed(1)}ft long.`,
      length: len, onRings: 0, lines: [], replaced: 0,
    };
  }
  const want = SEG_KINDS.includes(kind) && isBuilt(kind) ? kind : SEG_WALL;
  const tol = Number.isFinite(opts.tol) ? opts.tol : ON_LINE_TOL;

  // 1. Room boundaries the run lies along. Processed per ring in descending
  //    segment order: inserting a vertex renumbers every segment above it, and
  //    walking down means the indices still waiting are all below.
  const covers = ringCovers(floor, a, b, tol);
  const byRing = new Map();
  for (const c of covers) {
    const key = `${c.shape.id}:${c.ring}`;
    if (!byRing.has(key)) byRing.set(key, []);
    byRing.get(key).push(c);
  }
  let onRings = 0, alreadyBuilt = 0;
  for (const list of byRing.values()) {
    list.sort((x, y) => y.seg - x.seg);
    for (const c of list) {
      const out = setCoveredPiece(c.shape, c.ring, c.seg, a, u, c.c0, c.c1, want);
      if (!out) continue;
      if (out.changed) onRings++; else alreadyBuilt++;
    }
  }

  // 2. Existing wall lines along the same run. Same kind: absorbed, so drawing
  //    over one extends rather than stacks. Different kind: the drawn run
  //    wins over the stretch it covers, and what is left of the old line
  //    stays as one or two shorter pieces.
  const spans = covers.map((c) => [c.c0, c.c1]);
  let replaced = 0;
  let lo = 0, hi = len;
  for (const line of [...wallLinesOf(floor)]) {
    const [p, q] = lineEnds(line);
    const on = alongRun(a, u, len, p, q, tol);
    // Same kind: touching is enough, so two runs drawn end to end come out as
    // one wall. A different kind has to genuinely overlap before the drawn run
    // takes any of it away.
    if (!on || on.overlap < (lineKind(line) === want ? -tol : MIN_RUN)) continue;
    const sp = on.s0, sq = on.s1;
    if (lineKind(line) === want) {
      // Absorb it: the drawn run grows to cover both, and the old record goes.
      // Deliberately *not* added to `spans` — an absorbed line is one this
      // gesture is re-laying, not one already standing that it should leave
      // alone, and counting it as covered would leave the wall deleted.
      lo = Math.min(lo, sp, sq);
      hi = Math.max(hi, sp, sq);
      removeWallLine(floor, line.id);
      replaced++;
      continue;
    }
    const c0 = Math.max(0, on.s0), c1 = Math.min(len, on.s1);
    const rest = remainderOf(line, a, u, c0, c1);
    removeWallLine(floor, line.id);
    replaced++;
    for (const [ra, rb] of rest) {
      const kept = addWallLine(state, floorIndex, ra, rb, lineKind(line));
      if (kept && Array.isArray(line.openings)) {
        // A doorway only survives if it is still inside the piece it was cut
        // into — an opening halfway along a wall that has been cut in two has
        // no wall left to be an opening in.
        const keptLen = lineLength(kept);
        for (const o of line.openings) {
          const worldT = { x: p.x + (q.x - p.x) * o.t, z: p.z + (q.z - p.z) * o.t };
          const pr = projectOnSeg(ra, rb, worldT.x, worldT.z);
          if (pr.dist < 0.05 && pr.t * keptLen > o.w / 2 && (1 - pr.t) * keptLen > o.w / 2) {
            addLineOpening(kept, pr.t, o.w, o);
          }
        }
      }
    }
  }

  // 3. Everything the run covers that nothing else does becomes a wall line.
  //    Measured against the absorbed extent, so a run drawn end-to-end with an
  //    existing one of the same kind comes out as a single record.
  const shifted = spans.map(([s, e]) => [s - lo, e - lo]);
  const gaps = gapsOf(shifted, hi - lo);
  const at = (s) => ({ x: a.x + u.x * (s + lo), z: a.z + u.z * (s + lo) });
  const lines = [];
  for (const [s, e] of gaps) {
    const line = addWallLine(state, floorIndex, at(s), at(e), want);
    if (line) lines.push(line);
  }

  const ok = onRings > 0 || lines.length > 0 || replaced > 0;
  return {
    ok,
    reason: ok ? null
      : alreadyBuilt ? 'That run is already built along its whole length.'
      : 'Nothing to build there.',
    length: len, onRings, lines, replaced, alreadyBuilt,
  };
}

// ---------- erasing ----------

// Take out whatever a run of wall the cursor is over: a free-standing line
// whole, since a line *is* one wall. Returns the record removed, or null.
export function eraseWallLineAt(floor, x, z, tol = ON_LINE_TOL) {
  const hit = wallLineAt(floor, x, z, tol);
  if (!hit) return null;
  removeWallLine(floor, hit.line.id);
  return hit.line;
}

// ---------- load-time validation ----------

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v)
  ? Math.min(hi, Math.max(lo, v)) : null);

function readOpening(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = num(raw.t, 0, 1);
  const w = num(raw.w, MIN_DOOR_W, MAX_DOOR_W);
  if (t === null || w === null) return null;
  return writeOpening(0, t, w, raw);
}

// One floor's wall lines out of whatever a save file offered. An unreadable
// record is dropped rather than repaired: a wall with one end missing is not a
// wall, and the alternative — guessing where it went — would put geometry in
// the building that nobody drew.
export function normalizeWallLines(raw, extent = 4000, nextId = null) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw.slice(0, MAX_WALL_LINES)) {
    if (!r || typeof r !== 'object') continue;
    const ax = num(r.ax, -extent, extent), az = num(r.az, -extent, extent);
    const bx = num(r.bx, -extent, extent), bz = num(r.bz, -extent, extent);
    if (ax === null || az === null || bx === null || bz === null) continue;
    if (Math.hypot(bx - ax, bz - az) < MIN_RUN) continue;
    const line = {
      id: Math.round(num(r.id, 0, Number.MAX_SAFE_INTEGER) || 0),
      ax, az, bx, bz,
      // An unknown kind reads as a solid wall, never as nothing: the standing
      // rule is that an unknown boundary defaults to *more* solid, not less.
      kind: SEG_KINDS.includes(r.kind) && isBuilt(r.kind) ? r.kind : SEG_WALL,
    };
    if (!line.id && typeof nextId === 'function') line.id = nextId();
    const openings = Array.isArray(r.openings)
      ? r.openings.map(readOpening).filter(Boolean) : [];
    if (openings.length) line.openings = openings;
    out.push(line);
  }
  return out;
}

// Total built length of the free-standing walls on a storey, in feet — what a
// takeoff wants and what the floor panel counts by.
export function wallLineFootage(floor) {
  let ft = 0;
  for (const line of wallLinesOf(floor)) ft += lineLength(line);
  return ft;
}
