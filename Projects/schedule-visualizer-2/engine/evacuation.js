// Evacuation: every room's way out, and what a door card says.
//
// The one rule is routeToExit() in routing.js: the quickest way from a room
// to any exit by walking time, stairs costed by their levels. Among ways that
// take the same seconds the one with fewer turns wins, then the one with
// fewer stairs connections, and only then the exit with the lower id, ids
// compared as strings (code unit by code unit, so "x10" is before "x9").
// This module asks routeToExit once per room, and once more only for a room
// with no way out while elevators are being left out (onlyByElevator below).
// Elevators are never used: a connection whose `kind` is 'elevator' is
// avoided. The model has no elevators yet (spec 11 is a wish), so today the
// guard finds none and the search is the plain one, sharing a cache's
// distance fields with the movement view's routes.
//
// evacuationRoutes(project, graph?, options?)
//   → { rooms: [{ roomId, floorId, route, onlyByElevator }], avoided: ['c…'],
//       asked: { avoidConnections: ['c…'], avoidStairs, avoidExits: ['x…'] } }
//   One entry per room, floors in display order and each floor's rooms in
//   the order the floor lists them. `route` is routeToExit's result as it
//   stands: { ok: true, exitId, exit, from, cells, connections, connectionAt,
//   seconds, turns, stairs } or { ok: false, reason, roomId, floorId, … }.
//   `onlyByElevator` is true for a room with no way out that has one when
//   the elevators are let in (routed again for that room only); else false.
//   `avoided` are the elevator connections left out. `asked` is what the
//   caller asked to avoid, as sorted lists. `graph` is buildGraph's or
//   routingGraph's; options are { cache, geometryVersion, avoidExits,
//   avoidConnections, avoidStairs } and pass through to routeToExit, the
//   caller's avoidConnections merged with the elevators, never replaced.
//
// byExit(project, evacuation)
//   → [{ exitId, floorId, doorName, assembly, roomIds, rooms, people, uncounted }]
//   Every exit in the building, floors in display order, each floor's exits
//   in its own order, also an exit no room uses. roomIds in the order of
//   evacuation.rooms; people is the sum of those rooms' capacity; uncounted
//   is how many of them have no capacity set (they add nothing to people).
//
// noRoute(project, evacuation)
//   → [{ roomId, floorId, reason, sentence, onlyByElevator }]
//   The rooms with no way out, in the order of evacuation.rooms, each with
//   describeFailure()'s sentence ("There is no way through from Room 105 on
//   Floor 1 to an exit.", "Room 105 on Floor 1 does not open onto a corridor.").
//   The elevators left out are not named as something avoided: a room whose
//   only way out is an elevator gets the plain "no way through" sentence and
//   onlyByElevator: true. Connections the caller asked to avoid are named
//   ("no way through that keeps to what you asked to avoid").
//
// doorCard(project, graph, route, options?)
//   `route` is one routeToExit result (an entry's `route`). `graph` is not
//   read today; it is in the signature so a later card (a step-free one)
//   can route without the caller changing. options are { units,
//   avoidConnections }: `units` is directions()'s { perCell, one, many } for
//   a building with a scale (none can be set yet); `avoidConnections` is the
//   list the route was worked out with (evacuation.asked.avoidConnections),
//   so a failure names what the caller avoided. The card is
//   { ok, stale, roomId, number, name, floor: { id, name, level }, … } and
//   then for a room with a way out:
//     floors   the floors the route uses, in the order it first reaches
//              them: [{ floorId, name, level, box, cells, start, exit, stairs, roomCells }]
//              box       { x, y, width, height } in cells: the route's cells
//                        on that floor, and on the room's floor the room's
//                        own cells, plus CROP_MARGIN on every side, clamped
//                        to the floor
//              cells     the route's cells on that floor, in walking order
//              start     the room cell the walker leaves by, on the room's floor; else null
//              exit      the exit's cell, on the exit's floor; else null
//              stairs    [{ cell, connectionId, label, way: 'leave' | 'arrive' }]
//              roomCells the room's cells, on the room's floor (to shade it); else null
//     steps    directions()'s steps, as a card says them, numbered by the
//              card: `n` counts the card's own steps from 1 and is not
//              directions()'s number once two steps are folded into one.
//              Without `units` every distance is taken out ("Walk 12 cells
//              along North Corridor." is "Walk along North Corridor."; a walk
//              with nothing else to say is "Walk on.") and the step loses
//              `cells` and `distance`; a walk not worded "Walk <distance>…"
//              is kept as directions() wrote it, distance and all. With
//              `units` the steps keep their distances in those units. A walk
//              that is "Walk on." or one cell long, followed by a turn, is
//              folded into it ("Walk on, then turn left.", "Walk past Room
//              301, then turn right."): kind 'walk' with the turn's `turn`.
//              Each step keeps kind, text and parts (name: true marks what a
//              user typed).
//     text     the steps as "1. …" lines
//     exit     { id, floorId, floorName, doorName, assembly }, as typed
//     seconds  routeToExit's seconds
//     sentence null
//   and for a room with none: floors [], steps [], text '', exit null,
//   seconds null and sentence describeFailure()'s sentence. A route that no
//   longer fits the building (its room, a floor, a cell, a connection or the
//   exit has gone or changed since it was worked out) gives ok: false,
//   stale: true and "The way out from Room 204 has changed since it was
//   worked out; work it out again." It never throws for a stale route.
//
// cardSteps(steps, units?)
//   → the card's steps from directions()'s `steps`, as doorCard words them:
//   distances out when `units` is left out, the folds, numbered by the card.
//   `steps` are read, never changed.
//
// The number, door name, assembly point and every name in a step's parts are
// as typed, in any script; nothing here escapes or interprets them.

import { nameOfRoom, isWalkable } from './schema.js';
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

// A Set or list of ids as a sorted list of strings, as routing.js reads one.
function idList(value) {
  if (!value || typeof value === 'string') return [];
  return Array.from(value).filter((item) => typeof item === 'string').sort();
}

export function evacuationRoutes(project, graph, options) {
  const opts = options || {};
  const routing = routingGraph(project, graph);
  const avoided = elevatorConnections(project);
  const callerConnections = idList(opts.avoidConnections);
  const asked = { avoidConnections: callerConnections, avoidStairs: opts.avoidStairs === true, avoidExits: idList(opts.avoidExits) };
  const plain = { cache: opts.cache, geometryVersion: opts.geometryVersion, avoidExits: opts.avoidExits, avoidStairs: asked.avoidStairs };
  if (callerConnections.length > 0) plain.avoidConnections = callerConnections;
  // the elevators added to what the caller avoids; left as the caller's when
  // there is no elevator, so the search is the plain one and a cache's
  // distance fields are the ones the movement view fills
  const onlyElevators = avoided.filter((id) => !callerConnections.includes(id));
  const guarded = onlyElevators.length > 0 ? { ...plain, avoidConnections: [...callerConnections, ...onlyElevators] } : plain;
  const rooms = roomsInOrder(project).map(({ room, floor }) => {
    const route = routeToExit(routing, room.id, guarded);
    const onlyByElevator = !route.ok && route.reason === 'unreachable' && onlyElevators.length > 0 && routeToExit(routing, room.id, plain).ok === true;
    return { roomId: room.id, floorId: floor.id, route, onlyByElevator };
  });
  return { rooms, avoided, asked };
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
// something the reader asked to avoid, so unless the caller asked to avoid
// connections of its own, a failure is worded as a plain one ("There is no
// way through from Room 204 on Floor 2 to an exit.").
function failureSentence(project, route, callerConnections) {
  const keep = idList(callerConnections).length > 0;
  const avoiding = Array.isArray(route.avoiding) ? route.avoiding.filter((what) => keep || what !== 'connections') : [];
  return describeFailure(project, { ...route, avoiding });
}

export function noRoute(project, evacuation) {
  const callerConnections = evacuation.asked ? evacuation.asked.avoidConnections : null;
  return evacuation.rooms
    .filter((entry) => !entry.route.ok)
    .map((entry) => ({
      roomId: entry.roomId,
      floorId: entry.floorId,
      reason: entry.route.reason,
      sentence: failureSentence(project, entry.route, callerConnections),
      onlyByElevator: entry.onlyByElevator === true,
    }));
}

// A walk step without its distance. directions() writes a walk as
// "Walk <distance>" and then, as the route has them, " along <corridor>",
// " to stairs <letter>" or " to the end of the corridor", ", towards <room>"
// or ", past <room>", and ".". A step worded any other way is kept as
// directions() wrote it, distance and all, rather than guessed at.
function withoutDistance(step) {
  if (step.kind !== 'walk') return step;
  const { cells, distance, ...kept } = step;
  const parts = Array.isArray(step.parts) ? step.parts : [];
  const rest = parts.slice(1);
  if (parts.length < 2 || !parts[0] || parts[0].text !== 'Walk ' + distance) return step;
  const out = [{ text: 'Walk', name: false }];
  if (rest.length === 1 && rest[0].text === '.') out.push({ text: ' on.', name: false });
  else if (!rest[0].name && typeof rest[0].text === 'string' && rest[0].text.startsWith(', ')) out.push({ text: ' ' + rest[0].text.slice(2), name: false }, ...rest.slice(1));
  else out.push(...rest);
  return { ...kept, text: out.map((part) => part.text).join(''), parts: out };
}

// A walk with nothing to say ("Walk on.") or one cell long, just before a
// turn, said with the turn: "Walk on, then turn left." `cells` is how long
// directions() said the walk was.
function foldable(step, cells, next) {
  if (!next || step.kind !== 'walk' || next.kind !== 'turn') return false;
  if (step.text !== 'Walk on.' && cells !== 1) return false;
  const last = step.parts[step.parts.length - 1];
  return Boolean(last) && !last.name && typeof last.text === 'string' && last.text.endsWith('.') && typeof next.text === 'string' && next.text.startsWith('Turn ');
}

function folded(step, next) {
  const parts = step.parts.slice(0, -1);
  const end = step.parts[step.parts.length - 1].text.slice(0, -1);
  if (end !== '') parts.push({ text: end, name: false });
  parts.push({ text: ', then t' + next.text.slice(1), name: false });
  return { ...step, text: parts.map((part) => part.text).join(''), parts, turn: next.turn };
}

export function cardSteps(raw, units) {
  const said = units ? raw : raw.map(withoutDistance);
  const steps = [];
  for (let i = 0; i < said.length; i += 1) {
    if (foldable(said[i], raw[i].cells, said[i + 1])) {
      steps.push(folded(said[i], said[i + 1]));
      i += 1;
    } else {
      steps.push(said[i]);
    }
  }
  return steps.map((step, index) => ({ ...step, n: index + 1 }));
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

// Called only once fits() has said the route matches the building.
function routeFloors(project, route, room) {
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const labels = new Map((project.building.connections || []).map((connection) => [connection.id, connection.label]));
  const crossing = new Map(route.connectionAt.map((index, i) => [index, route.connections[i]]));
  const used = [];
  const byFloor = new Map();
  route.cells.forEach((place, i) => {
    let held = byFloor.get(place.floorId);
    if (!held) {
      const floor = floors.get(place.floorId);
      held = { floorId: floor.id, name: floor.name, level: floor.level, box: null, cells: [], start: null, exit: null, stairs: [], roomCells: null };
      byFloor.set(place.floorId, held);
      used.push(held);
    }
    held.cells.push(place.cell);
    if (i > 0 && crossing.has(i - 1)) held.stairs.push({ cell: place.cell, connectionId: crossing.get(i - 1), label: labels.get(crossing.get(i - 1)), way: 'arrive' });
    if (crossing.has(i)) held.stairs.push({ cell: place.cell, connectionId: crossing.get(i), label: labels.get(crossing.get(i)), way: 'leave' });
  });
  const home = byFloor.get(route.from.floorId);
  if (home) {
    home.start = route.from.cell;
    home.roomCells = room.cells.slice();
  }
  byFloor.get(route.exit.floorId).exit = route.exit.cell;
  for (const held of used) held.box = boxOf(floors.get(held.floorId), held.roomCells ? [...held.cells, ...held.roomCells] : held.cells);
  return used;
}

function cellOn(floor, cell) {
  return Number.isInteger(cell) && cell >= 0 && cell < floor.width * floor.height;
}

// Whether a route worked out earlier still matches the building: its room is
// where it was and still has the cell it is left by, every cell it walks is
// still walkable, every connection is still there, and the exit is still the
// exit at its last cell. Nothing is assumed about a route's shape.
function fits(project, route, room, roomFloor) {
  if (!room || !roomFloor || !route.from || route.from.floorId !== roomFloor.id) return false;
  if (!Array.isArray(room.cells) || !room.cells.includes(route.from.cell)) return false;
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  if (!Array.isArray(route.cells) || route.cells.length === 0) return false;
  for (const place of route.cells) {
    const floor = place ? floors.get(place.floorId) : null;
    if (!floor || !cellOn(floor, place.cell) || !isWalkable(floor.cells[place.cell])) return false;
  }
  if (!floors.has(route.from.floorId) || !route.cells.some((place) => place.floorId === route.from.floorId)) return false;
  const connections = new Set((project.building.connections || []).map((connection) => connection.id));
  if (!Array.isArray(route.connections) || !Array.isArray(route.connectionAt) || route.connections.length !== route.connectionAt.length) return false;
  if (!route.connections.every((id) => connections.has(id))) return false;
  if (!route.connectionAt.every((index) => Number.isInteger(index) && index >= 0 && index < route.cells.length - 1)) return false;
  const last = route.cells[route.cells.length - 1];
  if (!route.exit || route.exit.id !== route.exitId || last.floorId !== route.exit.floorId || last.cell !== route.exit.cell) return false;
  const exitFloor = floors.get(route.exit.floorId);
  const exit = (exitFloor.exits || []).find((candidate) => candidate && candidate.id === route.exitId);
  return Boolean(exit) && exit.cell === route.exit.cell;
}

export function doorCard(project, graph, route, options) {
  const opts = options || {};
  const given = route && typeof route === 'object' ? route : {};
  const roomId = given.fromRoomId || given.roomId || null;
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
    ok: given.ok === true,
    stale: false,
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
  if (route !== given || (card.ok && !fits(project, given, room, floor))) {
    card.ok = false;
    card.stale = true;
    card.sentence = 'The way out from ' + (room ? nameOfRoom(room, false) : 'this room') + ' has changed since it was worked out; work it out again.';
    return card;
  }
  if (!card.ok) {
    card.sentence = failureSentence(project, given, opts.avoidConnections);
    return card;
  }
  const exitFloor = project.building.floors.find((candidate) => candidate.id === given.exit.floorId);
  const exit = exitFloor.exits.find((candidate) => candidate && candidate.id === given.exitId);
  card.floors = routeFloors(project, given, room);
  card.steps = cardSteps(directions(project, given, opts.units || CELL_UNITS).steps, opts.units);
  card.text = card.steps.map((step) => step.n + '. ' + step.text).join('\n');
  card.exit = { id: exit.id, floorId: exitFloor.id, floorName: exitFloor.name, doorName: exit.doorName, assembly: exit.assembly };
  card.seconds = given.seconds;
  return card;
}
