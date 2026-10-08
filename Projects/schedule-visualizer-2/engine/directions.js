// Written directions from a route, as numbered steps relative to the walker:
// left and right as the walker faces, "to the end of the corridor", "past
// Room 104", stairs by their letter and the floor they lead to.
//
//   directions(project, route, units?) → { ok, steps, text }
//
// `route` is a result of route() or routeToExit() in routing.js. `units` says
// how a distance is written: { perCell, one, many }. Left out, distances are
// in cells ("12 cells"); a school that has set a scale passes for example
// { perCell: 2, one: 'metre', many: 'metres' }.
//
// A step is { n, kind, text, parts, … }:
//
//   n      its number, from 1
//   kind   'leave'   out of the door            + turn: 'left' | 'right' | 'straight' | null
//          'walk'    along a corridor           + cells (how many), distance (the words), to: 'end' | 'stairs' | null
//          'turn'    a turn between two walks   + turn: 'left' | 'right' | 'around'
//          'stairs'  one or more connections    + connections: ['c…'], labels, way: 'up' | 'down' | null, floorId
//          'arrive'  the room, and which side   + side: 'left' | 'right' | 'ahead' | 'here' | 'behind', roomId
//          'exit'    out of the building        + exitId
//          'same'    the same room, no travel
//   parts  the sentence in pieces, [{ text, name }]: name is true for a piece
//          a user typed (a room, a corridor, a floor, a door, a stairs
//          letter). `text` is the pieces joined and nothing else, so a typed
//          name is in it exactly as typed, whatever script it is in. A page
//          that wants each name kept together beside text in another
//          direction wraps the `name` pieces; nothing is added here.
//
// For a route that failed, ok is false, steps is empty and text is the
// sentence describeFailure() gives.
//
// Directions after a flight of stairs cannot say left or right, because the
// walker's facing on a landing is not known. Where the landing leads more
// than one way the walk is given a room to head towards instead.
//
// This module is one a published file carries, so it keeps to the linker
// rule: one-line named imports, `export` only directly before a declaration.

import { DOOR_SIDES, isWalkable, neighbourCell, spaceOwners } from './schema.js';
import { roomName } from './findings.js';

const NONE = 4;
const OPPOSITE = [2, 3, 0, 1];
const SIDE_INDEX = new Map(DOOR_SIDES.map((side, index) => [side, index]));

export const CELL_UNITS = { perCell: 1, one: 'cell', many: 'cells' };

function typed(text) {
  return { text, name: true };
}

function words(text) {
  return { text, name: false };
}

// A room's name as roomName() gives it, split so that only what was typed is
// marked as a name: "Room " + "204", or "Gym", or "a room with no number".
function roomParts(room, start) {
  const name = roomName(room, start);
  const number = room && typeof room.number === 'string' ? room.number : '';
  if (number.trim() === '') return [words(name)];
  if (name === number) return [typed(number)];
  return [words(name.slice(0, name.length - number.length)), typed(number)];
}

function finish(steps, kind, parts, more) {
  const pieces = parts.filter((part) => part.text !== '');
  steps.push({ n: steps.length + 1, kind, text: pieces.map((part) => part.text).join(''), parts: pieces, ...more });
}

// 'straight', 'left', 'right' or 'around': heading `to` as seen by someone
// facing `from`.
function relative(from, to) {
  if (from === to) return 'straight';
  if ((from + 1) % 4 === to) return 'right';
  if ((from + 3) % 4 === to) return 'left';
  return 'around';
}

function distanceWords(cells, units) {
  const unit = units && Number.isFinite(units.perCell) && units.perCell > 0 ? units : CELL_UNITS;
  const amount = Math.max(1, Math.round(cells * unit.perCell));
  return amount + ' ' + (amount === 1 ? unit.one : unit.many);
}

function lookup(project) {
  const building = project.building ? project.building : project;
  const floors = new Map(building.floors.map((floor) => [floor.id, floor]));
  const connections = new Map((building.connections || []).map((connection) => [connection.id, connection]));
  const rooms = new Map();
  for (const floor of building.floors) {
    for (const space of floor.spaces) if (space.kind === 'room') rooms.set(space.id, space);
  }
  return { floors, connections, rooms };
}

function headingBetween(floor, a, b) {
  for (let h = 0; h < 4; h += 1) if (neighbourCell(floor, a, DOOR_SIDES[h]) === b) return h;
  return NONE;
}

function walkableAt(floor, cell) {
  return cell !== -1 && isWalkable(floor.cells[cell]);
}

// The named corridor every one of these cells lies in, or null.
function corridorOf(floor, cells) {
  for (const corridor of floor.corridors || []) {
    if (typeof corridor.name !== 'string' || corridor.name.trim() === '') continue;
    const held = new Set(corridor.cells);
    if (cells.every((cell) => held.has(cell))) return corridor;
  }
  return null;
}

// The spaces beside a walk, in the order they are passed: rooms, and other
// spaces that have a label. The rooms at the two ends of the route are not
// landmarks.
function landmarks(floor, cells, heading, skip) {
  const owners = spaceOwners(floor);
  const found = [];
  for (const cell of cells) {
    for (const side of [(heading + 3) % 4, (heading + 1) % 4]) {
      const beside = neighbourCell(floor, cell, DOOR_SIDES[side]);
      const space = beside === -1 ? undefined : owners.get(beside);
      if (!space || skip.has(space.id) || (found.length > 0 && found[found.length - 1] === space)) continue;
      if (space.kind === 'room' || (typeof space.label === 'string' && space.label.trim() !== '')) found.push(space);
    }
  }
  return found;
}

function spaceParts(space) {
  return space.kind === 'room' ? roomParts(space, false) : [typed(space.label)];
}

// The sentence for a route that failed, naming the room and its floor.
export function describeFailure(project, route) {
  const { floors, rooms } = lookup(project);
  const room = route.roomId ? rooms.get(route.roomId) : null;
  const floor = route.floorId ? floors.get(route.floorId) : null;
  const where = (start) => (room ? roomName(room, start) : start ? 'The room' : 'the room') + (floor ? ' on ' + floor.name : '');
  if (route.reason === 'no-room') return 'No room is set for this period.';
  if (route.reason === 'room-missing') {
    const text = typeof route.text === 'string' && route.text.trim() !== '' ? route.text : '';
    return text === '' ? 'The room is not in the building.' : roomName({ number: text }, true) + ' is not in the building.';
  }
  if (route.reason === 'no-entry') return where(true) + ' does not open onto a corridor.';
  const other = route.end === 'to' ? rooms.get(route.fromRoomId) : null;
  const stepFree = Array.isArray(route.avoiding) && route.avoiding.includes('stairs');
  const avoiding = Array.isArray(route.avoiding) && route.avoiding.length > 0;
  const way = stepFree ? 'no step-free way through' : avoiding ? 'no way through that keeps to what you asked to avoid' : 'no way through';
  if (route.end === 'to') return 'There is ' + way + (other ? ' from ' + roomName(other, false) : '') + ' to ' + where(false) + '.';
  return 'There is ' + way + ' from ' + where(false) + ' to an exit.';
}

export function directions(project, route, units) {
  if (!route || route.ok !== true) return { ok: false, steps: [], text: route ? describeFailure(project, route) : 'No route was asked for.' };
  const steps = [];
  if (route.same) {
    finish(steps, 'same', [words('This is the same room. There is no travel.')], {});
    return { ok: true, steps, text: steps[0].text };
  }

  const { floors, connections, rooms } = lookup(project);
  const cells = route.cells;
  const last = cells.length - 1;
  const crossing = new Map(route.connectionAt.map((index, i) => [index, route.connections[i]]));
  // moves[i] is how the walker gets from cells[i] to cells[i + 1]: a heading, or NONE for a connection
  const moves = [];
  for (let i = 0; i < last; i += 1) {
    moves.push(crossing.has(i) ? NONE : headingBetween(floors.get(cells[i].floorId), cells[i].cell, cells[i + 1].cell));
  }
  const skip = new Set([route.fromRoomId, route.toRoomId]);
  const out = SIDE_INDEX.get(route.from.side);
  const into = route.to ? OPPOSITE[SIDE_INDEX.get(route.to.side)] : NONE;
  // with one cell between the two rooms there is no walk to turn into: the
  // last step says which side the room is on as the walker comes out
  const first = last > 0 ? moves[0] : NONE;

  // 1. out of the door
  const doorway = route.from.door ? 'door' : 'room';
  if (first === NONE) {
    finish(steps, 'leave', [words('Go out of the ' + doorway + '.')], { turn: null });
  } else {
    const turn = relative(out, first);
    const lead = turn === 'straight' ? 'Go straight' : turn === 'around' ? 'Turn around' : 'Turn ' + turn;
    finish(steps, 'leave', [words(lead + ' out of the ' + doorway + '.')], { turn });
  }

  // 2. the walks, turns and stairs
  let facing = first === NONE ? NONE : first;
  let afterStairs = false;
  let i = 0;
  while (i < last) {
    if (moves[i] === NONE) {
      const ids = [];
      const start = i;
      while (i < last && moves[i] === NONE) {
        ids.push(crossing.get(i));
        i += 1;
      }
      const fromFloor = floors.get(cells[start].floorId);
      const toFloor = floors.get(cells[i].floorId);
      const way = toFloor.level > fromFloor.level ? 'up' : toFloor.level < fromFloor.level ? 'down' : null;
      const labels = ids.map((id) => (connections.get(id) ? connections.get(id).label : ''));
      const parts = [words('Take ')];
      labels.forEach((label, index) => {
        parts.push(words((index > 0 ? ', then ' : '') + 'stairs '), typed(label));
      });
      if (toFloor !== fromFloor) parts.push(words((way ? ' ' + way : '') + ' to '), typed(toFloor.name));
      parts.push(words('.'));
      finish(steps, 'stairs', parts, { connections: ids, labels, way, floorId: toFloor.id });
      facing = NONE;
      afterStairs = true;
      continue;
    }

    const heading = moves[i];
    const start = i;
    while (i < last && moves[i] === heading) i += 1;
    const floor = floors.get(cells[start].floorId);
    const run = cells.slice(start, i + 1).map((place) => place.cell);
    if (facing !== NONE && facing !== heading) {
      const turn = relative(facing, heading);
      finish(steps, 'turn', [words(turn === 'around' ? 'Turn around.' : 'Turn ' + turn + '.')], { turn });
    }

    const count = run.length - 1;
    const distance = distanceWords(count, units);
    const parts = [words('Walk ' + distance)];
    // a single step is not worth a corridor's name or "to the end"
    const corridor = count > 1 ? corridorOf(floor, run.slice(1)) : null;
    if (corridor) parts.push(words(' along '), typed(corridor.name));
    let to = null;
    if (i < last && moves[i] === NONE) {
      const label = connections.get(crossing.get(i)) ? connections.get(crossing.get(i)).label : '';
      parts.push(words(' to stairs '), typed(label));
      to = 'stairs';
    } else if (count > 1 && !walkableAt(floor, neighbourCell(floor, run[run.length - 1], DOOR_SIDES[heading]))) {
      parts.push(words(' to the end of the corridor'));
      to = 'end';
    }
    const beside = landmarks(floor, run.slice(0, -1), heading, skip);
    let landmark = null;
    if (afterStairs) {
      // which way off the landing: only said when there is more than one
      const ways = DOOR_SIDES.filter((side) => walkableAt(floor, neighbourCell(floor, run[0], side))).length;
      if (ways > 1 && beside.length > 0) {
        landmark = beside[0];
        parts.push(words(', towards '), ...spaceParts(landmark));
      }
    } else if (to === null && beside.length > 0) {
      landmark = beside[beside.length - 1];
      parts.push(words(', past '), ...spaceParts(landmark));
    }
    parts.push(words('.'));
    finish(steps, 'walk', parts, { cells: count, distance, to, corridorId: corridor ? corridor.id : null, landmarkId: landmark ? landmark.id : null });
    facing = heading;
    afterStairs = false;
  }

  // 3. the end
  if (route.exit) {
    const floor = floors.get(route.exit.floorId);
    const exit = floor ? (floor.exits || []).find((candidate) => candidate.id === route.exit.id) : null;
    const doorName = exit && typeof exit.doorName === 'string' && exit.doorName.trim() !== '' ? exit.doorName : '';
    finish(steps, 'exit', doorName === '' ? [words('Leave the building by the exit here.')] : [words('Exit at '), typed(doorName), words('.')], { exitId: route.exit.id });
  } else {
    const room = rooms.get(route.toRoomId);
    const arriving = last > 0 ? facing : out;
    let side = 'here';
    let tail = ' is by the stairs.';
    if (arriving !== NONE) {
      const turn = relative(arriving, into);
      side = turn === 'straight' ? 'ahead' : turn === 'around' ? 'behind' : turn;
      tail = turn === 'straight' ? (last === 0 ? ' is straight across the corridor.' : ' is straight ahead.') : turn === 'around' ? ' is behind you.' : ' is on your ' + turn + '.';
    }
    finish(steps, 'arrive', [...roomParts(room, true), words(tail)], { side, roomId: route.toRoomId });
  }

  return { ok: true, steps, text: steps.map((step) => step.n + '. ' + step.text).join('\n') };
}
