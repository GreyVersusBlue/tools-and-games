// Duplicate a floor (spec 4.1's wish; ARCHITECTURE 22.8 and 22.17; DESIGN 16.2
// and 16.12 item 1).
//
//   describeFloorDuplicate(project, floorId)  what the dialog says, before anything changes
//   duplicateFloor                            the action: one undo step
//
// The copy goes on top of the building (level = the highest level + 1, tab
// last, same width and height), so no other floor's level, and no stair time,
// moves. What is copied gets a new id of its own kind; what is not copied is
// said, in the dialog and in the toast, never left to be found out.
//
//   copied      cells (corridor and stairs), rooms (cells, doors, wing, capacity,
//               shared, features, subject), other spaces, corridor names,
//               exclusion zones, areas of refuge, steps, elevator stops (`lifts`)
//   not copied  teachers in rooms, schedule references, exits, the traced image,
//               scenario levers
//
// Room numbers: renumbered for the new level only when every numbered room's
// number starts with a run of digits of one length n, n at least two longer than
// the source level's own digits, whose first digits are the source level, and
// the new level has as many digits and the results are unused. Otherwise the
// copies have no number, and asking for the renumbering is refused in words,
// never quietly turned into blanks.
//
// Joining, at the floor directly below the new one (the old top floor), at the
// same cell, when that cell is stairs (or an elevator stop of a car): one plain
// flight there with no other run makes the two a stairwell lettered with that
// flight's own label; a stairwell is joined; two or more plain flights in its
// run leave a plain flight and the dialog says so. No letter ever changes. The
// new flight takes the joined well's or flight's way, translated per flight.

import { action, ActionError, GEOMETRY, BUILDING, SCHEDULE, reporting } from './actions.js';
import { connectStairs } from './building.js';
import { collectIds, isId } from './ids.js';
import { nameKey, nextConnectionLabel, roomNumberKey, elevatorCars, isLiftCell, stairwells, stairsLetter, textLength, ELEVATOR_KIND } from './schema.js';

function refuse(message, code) {
  throw new ActionError(message, code);
}

// A floor's name is as long as the other names the tool keeps.
export const FLOOR_NAME_MOST = 60;

// ---------------------------------------------------------------- reading

const hasWell = (connection) => typeof connection.well === 'string' && connection.well.trim() !== '';
const isStairs = (connection) => connection.kind !== ELEVATOR_KIND;
const sameEnd = (end, floorId, cell) => end.floorId === floorId && end.cell === cell;
const endKey = (end) => end.floorId + ':' + end.cell;

function needFloor(project, floorId) {
  const floor = project.building.floors.find((candidate) => candidate.id === floorId);
  if (!floor) refuse('That floor is no longer in the building.', 'missing');
  return floor;
}

function topFloor(building) {
  return building.floors.reduce((top, floor) => (floor.level >= top.level ? floor : top), building.floors[0]);
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function list(parts) {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

// The new floor's name: "Floor <level>" when the source is named "Floor <its
// level>", else "<name> (copy)"; made unique with " (2)", " (3)"…
function nameForCopy(building, source, level) {
  const base = source.name === 'Floor ' + source.level ? 'Floor ' + level : source.name + ' (copy)';
  const used = new Set(building.floors.map((floor) => nameKey(floor.name)));
  if (!used.has(nameKey(base))) return base;
  for (let n = 2; ; n += 1) if (!used.has(nameKey(base + ' (' + n + ')'))) return base + ' (' + n + ')';
}

function numberedRooms(floor) {
  return floor.spaces.filter((space) => space.kind === 'room' && typeof space.number === 'string' && space.number.trim() !== '');
}

// The renumbering rule. Returns { possible, reason, rooms: [{ id, from, to }] }.
// `reason` is why not, in the words of a sentence's tail: "Floor 2's numbers do
// not all start with 2".
function renumbering(building, source, newLevel) {
  const numbered = numberedRooms(source);
  const none = { possible: false, reason: 'none', rooms: [] };
  if (numbered.length === 0) return none;
  const level = String(source.level);
  const notLike = { possible: false, reason: source.name + '\'s numbers do not all start with ' + level, rooms: [] };
  if (!(source.level >= 1)) return { ...notLike, reason: source.name + ' is not on a level of 1 or more, and numbers carry the level only from there' };
  const runs = numbered.map((room) => /^[0-9]+/.exec(room.number.trim()));
  if (runs.some((run) => run === null)) return notLike;
  const length = runs[0][0].length;
  if (runs.some((run) => run[0].length !== length)) return notLike;
  if (length < level.length + 2) return notLike;
  if (runs.some((run) => !run[0].startsWith(level))) return notLike;
  const fresh = String(newLevel);
  if (fresh.length !== level.length) return { possible: false, reason: 'the new floor\'s level, ' + fresh + ', has a different number of digits from ' + level, rooms: [] };
  const used = new Set();
  for (const floor of building.floors) for (const space of floor.spaces) if (space.kind === 'room' && space.number.trim() !== '') used.add(roomNumberKey(space.number));
  const rooms = numbered.map((room) => {
    const text = room.number.trim();
    return { id: room.id, from: text, to: fresh + text.slice(level.length) };
  });
  const seen = new Set();
  for (const room of rooms) {
    const key = roomNumberKey(room.to);
    if (used.has(key) || seen.has(key)) return { possible: false, reason: 'a renumbered room would be ' + room.to + ', which is already a room number', rooms: [] };
    seen.add(key);
  }
  return { possible: true, reason: '', rooms };
}

// ---------------------------------------------------------------- joining

// The run of stairs flights that continue from `start` through shared cells.
function runFrom(building, start) {
  const flights = building.connections.filter(isStairs);
  const run = new Set([start.id]);
  const cells = new Set([endKey(start.a), endKey(start.b)]);
  for (let grown = true; grown;) {
    grown = false;
    for (const flight of flights) {
      if (run.has(flight.id)) continue;
      if (!cells.has(endKey(flight.a)) && !cells.has(endKey(flight.b))) continue;
      run.add(flight.id);
      cells.add(endKey(flight.a));
      cells.add(endKey(flight.b));
      grown = true;
    }
  }
  return flights.filter((flight) => run.has(flight.id));
}

function levelOf(building, floorId) {
  const floor = building.floors.find((candidate) => candidate.id === floorId);
  return floor ? floor.level : 0;
}

// 'up', 'down' or 'both' as the building sees one flight run.
function wayOf(building, flight) {
  if (flight.direction !== 'ab' && flight.direction !== 'ba') return 'both';
  const a = levelOf(building, flight.a.floorId);
  const b = levelOf(building, flight.b.floorId);
  if (a === b) return 'both';
  return flight.direction === (a < b ? 'ab' : 'ba') ? 'up' : 'down';
}

function sharedWay(building, flights) {
  const ways = new Set(flights.map((flight) => wayOf(building, flight)));
  return ways.size === 1 ? Array.from(ways)[0] : 'both';
}

// What joining would do at one stairs cell of the old top floor. The new floor
// is above it, so the new flight's `a` end is on the top floor and 'up' is 'ab'.
function stairsJoin(building, top, cell) {
  const here = building.connections.filter((connection) => isStairs(connection) && (sameEnd(connection.a, top.id, cell) || sameEnd(connection.b, top.id, cell)));
  if (here.length === 0) return null;
  const welled = here.find(hasWell);
  if (welled) {
    const well = stairwells(building).find((candidate) => nameKey(candidate.letter) === nameKey(welled.well));
    const flights = building.connections.filter((connection) => well && well.connectionIds.includes(connection.id));
    return { type: 'well-extend', cell, letter: welled.well.trim(), way: sharedWay(building, flights), from: well && well.stops.length > 0 ? well.stops[0].floorId : top.id };
  }
  const run = here.flatMap((flight) => runFrom(building, flight));
  const flights = Array.from(new Map(run.map((flight) => [flight.id, flight])).values());
  if (flights.length === 1) {
    const flight = flights[0];
    const lower = levelOf(building, flight.a.floorId) <= levelOf(building, flight.b.floorId) ? flight.a : flight.b;
    return { type: 'well-new', cell, flightId: flight.id, letter: stairsLetter(flight), way: wayOf(building, flight), from: lower.floorId };
  }
  return { type: 'plain', cell, letters: flights.map(stairsLetter), flightIds: flights.map((flight) => flight.id), way: sharedWay(building, flights) };
}

function liftJoin(building, top, cell) {
  const car = elevatorCars(building).find((candidate) => candidate.connectionIds.length > 0 && candidate.stops.some((stop) => stop.floorId === top.id && stop.cell === cell));
  if (!car) return null;
  return { type: 'elevator', cell, letter: car.label };
}

// The joins the copy would make, one per stairs or elevator cell of the source
// that is the same kind and connected at the same cell of the old top floor.
function joinsFor(building, source, top) {
  const joins = [];
  for (let cell = 0; cell < source.cells.length; cell += 1) {
    if (source.cells[cell] !== 'S') continue;
    if (top.width !== source.width || top.height !== source.height) continue;
    if (top.cells[cell] !== 'S') continue;
    const lift = isLiftCell(building, source.id, cell);
    if (lift !== isLiftCell(building, top.id, cell)) continue;
    const join = lift ? liftJoin(building, top, cell) : stairsJoin(building, top, cell);
    if (join) joins.push(join);
  }
  // stairs first, then elevators, each in cell order: the sentence reads "Stairs A will run…; Elevator D gets a stop…"
  return joins.filter((join) => join.type !== 'elevator').concat(joins.filter((join) => join.type === 'elevator'));
}

// ---------------------------------------------------------------- the dialog

// What the dialog says before anything changes. `options.name` is the name the
// user has typed so far, which the sentences then use.
//   { floorId, name, newName, newLevel, topName,
//     rooms, otherSpaces, namedCorridors, zones, refuges,
//     numbered, renumber: { possible, reason, examples: [{ from, to }], count },
//     unnumbered, notes,
//     joins: [{ type, cell, text }], joinText, separateText,
//     copied, notCopied, sentence }
export function describeFloorDuplicate(project, floorId, options) {
  const building = project.building;
  const source = building.floors.find((floor) => floor.id === floorId);
  if (!source) return null;
  const top = topFloor(building);
  const newLevel = top.level + 1;
  // the name typed in the dialog, when there is one, is the name the sentences use
  const typed = options && typeof options.name === 'string' && options.name.trim() !== '' ? options.name.trim() : null;
  const newName = typed !== null ? typed : nameForCopy(building, source, newLevel);
  const rooms = source.spaces.filter((space) => space.kind === 'room').length;
  const otherSpaces = source.spaces.length - rooms;
  const named = source.corridors.length;
  const numbered = numberedRooms(source).length;
  const renumber = renumbering(building, source, newLevel);
  const joins = joinsFor(building, source, top).map((join) => ({ ...join, text: joinText(building, join, top, newName) }));
  const parts = [];
  if (rooms > 0) parts.push(plural(rooms, 'room', 'rooms'));
  if (otherSpaces > 0) parts.push(plural(otherSpaces, 'other space', 'other spaces'));
  if (named > 0) parts.push(plural(named, 'named corridor', 'named corridors'));
  const copied = parts.length > 0 ? parts.join(', ') : 'an empty grid of the same size';
  const separate = joins.filter((join) => join.type === 'plain');
  return {
    floorId: source.id,
    name: source.name,
    newName,
    newLevel,
    topName: top.name,
    rooms,
    otherSpaces,
    namedCorridors: named,
    zones: building.zones.filter((zone) => zone.floorId === source.id).length,
    refuges: (source.refuges || []).length,
    numbered,
    unnumbered: rooms - numbered,
    renumber: {
      possible: renumber.possible,
      reason: renumber.reason,
      count: renumber.rooms.length,
      examples: renumber.rooms.slice(0, 2).map((room) => ({ from: room.from, to: room.to })),
    },
    // every numbered copy is a room no group uses and no teacher is based in
    notes: renumber.possible ? renumber.rooms.length : 0,
    joins,
    joinText: joins.length === 0 ? '' : joins.map((join) => join.text).join('; ') + '.',
    separateText: separate.length === 0 ? '' : separate.map((join) => 'Stairs ' + list(join.letters) + ' stay separate stairs; Make one stairwell is in the stair\'s properties.').join(' '),
    copied,
    notCopied: 'teachers in rooms, exits, the traced image',
    sentence: 'The copy goes on top of the building, as ' + newName + ', with ' + source.name + '\'s corridors, stairs, rooms and other spaces: ' + copied + '.',
  };
}

// A clause for one join, no capital at the end and no full stop: the dialog
// strings them with "; ". It names no letter change, because none is made.
function joinText(building, join, top, newName) {
  const name = (floorId) => (building.floors.find((floor) => floor.id === floorId) || { name: '' }).name;
  if (join.type === 'elevator') return 'Elevator ' + join.letter + ' gets a stop on ' + newName;
  if (join.type === 'well-extend') return 'Stairwell ' + join.letter + ' will run on to ' + newName;
  if (join.type === 'well-new') return 'Stairs ' + join.letter + ' will run from ' + name(join.from) + ' to ' + newName + ' as one stairwell';
  return 'a new flight joins ' + top.name + ' to ' + newName + ' (Stairs ' + list(join.letters) + ' stay separate stairs; Make one stairwell is in the stair\'s properties)';
}

// ---------------------------------------------------------------- the action

// A fresh id of one kind that nothing in the project has: the id maker may be
// seeded, and a project from a file may hold an id it would draw.
function idMaker(project, ids) {
  const taken = new Set(collectIds(project));
  return (prefix) => {
    let id = ids(prefix);
    for (let tries = 0; taken.has(id) && tries < 50; tries += 1) id = ids(prefix);
    taken.add(id);
    return id;
  };
}

// payload: { floorId, numbers?: "level" | "blank", join?: true | false, name?, id? }
//   numbers  default "level" when that is possible, else "blank"; "level" when
//            it is not possible is refused
//   join     default true
//   name     the new floor's name; left out, the default of describeFloorDuplicate
//   id       the new floor's id, as addFloor takes one
// The outcome (scheduleOutcome) says what was done:
//   { text, floorId, newName, rooms, renumbered, blanked, joins, notes }
export const duplicateFloor = action(
  {
    label: (before, payload, after) => 'Duplicate ' + ((before.building.floors.find((floor) => floor.id === payload.floorId) || { name: 'a floor' }).name) + ' as ' + (after.building.floors[after.building.floors.length - 1].name),
    bumps: [GEOMETRY, BUILDING, SCHEDULE],
    focus: (before, payload, after) => ({ section: 'building', floorId: after.building.floors[after.building.floors.length - 1].id }),
  },
  (project, payload, ctx) => {
    const data = payload || {};
    const building = project.building;
    const source = needFloor(project, data.floorId);
    const info = describeFloorDuplicate(project, source.id, { name: data.name });
    const top = topFloor(building);
    const makeId = idMaker(project, ctx.ids);

    let name = info.newName;
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim() === '') refuse('A floor needs a name. Type one, like Floor 4, and try again.', 'no-name');
      if (textLength(data.name.trim()) > FLOOR_NAME_MOST) refuse('A floor name is at most ' + FLOOR_NAME_MOST + ' characters, and this one has ' + textLength(data.name.trim()) + '. Shorten it.', 'too-long');
      name = data.name.trim();
    }
    if (data.numbers !== undefined && data.numbers !== 'level' && data.numbers !== 'blank') refuse('Room numbers are renumbered for the new level ("level") or left blank ("blank").', 'bad-value');
    if (data.join !== undefined && typeof data.join !== 'boolean') refuse('Joining the stairs and elevators is on or off.', 'bad-value');
    let id;
    if (typeof data.id === 'string' && data.id !== '') {
      if (!isId(data.id, 'f')) refuse('"' + data.id + '" cannot be the id of a floor: an id is 10 lowercase letters and digits and starts with "f". Leave the id out and one is made.', 'bad-id');
      if (collectIds(project).includes(data.id)) refuse('The id "' + data.id + '" is already used in this project. Leave the id out and a new one is made.', 'duplicate-id');
      id = data.id;
    } else {
      id = makeId('f');
    }

    const renumber = renumbering(building, source, info.newLevel);
    const numbers = data.numbers === undefined ? (renumber.possible ? 'level' : 'blank') : data.numbers;
    if (numbers === 'level' && !renumber.possible) {
      refuse(renumber.reason === 'none' ? source.name + ' has no numbered rooms, so there is nothing to renumber. Leave the numbers blank.' : 'The numbers cannot carry over: ' + renumber.reason + '. Leave the copies without numbers, and number them on the new floor.', 'cannot-renumber');
    }
    const toNumber = new Map(renumber.rooms.map((room) => [room.id, room.to]));

    const spaces = source.spaces.map((space) => {
      if (space.kind === 'room') {
        const room = { ...space, id: makeId('r'), cells: space.cells.slice(), doors: space.doors.map((door) => ({ ...door })), teacherIds: [], number: '' };
        if (Array.isArray(space.featureIds)) room.featureIds = space.featureIds.slice();
        if (numbers === 'level' && toNumber.has(space.id)) room.number = toNumber.get(space.id);
        return room;
      }
      return { ...space, id: makeId('o'), cells: space.cells.slice() };
    });
    const floor = {
      id,
      name,
      level: info.newLevel,
      width: source.width,
      height: source.height,
      cells: source.cells,
      spaces,
      corridors: source.corridors.map((corridor) => ({ ...corridor, id: makeId('k'), cells: corridor.cells.slice() })),
      exits: [],
      image: null,
    };
    // every stop of the source, connected or not: a stop that is only an end of an
    // elevator connection is a stop too, and the copy has to say so for itself
    const lifts = [];
    for (let cell = 0; cell < source.cells.length; cell += 1) if (source.cells[cell] === 'S' && isLiftCell(building, source.id, cell)) lifts.push(cell);
    if (lifts.length > 0) floor.lifts = lifts;
    if (Array.isArray(source.notStepFree)) floor.notStepFree = source.notStepFree.slice();
    if (Array.isArray(source.refuges)) floor.refuges = source.refuges.map((refuge) => ({ ...refuge, id: makeId('a') }));
    const zones = building.zones.filter((zone) => zone.floorId === source.id).map((zone) => ({ ...zone, id: makeId('z'), floorId: id }));
    let next = { ...building, floors: building.floors.concat([floor]), zones: building.zones.concat(zones) };

    // joining: the new floor is on top, so a new flight is from the old top
    // floor's cell (its `a`) to the new floor's (its `b`)
    const made = [];
    if (data.join !== false) {
      for (const join of joinsFor(building, source, top)) {
        const at = { a: { floorId: top.id, cell: join.cell }, b: { floorId: id, cell: join.cell } };
        let result;
        try {
          result = connectStairs(next, at, (prefix) => makeId(prefix));
        } catch (error) {
          if (error instanceof ActionError || (error && error.name === 'BuildingError')) refuse(error.message, error.code || 'bad-value');
          throw error;
        }
        next = result.building;
        if (join.type === 'elevator') {
          made.push({ type: 'elevator', cell: join.cell });
          continue;
        }
        next = { ...next, connections: next.connections.map((connection) => (connection.id !== result.connectionId ? connection : withWay(connection, join))) };
        if (join.type === 'well-new') {
          next = { ...next, connections: next.connections.map((connection) => (connection.id === join.flightId ? { ...connection, well: join.letter } : connection)) };
        }
        made.push({ type: join.type, cell: join.cell, letter: join.letter });
      }
    }

    const joinsMade = info.joins.filter((join) => made.some((entry) => entry.cell === join.cell));
    const notes = numbers === 'level' ? toNumber.size : 0;
    const blanked = numbers === 'blank' ? numberedRooms(source).length : 0;
    const text = 'Duplicated ' + source.name + ' as ' + name + (joinsMade.length > 0 ? ': ' + joinsMade.map((join) => join.text).join('; ') + '.' : '.');
    const outcome = {
      text,
      floorId: id,
      newName: name,
      rooms: info.rooms,
      otherSpaces: info.otherSpaces,
      renumbered: notes,
      blanked,
      joins: joinsMade.map((join) => ({ type: join.type, cell: join.cell, text: join.text })),
      notes,
    };
    return reporting(project, { ...project, building: next }, outcome);
  },
);

// The new flight's `well` and `direction`: it takes the way of the well or
// flight it joins, translated for its own two ends (a is on the old top floor,
// below b), and a well's letter when it joins one.
function withWay(connection, join) {
  const next = { ...connection };
  if (join.type === 'well-extend' || join.type === 'well-new') next.well = join.letter;
  if (join.way === 'up') next.direction = 'ab';
  else if (join.way === 'down') next.direction = 'ba';
  return next;
}
