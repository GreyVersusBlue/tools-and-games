// The walkable graph of a building: every corridor and stairs cell on every
// floor is a node, numbered floor by floor in cell order. Nodes join their
// four edge-neighbours, and stairs connections join floors. For each room
// the graph holds its entries: the walkable cells a route can start or end
// on, and which room cell and side each is reached through.
//
// This module is one a published file carries, so it keeps to the linker
// rule: imports from ./schema.js on one line, `export` only directly before
// a declaration.

import { DOOR_SIDES, CELL_STAIRS, ELEVATOR_KIND, elevatorCars, isWalkable, neighbourCell } from './schema.js';

// The order every neighbour list is in: north, east, south, west.
export const HEADINGS = DOOR_SIDES;

// buildGraph(project) for a project or a published model; a bare Building
// works too. The result:
//
//   count        how many nodes
//   floors       [{ id, name, level, width, height, offset, count, nodeOfCell }]
//                nodeOfCell is an Int32Array over the floor's cells, -1 where
//                the cell cannot be walked on
//   nodeFloor    Uint16Array: the index into floors of each node
//   nodeCell     Int32Array: the cell of each node on its floor
//   stairs       Uint8Array: 1 where the node is a stairs cell that is not an
//                elevator stop
//   lifts        Uint8Array: 1 where the node is an elevator stop (a lift cell).
//                A lift cell is never walked through: a route steps onto one
//                to ride from it, and steps off one it has ridden to
//   neighbours   Int32Array of count × 4: the node to the N, E, S and W, or -1
//   links        [{ id, label, a, b, direction, levels, sameFloor }] with a
//                and b as nodes and levels = max(1, |level difference|).
//                Stairs connections come first, one link each. An elevator
//                connection makes no link of its own: each car with two or
//                more stops makes one link for every pair of its stops (so a
//                ride between two stops is one link however the stops were
//                joined), all with the car's id and { elevator: true, car,
//                staffOnly }, direction 'both'. Stairs links have no
//                `elevator` field.
//   cars         [{ id, label, link, links, stops }] one for each car that has
//                links: link is the index of its first link, links all of
//                them, stops [{ floorId, cell, node }] in floor-level order.
//                A car with fewer than two stops on walkable cells is left
//                out (its stop is still in `lifts`).
//   linkStart, linkList   the links at each node: linkList[linkStart[n] ..
//                linkStart[n + 1]) are indexes into links
//   rooms        Map of room id → { id, floorId, floor, doors, entries,
//                deadDoors }. entries are [{ node, cell, from, side, door }]:
//                the walkable cell, the room cell it is entered from, the
//                side of that room cell, whether a drawn door is there, and
//                stepFree (false for a door marked as having a step).
//                A room with doors is entered only through its doors; a room
//                with none, from every walkable cell that touches it.
//                deadDoors are the doors that face nothing walkable.
//   exits        [{ id, floorId, floor, cell, node, stepFree }] for exits on a
//                walkable cell that is not a lift cell
export function buildGraph(project) {
  const building = project.building ? project.building : project;
  const floors = [];
  const floorIndex = new Map();
  let count = 0;
  for (const floor of building.floors) {
    const nodeOfCell = new Int32Array(floor.width * floor.height).fill(-1);
    const offset = count;
    for (let cell = 0; cell < floor.cells.length; cell += 1) {
      if (isWalkable(floor.cells[cell])) {
        nodeOfCell[cell] = count;
        count += 1;
      }
    }
    floorIndex.set(floor.id, floors.length);
    floors.push({ id: floor.id, name: floor.name, level: floor.level, width: floor.width, height: floor.height, offset, count: count - offset, nodeOfCell });
  }

  const nodeFloor = new Uint16Array(count);
  const nodeCell = new Int32Array(count);
  const stairs = new Uint8Array(count);
  const lifts = new Uint8Array(count);
  const carStops = elevatorCars(building);
  for (const car of carStops) {
    for (const stop of car.stops) {
      const f = floorIndex.get(stop.floorId);
      if (f === undefined || !Number.isInteger(stop.cell) || stop.cell < 0 || stop.cell >= floors[f].nodeOfCell.length) continue;
      const node = floors[f].nodeOfCell[stop.cell];
      if (node !== -1 && building.floors[f].cells[stop.cell] === CELL_STAIRS) lifts[node] = 1;
    }
  }
  const neighbours = new Int32Array(count * 4).fill(-1);
  building.floors.forEach((floor, f) => {
    const nodeOfCell = floors[f].nodeOfCell;
    for (let cell = 0; cell < nodeOfCell.length; cell += 1) {
      const node = nodeOfCell[cell];
      if (node === -1) continue;
      nodeFloor[node] = f;
      nodeCell[node] = cell;
      if (floor.cells[cell] === CELL_STAIRS && !lifts[node]) stairs[node] = 1;
      for (let h = 0; h < 4; h += 1) {
        const next = neighbourCell(floor, cell, HEADINGS[h]);
        if (next !== -1) neighbours[node * 4 + h] = nodeOfCell[next];
      }
    }
  });

  const nodeOf = (end) => {
    const f = end ? floorIndex.get(end.floorId) : undefined;
    if (f === undefined || !Number.isInteger(end.cell) || end.cell < 0 || end.cell >= floors[f].nodeOfCell.length) return -1;
    return floors[f].nodeOfCell[end.cell];
  };
  const links = [];
  for (const connection of building.connections || []) {
    if (connection && connection.kind === ELEVATOR_KIND) continue;
    const a = nodeOf(connection.a);
    const b = nodeOf(connection.b);
    if (a === -1 || b === -1 || a === b || !stairs[a] || !stairs[b]) continue;
    const difference = Math.abs(floors[nodeFloor[a]].level - floors[nodeFloor[b]].level);
    links.push({ id: connection.id, label: connection.label, a, b, direction: connection.direction, levels: Math.max(1, difference), sameFloor: nodeFloor[a] === nodeFloor[b] });
  }
  const cars = [];
  carStops.forEach((car) => {
    const stops = [];
    for (const stop of car.stops) {
      const node = nodeOf(stop);
      if (node !== -1 && lifts[node] && !stops.some((held) => held.node === node)) stops.push({ floorId: stop.floorId, cell: stop.cell, node });
    }
    if (stops.length < 2) return;
    const entry = { id: car.id, label: car.label, link: links.length, links: [], stops };
    for (let i = 0; i < stops.length; i += 1) {
      for (let j = i + 1; j < stops.length; j += 1) {
        const difference = Math.abs(floors[nodeFloor[stops[i].node]].level - floors[nodeFloor[stops[j].node]].level);
        entry.links.push(links.length);
        links.push({ id: car.id, label: car.label, a: stops[i].node, b: stops[j].node, direction: 'both', levels: Math.max(1, difference), sameFloor: nodeFloor[stops[i].node] === nodeFloor[stops[j].node], car: cars.length, elevator: true, staffOnly: car.staffOnly === true });
      }
    }
    cars.push(entry);
  });
  const linkStart = new Int32Array(count + 1);
  for (const link of links) {
    linkStart[link.a + 1] += 1;
    linkStart[link.b + 1] += 1;
  }
  for (let node = 0; node < count; node += 1) linkStart[node + 1] += linkStart[node];
  const linkList = new Int32Array(links.length * 2);
  const filled = new Int32Array(count);
  links.forEach((link, index) => {
    for (const node of [link.a, link.b]) {
      linkList[linkStart[node] + filled[node]] = index;
      filled[node] += 1;
    }
  });

  const rooms = new Map();
  const exits = [];
  building.floors.forEach((floor, f) => {
    const nodeOfCell = floors[f].nodeOfCell;
    for (const space of floor.spaces) {
      if (space.kind !== 'room') continue;
      const entries = [];
      const deadDoors = [];
      const doors = Array.isArray(space.doors) ? space.doors : [];
      if (doors.length > 0) {
        for (const door of doors) {
          const across = neighbourCell(floor, door.cell, door.side);
          const node = across === -1 ? -1 : nodeOfCell[across];
          if (node === -1 || lifts[node]) deadDoors.push({ cell: door.cell, side: door.side });
          else entries.push({ node, cell: across, from: door.cell, side: door.side, door: true, stepFree: door.stepFree !== false });
        }
      } else {
        for (const cell of space.cells) {
          for (const side of HEADINGS) {
            const across = neighbourCell(floor, cell, side);
            const node = across === -1 ? -1 : nodeOfCell[across];
            if (node !== -1 && !lifts[node]) entries.push({ node, cell: across, from: cell, side, door: false, stepFree: true });
          }
        }
      }
      rooms.set(space.id, { id: space.id, floorId: floor.id, floor: f, doors: doors.length, entries, deadDoors });
    }
    for (const exit of floor.exits || []) {
      const node = Number.isInteger(exit.cell) && exit.cell >= 0 && exit.cell < nodeOfCell.length ? nodeOfCell[exit.cell] : -1;
      if (node !== -1 && !lifts[node]) exits.push({ id: exit.id, floorId: floor.id, floor: f, cell: exit.cell, node, stepFree: exit.stepFree !== false });
    }
  });

  return { count, floors, floorIndex, nodeFloor, nodeCell, stairs, lifts, neighbours, links, cars, linkStart, linkList, rooms, exits };
}

// The node of a cell, or -1 when the cell cannot be walked on.
export function nodeAt(graph, floorId, cell) {
  const f = graph.floorIndex.get(floorId);
  if (f === undefined || !(cell >= 0 && cell < graph.floors[f].nodeOfCell.length)) return -1;
  return graph.floors[f].nodeOfCell[cell];
}

// A node as { floorId, cell }.
export function placeOfNode(graph, node) {
  return { floorId: graph.floors[graph.nodeFloor[node]].id, cell: graph.nodeCell[node] };
}

// The nodes a room is entered through, each once, in entry order.
export function roomNodes(graph, roomId) {
  const room = graph.rooms.get(roomId);
  if (!room) return [];
  return Array.from(new Set(room.entries.map((entry) => entry.node)));
}

// The same as cells: [{ floorId, cell }].
export function entryCells(graph, roomId) {
  return roomNodes(graph, roomId).map((node) => placeOfNode(graph, node));
}

// Whether a link can be crossed starting from `node`. options.undirected
// ignores one-way connections; options.reverse walks them backwards;
// options.noElevators shuts every elevator link. An elevator link is always
// both ways.
function crossable(link, node, options) {
  if (link.elevator) return !(options && options.noElevators);
  if (link.direction === 'both' || (options && options.undirected)) return true;
  const forward = node === link.a ? link.direction === 'ab' : link.direction === 'ba';
  return options && options.reverse ? !forward : forward;
}

// One step of the search `reachable` and `components` share. A walker is on a
// node having arrived by WALKING or by RIDING; only a lift cell tells the two
// apart. A lift cell is never walked through: arrived at on foot it leads
// only into the car's links, arrived at by a ride it leads only to its
// walking neighbours (one of which may be another lift cell, which then
// leads only into rides). Everywhere else the mode does not matter and only
// WALKED is used. `mark(node, mode)` records a state and queues it if new.
const WALKED = 0;
const RODE = 1;

function spread(graph, node, mode, options, mark) {
  const lift = graph.lifts[node] === 1;
  if (!lift || mode === RODE) {
    for (let h = 0; h < 4; h += 1) {
      const next = graph.neighbours[node * 4 + h];
      if (next !== -1) mark(next, WALKED);
    }
  }
  for (let i = graph.linkStart[node]; i < graph.linkStart[node + 1]; i += 1) {
    const link = graph.links[graph.linkList[i]];
    if (link.elevator && mode === RODE) continue;
    if (!crossable(link, node, options)) continue;
    const next = link.a === node ? link.b : link.a;
    mark(next, link.elevator ? RODE : WALKED);
  }
}

// Breadth-first search. `from` is a node or a list of nodes. Returns a
// Uint8Array with 1 at every node that can be reached, the start included.
// options.reverse gives the nodes that can reach `from` instead, which only
// differs where a connection is one-way. options.noElevators leaves the
// elevators out; a lift cell can still be stepped onto, and leads nowhere.
export function reachable(graph, from, options) {
  const seen = new Uint8Array(graph.count);
  const held = new Uint8Array(graph.count * 2);
  const queue = [];
  const mark = (node, mode) => {
    if (held[node * 2 + mode]) return;
    held[node * 2 + mode] = 1;
    seen[node] = 1;
    queue.push(node * 2 + mode);
  };
  for (const node of typeof from === 'number' ? [from] : from) {
    if (!(node >= 0 && node < graph.count)) continue;
    mark(node, WALKED);
    if (graph.lifts[node]) mark(node, RODE);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head];
    spread(graph, state >> 1, state & 1, options, mark);
  }
  return seen;
}

// The parts of the building that are joined up, ignoring which way a one-way
// connection runs. { of, count }: `of` is an Int32Array giving each node the
// number of its part; parts are numbered from 0 in node order. A lift cell
// is never walked through, so two corridors that touch one lift cell are one
// part only when the car carries them somewhere (or they meet elsewhere), and
// the lift cell itself is in the part of the first node that reaches it.
// options.noElevators leaves the elevators out.
export function components(graph, options) {
  const of = new Int32Array(graph.count).fill(-1);
  const stamp = new Int32Array(graph.count * 2).fill(-1);
  const queue = [];
  const opts = { ...(options || {}), undirected: true };
  let count = 0;
  const mark = (node, mode) => {
    if (stamp[node * 2 + mode] === count) return;
    stamp[node * 2 + mode] = count;
    if (of[node] === -1) of[node] = count;
    queue.push(node * 2 + mode);
  };
  for (let start = 0; start < graph.count; start += 1) {
    if (of[start] !== -1) continue;
    queue.length = 0;
    mark(start, WALKED);
    if (graph.lifts[start]) mark(start, RODE);
    for (let head = 0; head < queue.length; head += 1) {
      const state = queue[head];
      spread(graph, state >> 1, state & 1, opts, mark);
    }
    count += 1;
  }
  return { of, count };
}
