// Routing: the one rule for how you get from room A to room B.
//
// A route runs over walkable cells (corridor and stairs), between cells that
// share an edge, and across stairs connections. Rooms are only the start and
// the end. It is the quickest by time; among routes that take the same time
// the one with the fewest turns; among those the one that uses the fewest
// stairs connections; and among those the one the search found first, which
// is fixed because the search always looks north, east, south, west and then
// along a cell's connections in the order the building lists them. So the
// same building always gives the same routes.
//
// Time. A route's seconds are
//
//   secondsPerCell × (walkable cells on the route)
//     + secondsPerStair × max(1, |level difference|) for each stairs connection used
//     + (elevator wait + elevator seconds per floor × max(1, |level difference|))
//       for each ride
//
// so the first cell outside the door and the stairs cell a connection lands
// on each count as a cell, like every other. A ride is one link between two
// stops of a car, so the wait is paid once however the car's stops were
// joined. A lift cell is never walked through: a route steps onto one to ride
// from it and steps off one it has ridden to.
//
// The search. A state is (walkable cell, heading): the heading is the way the
// walker was moving when they arrived on the cell, one of north, east, south,
// west, or none straight after a stairs connection. A change between two real
// headings is one turn. The start is one state per way out of the room: the
// cell outside, heading away from the room. The end is the cheapest of the
// end room's ways in, counting the step into the room and any turn it takes.
// The cost of a state is packed into one number,
//
//   seconds × 2^20 + turns × 2^10 + stairs
//
// and the heap pops equal numbers in the order they were pushed. Each state
// keeps the number of the push that set its cost, so a tie at the end is
// settled the same way as a tie on the way.
//
// One search from a room answers every journey that starts there. That
// result, a distance field, is four typed arrays over the states: cost,
// previous cell, previous heading and push number. Fields are kept in a
// cache, at most FIELD_LIMIT of them and FIELD_BYTES of memory, least
// recently used out first, and thrown away when the building's geometry
// changes.
//
// This module is one a published file carries, so it keeps to the linker
// rule: one-line named imports, `export` only directly before a declaration.
//
// routingGraph(project, graph?)   the graph to route on: buildGraph's, with the
//                                 walking speeds and the named corridors
// route(graph, fromRoomId, toRoomId, options?)
// routeToExit(graph, fromRoomId, options?)
// routeToCells(graph, fromRoomId, targets, options?)
// routesForSchedule(project, graph?, options?)
// runRoutes(routes, dayTypeId, bellsId?)
// walkTarget(off, periods, period)
// createRouteCache(limit?)
//
// options, all optional:
//   avoidStairs          true: a step-free route: no stairs connection, every
//                        elevator open (staff-only ones too), corridor cells
//                        marked as having a step not walked on, and doors
//                        marked as having a step not used
//   studentsOnly         true: a staff-only elevator is shut (a group's ordinary
//                        route). Ignored with avoidStairs. In the plan's key only
//                        when true and the building has a staff-only car.
//   avoidConnections     a Set or list of connection ids not to use
//   avoidCorridorNames   a Set or list of named-corridor ids (the "k…" id of
//                        an entry in a floor's `corridors`) whose cells are
//                        not to be walked on
//   ways                 an object, connection id → 'both' | 'ab' | 'ba': for this
//                        call the connection runs that way, whatever its
//                        `direction` says (a scenario's one-way lever, ARCHITECTURE
//                        18.3). A way equal to the connection's own changes nothing
//                        and is left out of the plan's key.
//   shutCells            a list of { floorId, cell }: cells not to be walked on,
//                        like the cells of avoidCorridorNames (a closed corridor)
//   undirected           true: every connection runs both ways, the building's
//                        `direction` and `ways` ignored (an evacuation uses every
//                        stair, ARCHITECTURE 18.4). In the plan's key only when true
//                        and some connection of the building is one-way; otherwise
//                        the plan is the plain one and shares its fields.
//   avoidExits           routeToExit only: a Set or list of exit ids
//   cache                a cache from createRouteCache(); without one every
//                        call searches afresh
//   geometryVersion      the store's counter. The cache is emptied when this
//                        differs from the last call's. Left out, the cache is
//                        emptied whenever it is handed a different graph.
//
// A route between two rooms is one of:
//
//   { ok: true, same: true, fromRoomId, toRoomId }       the same room, no travel
//
//   { ok: true, fromRoomId, toRoomId,
//     from: { floorId, cell, side, door },   the room cell left, through which side, and whether a drawn door is there
//     to:   { floorId, cell, side, door },   the room cell arrived in, and the side it was entered through
//     cells: [{ floorId, cell }],            the walkable cells in order; never empty
//     connections: ['c…'],                   the stairs connections used, in order
//     connectionAt: [index],                 connections[i] is taken from cells[connectionAt[i]] to the next cell
//     seconds, turns,
//     stairs,                                stairs connections used
//     rides }                                elevator rides used. A ride is in `connections` by its car's id; its
//                                            ends are cells[connectionAt[i]] and the next cell, never the connection's own ends
//
//   { ok: false, reason, roomId, floorId, end, fromRoomId, toRoomId, avoiding }
//     reason     'no-room'       no room was given for one end (roomId and floorId are null)
//                'room-missing'  the room is not in the building (floorId is null)
//                'no-entry'      the room has no door and touches no corridor, or every door leads nowhere
//                'unreachable'   no way through; roomId and floorId name the room that cannot be reached
//     end        'from' or 'to': which end the room named is
//     avoiding   the options in force, any of 'stairs', 'steps' (step-free, and the
//                building has corridor cells with a step), 'step-doors' (step-free,
//                and some door has a step), 'connections', 'corridors'
//
// A route object may be handed out more than once (the cache keeps it), so
// treat it as read-only.

import { DOOR_SIDES, CELL_CORRIDOR, defaultSettings, resolveSlotRoom, elevatorSettings } from './schema.js';
import { buildGraph, nodeAt } from './graph.js';
import { ownDayTypes, effectiveSchedule } from './day-types.js';
import { offPeriods } from './bells.js';

export const HEADING_NONE = 4;
export const FIELD_LIMIT = 64;
export const FIELD_BYTES = 64 * 1024 * 1024;
export const ROUTE_FAILURES = ['no-room', 'room-missing', 'no-entry', 'unreachable'];

const STATES = 5;
const SECOND = 1048576; // 2^20
const TURN = 1024; // 2^10
const STAIR = 1;
const OPPOSITE = [2, 3, 0, 1];
const BYTES_PER_STATE = 8 + 4 + 1 + 4;

const SIDE_INDEX = new Map(DOOR_SIDES.map((side, index) => [side, index]));

function wholeSeconds(value, fallback) {
  return Number.isFinite(value) && value >= 1 ? Math.round(value) : fallback;
}

// The graph route() works on. `graph` is buildGraph(project) when the caller
// already has it. The speeds come from the project's settings (the defaults
// for a bare building), and each named corridor becomes the list of its
// nodes.
export function routingGraph(project, graph) {
  if (graph && graph.routing === true) return graph;
  const base = graph || buildGraph(project);
  const building = project.building ? project.building : project;
  const defaults = defaultSettings();
  const settings = project.settings || defaults;
  const corridors = new Map();
  const stepNodes = [];
  for (const floor of building.floors) {
    const f = base.floorIndex.get(floor.id);
    const nodeOfCell = base.floors[f].nodeOfCell;
    // corridor cells with a step: a step-free route does not cross them
    for (const cell of Array.isArray(floor.notStepFree) ? floor.notStepFree : []) {
      const node = Number.isInteger(cell) && cell >= 0 && cell < nodeOfCell.length && floor.cells[cell] === CELL_CORRIDOR ? nodeOfCell[cell] : -1;
      if (node !== -1 && !stepNodes.includes(node)) stepNodes.push(node);
    }
    for (const corridor of floor.corridors || []) {
      const nodes = [];
      for (const cell of corridor.cells || []) {
        const node = cell >= 0 && cell < nodeOfCell.length ? nodeOfCell[cell] : -1;
        if (node !== -1) nodes.push(node);
      }
      corridors.set(corridor.id, { id: corridor.id, name: corridor.name, floorId: floor.id, nodes });
    }
  }
  stepNodes.sort((a, b) => a - b);
  const secondsPerCell = wholeSeconds(settings.secondsPerCell, defaults.secondsPerCell);
  const secondsPerStair = wholeSeconds(settings.secondsPerStair, defaults.secondsPerStair);
  // a ride's wait may be 0 and stays 0, so it does not go through wholeSeconds
  const elevator = elevatorSettings(settings);
  // every link carries its own seconds, so the search and the trace read one
  // number whatever kind of link it is
  const links = base.links.map((link) => ({ ...link, seconds: link.elevator ? elevator.wait + elevator.perFloor * link.levels : secondsPerStair * link.levels }));
  let hasStepDoor = false;
  // (a hand-made base, as Help's stairs figure builds, may have no rooms)
  if (base.rooms) for (const room of base.rooms.values()) if (room.entries.some((entry) => entry.stepFree === false)) hasStepDoor = true;
  return {
    ...base,
    links,
    routing: true,
    secondsPerCell,
    secondsPerStair,
    elevator,
    hasElevator: links.some((link) => link.elevator === true),
    hasStaffOnly: links.some((link) => link.elevator === true && link.staffOnly === true),
    stepNodes,
    hasStepDoor,
    corridors,
  };
}

function needRoutingGraph(graph) {
  if (!graph || graph.routing !== true) throw new TypeError('Routing needs a graph from routingGraph(project).');
}

export function createRouteCache(limit) {
  return {
    limit: Number.isInteger(limit) && limit > 0 ? limit : FIELD_LIMIT,
    bytesLimit: FIELD_BYTES,
    stamp: undefined,
    fields: new Map(),
    routes: new Map(),
    bytes: 0,
    searches: 0, // how many distance fields have been worked out, ever
  };
}

function listOf(value) {
  if (!value) return [];
  return Array.from(value).filter((item) => typeof item === 'string').sort();
}

// What the options mean on this graph: which links are shut, which nodes are
// shut, and a key that is the same for options that mean the same thing.
function planFor(graph, options) {
  const opts = options || {};
  const avoidStairs = opts.avoidStairs === true;
  const avoiding = [];
  if (avoidStairs) {
    avoiding.push('stairs');
    if (graph.stepNodes.length > 0) avoiding.push('steps');
    if (graph.hasStepDoor) avoiding.push('step-doors');
  }
  // staff-only elevators are shut to a group's ordinary route; a step-free
  // route is for anyone who needs it, so it ignores the option. It means
  // something only where a staff-only car is, so only then is it in the key.
  const studentsOnly = opts.studentsOnly === true && !avoidStairs && graph.hasStaffOnly;

  let linkShut = null;
  const shutLinks = [];
  const wanted = new Set(listOf(opts.avoidConnections));
  if (wanted.size > 0) {
    graph.links.forEach((link, index) => {
      if (!wanted.has(link.id)) return;
      if (!linkShut) linkShut = new Uint8Array(graph.links.length);
      linkShut[index] = 1;
      shutLinks.push(link.id);
    });
    avoiding.push('connections');
  }

  let nodeShut = null;
  const shutNodes = [];
  if (avoidStairs) {
    for (const node of graph.stepNodes) {
      if (!nodeShut) nodeShut = new Uint8Array(graph.count);
      nodeShut[node] = 1;
      shutNodes.push(node);
    }
  }
  const corridorIds = listOf(opts.avoidCorridorNames);
  if (corridorIds.length > 0) {
    for (const id of corridorIds) {
      const corridor = graph.corridors.get(id);
      if (!corridor) continue;
      for (const node of corridor.nodes) {
        if (!nodeShut) nodeShut = new Uint8Array(graph.count);
        if (!nodeShut[node]) {
          nodeShut[node] = 1;
          shutNodes.push(node);
        }
      }
    }
    avoiding.push('corridors');
  }
  // closed cells (a scenario's closed corridor) join the same list of shut
  // nodes, so a closure means one thing however it was asked for
  if (Array.isArray(opts.shutCells) && opts.shutCells.length > 0) {
    let resolved = false;
    for (const place of opts.shutCells) {
      const node = place ? nodeAt(graph, place.floorId, place.cell) : -1;
      if (node === -1) continue;
      resolved = true;
      if (!nodeShut) nodeShut = new Uint8Array(graph.count);
      if (!nodeShut[node]) {
        nodeShut[node] = 1;
        shutNodes.push(node);
      }
    }
    // a cell that is on no walkable node shuts nothing, and a failed route
    // does not say it was avoiding corridors (SV2-90b)
    if (resolved && !avoiding.includes('corridors')) avoiding.push('corridors');
  }
  shutNodes.sort((a, b) => a - b);

  // the shut nodes themselves are in the key, not the corridor ids: a named
  // corridor can be redrawn without the geometry counter moving
  const parts = [graph.secondsPerCell, graph.secondsPerStair, avoidStairs ? 1 : 0, shutLinks.sort().join(','), shutNodes.join(',')];

  // one-way overrides; only those that differ from the connection's own
  // direction mean anything, and none at all when every connection is used
  // both ways. Each part is added only when it is there, so a plan with
  // neither has the key it had before they existed.
  // undirected means something only where a connection is one-way, so in a
  // building with none the plan, and every field kept for it, is the plain one
  const wantsUndirected = opts.undirected === true;
  const undirected = wantsUndirected && graph.links.some((link) => link.direction !== 'both');
  let linkWay = null;
  if (!wantsUndirected && opts.ways && typeof opts.ways === 'object') {
    const named = [];
    graph.links.forEach((link, index) => {
      if (link.elevator) return; // a car runs both ways, always
      const way = opts.ways[link.id];
      if ((way !== 'both' && way !== 'ab' && way !== 'ba') || way === link.direction) return;
      if (!linkWay) linkWay = new Array(graph.links.length).fill(null);
      linkWay[index] = way;
      named.push(link.id + '=' + way);
    });
    if (named.length > 0) parts.push('w:' + named.sort().join(','));
  }
  if (undirected) parts.push('u');
  // what a ride costs, only where there is a car; and the staff-only rule
  if (graph.hasElevator) parts.push('e' + graph.elevator.wait + ',' + graph.elevator.perFloor);
  if (studentsOnly) parts.push('s');
  return { key: parts.join('|'), avoidStairs, studentsOnly, linkShut, nodeShut, avoiding, linkWay, undirected };
}

function linkOpen(link, index, from, plan) {
  if (link.elevator) {
    if (plan.studentsOnly && link.staffOnly) return false;
    if (plan.linkShut && plan.linkShut[index]) return false;
    return true;
  }
  if (plan.avoidStairs) return false;
  if (plan.linkShut && plan.linkShut[index]) return false;
  if (plan.undirected) return true;
  const direction = plan.linkWay && plan.linkWay[index] ? plan.linkWay[index] : link.direction;
  if (direction === 'both') return true;
  return from === link.a ? direction === 'ab' : direction === 'ba';
}

// A room's ways in and out, in a fixed order: by cell, then by side.
// A step-free plan leaves out the doors marked as having a step.
function entriesOf(room, plan) {
  return room.entries
    .filter((entry) => !(plan.avoidStairs && entry.stepFree === false))
    .map((entry) => ({ node: entry.node, from: entry.from, side: SIDE_INDEX.get(entry.side), door: entry.door === true }))
    .sort((a, b) => a.node - b.node || a.side - b.side);
}

// Whether a room can be left or entered at all under a plan.
function hasEntry(room, plan) {
  return room.entries.some((entry) => !(plan.avoidStairs && entry.stepFree === false));
}

// The search from one room: Dijkstra over (cell, heading) with a binary heap
// that pops equal costs in the order they were pushed.
function computeField(graph, room, plan) {
  const states = graph.count * STATES;
  const cost = new Float64Array(states).fill(Infinity);
  const prevNode = new Int32Array(states).fill(-1);
  const prevHeading = new Int8Array(states).fill(-1);
  const order = new Uint32Array(states);

  let capacity = 1024;
  let heapKey = new Float64Array(capacity);
  let heapOrder = new Uint32Array(capacity);
  let heapState = new Int32Array(capacity);
  let size = 0;
  let pushes = 0;

  function push(key, state) {
    if (size === capacity) {
      capacity *= 2;
      const keys = new Float64Array(capacity);
      keys.set(heapKey);
      heapKey = keys;
      const orders = new Uint32Array(capacity);
      orders.set(heapOrder);
      heapOrder = orders;
      const statesHeld = new Int32Array(capacity);
      statesHeld.set(heapState);
      heapState = statesHeld;
    }
    pushes += 1;
    const sequence = pushes;
    order[state] = sequence;
    let i = size;
    size += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapKey[parent] < key || (heapKey[parent] === key && heapOrder[parent] < sequence)) break;
      heapKey[i] = heapKey[parent];
      heapOrder[i] = heapOrder[parent];
      heapState[i] = heapState[parent];
      i = parent;
    }
    heapKey[i] = key;
    heapOrder[i] = sequence;
    heapState[i] = state;
  }

  // Takes the top off the heap; the caller has read heapKey[0] and heapState[0].
  function drop() {
    size -= 1;
    if (size === 0) return;
    const key = heapKey[size];
    const sequence = heapOrder[size];
    const state = heapState[size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= size) break;
      const right = child + 1;
      if (right < size && (heapKey[right] < heapKey[child] || (heapKey[right] === heapKey[child] && heapOrder[right] < heapOrder[child]))) child = right;
      if (key < heapKey[child] || (key === heapKey[child] && sequence < heapOrder[child])) break;
      heapKey[i] = heapKey[child];
      heapOrder[i] = heapOrder[child];
      heapState[i] = heapState[child];
      i = child;
    }
    heapKey[i] = key;
    heapOrder[i] = sequence;
    heapState[i] = state;
  }

  for (const entry of entriesOf(room, plan)) {
    if (plan.nodeShut && plan.nodeShut[entry.node]) continue;
    const state = entry.node * STATES + entry.side;
    if (cost[state] === 0) continue;
    cost[state] = 0;
    push(0, state);
  }

  const neighbours = graph.neighbours;
  const linkStart = graph.linkStart;
  const linkList = graph.linkList;
  const links = graph.links;
  const nodeShut = plan.nodeShut;
  const step = graph.secondsPerCell * SECOND;
  const lifts = graph.lifts;

  while (size > 0) {
    const key = heapKey[0];
    const state = heapState[0];
    drop();
    if (key > cost[state]) continue; // a later, cheaper push has already been dealt with
    const node = (state / STATES) | 0;
    const heading = state - node * STATES;
    // a lift cell is never walked through: arrived at on foot (a real
    // heading) it leads only into a ride, arrived at by a ride (heading none,
    // which only a link ends in at a lift cell) it leads only out on foot
    const lift = lifts[node] === 1;
    for (let d = 0; d < 4; d += 1) {
      if (lift && heading !== HEADING_NONE) break;
      const next = neighbours[node * 4 + d];
      if (next === -1 || (nodeShut && nodeShut[next])) continue;
      const nextKey = key + step + (heading !== HEADING_NONE && heading !== d ? TURN : 0);
      const nextState = next * STATES + d;
      if (nextKey < cost[nextState]) {
        cost[nextState] = nextKey;
        prevNode[nextState] = node;
        prevHeading[nextState] = heading;
        push(nextKey, nextState);
      }
    }
    for (let i = linkStart[node]; i < linkStart[node + 1]; i += 1) {
      const index = linkList[i];
      const link = links[index];
      if (lift && heading === HEADING_NONE) break;
      if (!linkOpen(link, index, node, plan)) continue;
      const next = link.a === node ? link.b : link.a;
      if (nodeShut && nodeShut[next]) continue;
      const nextKey = key + link.seconds * SECOND + step + STAIR;
      const nextState = next * STATES + HEADING_NONE;
      if (nextKey < cost[nextState]) {
        cost[nextState] = nextKey;
        prevNode[nextState] = node;
        prevHeading[nextState] = heading;
        push(nextKey, nextState);
      }
    }
  }

  return { cost, prevNode, prevHeading, order, bytes: states * BYTES_PER_STATE };
}

function syncCache(cache, graph, options) {
  const version = options ? options.geometryVersion : undefined;
  const stamp = version === undefined ? graph : 'v' + version;
  if (cache.stamp !== stamp) {
    cache.fields.clear();
    cache.routes.clear();
    cache.bytes = 0;
    cache.stamp = stamp;
  }
}

function fieldFor(graph, room, plan, cache) {
  const key = room.id + '|' + plan.key;
  if (cache) {
    const held = cache.fields.get(key);
    if (held) {
      cache.fields.delete(key);
      cache.fields.set(key, held); // most recently used goes to the back
      return held;
    }
  }
  const field = computeField(graph, room, plan);
  if (cache) {
    cache.searches += 1;
    cache.fields.set(key, field);
    cache.bytes += field.bytes;
    while (cache.fields.size > 1 && (cache.fields.size > cache.limit || cache.bytes > cache.bytesLimit)) {
      const oldest = cache.fields.keys().next().value;
      cache.bytes -= cache.fields.get(oldest).bytes;
      cache.fields.delete(oldest);
    }
  }
  return field;
}

function failure(reason, end, roomId, floorId, fromRoomId, toRoomId, plan) {
  return { ok: false, reason, roomId, floorId, end, fromRoomId: fromRoomId || null, toRoomId: toRoomId || null, avoiding: plan ? plan.avoiding.slice() : [] };
}

// Reads a route back out of a field, from an end state to the start.
function trace(graph, field, plan, node, heading) {
  const nodes = [];
  const headings = [];
  let at = node;
  let facing = heading;
  for (;;) {
    nodes.push(at);
    headings.push(facing);
    const state = at * STATES + facing;
    const before = field.prevNode[state];
    if (before === -1) break;
    facing = field.prevHeading[state];
    at = before;
  }
  nodes.reverse();
  headings.reverse();

  const cells = [];
  const connections = [];
  const connectionAt = [];
  let turns = 0;
  let seconds = 0;
  let rides = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    cells.push({ floorId: graph.floors[graph.nodeFloor[nodes[i]]].id, cell: graph.nodeCell[nodes[i]] });
    seconds += graph.secondsPerCell;
    if (i === 0) continue;
    if (headings[i] === HEADING_NONE) {
      // the connection that joins the two cells; a pair is joined once
      for (let j = graph.linkStart[nodes[i - 1]]; j < graph.linkStart[nodes[i - 1] + 1]; j += 1) {
        const index = graph.linkList[j];
        const link = graph.links[index];
        const other = link.a === nodes[i - 1] ? link.b : link.a;
        if (other !== nodes[i] || !linkOpen(link, index, nodes[i - 1], plan)) continue;
        connections.push(link.id);
        connectionAt.push(i - 1);
        seconds += link.seconds;
        if (link.elevator) rides += 1;
        break;
      }
    } else if (headings[i - 1] !== HEADING_NONE && headings[i - 1] !== headings[i]) {
      turns += 1;
    }
  }
  return { nodes, headings, cells, connections, connectionAt, seconds, turns, rides };
}

function place(graph, room, entry) {
  return { floorId: room.floorId, cell: entry.from, side: DOOR_SIDES[entry.side], door: entry.door };
}

function findRoute(graph, fromRoomId, toRoomId, plan, cache) {
  if (!fromRoomId) return failure('no-room', 'from', null, null, fromRoomId, toRoomId, plan);
  if (!toRoomId) return failure('no-room', 'to', null, null, fromRoomId, toRoomId, plan);
  const from = graph.rooms.get(fromRoomId);
  if (!from) return failure('room-missing', 'from', fromRoomId, null, fromRoomId, toRoomId, plan);
  const to = graph.rooms.get(toRoomId);
  if (!to) return failure('room-missing', 'to', toRoomId, null, fromRoomId, toRoomId, plan);
  if (fromRoomId === toRoomId) return { ok: true, same: true, fromRoomId, toRoomId };
  // after the plan is known: a step-free plan may leave a room with no door it can use
  if (!hasEntry(from, plan)) return failure('no-entry', 'from', fromRoomId, from.floorId, fromRoomId, toRoomId, plan);
  if (!hasEntry(to, plan)) return failure('no-entry', 'to', toRoomId, to.floorId, fromRoomId, toRoomId, plan);

  const routeKey = fromRoomId + '>' + toRoomId + '|' + plan.key;
  if (cache) {
    const held = cache.routes.get(routeKey);
    if (held) return held;
  }

  const field = fieldFor(graph, from, plan, cache);
  const step = graph.secondsPerCell * SECOND;
  let best = Infinity;
  let bestOrder = 0;
  let bestEntry = null;
  let bestHeading = -1;
  for (const entry of entriesOf(to, plan)) {
    if (plan.nodeShut && plan.nodeShut[entry.node]) continue;
    const into = OPPOSITE[entry.side];
    for (let heading = 0; heading < STATES; heading += 1) {
      const state = entry.node * STATES + heading;
      if (field.cost[state] === Infinity) continue;
      const total = field.cost[state] + step + (heading !== HEADING_NONE && heading !== into ? TURN : 0);
      if (total < best || (total === best && field.order[state] < bestOrder)) {
        best = total;
        bestOrder = field.order[state];
        bestEntry = entry;
        bestHeading = heading;
      }
    }
  }

  let result;
  if (!bestEntry) {
    result = failure('unreachable', 'to', toRoomId, to.floorId, fromRoomId, toRoomId, plan);
  } else {
    const path = trace(graph, field, plan, bestEntry.node, bestHeading);
    const leaving = entriesOf(from, plan).find((entry) => entry.node === path.nodes[0] && entry.side === path.headings[0]);
    result = {
      ok: true,
      fromRoomId,
      toRoomId,
      from: place(graph, from, leaving),
      to: place(graph, to, bestEntry),
      cells: path.cells,
      connections: path.connections,
      connectionAt: path.connectionAt,
      seconds: path.seconds,
      turns: path.turns + (bestHeading !== HEADING_NONE && bestHeading !== OPPOSITE[bestEntry.side] ? 1 : 0),
      stairs: path.connections.length - path.rides,
      rides: path.rides,
    };
  }
  if (cache) cache.routes.set(routeKey, result);
  return result;
}

// How do you get from room A to room B?
export function route(graph, fromRoomId, toRoomId, options) {
  needRoutingGraph(graph);
  const cache = options && options.cache ? options.cache : null;
  if (cache) syncCache(cache, graph, options);
  return findRoute(graph, fromRoomId, toRoomId, planFor(graph, options), cache);
}

// The quickest way from a room to any of a list of target nodes: the shared
// part of routeToExit and routeToCells. `targets` is [{ node, id, … }] in the
// order ties are settled (a tie goes to the earlier target); returns a
// failure, or { from, target, path, plan } for the caller to shape.
function routeToTargets(graph, fromRoomId, targets, options) {
  const cache = options && options.cache ? options.cache : null;
  if (cache) syncCache(cache, graph, options);
  const plan = planFor(graph, options);
  if (!fromRoomId) return { failed: failure('no-room', 'from', null, null, fromRoomId, null, plan) };
  const from = graph.rooms.get(fromRoomId);
  if (!from) return { failed: failure('room-missing', 'from', fromRoomId, null, fromRoomId, null, plan) };
  if (!hasEntry(from, plan)) return { failed: failure('no-entry', 'from', fromRoomId, from.floorId, fromRoomId, null, plan) };

  const field = fieldFor(graph, from, plan, cache);
  let best = Infinity;
  let bestOrder = 0;
  let bestTarget = null;
  let bestHeading = -1;
  for (const target of targets) {
    if (plan.nodeShut && plan.nodeShut[target.node]) continue;
    for (let heading = 0; heading < STATES; heading += 1) {
      const state = target.node * STATES + heading;
      const total = field.cost[state];
      if (total < best || (total === best && total !== Infinity && target === bestTarget && field.order[state] < bestOrder)) {
        best = total;
        bestOrder = field.order[state];
        bestTarget = target;
        bestHeading = heading;
      }
    }
  }
  if (!bestTarget) return { failed: failure('unreachable', 'from', fromRoomId, from.floorId, fromRoomId, null, plan) };

  const path = trace(graph, field, plan, bestTarget.node, bestHeading);
  const leaving = entriesOf(from, plan).find((entry) => entry.node === path.nodes[0] && entry.side === path.headings[0]);
  return { from, plan, target: bestTarget, path, leaving };
}

function shapeRoute(graph, found, fromRoomId) {
  const { path } = found;
  return {
    ok: true,
    fromRoomId,
    from: place(graph, found.from, found.leaving),
    cells: path.cells,
    connections: path.connections,
    connectionAt: path.connectionAt,
    seconds: path.seconds,
    turns: path.turns,
    stairs: path.connections.length - path.rides,
    rides: path.rides,
  };
}

// The quickest way from a room to any exit. The result is a route with
// `exit: { id, floorId, cell }` and `exitId` in place of `to` and `toRoomId`;
// a failure is 'no-room', 'room-missing', 'no-entry', or 'unreachable' when
// no exit can be walked to (or the building has none). Exits that tie are
// taken in id order.
export function routeToExit(graph, fromRoomId, options) {
  needRoutingGraph(graph);
  const shut = new Set(listOf(options ? options.avoidExits : null));
  const exits = graph.exits.filter((exit) => !shut.has(exit.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const found = routeToTargets(graph, fromRoomId, exits, options);
  if (found.failed) return found.failed;
  const result = shapeRoute(graph, found, fromRoomId);
  return { ok: true, fromRoomId, exitId: found.target.id, from: result.from, exit: { id: found.target.id, floorId: found.target.floorId, cell: found.target.cell }, cells: result.cells, connections: result.connections, connectionAt: result.connectionAt, seconds: result.seconds, turns: result.turns, stairs: result.stairs, rides: result.rides };
}

// The quickest way from a room to any of a list of cells, `targets` being
// [{ floorId, cell, id }] (an area of refuge, say). Like routeToExit, with
// `target: { id, floorId, cell }` and `targetId` in place of `exit` and
// `exitId`, the same failures, and ties taken in the order of the list's ids.
// A target that is on no walkable cell, or on a lift cell, is left out: a
// route never ends in a car.
export function routeToCells(graph, fromRoomId, targets, options) {
  needRoutingGraph(graph);
  const list = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const node = target ? nodeAt(graph, target.floorId, target.cell) : -1;
    if (node === -1 || graph.lifts[node]) continue;
    list.push({ node, id: target.id, floorId: target.floorId, cell: target.cell });
  }
  list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const found = routeToTargets(graph, fromRoomId, list, options);
  if (found.failed) return found.failed;
  const result = shapeRoute(graph, found, fromRoomId);
  return { ...result, targetId: found.target.id, target: { id: found.target.id, floorId: found.target.floorId, cell: found.target.cell } };
}

// Every transition's route, for every group, in every run. Transition t is
// the walk from period t into period t + 1.
//
//   { days: [{ dayTypeId, groups: [{ groupId, routes: [one result per transition] }] }],
//     bells: [{ dayTypeId, bellsId, groups }],   only when a run has a bell schedule
//     transitions,   how many results there are
//     pairs,         how many different (from room, to room) journeys they come to
//     searches }     how many distance fields this call had to work out
//
// A run is { dayTypeId, bellsId }: a day type's classes under one set of
// bells, bellsId null for the day type's regular bells (ARCHITECTURE 17.8).
// A run with regular bells is in `days`, keyed and shaped exactly as before
// bell schedules existed; a run with a bell schedule is in `bells`, in the
// order the runs were given. options.runs is the list of runs and
// options.meetingSlots(project, groupId, dayTypeId, bellsId) says where a
// group is in one (engine/runs.js's runsOf and meetingSlots: crowd.js's
// routesByRun hands both in). This module is carried by the published file
// and runs.js is not, so they come in as options. Left out, every own day
// type with its regular bells and effectiveSchedule's slots, which is what
// meetingSlots gives for a run with regular bells and no marks.
//
// A transition of a bell-schedule run whose two slots are the very slots of
// the same day type's regular run is that run's route object: the same
// rooms give the same walk. A period that does not meet under the schedule
// is an empty slot there, so a walk into it or out of it is 'no-room'.
//
// A slot with no room gives 'no-room'; a slot whose room is not in the
// building gives 'room-missing' with `text`, the number the slot remembers.
// With options.cache the second call for the same geometry searches nothing.
// The period the walk out of `period` ends in under a bell schedule whose
// `off` periods (a Set) do not meet: period + 1 when that meets; when it and
// the periods after it do not, the first period after them that does (an
// assembly in Period 3 makes the walk out of Period 2 a walk into Period 4);
// null when `period` does not meet itself or nothing meets after it, since
// the leading and trailing periods that do not meet move nobody
// (ARCHITECTURE 17.3). The walk is kept under the period it leaves.
export function walkTarget(off, periods, period) {
  if (!Number.isInteger(period) || period < 0 || period + 1 >= periods || off.has(period)) return null;
  let to = period + 1;
  while (to < periods && off.has(to)) to += 1;
  return to < periods ? to : null;
}

export function routesForSchedule(project, graph, options) {
  const opts = options || {};
  const routing = routingGraph(project, graph);
  const cache = opts.cache || createRouteCache();
  syncCache(cache, routing, opts);
  // a plan for each kind of group: a group that needs step-free routes has
  // the step-free plan, every other group the plain plan with staff-only cars
  // shut (ARCHITECTURE 19.4). Both are built from the caller's options.
  const plans = [planFor(routing, { ...opts, studentsOnly: true }), planFor(routing, { ...opts, avoidStairs: true })];
  const planOf = (group) => plans[group.stepFree === true ? 1 : 0];
  const searchesBefore = cache.searches;
  const runs = Array.isArray(opts.runs) ? opts.runs : ownDayTypes(project).map((dayType) => ({ dayTypeId: dayType.id, bellsId: null }));
  const slotsOf = typeof opts.meetingSlots === 'function' ? opts.meetingSlots : (of, groupId, dayTypeId) => effectiveSchedule(of, groupId, dayTypeId);

  const ends = (slot) => {
    const found = resolveSlotRoom(project, slot);
    if (found.room) return { id: found.room.id, text: found.text, missing: false };
    return { id: null, text: found.text, missing: found.missing };
  };

  // first every journey that is wanted, start room by start room, both plans
  // of a start room one after the other, so that each field is worked out
  // once however small the cache is
  const wanted = new Map();
  const days = [];
  const regular = new Map();
  let transitions = 0;
  for (const run of runs) {
    const bellsId = typeof run.bellsId === 'string' ? run.bellsId : null;
    const plain = bellsId === null ? null : regular.get(run.dayTypeId);
    const off = bellsId === null ? null : offPeriods(project, bellsId);
    const groups = [];
    project.groups.forEach((group, g) => {
      const slots = slotsOf(project, group.id, run.dayTypeId, bellsId);
      const walks = [];
      const same = [];
      const was = plain ? plain[g] : null;
      for (let t = 0; slots && t + 1 < slots.length; t += 1) {
        transitions += 1;
        // the period walked into: the next one, or past the ones that do not meet
        const target = off === null || off.size === 0 ? null : walkTarget(off, slots.length, t);
        const to = target === null ? t + 1 : target;
        if (to === t + 1 && was && was.slots[t] === slots[t] && was.slots[t + 1] === slots[t + 1]) {
          walks.push(null);
          same.push(t);
          continue;
        }
        const a = ends(slots[t]);
        const b = ends(slots[to]);
        walks.push([a, b]);
        if (a.id && b.id && a.id !== b.id) {
          if (!wanted.has(a.id)) wanted.set(a.id, [new Set(), new Set()]);
          wanted.get(a.id)[group.stepFree === true ? 1 : 0].add(b.id);
        }
      }
      groups.push({ groupId: group.id, slots, walks, was });
    });
    if (bellsId === null && !regular.has(run.dayTypeId)) regular.set(run.dayTypeId, groups);
    days.push({ dayTypeId: run.dayTypeId, bellsId, groups });
  }

  let pairs = 0;
  for (const [fromRoomId, byPlan] of wanted) {
    byPlan.forEach((toRoomIds, which) => {
      for (const toRoomId of toRoomIds) {
        findRoute(routing, fromRoomId, toRoomId, plans[which], cache);
        pairs += 1;
      }
    });
  }

  const missing = (end, which, a, b, plan) => ({ ...failure(end.missing ? 'room-missing' : 'no-room', which, null, null, a.id, b.id, plan), text: end.text });
  const routed = new Map();
  const groupsOf = (day) => day.groups.map((group, g) => {
    const plan = planOf(project.groups[g]);
    const routes = group.walks.map((walk, t) => {
      if (walk === null) return routed.get(group.was)[t];
      const [a, b] = walk;
      if (!a.id) return missing(a, 'from', a, b, plan);
      if (!b.id) return missing(b, 'to', a, b, plan);
      return findRoute(routing, a.id, b.id, plan, cache);
    });
    routed.set(group, routes);
    return { groupId: group.groupId, routes };
  });
  const result = { days: [] };
  const bells = [];
  for (const day of days) {
    if (day.bellsId === null) result.days.push({ dayTypeId: day.dayTypeId, groups: groupsOf(day) });
    else bells.push({ dayTypeId: day.dayTypeId, bellsId: day.bellsId, groups: groupsOf(day) });
  }
  if (bells.length > 0) result.bells = bells;
  result.transitions = transitions;
  result.pairs = pairs;
  result.searches = cache.searches - searchesBefore;
  return result;
}

// The routes of one run in a routesForSchedule() result: the entry of
// `days` keyed by dayTypeId, or with bellsId (a bell schedule's id) the
// entry of `bells` for that day type under that schedule. dayTypeId is the
// id the run is keyed by, the own day type for a day type that is the same
// as another (the caller asks effectiveDayType). Null when it is not there.
export function runRoutes(routes, dayTypeId, bellsId) {
  if (!routes || !Array.isArray(routes.days)) return null;
  if (typeof bellsId !== 'string') return routes.days.find((day) => day.dayTypeId === dayTypeId) || null;
  return Array.isArray(routes.bells) ? routes.bells.find((day) => day.dayTypeId === dayTypeId && day.bellsId === bellsId) || null : null;
}
