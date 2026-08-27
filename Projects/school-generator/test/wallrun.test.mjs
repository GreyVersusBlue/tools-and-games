// wallrun.test.mjs — walls drawn from one point to another.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createState, CELL } from '../js/grid.js';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL, isBuilt, segEnds, segLength,
} from '../js/shapes.js';
import {
  MAX_WALL_LINES, MIN_RUN, ON_LINE_TOL,
  wallLinesOf, lineEnds, lineLength, lineKind, lineOpenings,
  makeWallLine, addWallLine, removeWallLine, wallLineAt,
  addLineOpening, toggleLineOpening,
  coverOf, ringCovers, gapsOf, drawWallRun, eraseWallLineAt,
  normalizeWallLines, wallLineFootage,
} from '../js/wallrun.js';
import { boxRoom } from './build.mjs';

const P = (x, z) => ({ x, z });

// A storey with one 6x5-cell walled room in it, corner at (2, 2) cells.
function room() {
  const s = createState(20, 20);
  const shape = boxRoom(s, 0, 2, 2, 7, 6);
  return { s, f: s.floors[0], shape };
}

// Every built segment of a shape, as [length, kind] pairs.
const built = (shape) => shape.rings[0].walls
  .map((w, i) => [segLength(...segEnds(shape.rings[0], i)), w])
  .filter(([, w]) => isBuilt(w));

// ---------- records ----------

test('a wall line is two points and a kind', () => {
  const l = makeWallLine(7, P(0, 0), P(20, 0));
  assert.equal(l.id, 7);
  assert.equal(lineLength(l), 20);
  assert.equal(lineKind(l), SEG_WALL);
  assert.deepEqual(lineEnds(l), [P(0, 0), P(20, 0)]);
});

test('an unknown kind reads as a solid wall, never as nothing', () => {
  assert.equal(lineKind(makeWallLine(1, P(0, 0), P(4, 0), 99)), SEG_WALL);
  assert.equal(lineKind(makeWallLine(1, P(0, 0), P(4, 0), SEG_NONE)), SEG_WALL);
  assert.equal(lineKind(makeWallLine(1, P(0, 0), P(4, 0), SEG_RAIL)), SEG_RAIL);
});

test('a floor carries no walls key until one is drawn', () => {
  const s = createState(10, 10);
  assert.equal(s.floors[0].walls, undefined);
  assert.deepEqual(wallLinesOf(s.floors[0]), []);
  addWallLine(s, 0, P(0, 0), P(12, 0));
  assert.equal(wallLinesOf(s.floors[0]).length, 1);
  removeWallLine(s.floors[0], s.floors[0].walls[0].id);
  assert.equal(s.floors[0].walls, undefined, 'and loses it again when the last goes');
});

test('a run of nothing is not a wall', () => {
  const s = createState(10, 10);
  assert.equal(addWallLine(s, 0, P(4, 4), P(4, 4 + MIN_RUN / 2)), null);
  assert.deepEqual(wallLinesOf(s.floors[0]), []);
});

test('wall lines take ids off the same counter rooms and props do', () => {
  const s = createState(10, 10);
  const a = addWallLine(s, 0, P(0, 0), P(12, 0));
  const b = addWallLine(s, 0, P(0, 8), P(12, 8));
  assert.notEqual(a.id, b.id);
});

test('the line under the cursor is found by distance', () => {
  const s = createState(10, 10);
  const l = addWallLine(s, 0, P(0, 0), P(20, 0));
  const hit = wallLineAt(s.floors[0], 10, 0.3);
  assert.equal(hit.line.id, l.id);
  assert.ok(Math.abs(hit.t - 0.5) < 1e-9);
  assert.equal(wallLineAt(s.floors[0], 10, 40), null);
});

// ---------- geometry ----------

test('a run lies along a boundary only if it is parallel and close to it', () => {
  const a = P(0, 0), u = P(1, 0), len = 20;
  assert.deepEqual(coverOf(a, u, len, P(4, 0), P(12, 0)), { c0: 4, c1: 12 });
  assert.equal(coverOf(a, u, len, P(4, 3), P(12, 3)), null, 'three feet off is a different wall');
  assert.equal(coverOf(a, u, len, P(4, 0), P(4, 12)), null, 'square to it is not along it');
  assert.deepEqual(coverOf(a, u, len, P(-8, 0), P(6, 0)), { c0: 0, c1: 6 },
    'a boundary that runs off the start is clipped to the run');
});

test('a boundary drawn the other way round still covers the run', () => {
  const cover = coverOf(P(0, 0), P(1, 0), 20, P(12, 0), P(4, 0));
  assert.deepEqual(cover, { c0: 4, c1: 12 });
});

test('the gaps are what nothing covers', () => {
  assert.deepEqual(gapsOf([[4, 12]], 20), [[0, 4], [12, 20]]);
  assert.deepEqual(gapsOf([], 20), [[0, 20]]);
  assert.deepEqual(gapsOf([[0, 20]], 20), []);
  assert.deepEqual(gapsOf([[0, 8], [6, 20]], 20), [], 'overlapping covers leave no gap');
});

// ---------- drawing onto a room boundary ----------

test('a run along part of a room side walls exactly that part', () => {
  const { s, f, shape } = room();
  // The room's top side runs from x=8 to x=32 at z=8 (cells 2..7 at 4ft).
  const before = shape.rings[0].pts.length;
  const out = drawWallRun(s, 0, P(12, 8), P(20, 8), SEG_GLASS);
  assert.ok(out.ok);
  assert.equal(out.lines.length, 0, 'no free-standing wall was needed');
  assert.ok(out.onRings >= 1);
  assert.equal(shape.rings[0].pts.length, before + 2, 'the side was split at both ends');
  const glass = built(shape).filter(([, k]) => k === SEG_GLASS);
  assert.equal(glass.length, 1);
  assert.ok(Math.abs(glass[0][0] - 8) < 1e-6, `the glass run is 8ft, got ${glass[0][0]}`);
});

test('the length is the one you drew, not the one the polygon had', () => {
  const { s, shape } = room();
  const side = built(shape).map(([len]) => len);
  assert.ok(side.includes(24), 'the room side starts out 24ft long');
  drawWallRun(s, 0, P(10, 8), P(13, 8), SEG_RAIL);
  const rail = built(shape).filter(([, k]) => k === SEG_RAIL);
  assert.equal(rail.length, 1);
  assert.ok(Math.abs(rail[0][0] - 3) < 1e-6, `asked for 3ft, got ${rail[0][0]}`);
});

test('a run that runs off the end of a side stops at the corner and carries on as a line', () => {
  const { s, f } = room();
  // From eight feet before the room's left corner to the middle of its top side.
  const out = drawWallRun(s, 0, P(0, 8), P(20, 8), SEG_GLASS);
  assert.ok(out.ok);
  assert.ok(out.onRings >= 1, 'the covered part went onto the ring');
  assert.equal(out.lines.length, 1, 'the part outside it became a wall line');
  assert.ok(Math.abs(lineLength(out.lines[0]) - 8) < 1e-6);
  assert.deepEqual(lineEnds(out.lines[0]), [P(0, 8), P(8, 8)]);
});

test('a run in open ground is one free-standing wall', () => {
  const { s, f } = room();
  const out = drawWallRun(s, 0, P(0, 60), P(40, 60), SEG_WALL);
  assert.ok(out.ok);
  assert.equal(out.onRings, 0);
  assert.equal(out.lines.length, 1);
  assert.equal(lineLength(out.lines[0]), 40);
  assert.equal(wallLinesOf(f).length, 1);
});

test('a run of no length is refused with a reason rather than drawn', () => {
  const s = createState(20, 20);
  const out = drawWallRun(s, 0, P(4, 4), P(4, 4), SEG_WALL);
  assert.equal(out.ok, false);
  assert.match(out.reason, /two different points/);
  assert.deepEqual(wallLinesOf(s.floors[0]), []);
});

test('drawing the same run twice does not stack two walls', () => {
  const s = createState(20, 20);
  drawWallRun(s, 0, P(0, 20), P(40, 20), SEG_WALL);
  const out = drawWallRun(s, 0, P(0, 20), P(40, 20), SEG_WALL);
  assert.equal(wallLinesOf(s.floors[0]).length, 1, 'still one wall');
  assert.equal(lineLength(wallLinesOf(s.floors[0])[0]), 40);
  assert.ok(out.replaced > 0);
});

test('a run drawn end to end with an existing one becomes a single wall', () => {
  const s = createState(20, 20);
  drawWallRun(s, 0, P(0, 20), P(20, 20), SEG_WALL);
  drawWallRun(s, 0, P(20, 20), P(44, 20), SEG_WALL);
  const lines = wallLinesOf(s.floors[0]);
  assert.equal(lines.length, 1);
  assert.equal(lineLength(lines[0]), 44);
});

test('a different kind drawn over part of a wall wins that part and leaves the rest', () => {
  const s = createState(20, 20);
  drawWallRun(s, 0, P(0, 20), P(40, 20), SEG_WALL);
  drawWallRun(s, 0, P(12, 20), P(20, 20), SEG_GLASS);
  const lines = wallLinesOf(s.floors[0]).slice().sort((a, b) => a.ax - b.ax);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => [l.ax, l.bx, lineKind(l)]), [
    [0, 12, SEG_WALL], [12, 20, SEG_GLASS], [20, 40, SEG_WALL],
  ]);
});

test('a storey knows how much free-standing wall is on it', () => {
  const s = createState(20, 20);
  assert.equal(wallLineFootage(s.floors[0]), 0);
  drawWallRun(s, 0, P(0, 20), P(40, 20), SEG_WALL);
  drawWallRun(s, 0, P(0, 40), P(0, 70), SEG_WALL);
  assert.equal(wallLineFootage(s.floors[0]), 70);
});

test('the run is capped rather than allowed to grow without limit', () => {
  const s = createState(200, 200);
  for (let i = 0; i < MAX_WALL_LINES + 5; i++) {
    addWallLine(s, 0, P(0, i * 4), P(10, i * 4));
  }
  assert.equal(wallLinesOf(s.floors[0]).length, MAX_WALL_LINES);
});

// ---------- doorways ----------

test('a doorway can be cut into a free-standing wall', () => {
  const s = createState(20, 20);
  const line = addWallLine(s, 0, P(0, 20), P(40, 20));
  const o = addLineOpening(line, 0.5);
  assert.ok(o);
  assert.equal(o.seg, 0, 'a wall line is one segment, so its openings sit on segment zero');
  assert.equal(lineOpenings(line).length, 1);
});

test('clicking the same doorway twice removes it', () => {
  const s = createState(20, 20);
  const line = addWallLine(s, 0, P(0, 20), P(40, 20));
  toggleLineOpening(line, 0.5);
  assert.equal(lineOpenings(line).length, 1);
  toggleLineOpening(line, 0.5);
  assert.equal(lineOpenings(line).length, 0);
  assert.equal(line.openings, undefined, 'and the key goes with the last one');
});

test('a railing takes a gap, a wall too short takes nothing', () => {
  const s = createState(20, 20);
  const rail = addWallLine(s, 0, P(0, 20), P(20, 20), SEG_RAIL);
  assert.ok(addLineOpening(rail, 0.5), 'a gap in a railing is where the stair lands');
  const stub = addWallLine(s, 0, P(0, 40), P(2, 40));
  assert.equal(addLineOpening(stub, 0.5), null, 'a 2ft wall has nowhere to put a 3ft door');
});

test('a doorway survives being cut in two only where there is wall left around it', () => {
  const s = createState(40, 40);
  drawWallRun(s, 0, P(0, 20), P(80, 20), SEG_WALL);
  const line = wallLinesOf(s.floors[0])[0];
  addLineOpening(line, 0.1);      // at x = 8
  addLineOpening(line, 0.9);      // at x = 72
  drawWallRun(s, 0, P(30, 20), P(50, 20), SEG_GLASS);
  const kept = wallLinesOf(s.floors[0]).filter((l) => lineKind(l) === SEG_WALL);
  const doors = kept.reduce((n, l) => n + lineOpenings(l).length, 0);
  assert.equal(doors, 2, 'both doorways were well clear of the cut');
});

// ---------- erasing ----------

test('the eraser takes a whole free-standing wall', () => {
  const s = createState(20, 20);
  drawWallRun(s, 0, P(0, 20), P(40, 20), SEG_WALL);
  assert.equal(eraseWallLineAt(s.floors[0], 20, 0.2), null, 'nothing up there');
  const gone = eraseWallLineAt(s.floors[0], 20, 20);
  assert.ok(gone);
  assert.deepEqual(wallLinesOf(s.floors[0]), []);
});

// ---------- load ----------

test('wall lines survive a round trip and rubbish does not', () => {
  const raw = [
    { id: 3, ax: 0, az: 20, bx: 40, bz: 20, kind: SEG_GLASS },
    { id: 4, ax: 0, az: 20 },                       // half a wall is not a wall
    { id: 5, ax: 0, az: 0, bx: 0, bz: 0 },          // nor is a point
    'nonsense',
    { id: 6, ax: 0, az: 40, bx: 40, bz: 40, kind: 99 },
  ];
  const out = normalizeWallLines(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, SEG_GLASS);
  assert.equal(out[1].kind, SEG_WALL, 'an unknown kind defaults to more solid, not less');
});

test('an unreadable opening is dropped without taking its wall with it', () => {
  const out = normalizeWallLines([
    { id: 3, ax: 0, az: 20, bx: 40, bz: 20, openings: [{ t: 0.5, w: 3 }, { t: 'x' }, null] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].openings.length, 1);
});

test('a wall line with no id is given one', () => {
  let n = 40;
  const out = normalizeWallLines([{ ax: 0, az: 0, bx: 20, bz: 0 }], 4000, () => n++);
  assert.equal(out[0].id, 40);
});

test('coordinates are clamped to a sane extent', () => {
  const out = normalizeWallLines([{ id: 1, ax: -1e9, az: 0, bx: 1e9, bz: 0 }], 500);
  assert.equal(out[0].ax, -500);
  assert.equal(out[0].bx, 500);
});

// ---------- how a drawn wall travels ----------
//
// Two paths every record in this codebase has to survive: the save file, and
// the wire another person is on the far end of.

test('a drawn wall survives a save and a load, and a design without one is unchanged', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const s = createState(20, 20);
  const plain = serialize(s);
  assert.equal(JSON.parse(plain).floors[0].walls, undefined, 'no wall, no key');

  drawWallRun(s, 0, P(0, 20), P(40, 20), SEG_GLASS);
  const line = wallLinesOf(s.floors[0])[0];
  addLineOpening(line, 0.5);
  const back = deserialize(serialize(s));
  const kept = wallLinesOf(back.floors[0]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].kind, SEG_GLASS);
  assert.equal(lineLength(kept[0]), 40);
  assert.equal(lineOpenings(kept[0]).length, 1);
  assert.equal(serialize(back), serialize(s), 'and round-trips byte for byte');
});

test('a wall line never takes an id a room or a prop already has', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const s = createState(20, 20);
  boxRoom(s, 0, 2, 2, 7, 6);
  drawWallRun(s, 0, P(0, 60), P(40, 60), SEG_WALL);
  const back = deserialize(serialize(s));
  const ids = [
    ...back.floors[0].shapes.map((sh) => sh.id),
    ...wallLinesOf(back.floors[0]).map((l) => l.id),
  ];
  assert.equal(new Set(ids).size, ids.length, 'no two records share a number');
  assert.ok(back.nextId > Math.max(...ids), 'and the next one continues past them');
});

test('a wall drawn by one person reaches the other', async () => {
  const { opsBetween, applyOps, recordsOf } = await import('../js/session.js');
  const before = createState(20, 20);
  const after = createState(20, 20);
  drawWallRun(after, 0, P(0, 20), P(40, 20), SEG_WALL);
  const { ops, resync } = opsBetween(before, after);
  assert.equal(resync, false);
  assert.equal(ops.filter((o) => o.k === 'wall').length, 1);
  assert.equal(ops.find((o) => o.k === 'wall').f, 0, 'and says which storey it is on');

  applyOps(before, ops.map((o) => ({ ...o, t: 1, site: 'a' })));
  assert.equal(wallLinesOf(before.floors[0]).length, 1);
  assert.equal(recordsOf(before).size, recordsOf(after).size);
});

test('a wall the other person erased goes, and takes the key with it', async () => {
  const { opsBetween, applyOps } = await import('../js/session.js');
  const mine = createState(20, 20);
  drawWallRun(mine, 0, P(0, 20), P(40, 20), SEG_WALL);
  const theirs = createState(20, 20);
  drawWallRun(theirs, 0, P(0, 20), P(40, 20), SEG_WALL);
  theirs.floors[0].walls[0].id = mine.floors[0].walls[0].id;

  const gone = createState(20, 20);
  gone.nextId = theirs.nextId;
  const { ops } = opsBetween(theirs, gone);
  applyOps(mine, ops.map((o) => ({ ...o, t: 2, site: 'b' })));
  assert.deepEqual(wallLinesOf(mine.floors[0]), []);
  assert.equal(mine.floors[0].walls, undefined);
});
