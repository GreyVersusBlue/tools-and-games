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
  REACH_MIN, REACH_MAX, COUNTER_MAX, LAVATORY_MAX, WORK_MIN, WORK_MAX, REACH_RULES,
  reachAnalysis,
} from '../js/clearance.js';
import {
  TURN_D, TURN_R, PASSAGE_D, PASSAGE_R, clearanceWorld, clearRadiusAt, turningAnalysis,
  doorRect, doorRectBlocker,
  DOOR_PULL_DEPTH, DOOR_PULL_LATCH, DOOR_PUSH_DEPTH, DOOR_PUSH_LATCH,
} from '../js/turning.js';

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
  assert.ok(door, 'the corridor side of the classroom door has no room to manoeuvre');
  // A door that swings is asked 404.2.4's rectangle, not a circle: it is the
  // 4 ft corridor that is shorter than the 60 or 48 in the table wants.
  assert.equal(door.rect, true);
  assert.ok(door.depth < door.needDepth, `${door.depth} of ${door.needDepth}`);
  assert.equal(door.blocker, 'wall', 'the far wall of a 4 ft corridor');
  const f = find(t2.findings, 'door-approach');
  assert.ok(f && f.level === 'warn');
  assert.ok(f.rects.length >= 1 && f.doors.length === f.rects.length);
  assert.ok(f.rects.every((r) => r.corners.length === 4
    && r.corners.every((c) => Number.isFinite(c.x) && Number.isFinite(c.z))));
  assert.ok(!f.circles, 'no circle is drawn for a door that swings');
  assert.equal(f.cite, 'ADA 2010 · §404.2.4');
  assert.match(f.detail, /404\.2\.4\.1 asks for/);
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

// ---------- a door's manoeuvring clearance: ADA 404.2.4's rectangle ----------

test('404.2.4.1 in feet: 60 in and 18 in on the pull side, 48 in and 12 in on the push side', () => {
  assert.equal(DOOR_PULL_DEPTH, 5);
  assert.equal(DOOR_PULL_LATCH, 1.5);
  assert.equal(DOOR_PUSH_DEPTH, 4);
  assert.equal(DOOR_PUSH_LATCH, 1);
});

// Two rooms side by side, a 3 ft door in the wall between them at (20, 10).
// The wall runs +z; the hinge is on the start jamb (lower z) when `hand` is +1
// and the leaf swings toward the run's left (west, into West) when `sw` is +1.
// Wall faces are 0.2 ft off the centre line, an interior partition's half.
function hungPair(hand, sw, extra = null) {
  const s = createState(20, 10);
  const a = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 },
  ], { name: 'West' });
  const b = addShape(s, 0, [
    { x: 20, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 20, z: 20 },
  ], { name: 'East' });
  setSegWall(b, 0, 3, SEG_NONE);
  addOpening(a, 0, 1, 0.5, 3, { leaf: LEAF_SINGLE, hand, sw });
  if (extra) extra(s);
  return s;
}
const doorSpots = (s) => {
  const nav = buildNav(s, { accessible: true });
  const t = turningAnalysis(s, { nav, catalogGet: catalogEntry });
  const byRoom = {};
  for (const sp of t.spots) if (sp.kind === 'door') byRoom[sp.roomName] = sp;
  return { t, ...byRoom };
};
// A spot's corners as the box they bound, for an axis-aligned rectangle.
const boxOf = (sp) => {
  const xs = sp.corners.map((c) => c.x), zs = sp.corners.map((c) => c.z);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
};
const sameBox = (got, want) => {
  for (const k of Object.keys(want)) assert.ok(near(got[k], want[k], 1e-9), `${k}: ${got[k]} not ${want[k]}`);
};

test('door rectangle: swung west, hinged low, latch high — West is the pull side', () => {
  const { West, East } = doorSpots(hungPair(1, 1));
  assert.equal(West.pull, true);
  assert.equal(East.pull, false);
  // The door's opening is z 8.5 to 11.5. Latch toward +z, so the strip runs
  // from 11.5 to 13 (18 in) on the pull side and to 12.5 (12 in) on the push
  // side. Depth starts at the wall face, 0.2 either side of x = 20, and the
  // hinge end starts 0.2 inside the jamb, at 8.7 (see `doorRectCorners`).
  sameBox(boxOf(West), { x0: 14.8, x1: 19.8, z0: 8.7, z1: 13 });
  sameBox(boxOf(East), { x0: 20.2, x1: 24.2, z0: 8.7, z1: 12.5 });
  assert.equal(West.ok && East.ok, true, 'two empty rooms');
});

test('door rectangle: swung east, hinged high, latch low — East is the pull side', () => {
  const { West, East } = doorSpots(hungPair(-1, -1));
  assert.equal(East.pull, true);
  assert.equal(West.pull, false);
  // Latch toward -z: the strip runs down from 8.5, to 7 (pull) or 7.5 (push),
  // and the hinge end stops 0.2 short of the jamb at 11.5, at 11.3.
  sameBox(boxOf(East), { x0: 20.2, x1: 25.2, z0: 7, z1: 11.3 });
  sameBox(boxOf(West), { x0: 15.8, x1: 19.8, z0: 7.5, z1: 11.3 });
});

test('door rectangle: the hinge side only moves the strip, the swing side only moves the depth', () => {
  const lowHigh = doorSpots(hungPair(1, 1)).West;   // pull, latch high
  const lowLow = doorSpots(hungPair(-1, 1)).West;   // pull, latch low
  sameBox(boxOf(lowHigh), { x0: 14.8, x1: 19.8, z0: 8.7, z1: 13 });
  sameBox(boxOf(lowLow), { x0: 14.8, x1: 19.8, z0: 7, z1: 11.3 });
  const push = doorSpots(hungPair(1, -1)).West;     // push, latch high
  sameBox(boxOf(push), { x0: 15.8, x1: 19.8, z0: 8.7, z1: 12.5 });
});

test('door rectangle: a locker in the latch strip blocks the door it is beside, not the other hinge', () => {
  // A locker bank (6 ft by 15 in) along the wall, z 11.875 to 13.125: past the
  // latch jamb at 11.5, inside the pull side's 18 in strip (to 13).
  const locker = (s) => addProp(s, 'locker-bank', { x: 17, z: 12.5, rotationY: 0, floor: 0 });
  const high = doorSpots(hungPair(1, 1, locker)).West;
  assert.equal(high.ok, false);
  assert.equal(high.blocker, 'furniture:locker-bank');
  assert.ok(near(high.strip, 11.875 - 11.5, 1 / 24), `${high.strip} ft of the strip fits`);
  assert.equal(high.depth, 0, 'the locker is against the wall: no depth of the full-width rectangle clears it');
  // Hinged the other way the same locker is on the hinge side's far end: the
  // rectangle runs z 7 to 11.3 and the locker starts at 11.875.
  const low = doorSpots(hungPair(-1, 1, locker)).West;
  assert.equal(low.ok, true);
  // The push side's strip is 12 in, to 12.5: the locker still reaches it.
  const push = doorSpots(hungPair(1, -1, locker)).West;
  assert.equal(push.ok, false);
});

test('door rectangle: 60 in deep on the pull side, 48 in on the push side', () => {
  // A thin locker standing across the way, x 14.375 to 15.625, z 7 to 13. The
  // pull rectangle reaches x 14.8; the push one stops at 15.8.
  const locker = (s) => addProp(s, 'locker-bank', { x: 15, z: 10, rotationY: Math.PI / 2, floor: 0 });
  const pull = doorSpots(hungPair(1, 1, locker)).West;
  assert.equal(pull.ok, false);
  assert.ok(near(pull.depth, 19.8 - 15.625, 1 / 24), `${pull.depth} ft deep clears the locker's face`);
  const push = doorSpots(hungPair(1, -1, locker)).West;
  assert.equal(push.ok, true, '48 in from the face stops short of the locker');
});

test('door rectangle: a door on a diagonal wall hangs its rectangle square to the wall', () => {
  // West is (0,0) (20,0) (30,20) (0,20); East takes the rest. The partition
  // runs (20, 0) to (30, 20), length 10 sqrt 5, and the door is at its middle,
  // (25, 10). Unit run u = (1, 2)/sqrt 5; its left normal n = (-2, 1)/sqrt 5
  // points into West. Hinge at the start, swung left: West is the pull side.
  const s = createState(20, 10);
  const a = addShape(s, 0, [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 30, z: 20 }, { x: 0, z: 20 },
  ], { name: 'West' });
  const b = addShape(s, 0, [
    { x: 20, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 30, z: 20 },
  ], { name: 'East' });
  setSegWall(b, 0, 3, SEG_NONE);
  assert.ok(addOpening(a, 0, 1, 0.5, 3, { leaf: LEAF_SINGLE, hand: 1, sw: 1 }));
  const { West, East } = doorSpots(s);
  const r5 = Math.sqrt(5);
  // (25, 10) + a * u + v * n, with a along the run and v out of the wall.
  const at = (a, v) => ({ x: 25 + a / r5 - 2 * v / r5, z: 10 + 2 * a / r5 + v / r5 });
  const want = (a0, a1, v0, v1) => [at(a0, v0), at(a1, v0), at(a1, v1), at(a0, v1)];
  const check = (sp, corners) => corners.forEach((c, i) => {
    assert.ok(near(sp.corners[i].x, c.x, 1e-9) && near(sp.corners[i].z, c.z, 1e-9),
      `corner ${i}: ${JSON.stringify(sp.corners[i])} not ${JSON.stringify(c)}`);
  });
  assert.equal(West.pull, true);
  // Pull: along from -1.5 + 0.2 (the hinge face) to 1.5 + 1.5, out from 0.2
  // to 5.2 off the face.
  check(West, want(-1.3, 3, 0.2, 5.2));
  // Push, on East's side: n reversed, so v runs the other way: 0.2 to 4.2 out.
  assert.equal(East.pull, false);
  check(East, [at(-1.3, -0.2), at(2.5, -0.2), at(2.5, -4.2), at(-1.3, -4.2)]);
});

test('door rectangle: a door hung at a corner passes with its hinge there and fails with its latch there', () => {
  // A 12 ft closet and a hall east of it, a 4 ft door cut in the closet's east
  // wall at its first, middle or last cell. Every lattice door hinges at the
  // start of the run and latches toward the +z end. At the first cell the
  // closet's north wall meets the hinge jamb: the leaf hangs against its face,
  // and the rectangle (which starts there) clears. At the last cell the same
  // kind of wall meets the latch jamb, where the 18 in strip would be, and that
  // is the classic fail: the strip is in the wall.
  const at = (row) => {
    const s = createState(24, 12);
    const f = sheet(s, 0);
    f.box(1, 1, 3, 3, { name: 'Closet' });
    f.box(4, 1, 8, 3, { name: 'Hall' });
    f.door(4, row, false);
    f.bake();
    const nav = buildNav(s, { accessible: true });
    return turningAnalysis(s, { nav, catalogGet: catalogEntry }).spots.filter((x) => x.kind === 'door');
  };
  for (const row of [1, 2]) {
    const both = at(row);
    assert.equal(both.length, 2);
    assert.ok(both.every((x) => x.ok), `row ${row}: ${JSON.stringify(both.map((x) => x.blocker))}`);
  }
  const corner = at(3);
  assert.ok(corner.every((x) => !x.ok && x.blocker === 'wall'), JSON.stringify(corner.map((x) => x.blocker)));
  assert.ok(corner.every((x) => x.strip < x.needStrip), 'the strip is what the wall takes');
});

test('door rectangle: a wall crossing at the hinge jamb is the face the leaf hangs on, one at the latch jamb is in the strip', () => {
  // The door of hungPair(1, 1) with the collider's walls written out by hand:
  // the x = 20 wall in two pieces, z 0 to 8.5 and 11.5 to 20, and a 10 ft
  // partition running west from one jamb or the other, all 0.4 thick.
  const wall = (ax, az, bx, bz) => ({ ax, az, bx, bz, t: 0.4, pad: 0.2 });
  const door = (cross) => {
    const s = hungPair(1, 1);
    const nav = buildNav(s, { accessible: true });
    const p = nav.portals[0];
    const world = clearanceWorld(s, 0, catalogEntry);
    world.collider = { segs: [wall(20, 0, 20, 8.5), wall(20, 11.5, 20, 20), cross], props: [] };
    return doorRectBlocker(world, doorRect(p, { x: -1, z: 0 }));
  };
  // Hinge low, so the jamb at z 8.5 is the hinge: its partition's face is at
  // 8.7, where the rectangle starts, and it touches without overlapping.
  assert.equal(door(wall(10, 8.5, 20, 8.5)), null);
  // The jamb at 11.5 is the latch: a partition there stands in the 18 in strip.
  assert.equal(door(wall(10, 11.5, 20, 11.5)), 'wall');
  // And one 0.1 ft inside the hinge-side face is in the rectangle.
  assert.equal(door(wall(10, 8.8, 20, 8.8)), 'wall');
});

test('door rectangle: a cased opening has no leaf, so it keeps the turning circle', () => {
  const s = hungPair(1, 1);
  s.floors[0].shapes[0].rings[0].openings[0].leaf = LEAF_NONE;
  const { t } = doorSpots(s);
  const door = t.spots.find((sp) => sp.kind === 'door');
  assert.ok(door && !door.rect);
  assert.equal(door.need, TURN_R);
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
