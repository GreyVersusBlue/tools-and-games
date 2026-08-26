// What gets built, and in what order.
//
// Two things carry the file. One is arithmetic: the phases plus what is in no
// phase plus what is nobody's room have to add up to the whole estimate, or
// the plan is quietly cheaper than the building. The other is the one
// buildability check the model can honestly make — you cannot build the second
// floor before the first — which is the finding a phasing plan exists to
// catch.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import { shapesOf } from '../js/shapes.js';
import { buildSampleSchool } from '../js/sample.js';
import { emptyRates, exampleRates, setRate } from '../js/rates.js';
import { costing } from '../js/cost.js';
import {
  MAX_PHASES, emptyPhasing, isEmptyPhasing, normalizePhasing, phasingOf,
  phaseByStorey, addPhase, removePhase, movePhase, renamePhase, claimShared,
  assignRooms, pruneToDesign, phasingCosts, phasingCSV,
  allRoomIds, roomIdsOnFloor, roomIdOf, isRoomId, roomFloor,
} from '../js/phasing.js';

// Two storeys, one room each, stacked — the smallest building with an order
// that can be got wrong.
function stack() {
  const s = createState(12, 10);
  const g = sheet(s, 0);
  g.box(1, 1, 4, 4, { name: 'Ground room' });
  g.bake();
  addFloor(s, 1);
  const u = sheet(s, 1);
  u.box(1, 1, 4, 4, { name: 'Upper room' });
  u.bake();
  return s;
}

const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (±${eps})`);

// ---------- ids ----------

test('a room id is the one navgraph and cost already write', () => {
  const s = stack();
  assert.ok(isRoomId('r0:s7'));
  assert.ok(!isRoomId('s7'));
  assert.ok(!isRoomId('r0:g184'), 'a region id is not a room id any more');
  assert.equal(roomFloor('r1:s9'), 1);
  assert.equal(roomIdsOnFloor(s, 0).length, 1);
  assert.equal(allRoomIds(s).length, 2);
  assert.equal(roomIdOf(0, shapesOf(s.floors[0])[0]), roomIdsOnFloor(s, 0)[0]);
});

// ---------- the record ----------

test('a design ships with no phasing plan', () => {
  assert.ok(isEmptyPhasing(emptyPhasing()));
  assert.ok(isEmptyPhasing(phasingOf(stack())));
});

test('a room belongs to exactly one phase, and the earlier one meant it', () => {
  const p = normalizePhasing({
    phases: [
      { name: 'One', rooms: ['r0:s1', 'r0:s2'] },
      { name: 'Two', rooms: ['r0:s2', 'r1:s3'] },
    ],
  });
  assert.deepEqual(p.phases[0].rooms, ['r0:s1', 'r0:s2']);
  assert.deepEqual(p.phases[1].rooms, ['r1:s3']);
});

test('a malformed room reference is dropped rather than kept as nothing', () => {
  const p = normalizePhasing({ phases: [{ rooms: ['r0:s1', 'nonsense', 42, null] }] });
  assert.deepEqual(p.phases[0].rooms, ['r0:s1']);
});

test('only one phase can carry the shared bucket', () => {
  const p = normalizePhasing({
    phases: [{ shared: true }, { shared: true }, { shared: true }],
  });
  assert.deepEqual(p.phases.map((x) => x.shared), [true, false, false]);
});

test('ids are positional, so an unnamed phase still has a name', () => {
  const p = normalizePhasing({ phases: [{}, {}] });
  assert.deepEqual(p.phases.map((x) => x.id), ['p1', 'p2']);
  assert.deepEqual(p.phases.map((x) => x.name), ['Phase 1', 'Phase 2']);
});

test('the phase cap holds', () => {
  const phases = [];
  for (let i = 0; i < MAX_PHASES + 10; i++) phases.push({ name: `P${i}` });
  assert.equal(normalizePhasing({ phases }).phases.length, MAX_PHASES);
});

// ---------- editing ----------

test('one phase per storey is the plan nine buildings in ten get', () => {
  const s = stack();
  const p = phaseByStorey(s);
  assert.equal(p.phases.length, 2);
  assert.deepEqual(p.phases[0].rooms, roomIdsOnFloor(s, 0));
  assert.ok(p.phases[0].shared, 'the site is built when the site is built');
  assert.ok(!p.phases[1].shared);
});

test('moving a phase keeps every room where it was', () => {
  const s = stack();
  const p = movePhase(phaseByStorey(s), 'p2', -1);
  assert.deepEqual(p.phases.map((x) => x.name), ['Level 2', 'Level 1']);
  assert.deepEqual(p.phases[0].rooms, roomIdsOnFloor(s, 1));
});

test('moving off either end is a no-op rather than an error', () => {
  const p = phaseByStorey(stack());
  assert.deepEqual(movePhase(p, 'p1', -1).phases.map((x) => x.name), ['Level 1', 'Level 2']);
  assert.deepEqual(movePhase(p, 'p2', 1).phases.map((x) => x.name), ['Level 1', 'Level 2']);
  assert.deepEqual(movePhase(p, 'nope', 1).phases.map((x) => x.name), ['Level 1', 'Level 2']);
});

test('assigning a room takes it out of whatever phase had it', () => {
  const s = stack();
  const ground = roomIdsOnFloor(s, 0)[0];
  const p = assignRooms(phaseByStorey(s), 'p2', [ground]);
  assert.deepEqual(p.phases[0].rooms, []);
  assert.ok(p.phases[1].rooms.includes(ground));
});

test('assigning to nothing takes a room back out of the plan', () => {
  const s = stack();
  const ground = roomIdsOnFloor(s, 0)[0];
  const p = assignRooms(phaseByStorey(s), null, [ground]);
  assert.ok(!p.phases.some((x) => x.rooms.includes(ground)));
});

test('the shared bucket toggles rather than sticking', () => {
  const p = phaseByStorey(stack());
  assert.ok(claimShared(p, 'p2').phases[1].shared);
  assert.ok(!claimShared(p, 'p1').phases.some((x) => x.shared), 'clicking the holder clears it');
});

test('adding, renaming and removing a phase all keep the record legal', () => {
  let p = addPhase(emptyPhasing(), 'Enabling works');
  assert.equal(p.phases[0].name, 'Enabling works');
  assert.ok(p.phases[0].shared, 'the first phase gets the bucket by default');
  p = renamePhase(p, 'p1', 'Demolition');
  assert.equal(p.phases[0].name, 'Demolition');
  p = removePhase(p, 'p1');
  assert.ok(isEmptyPhasing(p));
});

test('a phase holding a room somebody deleted is pruned, not silently cheaper', () => {
  const s = stack();
  const p = phaseByStorey(s);
  const pruned = pruneToDesign(normalizePhasing({
    phases: [{ ...p.phases[0], rooms: [...p.phases[0].rooms, 'r0:s999'] }],
  }), s);
  assert.ok(!pruned.phases[0].rooms.includes('r0:s999'));
});

// ---------- pricing a plan ----------

test('no plan says so once, and prices nothing twice', () => {
  const plan = phasingCosts(stack(), { rates: exampleRates() });
  assert.ok(!plan.has);
  assert.equal(plan.rows.length, 0);
  assert.ok(plan.findings.some((f) => f.code === 'no-phasing'));
});

test('every phase gets its own takeoff and its own cost', () => {
  const s = buildSampleSchool();
  const plan = phasingCosts(s, { phasing: phaseByStorey(s), rates: exampleRates() });
  assert.equal(plan.rows.length, 2);
  for (const r of plan.rows) {
    assert.ok(r.lines.length > 0, `${r.name} has no takeoff`);
    assert.ok(r.area > 0);
    near(r.perSqft, r.cost / r.area, 1e-9);
  }
});

test('the cumulative column is what a funding schedule is written against', () => {
  const s = buildSampleSchool();
  const plan = phasingCosts(s, { phasing: phaseByStorey(s), rates: exampleRates() });
  near(plan.rows[0].cumulative, plan.rows[0].cost, 1e-9);
  near(plan.rows[1].cumulative, plan.rows[0].cost + plan.rows[1].cost, 1e-9);
});

test('the phases add up to the whole estimate, exactly', () => {
  const s = buildSampleSchool();
  const rates = exampleRates();
  const whole = costing(s, { rates });
  const plan = phasingCosts(s, { phasing: phaseByStorey(s), rates });
  near(plan.total, whole.summary.total, 1e-6);
});

test('...and still do when nothing has claimed the shared bucket', () => {
  const s = buildSampleSchool();
  const rates = exampleRates();
  const byStorey = phaseByStorey(s);
  const unclaimed = normalizePhasing({
    phases: byStorey.phases.map((p) => ({ ...p, shared: false })),
  });
  const plan = phasingCosts(s, { phasing: unclaimed, rates });
  assert.ok(plan.shared, 'it stands on its own row rather than disappearing');
  near(plan.total, costing(s, { rates }).summary.total, 1e-6);
  assert.ok(plan.findings.some((f) => f.code === 'shared-unclaimed'));
});

test('...and still do when a wing is in no phase at all', () => {
  const s = buildSampleSchool();
  const rates = exampleRates();
  const p = assignRooms(phaseByStorey(s), null, roomIdsOnFloor(s, 1));
  const plan = phasingCosts(s, { phasing: p, rates });
  assert.ok(plan.unassigned);
  assert.ok(plan.unassigned.cost > 0);
  near(plan.total, costing(s, { rates }).summary.total, 1e-6);
  const finding = plan.findings.find((f) => f.code === 'unphased-rooms');
  assert.ok(finding);
  assert.equal(finding.level, 'warn');
});

test('the shared bucket rides with the phase that claimed it, not beside it', () => {
  const s = buildSampleSchool();
  const rates = exampleRates();
  const claimed = phasingCosts(s, { phasing: phaseByStorey(s), rates });
  const loose = phasingCosts(s, {
    phasing: normalizePhasing({
      phases: phaseByStorey(s).phases.map((p) => ({ ...p, shared: false })),
    }),
    rates,
  });
  assert.equal(claimed.shared, null);
  near(claimed.rows[0].cost - loose.rows[0].cost, loose.shared.cost, 1e-6);
});

// ---------- the one check the model can honestly make ----------

test('a room cannot be built before the room holding it up', () => {
  const s = stack();
  const upstairs = { phases: [
    { name: 'Upstairs', rooms: roomIdsOnFloor(s, 1), shared: true },
    { name: 'Downstairs', rooms: roomIdsOnFloor(s, 0) },
  ] };
  const plan = phasingCosts(s, { phasing: upstairs, rates: exampleRates() });
  const finding = plan.findings.find((f) => f.code === 'phase-order');
  assert.ok(finding);
  assert.equal(finding.level, 'fail');
  assert.ok(/Upper room/.test(finding.detail));
});

test('...and the right way round raises nothing', () => {
  const s = stack();
  const plan = phasingCosts(s, { phasing: phaseByStorey(s), rates: exampleRates() });
  assert.ok(!plan.findings.some((f) => f.code === 'phase-order'));
});

test('two rooms in the same phase are not out of order with each other', () => {
  const s = stack();
  const one = { phases: [{ name: 'All of it', rooms: allRoomIds(s), shared: true }] };
  const plan = phasingCosts(s, { phasing: one, rates: exampleRates() });
  assert.ok(!plan.findings.some((f) => f.code === 'phase-order'));
});

test('an empty phase is a note, not a failure', () => {
  const s = stack();
  const p = addPhase(phaseByStorey(s), 'Later');
  const plan = phasingCosts(s, { phasing: p, rates: exampleRates() });
  const finding = plan.findings.find((f) => f.code === 'empty-phase');
  assert.ok(finding);
  assert.equal(finding.level, 'note');
});

// ---------- the spreadsheet ----------

test('the CSV carries the running total and every phase\'s takeoff', () => {
  const s = buildSampleSchool();
  const csv = phasingCSV(phasingCosts(s, { phasing: phaseByStorey(s), rates: exampleRates() }));
  assert.ok(csv.includes('Cumulative'));
  assert.ok(csv.includes('carries shared & sitework'));
  assert.ok(csv.includes('Phase,Assembly,Quantity,Unit,Rate,Cost'));
});

test('a plan with no rates still lists its phases, at nothing', () => {
  const s = buildSampleSchool();
  const plan = phasingCosts(s, { phasing: phaseByStorey(s), rates: emptyRates() });
  assert.equal(plan.total, 0);
  assert.equal(plan.rows.length, 2);
  assert.ok(plan.rows[0].lines.every((l) => !l.priced));
});

test('the design reads its own plan when the caller does not pass one', () => {
  const s = buildSampleSchool();
  s.phasing = phaseByStorey(s);
  s.rates = setRate(emptyRates(), 'slab', 10);
  assert.equal(phasingCosts(s).rows.length, 2);
  assert.ok(phasingCosts(s).total > 0);
});

// ---------- the file ----------

test('a phasing plan is an append to v11: a design without one writes no key', async () => {
  const { serialize, deserialize, SAVE_VERSION } = await import('../js/save-load.js');
  const state = buildSampleSchool();
  assert.doesNotMatch(serialize(state), /"phasing"/);

  const plan = phaseByStorey(state);
  state.phasing = plan;
  const text = serialize(state);
  assert.match(text, /"phasing"/);
  assert.equal(JSON.parse(text).version, SAVE_VERSION, 'a phasing plan is not a version bump');
  assert.deepEqual(deserialize(text).phasing, plan);
});

test('a phase naming a room the file does not contain loses the reference, not the plan', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const state = buildSampleSchool();
  state.phasing = phaseByStorey(state);
  const hostile = JSON.parse(serialize(state));
  hostile.phasing.phases[0].rooms.push('r0:s99999');
  const back = deserialize(JSON.stringify(hostile));
  assert.ok(back.phasing.phases[0].rooms.includes('r0:s99999'),
    'the loader keeps it — it is well-formed, and the design might grow it back');
  const plan = phasingCosts(back, { rates: exampleRates() });
  assert.ok(!plan.rows[0].roomIds.includes('r0:s99999'), '...and pricing prunes it');
});

test('a phasing record full of nonsense is a design built all at once', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const state = buildSampleSchool();
  state.phasing = phaseByStorey(state);
  const hostile = JSON.parse(serialize(state));
  hostile.phasing = { phases: 'not a list' };
  assert.equal(deserialize(JSON.stringify(hostile)).phasing, undefined);
});
