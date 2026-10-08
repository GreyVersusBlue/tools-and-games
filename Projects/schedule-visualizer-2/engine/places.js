// Places: the building's walkable cells cut into the stretches a person
// would point at, and the one rule for what each is called. The hotspot
// table ranks places, not single cells.
//
// A place is one of:
//
//   'corridor'    a named corridor: the walkable cells its name covers. A
//                 cell two names cover belongs to the one listed first.
//   'stretch'     a run of cells with no name, between junctions and ends
//   'junction'    cells with no name where ways meet: a cell with three or
//                 more walkable neighbours is a junction, and junction cells
//                 that touch are one place (so is a hall drawn several cells
//                 wide, where every cell has three neighbours or more)
//   'connection'  a stairs connection
//
// Stairs cells are walkable cells like any other here. Every walkable cell is
// in exactly one place, and every connection is one.
//
// A place's name comes from, in order:
//
//   1. the corridor's name, as typed
//   2. the wing of the nearest room, as typed
//   3. "by Room 204": the nearest room's number
//   4. the floor's name
//
// The nearest room is the room on the same floor with a cell the fewest
// cells away from a cell of the place, counted along rows and columns; rooms
// equally near are taken in the order the floor lists them. A connection is
// "Stairs A, Floor 1 to Floor 2" (the lower level first), or "Stairs A on
// Floor 1" when both ends are on one floor. Then the exits within
// EXIT_NEAR cells of a cell place are appended: ", by Door B".
//
//   places(project, graph?) → { places, placeOfNode, placeOfLink }
//     placeOfNode is an Int32Array over the graph's nodes and placeOfLink
//     one over graph.links, each the index into `places`. A place is
//
//     { id,            the corridor's id, the connection's id, or "floorId:cell" of its first cell
//       kind, floorId, (a connection has floorIds: [a's floor, b's floor] as well; its floorId is a's)
//       nodes,         the graph nodes of its cells, ascending; empty for a connection
//       cells,         the same as cell indexes on its floor
//       corridorId, connectionId, link (index into graph.links), or null
//       roomId,        the room the name was taken from, or null
//       exitIds,       the exits named
//       name,          the whole name as one string
//       parts }        the name in pieces, [{ text, name }]: name is true for
//                      a piece a user typed, as in directions.js
//
//   placeName(place)             the name
//   placeAt(result, graph, floorId, cell)   the place a cell is in, or null
//
//   hotspots(project, routes, dayTypeId, options)
//     the places ranked busiest first, for the hotspot table. options:
//     { graph, places (places()'s result), load (loads()'s result),
//       crowd (simulateDay()'s result, for the delay; may be left out),
//       measure: 'busiest' (the default) | 'total', limit }
//     Each row is
//     { place, load, peak, unit, groups, delay, dayDelay, cells }
//       load     the place's load: the highest load of any of its cells that
//                is not in an exclusion zone, in its busiest transition (or,
//                with 'total', over the day); a connection's own load
//       peak     that transition (the period walked out of); null with 'total'
//       groups   contributors() for the place in that transition (or the day)
//       delay    seconds of waiting the crowd model charged to the place in
//                that transition (over the day with 'total'); null without `crowd`
//       dayDelay the same over the whole day
//       cells    [{ node, cell, load, excluded }] busiest first; empty for a connection
//     A place with no load, or wholly inside exclusion zones, is left out.

import { buildGraph } from './graph.js';
import { loads, contributors } from './load.js';
import { roomName } from './findings.js';

export const PLACE_KINDS = ['corridor', 'stretch', 'junction', 'connection'];
export const EXIT_NEAR = 3;
export const JUNCTION_NEIGHBOURS = 3;

function typed(text) {
  return { text, name: true };
}

function words(text) {
  return { text, name: false };
}

function isBlank(text) {
  return typeof text !== 'string' || text.trim() === '';
}

// For every cell of a floor, how far the nearest room is and which room it
// is (its index among the floor's rooms), ties going to the room listed
// first. Distance is counted along rows and columns, through anything.
function nearestRooms(floor, rooms) {
  const size = floor.width * floor.height;
  const distance = new Int32Array(size).fill(-1);
  const owner = new Int32Array(size).fill(-1);
  let frontier = [];
  rooms.forEach((room, index) => {
    for (const cell of room.cells) {
      if (!(cell >= 0 && cell < size) || distance[cell] === 0) continue;
      distance[cell] = 0;
      owner[cell] = index;
      frontier.push(cell);
    }
  });
  for (let d = 0; frontier.length > 0; d += 1) {
    const next = [];
    for (const cell of frontier) {
      const x = cell % floor.width;
      const around = [cell - floor.width, x + 1 < floor.width ? cell + 1 : -1, cell + floor.width, x > 0 ? cell - 1 : -1];
      for (const other of around) {
        if (other < 0 || other >= size) continue;
        if (distance[other] === -1) {
          distance[other] = d + 1;
          owner[other] = owner[cell];
          next.push(other);
        } else if (distance[other] === d + 1 && owner[cell] < owner[other]) {
          owner[other] = owner[cell];
        }
      }
    }
    frontier = next;
  }
  return { distance, owner };
}

function roomParts(room) {
  const name = roomName(room, false);
  if (name === room.number) return [typed(room.number)];
  return name.endsWith(room.number) ? [words(name.slice(0, name.length - room.number.length)), typed(room.number)] : [words(name)];
}

function exitParts(floor, cells) {
  const near = [];
  for (const exit of floor.exits || []) {
    const ex = exit.cell % floor.width;
    const ey = Math.floor(exit.cell / floor.width);
    let best = Infinity;
    for (const cell of cells) {
      const away = Math.abs((cell % floor.width) - ex) + Math.abs(Math.floor(cell / floor.width) - ey);
      if (away < best) best = away;
    }
    if (best <= EXIT_NEAR) near.push(exit);
  }
  if (near.length === 0) return { exitIds: [], parts: [] };
  const named = near.filter((exit) => !isBlank(exit.doorName));
  const pieces = named.map((exit) => [typed(exit.doorName)]);
  if (named.length < near.length) pieces.push([words(named.length === 0 ? 'an exit' : 'another exit')]);
  // joined as a sentence lists things: "a", "a and b", "a, b and c"
  const parts = [words(', by ')];
  pieces.forEach((piece, index) => {
    if (index > 0) parts.push(words(index === pieces.length - 1 ? ' and ' : ', '));
    parts.push(...piece);
  });
  return { exitIds: near.map((exit) => exit.id), parts };
}

function finish(place, parts) {
  const pieces = parts.filter((part) => part.text !== '');
  place.parts = pieces;
  place.name = pieces.map((part) => part.text).join('');
  return place;
}

// The building cut into places.
export function places(project, graph) {
  const base = graph || buildGraph(project);
  const building = project.building ? project.building : project;
  const placeOfNode = new Int32Array(base.count).fill(-1);
  const placeOfLink = new Int32Array(base.links.length).fill(-1);
  const list = [];

  building.floors.forEach((floor, f) => {
    const info = base.floors[f];
    const rooms = floor.spaces.filter((space) => space.kind === 'room');
    const nearest = nearestRooms(floor, rooms);
    const add = (kind, id, nodes, corridor) => {
      const index = list.length;
      const cells = nodes.map((node) => base.nodeCell[node]);
      for (const node of nodes) placeOfNode[node] = index;
      const place = { id, kind, floorId: floor.id, nodes, cells, corridorId: corridor ? corridor.id : null, connectionId: null, link: null, roomId: null, exitIds: [], name: '', parts: [] };
      let parts;
      if (corridor && !isBlank(corridor.name)) {
        parts = [typed(corridor.name)];
      } else {
        let best = -1;
        for (const cell of cells) {
          if (nearest.owner[cell] === -1) continue;
          if (best === -1 || nearest.distance[cell] < nearest.distance[best] || (nearest.distance[cell] === nearest.distance[best] && nearest.owner[cell] < nearest.owner[best])) best = cell;
        }
        const room = best === -1 ? null : rooms[nearest.owner[best]];
        if (room && !isBlank(room.wing)) {
          parts = [typed(room.wing)];
          place.roomId = room.id;
        } else if (room && !isBlank(room.number)) {
          parts = [words('by '), ...roomParts(room)];
          place.roomId = room.id;
        } else {
          parts = [typed(floor.name)];
        }
      }
      const exits = exitParts(floor, cells);
      place.exitIds = exits.exitIds;
      list.push(finish(place, parts.concat(exits.parts)));
    };

    // 1. named corridors, in the order the floor lists them
    for (const corridor of floor.corridors || []) {
      const covered = new Set();
      for (const cell of corridor.cells || []) {
        const node = cell >= 0 && cell < info.nodeOfCell.length ? info.nodeOfCell[cell] : -1;
        if (node !== -1 && placeOfNode[node] === -1) covered.add(node);
      }
      if (covered.size === 0) continue;
      // claimed before the next name is read, so an overlap goes to the first
      const nodes = Array.from(covered).sort((a, b) => a - b);
      add('corridor', corridor.id, nodes, corridor);
    }

    // 2. what has no name: junction cells that touch, and the runs between them
    const junction = (node) => {
      let walkable = 0;
      for (let d = 0; d < 4; d += 1) if (base.neighbours[node * 4 + d] !== -1) walkable += 1;
      return walkable >= JUNCTION_NEIGHBOURS;
    };
    for (let node = info.offset; node < info.offset + info.count; node += 1) {
      if (placeOfNode[node] !== -1) continue;
      const kind = junction(node);
      const nodes = [node];
      placeOfNode[node] = -2; // being gathered
      for (let i = 0; i < nodes.length; i += 1) {
        for (let d = 0; d < 4; d += 1) {
          const other = base.neighbours[nodes[i] * 4 + d];
          if (other === -1 || placeOfNode[other] !== -1 || junction(other) !== kind) continue;
          placeOfNode[other] = -2;
          nodes.push(other);
        }
      }
      nodes.sort((a, b) => a - b);
      add(kind ? 'junction' : 'stretch', floor.id + ':' + base.nodeCell[nodes[0]], nodes, null);
    }
  });

  // 3. the stairs connections
  base.links.forEach((link, index) => {
    const a = base.floors[base.nodeFloor[link.a]];
    const b = base.floors[base.nodeFloor[link.b]];
    placeOfLink[index] = list.length;
    const place = { id: link.id, kind: 'connection', floorId: a.id, floorIds: [a.id, b.id], nodes: [], cells: [], corridorId: null, connectionId: link.id, link: index, roomId: null, exitIds: [], name: '', parts: [] };
    const parts = [words('Stairs '), typed(typeof link.label === 'string' ? link.label : '')];
    if (a.id === b.id) {
      parts.push(words(' on '), typed(a.name));
    } else {
      const [low, high] = a.level <= b.level ? [a, b] : [b, a];
      parts.push(words(', '), typed(low.name), words(' to '), typed(high.name));
    }
    list.push(finish(place, parts));
  });

  return { places: list, placeOfNode, placeOfLink };
}

// What a place is called.
export function placeName(place) {
  return place ? place.name : '';
}

// The place a cell is in, or null when the cell cannot be walked on.
export function placeAt(result, graph, floorId, cell) {
  const f = graph.floorIndex.get(floorId);
  if (f === undefined || !(cell >= 0 && cell < graph.floors[f].nodeOfCell.length)) return null;
  const node = graph.floors[f].nodeOfCell[cell];
  return node === -1 ? null : result.places[result.placeOfNode[node]];
}

// The busiest places, for the hotspot table.
export function hotspots(project, routes, dayTypeId, options) {
  const opts = options || {};
  const graph = opts.graph || buildGraph(project);
  const cut = opts.places || places(project, graph);
  const load = opts.load || loads(project, routes, dayTypeId, graph);
  if (!load) return [];
  const byTotal = opts.measure === 'total';
  const crowd = opts.crowd && Array.isArray(opts.crowd.transitions) ? opts.crowd.transitions : null;

  const rows = [];
  cut.places.forEach((place, order) => {
    const isLink = place.kind === 'connection';
    const members = isLink ? [place.link] : place.nodes;
    const source = isLink ? load.connections : load.cells;
    const shut = isLink ? load.excludedConnections : load.excluded;
    const open = members.filter((member) => !shut[member]);
    if (open.length === 0) return;

    let best = 0;
    let peak = null;
    if (byTotal) {
      for (const member of open) if (source.total[member] > best) best = source.total[member];
    } else {
      for (let t = 0; t < load.transitions; t += 1) {
        for (const member of open) {
          if (source.byTransition[t][member] > best) {
            best = source.byTransition[t][member];
            peak = t;
          }
        }
      }
    }
    if (best === 0) return;

    let delay = null;
    let dayDelay = null;
    if (crowd) {
      dayDelay = 0;
      let atPeak = 0;
      crowd.forEach((transition) => {
        const charged = isLink ? transition.connectionDelay : transition.cellDelay;
        let sum = 0;
        for (const member of members) sum += charged[member] || 0;
        dayDelay += sum;
        if (transition.period === peak) atPeak = sum;
      });
      delay = byTotal ? dayDelay : atPeak;
    }

    const where = isLink ? { links: members } : { nodes: members };
    const which = byTotal ? source.total : source.byTransition[peak];
    rows.push({
      place,
      order,
      load: best,
      peak,
      unit: load.unit,
      groups: contributors(project, routes, dayTypeId, where, graph, byTotal ? undefined : { period: peak }),
      delay,
      dayDelay,
      cells: isLink ? [] : members
        .map((node) => ({ node, cell: graph.nodeCell[node], load: which[node], excluded: shut[node] === 1 }))
        .sort((a, b) => b.load - a.load || a.node - b.node),
    });
  });

  rows.sort((a, b) => b.load - a.load || (b.delay || 0) - (a.delay || 0) || a.order - b.order);
  const limited = Number.isInteger(opts.limit) && opts.limit >= 0 ? rows.slice(0, opts.limit) : rows;
  return limited.map(({ order, ...row }) => row);
}
