// Signal City: the drivers. Pure: no DOM, no Math.random (the world's rng is
// handed in). One archetype table, one Car class, and the per-tick decision
// that turns "what is ahead of me and what does my light say" into an
// acceleration. The world (js/sim.js) owns the loop and the collision test;
// this file owns the judgement.
//
// The following model is IDM (Treiber's intelligent driver model):
//   a = amax * (1 - (v/v0)^4 - (s*/gap)^2)
//   s* = s0 + v*T + v*dv / (2*sqrt(amax*b))
// with the obstacle being whichever of (the car ahead, the stop line, the
// box entry, my own special stop) bites hardest. Reaction delay is real: a
// driver acts on the verdicts and the leader position from `reaction`
// seconds ago, read out of ring buffers, so a following car really does
// close up before it notices a stop. That is where chain collisions come
// from, and why aggressive tailgaters cause them.

export const ARCHETYPES = {
  //           accel brake bComf vmax  turnV  T    s0   react runRed patience yellowBias len   wid   greenTrust
  standard:  { accel: 2.6, brake: 4.5, bComf: 2.6, vmax: 14, turnV: 6.0, T: 1.5, s0: 2.0, reaction: 0.6, runRed: 0.02, patience: 45, yellowBias: 1.0, length: 4.6, width: 1.8, greenTrust: 0.15 },
  granny:    { accel: 1.4, brake: 4.8, bComf: 1.8, vmax: 10, turnV: 4.0, T: 2.2, s0: 3.0, reaction: 0.9, runRed: 0.00, patience: 150, yellowBias: 1.7, length: 5.8, width: 1.9, greenTrust: 0.0, cautious: 0.5 },
  aggressive:{ accel: 3.8, brake: 6.5, bComf: 4.5, vmax: 17, turnV: 8.0, T: 0.7, s0: 1.2, reaction: 0.4, runRed: 0.08, patience: 15, yellowBias: 0.35, length: 5.0, width: 2.2, greenTrust: 0.6 },
  tourist:   { accel: 2.4, brake: 4.5, bComf: 2.6, vmax: 13, turnV: 5.0, T: 1.6, s0: 2.2, reaction: 0.7, runRed: 0.02, patience: 50, yellowBias: 1.1, length: 5.0, width: 2.0, greenTrust: 0.25, hesitate: 0.35, hesitateFor: 1.6, wrongTurn: 0.15 },
  trucker:   { accel: 1.0, brake: 2.8, bComf: 1.5, vmax: 12, turnV: 3.5, T: 2.0, s0: 4.0, reaction: 1.2, runRed: 0.01, patience: 70, yellowBias: 1.2, length: 2.6, width: 2.4, greenTrust: 0.05, trailer: { length: 9.0, width: 2.5, gap: 0.3 }, wide: true },
  student:   { accel: 1.8, brake: 3.8, bComf: 2.2, vmax: 11, turnV: 4.5, T: 2.0, s0: 2.5, reaction: 1.1, runRed: 0.00, patience: 55, yellowBias: 1.3, length: 3.8, width: 1.7, greenTrust: 0.05, jitter: 1.5, jerky: 0.45 },
  rideshare: { accel: 2.6, brake: 4.5, bComf: 2.6, vmax: 14, turnV: 6.0, T: 1.4, s0: 2.0, reaction: 0.6, runRed: 0.02, patience: 30, yellowBias: 1.0, length: 4.4, width: 1.7, greenTrust: 0.2, pickup: 0.012, pickupFor: 4.0 },
  emergency: { accel: 3.6, brake: 6.5, bComf: 4.0, vmax: 20, turnV: 8.0, T: 1.0, s0: 2.0, reaction: 0.4, runRed: 1.00, patience: 0, yellowBias: 0.0, length: 5.6, width: 2.2, greenTrust: 0.0, ignoresSignals: true },
};

// Green trust, the fault the all-red clearance exists for. Once per
// approach, a driver whose green is on its way (the other street's yellow or
// the all-red is running, Controller.timeToGreen is finite) or has just come
// (within TRUST_WINDOW seconds of it, at the line) rolls `greenTrust`. A
// trusting driver anticipates: on the red they do not slow for a line they
// will reach as it turns green, and on the green they look at the light, not
// the box, so a car still crossing (a yellow puncher finishing, a red runner)
// is not waited for and not braked for until it is a stationary body on their
// line. With 1 s of all-red a main-street through that punched the yellow at
// 17 m/s is still crossing the stem's left path when the anticipating stem
// driver arrives on the green; with 2 s it has cleared (test/sim.mjs scripts
// it and measures the rate over seeds).
export const TRUST_WINDOW = 1.0;

export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES);

export const DT = 1 / 60;
const HIST = 90;               // ring buffer depth: 1.5 s at 60 Hz, past any reaction

let nextId = 1;
export function resetIds() { nextId = 1; }

export class Car {
  constructor({ archetype, variant = 0, path, rng, id = nextId++, spawnedAt = 0 }) {
    const st = ARCHETYPES[archetype];
    if (!st) throw new Error(`unknown archetype ${archetype}`);
    this.id = id;
    this.archetype = archetype;
    this.stats = st;
    this.variant = variant;
    this.path = path;
    this.s = 0;                 // arc length of the body's centre along path
    this.v = 0;
    this.a = 0;
    this.length = st.length + (st.trailer ? st.trailer.length + st.trailer.gap : 0);
    this.width = st.width;
    this.spawnedAt = spawnedAt;
    this.wait = 0;              // seconds stopped by traffic or a light
    this.stallT = 0;            // seconds sitting still inside the box, this stop
    this.patience = st.patience;
    this.honked = 0;            // honks so far
    this.honkCooldown = 0;
    this.crashed = false;
    this.crashedAt = 0;
    this.done = false;
    // per-approach decisions
    this.yellowDecision = null; // 'stop' | 'go', decided once when yellow first seen
    this.redRollDone = false;
    this.committed = st.ignoresSignals === true;   // through the next box, whatever the light
    this.cautiousDone = false; this.cautiousStop = false;
    this.wrongTurnDone = false;
    this.stoppedAtLine = false; // flash-red: have I actually stopped at the line
    this.stoppedAt = -1;        // world time I stopped at a flashing or dark head, for first come first served
    this.trustRolled = false; this.trusting = false; // fresh-green trust, once per green
    this.stopJitter = st.jitter ? rng.range(-st.jitter, st.jitter) : 0;
    this.jerk = 1; this.jerkT = 0;
    // special stops (tourist hesitation, rideshare pickup, granny caution)
    this.specialUntil = -1; this.specialS = 0; this.specialKind = null;
    this.hesitateRolled = false;
    // ring buffers of (s, v) and of the two verdicts, for reaction delay
    this.hist = new Array(HIST).fill(null).map(() => ({ s: 0, v: 0, stop: 0, box: 0 }));
    this.histI = 0;
    this.stopVerdict = 0;       // 0 free, else the s the front must stop before
    this.boxVerdict = 0;        // 0 free, else the s the front waits at
    this.blockedBy = 0;         // the car the last box verdict waited for
    this.priority = false;      // emergency: player has called the corridor
    this.rng = rng;
  }

  get front() { return this.s + this.stats.length / 2; }
  get rear() { return this.s - this.length + this.stats.length / 2; }
  get movement() { return this.path.movement; }
  get inSpecialStop() { return this.specialKind !== null; }
  get isWaiting() { return !this.crashed && !this.done && this.v < 0.5 && !this.inSpecialStop; }

  touchesBox() { return this.path.touchesBox(this.s, this.length); }
  inBox() { return this.front > this.path.boxEnter && this.rear < this.path.boxExit; }

  // Rectangles for drawing and collision: the body, plus the trailer trailing
  // along the same path.
  rects() {
    const st = this.stats;
    const body = this.path.at(this.s);
    const out = [{ x: body.x, y: body.y, heading: body.heading, length: st.length, width: st.width, part: 'body' }];
    if (st.trailer) {
      const back = this.s - st.length / 2 - st.trailer.gap - st.trailer.length / 2;
      const t = this.path.at(back);
      out.push({ x: t.x, y: t.y, heading: t.heading, length: st.trailer.length, width: st.trailer.width, part: 'trailer' });
    }
    return out;
  }

  // The (s, v, verdicts) this driver believes, `reaction` seconds late.
  perceived() {
    const back = Math.min(HIST - 1, Math.round(this.stats.reaction / DT));
    return this.hist[(this.histI - back + HIST) % HIST];
  }

  record() {
    const h = this.hist[this.histI];
    h.s = this.s; h.v = this.v; h.stop = this.stopVerdict; h.box = this.boxVerdict;
    this.histI = (this.histI + 1) % HIST;
  }

  // Reset the once-per-approach decisions: the world calls this as a car
  // leaves one box for the next (a corridor's handoff, sim.js).
  newApproach() {
    this.yellowDecision = null; this.redRollDone = false; this.cautiousDone = false; this.cautiousStop = false;
    this.wrongTurnDone = false; this.stoppedAtLine = false; this.stoppedAt = -1; this.hesitateRolled = false;
    this.trustRolled = false; this.trusting = false;
    this.committed = this.stats.ignoresSignals === true;
  }
}

// ---- the decision -----------------------------------------------------------

function idm(st, v, v0, gap, dv) {
  const free = st.accel * (1 - Math.pow(Math.max(0, v) / Math.max(0.1, v0), 4));
  if (gap === Infinity) return free;
  const sStar = st.s0 + Math.max(0, v * st.T + (v * dv) / (2 * Math.sqrt(st.accel * st.brake)));
  const g = Math.max(0.05, gap);
  return free - st.accel * (sStar / g) * (sStar / g);
}

// Decide the stop-line verdict from the head the driver sees. Returns the s
// the FRONT bumper must not pass, or 0 for free.
export function stopLineVerdict(car, head, timeToYellow, world) {
  const st = car.stats, p = car.path;
  const line = p.stopLine + car.stopJitter;
  const d = line - car.front;
  if (car.committed) return 0;
  if (car.front > p.stopLine + 0.5) return 0;   // past the line: committed by position
  const rollTrust = () => {
    car.trustRolled = true;
    const chance = (st.greenTrust || 0) * (world.greenTrustScale ?? 1);
    if (chance > 0 && car.rng.chance(chance)) { car.trusting = true; world.events.push({ t: world.t, kind: 'trust', car: car.id }); }
  };
  switch (head) {
    case 'green': case 'green-arrow': {
      // a fresh green clears last cycle's decisions
      car.yellowDecision = null; car.redRollDone = false; car.stoppedAtLine = false; car.stoppedAt = -1;
      // and is trusted, once, by a driver it releases within its first second
      if (!car.trustRolled && d < 30 && world.controllerFor(car).stageT < TRUST_WINDOW) rollTrust();
      // granny: a green that is about to end, and room to stop, and she stops
      if (st.cautious && !car.cautiousDone && timeToYellow < 3 && d > 8 && car.v > 2) {
        car.cautiousDone = true;
        if (car.rng.chance(st.cautious)) { car.cautiousStop = true; world.events.push({ t: world.t, kind: 'cautious', car: car.id }); }
      }
      if (car.cautiousStop && d > 0) return line;
      return 0;
    }
    case 'yellow': case 'yellow-arrow': {
      if (car.cautiousStop) return line;
      if (car.yellowDecision === null) {
        if (d <= 0) car.yellowDecision = 'go';
        else {
          const need = (car.v * car.v) / (2 * Math.max(0.1, d));
          car.yellowDecision = need <= st.bComf * st.yellowBias ? 'stop' : 'go';
        }
        if (car.yellowDecision === 'go') car.committed = true;
      }
      return car.yellowDecision === 'stop' ? line : 0;
    }
    case 'red': {
      car.cautiousStop = false;
      if (car.yellowDecision === 'go') return 0; // already committed (entered on yellow)
      if (!car.redRollDone && d < 28 && car.v > 4) {
        car.redRollDone = true;
        const p = st.runRed * (world.redRunScale ?? 1);
        if (p > 0 && car.rng.chance(p)) { car.committed = true; return 0; }
      }
      // a green on its way: the anticipator rolls once, and then does not
      // slow for a line they will reach as it turns green
      const tg = world.controllerFor(car).timeToGreen(p.movement);
      if (!Number.isFinite(tg)) { car.trustRolled = false; car.trusting = false; }
      else {
        if (!car.trustRolled && d < 80 && car.v > 4) rollTrust();
        if (car.trusting && d / Math.max(car.v, 0.5) >= tg) return 0;
      }
      return line;
    }
    case 'flash-red': case 'dark': {
      // stop at the line, then treat it as a box-entry question, in the
      // order the cars stopped (boxVerdict reads stoppedAt)
      if (!car.stoppedAtLine) {
        if (car.v < 0.3 && d < 3) { car.stoppedAtLine = true; car.stoppedAt = world.t; }
        else return line;
      }
      return 0;
    }
    case 'flash-yellow': return 0;
    default: return line;
  }
}

// Is the box safe to enter for this car right now? Returns the s the FRONT
// must wait at, or 0 for go. Conflicts come from the signal model's
// geometry; a wide turner (trucker) also blocks its own and its exit leg.
//
// A permissive left waits 4 m inside the box rather than at its edge, the
// way real drivers do, so that on the yellow it can finish the turn during
// the all-red instead of sitting through another cycle.
export function boxVerdict(car, head, world) {
  const p = car.path;
  const mine = p.movement;
  const ctl = world.controllerFor(car);
  if (car.front < p.stopLine - 30) return 0;        // too far to care
  // a walker on the crosswalk I leave by, still short of my lane or in it:
  // I hold at the box edge before the zebra. Every driver sees a person,
  // trusting or not; it is the box they stop looking at.
  if (car.front < p.boxExit + 0.2 && world.walkerBlocks(p)) { car.blockedBy = -1; return Math.max(car.front - 0.05, p.boxExit - 0.3); }
  const permissive = ctl.current.permissive.includes(mine) && (head === 'green' || head === 'yellow');
  const waitAt = permissive ? p.boxEnter + 4 : p.boxEnter;
  const inside = car.front > waitAt + 0.5;          // already in: only a committed car still gets a look
  if (inside && car.front > p.boxExit - 4) return 0;
  const uncontrolled = head === 'flash-red' || head === 'flash-yellow' || head === 'dark';
  const allWayStop = head === 'flash-red' || head === 'dark';
  const gapNeed = allWayStop ? 3.0 : permissive ? 4.0 : 1.2;
  const trusting = car.trusting && !uncontrolled && !permissive;   // a crossing is trusted through; a merge (same exit) is not
  const net = world.network;
  for (const o of world.cars) {
    if (o === car || o.done || o.path.node !== p.node) continue;
    const other = o.path.movement;
    const clash = world.conflicts(mine, other) || (car.stats.wide && car.path.turn !== 'T' && world.wideConflicts(mine, other)) || (o.stats.wide && o.path.turn !== 'T' && world.wideConflicts(other, mine));
    if (!clash) continue;
    // first come, first served at a four-way stop: a conflicting car that
    // stopped at its line before I did, and has not yet entered, goes first
    if (allWayStop && !inside && car.stoppedAtLine && o.stoppedAtLine && !o.crashed && o.front <= o.path.boxEnter + 0.5
      && (o.stoppedAt < car.stoppedAt || (o.stoppedAt === car.stoppedAt && o.id < car.id))) { car.blockedBy = o.id; return waitAt; }
    const crossing = o.path.exit !== p.exit;
    if (inside) {
      if (trusting && crossing) continue;
      if (!o.committed || o.touchesBox() || o.v < 0.5) continue;
      const x = net.crossing(car.path, o.path);
      if (car.front > x.sA) continue;                 // past where we would meet
      const eta = (o.path.boxEnter - o.front) / o.v;
      if (eta >= 0 && eta < 1.5) { car.blockedBy = o.id; return Math.max(car.front, x.sA - 3); }
      continue;
    }
    if (o.touchesBox()) {
      // past the point where our paths meet: no longer in my way. A sweep
      // (wide conflict with no geometric crossing) clears only at its box exit.
      const x = world.conflicts(mine, other) ? net.crossing(car.path, o.path) : { sB: o.path.boxExit };
      if (o.rear > x.sB + 0.5) continue;
      // stationary: obstacleAhead() catches a body actually on my line, and
      // one that is not (a permissive left waiting mid-box) is not in my way
      if (o.v < 0.5 || o.crashed) continue;
      // moving through, and not yet clear of me
      if (car.committed && !o.crashed) continue;
      // a trusting starter looked at the light, not the box
      if (trusting && crossing) continue;
      car.blockedBy = o.id;
      return waitAt;
    }
    // approaching and about to enter, with the right of way or committed
    if (trusting && crossing) continue;
    const dEnter = o.path.boxEnter - o.front;
    if (dEnter < 0 || o.v < 0.5) continue;
    const eta = dEnter / o.v;
    const theirHead = ctl.head(other);
    const theyHaveGreen = theirHead === 'green' || theirHead === 'green-arrow' || theirHead === 'yellow';
    if (car.committed && !o.committed) continue;
    if (permissive || uncontrolled) { if (eta < gapNeed) { car.blockedBy = o.id; return waitAt; } continue; }
    if ((o.committed || theyHaveGreen) && eta < gapNeed) { car.blockedBy = o.id; return waitAt; }
  }
  return 0;
}

// Compute this tick's acceleration from what the driver perceives.
export function drive(car, world, dt) {
  const st = car.stats, p = car.path;
  const seen = car.perceived();
  let v0 = st.vmax * (world.speedScale ?? 1);
  // slow for the turn, and slow early enough to make it
  if (p.turn !== 'T') {
    const dToBox = p.boxEnter - car.front;
    if (car.touchesBox()) v0 = Math.min(v0, st.turnV);
    else if (dToBox > 0) v0 = Math.min(v0, Math.sqrt(st.turnV * st.turnV + 2 * st.bComf * dToBox));
  }
  let a = idm(st, car.v, v0, Infinity, 0);
  let still = Infinity;     // nearest gap to something that is not moving
  const consider = (gap, dv) => {
    a = Math.min(a, idm(st, car.v, v0, gap, dv));
    if (dv >= car.v - 0.1 && gap < still) still = gap;
  };

  // the car ahead on my lane, as it was `reaction` ago
  const lead = world.leaderOf(car);
  if (lead) {
    const lp = lead.car.perceived();
    const staleGap = lead.gap - (lead.car.s - lp.s);   // where I believe its rear is
    consider(staleGap, car.v - lp.v);
  }
  // anything sitting on my line near the box
  const ob = world.obstacleAhead(car);
  if (ob) consider(ob.gap, car.v - ob.v);
  // the light
  if (seen.stop > 0) consider(seen.stop - car.front, car.v);
  // the box
  if (seen.box > 0) consider(seen.box - car.front, car.v);
  // my own stop
  if (car.specialKind) consider(car.specialS - car.front, car.v);

  // IDM only ever approaches its resting gap; once it is nearly there and
  // nearly stopped, stop, rather than creep for ten seconds
  if (car.v < 0.35 && still < st.s0 + 0.5) a = Math.min(a, -1.5);
  // student: jerky pedal
  if (st.jerky) {
    car.jerkT -= dt;
    if (car.jerkT <= 0) { car.jerkT = 0.4; car.jerk = 1 + car.rng.range(-st.jerky, st.jerky); }
    if (a < 0) a *= car.jerk;
  }
  return Math.max(-st.brake, Math.min(st.accel, a));
}

// Special stops: tourist hesitation inside the box, rideshare pickups on the
// straights. Called once per tick before `drive`.
export function specialStops(car, world, dt) {
  const st = car.stats, p = car.path, t = world.t;
  if (car.specialKind) {
    if (t >= car.specialUntil) { car.specialKind = null; }
    return;
  }
  if (car.crashed) return;
  if (st.hesitate && !car.hesitateRolled && car.front > p.boxEnter + 2 && car.front < p.boxExit - 4) {
    car.hesitateRolled = true;
    if (car.rng.chance(st.hesitate)) {
      car.specialKind = 'hesitate'; car.specialUntil = t + st.hesitateFor; car.specialS = car.front + Math.max(0.5, car.v * 0.4);
      world.events.push({ t, kind: 'hesitate', car: car.id });
    }
  }
  if (st.pickup && car.v > 3) {
    const nearBox = car.front > p.boxEnter - 18 && car.rear < p.boxExit + 12;
    // st.pickup is a per-second chance, scaled to this tick
    if (!nearBox && car.rng.chance(st.pickup * dt)) {
      car.specialKind = 'pickup'; car.specialUntil = t + st.pickupFor; car.specialS = car.front + car.v * 1.2 + 2;
      world.events.push({ t, kind: 'pickup', car: car.id });
    }
  }
  if (st.wrongTurn && !car.wrongTurnDone && p.stopLine - car.front < 14) {
    car.wrongTurnDone = true;
    if (car.rng.chance(st.wrongTurn)) {
      const others = world.network.choicesFrom(p.entry, p.lane).filter(q => q !== p);
      if (others.length) {
        car.path = car.rng.pick(others);
        world.events.push({ t, kind: 'wrong-turn', car: car.id, to: car.path.movement });
      }
    }
  }
}
