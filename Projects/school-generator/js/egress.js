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

import { CELL, cellIdx, floorLabel } from './grid.js';
import { shapesOf } from './shapes.js';
import { stairsOf, stairWidth, isRun, isElevator, elevatorDoorWidth } from './stairs.js';
import {
  buildNav, egressField, pointField, clearWidth, MIN_CLEAR_W, MIN_ACCESSIBLE_W,
} from './navgraph.js';
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

// Somewhere to measure to. A room's own extent, as points: every cell centre
// for a lattice region, every corner for a polygon one. Built once per
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
    const floor = fr.floor;
    for (let y = 0; y < floor.h; y++) {
      for (let x = 0; x < floor.w; x++) {
        const idx = fr.cellRoom[cellIdx(floor, x, y)];
        if (idx < 0) continue;
        const room = fr.rooms[idx];
        const pts = by.get(room.id);
        if (pts) pts.push({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
      }
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
  };

  return {
    nav, field, limits, sprinklered,
    rooms,
    exits,
    stairs,
    deadEnds: deadEnds(nav, field, samples, loads, limits),
    summary,
    findings: egressFindings({ rooms, exits, stairs, summary }),
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
      'width an exit needs once the leaf is standing in the opening.'));
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
      'leaf open, which is what a wheelchair needs.'));
  }
  return out;
}
