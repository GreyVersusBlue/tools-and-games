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
// is entered through can reach an exit cell, with the elevators left out
// (an evacuation never uses one); a room that can leave only by elevator is
// told that. An elevator stop with no connection is "Elevator stop on Floor 2
// is not connected", and stairs and elevator stops are judged in runs of their
// own kind.

import { roomNumberKey, CELL_STAIRS, neighbourCell, DOOR_SIDES, nameOfRoom, isWalkable, stairwells } from './schema.js';
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
  'one-way-trap',
  'dead-end',
  'stairwell-split',
];

const SIDE_WORDS = { n: 'north', e: 'east', s: 'south', w: 'west' };

function list(parts) {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many);
}

// Dead ends (ARCHITECTURE 22.6, 22.17; spec 4.9's wish). Fixed thresholds: a
// dead end that serves a room is a note only past 6 cells, or, with a Cell
// scale set, past 6.1 metres (20 feet); one that serves nothing is a warning
// whatever its length.
export const DEAD_END_CELLS = 6;
export const DEAD_END_METRES = 6.1;
export const DEAD_END_FEET = 20;

// deadEnds(project, graph?) → [{ floorId, cells, end, first, junction, length, roomIds, name }]
// On each floor, over the corridor and stairs cells (connections, levers and
// one-way rules ignored): an end is a corridor cell, not stairs and not an
// exit, with exactly one walkable edge neighbour. From it the run goes on
// while the next cell has exactly two walkable neighbours and is neither
// stairs nor an exit; it stops before the first cell with three or more, a
// stair (a lift is one) or an exit, the junction. The dead end is the cells
// walked, end first. A run that reaches another end is an isolated line, which
// part-unreachable covers, so it is not a dead end. A two-wide hall has no
// cell with one neighbour, so it never makes an end. `first` is the walked
// cell next to the junction: it names the dead end, so editing the far end of
// a stub keeps the id. `name` is the junction cell's corridor name, or ''.
export function deadEnds(project, graph) {
  const building = project.building ? project.building : project;
  const g = graph || buildGraph(project);
  const found = [];
  for (const floor of building.floors) {
    const exits = new Set(floor.exits.map((exit) => exit.cell));
    const around = (cell) => {
      const next = [];
      for (const side of DOOR_SIDES) {
        const there = neighbourCell(floor, cell, side);
        if (there !== -1 && isWalkable(floor.cells[there])) next.push(there);
      }
      return next;
    };
    const plain = (cell) => floor.cells[cell] !== CELL_STAIRS && !exits.has(cell);
    for (let start = 0; start < floor.cells.length; start += 1) {
      if (!isWalkable(floor.cells[start]) || !plain(start)) continue;
      const first = around(start);
      if (first.length !== 1) continue;
      const cells = [start];
      let before = start;
      let at = first[0];
      let junction = -1;
      for (;;) {
        const ways = around(at);
        if (!plain(at) || ways.length >= 3) {
          junction = at;
          break;
        }
        if (ways.length < 2) break; // another end: an isolated line
        cells.push(at);
        const onward = ways.find((way) => way !== before);
        before = at;
        at = onward;
      }
      if (junction === -1) continue;
      const own = new Set(cells);
      const roomIds = [];
      for (const space of floor.spaces) {
        if (space.kind !== 'room') continue;
        const entry = g.rooms.get(space.id);
        if (entry && entry.entries.some((way) => own.has(way.cell))) roomIds.push(space.id);
      }
      const corridor = floor.corridors.find((candidate) => candidate.cells.includes(junction));
      found.push({ floorId: floor.id, cells, end: start, first: cells[cells.length - 1], junction, length: cells.length, roomIds, name: corridor ? corridor.name : '' });
    }
  }
  return found;
}

function roomsWords(rooms) {
  const names = rooms.map((room) => nameOfRoom(room, false));
  if (names.every((name) => name.startsWith('Room '))) return (names.length === 1 ? 'room ' : 'rooms ') + list(names.map((name) => name.slice(5)));
  return list(names);
}

// "about 27 feet": the length in the Cell scale's unit, whole numbers
function lengthWords(cells, scale) {
  const whole = Math.round(cells * scale.length);
  return 'about ' + whole + ' ' + (whole === 1 ? (scale.unit === 'feet' ? 'foot' : 'metre') : scale.unit);
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
      add('room-no-corridor', 'problem', [room.id], nameOfRoom(room, true) + ' on ' + floor.name + ' touches no corridor or stairs, so nobody can walk to it or from it. Paint a corridor up to one of its sides.', where);
    } else if (entry.deadDoors.length > 0 && entry.entries.length === 0) {
      add('door-nowhere', 'problem', [room.id], (entry.deadDoors.length === 1 ? 'The door of ' : 'Every door of ') + nameOfRoom(room, false) + ' on ' + floor.name + ' leads nowhere, so nobody can walk to it or from it. Put a door on a side that faces a corridor or stairs.', { ...where, cells: entry.deadDoors.map((door) => door.cell) });
    } else if (entry.deadDoors.length > 0) {
      const sides = Array.from(new Set(entry.deadDoors.map((door) => SIDE_WORDS[door.side])));
      add('door-nowhere', 'warning', [room.id], nameOfRoom(room, true) + ' on ' + floor.name + ' has ' + (entry.deadDoors.length === 1 ? 'a door' : plural(entry.deadDoors.length, 'door', 'doors')) + ' on its ' + list(sides) + ' side that ' + (entry.deadDoors.length === 1 ? 'leads' : 'lead') + ' nowhere. Remove ' + (entry.deadDoors.length === 1 ? 'it' : 'them') + ', or paint a corridor there.', { ...where, cells: entry.deadDoors.map((door) => door.cell) });
    }
  }

  // stairs with no connection: one finding per run of touching stairs cells
  // in which no cell is connected. Elevator stops are judged apart from
  // stairs, and one cell at a time: a lift cell touching a stairs cell, or
  // another lift cell (of another elevator, say), neither connects it nor is
  // connected by it, and an unconnected stop is "Elevator stop on Floor 2 is
  // not connected".
  const linked = new Uint8Array(g.count);
  for (const link of g.links) {
    linked[link.a] = 1;
    linked[link.b] = 1;
  }
  building.floors.forEach((floor, f) => {
    const nodeOfCell = g.floors[f].nodeOfCell;
    const isLift = (cell) => nodeOfCell[cell] !== -1 && g.lifts[nodeOfCell[cell]] === 1;
    const done = new Set();
    for (let start = floor.cells.indexOf(CELL_STAIRS); start !== -1; start = floor.cells.indexOf(CELL_STAIRS, start + 1)) {
      if (done.has(start)) continue;
      const lift = isLift(start);
      const run = [start];
      done.add(start);
      let connected = false;
      for (let i = 0; i < run.length; i += 1) {
        if (linked[nodeOfCell[run[i]]]) connected = true;
        // a lift cell is judged on its own: only stairs cells merge into runs
        if (lift) break;
        for (const side of DOOR_SIDES) {
          const next = neighbourCell(floor, run[i], side);
          if (next !== -1 && floor.cells[next] === CELL_STAIRS && !done.has(next) && !isLift(next)) {
            done.add(next);
            run.push(next);
          }
        }
      }
      if (connected) continue;
      const column = (start % floor.width) + 1;
      const row = Math.floor(start / floor.width) + 1;
      if (lift) {
        add('stairs-unconnected', 'warning', [floor.id, start], 'Elevator stop on ' + floor.name + ' is not connected (column ' + column + ', row ' + row + '): it reaches no elevator stop on another floor, so nobody can use it. Connect it to a stop on another floor.', { floorId: floor.id, cell: start, cells: run.sort((a, b) => a - b) });
        continue;
      }
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
      const names = roomsOf[part].map((room) => nameOfRoom(room, false));
      // a part that holds a lift cell says so
      const hasLift = Array.from(onFloor[part]).some(([floorIndex, list]) => list.some((cell) => g.lifts[g.floors[floorIndex].nodeOfCell[cell]] === 1));
      const what = (hasLift ? plural(size[part], 'corridor, stairs or elevator cell', 'corridor, stairs and elevator cells') : plural(size[part], 'corridor or stairs cell', 'corridor and stairs cells')) + (names.length === 0 ? '' : names.length > 4 ? ' with ' + names.length + ' rooms' : ' with ' + list(names));
      add('part-unreachable', 'problem', [g.floors[f].id, cells[0]], 'Part of ' + g.floors[f].name + ' cannot be reached from the rest of the building: ' + what + '. Join it with a corridor or a stairs connection.', { floorId: g.floors[f].id, cells, roomIds: roomsOf[part].map((room) => room.id) });
    }
  }

  // exits
  const drawn = g.count > 0 || rooms.length > 0;
  if (g.exits.length === 0) {
    if (drawn) add('no-exit', 'warning', ['building'], 'No exit is marked. Mark a corridor cell on the building\'s edge as an exit so that evacuation routes can be worked out.', { floorId: building.floors[0].id, cells: [] });
  } else {
    // An evacuation never uses an elevator (spec 10.1), so the way out is asked
    // of the graph with the elevators left out. A room whose only way out is a
    // ride is told so: the building is joined, it is not safe to leave.
    const exitNodes = g.exits.map((exit) => exit.node);
    const canLeave = reachable(g, exitNodes, { reverse: true, undirected: true, noElevators: true });
    const canLeaveByElevator = g.cars.length > 0 ? reachable(g, exitNodes, { reverse: true, undirected: true }) : canLeave;
    for (const { room, floor } of rooms) {
      const entries = g.rooms.get(room.id).entries;
      if (entries.length === 0 || entries.some((entry) => canLeave[entry.node])) continue;
      const byElevator = entries.some((entry) => canLeaveByElevator[entry.node]);
      const text = byElevator
        ? nameOfRoom(room, true) + ' on ' + floor.name + ' has no route to any exit: its only way out is by elevator, and an evacuation never uses one. Join its corridor to stairs that lead to an exit.'
        : nameOfRoom(room, true) + ' on ' + floor.name + ' has no route to any exit. Join its corridor to one that leads to an exit, or mark an exit it can reach.';
      add('room-no-exit-route', 'problem', [room.id], text, { floorId: floor.id, roomId: room.id, cells: room.cells });
    }
  }

  // one-way traps (ARCHITECTURE 18.4): cells that can be walked to from an
  // exit, in passing time, and have no directed way back to one. Evacuation
  // ignores one-way, so this is the check that sees what a one-way rule does
  // to the way people move between classes.
  if (g.exits.length > 0 && g.links.some((link) => link.direction !== 'both')) {
    const exitNodes = g.exits.map((exit) => exit.node);
    const forward = reachable(g, exitNodes);
    const back = reachable(g, exitNodes, { reverse: true });
    const trapped = new Uint8Array(g.count);
    let any = false;
    for (let node = 0; node < g.count; node += 1) {
      if (forward[node] && !back[node]) {
        trapped[node] = 1;
        any = true;
      }
    }
    // A part with an exit of its own is a trap too: judged against the part
    // it was entered from, not against any exit. For each one-way connection
    // that can be taken from the exit-connected part, what it leads to and
    // what cannot walk back to the end it was taken from.
    for (const link of g.links) {
      if (link.direction === 'both') continue;
      const from = link.direction === 'ab' ? link.a : link.b;
      const to = link.direction === 'ab' ? link.b : link.a;
      if (!forward[from]) continue;
      const toward = reachable(g, to);
      if (toward[from]) continue;
      const homeward = reachable(g, from, { reverse: true });
      for (let node = 0; node < g.count; node += 1) {
        if (toward[node] && !homeward[node] && !trapped[node]) {
          trapped[node] = 1;
          any = true;
        }
      }
    }
    if (any) {
      const seen = new Uint8Array(g.count);
      for (let start = 0; start < g.count; start += 1) {
        if (!trapped[start] || seen[start]) continue;
        // one trap: the trapped cells that touch, by a step or a connection
        const nodes = [start];
        seen[start] = 1;
        for (let i = 0; i < nodes.length; i += 1) {
          const node = nodes[i];
          for (let h = 0; h < 4; h += 1) {
            const next = g.neighbours[node * 4 + h];
            if (next !== -1 && trapped[next] && !seen[next]) {
              seen[next] = 1;
              nodes.push(next);
            }
          }
          for (let k = g.linkStart[node]; k < g.linkStart[node + 1]; k += 1) {
            const link = g.links[g.linkList[k]];
            const next = link.a === node ? link.b : link.a;
            if (trapped[next] && !seen[next]) {
              seen[next] = 1;
              nodes.push(next);
            }
          }
        }
        const inTrap = new Set(nodes);
        // the one-way connections that lead in: walkable into the trap from
        // a cell outside it
        const doors = [];
        for (const link of g.links) {
          if (link.direction === 'both') continue;
          const from = link.direction === 'ab' ? link.a : link.b;
          const to = link.direction === 'ab' ? link.b : link.a;
          if (inTrap.has(to) && !inTrap.has(from)) doors.push({ link, rising: g.floors[g.nodeFloor[to]].level > g.floors[g.nodeFloor[from]].level, falling: g.floors[g.nodeFloor[to]].level < g.floors[g.nodeFloor[from]].level });
        }
        const onFloor = new Map();
        for (const node of nodes) {
          const f = g.nodeFloor[node];
          if (!onFloor.has(f)) onFloor.set(f, []);
          onFloor.get(f).push(g.nodeCell[node]);
        }
        const floorsOf = Array.from(onFloor.keys()).sort((a, b) => a - b);
        const first = floorsOf[0];
        const names = floorsOf.map((f) => g.floors[f].name);
        const way = doors.length > 0 && doors.every((door) => door.rising) ? 'down' : doors.length > 0 && doors.every((door) => door.falling) ? 'up' : null;
        const phrase = (door) => (door.rising ? 'up only' : door.falling ? 'down only' : 'one way');
        const same = doors.every((door) => phrase(door) === phrase(doors[0]));
        const what = same && doors.length > 1 ? 'Stairs ' + list(doors.map((door) => door.link.label)) + ' are ' + phrase(doors[0]) : list(doors.map((door) => 'Stairs ' + door.link.label + ' is ' + phrase(door)));
        const out = way === null ? 'out' : way;
        const text = 'Nothing on ' + list(names) + ' can get back ' + out + ': ' + what + ' and no other way leads ' + out + '.';
        const where = { floorId: g.floors[first].id, cells: onFloor.get(first).sort((a, b) => a - b), connectionIds: doors.map((door) => door.link.id) };
        // every trapped floor's cells, so Show can light them all
        where.floors = floorsOf.map((f) => ({ floorId: g.floors[f].id, cells: onFloor.get(f).sort((a, b) => a - b) }));
        if (doors.length > 0) where.connectionId = doors[0].link.id;
        add('one-way-trap', 'warning', [g.floors[first].id, ...doors.map((door) => door.link.id).sort()], text, where);
      }
    }
  }

  // dead ends: a warning when the run leads to no room, stair or exit; a note
  // when one that serves a room is longer than the fixed limit
  const scale = project.settings && project.settings.cellScale;
  const limit = scale ? (scale.unit === 'feet' ? DEAD_END_FEET : DEAD_END_METRES) : null;
  for (const end of deadEnds(project, g)) {
    const floor = building.floors.find((candidate) => candidate.id === end.floorId);
    const off = end.name !== '' ? end.name : 'a corridor at row ' + (Math.floor(end.junction / floor.width) + 1) + ', column ' + ((end.junction % floor.width) + 1);
    const served = end.roomIds.map((id) => floor.spaces.find((space) => space.id === id));
    const where = { floorId: floor.id, cells: end.cells.slice().sort((a, b) => a - b), roomIds: end.roomIds };
    const about = [floor.id, end.first];
    if (served.length === 0) {
      add('dead-end', 'warning', about, 'A dead end on ' + floor.name + ' off ' + off + ' goes nowhere: ' + plural(end.length, 'cell', 'cells') + (end.length === 1 ? ' that leads' : ' that lead') + ' to no room, stair or exit. A slip in the drawing?', where);
      continue;
    }
    const long = scale ? end.length * scale.length > limit : end.length > DEAD_END_CELLS;
    if (!long) continue; // a door's nook
    const code = scale && scale.unit === 'metres' ? 'about 6 metres' : 'about 20 feet';
    add('dead-end', 'note', about, 'A dead end on ' + floor.name + ' off ' + off + ' is ' + plural(end.length, 'cell', 'cells') + ' long' + (scale ? ' (' + lengthWords(end.length, scale) + ')' : '') + ' and serves ' + roomsWords(served) + '. Many fire codes limit dead-end corridors, often to ' + code + '; check your local code.', where);
  }

  // a stairwell in parts (a file edited elsewhere; the editor mends these as
  // they happen): the fix is joinStairwell, offered as "Join the parts"
  const floorName = (floorId) => {
    const floor = building.floors.find((candidate) => candidate.id === floorId);
    return floor ? floor.name : 'a floor that is gone';
  };
  for (const well of stairwells(building)) {
    if (well.parts < 2) continue;
    const flights = building.connections.filter((connection) => well.connectionIds.includes(connection.id));
    const key = (end) => end.floorId + ':' + end.cell;
    const parent = new Map();
    const find = (k) => {
      let root = k;
      while (parent.get(root) !== root) root = parent.get(root);
      parent.set(k, root);
      return root;
    };
    for (const flight of flights) {
      for (const end of [flight.a, flight.b]) if (!parent.has(key(end))) parent.set(key(end), key(end));
      const x = find(key(flight.a));
      const y = find(key(flight.b));
      if (x !== y) parent.set(y, x);
    }
    const byRoot = new Map();
    for (const stop of well.stops) {
      const root = find(key(stop));
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(stop);
    }
    // each part, lowest first (stops are lowest first already)
    const stopsOf = Array.from(byRoot.values()).sort((x, y) => well.stops.indexOf(x[0]) - well.stops.indexOf(y[0]));
    const words = stopsOf.map((stops) => floorName(stops[0].floorId) + ' to ' + floorName(stops[stops.length - 1].floorId));
    const first = stopsOf[0][0];
    const onFirst = stopsOf[0].filter((stop) => stop.floorId === first.floorId).map((stop) => stop.cell).sort((a, b) => a - b);
    const where = { floorId: first.floorId, cells: onFirst, well: well.letter, connectionIds: well.connectionIds.slice(), floors: stopsOf.map((stops) => ({ floorId: stops[0].floorId, cells: stops.filter((stop) => stop.floorId === stops[0].floorId).map((stop) => stop.cell).sort((a, b) => a - b) })) };
    const finding = { id: findingId('stairwell-split', well.letter), kind: 'stairwell-split', severity: 'warning', text: 'Stairwell ' + well.letter + ' is in ' + well.parts + ' parts: ' + (words.length > 2 ? words.slice(0, -1).join(', ') + ', and ' + words[words.length - 1] : words.join(', and ')) + '. Join the parts, or split the stairwell.', where, fixable: true };
    found['stairwell-split'].push(finding);
  }

  return BUILDING_CHECK_KINDS.flatMap((kind) => found[kind]);
}
