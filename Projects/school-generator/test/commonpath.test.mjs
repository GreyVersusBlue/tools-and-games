// The common path of egress travel (Phase 41): two node-disjoint ways out on
// the nav graph, and the walk from every corner of a room to the first place
// that has them. Built on hand-made buildings where the answer can be paced
// out, plus the sample school as the one real design.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, CELL } from '../js/grid.js';
import { EDGE_WALL, EDGE_DOOR, EDGE_DOOR2 } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addStair } from '../js/stairs.js';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav } from '../js/navgraph.js';
import { roomSamples, egressAnalysis } from '../js/egress.js';
import {
  twoWaysOut, splitsAt, commonPathFrom, commonPathOf, commonPathAnalysis,
} from '../js/commonpath.js';

// A corridor along row 4 from x=1 to x=len, a classroom hung off its east
// end, and exits where the caller says: 'west', 'east', both or neither.
function corridor({ len = 10, exits = ['west'], doors = 1 } = {}) {
  const s = createState(Math.max(14, len + 6), 10);
  const f = sheet(s, 0);
  f.box(1, 4, len, 4, { name: 'Corridor' });
  f.box(len - 3, 1, len, 3, { name: 'Room 101' });
  f.edgeH(len - 1, 4, EDGE_DOOR);                   // classroom → corridor
  if (doors > 1) f.edgeH(len - 3, 4, EDGE_DOOR);   // a second door, west end of the room
  if (exits.includes('west')) f.edgeV(1, 4, EDGE_DOOR2);
  if (exits.includes('east')) f.edgeV(len + 1, 4, EDGE_DOOR2);
  f.bake();
  return s;
}

const analyse = (s) => {
  const nav = buildNav(s);
  return { nav, cp: commonPathAnalysis(nav, { samples: roomSamples(nav), limit: 75 }) };
};
const row = (cp, name) => cp.rows.find((r) => r.name === name);

test('a building with one exit has no two ways out anywhere', () => {
  const { nav, cp } = analyse(corridor({ exits: ['west'] }));
  for (const n of nav.nodes.keys()) assert.ok(!splitsAt(nav, n), `${n} splits with one exit`);
  // ...so every walk is common the whole way to the door.
  for (const r of cp.rows) assert.ok(r.toExit, `${r.name} found a choice it cannot have`);
  assert.equal(cp.summary.toExit, cp.rows.length);
  // The classroom's common path is its travel distance — the same walk, the
  // same number.
  const eg = egressAnalysis(corridor({ exits: ['west'] }), { nav, commonPath: false });
  const cls = eg.rooms.find((r) => r.name === 'Room 101');
  assert.ok(Math.abs(row(cp, 'Room 101').common - cls.travel) < 0.01);
});

test('a corridor with an exit at each end parts the ways at the classroom door', () => {
  const { nav, cp } = analyse(corridor({ len: 20, exits: ['west', 'east'] }));
  const cls = row(cp, 'Room 101');
  assert.ok(!cls.toExit);
  assert.equal(cls.at.kind, 'portal', 'the choice appears at the doorway into the corridor');
  // From the room's far corner to its one door: within the room's own
  // diagonal, and nowhere near the corridor's length.
  assert.ok(cls.common > 0 && cls.common <= Math.hypot(4 * CELL, 3 * CELL) + 2 * 3,
    `expected a walk across the room, got ${cls.common}`);
  // The corridor itself has a choice wherever you stand in it.
  assert.equal(row(cp, 'Corridor').common, 0);
  // ...and the doorway node knows it splits.
  assert.ok(splitsAt(nav, cls.at.id));
});

test('two doors out of a room onto a corridor with one exit are not two ways out', () => {
  // The strict reading: two exit access doorways that lead to the same
  // single way off the corridor are one route with a fork in it, and the
  // common path runs on to the exit.
  const { cp } = analyse(corridor({ len: 12, exits: ['west'], doors: 2 }));
  const cls = row(cp, 'Room 101');
  assert.ok(cls.toExit, 'still common all the way');
  assert.ok(cls.common > 12 * CELL - 2 * CELL, 'measured down the corridor, not across the room');
});

test('two doors onto a corridor with exits both ways give a choice in the room itself', () => {
  const { cp } = analyse(corridor({ len: 20, exits: ['west', 'east'], doors: 2 }));
  const cls = row(cp, 'Room 101');
  // A corner may still be a few feet from the nearer door, but the walk to
  // a choice is now inside the room and short.
  assert.ok(cls.common < 2 * CELL + 3, `expected a choice in the room, got ${cls.common}`);
});

test('a point on a tile with two exits standing on it has a common path of zero', () => {
  const s = corridor({ len: 20, exits: ['west', 'east'] });
  const nav = buildNav(s);
  const corridorId = nav.rooms.find((r) => r.name === 'Corridor').id;
  const mid = nav.node(corridorId);
  const r = commonPathFrom(nav, 0, mid.x, mid.z, corridorId);
  assert.deepEqual(r, { dist: 0, at: null, exit: false });
  // ...and a set of anchors that reaches only one exit does not split.
  assert.ok(!twoWaysOut(nav, [nav.exits[0].id]));
  assert.ok(twoWaysOut(nav, nav.exits.map((e) => e.id)));
  assert.ok(!twoWaysOut(nav, []));
});

test('a sealed building measures nothing rather than throwing', () => {
  const { cp } = analyse(corridor({ exits: [] }));
  assert.equal(cp.rows.length, 0);
  assert.equal(cp.summary.worst, null);
  const nav = buildNav(corridor({ exits: [] }));
  assert.equal(commonPathFrom(nav, 0, 10, 18), null);
});

test('one stair makes the whole upper storey common down to the ground', () => {
  // Two exits on the ground floor, one stair up to a room above: from the
  // upper room the ways cannot part until the foot of the stair at the
  // earliest, so its common path is at least the stair's own run.
  const s = corridor({ len: 12, exits: ['west', 'east'] });
  addFloor(s, 1);
  const up = sheet(s, 1);
  up.box(1, 4, 12, 4, { name: 'Upper Corridor' });
  up.bake();
  const { link } = addStair(s, 0, { type: 'stair', x: 3 * CELL, z: 4.5 * CELL, rotationY: Math.PI / 2 });
  assert.ok(link);
  const { nav, cp } = analyse(s);
  const upper = row(cp, 'Upper Corridor');
  assert.ok(upper, 'the storey above is reached');
  assert.ok(!upper.toExit);
  // The ground corridor has a choice where it stands; the storey above has
  // to come down the one stair first, so its walk to a choice is the stair's
  // run at the least.
  assert.equal(row(cp, 'Corridor').common, 0);
  assert.ok(upper.common > 10, `expected a walk down the stair, got ${upper.common}`);
  assert.ok(splitsAt(nav, upper.at.id));
  // ...and the same building read by egress puts the finding on that room.
  const eg = egressAnalysis(s);
  const f = eg.findings.find((x) => x.code === 'common-path');
  assert.ok(f && (f.level === 'ok' || f.rooms.some((r) => r.name === 'Upper Corridor')));
});

test('the sample school is measured room by room, worst first, and cites where the ways part', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const samples = roomSamples(nav);
  const cp = commonPathAnalysis(nav, { samples, limit: 75 });
  assert.ok(cp.rows.length > 0);
  for (let i = 1; i < cp.rows.length; i++) assert.ok(cp.rows[i - 1].common >= cp.rows[i].common);
  for (const r of cp.rows) {
    assert.ok(Number.isFinite(r.common) && r.common >= 0);
    assert.ok(r.common === 0 || r.toExit || r.at, 'a walk that ended somewhere says where');
    assert.equal(r.over, r.common > 75);
    // The per-room reader and the analysis agree.
    const one = commonPathOf(nav, samples, nav.node(r.id));
    assert.ok(Math.abs(one.dist - r.common) < 1e-9);
  }
  assert.equal(cp.summary.over, cp.rows.filter((r) => r.over).length);
  assert.equal(cp.summary.worst, cp.rows[0]);
  // The one stair is the sample school's story: everything above the ground
  // floor is common to the stair hall's door, and over the limit.
  const upper = cp.rows.filter((r) => r.floor === 1);
  assert.ok(upper.length > 0);
  assert.ok(cp.rows[0].floor === 1 && cp.rows[0].over, 'the worst walk is upstairs');
  assert.ok(upper.filter((r) => r.over).length > upper.length / 2);
  // ...and every one of them parts at the same door: the stair hall's.
  assert.equal(new Set(upper.map((r) => r.at && r.at.id)).size, 1);
});

test('a memo shared across rooms answers the same as fresh searches', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  const samples = roomSamples(nav);
  const shared = commonPathAnalysis(nav, { samples, memo: new Map() });
  for (const r of shared.rows) {
    const fresh = commonPathOf(nav, samples, nav.node(r.id), new Map());
    assert.ok(Math.abs(fresh.dist - r.common) < 1e-9, `${r.name} differs with a fresh memo`);
  }
});
