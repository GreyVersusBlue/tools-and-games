// lift.js — the car, the call button, and the queue at the doors.
//
// Since Phase 2 an elevator has been a teleport with doors on both ends: walk
// into the shaft, arrive upstairs, and the doors were drawn parked open
// because there was nothing for them to be waiting for. The standing backlog
// has said so ever since — *"the car teleports with E; there is no ride, no
// call button, and the doors are drawn parked open"* — and every arc deferred
// it for the same good reason, which is that nothing in the building was
// asking for a lift at a particular moment. Phase 15's timetable is what
// changes that: once a section is upstairs at ten past nine, the crush at the
// lift between second and third period is a real event with a real number of
// people in it, and a teleport stops being good enough.
//
// So a car gets three things it did not have: **a position** between the two
// storeys it serves, **a call button** that remembers which floor pressed it,
// and **a state machine** that opens, waits, closes and travels rather than
// being permanently one of those.
//
// The whole of it is one small record per link and one `stepLift` per frame,
// on purpose. A lift is a queue with a door on it, and the temptation to model
// a bank of them with a dispatcher is the temptation to write a phase's worth
// of code for a school that has one lift beside the stair tower.
//
// Pure module: no three.js, no DOM. Exercised by test/lift.test.mjs.

import { FLOOR_H } from './grid.js';
import { elevatorSize, localToWorld, worldToLocal } from './stairs.js';

// The five states a car is ever in, and nothing between them. `doors` is 0
// (shut) to 1 (fully open) and is the only continuous thing here besides the
// car's own height — everything else is a clock counting down to the next
// state, which is what keeps a lift readable at a glance in a debugger.
export const LIFT_STATES = ['idle', 'opening', 'open', 'closing', 'moving'];

export const DOOR_S = 1.5;        // s — open, and the same to close
export const DWELL_S = 4;         // s — how long the doors stand open
export const HOLD_S = 8;          // s — the longest a call can hold them open
export const SPEED = 3.5;         // ft/s — a school lift is not a lift in a tower
export const CAPACITY = 8;        // people in the car, which is the queue's whole point
export const BOARD_REACH = 1.6;   // ft — how close to the doors you have to be to step in

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Where a car stands when it is at a floor: the middle of the shaft, at that
// storey's own datum. Both storeys share the plan position — an elevator is
// the one link whose two ends are the same point seen from two heights.
export function liftStop(link, floorIndex, floorHt = FLOOR_H) {
  const p = localToWorld(link, 0, 0);
  return { x: p.x, z: p.z, floor: floorIndex, y: floorIndex * floorHt };
}

// Where you stand to wait for it: just outside the doors, on the car's local
// -Z face, which is the same face `elevatorWalls` leaves the gap in.
export function liftLanding(link, floorIndex, floorHt = FLOOR_H) {
  const { d } = elevatorSize(link);
  const p = localToWorld(link, 0, -(d / 2 + BOARD_REACH));
  return { x: p.x, z: p.z, floor: floorIndex, y: floorIndex * floorHt };
}

// One car, parked. `at` is the storey it is standing at when it is not moving
// and the storey it left when it is; `to` is where it is going.
export function makeLift(link, opts = {}) {
  const floorHt = opts.floorHt || FLOOR_H;
  const from = Math.min(link.from, link.to);
  const to = Math.max(link.from, link.to);
  const at = opts.at === undefined ? from : Math.min(to, Math.max(from, Math.round(opts.at)));
  return {
    id: link.id,
    link,
    floorHt,
    // The two storeys it serves. A lift in this model joins exactly two, which
    // is what `elevatorsOn` has always assumed and what keeps `nextStop` a
    // comparison rather than a scheduler.
    low: from,
    high: to,
    at,
    to: at,
    // Height in feet, so a renderer can put the car where it actually is
    // rather than at one of its two ends.
    y: at * floorHt,
    state: 'idle',
    doors: 0,
    // The clock counting down to the next transition, and how long this stop
    // has lasted in total. `held` is the one that stops a queue holding the
    // doors open forever.
    clock: 0,
    held: 0,
    // Who pressed what. `calls` is the landings waiting; `riders` is who is in
    // the car and which storey each of them asked for.
    calls: new Set(),
    riders: new Map(),
    capacity: opts.capacity ?? CAPACITY,
    speed: opts.speed ?? SPEED,
    // Counted rather than derived: the report says nothing about lifts, and
    // "the car made forty-one trips between second and third period" is the
    // sort of thing a person watching a passing period wants to be told.
    trips: 0,
    boarded: 0,
    // The longest anybody has stood at a landing, in seconds, and who.
    waited: 0,
  };
}

// Every lift in a design, by link id. Built once at walk-start beside the
// colliders, and torn down with them: a car halfway between two storeys of a
// building that has just been re-drawn is a car in a shaft that may not exist.
export function makeLifts(state, opts = {}) {
  const out = new Map();
  for (const link of (state && state.links) || []) {
    if (!link || link.type !== 'elevator') continue;
    if (!Number.isFinite(link.from) || !Number.isFinite(link.to) || link.from === link.to) continue;
    out.set(link.id, makeLift(link, { floorHt: state.floorHt || FLOOR_H, ...opts }));
  }
  return out;
}

export const liftFor = (lifts, link) =>
  (lifts && link ? lifts.get(link.id) || null : null);

// ---------- the buttons ----------

// Press the call button at a landing. Idempotent, because forty people press
// it and one of them presses it eleven times.
export function callLift(car, floorIndex) {
  if (!car) return false;
  const f = Math.min(car.high, Math.max(car.low, Math.round(floorIndex)));
  // Already standing here with its doors open is a lift that does not need
  // calling — and holding the doors is what pressing the button then means.
  //
  // **Only while there is room and only up to the hold.** Everybody in the
  // queue presses on every frame they are not on board, so a full car whose
  // dwell is extended by each of them stands there with its doors open and its
  // eight passengers going nowhere for the rest of the day. That is the second
  // half of the same livelock `closing` guards against, and a fixture with a
  // lift as the only way upstairs found both halves of it in one run.
  if (car.at === f && (car.state === 'open' || car.state === 'opening')) {
    if (car.riders.size < car.capacity && car.held < HOLD_S) {
      car.clock = Math.max(car.clock, DWELL_S * 0.5);
    }
    return true;
  }
  car.calls.add(f);
  return true;
}

// Can this person get in? The doors have to be open at their storey and the
// car has to have room — which is the whole of what makes a queue a queue
// rather than a crowd walking through a wall.
export const canBoard = (car, floorIndex) =>
  !!car && car.state === 'open' && car.at === floorIndex && car.riders.size < car.capacity;

export function boardLift(car, riderId, toFloor) {
  if (!canBoard(car, car.at)) return false;
  const f = Math.min(car.high, Math.max(car.low, Math.round(toFloor)));
  car.riders.set(riderId, f);
  car.boarded++;
  // A car somebody has just stepped into holds its doors a moment longer, up
  // to `HOLD_S`. Without the cap a busy lift never leaves.
  car.clock = Math.min(HOLD_S, Math.max(car.clock, DOOR_S));
  if (f !== car.at) car.calls.add(f);
  return true;
}

// Step out. Returns true when this rider was actually in the car — a caller
// that has lost track of somebody gets an answer rather than an exception.
export function leaveLift(car, riderId) {
  if (!car || !car.riders.has(riderId)) return false;
  car.riders.delete(riderId);
  return true;
}

// Is this rider's floor the one the doors are open at?
export const canAlight = (car, riderId) =>
  !!car && car.state === 'open' && car.riders.get(riderId) === car.at;

// ---------- one person's side of it ----------
//
// agents.js has a rider braided into its steering — press, wait, board,
// alight — because somebody on a route is always in the middle of one, and
// every one of those four moments has a waypoint attached to it. The
// walkthrough camera is not on a route. It knows two things: a key was
// pressed, and where the body is standing. Same four moments, none of the
// steering, and it lives here rather than in walkthrough.js for the reason
// every pure module in this codebase does — walkthrough.js cannot be tested
// and this can.
//
// It is deliberately *not* shared with agents.js. The two riders want
// different things from the same car: an agent has a floor it was routed to
// and a body that has to keep being resolved against a crowd while it waits,
// and a camera has neither. Folding them together would mean one function
// with a steering branch in it, which is the shape this file was written to
// avoid.

// The far end. A lift in this model joins exactly two storeys, which is what
// makes "press the button" an unambiguous instruction rather than a panel.
export const otherStop = (car, from) => (from === car.high ? car.low : car.high);

export const RIDER = 'walker';

export function makeRider(id = RIDER) {
  return { id, car: null, want: null, state: 'away', wait: 0 };
}

// Which car is at hand, and whether the body is in it. Two answers rather
// than one because they mean different things to a person: inside the shaft
// you are in the car, outside it you are at the landing, and pressing the
// button means the same thing from either — it is *boarding* that needs you
// to be in there.
export function liftAtHand(lifts, x, z, floorIndex, opts = {}) {
  if (!lifts) return null;
  const inset = opts.inset ?? 0.4;
  const reach = opts.reach ?? BOARD_REACH * 2.5;
  let landing = null;
  for (const car of lifts.values()) {
    if (floorIndex < car.low || floorIndex > car.high) continue;
    const { w, d } = elevatorSize(car.link);
    const { lx, lz } = worldToLocal(car.link, x, z);
    if (Math.abs(lx) <= w / 2 - inset && Math.abs(lz) <= d / 2 - inset) {
      return { car, inside: true };
    }
    // Not in it — but standing at the doors is close enough to press the
    // button, which is the whole difference between this and Phase 2's
    // point-in-box test. Nearest landing wins, so two shafts side by side
    // answer with the one you are actually facing.
    const at = liftLanding(car.link, floorIndex, car.floorHt);
    const dist = Math.hypot(at.x - x, at.z - z);
    if (dist <= reach && (!landing || dist < landing.dist)) landing = { car, inside: false, dist };
  }
  return landing;
}

// The button. Outside a car it calls it; inside one standing open it is the
// floor button, and the floor is the other one. Idempotent, because a person
// waiting for a lift presses it more than once.
export function pressRider(rider, car, floorIndex) {
  if (!rider || !car) return false;
  // Already aboard and already going somewhere: pressing again is somebody
  // jabbing at a panel, which a lift is entitled to ignore.
  if (car.riders.has(rider.id)) return true;
  rider.car = car.id;
  rider.want = otherStop(car, floorIndex);
  rider.state = 'waiting';
  rider.wait = 0;
  callLift(car, floorIndex);
  return true;
}

// One rider, one tick. `inside` is whether the body is in the car's footprint
// — the caller's business, because only the caller knows where the body is.
// Answers what the caller has to do about it and nothing else: `y` is where
// the floor under this person is, and `state` is whether they are being
// carried by it.
export function stepRider(rider, car, dt, opts = {}) {
  if (!rider || rider.state === 'away') return { state: 'away' };
  if (!car || rider.car !== car.id) { resetRider(rider); return { state: 'away' }; }
  const floorIndex = opts.floorIndex ?? car.at;
  const step = Math.max(0, Math.min(dt, 0.25));

  if (rider.state === 'riding') {
    // The car forgot us — the only way this happens is a caller that reset
    // the lifts underneath a ride, and the honest answer is to stand on the
    // storey the car is nearest rather than to keep claiming a seat in it.
    if (!car.riders.has(rider.id)) {
      resetRider(rider);
      return { state: 'away', arrived: true, floor: car.floorIndex ?? car.at };
    }
    if (canAlight(car, rider.id)) {
      leaveLift(car, rider.id);
      resetRider(rider);
      return { state: 'away', arrived: true, floor: car.at, y: car.at * car.floorHt };
    }
    return { state: 'riding', y: car.y, floor: car.floorIndex ?? car.at };
  }

  // Waiting. Keep pressing — everybody at a landing does, the hold in
  // `callLift` is what stops that becoming a livelock, and it is what makes
  // the doors wait for you while you walk the last two feet.
  rider.wait += step;
  callLift(car, floorIndex);
  if (opts.inside && canBoard(car, floorIndex) && boardLift(car, rider.id, rider.want)) {
    rider.state = 'riding';
    return { state: 'riding', y: car.y, boarded: true, floor: car.at };
  }
  return { state: 'waiting', wait: rider.wait };
}

// Walked away, or the walk ended. Gets out of the car if it was in one, so
// the seat it was holding goes back to the queue.
export function cancelRider(rider, car) {
  if (!rider) return false;
  const was = rider.state !== 'away';
  if (car && car.riders.has(rider.id)) leaveLift(car, rider.id);
  resetRider(rider);
  return was;
}

function resetRider(rider) {
  rider.car = null;
  rider.want = null;
  rider.state = 'away';
  rider.wait = 0;
}

// ---------- where it is going next ----------

// The next storey worth travelling to: a rider's destination first, because
// somebody already in the car has waited longer than somebody who has only
// pressed a button, and a landing call after that. Null when there is nothing
// to do, which is the only way a car ever comes to rest.
export function nextStop(car) {
  for (const want of car.riders.values()) if (want !== car.at) return want;
  for (const f of car.calls) if (f !== car.at) return f;
  return null;
}

// ---------- the frame ----------

// One car, one tick. The states run in a ring — idle → opening → open →
// closing → moving → opening — and every transition is either a clock running
// out or a question about who is waiting, which is why this is a switch rather
// than a graph.
export function stepLift(car, dt) {
  if (!car) return car;
  const step = Math.max(0, Math.min(dt, 0.25));
  car.clock = Math.max(0, car.clock - step);

  switch (car.state) {
    case 'idle': {
      // A call at this storey opens the doors where the car already is; a call
      // anywhere else is a journey, and a journey starts with the doors shut.
      if (car.calls.has(car.at) || car.riders.size) {
        car.calls.delete(car.at);
        car.state = 'opening';
        break;
      }
      const next = nextStop(car);
      if (next !== null) { car.to = next; car.state = 'moving'; }
      break;
    }
    case 'opening': {
      car.doors = clamp01(car.doors + step / DOOR_S);
      if (car.doors >= 1) { car.state = 'open'; car.clock = DWELL_S; }
      break;
    }
    case 'open': {
      car.calls.delete(car.at);
      // How long this stop has lasted, across every re-open of it. The cap it
      // feeds is the whole reason a lift with a queue in front of it ever
      // leaves — see `closing`.
      car.held += step;
      // The doors stand open for their dwell and then shut, whether or not
      // anybody used them. A lift that waits for an empty landing forever is
      // the bug every naive version of this has.
      if (car.clock <= 0) car.state = 'closing';
      break;
    }
    case 'closing': {
      // Somebody at the doors re-opens them — same button, same hold, and the
      // reason a queue drains in ones and twos rather than all at once.
      //
      // **With a cap on it, and the cap is load-bearing.** Everybody still
      // waiting presses the button on every frame they are not on board, so a
      // car that re-opens for every press at the storey it is standing at
      // never departs: the first eight people get in, the ninth holds the
      // doors, and the eight inside ride nowhere for the rest of the school
      // day. This is exactly the livelock a fixture with a lift as the only
      // way upstairs found, and `held` is what breaks it.
      const wanted = car.calls.has(car.at);
      if (wanted && car.riders.size < car.capacity && car.held < HOLD_S) {
        car.state = 'opening';
        break;
      }
      car.doors = clamp01(car.doors - step / DOOR_S);
      if (car.doors <= 0) {
        car.doors = 0;
        const next = nextStop(car);
        if (next === null) { car.state = 'idle'; car.held = 0; }
        else { car.to = next; car.state = 'moving'; car.trips++; car.held = 0; }
      }
      break;
    }
    case 'moving': {
      const target = car.to * car.floorHt;
      const dir = Math.sign(target - car.y);
      car.y += dir * car.speed * step;
      if (dir === 0 || (dir > 0 ? car.y >= target : car.y <= target)) {
        car.y = target;
        car.at = car.to;
        car.held = 0;
        car.state = 'opening';
      }
      break;
    }
    default:
      car.state = 'idle';
      break;
  }
  // Which storey the car is *on* for anything that has to draw it or resolve
  // a body against it: the one it is standing at, or the one it is nearest to
  // while it travels.
  car.floorIndex = car.state === 'moving'
    ? Math.round(car.y / car.floorHt)
    : car.at;
  return car;
}

export function stepLifts(lifts, dt) {
  if (!lifts) return lifts;
  for (const car of lifts.values()) stepLift(car, dt);
  return lifts;
}

// ---------- what a panel says about it ----------

export function liftReport(lifts) {
  const out = { cars: 0, riding: 0, waiting: 0, trips: 0, boarded: 0, busiest: null };
  if (!lifts) return out;
  for (const car of lifts.values()) {
    out.cars++;
    out.riding += car.riders.size;
    out.waiting += car.calls.size;
    out.trips += car.trips;
    out.boarded += car.boarded;
    if (!out.busiest || car.boarded > out.busiest.boarded) out.busiest = car;
  }
  return out;
}

export const liftText = (car) => {
  if (!car) return 'no lift';
  const where = car.state === 'moving'
    ? `between ${car.low + 1} and ${car.high + 1}`
    : `at level ${car.at + 1}`;
  const doors = car.state === 'open' ? 'doors open'
    : car.state === 'opening' ? 'opening'
      : car.state === 'closing' ? 'closing' : 'doors shut';
  return `${where}, ${doors}, ${car.riders.size} aboard`;
};
