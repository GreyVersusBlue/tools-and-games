// Signal City: the world. One intersection or a corridor of them
// (`network.nodes`), a controller per node, the cars, the walkers, the
// spawner and the bookkeeping the score reads.
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
//   pedLate                    a pedestrian call unserved past `pedWait`
//                              seconds, and again every `pedWait` after
//   gridlock                   set once a car has waited past `gridlockWait`
//                              or one car has sat in the box past `boxStall`
//                              (per car: two lefts waiting in turn are two
//                              short stalls, not one long one)
//
// Walkers (M6). A call on a leg (`callPed`, a scripted `calls` entry or the
// Poisson `pedDemand`) reaches that node's controller; when its WALK comes
// the call's walkers step off the curb and cross the zebra at about 1.4 m/s
// (1.1 to 1.7). A walker waits at the edge of a lane a car is about to use
// or is in; a car turning onto the leg holds at the box edge until every
// walker has passed its lane (cars.js boxVerdict). A car whose body reaches
// a walker anyway has struck them: the walker is gone, the car is crashed,
// and it counts as a collision. Three rules from M7 (#575) keep a zebra
// from locking the box: a permissive left that can still stop short of a
// zebra with people on it does, and one that must wait for exit walkers
// waits in its own lane until it has committed into the box (cars.js
// boxVerdict); and speed decides who yields on a zebra: a walker passes a
// car standing still with no push on the pedal, and a standing car holds
// while a walker is in its lane ahead of it, where a moving car is yielded
// to as before.
//
// The corridor (M6). A path leaving a node by a linked leg ends where the
// next node's entry path begins (network.js linkNodes). When a car's centre
// passes that end it is handed on: a fresh turn from the level's weights
// among the paths its lane can take, `s` and the perception ring shifted
// into the new frame, and `newApproach()` so every once-per-approach
// decision (the yellow, the red roll, the trust roll, the four-way order)
// is made again at the second box.
//
// Events (M7). A level's `events` list is scripted moments, each `{ kind,
// at, for }` and a few fields of its own, started when the clock reaches
// `at` and ended `for` seconds later (`active` holds the ones in force;
// `activeEvent(kind)` reads one). Three kinds so far:
//   surge      { scale }         every leg's demand times `scale` while it
//                                runs, on top of the level's `demandCurve`
//   outage     the power is out: every controller goes dark (a four-way
//                                stop), and every command that needs power
//                                (a phase, a flash mode, the priority
//                                corridor) is refused until it is back, when
//                                each box returns to the phase it was in
//                                through an all-red
//   ambulance  { leg, turn, within }   an emergency vehicle spawned at `at`
//                                that has `within` seconds from its arrival
//                                to leave the map; past that it is late
//                                (stats.ambulanceLate, an 'ambulance-late'
//                                event) and the level's satisfaction pays
// Four more kinds, the rest of M7:
//   motorcade  { leg, turn, size, spacing }   a platoon of `size` cars of the
//   procession                   `motorcade` (fast, tight) or `procession`
//                                (slow, tight) archetype, spawned `spacing`
//                                seconds apart on `leg`, that obey the light
//                                like anyone else. It is split when a member
//                                is held at its stop line by the light while
//                                another member is already past the box
//                                (stats.platoonSplits, a 'split' event, five
//                                honks' worth and 50 points, once). A
//                                motorcade takes the priority corridor
//                                (requestPriority on any member, the hold
//                                covering every member); a procession does
//                                not. The event ends when every member has
//                                left the map.
//   closure    { leg, lane, length }   the inbound `lane` of `leg` is coned
//                                off for `length` metres back from the stop
//                                line, with a TAPER before it. Traffic still
//                                arrives in every lane (the cones are 54 m
//                                from the box; the map edge is 110 m out),
//                                and a car in the closed lane merges into
//                                the nearest open lane before the taper when
//                                there is room ahead and behind (_mergeTick),
//                                or waits at the taper until there is. The
//                                zipper: a car in the open lane coming up
//                                behind one waiting at the taper takes it as
//                                its leader (leaderOf) and slows for it, so
//                                the room comes. A car past the taper when
//                                the cones go up carries on.
//   school     { scale, peds }   a school zone: every car's free speed times
//                                `scale` (world.speedScale, read by drive)
//                                and every leg's pedestrian calls times
//                                `peds`, under a flashing beacon the
//                                renderer draws.
// The lists sit in the level, so a run is still a function of (seed, level,
// inputs). The page reads `active` for its event line.

import { makeRng } from './rng.js';
import { Controller, conflicts, wideConflicts, parseMovement } from './signals.js';
import { Network, buildNodes, rectsOverlap, pointInRect, LANE_WIDTH, CROSSWALK } from './network.js';
import { Car, ARCHETYPES, DT, resetIds, drive, stopLineVerdict, boxVerdict, specialStops } from './cars.js';

export { DT };

export const LOOP_LENGTH = 8;   // metres of lane the drawn loop covers, back from the stop line
export const PRIORITY_MARGIN = 6;  // seconds a corridor stays green after its vehicle is through the box
export const PRIORITY_CAP = 60;    // and the most a corridor's green can run, whatever is still in the way
export const TAPER = 12;           // metres a lane closure's cones angle across the lane before the closed stretch
export const MERGE_WINDOW = 40;    // metres before the taper a car starts looking for its gap
export const MERGE_AHEAD = 1.0;    // metres of daylight a merge needs to the car ahead in the new lane
export const MERGE_BEHIND = 1.0;   // and to the car behind, plus 0.4 s of its speed and 1.2 s of the speed it is closing at

export const DEFAULT_MIX = { standard: 6, granny: 1, aggressive: 1, tourist: 1, trucker: 0.5, student: 0.5, rideshare: 1, emergency: 0 };
export const DEFAULT_TURNS = { T: 0.6, L: 0.2, R: 0.2 };

export class World {
  constructor(level = {}, seed = 1) {
    this.level = level;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.nodes = buildNodes(level.network || {});
    this.network = this.nodes[0];                 // the first box: every single-node caller reads this
    // one controller per node: `controller` is every node's base, and
    // `controllers[i]` (an offset, a start phase) is merged over it
    const perNode = level.controllers || [];
    this.controllers = this.nodes.map((n, i) => {
      const spec = { ...(level.controller || {}), ...(perNode[i] || {}) };
      const c = new Controller({ legs: n.legs, ...spec });
      // the clearance is the road's width at a slow walker's 1.2 m/s, unless the level says otherwise
      if (!(spec.pedTiming && spec.pedTiming.clear)) c.pedTiming.clear = Math.ceil(2 * n.halfRoad / 1.2);
      return c;
    });
    this.controller = this.controllers[0];
    this.cars = [];
    this.walkers = [];
    this.pedCalls = this.nodes.map(() => ({}));   // per node: leg -> { since, walkers, late }
    this.pedWait = level.pedWait ?? 40;
    this.pedDemand = level.pedDemand || null;     // calls per hour per leg, applied at every node with walks
    this.loops = level.loops || null;             // movements with a loop, or null for every lane once sensors are on
    this.t = 0;
    this.tick = 0;
    this.duration = level.duration ?? 180;
    this.demand = level.demand || {};              // leg -> vehicles per hour
    this.mix = level.mix || DEFAULT_MIX;
    this.turns = level.turns || DEFAULT_TURNS;
    this.redRunScale = level.redRunScale ?? 1;
    this.greenTrustScale = level.greenTrustScale ?? 1;   // scales every archetype's greenTrust
    this.sensors = !!level.sensors;                      // induction loops (M6): until then queue rules sleep
    this.speedScale = 1;
    this.gridlockWait = level.gridlockWait ?? 120;
    this.boxStall = level.boxStall ?? 30;
    this.crashClear = level.crashClear ?? 8;
    this.nextArrival = this.nodes.map(n => { const o = {}; for (const leg of n.spawnLegs) o[leg] = this.rng.exp(this.demandFor(n.node, leg) / 3600); return o; });
    this.nextCall = this.nodes.map(n => { const o = {}; if (this.pedDemand) for (const leg of n.legs) o[leg] = this.rng.exp((this.pedDemand[leg] || 0) / 3600); return o; });
    this.scheduled = (level.spawns || []).slice().sort((a, b) => a.t - b.t); // [{ t, leg, archetype, turn, node }]
    this.scheduledCalls = (level.calls || []).slice().sort((a, b) => a.t - b.t); // [{ t, leg, node, walkers }]
    this.schedule = (level.events || []).map(e => ({ ...e })).sort((a, b) => a.at - b.at); // events yet to start (M7)
    this.active = [];       // events in force: { kind, at, until, ... }
    this.stats = { spawned: 0, cleared: 0, collisions: 0, honks: 0, wait: 0, waitCleared: 0, maxWait: 0, gridlock: false, gridlockAt: -1, boxStalled: 0, nearMisses: 0, pedCalls: 0, pedServed: 0, pedLate: 0, walkers: 0, struck: 0, handoffs: 0, outages: 0, ambulances: 0, ambulanceLate: 0, platoons: 0, platoonSplits: 0, closures: 0, merges: 0 };
    this.events = [];       // [{ t, kind, ... }], the renderer drains these
    this.boxStallT = 0;
    this._conf = new Map();
    this._walkerId = 0;
    resetIds();
  }

  get over() { return this.t >= this.duration; }

  // Vehicles per hour arriving on a node's leg: `demand` is one object for
  // every node, or an array with one per node.
  demandFor(node, leg) {
    const d = Array.isArray(this.demand) ? (this.demand[node] || {}) : this.demand;
    return d[leg] || 0;
  }

  controllerFor(car) { return this.controllers[car.path.node]; }

  // cached conflict lookups
  conflicts(a, b) {
    const k = a < b ? a + '|' + b : b + '|' + a;
    let v = this._conf.get(k);
    if (v === undefined) { v = conflicts(a, b); this._conf.set(k, v); }
    return v;
  }
  wideConflicts(a, b) { return wideConflicts(a, b); }

  // ---- events (M7) --------------------------------------------------------

  // Is the power out? While it is, the boxes are dark and nothing the
  // player asks of a signal can happen.
  get powerOut() { return this.active.some(e => e.kind === 'outage'); }

  // The event of `kind` in force, or null.
  activeEvent(kind) { return this.active.find(e => e.kind === kind) || null; }

  // What every leg's demand is multiplied by right now: the level's curve
  // times every surge in force.
  demandScale() {
    let s = this.level.demandCurve ? this.level.demandCurve(this.t / this.duration) : 1;
    for (const e of this.active) if (e.kind === 'surge') s *= e.scale ?? 1;
    return s;
  }

  // What every leg's pedestrian calls are multiplied by right now: every
  // school zone in force.
  pedScale() {
    let s = 1;
    for (const e of this.active) if (e.kind === 'school') s *= e.peds ?? 1;
    return s;
  }

  // The platoon (motorcade or procession) in force, or null.
  get platoon() { return this.active.find(e => e.kind === 'motorcade' || e.kind === 'procession') || null; }

  _eventTick() {
    while (this.schedule.length && this.schedule[0].at <= this.t) {
      const e = this.schedule.shift();
      if (!this._startEvent(e)) { e.at = this.t + 1; this.schedule.unshift(e); break; } // an ambulance's lane was full: try in a second
    }
    for (const e of this.active) {
      if (e.kind === 'ambulance') this._ambulanceTick(e);
      else if (e.kind === 'motorcade' || e.kind === 'procession') this._platoonTick(e);
      if (e.until !== null && this.t >= e.until && !e.ended) this._endEvent(e);
    }
    this.active = this.active.filter(e => !e.ended);
    // the school zone: every car's free speed, until it ends
    let sc = 1;
    for (const e of this.active) if (e.kind === 'school') sc *= e.scale;
    this.speedScale = sc;
  }

  _startEvent(spec) {
    const e = { ...spec, at: this.t, until: spec.for ? spec.at + spec.for : null, ended: false };
    switch (e.kind) {
      case 'surge':
        e.scale = e.scale ?? 1.5;
        break;
      case 'outage':
        // the phase each box was in, to come back to; a box already dark or
        // flashing comes back to phase 0
        e.resume = this.controllers.map(c => c.stage === 'flash' || c.stage === 'dark' ? 0 : (c.next !== null ? c.next : c.phase));
        for (const c of this.controllers) c.setDark();
        this.stats.outages++;
        break;
      case 'ambulance': {
        const car = this.spawnCar({ leg: e.leg, archetype: 'emergency', turn: e.turn, node: e.node || 0 });
        if (!car) return false;
        e.car = car;
        e.within = e.within ?? 45;
        e.until = null;                       // it ends when the vehicle leaves the map
        e.deadline = this.t + e.within;
        e.late = false;
        this.stats.ambulances++;
        this.events.push({ t: this.t, kind: 'spawn', car: car.id, archetype: 'emergency', scheduled: true });
        break;
      }
      case 'motorcade': case 'procession': {
        e.node = e.node || 0;
        e.turn = e.turn || 'T';
        e.size = e.size ?? (e.kind === 'motorcade' ? 5 : 8);
        e.spacing = e.spacing ?? (e.kind === 'motorcade' ? 1.2 : 2.0);
        e.cars = []; e.split = false; e.splitAt = null; e.priority = false; e.lastSpawn = -Infinity;
        e.until = null;                       // it ends when the last member has left the map
        if (!this._spawnMember(e)) return false;
        this.stats.platoons++;
        break;
      }
      case 'closure': {
        e.node = e.node || 0;
        e.lane = e.lane ?? 0;
        e.length = e.length ?? 30;
        const net = this.nodes[e.node];
        if (!e.leg || !net.legs.includes(e.leg)) throw new Error(`a closure needs a leg the box has, not ${e.leg}`);
        net.close(e.leg, e.lane);
        e.d0 = net.stopDist + e.length + TAPER;   // where the first cone stands, from the centre
        e.taperS = net.legLength - e.d0;          // the same point in the lane's path frame
        this.stats.closures++;
        break;
      }
      case 'school':
        e.scale = e.scale ?? 0.5;
        e.peds = e.peds ?? 3;
        break;
      default: throw new Error(`unknown event ${e.kind}`);
    }
    this.active.push(e);
    this.events.push({ t: this.t, kind: 'event', event: e.kind, on: true });
    return true;
  }

  _endEvent(e) {
    e.ended = true;
    if (e.kind === 'outage') this.controllers.forEach((c, i) => { if (c.stage === 'dark') c.requestPhase(e.resume[i], 'outage'); });
    if (e.kind === 'closure') {
      this.nodes[e.node].open(e.leg, e.lane);
      for (const c of this.cars) if (!c.done && c.path.node === e.node && c.path.entry === e.leg && c.path.lane === e.lane) { c.mergeS = 0; c.mergeLane = -1; }
    }
    this.events.push({ t: this.t, kind: 'event', event: e.kind, on: false });
  }

  // One more member of a platoon, if the lane start is clear. A motorcade
  // already given the corridor passes it on to the new car.
  _spawnMember(e) {
    const car = this.spawnCar({ leg: e.leg, archetype: e.kind, turn: e.turn, node: e.node, variant: e.cars.length % 4 });
    if (!car) return null;
    car.platoon = e;
    if (e.priority) car.priority = true;
    e.cars.push(car);
    e.lastSpawn = this.t;
    this.events.push({ t: this.t, kind: 'spawn', car: car.id, archetype: e.kind, scheduled: true });
    return car;
  }

  // The platoon's clock: the next member when its spacing has run (and the
  // lane start is clear), the split rule, and the end once every member is
  // off the map. A split is the light's doing, once: a member held at its
  // stop line by its verdict (a red, or a yellow it decided to stop for)
  // while another member is already past the box exit or gone. A whole
  // platoon waiting at a red together is not split, and neither is one
  // whose tail is still queued on a green the head has just cleared.
  _platoonTick(e) {
    if (e.cars.length < e.size && this.t - e.lastSpawn >= e.spacing - 1e-9) this._spawnMember(e);
    if (!e.split) {
      const through = e.cars.some(c => c.done || c.rear > c.path.boxExit);
      const held = through ? e.cars.find(c => !c.done && !c.crashed && c.stopVerdict > 0 && c.front < c.path.stopLine + 0.5) : null;
      if (held) {
        e.split = true; e.splitAt = this.t;
        this.stats.platoonSplits++;
        this.events.push({ t: this.t, kind: 'split', car: held.id, event: e.kind });
      }
    }
    if (e.cars.length >= e.size && e.cars.every(c => c.done)) this._endEvent(e);
  }

  // The lane closure's merge (M7): a car in the closed lane inside
  // MERGE_WINDOW metres of the taper moves onto the nearest open lane's
  // path at its own s (the approaches share their geometry) when there is
  // MERGE_AHEAD of daylight to the car ahead there and, behind, MERGE_BEHIND
  // plus 0.4 s of the follower's speed plus 1.2 s of the speed it is closing
  // at; the body slides across over the next second (Car.easeLateral). With
  // no gap it holds at the taper (car.mergeS, read by drive; car.mergeLane
  // is what leaderOf reads to make the car behind in that lane yield) and
  // looks again next step. The turn is kept where the new lane allows it,
  // else a through, else whatever the lane has.
  _mergeTick() {
    for (const e of this.active) {
      if (e.kind !== 'closure') continue;
      const net = this.nodes[e.node];
      const target = net.openLaneNear(e.leg, e.lane);
      for (const car of this.cars) {
        if (car.done || car.crashed || car.path.node !== e.node || car.path.entry !== e.leg || car.path.lane !== e.lane) continue;
        car.mergeS = 0; car.mergeLane = -1;
        if (car.front > e.taperS + 0.5 || car.front < e.taperS - MERGE_WINDOW) continue;
        const keep = target >= 0 && net.lanesForTurn(car.path.turn, e.leg).includes(target);
        const next = target < 0 ? null : ((keep && net.pathFor(e.leg, target, car.path.turn)) || net.pathFor(e.leg, target, 'T') || net.choicesFrom(e.leg, target)[0]);
        if (!next || !this._roomFor(car, next)) { car.mergeS = e.taperS; car.mergeLane = target; continue; }
        const from = car.path.at(car.s), to = next.at(car.s);
        car.latX += from.x - to.x; car.latY += from.y - to.y;
        car.path = next;
        this.stats.merges++;
        this.events.push({ t: this.t, kind: 'merge', car: car.id, to: next.movement });
      }
    }
  }

  _roomFor(car, next) {
    for (const o of this.cars) {
      if (o === car || o.done) continue;
      if (o.path.node !== next.node || o.path.entry !== next.entry || o.path.lane !== next.lane || o.rear > o.path.boxEnter) continue;
      if (o.s > car.s) { if (o.rear - car.front < MERGE_AHEAD) return false; }
      else { const closing = Math.max(0, o.v - car.v); if (car.rear - o.front < MERGE_BEHIND + 0.4 * o.v + 1.2 * closing) return false; }
    }
    return true;
  }

  // The clock on an ambulance: late once past its deadline still on the
  // map, over once it has left.
  _ambulanceTick(e) {
    if (e.car.done) { e.clearedAt = this.t; this._endEvent(e); return; }
    if (!e.late && this.t >= e.deadline) {
      e.late = true;
      this.stats.ambulanceLate++;
      this.events.push({ t: this.t, kind: 'ambulance-late', car: e.car.id });
    }
  }

  // Seconds an ambulance under a timer still has, negative once late, or
  // null with none on the map.
  ambulanceClock() {
    const e = this.activeEvent('ambulance');
    return e ? e.deadline - this.t : null;
  }

  // ---- player inputs ------------------------------------------------------

  // Every signal command is refused while the power is out (M7).
  requestPhase(i, node = 0) {
    if (this.powerOut) return false;
    return this.controllers[node].requestPhase(i);
  }

  // Hold the running green against its elapsed rule (M7): a hand's way of
  // keeping a green under a platoon. Refused while the power is out.
  holdGreen(node = 0) {
    if (this.powerOut) return false;
    return this.controllers[node].holdGreen();
  }

  // Flash red, flash yellow on the main road, or null for the phases.
  setFlash(f, node = 0) {
    if (this.powerOut) return false;
    return this.controllers[node].setFlash(f);
  }

  // The corridor's offset (M7): how many seconds behind the first box the
  // box at `node` runs its plan. The controller moves through its own
  // transitions (Controller.setOffset); returns the seconds it queued.
  setOffset(seconds, node = 1) {
    if (node <= 0 || node >= this.controllers.length) throw new RangeError(`no second box ${node}`);
    return this.controllers[node].setOffset(this.controllers[0].offset + seconds);
  }

  // The offset the box at `node` runs behind the first, for the panel.
  offsetOf(node = 1) { return this.controllers[node] ? this.controllers[node].offset - this.controllers[0].offset : 0; }

  // Press the call button on a leg. A call spawns `walkers` people when its
  // WALK comes; a second call on the same leg adds its people to the first.
  callPed(leg, { node = 0, walkers = 1 } = {}) {
    const ctl = this.controllers[node];
    const r = ctl.callPed(leg);
    if (r === false && !this.pedCalls[node][leg]) return false;
    const pending = this.pedCalls[node][leg] || (this.pedCalls[node][leg] = { since: this.t, walkers: 0, late: 0 });
    pending.walkers += walkers;
    this.stats.pedCalls++;
    this.events.push({ t: this.t, kind: 'call', node, leg });
    return true;
  }

  // The emergency corridor: hold green for that vehicle's movement until it
  // is through, plus a margin. The green is for every movement off its
  // entry leg, not its own alone (M7): on a one-lane approach the queue is
  // shared, and a left turner at its head on a red held the ambulance
  // behind it through the whole hold on 3 of 6 rush-hour seeds.
  requestPriority(car) {
    if (!car || car.priority || car.done || this.powerOut) return false;
    if (!car.stats.ignoresSignals && car.archetype !== 'motorcade') return false;   // a funeral gets no escort here
    if (car.platoon) {
      if (car.platoon.priority) return false;
      car.platoon.priority = true;
      for (const m of car.platoon.cars) if (m !== car) m.priority = true;
    }
    const p = car.path;
    const dist = Math.max(0, p.boxExit - car.rear);
    const hold = Math.min(40, dist / Math.max(4, car.v || 4) + 6);
    const ctl = this.controllerFor(car);
    const leg = ctl.movements.filter(m => { const mv = parseMovement(m); return !mv.ped && mv.entry === p.entry; });
    ctl.preempt(leg.includes(p.movement) ? leg : [p.movement], hold);
    car.priority = true;
    this.events.push({ t: this.t, kind: 'priority', car: car.id });
    return true;
  }

  // The corridor holds until its vehicle is through the box, plus a margin
  // (M7): the hold `requestPriority` set was an estimate from the vehicle's
  // distance, and at rush hour the queue in front of it is the real
  // distance. Every step a priority vehicle still short of its box exit
  // pushes the hold to at least PRIORITY_MARGIN seconds from now, up to
  // PRIORITY_CAP from the green's start, so a wedged vehicle cannot hold
  // the box for good.
  _holdPriority() {
    for (const car of this.cars) {
      if (car.done || !car.priority || car.crashed) continue;
      const ctl = this.controllerFor(car);
      const pre = ctl.preemption;
      if (!pre || ctl.stage !== 'green' || !pre.movements.includes(car.path.movement)) continue;
      if (car.rear < car.path.boxExit) pre.hold = Math.min(PRIORITY_CAP, Math.max(pre.hold, ctl.stageT + PRIORITY_MARGIN));
    }
    // a motorcade with members still to arrive holds its corridor for them
    for (const e of this.active) {
      if (e.kind !== 'motorcade' || !e.priority || e.cars.length >= e.size) continue;
      const ctl = this.controllers[e.node], pre = ctl.preemption;
      if (pre && ctl.stage === 'green') pre.hold = Math.min(PRIORITY_CAP, Math.max(pre.hold, ctl.stageT + PRIORITY_MARGIN));
    }
  }

  // ---- spawning -----------------------------------------------------------

  spawnCar({ leg, archetype, turn, variant, lane, node = 0 } = {}) {
    const net = this.nodes[node];
    leg = leg || this.rng.pick(net.spawnLegs);
    archetype = archetype || this.rng.weighted(this.mix);
    if (!ARCHETYPES[archetype]) throw new Error(`unknown archetype ${archetype}`);
    let paths = [];
    for (let tries = 0; tries < 4 && !paths.length; tries++) {
      const t = turn || this.rng.weighted(this.turns);
      const lanes = net.lanesForTurn(t);        // every lane, a closed one included: the cones are downstream of the map edge
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
      if (o.path.node === path.node && o.path.entry === path.entry && o.path.lane === path.lane && o.front < path.boxEnter) {
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
    // Poisson arrivals per leg, on every node's spawning legs
    const curve = this.demandScale();
    for (const net of this.nodes) {
      const next = this.nextArrival[net.node];
      for (const leg of net.spawnLegs) {
        const rate = this.demandFor(net.node, leg) * curve / 3600;
        if (rate <= 0) continue;
        next[leg] -= DT;
        if (next[leg] <= 0) {
          next[leg] = this.rng.exp(rate);
          const car = this.spawnCar({ leg, node: net.node });
          if (!car) next[leg] = Math.min(next[leg], 0.5); // lane full: try again soon
        }
      }
    }
    // pedestrian calls: scripted, then Poisson per leg
    while (this.scheduledCalls.length && this.scheduledCalls[0].t <= this.t) {
      const c = this.scheduledCalls.shift();
      this.callPed(c.leg, { node: c.node || 0, walkers: c.walkers || 1 });
    }
    if (this.pedDemand) {
      for (const net of this.nodes) {
        if (!this.controllers[net.node].hasPeds) continue;
        const next = this.nextCall[net.node];
        // the clock runs `pedScale` times faster under a school zone and
        // the intervals are drawn at the level's rate: exact for a Poisson
        // process whose rate steps, where the spawner's scheme (a rate read
        // when the interval is drawn) would lag by an interval, a minute at
        // 60 calls an hour
        const pedCurve = this.pedScale();
        for (const leg of net.legs) {
          const rate = (this.pedDemand[leg] || 0) / 3600;
          if (rate <= 0) continue;
          next[leg] -= DT * pedCurve;
          if (next[leg] <= 0) {
            next[leg] = this.rng.exp(rate);
            this.callPed(leg, { node: net.node, walkers: 1 + this.rng.int(0, 2) });
          }
        }
      }
    }
  }

  // ---- walkers --------------------------------------------------------------

  // A call whose WALK has come sends its people across; a call still waiting
  // past `pedWait` costs satisfaction, the way a honk does, and again every
  // `pedWait` after.
  _pedTick(dt) {
    for (const net of this.nodes) {
      const ctl = this.controllers[net.node];
      const calls = this.pedCalls[net.node];
      for (const leg of Object.keys(calls)) {
        const c = calls[leg];
        if (!c) continue;
        if (ctl.pedHead(leg) === 'walk') {
          for (let i = 0; i < c.walkers; i++) this._spawnWalker(net, leg);
          this.stats.pedServed++;
          this.events.push({ t: this.t, kind: 'walk', node: net.node, leg, waited: this.t - c.since });
          delete calls[leg];
          continue;
        }
        if (this.t - c.since >= this.pedWait * (c.late + 1)) {
          c.late++;
          this.stats.pedLate++;
          this.events.push({ t: this.t, kind: 'ped-late', node: net.node, leg, waited: this.t - c.since });
        }
      }
    }
    for (const w of this.walkers) {
      if (w.done) continue;
      const blocked = this._walkerBlocked(w);
      w.v = blocked ? 0 : w.speed;
      w.lat += w.dir * w.v * dt;
      if (blocked) w.waited += dt;
      const [x, y] = w.cw.point(w.lat, w.jitter);
      w.x = x; w.y = y;
      if (w.dir > 0 ? w.lat >= w.cw.half + 1 : w.lat <= -w.cw.half - 1) { w.done = true; continue; }
      // struck: a body over the walker's point, of a car that is moving
      for (const c of this.cars) {
        if (c.done || c.crashed || c.v < 1.0) continue;
        const r = c.rects();
        if (Math.abs(r[0].x - x) > 12 || Math.abs(r[0].y - y) > 12) continue;
        if (r.some(rr => pointInRect(x, y, rr))) {
          w.done = true; w.struck = true;
          c.crashed = true; c.crashedAt = this.t; c.v = 0;
          this.stats.collisions++; this.stats.struck++;
          this.events.push({ t: this.t, kind: 'collision', cars: [c.id], walker: w.id, who: [{ id: c.id, archetype: c.archetype, movement: c.path.movement, v: +c.v.toFixed(1), head: this.controllerFor(c).head(c.path.movement) }], where: { x, y } });
          break;
        }
      }
    }
    if (this.tick % 60 === 0) this.walkers = this.walkers.filter(w => !w.done);
  }

  _spawnWalker(net, leg) {
    const cw = net.crosswalk(leg);
    const dir = this.rng.chance(0.5) ? 1 : -1;
    const w = {
      id: ++this._walkerId, node: net.node, leg, cw, dir,
      lat: dir > 0 ? -cw.half - 1 - this.rng.range(0, 1.5) : cw.half + 1 + this.rng.range(0, 1.5),
      jitter: this.rng.range(-0.9, 0.9), speed: this.rng.range(1.1, 1.7), v: 0, waited: 0,
      tint: this.rng.int(0, 5), x: 0, y: 0, done: false, struck: false, born: this.t,
    };
    const [x, y] = cw.point(w.lat, w.jitter);
    w.x = x; w.y = y;
    this.walkers.push(w);
    this.stats.walkers++;
    return w;
  }

  // Is a car about to use, or in, the lane just ahead of this walker? Looks
  // 2.5 s ahead along every path that crosses this zebra. A car standing
  // still with no push on the pedal is walked past (#575): the car, for its
  // part, holds while the walker is in its lane (boxVerdict).
  _walkerBlocked(w) {
    const cw = w.cw, net = this.nodes[w.node];
    const aheadLat = w.lat + w.dir * 1.6;
    for (const c of this.cars) {
      if (c.done || c.path.node !== w.node) continue;
      if (c.v < 0.3 && c.a <= 0.1) continue;
      const p = c.path;
      let laneLat, dist, inBand;
      if (p.exit === w.leg) {
        laneLat = cw.laneLat(p.exitLane, false);
        dist = p.boxExit - c.front;
        inBand = c.front > p.boxExit && c.rear < p.boxExit + CROSSWALK;
      } else if (p.entry === w.leg) {
        laneLat = cw.laneLat(p.lane, true);
        dist = (p.boxEnter - CROSSWALK) - c.front;
        inBand = c.front > p.boxEnter - CROSSWALK && c.rear < p.boxEnter;
      } else continue;
      if (Math.abs(laneLat - aheadLat) > LANE_WIDTH / 2 + 1.2) continue;
      if (inBand) return true;
      if (dist > 0 && c.v > 0.5 && dist / c.v < 2.5) return true;
    }
    return false;
  }

  // Walkers on a node's leg who still have this path's exit lane to cross,
  // or are in it: the car holds at the box edge.
  walkerBlocks(path) {
    const cw = this.nodes[path.node].crosswalk(path.exit);
    const laneLat = cw.laneLat(path.exitLane, false);
    for (const w of this.walkers) {
      if (w.done || w.node !== path.node || w.leg !== path.exit) continue;
      if (w.dir > 0 ? w.lat < laneLat + LANE_WIDTH / 2 + 1.0 : w.lat > laneLat - LANE_WIDTH / 2 - 1.0) return true;
    }
    return false;
  }

  walkersOn(node, leg) {
    let n = 0;
    for (const w of this.walkers) if (!w.done && w.node === node && w.leg === leg) n++;
    return n;
  }

  // A walker in this car's own lane on its entry zebra, ahead of its front
  // (#575): a car standing still, or nearly, holds where it is for them.
  // The zebra runs the CROSSWALK metres before the box edge; a walker's
  // place along the leg is that band's middle plus their jitter.
  walkerAheadOnEntry(car) {
    const p = car.path;
    if (car.v >= 2 || car.front > p.boxEnter || car.front < p.boxEnter - CROSSWALK - car.length - 1) return false;
    const cw = this.nodes[p.node].crosswalk(p.entry);
    const laneLat = cw.laneLat(p.lane, true);
    for (const w of this.walkers) {
      if (w.done || w.node !== p.node || w.leg !== p.entry) continue;
      if (Math.abs(w.lat - laneLat) > LANE_WIDTH / 2 + 0.6) continue;
      const along = p.boxEnter - CROSSWALK / 2 - w.jitter;   // the walker's s along this path
      if (along > car.front - 0.2) return true;
    }
    return false;
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
    const link = p.link;
    let best = null, bestGap = Infinity;
    for (const o of this.cars) {
      if (o === car || o.done) continue;
      const q = o.path;
      let pos;
      if (q === p) pos = o.s;
      else if (q.node !== p.node) {
        // across a handoff: a car already on the next box's approach, in my lane
        if (link && q.node === link.node && q.entry === link.entry && q.lane === p.exitLane && o.rear < q.boxEnter && car.front > p.boxExit) pos = o.s - link.atS + p.length;
        else continue;
      }
      else if (q.entry === p.entry && q.lane === p.lane && o.rear < q.boxEnter && car.front < p.boxEnter + 1) pos = o.s;
      else if (q.exit === p.exit && q.exitLane === p.exitLane && o.front > q.boxExit) pos = o.s - q.boxExit + p.boxExit;
      // the zipper (M7): a car in the next lane waiting at a closure's taper
      // to merge into mine, ahead of me, is my leader; I slow for it and the
      // room it needs comes. One beside me (its rear not ahead of my front)
      // is not: I drive on and the car behind me yields instead.
      else if (o.mergeS > 0 && o.mergeLane === p.lane && q.entry === p.entry && o.v < 1.5 && car.front < p.boxEnter && o.rear > car.front) pos = o.s;
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
      // a trusting driver (cars.js) looks at the light, not the box: a car
      // still crossing their line is not seen until it is a stationary body.
      // A merge at the exit is not a crossing, and the last 4 m are the exit.
      if (car.trusting && car.front < p.boxExit - 4 && o.v >= 0.5 && !o.crashed && o.path.node === p.node && o.path.exit !== p.exit && this.conflicts(p.movement, o.path.movement)) continue;
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

  // Queue length behind a movement's stop line, for induction loops: cars
  // stopped short of the box on that movement. A level with `loops` lists
  // the movements that have one; any other reads 0.
  queued(movement, node = 0) {
    if (this.loops && !this.loops.includes(movement)) return 0;
    let n = 0;
    for (const c of this.cars) if (!c.done && c.path.node === node && c.path.movement === movement && c.front < c.path.boxEnter && c.v < 1) n++;
    return n;
  }

  // Does this lane have a loop, given the level's list?
  hasLoop(node, leg, lane) {
    if (!this.sensors) return false;
    const net = this.nodes[node];
    for (const turn of ['L', 'T', 'R']) {
      const p = net.pathFor(leg, lane, turn);
      if (p && (!this.loops || this.loops.includes(p.movement))) return true;
    }
    return false;
  }

  // Is a car sitting on the loop in this lane (the `LOOP_LENGTH` metres
  // before the stop line)? The renderer lights the rectangle from this.
  onLoop(node, leg, lane) {
    for (const c of this.cars) {
      if (c.done || c.path.node !== node || c.path.entry !== leg || c.path.lane !== lane) continue;
      if (c.front > c.path.stopLine - LOOP_LENGTH && c.rear < c.path.stopLine + 0.5) return true;
    }
    return false;
  }

  // ---- the step -----------------------------------------------------------

  step() {
    const dt = DT;
    this.t += dt;
    this.tick++;
    this._holdPriority();
    this.controllers.forEach((ctl, i) => ctl.step(dt, this.sensors ? m => this.queued(m, i) : null));
    this._eventTick();
    this._spawnTick();
    this._pedTick(dt);
    this._mergeTick();

    // 1. verdicts, from the true present, recorded for later perception
    for (const car of this.cars) {
      if (car.done) continue;
      const ctl = this.controllerFor(car);
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
      car.easeLateral(dt);
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
      if (car.path.link && car.s >= car.path.length) this._handoff(car);
      else if (car.s - car.length >= car.path.length) {
        car.done = true;
        this.stats.cleared++;
        this.stats.waitCleared += car.wait;
        this.events.push({ t: this.t, kind: 'cleared', car: car.id, wait: car.wait, travel: this.t - car.spawnedAt });
      }
    }
    // 3. collisions
    this._collide();
    // 4. crashed cars are towed after a while; stalls in the box, per car
    let longest = 0;
    for (const car of this.cars) {
      if (car.done) continue;
      if (car.crashed && this.t - car.crashedAt >= this.crashClear) {
        car.done = true;
        this.events.push({ t: this.t, kind: 'towed', car: car.id });
      }
      // in the box by its true front and rear (touchesBox measures a truck
      // from its cab centre with the trailer's length and reads 4.7 m early)
      if (car.front > car.path.boxEnter && car.rear < car.path.boxExit && car.v < 0.3 && !car.done) { car.stallT += dt; this.stats.boxStalled += dt; }
      else car.stallT = 0;
      if (car.stallT > longest) longest = car.stallT;
    }
    this.boxStallT = longest;
    if (!this.stats.gridlock && (this.stats.maxWait >= this.gridlockWait || this.boxStallT >= this.boxStall)) {
      this.stats.gridlock = true; this.stats.gridlockAt = this.t;
      this.events.push({ t: this.t, kind: 'gridlock' });
    }
    // 5. drop finished cars
    if (this.tick % 60 === 0) this.cars = this.cars.filter(c => !c.done);
  }

  // The corridor handoff: the car's centre has passed the end of a linked
  // path. Pick the next turn from the level's weights among the paths its
  // lane can take at the next box, move `s` and the perception ring into the
  // new frame, and start the approach fresh.
  _handoff(car) {
    const old = car.path, link = old.link;
    const net = this.nodes[link.node];
    const choices = net.choicesFrom(link.entry, old.exitLane);
    if (!choices.length) { car.done = true; this.stats.cleared++; return; }
    const weights = {};
    for (const p of choices) weights[p.turn] = this.turns[p.turn] || 0;
    let turn = Object.values(weights).some(w => w > 0) ? this.rng.weighted(weights) : choices[0].turn;
    let next = choices.find(p => p.turn === turn) || choices[0];
    const shift = link.atS - old.length;
    car.path = next;
    car.s += shift;
    for (const h of car.hist) h.s += shift;
    car.stopVerdict = 0; car.boxVerdict = 0;
    car.newApproach();
    this.stats.handoffs++;
    this.events.push({ t: this.t, kind: 'handoff', car: car.id, to: next.movement, node: link.node });
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
        const who = [a, b].map(c => ({ id: c.id, archetype: c.archetype, movement: c.path.movement, node: c.path.node, committed: c.committed, v: +c.v.toFixed(1), head: this.controllerFor(c).head(c.path.movement), special: c.specialKind, front: +c.front.toFixed(1), stop: +c.stopVerdict.toFixed(1), box: +c.boxVerdict.toFixed(1) }));
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
    for (const c of this.cars) { if (!c.done) { mix(c.s); mix(c.v); mix(c.id); mix(c.path.node); } }
    for (const w of this.walkers) { if (!w.done) { mix(w.lat); mix(w.id); } }
    mix(this.stats.cleared); mix(this.stats.collisions); mix(this.stats.honks); mix(this.stats.pedLate); mix(this.stats.ambulanceLate); mix(this.stats.platoonSplits); mix(this.stats.merges);
    return h >>> 0;
  }

  snapshot() {
    return {
      t: this.t, stats: { ...this.stats }, controller: this.controller.snapshot(), controllers: this.controllers.map(c => c.snapshot()),
      cars: this.cars.filter(c => !c.done).map(c => ({ id: c.id, archetype: c.archetype, movement: c.path.movement, node: c.path.node, s: +c.s.toFixed(2), v: +c.v.toFixed(2), crashed: c.crashed, wait: +c.wait.toFixed(1) })),
      walkers: this.walkers.filter(w => !w.done).map(w => ({ id: w.id, node: w.node, leg: w.leg, lat: +w.lat.toFixed(2), v: +w.v.toFixed(2) })),
    };
  }
}
