// clearance.js — the chair: what a seated body needs of a building, said once.
//
// Phase 40. "Accessibility stops at routes" was the backlog's own sentence:
// the accessible graph knew which stairs to leave out and which doorways were
// too narrow, and nothing else in the tool had ever sat in the chair — no
// turning circles, no reach ranges, no counter heights, and a walkthrough with
// exactly one body in it, a tall adult standing up.
//
// This module is the two gaps closed as one thing. Everything the analysis
// needs to know about a seated person — how wide, how high the eye, what a
// wheel rolls over, how steep a ramp may be, how big a circle it turns in, how
// far an arm reaches — is a constant here, and everything the *walkthrough*
// needs to know about the same person is the same constant read through
// `seatedStep()`. The report and the first-person camera derive from one
// contract, which is the only way they can never disagree about a doorway:
//
//   doorRolls(w, leaf)   the accessible graph keeps a doorway iff this says so,
//                        and a seated walker is refused at a doorway iff this
//                        says so — the same function, called from both sides.
//   rampRolls(link)      the same for a ramp: 1:12 is the most a chair climbs.
//   seatedStep()         the body, as the options collide.js's `moveWalker`
//                        takes — radius, threshold, grade, headroom, the door
//                        rule above.
//
// The numbers are the 2010 ADA Standards, cited beside each. They are not
// stored anywhere: every finding below is derived from the design as drawn,
// so nothing in the save format moved.
//
// The turning circles and the door rectangles are in turning.js, which only
// the report reads and the boot therefore leaves alone (TG-38).
//
// Pure module: no three.js, no DOM. Exercised by test/clearance.test.mjs.

import { floorLabel } from './grid.js';
import { LEAF_NONE, floorSolidAt, shapeAt } from './shapes.js';
import {
  stairsOf, stairMetrics, rampSlope, rampTopLanding, topLandingBox, localToWorld, worldToLocal,
  rectCorners, cutPolygon, footprintPolygon, pointInPolygon, isElevator,
} from './stairs.js';
import { MAX_RAMP_GRADE } from './sitemesh.js';
import { wallSegments, doorwaySegments, segsCross } from './collide.js';
import { propsOnFloor } from './props.js';
import { footprintOf } from './propplace.js';
import { collectDoorLeaves, leafEnd } from './openings.js';

// ---------- the doorway ----------
//
// The clear width a doorway offers is not the hole in the wall: a leaf parked
// at 90° and its stop eat into the opening, which is why a 36in door is the
// smallest one that gives the 32in clear ADA asks for. These four lived in
// navgraph.js from Phase 7 to Phase 39; they moved here because the walker
// now reads them too, and a contract two readers share belongs to neither.
export const CLEAR_LOSS = 0.33;          // ft — leaf and stop, off a doorway's width
export const MIN_CLEAR_W = 32 / 12;      // ft — ADA 404.2.3
// ...so the narrowest *opening* that passes, which is exactly a 3ft door.
export const MIN_ACCESSIBLE_W = MIN_CLEAR_W + CLEAR_LOSS;

// The clear width a doorway of this opening width actually offers. An opening
// with no leaf in it (a cased opening, a corridor mouth) loses nothing.
export const clearWidth = (w, leafed = true) =>
  Math.max(0, w - (leafed ? CLEAR_LOSS : 0));

// The clear width of a doorway *as hung*. A cased opening is all clear; a
// leaf loses its stop. A pair is measured with both leaves open — which is
// what the walkthrough does with one, and is the one place this reads more
// generously than a plan checker would: ADA 404.2.3 measures a pair at its
// active leaf alone, because the other may be bolted, and by that reading the
// lattice's 4ft pair (two 2ft leaves, and every generated school's front
// door) is not an accessible door. It rolls here, with both leaves open, and
// the backlog says so.
export function doorClear(w, leaf = 1) {
  if (leaf === LEAF_NONE) return Math.max(0, w);
  return clearWidth(w);
}

// **The contract.** Does a chair go through this doorway? The accessible graph
// (navgraph.js) keeps a doorway iff this is true, and a seated walker
// (collide.js, via `seatedStep`) is refused at a doorway iff it is false.
export const doorRolls = (w, leaf = 1) => doorClear(w, leaf) >= MIN_CLEAR_W - 1e-9;

// ---------- the body ----------

// Half the clear width: the chair is exactly as wide as the doorway it is
// entitled to, and that is what makes a 3ft door the narrowest it rolls
// through in the walk as well as on the graph.
export const SEATED_R = MIN_CLEAR_W / 2;            // ft — 16in
// Eye height. ADA 308 puts a seated eye between 43 and 51in; four feet is the
// middle of that, and the drop from 5.5ft is the whole of what the first
// person view has to say about the chair.
export const SEATED_EYE_H = 4;                      // ft — 48in
// The top of a seated head — what ducks under a stair soffit.
export const SEATED_HEAD_H = 4.4;                   // ft
// ADA 303.2: a vertical change of half an inch is the most a wheel rolls over
// without a bevel. This is the seated walker's step-up *and* step-down — a
// curb is a curb from either side.
export const THRESHOLD = 0.5 / 12;                  // ft
// ADA 405.2: 1:12 is the steepest running slope a ramp may have. The same
// number sitemesh.js measures a discharge route against, imported rather than
// restated so the site and the chair cannot drift apart.
export const MAX_SEATED_GRADE = MAX_RAMP_GRADE;
// How far ahead a grade is measured. A walker takes steps a few inches long,
// and a rule that tested each step on its own would let a chair creep up a
// bank in tiny steps each of which rose less than a threshold. Measured over
// a foot, a bank is a bank however slowly you approach it.
export const GRADE_PROBE = 1;                       // ft

// Is this ramp one a chair can use? Its slope is stored as feet of run per
// foot of rise (stairs.js), so 12 is the limit and anything under it is
// steeper.
export const rampRolls = (link) =>
  !!link && link.type === 'ramp' && 1 / rampSlope(link) <= MAX_SEATED_GRADE + 1e-9;

// ---------- the landing at the top of a ramp ----------
//
// ADA 405.7: a ramp ends on a level landing as wide as the ramp and 60in long
// (#904). Nothing here refuses a ramp or moves one. This says whether the
// top landing a ramp is owed, straight or folded (#985), has the room it
// needs on the storey above, read from the design as drawn, so a ramp placed
// when the landing was 4ft is asked the same question as one placed today
// and no save field records it.
//
// Three things can be in its way, and `why` names each that is:
//   'wall'  a wall or rail of the storey above runs through it, or a doorway
//           stands inside it, or the wall along its far end leaves less than
//           a doorway's 32in to leave by. A doorway *at* its far end is the
//           way off and is allowed (405.7.5), jambs and all.
//   'edge'  a corner of it, or the floor a foot past the middle of its far
//           end, is off the storey above: there is nowhere to arrive. A
//           folded ramp's far end is the open edge its walker steps off by,
//           beside the foot for an even count (`rampTopLanding`).
//   'link'  another link's hole in that floor, or a stair, ramp or lift that
//           stands on it, overlaps it.
//   'prop'  a floor-standing prop's footprint overlaps it (wall and ceiling
//           mounts are not asked). Needs `catalogGet` for the footprint; a
//           caller without one is not asked this (#984).
//   'swing' a door leaf of the storey above sweeps into it between shut and
//           its quarter turn, the far end's own doorway included: 405.7.5
//           lets a door's clearance share the landing, not its leaf (#984).
// Null for a stair and a ramp whose landing is clear. A folded ramp's turn
// landings are not asked: they stand between storeys, on no floor.
const LANDING_EPS = 0.1;        // ft: flush against an edge is not in the way
const LANDING_STEP_OFF = 1;     // ft of floor wanted past the far end
const LANDING_LINK_INSET = 0.3; // ft: more than the slack a hole is cut with

// The part of a local segment inside a local box, as a length.
function lengthInBox(ax, az, bx, bz, box) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - box.x0], [dx, box.x1 - ax], [-dz, az - box.z0], [dz, box.z1 - az]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return 0; continue; }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
  }
  return t1 > t0 ? (t1 - t0) * Math.hypot(dx, dz) : 0;
}

function polygonsOverlap(a, b) {
  if (a.some((p) => pointInPolygon(b, p.x, p.z)) || b.some((p) => pointInPolygon(a, p.x, p.z))) return true;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const u = b[j], v = b[(j + 1) % b.length];
      if (segsCross(p.x, p.z, q.x, q.z, u.x, u.z, v.x, v.z)) return true;
    }
  }
  return false;
}

export function rampLandingFit(state, link, metrics = stairMetrics(state), catalogGet = null) {
  // Straight or folded, the one top landing and its open edge (#985).
  const top = rampTopLanding(link, metrics);
  if (!top || !top.box || !state.floors[link.to]) return null;
  return landingFit(state, link, top.box, top.out, metrics, catalogGet);
}

// The five questions above, asked of local box `box` on storey `link.to`,
// whose way off is past `z1` when `out` is +1 and past `z0` when it is -1.
// A ramp's top landing and a stair's (#989) both come through here, so
// there is one copy of each question. Null when nothing is in the way.
function landingFit(state, link, box, out, metrics, catalogGet) {
  const floor = state.floors[link.to];
  const end = out === 1 ? box.z1 : box.z0;
  const e = LANDING_EPS;
  const why = [];

  const local = (s) => {
    const a = worldToLocal(link, s.ax, s.az), b = worldToLocal(link, s.bx, s.bz);
    return [a.lx, a.lz, b.lx, b.lz];
  };
  const inside = { x0: box.x0 + e, x1: box.x1 - e, z0: box.z0 + e, z1: box.z1 - e };
  const farEnd = { ...inside, z0: end - e, z1: end + e };
  const walls = wallSegments(floor);
  const shut = walls.reduce((sum, s) => sum + lengthInBox(...local(s), farEnd), 0);
  if (walls.concat(doorwaySegments(floor)).some((s) => lengthInBox(...local(s), inside) > 1e-6)
    || inside.x1 - inside.x0 - shut < MIN_CLEAR_W) why.push('wall');

  const solid = (lx, lz) => { const p = localToWorld(link, lx, lz); return floorSolidAt(floor, p.x, p.z); };
  const mid = (box.x0 + box.x1) / 2;
  const asked = [
    [inside.x0, inside.z0], [inside.x1, inside.z0], [inside.x0, inside.z1], [inside.x1, inside.z1],
    [mid, end + out * LANDING_STEP_OFF],
  ];
  if (!asked.every(([lx, lz]) => solid(lx, lz))) why.push('edge');

  const i = LANDING_LINK_INSET;
  const mine = rectCorners(link, { x0: box.x0 + i, x1: box.x1 - i, z0: box.z0 + i, z1: box.z1 - i });
  const others = stairsOf(state).filter((o) => o !== link).flatMap((o) => {
    const polys = [];
    if (o.to === link.to && !isElevator(o)) polys.push(cutPolygon(o, metrics));
    if (o.from === link.to || (isElevator(o) && o.to === link.to)) polys.push(footprintPolygon(o, metrics));
    return polys.filter(Boolean);
  });
  if (others.some((poly) => polygonsOverlap(mine, poly))) why.push('link');

  // The landing as a world polygon, flush edges let off as for walls.
  const clear = rectCorners(link, inside);
  if (catalogGet && propInLanding(state, link.to, clear, catalogGet)) why.push('prop');
  if (swingInLanding(state, link.to, clear)) why.push('swing');

  if (!why.length) return null;
  const at = localToWorld(link, mid, (box.z0 + box.z1) / 2);
  return { id: link.id, floor: link.to, x: at.x, z: at.z, why };
}

// Does a floor-standing prop's footprint, turned, overlap `clear` (a world
// polygon) on storey `floorId`? Wall and ceiling mounts are not asked.
function propInLanding(state, floorId, clear, catalogGet) {
  return propsOnFloor(state, floorId).some((p) => {
    const entry = catalogGet(p.type);
    if (!entry || entry.mount !== 'floor') return false;
    const { hw, hd } = footprintOf(entry, p);
    const c = Math.cos(p.rotationY || 0), sn = Math.sin(p.rotationY || 0);
    const foot = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => (
      { x: p.x + lx * c + lz * sn, z: p.z - lx * sn + lz * c }));
    return polygonsOverlap(clear, foot);
  });
}

// Does a door leaf of storey `floorId` sweep into `clear` between shut and its
// quarter turn? The sweep is the hinge and nine points on the leaf's arc.
function swingInLanding(state, floorId, clear) {
  return collectDoorLeaves(state, floorId).some((leaf) => polygonsOverlap(clear,
    [{ x: leaf.hx, z: leaf.hz }, ...Array.from({ length: 9 }, (_, k) => leafEnd(leaf, k / 8))]));
}

// ---------- the landing at the top of a stair ----------
//
// A straight stair's top landing is `topLandingBox`'s: the stair's width and
// 4ft deep, from the top of the run, drawn as a deck since #983, left by its
// far end. It is asked the ramp's five questions by the same lines
// (`landingFit`): 'prop' and 'swing' since #987, and 'wall', 'edge' and
// 'link' since #989, so a wall or a doorway in it or shutting its far end, a
// landing off the floor above, and another link's hole or footprint in it are
// each a reason too. Null for a ramp and for a stair whose landing is clear;
// nothing is moved.
export function stairLandingFit(state, link, metrics = stairMetrics(state), catalogGet = null) {
  if (!link || link.type !== 'stair') return null;
  const box = topLandingBox(link, metrics);
  if (!box || !state.floors[link.to]) return null;
  return landingFit(state, link, box, 1, metrics, catalogGet);
}

// The seated walker, as `moveWalker` options. `extra` is the per-step state
// the caller owns (`grounded`, `bodies`); everything about the body is here.
export function seatedStep(extra = {}) {
  return {
    radius: SEATED_R,
    stepUp: THRESHOLD,
    stepDown: THRESHOLD,
    headH: SEATED_HEAD_H,
    noStairs: true,
    maxGrade: MAX_SEATED_GRADE,
    gradeProbe: GRADE_PROBE,
    doorRule: (d) => doorRolls(d.w, d.leaf),
    ...extra,
  };
}

// The refusal, as a sentence — never a silent stop. `refusal` is what
// `moveWalker` hands back when the seated rules, rather than a wall, are what
// stopped the step.
export function refusalText(refusal) {
  if (!refusal || !refusal.reason) return '';
  switch (refusal.reason) {
    case 'stair':
      return 'A stair. Seated, the ramps and the lift are the way between storeys.';
    case 'door': {
      const w = refusal.doorway ? Math.round(refusal.doorway.w * 12) : null;
      return w
        ? `A ${w} in door. A chair needs 32 in clear, which is a 3 ft leaf.`
        : 'Too narrow a door. A chair needs 32 in clear, which is a 3 ft leaf.';
    }
    case 'grade':
      return Number.isFinite(refusal.grade) && refusal.grade > 0
        ? `Too steep for a chair — 1:${Math.max(1, Math.round(1 / refusal.grade))}, and 1:12 is the most a ramp may climb.`
        : 'A step. Half an inch is the most a wheel rolls over.';
    default:
      return '';
  }
}

// ---------- what the findings share ----------
//
// The reach rules below and the turning rules in turning.js write their
// findings the same way.
export const inches = (ft) => `${Math.round(ft * 12)} in`;
// A spot carries the name of the room it is in as `roomName`; a room row
// carries its own as `name`. Both read the same way here.
export const roomName = (r) => (r && (r.roomName || r.name))
  || (r ? `an unnamed room on ${floorLabel(r.floor)}` : 'a room');
export const finding = (level, code, title, detail, extra = {}) =>
  ({ level, code, title, detail, ...extra });

// ---------- reach and heights ----------
//
// The catalog already knows every counter and shelf: `h` is a floor-standing
// row's top and `y` a wall-mounted row's bottom, both in feet, and a prop may
// scale one or move the other. The rules are ADA's, in inches, keyed on the
// geometry family a row draws with — the same key the renderer picks a
// builder by — so a new counter row is checked the day it is added.
//
//   904.4.1  a sales or service counter tops out at 36 in
//   606.3    a lavatory rim at 34 in; a classroom sink is a lavatory
//   602.4    a drinking fountain's spout at 36 in
//   308      an operable part between 15 and 48 in off the floor
//   902.3    a work surface between 28 and 34 in — one per room is the 5%
//   225.2.1  lockers: some of them have to be within reach
export const REACH_MIN = 15 / 12;                   // ft
export const REACH_MAX = 48 / 12;                   // ft
export const COUNTER_MAX = 36 / 12;                 // ft
export const LAVATORY_MAX = 34 / 12;                // ft
export const SPOUT_MAX = 36 / 12;                   // ft
export const WORK_MIN = 28 / 12;                    // ft
export const WORK_MAX = 34 / 12;                    // ft
// A fountain's spout sits a few inches under the unit's top.
const SPOUT_BELOW_TOP = 0.3;                        // ft

export const REACH_RULES = [
  { geo: 'counter', kind: 'counter', label: 'counter', max: COUNTER_MAX, cite: 'ADA 904.4.1' },
  { geo: 'sinkcounter', kind: 'counter', label: 'sink counter', max: LAVATORY_MAX, cite: 'ADA 606.3' },
  { geo: 'sink', kind: 'counter', label: 'sink', max: LAVATORY_MAX, cite: 'ADA 606.3' },
  { geo: 'fountain', kind: 'counter', label: 'drinking fountain', max: SPOUT_MAX, cite: 'ADA 602.4',
    at: (top) => top - SPOUT_BELOW_TOP },
  { geo: 'wallbox', kind: 'control', label: 'wall-mounted control', min: REACH_MIN, max: REACH_MAX, cite: 'ADA 308',
    // A speaker is a wall box with nothing on it to operate.
    unless: (entry) => entry.style === 'grille' },
  { geo: 'hookrail', kind: 'control', label: 'coat hook', min: REACH_MIN, max: REACH_MAX, cite: 'ADA 308' },
  { geo: ['desk', 'table', 'workstation', 'carrel', 'labbench'], kind: 'work', label: 'work surface',
    min: WORK_MIN, max: WORK_MAX, cite: 'ADA 902.3' },
  { geo: 'locker', kind: 'locker', label: 'locker bank', cite: 'ADA 225.2.1' },
];

const ruleFor = (entry) => {
  if (!entry || !entry.geo) return null;
  const rule = REACH_RULES.find((r) => (Array.isArray(r.geo) ? r.geo.includes(entry.geo) : r.geo === entry.geo));
  if (!rule || (rule.unless && rule.unless(entry))) return null;
  return rule;
};

// The height a rule measures, in feet: a floor-standing row's top (scaled), a
// wall-mounted row's bottom — the operable part of a dispenser or a cabinet
// is at the bottom of the box, and 48 in at the bottom is the generous
// reading.
function heightOf(entry, prop) {
  const scale = (typeof prop.scale === 'number' && prop.scale > 0) ? prop.scale : 1;
  const y = Number.isFinite(prop.y) ? prop.y : (entry.y || 0);
  if (entry.mount === 'wall' || entry.mount === 'ceiling') return y;
  return y + (entry.h || 0) * scale;
}

export function reachAnalysis(state, opts = {}) {
  const catalogGet = opts.catalogGet || null;
  const nav = opts.nav || null;
  const items = [];
  const work = new Map();       // room id -> { room, surfaces: [], within: n }
  let lockers = 0, lockersLow = 0, tested = 0;
  const count = state && state.floors ? state.floors.length : 0;
  if (!catalogGet) return { items, fails: [], tested: 0, lockers: 0, lockersLow: 0, findings: [] };

  for (let i = 0; i < count; i++) {
    const floor = state.floors[i];
    for (const p of propsOnFloor(state, i)) {
      const entry = catalogGet(p.type);
      const rule = ruleFor(entry);
      if (!rule || entry.site) continue;
      const shape = shapeAt(floor, p.x, p.z);
      const roomId = shape ? `r${i}:s${shape.id}` : null;
      const name = shape ? shape.name || null : null;
      if (rule.kind === 'locker') {
        lockers++;
        if ((entry.tiers || 1) >= 2) lockersLow++;
        continue;
      }
      const top = heightOf(entry, p);
      const at = rule.at ? rule.at(top) : top;
      tested++;
      if (rule.kind === 'work') {
        if (!roomId) continue;
        let w = work.get(roomId);
        if (!w) { w = { room: roomId, floor: i, name, surfaces: 0, within: 0, x: p.x, z: p.z }; work.set(roomId, w); }
        w.surfaces++;
        if (at >= rule.min - 1e-9 && at <= rule.max + 1e-9) w.within++;
        continue;
      }
      const high = Number.isFinite(rule.max) && at > rule.max + 1e-9;
      const low = Number.isFinite(rule.min) && at < rule.min - 1e-9;
      if (!high && !low) continue;
      items.push({
        id: p.id, type: p.type, name: entry.name || p.type, label: rule.label, kind: rule.kind,
        floor: i, x: p.x, z: p.z, room: roomId, roomName: name,
        at, limit: high ? rule.max : rule.min, high, cite: rule.cite,
      });
    }
  }
  const rooms = [...work.values()].filter((w) => w.surfaces > 0 && w.within === 0);
  const fails = items.concat(rooms.map((w) => ({
    id: w.room, kind: 'work', floor: w.floor, x: w.x, z: w.z, room: w.room, roomName: w.name,
  })));
  return {
    items, rooms, fails, tested, lockers, lockersLow,
    findings: reachFindings({ items, rooms, tested, lockers, lockersLow }),
  };
}

const propMark = (it) => ({ id: it.id, floor: it.floor, x: it.x, z: it.z, w: 0 });

function reachFindings({ items, rooms, tested, lockers, lockersLow }) {
  const out = [];
  const counters = items.filter((it) => it.kind === 'counter');
  const controls = items.filter((it) => it.kind === 'control');
  if (counters.length) {
    const w = counters.reduce((a, b) => (b.at - b.limit > a.at - a.limit ? b : a));
    out.push(finding('warn', 'counter-height',
      `${counters.length} counter${counters.length === 1 ? '' : 's'} too high for a seated person`,
      `The ${w.name.toLowerCase()}${w.roomName ? ` in ${w.roomName}` : ''} is ${inches(w.at)} ` +
      `where ${inches(w.limit)} is the limit (${w.cite}). A lower section, or a lower unit, is the fix.`,
      { doors: counters.slice(0, 8).map(propMark), cite: `ADA 2010 · §${w.cite}` }));
  }
  if (controls.length) {
    const w = controls[0];
    out.push(finding('warn', 'reach-range',
      `${controls.length} control${controls.length === 1 ? '' : 's'} outside the 15–48 in reach range`,
      `The ${w.name.toLowerCase()}${w.roomName ? ` in ${w.roomName}` : ''} is mounted at ${inches(w.at)}; ` +
      `${w.high ? 'the highest' : 'the lowest'} an operable part may be is ${inches(w.limit)} (${w.cite}).`,
      { doors: controls.slice(0, 8).map(propMark), cite: `ADA 2010 · §${w.cite}` }));
  }
  if (rooms.length) {
    out.push(finding('warn', 'work-surface',
      `${rooms.length} room${rooms.length === 1 ? '' : 's'} with no work surface at a seated height`,
      `${rooms.slice(0, 4).map(roomName).join(', ')}` +
      `${rooms.length > 4 ? `, and ${rooms.length - 4} more` : ''} — every desk, table or bench ` +
      'in the room is outside 28–34 in (ADA 902.3). One at that height per room is enough.',
      { rooms: rooms.slice(0, 8).map((w) => ({ id: w.room, floor: w.floor, name: w.name })), cite: 'ADA 2010 · §902.3' }));
  }
  if (lockers && !lockersLow) {
    out.push(finding('note', 'lockers',
      `${lockers} locker bank${lockers === 1 ? '' : 's'}, none within reach`,
      'Every bank is full-height, so no locker has a hook or a shelf a seated person ' +
      'reaches. Some of them (ADA 225.2.1 says 5%) want to be the half-height kind.',
      { cite: 'ADA 2010 · §225.2.1' }));
  }
  if (tested && !items.length && !rooms.length) {
    out.push(finding('ok', 'reach', 'Every counter, control and work surface is within reach',
      `${tested} of them checked against the catalog's own heights.`,
      { cite: 'ADA 2010 · §308' }));
  }
  return out;
}
