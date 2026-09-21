// Signal City: the signal and intersection model. Pure: no DOM, no timers, no
// Math.random. The cars (js/cars.js) read it, the renderer draws it, the
// suite (test/signals.mjs) steps it by hand.
//
// Vocabulary
//   leg        one road meeting the intersection, named by compass point:
//              'N', 'E', 'S', 'W'. A T-junction has three.
//   movement   a vehicle path through the box, entry leg + turn: 'N-T' is
//              arriving from the north and going straight, 'N-L' left, 'N-R'
//              right. Pedestrian crossings are 'P-N', crossing the north leg.
//   phase      a set of movements that may run at once. The constructor
//              refuses a phase holding two movements that conflict.
//   head       the lamp state a movement's driver sees:
//              red | yellow | green | green-arrow | yellow-arrow |
//              flash-red | flash-yellow | dark
//
// Conflicts come from geometry, not a hand table. Every leg has an inbound
// point and an outbound point on a ring around the box (right-hand driving:
// the inbound half of a road is on the driver's right as they arrive), so a
// movement is a chord from its entry leg's inbound point to its exit leg's
// outbound point. Two chords conflict when their endpoints interleave (they
// cross inside the box) or when they land on the same outbound point (they
// merge). A right turn hugs its corner and crosses nothing. A pedestrian
// crossing on a leg conflicts with everything entering that leg and with
// everything leaving it except a right turn, which yields to the walker
// instead.
//
// Timing. A phase change is always green -> yellow -> all-red -> next green.
// Yellow and all-red are per-controller numbers the player can tune (the
// all-red clearance is mechanic 2 in the unlock order). A request that lands
// mid-clearance waits its turn.

export const LEGS = ['N', 'E', 'S', 'W'];
export const TURNS = ['L', 'T', 'R'];

const LEG_INDEX = { N: 0, E: 1, S: 2, W: 3 };

// The leg a turn from `entry` exits by. Left of a southbound car is east.
export function exitLeg(entry, turn) {
  const i = LEG_INDEX[entry];
  const d = turn === 'T' ? 2 : turn === 'L' ? 1 : 3;
  return LEGS[(i + d) % 4];
}

export function parseMovement(id) {
  const [a, b] = id.split('-');
  if (a === 'P') return { id, ped: true, leg: b };
  return { id, ped: false, entry: a, turn: b, exit: exitLeg(a, b) };
}

// Ring points: index 2*leg for inbound, 2*leg + 1 for outbound.
function inPoint(leg) { return LEG_INDEX[leg] * 2; }
function outPoint(leg) { return LEG_INDEX[leg] * 2 + 1; }

function between(x, a, b) {
  // strictly between a and b going clockwise around 8 points
  const span = (b - a + 8) % 8;
  const off = (x - a + 8) % 8;
  return off > 0 && off < span;
}

// Do two vehicle movements conflict? Same entry leg never conflicts (they are
// parallel lanes or the same lane).
export function conflicts(aId, bId) {
  if (aId === bId) return false;
  const a = typeof aId === 'string' ? parseMovement(aId) : aId;
  const b = typeof bId === 'string' ? parseMovement(bId) : bId;
  if (a.ped && b.ped) return false;
  if (a.ped || b.ped) {
    const p = a.ped ? a : b;
    const m = a.ped ? b : a;
    if (m.entry === p.leg) return true;
    if (m.exit === p.leg && m.turn !== 'R') return true;
    return false;
  }
  if (a.entry === b.entry) return false;
  const a1 = inPoint(a.entry), a2 = outPoint(a.exit);
  const b1 = inPoint(b.entry), b2 = outPoint(b.exit);
  if (a2 === b2) return true; // merge into the same outbound lane
  const inA1 = between(b1, a1, a2), inA2 = between(b2, a1, a2);
  return inA1 !== inA2;
}

// A trucker mid-turn sweeps wider than its chord: it also blocks the other
// lanes of its own entry leg and of its exit leg. The cars use this on top of
// `conflicts` when the turning vehicle is flagged wide.
export function wideConflicts(aId, bId) {
  if (aId === bId) return false;
  const a = parseMovement(aId), b = parseMovement(bId);
  if (a.ped || b.ped) return conflicts(a, b);
  if (a.turn === 'T') return conflicts(a, b);
  return conflicts(a, b) || a.entry === b.entry || a.exit === b.exit || a.exit === b.entry;
}

// Every vehicle movement an intersection with these legs can carry.
export function movementsFor(legs) {
  const out = [];
  for (const entry of legs) {
    for (const turn of TURNS) {
      const exit = exitLeg(entry, turn);
      if (legs.includes(exit)) out.push(`${entry}-${turn}`);
    }
  }
  return out;
}

export function pedMovementsFor(legs) {
  return legs.map(l => `P-${l}`);
}

// The conflict matrix as a Map of id -> Set of ids, for a legs list.
export function conflictMatrix(legs, { peds = false } = {}) {
  const ids = movementsFor(legs).concat(peds ? pedMovementsFor(legs) : []);
  const m = new Map();
  for (const a of ids) {
    const set = new Set();
    for (const b of ids) if (conflicts(a, b)) set.add(b);
    m.set(a, set);
  }
  return m;
}

// A permissive left is allowed to conflict: its driver yields (js/cars.js),
// which is what "permissive" means. Anything else that conflicts is refused.
export function phaseIsValid(movements, permissive = []) {
  for (let i = 0; i < movements.length; i++) {
    for (let j = i + 1; j < movements.length; j++) {
      if (permissive.includes(movements[i]) || permissive.includes(movements[j])) continue;
      if (conflicts(movements[i], movements[j])) return { ok: false, pair: [movements[i], movements[j]] };
    }
  }
  return { ok: true };
}

// The standard phase sets a level can start from.
export function standardPhases(legs, { lefts = false } = {}) {
  const has = l => legs.includes(l);
  const group = (a, b) => {
    const ms = [];
    for (const e of [a, b]) {
      if (!has(e)) continue;
      for (const t of ['T', 'R']) if (has(exitLeg(e, t))) ms.push(`${e}-${t}`);
      if (!lefts && has(exitLeg(e, 'L'))) ms.push(`${e}-L`); // permissive, yields
    }
    return ms;
  };
  const phases = [];
  const ns = group('N', 'S'), ew = group('E', 'W');
  if (ns.length) phases.push({ name: 'N-S', movements: ns });
  if (lefts) {
    const l = ['N-L', 'S-L'].filter(m => has(m[0]) && has(exitLeg(m[0], 'L')));
    if (l.length) phases.push({ name: 'N-S lefts', movements: l });
  }
  if (ew.length) phases.push({ name: 'E-W', movements: ew });
  if (lefts) {
    const l = ['E-L', 'W-L'].filter(m => has(m[0]) && has(exitLeg(m[0], 'L')));
    if (l.length) phases.push({ name: 'E-W lefts', movements: l });
  }
  // A left that shares its phase with its own through is permissive: it
  // conflicts with the opposing through by geometry and its driver yields.
  for (const p of phases) {
    p.permissive = p.movements.filter(m => parseMovement(m).turn === 'L'
      && p.movements.some(o => parseMovement(o).entry === parseMovement(m).entry && parseMovement(o).turn === 'T'));
  }
  return phases;
}

export const DEFAULT_TIMING = { yellow: 3, allRed: 1, minGreen: 4 };

export const STAGES = ['green', 'yellow', 'allred', 'flash', 'dark'];

// Stage times accumulate dt, so "3 s of yellow" can read 2.9999999999999996
// after thirty steps of 0.1. Every "has this stage run its time" compare
// allows this much slack rather than slipping a whole step.
const EPS = 1e-9;

// Controller: one intersection's brain.
export class Controller {
  constructor({
    legs = LEGS.slice(),
    phases,
    timing = {},
    mode = 'manual',      // 'manual' | 'timed'
    plan = null,          // timed: [{ phase: index, green: seconds }]
    offset = 0,           // timed: seconds the cycle is shifted by
    rules = [],           // [{ when: 'elapsed', seconds, then }] | [{ when: 'queue', movement, threshold, then }]
    flash = null,         // null | 'red' | { major: ['N','S'] } (major legs flash yellow, others red)
    startPhase = 0,
  } = {}) {
    this.legs = legs.slice();
    this.movements = movementsFor(this.legs);
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.phases = (phases || standardPhases(this.legs)).map((p, i) => {
      const v = phaseIsValid(p.movements, p.permissive || []);
      if (!v.ok) throw new Error(`phase ${p.name || i} holds a conflicting pair: ${v.pair.join(' vs ')}`);
      return { name: p.name || `phase ${i + 1}`, movements: p.movements.slice(), permissive: (p.permissive || []).slice() };
    });
    if (!this.phases.length) throw new Error('a controller needs at least one phase');
    this.mode = mode;
    this.plan = plan;
    this.offset = offset;
    this.rules = rules.map(r => ({ ...r }));
    this.t = 0;
    this.phase = startPhase;
    this.stage = 'green';
    this.stageT = 0;
    this.next = null;      // phase index queued during clearance, or null
    this.preemption = null; // { movements, hold, resume } while a priority corridor holds the box
    this.flash = null;
    this.log = [];         // transitions, for the suite and the HUD
    if (flash) this.setFlash(flash);
    if (mode === 'timed') this._alignToPlan();
  }

  // ---- queries ------------------------------------------------------------

  get current() { return this.preemption ? { name: 'priority', movements: this.preemption.movements, permissive: [] } : this.phases[this.phase]; }

  isGreen(movement) { return this.stage === 'green' && this.current.movements.includes(movement); }

  // Head state as the driver of `movement` sees it.
  head(movement) {
    if (this.stage === 'dark') return 'dark';
    if (this.stage === 'flash') {
      const f = this.flash;
      if (f === 'red') return 'flash-red';
      const mv = parseMovement(movement);
      return f.major.includes(mv.ped ? mv.leg : mv.entry) ? 'flash-yellow' : 'flash-red';
    }
    const cur = this.current;
    if (!cur.movements.includes(movement)) return 'red';
    const mv = parseMovement(movement);
    const protectedLeft = !mv.ped && mv.turn === 'L' && !cur.permissive.includes(movement);
    if (this.stage === 'green') return protectedLeft ? 'green-arrow' : 'green';
    if (this.stage === 'yellow') return protectedLeft ? 'yellow-arrow' : 'yellow';
    return 'red';
  }

  // Seconds until this movement's green ends, Infinity if it is not green or
  // nothing is scheduled to end it. Granny reads this.
  timeToYellow(movement) {
    if (!this.isGreen(movement)) return Infinity;
    if (this.next !== null) return Math.max(0, this.timing.minGreen - this.stageT);
    if (this.preemption) return Math.max(0, this.preemption.hold - this.stageT);
    if (this.mode === 'timed' && this.plan) {
      const green = this.plan[this._planIndex()].green;
      return Math.max(0, green - this.stageT);
    }
    for (const r of this.rules) {
      if (r.when === 'elapsed') return Math.max(0, r.seconds - this.stageT);
    }
    return Infinity;
  }

  cycleLength() {
    if (!this.plan) return 0;
    const { yellow, allRed } = this.timing;
    return this.plan.reduce((s, p) => s + p.green + yellow + allRed, 0);
  }

  // ---- commands -----------------------------------------------------------

  // Ask for a phase. Returns true if it will happen (now or after the
  // clearance already in flight), false if it is already the phase in force.
  requestPhase(i) {
    if (i < 0 || i >= this.phases.length) throw new RangeError(`no phase ${i}`);
    if (this.stage === 'flash' || this.stage === 'dark') {
      this.stage = 'allred';
      this.stageT = 0;
      this.next = i;
      this.flash = null;
      this._log('resume', i);
      return true;
    }
    if (this.preemption) { this.preemption.resume = i; return true; }
    if (i === this.phase && this.stage === 'green' && this.next === null) return false;
    if (this.next !== null) { this.next = i; return true; }
    if (this.stage === 'green') {
      this.next = i;
      if (this.stageT >= this.timing.minGreen - EPS) this._beginYellow();
      return true;
    }
    this.next = i;
    return true;
  }

  requestNext() { return this.requestPhase((this.phase + 1) % this.phases.length); }

  setTiming(patch) { Object.assign(this.timing, patch); }

  // 'red': four-way flashing red. { major: ['N','S'] }: those legs flash
  // yellow, the rest red. null: back to phase 0 through an all-red.
  setFlash(f) {
    if (!f) return this.requestPhase(this.phase);
    this.flash = f;
    this.stage = 'flash';
    this.stageT = 0;
    this.next = null;
    this.preemption = null;
    this._log('flash', f);
    return true;
  }

  setDark() {
    this.stage = 'dark';
    this.stageT = 0;
    this.next = null;
    this.preemption = null;
    this._log('dark');
  }

  // Priority corridor: hold green for `movements` (an emergency vehicle's
  // path) for `hold` seconds, then go back to the phase that was running.
  preempt(movements, hold = 15) {
    const v = phaseIsValid(movements);
    if (!v.ok) throw new Error(`priority set conflicts: ${v.pair.join(' vs ')}`);
    const resume = this.next !== null ? this.next : this.phase;
    const already = this.stage === 'green' && movements.every(m => this.current.movements.includes(m));
    this.preemption = { movements: movements.slice(), hold, resume };
    this.next = null;
    if (!already) {
      if (this.stage === 'green') this._beginYellow();
      else if (this.stage === 'flash' || this.stage === 'dark') { this.stage = 'allred'; this.stageT = 0; this.flash = null; }
    }
    this._log('preempt', movements.join(','));
  }

  // ---- stepping -----------------------------------------------------------

  // `sense` is an optional function(movement) -> queued vehicle count, used by
  // 'queue' rules (induction loops, mechanic 6). Without it those rules sleep.
  step(dt, sense = null) {
    this.t += dt;
    this.stageT += dt;
    const { yellow, allRed } = this.timing;
    switch (this.stage) {
      case 'green':
        if (this.preemption) {
          if (this.stageT >= this.preemption.hold - EPS) {
            const back = this.preemption.resume;
            this.preemption = null;
            this.next = back;
            this._beginYellow();
          }
          break;
        }
        if (this.next !== null) {
          if (this.stageT >= this.timing.minGreen - EPS) this._beginYellow();
          break;
        }
        if (this.mode === 'timed' && this.plan) {
          const green = this.plan[this._planIndex()].green;
          if (this.stageT >= green - EPS) {
            this.next = this.plan[(this._planIndex() + 1) % this.plan.length].phase;
            this._beginYellow();
          }
          break;
        }
        this._runRules(sense);
        break;
      case 'yellow':
        if (this.stageT >= yellow - EPS) { this.stage = 'allred'; this.stageT -= yellow; this._log('allred'); }
        break;
      case 'allred':
        if (this.stageT >= allRed - EPS) {
          if (this.preemption && !this.preemption.done) {
            // arriving into the priority hold
            this.preemption.done = true;
          } else if (this.next !== null) {
            this.phase = this.next;
            this.next = null;
          }
          this.stage = 'green';
          this.stageT -= allRed;
          this._log('green', this.current.name);
        }
        break;
      default:
        break; // flash and dark hold until told otherwise
    }
  }

  // ---- internals ----------------------------------------------------------

  _beginYellow() {
    if (this.stage !== 'green') return;
    this.stage = 'yellow';
    this.stageT = 0;
    this._log('yellow');
  }

  _runRules(sense) {
    for (const r of this.rules) {
      let fire = false;
      if (r.when === 'elapsed') fire = this.stageT >= r.seconds - EPS;
      else if (r.when === 'queue') {
        if (!sense) continue;
        if (this.current.movements.includes(r.movement)) continue; // it is being served
        fire = sense(r.movement) >= r.threshold && this.stageT >= this.timing.minGreen - EPS;
      }
      if (!fire) continue;
      const target = r.then === 'next' || r.then === undefined ? (this.phase + 1) % this.phases.length : r.then;
      if (target === this.phase) continue;
      this.next = target;
      this._beginYellow();
      return;
    }
  }

  _planIndex() {
    const i = this.plan.findIndex(p => p.phase === this.phase);
    return i < 0 ? 0 : i;
  }

  // Timed mode starts mid-cycle so that corridors can be offset from one
  // another: at t = 0 the controller is `offset` seconds into its cycle.
  _alignToPlan() {
    if (!this.plan || !this.plan.length) { this.mode = 'manual'; return; }
    const { yellow, allRed } = this.timing;
    const L = this.cycleLength();
    let x = ((this.offset % L) + L) % L;
    for (const p of this.plan) {
      if (x < p.green) { this.phase = p.phase; this.stage = 'green'; this.stageT = x; return; }
      x -= p.green;
      if (x < yellow) { this.phase = p.phase; this.stage = 'yellow'; this.stageT = x; this.next = this.plan[(this.plan.indexOf(p) + 1) % this.plan.length].phase; return; }
      x -= yellow;
      if (x < allRed) { this.phase = p.phase; this.stage = 'allred'; this.stageT = x; this.next = this.plan[(this.plan.indexOf(p) + 1) % this.plan.length].phase; return; }
      x -= allRed;
    }
    this.phase = this.plan[0].phase; this.stage = 'green'; this.stageT = 0;
  }

  _log(kind, detail = '') {
    this.log.push({ t: +this.t.toFixed(3), kind, detail });
    if (this.log.length > 200) this.log.shift();
  }

  // A plain snapshot for saves and the debug hook.
  snapshot() {
    return {
      t: this.t, phase: this.phase, stage: this.stage, stageT: this.stageT, next: this.next,
      heads: Object.fromEntries(this.movements.map(m => [m, this.head(m)])),
    };
  }
}
