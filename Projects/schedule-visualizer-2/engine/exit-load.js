// Safety's figures: how the exits are numbered and named, how evenly they
// share the building's people, and which rooms open onto a named corridor.
// Plain Node, no DOM, no clock, not a module the staff browser carries.
//
// EXIT_UNNAMED(floorName)             "The exit on Floor 1": the words for an
//                                     exit with no door name (Safety's, moved here)
// exitNumbers(project)                Map exitId -> number, from 1, in byExit's
//                                     order: floors in display order, each
//                                     floor's exits in its own order. A blocked
//                                     exit keeps its number.
// exitName(project, exitId)           the door name as typed, else EXIT_UNNAMED
//                                     with its floor's name; '' for an exit that
//                                     is not in the building
// exitLoad(project, rows, options?)   how evenly the exits share the people
//   rows are byExit(project, evacuation)'s rows. options.blockedExits is a list
//   of exit ids: a blocked exit is not open and is never heavy. options.basis
//   ('people' or 'rooms') forces the basis, so two loads of one question (a
//   trial's before and after) are always compared on the same one.
//   → { exits: [{ exitId, number, rooms, people, uncounted, blocked, heavy, share }],
//       basis: 'people' | 'rooms', open, total, fair, heavy: [exitId],
//       uncounted, sentence, sentenceParts }
//   `sentenceParts` is the sentence as [{ text, name }], name true for what a
//   user typed (a door name, or the floor's name in an unnamed exit's words);
//   null when `sentence` is.
//   `open` counts the exits not blocked, whether or not a room uses them (an
//   exit no room reaches is the very imbalance this warns of). `total` is the
//   sum of people (basis 'people') or rooms (basis 'rooms') over every row,
//   `fair` is total / open, `share` is an exit's figure / total (0 when total
//   is 0), `uncounted` is the rooms with a way out and no capacity, building
//   wide. The basis is 'rooms' when more than half of the rooms with a way out
//   have no capacity set. An open exit is heavy when open >= 2 and its figure
//   is at least HEAVY_SHARE x fair and at least fair + HEAVY_MARGIN (people or
//   rooms by the basis). `sentence` is null when nothing is heavy; one heavy
//   exit's sentence each, in key order, as DESIGN 14.7 item 2 words them; one
//   sentence says so when the building has a single way out. A row whose exit
//   has gone from the building is skipped. Deterministic, never throws.
// BASIS_ROOMS                        "Most rooms have no capacity set, so this
//                                     compares rooms, not people."
// basisWords(load)                    BASIS_ROOMS when load.basis is 'rooms', else ''
// corridorRooms(project, graph, corridorId)
//                                     the ids of the rooms with a door entry on
//                                     the corridor, in building order (ARCHITECTURE
//                                     20.9 item 9: any entry of the room, the
//                                     corridor cell across the door, in the
//                                     corridor's cells on the room's floor)
// roomsOnNoNamedCorridor(project, graph)
//                                     the ids of the rooms with no entry on any
//                                     corridor that has a name, in building order
//
// Every name in a sentence is as typed; whoever shows one sets textContent.

import { routingGraph } from './routing.js';

export const EXIT_UNNAMED = (floorName) => 'The exit on ' + floorName;

// An exit is heavy when its figure is this many times an even share ...
export const HEAVY_SHARE = 1.6;
// ... and at least this many more than an even share: 50 people, or 4 rooms
// when the figures are rooms.
export const HEAVY_MARGIN = { people: 50, rooms: 4 };

export const BASIS_ROOMS = 'Most rooms have no capacity set, so this compares rooms, not people.';

export function basisWords(load) {
  return load && load.basis === 'rooms' ? BASIS_ROOMS : '';
}

function exitsInOrder(project) {
  const found = [];
  const floors = project && project.building && Array.isArray(project.building.floors) ? project.building.floors : [];
  for (const floor of floors) {
    if (!floor) continue;
    for (const exit of Array.isArray(floor.exits) ? floor.exits : []) if (exit) found.push({ exit, floor });
  }
  return found;
}

export function exitNumbers(project) {
  const numbers = new Map();
  exitsInOrder(project).forEach(({ exit }, i) => numbers.set(exit.id, i + 1));
  return numbers;
}

export function exitName(project, exitId) {
  for (const { exit, floor } of exitsInOrder(project)) {
    if (exit.id !== exitId) continue;
    const named = typeof exit.doorName === 'string' && exit.doorName.trim() !== '';
    return named ? exit.doorName : EXIT_UNNAMED(floor.name);
  }
  return '';
}

function count(value) {
  return Number.isFinite(value) ? value : 0;
}

function whole(value) {
  return Math.round(value);
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

export function exitLoad(project, rows, options) {
  const blockedIds = new Set(options && Array.isArray(options.blockedExits) ? options.blockedExits : []);
  const numbers = exitNumbers(project);
  const kept = (Array.isArray(rows) ? rows : []).filter((row) => row && numbers.has(row.exitId));
  const withWay = kept.reduce((sum, row) => sum + count(row.rooms), 0);
  const uncounted = kept.reduce((sum, row) => sum + count(row.uncounted), 0);
  const forced = options && (options.basis === 'rooms' || options.basis === 'people') ? options.basis : null;
  const basis = forced || (withWay > 0 && uncounted * 2 > withWay ? 'rooms' : 'people');
  const figureOf = (row) => count(basis === 'rooms' ? row.rooms : row.people);
  const total = kept.reduce((sum, row) => sum + figureOf(row), 0);
  const open = numbers.size - Array.from(numbers.keys()).filter((id) => blockedIds.has(id)).length;
  const fair = open > 0 ? total / open : 0;
  const margin = HEAVY_MARGIN[basis];
  const exits = kept.map((row) => {
    const figure = figureOf(row);
    const blocked = blockedIds.has(row.exitId);
    const heavy = !blocked && open >= 2 && figure >= HEAVY_SHARE * fair && figure >= fair + margin;
    return { exitId: row.exitId, number: numbers.get(row.exitId), rooms: count(row.rooms), people: count(row.people), uncounted: count(row.uncounted), blocked, heavy, share: total > 0 ? figure / total : 0 };
  });
  const heavy = exits.filter((exit) => exit.heavy).map((exit) => exit.exitId);
  const parts = sentenceFor(project, exits, { basis, open, total, fair, heavy, count: numbers.size });
  return { exits, basis, open, total, fair, heavy, uncounted, sentence: parts ? parts.map((part) => part.text).join('') : null, sentenceParts: parts };
}

// The sentence as parts, or null: a door name is typed, the rest is ours.
function sentenceFor(project, exits, figures) {
  if (figures.count === 0 || figures.open === 0) return null;
  const typed = (text) => ({ text, name: true });
  const ours = (text) => ({ text, name: false });
  if (figures.open === 1) {
    const only = exits.find((exit) => !exit.blocked) || null;
    const name = exitName(project, only ? only.exitId : firstOpen(project, exits));
    return [ours('Every room leaves by '), typed(name), ours(figures.count === 1 ? ': it is the only exit.' : ': it is the only exit not blocked.')];
  }
  if (figures.heavy.length === 0) return null;
  const byId = new Map(exits.map((exit) => [exit.exitId, exit]));
  const share = (exit) => whole(exit.share * 100) + ' %';
  const exitsWord = 'where an even share of the ' + figures.open + ' exits would be ' + whole(figures.fair) + '.';
  const parts = [];
  figures.heavy.forEach((id, i) => {
    const exit = byId.get(id);
    const rest = figures.basis === 'people'
      ? ' (' + exit.number + ') is the way out for rooms holding ' + exit.people + ' of ' + figures.total + ' people at full capacity, ' + share(exit) + ', ' + exitsWord
      : ' (' + exit.number + ') is the way out for ' + exit.rooms + ' of ' + plural(figures.total, 'room', 'rooms') + ', ' + share(exit) + ', ' + exitsWord;
    parts.push(typed(exitName(project, id)), ours(rest));
    if (i < figures.heavy.length - 1) parts.push(ours(' '));
  });
  return parts;
}

// An open exit's id when no row of it is left to read it from (cannot happen
// with rows from byExit, which lists every exit).
function firstOpen(project, exits) {
  const shut = new Set(exits.filter((exit) => exit.blocked).map((exit) => exit.exitId));
  const found = exitsInOrder(project).find(({ exit }) => !shut.has(exit.id));
  return found ? found.exit.id : '';
}

// ---- corridors' rooms

function roomEntries(routing, project) {
  const found = [];
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) {
      if (space.kind !== 'room') continue;
      const held = routing.rooms.get(space.id);
      found.push({ roomId: space.id, floorId: floor.id, cells: held ? held.entries.map((entry) => entry.cell) : [] });
    }
  }
  return found;
}

export function corridorRooms(project, graph, corridorId) {
  let corridor = null;
  let floorId = null;
  for (const floor of project.building.floors) {
    const found = (floor.corridors || []).find((candidate) => candidate.id === corridorId);
    if (found) {
      corridor = found;
      floorId = floor.id;
      break;
    }
  }
  if (!corridor) return [];
  const cells = new Set(corridor.cells || []);
  return roomEntries(routingGraph(project, graph), project)
    .filter((room) => room.floorId === floorId && room.cells.some((cell) => cells.has(cell)))
    .map((room) => room.roomId);
}

export function roomsOnNoNamedCorridor(project, graph) {
  const named = new Map();
  for (const floor of project.building.floors) {
    const cells = new Set();
    for (const corridor of floor.corridors || []) {
      if (typeof corridor.name !== 'string' || corridor.name.trim() === '') continue;
      for (const cell of corridor.cells || []) cells.add(cell);
    }
    named.set(floor.id, cells);
  }
  return roomEntries(routingGraph(project, graph), project)
    .filter((room) => !room.cells.some((cell) => named.get(room.floorId).has(cell)))
    .map((room) => room.roomId);
}
