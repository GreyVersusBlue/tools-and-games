// The crowd model: the one rule for how long a group takes in a transition,
// and whether it is late. Every time figure in the tool comes from here.
//
// A group walks its route as a column of lane slots, one step every
// secondsPerCell. Groups keep right, so two groups going opposite ways along
// a corridor are in different slots and pass each other; a group behind a
// slower or waiting group waits; a group turning left across the oncoming
// lane waits for a gap in it, 6 seconds at most, and walks around a group
// that is standing there. The model is deterministic: it reads the project
// and the routes, never the screen, and commits moves in group id order, so
// the same project gives the same numbers on every machine.
//
// The rules are ARCHITECTURE 6.3, numbered 1 to 9 there with 4a, and the
// comments below name the rule each piece of code is. Rules 4, 4a, 6 and 8
// were amended on 2026-10-08 and this file follows the amended text.
//
// Rule 4, the crossing. A left turn (north to west, west to south, south to
// east, east to north) also needs the oncoming lane of the cell the head
// stands on, the crossing slot, to be clear. It is clear when any of these
// holds:
//
//   - nobody is in it;
//   - the group in it is standing, and is walked around;
//   - this group has already been refused CROSSING_WAIT_MAX = 6 seconds at
//     this crossing (people cross a gap in oncoming traffic after a few
//     seconds);
//   - the two groups each hold the other's crossing slot, both became ready
//     on the same tick, and this one has the lower id.
//
// A right turn, straight on, the step out of the room and the step off a
// stairs connection ask nothing more.
//
// Where the rules leave a question open, this is what was chosen (each has a
// test in test/engine/crowd.test.mjs). Choices a to d as SV2-15 made them are
// the text of rules 6, 4a and 8 now, and are kept here for what they add:
//
//   a. Arrival (rule 6) is the tick on which the head steps off the last
//      slot into the room: the tick it took that slot plus secondsPerCell.
//      An unhindered group then has total = walking and waiting = 0, and
//      waiting is exactly the seconds it spent refused.
//   b. The step into the room takes no slot (rule 3), so it is never refused,
//      and rule 4 is not applied to it even when the door is on the left.
//   c. The slot of the cell a stairs connection lands on (rule 4a). The step
//      onto it has no heading, so its slot takes the heading of the next real
//      step on the route: the step off it, or the step into the room. A
//      walker who lands and leaves at once by another connection (the middle
//      floor of a stairwell drawn as a chain) takes the heading of the last
//      real step before the stairs instead, when it came down onto the cell;
//      one going up keeps the next real heading. Rule 4a does not say which
//      way, and applying it both ways puts the walkers going up through a
//      middle landing and those coming down through it in one slot whenever
//      the floors are drawn alike, which is what the rule is there to
//      prevent. Rule 4 asks nothing of the step off a landing cell (h1 is
//      none).
//   d. Waiting for a stopped group (rule 8) is the seconds it was refused,
//      not total − walking: a walk longer than the cap is stopped without
//      having waited at all, and the subtraction would go negative.
//   e. The cap. A group whose head is not in the room after tick `cap` has
//      been played is stopped there; one that steps in on tick `cap` itself
//      arrived. A stopped column stays where it is. Nobody is left to want
//      its slots: every group in a transition has the same cap.
//   f. Group order is by id as plain strings (code units), the order `<`
//      gives, so it does not depend on the machine's language.
//   g. k for a stairs connection uses Math.round, so a half rounds up
//      (8 s stairs at 3 s a cell is 3 slots; 10 s at 4 s is 3).
//   h. positions[t] is the head's path index once tick t has been played:
//      −1 in the first room, 0 … slots − 1 on the route, slots and above once
//      the head is in the room (the tail is at positions[t] − length + 1).
//      Every group's array runs to the transition's last tick. It is an
//      Int16Array unless a path is too long for one, then an Int32Array.
//   i. A head count that is missing or not a whole number from 1 up uses the
//      school default.
//   j. Standing (rule 4, added by SV2-37). The rule's words are "did not move
//      in the previous tick", but a tick is one second and a step takes
//      secondsPerCell of them, so a column walking at full pace does not move
//      in two ticks of every three. A group is standing when it was due a
//      step in the previous tick and was refused it (rule 5). A group between
//      two steps is walking and is waited for. At one second a cell the two
//      readings are the same.
//   k. Waited for this crossing (rule 4, SV2-37) counts the seconds the
//      crossing itself refused the turn at this cell. A second refused
//      because the cell ahead was taken, or lost to a lower id, is not one of
//      the 6. The count starts again at every crossing.
//   l. Each hold the other's crossing slot (rule 4, SV2-37): by the head or
//      by any part of the column, and the other group must be asking for a
//      left turn of its own on this tick. "Became ready the same tick" is the
//      two groups' readyAt being equal. When they differ the one that asked
//      first has been refused a second by the time the other asks, is
//      standing, and is walked around; it turns once the other has gone or
//      its own 6 seconds are up.
//
// What this module gives:
//
//   isLate(total, passingSeconds, marginSeconds)   the one lateness rule
//   crowdCap(passingSeconds)                       when a group is stopped
//   columnLength(headCount)                        slots a group is long
//   routePath(graph, route)                        the lane slots of a route
//   walkingSeconds(graph, route)                   the uncrowded time
//   simulateTransition(graph, walkers, options)    one transition
//   simulateDayTransition(project, routes, dayTypeId, period, graph?)
//   simulateDay(project, routes, dayTypeId, graph?)
//   simulateSchedule(project, routes, graph?)      every own day type
//   teacherWalks(project, graph?, options?)        teachers' walks, uncrowded
//   walkResults(project, crowd, graph?, options?)  what checkSchedule takes
//
// `graph` is routingGraph(project) from routing.js (a bare buildGraph result
// is wrapped); `routes` is what routesForSchedule() gave for the same project.
//
// One transition's result:
//
//   { passingSeconds, marginSeconds, cap,
//     seconds,          the last tick played
//     groups: [{ groupId, fromRoomId, toRoomId, headCount,
//                length,     slots the column is long
//                slots,      slots on its path
//                walking, waiting, total, late, arrived,
//                positions }],                in group id order
//     cellDelay,        Int32Array over the graph's nodes: seconds of waiting
//                       charged to each cell (the one the head was refused)
//     connectionDelay } Int32Array over graph.links, the same for stairs
//
// simulateDayTransition adds dayTypeId and period (the one walked out of).

import { DOOR_SIDES, STUDENTS_PER_LANE_CELL, RANGES, inRange, defaultSettings } from './schema.js';
import { routingGraph, route, createRouteCache } from './routing.js';
import { ownDayTypes, effectiveDayType } from './day-types.js';
import { bellsFor } from './bells.js';
import { teacherDays, teacherMoves } from './teacher-day.js';

export const CAP_FACTOR = 3;
export const CAP_MINIMUM_SECONDS = 600;
export const CROSSING_WAIT_MAX = 6;

const NONE = 4;
const OPPOSITE = [2, 3, 0, 1];
const LEFT = [3, 0, 1, 2]; // north turns left to west, east to north, south to east, west to south
const SIDE_INDEX = new Map(DOOR_SIDES.map((side, index) => [side, index]));
const INT16_MAX = 32767;

// Rule 8. Late is decided against the passing time plus the school's margin.
export function isLate(total, passingSeconds, marginSeconds) {
  return total > passingSeconds + (Number.isFinite(marginSeconds) ? marginSeconds : 0);
}

// Rule 6. The tick after which a group that has not arrived is stopped.
export function crowdCap(passingSeconds) {
  const passing = Number.isFinite(passingSeconds) && passingSeconds > 0 ? passingSeconds : 0;
  return Math.max(CAP_MINIMUM_SECONDS, Math.ceil(CAP_FACTOR * passing));
}

// A group of head count h is a column ceil(h / 6) slots long.
export function columnLength(headCount) {
  return Math.max(1, Math.ceil(headCount / STUDENTS_PER_LANE_CELL));
}

function headCountOf(group, settings) {
  if (group && Number.isInteger(group.headCount) && inRange(group.headCount, RANGES.headCount)) return group.headCount;
  const fallback = settings ? settings.defaultHeadCount : undefined;
  return Number.isInteger(fallback) && fallback >= 1 ? fallback : defaultSettings().defaultHeadCount;
}

// The slot numbering of a graph. A cell slot is node × 4 + heading. After
// those come the stairs slots: for each connection, k slots one way (from its
// `a` end) and then k the other.
const numberings = new WeakMap();

function numberingOf(graph) {
  if (!graph || graph.routing !== true) throw new TypeError('The crowd model needs a graph from routingGraph(project).');
  const held = numberings.get(graph);
  if (held) return held;
  const stairsStart = graph.count * 4;
  const linkSlots = new Int32Array(graph.links.length);
  const linkBase = new Int32Array(graph.links.length);
  const linkOfId = new Map();
  let total = 0;
  graph.links.forEach((link, index) => {
    const k = Math.max(1, Math.round((graph.secondsPerStair * link.levels) / graph.secondsPerCell));
    linkSlots[index] = k;
    linkBase[index] = total;
    total += 2 * k;
    linkOfId.set(link.id, index);
  });
  const linkOfSlot = new Int32Array(total);
  graph.links.forEach((link, index) => {
    for (let j = 0; j < 2 * linkSlots[index]; j += 1) linkOfSlot[linkBase[index] + j] = index;
  });
  const numbering = { stairsStart, slotCount: stairsStart + total, linkSlots, linkBase, linkOfId, linkOfSlot };
  numberings.set(graph, numbering);
  return numbering;
}

function headingBetween(graph, from, to) {
  for (let d = 0; d < 4; d += 1) if (graph.neighbours[from * 4 + d] === to) return d;
  return -1;
}

// The lane slots a group on this route occupies in order, or null when the
// route is the same room, failed, or does not fit this graph.
//
//   { length,   how many slots
//     slots,    Int32Array: the slot numbers
//     cross,    Int32Array: the crossing slot of the step from index i to
//               i + 1 when that step is a left turn (rule 4), or −1
//     nodes,    Int32Array: the graph node of a cell slot, −1 on the stairs
//     links,    Int32Array: the index into graph.links of a stairs slot, −1 on a cell
//     part }    Int32Array: 0 … k − 1 along a stairs connection, 0 on a cell
export function routePath(graph, found) {
  const numbering = numberingOf(graph);
  if (!found || found.ok !== true || found.same === true || !Array.isArray(found.cells) || found.cells.length === 0) return null;
  const count = found.cells.length;
  const nodeOf = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    const f = graph.floorIndex.get(found.cells[i].floorId);
    const cell = found.cells[i].cell;
    const node = f === undefined || !(cell >= 0 && cell < graph.floors[f].nodeOfCell.length) ? -1 : graph.floors[f].nodeOfCell[cell];
    if (node === -1) return null;
    nodeOf[i] = node;
  }
  // linkAfter[i]: the connection taken from cell i, as an index into graph.links
  const linkAfter = new Int32Array(count).fill(-1);
  const connections = found.connections || [];
  for (let c = 0; c < connections.length; c += 1) {
    const at = found.connectionAt[c];
    const link = numbering.linkOfId.get(connections[c]);
    if (link === undefined || !(at >= 0 && at + 1 < count)) return null;
    linkAfter[at] = link;
  }
  // the heading of the step onto each cell, and of the step into the room
  const stepIn = new Int8Array(count + 1);
  stepIn[0] = found.from && SIDE_INDEX.has(found.from.side) ? SIDE_INDEX.get(found.from.side) : NONE;
  for (let i = 1; i < count; i += 1) {
    if (linkAfter[i - 1] !== -1) {
      stepIn[i] = NONE;
    } else {
      const heading = headingBetween(graph, nodeOf[i - 1], nodeOf[i]);
      if (heading === -1) return null;
      stepIn[i] = heading;
    }
  }
  stepIn[count] = found.to && SIDE_INDEX.has(found.to.side) ? OPPOSITE[SIDE_INDEX.get(found.to.side)] : NONE;
  // choice c: the lane of a cell stepped onto with no heading
  const lane = new Int8Array(count);
  let next = stepIn[count] === NONE ? 0 : stepIn[count];
  for (let i = count - 1; i >= 0; i -= 1) {
    if (stepIn[i] !== NONE) next = stepIn[i];
    lane[i] = next;
  }
  let last = stepIn[0] === NONE ? next : stepIn[0];
  for (let i = 0; i < count; i += 1) {
    if (stepIn[i] !== NONE) {
      last = stepIn[i];
    } else if (linkAfter[i] !== -1 && graph.floors[graph.nodeFloor[nodeOf[i]]].level < graph.floors[graph.nodeFloor[nodeOf[i - 1]]].level) {
      lane[i] = last; // came down, and going straight on by another connection
    }
  }

  let length = count;
  for (let i = 0; i < count; i += 1) if (linkAfter[i] !== -1) length += numbering.linkSlots[linkAfter[i]];
  const slots = new Int32Array(length);
  const cross = new Int32Array(length).fill(-1);
  const nodes = new Int32Array(length).fill(-1);
  const links = new Int32Array(length).fill(-1);
  const part = new Int32Array(length);
  let p = 0;
  for (let i = 0; i < count; i += 1) {
    slots[p] = nodeOf[i] * 4 + lane[i];
    nodes[p] = nodeOf[i];
    // rule 4: a left turn from the heading walked in on asks about the oncoming lane of this cell
    if (i + 1 < count && linkAfter[i] === -1 && stepIn[i] !== NONE && stepIn[i + 1] === LEFT[stepIn[i]]) {
      cross[p] = nodeOf[i] * 4 + OPPOSITE[stepIn[i]];
    }
    p += 1;
    const link = linkAfter[i];
    if (link !== -1) {
      const k = numbering.linkSlots[link];
      const base = numbering.stairsStart + numbering.linkBase[link] + (graph.links[link].a === nodeOf[i] ? 0 : k);
      for (let j = 0; j < k; j += 1) {
        slots[p] = base + j;
        links[p] = link;
        part[p] = j;
        p += 1;
      }
    }
  }
  return { length, slots, cross, nodes, links, part };
}

// Rule 8: walking = (number of path slots) × secondsPerCell. This is the
// walking time every screen shows; null when there is no walk to time.
export function walkingSeconds(graph, found) {
  const path = routePath(graph, found);
  return path ? path.length * graph.secondsPerCell : null;
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// One transition. `walkers` is [{ id, headCount, route }] in any order; a
// walker whose route is the same room or failed takes no part (rule 7).
// options: { passingSeconds, marginSeconds }.
export function simulateTransition(graph, walkers, options) {
  const numbering = numberingOf(graph);
  const opts = options || {};
  const passingSeconds = Number.isFinite(opts.passingSeconds) ? opts.passingSeconds : defaultSettings().defaultPassingSeconds;
  const marginSeconds = Number.isFinite(opts.marginSeconds) ? opts.marginSeconds : 0;
  const cap = crowdCap(passingSeconds);
  const step = graph.secondsPerCell;

  const taking = [];
  for (const walker of walkers || []) {
    const path = walker ? routePath(graph, walker.route) : null;
    if (!path) continue;
    const headCount = headCountOf(walker, null);
    taking.push({ id: walker.id, route: walker.route, path, headCount, length: columnLength(headCount) });
  }
  taking.sort(byId);
  const count = taking.length;

  const cellDelay = new Int32Array(graph.count);
  const connectionDelay = new Int32Array(graph.links.length);
  let longest = 0;
  let wide = false;
  for (const walker of taking) {
    if (walker.length > longest) longest = walker.length;
    if (walker.path.length + walker.length > INT16_MAX) wide = true;
  }
  const lastTick = cap + longest * step; // a group in the room by `cap` has its tail in by then
  const occupancy = new Int32Array(numbering.slotCount).fill(-1);
  const head = new Int32Array(count).fill(-1);
  const readyAt = new Int32Array(count);
  const waited = new Int32Array(count);
  const refusedAt = new Int32Array(count).fill(-2); // the last tick each group was refused a step
  const crossingWaited = new Int32Array(count); // seconds rule 4 has refused the turn the head is at
  const arrivedAt = new Int32Array(count).fill(-1);
  const over = new Uint8Array(count); // 1: tail in the room, 2: stopped
  const want = new Int32Array(count);
  const track = new Int32Array(count * (lastTick + 1));
  const IDLE = -2;
  const FREE = -1;
  const REFUSED = -3;
  const CROSSING = -4; // refused by rule 4 alone

  let active = count;
  let tick = 0;
  for (; active > 0; tick += 1) {
    // rule 1, read: what each group may do, from the slots as the last tick left them
    for (let g = 0; g < count; g += 1) {
      want[g] = IDLE;
      if (over[g] || readyAt[g] > tick) continue; // rule 2
      const path = taking[g].path;
      const at = head[g];
      if (at >= path.length - 1) {
        want[g] = FREE; // into the room, or the column following it in: takes no slot
        continue;
      }
      const slot = path.slots[at + 1];
      if (occupancy[slot] !== -1) {
        want[g] = REFUSED; // rule 3
        continue;
      }
      want[g] = slot;
      // rule 4: a left turn needs the oncoming lane of this cell clear
      const crossing = at >= 0 ? path.cross[at] : -1;
      const other = crossing === -1 ? -1 : occupancy[crossing];
      if (other === -1 || other === g) continue;
      if (refusedAt[other] === tick - 1) continue; // a standing group is walked around (choice j)
      if (crossingWaited[g] >= CROSSING_WAIT_MAX) continue; // it has waited its 6 seconds (choice k)
      if (g < other && readyAt[other] === readyAt[g] && !over[other]) {
        // each holds the other's crossing slot and both became ready on this tick: the lower id goes first (choice l)
        const theirs = taking[other].path;
        const there = head[other];
        if (there >= 0 && there < theirs.length - 1 && theirs.cross[there] !== -1 && occupancy[theirs.cross[there]] === g) continue;
      }
      want[g] = CROSSING;
    }
    // rule 1, commit: in group id order
    for (let g = 0; g < count; g += 1) {
      const wanted = want[g];
      if (wanted === IDLE) continue;
      const walker = taking[g];
      const path = walker.path;
      const at = head[g];
      if (wanted === REFUSED || wanted === CROSSING || (wanted >= 0 && occupancy[wanted] !== -1)) {
        // rule 5: a second of waiting, charged to the slot the head was refused
        waited[g] += 1;
        refusedAt[g] = tick;
        if (wanted === CROSSING) crossingWaited[g] += 1;
        const refused = path.slots[at + 1];
        if (refused < numbering.stairsStart) cellDelay[refused >> 2] += 1;
        else connectionDelay[numbering.linkOfSlot[refused - numbering.stairsStart]] += 1;
        continue;
      }
      if (wanted >= 0) occupancy[wanted] = g;
      const tail = at - walker.length + 1;
      if (tail >= 0 && tail < path.length) occupancy[path.slots[tail]] = -1;
      head[g] = at + 1;
      readyAt[g] = tick + step;
      crossingWaited[g] = 0;
      if (head[g] === path.length) arrivedAt[g] = tick; // choice a
      if (head[g] >= path.length + walker.length - 1) {
        over[g] = 1;
        active -= 1;
      }
    }
    for (let g = 0; g < count; g += 1) track[g * (lastTick + 1) + tick] = head[g];
    // rule 6: not in the room once tick `cap` has been played
    if (tick === cap) {
      for (let g = 0; g < count; g += 1) {
        if (!over[g] && arrivedAt[g] === -1) {
          over[g] = 2;
          active -= 1;
        }
      }
    }
  }
  const seconds = count === 0 ? 0 : tick - 1;

  const groups = taking.map((walker, g) => {
    const arrived = arrivedAt[g] !== -1;
    const total = arrived ? arrivedAt[g] : cap;
    const positions = wide ? new Int32Array(seconds + 1) : new Int16Array(seconds + 1);
    for (let t = 0; t <= seconds; t += 1) positions[t] = track[g * (lastTick + 1) + t];
    return {
      groupId: walker.id,
      fromRoomId: walker.route.fromRoomId,
      toRoomId: walker.route.toRoomId,
      headCount: walker.headCount,
      length: walker.length,
      slots: walker.path.length,
      walking: walker.path.length * step, // rule 8
      waiting: waited[g],
      total,
      late: arrived ? isLate(total, passingSeconds, marginSeconds) : true,
      arrived,
      positions,
    };
  });
  return { passingSeconds, marginSeconds, cap, seconds, groups, cellDelay, connectionDelay };
}

function dayOf(project, routes, dayTypeId) {
  const dayType = effectiveDayType(project, dayTypeId);
  if (!dayType || !routes || !Array.isArray(routes.days)) return null;
  const day = routes.days.find((candidate) => candidate.dayTypeId === dayType.id);
  return day ? { dayType, day } : null;
}

function runTransition(project, routing, found, period, passingSeconds) {
  const settings = project.settings;
  const groupOf = new Map(project.groups.map((group) => [group.id, group]));
  const walkers = [];
  for (const entry of found.day.groups) {
    const group = groupOf.get(entry.groupId);
    const way = entry.routes[period];
    if (!group || !way || way.ok !== true || way.same === true) continue;
    walkers.push({ id: group.id, headCount: headCountOf(group, settings), route: way });
  }
  const marginSeconds = settings.checks ? settings.checks.passingMarginSeconds : 0;
  const result = simulateTransition(routing, walkers, { passingSeconds, marginSeconds });
  return { dayTypeId: found.dayType.id, period, ...result };
}

// The transition out of `period` (into period + 1) on one day type. A day
// type that is the same as A Day is answered from A Day. Null when the day
// type, its routes or the transition is not there.
export function simulateDayTransition(project, routes, dayTypeId, period, graph) {
  const found = dayOf(project, routes, dayTypeId);
  if (!found || !Number.isInteger(period) || period < 0 || period + 1 >= project.settings.periods) return null;
  const bells = bellsFor(project, found.dayType.id);
  return runTransition(project, routingGraph(project, graph), found, period, bells[period].passingAfter);
}

// Every transition of one day type: { dayTypeId, transitions: [one result each] }.
export function simulateDay(project, routes, dayTypeId, graph) {
  const found = dayOf(project, routes, dayTypeId);
  if (!found) return null;
  const routing = routingGraph(project, graph);
  const bells = bellsFor(project, found.dayType.id);
  const transitions = [];
  for (let period = 0; period + 1 < project.settings.periods; period += 1) {
    transitions.push(runTransition(project, routing, found, period, bells[period].passingAfter));
  }
  return { dayTypeId: found.dayType.id, transitions };
}

// The whole day of every day type that is its own copy: { days: [simulateDay's result] }.
export function simulateSchedule(project, routes, graph) {
  const routing = routingGraph(project, graph);
  const days = [];
  for (const dayType of ownDayTypes(project)) {
    const day = simulateDay(project, routes, dayType.id, routing);
    if (day) days.push(day);
  }
  return { days };
}

// A teacher's walk between rooms is routed like a group's and timed by
// walking alone, with no crowd. One entry per walk teacherMoves() names, on
// every own day type, in the shape checkSchedule takes. A walk with no way
// through has no figure and is left out. options.cache is a route cache.
export function teacherWalks(project, graph, options) {
  const routing = routingGraph(project, graph);
  const cache = options && options.cache ? options.cache : createRouteCache();
  const routeOptions = { cache };
  if (options && options.geometryVersion !== undefined) routeOptions.geometryVersion = options.geometryVersion;
  const marginSeconds = project.settings.checks ? project.settings.checks.passingMarginSeconds : 0;
  const walks = [];
  for (const dayType of ownDayTypes(project)) {
    const days = teacherDays(project, dayType.id);
    if (!days) continue;
    const bells = bellsFor(project, dayType.id);
    for (const teacher of project.teachers) {
      const day = days.get(teacher.id);
      if (!day) continue;
      for (const move of teacherMoves(day)) {
        const walking = walkingSeconds(routing, route(routing, move.fromRoomId, move.toRoomId, routeOptions));
        if (walking === null) continue;
        const passingSeconds = bells[move.period].passingAfter;
        walks.push({ dayTypeId: dayType.id, teacherId: teacher.id, period: move.period, fromRoomId: move.fromRoomId, toRoomId: move.toRoomId, passingSeconds, walking, late: isLate(walking, passingSeconds, marginSeconds) });
      }
    }
  }
  return walks;
}

// The walk results checkSchedule(project, walkResults) takes, built from
// simulateSchedule's result: { groups, teachers }. Every walk is there, late
// or not, so the travel-time tables read the same list the checks do.
export function walkResults(project, crowd, graph, options) {
  const groups = [];
  for (const day of crowd && Array.isArray(crowd.days) ? crowd.days : []) {
    for (const transition of day.transitions) {
      for (const group of transition.groups) {
        groups.push({
          dayTypeId: day.dayTypeId,
          groupId: group.groupId,
          period: transition.period,
          fromRoomId: group.fromRoomId,
          toRoomId: group.toRoomId,
          passingSeconds: transition.passingSeconds,
          total: group.total,
          walking: group.walking,
          waiting: group.waiting,
          late: group.late,
          arrived: group.arrived,
        });
      }
    }
  }
  return { groups, teachers: teacherWalks(project, graph, options) };
}
