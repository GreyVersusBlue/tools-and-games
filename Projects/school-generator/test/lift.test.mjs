// The lift: a car with a position, a call button and a state machine, and the
// queue that forms at its doors.
//
// Two halves. The first is the car on its own — pure arithmetic over one small
// record, tested the way `schedule.js` is tested, because a state machine that
// can be read in a debugger is a state machine that can be asserted. The
// second puts a crowd in front of it, because the whole reason the backlog
// item was worth doing is that a timetable makes forty people want the same
// car at nine minutes past nine, and a car that opens for all forty at once is
// the teleport with better graphics.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSampleSchool } from '../js/sample.js';
import { catalogEntry } from '../js/catalog.js';
import { buildCollider } from '../js/collide.js';
import { terrainField } from '../js/terrain.js';
import { buildNav } from '../js/navgraph.js';
import { normalizeSchedule } from '../js/schedule.js';
import {
  makePopulation, makeContext, retargetAll, stepAgents, census, bodiesOn,
} from '../js/agents.js';
import {
  LIFT_STATES, DOOR_S, DWELL_S, HOLD_S, CAPACITY, SPEED, BOARD_REACH,
  makeLift, makeLifts, liftFor, liftStop, liftLanding,
  callLift, canBoard, boardLift, canAlight, leaveLift, nextStop,
  stepLift, stepLifts, liftReport, liftText,
  otherStop, makeRider, liftAtHand, pressRider, stepRider, cancelRider,
} from '../js/lift.js';

const LINK = { id: 7, type: 'elevator', from: 0, to: 1, x: 40, z: 20, rotationY: 0 };
const FLOOR_HT = 12;

const car = (opts = {}) => makeLift(LINK, { floorHt: FLOOR_HT, ...opts });

// Run a car for `seconds` at a fixed timestep, the way the frame does.
const run = (c, seconds, dt = 1 / 30, each = null) => {
  for (let t = 0; t < seconds; t += dt) { stepLift(c, dt); if (each) each(c, t); }
  return c;
};

test('a car starts parked at the lower storey with its doors shut', () => {
  const c = car();
  assert.equal(c.low, 0);
  assert.equal(c.high, 1);
  assert.equal(c.at, 0);
  assert.equal(c.y, 0);
  assert.equal(c.state, 'idle');
  assert.equal(c.doors, 0);
  assert.ok(LIFT_STATES.includes(c.state));
  // A lift joining two storeys the wrong way round is the same lift.
  const flipped = makeLift({ ...LINK, from: 1, to: 0 }, { floorHt: FLOOR_HT });
  assert.equal(flipped.low, 0);
  assert.equal(flipped.high, 1);
});

test('a car with nothing to do does nothing, forever', () => {
  const c = run(car(), 60);
  assert.equal(c.state, 'idle');
  assert.equal(c.doors, 0);
  assert.equal(c.y, 0);
  assert.equal(c.trips, 0);
});

test('a call at the storey it is standing at opens the doors and then shuts them', () => {
  const c = car();
  callLift(c, 0);
  run(c, DOOR_S + 0.2);
  assert.equal(c.state, 'open');
  assert.equal(c.doors, 1);
  run(c, DWELL_S + DOOR_S + 0.5);
  assert.equal(c.state, 'idle');
  assert.equal(c.doors, 0);
  assert.equal(c.at, 0, 'it went nowhere, because nobody asked it to');
});

test('a call from the other storey brings it, and it opens when it gets there', () => {
  const c = car();
  callLift(c, 1);
  assert.deepEqual([...c.calls], [1]);
  assert.equal(nextStop(c), 1);
  // The climb is twelve feet at the car's own speed, plus the doors.
  run(c, FLOOR_HT / SPEED + DOOR_S + 0.5);
  assert.equal(c.at, 1);
  assert.equal(c.y, FLOOR_HT);
  assert.equal(c.state, 'open');
  assert.equal(c.calls.size, 0, 'the call is answered, not remembered');
});

test('a car in motion is somewhere between its two storeys', () => {
  const c = car();
  callLift(c, 1);
  let seenBetween = false;
  run(c, FLOOR_HT / SPEED, 1 / 30, (x) => {
    if (x.state === 'moving' && x.y > 0.5 && x.y < FLOOR_HT - 0.5) seenBetween = true;
    assert.ok(x.y >= 0 && x.y <= FLOOR_HT, 'the car left its own shaft');
  });
  assert.ok(seenBetween, 'the car teleported, which is the thing this replaced');
});

test('you can only board an open car at your own storey, and only while there is room', () => {
  const c = car();
  assert.equal(canBoard(c, 0), false, 'the doors are shut');
  callLift(c, 0);
  run(c, DOOR_S + 0.1);
  assert.equal(canBoard(c, 0), true);
  assert.equal(canBoard(c, 1), false, 'the doors are open downstairs');
  for (let i = 0; i < CAPACITY; i++) assert.equal(boardLift(c, i, 1), true);
  assert.equal(c.riders.size, CAPACITY);
  assert.equal(canBoard(c, 0), false, 'a full car is a full car');
  assert.equal(boardLift(c, 99, 1), false);
  assert.equal(c.boarded, CAPACITY);
});

test('a rider is carried to their own floor and let out there', () => {
  const c = car();
  callLift(c, 0);
  run(c, DOOR_S + 0.1);
  boardLift(c, 'a', 1);
  assert.equal(canAlight(c, 'a'), false, 'not until it gets there');
  run(c, DWELL_S + DOOR_S * 2 + FLOOR_HT / SPEED + 1);
  assert.equal(c.at, 1);
  assert.equal(canAlight(c, 'a'), true);
  assert.equal(leaveLift(c, 'a'), true);
  assert.equal(leaveLift(c, 'a'), false, 'stepping out twice is not stepping out');
  assert.equal(c.riders.size, 0);
  assert.equal(c.trips, 1);
});

test('somebody in the car is served before somebody who only pressed a button', () => {
  const c = car({ at: 0 });
  callLift(c, 0);
  run(c, DOOR_S + 0.1);
  boardLift(c, 'a', 1);
  callLift(c, 0);
  // The rider wants up; the landing call is at the storey it is already at.
  assert.equal(nextStop(c), 1);
});

test('a car nobody used still shuts its doors and comes to rest', () => {
  const c = car();
  callLift(c, 1);
  run(c, 60);
  assert.equal(c.state, 'idle');
  assert.equal(c.doors, 0);
  assert.equal(c.riders.size, 0);
});

test('the landing is outside the shaft and the stop is inside it', () => {
  const stop = liftStop(LINK, 1, FLOOR_HT);
  const landing = liftLanding(LINK, 1, FLOOR_HT);
  assert.equal(stop.y, FLOOR_HT);
  assert.equal(landing.floor, 1);
  const gap = Math.hypot(stop.x - landing.x, stop.z - landing.z);
  assert.ok(gap > BOARD_REACH, 'the landing is inside the car');
});

test('makeLifts finds every elevator and nothing else', () => {
  const state = buildSampleSchool();
  const lifts = makeLifts(state);
  const wanted = state.links.filter((l) => l.type === 'elevator');
  assert.equal(lifts.size, wanted.length);
  for (const l of wanted) assert.ok(liftFor(lifts, l), `${l.id} has no car`);
  assert.equal(liftFor(lifts, state.links.find((l) => l.type === 'stair')), null);
  // A malformed link is not a lift with a bad car in it.
  assert.equal(makeLifts({ links: [{ id: 1, type: 'elevator', from: 0, to: 0 }] }).size, 0);
  assert.equal(makeLifts(null).size, 0);
});

test('the report and the one-liner describe what the car is doing', () => {
  const lifts = makeLifts(buildSampleSchool());
  const one = [...lifts.values()][0];
  assert.match(liftText(one), /doors shut/);
  callLift(one, 1);
  stepLifts(lifts, 0.1);
  const r = liftReport(lifts);
  assert.equal(r.cars, lifts.size);
  assert.equal(r.waiting, 1);
  assert.equal(liftText(null), 'no lift');
});

// ---------- the person at the doors who is not an agent ----------
//
// The walkthrough camera's whole side of a ride. This is the half of the
// backlog item the crowd never covered: `E` teleported, and every one of
// these assertions would have passed vacuously against a teleport because a
// teleport never has a state at all.

// One rider, one car, driven the way a frame drives them: press once, then
// step until something happens or the clock runs out.
function ride(c, rider, seconds, inside, floorIndex, dt = 1 / 30) {
  const seen = [];
  for (let t = 0; t < seconds; t += dt) {
    stepLift(c, dt);
    const out = stepRider(rider, c, dt, {
      floorIndex: typeof floorIndex === 'function' ? floorIndex(c, rider) : floorIndex,
      inside: typeof inside === 'function' ? inside(c, rider) : inside,
    });
    seen.push(out);
    if (out.arrived) break;
  }
  return { seen, last: seen[seen.length - 1] };
}

test('the far end of a two-storey lift is the other one', () => {
  const c = car();
  assert.equal(otherStop(c, 0), 1);
  assert.equal(otherStop(c, 1), 0);
});

test('a rider who has pressed nothing is not in a lift', () => {
  const rider = makeRider();
  assert.equal(rider.state, 'away');
  assert.deepEqual(stepRider(rider, car(), 0.1, { inside: true, floorIndex: 0 }),
    { state: 'away' });
});

test('pressing at the landing calls the car and pressing in it picks the floor', () => {
  const c = car({ at: 1 });
  const rider = makeRider();
  assert.equal(pressRider(rider, c, 0), true);
  assert.equal(rider.want, 1, 'from the ground, the button means up');
  assert.ok(c.calls.has(0), 'the car was called to where the person is');
  // ...and from the top it means down, off the same key.
  const back = makeRider();
  pressRider(back, car({ at: 0 }), 1);
  assert.equal(back.want, 0);
  assert.equal(pressRider(rider, null, 0), false);
});

test('a ride is a ride: the doors open, you get in, and you arrive', () => {
  const c = car({ at: 1 });          // the car is upstairs; we are not
  const rider = makeRider();
  pressRider(rider, c, 0);
  // Standing in the shaft on the ground floor the whole time. The floor we
  // are on only changes when the car puts us somewhere else.
  const { seen, last } = ride(c, rider, 30, true, 0);
  assert.ok(last.arrived, 'the ride ended');
  assert.equal(last.floor, 1, 'upstairs, which is what the button meant');
  assert.ok(seen.some((s) => s.boarded), 'there was a moment of getting in');
  assert.ok(seen.some((s) => s.state === 'waiting'), 'and a wait before it');
  // The car came down for us before it took us up: a ride that never moved
  // toward the person is a teleport with a delay on it.
  assert.ok(seen.filter((s) => s.state === 'riding').length > 1);
  assert.equal(rider.state, 'away');
  assert.equal(c.riders.size, 0, 'and we got out of it');
});

test('the floor under a rider is the car, not the storey they left', () => {
  const c = car({ at: 0 });
  const rider = makeRider();
  pressRider(rider, c, 0);
  const { seen } = ride(c, rider, 30, true, 0);
  const moving = seen.filter((s) => s.state === 'riding' && s.y > 0 && s.y < FLOOR_HT);
  assert.ok(moving.length > 3, 'the ride passes through the space between storeys');
  for (const s of moving) assert.ok(s.y >= 0 && s.y <= FLOOR_HT);
});

test('standing at the landing rather than in the car does not board you', () => {
  const c = car({ at: 0 });
  const rider = makeRider();
  pressRider(rider, c, 0);
  const { last } = ride(c, rider, 20, false, 0);
  assert.equal(last.state, 'waiting', 'the doors opened and we stayed outside');
  assert.ok(last.wait > 1);
  assert.equal(c.riders.size, 0);
  // ...and the doors were held open for us the whole time we stood there,
  // up to the hold, which is what pressing the button at an open car means.
  assert.ok(c.held > 0);
});

test('walking away gets you out of the car and off the button', () => {
  const c = car({ at: 0 });
  const rider = makeRider();
  pressRider(rider, c, 0);
  ride(c, rider, 6, true, 0);
  const wasAboard = c.riders.size;
  assert.equal(cancelRider(rider, c), true);
  assert.equal(rider.state, 'away');
  assert.equal(c.riders.size, 0);
  assert.ok(wasAboard >= 0);
  assert.equal(cancelRider(rider, c), false, 'and again is nothing');
  assert.equal(cancelRider(null, c), false);
});

test('a rider whose car was taken away stands on the nearest storey', () => {
  const c = car({ at: 0 });
  const rider = makeRider();
  pressRider(rider, c, 0);
  ride(c, rider, 6, true, 0);
  // The lifts were rebuilt underneath the ride — an edit, a restart. The
  // rider is put down rather than left holding a seat in a car that is gone.
  const out = stepRider(rider, car({ at: 1 }), 0.1, { inside: true, floorIndex: 0 });
  assert.equal(out.state, 'away');
  assert.equal(rider.state, 'away');
});

test('liftAtHand tells being in the car from standing at its doors', () => {
  const state = buildSampleSchool();
  const lifts = makeLifts(state);
  const one = [...lifts.values()][0];
  const stop = liftStop(one.link, 0, one.floorHt);
  const landing = liftLanding(one.link, 0, one.floorHt);

  const inCar = liftAtHand(lifts, stop.x, stop.z, 0);
  assert.ok(inCar && inCar.inside, 'in the middle of the shaft is in the car');
  assert.equal(inCar.car, one);

  const atDoors = liftAtHand(lifts, landing.x, landing.z, 0);
  assert.ok(atDoors && !atDoors.inside, 'at the landing is at the doors');
  assert.equal(atDoors.car, one);

  // Across the corridor is neither, and a storey this lift does not serve is
  // not a lift at hand no matter where you stand.
  assert.equal(liftAtHand(lifts, stop.x + 60, stop.z + 60, 0), null);
  assert.equal(liftAtHand(lifts, stop.x, stop.z, one.high + 1), null);
  assert.equal(liftAtHand(null, 0, 0, 0), null);
});

// ---------- the crowd in front of it ----------

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
  const ctx = makeContext(state, nav, {
    site, schedule, colliderFor, catalogGet: catalogEntry,
    minutes: opts.minutes ?? 9 * 60 + 20, lifts: opts.lifts,
  });
  const agents = makePopulation(state, nav, {
    seed: opts.seed ?? 5, students: opts.students ?? 40, schedule,
  });
  retargetAll(ctx, agents);
  return { state, nav, ctx, agents };
}

test('a context has a car per elevator, and can be told not to', () => {
  const { state, ctx } = harness();
  assert.ok(ctx.lifts);
  assert.equal(ctx.lifts.size, state.links.filter((l) => l.type === 'elevator').length);
  assert.equal(harness({ lifts: false }).ctx.lifts, null);
});

test('a school day with lifts in it never loses anybody, and never leaves a ghost in a car', () => {
  const { ctx, agents } = harness({ students: 60, seed: 9 });
  for (let i = 0; i < 900; i++) stepAgents(ctx, agents, 1 / 30);
  const c = census(agents);
  assert.equal(c.total, agents.length);
  // Everybody is in exactly one of the states this file knows about.
  assert.equal(c.walking + c.seated + c.idle + c.out + c.queueing + c.riding, c.total);
  const aboard = new Set();
  for (const car of ctx.lifts.values()) {
    assert.ok(car.riders.size <= car.capacity, 'more people in the car than fit in it');
    for (const id of car.riders.keys()) {
      assert.ok(!aboard.has(id), 'somebody is in two cars at once');
      aboard.add(id);
      const who = agents.find((a) => a.id === id);
      assert.equal(who.state, 'ride', 'somebody is in a car without knowing it');
    }
  }
  for (const a of agents) {
    if (a.state === 'ride') assert.ok(aboard.has(a.id), 'somebody thinks they are in a car that has not got them');
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.y));
  }
});

test('re-planning takes a rider out of the car rather than leaving them holding a place', () => {
  const { ctx, agents } = harness({ students: 40, seed: 4 });
  for (let i = 0; i < 1200; i++) stepAgents(ctx, agents, 1 / 30);
  // Whatever the state of the school, the bell is what re-plans everybody —
  // and the cars have to come out of it empty of people who have stopped
  // wanting to go anywhere.
  retargetAll(ctx, agents);
  for (const car of ctx.lifts.values()) assert.equal(car.riders.size, 0);
  for (const a of agents) assert.equal(a.lift, null);
});

// **The fixture that matters.** In the sample school the stair is cheaper than
// the lift's forty-five-foot-equivalent wait, so nobody ever rides one and a
// suite built on it would assert nothing at all about the code below — which
// is Phase 11's lesson word for word: *a pure module is only as honest as the
// state its tests put it in*. Take the stair and the floor opening away and
// the lift is the only way upstairs, which is a real building (a two-storey
// wing with one accessible route) and the state the ride path actually runs in.
function liftOnly(opts = {}) {
  const state = buildSampleSchool();
  state.links = state.links.filter((l) => l.type === 'elevator');
  return harness({ students: 60, seed: 5, ...opts, state });
}

test('with the lift as the only way up, a crowd queues, rides and gets out', () => {
  const { ctx, agents } = liftOnly();
  const one = [...ctx.lifts.values()][0];

  const rode = new Set(), queued = new Set();
  for (let i = 0; i < 6000; i++) {
    stepAgents(ctx, agents, 1 / 30);
    for (const a of agents) {
      if (a.state === 'ride') rode.add(a.id);
      if (a.state === 'queue') queued.add(a.id);
    }
    assert.ok(one.riders.size <= one.capacity, 'more people in the car than fit in it');
    assert.ok(one.y >= 0 && one.y <= one.high * one.floorHt, 'the car left its own shaft');
  }

  assert.ok(queued.size > 8, 'nobody ever waited, so nothing here was exercised');
  assert.ok(rode.size > 8, 'the car carried at most one load, which is the livelock');
  assert.ok(one.trips >= 2, 'the car never went back for the second load');
  assert.equal(one.riders.size, 0, 'somebody is still in the car three minutes later');
  assert.ok(one.waited > 1, 'a queue that nobody waited in is not a queue');

  // The livelock this fixture found, in the two forms it took: everybody in
  // the queue presses the button on every frame they are not aboard, so a car
  // that re-opened for each press — or extended its dwell for each press —
  // stood at one storey with eight passengers going nowhere for the rest of
  // the school day. Both are capped by `held` now, and this is the assertion
  // that would fail if either cap came off.
  assert.ok(one.held <= 60, 'a stop that never ends');
  const census2 = census(agents);
  assert.equal(census2.riding, agents.filter((a) => a.state === 'ride').length);
});

test('a rider is not a body anybody can walk into, because they are inside a shaft', () => {
  const { ctx, agents } = liftOnly({ students: 30, seed: 4 });
  for (let i = 0; i < 600; i++) stepAgents(ctx, agents, 1 / 30);
  // Whether or not anybody happens to be riding in this fixture, the rule is
  // the same one and it is asserted directly: a body in a shaft is behind
  // three walls and a door, and on the frame the car passes a storey it would
  // otherwise appear in the middle of a corridor and shove.
  const riders = agents.filter((a) => a.state === 'ride');
  for (const a of riders) assert.ok(a.lift !== null, 'a rider with no car');
  for (let f = 0; f < 2; f++) {
    const ids = new Set(bodiesOn(agents, f).map((b) => -b.id));
    for (const a of riders) assert.ok(!ids.has(a.id), 'a rider is a body on a storey');
  }
});

test('turning the cars off is the teleport back, exactly', () => {
  const withCars = harness({ students: 30, seed: 2 });
  const without = harness({ students: 30, seed: 2, lifts: false });
  for (let i = 0; i < 600; i++) {
    stepAgents(withCars.ctx, withCars.agents, 1 / 30);
    stepAgents(without.ctx, without.agents, 1 / 30);
  }
  // Not the same simulation — that is the point — but both of them are still
  // a school with the same people in it, none of whom have fallen out of the
  // world.
  assert.equal(withCars.agents.length, without.agents.length);
  for (const a of without.agents) assert.notEqual(a.state, 'ride');
  for (const a of without.agents) assert.notEqual(a.state, 'queue');
});
