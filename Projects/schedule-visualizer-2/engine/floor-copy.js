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
// Room numbers, room by room (22.17; Devon 2026-11-21): a room whose number
// starts with a run of digits at least two longer than the source level's own,
// whose first digits are the source level, is renumbered for the new level when
// the new level has as many digits and the result is unused (201 is 401). Any
// other numbered room ("Library", "21", a number already taken) keeps its own
// number with " 2" after it ("Library 2"), or " 3" and on when that is taken in
// the school. Rooms are left without numbers only when the user chooses that.

// Joining, at the floor directly below the new one (the old top floor), at the
// same cell, when that cell is stairs (or an elevator stop of a car): one plain
// flight there with no other run makes the two a stairwell lettered with that
// flight's own label; a stairwell is joined; two or more plain flights in its
// run leave a plain flight and the dialog says so. No letter ever changes. The
// new flight takes the joined well's or flight's way, translated per flight.

import { action, ActionError, GEOMETRY, BUILDING, SCHEDULE, reporting } from './actions.js';
import { connectStairs } from './building.js';
import { collectIds, isId } from './ids.js';
import { checkSchedule } from './checks.js';
import { copyNumber } from './numbering.js';
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

// The renumbering, room by room (ARCHITECTURE 22.17; Devon 2026-11-21: "Duplicates
// should be 'library 2'"). Returns { possible, reason, rooms: [{ id, from, to,
// level }], text }: `possible` when the floor has a numbered room, `reason`
// 'none' when it has none, `level` true for a room renumbered for the new level
// and false for one that keeps its own number with a count after it, and `text`
// the dialog's one sentence: "Rooms 201 to 204 become 401 to 404; Library
// becomes Library 2."
function renumbering(building, source, newLevel) {
  const numbered = numberedRooms(source);
  if (numbered.length === 0) return { possible: false, reason: 'none', rooms: [], text: '' };
  const level = String(source.level);
  const fresh = String(newLevel);
  const used = new Set();
  for (const floor of building.floors) for (const space of floor.spaces) if (space.kind === 'room' && typeof space.number === 'string' && space.number.trim() !== '') used.add(roomNumberKey(space.number));
  // first every room that follows the floor rule, so a count never takes the
  // number a renumbered room would have
  const levelled = new Map();
  for (const room of numbered) {
    const to = levelNumber(room.number.trim(), source.level, level, fresh);
    if (to === null || used.has(roomNumberKey(to))) continue;
    used.add(roomNumberKey(to));
    levelled.set(room.id, to);
  }
  const rooms = numbered.map((room) => {
    const from = room.number.trim();
    if (levelled.has(room.id)) return { id: room.id, from, to: levelled.get(room.id), level: true };
    return { id: room.id, from, to: copyNumber(from, used), level: false };
  });
  return { possible: true, reason: '', rooms, text: numbersText(rooms) };
}

// The floor rule for one room: the source level L at least 1, the number
// beginning with a run of digits at least len(L) + 2 long whose first digits are
// L, and the new level as many digits as L: those first digits become the new
// level ("214B" on level 2 is "414B" on level 4). Null when the room cannot.
function levelNumber(text, sourceLevel, level, fresh) {
  if (!(sourceLevel >= 1) || fresh.length !== level.length) return null;
  const run = /^[0-9]+/.exec(text);
  if (run === null || run[0].length < level.length + 2 || !run[0].startsWith(level)) return null;
  return fresh + text.slice(level.length);
}

// "Room 201 becomes 401", "Rooms 201 to 204 become 401 to 404" (a run with no
// gap), "The 3 rooms from 201 to 214B become 401 to 414B"; then each room with a
// count, "Library becomes Library 2", the first two and how many more past three.
function numbersText(rooms) {
  const parts = [];
  const byNumber = (a, b) => a.from.localeCompare(b.from, undefined, { numeric: true });
  const levelled = rooms.filter((room) => room.level).sort(byNumber);
  if (levelled.length === 1) parts.push('Room ' + levelled[0].from + ' becomes ' + levelled[0].to);
  else if (levelled.length === 2) parts.push('Rooms ' + levelled[0].from + ' and ' + levelled[1].from + ' become ' + levelled[0].to + ' and ' + levelled[1].to);
  else if (levelled.length > 2) {
    const first = levelled[0];
    const last = levelled[levelled.length - 1];
    const run = levelled.every((room, n) => /^[0-9]+$/.test(room.from) && room.from.length === first.from.length && BigInt(room.from) === BigInt(first.from) + BigInt(n));
    parts.push((run ? 'Rooms ' : 'The ' + levelled.length + ' rooms from ') + first.from + ' to ' + last.from + ' become ' + first.to + ' to ' + last.to);
  }
  const counted = rooms.filter((room) => !room.level);
  const becomes = (room) => room.from + ' becomes ' + room.to;
  if (counted.length > 0 && counted.length <= 3) parts.push(list(counted.map(becomes)));
  else if (counted.length > 3) parts.push(counted.slice(0, 2).map(becomes).join(', ') + ' and ' + (counted.length - 2) + ' more rooms keep their own numbers with a count after them');
  return parts.join('; ') + '.';
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
  const ordered = joins.filter((join) => join.type !== 'elevator').concat(joins.filter((join) => join.type === 'elevator'));
  // each new connection's own label, as connectStairs will give it, one after
  // another in this order: a plain flight is shown by it ("Stairs C")
  const labels = building.connections.slice();
  return ordered.map((join) => {
    const label = nextConnectionLabel(labels);
    labels.push({ label, well: join.type === 'well-extend' || join.type === 'well-new' ? join.letter : undefined });
    return join.type === 'plain' ? { ...join, newLetter: label } : join;
  });
}

// ---------------------------------------------------------------- the dialog

// What the dialog says before anything changes. `options.name` is the name the
// user has typed so far, which the sentences then use.
//   { floorId, name, newName, newLevel, topName,
//     rooms, otherSpaces, namedCorridors, zones, refuges,
//     numbered, renumber: { possible, reason, examples: [{ from, to }], count, counted, text },
//     unnumbered, notes, noteCounts: { <check kind>: n }, notesText,
//     joins: [{ type, cell, text }], joinText, separateText,
//     copied, notCopied, notJoinedText, unjoinedText, sentence }
export function describeFloorDuplicate(project, floorId, options) {
  const info = describeCopy(project, floorId, options);
  if (!info) return null;
  const notes = info.renumber.possible ? copyNotes(project, floorId) : NO_NOTES;
  return { ...info, notes: notes.count, noteCounts: notes.kinds, notesText: notes.text };
}

// ---------------------------------------------------------------- the notes

// What the numbered copies raise in the Checks tab, from the checks themselves:
// the copy is made (renumbered, not joined, ids of its own) and the schedule
// checked before and after; every new finding about a copied room is counted,
// by kind. A copy has no teacher and no group, so it is "a room no group uses"
// once for each day type the checks read, and "a room with no subject" when
// its source has none. Kept per project and floor: the dialog asks again on
// every key typed in the name, and a project is never changed in place.
const NO_NOTES = { count: 0, kinds: {}, text: '' };
const notesKept = new WeakMap();

const NOTE_WORDS = {
  'room-unused': 'a room no group uses',
  'room-no-subject': 'a room with no subject',
  'room-no-teacher': 'a room with groups and no teacher',
};

function copyNotes(project, floorId) {
  let kept = notesKept.get(project);
  if (!kept) {
    kept = new Map();
    notesKept.set(project, kept);
  }
  if (!kept.has(floorId)) kept.set(floorId, countCopyNotes(project, floorId));
  return kept.get(floorId);
}

function countCopyNotes(project, floorId) {
  let n = 0;
  const ids = (prefix) => prefix + 'note' + String((n += 1)).padStart(5, '0');
  let after;
  try {
    after = duplicateFloor(project, { floorId, numbers: 'level', join: false }, { ids });
  } catch (error) {
    if (error instanceof ActionError) return NO_NOTES;
    throw error;
  }
  const copy = after.building.floors[after.building.floors.length - 1];
  const copied = new Set(copy.spaces.map((space) => space.id));
  const before = new Set(checkSchedule(project).findings.map((finding) => finding.id));
  const kinds = {};
  const days = new Set();
  for (const finding of checkSchedule(after).findings) {
    if (before.has(finding.id) || finding.severity !== 'note' || !copied.has(finding.where.roomId)) continue;
    kinds[finding.kind] = (kinds[finding.kind] || 0) + 1;
    if (finding.kind === 'room-unused' && finding.where.dayTypeId) days.add(finding.where.dayTypeId);
  }
  const total = Object.values(kinds).reduce((sum, each) => sum + each, 0);
  if (total === 0) return NO_NOTES;
  const rooms = copy.spaces.filter((space) => space.kind === 'room' && space.number.trim() !== '').length;
  const parts = Object.keys(kinds).map((kind) => {
    const words = kinds[kind] + ' for ' + (NOTE_WORDS[kind] || kind);
    return kind === 'room-unused' && days.size > 1 ? words + ' (one for each of the ' + days.size + ' day types)' : words;
  });
  const text = 'The ' + plural(rooms, 'numbered copy', 'numbered copies') + ' will add ' + plural(total, 'note', 'notes') + ' to the Checks tab: ' + list(parts) + '.';
  return { count: total, kinds, text };
}

// describeFloorDuplicate without the notes, which the action itself does not need.
function describeCopy(project, floorId, options) {
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
      count: renumber.rooms.filter((room) => room.level).length,
      counted: renumber.rooms.filter((room) => !room.level).length,
      examples: renumber.rooms.filter((room) => room.level).slice(0, 2).map((room) => ({ from: room.from, to: room.to })),
      text: renumber.text,
    },
    joins,
    joinText: joins.length === 0 ? '' : joins.map((join) => join.text).join('; ') + '.',
    separateText: separate.length === 0 ? '' : separate.map((join) => 'Stairs ' + list(join.letters) + ' stay separate stairs; Make one stairwell is in the stair\'s properties.').join(' '),
    copied,
    notCopied: notCopiedText(building, source),
    notJoinedText: notJoined(source, top),
    unjoinedText: unjoined(building, source, top, joins, newName),
    sentence: 'The copy goes on top of the building, as ' + newName + ', with ' + source.name + '\'s corridors, stairs, rooms and other spaces: ' + copied + '.',
  };
}

// What is not copied, in a list: a connection with both ends on the source
// (stairs within one floor) is not copied either, and is named.
function notCopiedText(building, source) {
  const parts = ['teachers in rooms', 'exits', 'the traced image'];
  const within = building.connections.filter((connection) => connection.a.floorId === source.id && connection.b.floorId === source.id);
  if (within.length > 0) {
    const letters = Array.from(new Set(within.map(stairsLetter)));
    parts.push('Stairs ' + list(letters) + ', which ' + (letters.length === 1 ? 'joins' : 'join') + ' two cells of ' + source.name);
  }
  return parts.join(', ');
}

// Why nothing is joined when the floor below the copy is another size than the
// source: no cell of the copy lines up with one of it. '' when the sizes agree,
// or the source has no stairs or elevator stop to join.
function notJoined(source, top) {
  if (top.width === source.width && top.height === source.height) return '';
  if (!source.cells.includes('S')) return '';
  return 'Nothing is joined: ' + top.name + ' is ' + top.width + ' × ' + top.height + ' cells and ' + source.name + ' is ' + source.width + ' × ' + source.height + ', so the copy\'s stairs and elevator stops do not line up with ' + top.name + '\'s.';
}

// The connected stairs and elevator stops of the source that the copy does not
// join, each named, with why: joining is only ever to the same row and column
// of the floor below the copy (22.17), so a stair whose flight runs down from
// the source, where the old top floor has no stairs, is copied unconnected and
// the building checks will say so. '' when every one is joined, or when the
// sizes differ (notJoined says that for all of them).
//   "Stairs A and C are copied but not joined: Floor 3 has no stairs in the same
//    row and column. The building checks will list their copies on Floor 4 as not
//    connected until you connect them."
function unjoined(building, source, top, joins, newName) {
  if (top.width !== source.width || top.height !== source.height) return '';
  const joined = new Set(joins.map((join) => join.cell));
  const cars = elevatorCars(building);
  const groups = new Map();
  const add = (why, kind, letter) => {
    if (!groups.has(why)) groups.set(why, { stairs: [], cars: [] });
    const group = groups.get(why)[kind];
    if (letter !== '' && !group.includes(letter)) group.push(letter);
  };
  for (let cell = 0; cell < source.cells.length; cell += 1) {
    if (source.cells[cell] !== 'S' || joined.has(cell)) continue;
    const here = building.connections.filter((connection) => sameEnd(connection.a, source.id, cell) || sameEnd(connection.b, source.id, cell));
    if (here.length === 0) continue;
    const lift = isLiftCell(building, source.id, cell);
    let why;
    if (top.cells[cell] !== 'S') why = lift ? 'no-stop' : 'no-stairs';
    else if (lift !== isLiftCell(building, top.id, cell)) why = lift ? 'stairs-there' : 'stop-there';
    else why = lift ? 'stop-alone' : 'stairs-alone';
    if (lift) {
      const car = cars.find((candidate) => candidate.stops.some((stop) => stop.floorId === source.id && stop.cell === cell));
      add(why, 'cars', car ? car.label : '');
    } else {
      for (const connection of here.filter(isStairs)) add(why, 'stairs', stairsLetter(connection));
    }
  }
  const WHY = {
    'no-stairs': top.name + ' has no stairs in the same row and column',
    'no-stop': top.name + ' has no elevator stop in the same row and column',
    'stairs-there': top.name + ' has stairs there, not an elevator stop',
    'stop-there': top.name + ' has an elevator stop there, not stairs',
    'stairs-alone': top.name + '\'s stairs there are not connected to any floor',
    'stop-alone': top.name + '\'s elevator stop there is not on any car',
  };
  const sentences = [];
  let named = 0;
  for (const [why, group] of groups) {
    const names = [];
    const byLetter = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    group.stairs.sort(byLetter);
    group.cars.sort(byLetter);
    if (group.stairs.length > 0) names.push('Stairs ' + list(group.stairs));
    if (group.cars.length > 0) names.push(group.cars.length === 1 ? 'Elevator ' + group.cars[0] : 'Elevators ' + list(group.cars));
    if (names.length === 0) continue;
    const many = group.stairs.length + group.cars.length;
    named += many;
    sentences.push(list(names) + (many === 1 ? ' is' : ' are') + ' copied but not joined: ' + WHY[why] + '.');
  }
  if (sentences.length === 0) return '';
  return sentences.join(' ') + ' The building checks will list ' + (named === 1 ? 'its copy' : 'their copies') + ' on ' + newName + ' as not connected until you connect ' + (named === 1 ? 'it' : 'them') + '.';
}

// A clause for one join, starting with a capital (each names its stairs or
// elevator first) and with no full stop: the dialog strings them with "; ". It
// names no letter change, because none is made; a plain flight is named by
// the new letter it gets.
function joinText(building, join, top, newName) {
  const name = (floorId) => (building.floors.find((floor) => floor.id === floorId) || { name: '' }).name;
  if (join.type === 'elevator') return 'Elevator ' + join.letter + ' gets a stop on ' + newName;
  if (join.type === 'well-extend') return 'Stairwell ' + join.letter + ' will run on to ' + newName;
  if (join.type === 'well-new') return 'Stairs ' + join.letter + ' will run from ' + name(join.from) + ' to ' + newName + ' as one stairwell';
  return 'Stairs ' + join.newLetter + ', a new flight, will join ' + top.name + ' to ' + newName + ' (Stairs ' + list(join.letters) + ' stay separate stairs; Make one stairwell is in the stair\'s properties)';
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
//   numbers  default "level": each numbered room renumbered for the new level,
//            or its own number with a count; "blank" leaves every copy without one
//   join     default true
//   name     the new floor's name; left out, the default of describeFloorDuplicate
//   id       the new floor's id, as addFloor takes one
// The outcome (scheduleOutcome) says what was done:
//   { text, floorId, newName, rooms, renumbered, counted, blanked, joins }
// (the notes the copies raise are describeFloorDuplicate's, from the checks)
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
    const info = describeCopy(project, source.id, { name: data.name });
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
    // "level" with no numbered room has nothing to do, and is not refused
    const numbers = data.numbers === undefined ? 'level' : data.numbers;
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
    const renumbered = numbers === 'level' ? renumber.rooms.filter((room) => room.level).length : 0;
    const counted = numbers === 'level' ? renumber.rooms.length - renumbered : 0;
    const blanked = numbers === 'blank' ? numberedRooms(source).length : 0;
    const text = 'Duplicated ' + source.name + ' as ' + name + (joinsMade.length > 0 ? ': ' + joinsMade.map((join) => join.text).join('; ') + '.' : '.');
    const outcome = {
      text,
      floorId: id,
      newName: name,
      rooms: info.rooms,
      otherSpaces: info.otherSpaces,
      renumbered,
      counted,
      blanked,
      joins: joinsMade.map((join) => ({ type: join.type, cell: join.cell, text: join.text })),
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
