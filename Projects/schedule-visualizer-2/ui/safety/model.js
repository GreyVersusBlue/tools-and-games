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
// Every name in it is as typed; whoever puts them on screen sets textContent.

import { nameOfRoom } from '../../engine/schema.js';
import { evacuationRoutes, byExit, noRoute, doorCard } from '../../engine/evacuation.js';
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
