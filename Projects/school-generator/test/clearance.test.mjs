// clearance.js — the chair. The one thing this suite exists to prove is the
// contract the phase was named for: the accessible-route analysis and the
// seated walker read the same module, so a doorway one keeps the other rolls
// through and a doorway one drops the other is refused at — proved on real
// baked rooms with real leaves, not on the numbers. After that, the turning
// circle and the reach ranges, each on a fixture where the right answer can
// be paced out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor, CELL, WALL_T_EXT } from '../js/grid.js';
import { sheet } from './build.mjs';
import {
  addShape, addOpening, setSegWall, SEG_NONE, LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE,
} from '../js/shapes.js';
import { addProp } from '../js/props.js';
import { addStair } from '../js/stairs.js';
import { catalogEntry } from '../js/catalog.js';
import { buildNav, egressField } from '../js/navgraph.js';
import { buildCollider, moveWalker, tryStep, WALKER_R, STEP_UP } from '../js/collide.js';
import { MAX_RAMP_GRADE } from '../js/sitemesh.js';
import { buildSampleSchool } from '../js/sample.js';
import { accessibleAnalysis } from '../js/egress.js';
import { buildReport } from '../js/report.js';
import {
  CLEAR_LOSS, MIN_CLEAR_W, MIN_ACCESSIBLE_W, clearWidth, doorClear, doorRolls,
  SEATED_R, SEATED_EYE_H, SEATED_HEAD_H, THRESHOLD, MAX_SEATED_GRADE, GRADE_PROBE,
  rampRolls, seatedStep, refusalText,
  TURN_D, TURN_R, PASSAGE_D, PASSAGE_R, clearanceWorld, clearRadiusAt, turningAnalysis,
  REACH_MIN, REACH_MAX, COUNTER_MAX, LAVATORY_MAX, WORK_MIN, WORK_MAX, REACH_RULES,
  reachAnalysis,
} from '../js/clearance.js';

const has = (findings, code) => findings.some((f) => f.code === code);
const find = (findings, code) => findings.find((f) => f.code === code) || null;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------- the numbers ----------

test('the contract is the code, in feet', () => {
  assert.equal(MIN_CLEAR_W, 32 / 12);
  assert.equal(MIN_ACCESSIBLE_W, MIN_CLEAR_W + CLEAR_LOSS);
  assert.equal(clearWidth(3), 3 - CLEAR_LOSS);
  assert.equal(clearWidth(3, false), 3);
  assert.equal(TURN_D, 5);
  assert.equal(TURN_R, 2.5);
  assert.equal(PASSAGE_D, 3);
  assert.equal(PASSAGE_R, 1.5);
  assert.equal(THRESHOLD, 0.5 / 12);
  assert.equal(REACH_MIN, 15 / 12);
  assert.equal(REACH_MAX, 4);
  assert.equal(COUNTER_MAX, 3);
  assert.equal(LAVATORY_MAX, 34 / 12);
  assert.equal(WORK_MIN, 28 / 12);
  assert.equal(WORK_MAX, 34 / 12);
  assert.equal(SEATED_EYE_H, 4);
  assert.ok(SEATED_HEAD_H > SEATED_EYE_H && SEATED_HEAD_H < 5.9);
  assert.ok(GRADE_PROBE > 0);
});

test('the seated body is the clear width, and the grade is the site\'s ramp limit', () => {
  assert.equal(SEATED_R * 2, MIN_CLEAR_W, 'the chair is exactly as wide as its doorway');
  assert.ok(SEATED_R > WALKER_R, 'a chair is wider than a pair of shoulders');
  assert.equal(MAX_SEATED_GRADE, MAX_RAMP_GRADE, 'one 1:12, not two');
  assert.ok(THRESHOLD < STEP_UP);
});

test('doorRolls: a 3ft leaf, a 32in cased opening, a pair with both leaves open', () => {
  assert.ok(doorRolls(3, LEAF_SINGLE));
  assert.ok(!doorRolls(2.9, LEAF_SINGLE));
  assert.ok(!doorRolls(2.5, LEAF_SINGLE));
  assert.ok(doorRolls(3.5, LEAF_SINGLE));
  assert.ok(doorRolls(32 / 12, LEAF_NONE), 'a cased opening loses nothing to a leaf');
  assert.ok(!doorRolls(2.5, LEAF_NONE));
  assert.ok(doorRolls(4, LEAF_DOUBLE), 'the lattice\'s 4ft pair rolls with both leaves open');
  assert.ok(doorRolls(6, LEAF_DOUBLE));
  assert.ok(!doorRolls(2.8, LEAF_DOUBLE));
  assert.equal(doorClear(6, LEAF_DOUBLE), 6 - CLEAR_LOSS);
  assert.equal(doorClear(2, LEAF_NONE), 2);
  // The default leaf is a single one, which is what a portal without a
  // record would have.
  assert.equal(doorRolls(3), doorRolls(3, LEAF_SINGLE));
});

test('rampRolls: 1:12 rolls, 1:8 does not, and a stair is not a ramp', () => {
  assert.ok(rampRolls({ type: 'ramp', data: { slope: 12 } }));
  assert.ok(rampRolls({ type: 'ramp', data: { slope: 16 } }));
  assert.ok(rampRolls({ type: 'ramp', data: {} }), 'the default ramp is 1:12');
  assert.ok(!rampRolls({ type: 'ramp', data: { slope: 8 } }));
  assert.ok(!rampRolls({ type: 'stair', data: {} }));
  assert.ok(!rampRolls(null));
});

test('seatedStep is the body as options, and its door rule is doorRolls', () => {
  const o = seatedStep({ grounded: true });
  assert.equal(o.radius, SEATED_R);
  assert.equal(o.stepUp, THRESHOLD);
  assert.equal(o.stepDown, THRESHOLD);
  assert.equal(o.headH, SEATED_HEAD_H);
  assert.equal(o.noStairs, true);
  assert.equal(o.maxGrade, MAX_SEATED_GRADE);
  assert.equal(o.grounded, true);
  for (const w of [2.5, 2.9, 3, 3.5, 6]) {
    for (const leaf of [LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE]) {
      assert.equal(o.doorRule({ w, leaf }), doorRolls(w, leaf));
    }
  }
});

test('every refusal is a sentence', () => {
  assert.equal(refusalText(null), '');
  assert.equal(refusalText({ reason: 'nothing' }), '');
  assert.match(refusalText({ reason: 'stair' }), /stair/i);
  assert.match(refusalText({ reason: 'stair' }), /lift/);
  assert.match(refusalText({ reason: 'door', doorway: { w: 2.5 } }), /30 in door/);
  assert.match(refusalText({ reason: 'door' }), /32 in/);
  assert.match(refusalText({ reason: 'grade', grade: 0.125 }), /1:8/);
  assert.match(refusalText({ reason: 'grade', grade: 0.125 }), /1:12/);
  assert.match(refusalText({ reason: 'grade' }), /half an inch/i);
});

// ---------- the contract, in the walk ----------

// Two polygon rooms side by side with one doorway of width `w` in the
// partition between them. Built as polygons rather than on the lattice so the
// door can be any width at all.
function twoRooms(w, leaf = LEAF_SINGLE) {
  const s = createState(20, 10);
  const a = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 },
  ], { name: 'West' });
  const b = addShape(s, 0, [
    { x: 20, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 20, z: 20 },
  ], { name: 'East' });
  // One partition, one wall: the west room builds it and hangs the door in
  // it, the east room leaves its side open (see the conventions).
  setSegWall(b, 0, 3, SEG_NONE);
  addOpening(a, 0, 1, 0.5, w, { leaf });
  return s;
}

// Push a body from `from` toward `to` in short steps, the way the walk does,
// and say whether it arrived. Door leaves are held fully open, which is what
// they are when a walker is standing in one.
function reaches(s, from, to, opts, steps = 200) {
  const collider = buildCollider(s, 0, catalogEntry);
  for (const leaf of collider.doors) leaf.open = 1;
  const pos = { x: from.x, y: 0, z: from.z };
  let refusal = null;
  for (let i = 0; i < steps; i++) {
    const dx = to.x - pos.x, dz = to.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) return { arrived: true, refusal };
    const step = Math.min(0.2, d);
    const m = moveWalker(s, collider, pos, (dx / d) * step, (dz / d) * step, opts);
    if (m.refusal) refusal = m.refusal;
    pos.x = m.x; pos.z = m.z;
    if (m.support) pos.y = m.support.y;
  }
  return { arrived: false, refusal };
}

test('the walk and the graph agree about every doorway', () => {
  for (const leaf of [LEAF_SINGLE, LEAF_NONE, LEAF_DOUBLE]) {
    for (const w of [2.5, 2.75, 2.9, 3, 3.25, 4, 6]) {
      const s = twoRooms(w, leaf);
      const kept = buildNav(s, { accessible: true }).portals.length === 1;
      assert.equal(buildNav(s).portals.length, 1, 'the plain graph always has the door');
      assert.equal(kept, doorRolls(w, leaf), `graph: ${w}ft leaf ${leaf}`);
      const seated = reaches(s, { x: 14, z: 10 }, { x: 26, z: 10 }, seatedStep({ grounded: true }));
      assert.equal(seated.arrived, kept, `walk: ${w}ft leaf ${leaf} arrived=${seated.arrived}`);
      if (!kept) {
        assert.ok(seated.refusal && seated.refusal.reason === 'door', `refused as a door: ${w}`);
        assert.ok(near(seated.refusal.doorway.w, w));
        assert.match(refusalText(seated.refusal), /door/);
      }
      // A standing walker gets through every one of them — the door rule is
      // the chair's and nobody else's.
      const standing = reaches(s, { x: 14, z: 10 }, { x: 26, z: 10 }, { grounded: true });
      assert.ok(standing.arrived, `standing: ${w}ft leaf ${leaf}`);
      assert.equal(standing.refusal, null);
    }
  }
});

test('the seated body is stopped by a wall like anybody, with no reason given', () => {
  const s = twoRooms(3);
  const collider = buildCollider(s, 0, catalogEntry);
  const m = moveWalker(s, collider, { x: 3, y: 0, z: 10 }, -1.5, 0, seatedStep({ grounded: true }));
  assert.ok(m.x >= SEATED_R + WALL_T_EXT / 2 - 1e-6, `${m.x}`);
  assert.ok(m.x < 3);
  assert.equal(m.refusal, null, 'a wall is not a rule');
});

// A two-storey slab with one run climbing +Z from (20, 20).
function withRun(type, extra = {}) {
  const s = createState(50, 50);
  addFloor(s);
  sheet(s, 0).fill(0, 0, 49, 49).bake();
  sheet(s, 1).fill(0, 0, 49, 49).bake();
  const { link, reason } = addStair(s, 0, { type, x: 20, z: 20, rotationY: 0, ...extra });
  assert.ok(link, reason);
  return { s, link };
}

test('a stair refuses the chair, and says so', () => {
  const { s } = withRun('stair');
  const collider = buildCollider(s, 0, catalogEntry);
  const pos = { x: 20, y: 0, z: 19.7 };
  const standing = tryStep(s, collider, pos, 0, 0.5, { grounded: true });
  assert.ok(standing && standing.support.kind === 'stair', 'on foot the run is a run');
  assert.ok(standing.support.link, 'a stair surface knows its run');
  const seated = moveWalker(s, collider, pos, 0, 0.5, seatedStep({ grounded: true }));
  assert.ok(seated.blocked);
  assert.equal(seated.refusal.reason, 'stair');
  assert.match(refusalText(seated.refusal), /stair/i);
});

test('a 1:12 ramp takes the chair up; a 1:8 ramp does not', () => {
  {
    const { s, link } = withRun('ramp', { slope: 12 });
    assert.ok(rampRolls(link));
    const r = reaches(s, { x: 20, z: 17 }, { x: 20, z: 40 }, seatedStep({ grounded: true }), 400);
    assert.ok(r.arrived, 'twenty feet up a 1:12 ramp');
    assert.equal(r.refusal, null);
    const collider = buildCollider(s, 0, catalogEntry);
    const up = tryStep(s, collider, { x: 20, y: 10 / 12, z: 30 }, 0, 0.2, seatedStep({ grounded: true }));
    assert.ok(up && up.support.y > 10 / 12, 'and it is climbing');
  }
  {
    const { s, link } = withRun('ramp', { slope: 8 });
    assert.ok(!rampRolls(link));
    const r = reaches(s, { x: 20, z: 17 }, { x: 20, z: 40 }, seatedStep({ grounded: true }), 400);
    assert.ok(!r.arrived);
    assert.equal(r.refusal.reason, 'grade');
    assert.match(refusalText(r.refusal), /1:8/);
    // ...and the graph agrees: the steep ramp is off the accessible route.
    assert.ok(buildNav(s).links.some((l) => l.type === 'ramp'));
    assert.ok(!buildNav(s, { accessible: true }).links.some((l) => l.type === 'ramp'));
  }
});

test('creeping does not beat the grade rule', () => {
  // Steps an inch long each rise less than a threshold; measured a foot ahead
  // the ramp is still 1:8.
  const { s } = withRun('ramp', { slope: 8 });
  const collider = buildCollider(s, 0, catalogEntry);
  const pos = { x: 20, y: 0, z: 19.9 };
  let climbed = 0;
  for (let i = 0; i < 100; i++) {
    const m = moveWalker(s, collider, pos, 0, 0.02, seatedStep({ grounded: true }));
    pos.x = m.x; pos.z = m.z; if (m.support) pos.y = m.support.y;
    climbed = pos.y;
  }
  assert.ok(climbed < 0.05, `crept ${climbed}ft up a 1:8 ramp`);
});

// ---------- the turning circle ----------

// A walled box room `w` by `d` cells with nothing in it.
function box(w, d, extra = null) {
  const s = createState(Math.max(12, w + 4), Math.max(12, d + 4));
  const f = sheet(s, 0);
  f.box(1, 1, w, d, { name: 'Room' });
  if (extra) extra(f, s);
  f.bake();
  return s;
}

test('clearRadiusAt: a wall, a piece of furniture, the edge of the floor', () => {
  const s = box(4, 4);   // 16ft square, exterior walls
  const world = clearanceWorld(s, 0, catalogEntry);
  const mid = clearRadiusAt(world, 12, 12, TURN_R);
  assert.equal(mid.clear, TURN_R);
  assert.equal(mid.blocker, null);
  // Two feet from the west wall: the wall, less its half-thickness.
  const byWall = clearRadiusAt(world, 6, 12, TURN_R);
  assert.equal(byWall.blocker, 'wall');
  assert.ok(near(byWall.clear, 2 - WALL_T_EXT / 2, 1e-6), `${byWall.clear}`);
  // Off the floor entirely.
  assert.deepEqual(clearRadiusAt(world, 30, 30, TURN_R), { clear: 0, blocker: 'edge' });
  // A locker bank a foot and a half away.
  addProp(s, 'locker-bank', { x: 12, z: 12 + 1.5 + 0.625, rotationY: 0, floor: 0 });
  const w2 = clearanceWorld(s, 0, catalogEntry);
  const byLocker = clearRadiusAt(w2, 12, 12, TURN_R);
  assert.equal(byLocker.blocker, 'furniture:locker-bank');
  assert.ok(near(byLocker.clear, 1.5, 1e-6), `${byLocker.clear}`);
  // The floor's edge: a two-storey slab with a hole cut in the upper one.
  const s2 = createState(20, 20);
  addFloor(s2);
  sheet(s2, 0).fill(0, 0, 19, 19).bake();
  sheet(s2, 1).fill(0, 0, 19, 19).bake();
  addStair(s2, 0, { type: 'opening', x: 40, z: 40, w: 8, d: 8 });
  const up = clearanceWorld(s2, 1, catalogEntry);
  const nearHole = clearRadiusAt(up, 40, 40 - 4 - 1, TURN_R);
  assert.ok(nearHole.clear < TURN_R, 'the void is in the circle');
  assert.ok(['edge', 'wall'].includes(nearHole.blocker), nearHole.blocker);
  assert.deepEqual(clearRadiusAt(up, 40, 40, TURN_R), { clear: 0, blocker: 'edge' });
});

// A corridor `len` cells long and `wide` cells wide along row 1, with a
// classroom hung off its south side through one door and the corridor open
// to the outside at its west end.
function corridorWith(wide, len, extra = null) {
  const s = createState(len + 6, 12);
  const f = sheet(s, 0);
  f.box(1, 1, len, wide, { name: 'Corridor' });
  f.box(len - 3, wide + 1, len, wide + 4, { name: 'Room 101' });
  f.door(len - 1, wide + 1, true);            // classroom into the corridor
  f.door(1, 1, false);                         // the way out, west end
  if (extra) extra(f, s);
  f.bake();
  return s;
}

const circulationOf = (nav) => {
  const ids = new Set(nav.rooms.filter((r) => /corridor|hall/i.test(r.name || '')).map((r) => r.id));
  return (id) => ids.has(id);
};

test('turningAnalysis: a wide corridor passes, a one-cell corridor cannot turn at its door', () => {
  const wide = corridorWith(3, 10);
  const nav = buildNav(wide, { accessible: true });
  const t = turningAnalysis(wide, { nav, catalogGet: catalogEntry, circulation: circulationOf(nav) });
  assert.ok(t.tested >= 4, `${t.tested} places`);
  assert.equal(t.fails.length, 0, JSON.stringify(t.fails));
  assert.ok(has(t.findings, 'clearance'));
  assert.equal(find(t.findings, 'clearance').level, 'ok');

  const narrow = corridorWith(1, 10);
  const nav2 = buildNav(narrow, { accessible: true });
  const t2 = turningAnalysis(narrow, { nav: nav2, catalogGet: catalogEntry, circulation: circulationOf(nav2) });
  const door = t2.fails.find((f) => f.kind === 'door');
  assert.ok(door, 'the corridor side of the classroom door has no room to turn');
  assert.ok(door.clear < TURN_R);
  const f = find(t2.findings, 'door-approach');
  assert.ok(f && f.level === 'warn');
  assert.ok(f.circles.length >= 1);
  assert.ok(f.circles.every((c) => Number.isFinite(c.x) && Number.isFinite(c.z) && c.need === TURN_R));
  assert.match(f.detail, /against the 60 in/);
  // ...and the corridor itself is a room a chair cannot turn round in.
  const room = t2.fails.find((s) => s.kind === 'room' && s.roomName === 'Corridor');
  assert.ok(room);
  assert.ok(has(t2.findings, 'turning-space'));
  assert.ok(find(t2.findings, 'turning-space').rooms.some((r) => r.name === 'Corridor'));
});

test('turningAnalysis: two locker banks facing each other pinch the route', () => {
  // An 8ft corridor with the banks' fronts 27in apart, halfway along.
  const pinched = corridorWith(2, 12, (f, s) => {
    addProp(s, 'locker-bank', { x: 24, z: 4 + 2, rotationY: 0, floor: 0 });
    addProp(s, 'locker-bank', { x: 24, z: 4 + 5.5, rotationY: Math.PI, floor: 0 });
  });
  const nav = buildNav(pinched, { accessible: true });
  const t = turningAnalysis(pinched, { nav, catalogGet: catalogEntry, circulation: circulationOf(nav) });
  const pinch = t.fails.find((s) => s.kind === 'pinch');
  assert.ok(pinch, JSON.stringify(t.fails.map((s) => s.kind)));
  assert.ok(pinch.clear < PASSAGE_R);
  assert.match(pinch.blocker, /locker/);
  const f = find(t.findings, 'route-pinch');
  assert.ok(f && f.level === 'warn');
  assert.match(f.detail, /locker bank/);
  // The same corridor with the banks against the walls is not pinched.
  const fine = corridorWith(2, 12, (f, s) => {
    addProp(s, 'locker-bank', { x: 24, z: 4 + 0.2 + 0.625, rotationY: 0, floor: 0 });
    addProp(s, 'locker-bank', { x: 24, z: 12 - 0.2 - 0.625, rotationY: Math.PI, floor: 0 });
  });
  const nav2 = buildNav(fine, { accessible: true });
  const t2 = turningAnalysis(fine, { nav: nav2, catalogGet: catalogEntry, circulation: circulationOf(nav2) });
  assert.ok(!t2.fails.some((s) => s.kind === 'pinch'), JSON.stringify(t2.fails));
  // ...and a corridor nobody flagged as circulation is not swept at all.
  const t3 = turningAnalysis(pinched, { nav, catalogGet: catalogEntry });
  assert.ok(!t3.spots.some((s) => s.kind === 'pinch'));
});

test('turningAnalysis asks only about rooms the route reaches', () => {
  const s = corridorWith(1, 10);
  const nav = buildNav(s, { accessible: true });
  const none = turningAnalysis(s, { nav, catalogGet: catalogEntry, reachable: () => false });
  assert.equal(none.tested, 0);
  assert.deepEqual(none.findings, []);
  assert.deepEqual(turningAnalysis(null, {}).findings, []);
});

// ---------- reach and heights ----------

test('every reach rule names a limit and a citation', () => {
  for (const r of REACH_RULES) {
    assert.ok(r.geo && r.kind && r.cite, JSON.stringify(r));
    if (r.kind !== 'locker') assert.ok(Number.isFinite(r.max) || Number.isFinite(r.min));
  }
});

test('reachAnalysis: counters, controls, work surfaces and lockers off the catalog', () => {
  const s = createState(20, 20);
  const f = sheet(s, 0);
  f.box(1, 1, 8, 8, { name: 'Office' });
  f.box(9, 1, 16, 8, { name: 'Lab' });
  f.box(1, 9, 8, 16, { name: 'Classroom' });
  f.bake();
  const P = (type, x, z, o = {}) => addProp(s, type, { x, z, floor: 0, ...o });
  // The office is x 4–36, the lab x 36–68, the classroom below the office.
  P('counter-reception', 50, 12);            // 42in — too high, in the lab
  P('counter-serving', 20, 12);              // 36in — the limit, passes
  P('fountain', 26, 20);                     // spout at 36in — passes
  P('dispenser', 30, 12, { y: 4.5, mount: 'wall' });     // 54in — too high
  P('hook-rail', 14, 30, { y: 1, mount: 'wall' });       // 12in — too low
  P('speaker-pa', 30, 30, { y: 8, mount: 'wall' });      // not a control
  P('bench-lab', 48, 16);                    // the lab's only surface, 36in
  P('bench-lab', 48, 24);
  P('student-desk', 16, 48);                 // 30in — the classroom is fine
  P('locker-bank', 8, 60);
  const nav = buildNav(s);
  const r = reachAnalysis(s, { nav, catalogGet: catalogEntry });
  assert.ok(r.tested >= 7, `${r.tested}`);
  const counters = r.items.filter((i) => i.kind === 'counter');
  assert.deepEqual(counters.map((i) => i.type), ['counter-reception']);
  assert.ok(near(counters[0].at, 3.5));
  assert.equal(counters[0].roomName, 'Lab');
  const controls = r.items.filter((i) => i.kind === 'control');
  assert.deepEqual(controls.map((i) => i.type).sort(), ['dispenser', 'hook-rail']);
  assert.ok(controls.find((i) => i.type === 'dispenser').high);
  assert.ok(!controls.find((i) => i.type === 'hook-rail').high);
  assert.deepEqual(r.rooms.map((w) => w.name), ['Lab']);
  assert.equal(r.lockers, 1);
  assert.equal(r.lockersLow, 0);
  assert.ok(has(r.findings, 'counter-height'));
  assert.match(find(r.findings, 'counter-height').detail, /42 in where 36 in/);
  assert.ok(has(r.findings, 'reach-range'));
  assert.ok(has(r.findings, 'work-surface'));
  assert.match(find(r.findings, 'work-surface').detail, /Lab/);
  assert.equal(find(r.findings, 'lockers').level, 'note');
  assert.ok(!has(r.findings, 'reach'));
  // Every failing item is somewhere a plan can point at.
  for (const f of r.findings) {
    for (const d of f.doors || []) assert.ok(Number.isFinite(d.x) && Number.isFinite(d.z));
  }
  // Fix the lot and the section says so.
  const s2 = createState(20, 20);
  sheet(s2, 0).box(1, 1, 8, 8, { name: 'Office' }).bake();
  addProp(s2, 'counter-serving', { x: 12, z: 12, floor: 0 });
  addProp(s2, 'student-desk', { x: 20, z: 20, floor: 0 });
  addProp(s2, 'locker-bank-half', { x: 8, z: 24, floor: 0 });
  const r2 = reachAnalysis(s2, { nav: buildNav(s2), catalogGet: catalogEntry });
  assert.equal(r2.fails.length, 0);
  assert.equal(find(r2.findings, 'reach').level, 'ok');
  assert.ok(!has(r2.findings, 'lockers'), 'a half-height bank is within reach');
  // A scaled counter grows out of reach with the prop.
  const s3 = createState(20, 20);
  sheet(s3, 0).box(1, 1, 8, 8, { name: 'Office' }).bake();
  addProp(s3, 'counter-serving', { x: 12, z: 12, floor: 0, scale: 1.2 });
  assert.equal(reachAnalysis(s3, { catalogGet: catalogEntry }).fails.length, 1);
  // No catalog, nothing to say.
  assert.deepEqual(reachAnalysis(s, {}).findings, []);
});

// ---------- the section, and the sample ----------

test('the accessible section carries the chair, and the report carries the section', () => {
  const s = buildSampleSchool();
  const a = accessibleAnalysis(s);
  assert.ok(a.turning && a.reach);
  assert.equal(a.summary.turningTested, a.turning.tested);
  assert.equal(a.summary.turningFails, a.turning.fails.length);
  assert.equal(a.summary.reachTested, a.reach.tested);
  assert.equal(a.summary.steepRamps, 0);
  for (const spot of a.turning.spots) {
    assert.ok(Number.isFinite(spot.clear) && spot.clear >= 0 && spot.clear <= spot.need + 1e-9);
    assert.ok(['door', 'pinch', 'room'].includes(spot.kind));
    assert.ok(Number.isFinite(spot.x) && Number.isFinite(spot.z) && Number.isInteger(spot.floor));
    assert.equal(spot.ok, spot.clear >= spot.need - 1e-9);
  }
  // The sample has a door onto the strip beside its mezzanine void, and that
  // is the one place in it a chair cannot turn at a door.
  const doors = a.turning.fails.filter((f) => f.kind === 'door');
  assert.ok(doors.length >= 1);
  assert.ok(doors.every((d) => d.roomName === 'Upper Hall'), JSON.stringify(doors));
  assert.ok(a.reach.tested > 0);
  const r = buildReport(s);
  const mine = r.findings.filter((f) => f.section === 'accessible');
  assert.ok(mine.some((f) => f.code === 'door-approach'));
  assert.ok(mine.every((f) => f.level !== 'fail'), 'the chair warns; it does not fail a school');
  // Switched off, the section is exactly what it was.
  const off = accessibleAnalysis(s, { turning: false, reach: false });
  assert.equal(off.summary.turningTested, 0);
  assert.equal(off.summary.reachTested, 0);
  assert.ok(!has(off.findings, 'door-approach'));
});

test('a steep ramp is a finding, and it is not counted as a way up', () => {
  const s = createState(30, 30);
  addFloor(s);
  const f = sheet(s, 0);
  f.box(1, 1, 20, 8, { name: 'Ground Hall' }).door(1, 4, false);
  f.bake();
  sheet(s, 1).box(1, 1, 20, 8, { name: 'Upper Hall' }).bake();
  const { link } = addStair(s, 0, { type: 'ramp', x: 20, z: 12, rotationY: Math.PI / 2, slope: 6 });
  assert.ok(link);
  const a = accessibleAnalysis(s);
  assert.equal(a.summary.ramps, 0);
  assert.equal(a.summary.steepRamps, 1);
  assert.ok(has(a.findings, 'steep-ramp'));
  assert.match(find(a.findings, 'steep-ramp').detail, /1:6/);
  assert.ok(has(a.findings, 'no-lift'), 'a ramp a chair cannot climb is no way up');
  assert.ok(find(a.findings, 'steep-ramp').doors.length === 1);
});

test('the leaf a doorway hangs rides on its portal', () => {
  const s = twoRooms(4, LEAF_DOUBLE);
  const p = buildNav(s).portals[0];
  assert.equal(p.leaf, LEAF_DOUBLE);
  assert.equal(p.w, 4);
  const field = egressField(buildNav(s, { accessible: true }));
  assert.ok(field);
});

test('the chair sees the sample the way the sample is: every number finite, and fast', () => {
  const s = buildSampleSchool();
  const nav = buildNav(s, { accessible: true });
  const t0 = Date.now();
  const t = turningAnalysis(s, { nav, catalogGet: catalogEntry, circulation: circulationOf(nav) });
  const r = reachAnalysis(s, { nav, catalogGet: catalogEntry });
  const ms = Date.now() - t0;
  assert.ok(t.tested > 20 && r.tested > 0);
  assert.ok(ms < 5000, `${ms}ms`);
  assert.equal(CELL, 4);
});
