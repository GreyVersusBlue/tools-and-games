// egress.js — how far it is to the way out, and whether the way out is wide
// enough for the people the rooms hold.
//
// Phase 6 built the graph and walked a fire drill over it. This is the same
// walk with a tape measure: `egressField` already knows how far every room is
// from the nearest exit, every portal already carries the width of the hole it
// is, and occupancy.js says how many people are behind each door. Putting the
// three together is the whole of this file, which is why it is a reader rather
// than a system — there is nothing here the model didn't already contain.
//
// **What a number here means.** Travel distance is measured from the farthest
// point in a room to the nearest exit, over Phase 10's nav mesh: the tile
// under that point, the straight line to whichever doorway, gate or stair
// standing on it starts the shortest walk out, and the graph's own distance
// from there. That is longer than a straight line and shorter than the walk a
// body with a shoulder actually takes, because the mesh has no furniture in
// it. It is an estimate, it is labelled as one, and it is the same estimate
// the crowd walks — a drill that strands somebody and a travel distance that
// says 340 feet are the same finding twice.
//
// Until Phase 10 it was the room's *hub* distance plus the room's own radius,
// which counted the room twice over and put every trip through the middle of
// whatever corridor it crossed. Every number in this file moved when that
// went, and the tests below moved with them: they are the acceptance criteria
// for the mesh rather than an obstacle to it.
//
// **The accessible route is this graph with two things taken out** — stairs,
// and doorways too narrow to roll through. That is `buildNav`'s one new
// option, and everything downstream of it here is the same reachability
// question asked of a smaller graph.
//
// The limits are IBC: 250ft travel and 50ft dead ends in a sprinklered
// building (200 / 20 without), 75ft common path for an E occupancy, 0.2in of
// exit width per occupant on the level and 0.3in on a stair, two exits once a
// space holds fifty. A school is a sprinklered building unless somebody says
// otherwise, so that is the default.
//
// Pure module: no three.js, no DOM. Exercised by test/egress.test.mjs.

import { floorLabel } from './grid.js';
import { shapesOf } from './shapes.js';
import { stairsOf, stairWidth, isRun, isElevator, elevatorDoorWidth } from './stairs.js';
import {
  buildNav, egressField, pointField, clearWidth, MIN_CLEAR_W, MIN_ACCESSIBLE_W,
  dischargeField, dischargePath,
} from './navgraph.js';
import { ACCESSIBLE_GRADE, MAX_RAMP_GRADE, pathGrade } from './sitemesh.js';
import { terrainField } from './terrain.js';
import { buildingOccupancy } from './occupancy.js';

// ---------- the code, as numbers ----------

// IBC Table 1017.2 — exit access travel distance, Group E.
export const TRAVEL_LIMIT = { sprinklered: 250, plain: 200 };   // ft
// IBC 1020.4 — dead-end corridors.
export const DEAD_END_LIMIT = { sprinklered: 50, plain: 20 };   // ft
// IBC Table 1006.2.1 — common path of egress travel, Group E.
export const COMMON_PATH = 75;                                  // ft
// IBC 1005.3 — capacity per occupant, in inches of clear width.
export const LEVEL_IN_PER_OCC = 0.2;
export const STAIR_IN_PER_OCC = 0.3;
// IBC 1010.1.1 / 1011.2 — the narrowest thing that counts as a way out.
export const MIN_EXIT_CLEAR = MIN_CLEAR_W;      // ft, 32in
export const MIN_EGRESS_STAIR_W = 44 / 12;      // ft — a stair serving 50+
// IBC 1006.2.1 — one way out is enough up to this many people in one room.
export const SINGLE_EXIT_OCC = 49;
// IBC 1028 — the exit discharge is the part of the way out that runs from the
// exit to the public way, and it is not the part the travel limit is about.
// There is no single number in the code for how long it may be, so this is not
// a limit: it is the distance past which "the door is the way out" stops being
// a fair description of the building, and the report says so as a note rather
// than as a failure.
export const DISCHARGE_NOTE = 200;              // ft

// How many ways out a given occupant load needs (IBC 1006.3.2).
export function requiredExits(occ) {
  if (occ > 1000) return 4;
  if (occ > 500) return 3;
  if (occ > SINGLE_EXIT_OCC) return 2;
  return 1;
}

// The clear width that many people need, in feet.
export function requiredWidth(occ, opts = {}) {
  const per = opts.stair ? STAIR_IN_PER_OCC : LEVEL_IN_PER_OCC;
  return (occ * per) / 12;
}

const limitsFor = (sprinklered) => ({
  travel: sprinklered ? TRAVEL_LIMIT.sprinklered : TRAVEL_LIMIT.plain,
  deadEnd: sprinklered ? DEAD_END_LIMIT.sprinklered : DEAD_END_LIMIT.plain,
  commonPath: COMMON_PATH,
});

// ---------- how far it is across a room ----------

// Somewhere to measure to: every corner of a room's outline. Built once per
// analysis because both the travel distance and the dead-end length ask the
// same question from two different starting points.
export function roomSamples(nav) {
  const by = new Map();
  const perFloor = (nav && nav.perFloor) || [];
  for (let i = 0; i < perFloor.length; i++) {
    const fr = perFloor[i];
    if (!fr || !fr.floor) continue;
    for (const r of fr.rooms) by.set(r.id, []);
    for (const shape of shapesOf(fr.floor)) {
      const pts = by.get(`r${i}:s${shape.id}`);
      if (pts) for (const p of shape.rings[0].pts) pts.push({ x: p.x, z: p.z });
    }
  }
  return by;
}

// The farthest a person can be from a point and still be in this room. Used
// twice: from the hub it is the extra leg a travel distance has to carry, and
// from a doorway it is how deep a dead end goes.
export function farthestFrom(samples, id, from) {
  const pts = samples.get(id) || [];
  let far = 0;
  for (const p of pts) {
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    if (d > far) far = d;
  }
  return far;
}

// ---------- the analysis ----------

// Every doorway on a room, and every stair standing in one. Asked of the
// graph rather than walked out of it: on the mesh a door at the far end of a
// long room is a neighbour of the *tile* it stands on rather than of the room
// node, so counting a room's neighbours would count the doors near its middle
// and miss the rest.
const portalsOn = (nav, roomId) => nav.portalsOf(roomId);
const linksOn = (nav, roomId) => nav.linksOf(roomId);

// A room's ways *onward* — the neighbours through which the exit is closer
// than it is from here. Two of them is a corridor with a choice at both ends;
// one is a pocket you have to come back out of; none (with an exit somewhere
// in the building) is a room the field never reached.
function onwardFrom(nav, field, roomId) {
  const here = field.dist.get(roomId);
  if (here === undefined) return [];
  const out = [];
  for (const e of nav.adj.get(roomId) || []) {
    const n = nav.nodes.get(e.to);
    // A gate is a seam between two tiles of one room, not a way out of it —
    // counting them would give every corridor cut into three tiles three ways
    // onward and no dead end anywhere.
    if (!n || n.kind === 'room' || n.kind === 'outside' || n.kind === 'gate') continue;
    const d = field.dist.get(e.to);
    if (d !== undefined && d < here - 0.01) out.push(n);
  }
  return out;
}

// The longest walk out of a room, measured from every point in it rather than
// from its middle. Phase 10's whole argument in one function: the mesh knows
// how far the corner of a classroom is from the door of it, and adding a
// room's radius to its hub's distance — which is what this was — counted the
// corridor outside twice and the room itself twice over.
function worstTravel(nav, field, samples, room) {
  const pts = samples.get(room.id) || [];
  let worst = null;
  for (const p of pts) {
    const at = pointField(nav, field, room.floor, p.x, p.z, room.id);
    if (!at) continue;
    if (!worst || at.dist > worst.dist) worst = { ...at, x: p.x, z: p.z };
  }
  return worst;
}

// One room's egress: how far out, by which door, and whether the doors it has
// are enough for the people in it.
function roomEgress(nav, field, samples, room, load, limits) {
  const hub = field.dist.get(room.id);
  const far = farthestFrom(samples, room.id, room);
  const doors = portalsOn(nav, room.id);
  const doorWidth = doors.reduce((w, p) => w + clearWidth(p.w), 0);
  const worst = worstTravel(nav, field, samples, room);
  const reached = !!worst || hub !== undefined;
  const viaId = worst ? worst.via : field.via.get(room.id);
  const via = viaId ? nav.nodes.get(viaId) : null;
  const occ = load ? load.occ : 0;
  const travel = worst ? worst.dist : (hub !== undefined ? hub + far : Infinity);
  return {
    id: room.id,
    floor: room.floor,
    name: room.name || null,
    use: load ? load.use : 'unassigned',
    area: room.area,
    occ,
    // The walk from this room's own node, and how far across the room it is
    // from there — both kept because a report that only prints the worst
    // number cannot say whether the room or the walk to it is the problem.
    hub: hub === undefined ? Infinity : hub,
    reach: far,
    travel,
    reached,
    over: reached && travel > limits.travel,
    exit: via ? { id: via.id, x: via.x, z: via.z, w: via.w } : null,
    doors: doors.length,
    doorWidth,
    // A room holding more than fifty people needs a second way out of it, and
    // a room's doors have to be wide enough for the people behind them.
    needsTwo: occ > SINGLE_EXIT_OCC && doors.length < 2,
    narrow: occ > 0 && doors.length > 0 && doorWidth < requiredWidth(occ),
    doorless: occ > 0 && doors.length === 0 && linksOn(nav, room.id).length === 0,
  };
}

// The dead ends: circulation with exactly one way onward, measured from that
// one way back to the far end of the space.
function deadEnds(nav, field, samples, loads, limits) {
  const out = [];
  for (const room of nav.rooms) {
    const load = loads.get(room.id);
    if (!load || !load.circulation) continue;   // a room is not a dead-end corridor
    if (!field.dist.has(room.id)) continue;     // unreachable is a different finding
    const onward = onwardFrom(nav, field, room.id);
    if (onward.length !== 1) continue;
    const mouth = onward[0];
    const depth = farthestFrom(samples, room.id, mouth);
    if (depth <= limits.deadEnd) continue;
    out.push({
      id: room.id,
      floor: room.floor,
      name: room.name || null,
      depth,
      limit: limits.deadEnd,
      via: mouth.id,
    });
  }
  return out.sort((a, b) => b.depth - a.depth);
}

// The exits themselves, priced by width rather than counted.
function exitRows(nav) {
  return nav.exits.map((p) => {
    const clear = clearWidth(p.w);
    return {
      id: p.id,
      floor: p.floor,
      x: p.x, z: p.z,
      w: p.w,
      clear,
      // What that hole is worth in people, at 0.2in each.
      capacity: Math.floor((clear * 12) / LEVEL_IN_PER_OCC),
      narrow: clear < MIN_EXIT_CLEAR,
    };
  }).sort((a, b) => b.clear - a.clear);
}

// The vertical half of the same sum: what carries the upper storeys down.
function stairRows(state) {
  const rows = [];
  for (const link of stairsOf(state)) {
    if (isElevator(link)) {
      // A lift is not an exit — it is how you get *up* there, and in a fire it
      // is the thing you are told not to use. It is listed so the accessible
      // half of the report can point at it, and carries no egress capacity.
      rows.push({
        id: link.id, type: 'elevator', from: link.from, to: link.to,
        w: elevatorDoorWidth(link), capacity: 0, egress: false,
      });
      continue;
    }
    if (!isRun(link)) continue;
    const w = stairWidth(link);
    rows.push({
      id: link.id, type: link.type, from: link.from, to: link.to,
      w,
      capacity: Math.floor((w * 12) / STAIR_IN_PER_OCC),
      narrow: link.type === 'stair' && w < MIN_EGRESS_STAIR_W,
      egress: true,
    });
  }
  return rows;
}

// ---------- exit discharge ----------

// What happens after the door, which until Phase 17 was nothing: the graph
// flattened the whole outdoors into a single node, so every exit "discharged"
// the instant you crossed the threshold and the walk from there to the street
// — which is what a code actually means by discharge — was unmeasurable. It
// is now the same Dijkstra over more tiles.
//
// Three things come back per exit, and only the first is a distance:
//
//   `dist`   how far it is over the ground to the public way
//   `grade`  the steepest piece of that ground the shortest route crosses
//   `reaches` whether there is a route at all
//
// The grade is the half worth having. A discharge route steeper than 1:20 is a
// ramp by definition, and a ramp needs handrails, landings and edge protection
// this tool does not draw — so a school that discharges down a 9% bank is a
// school with an accessible route it has not built yet, and that is a finding
// the model can honestly make out of a heightfield it already had.
export function dischargeAnalysis(state, opts = {}) {
  const nav = opts.nav || buildNav(state);
  const field = opts.discharge || dischargeField(nav);
  const yard = nav.yard;
  const site = opts.siteField || terrainField(state);
  const rule = (nav.ways && nav.ways.rule) || (yard && yard.ways.rule) || 'none';
  const rows = nav.exits.map((p) => {
    const dist = field.dist.get(p.id);
    const reaches = dist !== undefined && Number.isFinite(dist);
    const path = reaches ? dischargePath(field, p.id) : null;
    const grade = path
      ? pathGrade(site, path.map((id) => nav.node(id)).filter(Boolean))
      : 0;
    const wayId = reaches ? field.via.get(p.id) : null;
    const way = wayId ? nav.node(wayId) : null;
    return {
      id: p.id,
      floor: p.floor,
      x: p.x, z: p.z,
      w: p.w,
      dist: reaches ? dist : Infinity,
      grade,
      reaches,
      // Where it comes out, so a plan can draw the route rather than assert it.
      way: way ? { id: way.id, x: way.x, z: way.z, paved: !!way.paved } : null,
      path,
      steep: reaches && grade > ACCESSIBLE_GRADE,
      impassable: reaches && grade > MAX_RAMP_GRADE,
      long: reaches && dist > DISCHARGE_NOTE,
    };
  }).sort((a, b) => (b.reaches ? b.dist : Infinity) - (a.reaches ? a.dist : Infinity));

  const reached = rows.filter((r) => r.reaches);
  const summary = {
    // Which rule found the public way — paving that reaches the property line,
    // or the property line itself. A distance measured to a fence is worth
    // having and worth labelling.
    rule,
    exits: rows.length,
    reaching: reached.length,
    stranded: rows.length - reached.length,
    worst: reached.length ? reached[0] : null,
    // The shortest way off the property from anywhere, which is the number a
    // muster plan is written against.
    best: reached.length ? reached[reached.length - 1] : null,
    steep: reached.filter((r) => r.steep).length,
    impassable: reached.filter((r) => r.impassable).length,
    area: yard ? yard.tiles.reduce((a, t) => a + t.area, 0) : 0,
    tiles: yard ? yard.tiles.length : 0,
  };
  return { nav, field, rows, summary, findings: dischargeFindings({ rows, summary }) };
}

function dischargeFindings({ rows, summary }) {
  const out = [];
  if (!rows.length) return out;
  if (summary.rule === 'none') {
    out.push(finding('note', 'discharge-unknown', 'Nowhere to discharge to',
      'The site has no ground around the building that reaches its own ' +
      'boundary, so there is nothing to measure the walk from the doors to.'));
    return out;
  }
  const stranded = rows.filter((r) => !r.reaches);
  if (stranded.length) {
    out.push(finding('fail', 'discharge-blocked',
      `${stranded.length} exit${stranded.length === 1 ? '' : 's'} discharge nowhere`,
      'The ground outside these doors does not connect to the public way — a ' +
      'planting bed, a bank too steep to walk, or a courtyard with the ' +
      'building all the way round it. A door that opens into an enclosure is ' +
      'not an exit.',
      { doors: stranded.slice(0, 8) }));
  }
  const impassable = rows.filter((r) => r.impassable);
  const steep = rows.filter((r) => r.steep && !r.impassable);
  if (impassable.length) {
    out.push(finding('fail', 'discharge-grade',
      `${impassable.length} discharge route${impassable.length === 1 ? '' : 's'} steeper than 1:12`,
      `The steepest is ${pct(impassable[0].grade)} — beyond what may be built ` +
      'as a ramp at all, so this part of the site needs steps and a separate ' +
      'accessible route round it.',
      { doors: impassable.slice(0, 8) }));
  } else if (steep.length) {
    out.push(finding('warn', 'discharge-grade',
      `${steep.length} discharge route${steep.length === 1 ? '' : 's'} steeper than 1:20`,
      `${pct(steep[0].grade)} at the worst. Past 1:20 a walking surface is a ` +
      'ramp, and a ramp needs handrails, level landings and edge protection ' +
      'that nothing in this design draws yet.',
      { doors: steep.slice(0, 8) }));
  }
  if (summary.worst && summary.worst.long) {
    out.push(finding('note', 'discharge-distance',
      `The longest discharge is ${ft(summary.worst.dist)}`,
      `From that door it is ${ft(summary.worst.dist)} over the ground to the ` +
      `${summary.rule === 'paved' ? 'paving that reaches the boundary' : 'edge of the site'}. ` +
      'The code sets no limit on it, but it is the part of the way out that is ' +
      'usually drawn as an arrow and never measured.'));
  }
  if (!out.length && summary.worst) {
    out.push(finding('ok', 'discharge',
      `Every exit reaches the public way, the farthest in ${ft(summary.worst.dist)}`,
      `Measured over the site to the ${summary.rule === 'paved' ? 'paving at the boundary' : 'edge of the site'}, ` +
      `at no more than ${pct(summary.worst.grade)} on the way.`));
  }
  return out;
}

export function egressAnalysis(state, opts = {}) {
  const nav = opts.nav || buildNav(state);
  const occupancy = opts.occupancy || buildingOccupancy(state, { nav });
  const sprinklered = opts.sprinklered !== false;
  const limits = limitsFor(sprinklered);
  // Measured in feet, not in routing cost: a stair charged at 1.7× is the
  // right way to *choose* a route and the wrong way to report how long it is.
  const field = opts.field || egressField(nav, { metric: true });
  const samples = opts.samples || roomSamples(nav);
  const loads = new Map(occupancy.rooms.map((r) => [r.id, r]));

  const rooms = nav.rooms
    .map((r) => roomEgress(nav, field, samples, r, loads.get(r.id), limits))
    .sort((a, b) => (b.reached ? b.travel : -1) - (a.reached ? a.travel : -1));

  const exits = exitRows(nav);
  const stairs = stairRows(state);
  const total = occupancy.total;
  const capacity = exits.reduce((n, e) => n + e.capacity, 0);
  // IBC 1005.5: losing any one exit must not cost more than half the required
  // capacity — the reason a building with one enormous door is not a building
  // with two doors.
  const worstLoss = exits.length ? exits[0].capacity : 0;
  const stairCapacity = stairs.filter((s) => s.egress).reduce((n, s) => n + s.capacity, 0);

  // What happens after the door. Folded into this analysis rather than left
  // beside it because a travel distance that stops at the threshold and a
  // discharge that starts there are two halves of one walk, and a reader with
  // only the first half of it will draw the arrow and never measure it.
  const discharge = opts.discharge === false
    ? null
    : dischargeAnalysis(state, { nav, siteField: opts.siteField });

  const summary = {
    sprinklered,
    limits,
    occupants: total,
    upper: occupancy.upper,
    exits: exits.length,
    exitsRequired: requiredExits(total),
    capacity,
    capacityRequired: total,
    redundant: exits.length > 1 && capacity - worstLoss >= total / 2,
    stairCapacity,
    stairsRequired: occupancy.upper,
    unreachable: rooms.filter((r) => !r.reached && r.occ > 0).length,
    worst: rooms.find((r) => r.reached) || null,
    // The farthest anybody walks from where they are standing to the public
    // way: the worst room's travel plus the discharge from the door it leaves
    // by. Not a code number — the two halves are measured against different
    // rules — but it is the answer to "how far is it out of here", which is
    // the question people actually ask of a plan.
    toPublicWay: null,
  };
  if (discharge && summary.worst && summary.worst.exit) {
    const row = discharge.rows.find((r) => r.id === summary.worst.exit.id);
    if (row && row.reaches) summary.toPublicWay = summary.worst.travel + row.dist;
  }

  return {
    nav, field, limits, sprinklered,
    rooms,
    exits,
    stairs,
    discharge,
    deadEnds: deadEnds(nav, field, samples, loads, limits),
    summary,
    findings: [
      ...egressFindings({ rooms, exits, stairs, summary }),
      ...(discharge ? discharge.findings : []),
    ],
  };
}

// ---------- the accessible route ----------

// The same building, walked by somebody who can't use a stair. What comes
// back is the two lists that matter: what is on an accessible route, and what
// is only reachable by climbing something.
export function accessibleAnalysis(state, opts = {}) {
  const nav = opts.nav || buildNav(state);
  const accessNav = opts.accessNav || buildNav(state, { accessible: true });
  const occupancy = opts.occupancy || buildingOccupancy(state, { nav });
  const loads = new Map(occupancy.rooms.map((r) => [r.id, r]));
  const walking = opts.field || egressField(nav, { metric: true });
  // Reachability *inward* from the accessible entrances: `egressField` is a
  // multi-source walk from every exit, and every exit is also a way in.
  const rolling = egressField(accessNav);

  const rooms = [];
  for (const room of nav.rooms) {
    const load = loads.get(room.id);
    const walkable = walking.dist.has(room.id);
    const rollable = rolling.dist.has(room.id);
    rooms.push({
      id: room.id,
      floor: room.floor,
      name: room.name || null,
      area: room.area,
      occ: load ? load.occ : 0,
      circulation: load ? load.circulation : false,
      walkable,
      rollable,
      // The finding: somewhere people can get to on foot and not otherwise.
      stairsOnly: walkable && !rollable,
    });
  }

  const entrances = accessNav.exits.map((p) => ({
    id: p.id, x: p.x, z: p.z, w: p.w, clear: clearWidth(p.w),
  }));
  const narrowDoors = nav.portals.filter((p) => p.w < MIN_ACCESSIBLE_W);
  const lifts = (state.links || []).filter((l) => l.type === 'elevator').length;
  const ramps = (state.links || []).filter((l) => l.type === 'ramp').length;
  const stairsOnly = rooms.filter((r) => r.stairsOnly);

  const summary = {
    entrances: entrances.length,
    lifts,
    ramps,
    narrowDoors: narrowDoors.length,
    reachable: rooms.filter((r) => r.rollable).length,
    unreachable: stairsOnly.length,
    // Every storey above the ground one needs a lift or a ramp to be on an
    // accessible route at all, and it is worth saying which are not.
    storeys: (state.floors || []).length,
    storeysReached: new Set(rooms.filter((r) => r.rollable).map((r) => r.floor)).size,
  };

  return {
    nav: accessNav,
    rooms,
    entrances,
    stairsOnly,
    narrowDoors: narrowDoors.map((p) => ({ id: p.id, floor: p.floor, x: p.x, z: p.z, w: p.w })),
    summary,
    findings: accessibleFindings({ rooms: stairsOnly, entrances, summary, narrowDoors }),
  };
}

// ---------- findings ----------

const finding = (level, code, title, detail, extra = {}) =>
  ({ level, code, title, detail, ...extra });

const ft = (n) => `${Math.round(n)} ft`;
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const inches = (n) => `${(n * 12).toFixed(0)} in`;
const roomName = (r) => r.name || (r.floor !== undefined ? `an unnamed room on ${floorLabel(r.floor)}` : 'an unnamed room');

function egressFindings({ rooms, exits, stairs, summary }) {
  const out = [];
  if (!exits.length) {
    out.push(finding('fail', 'no-exits', 'No way out',
      'Nothing on the ground floor opens to the outside. Every room in this ' +
      'design is sealed in, and a fire drill would strand all of it.'));
    return out;
  }

  const stranded = rooms.filter((r) => !r.reached && r.occ > 0);
  if (stranded.length) {
    out.push(finding('fail', 'unreachable',
      `${stranded.length} occupied room${stranded.length === 1 ? '' : 's'} can't reach an exit`,
      `${stranded.slice(0, 4).map(roomName).join(', ')}` +
      `${stranded.length > 4 ? `, and ${stranded.length - 4} more` : ''} — ` +
      'no doorway, stair or ramp joins them to a way out.',
      { rooms: stranded.slice(0, 8) }));
  }

  const over = rooms.filter((r) => r.over);
  if (over.length) {
    const worst = over[0];
    out.push(finding('fail', 'travel-distance',
      `${over.length} room${over.length === 1 ? ' is' : 's are'} beyond the travel limit`,
      `${roomName(worst)} is ${ft(worst.travel)} from the nearest exit — the ` +
      `limit is ${ft(summary.limits.travel)}${summary.sprinklered ? ' with sprinklers' : ' unsprinklered'}. ` +
      'Another exterior door in that wing is the usual answer.',
      { rooms: over.slice(0, 8) }));
  } else if (summary.worst) {
    out.push(finding('ok', 'travel-distance', 'Travel distances are within the limit',
      `The farthest anybody walks is ${ft(summary.worst.travel)} from ` +
      `${roomName(summary.worst)}, against a ${ft(summary.limits.travel)} limit.`));
  }

  if (exits.length < summary.exitsRequired) {
    out.push(finding('fail', 'exit-count',
      `${summary.occupants} occupants need ${summary.exitsRequired} exits`,
      `This design has ${exits.length}. Exits have to be remote from one ` +
      'another, so the second one belongs at the far end of the plan rather ' +
      'than beside the first.'));
  }

  if (summary.capacity < summary.capacityRequired) {
    out.push(finding('fail', 'exit-capacity', 'The exits are too narrow for the occupant load',
      `${summary.occupants} occupants need ${inches(requiredWidth(summary.occupants))} ` +
      `of clear exit width; the doors provide ${inches(exits.reduce((n, e) => n + e.clear, 0))}, ` +
      `which carries ${summary.capacity}.`));
  } else if (exits.length > 1 && !summary.redundant) {
    out.push(finding('warn', 'exit-redundancy', 'One exit is carrying too much of the load',
      'Lose the widest door and what is left is under half the required ' +
      'capacity. Codes size exits so that any one of them can be the one on fire.'));
  }

  const narrowExits = exits.filter((e) => e.narrow);
  if (narrowExits.length) {
    out.push(finding('warn', 'exit-width',
      `${narrowExits.length} exit${narrowExits.length === 1 ? '' : 's'} narrower than 32 in clear`,
      'A single 3 ft leaf is the smallest door that gives the 32 in clear ' +
      'width an exit needs once the leaf is standing in the opening.',
      // Carried so that a reader with a plan in front of it can point at
      // *that* door rather than go looking for it. Phase 10's minimap draws
      // them; the panel has always been able to and never had them.
      { doors: narrowExits.slice(0, 8) }));
  }

  const twoWays = rooms.filter((r) => r.needsTwo);
  if (twoWays.length) {
    out.push(finding('warn', 'second-door',
      `${twoWays.length} room${twoWays.length === 1 ? '' : 's'} over 50 occupants with one door`,
      `${twoWays.slice(0, 3).map((r) => `${roomName(r)} (${r.occ})`).join(', ')} — ` +
      'a space holding more than fifty people needs two ways out of it.',
      { rooms: twoWays.slice(0, 8) }));
  }

  const narrowRooms = rooms.filter((r) => r.narrow);
  if (narrowRooms.length) {
    out.push(finding('warn', 'door-width',
      `${narrowRooms.length} room${narrowRooms.length === 1 ? '' : 's'} with doors too narrow for the people in them`,
      `${roomName(narrowRooms[0])} holds ${narrowRooms[0].occ} and offers ` +
      `${inches(narrowRooms[0].doorWidth)} of clear door.`,
      { rooms: narrowRooms.slice(0, 8) }));
  }

  const climbing = stairs.filter((s) => s.egress);
  if (summary.upper > 0) {
    if (!climbing.length) {
      out.push(finding('fail', 'no-stairs', 'Upper storeys with no stair or ramp',
        `${summary.upper} occupants are above the ground floor with nothing to ` +
        'walk down. A lift is not an exit.'));
    } else if (summary.stairCapacity < summary.upper) {
      out.push(finding('warn', 'stair-capacity', 'The stairs are narrow for the upper floors',
        `${summary.upper} occupants above ground need ` +
        `${inches((summary.upper * STAIR_IN_PER_OCC) / 12)} of stair width at 0.3 in each; ` +
        `there is ${inches(climbing.reduce((n, s) => n + s.w, 0))}.`));
    }
    const narrowStairs = climbing.filter((s) => s.narrow);
    if (narrowStairs.length) {
      out.push(finding('note', 'stair-width',
        `${narrowStairs.length} stair${narrowStairs.length === 1 ? '' : 's'} under 44 in wide`,
        'A stair serving fifty people or more is 44 in minimum.'));
    }
  }

  if (!out.some((f) => f.level === 'fail')) {
    out.push(finding('ok', 'exits', `${exits.length} ways out, carrying ${summary.capacity}`,
      `The occupant load is ${summary.occupants}, and every room reaches a door.`));
  }
  return out;
}

function accessibleFindings({ rooms, entrances, summary, narrowDoors }) {
  const out = [];
  if (!entrances.length) {
    out.push(finding('fail', 'no-accessible-entrance', 'No accessible entrance',
      'Every exterior door is under 3 ft wide, so nothing here can be entered ' +
      'in a wheelchair.'));
  }
  if (summary.storeys > 1 && !summary.lifts && !summary.ramps) {
    out.push(finding('fail', 'no-lift', 'Upper storeys with no lift or ramp',
      'A stair is the only way up, which puts every room above the ground ' +
      'floor off the accessible route.'));
  }
  if (rooms.length) {
    const occupied = rooms.filter((r) => r.occ > 0);
    out.push(finding(occupied.length ? 'fail' : 'warn', 'stairs-only',
      `${rooms.length} space${rooms.length === 1 ? '' : 's'} reachable only by stairs`,
      `${rooms.slice(0, 4).map((r) => r.name || `an unnamed room on ${floorLabel(r.floor)}`).join(', ')}` +
      `${rooms.length > 4 ? `, and ${rooms.length - 4} more` : ''}.`,
      { rooms: rooms.slice(0, 8) }));
  } else if (entrances.length) {
    out.push(finding('ok', 'accessible-route', 'Every room is on an accessible route',
      'No room in this design needs a stair to reach it.'));
  }
  if (narrowDoors.length) {
    out.push(finding('note', 'narrow-doors',
      `${narrowDoors.length} doorway${narrowDoors.length === 1 ? '' : 's'} under 3 ft`,
      'A 3 ft leaf is the narrowest door that leaves 32 in clear with the ' +
      'leaf open, which is what a wheelchair needs.',
      { doors: narrowDoors.slice(0, 8).map((p) => ({ id: p.id, floor: p.floor, x: p.x, z: p.z, w: p.w })) }));
  }
  return out;
}
