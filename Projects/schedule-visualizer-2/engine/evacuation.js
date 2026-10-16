// Evacuation: every room's way out, and what a door card says.
//
// The one rule is routeToExit() in routing.js: the quickest way from a room
// to any exit by walking time, stairs costed by their levels, exits that tie
// taken in id order. This module asks it once per room and never re-routes.
// Elevators are never used: a connection whose `kind` is 'elevator' is
// avoided. The model has no elevators yet (spec 11 is a wish), so today the
// guard finds none and the search is the plain one, sharing a cache's
// distance fields with the movement view's routes.
//
// evacuationRoutes(project, graph?, options?)
//   → { rooms: [{ roomId, floorId, route }], avoided: ['c…'] }
//   One entry per room, floors in display order and each floor's rooms in
//   the order the floor lists them. `route` is routeToExit's result as it
//   stands: { ok: true, exitId, exit, from, cells, connections, connectionAt,
//   seconds, turns, stairs } or { ok: false, reason, roomId, floorId, … }.
//   `avoided` are the elevator connections left out. `graph` is buildGraph's
//   or routingGraph's; options are { cache, geometryVersion, avoidExits }
//   and pass through to routeToExit.
//
// byExit(project, evacuation)
//   → [{ exitId, floorId, doorName, assembly, roomIds, rooms, people, uncounted }]
//   Every exit in the building, floors in display order, each floor's exits
//   in its own order, also an exit no room uses. roomIds in the order of
//   evacuation.rooms; people is the sum of those rooms' capacity; uncounted
//   is how many of them have no capacity set (they add nothing to people).
//
// noRoute(project, evacuation)
//   → [{ roomId, floorId, reason, sentence }]
//   The rooms with no way out, in the order of evacuation.rooms, each with
//   describeFailure()'s sentence ("There is no way through from Room 105 on
//   Floor 1 to an exit.", "Room 105 on Floor 1 does not open onto a corridor.").
//   The elevators left out are not named as something avoided: a room whose
//   only way out is an elevator gets the plain "no way through" sentence.
//
// doorCard(project, graph, route)
//   `route` is one routeToExit result (an entry's `route`). `graph` is not
//   read today; it is in the signature so a later card (a step-free one)
//   can route without the caller changing. The card is
//   { ok, roomId, number, name, floor: { id, name, level }, … } and then
//   for a room with a way out:
//     floors   the floors the route uses, in the order it first reaches
//              them: [{ floorId, name, level, box, cells, start, exit, stairs }]
//              box    { x, y, width, height } in cells: the route's cells on
//                     that floor plus CROP_MARGIN on every side, clamped to
//                     the floor
//              cells  the route's cells on that floor, in walking order
//              start  the room cell the walker leaves by, on the room's floor; else null
//              exit   the exit's cell, on the exit's floor; else null
//              stairs [{ cell, connectionId, label, way: 'leave' | 'arrive' }]
//     steps    directions()'s numbered steps with every distance taken out
//              ("Walk 12 cells along North Corridor." is "Walk along North
//              Corridor."); a walk with nothing else to say is "Walk on."
//              Each step keeps n, kind, text and parts (name: true marks
//              what a user typed); `cells` and `distance` are dropped.
//     text     the steps as "1. …" lines
//     exit     { id, floorId, floorName, doorName, assembly }, as typed
//     seconds  routeToExit's seconds
//     sentence null
//   and for a room with none: floors [], steps [], text '', exit null,
//   seconds null and sentence describeFailure()'s sentence.
//
// The number, door name, assembly point and every name in a step's parts are
// as typed, in any script; nothing here escapes or interprets them.

import { nameOfRoom } from './schema.js';
import { routingGraph, routeToExit } from './routing.js';
import { directions, describeFailure, CELL_UNITS } from './directions.js';

export const ELEVATOR_KIND = 'elevator';
export const CROP_MARGIN = 3;

// The connections a walker leaving in an emergency must not take.
export function elevatorConnections(project) {
  const building = project.building ? project.building : project;
  return (building.connections || []).filter((connection) => connection && connection.kind === ELEVATOR_KIND).map((connection) => connection.id);
}

function roomsInOrder(project) {
  const rooms = [];
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) if (space.kind === 'room') rooms.push({ room: space, floor });
  }
  return rooms;
}

export function evacuationRoutes(project, graph, options) {
  const opts = options || {};
  const routing = routingGraph(project, graph);
  const avoided = elevatorConnections(project);
  const asked = { cache: opts.cache, geometryVersion: opts.geometryVersion, avoidExits: opts.avoidExits };
  // left out when there is nothing to avoid, so the search is the plain one
  // and a cache's distance fields are the ones the movement view fills
  if (avoided.length > 0) asked.avoidConnections = avoided;
  const rooms = roomsInOrder(project).map(({ room, floor }) => ({
    roomId: room.id,
    floorId: floor.id,
    route: routeToExit(routing, room.id, asked),
  }));
  return { rooms, avoided };
}

export function byExit(project, evacuation) {
  const capacity = new Map(roomsInOrder(project).map(({ room }) => [room.id, room.capacity]));
  const rows = [];
  const byId = new Map();
  for (const floor of project.building.floors) {
    for (const exit of floor.exits || []) {
      const row = { exitId: exit.id, floorId: floor.id, doorName: exit.doorName, assembly: exit.assembly, roomIds: [], rooms: 0, people: 0, uncounted: 0 };
      rows.push(row);
      byId.set(exit.id, row);
    }
  }
  for (const entry of evacuation.rooms) {
    if (!entry.route.ok) continue;
    const row = byId.get(entry.route.exitId);
    if (!row) continue;
    row.roomIds.push(entry.roomId);
    row.rooms += 1;
    const held = capacity.get(entry.roomId);
    if (Number.isInteger(held) && held > 0) row.people += held;
    else row.uncounted += 1;
  }
  return rows;
}

// describeFailure()'s sentence. The elevators this module leaves out are not
// something the reader asked to avoid, so a failure is worded as a plain one
// ("There is no way through from Room 204 on Floor 2 to an exit.").
function failureSentence(project, route) {
  const avoiding = Array.isArray(route.avoiding) ? route.avoiding.filter((what) => what !== 'connections') : [];
  return describeFailure(project, { ...route, avoiding });
}

export function noRoute(project, evacuation) {
  return evacuation.rooms
    .filter((entry) => !entry.route.ok)
    .map((entry) => ({ roomId: entry.roomId, floorId: entry.floorId, reason: entry.route.reason, sentence: failureSentence(project, entry.route) }));
}

// A walk step without its distance. directions() writes a walk as
// "Walk <distance>" and then, as the route has them, " along <corridor>",
// " to stairs <letter>" or " to the end of the corridor", ", towards <room>"
// or ", past <room>", and ".".
function withoutDistance(step) {
  const { cells, distance, ...kept } = step;
  if (step.kind !== 'walk') return step;
  const rest = step.parts.slice(1);
  if (step.parts[0].text !== 'Walk ' + distance) throw new Error('A walk step did not start "Walk ' + distance + '": ' + step.text);
  const parts = [{ text: 'Walk', name: false }];
  if (rest.length === 1 && rest[0].text === '.') parts.push({ text: ' on.', name: false });
  else if (!rest[0].name && rest[0].text.startsWith(', ')) parts.push({ text: ' ' + rest[0].text.slice(2), name: false }, ...rest.slice(1));
  else parts.push(...rest);
  return { ...kept, text: parts.map((part) => part.text).join(''), parts };
}

function boxOf(floor, cells) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const cell of cells) {
    const x = cell % floor.width;
    const y = (cell - x) / floor.width;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const x = Math.max(0, left - CROP_MARGIN);
  const y = Math.max(0, top - CROP_MARGIN);
  return { x, y, width: Math.min(floor.width - 1, right + CROP_MARGIN) - x + 1, height: Math.min(floor.height - 1, bottom + CROP_MARGIN) - y + 1 };
}

function routeFloors(project, route) {
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const labels = new Map((project.building.connections || []).map((connection) => [connection.id, connection.label]));
  const crossing = new Map(route.connectionAt.map((index, i) => [index, route.connections[i]]));
  const used = [];
  const byFloor = new Map();
  route.cells.forEach((place, i) => {
    let held = byFloor.get(place.floorId);
    if (!held) {
      const floor = floors.get(place.floorId);
      held = { floorId: floor.id, name: floor.name, level: floor.level, box: null, cells: [], start: null, exit: null, stairs: [] };
      byFloor.set(place.floorId, held);
      used.push(held);
    }
    held.cells.push(place.cell);
    if (i > 0 && crossing.has(i - 1)) held.stairs.push({ cell: place.cell, connectionId: crossing.get(i - 1), label: labels.get(crossing.get(i - 1)), way: 'arrive' });
    if (crossing.has(i)) held.stairs.push({ cell: place.cell, connectionId: crossing.get(i), label: labels.get(crossing.get(i)), way: 'leave' });
  });
  byFloor.get(route.from.floorId).start = route.from.cell;
  byFloor.get(route.exit.floorId).exit = route.exit.cell;
  for (const held of used) held.box = boxOf(floors.get(held.floorId), held.cells);
  return used;
}

export function doorCard(project, graph, route) {
  const roomId = route.fromRoomId || route.roomId || null;
  let room = null;
  let floor = null;
  for (const candidate of project.building.floors) {
    const found = candidate.spaces.find((space) => space.kind === 'room' && space.id === roomId);
    if (found) {
      room = found;
      floor = candidate;
      break;
    }
  }
  const card = {
    ok: route.ok === true,
    roomId,
    number: room ? room.number : '',
    name: room ? nameOfRoom(room, true) : '',
    floor: floor ? { id: floor.id, name: floor.name, level: floor.level } : null,
    floors: [],
    steps: [],
    text: '',
    exit: null,
    seconds: null,
    sentence: null,
  };
  if (!card.ok) {
    card.sentence = failureSentence(project, route);
    return card;
  }
  const exitFloor = project.building.floors.find((candidate) => candidate.id === route.exit.floorId);
  const exit = (exitFloor.exits || []).find((candidate) => candidate.id === route.exitId);
  card.floors = routeFloors(project, route);
  card.steps = directions(project, route, CELL_UNITS).steps.map(withoutDistance);
  card.text = card.steps.map((step) => step.n + '. ' + step.text).join('\n');
  card.exit = { id: exit.id, floorId: exitFloor.id, floorName: exitFloor.name, doorName: exit.doorName, assembly: exit.assembly };
  card.seconds = route.seconds;
  return card;
}
