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
//     + secondsPerStair × max(1, |level difference|) for each connection used
//
// so the first cell outside the door and the stairs cell a connection lands
// on each count as a cell, like every other.
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
// routesForSchedule(project, graph?, options?)
// createRouteCache(limit?)
//
// options, all optional:
//   avoidStairs          true: use no stairs connection (a step-free route)
//   avoidConnections     a Set or list of connection ids not to use
//   avoidCorridorNames   a Set or list of named-corridor ids (the "k…" id of
//                        an entry in a floor's `corridors`) whose cells are
//                        not to be walked on
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
//     seconds, turns, stairs }
//
//   { ok: false, reason, roomId, floorId, end, fromRoomId, toRoomId, avoiding }
//     reason     'no-room'       no room was given for one end (roomId and floorId are null)
//                'room-missing'  the room is not in the building (floorId is null)
//                'no-entry'      the room has no door and touches no corridor, or every door leads nowhere
//                'unreachable'   no way through; roomId and floorId name the room that cannot be reached
//     end        'from' or 'to': which end the room named is
//     avoiding   the options in force, any of 'stairs', 'connections', 'corridors'
//
// A route object may be handed out more than once (the cache keeps it), so
// treat it as read-only.

import { DOOR_SIDES, defaultSettings, resolveSlotRoom } from './schema.js';
import { buildGraph } from './graph.js';
import { ownDayTypes, effectiveSchedule } from './day-types.js';

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
  for (const floor of building.floors) {
    const f = base.floorIndex.get(floor.id);
    const nodeOfCell = base.floors[f].nodeOfCell;
    for (const corridor of floor.corridors || []) {
      const nodes = [];
      for (const cell of corridor.cells || []) {
        const node = cell >= 0 && cell < nodeOfCell.length ? nodeOfCell[cell] : -1;
        if (node !== -1) nodes.push(node);
      }
      corridors.set(corridor.id, { id: corridor.id, name: corridor.name, floorId: floor.id, nodes });
    }
  }
  return {
    ...base,
    routing: true,
    secondsPerCell: wholeSeconds(settings.secondsPerCell, defaults.secondsPerCell),
    secondsPerStair: wholeSeconds(settings.secondsPerStair, defaults.secondsPerStair),
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
  if (avoidStairs) avoiding.push('stairs');

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
  shutNodes.sort((a, b) => a - b);

  // the shut nodes themselves are in the key, not the corridor ids: a named
  // corridor can be redrawn without the geometry counter moving
  const key = [graph.secondsPerCell, graph.secondsPerStair, avoidStairs ? 1 : 0, shutLinks.sort().join(','), shutNodes.join(',')].join('|');
  return { key, avoidStairs, linkShut, nodeShut, avoiding };
}

function linkOpen(link, index, from, plan) {
  if (plan.avoidStairs) return false;
  if (plan.linkShut && plan.linkShut[index]) return false;
  if (link.direction === 'both') return true;
  return from === link.a ? link.direction === 'ab' : link.direction === 'ba';
}

// A room's ways in and out, in a fixed order: by cell, then by side.
function entriesOf(room) {
  return room.entries
    .map((entry) => ({ node: entry.node, from: entry.from, side: SIDE_INDEX.get(entry.side), door: entry.door === true }))
    .sort((a, b) => a.node - b.node || a.side - b.side);
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

  for (const entry of entriesOf(room)) {
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
  const stairStep = graph.secondsPerStair * SECOND;

  while (size > 0) {
    const key = heapKey[0];
    const state = heapState[0];
    drop();
    if (key > cost[state]) continue; // a later, cheaper push has already been dealt with
    const node = (state / STATES) | 0;
    const heading = state - node * STATES;
    for (let d = 0; d < 4; d += 1) {
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
      if (!linkOpen(link, index, node, plan)) continue;
      const next = link.a === node ? link.b : link.a;
      if (nodeShut && nodeShut[next]) continue;
      const nextKey = key + stairStep * link.levels + step + STAIR;
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
        seconds += graph.secondsPerStair * link.levels;
        break;
      }
    } else if (headings[i - 1] !== HEADING_NONE && headings[i - 1] !== headings[i]) {
      turns += 1;
    }
  }
  return { nodes, headings, cells, connections, connectionAt, seconds, turns };
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
  if (from.entries.length === 0) return failure('no-entry', 'from', fromRoomId, from.floorId, fromRoomId, toRoomId, plan);
  if (to.entries.length === 0) return failure('no-entry', 'to', toRoomId, to.floorId, fromRoomId, toRoomId, plan);

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
  for (const entry of entriesOf(to)) {
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
    const leaving = entriesOf(from).find((entry) => entry.node === path.nodes[0] && entry.side === path.headings[0]);
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
      stairs: path.connections.length,
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

// The quickest way from a room to any exit. The result is a route with
// `exit: { id, floorId, cell }` and `exitId` in place of `to` and `toRoomId`;
// a failure is 'no-room', 'room-missing', 'no-entry', or 'unreachable' when
// no exit can be walked to (or the building has none). Exits that tie are
// taken in id order.
export function routeToExit(graph, fromRoomId, options) {
  needRoutingGraph(graph);
  const cache = options && options.cache ? options.cache : null;
  if (cache) syncCache(cache, graph, options);
  const plan = planFor(graph, options);
  if (!fromRoomId) return failure('no-room', 'from', null, null, fromRoomId, null, plan);
  const from = graph.rooms.get(fromRoomId);
  if (!from) return failure('room-missing', 'from', fromRoomId, null, fromRoomId, null, plan);
  if (from.entries.length === 0) return failure('no-entry', 'from', fromRoomId, from.floorId, fromRoomId, null, plan);

  const shut = new Set(listOf(options ? options.avoidExits : null));
  const field = fieldFor(graph, from, plan, cache);
  let best = Infinity;
  let bestOrder = 0;
  let bestExit = null;
  let bestHeading = -1;
  const exits = graph.exits.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const exit of exits) {
    if (shut.has(exit.id) || (plan.nodeShut && plan.nodeShut[exit.node])) continue;
    for (let heading = 0; heading < STATES; heading += 1) {
      const state = exit.node * STATES + heading;
      const total = field.cost[state];
      if (total < best || (total === best && total !== Infinity && exit === bestExit && field.order[state] < bestOrder)) {
        best = total;
        bestOrder = field.order[state];
        bestExit = exit;
        bestHeading = heading;
      }
    }
  }
  if (!bestExit) return failure('unreachable', 'from', fromRoomId, from.floorId, fromRoomId, null, plan);

  const path = trace(graph, field, plan, bestExit.node, bestHeading);
  const leaving = entriesOf(from).find((entry) => entry.node === path.nodes[0] && entry.side === path.headings[0]);
  return {
    ok: true,
    fromRoomId,
    exitId: bestExit.id,
    from: place(graph, from, leaving),
    exit: { id: bestExit.id, floorId: bestExit.floorId, cell: bestExit.cell },
    cells: path.cells,
    connections: path.connections,
    connectionAt: path.connectionAt,
    seconds: path.seconds,
    turns: path.turns,
    stairs: path.connections.length,
  };
}

// Every transition's route, for every group, on every day type that is its
// own copy. Transition t is the walk from period t into period t + 1.
//
//   { days: [{ dayTypeId, groups: [{ groupId, routes: [one result per transition] }] }],
//     transitions,   how many results there are
//     pairs,         how many different (from room, to room) journeys they come to
//     searches }     how many distance fields this call had to work out
//
// A slot with no room gives 'no-room'; a slot whose room is not in the
// building gives 'room-missing' with `text`, the number the slot remembers.
// With options.cache the second call for the same geometry searches nothing.
export function routesForSchedule(project, graph, options) {
  const opts = options || {};
  const routing = routingGraph(project, graph);
  const cache = opts.cache || createRouteCache();
  syncCache(cache, routing, opts);
  const plan = planFor(routing, opts);
  const searchesBefore = cache.searches;

  const ends = (slot) => {
    const found = resolveSlotRoom(project, slot);
    if (found.room) return { id: found.room.id, text: found.text, missing: false };
    return { id: null, text: found.text, missing: found.missing };
  };

  // first every journey that is wanted, start room by start room, so that
  // each start room's field is worked out once however small the cache is
  const wanted = new Map();
  const days = [];
  let transitions = 0;
  for (const dayType of ownDayTypes(project)) {
    const groups = [];
    for (const group of project.groups) {
      const slots = effectiveSchedule(project, group.id, dayType.id);
      const walks = [];
      for (let t = 0; t + 1 < slots.length; t += 1) {
        const a = ends(slots[t]);
        const b = ends(slots[t + 1]);
        walks.push([a, b]);
        transitions += 1;
        if (a.id && b.id && a.id !== b.id) {
          if (!wanted.has(a.id)) wanted.set(a.id, new Set());
          wanted.get(a.id).add(b.id);
        }
      }
      groups.push({ groupId: group.id, walks });
    }
    days.push({ dayTypeId: dayType.id, groups });
  }

  let pairs = 0;
  for (const [fromRoomId, toRoomIds] of wanted) {
    for (const toRoomId of toRoomIds) {
      findRoute(routing, fromRoomId, toRoomId, plan, cache);
      pairs += 1;
    }
  }

  const missing = (end, which, a, b) => ({ ...failure(end.missing ? 'room-missing' : 'no-room', which, null, null, a.id, b.id, plan), text: end.text });
  return {
    days: days.map((day) => ({
      dayTypeId: day.dayTypeId,
      groups: day.groups.map((group) => ({
        groupId: group.groupId,
        routes: group.walks.map(([a, b]) => {
          if (!a.id) return missing(a, 'from', a, b);
          if (!b.id) return missing(b, 'to', a, b);
          return findRoute(routing, a.id, b.id, plan, cache);
        }),
      })),
    })),
    transitions,
    pairs,
    searches: cache.searches - searchesBefore,
  };
}
