// What it costs, and which room it costs it in.
//
// Counted by hand on a shoebox first — a room whose every wall is exterior and
// whose every square foot is its own — then held to two invariants on the
// sample school that are worth more than any single number in here:
//
//   the quantities are the takeoff's quantities, and
//   the rooms plus what is nobody's room add up to the whole estimate.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, CELL, WALL_H, FLOOR_H } from '../js/grid.js';
import { EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_WINDOW } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { WALL_T_INT, WALL_T_EXT } from '../js/walls.js';
import { addProp } from '../js/props.js';
import { addStair } from '../js/stairs.js';
import { applyFinish } from '../js/finish.js';
import { shapesOf } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { takeoff } from '../js/takeoff.js';
import { emptyRates, exampleRates, setRate } from '../js/rates.js';
import { costing, quantities, floorQuantities, sharedQuantities, costCSV } from '../js/cost.js';

// The same 4×4-cell room in a 12×10 lot the takeoff suite counts on: 64 ft of
// wall, all of it exterior, 256 ft² of floor.
function shoebox(extra = null) {
  const s = createState(12, 10);
  const f = sheet(s, 0);
  f.box(1, 1, 4, 4, { name: 'Room 101' });
  if (extra) extra(f);
  f.bake();
  return s;
}

const SLAB = 16 * CELL * CELL;          // 256 ft²
const WALL_LF = 16 * CELL;              // 64 ft
const WALL_AREA = WALL_LF * WALL_H;     // 640 ft²

const qtyOf = (cost, key) => {
  const line = cost.lines.find((l) => l.key === key);
  return line ? line.qty : 0;
};
const costOf = (cost, key) => {
  const line = cost.lines.find((l) => l.key === key);
  return line ? line.cost : 0;
};
const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (±${eps})`);

// ---------- counted by hand ----------

test('a shoebox is its own slab, its own finish and its own four walls', () => {
  const c = costing(shoebox(), { rates: emptyRates() });
  assert.equal(qtyOf(c, 'slab'), SLAB);
  assert.equal(qtyOf(c, 'finish:vct'), SLAB);
  assert.equal(qtyOf(c, 'facade:brick'), WALL_AREA);
  // Paint goes on the inside face of an exterior wall and only the inside.
  assert.equal(qtyOf(c, 'paint'), WALL_AREA);
});

test('all of it lands on the one room in it', () => {
  const c = costing(shoebox(), { rates: emptyRates() });
  assert.equal(c.byRoom.length, 1);
  const r = c.byRoom[0];
  assert.equal(r.name, 'Room 101');
  assert.equal(r.area, SLAB);
  assert.equal(r.lines.find((l) => l.key === 'facade:brick').qty, WALL_AREA);
});

test('a partition is split between the two rooms it separates', () => {
  const s = createState(14, 10);
  const f = sheet(s, 0);
  f.box(1, 1, 9, 4).vrun(5, 1, 4, EDGE_WALL);
  f.bake();
  const c = costing(s, { rates: emptyRates() });
  const partition = 4 * CELL * WALL_H;      // 16 ft of wall, 10 ft high
  assert.equal(qtyOf(c, 'wall-int'), partition);
  assert.equal(c.byRoom.length, 2);
  for (const r of c.byRoom) {
    const line = r.lines.find((l) => l.key === 'wall-int');
    near(line.qty, partition / 2, 1e-9, 'a wall between two rooms belongs to both');
  }
});

test('a partition is painted on both faces and an exterior wall on one', () => {
  const s = createState(14, 10);
  const f = sheet(s, 0);
  f.box(1, 1, 9, 4).vrun(5, 1, 4, EDGE_WALL);
  f.bake();
  const c = costing(s, { rates: emptyRates() });
  const ext = (9 + 9 + 4 + 4) * CELL * WALL_H;
  const partition = 4 * CELL * WALL_H;
  assert.equal(qtyOf(c, 'paint'), ext + partition * 2);
});

test('a door is a leaf count, and a window is a window', () => {
  const c = costing(shoebox((f) => {
    f.edgeV(1, 2, EDGE_DOOR).edgeV(1, 3, EDGE_DOOR2).edgeH(2, 1, EDGE_WINDOW);
  }), { rates: emptyRates() });
  assert.equal(qtyOf(c, 'door:single'), 1);
  assert.equal(qtyOf(c, 'door:double'), 1);
  assert.equal(qtyOf(c, 'window'), 1);
});

test('a glass wall is exterior glazing, not a partition', () => {
  const c = costing(shoebox((f) => f.hrun(1, 4, 1, EDGE_GLASS)), { rates: emptyRates() });
  assert.equal(qtyOf(c, 'glazing'), 4 * CELL * WALL_H);
  assert.equal(qtyOf(c, 'wall-glass'), 0);
});

test('a floor finish is priced as the finish it is, not as the average of them', () => {
  const s = shoebox();
  applyFinish(shapesOf(s.floors[0])[0], 'carpet', null);
  const c = costing(s, { rates: setRate(emptyRates(), 'finish:carpet', 7) });
  assert.equal(qtyOf(c, 'finish:vct'), 0);
  assert.equal(costOf(c, 'finish:carpet'), SLAB * 7);
});

test('furniture is counted by catalog category and lands in the room it stands in', () => {
  const s = shoebox();
  addProp(s, 'student-desk', { x: 12, z: 12, floor: 0 });
  addProp(s, 'chair-stack', { x: 13, z: 13, floor: 0 });
  const c = costing(s, { rates: emptyRates() });
  assert.equal(qtyOf(c, 'furniture:Tables & Desks'), 1);
  assert.equal(qtyOf(c, 'furniture:Seating'), 1);
  const r = c.byRoom[0];
  assert.equal(r.lines.find((l) => l.key === 'furniture:Seating').qty, 1);
});

test('a prop dropped outside every room stays on the storey, not in a room', () => {
  const s = shoebox();
  addProp(s, 'chair-stack', { x: 44, z: 36, floor: 0 });
  const f = floorQuantities(s, 0);
  assert.equal(f.loose.get('furniture:Seating'), 1);
  assert.equal(f.rooms[0].lines.get('furniture:Seating'), undefined);
});

// ---------- what belongs to nobody ----------

test('the roof, the site and the lift are the building\'s, not a room\'s', () => {
  const s = shoebox();
  addFloor(s, 1);
  const f2 = sheet(s, 1);
  f2.box(1, 1, 4, 4);
  f2.bake();
  assert.ok(addStair(s, 0, { type: 'elevator', x: 20, z: 20 }).link);
  const shared = sharedQuantities(s);
  assert.equal(shared.get('elevator'), 1);
  assert.ok(shared.get('roof:membrane') > 0);
  const c = costing(s, { rates: setRate(emptyRates(), 'elevator', 100000) });
  // Every room's own lines add up to less than the whole, by exactly the lift.
  const rooms = c.byRoom.reduce((n, r) => n + r.cost, 0);
  near(c.summary.total - rooms, 100000, 1e-6);
});

test('a pitched roof is measured up the slope, not across the plan', () => {
  const s = shoebox();
  s.roof = { style: 'gable', pitch: 12, facade: 'brick' };
  const flat = { ...s, roof: { style: 'flat', pitch: 4, facade: 'brick' } };
  const pitched = sharedQuantities(s).get('roof:shingle');
  const level = sharedQuantities(flat).get('roof:membrane');
  near(pitched / level, Math.SQRT2, 1e-9, 'a 12:12 is √2 times its footprint');
});

// ---------- pricing ----------

test('no rate table means nothing is priced, and it says so', () => {
  const c = costing(shoebox(), { rates: emptyRates() });
  assert.ok(!c.has);
  assert.equal(c.summary.total, 0);
  assert.ok(c.findings.some((f) => f.code === 'no-rates'));
});

test('an unpriced assembly is counted as zero and named out loud', () => {
  const c = costing(shoebox(), { rates: setRate(emptyRates(), 'slab', 10) });
  assert.equal(c.summary.total, SLAB * 10);
  const finding = c.findings.find((f) => f.code === 'unpriced');
  assert.ok(finding, 'the total is a floor, not an estimate');
  assert.ok(c.unpriced.some((u) => u.key === 'facade:brick'));
});

test('a rate of zero is priced and a missing rate is not', () => {
  let rates = setRate(emptyRates(), 'slab', 10);
  rates = setRate(rates, 'paint', 0);
  const c = costing(shoebox(), { rates });
  assert.ok(c.lines.find((l) => l.key === 'paint').priced);
  assert.ok(!c.lines.find((l) => l.key === 'facade:brick').priced);
  assert.equal(c.unpriced.some((u) => u.key === 'paint'), false);
});

test('the shipped example warns about itself until somebody types over it', () => {
  const s = shoebox();
  assert.ok(costing(s, { rates: exampleRates() }).findings.some((f) => f.code === 'example-rates'));
  assert.ok(!costing(s, { rates: setRate(exampleRates(), 'slab', 21) })
    .findings.some((f) => f.code === 'example-rates'));
});

test('an undated or unsourced rate is a note, not a silence', () => {
  const c = costing(shoebox(), { rates: setRate(emptyRates(), 'slab', 10) });
  assert.ok(c.findings.some((f) => f.code === 'undated-rates'));
  assert.ok(c.findings.some((f) => f.code === 'unsourced-rates'));
  const dated = costing(shoebox(), {
    rates: setRate(emptyRates(), 'slab', 10, { date: '2026-02-02', source: 'A bid' }),
  });
  assert.ok(!dated.findings.some((f) => f.code === 'undated-rates'));
  assert.ok(!dated.findings.some((f) => f.code === 'unsourced-rates'));
});

test('the design reads its own rates when the caller does not pass any', () => {
  const s = shoebox();
  s.rates = setRate(emptyRates(), 'slab', 10);
  assert.equal(costing(s).summary.total, SLAB * 10);
});

// ---------- the decomposition ----------

test('a room says what is driving it, and the drivers add up to the room', () => {
  const s = buildSampleSchool();
  const c = costing(s, { rates: exampleRates() });
  for (const r of c.worstRooms) {
    const drivers = r.drivers.reduce((n, d) => n + d.cost, 0);
    near(drivers, r.cost, 1e-6, `${r.name}: the tail is rolled up, not truncated`);
  }
});

test('worst first, five of them, and the first is the dearest room in the school', () => {
  const c = costing(buildSampleSchool(), { rates: exampleRates() });
  assert.equal(c.worstRooms.length, 5);
  for (let i = 1; i < c.byRoom.length; i++) {
    assert.ok(c.byRoom[i - 1].cost >= c.byRoom[i].cost);
  }
  assert.equal(c.summary.worst.id, c.byRoom[0].id);
});

test('the systems add up to the total, and so do the storeys plus what is shared', () => {
  const c = costing(buildSampleSchool(), { rates: exampleRates() });
  near(c.bySystem.reduce((n, s) => n + s.cost, 0), c.summary.total, 1e-6);
  const storeys = c.byStorey.reduce((n, f) => n + f.cost, 0);
  near(storeys + c.summary.shared, c.summary.total, 1e-6);
});

test('every room plus everything that is nobody\'s room is the whole estimate', () => {
  const c = costing(buildSampleSchool(), { rates: exampleRates() });
  const rooms = c.byRoom.reduce((n, r) => n + r.cost, 0);
  // Two remainders, and both are named: the shared bucket (roof, site, lifts)
  // and the loose one — a bench on the lawn, a length of garden wall with air
  // on both sides. The sample school has both, which is the point of counting
  // them rather than smearing them over the rooms.
  near(rooms + c.summary.shared + c.summary.loose, c.summary.total, 1e-6);
  assert.ok(c.summary.loose > 0, 'the sample school does furnish its playground');
});

// ---------- the promise Phase 7 made ----------

test('the quantities are the takeoff\'s quantities, wall for wall', () => {
  const s = buildSampleSchool();
  const t = takeoff(s);
  const c = costing(s, { rates: emptyRates() });
  near(qtyOf(c, 'slab'), t.totals.slab, 1e-6);
  near(qtyOf(c, 'paint'), t.totals.paintArea, 1e-6);
  near(qtyOf(c, 'facade:brick'), t.totals.facadeArea, 1e-6);
  near(qtyOf(c, 'roof:membrane'), t.totals.roof, 1e-6);
  near(qtyOf(c, 'door:single') + qtyOf(c, 'door:double') + qtyOf(c, 'door:cased'),
    t.totals.doors, 1e-6);
  near(qtyOf(c, 'window'), t.totals.windows, 1e-6);
  near(qtyOf(c, 'stair'), t.totals.stairs, 1e-6);
  near(qtyOf(c, 'elevator'), t.totals.elevators, 1e-6);
  const site = c.lines.filter((l) => l.key.startsWith('paving:'))
    .reduce((n, l) => n + l.qty, 0);
  near(site, t.totals.site, 1e-6);
});

test('the interior and exterior wall areas match the takeoff\'s two lines', () => {
  const s = buildSampleSchool();
  const t = takeoff(s);
  const c = costing(s, { rates: emptyRates() });
  const height = (i) => (i < s.floors.length - 1 ? (s.floorHt || FLOOR_H) : WALL_H);
  let ext = 0, int = 0;
  t.floors.forEach((f, i) => {
    for (const w of f.walls) {
      if (w.kind === 'glass') continue;
      if (w.exterior) ext += w.lf * height(i); else int += w.lf * height(i);
    }
  });
  near(qtyOf(c, 'facade:brick') + qtyOf(c, 'wall-rail') * 0, ext, 1);
  near(qtyOf(c, 'wall-int') + qtyOf(c, 'wall-rail') * 0, int, 1);
});

// ---------- the spreadsheet ----------

test('the CSV leads with the rates, because a cost nobody can check is a rumour', () => {
  const csv = costCSV(costing(buildSampleSchool(), { rates: exampleRates() }));
  assert.ok(csv.includes('Rates from'));
  assert.ok(csv.includes('WARNING'), 'and says the example is an example');
  assert.ok(csv.includes('Rate dated'));
  assert.ok(csv.includes('Not in any room'));
});

test('an unpriced line prints "no rate" rather than an empty cell', () => {
  const csv = costCSV(costing(shoebox(), { rates: setRate(emptyRates(), 'slab', 10) }));
  assert.ok(csv.includes('no rate'));
});

test('the quantities pass survives being asked for on its own', () => {
  const q = quantities(buildSampleSchool());
  assert.ok(q.all.size > 10);
  assert.ok(q.area > 0);
  assert.equal(q.floors.length, 2);
});
