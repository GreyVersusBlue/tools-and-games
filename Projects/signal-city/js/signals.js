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
//
// The offset (M7). A timed controller is `offset` seconds into its cycle at
// t = 0, so two boxes on one street can be set apart. Changing it on a
// running controller (`setOffset`) is not a jump: the controller keeps its
// stage and works off the difference over the greens that follow, each one
// cut no shorter than the minimum green or stretched to at most twice its
// plan, whichever direction round the cycle is the shorter, and every
// change still runs yellow and all-red. `shift` is what is left to absorb.
// `forecast` steps a copy ahead so the page can draw the windows to come.
//
// Pedestrians (M6). A walk is not a phase of its own: it is a flag on a
// through phase (`walks: ['P-N', 'P-S']` on the E-W phase, the crossings
// parallel to its traffic), because on every standard phase set the walk
// that can run with a through phase is exactly the one the geometry
// already permits, and a walk phase of its own would cost every driver a
// whole cycle for one walker. A call (`callPed(leg)`) is served when the
// phase carrying that walk is green: at once if the green has just begun or
// has time enough left, else at its next green. While a walk runs (WALK for
// `pedTiming.walk` seconds, then the flashing clearance for
// `pedTiming.clear`) the green cannot end: a request, a rule or the plan
// waits for the clearance. That is the mechanic the player feels.

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

// The walks a phase may carry: the crossings of the legs its traffic does
// not enter or leave except by a yielding right. Refuses a walk that
// conflicts with any movement in the phase that is not permissive.
export function walksFor(legs, movements, permissive = []) {
  return pedMovementsFor(legs).filter(w => movements.every(m => permissive.includes(m) || !conflicts(w, m)));
}

// The standard phase sets a level can start from. `lefts`: false is two
// phases with permissive lefts; true is four, the lefts protected on their
// own arrow and red during the throughs; 'both' is four with the lefts also
// permissive during their street's through phase (the flashing-yellow-arrow
// intersection: a left takes a gap if it sees one and its arrow if it does
// not), which is what a shared through-and-left lane needs. `peds` adds the
// walks each phase can carry: the through phases get the crossings parallel
// to them, the lefts phases none.
// `main` names the street phase 0 serves ('NS' or 'EW'): phase 0 is the
// main street everywhere (majorLegs, a timed plan's first entry), and a
// corridor's main street runs east-west.
export function standardPhases(legs, { lefts = false, peds = false, main = 'NS' } = {}) {
  const has = l => legs.includes(l);
  const group = (a, b) => {
    const ms = [];
    for (const e of [a, b]) {
      if (!has(e)) continue;
      for (const t of ['T', 'R']) if (has(exitLeg(e, t))) ms.push(`${e}-${t}`);
      if (lefts !== true && has(exitLeg(e, 'L'))) ms.push(`${e}-L`); // permissive, yields
    }
    return ms;
  };
  const phases = [];
  const street = (a, b) => {
    const ms = group(a, b);
    if (ms.length) phases.push({ name: `${a}-${b}`, movements: ms });
    if (lefts) {
      const l = [`${a}-L`, `${b}-L`].filter(m => has(m[0]) && has(exitLeg(m[0], 'L')));
      if (l.length) phases.push({ name: `${a}-${b} lefts`, movements: l });
    }
  };
  if (main === 'EW') { street('E', 'W'); street('N', 'S'); }
  else { street('N', 'S'); street('E', 'W'); }
  // A left that shares its phase with its own through is permissive: it
  // conflicts with the opposing through by geometry and its driver yields.
  for (const p of phases) {
    p.permissive = p.movements.filter(m => parseMovement(m).turn === 'L'
      && p.movements.some(o => parseMovement(o).entry === parseMovement(m).entry && parseMovement(o).turn === 'T'));
    p.walks = peds ? walksFor(legs, p.movements, p.permissive) : [];
  }
  return phases;
}

export const DEFAULT_TIMING = { yellow: 3, allRed: 1, minGreen: 4 };
// WALK for `walk` seconds, then the flashing clearance for `clear`. The
// world sets `clear` from the road's width at 1.2 m/s (a slow walker) and a
// level may override it.
export const DEFAULT_PED_TIMING = { walk: 7, clear: 8 };

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
    lefts = false,        // no phases given: standardPhases with protected lefts
    peds = false,         // no phases given: standardPhases with walks on the through phases
    main = 'NS',          // no phases given: which street phase 0 serves
    timing = {},
    pedTiming = {},
    mode = 'manual',      // 'manual' | 'timed'
    plan = null,          // timed: [{ phase: index, green: seconds }]
    offset = 0,           // timed: seconds the cycle is shifted by
    rules = [],           // [{ when: 'elapsed', seconds, then }] | [{ when: 'queue', movement, threshold, after?, then }]
    flash = null,         // null | 'red' | { major: ['N','S'] } (major legs flash yellow, others red)
    startPhase = 0,
  } = {}) {
    this.legs = legs.slice();
    this.movements = movementsFor(this.legs);
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.pedTiming = { ...DEFAULT_PED_TIMING, ...pedTiming };
    this.phases = (phases || standardPhases(this.legs, { lefts, peds, main })).map((p, i) => {
      const v = phaseIsValid(p.movements, p.permissive || []);
      if (!v.ok) throw new Error(`phase ${p.name || i} holds a conflicting pair: ${v.pair.join(' vs ')}`);
      const walks = (p.walks || []).slice();
      const allowed = walksFor(this.legs, p.movements, p.permissive || []);
      for (const w of walks) if (!allowed.includes(w)) throw new Error(`phase ${p.name || i} cannot carry ${w}: it crosses a movement in the phase`);
      return { name: p.name || `phase ${i + 1}`, movements: p.movements.slice(), permissive: (p.permissive || []).slice(), walks };
    });
    if (!this.phases.length) throw new Error('a controller needs at least one phase');
    this.mode = mode;
    this.plan = plan;
    this.offset = offset;
    this.shift = 0;        // seconds of plan still to lose (> 0, greens cut) or gain (< 0, greens stretched) after setOffset
    this.rules = rules.map(r => ({ ...r }));
    this.t = 0;
    this.phase = startPhase;
    this.stage = 'green';
    this.stageT = 0;
    this.heldT = 0;        // stageT at the last holdGreen: the elapsed rules count from here
    this.next = null;      // phase index queued during clearance, or null
    this.resumeAt = null;  // where 'next' goes after a queue rule jumped the sequence
    this.preemption = null; // { movements, hold, resume } while a priority corridor holds the box
    this.flash = null;
    this.pedCalls = new Set();   // legs with a call waiting, 'N' for P-N
    this.walk = null;            // { legs, stage: 'walk' | 'clear', t } while a walk runs
    this.walksServed = 0;
    this.log = [];         // transitions, for the suite and the HUD
    if (flash) this.setFlash(flash);
    if (mode === 'timed') this._alignToPlan();
  }

  // ---- queries ------------------------------------------------------------

  get current() { return this.preemption ? { name: 'priority', movements: this.preemption.movements, permissive: [], walks: [] } : this.phases[this.phase]; }

  get hasPeds() { return this.phases.some(p => p.walks.length); }

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
    return Math.max(this._scheduledEnd(), this.walkRemaining());
  }

  // Seconds of green left by the plan, the rules or a queued request; no
  // walk considered. Infinity when nothing is scheduled to end it.
  _scheduledEnd() {
    if (this.next !== null) return Math.max(0, this.timing.minGreen - this.stageT);
    if (this.preemption) return Math.max(0, this.preemption.hold - this.stageT);
    if (this.mode === 'timed' && this.plan) return Math.max(0, this._plannedGreen() - this.stageT);
    for (const r of this.rules) {
      if (r.when === 'elapsed') return Math.max(0, r.seconds - (this.stageT - this.heldT));
    }
    return Infinity;
  }

  // ---- pedestrians --------------------------------------------------------

  // Seconds until the walk in progress has cleared, 0 with none.
  walkRemaining() {
    if (!this.walk) return 0;
    const { walk, clear } = this.pedTiming;
    return Math.max(0, (this.walk.stage === 'walk' ? walk + clear : clear) - this.walk.t);
  }

  // The lamp a walker on leg `leg` sees: 'walk', 'clear' (flashing don't
  // walk, the clearance) or 'dont-walk'.
  pedHead(leg) {
    if (this.walk && this.walk.legs.includes(leg)) return this.walk.stage;
    return 'dont-walk';
  }

  // Press the call button on a leg. Returns 'walk' if that crossing is in
  // its WALK interval right now (step off, no call needed), true if a call
  // was registered, false if one was already waiting or no phase carries
  // that crossing.
  callPed(leg) {
    if (!this.phases.some(p => p.walks.includes(`P-${leg}`))) return false;
    if (this.pedHead(leg) === 'walk') return 'walk';
    if (this.pedCalls.has(leg)) return false;
    this.pedCalls.add(leg);
    return true;
  }

  // Start the walk for every called crossing the current phase carries.
  _startWalk() {
    const legs = this.current.walks.map(w => w.slice(2)).filter(l => this.pedCalls.has(l));
    if (!legs.length) return false;
    for (const l of legs) this.pedCalls.delete(l);
    this.walk = { legs, stage: 'walk', t: 0 };
    this.walksServed++;
    this._log('walk', legs.join(','));
    return true;
  }

  // A call is served on this green if the green has just begun (the walk
  // extends it) or has time enough left for the walk and its clearance;
  // otherwise it waits for the phase's next green.
  _walkFits() {
    if (this.walk || this.next !== null || this.preemption) return false;
    if (this.stageT < 0.5) return true;
    const { walk, clear } = this.pedTiming;
    return this._scheduledEnd() >= walk + clear;
  }

  _stepWalk(dt) {
    if (!this.walk) return;
    this.walk.t += dt;
    const { walk, clear } = this.pedTiming;
    if (this.walk.stage === 'walk' && this.walk.t >= walk - EPS) { this.walk.stage = 'clear'; this.walk.t -= walk; this._log('clear', this.walk.legs.join(',')); }
    else if (this.walk.stage === 'clear' && this.walk.t >= clear - EPS) { this.walk = null; this._log('dont-walk'); }
  }

  // Seconds until this movement's green begins, when one is already on its
  // way (yellow or all-red running with this movement in the queued phase),
  // 0 if it is green now, else Infinity. An anticipating driver reads this.
  timeToGreen(movement) {
    if (this.isGreen(movement)) return 0;
    if (this.next === null || this.preemption) return Infinity;
    if (!this.phases[this.next].movements.includes(movement)) return Infinity;
    const { yellow, allRed } = this.timing;
    if (this.stage === 'yellow') return Math.max(0, yellow - this.stageT) + allRed;
    if (this.stage === 'allred') return Math.max(0, allRed - this.stageT);
    return Infinity;
  }

  cycleLength() {
    if (!this.plan) return 0;
    const { yellow, allRed } = this.timing;
    return this.plan.reduce((s, p) => s + p.green + yellow + allRed, 0);
  }

  // Seconds into the plan's cycle the controller is right now, by the plan's
  // own greens (a green being cut or stretched reads by where its clock is).
  // 0 with no plan.
  cyclePosition() {
    if (!this.plan || !this.plan.length) return 0;
    const { yellow, allRed } = this.timing;
    let x = 0;
    const k = this._planIndex();
    for (let i = 0; i < k; i++) x += this.plan[i].green + yellow + allRed;
    if (this.stage === 'green') return x + Math.min(this.stageT, this.plan[k].green);
    if (this.stage === 'yellow') return x + this.plan[k].green + Math.min(this.stageT, yellow);
    if (this.stage === 'allred') return x + this.plan[k].green + yellow + Math.min(this.stageT, allRed);
    return x;
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
    this.resumeAt = null;   // a hand on the phases restarts the sequence from there
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

  // Hold the running green (M7): the elapsed rule that would end it counts
  // from now again, so a hand can keep a green under a platoon on a level
  // that cycles itself. Only a manual green with nothing queued and an
  // elapsed rule to hold against: a timed plan keeps its offsets, a queued
  // request keeps its turn, and a green nothing will end needs no holding.
  // The stage clock itself is untouched (the minimum green, a walk's fit,
  // a queue rule's `after` all still read it).
  holdGreen() {
    if (this.stage !== 'green' || this.next !== null || this.preemption) return false;
    if (this.mode === 'timed' && this.plan) return false;
    if (!this.rules.some(r => r.when === 'elapsed')) return false;
    this.heldT = this.stageT;
    this._log('hold', this.current.name);
    return true;
  }

  setTiming(patch) { Object.assign(this.timing, patch); }

  // Move a running timed plan to a new offset through its own transitions.
  // The controller has to end up `d = (o - offset) mod L` seconds further
  // along its cycle: it can lose d seconds by cutting the greens to come
  // (never below the minimum green) or gain L - d by stretching them (never
  // past twice their plan), and it takes whichever is fewer seconds. The
  // stage in force is untouched at the call; the difference is absorbed
  // green by green from the next green end, each through yellow and
  // all-red. Returns the signed seconds queued (> 0 cut, < 0 stretched).
  // Without a plan the number is just stored.
  setOffset(o) {
    if (typeof o !== 'number' || !Number.isFinite(o)) throw new RangeError(`offset ${o}`);
    const was = this.offset;
    this.offset = o;
    if (this.mode !== 'timed' || !this.plan || !this.plan.length) return 0;
    const L = this.cycleLength();
    const d = ((((o - was) + this.shift) % L) + L) % L;   // what is still owed, all told, as a forward distance
    this.shift = d < EPS || L - d < EPS ? 0 : d <= L - d ? d : -(L - d);
    this._log('offset', o);
    return this.shift;
  }

  // The green this plan entry runs this time round: the plan's, less what
  // a shift still has to cut (to the minimum green), or plus what it has to
  // stretch (to twice the plan).
  _plannedGreen() {
    const base = this.plan[this._planIndex()].green;
    if (this.shift > EPS) return Math.max(this.timing.minGreen, base - this.shift);
    if (this.shift < -EPS) return base + Math.min(-this.shift, base);
    return base;
  }

  // A copy that steps on its own: same plan, rules and state, its own log.
  // `forecast` uses it; the page draws from it.
  clone() {
    const c = Object.create(Controller.prototype);
    Object.assign(c, this);
    c.timing = { ...this.timing };
    c.pedTiming = { ...this.pedTiming };
    c.rules = this.rules.map(r => ({ ...r }));
    c.pedCalls = new Set(this.pedCalls);
    c.walk = this.walk ? { ...this.walk } : null;
    c.preemption = this.preemption ? { ...this.preemption } : null;
    c.log = [];
    return c;
  }

  // The head `movement` will show over the next `seconds`, as runs of
  // [{ from, to, head }] in seconds from now, by stepping a copy at `dt`.
  // Queue rules are stepped without a sensor (nothing to sense ahead of
  // time), so a sensed plan forecasts as its timed plan alone.
  forecast(movement, seconds, dt = 0.25) {
    const c = this.clone();
    const out = [];
    let head = c.head(movement), from = 0;
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 1; i <= n; i++) {
      c.step(dt);
      const h = c.head(movement);
      if (h !== head) { out.push({ from, to: i * dt, head }); head = h; from = i * dt; }
    }
    out.push({ from, to: n * dt, head });
    return out;
  }

  // Replace the rule list. The panel edits a copy and hands it back here, so
  // a half-typed row never runs. A rule naming a phase index that does not
  // exist is refused and the list is left as it was.
  setRules(rules) {
    for (const r of rules) {
      if (typeof r.then === 'number' && (r.then < 0 || r.then >= this.phases.length || !Number.isInteger(r.then))) throw new RangeError(`no phase ${r.then}`);
    }
    this.rules = rules.map(r => ({ ...r }));
  }

  // The legs that flash yellow in a major/minor flash: the entries of phase
  // 0, which is the main street on every standard phase set.
  majorLegs() {
    const legs = new Set();
    for (const m of this.phases[0].movements) { const mv = parseMovement(m); if (!mv.ped) legs.add(mv.entry); }
    return LEGS.filter(l => legs.has(l));
  }

  // 'red': four-way flashing red. { major: ['N','S'] }: those legs flash
  // yellow, the rest red. null: back to phase 0 through an all-red.
  setFlash(f) {
    if (!f) return this.requestPhase(this.phase);
    this.flash = f;
    this.stage = 'flash';
    this.stageT = 0;
    this.next = null;
    this.preemption = null;
    this.walk = null;
    this._log('flash', f);
    return true;
  }

  setDark() {
    this.stage = 'dark';
    this.stageT = 0;
    this.next = null;
    this.preemption = null;
    this.walk = null;
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
    this.walk = null;   // an emergency cuts the walk short; walkers already on the road are the world's
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
        this._stepWalk(dt);
        if (this.pedCalls.size && this._walkFits()) this._startWalk();
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
          if (this.stageT >= this._plannedGreen() - EPS) {
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
          this.heldT = 0;
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
    if (this.walk) return;   // the green holds until the walk has cleared; callers set `next` first and retry
    if (this.mode === 'timed' && this.plan && !this.preemption) this._absorbShift();
    this.stage = 'yellow';
    this.stageT = 0;
    this.heldT = 0;
    this._log('yellow');
  }

  // A queue rule that jumps to a phase is an insertion, not a skip: the
  // phase 'next' would have brought is remembered, and the first 'next' after
  // the jump goes there. Without this a full N bay during E-W pulled N-S
  // lefts, 'next' went back to E-W, and the N-S throughs waited 180 s
  // (Crossing locked 3 of 6 seeds).
  _runRules(sense) {
    for (const r of this.rules) {
      let fire = false;
      if (r.when === 'elapsed') fire = this.stageT - this.heldT >= r.seconds - EPS;
      else if (r.when === 'queue') {
        if (!sense) continue;
        if (this.current.movements.includes(r.movement)) continue; // it is being served
        // `after`: the green this rule may not cut short, the minimum green by default
        const after = Math.max(this.timing.minGreen, r.after || 0);
        fire = sense(r.movement) >= r.threshold && this.stageT >= after - EPS;
      }
      if (!fire) continue;
      const n = this.phases.length;
      const isNext = r.then === 'next' || r.then === undefined;
      const target = isNext ? (this.resumeAt !== null ? this.resumeAt : (this.phase + 1) % n) : r.then;
      if (target === this.phase) continue;
      if (isNext) this.resumeAt = null;
      else if (r.when === 'queue') { const after = (this.phase + 1) % n; this.resumeAt = after === target ? (after + 1) % n : after; }
      this.next = target;
      this._beginYellow();
      return;
    }
  }

  // A timed green is ending: what it lost against the plan (or gained) comes
  // off the shift, a hand on the phases included, and a shift that changed
  // sign from stepping past zero is done.
  _absorbShift() {
    if (Math.abs(this.shift) < EPS) return;
    const base = this.plan[this._planIndex()].green;
    const was = this.shift;
    this.shift -= base - this.stageT;
    if (Math.abs(this.shift) < 1e-6 || (was > 0) !== (this.shift > 0)) this.shift = 0;
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
      t: this.t, phase: this.phase, stage: this.stage, stageT: this.stageT, heldT: this.heldT, next: this.next, offset: this.offset, shift: this.shift,
      heads: Object.fromEntries(this.movements.map(m => [m, this.head(m)])),
      walk: this.walk ? { ...this.walk } : null, pedCalls: [...this.pedCalls],
    };
  }
}
