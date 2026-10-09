// The walkable graph of a building: every corridor and stairs cell on every
// floor is a node, numbered floor by floor in cell order. Nodes join their
// four edge-neighbours, and stairs connections join floors. For each room
// the graph holds its entries: the walkable cells a route can start or end
// on, and which room cell and side each is reached through.
//
// This module is one a published file carries, so it keeps to the linker
// rule: imports from ./schema.js on one line, `export` only directly before
// a declaration.

import { DOOR_SIDES, CELL_STAIRS, isWalkable, neighbourCell } from './schema.js';

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
//   stairs       Uint8Array: 1 where the node is a stairs cell
//   neighbours   Int32Array of count × 4: the node to the N, E, S and W, or -1
//   links        [{ id, label, a, b, direction, levels, sameFloor }] with a
//                and b as nodes and levels = max(1, |level difference|)
//   linkStart, linkList   the links at each node: linkList[linkStart[n] ..
//                linkStart[n + 1]) are indexes into links
//   rooms        Map of room id → { id, floorId, floor, doors, entries,
//                deadDoors }. entries are [{ node, cell, from, side, door }]:
//                the walkable cell, the room cell it is entered from, the
//                side of that room cell, and whether a drawn door is there.
//                A room with doors is entered only through its doors; a room
//                with none, from every walkable cell that touches it.
//                deadDoors are the doors that face nothing walkable.
//   exits        [{ id, floorId, floor, cell, node }] for exits on a walkable cell
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
  const neighbours = new Int32Array(count * 4).fill(-1);
  building.floors.forEach((floor, f) => {
    const nodeOfCell = floors[f].nodeOfCell;
    for (let cell = 0; cell < nodeOfCell.length; cell += 1) {
      const node = nodeOfCell[cell];
      if (node === -1) continue;
      nodeFloor[node] = f;
      nodeCell[node] = cell;
      if (floor.cells[cell] === CELL_STAIRS) stairs[node] = 1;
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
    const a = nodeOf(connection.a);
    const b = nodeOf(connection.b);
    if (a === -1 || b === -1 || a === b || !stairs[a] || !stairs[b]) continue;
    const difference = Math.abs(floors[nodeFloor[a]].level - floors[nodeFloor[b]].level);
    links.push({ id: connection.id, label: connection.label, a, b, direction: connection.direction, levels: Math.max(1, difference), sameFloor: nodeFloor[a] === nodeFloor[b] });
  }
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
          if (node === -1) deadDoors.push({ cell: door.cell, side: door.side });
          else entries.push({ node, cell: across, from: door.cell, side: door.side, door: true });
        }
      } else {
        for (const cell of space.cells) {
          for (const side of HEADINGS) {
            const across = neighbourCell(floor, cell, side);
            const node = across === -1 ? -1 : nodeOfCell[across];
            if (node !== -1) entries.push({ node, cell: across, from: cell, side, door: false });
          }
        }
      }
      rooms.set(space.id, { id: space.id, floorId: floor.id, floor: f, doors: doors.length, entries, deadDoors });
    }
    for (const exit of floor.exits || []) {
      const node = Number.isInteger(exit.cell) && exit.cell >= 0 && exit.cell < nodeOfCell.length ? nodeOfCell[exit.cell] : -1;
      if (node !== -1) exits.push({ id: exit.id, floorId: floor.id, floor: f, cell: exit.cell, node });
    }
  });

  return { count, floors, floorIndex, nodeFloor, nodeCell, stairs, neighbours, links, linkStart, linkList, rooms, exits };
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
// ignores one-way connections; options.reverse walks them backwards.
function crossable(link, node, options) {
  if (link.direction === 'both' || (options && options.undirected)) return true;
  const forward = node === link.a ? link.direction === 'ab' : link.direction === 'ba';
  return options && options.reverse ? !forward : forward;
}

// Breadth-first search. `from` is a node or a list of nodes. Returns a
// Uint8Array with 1 at every node that can be reached, the start included.
// options.reverse gives the nodes that can reach `from` instead, which only
// differs where a connection is one-way.
export function reachable(graph, from, options) {
  const seen = new Uint8Array(graph.count);
  const queue = new Int32Array(graph.count);
  let head = 0;
  let tail = 0;
  for (const node of typeof from === 'number' ? [from] : from) {
    if (node >= 0 && node < graph.count && !seen[node]) {
      seen[node] = 1;
      queue[tail] = node;
      tail += 1;
    }
  }
  while (head < tail) {
    const node = queue[head];
    head += 1;
    for (let h = 0; h < 4; h += 1) {
      const next = graph.neighbours[node * 4 + h];
      if (next !== -1 && !seen[next]) {
        seen[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }
    for (let i = graph.linkStart[node]; i < graph.linkStart[node + 1]; i += 1) {
      const link = graph.links[graph.linkList[i]];
      if (!crossable(link, node, options)) continue;
      const next = link.a === node ? link.b : link.a;
      if (!seen[next]) {
        seen[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }
  }
  return seen;
}

// The parts of the building that are joined up, ignoring which way a one-way
// connection runs. { of, count }: `of` is an Int32Array giving each node the
// number of its part; parts are numbered from 0 in node order.
export function components(graph) {
  const of = new Int32Array(graph.count).fill(-1);
  const queue = new Int32Array(graph.count);
  let count = 0;
  for (let start = 0; start < graph.count; start += 1) {
    if (of[start] !== -1) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    of[start] = count;
    while (head < tail) {
      const node = queue[head];
      head += 1;
      for (let h = 0; h < 4; h += 1) {
        const next = graph.neighbours[node * 4 + h];
        if (next !== -1 && of[next] === -1) {
          of[next] = count;
          queue[tail] = next;
          tail += 1;
        }
      }
      for (let i = graph.linkStart[node]; i < graph.linkStart[node + 1]; i += 1) {
        const link = graph.links[graph.linkList[i]];
        const next = link.a === node ? link.b : link.a;
        if (of[next] === -1) {
          of[next] = count;
          queue[tail] = next;
          tail += 1;
        }
      }
    }
    count += 1;
  }
  return { of, count };
}
