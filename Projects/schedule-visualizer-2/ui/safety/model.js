// What the Safety section shows, worked out from the project and its graph
// with no DOM in it: every room's way out (engine/evacuation.js, the one
// rule), the exits as the key numbers them, and the words for each.
//
//   safetyPicture(project, graph) -> {
//     evacuation   evacuationRoutes()'s answer, as it came
//     exits        [{ exitId, number, floorId, floorName, name, doorName,
//                     assembly, roomIds, rooms, people, uncounted }]
//                  byExit()'s rows in its order, numbered from 1 for the key;
//                  `name` is the door name as typed, or "The exit on Floor 1"
//     rows         [{ roomId, floorId, floorName, name, cells, ok, route,
//                     exitId, exitNumber, seconds, first, sentence, onlyByElevator }]
//                  every room, floors in display order and each floor's own
//                  order; `first` the door card's first step (doorCard), and
//                  for a room with no way out `sentence`, the routing engine's
//     missing      noRoute()'s rows
//     byRoom       Map roomId -> row
//   }
//   EXIT_UNNAMED(floorName)   the words for an exit with no door name
//   firstLine(project, picture, picked) -> parts [{ text, name }]
//     the screen's first line: what is drawn, as a sentence
//   roomLine(row, picture) -> string   "Door A · 45 s · Turn left out of the door."
//     (the exit's number is beside it, on its colour, where it is shown)
//
//   stepFreePicture(project, graph, picture) -> {
//     waysOut   stepFreeWaysOut()'s answer, as it came
//     report    stepFreeReport()'s answer, as it came
//     rooms     [{ roomId, floorId, floorName, name, cells, way: 'exit' | 'refuge' | 'none',
//                  route, seconds, exitId, exitNumber, exitName, refugeId, refugeName,
//                  reason, why }]   every room, as `rows` has them; exitNumber is the
//                  number the key gives the exit (the same as in the Everyone view)
//     byRoom    Map roomId -> room
//     counts    { exit, refuge, none }
//     exits     [{ exitId, number, name, rooms }]   the exits some room leaves by, step-free
//     refuges   [{ refugeId, floorId, floorName, name, roomIds, by, use }]  `use` is
//               refugeUse()'s line
//   stepFreeWords(counts) -> "41 to an exit, 12 to an area of refuge, 3 with no way out"
//   refugeUse(roomIds) -> "Used by 12 rooms" | "Not used: every room nearby has a step-free exit"
//   stepFreeFirstLine(project, step, picked) -> parts, as firstLine() does, for the Step-free view
//   stepFreeRoomLine(room, step) -> string  where the room's step-free way goes, in words
//
// Every name in it is as typed; whoever puts them on screen sets textContent.

import { nameOfRoom } from '../../engine/schema.js';
import { evacuationRoutes, byExit, noRoute, doorCard, stepFreeWaysOut } from '../../engine/evacuation.js';
import { stepFreeReport } from '../../engine/step-free.js';
import { refugeBy, refugeFor } from './ways.js';
import { formatDuration } from '../../engine/findings.js';
import { count } from '../components/words.js';

export const EXIT_UNNAMED = (floorName) => 'The exit on ' + floorName;

function floorNames(project) {
  return new Map(project.building.floors.map((floor) => [floor.id, floor.name]));
}

export function safetyPicture(project, graph) {
  const names = floorNames(project);
  const evacuation = evacuationRoutes(project, graph);
  const missing = noRoute(project, evacuation);
  const exits = byExit(project, evacuation).map((row, i) => {
    const floorName = names.get(row.floorId) || '';
    const named = typeof row.doorName === 'string' && row.doorName.trim() !== '';
    return { ...row, number: i + 1, floorName, name: named ? row.doorName : EXIT_UNNAMED(floorName) };
  });
  const exitOf = new Map(exits.map((exit) => [exit.exitId, exit]));
  const failed = new Map(missing.map((row) => [row.roomId, row]));
  const spaces = new Map();
  for (const floor of project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') spaces.set(space.id, space);
  const rows = evacuation.rooms.map((entry) => {
    const room = spaces.get(entry.roomId);
    const base = { roomId: entry.roomId, floorId: entry.floorId, floorName: names.get(entry.floorId) || '', name: nameOfRoom(room, true), cells: room ? room.cells : [], route: entry.route, onlyByElevator: entry.onlyByElevator === true };
    if (!entry.route.ok) {
      const no = failed.get(entry.roomId);
      return { ...base, ok: false, exitId: null, exitNumber: null, seconds: null, first: null, sentence: no ? no.sentence : '' };
    }
    const card = doorCard(project, graph, entry.route, { avoidConnections: evacuation.asked.avoidConnections });
    const exit = exitOf.get(entry.route.exitId);
    return { ...base, ok: true, exitId: entry.route.exitId, exitNumber: exit ? exit.number : null, seconds: entry.route.seconds, first: card.ok && card.steps.length > 0 ? card.steps[0].text : null, sentence: null };
  });
  return { evacuation, exits, rows, missing, byRoom: new Map(rows.map((row) => [row.roomId, row])) };
}

export function roomLine(row, picture) {
  if (!row.ok) return row.sentence;
  const exit = picture.exits.find((each) => each.exitId === row.exitId);
  const bits = [exit ? exit.name : 'An exit', formatDuration(row.seconds)];
  if (row.first) bits.push(row.first);
  return bits.join(' · ');
}

// The first line, in parts so a typed name can be set apart (bdi).
export function firstLine(project, picture, picked) {
  const row = picked ? picture.byRoom.get(picked) : null;
  if (row) {
    if (!row.ok) return [{ text: row.name, name: true }, { text: ' has no way out. ', name: false }, { text: row.sentence, name: false }];
    const exit = picture.exits.find((each) => each.exitId === row.exitId);
    return [
      { text: row.name, name: true },
      { text: ' on ', name: false },
      { text: row.floorName, name: true },
      { text: ': out by ', name: false },
      { text: exit ? exit.name : 'an exit', name: true },
      { text: ' in ' + formatDuration(row.seconds) + ' of walking.', name: false },
    ];
  }
  const ways = picture.rows.filter((each) => each.ok).length;
  const used = picture.exits.filter((exit) => exit.rooms > 0).length;
  const parts = [{ text: 'Every room’s way out, coloured by the exit it uses: ' + count(ways, 'room') + ' to ' + count(used, 'exit') + '.', name: false }];
  if (picture.missing.length > 0) parts.push({ text: ' ' + (picture.missing.length === 1 ? '1 room has' : picture.missing.length + ' rooms have') + ' no way out.', name: false });
  return parts;
}

// ---- the Step-free view (DESIGN 13.6)

export function refugeUse(roomIds) {
  const n = Array.isArray(roomIds) ? roomIds.length : 0;
  return n === 0 ? 'Not used: every room nearby has a step-free exit' : 'Used by ' + count(n, 'room');
}

export function stepFreeWords(counts) {
  return counts.exit + ' to an exit, ' + counts.refuge + ' to an area of refuge, ' + counts.none + ' with no way out';
}

export function stepFreePicture(project, graph, picture) {
  const waysOut = stepFreeWaysOut(project, graph);
  const report = stepFreeReport(project, graph);
  const names = floorNames(project);
  const exitOf = new Map(picture.exits.map((exit) => [exit.exitId, exit]));
  const refugeOf = new Map(waysOut.refuges.map((refuge) => [refuge.refugeId, refuge]));
  const rooms = waysOut.rooms.map((entry) => {
    const row = picture.byRoom.get(entry.roomId);
    const exit = entry.exitId ? exitOf.get(entry.exitId) : null;
    const refuge = entry.refugeId ? refugeOf.get(entry.refugeId) : null;
    return {
      roomId: entry.roomId,
      floorId: entry.floorId,
      floorName: names.get(entry.floorId) || '',
      name: row ? row.name : '',
      cells: row ? row.cells : [],
      way: entry.way,
      route: entry.way === 'none' ? null : entry.route,
      seconds: entry.way === 'none' ? null : entry.route.seconds,
      exitId: entry.exitId,
      exitNumber: exit ? exit.number : null,
      exitName: exit ? exit.name : null,
      refugeId: entry.refugeId,
      refugeName: refuge ? refuge.name : null,
      reason: entry.reason,
      why: entry.why,
    };
  });
  const counts = { exit: 0, refuge: 0, none: 0 };
  for (const room of rooms) counts[room.way] += 1;
  const used = new Map();
  for (const room of rooms) if (room.way === 'exit' && room.exitId) used.set(room.exitId, (used.get(room.exitId) || 0) + 1);
  const exits = picture.exits.filter((exit) => used.has(exit.exitId)).map((exit) => ({ exitId: exit.exitId, number: exit.number, name: exit.name, rooms: used.get(exit.exitId) }));
  const refuges = waysOut.refuges.map((refuge) => {
    const placed = refugeFor(project.building, refuge.refugeId);
    const by = placed ? refugeBy(project.building, placed) : null;
    return { ...refuge, floorName: names.get(refuge.floorId) || '', by: by ? by.text : null, use: refugeUse(refuge.roomIds) };
  });
  return { waysOut, report, rooms, byRoom: new Map(rooms.map((room) => [room.roomId, room])), counts, exits, refuges };
}

// Where a room's step-free way goes, in words ("East Door · 45 s", "Area of refuge 2 · 20 s", "only by elevator").
export function stepFreeRoomLine(room) {
  if (room.way === 'exit') return (room.exitName || 'An exit') + ' · ' + formatDuration(room.seconds);
  if (room.way === 'refuge') return (room.refugeName || 'An area of refuge') + ' · ' + formatDuration(room.seconds) + ', then wait for help';
  return room.why;
}

export function stepFreeFirstLine(project, step, picked) {
  const room = picked ? step.byRoom.get(picked) : null;
  if (room) {
    const head = [{ text: room.name, name: true }, { text: ' on ', name: false }, { text: room.floorName, name: true }];
    if (room.way === 'exit') return [...head, { text: ': step-free out by ', name: false }, { text: room.exitName || 'an exit', name: true }, { text: ' in ' + formatDuration(room.seconds) + ' of walking.', name: false }];
    if (room.way === 'refuge') return [...head, { text: ': no step-free exit; wait at ', name: false }, { text: room.refugeName || 'an area of refuge', name: true }, { text: ', ' + formatDuration(room.seconds) + ' of walking, for help.', name: false }];
    return [...head, { text: ' has no step-free way out: ' + room.why + '.', name: false }];
  }
  return [{ text: 'Step-free ways out: ' + stepFreeWords(step.counts) + '.', name: false }];
}
