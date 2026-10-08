// Building checks (spec 4.9): what is wrong or unfinished in the building, as
// findings in the shape the schedule checks use:
//
//   { id, kind, severity, text, where, fixable }
//
// `id` is built from the kind and the ids the finding is about, so the same
// problem has the same id tomorrow. `text` is a full sentence with every name
// in it as typed; the interface sets it as text, never as markup. `where` is
// what "Show me" needs: the floor, the cells to highlight, and the room,
// rooms or connection where there is one.
//
// Reachability comes from graph.js. "No route to any exit" is asked of the
// graph too: a room has a route to an exit exactly when one of the cells it
// is entered through can reach an exit cell.

import { roomNumberKey, CELL_STAIRS, neighbourCell, DOOR_SIDES } from './schema.js';
import { buildGraph, reachable, components } from './graph.js';
import { findingId } from './findings.js';

// The kinds, in the order the findings come out.
export const BUILDING_CHECK_KINDS = [
  'room-no-number',
  'room-duplicate-number',
  'room-no-corridor',
  'door-nowhere',
  'stairs-unconnected',
  'part-unreachable',
  'floor-unconnected',
  'no-exit',
  'room-no-exit-route',
];

const SIDE_WORDS = { n: 'north', e: 'east', s: 'south', w: 'west' };

function roomName(room) {
  return room.number.trim() === '' ? 'an unnumbered room' : 'Room ' + room.number;
}

function capital(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function list(parts) {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many);
}

// buildingChecks(project) → Finding[]. Pass the graph when one is already
// built for this geometry; otherwise it is built here.
export function buildingChecks(project, graph) {
  const building = project.building;
  const g = graph || buildGraph(project);
  const found = { };
  for (const kind of BUILDING_CHECK_KINDS) found[kind] = [];
  // `about` is the ids the finding is about (and a cell or "building" where
  // that is what tells one from another), in the form findings.js gives
  // every finding's id
  const add = (kind, severity, about, text, where) => found[kind].push({ id: findingId(kind, ...about), kind, severity, text, where, fixable: false });

  const rooms = [];
  for (const floor of building.floors) for (const space of floor.spaces) if (space.kind === 'room') rooms.push({ room: space, floor });

  // rooms with no number
  for (const { room, floor } of rooms) {
    if (room.number.trim() === '') add('room-no-number', 'warning', [room.id], 'A room on ' + floor.name + ' has no number. Give it one so that groups can be scheduled into it.', { floorId: floor.id, roomId: room.id, cells: room.cells });
  }

  // duplicate numbers: the editor refuses them, an imported file may not
  const byNumber = new Map();
  for (const entry of rooms) {
    if (entry.room.number.trim() === '') continue;
    const key = roomNumberKey(entry.room.number);
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(entry);
  }
  for (const same of byNumber.values()) {
    if (same.length < 2) continue;
    const first = same[0];
    add('room-duplicate-number', 'problem', same.map((entry) => entry.room.id).sort(), plural(same.length, 'room', 'rooms') + ' are numbered ' + first.room.number + ': on ' + list(same.map((entry) => entry.floor.name)) + '. Room numbers are unique across the building; change all but one.', { floorId: first.floor.id, roomId: first.room.id, roomIds: same.map((entry) => entry.room.id), cells: first.room.cells });
  }

  // rooms that touch no corridor, and doors that lead nowhere
  for (const { room, floor } of rooms) {
    const entry = g.rooms.get(room.id);
    const where = { floorId: floor.id, roomId: room.id, cells: room.cells };
    if (entry.doors === 0 && entry.entries.length === 0) {
      add('room-no-corridor', 'problem', [room.id], capital(roomName(room)) + ' on ' + floor.name + ' touches no corridor or stairs, so nobody can walk to it or from it. Paint a corridor up to one of its sides.', where);
    } else if (entry.deadDoors.length > 0 && entry.entries.length === 0) {
      add('door-nowhere', 'problem', [room.id], (entry.deadDoors.length === 1 ? 'The door of ' : 'Every door of ') + roomName(room) + ' on ' + floor.name + ' leads nowhere, so nobody can walk to it or from it. Put a door on a side that faces a corridor or stairs.', { ...where, cells: entry.deadDoors.map((door) => door.cell) });
    } else if (entry.deadDoors.length > 0) {
      const sides = Array.from(new Set(entry.deadDoors.map((door) => SIDE_WORDS[door.side])));
      add('door-nowhere', 'warning', [room.id], capital(roomName(room)) + ' on ' + floor.name + ' has ' + (entry.deadDoors.length === 1 ? 'a door' : plural(entry.deadDoors.length, 'door', 'doors')) + ' on its ' + list(sides) + ' side that ' + (entry.deadDoors.length === 1 ? 'leads' : 'lead') + ' nowhere. Remove ' + (entry.deadDoors.length === 1 ? 'it' : 'them') + ', or paint a corridor there.', { ...where, cells: entry.deadDoors.map((door) => door.cell) });
    }
  }

  // stairs with no connection: one finding per run of touching stairs cells
  // in which no cell is connected
  const linked = new Uint8Array(g.count);
  for (const link of g.links) {
    linked[link.a] = 1;
    linked[link.b] = 1;
  }
  building.floors.forEach((floor, f) => {
    const nodeOfCell = g.floors[f].nodeOfCell;
    const done = new Set();
    for (let start = floor.cells.indexOf(CELL_STAIRS); start !== -1; start = floor.cells.indexOf(CELL_STAIRS, start + 1)) {
      if (done.has(start)) continue;
      const run = [start];
      done.add(start);
      let connected = false;
      for (let i = 0; i < run.length; i += 1) {
        if (linked[nodeOfCell[run[i]]]) connected = true;
        for (const side of DOOR_SIDES) {
          const next = neighbourCell(floor, run[i], side);
          if (next !== -1 && floor.cells[next] === CELL_STAIRS && !done.has(next)) {
            done.add(next);
            run.push(next);
          }
        }
      }
      if (connected) continue;
      const column = (start % floor.width) + 1;
      const row = Math.floor(start / floor.width) + 1;
      add('stairs-unconnected', 'warning', [floor.id, start], 'The stairs on ' + floor.name + ' at column ' + column + ', row ' + row + ' are not connected to other stairs, so nobody can use them. Connect them to the stairs they lead to.', { floorId: floor.id, cell: start, cells: run.sort((a, b) => a - b) });
    }
  });

  // parts that cannot be reached from the rest, and floors joined to nothing.
  // The main part is the one the most rooms open onto (then the largest,
  // then the first); every other part is a finding.
  const parts = components(g);
  if (parts.count > 1) {
    const size = new Int32Array(parts.count);
    for (let node = 0; node < g.count; node += 1) size[parts.of[node]] += 1;
    const roomsOf = Array.from({ length: parts.count }, () => []);
    for (const entry of rooms) {
      const seen = new Set();
      for (const way of g.rooms.get(entry.room.id).entries) {
        const part = parts.of[way.node];
        if (!seen.has(part)) roomsOf[part].push(entry.room);
        seen.add(part);
      }
    }
    let main = 0;
    for (let part = 1; part < parts.count; part += 1) {
      if (roomsOf[part].length > roomsOf[main].length || (roomsOf[part].length === roomsOf[main].length && size[part] > size[main])) main = part;
    }
    const onFloor = Array.from({ length: parts.count }, () => new Map());
    for (let node = 0; node < g.count; node += 1) {
      const floors = onFloor[parts.of[node]];
      const f = g.nodeFloor[node];
      if (!floors.has(f)) floors.set(f, []);
      floors.get(f).push(g.nodeCell[node]);
    }
    for (let part = 0; part < parts.count; part += 1) {
      if (part === main) continue;
      const whole = [];
      for (const [f, cells] of onFloor[part]) if (cells.length === g.floors[f].count) whole.push(f);
      if (whole.length > 0) {
        for (const f of whole) add('floor-unconnected', 'problem', [g.floors[f].id], 'Nothing connects ' + g.floors[f].name + ' to the rest of the building. Connect stairs on it to stairs on another floor.', { floorId: g.floors[f].id, cells: onFloor[part].get(f) });
        continue;
      }
      const [f, cells] = onFloor[part].entries().next().value;
      const names = roomsOf[part].map(roomName);
      const what = plural(size[part], 'corridor or stairs cell', 'corridor and stairs cells') + (names.length === 0 ? '' : names.length > 4 ? ' with ' + names.length + ' rooms' : ' with ' + list(names));
      add('part-unreachable', 'problem', [g.floors[f].id, cells[0]], 'Part of ' + g.floors[f].name + ' cannot be reached from the rest of the building: ' + what + '. Join it with a corridor or a stairs connection.', { floorId: g.floors[f].id, cells, roomIds: roomsOf[part].map((room) => room.id) });
    }
  }

  // exits
  const drawn = g.count > 0 || rooms.length > 0;
  if (g.exits.length === 0) {
    if (drawn) add('no-exit', 'warning', ['building'], 'No exit is marked. Mark a corridor cell on the building\'s edge as an exit so that evacuation routes can be worked out.', { floorId: building.floors[0].id, cells: [] });
  } else {
    const canLeave = reachable(g, g.exits.map((exit) => exit.node), { reverse: true });
    for (const { room, floor } of rooms) {
      const entries = g.rooms.get(room.id).entries;
      if (entries.length === 0 || entries.some((entry) => canLeave[entry.node])) continue;
      add('room-no-exit-route', 'problem', [room.id], capital(roomName(room)) + ' on ' + floor.name + ' has no route to any exit. Join its corridor to one that leads to an exit, or mark an exit it can reach.', { floorId: floor.id, roomId: room.id, cells: room.cells });
    }
  }

  return BUILDING_CHECK_KINDS.flatMap((kind) => found[kind]);
}
