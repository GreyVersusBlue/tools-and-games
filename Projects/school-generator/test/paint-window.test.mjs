// paint-window.test.mjs — the brush rasterizes only the rooms a stroke can
// change (TG-39), and the building that comes out is byte-for-byte the one the
// old brush made.
//
// The oracle below is `rasterize`, `assignOwners` and `paintCells` as they
// stood in js/paint.js before that change, copied here whole: they rasterized
// and re-traced every lattice-aligned room on the storey for every stroke. It
// is deliberately not importing anything the new code could have changed except
// the pieces both versions are built from (`ownedRegions`, the three `reapply`
// verbs, `latticeAligned`, `rasterOf`, `cellCentre`, and everything outside
// paint.js). Each case is stroked with seeded random cells, a chain of strokes
// deep, once through each version, and the two storeys are compared as JSON
// text after every stroke along with the counts each call returned.
// Run `node --test test/paint-window.test.mjs` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CELL, createState } from '../js/grid.js';
import {
  createLattice, setTile, cellIdx, edgeHIdx, edgeVIdx, inGrid,
  traceRegion, EDGE_NONE, EDGE_WALL, EDGE_GLASS, EDGE_RAIL,
} from '../js/lattice.js';
import {
  shapesOf, shapeBBox, pointInShape, segEnds, segLength, isBuilt,
  orientRing, takeId, accentSpans, accentBreaks,
  SEG_GLASS, SEG_RAIL, MAX_SHAPES, MAX_RING_PTS,
} from '../js/shapes.js';
import { pruneAccents } from '../js/wallrun.js';
import {
  latticeAligned, ownedRegions, reapplyOpenings, reapplyAccents, splitAtBreaks,
  rasterOf, cellCentre, paintCells, rasterize,
} from '../js/paint.js';
import { deserialize, serialize } from '../js/save-load.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildSchool } from '../js/generate.js';

const EPS = 1e-6;
const edgeForSeg = (v) => (v === SEG_GLASS ? EDGE_GLASS : v === SEG_RAIL ? EDGE_RAIL : EDGE_WALL);

// ---------- the oracle: paint.js before TG-39 ----------

function rasterizeOld(state, floorIndex) {
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

function paintCellsOld(state, floorIndex, cells, on = true, opts = {}) {
  const out = { changed: 0, refused: 0, frozen: 0, offSheet: 0, rooms: 0, added: 0, removed: 0, accentsOff: 0 };
  const R = rasterizeOld(state, floorIndex);
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

  // A straight wall the room had in two colours gets its corner back (#860),
  // before anything is put on a segment by number.
  rooms.forEach((record, ri) => {
    if (made.has(ri) || !built.has(ri)) return;
    const breaks = accentBreaks(record);
    if (!breaks.length) return;
    for (const shape of built.get(ri)) splitAtBreaks(shape, breaks);
  });

  // The doorways, put back where they are rather than where their index was.
  rooms.forEach((record, ri) => {
    if (made.has(ri) || !built.has(ri)) return;
    const points = openingPoints(record);
    if (!points.length) return;
    for (const shape of built.get(ri)) reapplyOpenings(shape, points);
  });

  // And the accent walls (#846), the same way: a room cut in two keeps the
  // accent on whichever half the wall is now, or on both.
  rooms.forEach((record, ri) => {
    if (made.has(ri) || !built.has(ri)) return;
    const spans = accentSpans(record);
    if (!spans.length) return;
    for (const shape of built.get(ri)) reapplyAccents(shape, spans);
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
  // #964. A stroke that rubs a room out can leave a free-standing wall's
  // painted face with no room in front of it, which is a face the brush
  // refuses and the load takes off (#910): the accent went on being written to
  // the file until then. Asked here by the rule every other edit asks by, once
  // the storey's rooms are what the stroke left, and only of a stroke that
  // rubs out: one that lays floor takes a room from in front of nothing. A
  // stroke that moved no cell returned above and is not asked either.
  if (!on) out.accentsOff = pruneAccents(floor);
  return out;
}


// ---------- the cases ----------

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clone = (s) => JSON.parse(JSON.stringify(s));
const fixture = (name) => deserialize(fs.readFileSync(`test/fixtures/${name}.json`, 'utf8'));

// A stroke: sometimes a lone cell, sometimes a short drag, sometimes a block;
// anchored on a random room's outline half the time, because strokes far from
// everything exercise nothing, and anywhere on the sheet the rest.
function randomStroke(rnd, state, fi) {
  const R = rasterOf(state, fi);
  const shapes = shapesOf(state.floors[fi]);
  let cx, cy;
  if (shapes.length && rnd() < 0.7) {
    const bb = shapeBBox(shapes[Math.floor(rnd() * shapes.length)]);
    cx = Math.floor((bb.x0 + rnd() * (bb.x1 - bb.x0) - R.x0) / R.pitch) + Math.floor(rnd() * 3) - 1;
    cy = Math.floor((bb.z0 + rnd() * (bb.z1 - bb.z0) - R.z0) / R.pitch) + Math.floor(rnd() * 3) - 1;
  } else {
    cx = Math.floor(rnd() * (R.w + 2)) - 1;
    cy = Math.floor(rnd() * (R.h + 2)) - 1;
  }
  const kind = rnd();
  const cells = [];
  const w = kind < 0.4 ? 1 : 1 + Math.floor(rnd() * 5);
  const h = kind < 0.4 ? 1 : kind < 0.7 ? 1 : 1 + Math.floor(rnd() * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ x: cx + x, y: cy + y });
  return { cells, on: rnd() < 0.55 };
}

function chain(name, build, strokes, seed) {
  test(`${name}: ${strokes} random strokes per storey come out byte-identical`, () => {
    const rnd = mulberry32(seed);
    const base = build();
    let moved = 0;
    for (let fi = 0; fi < base.floors.length; fi++) {
      let a = clone(base), b = clone(base);
      for (let k = 0; k < strokes; k++) {
        // Every ninth stroke is an undo: the same storey as new objects, which
        // is all a restore from history is as far as the brush can tell.
        if (k % 9 === 8) { a = clone(a); b = clone(b); }
        const { cells, on } = randomStroke(rnd, a, fi);
        const opts = rnd() < 0.5 ? {} : { name: `P${k}`, color: '#abcdef' };
        const ra = paintCellsOld(a, fi, cells, on, opts);
        const rb = paintCells(b, fi, cells, on, opts);
        assert.equal(JSON.stringify(rb), JSON.stringify(ra), `${name} floor ${fi} stroke ${k}: the counts differ`);
        assert.equal(JSON.stringify(b), JSON.stringify(a), `${name} floor ${fi} stroke ${k}: the storey differs`);
        if (ra.changed) moved++;
      }
    }
    assert.ok(moved >= strokes / 4, `${name}: only ${moved} strokes changed anything, the case tests nothing`);
  });
}

chain('the sample school', () => buildSampleSchool(), 80, 11);
for (const [i, f] of ['plan-v1', 'plan-v2', 'plan-v5', 'sample-v10', 'generated-v10'].entries()) {
  chain(`fixture ${f}`, () => fixture(f), 60, 100 + i);
}
const LARGE = { students: 2400, band: 'high', storeys: 2, seed: 3 };
chain('a generated large school', () => buildSchool({ ...LARGE }), 25, 7);

test('once the brush has traced a storey, a stroke far away leaves its rooms the very same objects', () => {
  const s = buildSampleSchool();
  const fi = 0;
  const R = rasterOf(s, fi);
  const far = (sh) => {
    const bb = shapeBBox(sh);
    return bb.x1 < R.x0 + (R.w - 8) * R.pitch && bb.z1 < R.z0 + (R.h - 8) * R.pitch;
  };
  const stroke = (x, y) => paintCells(s, fi, [{ x, y }], true);
  // The first stroke after a load re-traces everything, as it always did.
  const first = shapesOf(s.floors[fi]).filter((sh) => latticeAligned(sh, R));
  assert.equal(stroke(R.w - 2, R.h - 2).changed, 1);
  assert.ok(first.length >= 5 && first.every((sh) => !shapesOf(s.floors[fi]).includes(sh)), 'a fresh load is traced whole');
  // After it, only the rooms by the stroke are.
  const settled = shapesOf(s.floors[fi]).filter(far);
  assert.ok(settled.length >= 3, `${settled.length} rooms far from the corner`);
  assert.equal(stroke(R.w - 3, R.h - 2).changed, 1);
  const after = shapesOf(s.floors[fi]);
  for (const sh of settled) assert.ok(after.includes(sh), `room ${sh.id} was rebuilt for a stroke nowhere near it`);
  const R2 = rasterize(s, fi, { x0: R.x0 + (R.w - 3) * R.pitch, z0: R.z0 + (R.h - 3) * R.pitch, x1: R.x0 + R.w * R.pitch, z1: R.z0 + R.h * R.pitch });
  assert.ok(R2.skipped >= settled.length, `${R2.skipped} skipped`);
});

test('a settled room another tool has edited is traced again, as the old brush would', () => {
  const base = fixture('generated-v10');
  const a = clone(base), b = clone(base);
  const far = [{ x: 78, y: 42 }];
  paintCellsOld(a, 0, far, true); paintCells(b, 0, far, true);
  assert.equal(JSON.stringify(b), JSON.stringify(a));
  const flush = (st) => {
    const hall = shapesOf(st.floors[0]).find((sh) => sh.name === 'Main Hall');
    const o = hall.rings[0].openings.find((op) => op.seg === 1);
    o.t = 0.1;          // a door pushed against the corner, as a vertex edit leaves it
    return o;
  };
  flush(a); flush(b);
  const next = [{ x: 78, y: 41 }];
  paintCellsOld(a, 0, next, true); paintCells(b, 0, next, true);
  assert.equal(JSON.stringify(b), JSON.stringify(a));
  const hall = shapesOf(b.floors[0]).find((sh) => sh.name === 'Main Hall');
  assert.ok(hall.rings[0].openings.find((op) => op.seg === 1).t > 0.1, 'the brush moved it off the corner');
});

test('the storey cap counts rooms the stroke skipped, so a full storey refuses a new room exactly as before', () => {
  const a = createState(100, 100), b = createState(100, 100);
  // 510 lone cells in one stroke, then five more far from all of them.
  const lone = [];
  for (let n = 0; n < 510; n++) lone.push({ x: 2 * (n % 40), y: 2 * Math.floor(n / 40) });
  const far = [0, 1, 2, 3, 4].map((n) => ({ x: 2 * n + 84, y: 2 * n + 84 }));
  for (const cells of [lone, far, far]) {
    const ra = paintCellsOld(a, 0, cells, true), rb = paintCells(b, 0, cells, true);
    assert.equal(JSON.stringify(rb), JSON.stringify(ra));
    assert.equal(JSON.stringify(b), JSON.stringify(a));
  }
  assert.equal(shapesOf(b.floors[0]).length, 512, 'the cap was reached');
});

test('a stroke reaches rooms two walls away: the closure follows touching boxes all the way', () => {
  // Measured while writing this: stopping at the neighbours' neighbours diverged
  // from the old brush on the second stroke over generated-v10, because shared
  // walls are re-claimed pass after pass down a run of halls. The chain cases
  // above are what hold that; this one pins that the reach really is long.
  const s = fixture('generated-v10');
  const R = rasterOf(s, 0);
  paintCells(s, 0, [{ x: 78, y: 42 }], true);               // settle everything
  const hall1 = shapesOf(s.floors[0]).find((sh) => sh.name === 'Main Hall');
  const bb = shapeBBox(hall1);
  const win = { x0: bb.x0, z0: bb.z0, x1: bb.x0 + R.pitch, z1: bb.z0 + R.pitch };
  const got = rasterize(s, 0, win);
  const names = got.rooms.map((sh) => sh.name);
  assert.ok(names.includes('Main Hall 2') && names.includes('Main Hall 3'), names.join());
});
