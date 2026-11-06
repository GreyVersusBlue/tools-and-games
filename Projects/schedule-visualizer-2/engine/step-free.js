// The step-free report (spec 11, "a report of rooms that cannot be reached
// without stairs"; ARCHITECTURE 19.6): which rooms a person who cannot use
// stairs cannot get to from outside, and why, and which step-free groups
// are scheduled into them.
//
//   stepFreeReport(project, graph?) → {
//     marked,          true when anything step-free is marked in the building: an elevator
//                      stop, a corridor step, a door or exit with a step, an area of refuge
//     noStepFreeExit,  true when no exit is step-free (or the building has none)
//     line,            the one sentence that says so, else null
//     rooms,           [{ roomId, floorId, reason, why }] in building order: the rooms with no
//                      step-free way in from any step-free exit, elevators open (a staff-only
//                      one included: whoever needs a step-free route is authorised)
//     groups }         [{ dayTypeId, period, entries: [{ groupId, roomId }] }] the step-free
//                      groups scheduled into those rooms, by day type (in the school's order)
//                      and period; empty when no group needs step-free routes or none is in one
//
// Each room's reason is the first that holds of:
//
//   'floor'    nothing on its floor is reached. why: "Floor 3 has no elevator stop" when no
//              elevator reaches a stop on the floor, else "no step-free way reaches Floor 3"
//   'doors'    a cell it is entered through is reached but every door has a step.
//              why: "every door of Room 204 has a step"
//   'steps'    it is reached when step cells are ignored. why: "a step on the way, North
//              Corridor" (the step nearest to the room, by its corridor's name or its floor's)
//   'no-way'   why: "no step-free way through"
//
// With no step-free exit the line says so ("No exit is step-free, so no room can be reached
// without stairs.") and every room is listed under it, each with reason 'no-exit' and why
// "no step-free exit".
//
// Not the same question as stepFreeWaysOut (evacuation.js): reaching a room may use an
// elevator; leaving in an emergency may not. The screen says so.
//
// Reachability is the graph's own flood (graph.js `reachable`, which knows a lift cell is never
// walked through) over the building with the stairs shut and, in the first pass, the corridor
// cells with a step shut: no other rule of routing is restated here.

import { resolveSlotRoom, nameOfRoom, elevatorCars } from './schema.js';
import { routingGraph } from './routing.js';
import { reachable } from './graph.js';
import { nearestStep } from './directions.js';
import { ownDayTypes } from './day-types.js';
import { meetingSlots } from './runs.js';

// The graph with every stairs link taken out, and, when `shutNodes` is given, every node in
// it cut off from its neighbours: what `reachable` floods for a person who cannot use stairs.
function stepFreeView(graph, shutNodes) {
  const shut = new Uint8Array(graph.count);
  for (const node of shutNodes || []) shut[node] = 1;
  const neighbours = graph.neighbours.slice();
  if (shutNodes && shutNodes.length > 0) {
    for (let node = 0; node < graph.count; node += 1) {
      for (let h = 0; h < 4; h += 1) {
        const next = neighbours[node * 4 + h];
        if (next !== -1 && (shut[node] || shut[next])) neighbours[node * 4 + h] = -1;
      }
    }
  }
  // links: the elevators only, as the per-node table graph.js builds for all of them
  const byNode = Array.from({ length: graph.count }, () => []);
  graph.links.forEach((link, index) => {
    if (!link.elevator) return;
    byNode[link.a].push(index);
    byNode[link.b].push(index);
  });
  const linkStart = new Int32Array(graph.count + 1);
  const linkList = [];
  for (let node = 0; node < graph.count; node += 1) {
    linkStart[node] = linkList.length;
    for (const index of byNode[node]) linkList.push(index);
  }
  linkStart[graph.count] = linkList.length;
  return { ...graph, neighbours, linkStart, linkList: Int32Array.from(linkList) };
}

// Anything step-free marked in the building (the screen says "Nothing step-free is marked yet"
// when not).
function anythingMarked(building) {
  if ((building.connections || []).some((connection) => connection && connection.kind === 'elevator')) return true;
  for (const floor of building.floors) {
    if ((floor.lifts || []).length > 0 || (floor.notStepFree || []).length > 0 || (floor.refuges || []).length > 0) return true;
    if ((floor.exits || []).some((exit) => exit.stepFree === false)) return true;
    if (floor.spaces.some((space) => space.kind === 'room' && (space.doors || []).some((door) => door.stepFree === false))) return true;
  }
  return false;
}

export function stepFreeReport(project, graph) {
  const routing = routingGraph(project, graph);
  const building = project.building;
  const exitNodes = routing.exits.filter((exit) => exit.stepFree !== false).map((exit) => exit.node);
  const report = { marked: anythingMarked(building), noStepFreeExit: exitNodes.length === 0, line: null, rooms: [], groups: [] };
  const listed = [];
  for (const floor of building.floors) for (const space of floor.spaces) if (space.kind === 'room') listed.push({ room: space, floor });

  if (report.noStepFreeExit) {
    report.line = 'No exit is step-free, so no room can be reached without stairs.';
    report.rooms = listed.map(({ room, floor }) => ({ roomId: room.id, floorId: floor.id, reason: 'no-exit', why: 'no step-free exit' }));
  } else {
    const strict = reachable(stepFreeView(routing, routing.stepNodes), exitNodes, { undirected: true });
    const loose = reachable(stepFreeView(routing, []), exitNodes, { undirected: true });
    const floors = new Map(building.floors.map((floor) => [floor.id, floor]));
    // the floors an elevator stops on
    const served = new Set();
    for (const car of elevatorCars(building)) if (car.connectionIds.length > 0) for (const stop of car.stops) served.add(stop.floorId);
    // floors with a node reached
    const touched = new Set();
    for (let node = 0; node < routing.count; node += 1) if (strict[node]) touched.add(routing.floors[routing.nodeFloor[node]].id);
    for (const { room, floor } of listed) {
      const entries = routing.rooms.get(room.id).entries;
      if (entries.some((entry) => entry.stepFree !== false && strict[entry.node])) continue;
      let reason = 'no-way';
      let why = 'no step-free way through';
      if (!touched.has(floor.id)) {
        reason = 'floor';
        why = served.has(floor.id) ? 'no step-free way reaches ' + floor.name : floor.name + ' has no elevator stop';
      } else if (entries.some((entry) => strict[entry.node])) {
        reason = 'doors';
        why = 'every door of ' + nameOfRoom(room, false) + ' has a step';
      } else if (entries.some((entry) => entry.stepFree !== false && loose[entry.node])) {
        reason = 'steps';
        why = 'a step on the way, ' + (nearestStep(floors, room) || floor.name);
      }
      report.rooms.push({ roomId: room.id, floorId: floor.id, reason, why });
    }
  }

  // the step-free groups scheduled into those rooms, by period
  const unreached = new Set(report.rooms.map((entry) => entry.roomId));
  if (unreached.size > 0 && Array.isArray(project.groups) && project.groups.some((group) => group.stepFree === true)) {
    for (const dayType of ownDayTypes(project)) {
      const periods = new Map();
      for (const group of project.groups) {
        if (group.stepFree !== true) continue;
        const slots = meetingSlots(project, group.id, dayType.id, null);
        if (!slots) continue;
        slots.forEach((slot, period) => {
          const found = resolveSlotRoom(project, slot).room;
          if (!found || !unreached.has(found.id)) return;
          if (!periods.has(period)) periods.set(period, []);
          periods.get(period).push({ groupId: group.id, roomId: found.id });
        });
      }
      for (const period of Array.from(periods.keys()).sort((a, b) => a - b)) report.groups.push({ dayTypeId: dayType.id, period, entries: periods.get(period) });
    }
  }
  return report;
}
