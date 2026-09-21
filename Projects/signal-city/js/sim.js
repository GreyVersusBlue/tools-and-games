// Signal City: the world. One intersection (a corridor is a later
// milestone: the Path/Car design already carries the hooks), its
// controller, its cars, the spawner and the bookkeeping the score reads.
//
// Fixed step: DT = 1/60 s, always. main.js accumulates real time into whole
// steps; the suite steps by hand. Every roll of the dice goes through one
// seeded rng in one fixed order, so `hash()` after N steps is a function of
// (seed, level, inputs) and nothing else (test/sim.mjs checks).
//
// What counts:
//   spawned, cleared           cars that arrived, cars that left the map
//   collisions                 crash events (a chain of three is two events)
//   wait                       seconds a car sat at under 0.5 m/s for reasons
//                              not its own (a pickup stop is its own fault)
//   honks                      patience ran out
//   gridlock                   set once a car has waited past `gridlockWait`
//                              or a car has sat in the box past `boxStall`

import { makeRng } from './rng.js';
import { Controller, conflicts, wideConflicts } from './signals.js';
import { Network, rectsOverlap } from './network.js';
import { Car, ARCHETYPES, DT, resetIds, drive, stopLineVerdict, boxVerdict, specialStops } from './cars.js';

export { DT };

export const DEFAULT_MIX = { standard: 6, granny: 1, aggressive: 1, tourist: 1, trucker: 0.5, student: 0.5, rideshare: 1, emergency: 0 };
export const DEFAULT_TURNS = { T: 0.6, L: 0.2, R: 0.2 };

export class World {
  constructor(level = {}, seed = 1) {
    this.level = level;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.network = new Network(level.network || {});
    this.controller = new Controller({ legs: this.network.legs, ...(level.controller || {}) });
    this.cars = [];
    this.t = 0;
    this.tick = 0;
    this.duration = level.duration ?? 180;
    this.demand = level.demand || {};              // leg -> vehicles per hour
    this.mix = level.mix || DEFAULT_MIX;
    this.turns = level.turns || DEFAULT_TURNS;
    this.redRunScale = level.redRunScale ?? 1;
    this.speedScale = 1;
    this.gridlockWait = level.gridlockWait ?? 120;
    this.boxStall = level.boxStall ?? 30;
    this.crashClear = level.crashClear ?? 8;
    this.nextArrival = {};
    for (const leg of this.network.legs) this.nextArrival[leg] = this.rng.exp((this.demand[leg] || 0) / 3600);
    this.scheduled = (level.spawns || []).slice().sort((a, b) => a.t - b.t); // [{ t, leg, archetype, turn }]
    this.stats = { spawned: 0, cleared: 0, collisions: 0, honks: 0, wait: 0, waitCleared: 0, maxWait: 0, gridlock: false, gridlockAt: -1, boxStalled: 0, nearMisses: 0 };
    this.events = [];       // [{ t, kind, ... }], the renderer drains these
    this.boxStallT = 0;
    this._conf = new Map();
    resetIds();
  }

  get over() { return this.t >= this.duration; }

  // cached conflict lookups
  conflicts(a, b) {
    const k = a < b ? a + '|' + b : b + '|' + a;
    let v = this._conf.get(k);
    if (v === undefined) { v = conflicts(a, b); this._conf.set(k, v); }
    return v;
  }
  wideConflicts(a, b) { return wideConflicts(a, b); }

  // ---- player inputs ------------------------------------------------------

  requestPhase(i) { return this.controller.requestPhase(i); }

  // The emergency corridor: hold green for that vehicle's movement until it
  // is through, plus a margin.
  requestPriority(car) {
    if (!car || car.priority || car.done) return false;
    const p = car.path;
    const dist = Math.max(0, p.boxExit - car.rear);
    const hold = Math.min(40, dist / Math.max(4, car.v || 4) + 6);
    this.controller.preempt([p.movement], hold);
    car.priority = true;
    this.events.push({ t: this.t, kind: 'priority', car: car.id });
    return true;
  }

  // ---- spawning -----------------------------------------------------------

  spawnCar({ leg, archetype, turn, variant, lane } = {}) {
    const net = this.network;
    leg = leg || this.rng.pick(net.legs);
    archetype = archetype || this.rng.weighted(this.mix);
    if (!ARCHETYPES[archetype]) throw new Error(`unknown archetype ${archetype}`);
    let paths = [];
    for (let tries = 0; tries < 4 && !paths.length; tries++) {
      const t = turn || this.rng.weighted(this.turns);
      const lanes = net.lanesForTurn(t);
      const l = lane ?? this.rng.pick(lanes);
      const p = net.pathFor(leg, l, t);
      if (p) paths = [p];
      if (turn) break;
    }
    if (!paths.length) {
      // fall back to any path from this leg
      for (const p of net.paths.values()) if (p.entry === leg) { paths = [p]; break; }
      if (!paths.length) return null;
    }
    const path = paths[0];
    // is the lane start clear? Arrive no faster than the car ahead if it is
    // close, so a queue that has backed up to the map edge is joined, not hit.
    const st = ARCHETYPES[archetype];
    const len = st.length + (st.trailer ? st.trailer.length + st.trailer.gap : 0);
    let v = Math.min(st.vmax, 9);
    for (const o of this.cars) {
      if (o.done) continue;
      if (o.path.entry === path.entry && o.path.lane === path.lane && o.front < path.boxEnter) {
        if (o.rear < len + st.s0 + 3) return null;
        if (o.rear < len + 25) v = Math.min(v, o.v);
      }
    }
    const car = new Car({ archetype, variant: variant ?? this.rng.int(0, 3), path, rng: this.rng, spawnedAt: this.t });
    car.s = car.length - car.stats.length / 2;   // whole body on the map
    car.v = v;
    for (const h of car.hist) { h.s = car.s; h.v = car.v; }
    this.cars.push(car);
    this.stats.spawned++;
    return car;
  }

  _spawnTick() {
    // scheduled arrivals (emergency calls, motorcades)
    while (this.scheduled.length && this.scheduled[0].t <= this.t) {
      const s = this.scheduled.shift();
      const car = this.spawnCar(s);
      if (!car) { s.t = this.t + 1; this.scheduled.unshift(s); break; } // lane full: retry in a second
      this.events.push({ t: this.t, kind: 'spawn', car: car.id, archetype: car.archetype, scheduled: true });
    }
    // Poisson arrivals per leg
    for (const leg of this.network.legs) {
      const rate = (this.demand[leg] || 0) * (this.level.demandCurve ? this.level.demandCurve(this.t / this.duration) : 1) / 3600;
      if (rate <= 0) continue;
      this.nextArrival[leg] -= DT;
      if (this.nextArrival[leg] <= 0) {
        this.nextArrival[leg] = this.rng.exp(rate);
        const car = this.spawnCar({ leg });
        if (!car) this.nextArrival[leg] = Math.min(this.nextArrival[leg], 0.5); // lane full: try again soon
      }
    }
  }

  // ---- following ----------------------------------------------------------

  // The nearest car ahead of `car` on its own line, with every candidate
  // expressed in car's arc-length frame: same path is exact; a car still
  // partly on the shared approach (its rear before the box) reads by its own
  // s, because every path leaving one lane shares that geometry; a car on
  // the shared exit lane reads by its distance past its own box exit. Returns
  // { car, gap } with gap from the leader's rear to my front, or null.
  leaderOf(car) {
    const p = car.path;
    let best = null, bestGap = Infinity;
    for (const o of this.cars) {
      if (o === car || o.done) continue;
      const q = o.path;
      let pos;
      if (q === p) pos = o.s;
      else if (q.entry === p.entry && q.lane === p.lane && o.rear < q.boxEnter && car.front < p.boxEnter + 1) pos = o.s;
      else if (q.exit === p.exit && q.exitLane === p.exitLane && o.front > q.boxExit) pos = o.s - q.boxExit + p.boxExit;
      else continue;
      const gap = (pos - o.length + o.stats.length / 2) - car.front;
      if (pos > car.s && gap < bestGap) { bestGap = gap; best = o; }
    }
    return best ? { car: best, gap: bestGap } : null;
  }

  // Anything physically on my line in the next `reach` metres, whatever path
  // it is on: a hesitating tourist mid-box, a crashed car, a car that turned
  // off my lane but is still nosing across it. Sweeps a probe of my width
  // along my path and reports the nearest body it overlaps. Only cars near
  // the box run this; on the straights the lane leader is enough.
  obstacleAhead(car, reach = 16) {
    const p = car.path;
    if (car.front < p.stopLine - 20 || car.rear > p.boxExit + 6) return null;
    const near = [];
    const me = p.at(car.s);
    for (const o of this.cars) {
      if (o === car || o.done) continue;
      const r = o.rects();
      if (Math.abs(r[0].x - me.x) > reach + 8 || Math.abs(r[0].y - me.y) > reach + 8) continue;
      // a lane leader is already handled by leaderOf
      near.push({ o, rects: r });
    }
    if (!near.length) return null;
    const probeLen = 1.0;
    for (let d = 0.5; d <= reach; d += 1.0) {
      const s = car.front + d;
      const q = p.at(s);
      const probe = { x: q.x, y: q.y, heading: q.heading, length: probeLen, width: car.width * 0.9 };
      for (const { o, rects } of near) {
        for (const rr of rects) {
          if (rectsOverlap(probe, rr)) {
            // is it actually ahead of me, not beside or behind
            const dx = rr.x - me.x, dy = rr.y - me.y;
            const ahead = dx * Math.cos(me.heading) + dy * Math.sin(me.heading);
            if (ahead < 0) continue;
            return { car: o, gap: d - probeLen / 2, v: o.v };
          }
        }
      }
    }
    return null;
  }

  // Queue length behind a movement's stop line, for induction loops.
  queued(movement) {
    let n = 0;
    for (const c of this.cars) if (!c.done && c.path.movement === movement && c.front < c.path.boxEnter && c.v < 1) n++;
    return n;
  }

  // ---- the step -----------------------------------------------------------

  step() {
    const dt = DT;
    this.t += dt;
    this.tick++;
    this.controller.step(dt, m => this.queued(m));
    this._spawnTick();

    const ctl = this.controller;
    // 1. verdicts, from the true present, recorded for later perception
    for (const car of this.cars) {
      if (car.done) continue;
      const head = ctl.head(car.path.movement);
      specialStops(car, this, dt);
      if (car.crashed) { car.stopVerdict = 0; car.boxVerdict = 0; }
      else {
        car.stopVerdict = stopLineVerdict(car, head, ctl.timeToYellow(car.path.movement), this);
        car.boxVerdict = car.stopVerdict > 0 ? 0 : boxVerdict(car, head, this);
      }
      car.record();
    }
    // 2. accelerate and move
    for (const car of this.cars) {
      if (car.done) continue;
      if (car.crashed) { car.v = 0; car.a = 0; }
      else {
        car.a = drive(car, this, dt);
        car.v = Math.max(0, car.v + car.a * dt);
        // IDM only ever approaches rest; below a crawl with no real push, it is stopped
        if (car.v < 0.05 && car.a < 0.2) car.v = 0;
      }
      car.s += car.v * dt;
      // waiting and patience
      if (car.isWaiting) {
        car.wait += dt;
        this.stats.wait += dt;
        if (car.wait > this.stats.maxWait) this.stats.maxWait = car.wait;
        if (car.stats.patience > 0) {
          car.patience -= dt;
          car.honkCooldown -= dt;
          if (car.patience <= 0 && car.honkCooldown <= 0) {
            car.honked++; car.honkCooldown = 8; this.stats.honks++;
            this.events.push({ t: this.t, kind: 'honk', car: car.id });
          }
        }
      }
      if (car.s - car.length >= car.path.length) {
        car.done = true;
        this.stats.cleared++;
        this.stats.waitCleared += car.wait;
        this.events.push({ t: this.t, kind: 'cleared', car: car.id, wait: car.wait, travel: this.t - car.spawnedAt });
      }
    }
    // 3. collisions
    this._collide();
    // 4. crashed cars are towed after a while; stalls in the box
    let boxStalled = false;
    for (const car of this.cars) {
      if (car.done) continue;
      if (car.crashed && this.t - car.crashedAt >= this.crashClear) {
        car.done = true;
        this.events.push({ t: this.t, kind: 'towed', car: car.id });
      }
      if (car.touchesBox() && car.v < 0.3 && !car.done) boxStalled = true;
    }
    if (boxStalled) { this.boxStallT += dt; this.stats.boxStalled += dt; } else this.boxStallT = 0;
    if (!this.stats.gridlock && (this.stats.maxWait >= this.gridlockWait || this.boxStallT >= this.boxStall)) {
      this.stats.gridlock = true; this.stats.gridlockAt = this.t;
      this.events.push({ t: this.t, kind: 'gridlock' });
    }
    // 5. drop finished cars
    if (this.tick % 60 === 0) this.cars = this.cars.filter(c => !c.done);
  }

  _collide() {
    const cars = this.cars;
    const rects = cars.map(c => (c.done ? null : c.rects()));
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i]; if (!rects[i]) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j]; if (!rects[j]) continue;
        if (a.crashed && b.crashed) continue;
        // broad phase
        const ra = rects[i][0], rb = rects[j][0];
        const reach = (a.length + b.length) / 2 + 2;
        if (Math.abs(ra.x - rb.x) > reach || Math.abs(ra.y - rb.y) > reach) continue;
        let hit = false;
        for (const p of rects[i]) { for (const q of rects[j]) if (rectsOverlap(p, q)) { hit = true; break; } if (hit) break; }
        if (!hit) continue;
        for (const c of [a, b]) if (!c.crashed) { c.crashed = true; c.crashedAt = this.t; c.v = 0; }
        this.stats.collisions++;
        const who = [a, b].map(c => ({ id: c.id, archetype: c.archetype, movement: c.path.movement, committed: c.committed, v: +c.v.toFixed(1), head: this.controller.head(c.path.movement), special: c.specialKind, front: +c.front.toFixed(1), stop: +c.stopVerdict.toFixed(1), box: +c.boxVerdict.toFixed(1) }));
        this.events.push({ t: this.t, kind: 'collision', cars: [a.id, b.id], who, where: { x: (ra.x + rb.x) / 2, y: (ra.y + rb.y) / 2 } });
      }
    }
  }

  // ---- for the suite and the debug hook -----------------------------------

  run(seconds) { for (let n = Math.round(seconds / DT); n > 0; n--) this.step(); return this; }

  hash() {
    let h = 2166136261;
    const mix = x => { h ^= Math.round(x * 1000) & 0xffff; h = Math.imul(h, 16777619) >>> 0; };
    mix(this.t);
    for (const c of this.cars) { if (!c.done) { mix(c.s); mix(c.v); mix(c.id); } }
    mix(this.stats.cleared); mix(this.stats.collisions); mix(this.stats.honks);
    return h >>> 0;
  }

  snapshot() {
    return {
      t: this.t, stats: { ...this.stats }, controller: this.controller.snapshot(),
      cars: this.cars.filter(c => !c.done).map(c => ({ id: c.id, archetype: c.archetype, movement: c.path.movement, s: +c.s.toFixed(2), v: +c.v.toFixed(2), crashed: c.crashed, wait: +c.wait.toFixed(1) })),
    };
  }
}
