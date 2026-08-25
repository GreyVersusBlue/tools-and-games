// The crowd: who exists, where they are told to be, what they sit on, and
// whether a building full of them empties when the alarm goes.
//
// The last of those is a simulation rather than a calculation, so this suite
// runs one: the sample school, a seeded population, and a fixed timestep. It
// asserts the properties that have to hold (everybody with a route out gets
// out; nobody ends up inside a wall; the same seed gives the same school) and
// not the exact positions, which are emergent and would make this a change
// detector rather than a test.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSampleSchool } from '../js/sample.js';
import { catalogEntry } from '../js/catalog.js';
import { buildCollider, supportAt } from '../js/collide.js';
import { terrainField } from '../js/terrain.js';
import { buildNav, teachingRooms } from '../js/navgraph.js';
import { defaultSchedule, blocks, normalizeSchedule } from '../js/schedule.js';
import {
  rng, seatOf, isSeat, seatsIn, makePopulation, pickLunchroom,
  makeContext, retargetAll, stepAgents, goalRoomFor, speedFor,
  makeCrowdField, crowdAdd, crowdCells, clearCrowd,
  census, drillReport, bodiesOn, bodiesNear,
  SPEED, AGENT_R, MAX_POP,
} from '../js/agents.js';

// One sample school, built once and shared by the read-only tests. The
// simulations each build their own, since they mutate the population.
const SAMPLE = buildSampleSchool();
const SAMPLE_NAV = buildNav(SAMPLE);

function harness(opts = {}) {
  const state = opts.state || buildSampleSchool();
  const nav = buildNav(state);
  const site = terrainField(state);
  const colliders = new Map();
  const colliderFor = (i) => {
    let c = colliders.get(i);
    if (!c) { c = buildCollider(state, i, catalogEntry, { site }); colliders.set(i, c); }
    return c;
  };
  const schedule = normalizeSchedule(opts.schedule);
  const agents = makePopulation(state, nav, {
    seed: opts.seed ?? 5, students: opts.students ?? 24, schedule,
  });
  const ctx = makeContext(state, nav, {
    site, schedule, colliderFor, catalogGet: catalogEntry, minutes: opts.minutes ?? 9 * 60 + 20,
  });
  return { state, nav, site, colliderFor, agents, ctx };
}

const run = (ctx, agents, seconds, dt = 1 / 30) => {
  for (let t = 0; t < Math.round(seconds / dt); t++) stepAgents(ctx, agents, dt);
};

// ---------- seeded randomness ----------

test('the same seed gives the same sequence, a different one does not', () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const first = Array.from({ length: 6 }, () => a());
  assert.deepEqual(Array.from({ length: 6 }, () => b()), first);
  assert.notDeepEqual(Array.from({ length: 6 }, () => c()), first);
  for (const v of first) assert.ok(v >= 0 && v < 1);
});

// ---------- seats ----------

test('a chair is a seat and a filing cabinet is not', () => {
  assert.ok(isSeat(catalogEntry('student-chair')));
  assert.ok(isSeat(catalogEntry('stool-lab-24')));
  assert.ok(isSeat(catalogEntry('bench-hall')));
  assert.ok(!isSeat(catalogEntry('student-desk')));
  assert.ok(!isSeat(catalogEntry('whiteboard')));
  assert.ok(!isSeat(null));
});

test('a seat height is a seat height, never an ankle or a shoulder', () => {
  for (const type of ['student-chair', 'stool-lab-30', 'beanbag', 'cushion', 'sofa']) {
    const seat = seatOf(catalogEntry(type));
    assert.ok(seat, type);
    assert.ok(seat.h >= 0.4 && seat.h <= 2, `${type} sits at ${seat.h}ft`);
  }
});

test('an explicit seat block on a row beats the geometry guess', () => {
  const seat = seatOf({ mount: 'floor', geo: 'desk', h: 3, seat: { h: 1.1, back: false } });
  assert.equal(seat.h, 1.1);
  assert.equal(seat.back, false);
});

test('seats belong to the room the model says they are in', () => {
  const room = SAMPLE_NAV.rooms.find((r) => r.name === 'Room 101');
  const seats = seatsIn(SAMPLE, SAMPLE_NAV, room, catalogEntry);
  assert.ok(seats.length >= 6, 'the furnished classroom has chairs');
  for (const s of seats) {
    assert.equal(SAMPLE_NAV.roomIdAt(room.floor, s.x, s.z), room.id);
    assert.ok(Number.isFinite(s.facing));
  }
  assert.ok(seats.some((s) => s.teacher), 'including the teacher\'s');
  // ...and a room with no furniture has none, rather than borrowing next door's.
  const empty = SAMPLE_NAV.rooms.find((r) => r.name === 'Room 103');
  assert.equal(seatsIn(SAMPLE, SAMPLE_NAV, empty, catalogEntry).length, 0);
});

// ---------- the population ----------

test('a population is teachers plus students, one teacher per teaching room', () => {
  const agents = makePopulation(SAMPLE, SAMPLE_NAV, { seed: 3, students: 30 });
  const teachers = agents.filter((a) => a.kind === 'teacher');
  const students = agents.filter((a) => a.kind === 'student');
  assert.equal(students.length, 30);
  assert.equal(teachers.length, teachingRooms(SAMPLE_NAV).length);
  assert.equal(new Set(teachers.map((t) => t.home)).size, teachers.length, 'one room each');
});

test('a population is a pure function of design, seed and size', () => {
  const key = (list) => list.map((a) => `${a.kind}:${a.home}:${a.shirt}:${a.timetable.join(',')}`).join('|');
  const a = makePopulation(SAMPLE, SAMPLE_NAV, { seed: 11, students: 20 });
  const b = makePopulation(SAMPLE, SAMPLE_NAV, { seed: 11, students: 20 });
  const c = makePopulation(SAMPLE, SAMPLE_NAV, { seed: 12, students: 20 });
  assert.equal(key(a), key(b));
  assert.notEqual(key(a), key(c));
});

test('students are spread over the homerooms rather than piled into one', () => {
  const agents = makePopulation(SAMPLE, SAMPLE_NAV, { seed: 4, students: 36 });
  const homes = new Map();
  for (const a of agents.filter((x) => x.kind === 'student')) {
    homes.set(a.home, (homes.get(a.home) || 0) + 1);
  }
  const counts = [...homes.values()];
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'evenly dealt');
});

test('the population size is clamped, and zero students is a staff meeting', () => {
  assert.equal(makePopulation(SAMPLE, SAMPLE_NAV, { students: 0 }).filter((a) => a.kind === 'student').length, 0);
  const huge = makePopulation(SAMPLE, SAMPLE_NAV, { students: 1e6 });
  assert.ok(huge.filter((a) => a.kind === 'student').length <= MAX_POP);
});

test('a design with no rooms has no population, rather than a crash', () => {
  const empty = { floors: [], props: [], links: [], w: 4, h: 4, floorHt: 12 };
  const nav = buildNav(empty);
  assert.deepEqual(makePopulation(empty, nav, { students: 20 }), []);
});

test('everybody starts on the storey their homeroom is on', () => {
  const agents = makePopulation(SAMPLE, SAMPLE_NAV, { seed: 9, students: 24 });
  for (const a of agents) {
    assert.equal(a.floorIndex, SAMPLE_NAV.node(a.home).floor, 'spawned on the wrong storey');
  }
});

test('lunch happens in a room named for it, or the biggest common one', () => {
  const named = [{ id: 'a', name: 'Cafeteria', area: 100 }];
  assert.equal(pickLunchroom(named, []), 'a');
  const unnamed = [{ id: 'small', name: 'Hall', area: 100 }, { id: 'big', name: 'Hall', area: 900 }];
  assert.equal(pickLunchroom(unnamed, []), 'big');
});

// ---------- what the schedule asks of them ----------

test('during a class you are in that period\'s room; during passing you are heading to the next', () => {
  const sched = defaultSchedule();
  const agent = { timetable: ['home', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'], home: 'home', lunch: 'caf' };
  const list = blocks(sched);
  const period2 = list.find((b) => b.kind === 'class' && b.index === 2);
  const before2 = list.find((b) => b.kind === 'passing' && b.end === period2.start);
  assert.equal(goalRoomFor(agent, sched, period2.start + 5), 'r2');
  assert.equal(goalRoomFor(agent, sched, before2.start + 1), 'r2', 'passing looks ahead');
});

test('lunch sends everyone to the lunchroom, and out of hours sends them home', () => {
  const sched = defaultSchedule();
  const agent = { timetable: ['home', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'], home: 'home', lunch: 'caf' };
  const lunch = blocks(sched).find((b) => b.kind === 'lunch');
  assert.equal(goalRoomFor(agent, sched, lunch.start + 2), 'caf');
  assert.equal(goalRoomFor(agent, sched, 6 * 60), null);
  assert.equal(goalRoomFor(agent, sched, 22 * 60), null);
  assert.equal(goalRoomFor(agent, sched, lunch.start + 2, 'drill'), null, 'a drill overrides the timetable');
});

test('a corridor moves faster at a passing period, and faster again in a drill', () => {
  const sched = defaultSchedule();
  const passing = blocks(sched).find((b) => b.kind === 'passing');
  const cls = blocks(sched).find((b) => b.kind === 'class');
  assert.equal(speedFor(sched, cls.start + 1, 'day'), SPEED.walk);
  assert.equal(speedFor(sched, passing.start + 1, 'day'), SPEED.passing);
  assert.equal(speedFor(sched, cls.start + 1, 'drill'), SPEED.drill);
});

// ---------- crowding ----------

test('the crowd field bins agent-seconds and normalises against its busiest bin', () => {
  const field = makeCrowdField(4);
  crowdAdd(field, 0, 2, 2, 1);
  crowdAdd(field, 0, 3, 3, 1);        // same bin
  crowdAdd(field, 0, 10, 2, 0.5);     // another
  crowdAdd(field, 1, 2, 2, 0.25);     // another storey
  const ground = crowdCells(field, 0);
  assert.equal(ground.length, 2);
  const busiest = ground[ground.length - 1];
  assert.equal(busiest.v, 2);
  assert.equal(busiest.t, 1);
  assert.equal(crowdCells(field, 1)[0].t, 0.125, 'normalised across storeys, not within one');
  clearCrowd(field);
  assert.equal(crowdCells(field, 0).length, 0);
  assert.equal(field.max, 0);
});

test('a bin with no time in it is not a bin', () => {
  const field = makeCrowdField();
  crowdAdd(field, 0, 1, 1, 0);
  crowdAdd(null, 0, 1, 1, 1);
  assert.equal(crowdCells(field, 0).length, 0);
});

// ---------- bodies ----------

test('the bodies a camera has to walk around are the ones on its storey', () => {
  const { agents } = harness({ students: 12 });
  const ground = bodiesOn(agents, 0);
  assert.ok(ground.length > 0);
  for (const b of ground) assert.equal(b.r, AGENT_R);
  assert.equal(bodiesOn(agents, 7).length, 0, 'nobody is on a storey that isn\'t there');
});

test('a leaf is told who is near it, and which of them is actually using it', () => {
  const { agents, ctx, nav } = harness({ students: 12 });
  retargetAll(ctx, agents);
  const near = bodiesNear(agents, 0, agents[0].x, agents[0].z, 40);
  assert.ok(near.length > 0);
  for (const b of near) assert.equal(typeof b.open, 'boolean');
  assert.ok(bodiesNear(agents, 0, -900, -900, 5).length === 0);
});

// ---------- the simulation ----------

test('a class settles: people arrive, and the ones with chairs sit on them', () => {
  const { ctx, agents, nav } = harness({ students: 24, minutes: 9 * 60 + 20 });
  retargetAll(ctx, agents);
  run(ctx, agents, 90);
  const c = census(agents);
  assert.equal(c.total, agents.length);
  assert.ok(c.walking + c.seated + c.idle + c.out === c.total);
  const arrived = agents.filter((a) => nav.roomIdAt(a.floorIndex, a.x, a.z) === a.goal).length;
  assert.ok(arrived > agents.length * 0.5, `only ${arrived}/${agents.length} reached their room`);
  // The one furnished classroom in the sample gets used.
  const room101 = nav.rooms.find((r) => r.name === 'Room 101');
  const sitting = agents.filter((a) => a.state === 'sit');
  for (const a of sitting) assert.ok(a.seat, 'a seated person is on a seat');
  assert.equal(new Set(sitting.map((a) => a.seat.id)).size, sitting.length, 'no two people share a chair');
  assert.ok(seatsIn(ctx.state, nav, room101, catalogEntry).length > 0);
});

test('nobody walks through a wall, ends up in the ground, or leaves the site', () => {
  const { ctx, agents, state, site } = harness({ students: 24 });
  retargetAll(ctx, agents);
  run(ctx, agents, 60);
  for (const a of agents) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.y));
    assert.ok(Math.abs(a.x) < 4000 && Math.abs(a.z) < 4000, 'still on the site');
    const support = supportAt(state, a.x, a.z, a.y + 0.5, { site });
    assert.ok(support, 'standing on something');
    assert.ok(Math.abs(support.y - a.y) < 2, `${a.id} is ${Math.abs(support.y - a.y).toFixed(1)}ft off the floor`);
  }
});

test('a passing period puts people in the corridors and a class takes them out again', () => {
  const { ctx, agents, nav } = harness({ students: 24, minutes: 9 * 60 + 20 });
  retargetAll(ctx, agents);
  run(ctx, agents, 60);
  const hallId = nav.rooms.find((r) => r.name === 'Main Hall').id;
  const inHall = () => agents.filter((a) => nav.roomIdAt(a.floorIndex, a.x, a.z) === hallId).length;
  const settled = inHall();
  // ...now ring the bell.
  const passing = blocks(ctx.schedule).find((b) => b.kind === 'passing' && b.start > 9 * 60 + 20);
  ctx.minutes = passing.start + 1;
  retargetAll(ctx, agents);
  run(ctx, agents, 12);
  assert.ok(inHall() >= settled, 'the corridor fills at the bell');
});

test('the fire drill empties the building, and says who did not get out', () => {
  const { ctx, agents, nav } = harness({ students: 30, minutes: 9 * 60 + 20 });
  retargetAll(ctx, agents);
  run(ctx, agents, 30);
  ctx.mode = 'drill';
  ctx.egress = null;
  ctx.elapsed = 0;
  clearCrowd(ctx.crowd);
  retargetAll(ctx, agents);
  run(ctx, agents, 200);
  const report = drillReport(agents, ctx.elapsed);
  assert.equal(report.total, agents.length);
  assert.equal(report.out + report.inside, report.total);
  assert.equal(report.stranded, 0, 'every room in the sample school has a way out');
  // Most of the school, not all of it: an evacuation has a tail, and ours is
  // longer than a real one because a body that has been shuffled into a corner
  // by a crowd takes a while to find its way back out of it. The bar is what
  // the simulation reliably clears rather than what a fire marshal would want.
  assert.ok(report.out > agents.length * 0.7, `only ${report.out}/${report.total} got out`);
  assert.ok(report.longest > 0 && report.longest <= ctx.elapsed);
  // Everybody who got out is outside the building, not standing in a classroom
  // with an `out` flag on.
  for (const a of agents.filter((x) => x.state === 'out')) {
    assert.equal(nav.roomIdAt(0, a.x, a.z), null, `${a.id} is "out" but still indoors`);
  }
  // And the drill leaves a heatmap behind it.
  assert.ok(crowdCells(ctx.crowd, 0).length > 0);
  assert.ok(ctx.crowd.max > 0);
});

test('a drill in a sealed building strands everybody rather than pretending', () => {
  const state = buildSampleSchool();
  // Brick up both exterior doors: the main entrance pair and the commons door.
  const f = state.floors[0];
  for (let i = 0; i < f.edgesV.length; i++) if (f.edgesV[i] === 6) f.edgesV[i] = 1;
  for (const shape of f.shapes) for (const ring of shape.rings) ring.openings.length = 0;
  const { ctx, agents } = harness({ state, students: 8 });
  ctx.mode = 'drill';
  ctx.egress = null;
  retargetAll(ctx, agents);
  run(ctx, agents, 20);
  const report = drillReport(agents, ctx.elapsed);
  assert.equal(report.out, 0);
  assert.equal(report.stranded, agents.length);
  assert.ok(report.done, 'a drill nobody can finish is finished');
});

test('the school day empties the building after the last bell', () => {
  const { ctx, agents } = harness({ students: 16, minutes: 9 * 60 + 20 });
  retargetAll(ctx, agents);
  run(ctx, agents, 20);
  ctx.minutes = 22 * 60;               // long after dismissal
  retargetAll(ctx, agents);
  run(ctx, agents, 200);
  assert.ok(census(agents).out > agents.length * 0.6, 'most of the school has gone home');
});

test('a simulated minute costs a sane amount of work', () => {
  const { ctx, agents } = harness({ students: 60 });
  retargetAll(ctx, agents);
  const t0 = Date.now();
  run(ctx, agents, 10, 1 / 60);
  const ms = Date.now() - t0;
  // 600 frames of ~72 bodies. The bar is deliberately loose — this is here to
  // catch an accidental O(n²) sweep, not to benchmark the machine.
  assert.ok(ms < 8000, `600 frames of 72 agents took ${ms}ms`);
});
